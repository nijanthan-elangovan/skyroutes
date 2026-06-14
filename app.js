// ---- Main app: smooth transitions, 3-flight prefetch queue ----

(function() {
    var SR = window.SkyRoutes;

    var map = L.map('map', {
        center: [30, 0], zoom: 3,
        minZoom: 2, maxZoom: 8,
        zoomControl: false, attributionControl: true,
        keyboard: false, dragging: false,
        scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: false, boxZoom: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
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

    var reducedMotionMq = matchMedia('(prefers-reduced-motion: reduce)');
    var reducedMotion = reducedMotionMq.matches;
    reducedMotionMq.addEventListener('change', function(e) { reducedMotion = e.matches; });

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
        while (tLon - cam.lon > 180) tLon -= 360;
        while (tLon - cam.lon < -180) tLon += 360;
        if (reducedMotion) dt = Math.max(dt, 1000);
        cam.lat += (tLat - cam.lat) * EASE * dt;
        cam.lon += (tLon - cam.lon) * EASE * dt;
        cam.zoom += (tZoom - cam.zoom) * EASE * dt;
        map.setView([cam.lat, cam.lon], cam.zoom, { animate: false });
    }
    function zoomForRoute(from, to) {
        var lonSpan = Math.abs(to.lon - from.lon);
        if (lonSpan > 180) lonSpan = 360 - lonSpan;
        var sp = Math.max(Math.abs(to.lat - from.lat), lonSpan);
        if (sp > 150) return 2.5;  if (sp > 120) return 2.8;
        if (sp > 80) return 3.2;   if (sp > 50) return 3.6;
        if (sp > 30) return 4;     if (sp > 15) return 4.5;
        return 5;
    }

    function alignFlightToCamera(fl) {
        var shift = Math.round((cam.lon - fl.arcPoints[0].lon) / 360) * 360;
        if (!shift) return fl;
        for (var i = 0; i < fl.arcPoints.length; i++) {
            fl.arcPoints[i].lon += shift;
        }
        return fl;
    }

    // ---- State machine ----
    var STATE = { FLY: 0, FADE_OUT: 1, PAN: 2, LANDED: 3 };
    var state = STATE.PAN;
    var stateStart = performance.now();
    var FADE_OUT_DURATION = 2000;
    var PAN_DURATION = 5000;
    var LANDED_DURATION = 2500;

    // Pause tracking: accumulate paused ms and offset flight startTime on resume
    var pauseStart = 0;
    var flight = alignFlightToCamera(takeNext()); // next flight to fly (not yet active)
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

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, function(ch) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
        });
    }

    function splitFlapHTML(text) {
        var html = '';
        for (var i = 0; i < text.length; i++) {
            if (text[i] === ' ') html += '<span style="width:6px;display:inline-block"></span>';
            else html += '<span class="fp-flap">' + escapeHTML(text[i]) + '</span>';
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
            if (!SR.paused) fn();
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
              '<div class="fp-airline">' + escapeHTML(fl.airlineName) + '</div>' +
              '<div class="fp-flight" style="color:' + acc + '">' + escapeHTML(fl.flightName) + '</div>' +
              '<div class="fp-status">' + escapeHTML(fl.dataStatus) + '</div>' +
              '<div class="fp-splitflap">' +
                '<div class="fp-flap-group" id="fp-origin">' + splitFlapHTML(fl.fromCode) + '</div>' +
                '<span class="fp-flap-arrow">→</span>' +
                '<div class="fp-flap-group" id="fp-dest">' + splitFlapHTML(fl.toCode) + '</div>' +
              '</div>' +
              '<div class="fp-divider"></div>' +
              '<div class="fp-clock" id="fp-clock"></div>' +
              '<div class="fp-stats">' +
                '<div class="fp-stat"><span class="fp-stat-label">ALT</span><span class="fp-stat-value" id="fp-alt">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">SPD</span><span class="fp-stat-value" id="fp-spd">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">DIST</span><span class="fp-stat-value" id="fp-dist">—</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-label">TIME</span><span class="fp-stat-value" id="fp-time">—</span></div>' +
              '</div>' +
              '<div class="fp-progress"><div class="fp-progress-fill" id="fp-bar"></div></div>' +
              '<div class="fp-turb" id="fp-turb">TURB: —</div>' +
            '</div>';
        overlay.appendChild(el);
        popup = el;
        popupRefs = {
            alt: el.querySelector('#fp-alt'),
            spd: el.querySelector('#fp-spd'),
            dist: el.querySelector('#fp-dist'),
            time: el.querySelector('#fp-time'),
            bar: el.querySelector('#fp-bar'),
            clock: el.querySelector('#fp-clock'),
            turb: el.querySelector('#fp-turb')
        };
        popupRefs.dist.textContent = fl.distance.toLocaleString() + ' km';
        popupRefs.bar.style.background = acc;

        // Init turbulence zones for this flight
        if (SR.effects) SR.effects.initTurbulence();

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

        if (!reducedMotion) {
            setTimeout(animateSplitFlap, 100);
            splitFlapTimer = setInterval(animateSplitFlap, 5000);
        }
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

        if (popupRefs.time) {
            var simHours = (flight.distance * st.progress) / (live.speed * 1.852);
            var h = Math.floor(simHours);
            var m = Math.floor((simHours - h) * 60);
            popupRefs.time.textContent = h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        }

        if (popupRefs.bar) {
            popupRefs.bar.style.width = Math.round(st.progress * 100) + '%';
        }

        // Local time at current position
        if (popupRefs.clock) {
            var headPos = SR.flightSystem.getHeadPosition(st.progress);
            if (headPos) {
                popupRefs.clock.textContent = 'SOLAR ' + SR.effects.getLocalTime(headPos.lon, headPos.lat);
            }
        }

        // Turbulence indicator
        if (popupRefs.turb && SR.effects) {
            var turb = SR.effects.getTurbulence(st.progress);
            if (turb) {
                popupRefs.turb.textContent = 'TURB: ' + turb.severity;
                popupRefs.turb.classList.add('active');
            } else {
                popupRefs.turb.classList.remove('active');
            }
        }

        // Audio
        if (SR.effects) SR.effects.updateAudio(st.progress, live.speed);
    }

    function fadeOutPopup() {
        if (!popup) return;
        clearSplitFlapTimers();
        popup.classList.remove('visible');
        var p = popup;
        popup = null; popupRefs = {};
        setTimeout(function() { p.remove(); }, 1500);
    }

    // ---- Skip to next (for keyboard shortcut) ----
    SR.skipToNext = function() {
        if (SR.paused) return;
        if (state === STATE.FLY) {
            if (SR.effects) {
                SR.effects.addToHistory(flight);
                SR.effects.fadeOutAudio();
            }
            fadeOutPopup();
            prevFlight = flight;
            prevFadeStart = performance.now();
            flight = alignFlightToCamera(takeNext());
            fillQueue();
            state = STATE.FADE_OUT;
            stateStart = performance.now();
        }
    };

    // ---- API ----
    SR.fetchRoutes().then(function(routes) { SR.flightSystem.setRoutes(routes); fillQueue(); });

    // =======================================
    // 3D VIEW SYSTEM
    // =======================================
    var viewBtn = document.getElementById('view-btn');
    var horizonGlow = document.getElementById('horizon-glow');
    var sceneWrapper = document.getElementById('scene-wrapper');
    var is3D = false;
    var auto3D = false; // auto-toggle based on altitude
    var userToggled3D = false; // true if user manually toggled

    // 3D camera state (smoothly interpolated each frame)
    var cam3d = {
        tiltX: 0,       // current rotateX degrees
        orbitY: 0,       // current rotateY degrees (auto-orbit)
        scale: 1,
        translateY: 0,   // percent
        perspOriginX: 50, // percent
        perspOriginY: 35, // percent
        // Targets
        targetTiltX: 0,
        targetOrbitY: 0,
        targetScale: 1,
        targetTranslateY: 0,
        targetPerspX: 50,
        targetPerspY: 35
    };

    var TILT_3D = 48;       // degrees when 3D is on
    var SCALE_3D = 1.3;
    var TRANSLATE_Y_3D = 10; // percent

    viewBtn.addEventListener('click', function() {
        userToggled3D = true;
        is3D = !is3D;
        document.body.classList.toggle('view-3d', is3D);
        viewBtn.setAttribute('aria-pressed', String(is3D));
    });

    function update3DCamera(now, dt) {
        if (reducedMotion) {
            is3D = false;
            document.body.classList.remove('view-3d');
            viewBtn.setAttribute('aria-pressed', 'false');
        }
        var t = now * 0.001; // seconds

        // ---- Auto-3D during cruise (altitude > 25000 ft) ----
        if (!userToggled3D && state === STATE.FLY && SR.flightSystem.current) {
            var st = SR.flightSystem.getState(now);
            if (st) {
                var live = SR.flightSystem.getLiveStats(st.progress);
                var shouldBe3D = live.altitude > 25000;
                if (shouldBe3D !== auto3D) {
                    auto3D = shouldBe3D;
                    is3D = auto3D;
                    document.body.classList.toggle('view-3d', is3D);
                }
            }
        }

        if (is3D) {
            // Auto-orbit: slow rotation
            cam3d.targetOrbitY = Math.sin(t * 0.04) * 8; // ±8 degrees

            // Flight-aware tilt direction
            if (flight && state === STATE.FLY) {
                // Compute bearing from departure to destination
                var dLon = flight.to.lon - flight.from.lon;
                if (dLon > 180) dLon -= 360;
                if (dLon < -180) dLon += 360;
                var dLat = flight.to.lat - flight.from.lat;
                // Shift perspective-origin toward the destination
                var bearingDeg = Math.atan2(dLon, dLat) * 180 / Math.PI;
                cam3d.targetPerspX = 50 + Math.sin(bearingDeg * Math.PI / 180) * 15;
                cam3d.targetPerspY = 35 - Math.cos(bearingDeg * Math.PI / 180) * 10;
            } else {
                cam3d.targetPerspX = 50;
                cam3d.targetPerspY = 35;
            }

            cam3d.targetTiltX = TILT_3D;
            cam3d.targetScale = SCALE_3D;
            cam3d.targetTranslateY = TRANSLATE_Y_3D;
        } else {
            cam3d.targetTiltX = 0;
            cam3d.targetOrbitY = 0;
            cam3d.targetScale = 1;
            cam3d.targetTranslateY = 0;
            cam3d.targetPerspX = 50;
            cam3d.targetPerspY = 35;
        }

        // Smooth interpolation
        var ease = 0.0012 * dt;
        cam3d.tiltX += (cam3d.targetTiltX - cam3d.tiltX) * ease;
        cam3d.orbitY += (cam3d.targetOrbitY - cam3d.orbitY) * ease;
        cam3d.scale += (cam3d.targetScale - cam3d.scale) * ease;
        cam3d.translateY += (cam3d.targetTranslateY - cam3d.translateY) * ease;
        cam3d.perspOriginX += (cam3d.targetPerspX - cam3d.perspOriginX) * ease;
        cam3d.perspOriginY += (cam3d.targetPerspY - cam3d.perspOriginY) * ease;

        // Apply
        document.body.style.perspective = is3D ? '900px' : 'none';
        document.body.style.perspectiveOrigin =
            cam3d.perspOriginX.toFixed(1) + '% ' + cam3d.perspOriginY.toFixed(1) + '%';

        sceneWrapper.style.transform =
            'rotateX(' + cam3d.tiltX.toFixed(2) + 'deg) ' +
            'rotateY(' + cam3d.orbitY.toFixed(2) + 'deg) ' +
            'scale(' + cam3d.scale.toFixed(3) + ') ' +
            'translateY(' + cam3d.translateY.toFixed(2) + '%)';

        // Horizon glow: position + color match flight color
        if (is3D && flight) {
            var c = flight.color;
            horizonGlow.style.background = 'linear-gradient(90deg,' +
                'transparent 10%,' +
                'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,0.12) 30%,' +
                'hsla(' + c.h + ',' + c.s + '%,' + (c.l+10) + '%,0.22) 50%,' +
                'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,0.12) 70%,' +
                'transparent 90%)';
            // Position glow at ~15% from top (where tilted horizon appears)
            horizonGlow.style.top = '12%';
        }
    }

    // =======================================
    // TRACK PANEL (easter egg)
    // =======================================
    var panel = document.getElementById('track-panel');
    var eggBtn = document.getElementById('egg-btn');
    var tpClose = document.getElementById('tp-close');
    var tpFlightInput = document.getElementById('tp-flight');
    var tpFromInput = document.getElementById('tp-from');
    var tpToInput = document.getElementById('tp-to');
    var tpSearchFlight = document.getElementById('tp-search-flight');
    var tpSearchRoute = document.getElementById('tp-search-route');
    var tpStatus = document.getElementById('tp-status');

    eggBtn.addEventListener('click', function() {
        setPanelOpen(!panel.classList.contains('open'));
    });
    tpClose.addEventListener('click', function() {
        setPanelOpen(false);
    });
    panel.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') setPanelOpen(false);
    });

    function setPanelOpen(open) {
        panel.classList.toggle('open', open);
        panel.setAttribute('aria-hidden', String(!open));
        panel.inert = !open;
        eggBtn.setAttribute('aria-expanded', String(open));
        if (open) tpFlightInput.focus();
        else eggBtn.focus();
    }

    function setStatus(msg, type) {
        tpStatus.textContent = msg;
        tpStatus.className = 'tp-status' + (type ? ' ' + type : '');
    }

    // Inject a custom flight into the state machine
    function injectFlight(fl) {
        SR.paused = false;
        pauseStart = 0;
        fadeOutPopup();
        prevFlight = flight;
        prevFadeStart = performance.now();
        flight = alignFlightToCamera(fl);
        // Clear queue so it chains from this flight next
        queue = [];
        fillQueue();
        state = STATE.PAN;
        stateStart = performance.now();
        setPanelOpen(false);
    }

    // Search by flight number — look in live data
    tpSearchFlight.addEventListener('click', function() {
        var query = (tpFlightInput.value || '').trim().toUpperCase().replace(/\s+/g, '');
        if (query.length < 3) { setStatus('Enter a flight number', 'error'); return; }

        setStatus('Searching...');

        // Search live flights cache
        var match = null;
        for (var i = 0; i < SR.liveFlights.length; i++) {
            var f = SR.liveFlights[i];
            var cs = f.callsign.replace(/\s+/g, '');
            var fn = f.flightName.replace(/\s+/g, '');
            if (cs === query || fn === query || cs.indexOf(query) === 0) {
                match = f;
                break;
            }
        }

        if (match) {
            var nearCode = match.nearAirport;

            // Pick a plausible destination — furthest airport in the heading direction
            var bestDest = null, bestScore = -Infinity;
            var headRad = (match.heading !== null ? match.heading : 0) * Math.PI / 180;
            for (var code in SR.AIRPORTS) {
                if (code === nearCode) continue;
                var ap = SR.AIRPORTS[code];
                var dLat = ap.lat - match.lat;
                var dLon = ap.lon - match.lon;
                if (dLon > 180) dLon -= 360;
                if (dLon < -180) dLon += 360;
                var dist = Math.sqrt(dLat * dLat + dLon * dLon);
                if (dist < 5) continue; // too close
                var angle = Math.atan2(dLon, dLat);
                var angleDiff = Math.abs(angle - headRad);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                var score = dist * Math.max(0, 1 - angleDiff / (Math.PI * 0.6));
                if (score > bestScore) { bestScore = score; bestDest = code; }
            }

            if (!bestDest) { setStatus('Could not determine route', 'error'); return; }

            var toAp = SR.getAirport(bestDest);

            setStatus(match.flightName + ' reported position, estimated toward ' + bestDest, 'success');

            // Build flight with proper geometry for the actual route
            var fl = SR.flightSystem.buildFlight();
            fl.fromCode = 'POS';
            fl.toCode = bestDest;
            fl.from = { name: 'Current position', lat: match.lat, lon: match.lon };
            fl.to = toAp;
            fl.arcPoints = SR.flightSystem.computeArc(fl.from, toAp);
            fl.distance = Math.round(SR.flightSystem.haversineKm(fl.from, toAp));
            fl.duration = SR.flightSystem.durationForDistance(fl.distance);
            fl.flightName = match.flightName;
            fl.airlineName = match.airlineName;
            fl.baseAlt = match.altitude !== null ? match.altitude : 35000;
            fl.baseSpeed = match.speed !== null ? match.speed : 480;
            var ageMinutes = match.lastContact ?
                Math.max(0, Math.round((Date.now() / 1000 - match.lastContact) / 60)) : null;
            fl.dataStatus = 'REPORTED POSITION' +
                (ageMinutes !== null ? ' ' + ageMinutes + 'M AGO' : '') +
                ' / ESTIMATED PATH';

            setTimeout(function() { injectFlight(fl); }, 800);
        } else {
            setStatus('Flight not found in live data', 'error');
        }
    });

    // Search by route — build a flight between two airports
    tpSearchRoute.addEventListener('click', function() {
        var from = (tpFromInput.value || '').trim().toUpperCase();
        var to = (tpToInput.value || '').trim().toUpperCase();

        if (from.length < 2 || to.length < 2) {
            setStatus('Enter airport codes (e.g. JFK, LHR)', 'error');
            return;
        }

        var fromAp = SR.getAirport(from);
        var toAp = SR.getAirport(to);

        if (!fromAp) { setStatus(from + ' not in airport database', 'error'); return; }
        if (!toAp) { setStatus(to + ' not in airport database', 'error'); return; }
        if (from === to) { setStatus('Origin and destination must differ', 'error'); return; }

        setStatus('Simulating ' + from + ' → ' + to, 'success');

        // Build flight for this route with proper arc
        var fl = SR.flightSystem.buildFlight(from);
        fl.fromCode = from;
        fl.toCode = to;
        fl.from = fromAp;
        fl.to = toAp;
        fl.arcPoints = SR.flightSystem.computeArc(fromAp, toAp);
        fl.distance = Math.round(SR.flightSystem.haversineKm(fromAp, toAp));
        fl.duration = SR.flightSystem.durationForDistance(fl.distance);

        fl.dataStatus = 'SIMULATED ROUTE';

        setTimeout(function() { injectFlight(fl); }, 800);
    });

    // Enter key support
    tpFlightInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') tpSearchFlight.click();
    });
    tpFromInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') tpSearchRoute.click();
    });
    tpToInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') tpSearchRoute.click();
    });

    // ---- Main loop ----
    var lastTime = performance.now();

    function drawStaticRoute(fl, alpha) {
        var pts = fl.arcPoints;
        var c = fl.color;
        ctx.beginPath();
        var first = map.latLngToContainerPoint(L.latLng(pts[0].lat, pts[0].lon));
        ctx.moveTo(first.x, first.y);
        for (var i = 1; i < pts.length; i++) {
            var point = map.latLngToContainerPoint(L.latLng(pts[i].lat, pts[i].lon));
            ctx.lineTo(point.x, point.y);
        }
        ctx.strokeStyle = 'hsla(' + c.h + ',' + c.s + '%,' + c.l + '%,' + alpha + ')';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function animate(now) {
        requestAnimationFrame(animate);
        var frameNow = now;
        var dt = Math.min(frameNow - lastTime, 100);
        lastTime = frameNow;

        if (SR.paused) {
            if (!pauseStart) pauseStart = frameNow;
            now = pauseStart;
            dt = 0;
        } else if (pauseStart) {
            var pausedMs = frameNow - pauseStart;
            stateStart += pausedMs;
            if (SR.flightSystem.current) SR.flightSystem.current.startTime += pausedMs;
            if (prevFadeStart) prevFadeStart += pausedMs;
            pauseStart = 0;
        }
        document.body.classList.toggle('paused', SR.paused);
        var elapsed = now - stateStart;

        ctx.clearRect(0, 0, W, H);

        // 3D camera orbit/tilt
        update3DCamera(now, dt);

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
                    // Takeoff zoom: start tight, pull back
                    var flightZoom = zoomForRoute(flight.from, flight.to);
                    var camZoom = flightZoom;
                    if (st.progress < 0.08) {
                        camZoom = flightZoom + (5.5 - flightZoom) * (1 - st.progress / 0.08);
                    }
                    // Landing zoom: push in toward destination
                    else if (st.progress > 0.92) {
                        camZoom = flightZoom + (5.2 - flightZoom) * ((st.progress - 0.92) / 0.08);
                    }

                    var leadProgress = Math.min(st.progress + Math.min(0.035, (1 - st.progress) * 0.5), 1);
                    var leadPos = SR.flightSystem.getHeadPosition(leadProgress);
                    if (!reducedMotion) moveCam(leadPos.lat, leadPos.lon, camZoom, dt);

                    // Day/night terminator
                    if (SR.effects) SR.effects.drawTerminator(ctx, map);

                    // City lights near departure (fading out) and arrival (fading in)
                    if (SR.effects && !reducedMotion) {
                        var depCityI = Math.max(0, 1 - st.progress / 0.12);
                        var arrCityI = Math.max(0, (st.progress - 0.88) / 0.12);
                        if (depCityI > 0.01)
                            SR.effects.drawCityLights(ctx, map, flight.arcPoints[0], flight.fromCode, depCityI, st.opacity);
                        if (arrCityI > 0.01)
                            SR.effects.drawCityLights(ctx, map, flight.arcPoints[flight.arcPoints.length - 1], flight.toCode, arrCityI, st.opacity);
                    }

                    // Aurora borealis
                    if (SR.effects && !reducedMotion && headPos.lat > 50)
                        SR.effects.drawAurora(ctx, map, headPos.lat, flight.color, st.opacity, now);
                }

                if (reducedMotion) drawStaticRoute(flight, 0.28);
                else SR.flightSystem.draw(ctx, map, now);

                // Phase label (DEPARTING / ARRIVING / LANDED)
                if (SR.effects && !reducedMotion) SR.effects.drawPhaseLabel(ctx, W, H, st.progress, st.opacity);

                if (!reducedMotion) updatePopup(now);
            } else {
                // Flight done → hold LANDED label briefly
                state = STATE.LANDED;
                stateStart = now;
            }
        }

        // ======== LANDED (hold for label + zoom) ========
        else if (state === STATE.LANDED) {
            drawStaticRoute(flight, 0.28);
            // Draw LANDED label
            if (SR.effects) {
                var landedAlpha = Math.min(1, elapsed / 400);
                if (elapsed > LANDED_DURATION - 800) landedAlpha = (LANDED_DURATION - elapsed) / 800;
                landedAlpha = Math.max(0, landedAlpha);
                ctx.save();
                ctx.font = '600 11px "SF Mono","Fira Code","Consolas",monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(100,255,180,' + (landedAlpha * 0.5) + ')';
                ctx.fillText('LANDED', W / 2, H * 0.88);
                ctx.restore();
            }
            // Zoom into destination
            var routeEnd = flight.arcPoints[flight.arcPoints.length - 1];
            if (!reducedMotion) moveCam(routeEnd.lat, routeEnd.lon, 5.5, dt);

            if (elapsed >= LANDED_DURATION) {
                if (SR.effects) {
                    SR.effects.addToHistory(flight);
                    SR.effects.fadeOutAudio();
                }
                fadeOutPopup();
                prevFlight = flight;
                prevFadeStart = now;
                flight = alignFlightToCamera(takeNext());
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
