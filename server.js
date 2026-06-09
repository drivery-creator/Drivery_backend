const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================================================
// 1. CONEXIÓN ROBUSTA A MONGO DB (DRIVERY OS CLUSTER)
// ==========================================================================
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ Error crítico: MONGO_URI no está definida en las variables de entorno.');
    process.exit(1);
}

const connectDB = () => {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🏁 [Drivery OS DB] Conexión de alta disponibilidad establecida con éxito.'))
        .catch(err => {
            console.error('❌ [Drivery OS DB] Fallo en la conexión inicial:', err.message);
            setTimeout(connectDB, 5000); // Reintento estratégico
        });
};
connectDB();

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ Alerta: Conexión con MongoDB perdida. Intentando reconectar...');
});

// ==========================================================================
// 2. MODELOS Y ESQUEMAS DE DATOS (PERSISTENCIA EN LA NUBE)
// ==========================================================================
const UsuarioSchema = new mongoose.Schema({
    telefono: { type: String, required: true, unique: true },
    pinCifrado: { type: String, required: true }, 
    statusEnlace: { type: String, default: 'VINCULADO' },
    balanceUsd: { type: Number, default: 0.00 },   
    balanceBs: { type: Number, default: 0.00 },    
    ultimaConexion: { type: Date, default: Date.now }
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

const TransaccionSchema = new mongoose.Schema({
    telefonoUsuario: { type: String, required: true },
    montoBs: { type: Number, required: true },
    montoUsd: { type: Number, required: true },
    referencia: { type: String, required: true, unique: true }, 
    bancoOrigen: { type: String, default: 'PAGO MÓVIL MANUAL' },
    status: { type: String, enum: ['PROCESANDO', 'APROBADO', 'RECHAZADO'], default: 'PROCESANDO' },
    fecha: { type: Date, default: Date.now }
});
const Transaccion = mongoose.model('Transaccion', TransaccionSchema);

const ViajeSchema = new mongoose.Schema({
    telefonoUsuario: { type: String, required: true },
    comandoOriginal: String,
    status: { type: String, enum: ['BUSCANDO', 'ASIGNADO', 'FINALIZADO', 'CANCELADO'], default: 'BUSCANDO' },
    destinoNombre: String,
    coordenadasDestino: { lat: Number, lng: Number },
    coordenadasUsuario: { lat: Number, lng: Number },
    tipoFlota: String,
    precioEstimadoUsd: Number,
    precioEstimadoBs: Number,
    tasaBcvAplicada: Number,
    yummyTripId: { type: String, required: true, unique: true }, 
    datosConductor: { type: Object, default: null }, 
    fecha: { type: Date, default: Date.now }
});
const Viaje = mongoose.model('Viaje', ViajeSchema);

// ==========================================================================
// 3. CONFIGURACIÓN DE APIS EXTERNAS Y VARIABLES GLOBALES
// ==========================================================================
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY; // Protegido en variables de entorno
const YUMMY_API_BASE = process.env.YUMMY_API_BASE || "https://api.yummy.rides/v1"; 

let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor; 
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 4000 });
        if (res.data && res.data.promedio) {
            bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
            console.log(`💱 [BCV API] Tasa oficial actualizada en vivo: ${bcvCache.valor} Bs/USD`);
        }
        return bcvCache.valor;
    } catch (e) { 
        console.warn('⚠️ Fallo al consultar DolarAPI, usando caché de respaldo:', bcvCache.valor);
        return bcvCache.valor; 
    }
}

const SYSTEM_PROMPT_DRIVERY = `Eres el núcleo de Inteligencia Artificial de Drivery OS, un orquestador táctico de movilidad premium para Venezuela. Tu única función es procesar comandos de voz de usuarios que desean transportarse y extraer coordenadas geográficas precisas.

RESTRICCIONES GEOGRÁFICAS STRICTAS (POLÍTICA SIN MARGEN DE ERROR):
1. Cualquier dirección, punto de interés, local comercial, avenida, urbanización o municipio dictado por el usuario DEBE ser interpretado, buscado y geolocalizado ÚNICAMENTE dentro del territorio de la República Bolivariana de Venezuela (Priorizando el área metropolitana de Caracas, Miranda y estados del país).
2. Si el usuario menciona un lugar genérico (ej. "Las Mercedes", "El Hatillo", "Chacao", "CCCT", "Plaza Altamira", "La Candelaria", "San Román", "Sambil"), asume por defecto y de manera obligatoria su ubicación real en Caracas, Venezuela. Añade siempre ", Venezuela" al final de la búsqueda interna.
3. Si el usuario intenta dictar una ruta o destino fuera de Venezuela (ej. "llévame a Miami", "vuelo a Madrid" o "viaje a Bogotá"), debes detectar que está fuera de los límites y denegar la solicitud con un tono premium, sofisticado y sutil, indicando que la flota opera exclusivamente en el espacio terrestre nacional.

FORMATO OBLIGATORIO DE RESPUESTA (JSON PURO):
Debes analizar el texto y responder exclusivamente en este formato JSON, sin textos introductorios, código Markdown ni explicaciones fuera del objeto:
{
  "success": true,
  "reply": "Entendido. Sincronizando unidad hacia [Nombre del Lugar Limpio], Caracas.",
  "destinoProcesado": "[Nombre del Lugar Limpio], Caracas, Venezuela"
}

Si el destino está fuera de Venezuela o es completamente indescifrable:
{
  "success": false,
  "reply": "Comando fuera de la zona de cobertura de la flota nacional. Por favor indique un destino válido en Venezuela.",
  "destinoProcesado": null
}`;

