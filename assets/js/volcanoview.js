// The Magma Chimney: rough rock inside and out (pushed in and out by bulges, ledges and layers), veins of lava glowing
// through it, falls of lava pouring down it, the rock red hot just above the lava, and the lava lake itself, which
// rises while you climb (game.js lavaY, set on the view each frame). Obsidian grows out of the walls.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { noiseGlsl } from './pattern.js';
import { HDR, mat4 } from './worldview.js';
import { detail } from './scenery.js';

// Value noise in JS, the same idea as the shaders', for the shape of the walls.
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

const WALL_VS = `#include <fog_pars_vertex>
  varying vec3 vW; varying vec3 vN;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

// Inside (uOut 0) and outside (uOut 1) of the chimney.
const WALL_FS = () => `#include <fog_pars_fragment>
  uniform float uT, uLava, uOut, uTop; uniform vec3 uHot, uWarm, uSky;
  varying vec3 vW; varying vec3 vN;
  ${noiseGlsl()}
  // Noise on the wall with no seam: seen from the x side and from the z side, blended by which way the wall faces.
  float wx, wz;
  float nt(vec2 s, float o){ return n21(vec2(vW.z, vW.y) * s + o) * wx + n21(vec2(vW.x, vW.y) * s + o) * wz; }
  void main(){
    float a = atan(vW.z, vW.x);
    vec2 rd = normalize(vW.xz); wx = rd.x * rd.x; wz = rd.y * rd.y;
    float n1 = nt(vec2(0.07), 0.0), n2 = nt(vec2(0.21), 3.0), n3 = nt(vec2(0.63), 9.0);
    // Dark basalt in layers, lighter grit, ash.
    float strata = 0.5 + 0.5 * sin(vW.y * 0.9 + n1 * 5.0);
    vec3 rock = mix(vec3(0.07, 0.055, 0.05), vec3(0.17, 0.13, 0.11), n2 * 0.6 + strata * 0.4) * (0.72 + 0.56 * n3);
    rock = mix(rock, vec3(0.2, 0.19, 0.18), uOut * smoothstep(0.55, 0.8, nt(vec2(2.7, 0.02), 5.0)) * 0.6);
    // Veins of lava: thin lines where the noise crosses its middle, only in places, pulsing as they flow.
    float v = nt(vec2(0.09, 0.05), -uT * 0.04) * 0.72 + n2 * 0.28;
    float vein = (1.0 - smoothstep(0.0, 0.022 + 0.02 * n3, abs(v - 0.5))) * smoothstep(0.38, 0.62, nt(vec2(0.03), 17.0));
    float flow = 0.55 + 0.45 * sin(vW.y * 0.35 + uT * 1.6 + n1 * 6.0);
    // Falls of lava: in some places a stream pours out of the rock and down to the lake.
    // Each one runs from where it springs out of the rock, 25 to 90 m down, wandering a little from side to side,
    // narrowing and thinning out at its foot. A new stretch of wall every 100 m has its own.
    float c = a * 9.0, id = floor(c), band = floor(vW.y / 100.0), on = step(0.86, h21(vec2(id, band * 3.1 + 3.0)));
    float src = band * 100.0 + 30.0 + h21(vec2(id, band + 7.0)) * 65.0, len = 25.0 + h21(vec2(id, band + 11.0)) * 65.0, k = clamp((src - vW.y) / len, 0.0, 1.0);
    float f = fract(c) - 0.5 + (n21(vec2(id * 7.0, vW.y * 0.06)) - 0.5) * 0.35;
    float w = (0.13 + 0.04 * n3) * (1.0 - 0.6 * k);
    float fall = on * (1.0 - smoothstep(w * 0.6, w, abs(f))) * step(vW.y, src) * step(k, 0.999) * (1.0 - uOut) * (1.0 - k * k);
    float fs = n21(vec2(f * 40.0 + id * 13.0, vW.y * 0.09 + uT * 1.4)) * 0.6 + n21(vec2(f * 90.0, vW.y * 0.3 + uT * 3.0)) * 0.4;
    float spring = (1.0 - smoothstep(0.0, 2.5, abs(vW.y - src))) * on * (1.0 - smoothstep(0.08, 0.25, abs(f))) * (1.0 - uOut);
    // Red hot just above the lava, more the closer.
    float heat = (1.0 - uOut) * exp(-max(vW.y - uLava, 0.0) / 10.0);
    vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
    vec3 light = mix(vec3(0.3, 0.17, 0.12), uSky, uOut) * (0.45 + 0.55 * max(n.y, 0.0) + 0.25 * (1.0 - abs(n.y))) + uWarm * (0.25 + heat) * (1.0 - uOut);
    vec3 col = rock * light;
    col += uHot * vein * flow * (0.55 + heat) * (1.0 - 0.75 * uOut);
    col = mix(col, uHot * (0.3 + 0.7 * fs * fs), fall * (0.6 + 0.4 * fs));
    col += uHot * spring * 0.8;
    col += uWarm * heat * heat * 0.7;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// The lake: plates of dark crust drifting over molten rock, glowing cracks between them, brighter upwellings.
const LAKE_VS = `#include <fog_pars_vertex>
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const LAKE_FS = () => `#include <fog_pars_fragment>
  uniform float uT; varying vec3 vW;
  ${noiseGlsl()}
  void main(){
    vec2 p = vW.xz;
    float k1 = n21(p * 0.13 + vec2(uT * 0.035, uT * 0.022)), k2 = n21(p * 0.37 - vec2(uT * 0.05, -uT * 0.031)), k3 = n21(p * 1.2 + vec2(uT * 0.12, 0.0));
    float c = k1 * 0.62 + k2 * 0.28 + k3 * 0.1;
    float crust = smoothstep(0.47, 0.6, c), crack = 1.0 - smoothstep(0.0, 0.04, abs(c - 0.5));
    float pulse = 0.75 + 0.25 * sin(uT * 1.4 + k2 * 9.0);
    vec3 molten = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.72, 0.22), k3 * k3) * 2.6 * pulse;
    vec3 col = mix(molten, vec3(0.05, 0.025, 0.018) * (0.6 + 0.9 * k3), crust) + vec3(1.0, 0.45, 0.08) * crack * 2.2 * (1.0 - crust * 0.5);
    // Now and then a bubble of bright lava swells up and bursts.
    vec2 g = floor(p * 0.4), fq = fract(p * 0.4) - 0.5;
    float b = fract(uT * (0.15 + 0.2 * h21(g)) + h21(g + 3.1)), bub = (1.0 - smoothstep(0.0, 0.18 * b, length(fq))) * step(0.7, h21(g + 9.0)) * (1.0 - b);
    col += vec3(1.0, 0.8, 0.35) * bub * 3.0;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

