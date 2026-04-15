const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GOOGLE_MAPS_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";

// --- CACHÉ DE TASA BCV ---
let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor;
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 1500 });
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        return bcvCache.valor;
    } catch (e) { return bcvCache.valor; }
}

// --- LOGIN DE FLOTA ---
async function loginFlota(id, password) {
    try {
        const response = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": id, "password": password, "device_type": "android",
            "login_by": "manual", "device_id": "DRV-MASTER", "app_version": "3.12.10", "country_phone_code": "+58"
        }, { timeout: 3000 });
        return response.data;
    } catch (e) { return { success: false }; }
}

// --- NÚCLEO DE COMANDOS DRIVERY ---
app.post('/api/command', async (req, res) => {
    let { command, userCoords, session, credentials } = req.body;
    let newSessionGenerated = null;

    try {
        // 1. Procesamiento de IA y Tasa
        const [completion, tasaBCV] = await Promise.all([
            groq.chat.completions.create({
                messages: [{ role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Caracas\"}." }, { role: "user", content: command }],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            }),
            obtenerTasaBCV()
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        // 2. Geocoding Táctico
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&bounds=10.40,-67.05|10.55,-66.75&key=${GOOGLE_MAPS_KEY}`;
        const geo = await axios.get(geoUrl);
        if (!geo.data.results[0]) throw new Error("DEST_NOT_FOUND");
        const destCoords = geo.data.results[0].geometry.location;

        const solicitarQuote = async (s) => {
            return await axios.post('https://api.yummyrides.com/api/v2/quotation', {
                pickupLatitude: parseFloat(userCoords.lat),
                pickupLongitude: parseFloat(userCoords.lng),
                destinationLatitude: parseFloat(destCoords.lat),
                destinationLongitude: parseFloat(destCoords.lng)
            }, {
                headers: {
                    'Authorization': String(s.bearer),
                    'token': String(s.token),
                    'user_id': String(s.userId),
                    'app_version': '3.12.10', 'device_type': 'android'
                },
                timeout: 5000
            });
        };

        let quoteResponse;
        try {
            quoteResponse = await solicitarQuote(session);
        } catch (err) {
            if (credentials) {
                const relogin = await loginFlota(credentials.id, credentials.pass);
                if (relogin.success) {
                    const u = relogin.user_detail;
                    newSessionGenerated = { bearer: `Bearer ${u.jwt}`, token: u.token, userId: u.user_id };
                    quoteResponse = await solicitarQuote(newSessionGenerated);
                } else { throw new Error("AUTH_FAIL"); }
            } else { throw err; }
        }

        // --- INTERCEPCIÓN EXACTA DE TODOS LOS PLANES DE FLOTA ---
        const services = quoteResponse.data.response.trip_services[0].subcategories[0].service_types;
        const fleetData = services.map(s => ({
            name: s.name,
            usd: s.estimated_fare.toFixed(2),
            bs: (s.estimated_fare * tasaBCV).toFixed(2),
            arrival: s.eta || "5 min"
        }));

        // Respuesta enriquecida para el Frontend
        res.json({
            coords: destCoords,      // Destino para el mapa
            origin: userCoords,      // Origen para la ruta
            reply: `Análisis táctico para ${destinoNombre} completado. Planes de flota interceptados.`,
            display: { 
                fleet: fleetData,    // Array con todos los carros y precios
                tasa: tasaBCV 
            },
            newSession: newSessionGenerated
        });

    } catch (e) {
        console.error("Error Core:", e.message);
        res.status(401).json({ reply: "Sincronización de red necesaria." });
    }
});

// Registro e Identidad
app.post('/api/register-identity', async (req, res) => {
    const { id, password } = req.body;
    const data = await loginFlota(id, password);
    if (data.success) {
        const u = data.user_detail;
        res.json({ 
            success: true, nombre: u.first_name,
            session: { bearer: `Bearer ${u.jwt}`, token: u.token, userId: u.user_id }
        });
    } else { res.status(401).json({ success: false }); }
});

app.get('/ping', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DRIVERY TURBO-CORE ACTIVE`));
