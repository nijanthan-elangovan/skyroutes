// ---- OpenSky anonymous live aircraft data ----

(function() {
    var SR = window.SkyRoutes || {};

    var API_BASE = 'https://opensky-network.org/api';

    var CACHE_KEY = 'skyroutes_live_v4';
    var CACHE_TTL = 30 * 60 * 1000; // 30 min

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
            var dLat = (ap.lat - lat) * Math.PI / 180;
            var dLon = (ap.lon - lon) * Math.PI / 180;
            var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(ap.lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            var d = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (d < bestDist) { bestDist = d; best = code; }
        }
        return bestDist < 300 ? best : null;
    }

    // Fetch live states from OpenSky
    function fetchStates() {
        var url = API_BASE + '/states/all';
        var options = {};
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
            options.signal = AbortSignal.timeout(20000);
        }
        return fetch(url, options)
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
            var lastContact = s[4];

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
                altitude: alt !== null ? Math.round(alt * 3.281) : null, // m → ft
                speed: speed !== null ? Math.round(speed * 1.944) : null, // m/s → kts
                heading: heading !== null ? heading : null,
                lastContact: lastContact || null,
                nearAirport: nearCode,
                country: country
            });
        }

        return flights;
    }

    // Live states are used only for explicit aircraft search. They do not
    // contain origin/destination data, so they must not decorate route demos.
    SR.liveFlights = [];

    // ---- Main fetch function ----
    SR.fetchRoutes = function() {
        // Check cache
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                var cached = JSON.parse(raw);
                if (Date.now() - cached.ts < CACHE_TTL) {
                    console.log('[SkyRoutes] Using cached live data (' + cached.flightCount + ' flights)');
                    SR.liveFlights = cached.flights || [];
                    return Promise.resolve(SR.POPULAR_ROUTES);
                }
            }
        } catch(e) {}

        console.log('[SkyRoutes] Fetching anonymous live data from OpenSky...');

        return fetchStates()
            .then(function(data) {
                var flights = parseFlights(data);
                console.log('[SkyRoutes] Parsed ' + flights.length + ' known-airline flights');

                SR.liveFlights = flights;

                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        ts: Date.now(),
                        flights: flights,
                        flightCount: flights.length
                    }));
                } catch(e) {}

                return SR.POPULAR_ROUTES;
            })
            .catch(function(err) {
                console.log('[SkyRoutes] API error, using fallback:', err.message);
                return SR.POPULAR_ROUTES;
            });
    };

    window.SkyRoutes = SR;
})();
