// The Wild Forest round the giant tree. On the island: a forest floor, spruces, firs, oaks, beeches, birches, pines and
// dead snags (the level's own trees and many more, densest at the edge), fallen logs, stumps, mossy rocks, ferns, shrubs,
// flowers and long grass. All round the lake: mountain ranges under forest, rock and snow, fading into the haze.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { noiseGlsl } from './pattern.js';
import { modelGeo, vegMat, detail } from './scenery.js';
import { mat4, merge } from './worldview.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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

const TREES = [['spruceT', 5], ['firT', 3], ['oakT', 2], ['beechT', 2], ['birchT', 2], ['pineT', 2], ['snagT', 0.6]];

export function buildWildForest(view) {
  const L = view.level, R = rng(2024), d = detail(), n3 = (a) => a[d] ?? a[1], G = 0.4;
  // Everything solid near the ground (the route, side trunks, piers, hidden courses): nothing may grow into it.
  const low = L.cols.filter((c) => c.kind !== 'dock' && c.kind !== 'core' && c.miny < 18 && c.maxy > -1);
  const trunks = [];
  const boxHit = (x, z, r) => low.some((c) => x + r > c.minx && x - r < c.maxx && z + r > c.minz && z - r < c.maxz);
  const free = (x, z, r) => !boxHit(x, z, r) && !trunks.some((t) => Math.hypot(x - t.x, z - t.z) < r + t.r);
  // The deer (scenery.js) walk only where this says the ground is clear.
  view.groundFree = free;
  let wsum = 0;
  for (const [, w] of TREES) wsum += w;
  const pick = () => { let x = R() * wsum; for (const [k, w] of TREES) if ((x -= w) <= 0) return k; return TREES[0][0]; };

  // The level's trees (placed clear of the route by level.js), then more: a real forest, thickest round the shore.
  const trees = L.decor.filter((t) => t.k === 'tree').map((t) => ({ x: t.x, y: t.y, z: t.z, s: t.s, ry: t.ry, k: pick() }));
  for (const t of trees) trunks.push({ x: t.x, z: t.z, r: 0.6 * t.s, cr: 3.2 * t.s });
  const want = n3([30, 70, 100]);
  for (let tries = 0, added = 0; added < want && tries < want * 30; tries++) {
    const edge = R() < 0.6, a = R() * TAU, r = edge ? 74 + R() * 12 : 26 + R() * 50, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 0.8 + R() * 0.55, cr = 3.2 * s;
    if (boxHit(x, z, cr * 0.9) || trunks.some((t) => Math.hypot(x - t.x, z - t.z) < (cr + t.cr) * 0.62)) continue;
    trees.push({ x, y: G, z, s, ry: R() * TAU, k: pick() });
    trunks.push({ x, z, r: 0.6 * s, cr });
    added++;
  }
  const band = view.band(0), col = new THREE.Color(), mat = vegMat();
  const byKind = new Map();
  for (const t of trees) { if (!byKind.has(t.k)) byKind.set(t.k, []); byKind.get(t.k).push(t); }
  for (const [k, list] of byKind) {
    const im = new THREE.InstancedMesh(modelGeo(k), mat, list.length);
    list.forEach((t, i) => {
      im.setMatrixAt(i, mat4(t.x, t.y, t.z, t.s, t.s * (0.92 + R() * 0.16), t.s, 0, t.ry, 0));
      im.setColorAt(i, col.setRGB(0.86 + R() * 0.18, 0.88 + R() * 0.16, 0.82 + R() * 0.14));
    });
    view.add(im);
    band.near.push(im);
    im.visible = band.on !== false;
  }
  // Seen from high up the climb: the same trees as plain cones.
  const trunk = new THREE.CylinderGeometry(0.3, 0.55, 6, 6).translate(0, 3, 0);
  const fol = merge([3.6, 6, 8.6].map((y, j) => ({ geo: new THREE.ConeGeometry(3.2 - j * 0.8, 4.4, 8), m: mat4(0, y, 0, 1, 1, 1, 0, j, 0), glow: null })));
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 }), trees.length);
  const fm = new THREE.InstancedMesh(fol, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), trees.length);
  trees.forEach((t, i) => {
    const m = mat4(t.x, t.y, t.z, t.s, t.s, t.s, 0, t.ry, 0);
    tm.setMatrixAt(i, m);
    fm.setMatrixAt(i, m);
    fm.setColorAt(i, col.setHSL(0.3 + R() * 0.05, 0.42, 0.17 + R() * 0.07));
  });
  view.add(tm, false); view.add(fm, false);
  band.far.push(tm, fm);
  for (const o of [tm, fm]) o.visible = band.on === false;

  // The floor: long grass, ferns in the shade of the trees, shrubs, flowers, mossy rocks, fallen logs and stumps.
  const put = new Map();
  const place = (k, x, z, sc, ry = R() * TAU) => { if (!put.has(k)) put.set(k, []); put.get(k).push(mat4(x, G, z, sc, sc, sc, 0, ry, 0)); };
  const scatter = (k, n, clear, s0, s1, shade) => {
    for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
      let x, z;
      if (shade && trees.length) {
        const t = trees[(R() * trees.length) | 0], a = R() * TAU, dd = 0.9 + R() * 3.2 * t.s;
        x = t.x + Math.cos(a) * dd; z = t.z + Math.sin(a) * dd;
      } else {
        const a = R() * TAU, r = Math.sqrt(22 * 22 + R() * (86 * 86 - 22 * 22));
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      const r = Math.hypot(x, z);
      if (r < 21 || r > 86.5 || !free(x, z, clear)) continue;
      place(k, x, z, s0 + R() * (s1 - s0));
      i++;
    }
  };
  scatter('logT', n3([3, 8, 11]), 2.9, 0.85, 1.15, false);
  for (const m of put.get('logT') || []) trunks.push({ x: m.elements[12], z: m.elements[14], r: 2.6 });
  scatter('stumpT', n3([4, 10, 14]), 0.7, 0.8, 1.3, true);
  scatter('mossrock', n3([8, 24, 34]), 0.9, 0.7, 1.6, false);
  scatter('shrubT', n3([12, 40, 60]), 0.8, 0.8, 1.4, true);
  scatter('fernT', n3([60, 160, 240]), 0.4, 0.8, 1.5, true);
  scatter('tuftT', n3([140, 400, 620]), 0.25, 0.8, 1.4, false);
  scatter('flowers', n3([25, 70, 110]), 0.3, 0.6, 1.0, false);
  for (const [k, list] of put) {
    const im = new THREE.InstancedMesh(modelGeo(k), mat, list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setRGB(0.88 + R() * 0.2, 0.9 + R() * 0.16, 0.86 + R() * 0.14)); });
    view.add(im, k === 'logT' || k === 'mossrock' || k === 'stumpT' || k === 'shrubT');
    band.near.push(im);
    im.visible = band.on !== false;
  }
}

