const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// 1. CONFIGURACIÓN DE INTELIGENCIA ARTIFICIAL (GEMINI)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Base de datos táctica para que la IA no cometa errores de geolocalización
const caracasNodes = {
    "las mercedes": { lat: 10.4847, lng: -66.8611, zoom: 16 },
    "altamira": { lat: 10.4961, lng: -66.8481, zoom: 17 },
    "chacao": { lat: 10.4914, lng: -66.8536, zoom: 17 },
    "el paraiso": { lat: 10.4795, lng: -66.9361, zoom: 15 },
    "los palos grandes": { lat: 10.4965, lng: -66.8415, zoom: 16 },
    "la castellana": { lat: 10.5005, lng: -66.8505, zoom: 16 },
    "petare": { lat: 10.4772, lng: -66.8092, zoom: 15 }
};

app.post("/api/command", async (req, res) => {
    try {
        const { command } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const systemPrompt = `Eres Drivery Core AI. Gestionas logística en Caracas.
        Responde SIEMPRE en JSON puro. 
        Si el usuario pide ver una zona, usa estas coordenadas: ${JSON.stringify(caracasNodes)}.
        
        Estructura JSON:
        {
          "reply": "Mensaje corto confirmando la acción",
          "action": "move_map",
          "coords": {"lat": 10.x, "lng": -66.x},
          "zoom": 16
        }`;

        const result = await model.generateContent([systemPrompt, command]);
        const responseText = result.response.text().replace(/```json|```/g, "");
        res.json(JSON.parse(responseText));
    } catch (error) {
        console.error("Error en Core IA:", error);
        res.status(500).json({ reply: "Error de conexión con el núcleo." });
    }
});

// 2. LÓGICA DE MÉTRICAS DE FLOTA (WEBSOCKETS)
let metrics = {
    blueFleet: 28450,
    greenFleet: 19720,
    totalUnits: 48170
};

wss.on('connection', (ws) => {
    console.log('Terminal Drivery OS conectada.');
    
    // Enviamos métricas iniciales
    ws.send(JSON.stringify({ metrics }));

    // Simulador de flujo de flota constante (Tecnología de Punta)
    const interval = setInterval(() => {
        metrics.blueFleet += Math.floor(Math.random() * 5) - 2;
        metrics.greenFleet += Math.floor(Math.random() * 5) - 2;
        metrics.totalUnits = metrics.blueFleet + metrics.greenFleet;
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ metrics }));
        }
    }, 3000);

    ws.on('close', () => clearInterval(interval));
});

// 3. ENCENDIDO DEL SISTEMA
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`-----------------------------------------`);
    console.log(`DRIVERY OS CORE - STATUS: ONLINE`);
    console.log(`PUERTO: ${PORT} | CARACAS, VENEZUELA`);
    console.log(`-----------------------------------------`);
});
