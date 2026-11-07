// Scenery: platform shapes and surfaces that differ per map and zone, floating islands with trees and plants
// that suit each zone, small plants on the ledges, animals animated on the GPU (birds, butterflies and
// critters), and better waterfalls with spray. Everything here is drawn with few draw calls: plants and props
// are instanced and coloured from one small palette texture; animals are whole flocks in one mesh each.
import { noiseGlsl } from './pattern.js';
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { CORE_R } from './level.js';
import { panelMat, HDR, mat4, canvasTex } from './worldview.js';

// Detail level from the graphics preset: 0 low (fewer islands and birds; no butterflies, critters, spray or
// ledge plants), 1 high, 2 ultra (more birds and butterflies).
let DETAIL = 1;
export function setDetail(d) { DETAIL = d; }
export const detail = () => DETAIL;

// ---------------------------------------------------------------- palette
// Each colour gets a 16 px swatch in a 256 px texture; model parts point their uvs at their swatch.
const PAL = [];
const palCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let palTex = null, palDirty = true;
function swatch(hex) {
  let i = PAL.indexOf(hex);
  if (i < 0) { i = PAL.length; PAL.push(hex); palDirty = true; }
  return [((i % 16) + 0.5) / 16, 1 - (Math.floor(i / 16) + 0.5) / 16];
}
function paletteTex() {
  if (!palTex) {
    palCanvas.width = palCanvas.height = 256;
    palTex = new THREE.CanvasTexture(palCanvas);
    palTex.colorSpace = THREE.SRGBColorSpace;
  }
  if (palDirty) {
    const g = palCanvas.getContext('2d');
    PAL.forEach((hex, i) => { g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.fillRect((i % 16) * 16, Math.floor(i / 16) * 16, 16, 16); });
    palTex.needsUpdate = true;
    palDirty = false;
  }
  return palTex;
}

// Merge parts { geo, m (Matrix4), c (hex), glow (hex or 0) } into one geometry with palette uvs.
function build(parts) {
  const pos = [], nor = [], uvs = [], glo = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const a = g.attributes.position.array, n = g.attributes.normal.array, [u, v] = swatch(p.c);
    const gl = p.glow ? HDR(p.glow, p.gk || 1) : null;
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      uvs.push(u, v);
      glo.push(gl ? gl.r : 0, gl ? gl.g : 0, gl ? gl.b : 0);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  return g;
}
const P = (geo, m, c, glow, gk) => ({ geo, m, c, glow, gk });
// Scale defaults to 1. (mat4 is looked up late: worldview.js and this file import each other.)
const M = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => mat4(x, y, z, sx, sy, sz, rx, ry, rz);
const cyl = (r1, r2, h, s = 8) => new THREE.CylinderGeometry(r1, r2, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);


// Foliage: leaves as small double sided diamonds whose normals point out from the middle of the clump, so a clump
// is lit like one soft rounded crown, not as flat facets. Built once per model from a fixed seed.
function leafGeo(list) {
  const pos = [], nor = [];
  for (const { c, t, b, n, s, w } of list) {
    const B = c.clone().addScaledVector(t, -s * 0.45), T = c.clone().addScaledVector(t, s * 0.55), Lf = c.clone().addScaledVector(b, w), Rt = c.clone().addScaledVector(b, -w);
    // Front side: wound so its face looks along n; the back the other way round, lit the same.
    let tri = [[B, Lf, T], [B, T, Rt]];
    const e1 = Lf.clone().sub(B), e2 = T.clone().sub(B);
    if (e1.cross(e2).dot(n) < 0) tri = [[B, T, Lf], [B, Rt, T]];
    for (const [p, q, r] of [...tri, ...tri.map(([p, q, r]) => [p, r, q])]) for (const v of [p, q, r]) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
// A round clump of leaves about 1 m across (squashed a little), in three shades over a dark inner fill.
function clump(seed, n, cols, inner, flat = 0.72) {
  const R = rng(seed), lists = cols.map(() => []), V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n; i++) {
    // More leaves on top and round the sides than underneath.
    const y = Math.min(1, Math.max(-0.75, R() * 2 - 0.62)), a = R() * TAU, h = Math.sqrt(1 - y * y);
    const d = V(Math.cos(a) * h, y, Math.sin(a) * h), rr = 0.82 + R() * 0.3;
    const c = V(d.x * rr, d.y * rr * flat, d.z * rr), n0 = V(d.x + (R() - 0.5) * 0.5, d.y * 1.3 + 0.25, d.z + (R() - 0.5) * 0.5).normalize();
    // The leaf lies across the surface, at a random turn, tilted a little.
    const up = Math.abs(n0.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0), t0 = up.clone().cross(n0).normalize(), b0 = n0.clone().cross(t0);
    const k = R() * TAU, t = t0.clone().multiplyScalar(Math.cos(k)).addScaledVector(b0, Math.sin(k)).addScaledVector(n0, (R() - 0.5) * 0.7).normalize();
    const b = n0.clone().cross(t).normalize(), s = 0.46 + R() * 0.2;
    lists[i % cols.length].push({ c, t, b, n: n0, s, w: s * (0.26 + R() * 0.08) });
  }
  return [P(ico(0.86, 1), M(0, 0, 0, 1, flat, 1), inner), ...lists.map((l, i) => P(leafGeo(l), M(0, 0, 0), cols[i]))];
}
// Ivy climbing a wall that faces +z: a wandering vine about 3 m tall with leaves lying nearly flat on the wall.
function ivy(seed, cols, stem) {
  const R = rng(seed), V = (x, y, z) => new THREE.Vector3(x, y, z), parts = [], lists = cols.map(() => []);
  let x = 0;
  for (let y = 0; y < 3; y += 0.5) {
    const nx = Math.max(-0.25, Math.min(0.25, x + (R() - 0.5) * 0.3));
    parts.push(P(cyl(0.022, 0.026, 0.52, 4), M((x + nx) / 2, y + 0.25, 0.03, 1, 1, 1, 0, 0, Math.atan2(x - nx, 0.5)), stem));
    x = nx;
  }
  for (let i = 0; i < 26; i++) {
    const y = R() * 3, side = R() < 0.5 ? -1 : 1, s = 0.2 + R() * 0.12;
    const c = V(Math.sin(y * 2.1 + seed) * 0.18 + side * (0.06 + R() * 0.16), y, 0.06 + R() * 0.08);
    const n = V((R() - 0.5) * 0.4, 0.3 + R() * 0.3, 1).normalize(), t = V(side * 0.5, -0.55 - R() * 0.4, 0.2).normalize(), b = n.clone().cross(t).normalize();
    lists[i % cols.length].push({ c, t, b, n, s, w: s * 0.42 });
  }
  return [...parts, ...lists.map((l, i) => P(leafGeo(l), M(0, 0, 0), cols[i]))];
}
// Shelf fungi on a wall facing +z: half discs stacked off the bark.
const bracket = (cols) => [[0, 0, 0.34], [0.2, 0.32, 0.26], [-0.16, 0.56, 0.2], [0.1, -0.3, 0.22]].flatMap(([x, y, r], i) => [
  P(new THREE.CylinderGeometry(r, r * 0.92, 0.07, 12, 1, false, -Math.PI / 2, Math.PI), M(x, y, -0.02, 1, 1, 1, -0.08), cols[i % 2]),
  P(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.02, 12, 1, false, -Math.PI / 2, Math.PI), M(x, y + 0.045, -0.02, 1, 1, 1, -0.08), cols[2])]);

// Hanging under a stone from y = 0 down: a wandering strand, with leaves or links on it. Few triangles: there are many of these.
function hanging(seed, len, stem, th, bits, bitR) {
  const R = rng(seed), parts = [];
  let x = 0, z = 0;
  for (let y = 0; y > -len; y -= 0.5) {
    const nx = x + (R() - 0.5) * 0.16, nz = z + (R() - 0.5) * 0.16;
    parts.push(P(new THREE.CylinderGeometry(th, th * 1.1, 0.54, 3, 1, true), M((x + nx) / 2, y - 0.25, (z + nz) / 2, 1, 1, 1, (nz - z) * 2, 0, (x - nx) * 2), stem));
    if (bits) for (let k = 0; k < 2; k++) parts.push(P(new THREE.TetrahedronGeometry(bitR, 0), M(nx + (R() - 0.5) * 0.24, y - 0.1 - R() * 0.3, nz + (R() - 0.5) * 0.24, 1.5, 0.6, 1.1, R() * 3, R() * 3, R() * 3), bits[k % bits.length]));
    x = nx; z = nz;
  }
  return parts;
}
// Wound round a post from y = 0 up.
function wound(seed, h, rad, stem, th, bits, bitR, glow) {
  const R = rng(seed), parts = [];
  for (let y = 0, a = R() * TAU; y < h; y += 0.26, a += 0.9) {
    parts.push(P(new THREE.CylinderGeometry(th, th, 0.34, 3, 1, true), M(Math.cos(a) * rad, y + 0.13, Math.sin(a) * rad, 1, 1, 1, 0.9, -a, 0), stem, glow, glow ? 2.2 : 0));
    if (bits && R() < 0.75) parts.push(P(new THREE.TetrahedronGeometry(bitR, 0), M(Math.cos(a) * (rad + 0.06), y + 0.1, Math.sin(a) * (rad + 0.06), 1.5, 0.6, 1.1, R() * 3, R() * 3, R() * 3), bits[(R() * bits.length) | 0]));
  }
  return parts;
}
// A bird with its beak toward +z and its wings up (k above 0) or down.
const bird = (body, wing, beak, k) => [
  P(ico(0.11, 0), M(0, 0, 0, 0.8, 0.7, 1.5), body), P(ico(0.075, 0), M(0, 0.04, 0.17), body), P(cone(0.03, 0.11, 4), M(0, 0.03, 0.27, 1, 1, 1, Math.PI / 2, 0, 0), beak),
  P(ico(0.022, 0), M(0.05, 0.07, 0.2), 0x200404, 0xff2a2a, 3), P(ico(0.022, 0), M(-0.05, 0.07, 0.2), 0x200404, 0xff2a2a, 3),
  P(box(0.34, 0.015, 0.14), M(0.2, k * 0.09, 0, 1, 1, 1, 0, 0, k * 0.55), wing), P(box(0.34, 0.015, 0.14), M(-0.2, k * 0.09, 0, 1, 1, 1, 0, 0, -k * 0.55), wing),
  P(box(0.1, 0.015, 0.16), M(0, 0, -0.2), wing)];

// ---------------------------------------------------------------- the Wild Forest's trees and plants
const I = () => M(0, 0, 0);
// The parts of a model moved by the matrix m (a clump placed in a crown, a fern on a log).
const at = (parts, m) => parts.map((p) => P(p.geo, m.clone().multiply(p.m), p.c, p.glow, p.gk));
// A limb from a to b ([x, y, z]): radius ra at a, rb at b.
function seg(a, b, ra, rb, s = 6) {
  const A0 = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A0), len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, s, 1).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate(A0.x, A0.y, A0.z);
}
const egg = (rx, ry, rz, w = 10, h = 7) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
// A geometry from a flat list of triangles, each corner [position, normal].
function tris(list) {
  const pos = [], nor = [];
  for (const [q, n] of list) { pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
// One tier of a spruce or fir: branches all round as a jagged skirt with drooping tips, and a darker underside. The
// normals point out from below the middle, so the tree is lit as one soft cone, not as flat facets.
function skirt(seed, r, h, n, droop) {
  const R = rng(seed), ring = [], V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n * 2; i++) {
    const a = ((i + (R() - 0.5) * 0.5) / (n * 2)) * TAU, tip = i % 2 === 0, rr = r * (tip ? 0.86 + R() * 0.28 : 0.48 + R() * 0.14);
    ring.push(V(Math.cos(a) * rr, tip ? -droop * (0.7 + R() * 0.6) : droop * 0.2, Math.sin(a) * rr));
  }
  const top = V(0, h, 0), under = V(0, h * 0.3, 0), cu = V(0, -r * 0.6, 0), cd = V(0, h + r, 0);
  const nu = (q) => q.clone().sub(cu).normalize(), nd = (q) => q.clone().sub(cd).normalize();
  const up = [], dn = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    up.push([top, nu(top).set(0, 1, 0)], [b, nu(b)], [a, nu(a)]);
    dn.push([under, V(0, -1, 0)], [a, nd(a)], [b, nd(b)]);
  }
  return [tris(up), tris(dn)];
}
// A spruce (or fir) H high with its lowest branches R0 out: a straight trunk and tiers of drooping branches.
function spruce(seed, H, R0, cols, dark, bark, nT) {
  const R = rng(seed), parts = [P(cyl(0.07, 0.36, H, 7), M(0, H / 2, 0), bark)], y0 = H * 0.13;
  for (let i = 0; i < nT; i++) {
    const t = i / (nT - 1), y = y0 + (H * 0.9 - y0) * Math.pow(t, 0.95), r = R0 * Math.pow(1 - t * 0.9, 0.9) * (0.9 + R() * 0.18), ry = R() * TAU;
    const [g1, g2] = skirt(seed * 31 + i, r, 0.5 + r * 0.42, r > 1.6 ? 10 : 7, 0.16 + r * 0.17);
    parts.push(P(g1, M(0, y, 0, 1, 1, 1, 0, ry), cols[i % cols.length]), P(g2, M(0, y, 0, 1, 1, 1, 0, ry), dark));
  }
  parts.push(P(cone(0.14, 1.2, 5), M(0, H * 0.9 + 0.75, 0), cols[0]));
  return parts;
}
// A broadleaf tree: trunk with a flared foot, limbs reaching out and up, a leafy clump at the end of each and on top.
function broadleaf(seed, o) {
  const R = rng(seed), parts = [P(cyl(o.tr * 0.62, o.tr, o.th, 9), M(0, o.th / 2, 0), o.bark), P(cone(o.tr * 1.8, o.tr * 2.4, 9), M(0, o.tr * 1.1, 0), o.bark)];
  const leaves = clump(seed + 3, o.leaves, o.cols, o.inner, o.flat ?? 0.72), crown = [];
  for (let k = 0; k < o.limbs; k++) {
    const a = (k / o.limbs) * TAU + R() * 0.8, lean = o.lean[0] + R() * (o.lean[1] - o.lean[0]), l = o.ll * (0.8 + R() * 0.4), y = o.th * (0.62 + R() * 0.3);
    const e = [Math.cos(a) * Math.sin(lean) * l, y + Math.cos(lean) * l, Math.sin(a) * Math.sin(lean) * l];
    parts.push(P(seg([0, y, 0], e, o.tr * 0.42, o.tr * 0.16), I(), o.bark));
    crown.push([e[0], e[1] + o.cs * 0.3, e[2], o.cs * (0.85 + R() * 0.3)]);
  }
  for (const [x, y, z] of o.top) crown.push([x, y, z, o.cs * (1 + R() * 0.2)]);
  for (const [x, y, z, sc] of crown) parts.push(...at(leaves, M(x, y, z, sc, sc, sc, 0, R() * TAU)));
  return parts;
}
// A fern: fronds of paired leaflets arching out from the middle.
function fernGeo(seed, n, len, cols) {
  const R = rng(seed), lists = cols.map(() => []), V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let f = 0; f < n; f++) {
    const a = (f / n) * TAU + R() * 0.5, ca = Math.cos(a), sa = Math.sin(a), L = len * (0.75 + R() * 0.45), up = 0.85 + R() * 0.5;
    for (let k = 1; k <= 6; k++) {
      const t = k / 7, c = V(ca * t * L, L * up * (0.9 * t - 0.75 * t * t), sa * t * L);
      const tan = V(ca, up * (0.9 - 1.5 * t), sa).normalize(), side = V(-sa, 0, ca), nrm = tan.clone().cross(side).normalize().multiplyScalar(-1);
      if (nrm.y < 0) nrm.negate();
      const s = 0.3 * L * (1 - t * 0.55);
      for (const sd of [-1, 1]) lists[(k + f) % cols.length].push({ c: c.clone().addScaledVector(side, sd * s * 0.45), t: side.clone().multiplyScalar(sd).addScaledVector(tan, 0.35).normalize(), b: tan, n: nrm, s, w: s * 0.26 });
    }
  }
  return lists.map((l, i) => P(leafGeo(l), I(), cols[i]));
}
// A tuft of long grass: thin blades bending out and over.
function blades(seed, n, h, cols) {
  const R = rng(seed), lists = cols.map(() => []), V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, ca = Math.cos(a), sa = Math.sin(a), r0 = R() * 0.1, hh = h * (0.6 + R() * 0.6), lean = 0.15 + R() * 0.45, w = 0.025 + R() * 0.015;
    const side = V(-sa, 0, ca), o = V(ca * r0, 0, sa * r0), out = V(ca, 0, sa);
    const m = o.clone().addScaledVector(out, hh * lean * 0.45).setY(hh * 0.58), tip = o.clone().addScaledVector(out, hh * lean * 1.1).setY(hh * (0.95 - lean * 0.3));
    const nrm = V(ca * 0.5, 1, sa * 0.5).normalize(), L = lists[i % cols.length];
    const q = [o.clone().addScaledVector(side, -w), o.clone().addScaledVector(side, w), m.clone().addScaledVector(side, w * 0.6), m.clone().addScaledVector(side, -w * 0.6)];
    for (const [x, y, z] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]], [q[3], q[2], tip]]) L.push([x, nrm], [y, nrm], [z, nrm], [x, nrm], [z, nrm], [y, nrm]);
  }
  return lists.map((l, i) => P(tris(l), I(), cols[i]));
}

