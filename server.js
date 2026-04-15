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

// Endpoint para procesar el comando de voz e interceptar flota
app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;

    try {
        // 1. IA extrae destino
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Caracas\"}." }, { role: "user", content: command }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        // 2. Geocoding
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        const destCoords = geo.data.results[0].geometry.location;

        // 3. Intercepción de Yummy (Quotation)
        const quoteResponse = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat), pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(destCoords.lat), destinationLongitude: parseFloat(destCoords.lng)
        }, {
            headers: { 'Authorization': session.bearer, 'token': session.token, 'user_id': session.userId, 'app_version': '3.12.10', 'device_type': 'android' }
        });

        const services = quoteResponse.data.response.trip_services[0].subcategories[0].service_types;
        const fleetData = services.map(s => ({
            id: s.id, name: s.name, usd: s.estimated_fare.toFixed(2), arrival: s.eta || "4 min"
        }));

        res.json({
            destCoords, 
            reply: `Ruta a ${destinoNombre} sincronizada. Seleccione unidad.`,
            display: { fleet: fleetData }
        });
    } catch (e) { res.status(500).json({ reply: "Error de red táctica." }); }
});

// Endpoint para ejecutar el pedido real (Booking)
app.post('/api/book', async (req, res) => {
    const { serviceId, pickup, destination, paymentMode, session } = req.body;
    try {
        const response = await axios.post('https://api.yummyrides.com/api/v2/request_trip', {
            "service_type_id": serviceId,
            "pickup_latitude": pickup.lat, "pickup_longitude": pickup.lng,
            "destination_latitude": destination.lat, "destination_longitude": destination.lng,
            "payment_mode": paymentMode === 'wallet' ? 'cash' : paymentMode,
            "is_scheduled": 0
        }, {
            headers: { 'Authorization': session.bearer, 'token': session.token, 'user_id': session.userId, 'app_version': '3.12.10', 'device_type': 'android' }
        });
        res.json({ success: true, reply: "Unidad confirmada. Siga el radar." });
    } catch (e) { res.status(500).json({ success: false, reply: "Error en el despliegue." }); }
});

app.listen(10000, () => console.log("DRIVERY CORE OPERATIVO"));
