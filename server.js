const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Necesario para las APIs de Yummy
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- CONFIGURACIÓN DE IDENTIDAD INTERCEPTADA ---
const HEADERS_YUMMY = {
    'Authorization': process.env.YUMMY_TOKEN,
    'token': process.env.YUMMY_SESSION_TOKEN,
    'user_id': process.env.YUMMY_USER_ID,
    'app_version': '3.12.10',
    'device_type': 'android',
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': 'okhttp/4.12.0'
};

const caracasPoints = `[Tus puntos de referencia anteriores...]`;

const systemPrompt = `Eres Drivery Core AI. Tu misión es extraer el destino. 
Responde SIEMPRE en formato JSON: 
{
  "coords": {"lat": 10.XXXX, "lng": -66.XXXX},
  "destino": "Nombre del sitio"
}`;

// --- FUNCIÓN MOTOR: CONSULTA REAL A YUMMY ---
async function obtenerCotizacionReal(pLat, pLng, dLat, dLng) {
    try {
        const res = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            "pickupLatitude": pLat,
            "pickupLongitude": pLng,
            "destinationLatitude": dLat,
            "destinationLongitude": dLng
        }, { headers: HEADERS_YUMMY });

        // Extraemos el primer servicio disponible (usualmente Yummy Car)
        const servicio = res.data.response.trip_services[0].subcategories[0].service_types[0];
        return {
            precioBase: servicio.estimated_fare,
            tiempo: Math.round(res.data.response.source_to_destination_eta / 60)
        };
    } catch (e) {
        console.error("Error API Yummy:", e.message);
        return null;
    }
}

app.post('/api/command', async (req, res) => {
    try {
        const { command, userCoords } = req.body; // Recibimos el GPS del usuario
        
        // 1. Groq procesa el lenguaje natural
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt + caracasPoints },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { "type": "json_object" }
        });

        const aiRes = JSON.parse(chatCompletion.choices[0].message.content);

        // 2. Ejecutamos la cotización real con los datos interceptados
        // Usamos userCoords (GPS del Orbe) y aiRes (Destino de Groq)
        const cotizacion = await obtenerCotizacionReal(
            userCoords.lat, 
            userCoords.lng, 
            aiRes.coords.lat, 
            aiRes.coords.lng
        );

        if (cotizacion) {
            const precioFinal = (cotizacion.precioBase + 0.50).toFixed(2);
            const tasaBCV = 45.10; // Esto puedes automatizarlo después
            const precioBs = (precioFinal * tasaBCV).toFixed(2);

            // Respuesta enriquecida para el Orbe
            res.json({
                coords: aiRes.coords,
                reply: `Entendido. El viaje a ${aiRes.destino} sale en ${precioFinal} dólares. Estarían allá en unos ${cotizacion.tiempo} minutos.`,
                display: {
                    usd: precioFinal,
                    bs: precioBs,
                    tiempo: cotizacion.tiempo,
                    tasa: tasaBCV
                }
            });
        } else {
            res.json({ ...aiRes, reply: "Lo siento, no pude conectar con la flota en este momento." });
        }

    } catch (error) {
        res.status(500).json({ error: "Fallo en motor logístico" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS: Engine de Precisión con API Real activo.`);
});