// ---------------------------------------------------------------- plants and props (about 1 unit = 1 m)
const MODELS = {
  // On the relic courses: what hangs under the stones, is wound round the gates, and what the trees stand on.
  hangvine0: () => hanging(71, 3.2, 0x3a5a24, 0.022, [0x2f6a2a, 0x3c8030, 0x58993c], 0.12),
  hangvine1: () => hanging(72, 2.0, 0x3a5a24, 0.02, [0x3c8030, 0x58993c], 0.11),
  hangweed: () => hanging(77, 2.2, 0x3a7a4a, 0.024, [0x3a7a4a, 0x5a9a5a], 0.11),
  hangrope: () => hanging(73, 1.8, 0xc8a46a, 0.028),
  stalact: () => [P(cone(0.24, 1.4, 5), M(0, -0.7, 0, 1, 1, 1, Math.PI), 0x2a1a16), P(cone(0.08, 0.36, 4), M(0, -1.5, 0, 1, 1, 1, Math.PI), 0x3a1a10, 0xff5a1a, 2.6)],
  thrustC: () => [P(cyl(0.2, 0.3, 0.22, 8), M(0, -0.11, 0), 0x2a2e38), P(cyl(0.17, 0.17, 0.04, 10), M(0, -0.24, 0), 0xffd0f0, 0xff4fd8, 3)],
  thrustS: () => [P(cyl(0.2, 0.3, 0.22, 8), M(0, -0.11, 0), 0x3a4250), P(cyl(0.17, 0.17, 0.04, 10), M(0, -0.24, 0), 0xd0fff4, 0x3ff0d0, 3)],
  postvine: () => wound(81, 3.4, 0.28, 0x3a5a24, 0.025, [0x2f6a2a, 0x3c8030, 0x58993c], 0.1),
  postrope: () => wound(82, 3.4, 0.28, 0xc8a46a, 0.03),
  postcable: () => wound(83, 3.4, 0.23, 0x1a1c22, 0.022, [0xd8b020], 0.05),
  postchain: () => wound(84, 3.4, 0.23, 0x2a2220, 0.03, [0x3a1a10], 0.06),
  postneon: () => wound(85, 3.4, 0.23, 0xffd0f0, 0.018, null, 0, 0xff4fd8),
  isletG: () => [P(ico(1, 1), M(0, -0.55, 0, 1.3, 0.7, 1.3), 0x6a5a48), P(cyl(1.2, 1.3, 0.16, 10), M(0, 0, 0), 0x4f7a34)],
  isletS: () => [P(ico(1, 1), M(0, -0.55, 0, 1.3, 0.7, 1.3), 0x8a7a60), P(cyl(1.2, 1.3, 0.16, 10), M(0, 0, 0), 0xd9c49c)],
  isletW: () => [P(ico(1, 1), M(0, -0.55, 0, 1.3, 0.7, 1.3), 0x5a6a66), P(cyl(1.2, 1.3, 0.16, 10), M(0, 0, 0), 0x3f7a4a)],
  // Torn steel blown about by the storm.
  wreck0: () => [P(box(1.6, 0.07, 0.9), M(0, 0, 0, 1, 1, 1, 0.2, 0, 0.1), 0x5a6272), P(box(1.3, 0.06, 0.7), M(0.5, 0.16, 0.2, 1, 1, 1, -0.3, 0.5, 0.3), 0x4a5260), P(box(0.1, 0.1, 1.4), M(-0.5, -0.06, 0, 1, 1, 1, 0, 0.2, 0), 0x3a4250), P(box(0.1, 0.1, 1.4), M(0.4, -0.06, 0), 0x3a4250)],
  wreck1: () => [P(box(2.4, 0.1, 0.1), M(0, 0.2, 0), 0x4a5260), P(box(2.4, 0.1, 0.1), M(0, -0.2, 0), 0x4a5260), ...[-1, -0.33, 0.33, 1].map((x, k) => P(box(0.07, 0.46, 0.07), M(x, 0, 0, 1, 1, 1, 0, 0, k % 2 ? 0.5 : -0.5), 0x3a4250))],
  wreck2: () => [P(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8, 1, true), M(0, 0, 0), 0x6a7280), P(box(0.9, 0.05, 0.7), M(0.2, 0.6, 0.1, 1, 1, 1, 0.4, 0.2, 0.3), 0x4a5260), P(ico(0.06, 0), M(0.1, -0.4, 0.45), 0xffe8a0, 0xffd040, 3)],
  // A spire of basalt going all the way down (y is scaled to its height), and what is on top of it.
  basaltcol: () => [P(cyl(0.9, 1.05, 1, 6), M(0, -0.5, 0), 0x2a1e1a)],
  basalttop: () => [P(cyl(0.82, 0.9, 0.08, 6), M(0, 0.02, 0), 0x3a2a26), P(ico(0.2, 0), M(0.34, 0.08, 0.2), 0x3a1a10, 0xff5a1a, 2.4), P(ico(0.14, 0), M(-0.36, 0.06, -0.26), 0x3a1a10, 0xff5a1a, 2.4)],
  // A skyscraper's roof: the building is one box below it, the roof has a lip with neon round it.
  roofbox: () => [P(box(1.04, 1, 1.04), M(0, -0.5, 0), 0x2a2836)],
  roofneon: () => [P(box(1.06, 0.07, 0.015), M(0, -0.04, 0.522), 0xffd0f0, 0xff4fd8, 2.4), P(box(1.06, 0.07, 0.015), M(0, -0.04, -0.522), 0xffd0f0, 0xff4fd8, 2.4), P(box(0.015, 0.07, 1.06), M(0.522, -0.04, 0), 0xc0f0ff, 0x40e0ff, 2.4), P(box(0.015, 0.07, 1.06), M(-0.522, -0.04, 0), 0xc0f0ff, 0x40e0ff, 2.4)],
  birdU: () => bird(0x1a1a22, 0x24242e, 0xd8a020, 1),
  birdD: () => bird(0x1a1a22, 0x24242e, 0xd8a020, -1),
  gullU: () => bird(0xeeeae2, 0xb8bcc4, 0xe8a020, 1),
  gullD: () => bird(0xeeeae2, 0xb8bcc4, 0xe8a020, -1),
  beehive: () => [P(ico(0.5, 1), M(0, 0, 0, 0.85, 1, 0.85), 0xc89a3a), P(new THREE.TorusGeometry(0.42, 0.04, 4, 12), M(0, 0.18, 0, 1, 1, 1, Math.PI / 2), 0x8a6420), P(new THREE.TorusGeometry(0.42, 0.04, 4, 12), M(0, -0.14, 0, 1, 1, 1, Math.PI / 2), 0x8a6420), P(ico(0.1, 0), M(0, -0.28, 0.32), 0x1a1208), P(ico(0.05, 0), M(0.5, 0.2, 0.2), 0x1a1208), P(ico(0.05, 0), M(-0.45, -0.1, 0.35), 0x1a1208), P(ico(0.05, 0), M(0.2, 0.5, -0.3), 0x1a1208)],
  coconut: () => [P(ico(0.5, 1), M(0, 0, 0), 0x5a3a20), P(ico(0.07, 0), M(0.15, 0.2, 0.42), 0x1a1208), P(ico(0.07, 0), M(-0.15, 0.2, 0.42), 0x1a1208), P(ico(0.07, 0), M(0, 0, 0.48), 0x1a1208)],
  boulder: () => [P(new THREE.DodecahedronGeometry(0.5, 0), M(0, 0, 0), 0x7a7a76), P(new THREE.DodecahedronGeometry(0.22, 0), M(0.25, 0.3, 0.1), 0x3f7a4a)],
  lavabomb: () => [P(new THREE.DodecahedronGeometry(0.5, 0), M(0, 0, 0), 0x2a1410, 0xff5a1a, 1.4)],
  dronebomb: () => [P(box(0.5, 0.2, 0.5), M(0, 0, 0), 0x3a3e4a), P(box(0.16, 0.06, 0.16), M(0, -0.13, 0.1), 0x200404, 0xff3050, 3), ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([a, b]) => [P(box(0.36, 0.04, 0.04), M(a * 0.28, 0.08, b * 0.28, 1, 1, 1, 0, a * b * 0.78, 0), 0x2a2e38), P(cyl(0.16, 0.16, 0.015, 8), M(a * 0.42, 0.13, b * 0.42), 0x8a8e96)])],
  flytrap: () => [P(cyl(0.05, 0.08, 1.5, 5), M(0, -1.05, 0), 0x3a7a32), P(new THREE.SphereGeometry(0.5, 10, 6, 0, TAU, 0, Math.PI / 2), M(0, 0.04, 0, 1, 0.8, 1, -0.35), 0x4f9a3a), P(new THREE.SphereGeometry(0.5, 10, 6, 0, TAU, 0, Math.PI / 2), M(0, -0.04, 0, 1, 0.8, 1, Math.PI + 0.35), 0x4f9a3a), P(ico(0.34, 0), M(0, 0, 0.08), 0x8a1a20, 0xff3040, 0.6),
    ...[-0.36, -0.18, 0, 0.18, 0.36].flatMap((x) => [P(cone(0.035, 0.17, 3), M(x, 0.08, 0.42 - Math.abs(x) * 0.5, 1, 1, 1, Math.PI), 0xf0e6d0), P(cone(0.035, 0.17, 3), M(x, -0.08, 0.42 - Math.abs(x) * 0.5), 0xf0e6d0)])],
  magnet: () => [P(new THREE.TorusGeometry(0.42, 0.13, 6, 12, Math.PI), M(0, 0.05, 0), 0xc83030), P(box(0.26, 0.3, 0.26), M(0.42, -0.1, 0), 0xc8ccd4, 0x40e0ff, 1.2), P(box(0.26, 0.3, 0.26), M(-0.42, -0.1, 0), 0xc8ccd4, 0xff4fd8, 1.2)],
  // The Wild Forest: tall spruces and firs, oaks, birches, pines, dead snags, fallen logs, ferns and long grass.
  spruceT: () => spruce(201, 11.5, 3.2, [0x2a5a2e, 0x316634, 0x3a723a], 0x173219, 0x4a3828, 12),
  firT: () => spruce(203, 12.5, 2.7, [0x1f4a36, 0x26553c, 0x2e6244], 0x11281c, 0x3e3026, 14),
  oakT: () => broadleaf(205, { tr: 0.5, th: 4.6, bark: 0x4e3e2e, limbs: 4, lean: [0.55, 0.95], ll: 2.6, cs: 2.0, leaves: 60,
    cols: [0x3a7a30, 0x4a9038, 0x68a844], inner: 0x2a5a22, top: [[0, 8.2, 0], [0.6, 7.0, -0.7]] }),
  beechT: () => broadleaf(207, { tr: 0.42, th: 5.4, bark: 0x7a7468, limbs: 3, lean: [0.35, 0.7], ll: 2.8, cs: 1.9, leaves: 60,
    cols: [0x447e2c, 0x5a9634, 0x78aa3c], inner: 0x325e22, top: [[0, 9.0, 0], [-0.8, 7.8, 0.6]] }),
  birchT: () => {
    const R = rng(209), parts = [P(cyl(0.11, 0.2, 9.4, 8), M(0, 4.7, 0), 0xe6e2d8)];
    for (let k = 0; k < 11; k++) { const y = 0.5 + R() * 8, a = R() * TAU, r = 0.2 - y * 0.0095; parts.push(P(box(0.12 + R() * 0.06, 0.04 + R() * 0.05, 0.05), M(Math.cos(a) * r, y, Math.sin(a) * r, 1, 1, 1, 0, -(a + Math.PI / 2)), 0x2a2622)); }
    const leaves = clump(211, 50, [0x5a9a3a, 0x74b04a, 0x92c45a], 0x3a7028);
    for (const [x, y, z, sc] of [[0.9, 6.2, 0.3, 1.3], [-0.8, 7.0, -0.4, 1.4], [0.2, 8.0, 0.9, 1.3], [-0.3, 9.2, -0.2, 1.5], [0.6, 8.6, -0.8, 1.1]]) {
      parts.push(P(seg([0, y - 1.6, 0], [x * 0.8, y, z * 0.8], 0.07, 0.03, 5), I(), 0xe6e2d8), ...at(leaves, M(x, y, z, sc, sc * 1.15, sc, 0, R() * TAU)));
    }
    return parts;
  },
  pineT: () => {
    const R = rng(213), parts = [P(cyl(0.2, 0.36, 7.5, 8), M(0, 3.75, 0), 0x5a4434), P(cyl(0.12, 0.2, 4, 7), M(0, 9.3, 0), 0xb0703c)];
    const leaves = clump(215, 50, [0x2a5a2c, 0x346a34, 0x3f7a3c], 0x1e4220, 0.45);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + R() * 0.5, d = k === 4 ? 0 : 1.2 + R() * 0.6, y = 8.4 + R() * 1.2 + (k === 4) * 2.2, x = Math.cos(a) * d, z = Math.sin(a) * d, sc = 1.5 + R() * 0.5;
      if (d) parts.push(P(seg([0, y - 0.8, 0], [x, y, z], 0.1, 0.05, 5), I(), 0x9a6034));
      parts.push(...at(leaves, M(x, y, z, sc * 1.2, sc * 0.75, sc * 1.2, 0, R() * TAU)));
    }
    return parts;
  },
  snagT: () => {
    const R = rng(217), parts = [P(cyl(0.12, 0.34, 7, 8), M(0, 3.5, 0), 0x6a625a), P(cone(0.13, 0.7, 6), M(0.04, 7.3, 0, 1, 1, 1, 0.2, 0, 0.3), 0x8a8276)];
    for (let k = 0; k < 5; k++) { const a = R() * TAU, y = 2.8 + R() * 3.6, l = 1 + R() * 1.4; parts.push(P(seg([0, y, 0], [Math.cos(a) * l, y + l * (0.3 + R() * 0.5), Math.sin(a) * l], 0.07, 0.02, 5), I(), 0x6a625a)); }
    parts.push(...at(bracket([0xc89a5a, 0xa8743e, 0xeee0c0]), M(0, 1.6, 0.3, 0.6)), ...at(bracket([0xd8c8a8, 0xb8a888, 0xf0e8d8]), M(-0.2, 2.6, -0.24, 0.45, 0.45, 0.45, 0, Math.PI)));
    return parts;
  },
  logT: () => {
    const moss = clump(219, 40, [0x4a8a3a, 0x63a446, 0x8cc05a], 0x3a6e2e, 0.4);
    return [P(seg([-2.6, 0.36, 0], [2.6, 0.42, 0.1], 0.42, 0.34, 10), I(), 0x5a4632), P(cyl(0.38, 0.38, 0.04, 10), M(-2.62, 0.36, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0xb08a5a),
      P(cyl(0.3, 0.3, 0.04, 10), M(2.62, 0.42, 0.1, 1, 1, 1, 0, 0, Math.PI / 2), 0xb08a5a), ...at(moss, M(-0.9, 0.74, 0, 1.1, 0.4, 0.42)), ...at(moss, M(1.2, 0.76, 0.06, 0.8, 0.35, 0.36, 0, 1.2)),
      ...at(bracket([0xc89a5a, 0xa8743e, 0xeee0c0]), M(0.4, 0.4, 0.42, 0.35))];
  },
  stumpT: () => [P(cyl(0.42, 0.56, 0.7, 10), M(0, 0.35, 0), 0x5a4632), P(cyl(0.4, 0.4, 0.03, 10), M(0, 0.71, 0), 0xb89a6a), P(cyl(0.2, 0.2, 0.035, 10), M(0, 0.715, 0), 0xa0805a),
    ...at(clump(221, 30, [0x4a8a3a, 0x63a446], 0x3a6e2e, 0.4), M(0.3, 0.2, 0.3, 0.4, 0.3, 0.4))],
  fernT: () => fernGeo(223, 7, 0.95, [0x2f7a2c, 0x3f8c34, 0x58a040]),
  tuftT: () => blades(225, 12, 0.7, [0x5a9a3a, 0x74ae46, 0x8ab84e]),
  shrubT: () => [...at(clump(227, 46, [0x2f6a2a, 0x3c8030, 0x58993c], 0x22501f), M(0, 0.55, 0, 0.8, 0.62, 0.8)), ...at(clump(228, 30, [0x3c8030, 0x58993c], 0x22501f), M(0.55, 0.42, 0.2, 0.5, 0.42, 0.5))],
  // The same trees smaller, for the floating islands and ledges up the climb.
  spruceS: () => at(MODELS.spruceT(), M(0, 0, 0, 0.4)),
  oakS: () => at(MODELS.oakT(), M(0, 0, 0, 0.4)),
  birchS: () => at(MODELS.birchT(), M(0, 0, 0, 0.38)),
  snagS: () => at(MODELS.snagT(), M(0, 0, 0, 0.42)),
  mossrock: () => [P(new THREE.DodecahedronGeometry(0.62, 1), M(0, 0.28, 0, 1.25, 0.72, 1), 0x7a776e), P(new THREE.DodecahedronGeometry(0.34, 0), M(0.62, 0.12, 0.3), 0x6a675e),
    ...at(clump(229, 36, [0x4a8a3a, 0x63a446, 0x8cc05a], 0x3a6e2e, 0.4), M(-0.1, 0.62, 0, 0.62, 0.3, 0.52))],
  pine: () => [P(cyl(0.12, 0.2, 1.4), M(0, 0.7, 0), 0x5a3e28), P(cone(1.0, 1.7, 9), M(0, 1.7, 0), 0x24603a), P(cone(0.8, 1.5, 9), M(0, 2.4, 0, 1, 1, 1, 0, 0.4), 0x2c6e40), P(cone(0.55, 1.2, 9), M(0, 3.1, 0, 1, 1, 1, 0, 0.8), 0x347a46)],
  frostpine: () => [P(cyl(0.12, 0.2, 1.4), M(0, 0.7, 0), 0x4a3a30), P(cone(1.0, 1.7, 9), M(0, 1.7, 0), 0xd8eef6), P(cone(0.8, 1.5, 9), M(0, 2.4, 0, 1, 1, 1, 0, 0.4), 0x5a8a8a), P(cone(0.55, 1.2, 9), M(0, 3.1, 0, 1, 1, 1, 0, 0.8), 0xeaf6fa)],
  oak: () => [P(cyl(0.14, 0.24, 1.8), M(0, 0.9, 0), 0x5e4028), P(cyl(0.06, 0.08, 0.9), M(0.3, 1.5, 0, 1, 1, 1, 0, 0, -0.7), 0x5e4028),
    P(ico(0.95, 1), M(0, 2.35, 0), 0x3f8a36), P(ico(0.7, 1), M(0.62, 2.0, 0.25), 0x4a9a3e), P(ico(0.72, 1), M(-0.55, 2.1, -0.2), 0x36803a), P(ico(0.6, 1), M(0.1, 2.85, -0.35), 0x56a646)],
  birch: () => [P(cyl(0.09, 0.13, 2.6), M(0, 1.3, 0), 0xeeeae2), P(box(0.19, 0.06, 0.05), M(0, 0.8, 0.1), 0x2a2a2a), P(box(0.17, 0.05, 0.05), M(0, 1.6, -0.1), 0x2a2a2a),
    P(ico(0.7, 1), M(0, 2.7, 0, 1, 1.3, 1), 0x9ad05a), P(ico(0.5, 1), M(0.35, 2.3, 0.2), 0xb4dc6a)],
  blossom: () => [P(cyl(0.11, 0.2, 1.5), M(0, 0.75, 0), 0x4a3028), P(cyl(0.06, 0.08, 0.8), M(-0.3, 1.4, 0, 1, 1, 1, 0, 0, 0.7), 0x4a3028),
    P(ico(0.85, 1), M(0, 2.1, 0), 0xffa8d0), P(ico(0.62, 1), M(0.58, 1.85, 0.2), 0xff8ac0), P(ico(0.65, 1), M(-0.55, 1.95, -0.15), 0xffc0dc), P(ico(0.5, 1), M(0.1, 2.6, 0.3), 0xffd4e6)],
  palm: () => {
    const parts = [];
    for (let k = 0; k < 6; k++) parts.push(P(cyl(0.16 - k * 0.012, 0.18 - k * 0.012, 0.75), M(k * k * 0.035, 0.35 + k * 0.7, 0, 1, 1, 1, 0, 0, -k * 0.07), 0x9a7a52));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      parts.push(P(box(0.32, 0.04, 1.9).translate(0, 0, 0.95), M(1.25, 4.15, 0, 1, 1, 1, 0.38, a, 0), k % 2 ? 0x3e9a3a : 0x4fb048));
    }
    parts.push(P(ico(0.14, 0), M(1.2, 3.95, 0.12), 0x6a4a28), P(ico(0.14, 0), M(1.32, 3.95, -0.1), 0x6a4a28));
    return parts;
  },
  bamboo: () => {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const x = Math.cos(k * 2.4) * 0.28, z = Math.sin(k * 2.4) * 0.28, h = 2.6 + (k % 3) * 0.6;
      parts.push(P(cyl(0.05, 0.06, h), M(x, h / 2, z), 0x7aaa3a));
      for (let y = 0.5; y < h; y += 0.55) parts.push(P(cyl(0.065, 0.065, 0.05), M(x, y, z), 0x4a7a2a));
      parts.push(P(cone(0.22, 0.6, 5), M(x + 0.15, h - 0.2, z, 1, 1, 0.3, 0, 0, -1.1), 0x5aa83a), P(cone(0.2, 0.5, 5), M(x - 0.12, h - 0.45, z, 1, 1, 0.3, 0, 0, 1.0), 0x6ab84a));
    }
    return parts;
  },
  dead: () => [P(cyl(0.1, 0.22, 2.4), M(0, 1.2, 0), 0x4a403a), P(cyl(0.04, 0.07, 1.1), M(0.35, 1.8, 0, 1, 1, 1, 0, 0, -0.9), 0x4a403a),
    P(cyl(0.035, 0.06, 0.9), M(-0.3, 2.1, 0.1, 1, 1, 1, 0.2, 0, 0.8), 0x4a403a), P(cyl(0.03, 0.05, 0.8), M(0.05, 2.5, -0.3, 1, 1, 1, -0.8, 0, 0), 0x4a403a), P(cyl(0.025, 0.04, 0.6), M(0.6, 2.25, 0.05, 1, 1, 1, 0, 0, -0.3), 0x4a403a)],
  shroom: () => [P(cyl(0.16, 0.24, 1.6), M(0, 0.8, 0), 0xf0e6d0), P(new THREE.SphereGeometry(0.95, 14, 7, 0, TAU, 0, Math.PI / 2), M(0, 1.5, 0, 1, 0.6, 1), 0xd8302a),
    P(cyl(0.9, 0.9, 0.05, 14), M(0, 1.5, 0), 0xf6e0c8), ...[0, 1, 2, 3, 4].map((k) => P(ico(0.12, 0), M(Math.cos(k * 1.3) * 0.55, 1.88 + (k % 2) * 0.06, Math.sin(k * 1.3) * 0.55), 0xffffff))],
  glowshroom: () => [P(cyl(0.12, 0.18, 1.2), M(0, 0.6, 0), 0xe8f0e0), P(new THREE.SphereGeometry(0.7, 12, 6, 0, TAU, 0, Math.PI / 2), M(0, 1.15, 0, 1, 0.55, 1), 0x3fd8c0, 0x3fe0c8, 0.9),
    P(cyl(0.66, 0.66, 0.04, 12), M(0, 1.15, 0), 0x9af0e0, 0x9af0e0, 0.6)],
  glowtree: () => [P(cyl(0.12, 0.2, 1.6), M(0, 0.8, 0), 0x3a2e28), P(ico(0.85, 1), M(0, 2.15, 0), 0x2a8a7a, 0x3fe0c8, 0.5), P(ico(0.6, 1), M(0.55, 1.85, 0.2), 0x2a7a6a, 0x3fe0c8, 0.45), P(ico(0.6, 1), M(-0.5, 1.95, -0.2), 0x2a8a7a, 0x5ff0d8, 0.5)],
  crystal: () => [0, 1, 2, 3, 4].map((k) => P(new THREE.OctahedronGeometry(0.3, 0), M(Math.cos(k * 1.9) * 0.3 * (k > 0), 0.55 + (k === 0) * 0.3, Math.sin(k * 1.9) * 0.3 * (k > 0), 0.8, 2.6 - (k > 0) * 1.0, 0.8, Math.cos(k) * 0.3 * (k > 0), 0, Math.sin(k) * 0.35 * (k > 0)), 0x9ae8ff, 0x7fd8ff, 0.8)),
  obsidian: () => [0, 1, 2, 3].map((k) => P(new THREE.OctahedronGeometry(0.3, 0), M(Math.cos(k * 1.9) * 0.28 * (k > 0), 0.5 + (k === 0) * 0.3, Math.sin(k * 1.9) * 0.28 * (k > 0), 0.8, 2.4 - (k > 0) * 0.9, 0.8, Math.cos(k) * 0.3 * (k > 0), 0, Math.sin(k) * 0.35 * (k > 0)), 0x3a2448, 0xb06bff, 0.5)),
  bush: () => [P(ico(0.5, 1), M(0, 0.35, 0), 0x3f8a36), P(ico(0.4, 1), M(0.4, 0.3, 0.15), 0x4a9a3e), P(ico(0.38, 1), M(-0.35, 0.3, -0.1), 0x36803a), P(ico(0.32, 1), M(0.05, 0.62, -0.2), 0x56a646)],
  flowers: () => {
    const parts = [], cols = [0xff5a8a, 0xffe066, 0xffffff, 0xb48cff, 0xff8a3d];
    for (let k = 0; k < 7; k++) {
      const x = Math.cos(k * 2.3) * 0.32 * (k % 3) / 2, z = Math.sin(k * 2.3) * 0.32 * (k % 3) / 2, h = 0.35 + (k % 3) * 0.12;
      parts.push(P(cyl(0.015, 0.015, h, 4), M(x, h / 2, z), 0x4a9a3a), P(ico(0.08, 0), M(x, h, z), cols[k % 5]));
    }
    parts.push(P(ico(0.22, 0), M(0, 0.08, 0, 1.4, 0.5, 1.4), 0x4a9a3e));
    return parts;
  },
  fern: () => [0, 1, 2, 3, 4, 5, 6].map((k) => P(cone(0.12, 0.9, 4), M(Math.cos(k * 0.9) * 0.2, 0.38, Math.sin(k * 0.9) * 0.2, 1, 1, 0.35, Math.sin(k * 0.9) * 0.7, 0, -Math.cos(k * 0.9) * 0.7), k % 2 ? 0x3e8a3a : 0x52a046)),
  grass: () => [0, 1, 2, 3, 4, 5].map((k) => P(cone(0.04, 0.5, 3), M(Math.cos(k * 1.1) * 0.12, 0.24, Math.sin(k * 1.1) * 0.12, 1, 1, 1, Math.sin(k) * 0.25, 0, Math.cos(k) * 0.25), k % 2 ? 0x6ab84a : 0x5aa83a)),
  cactus: () => [P(cyl(0.22, 0.25, 2.2, 10), M(0, 1.1, 0), 0x4a9a4a), P(ico(0.22, 1), M(0, 2.2, 0), 0x4a9a4a), P(cyl(0.12, 0.12, 0.5, 8), M(0.32, 1.2, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0x4a9a4a),
    P(cyl(0.12, 0.12, 0.7, 8), M(0.55, 1.5, 0), 0x4a9a4a), P(cyl(0.11, 0.11, 0.5, 8), M(-0.3, 1.5, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0x4a9a4a), P(cyl(0.11, 0.11, 0.6, 8), M(-0.5, 1.75, 0), 0x4a9a4a), P(ico(0.1, 0), M(0, 2.4, 0), 0xff5a8a)],
  coral: () => {
    const parts = [], cols = [0xff7a6a, 0xff9ad8, 0xffb43d];
    for (let k = 0; k < 7; k++) { const a = k * 0.9, l = 0.6 + (k % 3) * 0.3; parts.push(P(cyl(0.05, 0.09, l, 6), M(Math.cos(a) * 0.15, l / 2, Math.sin(a) * 0.15, 1, 1, 1, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), cols[k % 3]), P(ico(0.08, 0), M(Math.cos(a) * (0.15 + l * 0.45), l * 0.9, Math.sin(a) * (0.15 + l * 0.45)), cols[(k + 1) % 3])); }
    return parts;
  },
  reeds: () => [0, 1, 2, 3, 4, 5].map((k) => [P(cyl(0.02, 0.025, 1.4 + (k % 3) * 0.3, 4), M(Math.cos(k * 1.7) * 0.2, 0.7 + (k % 3) * 0.15, Math.sin(k * 1.7) * 0.2), 0x6a9a3a), P(cyl(0.05, 0.05, 0.25, 6), M(Math.cos(k * 1.7) * 0.2, 1.45 + (k % 3) * 0.3, Math.sin(k * 1.7) * 0.2), 0x6a4a2a)]).flat(),
  // Storm station gear. A tesla coil: copper column in rings, a steel doughnut and a glowing tip.
  coil: () => [P(box(0.8, 0.4, 0.8), M(0, 0.2, 0), 0x3a3e46), P(cyl(0.16, 0.2, 2.2, 10), M(0, 1.5, 0), 0x8a6a4a),
    ...[0, 1, 2, 3, 4, 5].map((k) => P(new THREE.TorusGeometry(0.22, 0.035, 5, 14), M(0, 0.6 + k * 0.34, 0, 1, 1, 1, Math.PI / 2), 0x5a4a3a)),
    P(new THREE.TorusGeometry(0.42, 0.14, 8, 18), M(0, 2.7, 0, 1, 1, 1, Math.PI / 2), 0xb8bcc4), P(ico(0.16, 1), M(0, 2.95, 0), 0x9ae8ff, 0x7fd8ff, 3.0)],
  // A radar dish on a steel frame, a red light on top.
  dish: () => [...[0, 1, 2].map((k) => P(cyl(0.04, 0.06, 1.6, 5), M(Math.cos(k * 2.09) * 0.35, 0.75, Math.sin(k * 2.09) * 0.35, 1, 1, 1, Math.sin(k * 2.09) * 0.22, 0, -Math.cos(k * 2.09) * 0.22), 0x6a6e76)),
    P(box(0.4, 0.3, 0.4), M(0, 1.6, 0), 0x3a3e46), P(new THREE.SphereGeometry(1.1, 14, 5, 0, TAU, 0, 0.75), M(0, 2.6, 0.25, 1, 1, 1, -1.9), 0xeeeae2),
    P(cyl(0.03, 0.03, 0.9, 5), M(0, 2.2, 0.55, 1, 1, 1, -0.35), 0x3a3e46), P(ico(0.08, 0), M(0, 1.82, 0), 0x200404, 0xff3050, 3)],
  // A weather mast: anemometer cups up top, a vane under them, the four points.
  vane: () => [P(cyl(0.04, 0.06, 2.8, 6), M(0, 1.4, 0), 0x3a3e46), ...[0, 1, 2].map((k) => [P(box(0.5, 0.025, 0.025), M(Math.cos(k * 2.09) * 0.25, 2.85, Math.sin(k * 2.09) * 0.25, 1, 1, 1, 0, -k * 2.09, 0), 0x8a8e96),
    P(new THREE.SphereGeometry(0.08, 8, 4, 0, TAU, 0, Math.PI / 2), M(Math.cos(k * 2.09) * 0.5, 2.85, Math.sin(k * 2.09) * 0.5, 1, 1, 1, 0, -k * 2.09, Math.PI / 2), 0xb8bcc4)]).flat(),
    P(box(0.9, 0.03, 0.03), M(0, 2.5, 0), 0x3a3e46), P(box(0.03, 0.03, 0.9), M(0, 2.5, 0), 0x3a3e46), P(box(0.7, 0.16, 0.02), M(0.15, 2.68, 0), 0xd8b020), P(cone(0.08, 0.22, 4), M(-0.3, 2.68, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0xc83030)],
  // A small wind turbine's tower and nacelle (the rotor spins on its own, worldview.js stormGear).
  turbine: () => [P(cyl(0.1, 0.2, 5.6, 8), M(0, 2.8, 0), 0xeeeae2), P(box(0.36, 0.34, 0.9), M(0, 5.7, -0.15), 0xb8bcc4), P(cyl(0.2, 0.3, 0.3, 8), M(0, 0.15, 0), 0x6a6e76), P(ico(0.05, 0), M(0, 5.92, -0.4), 0x200404, 0xff3050, 3)],
  rotor: () => [P(cone(0.13, 0.3, 8), M(0, 0, 0.12, 1, 1, 1, Math.PI / 2), 0xb8bcc4), ...[0, 1, 2].map((k) => P(box(0.16, 2.2, 0.03), M(Math.cos(k * 2.09 + 1.57) * 1.1, Math.sin(k * 2.09 + 1.57) * 1.1, 0, 1, 1, 1, 0, 0, k * 2.09), 0xeeeae2))],
  antenna: () => [P(cyl(0.05, 0.08, 3.2, 6), M(0, 1.6, 0), 0x8a8e96), P(box(0.9, 0.04, 0.04), M(0, 2.4, 0), 0x8a8e96), P(box(0.6, 0.04, 0.04), M(0, 2.9, 0), 0x8a8e96),
    P(cone(0.32, 0.18, 12), M(0.3, 1.6, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0xd8dce4), P(ico(0.07, 0), M(0, 3.25, 0), 0xff3030, 0xff3030, 2.5)],
  acunit: () => [P(box(0.9, 0.6, 0.7), M(0, 0.3, 0), 0xb8bcc4), P(cyl(0.24, 0.24, 0.04, 12), M(0, 0.62, 0), 0x3a3e46), P(box(0.92, 0.05, 0.05), M(0, 0.45, 0.36), 0x6a6e76)],
  tank: () => [P(cyl(0.6, 0.6, 1.2, 12), M(0, 1.8, 0), 0x8a6a4a), P(cone(0.68, 0.5, 12), M(0, 2.65, 0), 0x5a4a3a), ...[0, 1, 2, 3].map((k) => P(cyl(0.04, 0.04, 1.2, 4), M(Math.cos(k * 1.57 + 0.78) * 0.45, 0.6, Math.sin(k * 1.57 + 0.78) * 0.45), 0x4a4a4a))],
  lamp: () => [P(cyl(0.04, 0.07, 2.4, 6), M(0, 1.2, 0), 0x3a3e46), P(box(0.5, 0.04, 0.04), M(0.22, 2.35, 0), 0x3a3e46), P(cone(0.14, 0.16, 8), M(0.45, 2.25, 0), 0x3a3e46), P(ico(0.08, 0), M(0.45, 2.15, 0), 0xffd890, 0xffc87a, 3.0)],
  debris: () => [P(box(1.2, 0.08, 0.7), M(0, 0.3, 0, 1, 1, 1, 0.3, 0.4, 0.2), 0x5a6070), P(box(0.8, 0.06, 0.5), M(0.3, 0.5, -0.2, 1, 1, 1, -0.5, 1.2, 0.4), 0x6a7080),
    P(cyl(0.08, 0.08, 1.4, 8), M(-0.3, 0.4, 0.2, 1, 1, 1, 0.2, 0, 1.2), 0x4a5060), P(ico(0.06, 0), M(0.2, 0.62, 0.1), 0x3ff0d0, 0x3ff0d0, 2.0)],
  hut: () => [P(box(1.4, 1.0, 1.2), M(0, 0.5, 0), 0xd8b880), P(cone(1.15, 0.8, 4), M(0, 1.4, 0, 1, 1, 1, 0, Math.PI / 4), 0xc8a050), P(box(0.36, 0.6, 0.04), M(0, 0.3, 0.61), 0x6a4a2a)],
  ember: () => [P(new THREE.DodecahedronGeometry(0.4, 0), M(0, 0.25, 0, 1.2, 0.7, 1), 0x2a2220, 0xff5a1a, 0.35), P(new THREE.DodecahedronGeometry(0.25, 0), M(0.4, 0.15, 0.2), 0x2a2220, 0xff7a2a, 0.5)],
  umbrella: () => [P(cyl(0.03, 0.03, 2.0, 6), M(0, 1.0, 0, 1, 1, 1, 0.08, 0, 0), 0xeeeeee), P(cone(1.0, 0.45, 10), M(0, 2.05, 0.08), 0xff5a4a), P(cone(1.02, 0.12, 10), M(0, 1.84, 0.08), 0xffffff)],
  rocks: () => [P(new THREE.DodecahedronGeometry(0.35, 0), M(0, 0.2, 0, 1, 0.7, 1), 0x8a8478), P(new THREE.DodecahedronGeometry(0.25, 0), M(0.35, 0.12, 0.15), 0x7a746a), P(new THREE.DodecahedronGeometry(0.2, 0), M(-0.25, 0.1, -0.2), 0x9a9488)],
  planter: () => [P(box(1.0, 0.4, 0.5), M(0, 0.2, 0), 0x6a6e76), P(ico(0.32, 1), M(-0.25, 0.55, 0), 0x3f8a36), P(ico(0.3, 1), M(0.22, 0.52, 0.05), 0x4a9a3e), P(ico(0.08, 0), M(0.05, 0.7, 0.15), 0xff5a8a)],
  // The maze gardens (mazeview.js): pond things, the tops of the posts between the walls, and the creatures that prowl
  // the corridors. Creatures face +z with their feet at 0.
  lilypad: () => [P(cyl(0.26, 0.26, 0.02, 10), M(0, 0.01, 0), 0x3a9a3a), P(cyl(0.2, 0.2, 0.025, 10), M(0.05, 0.012, 0.02), 0x4ab04a)],
  lotus: () => [P(cyl(0.24, 0.24, 0.02, 10), M(0, 0.01, 0), 0x3a9a3a), ...[0, 1, 2, 3, 4].map((k) => P(cone(0.05, 0.16, 4), M(Math.cos(k * 1.26) * 0.05, 0.08, Math.sin(k * 1.26) * 0.05, 1, 1, 1, Math.sin(k * 1.26) * 0.5, 0, -Math.cos(k * 1.26) * 0.5), 0xffb0d8)), P(ico(0.035, 0), M(0, 0.07, 0), 0xffe066, 0xffe066, 0.6)],
  topiary: () => [P(ico(0.3, 1), M(0, 0.24, 0), 0x3a8a32), P(ico(0.16, 1), M(0, 0.6, 0), 0x4a9a3e)],
  urn: () => [P(cyl(0.16, 0.22, 0.08, 10), M(0, 0.04, 0), 0xe8d4a8), P(cyl(0.2, 0.1, 0.3, 10), M(0, 0.23, 0), 0xc87a4a), P(cyl(0.13, 0.2, 0.06, 10), M(0, 0.41, 0), 0xc87a4a), P(ico(0.14, 0), M(0, 0.5, 0), 0x4a9a3e), P(ico(0.05, 0), M(0.06, 0.6, 0.04), 0xff5a8a)],
  pylon: () => [P(cyl(0.2, 0.22, 0.1, 8), M(0, 0.05, 0), 0x3a4250), P(cyl(0.05, 0.05, 0.3, 6), M(0, 0.25, 0), 0x5a6270), P(new THREE.OctahedronGeometry(0.11, 0), M(0, 0.48, 0), 0x7ff8ff, 0x7ff8ff, 2.4)],
  brazier: () => [P(cyl(0.22, 0.14, 0.18, 8), M(0, 0.09, 0), 0x2a2220), P(cone(0.13, 0.32, 6), M(0, 0.32, 0), 0xffa030, 0xff6a10, 2.6), P(cone(0.07, 0.22, 5), M(0.05, 0.42, 0.02), 0xffe070, 0xffd040, 3)],
  neonpost: () => [P(cyl(0.19, 0.19, 0.06, 12), M(0, 0.03, 0), 0x2a2e38), P(new THREE.TorusGeometry(0.12, 0.025, 4, 16).rotateX(Math.PI / 2), M(0, 0.12, 0), 0xff40d0, 0xff40d0, 2.6), P(ico(0.06, 0), M(0, 0.22, 0), 0x40f0ff, 0x40f0ff, 2.6)],
  mosscap: () => [P(cyl(0.22, 0.2, 0.08, 8), M(0, 0.04, 0), 0x6a7a6a), P(ico(0.14, 0), M(0.06, 0.12, 0), 0x3a8a3a), P(cyl(0.025, 0.03, 0.14, 5), M(-0.07, 0.13, 0.05), 0xe8f0e0), P(new THREE.SphereGeometry(0.08, 8, 4, 0, TAU, 0, Math.PI / 2), M(-0.07, 0.2, 0.05, 1, 0.6, 1), 0x3fd8c0, 0x3fe0c8, 1.2)],
  shrine: () => [P(cyl(0.42, 0.5, 0.14, 12), M(0, 0.07, 0), 0x6a5e72), P(cyl(0.22, 0.3, 0.42, 10), M(0, 0.35, 0), 0x524860), P(cyl(0.34, 0.28, 0.1, 12), M(0, 0.61, 0), 0x6a5e72),
    P(new THREE.TorusGeometry(0.31, 0.03, 4, 24).rotateX(Math.PI / 2), M(0, 0.67, 0), 0xffc040, 0xffa030, 2.4)],
  // Foliage for the big trees (worldview.js and coreview.js): crowns and branch tips, ivy and shelf fungi on bark,
  // and the mossy ferny clumps on the waterfall's rock stacks.
  canopy: () => clump(11, 84, [0x2f6a2a, 0x3c8030, 0x58993c], 0x22501f),
  canopy2: () => clump(12, 84, [0x3a7428, 0x4f8c2e, 0x7aa83a], 0x2a5a20),
  mossclump: () => clump(13, 70, [0x4a8a3a, 0x63a446, 0x8cc05a], 0x3a6e2e, 0.5),
  ivy: () => ivy(5, [0x2c5a24, 0x3b6e2c, 0x548a38], 0x4a3a26),
  bracket: () => bracket([0xc89a5a, 0xa8743e, 0xeee0c0]),
};

// ---------------------------------------------------------------- platform shapes
// Unit shapes: x and z from -0.5 to 0.5 (scaled to the collider), the walkable top at y = 0.5, the collider
// body down to -0.5; some hang lower below it.
function squircle(n, k = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a), r = 0.5 / Math.pow(Math.pow(Math.abs(c), k) + Math.pow(Math.abs(s), k), 1 / k);
    pts.push([c * r, s * r]);
  }
  return pts;
}
function ringsGeo(rings, n, seed) {
  // rings: [y, scale, jitter]; a flat top cap and a point at the bottom.
  const R = rng(seed), base = squircle(n), pos = [];
  const ring = rings.map(([y, k, j]) => base.map(([x, z]) => { const q = 1 + (R() - 0.5) * j; return [x * k * q, y + (R() - 0.5) * j * 0.4 * (y < 0.4), z * k * q]; }));
  const tip = [(R() - 0.5) * 0.15, rings[rings.length - 1][0] - 0.6, (R() - 0.5) * 0.15];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) tri([0, 0.5, 0], ring[0][(i + 1) % n], ring[0][i]);
  for (let r = 0; r < ring.length - 1; r++) for (let i = 0; i < n; i++) {
    const a = ring[r][i], b = ring[r][(i + 1) % n], c = ring[r + 1][i], d = ring[r + 1][(i + 1) % n];
    tri(a, b, c); tri(b, d, c);
  }
  const last = ring[ring.length - 1];
  for (let i = 0; i < n; i++) tri(last[i], last[(i + 1) % n], tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
export function mergeGeos(list) {
  const pos = [], nor = [];
  for (const [geo, m] of list) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
const SHAPES = new Map();
export function shapeGeo(name) {
  if (SHAPES.has(name)) return SHAPES.get(name);
  let g;
  const v = +(name.match(/\d+$/) || [0])[0];
  if (name.startsWith('rock')) g = ringsGeo([[0.5, 1, 0], [0.15, 1.03, 0.12], [-0.5, 0.97, 0.18], [-1.3, 0.72, 0.3], [-2.1, 0.42, 0.35]], 16, 11 + v * 7);
  else if (name.startsWith('isle')) g = ringsGeo([[0.5, 1, 0], [0.2, 1.04, 0.1], [-0.4, 0.9, 0.22], [-1.0, 0.66, 0.3], [-1.7, 0.4, 0.35], [-2.3, 0.2, 0.3]], 18, 101 + v * 13);
  else if (name === 'chamfer') {
    const s = new THREE.Shape(), k = 0.38;
    s.moveTo(-0.5, -k); s.lineTo(-k, -0.5); s.lineTo(k, -0.5); s.lineTo(0.5, -k); s.lineTo(0.5, k); s.lineTo(k, 0.5); s.lineTo(-k, 0.5); s.lineTo(-0.5, k);
    g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.5, 0);
    g = mergeGeos([[g, new THREE.Matrix4()]]);
  } else if (name.startsWith('basalt')) {
    const R = rng(31 + v * 5), list = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const x = i * 0.21 + (j % 2 ? 0.105 : 0), z = j * 0.19;
      if (Math.abs(x) > 0.5 || Math.abs(z) > 0.5) continue;
      const bot = -0.5 - R() * 1.6, h = 0.5 - bot;
      list.push([new THREE.CylinderGeometry(0.122, 0.122, h, 6), new THREE.Matrix4().makeTranslation(x, 0.5 - h / 2, z)]);
    }
    g = mergeGeos(list);
  } else if (name === 'disc') g = mergeGeos([[new THREE.CylinderGeometry(0.6, 0.58, 1, 28), new THREE.Matrix4()]]);
  else if (name === 'lily') g = mergeGeos([[new THREE.CylinderGeometry(0.64, 0.62, 1, 26, 1, false, 0.17, TAU - 0.34), new THREE.Matrix4()]]);
  else if (name === 'cloud') {
    const list = [[new THREE.CylinderGeometry(0.58, 0.5, 0.4, 20), new THREE.Matrix4().makeTranslation(0, 0.3, 0)]];
    for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, r = 0.42; list.push([new THREE.SphereGeometry(0.22 + (k % 3) * 0.05, 7, 5), new THREE.Matrix4().makeTranslation(Math.cos(a) * r, 0.08 - (k % 2) * 0.15, Math.sin(a) * r)]); }
    list.push([new THREE.SphereGeometry(0.4, 8, 6), new THREE.Matrix4().makeTranslation(0, -0.35, 0)]);
    g = mergeGeos(list);
  } else if (name === 'planks') {
    const list = [];
    for (let k = 0; k < 5; k++) list.push([new THREE.BoxGeometry(0.188, 0.45, 1), new THREE.Matrix4().makeTranslation(-0.4 + k * 0.2, 0.275, 0)]);
    for (const x of [-0.32, 0.32]) list.push([new THREE.BoxGeometry(0.1, 1.2, 0.9), new THREE.Matrix4().makeTranslation(x, -0.55, 0)]);
    g = mergeGeos(list);
  } else if (name === 'raft') {
    const list = [];
    for (let k = 0; k < 7; k++) list.push([new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateZ(Math.PI / 2).scale(1, 0.9, 1 / 7), new THREE.Matrix4().makeTranslation(0, 0.05, -0.43 + k * (0.86 / 6))]);
    for (const x of [-0.35, 0.35]) list.push([new THREE.BoxGeometry(0.06, 0.3, 1.04), new THREE.Matrix4().makeTranslation(x, -0.45, 0)]);
    g = mergeGeos(list);
  } else if (name === 'mushcap') g = mergeGeos([[new THREE.CylinderGeometry(0.62, 0.66, 0.7, 22), new THREE.Matrix4().makeTranslation(0, 0.15, 0)],
    [new THREE.SphereGeometry(0.66, 22, 6, 0, TAU, Math.PI / 2, Math.PI / 2).scale(1, 0.55, 1), new THREE.Matrix4().makeTranslation(0, -0.2, 0)]]);
  else if (name === 'stem') g = mergeGeos([[new THREE.CylinderGeometry(0.14, 0.2, 3.4, 12), new THREE.Matrix4().makeTranslation(0, -1.9, 0)]]);
  else if (name === 'vine') g = mergeGeos([[new THREE.CylinderGeometry(0.04, 0.03, 3.2, 6), new THREE.Matrix4().makeTranslation(0.1, -1.9, 0.05)], [new THREE.CylinderGeometry(0.03, 0.02, 2.4, 6), new THREE.Matrix4().makeTranslation(-0.25, -1.5, -0.1)]]);
  else if (name === 'log') g = mergeGeos([[new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2), new THREE.Matrix4()]]);
  else if (name === 'girder') g = mergeGeos([[new THREE.BoxGeometry(1, 0.22, 1), new THREE.Matrix4().makeTranslation(0, 0.39, 0)], [new THREE.BoxGeometry(1, 0.6, 0.28), new THREE.Matrix4()], [new THREE.BoxGeometry(1, 0.22, 0.8), new THREE.Matrix4().makeTranslation(0, -0.39, 0)]]);
  else g = mergeGeos([[new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4()]]);
  SHAPES.set(name, g);
  return g;
}

