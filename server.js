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
    userId: "69d85560192790ce9dbdf8c8" // Tu ID fijo
};

// --- FUNCIÓN DE AUTO-LOGIN (INMORTALIDAD) ---
async function refrescarSesion() {
    console.log("🔄 Drivery OS: Detectada sesión expirada. Iniciando Auto-Login...");
    try {
        const res = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": process.env.USER_EMAIL,
            "password": process.env.USER_PASSWORD,
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
            console.log("✅ Sesión restaurada con éxito.");
            return true;
        }
        return false;
    } catch (e) {
        console.error("❌ Error crítico en Auto-Login:", e.message);
        return false;
    }
}

// --- MANEJADOR DE PETICIONES A YUMMY CON AUTO-REINTENTO ---
async function callYummy(url, data) {
    const getHeaders = () => ({
        headers: {
            'Authorization': SESSION.bearer,
            'token': SESSION.sessionToken,
            'user_id': SESSION.userId,
            'app_version': '3.12.10',
            'device_type': 'android',
            'Content-Type': 'application/json',
            'language': 'es'
        }
    });

    try {
        const res = await axios.post(url, data, getHeaders());
        return res.data;
    } catch (err) {
        // Si el error es 401 (No autorizado), refrescamos token y reintentamos UNA VEZ
        if (err.response && err.response.status === 401) {
            const loginExitoso = await refrescarSesion();
            if (loginExitoso) {
                const retryRes = await axios.post(url, data, getHeaders());
                return retryRes.data;
            }
        }
        throw err;
    }
}

// --- ENDPOINT PRINCIPAL: COMANDO DE VOZ ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords } = req.body;

    try {
        // 1. Groq procesa el lenguaje natural para extraer coordenadas de Caracas
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres el núcleo de Drivery OS. Recibes un destino en Caracas y respondes estrictamente un JSON con las coordenadas aproximadas: { \"lat\": numero, \"lng\": numero, \"destino\": \"nombre\" }." 
                },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const dest = JSON.parse(completion.choices[0].message.content);

        // 2. Consultar precio real a Yummy (Con auto-login integrado)
        const quote = await callYummy('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: userCoords.lat,
            pickupLongitude: userCoords.lng,
            destinationLatitude: dest.lat,
            destinationLongitude: dest.lng
        });

        // 3. Procesar datos del servicio
        const servicio = quote.response.trip_services[0].subcategories[0].service_types[0];
        const margen = 0.50; // Tu ganancia fija
        const precioUSD = (servicio.estimated_fare + margen).toFixed(2);
        const tasa = parseFloat(process.env.TASA_BCV) || 45.10;

        // 4. Respuesta final al Orbe
        res.json({
            coords: { lat: dest.lat, lng: dest.lng },
            reply: `Copiado Jarnor. El traslado a ${dest.destino} tiene un valor de $${precioUSD}.`,
            display: {
                usd: precioUSD,
                bs: (precioUSD * tasa).toFixed(2),
                tiempo: 5 // Tiempo estimado de llegada
            }
        });

    } catch (error) {
        console.error("Error en el Core:", error.message);
        res.status(500).json({ reply: "Lo siento, el enlace con la flota falló temporalmente." });
    }
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    -------------------------------------------
    DRIVERY OS: Engine Autónomo Activo
    Puerto: ${PORT}
    Estado: Inmortalidad de Token Activada
    -------------------------------------------
    `);
});
