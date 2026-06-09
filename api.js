// ---- API integration with caching ----

(function() {
    var SR = window.SkyRoutes || {};
    var CACHE_KEY = 'skyroutes_cache_v2';
    var CACHE_TTL = 45 * 60 * 1000;

    SR.fetchRoutes = function() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                var cached = JSON.parse(raw);
                if (Date.now() - cached.ts < CACHE_TTL) {
                    console.log('[SkyRoutes] Using cached data');
                    return Promise.resolve(cached.routes);
                }
            }
        } catch (e) {}

        // OpenSky global — no bbox filter
        var url = 'https://opensky-network.org/api/states/all';
        console.log('[SkyRoutes] Fetching from OpenSky...');

        return fetch(url, { signal: AbortSignal.timeout(15000) })
            .then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function(data) {
                var count = data.states ? data.states.length : 0;
                console.log('[SkyRoutes] Got ' + count + ' aircraft globally');
                var routes = SR.POPULAR_ROUTES;
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), routes: routes }));
                } catch (e) {}
                return routes;
            })
            .catch(function(err) {
                console.log('[SkyRoutes] API fallback:', err.message);
                return SR.POPULAR_ROUTES;
            });
    };

    window.SkyRoutes = SR;
})();
