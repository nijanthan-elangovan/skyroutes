// ---- Global airport data and routes ----

var SkyRoutes = window.SkyRoutes || {};

SkyRoutes.AIRPORTS = {
    // --- India ---
    BOM: { name: 'Mumbai',       lat: 19.0896, lon: 72.8656  },
    DEL: { name: 'Delhi',        lat: 28.5562, lon: 77.1000  },
    BLR: { name: 'Bengaluru',    lat: 13.1986, lon: 77.7066  },
    MAA: { name: 'Chennai',      lat: 12.9941, lon: 80.1709  },
    HYD: { name: 'Hyderabad',    lat: 17.2403, lon: 78.4294  },
    CCU: { name: 'Kolkata',      lat: 22.6547, lon: 88.4467  },
    COK: { name: 'Kochi',        lat: 10.1520, lon: 76.4019  },

    // --- Middle East ---
    DXB: { name: 'Dubai',        lat: 25.2532, lon: 55.3657  },
    DOH: { name: 'Doha',         lat: 25.2731, lon: 51.6081  },
    AUH: { name: 'Abu Dhabi',    lat: 24.4330, lon: 54.6511  },
    RUH: { name: 'Riyadh',       lat: 24.9576, lon: 46.6988  },
    IST: { name: 'Istanbul',     lat: 41.2753, lon: 28.7519  },
    TLV: { name: 'Tel Aviv',     lat: 32.0114, lon: 34.8867  },

    // --- Europe ---
    LHR: { name: 'London',       lat: 51.4700, lon: -0.4543  },
    CDG: { name: 'Paris',        lat: 49.0097, lon: 2.5479   },
    FRA: { name: 'Frankfurt',    lat: 50.0379, lon: 8.5622   },
    AMS: { name: 'Amsterdam',    lat: 52.3105, lon: 4.7683   },
    ZRH: { name: 'Zurich',       lat: 47.4647, lon: 8.5492   },
    MUC: { name: 'Munich',       lat: 48.3537, lon: 11.7750  },
    FCO: { name: 'Rome',         lat: 41.8003, lon: 12.2389  },
    MAD: { name: 'Madrid',       lat: 40.4983, lon: -3.5676  },
    BCN: { name: 'Barcelona',    lat: 41.2971, lon: 2.0785   },
    ARN: { name: 'Stockholm',    lat: 59.6519, lon: 17.9186  },
    CPH: { name: 'Copenhagen',   lat: 55.6180, lon: 12.6508  },
    OSL: { name: 'Oslo',         lat: 60.1976, lon: 11.1004  },
    HEL: { name: 'Helsinki',     lat: 60.3172, lon: 24.9633  },
    ATH: { name: 'Athens',       lat: 37.9364, lon: 23.9445  },
    LIS: { name: 'Lisbon',       lat: 38.7813, lon: -9.1359  },
    DUB: { name: 'Dublin',       lat: 53.4264, lon: -6.2499  },

    // --- Asia ---
    NRT: { name: 'Tokyo',        lat: 35.7647, lon: 140.3864 },
    HND: { name: 'Haneda',       lat: 35.5494, lon: 139.7798 },
    PEK: { name: 'Beijing',      lat: 40.0799, lon: 116.6031 },
    PVG: { name: 'Shanghai',     lat: 31.1443, lon: 121.8083 },
    HKG: { name: 'Hong Kong',    lat: 22.3080, lon: 113.9185 },
    ICN: { name: 'Seoul',        lat: 37.4602, lon: 126.4407 },
    SIN: { name: 'Singapore',    lat: 1.3502,  lon: 103.9944 },
    BKK: { name: 'Bangkok',      lat: 13.6900, lon: 100.7501 },
    KUL: { name: 'Kuala Lumpur', lat: 2.7456,  lon: 101.7099 },
    TPE: { name: 'Taipei',       lat: 25.0797, lon: 121.2342 },
    MNL: { name: 'Manila',       lat: 14.5086, lon: 121.0197 },
    SGN: { name: 'Ho Chi Minh',  lat: 10.8188, lon: 106.6520 },
    HAN: { name: 'Hanoi',        lat: 21.2212, lon: 105.8070 },
    CMB: { name: 'Colombo',      lat: 7.1824,  lon: 79.8841  },
    KTM: { name: 'Kathmandu',    lat: 27.6966, lon: 85.3591  },
    DAC: { name: 'Dhaka',        lat: 23.8432, lon: 90.3978  },

    // --- North America ---
    JFK: { name: 'New York',     lat: 40.6413, lon: -73.7781 },
    LAX: { name: 'Los Angeles',  lat: 33.9425, lon: -118.4081},
    SFO: { name: 'San Francisco',lat: 37.6213, lon: -122.3790},
    ORD: { name: 'Chicago',      lat: 41.9742, lon: -87.9073 },
    ATL: { name: 'Atlanta',      lat: 33.6407, lon: -84.4277 },
    MIA: { name: 'Miami',        lat: 25.7959, lon: -80.2870 },
    DFW: { name: 'Dallas',       lat: 32.8998, lon: -97.0403 },
    YYZ: { name: 'Toronto',      lat: 43.6777, lon: -79.6248 },
    YVR: { name: 'Vancouver',    lat: 49.1967, lon: -123.1815},
    MEX: { name: 'Mexico City',  lat: 19.4363, lon: -99.0721 },

    // --- South America ---
    GRU: { name: 'Sao Paulo',    lat: -23.4356,lon: -46.4731 },
    EZE: { name: 'Buenos Aires', lat: -34.8222,lon: -58.5358 },
    BOG: { name: 'Bogota',       lat: 4.7016,  lon: -74.1469 },
    SCL: { name: 'Santiago',     lat: -33.3930,lon: -70.7858 },
    LIM: { name: 'Lima',         lat: -12.0219,lon: -77.1143 },

    // --- Africa ---
    JNB: { name: 'Johannesburg', lat: -26.1392,lon: 28.2460  },
    NBO: { name: 'Nairobi',      lat: -1.3192, lon: 36.9278  },
    CAI: { name: 'Cairo',        lat: 30.1219, lon: 31.4056  },
    ADD: { name: 'Addis Ababa',  lat: 8.9779,  lon: 38.7993  },
    CMN: { name: 'Casablanca',   lat: 33.3675, lon: -7.5898  },
    LOS: { name: 'Lagos',        lat: 6.5774,  lon: 3.3212   },
    CPT: { name: 'Cape Town',    lat: -33.9649,lon: 18.6017  },

    // --- Oceania ---
    SYD: { name: 'Sydney',       lat: -33.9461,lon: 151.1772 },
    MEL: { name: 'Melbourne',    lat: -37.6690,lon: 144.8410 },
    AKL: { name: 'Auckland',     lat: -37.0082,lon: 174.7850 }
};

