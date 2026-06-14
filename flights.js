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
        var pts=[];
        var fromLon = from.lon, toLon = to.lon;

        // Dateline fix: if the longitude gap > 180°, wrap the shorter way
        var dLon = toLon - fromLon;
        if (dLon > 180) toLon -= 360;
        else if (dLon < -180) toLon += 360;

        var midLat=(from.lat+to.lat)/2, midLon=(fromLon+toLon)/2;
        var dLat=to.lat-from.lat;
        dLon = toLon - fromLon;
        var dist=Math.sqrt(dLat*dLat+dLon*dLon);
        var pLat=-dLon,pLon=dLat,pLen=Math.sqrt(pLat*pLat+pLon*pLon);
        if(pLen>0){pLat/=pLen;pLon/=pLen;}
        var ch=Math.min(dist*0.28,18);
        var cLat=midLat+pLat*ch, cLon=midLon+pLon*ch;
        for(var i=0;i<=ARC_POINTS;i++){
            var t=i/ARC_POINTS, u=1-t;
            var lat=u*u*from.lat+2*u*t*cLat+t*t*to.lat;
            var lon=u*u*fromLon+2*u*t*cLon+t*t*toLon;
            // Normalize longitude back to [-180, 180]
            if(lon>180) lon-=360;
            else if(lon<-180) lon+=360;
            pts.push({lat:lat, lon:lon});
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
            var dist=Math.round(haversineKm(fromAp,toAp));

            // Try to get real flight data near the departure airport
            var real = SR.getRealFlight ? SR.getRealFlight(r[0]) : null;
            var flightName, airlineName, baseAlt, baseSpeed;

            if (real) {
                flightName = real.flightName;
                airlineName = real.airlineName;
                baseAlt = real.altitude || (30000+Math.floor(Math.random()*12000));
                baseSpeed = real.speed || (420+Math.floor(Math.random()*140));
            } else {
                var fl = randomFlight();
                flightName = fl.number;
                airlineName = fl.airline;
                baseAlt = 30000+Math.floor(Math.random()*12000);
                baseSpeed = 420+Math.floor(Math.random()*140);
            }

            return {
                fromCode:r[0], toCode:r[1], from:fromAp, to:toAp,
                arcPoints:computeArc(fromAp,toAp), startTime:0,
                duration:durationForDistance(dist), color:pickColor(),
                flightName:flightName, airlineName:airlineName,
                baseAlt:baseAlt, baseSpeed:baseSpeed,
                distance:dist, isLive: !!real
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
            var headPt = lerpPt(pts, exactHead);

            // ---- PROJECT ALL POINTS ONCE (the big perf win) ----
            var scr = current._scrCache;
            if(!scr || scr.length !== pts.length) {
                scr = new Array(pts.length);
                current._scrCache = scr;
            }
            for(var i=0;i<pts.length;i++){
                scr[i] = map.latLngToContainerPoint(L.latLng(pts[i].lat, pts[i].lon));
            }
            var hp = map.latLngToContainerPoint(L.latLng(headPt.lat, headPt.lon));

            // ---- Full arc ghost (1 draw call) ----
            ctx.beginPath();
            ctx.moveTo(scr[0].x, scr[0].y);
            for(var i=1;i<pts.length;i++) ctx.lineTo(scr[i].x, scr[i].y);
            ctx.strokeStyle='hsla('+h+','+Math.round(s*0.3)+'%,'+Math.round(l*0.5)+'%,'+(alpha*0.05)+')';
            ctx.lineWidth=1;
            ctx.stroke();

            // ---- Route lights (reuse same path) ----
            ctx.save();
            ctx.setLineDash([1,12]);
            ctx.lineDashOffset=-(now*0.012);
            ctx.strokeStyle='hsla('+h+','+s+'%,'+(l+12)+'%,'+(alpha*0.16)+')';
            ctx.lineWidth=1.4;
            ctx.lineCap='round';
            ctx.stroke();
            ctx.restore();

            // ---- Beacons (only when visible) ----
            var depI=Math.max(0,1-(state.progress/0.12));
            var arrI=Math.max(0,(state.progress-0.86)/0.14);
            if(depI>0.01) drawAirportBeacon(ctx,map,current.from,c,depI,now);
            if(arrI>0.01) drawAirportBeacon(ctx,map,current.to,c,arrI,now);
            if(state.progress<0.06) drawAirportShockwave(ctx,map,current.from,c,state.progress/0.055);
            if(state.progress>0.945) drawAirportShockwave(ctx,map,current.to,c,(state.progress-0.945)/0.055);
            if(state.progress>0.72) drawApproachRings(ctx,map,current.to,c,(state.progress-0.72)/0.28,now);

            // ---- Traveled trail: 3 bands instead of per-segment (3 draw calls, not 120) ----
            if(headIdx > 2) {
                // Band 1: old trail (0 → 60% of head) — dim, thin
                var band1End = Math.floor(headIdx * 0.6);
                if(band1End > 1) {
                    ctx.beginPath();
                    ctx.moveTo(scr[0].x, scr[0].y);
                    for(var i=1;i<=band1End;i++) ctx.lineTo(scr[i].x, scr[i].y);
                    ctx.strokeStyle='hsla('+h+','+s+'%,'+(l+5)+'%,'+(alpha*0.12)+')';
                    ctx.lineWidth=0.8;
                    ctx.lineCap='round';
                    ctx.stroke();
                }

                // Band 2: mid trail (60% → 90% of head) — medium
                var band2Start = Math.max(1, band1End);
                var band2End = Math.floor(headIdx * 0.9);
                if(band2End > band2Start) {
                    ctx.beginPath();
                    ctx.moveTo(scr[band2Start].x, scr[band2Start].y);
                    for(var i=band2Start+1;i<=band2End;i++) ctx.lineTo(scr[i].x, scr[i].y);
                    ctx.strokeStyle='hsla('+h+','+s+'%,'+(l+5)+'%,'+(alpha*0.3)+')';
                    ctx.lineWidth=1.5;
                    ctx.lineCap='round';
                    ctx.stroke();
                }

                // Band 3: hot trail (90% → head) — bright, thick
                var band3Start = Math.max(1, band2End);
                if(headIdx > band3Start) {
                    ctx.beginPath();
                    ctx.moveTo(scr[band3Start].x, scr[band3Start].y);
                    for(var i=band3Start+1;i<=headIdx;i++) ctx.lineTo(scr[i].x, scr[i].y);
                    ctx.lineTo(hp.x, hp.y);
                    ctx.strokeStyle='hsla('+h+','+(s+10)+'%,'+(l+10)+'%,'+(alpha*0.55)+')';
                    ctx.lineWidth=2.5;
                    ctx.lineCap='round';
                    ctx.stroke();
                }
            }

            // ---- City labels ----
            ctx.font='600 9px "SF Mono","Fira Code","Consolas",monospace';
            ctx.textBaseline='middle';
            ctx.textAlign='center';
            var depAlpha=alpha*Math.max(0,1-state.progress/0.2);
            if(depAlpha>0.01){
                ctx.fillStyle='hsla('+h+','+(s+5)+'%,'+(l+20)+'%,'+depAlpha+')';
                ctx.fillText(current.from.name.toUpperCase(),scr[0].x,scr[0].y-18);
            }
            var arrAlpha=alpha*Math.max(0,(state.progress-0.75)/0.25);
            if(arrAlpha>0.01){
                ctx.fillStyle='hsla('+h+','+(s+5)+'%,'+(l+20)+'%,'+arrAlpha+')';
                ctx.fillText(current.to.name.toUpperCase(),scr[pts.length-1].x,scr[pts.length-1].y-18);
            }

            // ---- Turbulence shake on head position ----
            if(SR.effects) {
                var turb = SR.effects.getTurbulence(state.progress);
                if(turb) {
                    var shaken = SR.effects.applyTurbulenceShake(hp.x, hp.y, now, turb.severity);
                    hp = { x: shaken.x, y: shaken.y };
                }
            }

            // ---- Head glow ----
            var cruiseI=Math.min(1,state.progress/0.18)*Math.min(1,(1-state.progress)/0.18)*alpha;
            if(cruiseI>0.01) drawRadarSweep(ctx,hp,c,cruiseI,now);

            var gg=ctx.createRadialGradient(hp.x,hp.y,0,hp.x,hp.y,16);
            gg.addColorStop(0,'hsla('+h+','+(s+10)+'%,'+(l+15)+'%,'+(alpha*0.55)+')');
            gg.addColorStop(0.3,'hsla('+h+','+s+'%,'+l+'%,'+(alpha*0.15)+')');
            gg.addColorStop(1,'hsla('+h+','+s+'%,'+l+'%,0)');
            ctx.beginPath();
            ctx.arc(hp.x,hp.y,16,0,Math.PI*2);
            ctx.fillStyle=gg;
            ctx.fill();

            // ---- Smooth angle ----
            var angle=smoothAngle(smoothScreenAngle(map,pts,exactHead));

            // ---- Contrails (simplified: 2 lines, not per-segment) ----
            if(state.progress>0.08 && state.progress<0.92 && headIdx>6){
                var sinA=Math.sin(angle),cosA=Math.cos(angle);
                var cBack=Math.max(0,headIdx-18);
                var bp=scr[cBack];
                ctx.save();
                ctx.lineWidth=0.5;
                ctx.lineCap='round';
                ctx.strokeStyle='rgba(200,210,230,'+(alpha*0.12)+')';
                ctx.beginPath();
                ctx.moveTo(hp.x+sinA*5,hp.y-cosA*5);
                ctx.lineTo(bp.x+sinA*3,bp.y-cosA*3);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(hp.x-sinA*5,hp.y+cosA*5);
                ctx.lineTo(bp.x-sinA*3,bp.y+cosA*3);
                ctx.stroke();
                ctx.restore();
            }

            // ---- Airplane shadow ----
            var altP=state.progress<0.15?state.progress/0.15:state.progress>0.85?(1-state.progress)/0.15:1;
            var altLen=18*altP*alpha;
            ctx.save();
            ctx.translate(hp.x+2,hp.y+6+altLen*0.3);
            ctx.rotate(angle);
            ctx.scale(0.8,0.35);
            ctx.beginPath();
            ctx.moveTo(10,0);ctx.lineTo(-6,0);
            ctx.moveTo(2,0);ctx.lineTo(-3,-7);
            ctx.moveTo(2,0);ctx.lineTo(-3,7);
            ctx.strokeStyle='rgba(0,0,0,'+(alpha*0.12)+')';
            ctx.lineWidth=2;ctx.lineCap='round';ctx.stroke();
            ctx.restore();

            // ---- Airplane ----
            ctx.save();
            ctx.translate(hp.x,hp.y);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(10,0);ctx.lineTo(-6,0);
            ctx.moveTo(2,0);ctx.lineTo(-3,-7);
            ctx.moveTo(2,0);ctx.lineTo(-3,7);
            ctx.moveTo(-6,0);ctx.lineTo(-8,-4);
            ctx.moveTo(-6,0);ctx.lineTo(-8,4);
            ctx.strokeStyle='hsla('+h+','+(s+5)+'%,'+(l+25)+'%,'+alpha+')';
            ctx.lineWidth=1.5;ctx.lineCap='round';ctx.stroke();
            ctx.beginPath();
            ctx.arc(10,0,1.2,0,Math.PI*2);
            ctx.fillStyle='hsla('+h+','+(s+10)+'%,'+(l+30)+'%,'+alpha+')';
            ctx.fill();

            // Nav lights
            var blink=(Math.sin(now*0.018)>0.65)?1:0.18;
            ctx.beginPath();ctx.arc(-3,-7,1.5,0,Math.PI*2);
            ctx.fillStyle='rgba(255,75,75,'+(alpha*blink)+')';ctx.fill();
            ctx.beginPath();ctx.arc(-3,7,1.5,0,Math.PI*2);
            ctx.fillStyle='rgba(75,255,175,'+(alpha*blink)+')';ctx.fill();
            ctx.beginPath();ctx.arc(-7,0,1,0,Math.PI*2);
            ctx.fillStyle='rgba(255,255,255,'+(alpha*(0.35+blink*0.55))+')';ctx.fill();
            ctx.restore();
        },

        setRoutes: function(routes) {
            if(routes&&routes.length>0){
                var existing={};
                SR.POPULAR_ROUTES.forEach(function(r){existing[r.join('-')]=true;});
                routes.forEach(function(r){if(!existing[r.join('-')])SR.POPULAR_ROUTES.push(r);});
            }
            shufflePool();
        },

        // Exposed for track panel to recompute arcs
        computeArc: function(from, to) {
            return computeArc(from, to);
        },

        haversineKm: function(a, b) {
            return haversineKm(a, b);
        },

        durationForDistance: function(km) {
            return durationForDistance(km);
        }
    };

    window.SkyRoutes = SR;
})();
