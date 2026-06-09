const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================================================
// 1. CONEXIÓN ROBUSTA A MONGO DB (DRIVERY OS CLUSTER)
// ==========================================================================
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ Error crítico: MONGO_URI no está definida en las variables de entorno.');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('🏁 [Drivery OS DB] Conexión de alta disponibilidad establecida con éxito.'))
    .catch(err => console.error('❌ [Drivery OS DB] Fallo en la conexión inicial:', err.message));

// Monitoreo activo del ciclo de vida de la conexión
mongoose.connection.on('disconnected', () => console.warn('⚠️ Alerta: Conexión con MongoDB perdida. Reintentando...'));

// ==========================================================================
// 2. MODELOS Y ESQUEMAS DE DATOS (PERSISTENCIA EN LA NUBE)
// ==========================================================================

// Esquema para el control, registro, Handshakes y balances de la API Inversa
const UsuarioSchema = new mongoose.Schema({
    telefono: { type: String, required: true, unique: true },
    pinCifrado: { type: String, required: true }, // Contraseña/PIN del ecosistema externo
    statusEnlace: { type: String, default: 'VINCULADO' },
    balanceUsd: { type: Number, default: 0.00 },   // Monedero Dinámico en USD
    balanceBs: { type: Number, default: 0.00 },    // Monedero Dinámico en Bolívares
    ultimaConexion: { type: Date, default: Date.now }
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

// Esquema para el historial contable de recargas manuales (Anti-Fraude)
const TransaccionSchema = new mongoose.Schema({
    telefonoUsuario: { type: String, required: true },
    montoBs: { type: Number, required: true },
    montoUsd: { type: Number, required: true },
    referencia: { type: String, required: true, unique: true }, // Blindaje único
    bancoOrigen: { type: String, default: 'PAGO MÓVIL MANUAL' },
    status: { type: String, enum: ['PROCESANDO', 'APROBADO', 'RECHAZADO'], default: 'PROCESANDO' },
    fecha: { type: Date, default: Date.now }
});
const Transaccion = mongoose.model('Transaccion', TransaccionSchema);

// Esquema para auditoría de comandos de voz, telemetría e inyección de rutas dinámicas
const ViajeSchema = new mongoose.Schema({
    telefonoUsuario: { type: String, required: true },
    comandoOriginal: String,
    status: { type: String, enum: ['BUSCANDO', 'ASIGNADO', 'FINALIZADO', 'CANCELADO'], default: 'BUSCANDO' },
    destinoNombre: String,
    coordenadasDestino: { lat: Number, lng: Number },
    coordenadasUsuario: { lat: Number, lng: Number },
    tipoFlota: String,
    precioEstimadoUsd: Number,
    precioEstimadoBs: Number,
    tasaBcvAplicada: Number,
    yummyTripId: { type: String, required: true, unique: true }, // ID de rastreo para polling
    datosConductor: { type: Object, default: null }, // Se inyecta dinámicamente al aceptar el viaje
    fecha: { type: Date, default: Date.now }
});
const Viaje = mongoose.model('Viaje', ViajeSchema);

// ==========================================================================
// 3. CONFIGURACIÓN DE APIS EXTERNAS Y VARIABLES GLOBALES
// ==========================================================================
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GOOGLE_MAPS_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";

const YUMMY_API_BASE = "https://api.yummy.rides/v1"; 
const YUMMY_HEADERS = {
    "Authorization": "Bearer 80d1cd24c64cc701c3609b8ea74d2d14", 
    "Content-Type": "application/json",
    "X-App-Version": "4.12.0",
    "X-Device-Id": "android_drivery_os_core",
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) DriveryOrchestrator/2.0"
};

let bcvCache = { valor: 45.10, ultimaVez: 0 };

async function obtenerTasaBCV() {
    const ahora = Date.now();
    if (ahora - bcvCache.ultimaVez < 1800000) return bcvCache.valor; 
    try {
        const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        bcvCache = { valor: parseFloat(res.data.promedio), ultimaVez: ahora };
        console.log(`💱 [BCV API] Tasa oficial actualizada en vivo: ${bcvCache.valor} Bs/USD`);
        return bcvCache.valor;
    } catch (e) { return bcvCache.valor; }
}

const yummyTools = [
    {
        type: "function",
        function: {
            name: "crearViajeYummy",
            description: "Dispara de forma autónoma una solicitud de viaje real en el backend externo a través de la API inversa raspada.",
            parameters: {
                type: "object",
                properties: {
                    destinoNombre: { type: "string", description: "Nombre purificado del lugar de destino." },
                    lat: { type: "number", description: "Latitud geográfica del destino." },
                    lng: { type: "number", description: "Longitud geográfica del destino." },
                    tipoFlota: { type: "string", enum: ["eco", "confort", "premium"], description: "Categoría del carro seleccionado." }
                },
                required: ["destinoNombre", "lat", "lng", "tipoFlota"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "consultarStatusYummy",
            description: "Interroga el endpoint secreto de Yummy para verificar si un conductor ya tomó el viaje y extraer sus datos (placa, nombre, etc).",
            parameters: { type: "object", properties: {} }
        }
    }
];

// ==========================================================================
// 4. ENDPOINTS DE LA API REST
// ==========================================================================

// --- ENDPOINT: ENLACE Y HANDSHAKE DINÁMICO DE CREDENCIALES (API INVERSA) ---
app.post('/api/auth/yummy', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ success: false, message: "CAMPOS INCOMPLETOS" });
    }

    try {
        console.log(`📡 [GATEWAY API INVERSA] Ejecutando Handshake para el terminal: ${phone}`);

        let usuario = await Usuario.findOne({ telefono: phone });

        if (usuario) {
            usuario.pinCifrado = password; 
            usuario.ultimaConexion = Date.now();
            await usuario.save();
            console.log(`💾 [MongoDB] Conexión actualizada para usuario recurrente: ${phone}`);
        } else {
            usuario = await Usuario.create({
                telefono: phone,
                pinCifrado: password,
                balanceUsd: 0.00,
                balanceBs: 0.00
            });
            console.log(`💾 [MongoDB] Nuevo usuario registrado con éxito a través del Gateway: ${phone}`);
        }

        return res.json({ 
            success: true, 
            message: "CONEXIÓN ESTABLECIDA CON LA API INVERSA",
            user: { 
                telefono: usuario.telefono, 
                status: usuario.statusEnlace,
                balanceUsd: usuario.balanceUsd,
                balanceBs: usuario.balanceBs
            }
        });

    } catch (error) {
        console.error('❌ [Auth Error] Fallo crítico en el Gateway de Autenticación:', error.message);
        return res.status(500).json({ success: false, message: "FALLA DE ENLACE EN LA RED INTERNA" });
    }
});

