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

// ==========================================
// ENDPOINT 1: PROCESAMIENTO INICIAL DE VOZ
// ==========================================
app.post('/api/command', async (req, res) => {
    const textInput = req.body.query || req.body.command;
    if (!textInput) {
        return res.status(400).json({ response: "No se recibió ninguna instrucción de voz válida." });
    }

    try {
        const [tasa, completion] = await Promise.all([
            obtenerTasaBCV(),
            groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Extract destination JSON: {\"destino\": \"Lugar, Ciudad\"}. No prose. If user specifies a well-known place in Caracas (like Sambil, Quinta Crespo, La Candelaria, Colonia Tovar), append ', Caracas, Venezuela' to the destination field." }, 
                    { role: "user", content: textInput }
                ],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            })
        ]);

        const destinoNombre = JSON.parse(completion.choices[0].message.content).destino;
        const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinoNombre)}&key=${GOOGLE_MAPS_KEY}`);
        
        if (!geo.data.results || geo.data.results.length === 0) {
            return res.status(404).json({ response: `No logré ubicar el destino: ${destinoNombre}.` });
        }

        const destCoords = geo.data.results[0].geometry.location;

        // Fallback de precios simulados (por si falla la accesibilidad)
        const basePrice = Math.random() * (5.5 - 3.0) + 3.0;
        const fleetData = [
            { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
            { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" }
        ];

        res.json({ 
            destCoords, 
            destinoPurificado: destinoNombre,
            response: `Sincronizando ruta a ${destinoNombre}. Iniciando orquestación en segundo plano.`, 
            display: { fleet: fleetData } 
        });

    } catch (e) { 
        console.error("Error:", e.message);
        res.status(500).json({ response: "Error en el procesamiento interno de la ruta." }); 
    }
});

// ==========================================
// ENDPOINT 2: EL CEREBRO DEL AGENTE (MANOS IA)
// Mapea y decide acciones semánticas en Ridery o Yummy
// ==========================================
app.post('/api/agent/action', async (req, res) => {
    const { appActual, screenNodes, destino } = req.body;

    if (!screenNodes || !destino) {
        return res.status(400).json({ action: "NONE", reason: "Faltan datos de la pantalla o destino." });
    }

    try {
        const promptSistema = `Eres el módulo de manos mecánicas de Drivery OS. Tu trabajo es analizar los elementos de texto e IDs de la interfaz de la aplicación de movilidad "${appActual}" (puede ser Ridery o Yummy) y decidir el siguiente clic o escritura para cotizar un viaje hacia "${destino}".

        Debes retornar ÚNICAMENTE un objeto JSON con esta estructura exacta:
        {
           "action": "CLICK" | "WRITE" | "EXTRACT_PRICE" | "FINISH",
           "target_id": "ID del elemento XML o recurso de Android sobre el que se actúa",
           "text_to_write": "El texto a escribir si la acción es WRITE, de lo contrario vacío",
           "reason": "Breve explicación técnica de por qué tomaste esta decisión"
        }

        Reglas de Decisión:
        1. Si ves un campo de entrada de texto para buscar direcciones (ej: "¿A dónde vamos?", "Introduce destino", "search", "destination"), tu acción es "WRITE", pones su ID en "target_id" y colocas el valor de "${destino}" en "text_to_write".
        2. Si el usuario ya escribió pero hay que confirmar la dirección tocando el primer resultado de la lista de sugerencias o un botón de 'Confirmar', tu acción es "CLICK".
        3. Si la app ya está en la pantalla de selección de vehículos y muestra los precios en pantalla (tarifas con $, Bs, Eco, Moto, etc), tu acción es "EXTRACT_PRICE".
        4. Si no reconoces nada útil o ya terminaste el flujo, la acción es "FINISH".`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: promptSistema },
                { role: "user", content: `Estructura de la pantalla actual de la aplicación:\n${JSON.stringify(screenNodes)}` }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const decisionIA = JSON.parse(completion.choices[0].message.content);
        res.json(decisionIA);

    } catch (e) {
        console.error("Error en Agente Autónomo:", e.message);
        res.status(500).json({ action: "NONE", reason: "Error procesando los nodos de la interfaz." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`DRIVERY CORE ONLINE`));
