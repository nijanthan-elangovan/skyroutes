// ---- WebGL2 procedural clouds (3D simplex noise + FBM) ----
// Adapted from codepen.io/sujitkoji/pen/GgpbJdj — dark moody variant

(function() {
    var SR = window.SkyRoutes || {};

    var vertSrc = '#version 300 es\nin vec4 position;\nvoid main(){gl_Position=position;}';

    var fragSrc = [
        '#version 300 es',
        'precision highp float;',
        'uniform float iTime;',
        'uniform vec2 iResolution;',
        'out vec4 fragColor;',

        // 3D simplex noise
        'vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}',
        'float snoise3(vec3 v){',
        '  const vec2 C=vec2(1.0/6.0,1.0/3.0);',
        '  const vec4 D=vec4(0.0,0.5,1.0,2.0);',
        '  vec3 i=floor(v+dot(v,C.yyy));',
        '  vec3 x0=v-i+dot(i,C.xxx);',
        '  vec3 g=step(x0.yzx,x0.xyz);',
        '  vec3 l=1.0-g;',
        '  vec3 i1=min(g.xyz,l.zxy);',
        '  vec3 i2=max(g.xyz,l.zxy);',
        '  vec3 x1=x0-i1+C.xxx;',
        '  vec3 x2=x0-i2+C.yyy;',
        '  vec3 x3=x0-D.yyy;',
        '  i=mod(i,289.0);',
        '  vec4 p=permute(permute(permute(',
        '    i.z+vec4(0.0,i1.z,i2.z,1.0))',
        '    +i.y+vec4(0.0,i1.y,i2.y,1.0))',
        '    +i.x+vec4(0.0,i1.x,i2.x,1.0));',
        '  float n_=1.0/7.0;',
        '  vec3 ns=n_*D.wyz-D.xzx;',
        '  vec4 j=p-49.0*floor(p*ns.z*ns.z);',
        '  vec4 x_=floor(j*ns.z);',
        '  vec4 y_=floor(j-7.0*x_);',
        '  vec4 x=x_*ns.x+ns.yyyy;',
        '  vec4 y=y_*ns.x+ns.yyyy;',
        '  vec4 h=1.0-abs(x)-abs(y);',
        '  vec4 b0=vec4(x.xy,y.xy);',
        '  vec4 b1=vec4(x.zw,y.zw);',
        '  vec4 s0=floor(b0)*2.0+1.0;',
        '  vec4 s1=floor(b1)*2.0+1.0;',
        '  vec4 sh=-step(h,vec4(0.0));',
        '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;',
        '  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
        '  vec3 p0=vec3(a0.xy,h.x);',
        '  vec3 p1=vec3(a0.zw,h.y);',
        '  vec3 p2=vec3(a1.xy,h.z);',
        '  vec3 p3=vec3(a1.zw,h.w);',
        '  vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
        '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
        '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);',
        '  m=m*m;',
        '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
        '}',

        // FBM with 6 octaves
        'float fbm3(vec2 uv,float t){',
        '  float total=0.0;',
        '  float amp=0.5;',
        '  float freq=1.0;',
        '  for(int i=0;i<6;i++){',
        '    total+=snoise3(vec3(uv*freq,t*0.08))*amp;',
        '    freq*=2.0;',
        '    amp*=0.5;',
        '  }',
        '  return total*0.5+0.5;',
        '}',

        'void main(){',
        '  vec2 uv=gl_FragCoord.xy/iResolution.xy;',
        '  uv=uv*2.0-1.0;',
        '  uv.x*=iResolution.x/iResolution.y;',
        // Slow drift
        '  uv+=vec2(iTime*0.04, iTime*0.06);',
        '  float n=fbm3(uv*1.2, iTime);',
        '  float cloud=smoothstep(0.38,0.72,n);',
        // Dark palette: near-black base → dark blue-gray clouds
        '  vec3 base=vec3(0.012,0.015,0.025);',
        '  vec3 cloudCol=vec3(0.06,0.08,0.12);',
        '  vec3 col=mix(base,cloudCol,cloud);',
        // Subtle highlight on densest areas
        '  float highlight=smoothstep(0.65,0.85,n);',
        '  col+=vec3(0.03,0.04,0.06)*highlight;',
        '  fragColor=vec4(col,1.0);',
        '}'
    ].join('\n');

    function compile(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('Cloud shader error:', gl.getShaderInfoLog(s));
        }
        return s;
    }

    SR.initClouds = function() {
        var c = document.getElementById('cloud-canvas');
        if (!c) return null;
        var gl = c.getContext('webgl2');
        if (!gl) {
            console.warn('[SkyRoutes] WebGL2 not supported, clouds disabled');
            return null;
        }

        c.width = window.innerWidth;
        c.height = window.innerHeight;
        gl.viewport(0, 0, c.width, c.height);

        var vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
        var fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);

        var verts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        var posLoc = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        var iTimeLoc = gl.getUniformLocation(prog, 'iTime');
        var iResLoc = gl.getUniformLocation(prog, 'iResolution');

        window.addEventListener('resize', function() {
            c.width = window.innerWidth;
            c.height = window.innerHeight;
            gl.viewport(0, 0, c.width, c.height);
        });

        return {
            render: function(t) {
                gl.uniform1f(iTimeLoc, t * 0.001);
                gl.uniform2f(iResLoc, c.width, c.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        };
    };

    window.SkyRoutes = SR;
})();