// Surface pattern ids (pattern.js): 1 metal, 2 stone, 3 wood, 4 hex tiles, 5 grass on rock, 6 sand on rock,
// 7 basalt, 8 tread plate, 9 bamboo, 10 marble, 11 coral, 12 concrete, 13 moss on wet stone, 14 snow on rock,
// 15 cloud, 16 bark, 17 hedge, 18 upright logs, 19 forest floor.
const PATMATS = new Map();
export function patMat(pat, color = 0xffffff, o = {}) {
  const key = pat + ':' + color + ':' + (o.rough ?? '');
  if (!PATMATS.has(key)) PATMATS.set(key, panelMat(color, { pattern: pat, roughness: o.rough ?? ({ 10: 0.3, 14: 0.4, 8: 0.45, 1: 0.45 }[pat] ?? 0.85), metalness: pat === 1 || pat === 8 ? 0.55 : 0.02 }));
  return PATMATS.get(key);
}

// Natural shapes on the daytime maps go without the glowing edge trim (it outlines the box, not the rock).
const NATURAL = /^(rock|isle|disc|lily|cloud|mushcap|basalt|planks|raft|log)/;
export const noTrim = (key, shape) => (key === 'sunny' || key === 'forest' || key === 'waterfall' || key === 'storm') && NATURAL.test(shape);

