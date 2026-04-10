const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Memoria dinámica de sesión
let SESSION = {
    bearer: process.env.YUMMY_TOKEN || "",
    sessionToken: process.env.YUMMY_SESSION_TOKEN || "",
    userId: "69d85560192790ce9dbdf8c8"
};

// --- PROTOCOLO DE INMORTALIDAD (AUTO-LOGIN) ---
async function autoLogin() {
    console.log("🔄 Renovando sesión en infraestructura Yummy...");
    try {
        const res = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": "4241291671",
            "password": "Drivery26$",
            "device_type": "android",
            "device_token": "cXQm3AtaQDCbXIALsz_lr_:APA91bGGLq93QT5RrH8QdNJg-xxBNDMsw-xCpD_2rvNs0IwLsPtWRkv5Sx3XdxB-x4mIlC9r4Lqt0byUFBBwKsLxZpYjm3VutsalVKTpOh6dAywnzi3pLOw",
            "login_by": "manual",
            "device_id": "8700e0e37b212e08",
            "app_version": "3.12.10",
            "country_phone_code": "+58"
        });

        if (res.data.success) {
            SESSION.bearer = `Bearer ${res.data.response.token}`;
            SESSION.sessionToken = res.data.response.token;
            console.log("✅ Sesión resucitada con éxito.");
            return true;
        }
    } catch (e) {
        console.error("❌ Fallo crítico de autenticación:", e.message);
        return false;
    }
}

// --- ORQUESTADOR DE PETICIONES ---
async function callYummy(url, data) {
    const getHeaders = () => ({
        headers: {
            'Authorization': SESSION.bearer,
            'token': SESSION.sessionToken,
            'user_id': SESSION.userId,
            'app_version': '3.12.10',
            'device_type': 'android',
            'Content-Type': 'application/json'
        }
    });

    try {
        const res = await axios.post(url, data, getHeaders());
        return res.data;
    } catch (err) {
        if (err.response && err.response.status === 401) {
            const reintentar = await autoLogin();
            if (reintentar) return (await axios.post(url, data, getHeaders())).data;
        }
        throw err;
    }
}

// --- ENDPOINT COMMAND CENTER ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords } = req.body;
    try {
        // 1. IA procesa el lenguaje natural
        const chat = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Eres el núcleo de Drivery OS. Recibes un destino en Caracas y respondes SOLO un JSON con: {lat, lng, destino}." },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const dest = JSON.parse(chat.choices[0].message.content);

        // 2. Cotización en tiempo real
        const quote = await callYummy('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: userCoords.lat,
            pickupLongitude: userCoords.lng,
            destinationLatitude: dest.lat,
            destinationLongitude: dest.lng
        });

        const servicio = quote.response.trip_services[0].subcategories[0].service_types[0];
        const precioConMargen = (servicio.estimated_fare + 0.50).toFixed(2);
        const tasa = 45.10;

        res.json({
            coords: { lat: dest.lat, lng: dest.lng },
            reply: `Entendido Jarnor. Destino: ${dest.destino}. El costo logístico es de $${precioConMargen}.`,
            display: { 
                usd: precioConMargen, 
                bs: (precioConMargen * tasa).toFixed(2), 
                tiempo: 5 
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ reply: "Error de enlace con la flota." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Drivery OS Core: Online en puerto ${PORT}`));
