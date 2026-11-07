// Neon Skyline at night: the Nexus, the glass tower the route climbs round (level.js, 'spiral'), the needle pylons out
// round it that the route visits (level.js excursion, often by flying car), and the life of the city round them:
// giant holograms of koi swimming round the tower, floating screens, blimps, searchlights from the shore, a sea of cloud
// high up and a beam of light from the top. The city round the bay is backdrop.js cityLands.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { noiseGlsl } from './pattern.js';
import { CORE_R } from './level.js';
import { HDR, mat4, canvasTex } from './worldview.js';
import { detail } from './scenery.js';

const BOXG = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------- the glass of the towers
// A curtain wall of dark glass in floors 3.6 m tall, rooms lit behind some panes, a floor of plant rooms every 36 m with
// a line of light, and a diamond frame of steel over it all with pulses of light running up it. aZ: the colour of the
// zone at that height. aC: the middle of the tower (x, z) and its radius, so the needles share the one material.
const GLASS_VS = `#include <fog_pars_vertex>
  attribute vec3 aZ; attribute vec3 aC;
  varying vec3 vW; varying vec3 vN; varying vec3 vZ; varying vec3 vC;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vZ = aZ; vC = aC;
    vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const GLASS_FS = () => `#include <fog_pars_fragment>
  uniform float uT; uniform vec3 uSky; uniform vec3 uGnd;
  varying vec3 vW; varying vec3 vN; varying vec3 vZ; varying vec3 vC;
  ${noiseGlsl()}
  void main(){
    vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
    vec2 d = vW.xz - vC.xy;
    float R = vC.z, y = vW.y, u = atan(d.y, d.x) * R;
    // How big a pixel is on the wall: no seam where the angle wraps round, as fwidth of it would have.
    float mpp = max(length(dFdx(vW)), length(dFdy(vW)));
    float cols = 2.0 * floor(R * 3.1416 / 1.55 + 0.5), cw = R * 6.2832 / cols;
    vec2 q = vec2(u / cw, y / 3.6), id = floor(q), f = fract(q), fq = vec2(mpp / cw, mpp / 3.6);
    float far = smoothstep(0.3, 0.9, max(fq.x, fq.y));
    float mx = smoothstep(0.0, 0.06 + fq.x, f.x) * (1.0 - smoothstep(0.94 - fq.x, 1.0, f.x));
    float my = smoothstep(0.16, 0.2 + fq.y, f.y) * (1.0 - smoothstep(0.95 - fq.y, 1.0, f.y));
    float pane = mix(mx * my, 0.72, far);
    // The glass shows the sky above and the glow of the city below, more at a glancing angle.
    vec3 r = reflect(-V, n);
    float fres = pow(1.0 - abs(dot(n, V)), 3.0);
    vec3 refl = mix(uGnd * 2.0 + vZ * 0.06, uSky * 1.4, smoothstep(-0.25, 0.5, r.y));
    vec3 glass = vec3(0.01, 0.014, 0.028) + refl * (0.14 + 0.75 * fres);
    vec3 frame = vec3(0.07, 0.075, 0.09) * (0.5 + 1.5 * uSky);
    vec3 col = mix(frame, glass, pane);
    // Rooms: warm, cool, now and then one in the zone's colour, a few flickering.
    float h = h21(id), lit = step(0.56, h21(id * 1.37 + 5.1));
    vec3 room = mix(vec3(1.0, 0.7, 0.42), vec3(0.55, 0.78, 1.0), step(0.62, h21(id + 9.2)));
    room = mix(room, vZ, step(0.86, h21(id + 2.7)));
    float flick = 1.0 - step(0.95, h) * step(0.5, fract(uT * (1.5 + h * 3.0) + h * 7.0)) * 0.7;
    vec3 em = mix(room * lit * mx * my * (0.3 + 0.45 * h21(id + 4.4)) * flick, vec3(0.16, 0.13, 0.12) + vZ * 0.03, far);
    // Plant rooms every 36 m: dark louvres and a line of light.
    float yy = mod(y, 36.0), mech = smoothstep(0.0, mpp, yy) * (1.0 - smoothstep(1.4, 1.4 + mpp, yy));
    col = mix(col, vec3(0.03, 0.03, 0.04), mech);
    em = mix(em, vZ * 1.6 * (1.0 - smoothstep(0.06, 0.06 + mpp * 1.5, abs(yy - 0.7))), mech);
    // The diamond frame, three to six diamonds round, four floors tall, and the pulses running up it.
    float nd = clamp(floor(R), 3.0, 6.0), W = R * 6.2832 / nd;
    float s1 = u / W + y / 14.4, s2 = u / W - y / 14.4, wl = mpp * (1.0 / W + 1.0 / 14.4), lw = 0.022;
    float l1 = smoothstep(0.5 - lw - wl, 0.5 - lw, abs(fract(s1) - 0.5)), l2 = smoothstep(0.5 - lw - wl, 0.5 - lw, abs(fract(s2) - 0.5));
    float grid = max(l1, l2) * (1.0 - 0.4 * far);
    float p1 = fract(y * 0.009 - uT * 0.14 + h21(vec2(mod(floor(s1 + 0.5), nd), 3.0 + R)));
    float p2 = fract(y * 0.009 - uT * 0.14 + h21(vec2(mod(floor(s2 + 0.5), nd), 7.0 + R)));
    float pulse = l1 * smoothstep(0.8, 0.985, p1) * step(p1, 0.992) + l2 * smoothstep(0.8, 0.985, p2) * step(p2, 0.992);
    vec3 steel = vec3(0.16, 0.17, 0.2) * (0.4 + 1.6 * uSky) + vZ * 0.1;
    col = mix(col, steel, grid);
    em = mix(em, vZ * 0.3, grid) + vZ * pulse * 3.0;
    gl_FragColor = vec4(col + em, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// The scene's sky and ground light (the hemisphere light), copied into U every frame.
function skyLight(view, U) {
  let hemi = null;
  view.onFrame.push(() => {
    if (!hemi) {
      let s = view.root;
      while (s.parent) s = s.parent;
      s.traverse((x) => { if (x.isHemisphereLight) hemi = x; });
      if (!hemi) return;
    }
    U.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI);
    U.uGnd.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity / Math.PI);
  });
}