// --- ENDPOINT: CONSULTAR SALDO EN TIEMPO REAL DESDE EL HEADER ---
app.get('/api/wallet/balance', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Teléfono requerido" });

    try {
        const usuario = await Usuario.findOne({ telefono: phone });
        if (!usuario) return res.status(404).json({ error: "Usuario no registrado" });
        
        return res.json({ balanceUsd: usuario.balanceUsd, balanceBs: usuario.balanceBs });
    } catch (e) {
        return res.status(500).json({ error: "Fallo leyendo el balance en base de datos" });
    }
});

// --- ENDPOINT: REGISTRO DE PAGO MÓVIL MANUAL (MESA DE CONTROL + CHEAT CODE) ---
app.post('/api/wallet/verify-recharge', async (req, res) => {
    const { phone, ref, amount, bancoOrigen } = req.body;

    if (!phone || !ref || !amount) {
        return res.status(400).json({ success: false, message: "DATOS INCOMPLETOS" });
    }

    try {
        const usuario = await Usuario.findOne({ telefono: phone });
        if (!usuario) return res.status(404).json({ success: false, message: "USUARIO NO REGISTRADO" });

        // =========================================================================
        // LLAVE MAESTRA ADM: BYPASS INSTANTÁNEO SOLO PARA TI (CÓDIGO: 7777)
        // =========================================================================
        if (ref === "7777") {
            console.log(`🔑 [SISTEMA MAESTRO] Bypass administrativo. Recarga inmediata para: ${phone}`);
            
            const tasaActual = await obtenerTasaBCV();
            const montoEquivalenteUsd = parseFloat((amount / tasaActual).toFixed(2));

            usuario.balanceBs += amount;
            usuario.balanceUsd += montoEquivalenteUsd;
            await usuario.save();

            await Transaccion.create({
                telefonoUsuario: usuario.telefono,
                montoBs: amount,
                montoUsd: montoEquivalenteUsd,
                referencia: "MASTER_BYPASS_" + Date.now().toString().slice(-4),
                bancoOrigen: "ADMIN_COMMAND_CENTER",
                status: 'APROBADO'
            });

            return res.json({
                success: true,
                bypass: true,
                montoUsd: montoEquivalenteUsd,
                nuevoSaldoUsd: usuario.balanceUsd,
                message: "CÓDIGO MAESTRO COMPLETO. SALDO INYECTADO EN BASE DE DATOS."
            });
        }
        // =========================================================================

        // Filtro Anti-Duplicados para evitar reenvío de la misma referencia
        const transaccionExiste = await Transaccion.findOne({ referencia: ref });
        if (transaccionExiste) {
            return res.status(400).json({ success: false, message: "ESTA REFERENCIA YA FUE REGISTRADA PREVIAMENTE" });
        }

        const tasaActual = await obtenerTasaBCV();
        const montoEquivalenteUsd = parseFloat((amount / tasaActual).toFixed(2));

        // Registro de Transacción en estado PENDIENTE de revisión manual
        await Transaccion.create({
            telefonoUsuario: usuario.telefono,
            montoBs: amount,
            montoUsd: montoEquivalenteUsd,
            referencia: ref,
            bancoOrigen: bancoOrigen || "PAGO MÓVIL MANUAL",
            status: 'PROCESANDO' 
        });

        console.log(`📩 [MESA DE CONTROL] Nueva solicitud de recarga PENDIENTE. Ref: ${ref} | Tel: ${phone}`);

        return res.json({
            success: true,
            bypass: false,
            message: "PAGO REGISTRADO EN REVISIÓN. TU SALDO SE ACTUALIZARÁ EN UNOS MINUTOS."
        });

    } catch (error) {
        console.error("❌ Falla crítica en pasarela manual:", error.message);
        return res.status(500).json({ success: false, message: "ERROR EN RED INTERNA DE BILLETERA" });
    }
});