// ==========================================================================
// 4. ENDPOINTS DE LA API REST
// ==========================================================================

// --- ENDPOINT EXTERNO PROXY: AUTENTICACIÓN ESPEJO ---
app.post('/api/auth/external', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ success: false, message: "CAMPOS INCOMPLETOS" });
    }

    try {
        console.log(`📡 [PROXY GATEWAY] Handshake externo para terminal: ${phone}`);

        const respuestaExterna = await axios.post(`${YUMMY_API_BASE}/auth/login`, {
            phone_number: phone,
            pin: password,
            device_type: "android"
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-App-Version": "4.12.0",
                "X-Device-Id": "android_drivery_os_core",
                "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) DriveryOrchestrator/2.0"
            },
            timeout: 7000
        });

        const tokenReal = respuestaExterna.data.token || respuestaExterna.data.accessToken;

        let usuario = await Usuario.findOne({ telefono: phone });
        if (usuario) {
            usuario.pinCifrado = password;
            usuario.ultimaConexion = Date.now();
            await usuario.save();
        } else {
            usuario = await Usuario.create({
                telefono: phone,
                pinCifrado: password,
                balanceUsd: 0.00,
                balanceBs: 0.00
            });
        }

        return res.json({ 
            success: true, 
            tokenExterno: tokenReal,
            message: "SESIÓN ESPEJADA CON ÉXITO",
            user: { telefono: usuario.telefono, balanceUsd: usuario.balanceUsd }
        });

    } catch (error) {
        console.error('❌ [Proxy Auth Error] Fallo al espejar sesión remota:', error.message);
        return res.status(401).json({ success: false, message: "FALLA DE AUTENTICACIÓN EN LA CUENTA EXTERNA" });
    }
});

// --- ENDPOINT: EL CEREBRO DE VOZ ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords } = req.body;
    
    if (!command) {
        return res.status(400).json({ reply: "Comando inválido o vacío." });
    }

    const baseCoords = userCoords && userCoords.lat ? userCoords : { lat: 10.4806, lng: -66.9036 };

    try {
        const tasa = await obtenerTasaBCV();

        const responseIA = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: SYSTEM_PROMPT_DRIVERY },
                { role: "user", content: command }
            ],
            response_format: { type: "json_object" }
        });

        let aiResult;
        try {
            aiResult = JSON.parse(responseIA.choices[0].message.content);
        } catch (parseErr) {
            console.error("❌ Error parseando respuesta de IA, usando contingencia:", parseErr);
            return res.json({ reply: "No se pudo procesar el comando de voz correctamente. Intente de nuevo.", destCoords: null });
        }

        if (!aiResult.success || !aiResult.destinoProcesado) {
            return res.json({ reply: aiResult.reply, destCoords: null });
        }

        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(aiResult.destinoProcesado)}&key=${GOOGLE_MAPS_KEY}`;
        const geo = await axios.get(geoUrl);
        
        if (!geo.data.results || geo.data.results.length === 0) {
            return res.json({ reply: `No logré ubicar "${aiResult.destinoProcesado}" en la cartografía nacional.` });
        }

        const result = geo.data.results[0];
        const destCoords = result.geometry.location;

        let distanciaKm = 5.0; 
        try {
            const distanceUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${baseCoords.lat},${baseCoords.lng}&destinations=${destCoords.lat},${destCoords.lng}&key=${GOOGLE_MAPS_KEY}`;
            const distRes = await axios.get(distanceUrl);
            if (distRes.data.rows[0].elements[0].status === "OK") {
                distanciaKm = distRes.data.rows[0].elements[0].distance.value / 1000;
            }
        } catch (errDistance) {
            console.warn("Alerta: Usando telemetría analítica de distancia lineal.");
        }

        let precioBaseUsd = 2.00 + (distanciaKm * 0.75);
        if (precioBaseUsd < 3.00) precioBaseUsd = 3.00; 

        const fleetData = [
            { id: "eco", name: "Drivery Eco", usd: precioBaseUsd.toFixed(2), bs: (precioBaseUsd * tasa).toFixed(2), eta: "3 min" },
            { id: "confort", name: "Drivery Confort", usd: (precioBaseUsd * 1.30).toFixed(2), bs: (precioBaseUsd * 1.30 * tasa).toFixed(2), eta: "5 min" },
            { id: "premium", name: "Drivery Black", usd: (precioBaseUsd * 2.00).toFixed(2), bs: (precioBaseUsd * 2.00 * tasa).toFixed(2), eta: "7 min" }
        ];

        return res.json({ 
            destCoords, 
            reply: aiResult.reply, 
            destinoNombre: aiResult.destinoProcesado.replace(", Venezuela", ""),
            display: { fleet: fleetData } 
        });

    } catch(e) { 
        console.error("Fallo crítico en el procesador analítico:", e);
        res.status(500).json({ reply: "Error interno en los servidores de Drivery OS." }); 
    }
});