// --- Global routes (diverse, all continents) ---
SkyRoutes.POPULAR_ROUTES = [
    // Transatlantic
    ['JFK','LHR'],['JFK','CDG'],['JFK','FRA'],['JFK','AMS'],
    ['ATL','FCO'],['MIA','MAD'],['ORD','DUB'],['LAX','LHR'],
    ['YYZ','LHR'],['SFO','FRA'],['DFW','LHR'],['JFK','BCN'],
    ['MIA','LIS'],['LAX','CDG'],['JFK','ARN'],

    // Transpacific
    ['LAX','NRT'],['SFO','HND'],['LAX','PVG'],['LAX','SIN'],
    ['SFO','ICN'],['LAX','HKG'],['YVR','NRT'],['SFO','TPE'],
    ['LAX','SYD'],['SFO','MNL'],

    // Europe ↔ Asia
    ['LHR','SIN'],['LHR','HKG'],['LHR','NRT'],['CDG','PVG'],
    ['FRA','PEK'],['AMS','ICN'],['LHR','BKK'],['FRA','SIN'],
    ['CDG','NRT'],['ZRH','HKG'],['MUC','PVG'],['LHR','BOM'],
    ['FRA','DEL'],['CDG','BLR'],['LHR','DEL'],['AMS','BOM'],

    // India routes
    ['BOM','DXB'],['BOM','SIN'],['BOM','NRT'],
    ['BOM','SFO'],['BOM','JFK'],['DEL','DXB'],['DEL','SIN'],
    ['DEL','YYZ'],['BLR','SIN'],['BLR','FRA'],
    ['MAA','SIN'],['MAA','KUL'],['HYD','DXB'],['CCU','BKK'],
    ['COK','DOH'],['DEL','BKK'],['BOM','IST'],['DEL','ICN'],

    // Middle East hub
    ['DXB','LHR'],['DXB','SIN'],['DXB','SYD'],['DXB','JFK'],
    ['DXB','NRT'],['DXB','GRU'],['DOH','LHR'],['DOH','SIN'],
    ['DOH','SYD'],['IST','JFK'],['IST','SIN'],['AUH','LHR'],

    // Africa
    ['JNB','LHR'],['JNB','DXB'],['NBO','LHR'],['NBO','DXB'],
    ['CAI','LHR'],['CAI','FRA'],['ADD','DXB'],['LOS','LHR'],
    ['CMN','CDG'],['CPT','DXB'],['JNB','SIN'],['CAI','IST'],

    // South America
    ['GRU','LHR'],['GRU','CDG'],['GRU','JFK'],['GRU','MIA'],
    ['EZE','MAD'],['EZE','MIA'],['BOG','MIA'],['SCL','MAD'],
    ['LIM','MIA'],['GRU','FRA'],['EZE','FCO'],['BOG','JFK'],

    // Intra-Asia
    ['SIN','NRT'],['SIN','ICN'],['SIN','SYD'],['HKG','NRT'],
    ['BKK','NRT'],['BKK','ICN'],['ICN','HKG'],['PVG','SIN'],
    ['MNL','NRT'],['SGN','ICN'],['KUL','NRT'],['HAN','ICN'],
    ['TPE','SIN'],['HKG','SYD'],['BKK','SYD'],['PEK','SIN'],

    // Oceania
    ['MEL','SIN'],['AKL','SYD'],
    ['SYD','NRT'],['MEL','HKG'],['AKL','LAX'],

    // Cross-continental
    ['JNB','SYD'],['CAI','BOM'],['IST','PEK'],['ARN','NRT'],
    ['CPH','JFK'],['HEL','NRT'],['OSL','JFK'],['ATH','DXB'],
    ['DUB','JFK'],['LIS','GRU'],['MAD','MEX'],
    ['MEX','CDG'],['YVR','SYD']
];

SkyRoutes.getAirport = function(code) {
    return SkyRoutes.AIRPORTS[code] || null;
};

SkyRoutes.addAirportMarkers = function(map) {
    var markers = {};
    for (var code in SkyRoutes.AIRPORTS) {
        var ap = SkyRoutes.AIRPORTS[code];
        var icon = L.divIcon({
            className: 'airport-marker',
            html: '<div class="airport-dot"></div>' +
                  '<div class="airport-name">' + code + '</div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        markers[code] = L.marker([ap.lat, ap.lon], { icon: icon, interactive: false }).addTo(map);
    }
    return markers;
};

window.SkyRoutes = SkyRoutes;
