const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- 1. REGISTRO E IDENTIDAD (SOLO UNA VEZ) ---
app.post('/api/register-identity', async (req, res) => {
    const { id, password, deviceId } = req.body;
    try {
        const response = await axios.post('https://admin.yummyrides.com/userslogin', {
            "email": id,
            "password": password,
            "device_type": "android",
            "login_by": "manual",
            "device_id": deviceId,
            "app_version": "3.12.10",
            "country_phone_code": "+58"
        });

        if (response.data.success) {
            const data = response.data.user_detail;
            res.json({ 
                success: true, 
                session: { bearer: `Bearer ${data.jwt}`, token: data.token, userId: data.user_id }
            });
        } else {
            res.json({ success: false, message: "Acceso denegado por la red de flota." });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Error en el túnel de validación." });
    }
});

// --- 2. COMANDO LOGÍSTICO (USO DIARIO) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords, session } = req.body;

    try {
        // Groq extrae el destino de cualquier frase informal
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres el núcleo de Drivery OS en Caracas. Tu única función es extraer el destino. Si el usuario dice 'llévame al Sambil', responde estrictamente: Sambil, Caracas. No uses frases, solo el destino exacto." 
                },
                { role: "user", content: command }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const destData = JSON.parse(completion.choices[0].message.content);
        const destinoFinal = destData.destino || destData.destination || command;

        // Llamada a Yummy con las llaves del usuario (Puente Transparente)
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

        const servicio = quote.data.response.trip_services[0].subcategories[0].service_types[0];
        const precioTotal = (servicio.estimated_fare + 0.50).toFixed(2);

        res.json({
            coords: { lat: servicio.lat || 10.48, lng: servicio.lng || -66.90 },
            reply: `Destino: ${destinoFinal}. Tarifa: $${precioTotal}.`,
            display: { usd: precioTotal, bs: (precioTotal * 45.10).toFixed(2), tiempo: 5 }
        });

    } catch (e) {
        res.status(401).json({ reply: "Sesión de flota expirada. Re-autentique." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Drivery OS Core Online"));
