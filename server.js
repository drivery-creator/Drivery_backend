const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// Llave de Google para convertir nombres a coordenadas
const GOOGLE_MAPS_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";

// --- 1. REGISTRO E IDENTIDAD ---
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

// --- 2. COMANDO LOGÍSTICO (PROCESAMIENTO CON GEOCODING) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;

    try {
        // A. EXTRAER NOMBRE DEL DESTINO CON IA
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Eres el núcleo de Drivery OS. Extrae el destino. JSON: {\"destino\": \"Lugar, Caracas\"}." },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;

        // B. GEOCODIFICACIÓN: Convertir nombre a Lat/Lng (Solución al Error 400)
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`;
        const geoResponse = await axios.get(geoUrl);
        
        if (!geoResponse.data.results[0]) throw new Error("Ubicación no encontrada");
        
        const coordsDestino = geoResponse.data.results[0].geometry.location;

        console.log(`Logística: De [${userCoords.lat}] a ${destinoNombre} [${coordsDestino.lat}, ${coordsDestino.lng}]`);

        // C. COTIZACIÓN CON FORMATO NUEVO (Sin destinationName, solo Coordenadas)
        const quote = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat),
            pickupLongitude: parseFloat(userCoords.lng),
            destinationLatitude: parseFloat(coordsDestino.lat),
            destinationLongitude: parseFloat(coordsDestino.lng)
        }, {
            headers: {
                'Authorization': String(session.bearer),
                'token': String(session.token),
                'user_id': String(session.userId),
                'app_version': '3.12.10',
                'device_type': 'android'
            }
        });

        const sub = quote.data.response.trip_services[0].subcategories[0];
        const servicio = sub.service_types[0];
        const precio = (servicio.estimated_fare).toFixed(2);

        res.json({
            coords: { lat: coordsDestino.lat, lng: coordsDestino.lng },
            reply: `Ruta a ${destinoNombre} confirmada. Tarifa: $${precio}.`,
            display: { usd: precio, bs: (precio * 45.10).toFixed(2), tiempo: 5 }
        });

    } catch (e) {
        console.error("Fallo Logístico:", e.response ? e.response.data : e.message);
        res.status(401).json({ reply: "Destino inválido o sesión de flota expirada." });
    }
});

app.get('/ping', (req, res) => res.send('Drivery Active'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`
    -------------------------------------------
    DRIVERY OS: NÚCLEO OPERATIVO ACTIVADO
    PUERTO: ${PORT}
    ESTADO: LISTO (PROTOCOLO GEO-COORD)
    -------------------------------------------
    `);
});
