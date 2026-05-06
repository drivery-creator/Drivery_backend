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
    const { command, userCoords } = req.body;
    try {
        const [tasa, completion] = await Promise.all([
            obtenerTasaBCV(),
            groq.chat.completions.create({
                messages: [{ role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}. No prose." }, { role: "user", content: command }],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            })
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        
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
                    // Fórmula USA: Base $2.50 + $1.35/milla + $0.28/min + $3.00 Fee
                    basePrice = 2.50 + (distMillas * 1.35) + (tiempoMin * 0.28) + 3.00;
                } 
                else if (isMexico) {
                    // Fórmula México (MXN): Base 12.00 + 4.50/km + 1.80/min
                    const precioMXN = 12.00 + (distKm * 4.50) + (tiempoMin * 1.80);
                    basePrice = precioMXN / 18.50; // Conversión a USD
                } 
                else if (isColombia) {
                    // Fórmula Colombia (COP): Base 2500 + 800/km + 200/min
                    const precioCOP = 2500 + (distKm * 800) + (tiempoMin * 200);
                    basePrice = precioCOP / 4000; // Conversión a USD
                }
            } else {
                basePrice = 15.00; // Fallback internacional
            }
        } else {
            // Lógica original para Caracas (Precios aleatorios controlados)
            basePrice = Math.random() * (5.5 - 3.0) + 3.0;
        }

        const fleetData = [
            { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
            { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" },
            { id: "premium", name: "Drivery Black", usd: (basePrice * 2.1).toFixed(2), bs: (basePrice * 2.1 * tasa).toFixed(2), eta: "8 min" }
        ];

        res.json({ 
            destCoords, 
            reply: `Ruta a ${destinoNombre} sincronizada. Seleccione su unidad.`, 
            display: { fleet: fleetData } 
        });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ reply: "Error en el procesamiento de ruta." }); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE`));
