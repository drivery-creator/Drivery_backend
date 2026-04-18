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
        const destCoords = geo.data.results[0].geometry.location;

        const basePrice = Math.random() * (4.5 - 2.5) + 2.5;
        const fleetData = [
            { id: "eco", name: "Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2) },
            { id: "confort", name: "Confort", usd: (basePrice * 1.4).toFixed(2), bs: (basePrice * 1.4 * tasa).toFixed(2) },
            { id: "black", name: "Black", usd: (basePrice * 2.2).toFixed(2), bs: (basePrice * 2.2 * tasa).toFixed(2) }
        ];

        res.json({ 
            destCoords, 
            reply: `Ruta a ${destinoNombre} lista. Tasa: ${tasa.toFixed(2)} Bs.`, 
            display: { fleet: fleetData } 
        });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ reply: "Fallo de conexión con el núcleo." }); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE - CLEAN MODE`));
