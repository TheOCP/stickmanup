// Far-off land round every map but the Wild Forest (wildview.js has that one), drawn the same way: big meshes lit in the
// shader by the scene's own lights (copied in every frame, so a night or dusk look is right too), with a fog that
// thickens more slowly than on everything else, so the far shapes stay in sight as layers in the haze.
//   Storm Tower: black sea cliffs and stacks, a coast of high peaks with snow, masts with red lights, a lighthouse.
//   Sunny Isles: green volcanic islands with white beaches, palms and jungle.
//   Volcano: the crater wall all round, black rock and ash with lava running down it, small cones in the lava lake.
//   Neon City: round, tapering and tiered towers with lit windows round the bay, a bridge hung with lights, the lit hills behind.
//   Waterfall: green-topped rock pillars and a ring of high cliffs with white falls running down them.
// Nothing here comes nearer the middle than 150 m: the climb and its hidden courses all stay inside 110 m.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { noiseGlsl } from './pattern.js';
import { detail, fallMat } from './scenery.js';
import { HDR } from './worldview.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex);

// Smooth value noise in 2D from a seed, 0..1.
function vnoise(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144269)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const fbmOf = (N) => (x, z) => N(x, z) * 0.5 + N(x * 2.03 + 5.2, z * 2.03 + 1.3) * 0.27 + N(x * 4.07 + 9.7, z * 4.07 + 3.1) * 0.15 + N(x * 8.1 + 2.2, z * 8.1 + 7.7) * 0.08;
const ridgedOf = (N) => (x, z) => {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < 5; o++) { const n = 1 - Math.abs(N(x * f + o * 7.3, z * f + o * 3.1) * 2 - 1); s += n * n * a; a *= 0.5; f *= 2.1; }
  return s;
};

// ---------------------------------------------------------------- the shader
// aD: x the crowns of trees up close (in towers: which tower), y rock up close (in towers: 1 a wall with windows, 2 a light,
// below 0 a round wall with windows, minus its radius),
// z what glows: lava, the lights of a town, lit windows, white water, by the mode.
const MODES = { plain: 0, lava: 1, lights: 2, windows: 3, falls: 4 };
const LAND_VS = `#include <fog_pars_vertex>
  attribute vec3 aCol; attribute vec3 aD; uniform float uFogK;
  varying vec3 vC; varying vec3 vW; varying vec3 vN; varying vec3 vD; varying float vDist;
  void main(){
    vC = aCol; vD = aD; vW = position; vN = normal;
    vec4 mvPosition = viewMatrix * vec4(position, 1.0);
    vDist = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    vFogDepth *= uFogK;
  }`;
