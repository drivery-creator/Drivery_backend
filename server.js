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
        // Interpretación del destino con Groq
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres el núcleo de Drivery OS en Caracas. Extrae el destino. Responde estrictamente JSON: {\"destino\": \"Lugar, Caracas\"}." 
                },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const interpretation = JSON.parse(completion.choices[0].message.content);
        const destinoFinal = interpretation.destino || command;

        // LOG DE DEPURACIÓN EN RENDER
        console.log(`Solicitud: ${destinoFinal} | Lat: ${userCoords.lat} Lng: ${userCoords.lng}`);

        // Solicitud de cotización con corrección de tipos (Evita el Error 400)
        const quote = await axios.post('https://api.yummyrides.com/api/v2/quotation', {
            pickupLatitude: parseFloat(userCoords.lat),
            pickupLongitude: parseFloat(userCoords.lng),
            destinationName: String(destinoFinal)
        }, {
            headers: {
                'Authorization': String(session.bearer),
                'token': String(session.token),
                'user_id': String(session.userId),
                'app_version': '3.12.10',
                'device_type': 'android'
            }
        });

        // Verificación de datos de respuesta
        if (!quote.data.response || !quote.data.response.trip_services) {
            throw new Error("Respuesta de flota vacía.");
        }

        const subcategory = quote.data.response.trip_services[0].subcategories[0];
        const servicio = subcategory.service_types[0];
        
        const precioUSD = (servicio.estimated_fare).toFixed(2);
        const precioBS = (precioUSD * 45.10).toFixed(2); 

        res.json({
            coords: { lat: servicio.lat, lng: servicio.lng },
            reply: `Ruta confirmada a ${destinoFinal}. El valor de flota es de ${precioUSD} dólares.`,
            display: { usd: precioUSD, bs: precioBS, tiempo: 5 }
        });

    } catch (e) {
        // Captura específica del error 400 o expiración
        if (e.response) {
            console.error("Error desde Yummy:", e.response.status, e.response.data);
            if (e.response.status === 400 || e.response.status === 401) {
                return res.status(401).json({ reply: "El enlace a la flota expiró. Por favor, re-vincule su dispositivo en la bóveda." });
            }
        }
        
        console.error("Fallo general:", e.message);
        res.status(500).json({ reply: "Núcleo en mantenimiento. Reintente en un momento." });
    }
});

// --- 3. MANTENIMIENTO (PING) ---
app.get('/ping', (req, res) => res.send('Drivery OS Core Active'));

const PORT = process.env.PORT || 10000; // Render usa el 10000 por defecto
app.listen(PORT, () => {
    console.log(`
    -------------------------------------------
    DRIVERY OS: NÚCLEO OPERATIVO ACTIVADO
    PUERTO: ${PORT}
    ESTADO: LISTO PARA COMANDOS DE VOZ
    -------------------------------------------
    `);
});
