const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/orbe', async (req, res) => {
    const { query } = req.body;
    
    // Aquí Groq analiza la intención. Simulación para Sambil Chacao:
    if (query.toLowerCase().includes("sambil")) {
        return res.json({
            destination: "Sambil Chacao, Caracas",
            planes: [
                { nombre: "Eco-Drivery", precio: "4.50", tiempo: "5 min" },
                { nombre: "Drivery SUV", precio: "8.00", tiempo: "7 min" }
            ],
            accessibility_steps: {
                target_app: "com.ubercab",
                action: "calculate_fare",
                destination: "Sambil Chacao"
            }
        });
    }
    
    res.json({ message: "Comando recibido, procesando..." });
});

app.listen(process.env.PORT || 3000);
