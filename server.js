const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de Google AI (Gemini 3.1 Flash)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const systemPrompt = `Eres Drivery Core AI, el cerebro de una Super App de servicios en Caracas, Venezuela. 
Tu especialidad es la logística y tecnología de punta. 
Si el usuario menciona un lugar de Caracas, responde con las coordenadas aproximadas en formato JSON: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Tu mensaje"}.
Mantén un tono profesional, tecnológico y eficiente.`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        // Usamos el modelo estable gemini-1.5-flash (compatible con Gemini 3.1)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            apiVersion: "v1" 
        });

        const prompt = `${systemPrompt}\n\nUsuario: ${command}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Intentar parsear JSON si la IA envió coordenadas
        try {
            const jsonResponse = JSON.parse(text);
            res.json(jsonResponse);
        } catch (e) {
            res.json({ reply: text });
        }
    } catch (error) {
        console.error("Error en el Core:", error);
        res.status(500).json({ error: "Error interno del servidor", details: error.message });
    }
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS Backend operativo en puerto ${PORT}`);
});
