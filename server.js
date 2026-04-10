const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURACIÓN DE INTELIGENCIA ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- 1. REGISTRO E IDENTIDAD (CON RECONOCIMIENTO DE NOMBRE) ---
app.post('/api/register-identity', async (req, res) => {
    const { id, password, deviceId } = req.body;
    
    try {
        const response = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": id,
            "password": password,
            "device_type": "android",
            "login_by": "manual",
            "device_id": deviceId || "DRV-CORE-MASTER",
            "app_version": "3.12.10",
            "country_phone_code": "+58"
        });

        if (response.data.success) {
            const data = response.data.user_detail;
            // Extraemos el nombre real para el saludo del Orbe
            const nombreReal = data.first_name || "Comandante";
            
            res.json({ 
                success: true, 
                nombre: nombreReal,
                session: { 
                    bearer: `Bearer ${data.jwt}`, 
                    token: data.token, 
                    userId: data.user_id 
                }
            });
        } else {
            res.status(401).json({ success: false, message: "Credenciales de flota inválidas." });
        }
    } catch (e) {
        console.error("Error en Auth:", e.message);
        res.status(500).json({ success: false, message: "Error de enlace con la red central." });
    }
});

// --- 2. COMANDO LOGÍSTICO (PROCESAMIENTO DE VOZ Y COTIZACIÓN) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;

    try {
        // El Orbe interpreta la intención del mensaje usando Groq
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres el núcleo de Drivery OS en Caracas. Tu función es extraer el destino. Responde estrictamente en JSON: {\"destino\": \"Lugar, Caracas\"}. No importa qué tan informal hable el usuario, tú extraes el lugar exacto." 
                },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const interpretation = JSON.parse(completion.choices[0].message.content);
        const destinoFinal = interpretation.destino || command;

        // Solicitud de cotización real a la infraestructura de Yummy
        const quote = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: userCoords.lat,
            pickupLongitude: userCoords.lng,
            destinationName: destinoFinal
        }, {
            headers: {
                'Authorization': session.bearer,
                'token': session.token,
                'user_id': session.userId,
                'app_version': '3.12.10',
                'device_type': 'android'
            }
        });

        // Extraemos la mejor opción de la flota (normalmente la primera subcategoría)
        const servicio = quote.data.response.trip_services[0].subcategories[0].service_types[0];
        
        // Ajuste de tarifa estratégica (puedes añadir un margen si deseas)
        const precioUSD = (servicio.estimated_fare).toFixed(2);
        const precioBS = (precioUSD * 45.10).toFixed(2); // Tasa dinámica opcional

        res.json({
            coords: { lat: servicio.lat, lng: servicio.lng },
            reply: `Ruta confirmada a ${destinoFinal}. El valor de flota es de ${precioUSD} dólares.`,
            display: { 
                usd: precioUSD, 
                bs: precioBS, 
                tiempo: 5 // Tiempo estimado promedio de llegada
            }
        });

    } catch (e) {
        console.error("Error Logístico:", e.message);
        res.status(401).json({ reply: "Sesión de flota expirada. Por favor, re-vincule su dispositivo." });
    }
});

// --- 3. MANTENIMIENTO DE CONEXIÓN (KEEP-ALIVE) ---
// Esta ruta sirve para que Render no duerma el servidor
app.get('/ping', (req, res) => res.send('Drivery OS Core Active'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    -------------------------------------------
    DRIVERY OS: NÚCLEO OPERATIVO ACTIVADO
    PUERTO: ${PORT}
    ESTADO: LISTO PARA COMANDOS DE VOZ
    -------------------------------------------
    `);
});
