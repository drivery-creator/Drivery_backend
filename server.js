const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { ejecutarDespacho } = require('./automator.js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// BASE DE DATOS DE COORDENADAS - DRIVERY OS CARACAS
const caracasPoints = `
PUNTOS DE REFERENCIA EXACTOS:
- Sambil La Candelaria: {"lat": 10.5065, "lng": -66.9035}
- Sambil Chacao: {"lat": 10.4900, "lng": -66.8550}
- CCCT: {"lat": 10.4845, "lng": -66.8480}
- Las Mercedes: {"lat": 10.4850, "lng": -66.8650}
- Tolón Fashion Mall: {"lat": 10.4815, "lng": -66.8665}
- Petare (Redoma): {"lat": 10.4780, "lng": -66.8050}
- Plaza Altamira: {"lat": 10.4961, "lng": -66.8485}
- El Paraíso: {"lat": 10.4860, "lng": -66.9200}
- Montalbán: {"lat": 10.4750, "lng": -66.9400}
- La Castellana: {"lat": 10.4990, "lng": -66.8520}
- Los Palos Grandes: {"lat": 10.4975, "lng": -66.8430}
- Chacaíto: {"lat": 10.4905, "lng": -66.8745}
- Sabana Grande: {"lat": 10.4920, "lng": -66.8830}
- Plaza Venezuela: {"lat": 10.4965, "lng": -66.8850}
- El Hatillo: {"lat": 10.4350, "lng": -66.8250}
- Universidad Central (UCV): {"lat": 10.4910, "lng": -66.8910}
- Capitolio / Centro: {"lat": 10.5060, "lng": -66.9145}
- San Bernardino: {"lat": 10.5130, "lng": -66.8980}
- La Trinidad: {"lat": 10.4480, "lng": -66.8480}
- Bello Monte: {"lat": 10.4880, "lng": -66.8780}
- Santa Fe: {"lat": 10.4630, "lng": -66.8480}
- Caurimare: {"lat": 10.4730, "lng": -66.8280}
- Los Dos Caminos: {"lat": 10.4915, "lng": -66.8320}
- Palo Verde: {"lat": 10.4795, "lng": -66.7950}
- Caricuao: {"lat": 10.4320, "lng": -66.9650}
- La Guaira (Aeropuerto): {"lat": 10.6031, "lng": -66.9906}
`;

const systemPrompt = `Eres Drivery Core AI, el cerebro logístico de la Super App Drivery. 
Tu tono es tecnológico, eficiente y muy caraqueño. 

TAREAS:
1. Identifica el lugar mencionado por el usuario.
2. Usa la siguiente base de datos para las coordenadas: ${caracasPoints}
3. Si el lugar no está en la lista, estima la latitud (cerca de 10.4) y longitud (cerca de -66.8).
4. Responde SIEMPRE en formato JSON estricto.

FORMATO DE RESPUESTA:
{
  "coords": {"lat": 10.XXXX, "lng": -66.XXXX},
  "reply": "Texto breve que será leído por voz"
}

Ejemplo: {"coords": {"lat": 10.4961, "lng": -66.8485}, "reply": "Copiado. Centrando radar en Plaza Altamira."}`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { "type": "json_object" },
            temperature: 0.2 // Baja temperatura para mayor precisión numérica
        });

        const content = chatCompletion.choices[0].message.content;
        res.json(JSON.parse(content));

    } catch (error) {
        console.error("Error en Groq Core:", error.message);
        res.status(500).json({ error: "Fallo en motor logístico", details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS: Engine de Precisión activo en puerto ${PORT}`);
});
