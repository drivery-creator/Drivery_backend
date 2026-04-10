const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- ESTADO DE SESIÓN EN MEMORIA ---
let SESSION = {
    bearer: "",
    sessionToken: "",
    userId: "69d85560192790ce9dbdf8c8"
};

// --- FUNCIÓN DE AUTO-LOGIN (DETECTA TOKEN EN CUALQUIER NIVEL) ---
async function refrescarSesion() {
    console.log("🔄 Drivery OS: Ejecutando protocolo de Auto-Login...");
    try {
        const res = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": process.env.USER_EMAIL,
            "password": process.env.USER_PASSWORD,
            "device_type": "android",
            "login_by": "manual",
            "device_id": "8700e0e37b212e08",
            "app_version": "3.12.10",
            "country_phone_code": "+58"
        });

        const data = res.data;
        // Buscamos el token donde sea que Yummy lo haya puesto según el log
        const nuevoToken = data.token || (data.user_detail ? data.user_detail.token : null);

        if (data.success && nuevoToken) {
            SESSION.bearer = `Bearer ${nuevoToken}`;
            SESSION.sessionToken = nuevoToken;
            SESSION.userId = data.user_id || (data.user_detail ? data.user_detail.user_id : SESSION.userId);

            console.log("✅ SESIÓN RESTAURADA. Token capturado correctamente.");
            return true;
        } else {
            console.log("❌ No se encontró el token en la respuesta de Yummy.");
            return false;
        }
    } catch (e) {
        console.error("❌ Error de red en Login:", e.message);
        return false;
    }
}

// --- MANEJADOR DE PETICIONES CON AUTO-RETRY ---
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
            console.log("⚠️ Token expirado. Refrescando...");
            const exito = await refrescarSesion();
            if (exito) return (await axios.post(url, data, getHeaders())).data;
        }
        throw err;
    }
}

// --- ENDPOINT COMMAND CENTER ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords } = req.body;
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Eres Drivery Core. Devuelve JSON: { \"lat\": numero, \"lng\": numero, \"destino\": \"nombre\" }." },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const dest = JSON.parse(completion.choices[0].message.content);

        const quote = await callYummy('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: userCoords.lat,
            pickupLongitude: userCoords.lng,
            destinationLatitude: dest.lat,
            destinationLongitude: dest.lng
        });

        const servicio = quote.response.trip_services[0].subcategories[0].service_types[0];
        const precioUSD = (servicio.estimated_fare + 0.50).toFixed(2);
        const tasa = parseFloat(process.env.TASA_BCV) || 45.10;

        res.json({
            coords: { lat: dest.lat, lng: dest.lng },
            reply: `Copiado Jarnor. El traslado a ${dest.destino} tiene un valor de $${precioUSD}.`,
            display: { usd: precioUSD, bs: (precioUSD * tasa).toFixed(2), tiempo: 5 }
        });
    } catch (error) {
        console.error("Core Error:", error.message);
        res.status(500).json({ reply: "Falla de enlace con la flota." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY OS: Sistema autónomo en línea.`));
