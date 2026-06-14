// ---- effects.js: audio, weather, terminator, aurora, city lights, turbulence, history ----

(function() {
    var SR = window.SkyRoutes || {};

    // ==============================================
    // 1. AMBIENT AUDIO (Web Audio API)
    // ==============================================
    var audioCtx = null;
    var engineNode = null;
    var windNode = null;
    var masterGain = null;
    var engineGain = null;
    var windGain = null;
    var audioStarted = false;

    function initAudio() {
        if (audioStarted) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.12; // very quiet
            masterGain.connect(audioCtx.destination);

            // Engine: filtered noise
            engineGain = audioCtx.createGain();
            engineGain.gain.value = 0;
            engineGain.connect(masterGain);

            var engineBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
            var d = engineBuf.getChannelData(0);
            for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            engineNode = audioCtx.createBufferSource();
            engineNode.buffer = engineBuf;
            engineNode.loop = true;
            var engineFilter = audioCtx.createBiquadFilter();
            engineFilter.type = 'lowpass';
            engineFilter.frequency.value = 120;
            engineFilter.Q.value = 2;
            engineNode.connect(engineFilter);
            engineFilter.connect(engineGain);
            engineNode.start();

            // Wind: higher filtered noise
            windGain = audioCtx.createGain();
            windGain.gain.value = 0;
            windGain.connect(masterGain);

            var windBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
            var w = windBuf.getChannelData(0);
            for (var i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
            windNode = audioCtx.createBufferSource();
            windNode.buffer = windBuf;
            windNode.loop = true;
            var windFilter = audioCtx.createBiquadFilter();
            windFilter.type = 'bandpass';
            windFilter.frequency.value = 800;
            windFilter.Q.value = 0.3;
            windNode.connect(windFilter);
            windFilter.connect(windGain);
            windNode.start();

            audioStarted = true;
        } catch (e) {}
    }

    // Start audio on first user interaction
    document.addEventListener('click', function() { initAudio(); }, { once: true });
    document.addEventListener('keydown', function() { initAudio(); }, { once: true });

    SR.effects = {
        // Update audio based on flight state
        updateAudio: function(progress, speed, altitude) {
            if (!audioStarted || !audioCtx) return;
            // Engine: louder during takeoff/landing, quieter during cruise
            var engVol;
            if (progress < 0.1) engVol = progress / 0.1;
            else if (progress > 0.9) engVol = (1 - progress) / 0.1;
            else engVol = 0.5 + Math.sin(progress * 6) * 0.05;
            engineGain.gain.value = Math.max(0, engVol * 0.8);

            // Wind: proportional to speed
            var windVol = Math.min(1, speed / 550) * 0.4;
            windGain.gain.value = windVol;
        },

        fadeOutAudio: function() {
            if (!audioStarted || !masterGain) return;
            masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);
            setTimeout(function() {
                if (masterGain) masterGain.gain.value = 0.12;
            }, 2000);
        },

        // ==============================================
        // 2. DAY/NIGHT TERMINATOR
        // ==============================================
        drawTerminator: function(ctx, map, W, H, now) {
            var d = new Date(now);
            // Solar declination (approximate)
            var dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
            var declination = -23.45 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
            // Solar hour angle
            var utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;
            var solarNoonLon = (12 - utcHours) * 15;

            ctx.save();
            ctx.beginPath();
            // Draw the night side as a filled polygon
            var points = [];
            for (var lon = -180; lon <= 180; lon += 3) {
                // Latitude where terminator crosses at this longitude
                var hourAngle = (lon - solarNoonLon) * Math.PI / 180;
                var decRad = declination * Math.PI / 180;
                var termLat = Math.atan(-Math.cos(hourAngle) / Math.tan(decRad)) * 180 / Math.PI;
                var p = map.latLngToContainerPoint(L.latLng(termLat, lon));
                points.push(p);
            }

            // Fill from terminator to the bottom (night side depends on season)
            var nightSide = declination >= 0 ? -90 : 90;
            ctx.moveTo(points[0].x, points[0].y);
            for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            // Close along the bottom/top edge
            var corner1 = map.latLngToContainerPoint(L.latLng(nightSide, 180));
            var corner2 = map.latLngToContainerPoint(L.latLng(nightSide, -180));
            ctx.lineTo(corner1.x, corner1.y);
            ctx.lineTo(corner2.x, corner2.y);
            ctx.closePath();
            ctx.fillStyle = 'rgba(0,0,10,0.25)';
            ctx.fill();
            ctx.restore();
        },

        // ==============================================
        // 3. TIMEZONE CLOCK (proper fractional offsets)
        // ==============================================
        getLocalTime: function(lon, lat) {
            // Use Intl API if available for accurate timezone
            try {
                // Find timezone by coordinates using a lookup table for known offsets
                // India (+5:30), Nepal (+5:45), Iran (+3:30), Newfoundland (-3:30),
                // Afghanistan (+4:30), Myanmar (+6:30), Marquesas (-9:30),
                // Chatham Islands (+12:45)
                var offsetMin;
                // Check known fractional-offset regions by lat/lon bounds
                if (lat > 6 && lat < 36 && lon > 68 && lon < 98) offsetMin = 330; // India/Sri Lanka +5:30
                else if (lat > 26 && lat < 31 && lon > 80 && lon < 89) offsetMin = 345; // Nepal +5:45
                else if (lat > 24 && lat < 40 && lon > 44 && lon < 64) offsetMin = 210; // Iran +3:30
                else if (lat > 29 && lat < 39 && lon > 60 && lon < 75) offsetMin = 270; // Afghanistan +4:30
                else if (lat > 10 && lat < 29 && lon > 92 && lon < 102) offsetMin = 390; // Myanmar +6:30
                else if (lat > 44 && lat < 53 && lon > -60 && lon < -52) offsetMin = -210; // Newfoundland -3:30
                else if (lat > -45 && lat < -43 && lon > -177 && lon < -176) offsetMin = 765; // Chatham +12:45
                else offsetMin = Math.round(lon / 15) * 60; // standard whole-hour

                var d = new Date();
                var utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
                var local = new Date(utcMs + offsetMin * 60000);
                var h = local.getHours();
                var m = local.getMinutes();
                return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
            } catch(e) {
                return '--:--';
            }
        },

        // ==============================================
        // 4. NORTHERN LIGHTS (aurora borealis)
        // ==============================================
        drawAurora: function(ctx, map, headLat, color, alpha, now) {
            if (headLat < 52) return; // only above 52°N
            var intensity = Math.min(1, (headLat - 52) / 15) * alpha;
            if (intensity < 0.01) return;

            var t = now * 0.0003;
            // Draw shimmering curtains across the top
            for (var i = 0; i < 5; i++) {
                var lat = 60 + i * 3 + Math.sin(t + i * 2) * 2;
                var points = [];
                for (var lon = -60; lon <= 60; lon += 5) {
                    var wave = Math.sin(lon * 0.05 + t + i) * 3;
                    var p = map.latLngToContainerPoint(L.latLng(lat + wave, lon));
                    points.push(p);
                }
                if (points.length < 2) continue;

                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (var j = 1; j < points.length; j++) ctx.lineTo(points[j].x, points[j].y);

                var shimmer = 0.5 + 0.5 * Math.sin(t * 2 + i * 1.5);
                var h = 140 + i * 15; // green to cyan
                ctx.strokeStyle = 'hsla(' + h + ',70%,55%,' + (intensity * shimmer * 0.12) + ')';
                ctx.lineWidth = 8 + Math.sin(t + i) * 4;
                ctx.lineCap = 'round';
                ctx.filter = 'blur(4px)';
                ctx.stroke();
            }
            ctx.filter = 'none';
        },

        // ==============================================
        // 5. CITY LIGHTS near airports
        // ==============================================
        _cityLightsCache: {},
        drawCityLights: function(ctx, map, airport, code, intensity, alpha) {
            if (intensity < 0.01) return;
            // Generate random light positions once per airport
            if (!this._cityLightsCache[code]) {
                var lights = [];
                for (var i = 0; i < 30; i++) {
                    lights.push({
                        dLat: (Math.random() - 0.5) * 0.8,
                        dLon: (Math.random() - 0.5) * 0.8,
                        size: 0.5 + Math.random() * 1,
                        brightness: 0.3 + Math.random() * 0.7
                    });
                }
                this._cityLightsCache[code] = lights;
            }
            var lights = this._cityLightsCache[code];
            for (var i = 0; i < lights.length; i++) {
                var l = lights[i];
                var p = map.latLngToContainerPoint(
                    L.latLng(airport.lat + l.dLat, airport.lon + l.dLon)
                );
                ctx.beginPath();
                ctx.arc(p.x, p.y, l.size, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,220,150,' + (intensity * l.brightness * alpha * 0.2) + ')';
                ctx.fill();
            }
        },

        // ==============================================
        // 6. TURBULENCE
        // ==============================================
        _turbZones: null,
        initTurbulence: function(arcPointsLength) {
            // Random zones along the route
            this._turbZones = [];
            var count = 1 + Math.floor(Math.random() * 2);
            for (var i = 0; i < count; i++) {
                this._turbZones.push({
                    start: 0.2 + Math.random() * 0.5,
                    length: 0.03 + Math.random() * 0.05,
                    severity: Math.random() < 0.7 ? 'LIGHT' : 'MODERATE'
                });
            }
        },

        getTurbulence: function(progress) {
            if (!this._turbZones) return null;
            for (var i = 0; i < this._turbZones.length; i++) {
                var z = this._turbZones[i];
                if (progress >= z.start && progress <= z.start + z.length) {
                    return z;
                }
            }
            return null;
        },

        // Apply turbulence shake to a screen point
        applyTurbulenceShake: function(px, py, now, severity) {
            var amp = severity === 'MODERATE' ? 3 : 1.5;
            var freq = severity === 'MODERATE' ? 0.03 : 0.02;
            return {
                x: px + Math.sin(now * freq) * amp + Math.sin(now * freq * 1.7) * amp * 0.5,
                y: py + Math.cos(now * freq * 1.3) * amp * 0.7
            };
        },

        // ==============================================
        // 7. FLIGHT HISTORY RIBBON
        // ==============================================
        _history: [],
        MAX_HISTORY: 10,

        addToHistory: function(fl) {
            this._history.push({
                fromCode: fl.fromCode,
                toCode: fl.toCode,
                color: fl.color,
                airline: fl.airlineName,
                flightName: fl.flightName
            });
            if (this._history.length > this.MAX_HISTORY) this._history.shift();
            this.renderHistoryRibbon();
        },

        renderHistoryRibbon: function() {
            var container = document.getElementById('history-ribbon');
            if (!container) return;
            container.innerHTML = '';
            for (var i = 0; i < this._history.length; i++) {
                var h = this._history[i];
                var c = h.color;
                var el = document.createElement('div');
                el.className = 'hr-item';
                el.innerHTML =
                    '<div class="hr-arc" style="color:hsl(' + c.h + ',' + c.s + '%,' + c.l + '%)">⌒</div>' +
                    '<div class="hr-route">' + h.fromCode + '→' + h.toCode + '</div>';
                container.appendChild(el);
            }
        },

        // ==============================================
        // 8. TAKEOFF / LANDING LABELS
        // ==============================================
        drawPhaseLabel: function(ctx, W, H, progress, alpha) {
            if (alpha < 0.01) return;
            var label = null;
            var labelAlpha = 0;

            if (progress < 0.06) {
                label = 'DEPARTING';
                labelAlpha = Math.min(1, progress / 0.03) * (1 - progress / 0.06);
            } else if (progress > 0.93) {
                label = 'ARRIVING';
                labelAlpha = Math.min(1, (progress - 0.93) / 0.04);
            }
            // LANDED is drawn by the LANDED state in app.js

            if (!label) return;

            ctx.save();
            ctx.font = '600 10px "SF Mono","Fira Code","Consolas",monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.letterSpacing = '3px';
            ctx.fillStyle = 'rgba(255,255,255,' + (labelAlpha * alpha * 0.4) + ')';
            ctx.fillText(label, W / 2, H * 0.88);
            ctx.restore();
        }
    };

    // ==============================================
    // 9. KEYBOARD SHORTCUTS
    // ==============================================
    document.addEventListener('keydown', function(e) {
        var key = e.key.toLowerCase();
        if (e.target.tagName === 'INPUT') return; // don't intercept form inputs

        if (key === ' ' || key === 'spacebar') {
            e.preventDefault();
            // Toggle pause (handled in app.js via SR.paused)
            SR.paused = !SR.paused;
        }
        else if (key === 'n') {
            // Next flight (handled in app.js)
            if (SR.skipToNext) SR.skipToNext();
        }
        else if (key === 'f') {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen().catch(function() {});
        }
        else if (key === '3') {
            var btn = document.getElementById('view-btn');
            if (btn) btn.click();
        }
    });

    SR.paused = false;

    window.SkyRoutes = SR;
})();