const landFs = () => `#include <fog_pars_fragment>
  uniform vec3 uSunDir; uniform vec3 uSunC; uniform vec3 uSky; uniform vec3 uGnd; uniform vec3 uGlow; uniform vec3 uGlow2;
  uniform float uT; uniform float uMode; uniform float uFogD; uniform float uFogK;
  varying vec3 vC; varying vec3 vW; varying vec3 vN; varying vec3 vD; varying float vDist;
  ${noiseGlsl()}
  void main(){
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float near = 1.0 - smoothstep(160.0, 560.0, vDist);
    vec3 col = vC, em = vec3(0.0);
    if (uMode > 2.5 && uMode < 3.5) {
      if (vD.y > 1.5) {
        // A light: neon on the towers, the lamps on the bridge, red lights on the roofs.
        em = vC * 2.4;
        col = vec3(0.0);
      } else {
        // Rows of windows, some lit. Far off, where a window is smaller than a pixel, their average instead. A round
        // tower (detail y below 0: minus its radius) has them all the way round it.
        float rad = max(-vD.y, 0.0);
        vec2 w = rad > 0.0 ? vec2(atan(n.z, n.x) * rad, vW.y) : abs(n.x) > abs(n.z) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        vec2 q = vec2(w.x / 2.4, w.y / 3.3), id = floor(q), f = fract(q);
        float side = step(abs(n.y), 0.5) * (rad > 0.0 ? 1.0 : vD.y);
        float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.86) * side;
        float lit = step(1.0 - vD.z, h21(id + vD.x * 61.7));
        float far = smoothstep(0.3, 0.9, length(fwidth(q)));
        float on = mix(win * lit, 0.38 * vD.z * side, far);
        em = mix(uGlow, uGlow2, h21(id * 1.31 + vD.x * 17.0)) * on * (0.7 + 0.5 * h21(id + 3.7));
        col *= mix(1.0 - 0.5 * win, 1.0 - 0.2 * side, far);
      }
    } else {
      float cn = n21(vW.xz * 0.42) * 0.6 + n21(vW.xz * 1.15 + 3.0) * 0.4;
      float rk = n21(vec2(vW.x * 0.06 + vW.z * 0.06, vW.y * 0.45)) * 0.55 + n21(vW.xz * 0.28 + 7.0) * 0.45;
      col *= mix(1.0, 0.58 + 0.7 * cn, vD.x * near) * mix(1.0, 0.7 + 0.55 * rk, vD.y * near);
      float g = vD.z;
      if (g > 0.002) {
        if (uMode < 1.5) {
          // Lava running down, brighter knots of it sliding along.
          float f = n21(vec2((vW.x + vW.z) * 0.09, vW.y * 0.05 + uT * 0.35)) * 0.6 + n21(vec2((vW.x - vW.z) * 0.23, vW.y * 0.13 + uT * 0.9)) * 0.4;
          em = mix(uGlow, uGlow2, f) * g * (0.35 + 1.2 * f * f);
          col *= 1.0 - 0.7 * g;
        } else if (uMode < 2.5) {
          // The lights of the towns on the hills, twinkling.
          // In rows along the streets: a block every seven lamps each way.
          vec2 q = vW.xz * 0.28, id = floor(q), f = fract(q) - 0.5;
          float h = h21(id), far = smoothstep(0.25, 0.9, length(fwidth(q)));
          float street = max(step(mod(id.x, 7.0), 0.5), step(mod(id.y, 7.0), 0.5));
          float k = mix(smoothstep(0.32, 0.06, length(f)) * step(0.3, h) * street, 0.025, far);
          em = mix(uGlow, uGlow2, h21(id + 7.3)) * g * k * (0.75 + 0.25 * sin(uT * 3.0 + h * 50.0));
        } else {
          // White water running down the rock: ropes of it with dark wet rock between, sliding down, foam at the foot.
          float hz = atan(vW.z, vW.x) * length(vW.xz);
          float s = n21(vec2(hz * 0.22, vW.y * 0.025 + uT * 0.7)) * 0.55 + n21(vec2(hz * 0.55 + 7.0, vW.y * 0.05 + uT * 1.5)) * 0.45;
          float rope = smoothstep(0.3, 0.7, s), foam = 1.0 - smoothstep(2.0, 16.0, vW.y);
          col = mix(col * 0.7, vec3(0.94, 0.97, 1.0), g * max(0.35 + 0.65 * rope, foam));
          em = vec3(0.1, 0.12, 0.14) * g * rope;
        }
      }
    }
    vec3 light = mix(uGnd, uSky, 0.5 + 0.5 * n.y) + uSunC * max(dot(n, uSunDir), 0.0);
    col *= light;
    // What glows shows through the haze better than what is only lit.
    float fd = uFogD * vDist * uFogK, ff = min(0.95, 1.0 - exp(-fd * fd));
    col += em * (1.0 - 0.5 * ff) / (1.0 - ff);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export function landMat(view, o = {}) {
  const m = new THREE.ShaderMaterial({
    fog: true,
    side: o.side ?? THREE.FrontSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uFogK: { value: o.fogK ?? 0.42 }, uFogD: { value: 0.005 }, uT: { value: 0 }, uMode: { value: MODES[o.mode || 'plain'] },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() }, uSunC: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uSky: { value: new THREE.Color(0.3, 0.3, 0.3) }, uGnd: { value: new THREE.Color(0.1, 0.1, 0.1) },
      uGlow: { value: HDR(o.glow ?? 0xff6a1a, o.glowK ?? 2.5) }, uGlow2: { value: HDR(o.glow2 ?? o.glow ?? 0xffb040, o.glowK ?? 2.5) },
    }]),
    vertexShader: LAND_VS, fragmentShader: landFs(),
  });
  // The scene's lights and fog, found once and copied in every frame.
  let hemi = null, sun = null, scene = null;
  const U = m.uniforms, k = 1 / Math.PI;
  view.onFrame.push(() => {
    if (!hemi) {
      let s = view.root;
      while (s.parent) s = s.parent;
      s.traverse((x) => { if (x.isHemisphereLight) hemi = x; else if (x.isDirectionalLight && !sun) sun = x; });
      if (!hemi || !sun) { hemi = sun = null; return; }
      scene = s;
    }
    U.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity * k);
    U.uGnd.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * k);
    U.uSunC.value.copy(sun.color).multiplyScalar(sun.intensity * k);
    U.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
    U.uFogD.value = scene.fog ? scene.fog.density : 0;
  });
  view.timeMats.push(m);
  return m;
}

// ---------------------------------------------------------------- building the meshes
// A mesh over a grid of NU x NV points, closed round in u. at(u, v, p) puts point (u, v) in p; paint(p, n, o) gives
// its colour in o.c and its detail in o.d. The faces look the way u x v points (flip: the other way).
function gridMesh(NU, NV, at, paint, mat, flip = false) {
  const n = NU * NV, pos = new Float32Array(n * 3), p = new THREE.Vector3();
  for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) {
    at(u, v, p);
    const o = (v * NU + u) * 3;
    pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
  }
  const idx = [];
  for (let v = 0; v < NV - 1; v++) for (let u = 0; u < NU; u++) {
    const a = v * NU + u, b = v * NU + ((u + 1) % NU), c = a + NU, e = b + NU;
    if (flip) idx.push(a, c, b, b, c, e);
    else idx.push(a, b, c, b, e, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.attributes.normal.array, cols = new Float32Array(n * 3), dd = new Float32Array(n * 3), q = new THREE.Vector3(), nn = new THREE.Vector3();
  const out = { c: new THREE.Color(), d: [0, 0, 0] };
  for (let i = 0; i < n; i++) {
    q.fromArray(pos, i * 3);
    nn.fromArray(nor, i * 3);
    out.d[0] = out.d[1] = out.d[2] = 0;
    paint(q, nn, out);
    cols[i * 3] = out.c.r; cols[i * 3 + 1] = out.c.g; cols[i * 3 + 2] = out.c.b;
    dd[i * 3] = out.d[0]; dd[i * 3 + 1] = out.d[1]; dd[i * 3 + 2] = out.d[2];
  }
  geo.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(dd, 3));
  return new THREE.Mesh(geo, mat);
}

// Land in a ring round the middle, from r0 out to r1, its rows closer together near the middle.
function ringMesh(NA, NR, r0, r1, height, paint, mat) {
  return gridMesh(NA, NR, (u, v, p) => {
    const r = r0 * Math.pow(r1 / r0, v / (NR - 1)), a = (u / NA) * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
    p.set(x, height(x, z), z);
  }, paint, mat);
}

// Many small shapes as one mesh in the land's shader: trees, palms, masts, towers.
class Bits {
  constructor() { this.p = []; this.n = []; this.c = []; this.d = []; this.i = []; }
  // geo placed by the matrix m in one colour (darker towards its foot by lo), with the detail d.
  add(geo, m, col, d = ZERO, lo = 1) {
    const base = this.p.length / 3, a = geo.attributes.position, na = geo.attributes.normal;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const y0 = geo.boundingBox.min.y, yh = geo.boundingBox.max.y - y0 || 1;
    _nm.getNormalMatrix(m);
    for (let k = 0; k < a.count; k++) {
      const s = lo + (1 - lo) * ((a.getY(k) - y0) / yh);
      _v.fromBufferAttribute(a, k).applyMatrix4(m);
      this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(na, k).applyMatrix3(_nm).normalize();
      this.n.push(_v.x, _v.y, _v.z);
      this.c.push(col.r * s, col.g * s, col.b * s);
      this.d.push(d[0], d[1], d[2]);
    }
    if (geo.index) for (let k = 0; k < geo.index.count; k++) this.i.push(base + geo.index.getX(k));
    else for (let k = 0; k < a.count; k++) this.i.push(base + k);
  }
  mesh(mat) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(this.d, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}
const ZERO = [0, 0, 0], _v = new THREE.Vector3(), _nm = new THREE.Matrix3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
// x, y, z, scale (sx, sy, sz) and turns (rx, ry, rz in YXZ order).
const M = (x, y, z, sx, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));

const CONE = new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0);
const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0);
// A tree crown, shaded round (not by its faces) so a canopy of them looks soft.
// Its 12 corners shared, so thousands of them stay light.
const CROWN = (() => {
  const src = new THREE.IcosahedronGeometry(1, 0).attributes.position, at = new Map(), P = [], idx = [];
  for (let k = 0; k < src.count; k++) {
    const key = [src.getX(k), src.getY(k), src.getZ(k)].map((v) => Math.round(v * 1e4)).join();
    if (!at.has(key)) { at.set(key, P.length / 3); P.push(src.getX(k), src.getY(k), src.getZ(k)); }
    idx.push(at.get(key));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.slice(), 3));
  g.setIndex(idx);
  return g.translate(0, 0.6, 0);
})();
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
// A palm: a leaning trunk and a crown of drooping leaves, 4 m to the top of the trunk. Corners shared, it is seen from far.
const PALM = (() => {
  const P = [], idx = [], trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 4, 3, true).translate(0, 0.5, 0), tp = trunk.attributes.position;
  for (let k = 0; k < tp.count; k++) { const y = tp.getY(k); P.push(tp.getX(k) + y * y * 0.9, y * 4, tp.getZ(k)); }
  for (let k = 0; k < trunk.index.count; k++) idx.push(trunk.index.getX(k));
  // Each leaf a V from the crown out and down: a spine and an edge on each side.
  const seg = [[0, 0], [1.3, 0.5], [2.5, 0.2], [3.3, -0.7]], w = (s) => 0.12 + 0.35 * Math.sin((s / 3) * Math.PI + 0.3);
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Matrix4().makeTranslation(0.9, 4, 0).multiply(new THREE.Matrix4().makeRotationY((k / 6) * TAU + 0.3)).multiply(new THREE.Matrix4().makeRotationZ(-0.1 + (k % 2) * 0.2));
    const base = P.length / 3, put = (x, y, z) => { _v.set(x, y, z).applyMatrix4(m); P.push(_v.x, _v.y, _v.z); };
    for (const [x, y] of seg) put(x, y, 0);
    for (const sd of [-1, 1]) seg.forEach(([x, y], i) => put(x, y + w(i) * 0.3, sd * w(i)));
    for (let i = 0; i < 3; i++) {
      const s0 = base + i, s1 = s0 + 1, l0 = base + 4 + i, r0 = base + 8 + i;
      idx.push(s0, s1, l0, s1, l0 + 1, l0, s0, r0, s1, s1, r0, r0 + 1);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
})();

// How steep the land is at x, z (1 flat, 0 a wall): the up part of its normal.
const upOf = (height, x, z) => { const gx = height(x + 2, z) - height(x - 2, z), gz = height(x, z + 2) - height(x, z - 2); return 4 / Math.hypot(gx, 4, gz); };

// ---------------------------------------------------------------- Storm Tower
export function stormLands(view) {
  const d = detail(), NA = [128, 200, 256][d], NR = [36, 50, 62][d], r0 = 150, r1 = 780, R = rng(9101);
  const N1 = vnoise(61), N2 = vnoise(62), N3 = vnoise(63), N4 = vnoise(64), fbm = fbmOf(N1), ridged = ridgedOf(N2);
  // Islands and sea stacks with sheer sides nearer in, then a coast of high peaks; under the sea again at the far edge.
  const height = (x, z) => {
    const r = Math.hypot(x, z), n = fbm(x * 0.0058 + 3.1, z * 0.0058 + 8.7), rid = Math.pow(ridged(x * 0.0052, z * 0.0052), 1.35);
    const isl = smooth(0.585, 0.625, n) * smooth(185, 235, r), coast = smooth(0.42, 0.5, (r - 420) / 300 + N4(x * 0.004, z * 0.004) * 0.35);
    const land = Math.max(isl, coast) * (1 - smooth(r1 - 140, r1 - 30, r));
    return -16 + land * (22 + (40 + 70 * smooth(0.6, 0.75, n) + coast * (140 + 220 * N3(x * 0.003 + 2, z * 0.003 + 5))) * rid);
  };
  const ROCK = [C(0x474d57), C(0x737a84)], WET = C(0x2a2d33), FOAM = C(0xb4c0c8), GRASS = [C(0x35412f), C(0x4c583f)], SNOW = C(0xe4e9f0), _c = new THREE.Color();
  const paint = (p, n, o) => {
    const y = p.y, slope = 1 - n.y, t = N4(p.x * 0.03, p.z * 0.03), m = N1(p.x * 0.02 + 4, p.z * 0.02 + 8);
    o.c.copy(ROCK[0]).lerp(ROCK[1], t);
    const grass = smooth(4, 9, y) * (1 - smooth(0.32, 0.5, slope)) * (1 - smooth(120, 160, y)) * (0.4 + 0.6 * m);
    o.c.lerp(_c.copy(GRASS[0]).lerp(GRASS[1], m), grass);
    const snow = smooth(150 + 40 * m, 185 + 40 * m, y) * (1 - smooth(0.5, 0.75, slope));
    o.c.lerp(SNOW, snow);
    o.c.lerp(WET, (1 - smooth(0.5, 4, y)) * 0.7);
    o.c.lerp(FOAM, (1 - smooth(0.2, 1.4, Math.abs(y - 0.2))) * smooth(0.15, 0.4, slope) * 0.85);
    o.d[0] = grass * 0.5;
    o.d[1] = Math.max(0, 1 - grass - snow);
  };
  const mat = landMat(view, { fogK: 0.3 });
  view.root.add(ringMesh(NA, NR, r0, r1, height, paint, mat));

  // On the highest tops: masts with red lights. On the nearest high stack: a lighthouse turning its beam.
  const tops = [];
  for (let k = 0; k < 900; k++) {
    const a = R() * TAU, r = 175 + R() * 480, x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
    if (y > 10 && upOf(height, x, z) > 0.75) tops.push({ x, y, z, r });
  }
  tops.sort((a, b) => b.y - a.y);
  const masts = [], bits = new Bits(), metal = C(0x2a2d34);
  for (const t of tops) {
    if (masts.length >= [5, 7, 9][d]) break;
    if (masts.some((m) => Math.hypot(m.x - t.x, m.z - t.z) < 110)) continue;
    masts.push(t);
    const h = 36 + R() * 30;
    // Three legs leaning in and rings of struts.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU, bx = Math.cos(a) * 3, bz = Math.sin(a) * 3;
      bits.add(CYL, M(t.x + bx, t.y - 2, t.z + bz, 0.22, h + 2, 0.22, Math.atan2(3, h) * Math.cos(a), 0, -Math.atan2(3, h) * Math.sin(a) * -1), metal);
    }
    for (let y = 6; y < h; y += 8) bits.add(BOX, M(t.x, t.y + y, t.z, 3 * (1 - y / h) * 1.8 + 0.4, 0.2, 3 * (1 - y / h) * 1.8 + 0.4), metal);
    t.h = h;
  }
  const lh = tops.filter((t) => t.r < 300 && !masts.includes(t))[0];
  if (lh) {
    // White and red, a black lantern room on top.
    const base = lh.y - 1, white = C(0xe8e4dc), red = C(0xa82420);
    for (let k = 0; k < 6; k++) bits.add(CYL, M(lh.x, base + k * 3, lh.z, 2.6 - k * 0.14, 3, 2.6 - k * 0.14), k % 2 ? red : white, ZERO, 0.85);
    bits.add(CYL, M(lh.x, base + 18, lh.z, 2.6, 0.5, 2.6), C(0x202226));
    bits.add(CONE, M(lh.x, base + 21.5, lh.z, 1.9, 2.2, 1.9), C(0x202226));
  }
  view.root.add(bits.mesh(mat));
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 8, 6), new THREE.MeshBasicMaterial({ color: HDR(0xff3040, 3), fog: false }), Math.max(1, masts.length * 2));
  lights.count = masts.length * 2;
  masts.forEach((t, i) => {
    lights.setMatrixAt(i * 2, M(t.x, t.y + t.h + 0.6, t.z, 1));
    lights.setMatrixAt(i * 2 + 1, M(t.x, t.y + t.h * 0.55, t.z, 0.7));
  });
  view.root.add(lights);
  view.blink.push({ m: lights.material, base: 3, hex: 0xff3040, sp: 1.6, sq: true });
  if (lh) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), new THREE.MeshBasicMaterial({ color: HDR(0xfff0c0, 4), fog: false }));
    lamp.position.set(lh.x, lh.y + 19.6, lh.z);
    // Two beams, sweeping round. Brightest at the lamp, fading out along their length.
    const beamM = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uC: { value: HDR(0xfff2c8, 0.55) } },
      vertexShader: 'varying float vL; void main(){ vL = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uC; varying float vL;
        void main(){ gl_FragColor = vec4(uC * vL * vL, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const bg = new THREE.ConeGeometry(11, 170, 20, 1, true).translate(0, -85, 0).rotateZ(Math.PI / 2 + 0.06);
    const beam = new THREE.Group();
    beam.add(new THREE.Mesh(bg, beamM), new THREE.Mesh(bg.clone().rotateY(Math.PI), beamM));
    beam.position.copy(lamp.position);
    beam.userData.anim = true;
    view.anim.push(beam);
    view.onFrame.push((t) => { beam.rotation.y = t * 0.7; });
    view.root.add(lamp, beam);
  }
}

// ---------------------------------------------------------------- Sunny Isles
export function sunnyLands(view) {
  const d = detail(), NA = [128, 200, 256][d], NR = [36, 52, 66][d], r0 = 150, r1 = 920, R = rng(7202);
  const N1 = vnoise(71), N2 = vnoise(72), N3 = vnoise(73), N4 = vnoise(74), fbm = fbmOf(N1), ridged = ridgedOf(N2);
  // Islands with white beaches, some of them with sharp green peaks of old volcanoes.
  const height = (x, z) => {
    const r = Math.hypot(x, z), n = fbm(x * 0.0044 + 1.3, z * 0.0044 + 4.1);
    const isl = smooth(0.53, 0.6, n) * smooth(185, 245, r) * (1 - smooth(r1 - 170, r1 - 40, r));
    const peak = smooth(0.6, 0.72, n) * (0.35 + 0.65 * N3(x * 0.004 + 7, z * 0.004 + 2));
    return -9 + isl * (11 + 22 * fbm(x * 0.02, z * 0.02) + peak * (50 + 120 * Math.pow(ridged(x * 0.0065, z * 0.0065), 1.25) + 70 * Math.pow(ridged(x * 0.016 + 3, z * 0.016 + 1), 2)));
  };
  const SAND = C(0xf2e3b6), WETSAND = C(0xc9b88c), JUNGLE = [C(0x2c6424), C(0x4c8c34)], GRASS = C(0x77a845), ROCK = [C(0x3f4636), C(0x5d5e4a)], _c = new THREE.Color();
  const cover = (x, y, z, up) => {
    const slope = 1 - up, m = N4(x * 0.02, z * 0.02);
    const beach = 1 - smooth(2.2, 4.2, y);
    const rock = smooth(0.66, 0.84, slope) * smooth(6, 14, y) * (0.5 + 0.5 * m);
    const jungle = (1 - beach) * (1 - rock) * (1 - smooth(150, 210, y)) * (0.75 + 0.25 * m);
    return { beach, rock, jungle, grass: (1 - beach) * (1 - rock) * (1 - jungle) };
  };
  const paint = (p, n, o) => {
    const c = cover(p.x, p.y, p.z, n.y), m = N1(p.x * 0.03 + 4, p.z * 0.03 + 8);
    o.c.copy(ROCK[0]).lerp(ROCK[1], m);
    o.c.lerp(GRASS, c.grass);
    o.c.lerp(_c.copy(JUNGLE[0]).lerp(JUNGLE[1], m), c.jungle);
    o.c.lerp(_c.copy(WETSAND).lerp(SAND, smooth(0.2, 1.4, p.y)), c.beach);
    o.d[0] = c.jungle * 0.9;
    o.d[1] = c.rock;
  };
  const mat = landMat(view, { fogK: 0.5, side: THREE.DoubleSide });
  view.root.add(ringMesh(NA, NR, r0, r1, height, paint, mat));
  // Palms along the beaches and jungle crowns up the slopes, a build step of their own.
  const trees = () => {
    const bits = new Bits(), nP = [400, 1000, 1400][d], nJ = [800, 2000, 2800][d], col = new THREE.Color();
    for (let n = 0, tries = 0; n < nP && tries < nP * 30; tries++) {
      const a = R() * TAU, r = 190 + Math.pow(R(), 1.4) * 520, x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
      if (y < 1.2 || y > 14) continue;
      const up = upOf(height, x, z);
      if (up < 0.8) continue;
      const s = (1.6 + R() * 1.2) * (r > 400 ? 1.4 : 1);
      col.setHSL(0.27 + R() * 0.05, 0.5, 0.26 + R() * 0.08);
      bits.add(PALM, M(x, y - 0.3, z, s, s * (0.9 + R() * 0.5), s, 0, R() * TAU, 0), col, [0.3, 0, 0], 0.55);
      n++;
    }
    for (let n = 0, tries = 0; n < nJ && tries < nJ * 12; tries++) {
      const a = R() * TAU, r = 190 + Math.pow(R(), 1.3) * 560, x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
      if (y < 3.5) continue;
      if (R() > cover(x, y, z, upOf(height, x, z)).jungle) continue;
      const s = (3 + R() * 3.5) * (r > 400 ? 1.5 : 1);
      col.copy(JUNGLE[0]).lerp(JUNGLE[1], R()).multiplyScalar(0.85 + R() * 0.35);
      bits.add(CROWN, M(x, y - s * 0.3, z, s, s * 0.8, s, R(), R() * TAU, 0), col, [0.8, 0, 0], 0.6);
      n++;
    }
    const m = bits.mesh(mat);
    if (m) view.root.add(m);
  };
  if (view.steps && view.steps.length) view.steps.unshift(trees);
  else trees();
}

// ---------------------------------------------------------------- Volcano
export function calderaLands(view) {
  const d = detail(), NU = [128, 200, 256][d], NV = [44, 60, 76][d], R = rng(3303);
  const N1 = vnoise(81), N2 = vnoise(82), N3 = vnoise(83), N4 = vnoise(84), ridged = ridgedOf(N2);
  // Round the circle without a seam: noise read on a circle.
  const ring = (N, a, k, o = 0) => N(Math.cos(a) * k + o, Math.sin(a) * k + o);
  const falls = [];
  for (let k = 0, n = [7, 10, 13][d]; k < n; k++) falls.push({ a: (k / n) * TAU + (R() - 0.5) * 0.35, top: 70 + R() * 260, w: 10 + R() * 9, ph: R() * 9 });
  // The inner wall leans back and steps out in ledges, cut by gullies; over the rim it goes down the outside into the haze.
  const wallAt = (a, t, p) => {
    const rb = 178 + 46 * ring(N1, a, 2.1), H = 400 + 260 * ring(N3, a, 1.6, 5), u = a * 230;
    let y, r;
    if (t < 0.82) {
      const s = Math.pow(t / 0.82, 1.12);
      y = -5 + (H + 5) * s;
      const lv = y / 52 + ring(N4, a, 3) * 2.5;
      r = rb + 0.26 * y + 9 * (Math.floor(lv) + smooth(0.72, 1, lv - Math.floor(lv)));
    } else {
      const lv = H / 52 + ring(N4, a, 3) * 2.5, rH = rb + 0.26 * H + 9 * (Math.floor(lv) + smooth(0.72, 1, lv - Math.floor(lv)));
      const s = (t - 0.82) / 0.18;
      y = H + 14 * Math.sin(Math.min(1, s * 4) * Math.PI * 0.5) - 260 * smooth(0.2, 1, s);
      r = rH + 30 * Math.min(1, s * 4) + 520 * smooth(0.2, 1, s);
    }
    // Gullies down the wall.
    r += 13 * (ridged(u * 0.012, y * 0.004) - 0.45) + 5 * (N1(u * 0.05, y * 0.03) - 0.5);
    p.set(Math.cos(a) * r, y, Math.sin(a) * r);
  };
  const BASALT = [C(0x342a25), C(0x54463d)], RUST = C(0x6a3a24), ASH = C(0x80766e), SULFUR = C(0xa89a38), _c = new THREE.Color();
  const paint = (p, n, o) => {
    const a = Math.atan2(p.z, p.x), y = p.y, r = Math.hypot(p.x, p.z), m = N1(p.x * 0.03, p.z * 0.03 + y * 0.02);
    o.c.copy(BASALT[0]).lerp(BASALT[1], m);
    o.c.lerp(RUST, smooth(0.55, 0.8, N3(y * 0.035, a * 3)) * 0.65);
    const ash = smooth(0.45, 0.75, n.y) * smooth(4, 20, y);
    o.c.lerp(ASH, ash * 0.85);
    o.c.lerp(SULFUR, smooth(0.78, 0.9, N4(p.x * 0.02 + 3, p.z * 0.02 + y * 0.01)) * (1 - smooth(60, 160, y)) * 0.6);
    o.d[1] = 1 - ash * 0.6;
    // What glows: the foot of the wall over the lava and cracks low down.
    let g = Math.max((1 - smooth(-2, 9, y)) * 0.55, 0.13 * (1 - smooth(0, 110, y)));
    g = Math.max(g, smooth(0.88, 0.96, ridged(a * 40, y * 0.02)) * (1 - smooth(30, 140, y)) * 0.55);
    o.d[2] = Math.min(1, g);
  };
  const mat = landMat(view, { mode: 'lava', glow: 0xff4a10, glow2: 0xffa030, glowK: 1.5, fogK: 0.34, side: THREE.DoubleSide });
  view.root.add(gridMesh(NU, NV, (u, v, p) => wallAt((u / NU) * TAU, v / (NV - 1), p), paint, mat));
  // The lava falls: ribbons lying on the wall from their vent down to the lake, over every ledge on the way, hottest
  // down the middle. Each row is the wall's own point at that height, a little out from it.
  const ribbons = new Bits(), crust = C(0x2a1a12), wp = new THREE.Vector3();
  for (const f of falls) {
    const H = 400 + 260 * ring(N3, f.a, 1.6, 5), rows = [];
    for (let y = Math.min(f.top, H - 20); y > -5; y -= 3) {
      const t = 0.82 * Math.pow(Math.max(0, (y + 5) / (H + 5)), 1 / 1.12), am = f.a + 0.05 * Math.sin(y * 0.021 + f.ph), row = [];
      for (const k of [-1, 0, 1]) {
        wallAt(am + (k * f.w * 0.5) / 200, t, wp);
        const r = Math.hypot(wp.x, wp.z), in1 = (r - 1.5) / r;
        row.push([wp.x * in1, y + (k === 0 ? 0 : 0.6), wp.z * in1]);
      }
      rows.push(row);
    }
    if (rows.length < 2) continue;
    const base = ribbons.p.length / 3;
    rows.forEach((row, j) => row.forEach((q, k) => {
      ribbons.p.push(q[0], q[1], q[2]);
      ribbons.n.push(-q[0] / Math.hypot(q[0], q[2]), 0, -q[2] / Math.hypot(q[0], q[2]));
      ribbons.c.push(crust.r, crust.g, crust.b);
      // Cooling at the edges, and just out of the vent.
      ribbons.d.push(0, 0.6, (k === 1 ? 0.8 : 0.08) * smooth(0, 3, j));
    }));
    for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < 2; k++) {
      const a = base + j * 3 + k, b = a + 1, c = a + 3, e = b + 3;
      ribbons.i.push(a, c, b, b, c, e);
    }
  }
  const rm = ribbons.mesh(mat);
  if (rm) view.root.add(rm);
  // Small cones out in the lava lake, glowing in their craters and down one side.
  const cones = [];
  for (let k = 0; k < 40 && cones.length < [2, 3, 4][d]; k++) {
    const a = R() * TAU, r = 160 + R() * 60 + 0, s = 26 + R() * 18;
    const rb = 178 + 46 * ring(N1, a, 2.1);
    if (r + s > rb - 4 || r - s < 150 || cones.some((c) => Math.hypot(c.x - Math.cos(a) * r, c.z - Math.sin(a) * r) < c.s + s + 10)) continue;
    cones.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s, h: s * (0.7 + R() * 0.5), side: R() * TAU });
  }
  for (const c of cones) {
    const NUc = 40, NVc = 12;
    const coneMesh = gridMesh(NUc, NVc, (u, v, p) => {
      const a = (u / NUc) * TAU, t = v / (NVc - 1), rr = t * c.s * (1 + 0.12 * (N2(Math.cos(a) * 2 + c.x, Math.sin(a) * 2) - 0.5));
      // A bowl inside the crater, the rim, then down the outside under the lava.
      const y = t < 0.28 ? c.h - 7 + 7 * smooth(0, 0.28, t) : c.h * (1 - Math.pow((t - 0.28) / 0.72, 0.8)) - 3 * smooth(0.8, 1, t);
      p.set(c.x + Math.cos(a) * rr, y, c.z + Math.sin(a) * rr);
    }, (p, n, o) => {
      paint(p, n, o);
      const rr = Math.hypot(p.x - c.x, p.z - c.z), a = Math.atan2(p.z - c.z, p.x - c.x);
      let da = a - c.side;
      da -= Math.round(da / TAU) * TAU;
      const crater = 1 - smooth(0.2, 0.3, rr / c.s), stream = (1 - smooth(2, 5, Math.abs(da) * rr)) * smooth(0.25, 0.35, rr / c.s);
      o.d[2] = Math.max(o.d[2], crater, stream * 0.9);
    }, mat);
    view.root.add(coneMesh);
  }
}

// ---------------------------------------------------------------- Neon City
export function cityLands(view) {
  const d = detail(), R = rng(4244), bits = new Bits(), out = new THREE.Color(), _c = new THREE.Color();
  const mat = landMat(view, { mode: 'windows', glow: 0xffd9a0, glow2: 0x9ad8ff, glowK: 1.7, fogK: 0.45 });
  // The bridge: across the bay at one side, its ends on the shore among the towers.
  const ba = 0.9, bd = 270, bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd, tx = -Math.sin(ba), tz = Math.cos(ba), half = 175;
  // The shore all round, but for the river the bridge crosses: the towers stand on land, the bridge's own towers in the water.
  const N1 = vnoise(91), N2 = vnoise(92), fbm = fbmOf(N1);
  const shoreR = (x, z) => 182 + 14 * N2(x * 0.02, z * 0.02);
  const river = (x, z) => x * Math.cos(ba) + z * Math.sin(ba) > 0 && Math.abs(x * tx + z * tz) < 112;
  const nearBridge = (x, z, rad) => {
    const u = (x - bx) * tx + (z - bz) * tz, w = (x - bx) * Math.cos(ba) + (z - bz) * Math.sin(ba);
    return Math.abs(u) < half + 40 + rad && Math.abs(w) < 40 + rad;
  };
  const FACADE = [0x1b2130, 0x232a3a, 0x2c303c, 0x342e2a, 0x1e2a2e, 0x2a2440].map(C), NEON = [0xff2a8a, 0x2ad8ff, 0xb05aff, 0xff8a2a, 0x3aff9a].map(C);
  // Round towers, tapering ones, octagons, wedding cakes of round tiers and now and then a slab. Taller downtown (one side
  // of the bay) and along the shore, lower out at the edges.
  const KINDS = ['round', 'round', 'taper', 'oct', 'tiers', 'box'];
  const towers = [], nB = [110, 190, 260][d];
  for (let tries = 0; towers.length < nB && tries < nB * 20; tries++) {
    const a = R() * TAU, r = 160 + Math.pow(R(), 1.1) * 470, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 14 + R() * 20, rad = w * 0.75;
    if (r < shoreR(x, z) + rad + 3 || river(x, z) || Math.abs(x * tx + z * tz) < 112 + rad && x * Math.cos(ba) + z * Math.sin(ba) > 0 || nearBridge(x, z, rad) || towers.some((t) => Math.hypot(t.x - x, t.z - z) < (t.w + w) * 0.62 + 4)) continue;
    const downtown = Math.max(0, Math.cos(a - 3.6)) * (1 - smooth(260, 560, r)), shore = 1 - smooth(200, 330, r);
    const h = 30 + (70 + 280 * downtown + 120 * shore) * Math.pow(R(), 1.4) + 60 * downtown;
    towers.push({ x, z, w, h, kind: KINDS[(R() * KINDS.length) | 0] });
  }
  // Landmarks downtown, far taller than the rest: a needle with a lit pod, a tapering giant, a tiered one, a round one.
  for (let k = 0, tries = 0; k < 4 && tries < 300; tries++) {
    const a = 3.6 + (R() - 0.5) * 1.6, r = 230 + R() * 200, x = Math.cos(a) * r, z = Math.sin(a) * r, w = 26 + R() * 10;
    if (river(x, z) || nearBridge(x, z, w) || towers.some((t) => t.mark && Math.hypot(t.x - x, t.z - z) < 70)) continue;
    for (let i = towers.length - 1; i >= 0; i--) if (!towers[i].mark && Math.hypot(towers[i].x - x, towers[i].z - z) < (towers[i].w + w) * 0.62 + 6) towers.splice(i, 1);
    towers.push({ x, z, w, h: 380 + R() * 200, kind: ['needle', 'taper', 'tiers', 'round'][k], mark: true });
    k++;
  }
  const ROUND = new THREE.CylinderGeometry(1, 1, 1, 20, 1).translate(0, 0.5, 0), TAPER = new THREE.CylinderGeometry(0.6, 1, 1, 20, 1).translate(0, 0.5, 0);
  const OCT = new THREE.CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0), BAND = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  const DOME = new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, Math.PI / 2);
  // A round wall's detail: its windows' radius, so a whole number of them goes round.
  const roundD = (seed, lit, r) => [seed, -(Math.max(3, Math.round((TAU * r) / 2.4)) * 2.4) / TAU, lit];
  const lamp = [0, 2, 0], steelC = C(0x606878), red = C(0xff2030);
  towers.forEach((t, i) => {
    const seed = (i * 0.618) % 1, lit = 0.25 + R() * 0.35, r = t.w / 2, nc = NEON[(R() * NEON.length) | 0];
    out.copy(FACADE[(R() * FACADE.length) | 0]).multiplyScalar(0.8 + R() * 0.4);
    let rt = r;
    if (t.kind === 'box') {
      bits.add(BOX, M(t.x, -2, t.z, t.w, t.h + 2, t.w * (0.7 + R() * 0.3)), out, [seed, 1, lit]);
      rt = r * 0.6;
    } else if (t.kind === 'tiers') {
      let y = -2, rr = r;
      const n = 2 + ((R() * 2) | 0);
      for (let k = 0; k < n; k++) {
        const hk = k === n - 1 ? t.h - y : (t.h + 2) * (k === 0 ? 0.5 : 0.22);
        bits.add(ROUND, M(t.x, y, t.z, rr, hk, rr), out, roundD(seed, lit, rr));
        bits.add(BAND, M(t.x, y + hk - 1.4, t.z, rr + 0.3, 0.7, rr + 0.3), nc, lamp);
        y += hk;
        if (k < n - 1) rr *= 0.72;
      }
      rt = rr;
    } else if (t.kind === 'needle') {
      // A slim shaft, a wide round pod of lit windows high up, a mast.
      const pod = t.h * 0.78;
      bits.add(ROUND, M(t.x, -2, t.z, 6, t.h + 2, 6), out, roundD(seed, lit, 6));
      bits.add(ROUND, M(t.x, pod, t.z, 22, 12, 22), out, roundD(seed, 0.7, 22));
      for (const dy of [-0.4, 12]) bits.add(BAND, M(t.x, pod + dy, t.z, 22.4, 0.8, 22.4), nc, lamp);
      rt = 5;
    } else {
      const geo = t.kind === 'taper' ? TAPER : t.kind === 'oct' ? OCT : ROUND;
      bits.add(geo, M(t.x, -2, t.z, r, t.h + 2, r), out, roundD(seed, lit, t.kind === 'taper' ? r * 0.8 : r));
      if (t.kind === 'taper') rt = r * 0.6;
      // Neon: rings of light up it, or strips from the ground to the roof.
      if (R() < 0.5) {
        for (let y = 26 + R() * 20; y < t.h - 8; y += 40 + R() * 30) {
          const rr = (t.kind === 'taper' ? r * (1 - (0.4 * (y + 2)) / (t.h + 2)) : r) + 0.3;
          bits.add(BAND, M(t.x, y, t.z, rr, 0.8, rr), nc, lamp);
        }
      } else if (t.kind !== 'taper') {
        for (let k = 0; k < 4; k++) { const b = (k * Math.PI) / 2 + i; bits.add(BOX, M(t.x + Math.cos(b) * (r + 0.2), -2, t.z + Math.sin(b) * (r + 0.2), 0.5, t.h + 2, 0.5), nc, lamp); }
      }
    }
    // The top: a spire with a red light, a dome, a ring of light, or plant rooms.
    const top = t.h, k = t.mark ? 0 : R();
    if (k < 0.22) {
      const sh = t.mark ? 70 : 24 + R() * 16;
      bits.add(CYL, M(t.x, top, t.z, 0.6, sh, 0.6), steelC);
      bits.add(BOX, M(t.x, top + sh, t.z, 1.6, 1.6, 1.6), red, lamp);
    } else if (k < 0.45 && t.kind !== 'box') bits.add(DOME, M(t.x, top, t.z, rt * 0.92, rt * 0.55, rt * 0.92), _c.copy(out).multiplyScalar(0.8), [seed, 0, 0]);
    else if (k < 0.7) bits.add(BAND, M(t.x, top - 3, t.z, rt + 0.4, 1, rt + 0.4), nc, lamp);
    else {
      bits.add(BOX, M(t.x + (R() - 0.5) * rt * 0.4, top, t.z + (R() - 0.5) * rt * 0.4, rt * 0.7, 4 + R() * 4, rt * 0.7), _c.copy(out).multiplyScalar(0.8), [seed, 0, 0]);
      if (t.h > 110) bits.add(BOX, M(t.x, top + 9, t.z, 1.2, 1.2, 1.2), red, lamp);
    }
  });
  // The bridge: towers, the deck, cables hung with lights.
  const steel = C(0x3a3e48), deckY = 20, along = (u, y, w = 0) => [bx + tx * u + Math.cos(ba) * w, y, bz + tz * u + Math.sin(ba) * w];
  const ry = Math.atan2(tx, tz);
  {
    const [x, , z] = along(0, 0);
    bits.add(BOX, M(x, deckY - 1.5, z, 22, 3, half * 2, 0, ry), steel);
    for (const s of [-1, 1]) for (let k = 0; k < half * 2; k += 8) { const [lx, , lz] = along(-half + k + 4, 0, s * 10.5); bits.add(BOX, M(lx, deckY + 1.5, lz, 0.5, 0.5, 0.5), C(0xffd890), lamp); }
  }
  const tH = 120, tu = half * 0.56;
  for (const su of [-1, 1]) {
    for (const sw of [-1, 1]) {
      const [x, , z] = along(su * tu, 0, sw * 9);
      bits.add(BOX, M(x, -4, z, 3.2, tH + 4, 3.2, 0, ry), steel);
    }
    for (const y of [deckY + 8, tH * 0.6, tH - 6]) { const [x, , z] = along(su * tu, 0); bits.add(BOX, M(x, y, z, 21, 3, 3, 0, ry), steel); }
    const [x, , z] = along(su * tu, 0);
    bits.add(BOX, M(x, tH + 0.5, z, 2, 2, 2), C(0xff2030), lamp);
  }
  // The cables: between the towers a hanging curve, out to the ends straight down to the deck. Lights on them all along.
  const cable = (u0, y0, u1, y1, sag, sw) => {
    const n = 22;
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const f = k / n, u = u0 + (u1 - u0) * f, y = y0 + (y1 - y0) * f - sag * 4 * f * (1 - f), p = along(u, y, sw);
      if (prev) {
        const dx = p[0] - prev[0], dy = p[1] - prev[1], dz = p[2] - prev[2], len = Math.hypot(dx, dy, dz);
        _v.set(dx, dy, dz).normalize();
        _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
        _m.compose(_p.set(prev[0], prev[1], prev[2]), _q, _s.set(0.5, len, 0.5));
        bits.add(CYL, _m, steel);
        if (k % 2 === 0) bits.add(BOX, M(p[0], p[1] - 0.4, p[2], 0.8, 0.8, 0.8), C(0xfff4d0), lamp);
        // Hangers down to the deck.
        if (k % 2 === 1 && y > deckY + 3) bits.add(BOX, M(p[0], deckY, p[2], 0.25, y - deckY, 0.25), steel);
      }
      prev = p;
    }
  };
  for (const sw of [-9, 9]) {
    cable(-tu, tH, tu, tH, tH - deckY - 6, sw);
    cable(-half, deckY + 2, -tu, tH, -8, sw);
    cable(tu, tH, half, deckY + 2, -8, sw);
  }
  view.root.add(bits.mesh(mat));
  // Behind it all, dark hills with the lights of the towns on them.
  const height = (x, z) => {
    const r = Math.hypot(x, z), land = smooth(-3, 1, r - shoreR(x, z)) * (1 - (1 - smooth(-6, 2, Math.abs(x * tx + z * tz) - 108)) * smooth(-20, 0, x * Math.cos(ba) + z * Math.sin(ba)) * (1 - smooth(640, 700, r)));
    return -6 + 7.4 * land + smooth(620, 720, r) * (20 + 150 * fbm(x * 0.004, z * 0.004) * (0.4 + 0.6 * N2(x * 0.002, z * 0.002)));
  };
  const GROUND = [C(0x15171d), C(0x22242a)], HILL = [C(0x161a24), C(0x222a2c)], QUAY = C(0x4a4c52);
  const hills = landMat(view, { mode: 'lights', glow: 0xffc070, glow2: 0xfff0d8, glowK: 2.2, fogK: 0.42 });
  view.root.add(ringMesh([160, 240, 300][d], [40, 54, 66][d], 172, 1100, height, (p, n, o) => {
    const r = Math.hypot(p.x, p.z), hill = smooth(640, 700, r), m = N2(p.x * 0.01, p.z * 0.01);
    o.c.copy(GROUND[0]).lerp(GROUND[1], m).lerp(_c.copy(HILL[0]).lerp(HILL[1], m), hill);
    o.c.lerp(QUAY, (1 - smooth(0.25, 0.6, n.y)) * (1 - hill));
    o.d[0] = 0.4 * hill;
    // Street lights all over the town, the lights of villages on the hills.
    const town = smooth(0.8, 1.3, p.y) * (1 - hill) * (0.45 + 0.55 * N1(p.x * 0.01 + 3, p.z * 0.01 + 1));
    const vill = hill * smooth(2, 8, p.y) * (1 - smooth(70, 120, p.y)) * smooth(0.4, 0.62, N1(p.x * 0.006 + 3, p.z * 0.006 + 1)) * smooth(0.75, 0.9, n.y);
    o.d[2] = Math.max(town * 0.75, vill);
  }, hills));
}

// ---------------------------------------------------------------- Waterfall
export function fallLands(view) {
  const d = detail(), R = rng(5150), N1 = vnoise(101), N2 = vnoise(102), N3 = vnoise(103), N4 = vnoise(104), fbm = fbmOf(N1), ridged = ridgedOf(N2);
  const mat = landMat(view, { mode: 'falls', fogK: 0.24 });
  const ROCK = [C(0x564f44), C(0x80755f)], DARK = C(0x2a2723), MOSS = [C(0x1f5420), C(0x4a8a30)], _c = new THREE.Color();
  // Jungle on the tops and ledges, and the falls themselves as sheets of water, a build step of their own.
  const bits = new Bits(), sheets = [], col = new THREE.Color();
  const jungle = (x, y, z, s, k = 1) => {
    col.copy(MOSS[0]).lerp(MOSS[1], R()).multiplyScalar(0.8 + R() * 0.4);
    if (R() < 0.18 * k) bits.add(PALM, M(x, y - 0.5, z, s * 0.55, s * (0.5 + R() * 0.3), s * 0.55, 0, R() * TAU, 0), col, [0.3, 0, 0], 0.55);
    else bits.add(CROWN, M(x, y - s * 0.3, z, s, s * (0.6 + R() * 0.4), s, R(), R() * TAU, 0), col, [0.8, 0, 0], 0.55);
  };
  // Rock pillars with green on their ledges and tops; white water down the side that faces the lagoon on some.
  const pillars = [], nPil = [8, 11, 14][d];
  for (let tries = 0; pillars.length < nPil && tries < 400; tries++) {
    const a = R() * TAU, r = 230 + R() * 230, rad = 18 + R() * 26, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad + 22)) continue;
    pillars.push({ x, z, rad, h: 90 + R() * 150, s: R() * 50, fall: R() < 0.6, face: Math.atan2(-z, -x) + (R() - 0.5) * 0.6 });
  }
  for (const P of pillars) {
    const NU = [22, 30, 36][d], NV = [16, 22, 28][d], top = 0.86;
    const mesh = gridMesh(NU, NV, (u, v, p) => {
      const a = (u / NU) * TAU, t = v / (NV - 1);
      let y, r;
      if (t < top) {
        y = -6 + (P.h + 6) * (t / top);
        // Narrowing upward, fluted by the rain, with a bulge of harder rock here and there.
        r = P.rad * (1.12 - 0.22 * (y / P.h)) * (0.84 + 0.16 * N3(Math.cos(a) * 1.7 + P.s, Math.sin(a) * 1.7 + y * 0.012) + 0.08 * N1(Math.cos(a) * 4 + P.s, y * 0.05)
          + 0.12 * (ridged(Math.cos(a) * 2.6 + P.s, Math.sin(a) * 2.6 + y * 0.004) - 0.45) + 0.06 * smooth(0.6, 0.8, N4(y * 0.04 + P.s, a)));
      } else {
        // Over the top: a rounded cap of green.
        const s = (t - top) / (1 - top);
        y = P.h + 7 * Math.sin(s * Math.PI * 0.5);
        r = P.rad * 0.9 * (0.86 + 0.16 * N3(Math.cos(a) * 1.7 + P.s, Math.sin(a) * 1.7 + P.h * 0.012)) * Math.cos(s * Math.PI * 0.5);
      }
      p.set(P.x + Math.cos(a) * r, y, P.z + Math.sin(a) * r);
    }, (p, n, o) => {
      const a = Math.atan2(p.z - P.z, p.x - P.x), m = N4(p.x * 0.05, p.y * 0.03 + p.z * 0.05);
      o.c.copy(ROCK[0]).lerp(ROCK[1], N1(a * 3 + P.s, p.y * 0.08));
      o.c.lerp(DARK, smooth(0.6, 0.85, N2(a * 9 + P.s, p.y * 0.01)) * 0.6);
      const green = Math.max(smooth(0.35, 0.6, n.y), smooth(0.62, 0.8, m) * 0.8, smooth(P.h - 14, P.h - 2, p.y));
      o.c.lerp(_c.copy(MOSS[0]).lerp(MOSS[1], m), green);
      o.d[0] = green * 0.8;
      o.d[1] = 1 - green;
      if (P.fall) {
        let da = a - P.face;
        da -= Math.round(da / TAU) * TAU;
        o.d[2] = (1 - smooth(0.06, 0.16, Math.abs(da))) * smooth(P.h + 2, P.h - 6, p.y);
      }
    }, mat, true);
    view.root.add(mesh);
    // A crown of jungle over the top, trees hanging on round its rim.
    const nC = [14, 26, 36][d];
    for (let k = 0; k < nC; k++) {
      const a = R() * TAU, u = Math.sqrt(R()) * 0.85, x = P.x + Math.cos(a) * P.rad * 0.9 * u, z = P.z + Math.sin(a) * P.rad * 0.9 * u;
      jungle(x, P.h + 7 * Math.cos(u * Math.PI * 0.5) - 1, z, 4 + R() * 4);
    }
    if (P.fall) {
      // Pouring off the lip and clear of the rock all the way down.
      const w = 5 + P.rad * 0.18, top = P.h + 2, ca = Math.cos(P.face), sa = Math.sin(P.face);
      sheets.push({ x0: P.x + ca * P.rad * 0.86, z0: P.z + sa * P.rad * 0.86, x1: P.x + ca * (P.rad * 1.45 + 6), z1: P.z + sa * (P.rad * 1.45 + 6), y0: top, y1: -2, w, face: P.face });
      const fd = P.rad * 1.45 + 6;
      view.mistSpots.push({ x: P.x + ca * fd, y: 0, z: P.z + sa * fd, r: w * 0.7, n: 16, rise: 14 });
    }
  }
  // All round, far off: high green cliffs with a jungle on top and many falls down their faces.
  // Two steps of cliffs, cut into bays and headlands, a jungle on the ledge between them and on top.
  const height = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), ca = Math.cos(a), sa = Math.sin(a);
    const edge = 590 + 70 * N3(ca * 2.2, sa * 2.2) + 38 * (N1(ca * 9 + 2, sa * 9 + 2) - 0.5), edge2 = edge + 60 + 50 * N2(ca * 4 + 7, sa * 4 + 7);
    const c1 = smooth(edge - 22, edge + 6, r), c2 = smooth(edge2 - 20, edge2 + 8, r);
    return -8 + smooth(520, 560, r) * (6 + 14 * fbm(x * 0.01, z * 0.01)) + c1 * (95 + 55 * N4(x * 0.004, z * 0.004)) + c2 * (90 + 130 * N4(x * 0.0025 + 5, z * 0.0025) + 60 * ridged(x * 0.005, z * 0.005));
  };
  const fallAt = (a) => smooth(0.66, 0.7, N1(Math.cos(a) * 26 + 4, Math.sin(a) * 26 + 4));
  view.root.add(ringMesh([128, 220, 300][d], [26, 34, 42][d], 500, 1150, height, (p, n, o) => {
    const a = Math.atan2(p.z, p.x), m = N4(p.x * 0.02, p.z * 0.02), steep = 1 - smooth(0.35, 0.65, n.y);
    o.c.copy(ROCK[0]).lerp(ROCK[1], N1(a * 30, p.y * 0.05));
    o.c.lerp(DARK, steep * smooth(0.5, 0.8, N3(a * 140, p.y * 0.006)) * 0.7);
    o.c.lerp(_c.copy(MOSS[0]).lerp(MOSS[1], m), (1 - steep) * smooth(-2, 2, p.y));
    o.c.lerp(MOSS[0], steep * smooth(0.5, 0.72, N2(a * 60, p.y * 0.02)) * 0.85);
    o.d[0] = (1 - steep) * 0.9;
    o.d[1] = steep;
    o.d[2] = steep * fallAt(a) * smooth(4, 20, p.y);
  }, mat));
  // The jungle along the tops of the cliffs and on the ledge between the two steps.
  const nJ = [700, 1600, 2400][d];
  for (let n = 0, tries = 0; n < nJ && tries < nJ * 10; tries++) {
    const a = R() * TAU, r = 520 + R() * 600, x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
    if (y < 30 || upOf(height, x, z) < 0.86) continue;
    jungle(x, y, z, (6 + R() * 6) * (r > 800 ? 1.4 : 1), 0.6);
    n++;
  }
  const finish = () => {
    const m = bits.mesh(mat);
    if (m) view.root.add(m);
    // The big falls off the pillars: a sheet each, wider at the foot, pouring at the speed of a long drop.
    const fm = fallMat(view, { speed: 0.9, alpha: 0.95 }), pos = [], uv = [], idx = [];
    for (const f of sheets) {
      const NS = 10, sx = -Math.sin(f.face), sz = Math.cos(f.face), b = pos.length / 3;
      for (let j = 0; j <= NS; j++) {
        const t = j / NS, q = Math.sqrt(t), x = f.x0 + (f.x1 - f.x0) * q, z = f.z0 + (f.z1 - f.z0) * q, y = f.y0 + (f.y1 - f.y0) * t, w = f.w * (0.8 + 0.5 * t);
        pos.push(x - sx * w, y, z - sz * w, x + sx * w, y, z + sz * w);
        uv.push(0, y * 0.04, 1, y * 0.04);
        if (j) idx.push(b + j * 2 - 2, b + j * 2 - 1, b + j * 2, b + j * 2 - 1, b + j * 2 + 1, b + j * 2);
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      view.root.add(new THREE.Mesh(g, fm));
    }
  };
  if (view.steps && view.steps.length) view.steps.unshift(finish);
  else finish();
}
