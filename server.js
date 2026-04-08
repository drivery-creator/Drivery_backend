const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización del motor de IA
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const systemPrompt = `Eres Drivery Core AI. Gestionas logística en Caracas.
Si el usuario menciona un lugar, responde con JSON: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Tu mensaje"}.`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        // CORRECCIÓN CRÍTICA: Forzamos apiVersion 'v1' para evitar el error 404 de la ruta v1beta
        const model = genAI.getGenerativeModel(
            { model: "gemini-1.5-flash" },
            { apiVersion: 'v1' }
        );

        const prompt = `${systemPrompt}\n\nUsuario: ${command}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        try {
            // Intentamos limpiar la respuesta por si la IA añade bloques de código Markdown
            const cleanText = text.replace(/```json|```/g, '').trim();
            const jsonResponse = JSON.parse(cleanText);
            res.json(jsonResponse);
        } catch (e) {
            res.json({ reply: text });
        }
    } catch (error) {
        console.error("Error en Core IA:", error);
        res.status(500).json({ error: "Error en el servidor", details: error.message });
    }
});

// BINDING DE PUERTO: Fundamental para Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Terminal Drivery OS conectada en puerto ${PORT}`);
});