function glassMat(view) {
  if (view.glassMat) return view.glassMat;
  const m = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uSky: { value: new THREE.Color(0.2, 0.2, 0.3) }, uGnd: { value: new THREE.Color(0.1, 0.05, 0.1) } }]),
    vertexShader: GLASS_VS, fragmentShader: GLASS_FS(),
  });
  skyLight(view, m.uniforms);
  view.timeMats.push(m);
  return (view.glassMat = m);
}

// The colour of the zone at height y, blended over 12 m either side of each change.
function zoneColor(L) {
  const cols = L.zones.map((z) => new THREE.Color(z.color)), c = new THREE.Color();
  return (y) => {
    let i = 0;
    while (i < L.zones.length - 1 && y > L.zones[i].y1) i++;
    c.copy(cols[i]);
    const z = L.zones[i];
    if (i < cols.length - 1 && y > z.y1 - 12) c.lerp(cols[i + 1], 0.5 * Math.min(1, (y - (z.y1 - 12)) / 12));
    if (i > 0 && y < z.y0 + 12) c.lerp(cols[i - 1], 0.5 * Math.min(1, (z.y0 + 12 - y) / 12));
    return c;
  };
}

// Round walls in one mesh: each a ring of seg sides from y0 (radius r0) to y1 (radius r1), in rows about every step metres.
class Walls {
  constructor(zc) { this.p = []; this.n = []; this.z = []; this.c = []; this.i = []; this.zc = zc; }
  add(cx, cz, r0, r1, y0, y1, seg, step, R = r0) {
    const rows = Math.max(1, Math.ceil((y1 - y0) / step)), base = this.p.length / 3, h = y1 - y0, ny = (r0 - r1) / h;
    for (let j = 0; j <= rows; j++) {
      const y = y0 + (h * j) / rows, r = r0 + ((r1 - r0) * j) / rows, col = this.zc(y);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a), k = 1 / Math.hypot(1, ny);
        this.p.push(cx + ca * r, y, cz + sa * r);
        this.n.push(ca * k, ny * k, sa * k);
        this.z.push(col.r, col.g, col.b);
        this.c.push(cx, cz, R);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + seg + 1;
      this.i.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aZ', new THREE.Float32BufferAttribute(this.z, 3));
    g.setAttribute('aC', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

// ---------------------------------------------------------------- pictures
const ADS = [['NEON COLA', 350, 'bottle'], ['SKYCAR', 190, 'car'], ['ROBOTIX', 120, 'bot'], ['MOON TRIPS', 260, 'moon'], ['PIXEL BURGER', 30, 'burger'], ['ZAP', 55, 'bolt']];
// Six adverts, three across and two down, each 512 by 256.
export function adsTex() {
  return canvasTex(1536, 512, (g) => {
    ADS.forEach(([text, hu, pic], i) => {
      const x = (i % 3) * 512, y = Math.floor(i / 3) * 256, gr = g.createLinearGradient(x, y, x + 512, y + 256);
      gr.addColorStop(0, `hsl(${hu},80%,22%)`); gr.addColorStop(1, `hsl(${(hu + 60) % 360},90%,12%)`);
      g.fillStyle = gr; g.fillRect(x, y, 512, 256);
      for (let k = 0; k < 12; k++) { g.fillStyle = `hsla(${hu},100%,70%,0.12)`; g.fillRect(x, y + k * 22, 512, 3); }
      g.save(); g.translate(x + 120, y + 128); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`;
      if (pic === 'bottle') { g.fillRect(-22, -30, 44, 100); g.fillRect(-10, -70, 20, 44); g.beginPath(); g.arc(0, -30, 22, Math.PI, 0); g.fill(); }
      else if (pic === 'car') { g.beginPath(); g.ellipse(0, 10, 90, 26, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(-10, -12, 44, 26, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.fillRect(70, 4, 18, 8); }
      else if (pic === 'bot') { g.fillRect(-50, -50, 100, 80); g.fillStyle = '#000'; g.fillRect(-36, -26, 72, 18); g.fillStyle = '#7fd8ff'; g.fillRect(-30, -22, 60, 10); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`; g.fillRect(-4, -80, 8, 30); }
      else if (pic === 'moon') { g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,0.25)'; for (const [a, b, r] of [[-20, -20, 14], [24, 10, 18], [-10, 34, 10]]) { g.beginPath(); g.arc(a, b, r, 0, TAU); g.fill(); } }
      else if (pic === 'burger') { g.beginPath(); g.ellipse(0, -20, 70, 40, 0, Math.PI, 0); g.fill(); g.fillStyle = '#5a3'; g.fillRect(-72, -18, 144, 12); g.fillStyle = '#842'; g.fillRect(-70, -6, 140, 22); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`; g.fillRect(-70, 16, 140, 20); }
      else { g.beginPath(); g.moveTo(-10, -90); g.lineTo(40, -90); g.lineTo(10, -10); g.lineTo(45, -10); g.lineTo(-30, 90); g.lineTo(-5, 10); g.lineTo(-40, 10); g.closePath(); g.fill(); }
      g.restore();
      g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const tw = g.measureText(text).width;
      if (tw > 256) g.font = `bold ${Math.floor(60 * 256 / tw)}px sans-serif`;
      g.shadowColor = `hsl(${hu},100%,60%)`; g.shadowBlur = 16; g.fillText(text, x + 236, y + 128); g.shadowBlur = 0;
      g.strokeStyle = `hsl(${hu},100%,65%)`; g.lineWidth = 6; g.strokeRect(x + 4, y + 4, 504, 248);
    });
  });
}
// The u and v range of advert i in the picture: [u0, v0, u1, v1].
const adUV = (i) => [(i % 3) / 3, 1 - (Math.floor(i / 3) + 1) / 2, (i % 3 + 1) / 3, 1 - Math.floor(i / 3) / 2];

// A strip of quads, for screens: points going the way the angle grows face out from the middle, the other way face in.
// u runs back along the points, so the words read the right way round from the side they face.
function stripGeo(list) {
  const pos = [], uvs = [], idx = [];
  for (const { pts, y0, y1, uv } of list) {
    const n = pts.length - 1, b0 = pos.length / 3;
    pts.forEach(([x, z], j) => {
      const u = uv[2] + (uv[0] - uv[2]) * (j / n);
      pos.push(x, y0, z, x, y1, z);
      uvs.push(u, uv[1], u, uv[3]);
    });
    for (let j = 0; j < n; j++) { const b = b0 + j * 2; idx.push(b, b + 3, b + 2, b, b + 1, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Light that fades along its length (v 0 at the source): searchlights, the beam from the top, thrusters.
function beamMat(hex, k) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uC: { value: HDR(hex, k) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uC; varying vec2 vUv;
      void main(){ float f = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.04, vUv.y); gl_FragColor = vec4(uC * f, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- the Nexus
export function buildNexus(view) {
  const L = view.level, zc = zoneColor(L), top = L.top - 1.2, d = detail();
  const walls = new Walls(zc);
  walls.add(0, 0, CORE_R, CORE_R, -40, top, [48, 64, 80][d], 6);
  view.add(walls.mesh(glassMat(view)));
  // A sky lobby at the foot of each zone: a dark band edged with light in the zone's colour.
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.35, metalness: 0.8 });
  for (const z of L.zones) {
    const y = z.y0 - 1.7, gm = new THREE.MeshBasicMaterial({ color: HDR(z.color, 2.4) });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R + 0.08, CORE_R + 0.08, 2.2, 72, 1, true), dark);
    band.position.y = y;
    view.add(band, false);
    for (const dy of [-1.05, 1.05]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(CORE_R + 0.1, 0.06, 6, 96).rotateX(Math.PI / 2), gm);
      t.position.y = y + dy;
      view.add(t, false);
    }
  }
  // Screens all the way round at a few heights, an advert every sixth of the way.
  const ads = adsTex(), screens = [], R = rng(707), rs = CORE_R + 0.12;
  for (const zi of [0, 2, 4, 6, 8]) {
    const z = L.zones[zi];
    if (!z) continue;
    const y = z.y0 + 18 + R() * Math.max(1, z.y1 - z.y0 - 50), a0 = R() * TAU, h = (rs * TAU) / 6 / 2;
    for (let k = 0; k < 6; k++) {
      const pts = [];
      for (let j = 0; j <= 10; j++) { const a = a0 + ((k + j / 10) / 6) * TAU; pts.push([Math.cos(a) * rs, Math.sin(a) * rs]); }
      screens.push({ pts, y0: y - h / 2, y1: y + h / 2, uv: adUV((k + zi) % 6) });
    }
    for (const dy of [-h / 2 - 0.15, h / 2 + 0.15]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(rs + 0.02, 0.08, 6, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: HDR(z.color, 2.2) }));
      t.position.y = y + dy;
      view.add(t, false);
    }
  }
  view.add(new THREE.Mesh(stripGeo(screens), new THREE.MeshBasicMaterial({ map: ads, color: HDR(0xffffff, 1.5) })), false);
  buildCrown(view, L.top);
}

// The crown over the summit: steel fins leaning out round the edge, lit along their tips, a ring of light above them, and
// a beam of light straight up from the middle, seen from anywhere in the city.
function buildCrown(view, y) {
  const n = 16, steel = new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.3, metalness: 0.85 });
  const glow = new THREE.MeshBasicMaterial({ color: HDR(0xffd86a, 2.6) });
  const fins = new THREE.InstancedMesh(BOXG, steel, n), tips = new THREE.InstancedMesh(BOXG, glow, n);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, h = k % 2 ? 16 : 24, r = 10.4 + h * 0.06;
    fins.setMatrixAt(k, mat4(Math.cos(a) * r, y - 4 + h / 2, Math.sin(a) * r, 1.6, h, 0.4, 0, -a, -0.12));
    const ro = r + 0.8;
    tips.setMatrixAt(k, mat4(Math.cos(a) * ro, y - 4 + h / 2, Math.sin(a) * ro, 0.12, h, 0.16, 0, -a, -0.12));
  }
  view.add(fins); view.add(tips, false);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(12.2, 0.22, 8, 128).rotateX(Math.PI / 2), glow);
  ring.position.y = y + 21;
  view.add(ring, false);
  const len = 900, beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 1.2, len, 24, 1, true).translate(0, len / 2, 0), beamMat(0xffe6a0, 0.9));
  beam.position.y = y + 1;
  beam.frustumCulled = false;
  view.add(beam, false);
}

// ---------------------------------------------------------------- the needles
// The pylons out round the Nexus (level.js excursion): the same glass, rings of light, a mast with a red light on top.
// One standing in the water has a wider foot; one floating over older route hangs on a cone with a thruster under it.
export function buildNeedles(view) {
  const T = view.level.trees, zc = zoneColor(view.level), walls = new Walls(zc), steel = new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.35, metalness: 0.8 });
  const rings = [], caps = [], masts = [], beacons = [], thrusters = [];
  for (const t of T) {
    // Solid from base + 2 when it floats (level.js): the cone under it ends 1 m below its base, clear of the route.
    const floating = t.base > 0, low = floating ? t.base + 2 : t.base;
    walls.add(t.x, t.z, t.r, t.r, low, t.top, 24, 6);
    if (!floating) walls.add(t.x, t.z, t.r * 1.35, t.r, t.base, t.base + 6, 24, 6, t.r);
    else {
      walls.add(t.x, t.z, 0.6, t.r, t.base - 1, low, 24, 3, t.r);
      thrusters.push([t.x, t.base - 1, t.z]);
    }
    for (let y = low + 6; y < t.top - 2; y += 12) rings.push([mat4(t.x, y, t.z, t.r + 0.05, 1, t.r + 0.05), zc(y).getHex()]);
    caps.push(mat4(t.x, t.top + 0.6, t.z, 1, 1, 1));
    masts.push(mat4(t.x, t.top + 4.2, t.z, 1, 1, 1));
    beacons.push(mat4(t.x, t.top + 7.6, t.z, 1, 1, 1));
  }
  if (!T.length) return;
  view.add(walls.mesh(glassMat(view)));
  const inst = (geo, mat, list, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length), c = new THREE.Color();
    list.forEach((q, i) => { if (Array.isArray(q)) { m.setMatrixAt(i, q[0]); m.setColorAt(i, c.setHex(q[1]).multiplyScalar(2.4)); } else m.setMatrixAt(i, q); });
    m.frustumCulled = false;
    view.add(m, shadow);
    return m;
  };
  inst(new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), rings, false);
  inst(new THREE.CylinderGeometry(T[0].r * 0.6, T[0].r, 1.2, 24), steel, caps);
  inst(new THREE.CylinderGeometry(0.07, 0.18, 7, 8), steel, masts);
  const red = new THREE.MeshBasicMaterial({ color: HDR(0xff3040, 3) });
  view.blink.push({ m: red, base: 3, hex: 0xff3040, sp: 2.6, sq: true });
  inst(new THREE.SphereGeometry(0.3, 12, 8), red, beacons, false);
  if (thrusters.length) {
    const ringG = new THREE.TorusGeometry(0.75, 0.12, 8, 32).rotateX(Math.PI / 2), flame = beamMat(0x5ad8ff, 1.2);
    inst(ringG, new THREE.MeshBasicMaterial({ color: HDR(0x7fe8ff, 3) }), thrusters.map(([x, y, z]) => mat4(x, y, z, 1, 1, 1)), false);
    const len = 16, g = new THREE.CylinderGeometry(0.7, 4.5, len, 20, 1, true).translate(0, -len / 2, 0);
    // v runs from the bottom up on a cylinder: turned round, so the light fades away from the thruster.
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    inst(g, flame, thrusters.map(([x, y, z]) => mat4(x, y - 0.1, z, 1, 1, 1)), false);
  }
}

// ---------------------------------------------------------------- the city's life
// Koi as holograms: a body, a forked tail, fins; the tail wags in the shader.
function koiGeo() {
  const body = new THREE.SphereGeometry(1, 24, 12).scale(0.46, 0.12, 0.1).translate(0.02, 0, 0).toNonIndexed();
  const P = [...body.attributes.position.array], tri = (...v) => P.push(...v.flat());
  // Tail: two long lobes; fins out to the sides and below; a fin along the back.
  tri([-0.4, 0, 0], [-0.78, 0.24, 0], [-0.66, 0.02, 0]); tri([-0.4, 0, 0], [-0.66, -0.02, 0], [-0.78, -0.24, 0]);
  for (const s of [-1, 1]) { tri([0.18, -0.05, s * 0.07], [0.02, -0.07, s * 0.36], [-0.04, -0.06, s * 0.08]); tri([-0.16, -0.06, s * 0.05], [-0.3, -0.1, s * 0.2], [-0.3, -0.07, s * 0.04]); }
  tri([0.16, 0.1, 0], [-0.28, 0.22, 0], [-0.3, 0.09, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
const HOLO_VS = `uniform float uT; varying vec3 vW; varying vec3 vN;
  void main(){
    vec3 p = position;
    float back = clamp((0.45 - p.x) / 1.2, 0.0, 1.0);
    p.z += sin(p.x * 5.5 + uT * 2.6) * 0.1 * back * back;
    vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const HOLO_FS = `uniform float uT; uniform vec3 uC; varying vec3 vW; varying vec3 vN;
  void main(){
    vec3 V = normalize(cameraPosition - vW);
    float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
    float scan = 0.6 + 0.4 * sin(vW.y * 2.4 - uT * 5.0);
    float flick = 0.9 + 0.1 * sin(uT * 37.0) * sin(uT * 13.0);
    gl_FragColor = vec4(uC * (0.1 + 1.2 * fres) * scan * flick, 1.0);
    #include <colorspace_fragment>
  }`;

export function buildCityLife(view) {
  const L = view.level, R = rng(818), d = detail(), top = L.top, zy = (i) => L.zones[Math.min(i, L.zones.length - 1)];
  // Koi swimming round the Nexus, well out past the route and the needles.
  const kg = koiGeo(), koi = [];
  [[0xff4fd8, 2, 47, 0.05], [0x3fd0ff, 2, 56, -0.04], [0xffb43d, 5, 50, 0.045], [0x7cff6a, 0, 44, -0.05], [0xff6a8a, 7, 58, 0.04]].slice(0, [3, 4, 5][d]).forEach(([hex, zi, r, sp]) => {
    const z = zy(zi), m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uT: { value: 0 }, uC: { value: HDR(hex, 1.6) } }, vertexShader: HOLO_VS, fragmentShader: HOLO_FS,
    });
    view.timeMats.push(m);
    const o = new THREE.Mesh(kg, m);
    o.scale.setScalar(26 + R() * 8);
    o.frustumCulled = false;
    view.add(o, false);
    koi.push({ o, r, sp, ph: R() * TAU, y: (z.y0 + z.y1) / 2 + (R() - 0.5) * 30 });
  });
  view.onFrame.push((t) => {
    for (const k of koi) {
      const a = k.ph + t * k.sp, s = Math.sign(k.sp), fx = -Math.sin(a) * s, fz = Math.cos(a) * s;
      k.o.position.set(Math.cos(a) * k.r, k.y + Math.sin(t * 0.21 + k.ph) * 7, Math.sin(a) * k.r);
      k.o.rotation.set(0, Math.atan2(-fz, fx), Math.cos(t * 0.21 + k.ph) * 0.12, 'YXZ');
    }
  });
  // Screens hanging in the air, facing the tower, out past the needles.
  const ads = adsTex(), boards = [];
  for (let y = 26; y < top - 20; y += [70, 46, 34][d]) {
    const a = R() * TAU, r = 39 + R() * 9, w = 12 + R() * 6, h = w / 2, tx = -Math.sin(a), tz = Math.cos(a), cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    // The tangent runs the way the angle grows: from outside that is to the left, so the near side starts at +.
    boards.push({ pts: [[cx - tx * w / 2, cz - tz * w / 2], [cx + tx * w / 2, cz + tz * w / 2]].reverse(), y0: y - h / 2, y1: y + h / 2, uv: adUV((R() * 6) | 0) });
  }
  const bm = new THREE.MeshBasicMaterial({ map: ads, color: HDR(0xffffff, 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const boardMesh = new THREE.Mesh(stripGeo(boards), bm);
  boardMesh.frustumCulled = false;
  view.add(boardMesh, false);
  view.onFrame.push((t) => { bm.color.setScalar(1.1 * (0.92 + 0.08 * Math.sin(t * 23) * Math.sin(t * 7.3))); });
  // Blimps far out, slowly round the city, a screen on each side.
  const hull = new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.55, metalness: 0.3 }), blimps = [];
  const shot = new THREE.MeshBasicMaterial({ map: ads, color: HDR(0xffffff, 1.3) });
  const navR = new THREE.MeshBasicMaterial({ color: HDR(0xff3040, 3) }), navG = new THREE.MeshBasicMaterial({ color: HDR(0x40ff80, 3) });
  [[135, 170, 0.012], [155, 400, -0.009], [140, 640, 0.01]].slice(0, [2, 3, 3][d]).forEach(([r, y, sp], i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14).scale(26, 6.5, 6.5), hull));
    for (const [rx, sy, sz] of [[0, 4.5, 0.4], [Math.PI / 2, 4.5, 0.4]]) {
      const f = new THREE.Mesh(BOXG, hull);
      f.scale.set(6, sy * 2, sz); f.position.x = -22; f.rotation.x = rx;
      g.add(f);
    }
    const gond = new THREE.Mesh(BOXG, hull);
    gond.scale.set(7, 2, 2.6); gond.position.y = -7;
    g.add(gond);
    const uv = adUV(i * 2 + 1);
    for (const s of [-1, 1]) {
      const sg = new THREE.PlaneGeometry(22, 6.2), a = sg.attributes.uv;
      for (let k = 0; k < a.count; k++) a.setXY(k, a.getX(k) ? uv[2] : uv[0], a.getY(k) ? uv[3] : uv[1]);
      const sm = new THREE.Mesh(sg, shot);
      sm.position.set(0, 0.5, s * 6.75);
      if (s < 0) sm.rotation.y = Math.PI;
      g.add(sm);
    }
    for (const [x, m] of [[3, navR], [-3, navG]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), m);
      l.position.set(x, -6.5, 0);
      g.add(l);
    }
    g.frustumCulled = false;
    view.add(g, false);
    blimps.push({ g, r, y, sp, ph: R() * TAU });
  });
  view.onFrame.push((t) => {
    for (const b of blimps) {
      const a = b.ph + t * b.sp, s = Math.sign(b.sp), fx = -Math.sin(a) * s, fz = Math.cos(a) * s;
      b.g.position.set(Math.cos(a) * b.r, b.y + Math.sin(t * 0.1 + b.ph) * 4, Math.sin(a) * b.r);
      b.g.rotation.set(0, Math.atan2(-fz, fx), 0);
    }
  });
  // Searchlights from the shore, sweeping the sky.
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), lights = [];
  const sl = 520, slG = new THREE.CylinderGeometry(14, 0.8, sl, 18, 1, true).translate(0, sl / 2, 0);
  for (let k = 0, n = [4, 6, 8][d]; k < n; k++) {
    const a = (k / n) * TAU + R() * 0.4, r = 185 + R() * 60, o = new THREE.Mesh(slG, beamMat(k % 3 ? 0xc8d8ff : 0xff8ad8, 0.32));
    o.position.set(Math.cos(a) * r, 4, Math.sin(a) * r);
    o.frustumCulled = false;
    view.add(o, false);
    lights.push({ o, a, sp: 0.12 + R() * 0.1, ph: R() * TAU });
  }
  view.onFrame.push((t) => {
    for (const l of lights) {
      const yaw = l.a + Math.PI + Math.sin(t * l.sp + l.ph) * 0.9, tilt = 0.32 + 0.22 * Math.sin(t * l.sp * 0.7 + l.ph * 2);
      dir.set(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
      l.o.quaternion.setFromUnitVectors(up, dir);
    }
  });
  // A sea of cloud at the foot of the Cloud Deck, lit from below by the city: you climb up through it.
  const cz = L.zones[7];
  if (cz) {
    const cm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uT: { value: 0 }, uLo: { value: HDR(0xff7ab8, 0.55) }, uHi: { value: HDR(0xb8c8ff, 0.5) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uT; uniform vec3 uLo; uniform vec3 uHi; varying vec3 vW;
        ${noiseGlsl()}
        void main(){
          vec2 p = vW.xz * 0.012 + vec2(uT * 0.004, uT * 0.0025) + vW.y * 0.37;
          float n = n21(p) * 0.55 + n21(p * 2.3 + 4.1) * 0.3 + n21(p * 5.1 + 9.3) * 0.15;
          float r = length(vW.xz), a = smoothstep(0.42, 0.75, n) * smoothstep(34.0, 70.0, r) * (1.0 - smoothstep(500.0, 900.0, r));
          vec3 c = mix(uHi, uLo, step(cameraPosition.y, vW.y)) * (0.6 + 0.6 * n);
          gl_FragColor = vec4(c, a * 0.75);
          #include <colorspace_fragment>
        }`,
    });
    view.timeMats.push(cm);
    for (const dy of [0, 6]) {
      const s = new THREE.Mesh(new THREE.RingGeometry(34, 900, 96, 6).rotateX(-Math.PI / 2), cm);
      s.position.y = cz.y0 + 6 + dy;
      s.frustumCulled = false;
      view.add(s, false);
    }
  }
}