const KICKWALL = {
  storm: { shape: 'box', pat: 8, col: 0x8a94a4 }, sunny: { shape: 'box', pat: 2, col: 0xf2e8d4 }, forest: { shape: 'box', pat: 18, col: 0xffffff },
  volcano: { shape: 'box', pat: 7, col: 0xb09a92 }, city: { shape: 'box', pat: 12, col: 0xb4b8c4 }, waterfall: { shape: 'box', pat: 13, col: 0xffffff },
};
// How each map dresses its platforms: { shape, pat, col (hex or null for the zone tint), under (hanging part) }.
export function styleFor(key, c, zi, R) {
  if (c.kind === 'pier') {
    switch (key) {
      case 'sunny': return { shape: 'planks', pat: 3, col: 0xc9a06a };
      case 'waterfall': return { shape: 'planks', pat: 3, col: 0xb89464 };
      case 'forest': return { shape: 'planks', pat: 3, col: 0x8a6a46 };
      case 'volcano': return { shape: 'basalt0', pat: 7, col: 0xa08a82 };
      case 'city': return { shape: 'chamfer', pat: 12, col: 0xa8acb8 };
      default: return { shape: 'chamfer', pat: 4, col: 0x8e98a8 };
    }
  }
  // The walls of a wall jump shaft: a real surface for each map, not a plain panel.
  if (c.kind === 'wall' && c.kick && !c.look) return KICKWALL[key] || null;
  const beam = c.kind === 'beam' || c.kind === 'branch';
  if (c.kind !== 'plat' && !beam) return null;
  if (c.look || c.surf === 'ice' || c.surf === 'mud') return null;
  const rock = 'rock' + ((R() * 3) | 0);
  switch (key) {
    case 'storm': {
      // Riveted steel decks and wet concrete slabs, weathered, on sea stacks higher up.
      if (beam) return { shape: 'girder', pat: 1, col: 0x5a6068 };
      if (zi === 4) return { shape: rock, pat: 2, col: 0x6a6e74 };
      if (zi === 5 || zi === 8) return { shape: rock, pat: 14, col: 0xffffff };
      const r = R();
      return r < 0.45 ? { shape: 'chamfer', pat: 8, col: [0x7a8088, 0x8a8478, 0x6e7680][(R() * 3) | 0] } : r < 0.8 ? { shape: 'chamfer', pat: 12, col: [0x9a9c9e, 0x8c9094][(R() * 2) | 0] } : { shape: rock, pat: 2, col: 0x7a7e84 };
    }
    case 'sunny':
      if (beam) return { shape: 'box', pat: 3, col: 0xc9a36b };
      if (zi <= 1) return { shape: 'planks', pat: 3, col: 0xd0aa70 };
      if (zi === 3) return { shape: 'cloud', pat: 15, col: 0xffffff };
      return R() < 0.6 ? { shape: rock, pat: 6, col: 0xffffff } : { shape: 'chamfer', pat: 2, col: null };
    case 'forest':
      if (beam) return { shape: 'log', pat: 16, col: 0x8a6a4a };
      if (zi === 1 && R() < 0.75) return { shape: 'mushcap', pat: 0, col: [0xd8302a, 0xe8702a, 0xa84ad8, 0xe8c040][(R() * 4) | 0], under: { shape: 'stem', pat: 0, col: 0xf0e6d0 } };
      if (zi === 2) return { shape: 'planks', pat: 3, col: 0xb08458 };
      return { shape: rock, pat: zi === 3 || zi === 4 ? 13 : 5, col: 0xffffff, under: zi === 3 && R() < 0.5 ? { shape: 'vine', pat: 0, col: 0x3a7a32 } : null };
    case 'volcano':
      if (beam) return { shape: 'box', pat: 7, col: 0x9a827a };
      if (zi === 2) return { shape: rock, pat: 7, col: 0x7a6a8e };
      return { shape: 'basalt' + ((R() * 2) | 0), pat: 7, col: 0xb09a92 };
    case 'city':
      if (beam) return { shape: 'girder', pat: 1, col: 0x5a5e6e };
      return { shape: 'chamfer', pat: 12, col: null };
    case 'waterfall':
      if (beam) return { shape: 'box', pat: 9, col: 0xd8c890 };
      if (zi === 1) return { shape: 'lily', pat: 0, col: [0x4ab84a, 0x3aa840, 0x5ac85a][(R() * 3) | 0], under: { shape: 'vine', pat: 0, col: 0x3a8a3a } };
      if (zi === 2) return { shape: 'raft', pat: 9, col: 0xd8c890 };
      if (zi === 5) return { shape: rock, pat: 11, col: 0xffffff };
      if (zi === 6 || zi === 8) return { shape: 'disc', pat: 10, col: 0xffffff };
      return { shape: rock, pat: 13, col: 0xffffff };
  }
  return null;
}

// ---------------------------------------------------------------- zone flora (islands and ledges)
// Per map, per zone: island top (pattern), trees, small things. [model, weight].
const T = (isle, trees, small) => ({ isle, trees, small });
const FLORA = {
  storm: [T(2, [['turbine', 3], ['lamp', 1], ['tank', 1], ['acunit', 1]], [['debris', 1]]), T(2, [['dish', 2], ['coil', 1], ['acunit', 1], ['antenna', 1]], [['debris', 1]]),
    T(2, [['coil', 3], ['vane', 1], ['antenna', 1]], [['debris', 1]]), T(2, [['turbine', 2], ['vane', 2], ['lamp', 1]], [['debris', 1]]), T(2, [['dish', 2], ['coil', 2], ['debris', 1]], [['debris', 1]]),
    T(14, [['frostpine', 3], ['crystal', 2], ['vane', 1]], [['crystal', 1]]), T(2, [['coil', 2], ['turbine', 1], ['crystal', 1]], [['crystal', 1]]), T(2, [['dish', 1], ['coil', 2], ['crystal', 1]], [['crystal', 1]]), T(14, [['crystal', 3], ['vane', 1]], [['crystal', 1]])],
  sunny: [T(6, [['palm', 3], ['hut', 1], ['umbrella', 1]], [['rocks', 1], ['grass', 1]]), T(6, [['palm', 2], ['coral', 2], ['bush', 1]], [['coral', 1], ['flowers', 1]]),
    T(5, [['palm', 2], ['bush', 2], ['flowers', 1]], [['flowers', 2], ['grass', 1]]), T(5, [['blossom', 2], ['flowers', 3], ['bush', 1]], [['flowers', 2]]),
    T(6, [['palm', 3], ['umbrella', 1]], [['grass', 1], ['rocks', 1]]), T(6, [['cactus', 3], ['palm', 1]], [['rocks', 1]]), T(5, [['palm', 2], ['flowers', 2]], [['flowers', 1]]),
    T(5, [['blossom', 2], ['flowers', 3]], [['flowers', 2]]), T(6, [['palm', 2], ['blossom', 1]], [['flowers', 1]])],
  forest: [T(5, [['oakS', 3], ['shrubT', 2], ['fernT', 2]], [['fernT', 2], ['tuftT', 1], ['shrubT', 1]]), T(13, [['shroom', 4], ['fernT', 1]], [['glowshroom', 1], ['fernT', 1]]),
    T(5, [['oakS', 2], ['spruceS', 2], ['shrubT', 1]], [['fernT', 1], ['tuftT', 1]]), T(13, [['oakS', 2], ['fernT', 2], ['shrubT', 2]], [['fernT', 2]]),
    T(13, [['glowtree', 3], ['glowshroom', 2]], [['glowshroom', 2]]), T(5, [['snagS', 3], ['shrubT', 1]], [['mossrock', 1], ['tuftT', 1]]), T(5, [['spruceS', 4]], [['fernT', 1], ['mossrock', 1]]),
    T(5, [['oakS', 3], ['shrubT', 1]], [['shrubT', 1], ['flowers', 1]]), T(5, [['birchS', 3], ['blossom', 1], ['flowers', 1]], [['flowers', 2]])],
  volcano: [T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['obsidian', 3], ['ember', 1]], [['obsidian', 1]]),
    T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['ember', 2], ['dead', 1]], [['ember', 1]]), T(7, [['obsidian', 2], ['ember', 2]], [['ember', 1]]),
    T(7, [['obsidian', 3], ['ember', 1]], [['obsidian', 1]]), T(7, [['dead', 3]], [['ember', 1]]), T(5, [['pine', 3], ['bush', 1]], [['grass', 1]])],
  city: [T(12, [['acunit', 3], ['tank', 1], ['antenna', 1]], [['acunit', 1]]), T(12, [['acunit', 2], ['lamp', 2]], [['planter', 1]]), T(12, [['antenna', 2], ['acunit', 2]], [['acunit', 1]]),
    T(12, [['tank', 2], ['acunit', 2]], [['planter', 1]]), T(5, [['oak', 2], ['bush', 2], ['flowers', 1]], [['planter', 2]]), T(12, [['antenna', 4]], [['acunit', 1]]),
    T(12, [['acunit', 2], ['lamp', 1]], [['planter', 1]]), T(5, [['bush', 2], ['oak', 1], ['flowers', 1]], [['planter', 1]]), T(12, [['antenna', 2], ['lamp', 1]], [['planter', 1]])],
  waterfall: [T(5, [['palm', 3], ['bush', 1], ['blossom', 1]], [['flowers', 1], ['tuftT', 3], ['grass', 1]]), T(5, [['reeds', 2], ['fern', 2], ['bush', 1], ['flowers', 1]], [['reeds', 1], ['flowers', 1], ['tuftT', 2]]),
    T(13, [['bamboo', 4], ['fern', 1]], [['fern', 2], ['tuftT', 2]]), T(5, [['blossom', 2], ['palm', 1], ['flowers', 2]], [['flowers', 2], ['tuftT', 2]]), T(5, [['palm', 3], ['fern', 1]], [['flowers', 1], ['tuftT', 3]]),
    T(13, [['fern', 2], ['bamboo', 2], ['bush', 1]], [['fernT', 2], ['tuftT', 1]]), T(5, [['palm', 2], ['bush', 2], ['flowers', 1]], [['flowers', 1], ['tuftT', 2]]), T(13, [['birch', 2], ['fern', 2]], [['fern', 1], ['tuftT', 2]]),
    T(5, [['blossom', 3], ['flowers', 2]], [['flowers', 2], ['tuftT', 2]])],
};
const pick = (list, R) => { let s = 0; for (const [, w] of list) s += w; let x = R() * s; for (const [k, w] of list) if ((x -= w) <= 0) return k; return list[0][0]; };

