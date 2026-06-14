const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
    window: {},
    document: {
        addEventListener() {},
        getElementById() { return null; }
    },
    navigator: {},
    console,
    setTimeout,
    clearTimeout
};
vm.createContext(context);

for (const file of ['airports.js', 'flights.js', 'effects.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const SR = context.window.SkyRoutes;

for (const route of SR.POPULAR_ROUTES) {
    assert(SR.AIRPORTS[route[0]], `Unknown origin: ${route[0]}`);
    assert(SR.AIRPORTS[route[1]], `Unknown destination: ${route[1]}`);
}

const undirected = new Set();
for (const route of SR.POPULAR_ROUTES) {
    const key = route.slice().sort().join('-');
    assert(!undirected.has(key), `Duplicate route: ${route.join('-')}`);
    undirected.add(key);
}

const transpacific = SR.flightSystem.computeArc(SR.AIRPORTS.LAX, SR.AIRPORTS.NRT);
for (let i = 1; i < transpacific.length; i++) {
    assert(
        Math.abs(transpacific[i].lon - transpacific[i - 1].lon) < 10,
        'Transpacific route contains a longitude jump'
    );
}

const endpoint = transpacific[transpacific.length - 1];
assert(Math.abs(endpoint.lat - SR.AIRPORTS.NRT.lat) < 0.001);
assert(Math.abs((((endpoint.lon - SR.AIRPORTS.NRT.lon) % 360) + 540) % 360 - 180) < 0.001);
assert(
    Math.abs(transpacific[0].lon - transpacific[transpacific.length - 1].lon) < 180,
    'Great-circle route must stay in one continuous world copy'
);

const india = SR.effects.getLocalTime(77, 28);
const nepal = SR.effects.getLocalTime(85, 28);
const toMinutes = value => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
};
assert.strictEqual((toMinutes(nepal) - toMinutes(india) + 1440) % 1440, 15);

const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
assert(!workflow.includes('OPENSKY_CLIENT_SECRET'), 'Deployment must not publish OpenSky secrets');

const api = fs.readFileSync('api.js', 'utf8');
assert(!api.includes('CLIENT_SECRET'), 'Browser API code must not contain client-secret handling');
assert(!api.includes('buildLiveRoutes'), 'Live aircraft must not be converted into invented routes');
assert(api.includes('alt !== null'), 'Zero altitude must not be replaced with a fake default');
assert(api.includes('speed !== null'), 'Zero speed must not be replaced with a fake default');

const app = fs.readFileSync('app.js', 'utf8');
assert(!app.includes('LIVE POSITION'), 'Cached aircraft positions must not be labelled live');
assert(app.includes('REPORTED POSITION'), 'Aircraft positions must be labelled as reported');
assert(app.includes('alignFlightToCamera'), 'Activated routes must align to the current world copy');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<button id="egg-btn"'), 'Tracker control must be keyboard accessible');
assert(html.includes('<button id="view-btn"'), '3D control must be keyboard accessible');
assert(!html.includes('clouds.js') && !html.includes('labels.js'), 'Dead modules must not be loaded');

console.log('All regression checks passed.');
