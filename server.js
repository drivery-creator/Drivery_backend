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

app.post('/api/command', async (req, res) => {
    // CORRECCIÓN 1: Extrae tanto 'query' (Flutter) como 'command' por seguridad
    const textInput = req.body.query || req.body.command;
    const { userCoords } = req.body;

    if (!textInput) {
        return res.status(400).json({ 
            response: "No se recibió ninguna instrucción de voz válida.",
            error: "Missing query or command parameters" 
        });
    }

    try {
        const [tasa, completion] = await Promise.all([
            obtenerTasaBCV(),
            groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}. No prose. If user specifies a well-known place in Caracas (like Sambil, Quinta Crespo, La Candelaria), append ', Caracas, Venezuela' to the destination field." }, 
                    { role: "user", content: textInput }
                ],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            })
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;
        
        // Geocodificación con Google Maps
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        
        if (!geo.data.results || geo.data.results.length === 0) {
            return res.status(404).json({ response: `No logré ubicar el destino: ${destinoNombre}. Intente de nuevo.` });
        }

        const result = geo.data.results[0];
        const destCoords = result.geometry.location;

        // --- LÓGICA DE COTIZACIÓN INTERNACIONAL INYECTADA ---
        let basePrice;
        const addressComponents = result.address_components;
        const isUSA = addressComponents.some(c => c.short_name === "US");
        const isMexico = addressComponents.some(c => c.short_name === "MX");
        const isColombia = addressComponents.some(c => c.short_name === "CO");

        if ((isUSA || isMexico || isColombia) && userCoords) {
            const distRes = await axios.get(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userCoords.lat},${userCoords.lng}&destinations=${destCoords.lat},${destCoords.lng}&key=${GOOGLE_MAPS_KEY}`);
            const elemento = distRes.data.rows[0].elements[0];
            
            if (elemento.status === "OK") {
                const distMetros = elemento.distance.value;
                const tiempoSegundos = elemento.duration.value;
                const distKm = distMetros / 1000;
                const tiempoMin = tiempoSegundos / 60;

                if (isUSA) {
                    const distMillas = distKm * 0.621371;
                    basePrice = 2.50 + (distMillas * 1.35) + (tiempoMin * 0.28) + 3.00;
                } 
                else if (isMexico) {
                    const precioMXN = 12.00 + (distKm * 4.50) + (tiempoMin * 1.80);
                    basePrice = precioMXN / 18.50; 
                } 
                else if (isColombia) {
                    const precioCOP = 2500 + (distKm * 800) + (tiempoMin * 200);
                    basePrice = precioCOP / 4000; 
                }
            } else {
                basePrice = 15.00; // Fallback internacional
            }
        } else {
            // Lógica original para Caracas (Precios base en USD)
            basePrice = Math.random() * (5.5 - 3.0) + 3.0;
        }

        const fleetData = [
            { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
            { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" },
            { id: "premium", name: "Drivery Black", usd: (basePrice * 2.1).toFixed(2), bs: (basePrice * 2.1 * tasa).toFixed(2), eta: "8 min" }
        ];

        // CORRECCIÓN 2: Se envía 'response' en vez de 'reply' para hacer match perfecto con Flutter
        res.json({ 
            destCoords, 
            response: `Ruta a ${destinoNombre} sincronizada. Seleccione su unidad en la pantalla.`, 
            display: { fleet: fleetData } 
        });

    } catch (e) { 
        console.error("Error en Drivery Core:", e.message);
        res.status(500).json({ response: "Error en el procesamiento interno de la ruta." }); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE`));
