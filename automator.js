const puppeteer = require('puppeteer');

// Esta es la función maestra que llamará tu server.js
async function ejecutarDespacho(flota, origen, destino) {
    const browser = await puppeteer.launch({
        headless: true, // El navegador no se ve, corre en el fondo
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Obligatorio para Render
    });
    const page = await browser.newPage();

    try {
        if (flota === 'Verde') {
            console.log("Iniciando protocolo Yummy...");
            await page.goto('https://yummy.delivery/login'); // Ejemplo
            // Aquí van los pasos específicos de Yummy (clics, inputs)
            return { precio: 5.50, tiempo: "10 min", msg: "Yummy listo" };
        } 
        
        if (flota === 'Azul') {
            console.log("Iniciando protocolo Ridery...");
            await page.goto('https://ridery.app/login'); // Ejemplo
            // Aquí van los pasos específicos de Ridery
            return { precio: 7.20, tiempo: "5 min", msg: "Ridery listo" };
        }

    } catch (error) {
        console.error(`Error en el motor de flota ${flota}:`, error);
        return { error: "Plataforma fuera de servicio" };
    } finally {
        await browser.close(); // Siempre cerramos el navegador para no gastar RAM
    }
}

module.exports = { ejecutarDespacho };