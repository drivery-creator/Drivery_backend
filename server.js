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

// FUNCIÓN PARA OBTENER TASA BCV REAL
async function obtenerTasaBCV() {
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        return parseFloat(res.data.promedio);
    } catch (e) {
        return 45.10; // Tasa de respaldo
    }
}

app.post('/api/register-identity', async (req, res) => {
    const { id, password, deviceId } = req.body;
    try {
        const response = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": id, "password": password, "device_type": "android",
            "login_by": "manual", "device_id": deviceId || "DRV-CORE-MASTER",
            "app_version": "3.12.10", "country_phone_code": "+58"
        });
        if (response.data.success) {
            const data = response.data.user_detail;
            res.json({ 
                success: true, nombre: data.first_name || "Comandante",
                session: { bearer: `Bearer ${data.jwt}`, token: data.token, userId: data.user_id }
            });
        } else { res.status(401).json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Eres el núcleo de Drivery OS. Extrae el destino. JSON: {\"destino\": \"Lugar, Caracas\"}." },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        const destCoords = geo.data.results[0].geometry.location;

        const quote = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat),
            pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(destCoords.lat),
            destinationLongitude: parseFloat(destCoords.lng)
        }, {
            headers: {
                'Authorization': String(session.bearer),
                'token': String(session.token),
                'user_id': String(session.userId),
                'app_version': '3.12.10', 'device_type': 'android'
            }
        });

        const sub = quote.data.response.trip_services[0].subcategories[0];
        const servicio = sub.service_types[0];
        const precioUSD = servicio.estimated_fare;
        const tasa = await obtenerTasaBCV();
        const precioBS = (precioUSD * tasa).toFixed(2);

        res.json({
            coords: { lat: destCoords.lat, lng: destCoords.lng },
            reply: `Ruta confirmada a ${destinoNombre}. Tarifa: $${precioUSD.toFixed(2)} (${precioBS} Bs. a tasa BCV).`,
            display: { usd: precioUSD.toFixed(2), bs: precioBS, tasa: tasa, tiempo: 5 }
        });
    } catch (e) { res.status(401).json({ reply: "Error de enlace logístico." }); }
});

app.listen(process.env.PORT || 10000);
