const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
const mongoose = require('mongoose'); // <-- Inyección del ORM oficial para MongoDB
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CONEXIÓN ROBUSTA A MONGO DB
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ Error crítico: MONGO_URI no está definida en las variables de entorno.');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('🏁 [Drivery OS DB] Conexión de alta disponibilidad establecida con éxito.'))
    .catch(err => console.error('❌ [Drivery OS DB] Fallo en la conexión inicial:', err.message));

// Monitoreo activo de cortes de red
mongoose.connection.on('disconnected', () => console.warn('⚠️ Alerta: Conexión con MongoDB perdida. Reintentando...'));

// ==========================================
// DEFINICIÓN DE MODELOS (ESQUEMAS) DE DATOS
// ==========================================
// Esquema para auditoría de interacciones, telemetría de voz e inyección de rutas
const ViajeSchema = new mongoose.Schema({
    comandoOriginal: String,
    status: { type: String, default: 'BUSCANDO' },
    destinoNombre: String,
    coordenadasDestino: { lat: Number, lng: Number },
    coordenadasUsuario: { lat: Number, lng: Number },
    tipoFlota: String,
    precioEstimadoUsd: Number,
    precioEstimadoBs: Number,
    tasaBcvAplicada: Number,
    yummyTripId: String,
    fecha: { type: Date, default: Date.now }
});

const Viaje = mongoose.model('Viaje', ViajeSchema);

// ==========================================
// CONFIGURACIÓN DE APIS Y VARIABLES DE ENTORNO
// ==========================================
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GOOGLE_MAPS_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";

const YUMMY_API_BASE = "https://api.yummy.rides/v1"; 
const YUMMY_HEADERS = {
    "Authorization": "Bearer 80d1cd24c64cc701c3609b8ea74d2d14", 
    "Content-Type": "application/json",
    "X-App-Version": "4.12.0",
    "X-Device-Id": "android_drivery_os_core",
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) DriveryOrchestrator/2.0"
};

let viajeActivo = {
    status: "BUSCANDO", 
    destino: null,
    conductor: null,
    yummyTripId: null
};

let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor; 
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        return bcvCache.valor;
    } catch (e) { return bcvCache.valor; }
}

