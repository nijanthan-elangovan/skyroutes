// ---- Main app: smooth transitions, 3-flight prefetch queue ----

(function() {
    var SR = window.SkyRoutes;

    var map = L.map('map', {
        center: [30, 0], zoom: 3,
        minZoom: 2, maxZoom: 8,
        zoomControl: false, attributionControl: false,
        keyboard: false, dragging: false,
        scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: false, boxZoom: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19
    }).addTo(map);

    SR.addAirportMarkers(map);

    var canvas = document.getElementById('flight-canvas');
    var ctx = canvas.getContext('2d');
    var W, H;
    function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
    resize();
    addEventListener('resize', resize);

    // ---- Projector mode: double-click fullscreen and keep the display awake ----
    var wakeLock = null;
    function requestWakeLock() {
        if (!navigator.wakeLock) return;
        navigator.wakeLock.request('screen').then(function(lock) {
            wakeLock = lock;
            lock.addEventListener('release', function() { wakeLock = null; });
        }).catch(function() {});
    }
    addEventListener('dblclick', function() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen().then(requestWakeLock).catch(function() {});
        }
    });
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && document.fullscreenElement && !wakeLock) {
            requestWakeLock();
        }
    });
    document.addEventListener('fullscreenchange', function() {
        if (!document.fullscreenElement && wakeLock) wakeLock.release();
    });

    // Clouds disabled
    var cloudRenderer = null;

    // ---- Flight queue: pre-build 3 flights (doesn't touch flightSystem.current) ----
    var queue = [];
    function fillQueue() {
        while (queue.length < 3) {
            var previous = queue.length > 0 ? queue[queue.length - 1] : null;
            queue.push(SR.flightSystem.buildFlight(previous ? previous.toCode : null));
        }
    }
    function takeNext() {
        fillQueue();
        return queue.shift();
    }

    // ---- Camera ----
    var cam = { lat: 30, lon: 0, zoom: 3 };
    var EASE = 0.0015;
    function moveCam(tLat, tLon, tZoom, dt) {
        cam.lat += (tLat - cam.lat) * EASE * dt;
        cam.lon += (tLon - cam.lon) * EASE * dt;
        cam.zoom += (tZoom - cam.zoom) * EASE * dt;
        map.setView([cam.lat, cam.lon], cam.zoom, { animate: false });
    }
    function zoomForRoute(from, to) {
        var sp = Math.max(Math.abs(to.lat - from.lat), Math.abs(to.lon - from.lon));
        if (sp > 150) return 2.5;  if (sp > 120) return 2.8;
        if (sp > 80) return 3.2;   if (sp > 50) return 3.6;
        if (sp > 30) return 4;     if (sp > 15) return 4.5;
        return 5;
    }

    // ---- State machine ----
    var STATE = { FLY: 0, FADE_OUT: 1, PAN: 2 };
    var state = STATE.PAN;
    var stateStart = performance.now();
    var FADE_OUT_DURATION = 2000;
    var PAN_DURATION = 5000;

    var flight = takeNext();     // next flight to fly (not yet active)
    var prevFlight = null;
    var prevFadeStart = 0;

    // ---- Popup ----
    var overlay = document.getElementById('labels-overlay');
    var popup = null;
    var popupRefs = {};
    var splitFlapTimer = null;
    var splitFlapTimeouts = [];
    var popupX = 0, popupY = 0;
    var POP_EASE = 0.06;

    function splitFlapHTML(text) {
        var html = '';
        for (var i = 0; i < text.length; i++) {
            if (text[i] === ' ') html += '<span style="width:6px;display:inline-block"></span>';
            else html += '<span class="fp-flap">' + text[i] + '</span>';
        }
        return html;
    }

    function clearSplitFlapTimers() {
        if (splitFlapTimer) clearInterval(splitFlapTimer);
        splitFlapTimer = null;
        splitFlapTimeouts.forEach(clearTimeout);
        splitFlapTimeouts = [];
    }

    function scheduleSplitFlap(fn, delay) {
        var timer = setTimeout(function() {
            splitFlapTimeouts = splitFlapTimeouts.filter(function(id) { return id !== timer; });
            fn();
        }, delay);
        splitFlapTimeouts.push(timer);
    }

    function createPopup(fl) {
        clearSplitFlapTimers();
        if (popup) { popup.remove(); popup = null; }
        var c = fl.color;
        var acc = 'hsl(' + c.h + ',' + c.s + '%,' + c.l + '%)';
        var el = document.createElement('div');
        el.className = 'flight-popup';
        el.innerHTML =
            '<div class="flight-popup-inner">' +
              '<div class="fp-airline">' + fl.airlineName + '</div>' +
              '<div class="fp-flight" style="color:' + acc + '">' + fl.flightName + '</div>' +
              '<div class="fp-splitflap">' +
                '<div class="fp-flap-group" id="fp-origin">' + splitFlapHTML(fl.fromCode) + '</div>' +
                '<span class="fp-flap-arrow">→</span>' +
                '<div class="fp-flap-group" id="fp-dest">' + splitFlapHTML(fl.toCode) + '</div>' +
              '</div>' +
              '<div class="fp-divider"></div>' +
              '<div class="fp-stats">' +
                '<div class="fp-stat"><span class="fp-stat-label">ALT</span><span class="fp-stat-value" id="fp-alt">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">SPD</span><span class="fp-stat-value" id="fp-spd">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">DIST</span><span class="fp-stat-value" id="fp-dist">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">TIME</span><span class="fp-stat-value" id="fp-time">—</span></div>' +
              '</div>' +
              '<div class="fp-progress"><div class="fp-progress-fill" id="fp-bar"></div></div>' +
            '</div>';
        overlay.appendChild(el);
        popup = el;
        popupRefs = {
            alt: el.querySelector('#fp-alt'),
            spd: el.querySelector('#fp-spd'),
            dist: el.querySelector('#fp-dist'),
            time: el.querySelector('#fp-time'),
            bar: el.querySelector('#fp-bar')
        };
        popupRefs.dist.textContent = fl.distance.toLocaleString() + ' km';
        // Set progress bar color to match flight
        popupRefs.bar.style.background = acc;

        var startPx = map.latLngToContainerPoint(L.latLng(fl.from.lat, fl.from.lon));
        popupX = startPx.x + 24;
        popupY = startPx.y + 32;
        el.style.transform = 'translate(' + Math.round(popupX) + 'px,' + Math.round(popupY) + 'px)';

        requestAnimationFrame(function() {
            requestAnimationFrame(function() { el.classList.add('visible'); });
        });

        function animateGroup(group, code, delay) {
            if (!group) return;
            var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            group.querySelectorAll('.fp-flap').forEach(function(flap, index) {
                var target = code[index];
                var targetIndex = alphabet.indexOf(target);
                var steps = 5 + index * 2;
                for (var step = 0; step <= steps; step++) {
                    (function(currentStep) {
                        scheduleSplitFlap(function() {
                            var letterIndex = (targetIndex - steps + currentStep + alphabet.length) % alphabet.length;
                            flap.textContent = currentStep === steps ? target : alphabet[letterIndex];
                            flap.classList.remove('flipping');
                            void flap.offsetWidth;
                            flap.classList.add('flipping');
                        }, delay + index * 90 + currentStep * 85);
                    })(step);
                }
            });
        }

        function animateSplitFlap() {
            animateGroup(el.querySelector('#fp-origin'), fl.fromCode, 0);
            animateGroup(el.querySelector('#fp-dest'), fl.toCode, 220);
        }

        setTimeout(animateSplitFlap, 100);
        splitFlapTimer = setInterval(animateSplitFlap, 5000);
    }

    function updatePopup(now) {
        if (!popup || !SR.flightSystem.current) return;
        var st = SR.flightSystem.getState(now);
        if (!st || st.done) return;

        var pos = SR.flightSystem.getHeadPosition(st.progress);
        if (pos) {
            var px = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
            popupX += (px.x + 24 - popupX) * POP_EASE;
            popupY += (px.y + 32 - popupY) * POP_EASE;
            popup.style.transform = 'translate(' + Math.round(popupX) + 'px,' + Math.round(popupY) + 'px)';
        }
        popup.style.opacity = st.opacity * 0.92;

        var live = SR.flightSystem.getLiveStats(st.progress);
        if (popupRefs.alt) popupRefs.alt.textContent = live.altitude.toLocaleString() + ' ft';
        if (popupRefs.spd) popupRefs.spd.textContent = live.speed + ' kts';

        // Elapsed time (simulated flight hours based on distance & speed)
        if (popupRefs.time) {
            var simHours = (flight.distance * st.progress) / (live.speed * 1.852); // kts→km/h
            var h = Math.floor(simHours);
            var m = Math.floor((simHours - h) * 60);
            popupRefs.time.textContent = h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        }

        // Progress bar
        if (popupRefs.bar) {
            popupRefs.bar.style.width = Math.round(st.progress * 100) + '%';
        }
    }

    function fadeOutPopup() {
        if (!popup) return;
        clearSplitFlapTimers();
        popup.classList.remove('visible');
        var p = popup;
        popup = null; popupRefs = {};
        setTimeout(function() { p.remove(); }, 1500);
    }

    // ---- API ----
    SR.fetchRoutes().then(function(routes) { SR.flightSystem.setRoutes(routes); fillQueue(); });

    // ---- Main loop ----
    var lastTime = performance.now();

    function animate(now) {
        requestAnimationFrame(animate);
        var dt = Math.min(now - lastTime, 100);
        lastTime = now;
        var elapsed = now - stateStart;

        if (cloudRenderer) cloudRenderer.render(now);
        ctx.clearRect(0, 0, W, H);

        // ---- Fading-out previous flight trail ----
        if (prevFlight) {
            var fadeElapsed = now - prevFadeStart;
            var fadeAlpha = 1 - (fadeElapsed / FADE_OUT_DURATION);
            if (fadeAlpha > 0.01) {
                var pts = prevFlight.arcPoints;
                var c = prevFlight.color;
                ctx.beginPath();
                var f = map.latLngToContainerPoint(L.latLng(pts[0].lat, pts[0].lon));
                ctx.moveTo(f.x, f.y);
                for (var i = 1; i < pts.length; i++) {
                    var p = map.latLngToContainerPoint(L.latLng(pts[i].lat, pts[i].lon));
                    ctx.lineTo(p.x, p.y);
                }
                ctx.strokeStyle = 'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,' + (fadeAlpha * 0.2) + ')';
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.stroke();
            } else {
                prevFlight = null;
            }
        }

        // ======== FLY ========
        if (state === STATE.FLY) {
            var st = SR.flightSystem.getState(now);
            if (st && !st.done) {
                var headPos = SR.flightSystem.getHeadPosition(st.progress);
                if (headPos) {
                    var leadProgress = Math.min(st.progress + Math.min(0.035, (1 - st.progress) * 0.5), 1);
                    var leadPos = SR.flightSystem.getHeadPosition(leadProgress);
                    moveCam(
                        leadPos.lat,
                        leadPos.lon,
                        zoomForRoute(flight.from, flight.to), dt
                    );
                }
                SR.flightSystem.draw(ctx, map, now);
                updatePopup(now);
            } else {
                // Flight done
                fadeOutPopup();
                prevFlight = flight;
                prevFadeStart = now;
                flight = takeNext();
                fillQueue();
                state = STATE.FADE_OUT;
                stateStart = now;
            }
        }

        // ======== FADE_OUT ========
        else if (state === STATE.FADE_OUT) {
            if (elapsed >= FADE_OUT_DURATION) {
                state = STATE.PAN;
                stateStart = now;
            }
        }

        // ======== PAN to departure and settle at the flight's route zoom ========
        else if (state === STATE.PAN) {
            moveCam(
                flight.from.lat,
                flight.from.lon,
                zoomForRoute(flight.from, flight.to),
                dt
            );
            if (elapsed >= PAN_DURATION) {
                // NOW activate: sets flightSystem.current so getState/draw work
                SR.flightSystem.activate(flight, now);
                createPopup(flight);
                state = STATE.FLY;
                stateStart = now;
            }
        }
    }

    requestAnimationFrame(animate);
})();