// ---------------------------------------------------------------- the mountains round the lake
// Lit and fogged in the shader: the scene's own lights (copied in every frame, so a night or dusk map is right too), and
// fog that thickens more slowly than on everything else, so the far ranges stay in sight as layers in the haze.
const WILD_VS = `#include <fog_pars_vertex>
  attribute vec3 aCol; attribute vec2 aD; uniform float uFogK;
  varying vec3 vC; varying vec3 vW; varying vec3 vN; varying vec2 vD; varying float vDist;
  void main(){
    vC = aCol; vD = aD; vW = position; vN = normal;
    vec4 mvPosition = viewMatrix * vec4(position, 1.0);
    vDist = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    vFogDepth *= uFogK;
  }`;
const wildFs = () => `#include <fog_pars_fragment>
  uniform vec3 uSunDir; uniform vec3 uSunC; uniform vec3 uSky; uniform vec3 uGnd;
  varying vec3 vC; varying vec3 vW; varying vec3 vN; varying vec2 vD; varying float vDist;
  ${noiseGlsl()}
  void main(){
    vec3 n = normalize(vN);
    // Up close: the crowns of the forest and the dark gaps between them, layers and cracks in the rock.
    float near = 1.0 - smoothstep(140.0, 460.0, vDist);
    float cn = n21(vW.xz * 0.42) * 0.6 + n21(vW.xz * 1.15 + 3.0) * 0.4;
    float rk = n21(vec2(vW.x * 0.06 + vW.z * 0.06, vW.y * 0.45)) * 0.55 + n21(vW.xz * 0.28 + 7.0) * 0.45;
    float det = mix(1.0, 0.58 + 0.7 * cn, vD.x * near) * mix(1.0, 0.7 + 0.55 * rk, vD.y * near);
    vec3 light = mix(uGnd, uSky, 0.5 + 0.5 * n.y) + uSunC * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(vC * det * light, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function wildMat(view) {
  const m = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uFogK: { value: 0.42 }, uSunDir: { value: new THREE.Vector3(-0.5, 0.62, 0.45).normalize() }, uSunC: { value: new THREE.Color(0xffe2b4).multiplyScalar(2.1 / Math.PI) },
      uSky: { value: new THREE.Color(0xb9d9c4).multiplyScalar(1.05 / Math.PI) }, uGnd: { value: new THREE.Color(0x3c4a2a).multiplyScalar(1.05 / Math.PI) },
    }]),
    vertexShader: WILD_VS, fragmentShader: wildFs(),
  });
  // The scene's lights, found once and copied in every frame (the sun's colour and strength change with the map's look).
  let hemi = null, sun = null;
  const U = m.uniforms, k = 1 / Math.PI;
  view.onFrame.push(() => {
    if (!hemi) {
      let s = view.root;
      while (s.parent) s = s.parent;
      s.traverse((o) => { if (o.isHemisphereLight) hemi = o; else if (o.isDirectionalLight && !sun) sun = o; });
      if (!hemi || !sun) { hemi = sun = null; return; }
    }
    U.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity * k);
    U.uGnd.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * k);
    U.uSunC.value.copy(sun.color).multiplyScalar(sun.intensity * k);
    U.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
  });
  return m;
}

export function buildWildlands(view) {
  const d = detail(), NA = [128, 200, 256][d], NR = [36, 54, 66][d], r0 = 104, r1 = 660, R = rng(808);
  const N1 = vnoise(11), N2 = vnoise(23), N3 = vnoise(37), N4 = vnoise(41);
  const fbm = (x, z) => N1(x, z) * 0.5 + N1(x * 2.03 + 5.2, z * 2.03 + 1.3) * 0.27 + N1(x * 4.07 + 9.7, z * 4.07 + 3.1) * 0.15 + N1(x * 8.1 + 2.2, z * 8.1 + 7.7) * 0.08;
  const ridged = (x, z) => {
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < 5; o++) { const n = 1 - Math.abs(N2(x * f + o * 7.3, z * f + o * 3.1) * 2 - 1); s += n * n * a; a *= 0.5; f *= 2.1; }
    return s;
  };
  // Under the lake at the shore, wooded hills, then the ranges behind them: higher where the big noise says so.
  const height = (x, z) => {
    const r = Math.hypot(x, z), shore = smooth(r0, 168, r), range = smooth(190, 430, r);
    const hills = fbm(x * 0.011, z * 0.011), mass = N3(x * 0.0042 + 3.7, z * 0.0042 + 1.1);
    return -7 + shore * (9 + 34 * hills) + range * (22 + (110 + 200 * mass) * Math.pow(ridged(x * 0.0043, z * 0.0043), 1.3));
  };
  const C = (hex) => new THREE.Color(hex);
  const ROCK = [C(0x5a5650), C(0x857f74)], SCREE = C(0x9a948a), MEADOW = [C(0x56702e), C(0x707a38)], FOREST = [C(0x1a361d), C(0x2c4e26)], SNOW = C(0xeef2f6), BEACH = C(0x7a6e58);
  // Where each kind of ground is, from the height, the steepness and some noise.
  const cover = (x, y, z, ny) => {
    const slope = 1 - ny, tl = 72 + 40 * N3(x * 0.01, z * 0.01), sl = 138 + 34 * N4(x * 0.006 + 9, z * 0.006 + 4);
    const forest = smooth(1, 4, y) * (1 - smooth(tl - 22, tl + 8, y)) * (1 - smooth(0.36, 0.55, slope));
    const snow = smooth(sl - 14, sl + 14, y) * (1 - smooth(0.5, 0.78, slope));
    const meadow = (1 - forest) * smooth(2, 6, y) * (1 - smooth(0.22, 0.4, slope)) * (1 - smooth(tl + 4, tl + 28, y));
    return { forest, snow, meadow, beach: 1 - smooth(-0.6, 2.4, y) };
  };
  const tint = (out, x, y, z, ny, c) => {
    const n = N4(x * 0.03, z * 0.03), m = N1(x * 0.02 + 4, z * 0.02 + 8);
    out.copy(ROCK[0]).lerp(ROCK[1], n);
    out.lerp(SCREE, smooth(0.6, 0.9, 1 - ny) * 0.2 + smooth(0.55, 0.8, m) * 0.25);
    out.lerp(_c.copy(MEADOW[0]).lerp(MEADOW[1], m), c.meadow);
    out.lerp(_c.copy(FOREST[0]).lerp(FOREST[1], n * 0.8 + m * 0.2), c.forest);
    out.lerp(SNOW, c.snow);
    out.lerp(BEACH, c.beach);
    return out;
  };
  const _c = new THREE.Color(), out = new THREE.Color();

  // The ground: a ring of rows from the shore outward, closer together near the lake.
  const pos = new Float32Array(NA * NR * 3), idx = [];
  for (let i = 0; i < NR; i++) {
    const r = r0 * Math.pow(r1 / r0, i / (NR - 1));
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r, o = (i * NA + j) * 3;
      pos[o] = x; pos[o + 1] = height(x, z); pos[o + 2] = z;
    }
  }
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, e = b + NA;
    idx.push(a, b, c, b, e, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.attributes.normal.array, cols = new Float32Array(NA * NR * 3), dd = new Float32Array(NA * NR * 2);
  for (let v = 0; v < NA * NR; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ny = nor[v * 3 + 1], c = cover(x, y, z, ny);
    tint(out, x, y, z, ny, c);
    cols[v * 3] = out.r; cols[v * 3 + 1] = out.g; cols[v * 3 + 2] = out.b;
    dd[v * 2] = c.forest; dd[v * 2 + 1] = Math.max(0, 1 - c.forest - c.meadow - c.snow - c.beach);
  }
  geo.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(dd, 2));
  const mat = wildMat(view);
  view.root.add(new THREE.Mesh(geo, mat));

  // Trees standing out against the sky on the hills round the lake: thousands of spruces, three cones each. A build step
  // of their own, so a map being made behind the menu doesn't hold up a frame for long.
  const trees = () => {
  const nT = [700, 2200, 3200][d], tp = [], tn = [], tc = [], tdd = [], ti = [];
  const cone = (x, y, z, r, h, c) => {
    const base = tp.length / 3, seg = 6, sl = Math.hypot(r, h);
    tp.push(x, y + h, z); tn.push(0, 1, 0); tc.push(c.r, c.g, c.b); tdd.push(0, 0);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      tp.push(x + ca * r, y, z + sa * r); tn.push((ca * h) / sl, r / sl, (sa * h) / sl); tc.push(c.r * 0.8, c.g * 0.8, c.b * 0.8); tdd.push(0, 0);
      ti.push(base, base + 1 + ((k + 1) % seg), base + 1 + k);
    }
  };
  for (let n = 0, tries = 0; n < nT && tries < nT * 12; tries++) {
    const a = R() * TAU, r = 112 + Math.pow(R(), 1.6) * 190, x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
    if (y < 1.8) continue;
    const gx = height(x + 2, z) - height(x - 2, z), gz = height(x, z + 2) - height(x, z - 2), ny = 4 / Math.hypot(gx, 4, gz);
    if (R() > cover(x, y, z, ny).forest) continue;
    const h = (8 + R() * 9) * (r > 220 ? 1.3 : 1), w = h * (0.2 + R() * 0.06);
    out.copy(FOREST[0]).lerp(FOREST[1], R()).multiplyScalar(0.8 + R() * 0.4);
    cone(x, y - 1, z, w, h * 0.55, out);
    cone(x, y + h * 0.28, z, w * 0.74, h * 0.45, out);
    cone(x, y + h * 0.55, z, w * 0.46, h * 0.45, out);
    n++;
  }
  if (tp.length) {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
    tg.setAttribute('aCol', new THREE.Float32BufferAttribute(tc, 3));
    tg.setAttribute('aD', new THREE.Float32BufferAttribute(tdd, 2));
    tg.setIndex(ti);
    view.root.add(new THREE.Mesh(tg, mat));
  }
  };
  if (view.steps && view.steps.length) view.steps.unshift(trees);
  else trees();
}