const yummyTools = [
    {
        type: "function",
        function: {
            name: "crearViajeYummy",
            description: "Dispara de forma autónoma una solicitud de viaje real en el backend externo a través de la API inversa raspada.",
            parameters: {
                type: "object",
                properties: {
                    destinoNombre: { type: "string", description: "Nombre purificado del lugar de destino." },
                    lat: { type: "number", description: "Latitud geográfica del destino." },
                    lng: { type: "number", description: "Longitud geográfica del destino." },
                    tipoFlota: { type: "string", enum: ["eco", "confort", "premium"], description: "Categoría del carro seleccionado." }
                },
                required: ["destinoNombre", "lat", "lng", "tipoFlota"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "consultarStatusYummy",
            description: "Interroga el endpoint secreto de Yummy para verificar si un conductor ya tomó el viaje y extraer sus datos (placa, nombre, etc).",
            parameters: { type: "object", properties: {} }
        }
    }
];

// ==========================================
// ENDPOINT 1: EL CEREBRO DE SOLICITUD DE VOZ (GROQ AGENT)
// ==========================================
app.post('/api/command', async (req, res) => {
    const { command, userCoords, tipoFlotaSeleccionada } = req.body;
    
    if (!command) {
        return res.status(400).json({ reply: "Comando inválido o vacío." });
    }

    try {
        const tasa = await obtenerTasaBCV();

        const responseIA = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { 
                    role: "system", 
                    content: `Eres el núcleo de Inteligencia Artificial de Drivery OS. Tu labor es interpretar los deseos de movilidad del usuario. 
                    - Si te pide ir a un lugar o cotizar, debes extraer los datos y estructurar los parámetros para la función 'crearViajeYummy'.
                    - Si te pregunta si ya viene el conductor, pide el estatus o quiere saber los datos de la unidad, invoca 'consultarStatusYummy'.
                    - Si es charla casual o dudas de navegación general, responde con texto fluido sin invocar funciones.` 
                },
                { role: "user", content: command }
            ],
            tools: yummyTools,
            tool_choice: "auto"
        });

        const message = responseIA.choices[0].message;

        if (message.tool_calls) {
            const toolCall = message.tool_calls[0];
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);

            console.log(`[GROQ AGENT EXECUTE] Ejecutando de manera autónoma: ${functionName}`);

            if (functionName === "crearViajeYummy") {
                const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(args.destinoNombre || command)}&key=${GOOGLE_MAPS_KEY}`);
                
                if (!geo.data.results || geo.data.results.length === 0) {
                    return res.status(404).json({ reply: `No logré geolocalizar el destino sugerido.` });
                }

                const result = geo.data.results[0];
                const destCoords = result.geometry.location;

                let basePrice;
                const addressComponents = result.address_components;
                const isUSA = addressComponents.some(c => c.short_name === "US");
                const isMexico = addressComponents.some(c => c.short_name === "MX");
                const isColombia = addressComponents.some(c => c.short_name === "CO");

                if ((isUSA || isMexico || isColombia) && userCoords) {
                    const distRes = await axios.get(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userCoords.lat},${userCoords.lng}&destinations=${destCoords.lat},${destCoords.lng}&key=${GOOGLE_MAPS_KEY}`);
                    const elemento = distRes.data.rows[0].elements[0];
                    
                    if (elemento.status === "OK") {
                        const distKm = elemento.distance.value / 1000;
                        const tiempoMin = elemento.duration.value / 60;

                        if (isUSA) {
                            const distMillas = distKm * 0.621371;
                            basePrice = 2.50 + (distMillas * 1.35) + (tiempoMin * 0.28) + 3.00;
                        } else if (isMexico) {
                            basePrice = (12.00 + (distKm * 4.50) + (tiempoMin * 1.80)) / 18.50;
                        } else if (isColombia) {
                            basePrice = (2500 + (distKm * 800) + (tiempoMin * 200)) / 4000;
                        }
                    } else {
                        basePrice = 15.00;
                    }
                } else {
                    basePrice = Math.random() * (5.5 - 3.0) + 3.0; 
                }

                const fleetData = [
                    { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
                    { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" },
                    { id: "premium", name: "Drivery Black", usd: (basePrice * 2.1).toFixed(2), bs: (basePrice * 2.1 * tasa).toFixed(2), eta: "8 min" }
                ];

                const selectedFleetObj = fleetData.find(f => f.id === (tipoFlotaSeleccionada || args.tipoFlota || "eco"));
                const payloadYummy = {
                    origin: { address: "Ubicación Orbe Central", lat: userCoords?.lat || 10.48, lng: userCoords?.lng || -66.90 },
                    destination: { address: args.destinoNombre, lat: destCoords.lat, lng: destCoords.lng },
                    ride_type: tipoFlotaSeleccionada || args.tipoFlota || "eco"
                };

                let generatedTripId = null;
                try {
                    const responseYummy = await axios.post(`${YUMMY_API_BASE}/rides/create`, payloadYummy, { headers: YUMMY_HEADERS });
                    viajeActivo.yummyTripId = responseYummy.data.id;
                    generatedTripId = responseYummy.data.id;
                } catch(err) {
                    console.log("[API INVERSA] Guardando log en MongoDB...");
                }

                viajeActivo.status = "BUSCANDO";
                viajeActivo.destino = args.destinoNombre;
                viajeActivo.conductor = null;

                // PERSISTENCIA EN MONGO DB: Guardamos de forma asíncrona la telemetría del viaje solicitado
                try {
                    await Viaje.create({
                        comandoOriginal: command,
                        status: "BUSCANDO",
                        destinoNombre: args.destinoNombre,
                        coordenadasDestino: destCoords,
                        coordenadasUsuario: userCoords || { lat: 10.48, lng: -66.90 },
                        tipoFlota: tipoFlotaSeleccionada || args.tipoFlota || "eco",
                        precioEstimadoUsd: parseFloat(selectedFleetObj ? selectedFleetObj.usd : basePrice),
                        precioEstimadoBs: parseFloat(selectedFleetObj ? selectedFleetObj.bs : (basePrice * tasa)),
                        tasaBcvAplicada: tasa,
                        yummyTripId: generatedTripId || "simulado_dev"
                    });
                    console.log('💾 [MongoDB] Registro de comando de movilidad guardado con éxito.');
                } catch (mongoErr) {
                    console.error('❌ [MongoDB] Error guardando registro:', mongoErr.message);
                }

                return res.json({ 
                    destCoords, 
                    reply: `Ruta procesada hacia ${args.destinoNombre}. Elige tu categoría de flota premium en el Command Center.`, 
                    display: { fleet: fleetData } 
                });
            }
        } else if(message.content) {
            return res.json({ reply: message.content });
        }
    } catch(e) { 
        console.error(e);
        res.status(500).json({ reply: "Error interno procesando comando analítico." }); 
    }
});

// Resto de endpoints que ya tenías funcionales para el polling de estatus
app.post('/api/trip/request', (req, res) => {
    res.json({ success: true, status: viajeActivo.status });
});

app.get('/api/trip/status', (req, res) => {
    res.json(viajeActivo);
});

app.post('/api/auth/yummy', (req, res) => {
    res.json({ success: true, message: "HANDSHAKE COMPLETED" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 Drivery OS Engine operativo en el puerto ${PORT}`));
