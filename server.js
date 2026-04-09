const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización de Groq con tu nueva llave
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const systemPrompt = `Eres Drivery Core AI, el cerebro logístico de Caracas. 
Responde siempre con un objeto JSON válido que contenga "coords" (lat y lng de Caracas) y "reply" (tu mensaje).
Ejemplo: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Entendido, enviando unidad a Chacao."}`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: command }
            ],
            model: "llama3-8b-8192", // El modelo más rápido disponible
            response_format: { "type": "json_object" }
        });

        const content = chatCompletion.choices[0].message.content;
        res.json(JSON.parse(content));

    } catch (error) {
        console.error("Error en Groq:", error.message);
        res.status(500).json({ error: "Fallo en motor Llama 3", details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS: Motor Groq activo en puerto ${PORT}`);
});
