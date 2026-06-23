const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// MONITOR DE TRÁFICO GLOBAL EN TIEMPO REAL
// ==========================================
app.use((req, res, next) => {
    console.log(`[NET-TRAFFIC] ${new Date().toISOString()} -> IP: ${req.ip} | MÉTODO: ${req.method} | RUTA SOLICITADA: ${req.originalUrl}`);
    next();
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ==========================================
// SECTOR DE CONFIGURACIÓN Y SEGURIDAD
// ==========================================
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";
const MONGO_URI = process.env.MONGO_URI || "TU_CADENA_DE_CONEXION_DE_ATLAS_AQUI";

// Conexión Estructurada a MongoDB Atlas
mongoose.connect(MONGO_URI)
    .then(() => console.log('► CONEXIÓN EXITOSA A MONGODB ATLAS ◄'))
    .catch(err => console.error('❌ ERROR AL CONECTAR MONGODB:', err));

// Esquema de datos purificado para el Pasajero de Drivery OS
const PasajeroSchema = new mongoose.Schema({
    pasajeroId: { type: String, required: true, unique: true },
    clavePasajero: { type: String, required: true },
    profilePicUrl: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const Pasajero = mongoose.model('Pasajero', PasajeroSchema);

// ==========================================
// CONFIGURACIÓN DE ALMACENAMIENTO (MULTER)
// ==========================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const pasajeroId = req.body.pasajeroId || 'anonimo';
        cb(null, `${pasajeroId}_${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cache para la tasa del BCV
let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor; 
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 3000 });
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        return bcvCache.valor;
    } catch (e) { 
        console.warn("[WARN] No se pudo consultar DolarAPI, usando tasa en cache:", bcvCache.valor);
        return bcvCache.valor; 
    }
}

// ==========================================
// ENDPOINT: REGISTRO DE PASAJEROS (MONGO)
// ==========================================
app.post('/api/register', upload.single('profilePic'), async (req, res) => {
    try {
        const { pasajeroId, clavePasajero } = req.body;
        
        if (!pasajeroId || !clavePasajero) {
            return res.status(400).json({ success: false, response: "El ID del Pasajero y la Clave son obligatorios." });
        }

        const fileUrl = req.file 
            ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
            : null;

        const pasajeroGuardado = await Pasajero.findOneAndUpdate(
            { pasajeroId: pasajeroId },
            { 
                clavePasajero: clavePasajero,
                profilePicUrl: fileUrl 
            },
            { new: true, upsert: true }
        );

        console.log(`[DATABASE] Registro persistido para Pasajero ID: ${pasajeroGuardado.pasajeroId}`);

        res.json({
            success: true,
            response: "Sistema de Drivery OS conectado y persistido con éxito.",
            pasajero: {
                id: pasajeroGuardado.pasajeroId,
                profilePicUrl: pasajeroGuardado.profilePicUrl
            }
        });
    } catch (e) {
        console.error("Error en Registro Base Datos:", e.message);
        res.status(500).json({ success: false, response: "Error interno salvando credenciales del pasajero." });
    }
});

// ==========================================
// ENDPOINT 1: PROCESAMIENTO INICIAL DE VOZ (BLINDADO)
// ==========================================
app.post('/api/command', async (req, res) => {
    const textInput = req.body.query || req.body.command;
    console.log(`\n[COMMAND] Nueva instrucción de voz recibida: "${textInput}"`);

    if (!textInput) {
        return res.status(400).json({ success: false, response: "No se recibió ninguna instrucción de voz válida." });
    }

    let tasa = 45.10;
    let destinoNombre = null;

    try {
        tasa = await obtenerTasaBCV();

        console.log("[GROQ] Solicitando extracción de estructura limpia a la IA...");
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}. No prose. If user specifies a well-known place in Caracas (like Sambil, Quinta Crespo, La Candelaria, Colonia Tovar), append ', Caracas, Venezuela' to the destination field." }, 
                { role: "user", content: textInput }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const contentRaw = completion.choices[0].message.content;
        console.log(`[GROQ] Respuesta JSON cruda: ${contentRaw}`);
        
        const parsedJson = JSON.parse(contentRaw);
        destinoNombre = parsedJson.destino;

        if (!destinoNombre || destinoNombre.trim() === "") {
            console.error("[GROQ ERROR] El JSON devuelto no contiene la propiedad 'destino' o está vacía.");
            return res.status(422).json({ success: false, response: "No logré extraer una dirección clara de tu comando de voz." });
        }

        console.log(`[MAPS] Consultando coordenadas en Google Cloud para: "${destinoNombre}"`);
        let geo;
        try {
            geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`, { timeout: 6000 });
        } catch (errorGeo) {
            console.error("[❌ MAPS API ERROR]:", errorGeo.message);
            return res.status(502).json({ success: false, response: "Error de comunicación con el servidor de mapas de Google." });
        }

        if (!geo.data.results || geo.data.results.length === 0 || geo.data.status !== "OK") {
            console.error(`[MAPS ERROR] No se hallaron resultados para la dirección. Status Google: ${geo.data.status}`);
            return res.status(422).json({ success: false, response: `No logré ubicar geográficamente el destino: ${destinoNombre}. Verifica la dirección.` });
        }

        const destCoords = geo.data.results[0].geometry.location;
        console.log(`[MAPS SUCCESS] Coordenadas fijadas -> Lat: ${destCoords.lat}, Lng: ${destCoords.lng}`);

        const basePrice = Math.random() * (5.5 - 3.0) + 3.0;
        const fleetData = [
            { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
            { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" }
        ];

        console.log("[SUCCESS] Enviando paquete de datos estruturados al APK cliente.");
        return res.json({ 
            success: true,
            destCoords: { lat: destCoords.lat, lng: destCoords.lng }, 
            destinoPurificado: destinoNombre,
            response: `Sincronizando ruta a ${destinoNombre}. Iniciando orquestación en segundo plano.`, 
            display: { fleet: fleetData } 
        });

    } catch (e) { 
        console.error("[CRITICAL ERROR] Quiebre total en el endpoint /api/command:", e);
        
        // Extrae el mensaje de error real del sistema y se lo inyecta a la respuesta de voz
        const errorLimpio = e.message || "Error desconocido en el hilo principal.";
        return res.status(500).json({ 
            success: false, 
            response: `Atención: Fallo en el núcleo de la IA. Motivo técnico: ${errorLimpio}` 
        }); 
    }
});

// ==========================================
// ENDPOINT 2: EL CEREBRO DEL AGENTE (MANOS IA)
// ==========================================
app.post('/api/agent/action', async (req, res) => {
    const { appActual, screenNodes, destino } = req.body;

    if (!screenNodes || !destino) {
        return res.status(400).json({ action: "NONE", reason: "Faltan datos de la pantalla o destino." });
    }

    try {
        const promptSistema = `Eres el módulo de manos mecánicas de Drivery OS. Tu trabajo es analizar los elementos de texto e IDs de la interfaz de la aplicación de movilidad "${appActual}" (puede ser Ridery o Yummy) y decidir el siguiente clic o escritura para cotizar un viaje hacia "${destino}".

        Debes retornar ÚNICAMENTE un objeto JSON con esta estructura exacta:
        {
           "action": "CLICK" | "WRITE" | "EXTRACT_PRICE" | "FINISH",
           "target_id": "ID del elemento XML o recurso de Android sobre el que se actúa",
           "text_to_write": "El texto a escribir si la acción es WRITE, de lo contrario vacío",
           "reason": "Breve explicación técnica de por qué tomaste esta decisión"
        }

        Reglas de Decisión:
        1. Si ves un campo de entrada de texto para buscar direcciones (ej: "¿A dónde vamos?", "Introduce destino", "search", "destination"), tu acción es "WRITE", pones su ID en "target_id" y colocas el valor de "${destino}" en "text_to_write".
        2. Si el usuario ya escribió pero hay que confirmar la dirección tocando el primer resultado de la lista de sugerencias o un botón de 'Confirmar', tu acción es "CLICK".
        3. Si la app ya está en la pantalla de selección de vehículos y muestra los precios en pantalla (tarifas con $, Bs, Eco, Moto, etc), tu acción es "EXTRACT_PRICE".
        4. Si no reconoces nada útil o ya terminaste el flujo, la hace es "FINISH".`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: promptSistema },
                { role: "user", content: `Estructura de la pantalla actual de la aplicación:\n${JSON.stringify(screenNodes)}` }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const decisionIA = JSON.parse(completion.choices[0].message.content);
        res.json(decisionIA);

    } catch (e) {
        console.error("Error en Agente Autónomo:", e.message);
        res.status(500).json({ action: "NONE", reason: "Error procesando los nodos de la interfaz." });
    }
});

// ==========================================
// CAPTURADOR EXPLICÍTÓ DE ERRORES 404
// ==========================================
app.use((req, res, next) => {
    console.error(`[🚨 RUTA DESCONOCIDA - 404] Interceptado tráfico a ruta inválida: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        success: false,
        response: `La ruta '${req.originalUrl}' no existe en la infraestructura de este core.`
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE IN PORT ${PORT}`));
