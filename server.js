// server.js - DRIVERY OS INTELLIGENCE NODE
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CONFIGURACIÓN DE COMUNICACIÓN (CORS para permitir entrada desde su dominio)
const io = new Server(server, {
    cors: {
        origin: "*", // En producción, cambie "*" por "https://driveryapp.com"
        methods: ["GET", "POST"]
    }
});

// INICIALIZACIÓN DEL CEREBRO (Gemini 1.5 Flash)
// La llave se toma de las Variables de Entorno de Render por seguridad
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// LÓGICA DEL CANAL ENCRIPTADO
io.on('connection', (socket) => {
    console.log('📡 CANAL TÁCTICO ACTIVADO: SESIÓN_' + socket.id);

    // ESCUCHAR COMANDOS DEL DIRECTOR O USUARIO
    socket.on('COMMAND_MASTER', async (data) => {
        try {
            console.log('🧠 PROCESANDO PETICIÓN LOGÍSTICA...');

            // CONFIGURACIÓN DEL PERSONA (Instrucciones para que la IA sea Drivery)
            const chat = model.startChat({
                history: [
                    {
                        role: "user",
                        parts: [{ text: "Actúa como el sistema operativo Drivery OS. Eres una inteligencia de transporte y logística en Venezuela. Tu tono es tecnológico, eficiente y cinematográfico. El Director es Jarnor. Siempre considera un margen de $0.50 por servicio para proteger el negocio." }],
                    },
                    {
                        role: "model",
                        parts: [{ text: "Sistemas en línea. Orbe operativo. Entendido, Director Jarnor. Estoy listo para interceptar y optimizar la logística." }],
                    },
                ],
            });

            const result = await chat.sendMessage(data.instruction);
            const response = await result.response;
            const text = response.text();

            // RESPUESTA AL ORBE EN TIEMPO REAL
            socket.emit('ORBE_RESPONSE', {
                status: 'SUCCESS',
                payload: text,
                timestamp: new Date().toLocaleTimeString()
            });

        } catch (error) {
            console.error("❌ FALLA EN LA SINAPSIS:", error);
            socket.emit('ORBE_RESPONSE', { 
                status: 'ERROR', 
                payload: "Error de intercepción. Reintentando enlace..." 
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('🔌 CANAL CERRADO');
    });
});

// EL MOTOR ARRANCA EN EL PUERTO ASIGNADO POR RENDER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 DRIVERY COMMAND CENTER OPERATIVO EN PUERTO ${PORT}`);
});