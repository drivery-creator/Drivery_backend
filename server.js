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

// --- FUNCIÓN TÁCTICA: OBTENER TASA BCV OFICIAL ---
async function obtenerTasaBCV() {
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        return parseFloat(res.data.promedio);
    } catch (e) {
        console.error("Fallo al consultar BCV, usando tasa de emergencia.");
        return 45.10; // Tasa de respaldo
    }
}

// --- FUNCIÓN DE LOGUEO CENTRALIZADA (PARA AUTO-RELOGIN) ---
async function loginFlota(id, password) {
    const response = await axios.post('https://admin.yummyrides.com/userslogin', {
        "email": id,
        "password": password,
        "device_type": "android",
        "login_by": "manual",
        "device_id": "DRV-MASTER",
        "app_version": "3.12.10",
        "country_phone_code": "+58"
    });
    return response.data;
}

// --- 1. REGISTRO E IDENTIDAD ---
app.post('/api/register-identity', async (req, res) => {
    const { id, password } = req.body;
    try {
        const data = await loginFlota(id, password);
        if (data.success) {
            const user = data.user_detail;
            res.json({ 
                success: true, 
                nombre: user.first_name || "Comandante",
                session: { bearer: `Bearer ${user.jwt}`, token: user.token, userId: user.user_id }
            });
        } else { res.status(401).json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 2. COMANDO LOGÍSTICO (CON PROTOCOLO DE AUTO-RENOVACIÓN) ---
app.post('/api/command', async (req, res) => {
    let { command, userCoords, session, credentials } = req.body;
    let newSessionGenerated = null;

    try {
        // A. Interpretación del destino (IA)
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Eres el núcleo de Drivery OS. Extrae el destino. JSON: {\"destino\": \"Lugar, Caracas\"}." },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        // B. Geocoding (Google)
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        if (!geo.data.results[0]) throw new Error("Destino no localizado");
        const destCoords = geo.data.results[0].geometry.location;

        // C. Función interna para cotizar (para poder reintentar)
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
                }
            });
        };

        let quoteResponse;
        try {
            quoteResponse = await solicitarQuote(session);
        } catch (err) {
            // SI LA SESIÓN EXPIRÓ (401) Y TENEMOS CREDENCIALES, AUTO-RELOGIN
            if (err.response && err.response.status === 401 && credentials) {
                console.log("Sesión caducada. Iniciando Auto-Relogin...");
                const reloginData = await loginFlota(credentials.id, credentials.pass);
                
                if (reloginData.success) {
                    const u = reloginData.user_detail;
                    newSessionGenerated = { bearer: `Bearer ${u.jwt}`, token: u.token, userId: u.user_id };
                    // Reintento con nueva sesión
                    quoteResponse = await solicitarQuote(newSessionGenerated);
                } else { throw new Error("Fallo de re-vinculación"); }
            } else { throw err; }
        }

        // D. Procesar respuesta final
        const servicio = quoteResponse.data.response.trip_services[0].subcategories[0].service_types[0];
        const precioUSD = servicio.estimated_fare;
        const tasa = await obtenerTasaBCV();
        const precioBS = (precioUSD * tasa).toFixed(2);

        res.json({
            coords: { lat: destCoords.lat, lng: destCoords.lng },
            reply: `Ruta confirmada a ${destinoNombre}. Tarifa: $${precioUSD.toFixed(2)} (${precioBS} Bs.).`,
            display: { usd: precioUSD.toFixed(2), bs: precioBS, tasa: tasa, tiempo: 5 },
            newSession: newSessionGenerated // El front guardará esta nueva sesión si existe
        });

    } catch (e) {
        console.error("Error en núcleo:", e.message);
        res.status(401).json({ reply: "El enlace a la flota ha expirado. Por favor, revincule su dispositivo." });
    }
});

app.get('/ping', (req, res) => res.send('Drivery OS Core Active'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DRIVERY CORE ONLINE - PORT ${PORT}`));
