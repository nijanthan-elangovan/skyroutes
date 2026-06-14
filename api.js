// ---- OpenSky OAuth2 + live flight data ----

(function() {
    var SR = window.SkyRoutes || {};

    // OpenSky OAuth2 — credentials from injected script (_creds.js) or local JSON
    var CLIENT_ID = SR._cid || null;
    var CLIENT_SECRET = SR._cse || null;
    var TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
    var API_BASE = 'https://opensky-network.org/api';

    // If not injected, try loading from local credentails.json (dev only, gitignored)
    var credsLoaded = CLIENT_ID
        ? Promise.resolve()
        : fetch('credentails.json')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (d && d.clientId) {
                    CLIENT_ID = d.clientId;
                    CLIENT_SECRET = d.clientSecret;
                    console.log('[SkyRoutes] Credentials loaded from local file');
                }
            })
            .catch(function() {
                console.log('[SkyRoutes] No credentials — using fallback routes');
            });
    if (CLIENT_ID) console.log('[SkyRoutes] Credentials loaded from injected script');

    var CACHE_KEY = 'skyroutes_live_v3';
    var CACHE_TTL = 30 * 60 * 1000; // 30 min
    var TOKEN_KEY = 'skyroutes_token';

    // Known ICAO airline prefixes → full names
    var ICAO_AIRLINES = {
        'AIC':'Air India','IGO':'IndiGo','QTR':'Qatar Airways','UAE':'Emirates',
        'SIA':'Singapore Airlines','THA':'Thai Airways','DLH':'Lufthansa',
        'BAW':'British Airways','AFR':'Air France','KLM':'KLM','THY':'Turkish Airlines',
        'ETD':'Etihad','CPA':'Cathay Pacific','AAL':'American Airlines',
        'UAL':'United Airlines','DAL':'Delta','ANA':'All Nippon Airways',
        'JAL':'Japan Airlines','QFA':'Qantas','ANZ':'Air New Zealand',
        'SAA':'South African Airways','ETH':'Ethiopian Airlines','LAN':'LATAM',
        'AVA':'Avianca','ACA':'Air Canada','SAS':'SAS','FIN':'Finnair',
        'IBE':'Iberia','TAP':'TAP Portugal','AFL':'Aeroflot','KAL':'Korean Air',
        'AAR':'Asiana','SVA':'Saudia','GIA':'Garuda Indonesia','MAS':'Malaysia Airlines',
        'CCA':'Air China','CES':'China Eastern','CSN':'China Southern',
        'EVA':'EVA Air','CAL':'China Airlines','VIR':'Virgin Atlantic',
        'SWR':'Swiss','AUA':'Austrian','LOT':'LOT Polish','CSA':'Czech Airlines',
        'EIN':'Aer Lingus','TAM':'LATAM Brasil','GLO':'Gol Airlines'
    };
    var IATA_FROM_ICAO = {
        'AIC':'AI','IGO':'6E','QTR':'QR','UAE':'EK','SIA':'SQ','THA':'TG',
        'DLH':'LH','BAW':'BA','AFR':'AF','KLM':'KL','THY':'TK','ETD':'EY',
        'CPA':'CX','AAL':'AA','UAL':'UA','DAL':'DL','ANA':'NH','JAL':'JL',
        'QFA':'QF','ANZ':'NZ','SAA':'SA','ETH':'ET','LAN':'LA','AVA':'AV',
        'ACA':'AC','SAS':'SK','FIN':'AY','IBE':'IB','TAP':'TP','AFL':'SU',
        'KAL':'KE','AAR':'OZ','SVA':'SV','EVA':'BR','CAL':'CI','VIR':'VS',
        'SWR':'LX','AUA':'OS','MAS':'MH','GIA':'GA','CCA':'CA','CES':'MU',
        'CSN':'CZ'
    };

    // Find the nearest airport in our dataset to a lat/lon
    function nearestAirport(lat, lon) {
        var best = null, bestDist = Infinity;
        var airports = SR.AIRPORTS;
        for (var code in airports) {
            var ap = airports[code];
            var dLat = ap.lat - lat, dLon = ap.lon - lon;
            var d = dLat * dLat + dLon * dLon;
            if (d < bestDist) { bestDist = d; best = code; }
        }
        // Only match if within ~3 degrees (~300km)
        return bestDist < 9 ? best : null;
    }

    // Get OAuth2 token
    function getToken() {
        // Check cached token
        try {
            var raw = sessionStorage.getItem(TOKEN_KEY);
            if (raw) {
                var t = JSON.parse(raw);
                if (t.expires > Date.now()) return Promise.resolve(t.access_token);
            }
        } catch(e) {}

        var body = 'grant_type=client_credentials&client_id=' +
            encodeURIComponent(CLIENT_ID) + '&client_secret=' +
            encodeURIComponent(CLIENT_SECRET);

        return fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body,
            signal: AbortSignal.timeout(10000)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('Token request failed: ' + res.status);
            return res.json();
        })
        .then(function(data) {
            var token = data.access_token;
            try {
                sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
                    access_token: token,
                    expires: Date.now() + (data.expires_in - 60) * 1000
                }));
            } catch(e) {}
            console.log('[SkyRoutes] OAuth2 token acquired');
            return token;
        });
    }

    // Fetch live states from OpenSky
    function fetchStates(token) {
        var url = API_BASE + '/states/all';
        var headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        return fetch(url, {
            headers: headers,
            signal: AbortSignal.timeout(20000)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('States API: ' + res.status);
            return res.json();
        });
    }

    // Parse OpenSky states into flight objects
    function parseFlights(data) {
        if (!data.states || !data.states.length) return [];

        var flights = [];
        var seen = {}; // deduplicate by callsign

        for (var i = 0; i < data.states.length; i++) {
            var s = data.states[i];
            var callsign = (s[1] || '').trim();
            var country = s[2];
            var lon = s[5];
            var lat = s[6];
            var alt = s[7]; // geo altitude meters
            var speed = s[9]; // m/s
            var heading = s[10];
            var onGround = s[8];

            // Skip: no callsign, on ground, no position
            if (!callsign || onGround || lat === null || lon === null) continue;
            if (seen[callsign]) continue;
            seen[callsign] = true;

            // Extract airline ICAO prefix (first 3 chars of callsign)
            var airlineIcao = callsign.substring(0, 3);
            var airlineName = ICAO_AIRLINES[airlineIcao];
            if (!airlineName) continue; // skip unknown airlines

            var iataCode = IATA_FROM_ICAO[airlineIcao] || airlineIcao;
            var flightNum = callsign.substring(3).replace(/^0+/, '');

            // Find nearest departure/arrival airports based on position
            // We can't know exact route from states API, so find the nearest
            // airport to current position (as a "in transit near" indicator)
            var nearCode = nearestAirport(lat, lon);

            flights.push({
                callsign: callsign,
                flightName: iataCode + ' ' + flightNum,
                airlineName: airlineName,
                lat: lat,
                lon: lon,
                altitude: alt ? Math.round(alt * 3.281) : 35000, // m → ft
                speed: speed ? Math.round(speed * 1.944) : 480, // m/s → kts
                heading: heading || 0,
                nearAirport: nearCode,
                country: country
            });
        }

        return flights;
    }

    // Build route pairs from live flights:
    // Pick random pairs of airports that have nearby active flights
    function buildLiveRoutes(flights) {
        // Collect airports with nearby flights
        var activeAirports = {};
        for (var i = 0; i < flights.length; i++) {
            var f = flights[i];
            if (f.nearAirport) activeAirports[f.nearAirport] = true;
        }

        var codes = Object.keys(activeAirports);
        if (codes.length < 2) return [];

        // Build route pairs from airports with active traffic
        var routes = [];
        for (var i = 0; i < codes.length; i++) {
            for (var j = i + 1; j < codes.length; j++) {
                if (SR.getAirport(codes[i]) && SR.getAirport(codes[j])) {
                    routes.push([codes[i], codes[j]]);
                }
            }
        }
        return routes;
    }

    // ---- Store live flights for the popup to use real data ----
    SR.liveFlights = [];

    // Get a real flight near a given airport code
    SR.getRealFlight = function(airportCode) {
        if (!SR.liveFlights.length) return null;
        // Find flights near this airport
        var ap = SR.getAirport(airportCode);
        if (!ap) return null;

        var best = null, bestDist = Infinity;
        for (var i = 0; i < SR.liveFlights.length; i++) {
            var f = SR.liveFlights[i];
            var dLat = f.lat - ap.lat, dLon = f.lon - ap.lon;
            var d = dLat * dLat + dLon * dLon;
            if (d < bestDist) { bestDist = d; best = f; }
        }
        return bestDist < 25 ? best : null; // within ~5 degrees
    };

    // ---- Main fetch function ----
    SR.fetchRoutes = function() {
        // Wait for credentials to load first
        return credsLoaded.then(function() {
        // Check cache
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                var cached = JSON.parse(raw);
                if (Date.now() - cached.ts < CACHE_TTL) {
                    console.log('[SkyRoutes] Using cached live data (' + cached.flightCount + ' flights)');
                    SR.liveFlights = cached.flights || [];
                    if (cached.routes && cached.routes.length > 5) {
                        return Promise.resolve(cached.routes);
                    }
                }
            }
        } catch(e) {}

        // No credentials? Skip API, use fallback
        if (!CLIENT_ID || !CLIENT_SECRET) {
            console.log('[SkyRoutes] No credentials — using curated routes');
            return SR.POPULAR_ROUTES;
        }

        console.log('[SkyRoutes] Fetching live data from OpenSky...');

        return getToken()
            .then(function(token) {
                return fetchStates(token);
            })
            .then(function(data) {
                var flights = parseFlights(data);
                console.log('[SkyRoutes] Parsed ' + flights.length + ' known-airline flights');

                SR.liveFlights = flights;

                var liveRoutes = buildLiveRoutes(flights);
                console.log('[SkyRoutes] Built ' + liveRoutes.length + ' live route pairs');

                var allRoutes = liveRoutes.concat(SR.POPULAR_ROUTES);

                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        ts: Date.now(),
                        routes: allRoutes,
                        flights: flights.slice(0, 200),
                        flightCount: flights.length
                    }));
                } catch(e) {}

                return allRoutes;
            })
            .catch(function(err) {
                console.log('[SkyRoutes] API error, using fallback:', err.message);
                return SR.POPULAR_ROUTES;
            });
        }); // end credsLoaded.then
    };

    window.SkyRoutes = SR;
})();