// Floating islands round the climb (ledges on the crater wall; none in the city), trees and
// plants by zone, and small plants on the bigger ledges of the route.
export function buildScenery(view) {
  const L = view.level, key = view.key, F = FLORA[key];
  if (!F) return;
  const R = rng(4242), inst = new Map(), isles = new Map();
  // Plants are kept per height band (view.band) so only those near the camera are drawn.
  const put = (model, m, tint) => { const y = m.elements[13], k = model + '|' + Math.floor(y / 50); if (!inst.has(k)) inst.set(k, { model, y, list: [] }); inst.get(k).list.push([m, tint]); };
  const putIsle = (shape, pat, m) => { const k = shape + ':' + pat; if (!isles.has(k)) isles.set(k, { shape, pat, list: [] }); isles.get(k).list.push(m); };
  const trees = L.trees || [];
  const tint = new THREE.Color();
  L.zones.forEach((z, zi) => {
    // The city has no islands round the Nexus: its holograms and screens are there (cityview.js).
    const f = F[Math.min(zi, F.length - 1)], n = key === 'city' ? 0 : (key === 'waterfall' ? 13 : 9) - (DETAIL === 0 ? 4 : 0);
    // The lowest islands float well clear of the ground: low down they sank into the beach, a palm or a pier.
    const y0 = zi === 0 && key !== 'volcano' && key !== 'city' ? z.y0 + 12 : z.y0;
    for (let k = 0; k < n; k++) {
      const y = y0 + R() * (z.y1 - y0);
      let x, zz, s, top, ry = R() * TAU;
      if (key === 'volcano') {
        // A ledge sticking out of the crater wall.
        const a = R() * TAU; x = Math.cos(a) * 21.8; zz = Math.sin(a) * 21.8; s = 2.5 + R() * 2.5; ry = -a;
      } else {
        const a = R() * TAU, r = key === 'forest' ? 38 + R() * 10 : 26 + R() * 13;
        x = Math.cos(a) * r; zz = Math.sin(a) * r; s = 3 + R() * 4.5;
        if (trees.some((t) => Math.hypot(t.x - x, t.z - zz) < 10)) continue;
      }
      top = y;
      putIsle(key === 'city' ? 'chamfer' : 'isle' + ((R() * 3) | 0), f.isle, M(x, top - 0.5 * (key === 'city' ? 0.5 : 1.2), zz, s, key === 'city' ? 0.5 : 1.2, key === 'city' ? 2.6 : s * (0.75 + R() * 0.25), 0, ry));
      const nt = key === 'city' ? 1 : 1 + ((R() * 2.6) | 0);
      for (let j = 0; j < nt; j++) {
        const a = R() * TAU, d = R() * s * 0.28, sc = 0.8 + R() * 0.7;
        tint.setHSL(0, 0, 0.85 + R() * 0.3);
        const model = pick(f.trees, R), tx = x + Math.cos(a) * d, tz = zz + Math.sin(a) * d, try_ = R() * TAU;
        put(model, M(tx, top, tz, sc, sc, sc, 0, try_), tint.getHex());
        if (model === 'turbine') (view.rotors || (view.rotors = [])).push({ x: tx, y: top, z: tz, ry: try_, s: sc });
        if (model === 'coil') (view.coils || (view.coils = [])).push({ x: tx, y: top, z: tz, s: sc });
      }
      for (let j = 0, ns = (key === 'waterfall' ? 6 : 2) + ((R() * 3) | 0); j < ns; j++) {
        const a = R() * TAU, d = s * (0.12 + R() * 0.3), sc = 0.7 + R() * 0.6;
        put(pick(f.small, R), M(x + Math.cos(a) * d, top, zz + Math.sin(a) * d, sc, sc, sc, 0, R() * TAU), null);
      }
      // Waterfall: some islands spill a little waterfall off one edge.
      if (key === 'waterfall' && R() < 0.45) view.islandFalls.push({ x: x + Math.cos(ry) * s * 0.42, y: top, z: zz - Math.sin(ry) * s * 0.42, w: s * 0.35, h: 6 + R() * 10, ry });
    }
  });
  // Waterfall: small green islets out in the lagoon, palms and bushes on them, a fall off some into the sea.
  if (key === 'waterfall') {
    const f = F[0], nI = [6, 12, 16][DETAIL];
    for (let k = 0, tries = 0; k < nI && tries < 200; tries++) {
      const a = R() * TAU, r = 52 + R() * 70, x = Math.cos(a) * r, zz = Math.sin(a) * r, s = 4 + R() * 5;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - zz) < 12) || L.decor.some((d) => d.k === 'boat' && Math.hypot(d.x - x, d.z - zz) < 10)) continue;
      const top = 0.5 + R() * 0.7, ry = R() * TAU;
      putIsle('isle' + ((R() * 3) | 0), k % 3 ? 5 : 6, M(x, top - 0.3, zz, s, 0.6, s * (0.75 + R() * 0.25), 0, ry));
      for (let j = 0, nt = 1 + ((R() * 3) | 0); j < nt; j++) {
        const b = R() * TAU, d = R() * s * 0.3, sc = 0.9 + R() * 0.7;
        put(R() < 0.65 ? 'palm' : pick(f.trees, R), M(x + Math.cos(b) * d, top, zz + Math.sin(b) * d, sc, sc, sc, 0, R() * TAU), null);
      }
      for (let j = 0; j < 6; j++) {
        const b = R() * TAU, d = s * (0.1 + R() * 0.32), sc = 0.7 + R() * 0.6;
        put(pick(f.small, R), M(x + Math.cos(b) * d, top, zz + Math.sin(b) * d, sc, sc, sc, 0, R() * TAU), null);
      }
      k++;
    }
  }
  // Small plants near the edges of the bigger route ledges (they don't get in the way: no collision).
  for (const c of DETAIL ? L.cols : []) {
    // Waterfall: grass on every mossy rock of the route (not on the lily pads, rafts and marble).
    const wf = key === 'waterfall' && ![1, 2, 6, 8].includes(c.zone);
    if (c.kind !== 'plat' || c.dyn || c.look || Math.min(c.hx, c.hz) < (wf ? 0.9 : 1.3) || R() > (wf ? 0.85 : 0.4)) continue;
    const f = F[Math.min(c.zone, F.length - 1)], ax = Math.cos(c.ry), az = -Math.sin(c.ry), bx = Math.sin(c.ry), bz = Math.cos(c.ry);
    for (let j = 0; j < (wf ? 2 : 1) + ((R() * (wf ? 3 : 2)) | 0); j++) {
      const u = (R() < 0.5 ? -1 : 1) * (c.hx - 0.25), v = (R() * 2 - 1) * (c.hz - 0.3), sw = R() < 0.5, sc = 0.45 + R() * 0.35;
      const px = sw ? u : (R() * 2 - 1) * (c.hx - 0.3), pz = sw ? v : (R() < 0.5 ? -1 : 1) * (c.hz - 0.25);
      put(pick(f.small, R), M(c.x + ax * px + bx * pz, c.y + c.hy, c.z + az * px + bz * pz, sc, sc, sc, 0, R() * TAU), null);
    }
  }
  // Draw: one instanced mesh per island shape and per model.
  const col = new THREE.Color();
  for (const { shape, pat, list } of isles.values()) {
    const im = new THREE.InstancedMesh(shapeGeo(shape), patMat(pat), list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHSL(0, 0, 0.88 + ((i * 37) % 23) / 100)); });
    view.add(im);
  }
  const mat = vegMat();
  for (const { model, y, list } of inst.values()) {
    const geo = modelGeo(model), im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, t], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(t ?? 0xffffff)); });
    view.add(im, model !== 'grass' && model !== 'flowers' && model !== 'fern' && model !== 'fernT' && model !== 'tuftT');
    view.band(y).near.push(im);
  }
  paletteTex();
}
const GEOS = new Map();
// Many models as one mesh for vegMat(): [[name, Matrix4], ...]. All drawn together, so this is for things that stay put.
export function mergedModels(list) {
  const pos = [], nor = [], uvs = [], glo = [], v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [name, m] of list) {
    const g = modelGeo(name), a = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array, l = g.attributes.aGlow.array;
    nm.getNormalMatrix(m);
    for (let i = 0; i < a.length; i += 3) {
      v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      glo.push(l[i], l[i + 1], l[i + 2]);
    }
    for (let i = 0; i < u.length; i++) uvs.push(u[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  g.computeBoundingSphere();
  return g;
}
export function modelGeo(name) {
  if (!GEOS.has(name)) GEOS.set(name, build(MODELS[name]()));
  return GEOS.get(name);
}
let VEG = null;
export function vegMat() {
  // The phone gets the palette once, so every model's colours must be in it before the first map is drawn.
  // Otherwise trees that first appear on a later map come out black there.
  if (!VEG) {
    for (const k of Object.keys(MODELS)) modelGeo(k);
    for (const k of BEAST_KINDS) beastRig(k);
    VEG = panelMat(0xffffff, { map: paletteTex(), roughness: 0.82, metalness: 0, pattern: 0 });
  }
  return VEG;
}

// ---------------------------------------------------------------- animals (whole flocks animated in the shader)
// Model parts with a wing flag: w 0 body, -1/+1 wing (flaps round the body's long axis), 2 leg (swings).
const A = (geo, m, c, w = 0) => ({ geo, m, c, w });
const lo = (r) => new THREE.OctahedronGeometry(r, 0), quad = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
const ANIMALS = {
  gull: (c = [0xf4f4f0, 0xb8bcc4, 0x2a2a2a, 0xffa030]) => [A(lo(0.12), M(0, 0, 0, 1, 0.9, 2.6), c[0]), A(lo(0.085), M(0, 0.06, 0.3), c[0]),
    A(cone(0.025, 0.11, 5), M(0, 0.05, 0.42, 1, 1, 1, Math.PI / 2), c[3]), A(quad(0.16, 0.14), M(0, 0.02, -0.33), c[1]),
    A(quad(0.44, 0.2), M(0.27, 0.03, 0, 1, 1, 1, 0, 0.08), c[1], 1), A(quad(0.24, 0.14), M(0.6, 0.03, -0.04, 1, 1, 1, 0, 0.25), c[2], 1),
    A(quad(0.44, 0.2), M(-0.27, 0.03, 0, 1, 1, 1, 0, -0.08), c[1], -1), A(quad(0.24, 0.14), M(-0.6, 0.03, -0.04, 1, 1, 1, 0, -0.25), c[2], -1)],
  parrot: () => [A(lo(0.12), M(0, 0, 0, 1, 1, 2.3), 0xe8302a), A(lo(0.09), M(0, 0.07, 0.27), 0xe8302a), A(cone(0.035, 0.1, 5), M(0, 0.05, 0.38, 1, 1, 1, 1.9), 0xf0e0c0),
    A(quad(0.06, 0.5), M(0, -0.02, -0.5), 0x2a6ae8), A(quad(0.4, 0.2), M(0.24, 0.03, 0), 0xffd23d, 1), A(quad(0.24, 0.15), M(0.54, 0.03, -0.03, 1, 1, 1, 0, 0.25), 0x2a6ae8, 1),
    A(quad(0.4, 0.2), M(-0.24, 0.03, 0), 0xffd23d, -1), A(quad(0.24, 0.15), M(-0.54, 0.03, -0.03, 1, 1, 1, 0, -0.25), 0x2a6ae8, -1)],
  eagle: () => ANIMALS.gull([0x6a4a2e, 0x5a3e26, 0x3a2a1a, 0xffc030]).concat([A(lo(0.09), M(0, 0.07, 0.31), 0xf4f4f0)]),
  butterfly: () => [A(box(0.03, 0.03, 0.2), M(0, 0, 0), 0x2a2a2a), A(quad(0.2, 0.16), M(0.11, 0, 0.04, 1, 1, 1, 0, 0.3), 0xffffff, 1), A(quad(0.15, 0.12), M(0.09, 0, -0.08, 1, 1, 1, 0, -0.3), 0xe8e8e8, 1),
    A(quad(0.2, 0.16), M(-0.11, 0, 0.04, 1, 1, 1, 0, -0.3), 0xffffff, -1), A(quad(0.15, 0.12), M(-0.09, 0, -0.08, 1, 1, 1, 0, 0.3), 0xe8e8e8, -1)],
  crab: () => [A(lo(0.16), M(0, 0.1, 0, 1.3, 0.55, 1), 0xd84a2a), A(ico(0.03, 0), M(0.06, 0.2, 0.12), 0x111111), A(ico(0.03, 0), M(-0.06, 0.2, 0.12), 0x111111),
    A(lo(0.07), M(0.2, 0.12, 0.16, 1.2, 0.7, 1), 0xe85a3a), A(lo(0.07), M(-0.2, 0.12, 0.16, 1.2, 0.7, 1), 0xe85a3a),
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((k) => A(box(0.18, 0.025, 0.025), M(s * 0.2, 0.05, -0.06 + k * 0.07, 1, 1, 1, 0, 0, s * 0.5), 0xc83a22, 2)))],
  frog: () => [A(lo(0.15), M(0, 0.12, 0, 1, 0.75, 1.2), 0x4ab84a), A(lo(0.05), M(0.07, 0.22, 0.09), 0xf0f0e0), A(lo(0.05), M(-0.07, 0.22, 0.09), 0xf0f0e0),
    A(ico(0.025, 0), M(0.07, 0.23, 0.13), 0x111111), A(ico(0.025, 0), M(-0.07, 0.23, 0.13), 0x111111), A(box(0.07, 0.05, 0.2), M(0.13, 0.05, -0.08), 0x3aa83a, 2), A(box(0.07, 0.05, 0.2), M(-0.13, 0.05, -0.08), 0x3aa83a, 2)],
  turtle: () => [A(new THREE.SphereGeometry(0.4, 6, 3, 0, TAU, 0, Math.PI / 2), M(0, 0, 0, 1, 0.6, 1.2), 0x4a6a3a), A(lo(0.12), M(0, 0.02, 0.55), 0x8aa86a),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => A(box(0.22, 0.04, 0.1), M(s * 0.4, 0, f * 0.3, 1, 1, 1, 0, s * f * 0.4), 0x8aa86a, 2))],
  // City robots: a helper on one wheel with arms and a visor, and a little delivery box on four wheels. Their lights
  // are a second flock drawn glowing in the same place (…L).
  robot: () => [A(cyl(0.16, 0.16, 0.08, 12).rotateZ(Math.PI / 2), M(0, 0.16, 0), 0x2a2a2a), A(box(0.12, 0.3, 0.2), M(0, 0.38, 0), 0x6a6e76),
    A(lo(0.3), M(0, 0.8, 0, 0.85, 1, 0.65), 0xeeeae2), A(box(0.44, 0.08, 0.3), M(0, 0.58, 0), 0x8a8e96), A(box(0.3, 0.24, 0.26), M(0, 1.22, 0), 0xeeeae2),
    A(box(0.07, 0.42, 0.09), M(0.3, 0.82, 0.02, 1, 1, 1, 0.25, 0, 0.12), 0x8a8e96), A(box(0.07, 0.42, 0.09), M(-0.3, 0.82, 0.02, 1, 1, 1, -0.2, 0, -0.12), 0x8a8e96),
    A(box(0.02, 0.16, 0.02), M(0.08, 1.42, 0), 0x6a6e76)],
  robotL: () => [A(box(0.24, 0.06, 0.02), M(0, 1.24, 0.135), 0x7fd8ff), A(box(0.14, 0.06, 0.02), M(0, 0.86, 0.2), 0x7fd8ff), A(ico(0.03, 0), M(0.08, 1.51, 0), 0xff3050)],
  deliv: () => [A(box(0.6, 0.42, 0.8), M(0, 0.36, 0), 0xeeeae2), A(box(0.62, 0.04, 0.82), M(0, 0.58, 0), 0x3a3e46),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => A(cyl(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2), M(x * 0.31, 0.1, z * 0.28), 0x2a2a2a)),
    A(box(0.02, 0.4, 0.02), M(0.22, 0.78, -0.3), 0x6a6e76)],
  delivL: () => [A(box(0.4, 0.05, 0.02), M(0, 0.48, 0.41), 0x7fd8ff), A(ico(0.035, 0), M(0.22, 0.99, -0.3), 0xd8b020)],
  // A flying car out in the city's traffic, about 4.4 m long. Lights in hovercarL.
  hovercar: () => [A(box(1.9, 0.5, 4.2), M(0, 0, 0), 0xffffff), A(box(1.7, 0.3, 0.9), M(0, -0.06, 2.4, 1, 1, 1, 0.25), 0xffffff),
    A(box(1.62, 0.44, 2.1), M(0, 0.46, -0.25), 0x1a2433), A(box(1.66, 0.06, 2.0), M(0, 0.7, -0.3), 0xffffff), A(box(1.8, 0.28, 0.5), M(0, 0.3, -2.0), 0xffffff),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => A(cyl(0.3, 0.34, 0.24, 10), M(x * 0.95, -0.32, z * 1.45), 0x3a3e46))],
  hovercarL: () => [A(box(0.5, 0.12, 0.04), M(0.55, 0.0, 2.11), 0xffffff), A(box(0.5, 0.12, 0.04), M(-0.55, 0.0, 2.11), 0xffffff),
    A(box(1.6, 0.08, 0.04), M(0, 0.12, -2.11), 0xff2030), A(box(1.7, 0.02, 3.8), M(0, -0.26, 0), 0x3fd0ff),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => A(cyl(0.24, 0.24, 0.02, 10), M(x * 0.95, -0.45, z * 1.45), 0x9ae8ff))],
  // A grey heron wading in the shallows, about 1.4 m tall.
  heron: () => [A(lo(0.16), M(0, 0.86, 0, 0.9, 0.85, 2.2), 0xa8acb8), A(box(0.05, 0.42, 0.05), M(0, 1.1, 0.33, 1, 1, 1, 0.35), 0xeeeae2),
    A(lo(0.065), M(0, 1.3, 0.42, 0.8, 0.8, 1.4), 0xeeeae2), A(box(0.02, 0.02, 0.16), M(0, 1.35, 0.33), 0x2a2a2a), A(cone(0.024, 0.2, 4), M(0, 1.29, 0.56, 1, 1, 1, Math.PI / 2), 0xd8b020),
    A(box(0.05, 0.07, 0.32), M(0.13, 0.86, -0.1), 0x5a5e6a), A(box(0.05, 0.07, 0.32), M(-0.13, 0.86, -0.1), 0x5a5e6a), A(quad(0.14, 0.2), M(0, 0.8, -0.4), 0x8a8e96),
    A(box(0.025, 0.8, 0.025), M(0.06, 0.4, 0), 0x6a6e76), A(box(0.025, 0.8, 0.025), M(-0.06, 0.4, 0.02), 0x6a6e76)],
  // A fish leaping out of the lagoon.
  fish: () => [A(lo(0.1), M(0, 0, 0, 0.55, 1, 2.6), 0x9ab8cc), A(lo(0.07), M(0, -0.02, 0.06, 0.5, 0.8, 2.4), 0xeeeae2),
    A(new THREE.PlaneGeometry(0.2, 0.18).rotateY(Math.PI / 2), M(0, 0, -0.3), 0x6a8aa0), A(new THREE.PlaneGeometry(0.16, 0.08).rotateY(Math.PI / 2), M(0, 0.1, 0.02), 0x6a8aa0)],
  // Deer (scenery.js mode 5): w 3 neck, 4 head, 5 tail, 6 upper leg, 7 lower leg, moved by the shader as they walk and graze.
  deer: () => deerParts(0),
  stag: () => deerParts(1),
  fawn: () => deerParts(2),
  lizard: () => [A(box(0.16, 0.1, 0.5), M(0, 0.06, 0), 0x3a2a24), A(box(0.12, 0.08, 0.14), M(0, 0.06, 0.3), 0x3a2a24), A(cone(0.06, 0.5, 4), M(0, 0.05, -0.48, 1, 0.6, 1, -Math.PI / 2), 0x3a2a24),
    A(ico(0.03, 0), M(0.04, 0.08, 0.08), 0xff6a1a), A(ico(0.03, 0), M(-0.03, 0.08, -0.08), 0xff6a1a), ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => A(box(0.14, 0.03, 0.04), M(s * 0.12, 0.03, f * 0.15), 0x2a1e1a, 2))],
  rabbit: () => [A(lo(0.13), M(0, 0.14, 0, 1, 0.9, 1.3), 0xb89a7a), A(lo(0.09), M(0, 0.24, 0.15), 0xb89a7a), A(box(0.035, 0.16, 0.06), M(0.03, 0.38, 0.12, 1, 1, 1, -0.2, 0, -0.15), 0xa88a6a),
    A(box(0.035, 0.16, 0.06), M(-0.03, 0.38, 0.12, 1, 1, 1, -0.2, 0, 0.15), 0xa88a6a), A(ico(0.045, 0), M(0, 0.17, -0.18), 0xffffff), A(ico(0.02, 0), M(0.05, 0.27, 0.21), 0x111111), A(ico(0.02, 0), M(-0.05, 0.27, 0.21), 0x111111),
    A(box(0.06, 0.05, 0.18), M(0.08, 0.04, -0.04), 0xa88a6a, 2), A(box(0.06, 0.05, 0.18), M(-0.08, 0.04, -0.04), 0xa88a6a, 2)],
  pigeon: () => [A(lo(0.1), M(0, 0.16, 0, 1, 1, 1.7), 0x8a8e9a), A(lo(0.065), M(0, 0.28, 0.13), 0x6a7a8a), A(cone(0.018, 0.06, 4), M(0, 0.27, 0.21, 1, 1, 1, Math.PI / 2), 0xd8a060),
    A(box(0.1, 0.03, 0.18), M(0.08, 0.17, -0.02, 1, 1, 1, 0, 0, -0.3), 0x7a7e8a), A(box(0.1, 0.03, 0.18), M(-0.08, 0.17, -0.02, 1, 1, 1, 0, 0, 0.3), 0x7a7e8a),
    A(quad(0.1, 0.12), M(0, 0.14, -0.2), 0x5a5e6a), A(box(0.015, 0.1, 0.015), M(0.03, 0.05, 0), 0xd86a5a, 2), A(box(0.015, 0.1, 0.015), M(-0.03, 0.05, 0), 0xd86a5a, 2)],
  dolphin: () => [A(lo(0.4), M(0, 0, 0, 0.8, 0.8, 2.6), 0x7a8a9a), A(cone(0.08, 0.4, 5), M(0, 0.02, 1.1, 1, 1, 1, Math.PI / 2), 0x8a9aaa), A(cone(0.18, 0.4, 4), M(0, 0.38, -0.1, 0.3, 1, 1), 0x6a7a8a),
    A(quad(0.6, 0.2), M(0, 0, -1.05), 0x6a7a8a), A(box(0.3, 0.04, 0.14), M(0.3, -0.12, 0.3, 1, 1, 1, 0, 0, -0.4), 0x6a7a8a), A(box(0.3, 0.04, 0.14), M(-0.3, -0.12, 0.3, 1, 1, 1, 0, 0, 0.4), 0x6a7a8a)],
};
// A deer about 1 m at the shoulder, facing +z: a doe (0), a stag with antlers (1) or a spotted fawn (2).
function deerParts(kind) {
  const coat = kind === 1 ? 0x8e6038 : kind === 2 ? 0xa8703e : 0x9a6a40, back = kind === 1 ? 0x6e4a2c : 0x7d5532, leg = 0x80603e, low = 0x6a4c30;
  const pale = 0xeee6d8, hoof = 0x2a211a, E = (x, y, z, rx, ry, rz, c, w, px = 0, py = 0, pz = 0, d = 10) => A(egg(rx, ry, rz, d, Math.max(5, d - 3)), M(x, y, z, 1, 1, 1, px, py, pz), c, w);
  const parts = [
    // Body: barrel, deeper chest, rump, pale belly and rump patch.
    E(0, 0.86, -0.02, 0.17, 0.2, 0.47, coat, 0), E(0, 0.84, 0.28, 0.16, 0.22, 0.22, coat, 0), E(0, 0.9, -0.34, 0.17, 0.2, 0.22, coat, 0),
    E(0, 0.69, 0.0, 0.1, 0.07, 0.3, 0xd8c6aa, 0), E(0, 0.92, -0.52, 0.085, 0.1, 0.05, pale, 0),
    // A soft shadow on the ground under it.
    A(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), M(0, 0.012, 0, 0.3, 1, 0.62), 0x24361a, 0),
    // Tail.
    E(0, 0.95, -0.57, 0.05, 0.1, 0.035, back, 5, -0.4), E(0, 0.93, -0.59, 0.042, 0.085, 0.025, pale, 5, -0.4),
    // Neck from the chest up and forward, a pale throat.
    A(seg([0, 0.88, 0.4], [0, 1.33, 0.67], 0.11, 0.075, 8), I(), coat, 3), E(0, 1.18, 0.62, 0.05, 0.08, 0.04, pale, 3, -0.6),
    // Head: skull, tapering snout, pale muzzle, black nose, eyes, ears.
    E(0, 1.37, 0.73, 0.075, 0.08, 0.12, coat, 4, 0.5), A(seg([0, 1.35, 0.76], [0, 1.26, 0.92], 0.058, 0.034, 8), I(), coat, 4),
    E(0, 1.255, 0.925, 0.036, 0.03, 0.03, 0xd8c8b4, 4, 0, 0, 0, 6), E(0, 1.262, 0.948, 0.022, 0.018, 0.012, 0x1c1612, 4, 0, 0, 0, 6),
    E(0.058, 1.395, 0.77, 0.018, 0.018, 0.018, 0x0e0c0a, 4, 0, 0, 0, 6), E(-0.058, 1.395, 0.77, 0.018, 0.018, 0.018, 0x0e0c0a, 4, 0, 0, 0, 6),
  ];
  for (const sx of [-1, 1]) {
    parts.push(E(sx * 0.085, 1.47, 0.69, 0.034, 0.085, 0.014, coat, 4, 0.2, sx * 0.4, -sx * 0.7, 8), E(sx * 0.088, 1.47, 0.698, 0.024, 0.066, 0.008, 0xd8b8a0, 4, 0.2, sx * 0.4, -sx * 0.7, 6));
    // Forelegs: from the shoulder to the knee, then the slim cannon to the hoof.
    parts.push(A(seg([sx * 0.09, 0.84, 0.32], [sx * 0.09, 0.47, 0.34], 0.058, 0.036), I(), leg, 6), A(seg([sx * 0.09, 0.47, 0.34], [sx * 0.09, 0.06, 0.34], 0.032, 0.024), I(), low, 7),
      A(seg([sx * 0.09, 0.065, 0.342], [sx * 0.09, 0, 0.36], 0.026, 0.032, 6), I(), hoof, 7));
    // Hind legs: a thick thigh, the gaskin back to the hock, the cannon down to the hoof.
    parts.push(E(sx * 0.1, 0.82, -0.36, 0.075, 0.17, 0.12, coat, 6), A(seg([sx * 0.1, 0.78, -0.36], [sx * 0.1, 0.5, -0.45], 0.06, 0.038), I(), leg, 6),
      A(seg([sx * 0.1, 0.5, -0.45], [sx * 0.1, 0.06, -0.39], 0.032, 0.024), I(), low, 7), A(seg([sx * 0.1, 0.065, -0.388], [sx * 0.1, 0, -0.37], 0.026, 0.032, 6), I(), hoof, 7));
    if (kind === 1) {
      // Antlers: a beam curving up and out, with tines.
      const b = [[sx * 0.05, 1.45, 0.7], [sx * 0.13, 1.6, 0.66], [sx * 0.18, 1.75, 0.6], [sx * 0.15, 1.9, 0.66]];
      for (let k = 0; k < 3; k++) parts.push(A(seg(b[k], b[k + 1], 0.017 - k * 0.003, 0.014 - k * 0.003, 5), I(), 0xc8b49a, 4));
      for (const [a, t] of [[[sx * 0.07, 1.49, 0.7], [sx * 0.08, 1.56, 0.81]], [[sx * 0.13, 1.6, 0.66], [sx * 0.14, 1.73, 0.75]], [[sx * 0.17, 1.73, 0.61], [sx * 0.23, 1.86, 0.68]]]) parts.push(A(seg(a, t, 0.012, 0.007, 4), I(), 0xe0d4c0, 4));
    }
  }
  if (kind === 2) {
    // Fawn spots along the back and flanks.
    const R = rng(31);
    for (let k = 0; k < 22; k++) {
      const z = -0.4 + R() * 0.75, a = (R() < 0.5 ? -1 : 1) * (0.25 + R() * 0.9), r = 1 - (z / 0.5) ** 2 * 0.3;
      parts.push(E(Math.sin(a) * 0.17 * r, 0.86 + Math.cos(a) * 0.2 * r, z, 0.016, 0.016, 0.016, 0xf4ece0, 0, 0, 0, 0, 5));
    }
  }
  return parts;
}
const SWARM_VS = `#include <fog_pars_vertex>
  uniform float uT, uMode, uFlap, uSide, uBank;
  attribute vec3 aCol; attribute float aW; attribute vec4 aP; attribute vec4 aQ;
  varying vec3 vC; varying float vL;
  vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  void main(){
    float ph = aP.w, R = aQ.x, sp = aQ.y, amp = aQ.z, sz = aQ.w, a = uT * sp + ph * 6.2832, bank = 0.0, pitch = 0.0;
    float dv = 0.0, gait = 0.0, graze = 0.0, look = 0.0;
    vec3 c, d;
    if (uMode < 0.5) {
      c = aP.xyz + vec3(cos(a) * R, sin(a * 0.6 + ph * 5.0) * amp, sin(a) * R);
      d = vec3(-sin(a), 0.0, cos(a)) * sign(sp); bank = 0.35 * sign(sp);
    } else if (uMode < 1.5) {
      c = aP.xyz + vec3(sin(a) * R + sin(a * 2.3 + ph) * R * 0.35, sin(a * 1.7 + ph * 3.0) * amp, cos(a * 1.3) * R);
      d = normalize(vec3(cos(a) * R + cos(a * 2.3 + ph) * R * 0.8, 0.001, -sin(a * 1.3) * R * 1.3));
    } else if (uMode < 2.5) {
      float h = ph * 6.2832; vec3 f = vec3(sin(h), 0.0, cos(h));
      c = aP.xyz + f * sin(a) * R; d = f * (cos(a) >= 0.0 ? 1.0 : -1.0);
    } else if (uMode < 3.5) {
      float h = ph * 6.2832; vec3 f = vec3(sin(h), 0.0, cos(h));
      c = aP.xyz + f * sin(a * 0.5) * R; c.y += max(0.0, sin(a * 3.0)) * amp; d = f * (cos(a * 0.5) >= 0.0 ? 1.0 : -1.0);
    } else if (uMode > 4.5) {
      // Deer: walk a figure of eight (two circles of radius R meeting at the spot), slow down, stop to graze for a while,
      // now and then lift the head to look round, then walk on. amp moves one along the same path (a fawn behind its mother).
      float Tw = 6.0 + fract(ph * 7.31) * 7.0, Tg = 4.0 + fract(ph * 3.17) * 7.0, Tc = Tw + Tg, e = 1.3;
      float u = uT / Tc + ph * 5.0, f = fract(u) * Tc;
      float run = f < e ? 0.5 * f * f / e : f < Tw - e ? f - 0.5 * e : f < Tw ? Tw - e - 0.5 * (Tw - f) * (Tw - f) / e : Tw - e;
      dv = f < e ? f / e : f < Tw - e ? 1.0 : f < Tw ? (Tw - f) / e : 0.0;
      float L = (floor(u) * (Tw - e) + run) * sp + amp + ph * 40.0, Lc = 6.2832 * R;
      float th = fract(L / Lc) * 6.2832, sx = mod(floor(L / Lc), 2.0) < 0.5 ? 1.0 : -1.0, h = ph * 6.2832, ch = cos(h), sh = sin(h);
      vec3 q = vec3(sx * R * (1.0 - cos(th)), 0.0, R * sin(th)), t = vec3(sx * sin(th), 0.0, cos(th));
      c = aP.xyz + vec3(ch * q.x + sh * q.z, 0.0, -sh * q.x + ch * q.z);
      d = vec3(ch * t.x + sh * t.z, 0.0, -sh * t.x + ch * t.z);
      gait = L / (1.15 * sz) * 6.2832;
      float m = Tw + Tg * 0.55, alert = Tg > 7.0 ? smoothstep(m - 1.0, m - 0.4, f) * (1.0 - smoothstep(m + 0.8, m + 1.4, f)) : 0.0;
      graze = smoothstep(Tw + 0.1, Tw + 1.3, f) * (1.0 - smoothstep(Tc - 1.2, Tc - 0.1, f)) * (1.0 - alert);
      look = alert * sin(ph * 23.0) * 0.7 + dv * sin(uT * 0.6 + ph * 9.0) * 0.12;
    } else {
      // Swimming round a circle at the surface, now and then leaping out (dolphins).
      c = aP.xyz + vec3(cos(a) * R, 0.0, sin(a) * R); d = vec3(-sin(a), 0.0, cos(a)) * sign(sp);
      float j = sin(a * 0.5 + ph * 7.0); float up = amp * max(0.0, j) * max(0.0, j); c.y += up - 0.4;
      pitch = -cos(a * 0.5 + ph * 7.0) * step(0.0, j) * 0.9;
    }
    vec3 p = position * sz, n = normal;
    if (abs(aW) > 0.5 && abs(aW) < 1.5) { float ang = sin(uT * uFlap + ph * 40.0) * 0.8 * sign(aW); p.xy = rot2(p.xy, ang); n.xy = rot2(n.xy, ang); }
    if (aW > 1.5 && aW < 2.5) { float ang = sin(uT * 10.0 + ph * 30.0 + position.z * 25.0) * 0.45; p.yz = rot2(p.yz, ang * sign(position.x)); }
    if (uMode > 4.5 && aW > 2.5) {
      vec3 q = position, nn = normal;
      if (aW > 5.5) {
        // Legs swing from the hip and the lower leg folds back as it comes forward. Order: left hind, left fore, right hind, right fore.
        bool fr = position.z > 0.0;
        vec2 hip = fr ? vec2(0.84, 0.32) : vec2(0.8, -0.36), knee = fr ? vec2(0.47, 0.34) : vec2(0.5, -0.45);
        float ga = gait + 6.2832 * ((position.x > 0.0 ? 0.0 : 0.5) + (fr ? 0.25 : 0.0)), am = 0.4 * dv;
        float sw = -am * sin(ga), bend = am * (fr ? 1.5 : 0.9) * max(0.0, cos(ga));
        if (aW > 6.5) { q.yz = knee + rot2(q.yz - knee, bend); nn.yz = rot2(nn.yz, bend); }
        q.yz = hip + rot2(q.yz - hip, sw); nn.yz = rot2(nn.yz, sw);
      } else if (aW > 4.5) {
        // The tail flicks up now and then.
        float fl = abs(sin(uT * 14.0 + ph * 9.0)) * 0.9 * step(0.85, fract(uT * 0.23 + ph * 3.0));
        vec2 tb = vec2(0.99, -0.53);
        q.yz = tb + rot2(q.yz - tb, fl); nn.yz = rot2(nn.yz, fl);
      } else {
        // Neck and head: stretched down to the grass to graze, a nod with each step, a look round.
        vec2 nb = vec2(0.88, 0.4), nt = vec2(1.33, 0.67);
        float a1 = graze * 2.0 + sin(gait * 2.0) * 0.05 * dv, a2 = -graze * 0.2;
        if (aW > 3.5) { q.yz = nt + rot2(q.yz - nt, a2); nn.yz = rot2(nn.yz, a2); }
        q.yz = nb + rot2(q.yz - nb, a1); nn.yz = rot2(nn.yz, a1);
        q.xz = vec2(0.0, nb.y) + rot2(q.xz - vec2(0.0, nb.y), look); nn.xz = rot2(nn.xz, look);
      }
      p = q * sz; n = nn;
    }
    p.yz = rot2(p.yz, pitch); n.yz = rot2(n.yz, pitch);
    bank *= uBank;
    p.xy = rot2(p.xy, bank); n.xy = rot2(n.xy, bank);
    float yaw = atan(d.x, d.z) + uSide, cy = cos(yaw), sy = sin(yaw);
    p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
    n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
    vC = aCol;
    vL = 0.5 + 0.65 * max(dot(normalize(n), normalize(vec3(0.4, 0.9, 0.3))), 0.0);
    vec4 mvPosition = viewMatrix * vec4(c + p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SWARM_FS = `#include <fog_pars_fragment>
  uniform float uLight, uGlow; varying vec3 vC; varying float vL;
  void main(){
    gl_FragColor = vec4(vC * (vL * uLight + uGlow), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
// One mesh per flock: list of { x, y, z, ph, R, sp, amp, sz, tint }.
export function swarm(view, animal, list, o = {}) {
  if (!list.length) return;
  const parts = ANIMALS[animal](), tmpl = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m);
    const c = new THREE.Color(p.c);
    tmpl.push([g.attributes.position.array, g.attributes.normal.array, c, p.w]);
    g.dispose();
  }
  const pos = [], nor = [], col = [], wf = [], ap = [], aq = [];
  let cx = 0, cy = 0, cz = 0, rad = 0;
  for (const s of list) { cx += s.x / list.length; cy += s.y / list.length; cz += s.z / list.length; }
  for (const s of list) {
    rad = Math.max(rad, Math.hypot(s.x - cx, s.y - cy, s.z - cz) + s.R + s.amp + 3);
    const t = new THREE.Color(s.tint ?? 0xffffff);
    for (const [pa, na, c, w] of tmpl) for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]); nor.push(na[i], na[i + 1], na[i + 2]);
      col.push(c.r * t.r, c.g * t.g, c.b * t.b); wf.push(w); ap.push(s.x, s.y, s.z, s.ph); aq.push(s.R, s.sp, s.amp, s.sz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(wf, 1));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(aq, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad);
  const m = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uMode: { value: o.mode ?? 0 }, uFlap: { value: o.flap ?? 9 }, uSide: { value: o.side ?? 0 }, uBank: { value: o.bank ?? 1 }, uLight: { value: o.light ?? 1 }, uGlow: { value: o.glow ?? 0 } }]),
    vertexShader: SWARM_VS, fragmentShader: SWARM_FS,
  });
  view.timeMats.push(m);
  const mesh = new THREE.Mesh(g, m);
  view.root.add(mesh);
  if (cy > 30) view.band(cy).near.push(mesh);
}

