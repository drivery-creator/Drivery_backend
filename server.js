const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- MEMORIA DINÁMICA DE TOKENS ---
let AUTH_STATE = {
    bearer: process.env.YUMMY_TOKEN || "",
    session: process.env.YUMMY_SESSION_TOKEN || "",
    user_id: "69d85560192790ce9dbdf8c8"
};

// --- FUNCIÓN DE INMORTALIDAD (AUTO-LOGIN) ---
async function refrescarSesion() {
    console.log("🔄 Iniciando Auto-Login en Yummy...");
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
            AUTH_STATE.bearer = `Bearer ${res.data.response.token}`;
            AUTH_STATE.session = res.data.response.token; // En Yummy v3 suelen coincidir
            console.log("✅ Sesión Renovada. Nuevo Token generado.");
            return true;
        }
    } catch (e) {
        console.error("❌ Fallo crítico en Auto-Login:", e.message);
        return false;
    }
}

// --- WRAPPER INTELIGENTE PARA PETICIONES ---
async function yummyRequest(url, data) {
    const config = () => ({
        headers: {
            'Authorization': AUTH_STATE.bearer,
            'token': AUTH_STATE.session,
            'user_id': AUTH_STATE.user_id,
            'app_version': '3.12.10',
            'device_type': 'android',
            'Content-Type': 'application/json'
        }
    });

    try {
        const res = await axios.post(url, data, config());
        return res.data;
    } catch (err) {
        if (err.response && err.response.status === 401) {
            const exito = await refrescarSesion();
            if (exito) return (await axios.post(url, data, config())).data;
        }
        throw err;
    }
}

// --- ENDPOINT PRINCIPAL (GROQ + YUMMY) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords } = req.body;
    try {
        // 1. Groq procesa destino (Usando tu prompt de CaracasPoints)
        const chat = await groq.chat.completions.create({
            messages: [{ role: "system", content: "Eres Drivery Core. Devuelve JSON: {lat, lng, destino}" }, { role: "user", content: command }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const dest = JSON.parse(chat.choices[0].message.content);

        // 2. Cotización Real con Auto-Retry
        const quote = await yummyRequest('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: userCoords.lat,
            pickupLongitude: userCoords.lng,
            destinationLatitude: dest.lat,
            destinationLongitude: dest.lng
        });

        const servicio = quote.response.trip_services[0].subcategories[0].service_types[0];
        const precioFinal = (servicio.estimated_fare + 0.50).toFixed(2);

        res.json({
            coords: { lat: dest.lat, lng: dest.lng },
            reply: `Copiado Jarnor. Viaje a ${dest.destino} en $${precioFinal}.`,
            display: { usd: precioFinal, bs: (precioFinal * 45.10).toFixed(2), tiempo: 5 }
        });
    } catch (e) {
        res.status(500).json({ error: "Error en el núcleo Drivery OS" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Drivery OS: Engine Autónomo Activo`));
