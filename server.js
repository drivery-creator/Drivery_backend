const express = require('express');
const cors = require('cors');
const { createClient } = require('@google/genai'); // Cambio aquí para el nuevo SDK
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración con el nuevo SDK unificado
const client = createClient({
  apiKey: process.env.GOOGLE_API_KEY,
});

const systemPrompt = `Eres Drivery Core AI. Gestionas logística en Caracas.
Si el usuario menciona un lugar, responde con JSON: {"coords": {"lat": 10.48, "lng": -66.89}, "reply": "Tu mensaje"}.`;

app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        // El nuevo SDK usa una sintaxis más directa
        const response = await client.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUsuario: ${command}` }] }]
        });

        const text = response.candidates[0].content.parts[0].text;

        try {
            const cleanText = text.replace(/```json|```/g, '').trim();
            const jsonResponse = JSON.parse(cleanText);
            res.json(jsonResponse);
        } catch (e) {
            res.json({ reply: text });
        }
    } catch (error) {
        console.error("Error con el nuevo SDK:", error.message);
        res.status(500).json({ error: "Error en Core IA", message: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drivery OS conectado con el nuevo SDK en puerto ${PORT}`);
});
