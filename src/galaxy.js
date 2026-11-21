// galaxy.js — self-contained animated spiral-galaxy background (raw WebGL, no deps)
// Original visual inspired by particle-galaxy / shader-space aesthetics.

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye, center, up) {
  const [ex, ey, ez] = eye;
  let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1,
  ]);
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSize;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
varying vec3 vColor;
varying float vFade;
void main() {
  float a = uTime * 0.045;
  float c = cos(a), s = sin(a);
  mat3 rot = mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
  vec3 p = rot * aPos;
  vec4 mv = uView * vec4(p, 1.0);
  gl_Position = uProj * mv;
  gl_PointSize = aSize * (260.0 / max(-mv.z, 0.1));
  float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aPos.x * 3.0 + aPos.z * 2.0);
  vColor = aColor;
  vFade = tw;
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float alpha = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vColor * vFade, alpha * vFade);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function build() {
  const PARTICLES = 26000;
  const ARMS = 4;
  const RADIUS = 11;
  const SPIN = 0.95;
  const inner = [1.0, 0.86, 0.58];
  const mid = [0.95, 0.45, 0.65];
  const outer = [0.30, 0.42, 1.0];
  const pos = new Float32Array(PARTICLES * 3);
  const col = new Float32Array(PARTICLES * 3);
  const siz = new Float32Array(PARTICLES);

  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const scatter = (r) => (Math.pow(Math.random(), 2.4)) * (Math.random() < 0.5 ? 1 : -1) * r * 0.42;

  const core = Math.floor(PARTICLES * 0.82);
  for (let i = 0; i < PARTICLES; i++) {
    let x, y, z, t, c, s;
    if (i < core) {
      const r = Math.pow(Math.random(), 0.65) * RADIUS;
      const branch = (i % ARMS) / ARMS * Math.PI * 2;
      const angle = branch + r * SPIN;
      x = Math.cos(angle) * r + scatter(r);
      z = Math.sin(angle) * r + scatter(r);
      y = scatter(r) * 0.35 * (1.0 - r / RADIUS * 0.6);
      t = r / RADIUS;
      c = t < 0.5 ? mix3(inner, mid, t / 0.5) : mix3(mid, outer, (t - 0.5) / 0.5);
      s = lerp(3.4, 1.4, Math.min(1, t * 1.3)) * (0.7 + Math.random() * 0.6);
    } else {
      // faint far star halo
      const r = 20 + Math.random() * 34;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      x = r * Math.sin(ph) * Math.cos(th);
      y = r * Math.cos(ph) * 0.6;
      z = r * Math.sin(ph) * Math.sin(th);
      const b = 0.5 + Math.random() * 0.5;
      c = [b * 0.8, b * 0.85, b];
      s = 0.8 + Math.random() * 1.1;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    siz[i] = s;
  }
  return { PARTICLES, pos, col, siz };
}

export function initGalaxy(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.style.background = 'radial-gradient(circle at 50% 40%, #171032 0%, #06040f 70%)';
    return { hasAudio: false, dispose() {} };
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const { PARTICLES, pos, col, siz } = build();
  const mk = (data, loc, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, loc);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
  };
  mk(pos, 'aPos', 3); mk(col, 'aColor', 3); mk(siz, 'aSize', 1);

  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uTime = gl.getUniformLocation(prog, 'uTime');

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0.016, 0.012, 0.035, 1);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniformMatrix4fv(uProj, false, perspective(1.02, canvas.width / canvas.height, 0.1, 120));
  }
  window.addEventListener('resize', resize);
  resize();

  let rafId = 0, running = true;
  const start = performance.now();
  function frame(now) {
    if (!running) return;
    const t = (now - start) / 1000;
    resize();
    const bob = Math.sin(t * 0.25) * 0.8;
    gl.uniformMatrix4fv(uView, false, lookAt([0, 6.5 + bob, 15], [0, 0.3, 0], [0, 1, 0]));
    gl.uniform1f(uTime, t);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, PARTICLES);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    hasAudio: false,
    dispose() { running = false; cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); },
  };
}
