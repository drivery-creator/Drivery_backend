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

// ENDPOINT DE REGISTRO: Captura y reenvía la identidad del dispositivo
app.post('/api/register-identity', async (req, res) => {
    const { id, password, userAgent } = req.body;
    try {
        const response = await axios.post('https://api.yummyrides.com/api/v2/login', {
            "user_id": id, 
            "password": password, 
            "device_type": "android", 
            "app_version": "3.12.10"
        }, { 
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': userAgent || 'okhttp/4.9.1',
                'Accept': 'application/json'
            } 
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
        console.error("Error en el Log de Render:", e.response?.data || e.message);
        res.status(401).json({ 
            success: false, 
            message: e.response?.data?.message || "Error de acceso" 
        });
    }
});

app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;
    try {
        const [tasa, completion] = await Promise.all([
            obtenerTasaBCV(),
            groq.chat.completions.create({
                messages: [{ role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}." }, { role: "user", content: command }],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            })
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        const destCoords = geo.data.results[0].geometry.location;

        const quoteResponse = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat), pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(destCoords.lat), destinationLongitude: parseFloat(destCoords.lng)
        }, {
            headers: { 
                'Authorization': session.bearer, 
                'token': session.token, 
                'user_id': session.userId, 
                'app_version': '3.12.10', 
                'device_type': 'android' 
            }
        });

        const services = quoteResponse.data.response.trip_services[0].subcategories[0].service_types;
        const fleetData = services.map(s => ({
            id: s.id, name: s.name, usd: s.estimated_fare.toFixed(2),
            bs: (s.estimated_fare * tasa).toFixed(2), arrival: s.eta || "4 min"
        }));

        res.json({ destCoords, reply: `Ruta a ${destinoNombre} sincronizada. Tasa B C V: ${tasa.toFixed(2)}.`, display: { fleet: fleetData } });
    } catch (e) { res.status(500).json({ reply: "Fallo en la red táctica." }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE`));