export function buildAnimals(view) {
  const L = view.level, key = view.key, R = rng(777), top = L.top;
  // Flocks spread up the whole climb (each flock circles its own spot), plus big circles round the tower.
  const flocks = (n, per, rMin, rMax, sz, sp, tints) => {
    // One mesh per band of height, so flocks far above or below are culled.
    const bands = new Map();
    for (let f = 0; f < n; f++) {
      const y = 8 + R() * (top + 10), a = R() * TAU, r = rMin + R() * (rMax - rMin), b = Math.floor(y / 120);
      if (!bands.has(b)) bands.set(b, []);
      for (let k = 0; k < per; k++) bands.get(b).push({ x: Math.cos(a) * r, y: y + (R() - 0.5) * 3, z: Math.sin(a) * r, ph: R(), R: 3 + R() * 6, sp: (0.25 + R() * 0.25) * (f % 2 ? 1 : -1) * sp, amp: 1 + R() * 1.5, sz: sz * (0.85 + R() * 0.3), tint: tints ? tints[(R() * tints.length) | 0] : null });
    }
    return [...bands.values()];
  };
  const birds = { storm: ['gull', [0x3a3a44]], sunny: ['gull', null], forest: ['gull', [0x8a6a3e, 0x6a8a4a, 0x4a6a9a, 0xc8a04a]], volcano: ['gull', [0xff8a3d]], city: ['gull', [0x9a9aa8, 0x7a7a88]], waterfall: ['parrot', [0xffffff, 0x3aa8ff, 0x5ad86a, 0xffd23d]] }[key];
  const light = key === 'storm' ? 0.45 : key === 'city' ? 0.7 : key === 'volcano' ? 0.8 : 1;
  for (const list of flocks([14, 32, 44][DETAIL], 4, 12, 34, key === 'forest' ? 1.0 : 1.4, 1, birds[1])) swarm(view, birds[0], list, { light, glow: key === 'volcano' ? 0.6 : 0, flap: key === 'storm' ? 7 : 9 });
  if (key === 'sunny' || key === 'waterfall') for (const list of flocks(18, 2, 30, 60, 1.6, 0.6, null)) swarm(view, 'gull', list, { light, flap: 6 });
  if (key === 'forest') for (const list of flocks(16, 1, 30, 60, 3.2, 0.35, null)) swarm(view, 'eagle', list, { light, flap: 3.5 });
  if (DETAIL === 0) return;
  // Butterflies near the route on the green maps.
  if (key === 'sunny' || key === 'forest' || key === 'waterfall') {
    const cols = [0xff9a3d, 0x5ab8ff, 0xffe066, 0xff6ab8, 0xb48cff, 0xffffff], bands = new Map();
    for (let k = 0; k < (DETAIL === 2 ? 320 : 200); k++) {
      const y = 2 + R() * (top - 4), a = R() * TAU, r = 8 + R() * 12, b = Math.floor(y / 60);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ph: R(), R: 0.8 + R() * 1.6, sp: 0.6 + R() * 0.5, amp: 0.6, sz: 1.2 + R() * 0.6, tint: cols[(R() * cols.length) | 0] });
    }
    for (const list of bands.values()) swarm(view, 'butterfly', list, { mode: 1, flap: 22, light: 1.15 });
  }
  // Critters on the ground.
  const ring = (n, rMin, rMax, y, f) => Array.from({ length: n }, () => { const a = R() * TAU, r = rMin + R() * (rMax - rMin); return Object.assign({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ph: R(), tint: null }, f()); });
  if (key === 'sunny') {
    swarm(view, 'crab', ring(14, 31, 39, 0.42, () => ({ R: 0.8 + R(), sp: 0.5 + R() * 0.4, amp: 0, sz: 1.2 })), { mode: 2, side: Math.PI / 2 });
    swarm(view, 'dolphin', ring(8, 60, 140, 0, () => ({ R: 14 + R() * 10, sp: (0.12 + R() * 0.05) * (R() < 0.5 ? 1 : -1), amp: 2.6, sz: 1.3 })), { mode: 4 });
  }
  if (key === 'forest') {
    // A herd: does, some with a fawn trailing behind, and stags. Each walks its figure of eight where the ground is clear
    // of trees, logs, rocks and the route (wildview.js).
    const free = view.groundFree || (() => true), does = [], fawns = [], stags = [];
    const spot = (rr) => {
      for (let tries = 0; tries < 80; tries++) {
        const a = R() * TAU, r = 30 + R() * 48, x = Math.cos(a) * r, z = Math.sin(a) * r, ph = R(), h = ph * TAU, ch = Math.cos(h), sh = Math.sin(h);
        let ok = true;
        for (let k = 0; k < 40 && ok; k++) {
          const th = ((k % 20) / 20) * TAU, sx = k < 20 ? 1 : -1, qx = sx * rr * (1 - Math.cos(th)), qz = rr * Math.sin(th);
          const px = x + ch * qx + sh * qz, pz = z - sh * qx + ch * qz, pr = Math.hypot(px, pz);
          ok = pr > 24 && pr < 84 && free(px, pz, 1.1);
        }
        if (ok) return { x, y: 0.4, z, ph };
      }
      return null;
    };
    for (let i = 0, n = [5, 9, 12][DETAIL]; i < n; i++) {
      const rr = 3.4 + R() * 3, s = spot(rr), stag = i % 4 === 1;
      if (!s) continue;
      const sp = 0.85 + R() * 0.3;
      (stag ? stags : does).push(Object.assign({ R: rr, sp, amp: 0, sz: stag ? 1.12 : 1 + R() * 0.06, tint: null }, s));
      if (!stag && i % 3 === 0) fawns.push(Object.assign({ R: rr, sp, amp: -1.7, sz: 0.62, tint: null }, s));
    }
    for (const [k, list] of [['deer', does], ['stag', stags], ['fawn', fawns]]) if (list.length) swarm(view, k, list, { mode: 5 });
  }
  if (key === 'waterfall') {
    const lilies = L.decor.filter((d) => d.k === 'lily');
    swarm(view, 'frog', lilies.filter((d, i) => i % 3 === 0).map((d) => ({ x: d.x, y: d.y + 0.03, z: d.z, ph: R(), R: 0.25, sp: 0.4 + R() * 0.3, amp: 0.35, sz: 1.4, tint: null })), { mode: 3 });
    // Herons wading slowly along the edge of the beach, fish leaping out in the lagoon.
    swarm(view, 'heron', ring(8, 37.6, 39.2, -0.3, () => ({ R: 0.8 + R() * 1.2, sp: 0.12 + R() * 0.1, amp: 0, sz: 1.1 })), { mode: 2 });
    const koi = [0xffffff, 0xffffff, 0xffb070, 0xffd8a0];
    swarm(view, 'fish', ring(18, 46, 110, 0.2, () => ({ R: 0.6 + R() * 0.5, sp: (4 + R() * 1.6) * (R() < 0.5 ? 1 : -1), amp: 1.1, sz: 1.2, tint: koi[(R() * 4) | 0] })), { mode: 4 });
    swarm(view, 'turtle', ring(10, 42, 80, 0.12, () => ({ R: 4 + R() * 6, sp: (0.06 + R() * 0.05) * (R() < 0.5 ? 1 : -1), amp: 0, sz: 1.6 })), { mode: 4 });
  }
  if (key === 'city') {
    // Traffic: flying cars in lanes round the city, each height its own way round, lights on.
    const paint = [0xc83030, 0xffffff, 0x5a5e66, 0xd8b020, 0x2a6ae8, 0xff4fd8, 0x7cff6a, 0x9a9aa8], cars = new Map();
    const nCar = [36, 80, 120][DETAIL];
    for (let k = 0; k < nCar; k++) {
      const lane = (R() * Math.floor(top / 22)) | 0, y = 12 + lane * 22 + R() * 3, b = Math.floor(y / 120), r = 42 + R() * 70;
      if (!cars.has(b)) cars.set(b, []);
      cars.get(b).push({ x: 0, y, z: 0, ph: R(), R: r, sp: ((11 + R() * 7) / r) * (lane % 2 ? 1 : -1), amp: 0.8, sz: 1, tint: paint[(R() * paint.length) | 0] });
    }
    for (const list of cars.values()) {
      swarm(view, 'hovercar', list, { light: 0.9, bank: 0.25 });
      swarm(view, 'hovercarL', list.map((c) => Object.assign({}, c, { tint: null })), { light: 0, glow: 2.6, bank: 0.25 });
    }
    // Robots on the square at the foot of the Nexus, going to and fro.
    const bots = [], boxes = [];
    for (let k = 0; k < 10; k++) {
      const a = 0.9 + (k / 10) * (TAU - 1.8) + R() * 0.3, r = 15.5 + R() * 2.5;
      (k % 3 ? bots : boxes).push({ x: Math.cos(a) * r, y: 2, z: Math.sin(a) * r, ph: R(), R: 1 + R() * 1.6, sp: 0.35 + R() * 0.25, amp: 0, sz: 1.1, tint: null });
    }
    for (const [k, list] of [['robot', bots], ['deliv', boxes]]) {
      if (!list.length) continue;
      const byBand = new Map();
      for (const s of list) { const b = Math.floor(s.y / 120); if (!byBand.has(b)) byBand.set(b, []); byBand.get(b).push(s); }
      for (const l of byBand.values()) { swarm(view, k, l, { mode: 2, light: 0.95 }); swarm(view, k + 'L', l, { mode: 2, light: 0, glow: 2.4 }); }
    }
  }
  if (key === 'volcano') swarm(view, 'lizard', ring(16, 21.2, 21.8, 0, () => ({ R: 1.2, sp: 0.4, amp: 0, sz: 2.2 })).map((s) => Object.assign(s, { y: 6 + R() * (top - 20) })), { mode: 2, glow: 0.2 });
}