const BASE_LAVA = 0.25;

export function buildVolcanoView(view) {
  const L = view.level, d = detail(), y0 = -30, H = L.top + 60, R = rng(23), N1 = vnoise(31), N2 = vnoise(32), N3 = vnoise(33);
  // How far the rock comes in (inside) or out (outside) from the plain cylinder, 0 to 2 m: bulges, ledges and layers.
  const push = (a, y, s) => {
    const ca = Math.cos(a), sa = Math.sin(a), f = N1(ca * 3 + s, sa * 3 + y * 0.03) * 0.55 + N2(ca * 9 + s, sa * 9 + y * 0.09) * 0.3 + N3(ca * 24, sa * 24 + y * 0.25) * 0.15;
    const ledge = Math.max(0, Math.sin(y * 0.55 + N1(ca * 2, sa * 2 + y * 0.01) * 7)) ** 6 * 0.5;
    return Math.min(2, Math.max(0, (f - 0.3) * 2.6) + ledge);
  };
  const inner = (y) => 27 - 3 * ((y - y0) / H);
  const wallGeo = (out) => {
    const NA = [72, 128, 160][d], NY = Math.ceil(H / [6, 3.5, 2.6][d]), pos = [], idx = [];
    for (let j = 0; j <= NY; j++) {
      const y = y0 + (H * j) / NY;
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * TAU, p = push(a % TAU, y, out ? 50 : 0), r = out ? 28.5 + p * 0.75 : inner(y) - p;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b = a + NA + 1;
      if (out) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // The seam where the circle closes: both sides share the same normal so no line shows.
    const nr = g.attributes.normal;
    for (let j = 0; j <= NY; j++) {
      const a = j * (NA + 1), b = a + NA;
      const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
    }
    g.computeBoundingSphere();
    return g;
  };
  const wallMat = (out) => {
    const m = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uT: { value: 0 }, uLava: { value: BASE_LAVA }, uOut: { value: out ? 1 : 0 }, uTop: { value: L.top },
        uHot: { value: HDR(0xff6a14, 2.2) }, uWarm: { value: new THREE.Color(0xff5010) }, uSky: { value: new THREE.Color(0x8a6a5a) },
      }]),
      vertexShader: WALL_VS, fragmentShader: WALL_FS(),
    });
    view.timeMats.push(m);
    return m;
  };
  const inMat = wallMat(false), outMat = wallMat(true);
  view.add(new THREE.Mesh(wallGeo(false), inMat), false);
  view.add(new THREE.Mesh(wallGeo(true), outMat), false);
  // The rim on top, joining the two.
  const rimY = y0 + H, rim = new THREE.Mesh(new THREE.TorusGeometry(26.3, 2.4, 10, 96).rotateX(Math.PI / 2).scale(1, 0.6, 1), outMat);
  rim.position.y = rimY;
  view.add(rim, false);

  // The lava lake, a disc as wide as the chimney: its edge is hidden between the inner and outer walls.
  const lakeM = new THREE.ShaderMaterial({ fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 } }]), vertexShader: LAKE_VS, fragmentShader: LAKE_FS() });
  view.timeMats.push(lakeM);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(27.6, 96).rotateX(-Math.PI / 2), lakeM);
  lake.position.y = BASE_LAVA;
  lake.frustumCulled = false;
  view.add(lake, false);
  view.anim.push(lake);
  // A glow over the lake that goes up with it: a soft orange haze, thickest on the lava.
  const hazeM = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: HDR(0xff5a14, 0.5) } },
    vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uC; varying float vY; void main(){ gl_FragColor = vec4(uC * exp(-vY / 3.5), 1.0);\n#include <colorspace_fragment>\n}',
  });
  const haze = new THREE.Mesh(new THREE.CylinderGeometry(26.5, 27.3, 14, 64, 6, true).translate(0, 7, 0), hazeM);
  haze.position.y = BASE_LAVA;
  view.add(haze, false);
  view.anim.push(haze);

  // Obsidian growing out of the inside of the wall: clusters of black glassy crystals, a faint violet glow in them.
  const nC = [70, 160, 240][d], crys = [], cg = new THREE.OctahedronGeometry(1, 0).scale(0.35, 1, 0.35);
  for (let k = 0; k < nC; k++) {
    const a = R() * TAU, y = 3 + R() * (L.top - 10), r = inner(y) - push(a, y, 0) + 0.2, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0, n = 2 + ((R() * 4) | 0); j < n; j++) {
      const s = 0.4 + R() * 0.9, tilt = 0.5 + R() * 0.9, spin = (R() - 0.5) * 1.6, dy = (R() - 0.5) * 1.4;
      // Pointing in from the wall and up a little.
      crys.push(mat4(ca * (r - s * 0.5), y + dy, sa * (r - s * 0.5), s, s * (1.2 + R()), s, 0, -a + Math.PI + spin, -tilt));
    }
  }
  const cm = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0x1a1220, roughness: 0.12, metalness: 0.4, emissive: 0x2a0a3a, emissiveIntensity: 0.8, flatShading: true }), crys.length);
  crys.forEach((m, i) => cm.setMatrixAt(i, m));
  view.add(cm);

  // Embers drifting up through the chimney around the camera.
  const n = 160, emb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 4), new THREE.MeshBasicMaterial({ color: HDR(0xffa040, 3.5) }), n);
  for (let i = 0; i < n; i++) { const a = R() * TAU, rr2 = 4 + R() * 18; emb.setMatrixAt(i, mat4(Math.cos(a) * rr2, R() * 40, Math.sin(a) * rr2, 1, 1, 1)); }
  emb.frustumCulled = false;
  view.embers = new THREE.Group();
  view.embers.add(emb);
  view.root.add(view.embers);
  view.anim.push(view.embers);

  // Each frame: the lake where the climb says the lava is (only ever up while you watch: a fall sets it back down at once).
  let shown = BASE_LAVA;
  view.onFrame.push((t) => {
    const want = view.lavaY === undefined || view.lavaY === null ? BASE_LAVA + 0.12 * Math.sin(t * 0.4) : Math.max(BASE_LAVA, view.lavaY);
    shown = want < shown - 2 ? want : shown + (want - shown) * 0.2;
    lake.position.y = shown;
    haze.position.y = shown;
    inMat.uniforms.uLava.value = shown;
  });
}
