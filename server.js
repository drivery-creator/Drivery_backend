const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/orbe', async (req, res) => {
    const { query } = req.body;
    // Lógica para Sambil Chacao
    if (query.toLowerCase().includes("sambil")) {
        return res.json({
            destination: "Sambil Chacao, Caracas",
            planes: [
                { nombre: "Drivery Eco", precio: "4.50", tiempo: "5 min" },
                { nombre: "Drivery Plus", precio: "7.20", tiempo: "3 min" }
            ],
            accessibility_steps: { target_app: "com.ubercab", action: "quote", destination: "Sambil" }
        });
    }
    res.json({ message: "Oído. Procesando comando..." });
});

app.listen(process.env.PORT || 3000);
