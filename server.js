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
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 1500 });
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        return bcvCache.valor;
    } catch (e) { return bcvCache.valor; }
}

app.post('/api/command', async (req, res) => {
    let { command, userCoords, session } = req.body;

    try {
        const [completion, tasaBCV] = await Promise.all([
            groq.chat.completions.create({
                messages: [{ role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Caracas\"}." }, { role: "user", content: command }],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            }),
            obtenerTasaBCV()
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`;
        const geo = await axios.get(geoUrl);
        const destCoords = geo.data.results[0].geometry.location;

        const quoteResponse = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat), pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(destCoords.lat), destinationLongitude: parseFloat(destCoords.lng)
        }, {
            headers: { 'Authorization': session.bearer, 'token': session.token, 'user_id': session.userId, 'app_version': '3.12.10', 'device_type': 'android' },
            timeout: 5000
        });

        const services = quoteResponse.data.response.trip_services[0].subcategories[0].service_types;
        const fleetData = services.map(s => ({
            name: s.name,
            usd: s.estimated_fare.toFixed(2),
            bs: (s.estimated_fare * tasaBCV).toFixed(2),
            arrival: s.eta || "5 min"
        }));

        // GENERACIÓN DE URL DE ESPEJO (Google Maps Embed Táctico)
        const mirrorUrl = `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_KEY}&origin=${userCoords.lat},${userCoords.lng}&destination=${destCoords.lat},${destCoords.lng}&mode=driving&zoom=14`;

        res.json({
            reply: `Ruta a ${destinoNombre} sincronizada. Planes interceptados.`,
            mirrorUrl: mirrorUrl,
            display: { fleet: fleetData }
        });

    } catch (e) {
        res.status(401).json({ reply: "Sincronización necesaria." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DRIVERY MIRROR CORE ACTIVE`));