// --- ENDPOINT PROXY: EXTRACTOR DE TARIFAS REALES ---
app.post('/api/trip/quote-real', async (req, res) => {
    const { token, origin, dest } = req.body;

    if (!token || !origin || !dest) {
        return res.status(400).json({ success: false, message: "Faltan parámetros tácticos de ruta." });
    }

    try {
        const tasa = await obtenerTasaBCV();

        const respuestaCotizacion = await axios.post(`${YUMMY_API_BASE}/trips/quote`, {
            pickup_lat: origin.lat,
            pickup_lng: origin.lng,
            dropoff_lat: dest.lat,
            dropoff_lng: dest.lng
        }, {
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            timeout: 6000
        });

        const serviciosExternos = respuestaCotizacion.data.services || [];
        
        const fleetMapped = serviciosExternos.map(serv => {
            const precioUsd = parseFloat(serv.price_usd || serv.price || 0);
            return {
                id: serv.id || "eco",
                name: serv.name === "Rides" ? "Drivery Eco" : `Drivery ${serv.name}`,
                usd: precioUsd.toFixed(2),
                bs: (precioUsd * tasa).toFixed(2),
                eta: serv.eta || "4 min"
            };
        });

        if (fleetMapped.length === 0) throw new Error("Estructura externa modificada o vacía.");

        return res.json({ success: true, fleet: fleetMapped });

    } catch (error) {
        console.error("Fallo en la cotización proxy externa:", error.message);
        return res.status(400).json({ success: false, message: "No se pudieron recuperar las tarifas reales." });
    }
});

// --- ENDPOINT: SOLICITAR VIAJE ---
app.post('/api/trip/request', async (req, res) => {
    const { telefonoUsuario, destinoNombre, lat, lng, precioUsd, precioBs, tipoFlota } = req.body;

    if (!telefonoUsuario || !destinoNombre || !lat || !lng) {
        return res.status(400).json({ success: false, message: "Faltan parámetros de rastreo." });
    }

    try {
        const nuevoViaje = await Viaje.create({
            telefonoUsuario: telefonoUsuario,
            comandoOriginal: `Solicitud en vivo hacia ${destinoNombre}`,
            status: "BUSCANDO",
            destinoNombre: destinoNombre,
            coordenadasDestino: { lat, lng },
            coordenadasUsuario: { lat: 10.4806, lng: -66.9036 }, 
            tipoFlota: tipoFlota || "eco",
            precioEstimadoUsd: precioUsd || 4.00,
            precioEstimadoBs: precioBs || 180.00,
            tasaBcvAplicada: bcvCache.valor,
            yummyTripId: "DRV_" + Date.now().toString().slice(-6) 
        });

        res.json({ 
            success: true, 
            message: "BUSCANDO CONDUCTOR EN LA ZONA EN VIVO", 
            yummyTripId: nuevoViaje.yummyTripId 
        });

    } catch (error) {
        console.error("Error guardando viaje en MongoDB:", error.message);
        res.status(500).json({ success: false, message: "Error en el clúster de asignación" });
    }
});

// --- ENDPOINT: POLLING DE ESTATUS ---
app.get('/api/trip/status', async (req, res) => {
    const { yummyTripId } = req.query;
    if (!yummyTripId) return res.status(400).json({ error: "Se requiere ID de viaje" });

    try {
        const viaje = await Viaje.findOne({ yummyTripId: yummyTripId });
        if (!viaje) return res.status(404).json({ error: "El viaje no existe" });

        return res.json({
            status: viaje.status,
            destino: viaje.destinoNombre,
            yummyTripId: viaje.yummyTripId,
            conductor: viaje.datosConductor 
        });
    } catch (error) {
        res.status(500).json({ error: "Fallo de telemetría." });
    }
});

