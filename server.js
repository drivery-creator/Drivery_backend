const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// INICIALIZACIÓN: Captura la llave de las variables de entorno de Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemPrompt = `Eres Drivery Core AI. Gestionas logística en Caracas.
Si el usuario menciona un lugar, responde siempre con este formato JSON: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Tu mensaje"}.`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        // MODELO: Usamos gemini-1.5-flash forzando la API estable (v1)
        const model = genAI.getGenerativeModel(
            { model: "gemini-1.5-flash" },
            { apiVersion: 'v1' }
        );

        const prompt = `${systemPrompt}\n\nUsuario: ${command}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Limpieza de respuesta y envío al Orbe
        try {
            const cleanText = text.replace(/```json|```/g, '').trim();
            const jsonResponse = JSON.parse(cleanText);
            res.json(jsonResponse);
        } catch (e) {
            res.json({ reply: text });
        }
    } catch (error) {
        console.error("Error Core IA:", error.message);
        res.status(500).json({ error: "Error en el servidor", details: error.message });
    }
});

// PUERTO: Render asigna uno automáticamente, usamos 10000 como respaldo local
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS: Terminal activa en puerto ${PORT}`);
});