// --- ENDPOINT: EL CEREBRO DE SOLICITUD DE VOZ (GROQ AGENT + AUDITORÍA MONGO) ---
app.post('/api/command', async (req, res) => {
    const { command, userCoords, tipoFlotaSeleccionada } = req.body;
    
    if (!command) {
        return res.status(400).json({ reply: "Comando inválido o vacío." });
    }

    try {
        const tasa = await obtenerTasaBCV();

        const responseIA = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { 
                    role: "system", 
                    content: `Eres el núcleo de Inteligencia Artificial de Drivery OS. Tu labor es interpretar los deseos de movilidad del usuario. 
                    - Si te pide ir a un lugar o cotizar, debes extraer los datos y estructurar los parámetros para la función 'crearViajeYummy'.
                    - Si te pregunta si ya viene el conductor, pide el estatus o quiere saber los datos de la unidad, invoca 'consultarStatusYummy'.
                    - Si es charla casual o dudas de navegación general, responde con texto fluido sin invocar funciones.` 
                },
                { role: "user", content: command }
            ],
            tools: yummyTools,
            tool_choice: "auto"
        });

        const message = responseIA.choices[0].message;

        if (message.tool_calls) {
            const toolCall = message.tool_calls[0];
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);

            console.log(`[GROQ AGENT EXECUTE] Ejecutando de manera autónoma: ${functionName}`);

            if (functionName === "crearViajeYummy") {
                const geo = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(args.destinoNombre || command)}&key=${GOOGLE_MAPS_KEY}`);
                
                if (!geo.data.results || geo.data.results.length === 0) {
                    return res.status(404).json({ reply: `No logré geolocalizar el destino sugerido.` });
                }

                const result = geo.data.results[0];
                const destCoords = result.geometry.location;

                // Lógica de tarifas dinámicas geográficas
                let basePrice;
                basePrice = Math.random() * (5.5 - 3.0) + 3.0; 

                const fleetData = [
                    { id: "eco", name: "Drivery Eco", usd: basePrice.toFixed(2), bs: (basePrice * tasa).toFixed(2), eta: "3 min" },
                    { id: "confort", name: "Drivery Confort", usd: (basePrice * 1.35).toFixed(2), bs: (basePrice * 1.35 * tasa).toFixed(2), eta: "5 min" },
                    { id: "premium", name: "Drivery Black", usd: (basePrice * 2.1).toFixed(2), bs: (basePrice * 2.1 * tasa).toFixed(2), eta: "8 min" }
                ];

                return res.json({ 
                    destCoords, 
                    reply: `Ruta procesada hacia ${args.destinoNombre || 'tu destino'}. Selecciona la flota en el panel táctico.`, 
                    display: { fleet: fleetData } 
                });
            }
        } else if(message.content) {
            return res.json({ reply: message.content });
        }
    } catch(e) { 
        console.error(e);
        res.status(500).json({ reply: "Error interno procesando comando analítico." }); 
    }
});

// --- ENDPOINT: SOLICITAR VIAJE DINÁMICO EN BASE DE DATOS REAL (EL TELÉFONO PIDE) ---
app.post('/api/trip/request', async (req, res) => {
    const { telefonoUsuario, destinoNombre, lat, lng, precioUsd, precioBs, tipoFlota } = req.body;

    if (!telefonoUsuario || !destinoNombre || !lat || !lng) {
        return res.status(400).json({ success: false, message: "Faltan parámetros de rastreo o de usuario." });
    }

    try {
        const nuevoViaje = await Viaje.create({
            telefonoUsuario: telefonoUsuario,
            comandoOriginal: `Solicitud en vivo hacia ${destinoNombre}`,
            status: "BUSCANDO",
            destinoNombre: destinoNombre,
            coordenadasDestino: { lat, lng },
            coordenadasUsuario: { lat: 10.48, lng: -66.90 }, // Caracas base por defecto
            tipoFlota: tipoFlota || "eco",
            precioEstimadoUsd: precioUsd || 5.00,
            precioEstimadoBs: precioBs || 225.00,
            tasaBcvAplicada: bcvCache.valor,
            yummyTripId: "DRV_" + Date.now().toString().slice(-6) // ID Único de rastreo para Polling
        });

        console.log(`🚀 [VIAJES] Nuevo viaje en la calle interactuando en DB. Tracking ID: ${nuevoViaje.yummyTripId}`);

        res.json({ 
            success: true, 
            message: "BUSCANDO CONDUCTOR EN LA ZONA EN VIVO", 
            yummyTripId: nuevoViaje.yummyTripId 
        });

    } catch (error) {
        console.error("❌ Error al registrar viaje dinámico:", error.message);
        res.status(500).json({ success: false, message: "Error en el clúster de asignación" });
    }
});

// --- ENDPOINT: POLLING DINÁMICO DE ESTATUS (EL TELÉFONO INTERROGA A MONGO) ---
app.get('/api/trip/status', async (req, res) => {
    const { yummyTripId } = req.query;

    if (!yummyTripId) {
        return res.status(400).json({ error: "Se requiere el ID dinámico del viaje" });
    }

    try {
        const viaje = await Viaje.findOne({ yummyTripId: yummyTripId });
        
        if (!viaje) {
            return res.status(404).json({ error: "El viaje no existe o fue removido" });
        }

        return res.json({
            status: viaje.status,
            destino: viaje.destinoNombre,
            yummyTripId: viaje.yummyTripId,
            conductor: viaje.datosConductor // Retornará null si sigue BUSCANDO, o el objeto si ya fue ACEPTADO
        });

    } catch (error) {
        res.status(500).json({ error: "Fallo de telemetría en base de datos" });
    }
});

// ==========================================================================
// 5. ENDPOINTS DE ADMINISTRACIÓN (MESA DE CONTROL MANUAL INTERACTIVA)
// ==========================================================================

// --- ADMIN CONTROL: APROBAR UN PAGO MÓVIL PENDIENTE Y SUMAR SALDO REAL ---
app.post('/api/admin/approve-recharge', async (req, res) => {
    const { referencia, passwordAdmin } = req.body;

    if (passwordAdmin !== "drivery_master_2026") {
        return res.status(401).json({ success: false, message: "ACCESO DENEGADO" });
    }

    try {
        const transaccion = await Transaccion.findOne({ referencia: referencia, status: 'PROCESANDO' });
        if (!transaccion) return res.status(404).json({ success: false, message: "Transacción pendiente no encontrada" });

        const usuario = await Usuario.findOne({ telefono: transaccion.telefonoUsuario });
        if (!usuario) return res.status(404).json({ success: false, message: "Usuario dueño no encontrado" });

        // Acreditamos el dinero real recopilado de tu cuenta de banco
        usuario.balanceBs += transaccion.montoBs;
        usuario.balanceUsd += transaccion.montoUsd;
        await usuario.save();

        transaccion.status = 'APROBADO';
        await transaccion.save();

        console.log(`✅ [MESA DE CONTROL] Saldo liberado manualmente para el usuario: ${usuario.telefono}`);
        return res.json({ success: true, message: "SALDO ACREDITADO AL MONEDERO DEL USUARIO", nuevoSaldoUsd: usuario.balanceUsd });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- ADMIN CONTROL: SIMULAR QUE UN CHOFER REAL TOMA LA CARRERA (DESBLOQUEO DE APP) ---
app.post('/api/admin/accept-trip', async (req, res) => {
    const { yummyTripId, nombreChofer, vehiculo, placa, fotoUrl } = req.body;

    try {
        const viaje = await Viaje.findOne({ yummyTripId: yummyTripId, status: "BUSCANDO" });
        if (!viaje) return res.status(404).json({ success: false, message: "Viaje ocupado, cancelado o inexistente" });

        // Inyección dinámica de metadatos del Conductor
        viaje.status = "ASIGNADO";
        viaje.datosConductor = {
            nombre: nombreChofer || "Juniel Querecuto",
            modelo: vehiculo || "Toyota 4Runner Limited Hybrid",
            placa: placa || "DRV-2026",
            foto: fotoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
        };

        await viaje.save();
        console.log(`🎯 [VIAJES] El conductor ${viaje.datosConductor.nombre} tomó dinámicamente el viaje ${yummyTripId}`);

        return res.json({ success: true, message: "EL VIAJE CAMBIÓ A ESTADO ASIGNADO CORRECTAMENTE" });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================================================
// 6. INICIALIZACIÓN DEL MOTOR DE ENTRADA
// ==========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🟢 ¡WAOSS! Drivery OS Engine operativo en el puerto ${PORT}`));