// --- ENDPOINT: CONSULTAR SALDO ---
app.get('/api/wallet/balance', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Teléfono requerido" });

    try {
        const usuario = await Usuario.findOne({ telefono: phone });
        if (!usuario) return res.status(404).json({ error: "Usuario no registrado" });
        return res.json({ balanceUsd: usuario.balanceUsd, balanceBs: usuario.balanceBs });
    } catch (e) {
        return res.status(500).json({ error: "Fallo leyendo base de datos" });
    }
});

// --- ENDPOINT: REGISTRO DE PAGO MÓVIL MANUAL (BYPASS: 7777) ---
app.post('/api/wallet/verify-recharge', async (req, res) => {
    const { phone, ref, amount, bancoOrigen } = req.body;

    if (!phone || !ref || !amount) {
        return res.status(400).json({ success: false, message: "DATOS INCOMPLETOS" });
    }

    try {
        const usuario = await Usuario.findOne({ telefono: phone });
        if (!usuario) return res.status(404).json({ success: false, message: "USUARIO NO REGISTRADO" });

        if (ref === "7777") {
            const tasaActual = await obtenerTasaBCV();
            const montoEquivalenteUsd = parseFloat((amount / tasaActual).toFixed(2));

            usuario.balanceBs += amount;
            usuario.balanceUsd += montoEquivalenteUsd;
            await usuario.save();

            await Transaccion.create({
                telefonoUsuario: usuario.telefono,
                montoBs: amount,
                montoUsd: montoEquivalenteUsd,
                referencia: "MASTER_BYPASS_" + Date.now().toString().slice(-4),
                bancoOrigen: "ADMIN_COMMAND_CENTER",
                status: 'APROBADO'
            });

            return res.json({
                success: true,
                bypass: true,
                montoUsd: montoEquivalenteUsd,
                nuevoSaldoUsd: usuario.balanceUsd,
                message: "MASTER BYPASS COMPLETE. SALDO INYECTADO."
            });
        }

        const transaccionExiste = await Transaccion.findOne({ referencia: ref });
        if (transaccionExiste) {
            return res.status(400).json({ success: false, message: "ESTA REFERENCIA YA FUE REGISTRADA PREVIAMENTE" });
        }

        const tasaActual = await obtenerTasaBCV();
        const montoEquivalenteUsd = parseFloat((amount / tasaActual).toFixed(2));

        await Transaccion.create({
            telefonoUsuario: usuario.telefono,
            montoBs: amount,
            montoUsd: montoEquivalenteUsd,
            referencia: ref,
            bancoOrigen: bancoOrigen || "PAGO MÓVIL MANUAL",
            status: 'PROCESANDO' 
        });

        return res.json({ success: true, bypass: false, message: "PAGO REGISTRADO EN REVISIÓN." });

    } catch (error) {
        return res.status(500).json({ success: false, message: "ERROR EN BILLETERA" });
    }
});

// ==========================================================================
// 5. ENDPOINTS DE ADMINISTRACIÓN (MESA DE CONTROL MANUAL)
// ==========================================================================
app.post('/api/admin/approve-recharge', async (req, res) => {
    const { referencia, passwordAdmin } = req.body;
    if (passwordAdmin !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: "ACCESO DENEGADO" });
    }

    try {
        const transaccion = await Transaccion.findOne({ referencia: referencia, status: 'PROCESANDO' });
        if (!transaccion) return res.status(404).json({ success: false, message: "Transacción no encontrada" });

        const usuario = await Usuario.findOne({ telefono: transaccion.telefonoUsuario });
        usuario.balanceBs += transaccion.montoBs;
        usuario.balanceUsd += transaccion.montoUsd;
        await usuario.save();

        transaccion.status = 'APROBADO';
        await transaccion.save();

        return res.json({ success: true, nuevoSaldoUsd: usuario.balanceUsd });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/accept-trip', async (req, res) => {
    const { yummyTripId, nombreChofer, vehiculo, placa, fotoUrl } = req.body;

    try {
        const viaje = await Viaje.findOne({ yummyTripId: yummyTripId, status: "BUSCANDO" });
        if (!viaje) return res.status(404).json({ success: false, message: "Viaje no disponible" });

        viaje.status = "ASIGNADO";
        viaje.datosConductor = {
            nombre: nombreChofer || "Juniel Querecuto",
            modelo: vehiculo || "Toyota 4Runner Limited Hybrid",
            placa: placa || "DRV-2026",
            foto: fotoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
        };

        await viaje.save();
        return res.json({ success: true, message: "VIAJE ASIGNADO CORRECTAMENTE CORRIENDO EN BETA" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================================================
// 6. INICIALIZACIÓN DEL MOTOR DE ENTRADA
// ==========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 ¡WAOSS! Drivery OS Engine operativo en el puerto ${PORT}`));
