const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Usamos GEMINI_API_KEY para seguir la guía que compartiste
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemPrompt = `Eres Drivery Core AI. Gestionas logística en Caracas.
Responde siempre en formato JSON: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Tu mensaje"}.`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        // ACTUALIZACIÓN: Usamos 'gemini-1.5-flash-latest' para evitar depreciación
        // Y forzamos apiVersion: 'v1' para salir del entorno v1beta que causa el 404
        const model = genAI.getGenerativeModel(
            { model: "gemini-1.5-flash-latest" },
            { apiVersion: 'v1' }
        );

        const prompt = `${systemPrompt}\n\nUsuario: ${command}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        try {
            const cleanText = text.replace(/```json|```/g, '').trim();
            const jsonResponse = JSON.parse(cleanText);
            res.json(jsonResponse);
        } catch (e) {
            res.json({ reply: text });
        }
    } catch (error) {
        console.error("Error detectado en Core:", error.message);
        res.status(500).json({ error: "Error de conexión con IA", details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS: Engine operativo con gemini-1.5-flash-latest`);
});
