// flowers.js — original "night flower valley" interactive background (raw WebGL, no deps).
// Captures the *feel* described in the brief — glowing point-sprite flowers over undulating
// terrain, blooming as they near the camera, idle forward drift + scroll-to-wander, mouse
// pushing points away in screen space with a glow near the cursor, depth fog, additive bloom,
// vignette, and an optional procedurally-generated ambient pad. All art/code is original;
// no third-party engine or assets are used.

// ---- tiny mat4 ----
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
function mul(a, b) {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
function translate(x, y, z) { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }

// ---- procedural flower / glow sprite texture (white, tinted per-point in the shader) ----
function makeFlowerTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  // soft bloom halo
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  halo.addColorStop(0, 'rgba(255,255,255,0.9)');
  halo.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(0, 0, S / 2, 0, 7); g.fill();
  // five petals
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    g.save();
    g.rotate((i / 5) * Math.PI * 2);
    const pet = g.createRadialGradient(0, -24, 0, 0, -24, 22);
    pet.addColorStop(0, 'rgba(255,255,255,0.95)');
    pet.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = pet;
    g.beginPath(); g.ellipse(0, -24, 13, 22, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // bright core
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 14);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
  return c;
}

const VERT = `
attribute vec3 aPos;      // x, groundY, z0
attribute vec3 aColor;
attribute vec2 aMeta;     // size, type(0 flower,1 leaf,2 dust)
uniform mat4 uProj, uView;
uniform float uTravel, uDepth, uTime, uAspect, uPush;
uniform vec2 uMouse;
varying vec3 vColor;
varying float vGlow, vFog, vType, vTw;
void main() {
  float z = mod(aPos.z + uTravel, uDepth) - uDepth;   // (-uDepth, 0]
  float sway = sin(uTime * 0.8 + aPos.x * 0.6 + aPos.z) * 0.06;
  vec3 world = vec3(aPos.x + sway, aPos.y, z);
  vec4 view = uView * vec4(world, 1.0);
  vec4 clip = uProj * view;
  vec2 ndc = clip.xy / clip.w;
  // screen-space mouse repulsion + proximity glow
  vec2 d = (ndc - uMouse) * vec2(uAspect, 1.0);
  float dist2 = dot(d, d);
  float push = uPush * exp(-dist2 * 5.0);
  ndc += normalize(d + 1e-4) * push;
  float glow = exp(-dist2 * 7.0);
  clip.xy = ndc * clip.w;
  gl_Position = clip;
  float dist = -view.z;
  float bloom = smoothstep(uDepth, uDepth * 0.08, dist);   // bigger & brighter up close
  float leafBloom = smoothstep(uDepth * 0.2, uDepth * 0.75, dist); // leaves grow further back
  float grow = aMeta.y > 0.5 && aMeta.y < 1.5 ? mix(bloom, leafBloom + 0.3, 0.6) : bloom;
  gl_PointSize = min(aMeta.x * clamp(grow, 0.05, 1.0) * (300.0 / max(dist, 2.0)), 90.0);
  vColor = aColor;
  vGlow = glow;
  vFog = clamp(1.0 - dist / uDepth, 0.0, 1.0);
  vType = aMeta.y;
  vTw = 0.8 + 0.2 * sin(uTime * 2.0 + aPos.x * 4.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec3 vColor;
varying float vGlow, vFog, vType, vTw;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  if (vType > 1.5) {                 // dust = tiny soft dot (center of sprite only)
    float r = length(gl_PointCoord - 0.5);
    t.a = smoothstep(0.5, 0.0, r);
  }
  vec3 col = vColor * (1.0 + vGlow * 1.5) * vTw;
  float a = t.a * vFog * (0.30 + vGlow * 0.6);
  gl_FragColor = vec4(col * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('SHADER COMPILE FAIL: ' + gl.getShaderInfoLog(s));
  return s;
}

const PALETTE = {
  flower: [[1.0, 0.95, 0.82], [1.0, 0.72, 0.80], [0.95, 0.84, 1.0], [1.0, 0.86, 0.55], [0.78, 0.88, 1.0]],
  leaf: [[0.45, 0.78, 0.62], [0.38, 0.66, 0.58], [0.55, 0.82, 0.55]],
  dust: [[0.85, 0.88, 1.0]],
};

function build() {
  const SPAN = 30, DEPTH = 64, GROUND = -3.6, AMP = 1.4;
  const nFlower = 3000, nLeaf = 1600, nDust = 900;
  const N = nFlower + nLeaf + nDust;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), meta = new Float32Array(N * 2);
  const terrain = (x, z) => GROUND + (Math.sin(x * 0.16) + Math.cos(z * 0.21) + Math.sin((x + z) * 0.09)) * AMP * 0.5;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  let i = 0;
  const put = (x, y, z, c, size, type) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    meta[i * 2] = size; meta[i * 2 + 1] = type; i++;
  };
  for (let k = 0; k < nFlower; k++) {
    const x = (Math.random() * 2 - 1) * SPAN, z = Math.random() * DEPTH;
    put(x, terrain(x, z) + Math.random() * 0.5, z, pick(PALETTE.flower), 7 + Math.random() * 7, 0);
  }
  for (let k = 0; k < nLeaf; k++) {
    const x = (Math.random() * 2 - 1) * SPAN, z = Math.random() * DEPTH;
    put(x, terrain(x, z) - 0.2 + Math.random() * 0.3, z, pick(PALETTE.leaf), 5 + Math.random() * 5, 1);
  }
  for (let k = 0; k < nDust; k++) {
    const x = (Math.random() * 2 - 1) * SPAN, z = Math.random() * DEPTH;
    put(x, terrain(x, z) + 0.5 + Math.random() * 4, z, pick(PALETTE.dust), 1.5 + Math.random() * 2.5, 2);
  }
  return { N, pos, col, meta, DEPTH };
}

// ---- optional procedural ambient pad (original, asset-free) ----
function makeAudio() {
  let ctx, master, nodes = [], on = false, initialized = false;
  function init() {
    if (initialized) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(master);
    [55, 82.4, 110, 164.8].forEach((f, idx) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.12 / (idx + 1);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + idx * 0.03;
      const lg = ctx.createGain(); lg.gain.value = 0.04;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(lp); o.start(); lfo.start();
      nodes.push(o, lfo);
    });
    initialized = true;
  }
  return {
    toggle() {
      init();
      if (!ctx) return false;
      if (ctx.state === 'suspended') ctx.resume();
      on = !on;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.6);
      return on;      // returns playing-state
    },
    dispose() { if (ctx) { nodes.forEach(n => { try { n.stop(); } catch (e) {} }); ctx.close(); } },
  };
}

export function initFlowers(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.style.background = 'radial-gradient(ellipse at 50% 80%, #241633 0%, #06040c 70%)';
    return { hasAudio: false, dispose() {} };
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.warn('PROGRAM LINK FAIL: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const { N, pos, col, meta, DEPTH } = build();
  const mk = (data, loc, size) => {
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, loc); gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
  };
  mk(pos, 'aPos', 3); mk(col, 'aColor', 3); mk(meta, 'aMeta', 2);

  // texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeFlowerTexture());
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const U = (n) => gl.getUniformLocation(prog, n);
  const uProj = U('uProj'), uView = U('uView'), uTravel = U('uTravel'), uDepth = U('uDepth'),
    uTime = U('uTime'), uAspect = U('uAspect'), uMouse = U('uMouse'), uPush = U('uPush'), uTex = U('uTex');
  gl.uniform1i(uTex, 0);
  gl.uniform1f(uDepth, DEPTH);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0.015, 0.012, 0.028, 1);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uAspect, canvas.width / canvas.height);
    gl.uniformMatrix4fv(uProj, false, perspective(1.0, canvas.width / canvas.height, 0.1, DEPTH + 10));
  }
  window.addEventListener('resize', resize); resize();

  // vignette + grain overlay (DOM, removed on dispose)
  const fx = document.createElement('div');
  fx.id = 'valleyFx';
  fx.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;' +
    'background:radial-gradient(ellipse 85% 75% at 50% 48%, transparent 40%, rgba(2,1,8,0.55) 100%);';
  canvas.after(fx);

  // ---- interaction state ----
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let travel = 0, speed = 2.4, targetSpeed = 2.4, push = 0, targetPush = 0.06;
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onWheel = (e) => { targetSpeed = Math.min(26, targetSpeed + Math.abs(e.deltaY) * 0.02); };
  const onDown = () => { targetPush = 0.14; };
  const onUp = () => { targetPush = 0.06; };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  const audio = makeAudio();

  let rafId = 0, running = true, last = performance.now();
  const start = last;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - start) / 1000;
    // ease scroll back to idle drift
    targetSpeed += (2.4 - targetSpeed) * dt * 0.8;
    speed += (targetSpeed - speed) * dt * 3.0;
    travel += speed * dt;
    push += (targetPush - push) * dt * 4.0;
    // smooth mouse + camera tilt toward cursor
    mouse.x += (mouse.tx - mouse.x) * dt * 4.0;
    mouse.y += (mouse.ty - mouse.y) * dt * 4.0;
    const bob = Math.sin(t * 0.3) * 0.12;
    let view = translate(0, 1.2 - bob, 0);            // fly low over the carpet
    view = mul(rotX(-0.22 - mouse.y * 0.05), view);   // look down onto the field + tilt to mouse
    view = mul(rotY(mouse.x * 0.08), view);

    gl.uniform1f(uTime, t);
    gl.uniform1f(uTravel, travel);
    gl.uniform1f(uPush, push);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniformMatrix4fv(uView, false, view);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, N);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    hasAudio: true,
    toggleSound() { return audio.toggle(); },   // true = now playing
    dispose() {
      running = false; cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      audio.dispose();
      fx.remove();
    },
  };
}
