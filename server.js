const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN DE NÚCLEO
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GOOGLE_MAPS_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";

// --- GESTIÓN DE TASA BCV EN TIEMPO REAL ---
let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    // Cache de 30 minutos para evitar saturación de API
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor; 
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        return bcvCache.valor;
    } catch (e) { 
        console.error("Error obteniendo tasa BCV, usando fallback.");
        return bcvCache.valor; 
    }
}

// --- ENDPOINT 1: REGISTRO DE IDENTIDAD (AUTH VAULT) ---
app.post('/api/register-identity', async (req, res) => {
    const { id, password } = req.body;
    try {
        const response = await axios.post('https://api.yummyrides.com/api/v2/login', {
            "user_id": id,
            "password": password,
            "device_type": "android",
            "app_version": "3.12.10"
        });

        const userData = response.data.response;
        res.json({
            success: true,
            nombre: userData.first_name,
            session: {
                bearer: response.headers['authorization'],
                token: userData.token,
                userId: userData.id
            }
        });
    } catch (e) {
        res.status(401).json({ success: false, message: "Credenciales MaaS inválidas." });
    }
});

// --- ENDPOINT 2: COMANDO DE VOZ Y COTIZACIÓN (QUOTATION) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;

    try {
        // 1. IA extrae destino y Tasa BCV en paralelo
        const [tasa, completion] = await Promise.all([
            obtenerTasaBCV(),
            groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}. Be concise." },
                    { role: "user", content: command }
                ],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            })
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        // 2. Geocoding (Convertir nombre a coordenadas)
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        if (!geo.data.results[0]) return res.status(404).json({ reply: "Destino no localizado en el radar." });
        
        const destCoords = geo.data.results[0].geometry.location;

        // 3. Intercepción de Quotation Real (Yummy)
        const quoteResponse = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat),
            pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(destCoords.lat),
            destinationLongitude: parseFloat(destCoords.lng)
        }, {
            headers: { 
                'Authorization': session.bearer, 
                'token': session.token, 
                'user_id': session.userId,
                'app_version': '3.12.10',
                'device_type': 'android'
            }
        });

        // 4. Mapeo de Flota con inyección de Tasa BCV
        const services = quoteResponse.data.response.trip_services[0].subcategories[0].service_types;
        const fleetData = services.map(s => ({
            id: s.id,
            name: s.name,
            usd: s.estimated_fare.toFixed(2),
            bs: (s.estimated_fare * tasa).toFixed(2),
            arrival: s.eta || "4 min"
        }));

        res.json({
            destCoords,
            reply: `Ruta a ${destinoNombre} calculada. Tasa BCV: ${tasa} Bs.`,
            display: { fleet: fleetData }
        });

    } catch (e) {
        console.error("Error en Command Center:", e.response?.data || e.message);
        res.status(500).json({ reply: "Fallo en la red de intercepción táctica." });
    }
});

// --- ENDPOINT 3: EJECUCIÓN DE PEDIDO (BOOKING REAL) ---
app.post('/api/book', async (req, res) => {
    const { serviceId, pickup, destination, paymentMode, session, price } = req.body;

    try {
        // Aquí podrías restar el balance de tu DB interna si el paymentMode es 'wallet'
        
        const response = await axios.post('https://api.yummyrides.com/api/v2/request_trip', {
            "service_type_id": serviceId,
            "pickup_latitude": parseFloat(pickup.lat),
            "pickup_longitude": parseFloat(pickup.lng),
            "destination_latitude": parseFloat(destination.lat),
            "destination_longitude": parseFloat(destination.lng),
            "payment_mode": paymentMode === 'wallet' ? 'cash' : paymentMode,
            "is_scheduled": 0
        }, {
            headers: {
                'Authorization': session.bearer,
                'token': session.token,
                'user_id': session.userId,
                'app_version': '3.12.10',
                'device_type': 'android'
            }
        });

        res.json({ 
            success: true, 
            reply: "Protocolo de reserva completado. Unidad en camino.",
            tripId: response.data.response.trip_id 
        });

    } catch (e) {
        console.error("Error en Booking:", e.response?.data || e.message);
        res.status(500).json({ success: false, reply: "Error al desplegar unidad de transporte." });
    }
});

// --- PING DE MANTENIMIENTO ---
app.get('/ping', (req, res) => res.send("DRIVERY CORE ONLINE"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    -------------------------------------------
    DRIVERY OS - CORE ACTIVATED
    PORT: ${PORT}
    STATUS: OPERATIONAL
    -------------------------------------------
    `);
});
