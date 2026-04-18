<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Drivery OS | Command Center</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --drivery-blue: #00d2ff; --drivery-green: #39ff14; --drivery-purple: #7b2cbf;
            --glass-bg: rgba(6, 11, 20, 0.94); --glass-border: rgba(0, 210, 255, 0.3);
            --font-tech: 'Orbitron', sans-serif; --font-main: 'Rajdhani', sans-serif;
        }
        body, html { margin: 0; padding: 0; height: 100%; background-color: #000; overflow: hidden; font-family: var(--font-main); color: #fff; }
        #map { position: absolute; top: 0; left: 0; height: 100%; width: 100%; z-index: 1; background-color: #1a1f26; }
        
        #ui-layer { position: relative; z-index: 100; height: 100dvh; display: flex; flex-direction: column; pointer-events: none; align-items: center; justify-content: space-between; }
        #ui-layer > * { pointer-events: auto; }

        header { width: 100%; display: flex; justify-content: space-between; padding: 25px 30px; box-sizing: border-box; transition: 0.5s ease; }
        .logo-main { height: 45px; filter: drop-shadow(0 0 15px var(--drivery-blue)); }

        /* TARJETAS SUPERIORES */
        #fleet-selection { position: absolute; top: 20px; width: 95%; display: none; justify-content: center; flex-wrap: wrap; gap: 12px; z-index: 1000; }
        .car-card { background: var(--glass-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: 18px; padding: 12px 18px; text-align: center; min-width: 105px; cursor: pointer; transition: 0.3s; }
        .car-card.selected { border-color: var(--drivery-green); box-shadow: 0 0 15px rgba(57, 255, 20, 0.3); }

        /* MANDO INFERIOR */
        main { flex-grow: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: all 0.8s ease; }
        .orb-master { width: 280px; height: 280px; filter: drop-shadow(0 0 45px rgba(0, 210, 255, 0.5)); cursor: pointer; touch-action: none; }

        /* BOTÓN CONFIRMAR: APARECE AL TOCAR TARJETA */
        #confirm-panel { position: fixed; bottom: 120px; display: none; flex-direction: column; align-items: center; width: 100%; z-index: 200; }
        .btn-action { background: var(--drivery-purple); color: #fff; border: none; padding: 15px 40px; border-radius: 30px; font-family: var(--font-tech); font-weight: 900; letter-spacing: 2px; cursor: pointer; box-shadow: 0 0 20px rgba(123, 44, 191, 0.5); }

        /* MODAL DE BÚSQUEDA (EL RELOJITO) */
        #search-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 3000; flex-direction: column; align-items: center; justify-content: center; }
        .loader { width: 60px; height: 60px; border: 3px solid transparent; border-top-color: var(--drivery-blue); border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .route-active main { justify-content: flex-end; padding-bottom: 25px; }
        .route-active .orb-master { width: 85px; height: 85px; }
        .route-active header { opacity: 0; pointer-events: none; }
    </style>
</head>
<body id="body-context">
    <div id="map"></div>
    
    <div id="search-modal">
        <div class="loader"></div>
        <h3 style="font-family:var(--font-tech); color:var(--drivery-blue); margin-top:25px; letter-spacing:3px;">BUSCANDO PILOTO</h3>
        <p id="search-timer" style="font-size:14px; opacity:0.7;">00:00</p>
    </div>

    <div id="ui-layer">
        <header>
            <img src="logo_app.png" class="logo-main">
            <div id="u-balance" style="color:var(--drivery-green); font-family:var(--font-tech); font-weight:900;">$0.00</div>
        </header>

        <div id="fleet-selection"></div>

        <div id="confirm-panel">
            <button class="btn-action" onclick="confirmarViaje()">CONFIRMAR VIAJE</button>
        </div>

        <main>
            <div id="main-orbe" class="orb-master"></div>
            <h2 id="orb-status" style="font-family:var(--font-tech); font-size:12px; color:var(--drivery-blue); margin-top:15px; letter-spacing:2px;">MANTENER PARA TRANSMITIR</h2>
        </main>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
        const API_URL = "https://drivery-backend.onrender.com";
        const MAP_KEY = "AIzaSyAFwND09Y6rrNzVrhOdu5wGptY063y-fME";
        let map, directionsRenderer, directionsService, sphere, coreMat, recognition, isRecording = false;
        let userPos = { lat: 10.48, lng: -66.90 }, markerA, markerB, selectedPlan = null;

        function speak(texto) { const m = new SpeechSynthesisUtterance(texto); m.lang = 'es-VE'; window.speechSynthesis.speak(m); }

        function initMap() {
            const style = [{"elementType":"geometry","stylers":[{"color":"#1a1f26"}]},{"elementType":"labels.text.fill","stylers":[{"color":"#00d2ff"}]},{"featureType":"road","elementType":"geometry","stylers":[{"color":"#2c343f"}]}];
            directionsService = new google.maps.DirectionsService();
            directionsRenderer = new google.maps.DirectionsRenderer({ map: null, suppressMarkers: true, polylineOptions: { strokeColor: "#00d2ff", strokeWeight: 6 } });
            map = new google.maps.Map(document.getElementById("map"), { center: userPos, zoom: 16, styles: style, disableDefaultUI: true });
            directionsRenderer.setMap(map);
            if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => { userPos = { lat: p.coords.latitude, lng: p.coords.longitude }; map.setCenter(userPos); });
            initThreeJS(); initVoice();
        }

        async function ejecutarComando(cmd) {
            document.getElementById('body-context').classList.add('route-active');
            coreMat.color.setHex(0xffffff);
            try {
                const res = await fetch(`${API_URL}/api/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: cmd, userCoords: userPos }) });
                const data = await res.json();
                if(data.destCoords) {
                    if(markerA) markerA.setMap(null); if(markerB) markerB.setMap(null);
                    const icon = () => ({ path: google.maps.SymbolPath.CIRCLE, fillColor: '#002a3a', fillOpacity: 1, strokeColor: '#00d2ff', strokeWeight: 2, scale: 10 });
                    markerA = new google.maps.Marker({ position: userPos, map: map, icon: icon(), label: { text: 'A', color: '#00d2ff' } });
                    markerB = new google.maps.Marker({ position: data.destCoords, map: map, icon: icon(), label: { text: 'B', color: '#00d2ff' } });
                    directionsService.route({ origin: userPos, destination: data.destCoords, travelMode: 'DRIVING' }, (r, s) => { if (s === 'OK') directionsRenderer.setDirections(r); });
                    mostrarFlota(data.display.fleet);
                    speak(data.reply);
                }
            } catch(e) { speak("Fallo táctico."); }
            coreMat.color.setHex(0x00d2ff);
        }

        function mostrarFlota(fleet) {
            const panel = document.getElementById('fleet-selection');
            panel.innerHTML = ''; panel.style.display = 'flex';
            fleet.forEach((car) => {
                const card = document.createElement('div');
                card.className = 'car-card';
                card.innerHTML = `<div style="font-size:8px; color:var(--drivery-blue);">${car.name.toUpperCase()}</div><div style="font-size:18px; font-weight:900;">$${car.usd}</div><div style="font-size:10px; color:var(--drivery-green);">${car.bs} Bs.</div>`;
                card.onclick = () => {
                    document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    selectedPlan = car;
                    document.getElementById('confirm-panel').style.display = 'flex';
                };
                panel.appendChild(card);
            });
        }

        function confirmarViaje() {
            if(!selectedPlan) return;
            document.getElementById('search-modal').style.display = 'flex';
            let seg = 0;
            setInterval(() => {
                seg++;
                let m = Math.floor(seg/60); let s = seg % 60;
                document.getElementById('search-timer').innerText = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
            }, 1000);
            speak(`Solicitando unidad ${selectedPlan.name}. Espere confirmación de piloto.`);
        }

        function initThreeJS() {
            const container = document.getElementById('main-orbe');
            const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setSize(280, 280);
            container.appendChild(renderer.domElement);
            sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 5), new THREE.MeshBasicMaterial({ color: 0x00d2ff, wireframe: true, transparent: true, opacity: 0.15 }));
            coreMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff, wireframe: true, transparent: true, opacity: 0.6 });
            const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 3), coreMat);
            sphere.add(core); scene.add(sphere); camera.position.z = 2.4;
            const animate = () => { requestAnimationFrame(animate); sphere.rotation.y += 0.003; core.rotation.y -= 0.006; renderer.render(scene, camera); }; animate();
            const startTalk = (e) => { e.preventDefault(); isRecording = true; coreMat.color.setHex(0xffffff); sphere.scale.set(1.1, 1.1, 1.1); document.getElementById('orb-status').innerText = "TRANSMITIENDO..."; try { recognition.start(); } catch(err) {} };
            const stopTalk = () => { if (isRecording) { isRecording = false; coreMat.color.setHex(0x00d2ff); sphere.scale.set(1, 1, 1); document.getElementById('orb-status').innerText = "PROCESANDO..."; recognition.stop(); } };
            container.addEventListener('mousedown', startTalk); window.addEventListener('mouseup', stopTalk);
            container.addEventListener('touchstart', startTalk); container.addEventListener('touchend', stopTalk);
        }

        function initVoice() { recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)(); recognition.lang = 'es-VE'; recognition.onresult = (e) => ejecutarComando(e.results[0][0].transcript); }
        window.onload = () => { const s = document.createElement('script'); s.src = `https://maps.googleapis.com/maps/api/js?key=${MAP_KEY}&callback=initMap`; document.head.appendChild(s); };
    </script>
</body>
</html>