// ---------------------------------------------------------------- waterfalls
// Falling water: deep blue-white layers streaming down, foam clumps, ragged see-through edges.
export function fallMat(view, o = {}) {
  // fade: the fall carries a 0..1 attribute aK from its lip to its foot, spreads out and dissolves into spray at the
  // bottom (falls off floating islands, which have nothing to land on).
  const fade = !!o.fade;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uT: { value: 0 }, uS: { value: o.speed ?? 0.5 }, uA: { value: o.alpha ?? 0.92 },
      uC: { value: new THREE.Color(o.color ?? 0xdaf4fa) }, uD: { value: new THREE.Color(o.deep ?? 0x2f8ab0) },
    }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv; varying float vK;
      ${fade ? 'attribute float aK;' : ''}
      void main(){ vUv = uv; vK = ${fade ? 'aK' : '0.0'};
        vec3 p = position;
        ${fade ? 'p.x *= 1.0 + aK * aK * 0.9;' : ''}
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float uT, uS, uA; uniform vec3 uC, uD; varying vec2 vUv; varying float vK;
      ${noiseGlsl()}
      void main(){
        float x = vUv.x, v = vUv.y + uT * uS;
        // Ropes of water: noise drawn out along the flow at three sizes, each sliding at its own speed.
        float s1 = n21(vec2(x * 22.0, v * 0.55));
        float s2 = n21(vec2(x * 58.0 + 5.0, v * 1.5 + uT * uS * 0.8));
        float s3 = n21(vec2(x * 8.0 + 2.0, v * 0.22 + uT * uS * 0.3));
        float streak = smoothstep(0.32, 0.82, s1 * 0.45 + s2 * 0.35 + s3 * 0.2);
        // Clumps of white water tumbling down faster.
        float clump = smoothstep(0.6, 0.9, n21(vec2(x * 13.0 + 11.0, v * 3.2 + uT * uS * 1.7)) * 0.6 + s2 * 0.4);
        vec3 col = mix(uD, uC, 0.22 + 0.78 * streak);
        col = mix(col, vec3(1.0), clump * 0.85);
        // See-through gaps between the ropes, more of them toward the edges.
        float edge = smoothstep(0.0, 0.08 + 0.14 * s3, x) * (1.0 - smoothstep(0.92 - 0.14 * s1, 1.0, x));
        float a = uA * edge * (0.5 + 0.5 * max(streak, clump));
        // Foam where it pours over the lip, and spray that dissolves at the foot.
        float lip = 1.0 - smoothstep(0.0, 0.06, vK);
        float spray = smoothstep(0.45, 1.0, vK + (s2 - 0.5) * 0.25);
        col = mix(col, vec3(1.0), max(lip * 0.7 * ${fade ? '1.0' : '0.0'}, spray * 0.8));
        a *= 1.0 - spray * spray;
        gl_FragColor = vec4(col * (0.9 + 0.25 * streak), a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  view.timeMats.push(m);
  return m;
}

// Spray and mist where falls land: soft puffs rising and spreading, as camera-facing quads in one mesh.
export function buildMist(view, spots) {
  if (!spots.length || DETAIL === 0) return;
  const R = rng(99), pos = [], ap = [], aq = [];
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  let cx = 0, cy = 0, cz = 0;
  for (const s of spots) { cx += s.x / spots.length; cy += s.y / spots.length; cz += s.z / spots.length; }
  let rad = 0;
  for (const s of spots) {
    rad = Math.max(rad, Math.hypot(s.x - cx, s.y - cy, s.z - cz) + s.r * 3 + 10);
    for (let k = 0; k < (s.n || 14); k++) {
      const a = R() * TAU, r = R() * s.r, ph = R();
      for (const [u, v] of corners) { pos.push(u, v, 0); ap.push(s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r, ph); aq.push(s.r * (0.6 + R() * 0.5), 0.25 + R() * 0.2, s.rise ?? 4, 0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(aq, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 } }]),
    vertexShader: `#include <fog_pars_vertex>
      uniform float uT; attribute vec4 aP; attribute vec4 aQ; varying vec2 vQ; varying float vA;
      void main(){
        float life = fract(uT * aQ.y + aP.w), size = aQ.x * (0.5 + life * 1.2);
        vec3 c = aP.xyz + vec3(sin(aP.w * 40.0) * life * 1.5, life * aQ.z, cos(aP.w * 33.0) * life * 1.5);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = c + (right * position.x + up * position.y) * size;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        // Fades out close to the camera: spray is scenery, it must never blank out your view of the jump.
        vQ = position.xy; vA = (1.0 - life) * smoothstep(0.0, 0.15, life) * smoothstep(4.0, 16.0, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      varying vec2 vQ; varying float vA;
      void main(){
        float d = length(vQ) * 2.0, a = (1.0 - smoothstep(0.3, 1.0, d)) * vA * 0.42;
        gl_FragColor = vec4(vec3(0.94, 0.98, 1.0), a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  view.timeMats.push(m);
  view.root.add(new THREE.Mesh(g, m));
}
export { FLORA, pick as pickWeighted };

// ---------------------------------------------------------------- creatures (worldview.js buildCreatures)
// Each one a body and the limbs that move as it goes, every limb its own model turning about its joint (at). They face +z
// with their feet at 0. move: leg (swings fore and aft), side (an insect's or a crab's legs, swinging round), arm, wing,
// tail, jaw, claw. ph: where in the stride (a trot: each fore leg with the hind leg across from it).
const Eg = (x, y, z, rx, ry, rz, c, ax = 0, ay = 0, az = 0, d = 10, glow, gk) => P(egg(rx, ry, rz, d, Math.max(5, d - 3)), M(x, y, z, 1, 1, 1, ax, ay, az), c, glow, gk);
const Sg = (a, b, ra, rb, c, s = 7, glow, gk) => P(seg(a, b, ra, rb, s), I(), c, glow, gk);
const Cn = (x, y, z, r, h, c, ax = 0, ay = 0, az = 0, s = 5, glow, gk) => P(cone(r, h, s), M(x, y, z, 1, 1, 1, ax, ay, az), c, glow, gk);
const SIDES = [-1, 1], PI = Math.PI;
// A thin sheet seen from both sides (a wing): a fan of corners round the first.
function sheet(pts) {
  const p = [];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[0], b = pts[k], c = pts[k + 1];
    p.push(...a, ...b, ...c, ...a, ...c, ...b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
const BEASTS = {
  // The Wild Forest: a grey wolf with a thick ruff, amber eyes and a bushy tail.
  wolf: () => {
    const coat = 0x6e6a64, back = 0x4a4642, pale = 0xc8c0b4, dark = 0x1e1c1a;
    const body = [
      Eg(0, 0.68, -0.04, 0.15, 0.17, 0.4, coat), Eg(0, 0.68, 0.26, 0.17, 0.21, 0.21, coat), Eg(0, 0.7, -0.36, 0.15, 0.16, 0.17, coat),
      Eg(0, 0.79, -0.04, 0.1, 0.07, 0.36, back), Eg(0, 0.55, 0.04, 0.09, 0.06, 0.26, pale),
      Eg(0, 0.77, 0.36, 0.19, 0.2, 0.15, back, -0.4), Sg([0, 0.74, 0.38], [0, 0.86, 0.54], 0.13, 0.1, coat, 8), Eg(0, 0.64, 0.42, 0.11, 0.12, 0.08, pale, -0.3),
      Eg(0, 0.9, 0.6, 0.1, 0.095, 0.12, coat), Eg(0, 0.86, 0.6, 0.12, 0.07, 0.09, pale),
      Sg([0, 0.88, 0.66], [0, 0.83, 0.85], 0.06, 0.034, coat, 8), Eg(0, 0.81, 0.79, 0.045, 0.028, 0.08, pale), Eg(0, 0.845, 0.865, 0.026, 0.02, 0.02, dark, 0, 0, 0, 6),
      ...SIDES.flatMap((sx) => [
        Eg(sx * 0.046, 0.92, 0.69, 0.02, 0.016, 0.012, 0xffd23a, 0, 0, 0, 6, 0xffc030, 2.4),
        Cn(sx * 0.055, 1.0, 0.56, 0.042, 0.12, back, -0.15, 0, -sx * 0.25, 4), Cn(sx * 0.055, 0.995, 0.57, 0.024, 0.08, pale, -0.15, 0, -sx * 0.25, 4),
      ]),
    ];
    const fore = (sx) => ({ at: [sx * 0.085, 0.66, 0.3], move: 'leg', ph: sx > 0 ? 0 : PI, amp: 0.45, parts: [
      Eg(0, -0.06, 0, 0.055, 0.12, 0.075, coat), Sg([0, -0.04, 0], [0, -0.33, 0.03], 0.058, 0.04, coat), Sg([0, -0.33, 0.03], [0, -0.6, 0.01], 0.036, 0.028, coat),
      Eg(0, -0.635, 0.03, 0.034, 0.022, 0.05, dark, 0, 0, 0, 7)] });
    const hind = (sx) => ({ at: [sx * 0.09, 0.67, -0.36], move: 'leg', ph: sx > 0 ? PI : 0, amp: 0.45, parts: [
      Eg(0, -0.07, 0, 0.065, 0.15, 0.1, coat), Sg([0, -0.1, 0], [0, -0.36, -0.1], 0.062, 0.04, coat), Sg([0, -0.36, -0.1], [0, -0.62, -0.05], 0.036, 0.028, coat),
      Eg(0, -0.645, -0.03, 0.034, 0.022, 0.05, dark, 0, 0, 0, 7)] });
    const tail = { at: [0, 0.74, -0.5], move: 'tail', ph: 0, amp: 0.35, parts: [
      Sg([0, 0, 0], [0, -0.1, -0.18], 0.05, 0.06, coat), Eg(0, -0.2, -0.3, 0.065, 0.07, 0.2, coat, -0.6), Eg(0, -0.31, -0.42, 0.042, 0.046, 0.08, back, -0.6)] };
    return { body, limbs: [fore(-1), fore(1), hind(-1), hind(1), tail] };
  },
  // The Wild Forest's mazes: a wild boar, all shoulders, with a bristly mane, a long snout and tusks.
  boar: () => {
    const hide = 0x4a3426, bristle = 0x2e2018, snout = 0x9a7a6a, tusk = 0xf4ecd8, dark = 0x1e1c1a;
    const body = [
      Eg(0, 0.6, -0.06, 0.24, 0.27, 0.46, hide), Eg(0, 0.66, 0.24, 0.25, 0.3, 0.24, hide), Eg(0, 0.58, -0.38, 0.22, 0.24, 0.2, hide),
      Eg(0, 0.86, 0.12, 0.08, 0.06, 0.4, bristle),
      ...[0.42, 0.3, 0.18, 0.06, -0.06, -0.18].map((z, k) => Cn(0, 0.92 - k * 0.012, z, 0.05, 0.17 - k * 0.016, bristle, -0.45, 0, 0, 4)),
      Eg(0, 0.62, 0.52, 0.17, 0.19, 0.2, hide, 0.35), Sg([0, 0.56, 0.6], [0, 0.46, 0.86], 0.12, 0.075, hide, 8),
      P(cyl(0.078, 0.078, 0.04, 10), M(0, 0.455, 0.88, 1, 1, 1, PI / 2 - 0.35), snout),
      ...SIDES.flatMap((sx) => [
        Eg(sx * 0.03, 0.455, 0.9, 0.014, 0.018, 0.006, dark, 0, 0, 0, 5),
        Sg([sx * 0.075, 0.45, 0.76], [sx * 0.11, 0.5, 0.82], 0.022, 0.016, tusk, 5), Sg([sx * 0.11, 0.5, 0.82], [sx * 0.12, 0.58, 0.79], 0.016, 0.005, tusk, 5),
        Eg(sx * 0.12, 0.68, 0.63, 0.022, 0.02, 0.016, 0xff3a2a, 0, 0, 0, 6, 0xff3a2a, 2.4),
        Cn(sx * 0.12, 0.8, 0.47, 0.055, 0.13, bristle, -0.3, 0, -sx * 0.5, 4),
      ]),
    ];
    const leg = (sx, z, ph, thigh) => ({ at: [sx * 0.13, 0.47, z], move: 'leg', ph, amp: 0.4, parts: [
      Eg(0, -0.04, 0, 0.08, thigh, 0.1, hide), Sg([0, -0.06, 0], [0, -0.27, 0.02], 0.07, 0.05, hide), Sg([0, -0.27, 0.02], [0, -0.42, 0.03], 0.045, 0.036, bristle),
      P(cyl(0.04, 0.045, 0.05, 6), M(0, -0.445, 0.035), dark)] });
    const tail = { at: [0, 0.66, -0.56], move: 'tail', ph: 0, amp: 0.5, parts: [Sg([0, 0, 0], [0, -0.2, -0.06], 0.022, 0.012, hide, 4), Eg(0, -0.24, -0.07, 0.03, 0.05, 0.03, bristle, 0, 0, 0, 6)] };
    return { body, limbs: [leg(-1, 0.3, PI, 0.14), leg(1, 0.3, 0, 0.14), leg(-1, -0.38, 0, 0.17), leg(1, -0.38, PI, 0.17), tail] };
  },
  // Waterfall: a crocodile, armoured down its back and tail, its lower jaw dropping as it comes for you.
  croc: () => {
    const skin = 0x4a5e2e, dark = 0x2e3c1e, belly = 0xb8b07a, tooth = 0xf4ecd8;
    const teeth = (y, down) => SIDES.flatMap((sx) => [0.72, 0.82, 0.92, 1.02, 1.12, 1.2].map((z) => Cn(sx * 0.1 * (1 - (z - 0.7) * 0.45), y, z, 0.012, 0.05, tooth, down ? PI : 0, 0, 0, 4)));
    const body = [
      Eg(0, 0.24, -0.02, 0.3, 0.15, 0.6, skin, 0, 0, 0, 12), Eg(0, 0.15, 0, 0.26, 0.08, 0.55, belly),
      ...[-0.5, -0.38, -0.26, -0.14, -0.02, 0.1, 0.22, 0.34, 0.46].flatMap((z) => SIDES.map((sx) => Eg(sx * 0.1, 0.37 - Math.abs(z) * 0.04, z, 0.045, 0.035, 0.05, dark, 0, 0, 0, 5))),
      Eg(0, 0.24, 0.58, 0.2, 0.12, 0.22, skin), Eg(0, 0.26, 0.95, 0.13, 0.065, 0.36, skin), Eg(0, 0.3, 1.27, 0.05, 0.03, 0.04, dark, 0, 0, 0, 6),
      ...SIDES.flatMap((sx) => [Eg(sx * 0.09, 0.33, 0.66, 0.045, 0.04, 0.05, skin, 0, 0, 0, 7), Eg(sx * 0.095, 0.355, 0.68, 0.02, 0.018, 0.02, 0xffd23a, 0, 0, 0, 6, 0xffd23a, 2)]),
      ...teeth(0.2, true),
    ];
    const jaw = { at: [0, 0.2, 0.66], move: 'jaw', ph: 0, amp: 1, parts: [Eg(0, -0.02, 0.3, 0.12, 0.045, 0.34, skin), Eg(0, -0.04, 0.3, 0.1, 0.03, 0.3, belly), ...teeth(0.025, false).map((p) => ({ ...p, m: M(0, 0, -0.66).multiply(p.m) }))] };
    const crest = Array.from({ length: 9 }, (_, k) => { const z = -0.1 - k * 0.12, f = -z / 1.15; return Cn(0, 0.17 * (1 - f * 0.85) - 0.09 * f + 0.02, z, 0.03, 0.07, dark, 0, 0, 0, 4); });
    const tail = { at: [0, 0.24, -0.58], move: 'tail', ph: 0, amp: 0.3, parts: [Sg([0, 0, 0], [0, -0.05, -0.55], 0.17, 0.1, skin, 8), Sg([0, -0.05, -0.55], [0, -0.1, -1.15], 0.1, 0.025, skin, 7), ...crest] };
    const leg = (sx, z, ph, k) => ({ at: [sx * 0.24, 0.2, z], move: 'side', ph, amp: 0.35, parts: [
      Sg([0, 0, 0], [sx * 0.16, -0.04, 0.02], 0.07 * k, 0.055 * k, skin), Sg([sx * 0.16, -0.04, 0.02], [sx * 0.2, -0.18, 0.05], 0.05 * k, 0.04 * k, skin),
      Eg(sx * 0.21, -0.185, 0.09, 0.06, 0.02, 0.08, dark, 0, 0, 0, 7), ...[-1, 0, 1].map((c) => Cn(sx * 0.21 + c * 0.035, -0.19, 0.17, 0.01, 0.05, tooth, PI / 2, 0, 0, 3))] });
    return { body, limbs: [leg(-1, 0.32, 0, 1), leg(1, 0.32, PI, 1), leg(-1, -0.36, PI, 1.15), leg(1, -0.36, 0, 1.15), jaw, tail] };
  },
  // Sunny Isles: a sand scorpion, its tail curled over its back with a glowing sting.
  scorpion: () => {
    const shell = 0xc08a3a, plate = 0x8a5a22, legC = 0x7a4a1a, claw = 0xb07a2e;
    const body = [
      Eg(0, 0.22, 0.24, 0.19, 0.08, 0.22, shell), ...[0.06, -0.08, -0.2, -0.3].map((z, k) => Eg(0, 0.22 - k * 0.005, z, 0.2 - k * 0.025, 0.085, 0.09, k % 2 ? plate : shell)),
      ...SIDES.flatMap((sx) => [Eg(sx * 0.04, 0.31, 0.36, 0.02, 0.02, 0.02, 0xff4020, 0, 0, 0, 6, 0xff4020, 2.4), Cn(sx * 0.03, 0.2, 0.46, 0.018, 0.07, legC, PI / 2, 0, 0, 4)]),
    ];
    const pts = [[0, 0, 0], [0, 0.1, -0.13], [0, 0.26, -0.2], [0, 0.42, -0.16], [0, 0.54, -0.04], [0, 0.58, 0.08]];
    const tail = { at: [0, 0.24, -0.36], move: 'tail', ph: 0, amp: 0.25, parts: [
      ...pts.slice(0, -1).flatMap((a, k) => [Sg(a, pts[k + 1], 0.07 - k * 0.008, 0.06 - k * 0.008, k % 2 ? plate : shell), Eg(...a, 0.07 - k * 0.008, 0.06 - k * 0.008, 0.06 - k * 0.008, k % 2 ? shell : plate, 0, 0, 0, 7)]),
      Eg(0, 0.56, 0.14, 0.055, 0.05, 0.07, claw), Cn(0, 0.5, 0.2, 0.025, 0.12, 0xff3060, 2.4, 0, 0, 5, 0xff3060, 2.2)] };
    const claws = SIDES.map((sx) => ({ at: [sx * 0.13, 0.22, 0.42], move: 'claw', side: sx, ph: sx > 0 ? 0 : 1.3, amp: 1, parts: [
      Sg([0, 0, 0], [sx * 0.1, 0.02, 0.15], 0.035, 0.03, legC), Sg([sx * 0.1, 0.02, 0.15], [sx * 0.08, 0.03, 0.3], 0.03, 0.028, legC), Eg(sx * 0.08, 0.03, 0.4, 0.065, 0.04, 0.1, claw),
      Cn(sx * 0.05, 0.03, 0.52, 0.02, 0.1, claw, PI / 2, 0, 0, 4), Cn(sx * 0.11, 0.03, 0.51, 0.018, 0.09, plate, PI / 2, 0, 0, 4)] }));
    const legs = (g) => ({ at: [0, 0.22, 0.1], move: 'side', ph: g ? PI : 0, amp: 0.22, parts: [0, 1, 2, 3].flatMap((k) => {
      const sx = (k + g) % 2 ? 1 : -1, z = 0.2 - k * 0.12, dz = (k - 1.5) * 0.06;
      return [Sg([sx * 0.14, 0, z], [sx * 0.3, 0.1, z + dz], 0.022, 0.018, legC, 5), Sg([sx * 0.3, 0.1, z + dz], [sx * 0.42, -0.22, z + dz * 1.6], 0.018, 0.01, legC, 5)];
    }) });
    return { body, limbs: [...claws, legs(0), legs(1), tail] };
  },
  // Storm Tower: a storm crab, lightning running in lines over its shell, eyes on stalks, one claw bigger than the other.
  stormcrab: () => {
    const shell = 0x2a3a5a, under = 0x22304a, limb = 0x3a4a6a, glow = 0x5af0ff;
    const body = [
      Eg(0, 0.42, 0, 0.42, 0.16, 0.32, shell, 0, 0, 0, 14), Eg(0, 0.34, 0, 0.36, 0.1, 0.27, under),
      ...SIDES.flatMap((sx) => [0, 1, 2, 3].map((k) => Cn(sx * (0.08 + k * 0.09), 0.45, 0.3 - k * 0.045, 0.03, 0.09, shell, PI / 2 - 0.25, 0, 0, 4))),
      P(box(0.5, 0.012, 0.02), M(0, 0.575, 0.05), glow, glow, 2.2), P(box(0.02, 0.012, 0.42), M(0, 0.578, 0), glow, glow, 2.2),
      ...SIDES.flatMap((sx) => [
        P(box(0.22, 0.012, 0.02), M(sx * 0.22, 0.55, -0.08, 1, 1, 1, 0, sx * 0.6, sx * 0.2), glow, glow, 2),
        Sg([sx * 0.08, 0.5, 0.24], [sx * 0.1, 0.68, 0.28], 0.02, 0.016, limb, 5), Eg(sx * 0.1, 0.7, 0.285, 0.035, 0.035, 0.035, 0x7ff8ff, 0, 0, 0, 7, 0x7ff8ff, 2.6),
      ]),
      P(box(0.14, 0.06, 0.03), M(0, 0.38, 0.31), under),
    ];
    const claws = SIDES.map((sx) => { const k = sx > 0 ? 1.3 : 1; return { at: [sx * 0.3, 0.4, 0.22], move: 'claw', side: sx, ph: sx > 0 ? 0 : 1.7, amp: 1, parts: [
      Sg([0, 0, 0], [sx * 0.16, 0.02, 0.14], 0.05, 0.045, limb), Sg([sx * 0.16, 0.02, 0.14], [sx * 0.2, 0.06, 0.3], 0.045, 0.04, limb),
      Eg(sx * 0.21, 0.07, 0.42, 0.09 * k, 0.06 * k, 0.13 * k, shell), Cn(sx * 0.18, 0.07, 0.42 + 0.15 * k, 0.03 * k, 0.14 * k, shell, PI / 2, 0, 0, 4),
      Cn(sx * 0.26, 0.05, 0.42 + 0.13 * k, 0.025 * k, 0.11 * k, limb, PI / 2, 0, 0, 4), P(box(0.012, 0.012, 0.16 * k), M(sx * 0.21, 0.07 + 0.06 * k, 0.42), glow, glow, 2)] }; });
    const legs = (g) => ({ at: [0, 0.38, -0.02], move: 'side', ph: g ? PI : 0, amp: 0.2, parts: [0, 1, 2, 3].flatMap((k) => {
      const sx = (k + g) % 2 ? 1 : -1, z = 0.12 - k * 0.11;
      return [Sg([sx * 0.36, 0, z], [sx * 0.62, 0.12, z + (k - 1.5) * 0.06], 0.035, 0.03, limb, 5), Sg([sx * 0.62, 0.12, z + (k - 1.5) * 0.06], [sx * 0.78, -0.38, z + (k - 1.5) * 0.1], 0.03, 0.012, limb, 5)];
    }) });
    return { body, limbs: [...claws, legs(0), legs(1)] };
  },
  // Volcano: an imp, a small fire devil with horns, bat wings, glowing eyes and mouth, flames for hair and on its tail.
  imp: () => {
    const skin = 0x8a1a10, deep = 0x6a120a, light = 0xa02414, horn = 0x2a1a14, wing = 0x3a0a08;
    const body = [
      Eg(0, 0.84, 0, 0.16, 0.22, 0.13, skin, 0, 0, 0, 10, 0xff4a10, 0.35), Eg(0, 0.66, 0.01, 0.13, 0.1, 0.11, deep), Eg(0, 0.8, 0.07, 0.11, 0.13, 0.07, light),
      Eg(0, 1.2, 0.04, 0.14, 0.13, 0.13, skin), Eg(0, 1.12, 0.1, 0.1, 0.06, 0.08, deep), P(box(0.1, 0.015, 0.02), M(0, 1.13, 0.17), 0xffa030, 0xff8a1a, 2.6),
      Cn(0, 1.4, -0.02, 0.1, 0.3, 0xffa030, 0, 0, 0, 6, 0xff8a1a, 2.6), Cn(0.03, 1.5, -0.01, 0.05, 0.2, 0xffe070, 0, 0, 0, 5, 0xffd040, 3),
      ...SIDES.flatMap((sx) => [
        Eg(sx * 0.055, 1.22, 0.15, 0.026, 0.02, 0.015, 0xffe040, 0, 0, 0, 6, 0xffe040, 3),
        Sg([sx * 0.08, 1.3, 0.02], [sx * 0.15, 1.42, -0.04], 0.035, 0.022, horn, 6), Sg([sx * 0.15, 1.42, -0.04], [sx * 0.13, 1.52, -0.14], 0.022, 0.006, horn, 5),
        Cn(sx * 0.15, 1.22, 0.02, 0.03, 0.12, skin, 0, 0, -sx * 1.2, 4),
        Sg([sx * 0.17, 0.98, 0], [sx * 0.24, 0.78, 0.04], 0.045, 0.035, skin), Sg([sx * 0.24, 0.78, 0.04], [sx * 0.25, 0.6, 0.12], 0.035, 0.028, skin),
        ...[-1, 0, 1].map((c) => Cn(sx * 0.25 + c * 0.02, 0.55, 0.15, 0.012, 0.07, horn, PI - 0.3, 0, 0, 3)),
      ]),
    ];
    const leg = (sx) => ({ at: [sx * 0.08, 0.6, 0], move: 'leg', ph: sx > 0 ? 0 : PI, amp: 0.5, parts: [
      Eg(0, -0.06, 0, 0.06, 0.1, 0.07, deep), Sg([0, -0.08, 0], [0, -0.3, 0.08], 0.05, 0.035, skin), Sg([0, -0.3, 0.08], [0, -0.48, -0.04], 0.035, 0.028, skin),
      Sg([0, -0.48, -0.04], [0, -0.58, 0.02], 0.028, 0.022, skin), Eg(0, -0.585, 0.06, 0.04, 0.02, 0.07, horn, 0, 0, 0, 6)] });
    const wingL = (sx) => ({ at: [sx * 0.07, 0.98, -0.1], move: 'wing', side: sx, ph: 0, amp: 1, parts: [
      P(sheet([[0, 0, 0], [sx * 0.55, 0.25, -0.15], [sx * 0.6, -0.05, -0.2], [sx * 0.42, -0.25, -0.15], [sx * 0.18, -0.2, -0.08]]), I(), wing),
      Sg([0, 0, 0], [sx * 0.55, 0.25, -0.15], 0.02, 0.01, horn, 4)] });
    const tail = { at: [0, 0.66, -0.1], move: 'tail', ph: 0, amp: 0.4, parts: [Sg([0, 0, 0], [0, -0.15, -0.2], 0.03, 0.022, skin, 5), Sg([0, -0.15, -0.2], [0, -0.1, -0.42], 0.022, 0.012, skin, 5),
      Cn(0, -0.06, -0.46, 0.035, 0.1, 0xffa030, -1.2, 0, 0, 5, 0xff6a10, 2.2)] };
    return { body, limbs: [leg(-1), leg(1), wingL(-1), wingL(1), tail] };
  },
  // Neon City: a robot dog, plated, with a red visor, cyan running lights and knees that bend backwards.
  robodog: () => {
    const shell = 0x3a3e4a, top = 0x4a4e5a, joint = 0x6a6e7a, black = 0x2a2e38, red = 0xff2a4a, cyan = 0x30f0ff;
    const body = [
      P(box(0.36, 0.2, 0.84), M(0, 0.62, 0), shell), P(box(0.3, 0.06, 0.74), M(0, 0.745, 0), top), P(box(0.22, 0.05, 0.2), M(0, 0.79, -0.18), black),
      P(box(0.3, 0.18, 0.2), M(0, 0.66, 0.5), top), P(box(0.24, 0.06, 0.02), M(0, 0.68, 0.605), red, red, 3), P(box(0.2, 0.04, 0.02), M(0, 0.64, -0.425), red, red, 2.4),
      ...SIDES.flatMap((sx) => [
        P(box(0.02, 0.03, 0.7), M(sx * 0.185, 0.64, 0), cyan, cyan, 2.2), Eg(sx * 0.16, 0.66, 0.52, 0.03, 0.03, 0.03, black, 0, 0, 0, 7),
        Sg([sx * 0.08, 0.75, 0.45], [sx * 0.1, 0.95, 0.4], 0.012, 0.008, black, 4), Eg(sx * 0.1, 0.96, 0.4, 0.022, 0.022, 0.022, red, 0, 0, 0, 6, red, 2.6),
        ...[0.32, -0.32].map((z) => P(cyl(0.07, 0.07, 0.06, 10), M(sx * 0.21, 0.58, z, 1, 1, 1, 0, 0, PI / 2), joint)),
      ]),
    ];
    const leg = (sx, z, ph) => ({ at: [sx * 0.25, 0.58, z], move: 'leg', ph, amp: 0.4, parts: [
      P(box(0.07, 0.3, 0.08), M(0, -0.13, -0.06, 1, 1, 1, 0.4), shell), P(cyl(0.045, 0.045, 0.08, 8), M(0, -0.27, -0.11, 1, 1, 1, 0, 0, PI / 2), joint),
      P(box(0.05, 0.32, 0.06), M(0, -0.42, -0.04, 1, 1, 1, -0.45), black), Eg(0, -0.56, 0.02, 0.04, 0.025, 0.05, black, 0, 0, 0, 7)] });
    return { body, limbs: [leg(-1, 0.32, 0), leg(1, 0.32, PI), leg(-1, -0.32, PI), leg(1, -0.32, 0)] };
  },
};
// A creature's models, made once: { body, limbs: [{ geo, at, move, ph, amp, side }], hl: half its length, zc: its middle }.
const rigs = new Map();
export function beastRig(kind) {
  if (rigs.has(kind)) return rigs.get(kind);
  const spec = BEASTS[kind]();
  const body = build(spec.body), limbs = spec.limbs.map((l) => ({ at: l.at, move: l.move, ph: l.ph || 0, amp: l.amp || 1, side: l.side || 1, geo: build(l.parts) }));
  const all = new THREE.Box3(), b = new THREE.Box3();
  body.computeBoundingBox();
  all.copy(body.boundingBox);
  for (const l of limbs) {
    l.geo.computeBoundingBox();
    all.union(b.copy(l.geo.boundingBox).translate(new THREE.Vector3(...l.at)));
  }
  const rig = { body, limbs, hl: (all.max.z - all.min.z) / 2, zc: (all.max.z + all.min.z) / 2 };
  rigs.set(kind, rig);
  return rig;
}
export const BEAST_KINDS = Object.keys(BEASTS);
