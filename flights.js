// ---- Single flight system: smooth trail, proper bearing ----

(function() {
    var SR = window.SkyRoutes || {};
    var ARC_POINTS = 120;
    var MIN_DURATION = 10000;
    var MAX_DURATION = 40000;
    var LONG_HAUL_BONUS = 25000;

    var PALETTE = [
        { h: 200, s: 70, l: 60 },
        { h: 260, s: 55, l: 65 },
        { h: 330, s: 50, l: 60 },
        { h: 35,  s: 60, l: 55 },
        { h: 160, s: 50, l: 55 },
        { h: 280, s: 45, l: 60 },
        { h: 15,  s: 55, l: 58 },
        { h: 180, s: 40, l: 55 },
        { h: 45,  s: 65, l: 58 },
        { h: 300, s: 40, l: 58 },
    ];

    var AIRLINE_NAMES = {
        'AI':'Air India','6E':'IndiGo','QR':'Qatar Airways','EK':'Emirates',
        'SQ':'Singapore Airlines','TG':'Thai Airways','LH':'Lufthansa',
        'BA':'British Airways','AF':'Air France','KL':'KLM Royal Dutch',
        'TK':'Turkish Airlines','EY':'Etihad Airways','CX':'Cathay Pacific',
        'AA':'American Airlines','UA':'United Airlines','DL':'Delta Air Lines',
        'NH':'All Nippon Airways','JL':'Japan Airlines','QF':'Qantas',
        'NZ':'Air New Zealand','SA':'South African Airways','ET':'Ethiopian Airlines',
        'LA':'LATAM Airlines','AV':'Avianca','AC':'Air Canada',
        'SK':'SAS Scandinavian','AY':'Finnair','IB':'Iberia',
        'TP':'TAP Portugal','SU':'Aeroflot','KE':'Korean Air','OZ':'Asiana Airlines'
    };
    var AIRLINE_CODES = Object.keys(AIRLINE_NAMES);

    function randomFlight() {
        var code = AIRLINE_CODES[Math.floor(Math.random()*AIRLINE_CODES.length)];
        return { code:code, number:code+' '+(100+Math.floor(Math.random()*900)), airline:AIRLINE_NAMES[code] };
    }

    function haversineKm(a,b) {
        var R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lon-a.lon)*Math.PI/180;
        var x=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
    }

    function durationForDistance(km) {
        var t=Math.max(0,Math.min(1,(km-500)/16000));
        return MIN_DURATION+t*(MAX_DURATION-MIN_DURATION)+t*t*LONG_HAUL_BONUS;
    }

    function computeArc(from,to) {
        var pts=[], midLat=(from.lat+to.lat)/2, midLon=(from.lon+to.lon)/2;
        var dLat=to.lat-from.lat, dLon=to.lon-from.lon;
        var dist=Math.sqrt(dLat*dLat+dLon*dLon);
        var pLat=-dLon,pLon=dLat,pLen=Math.sqrt(pLat*pLat+pLon*pLon);
        if(pLen>0){pLat/=pLen;pLon/=pLen;}
        var ch=Math.min(dist*0.28,18);
        var cLat=midLat+pLat*ch, cLon=midLon+pLon*ch;
        for(var i=0;i<=ARC_POINTS;i++){
            var t=i/ARC_POINTS, u=1-t;
            pts.push({lat:u*u*from.lat+2*u*t*cLat+t*t*to.lat, lon:u*u*from.lon+2*u*t*cLon+t*t*to.lon});
        }
        return pts;
    }

    function screenAngle(map,p1,p2) {
        var a=map.latLngToContainerPoint(L.latLng(p1.lat,p1.lon));
        var b=map.latLngToContainerPoint(L.latLng(p2.lat,p2.lon));
        return Math.atan2(b.y-a.y, b.x-a.x);
    }

    // ---- Sub-pixel interpolation: get exact lat/lon between two arc points ----
    function lerpPt(pts, exactIdx) {
        var i = Math.floor(exactIdx);
        var frac = exactIdx - i;
        i = Math.max(0, Math.min(i, pts.length - 1));
        var j = Math.min(i + 1, pts.length - 1);
        return {
            lat: pts[i].lat + (pts[j].lat - pts[i].lat) * frac,
            lon: pts[i].lon + (pts[j].lon - pts[i].lon) * frac
        };
    }

    // Smoothed screen angle using interpolated points
    function smoothScreenAngle(map, pts, exactIdx) {
        var behind = lerpPt(pts, Math.max(0, exactIdx - 2));
        var ahead  = lerpPt(pts, Math.min(pts.length - 1, exactIdx + 2));
        return screenAngle(map, behind, ahead);
    }

    // Smoothed angle tracking to prevent jitter on direction changes
    var _prevAngle = null;
    function smoothAngle(newAngle) {
        if (_prevAngle === null) { _prevAngle = newAngle; return newAngle; }
        // Handle angle wrapping
        var diff = newAngle - _prevAngle;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        _prevAngle += diff * 0.12; // low-pass filter
        return _prevAngle;
    }

    function drawAirportBeacon(ctx,map,airport,color,intensity,now) {
        if(intensity<=0) return;
        var p=map.latLngToContainerPoint(L.latLng(airport.lat,airport.lon));
        var h=color.h,s=color.s,l=color.l;

        for(var i=0;i<3;i++){
            var phase=((now/1800)+(i/3))%1;
            var radius=5+phase*28;
            var ringAlpha=intensity*(1-phase)*0.35;
            ctx.beginPath();
            ctx.arc(p.x,p.y,radius,0,Math.PI*2);
            ctx.strokeStyle='hsla('+h+','+(s+10)+'%,'+(l+15)+'%,'+ringAlpha+')';
            ctx.lineWidth=1.2;
            ctx.stroke();
        }

        var glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,12);
        glow.addColorStop(0,'hsla('+h+','+(s+10)+'%,'+(l+20)+'%,'+(intensity*0.5)+')');
        glow.addColorStop(1,'hsla('+h+','+s+'%,'+l+'%,0)');
        ctx.beginPath();
        ctx.arc(p.x,p.y,12,0,Math.PI*2);
        ctx.fillStyle=glow;
        ctx.fill();
    }

    function drawAirportShockwave(ctx,map,airport,color,phase) {
        if(phase<0||phase>1) return;
        var p=map.latLngToContainerPoint(L.latLng(airport.lat,airport.lon));
        var eased=1-Math.pow(1-phase,3);
        ctx.beginPath();
        ctx.arc(p.x,p.y,8+eased*55,0,Math.PI*2);
        ctx.strokeStyle='hsla('+color.h+','+(color.s+10)+'%,'+(color.l+20)+'%,'+((1-phase)*0.45)+')';
        ctx.lineWidth=2-phase*1.5;
        ctx.stroke();
    }

    function drawRadarSweep(ctx,point,color,intensity,now) {
        if(intensity<=0) return;
        var radius=42;
        var angle=(now*0.0012)%(Math.PI*2);
        var gradient=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,radius);
        gradient.addColorStop(0,'hsla('+color.h+','+color.s+'%,'+color.l+'%,'+(intensity*0.08)+')');
        gradient.addColorStop(1,'hsla('+color.h+','+color.s+'%,'+color.l+'%,0)');
        ctx.beginPath();
        ctx.moveTo(point.x,point.y);
        ctx.arc(point.x,point.y,radius,angle-0.55,angle);
        ctx.closePath();
        ctx.fillStyle=gradient;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x,point.y,radius,0,Math.PI*2);
        ctx.strokeStyle='hsla('+color.h+','+color.s+'%,'+(color.l+15)+'%,'+(intensity*0.06)+')';
        ctx.lineWidth=1;
        ctx.stroke();
    }

    function drawWake(ctx,map,pts,headIdx,color,alpha,now) {
        var start=Math.max(0,headIdx-16);
        for(var i=start;i<headIdx;i+=2){
            var age=(headIdx-i)/16;
            var p=map.latLngToContainerPoint(L.latLng(pts[i].lat,pts[i].lon));
            var drift=Math.sin(now*0.002+i*1.7)*age*3;
            var radius=1.8-age;
            ctx.beginPath();
            ctx.arc(p.x,p.y+drift,Math.max(0.45,radius),0,Math.PI*2);
            ctx.fillStyle='hsla('+color.h+','+color.s+'%,'+(color.l+20)+'%,'+(alpha*(1-age)*0.32)+')';
            ctx.fill();
        }
    }

    function drawApproachRings(ctx,map,airport,color,intensity,now) {
        if(intensity<=0) return;
        var p=map.latLngToContainerPoint(L.latLng(airport.lat,airport.lon));
        for(var i=0;i<4;i++){
            var phase=((now/2400)+(i/4))%1;
            var radius=12+phase*52;
            ctx.beginPath();
            ctx.arc(p.x,p.y,radius,0,Math.PI*2);
            ctx.strokeStyle='hsla('+color.h+','+(color.s+5)+'%,'+(color.l+18)+'%,'+(intensity*(1-phase)*0.13)+')';
            ctx.lineWidth=1;
            ctx.stroke();
        }
    }

    var current=null, routePool=[], lastColorIdx=-1;

    function shufflePool(){
        routePool=SR.POPULAR_ROUTES.slice();
        for(var i=routePool.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=routePool[i];routePool[i]=routePool[j];routePool[j]=tmp;}
    }
    function nextRoute(){if(routePool.length===0)shufflePool();return routePool.pop();}
    function nextRouteFrom(fromCode){
        var candidates=[];
        for(var i=0;i<SR.POPULAR_ROUTES.length;i++){
            var route=SR.POPULAR_ROUTES[i];
            if(route[0]===fromCode) candidates.push([route[0],route[1]]);
            else if(route[1]===fromCode) candidates.push([route[1],route[0]]);
        }
        if(candidates.length===0) return nextRoute();
        return candidates[Math.floor(Math.random()*candidates.length)];
    }
    function pickColor(){var idx=Math.floor(Math.random()*PALETTE.length);if(idx===lastColorIdx)idx=(idx+1)%PALETTE.length;lastColorIdx=idx;return PALETTE[idx];}
    shufflePool();

    SR.flightSystem = {
        current: null,

        // Build a flight object without setting it as active
        buildFlight: function(fromCode) {
            var r=fromCode ? nextRouteFrom(fromCode) : nextRoute();
            var fromAp=SR.getAirport(r[0]), toAp=SR.getAirport(r[1]);
            var dist=Math.round(haversineKm(fromAp,toAp)), fl=randomFlight();
            return {
                fromCode:r[0], toCode:r[1], from:fromAp, to:toAp,
                arcPoints:computeArc(fromAp,toAp), startTime:0,
                duration:durationForDistance(dist), color:pickColor(),
                flightName:fl.number, airlineName:fl.airline,
                baseAlt:30000+Math.floor(Math.random()*12000),
                baseSpeed:420+Math.floor(Math.random()*140),
                distance:dist
            };
        },

        // Activate a flight (set it as the current one being drawn/tracked)
        activate: function(fl, startTime) {
            fl.startTime = startTime;
            current = fl;
            SR.flightSystem.current = fl;
            _prevAngle = null; // reset angle smoother
        },

        getState: function(now) {
            if(!current) return null;
            var elapsed=now-current.startTime, dur=current.duration;
            if(elapsed<0) return {progress:0,opacity:0,done:false};
            if(elapsed>dur) return {progress:1,opacity:0,done:true};
            var progress=elapsed/dur, opacity=1;
            if(elapsed<1500) opacity=elapsed/1500;
            else if(elapsed>dur-2500) opacity=(dur-elapsed)/2500;
            return {progress:progress, opacity:Math.max(0,Math.min(1,opacity)), done:false};
        },

        getLiveStats: function(progress) {
            if(!current) return {};
            var alt;
            if(progress<0.15) alt=current.baseAlt*(progress/0.15);
            else if(progress>0.85) alt=current.baseAlt*((1-progress)/0.15);
            else alt=current.baseAlt+Math.sin(progress*12)*400;
            alt=Math.round(Math.max(0,alt));
            var spd;
            if(progress<0.1) spd=180+(current.baseSpeed-180)*(progress/0.1);
            else if(progress>0.9) spd=180+(current.baseSpeed-180)*((1-progress)/0.1);
            else spd=current.baseSpeed+Math.sin(progress*8)*15;
            spd=Math.round(Math.max(0,spd));
            return {altitude:alt, speed:spd, remaining:Math.round(current.distance*(1-progress))};
        },

        getHeadPosition: function(progress) {
            if(!current) return null;
            var exactIdx = progress * (current.arcPoints.length - 1);
            return lerpPt(current.arcPoints, exactIdx);
        },

        getExactIndex: function(progress) {
            if(!current) return 0;
            return progress * (current.arcPoints.length - 1);
        },

        draw: function(ctx, map, now) {
            if(!current) return;
            var state=this.getState(now);
            if(!state||state.opacity<=0.005) return;

            var pts=current.arcPoints, alpha=state.opacity;
            var c=current.color, h=c.h, s=c.s, l=c.l;
            var exactHead = state.progress * (pts.length - 1);
            var headIdx = Math.max(0, Math.min(Math.floor(exactHead), pts.length - 1));
            // Interpolated head position for smooth movement
            var headPt = lerpPt(pts, exactHead);

            // ---- Full arc ghost (upcoming path, very faint) ----
            ctx.beginPath();
            var f=map.latLngToContainerPoint(L.latLng(pts[0].lat,pts[0].lon));
            ctx.moveTo(f.x,f.y);
            for(var i=1;i<pts.length;i++){
                var p=map.latLngToContainerPoint(L.latLng(pts[i].lat,pts[i].lon));
                ctx.lineTo(p.x,p.y);
            }
            ctx.strokeStyle='hsla('+h+','+Math.round(s*0.3)+'%,'+Math.round(l*0.5)+'%,'+(alpha*0.05)+')';
            ctx.lineWidth=1;
            ctx.stroke();

            // ---- Slowly moving route lights ----
            ctx.save();
            ctx.setLineDash([1,12]);
            ctx.lineDashOffset=-(now*0.012);
            ctx.strokeStyle='hsla('+h+','+s+'%,'+(l+12)+'%,'+(alpha*0.16)+')';
            ctx.lineWidth=1.4;
            ctx.lineCap='round';
            ctx.stroke();
            ctx.restore();

            // ---- Departure and arrival airport beacons ----
            var departureIntensity=Math.max(0,1-(state.progress/0.12));
            var arrivalIntensity=Math.max(0,(state.progress-0.86)/0.14);
            drawAirportBeacon(ctx,map,current.from,c,departureIntensity,now);
            drawAirportBeacon(ctx,map,current.to,c,arrivalIntensity,now);
            drawAirportShockwave(ctx,map,current.from,c,state.progress/0.055);
            drawAirportShockwave(ctx,map,current.to,c,(state.progress-0.945)/0.055);
            drawApproachRings(ctx,map,current.to,c,Math.max(0,(state.progress-0.72)/0.28),now);

            // ---- Full traveled trail (0 → head), fades from dim at origin to bright at head ----
            if(headIdx > 2) {
                for(var i=0; i<headIdx; i++){
                    // segT: 0 at origin, 1 at head
                    var segT = i / headIdx;

                    // Opacity: origin starts dim, builds toward head
                    // Use a curve so the old trail stays visible longer
                    var segAlpha = alpha * (0.08 + segT * segT * 0.52);
                    var segWidth = 0.6 + segT * 1.8;

                    var a=map.latLngToContainerPoint(L.latLng(pts[i].lat,pts[i].lon));
                    var b=map.latLngToContainerPoint(L.latLng(pts[i+1].lat,pts[i+1].lon));

                    ctx.beginPath();
                    ctx.moveTo(a.x,a.y);
                    ctx.lineTo(b.x,b.y);
                    ctx.strokeStyle='hsla('+h+','+s+'%,'+(l+5)+'%,'+segAlpha+')';
                    ctx.lineWidth=segWidth;
                    ctx.lineCap='round';
                    ctx.stroke();
                }

                // Bright glow near head (last 10 segments)
                var glowStart=Math.max(0,headIdx-10);
                for(var i=glowStart;i<headIdx;i++){
                    var t=(i-glowStart)/10;
                    var a=map.latLngToContainerPoint(L.latLng(pts[i].lat,pts[i].lon));
                    var b=map.latLngToContainerPoint(L.latLng(pts[i+1].lat,pts[i+1].lon));
                    ctx.beginPath();
                    ctx.moveTo(a.x,a.y);
                    ctx.lineTo(b.x,b.y);
                    ctx.strokeStyle='hsla('+h+','+(s+10)+'%,'+(l+15)+'%,'+(alpha*t*0.35)+')';
                    ctx.lineWidth=3+t*2;
                    ctx.lineCap='round';
                    ctx.stroke();
                }
            }

            // ---- Distance tick marks along upcoming path (every ~1000km) ----
            if(headIdx < pts.length - 5) {
                var kmPerSeg = current.distance / pts.length;
                var segsPer1000 = Math.round(1000 / kmPerSeg);
                if(segsPer1000 > 3) {
                    for(var i = headIdx + segsPer1000; i < pts.length; i += segsPer1000) {
                        var tp = map.latLngToContainerPoint(L.latLng(pts[i].lat, pts[i].lon));
                        ctx.beginPath();
                        ctx.arc(tp.x, tp.y, 1.5, 0, Math.PI*2);
                        ctx.fillStyle = 'hsla('+h+','+(s*0.5)+'%,'+(l+10)+'%,'+(alpha*0.18)+')';
                        ctx.fill();
                    }
                }
            }

            // ---- Departure / arrival city name labels on canvas ----
            var depPt = map.latLngToContainerPoint(L.latLng(current.from.lat, current.from.lon));
            var arrPt = map.latLngToContainerPoint(L.latLng(current.to.lat, current.to.lon));
            ctx.font = '600 9px "SF Mono","Fira Code","Consolas",monospace';
            ctx.textBaseline = 'middle';
            // Departure label (fades as we leave)
            var depAlpha = alpha * Math.max(0, 1 - state.progress / 0.2);
            if(depAlpha > 0.01) {
                ctx.textAlign = 'center';
                ctx.fillStyle = 'hsla('+h+','+(s+5)+'%,'+(l+20)+'%,'+depAlpha+')';
                ctx.fillText(current.from.name.toUpperCase(), depPt.x, depPt.y - 18);
            }
            // Arrival label (fades in as we approach)
            var arrAlpha = alpha * Math.max(0, (state.progress - 0.75) / 0.25);
            if(arrAlpha > 0.01) {
                ctx.textAlign = 'center';
                ctx.fillStyle = 'hsla('+h+','+(s+5)+'%,'+(l+20)+'%,'+arrAlpha+')';
                ctx.fillText(current.to.name.toUpperCase(), arrPt.x, arrPt.y - 18);
            }

            // ---- Head glow (using interpolated position) ----
            var hp=map.latLngToContainerPoint(L.latLng(headPt.lat,headPt.lon));
            var cruiseIntensity=Math.min(1,state.progress/0.18)*Math.min(1,(1-state.progress)/0.18)*alpha;
            drawWake(ctx,map,pts,headIdx,c,alpha,now);
            drawRadarSweep(ctx,hp,c,cruiseIntensity,now);

            // ---- Altitude line (dashed vertical from plane to "ground") ----
            var altProgress;
            if(state.progress<0.15) altProgress=state.progress/0.15;
            else if(state.progress>0.85) altProgress=(1-state.progress)/0.15;
            else altProgress=1;
            var altLineLen = 22 * altProgress * alpha;
            if(altLineLen > 1) {
                ctx.save();
                ctx.setLineDash([2,3]);
                ctx.beginPath();
                ctx.moveTo(hp.x, hp.y + 10);
                ctx.lineTo(hp.x, hp.y + 10 + altLineLen);
                ctx.strokeStyle = 'hsla('+h+','+s+'%,'+(l+10)+'%,'+(alpha*0.2)+')';
                ctx.lineWidth = 0.8;
                ctx.stroke();
                ctx.restore();
                ctx.beginPath();
                ctx.ellipse(hp.x, hp.y + 10 + altLineLen, 4, 1.5, 0, 0, Math.PI*2);
                ctx.fillStyle = 'hsla('+h+','+s+'%,'+l+'%,'+(alpha*0.1)+')';
                ctx.fill();
            }

            var gg=ctx.createRadialGradient(hp.x,hp.y,0,hp.x,hp.y,18);
            gg.addColorStop(0,  'hsla('+h+','+(s+10)+'%,'+(l+15)+'%,'+(alpha*0.55)+')');
            gg.addColorStop(0.3,'hsla('+h+','+s+'%,'+l+'%,'+(alpha*0.15)+')');
            gg.addColorStop(1,  'hsla('+h+','+s+'%,'+l+'%,0)');
            ctx.beginPath();
            ctx.arc(hp.x,hp.y,18,0,Math.PI*2);
            ctx.fillStyle=gg;
            ctx.fill();

            // ---- Smooth angle (interpolated + low-pass filtered) ----
            var angle = smoothAngle(smoothScreenAngle(map, pts, exactHead));

            // ---- Contrails (thin white lines from each wingtip) ----
            if(state.progress > 0.08 && state.progress < 0.92 && headIdx > 8) {
                var sinA = Math.sin(angle), cosA = Math.cos(angle);
                // Wing offsets (perpendicular to heading)
                var wingL = { x: hp.x + sinA * 6, y: hp.y - cosA * 6 };
                var wingR = { x: hp.x - sinA * 6, y: hp.y + cosA * 6 };
                var cLen = 14; // trail segments back
                ctx.save();
                ctx.lineWidth = 0.6;
                ctx.lineCap = 'round';
                for(var ci = 0; ci < cLen; ci++) {
                    var cIdx = exactHead - ci * 1.5;
                    if(cIdx < 0) break;
                    var cIdx2 = exactHead - (ci+1) * 1.5;
                    if(cIdx2 < 0) break;
                    var cp1 = lerpPt(pts, cIdx);
                    var cp2 = lerpPt(pts, cIdx2);
                    var cs1 = map.latLngToContainerPoint(L.latLng(cp1.lat, cp1.lon));
                    var cs2 = map.latLngToContainerPoint(L.latLng(cp2.lat, cp2.lon));
                    var cAngle = Math.atan2(cs1.y - cs2.y, cs1.x - cs2.x);
                    var sinC = Math.sin(cAngle), cosC = Math.cos(cAngle);
                    var ca = alpha * (1 - ci/cLen) * 0.2;
                    // Left contrail
                    ctx.beginPath();
                    ctx.moveTo(cs1.x + sinC*5, cs1.y - cosC*5);
                    ctx.lineTo(cs2.x + sinC*5, cs2.y - cosC*5);
                    ctx.strokeStyle = 'rgba(200,210,230,'+ca+')';
                    ctx.stroke();
                    // Right contrail
                    ctx.beginPath();
                    ctx.moveTo(cs1.x - sinC*5, cs1.y + cosC*5);
                    ctx.lineTo(cs2.x - sinC*5, cs2.y + cosC*5);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // ---- Airplane shadow ----
            ctx.save();
            ctx.translate(hp.x + 3, hp.y + 8 + altLineLen * 0.3);
            ctx.rotate(angle);
            ctx.scale(0.85, 0.4);
            ctx.beginPath();
            ctx.moveTo(10,0); ctx.lineTo(-6,0);
            ctx.moveTo(2,0);  ctx.lineTo(-3,-7);
            ctx.moveTo(2,0);  ctx.lineTo(-3,7);
            ctx.strokeStyle = 'rgba(0,0,0,'+(alpha*0.15)+')';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();

            // ---- Airplane ----
            ctx.save();
            ctx.translate(hp.x,hp.y);
            ctx.rotate(angle);

            ctx.beginPath();
            ctx.moveTo(10,0); ctx.lineTo(-6,0);
            ctx.moveTo(2,0);  ctx.lineTo(-3,-7);
            ctx.moveTo(2,0);  ctx.lineTo(-3,7);
            ctx.moveTo(-6,0); ctx.lineTo(-8,-4);
            ctx.moveTo(-6,0); ctx.lineTo(-8,4);
            ctx.strokeStyle='hsla('+h+','+(s+5)+'%,'+(l+25)+'%,'+alpha+')';
            ctx.lineWidth=1.5;
            ctx.lineCap='round';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(10,0,1.2,0,Math.PI*2);
            ctx.fillStyle='hsla('+h+','+(s+10)+'%,'+(l+30)+'%,'+alpha+')';
            ctx.fill();

            // ---- Blinking navigation lights ----
            var blink=(Math.sin(now*0.018)>0.65)?1:0.18;
            ctx.beginPath();
            ctx.arc(-3,-7,1.5,0,Math.PI*2);
            ctx.fillStyle='rgba(255,75,75,'+(alpha*blink)+')';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(-3,7,1.5,0,Math.PI*2);
            ctx.fillStyle='rgba(75,255,175,'+(alpha*blink)+')';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(-7,0,1,0,Math.PI*2);
            ctx.fillStyle='rgba(255,255,255,'+(alpha*(0.35+blink*0.55))+')';
            ctx.fill();
            ctx.restore();
        },

        setRoutes: function(routes) {
            if(routes&&routes.length>0){
                var existing={};
                SR.POPULAR_ROUTES.forEach(function(r){existing[r.join('-')]=true;});
                routes.forEach(function(r){if(!existing[r.join('-')])SR.POPULAR_ROUTES.push(r);});
            }
            shufflePool();
        }
    };

    window.SkyRoutes = SR;
})();
