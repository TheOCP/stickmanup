// The shapes of hats and suit extras: each is a few primitives merged into one geometry, coloured from one
// small palette texture, so a hat is one draw call. Coordinates are relative to the head's centre (radius 0.2)
// unless GEAR_AT says otherwise.
import * as THREE from 'three';
import { panelMat } from './worldview.js';

const M = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const part = (geo, m, c, glow, gk) => ({ geo, m, c, glow, gk });
const sph = (r, x, y, z, c, sx = 1, sy = 1, sz = 1, glow, gk) => part(new THREE.SphereGeometry(r, 12, 9), M(x, y, z, sx, sy, sz), c, glow, gk);
const dome = (r, x, y, z, c, sx = 1, sy = 1, sz = 1) => part(new THREE.SphereGeometry(r, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2), M(x, y, z, sx, sy, sz), c);
const cyl = (rt, rb, h, x, y, z, c, rx = 0, rz = 0, glow, gk, ry = 0) => part(new THREE.CylinderGeometry(rt, rb, h, 16), M(x, y, z, 1, 1, 1, rx, ry, rz), c, glow, gk);
const cone = (r, h, x, y, z, c, rx = 0, rz = 0, glow, gk) => part(new THREE.ConeGeometry(r, h, 12), M(x, y, z, 1, 1, 1, rx, 0, rz), c, glow, gk);
const box = (w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0, glow, gk) => part(new THREE.BoxGeometry(w, h, d), M(x, y, z, 1, 1, 1, rx, ry, rz), c, glow, gk);
const tor = (R, r, x, y, z, c, rx = Math.PI / 2, ry = 0, glow, gk, sx = 1, sz = 1) => part(new THREE.TorusGeometry(R, r, 7, 22), M(x, y, z, sx, 1, sz, rx, ry, 0), c, glow, gk);

const band = (c) => [tor(0.195, 0.024, 0, 0.09, 0, c), box(0.03, 0.09, 0.12, 0.03, 0.09, -0.24, c, 0.5, 0, -0.5), box(0.03, 0.09, 0.12, -0.03, 0.09, -0.24, c, 0.5, 0, 0.5)];
const spikes = (n, r, y, h, c, glow, gk, w = 0.04) => {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(cone(w, h, Math.sin(a) * r, y, Math.cos(a) * r, c, Math.cos(a) * 0.35, -Math.sin(a) * 0.35, glow, gk)); }
  return out;
};

export const GEAR = {
  cap: () => [dome(0.208, 0, 0.03, 0, 0xd82a2a), box(0.24, 0.018, 0.17, 0, 0.055, 0.25, 0xb01a1a, -0.08), sph(0.02, 0, 0.235, 0, 0xffffff)],
  beanie: () => [dome(0.212, 0, 0.03, 0, 0x2a5ad8, 1, 1.05, 1), tor(0.205, 0.028, 0, 0.05, 0, 0xe8e8f0), sph(0.05, 0, 0.27, 0, 0xffffff)],
  band_red: () => band(0xd82a2a),
  band_blue: () => band(0x2a6ad8),
  bucket: () => [dome(0.205, 0, 0.05, 0, 0xd8c79a), cyl(0.205, 0.3, 0.07, 0, 0.03, 0, 0xc8b78a)],
  cowboy: () => [cyl(0.34, 0.36, 0.022, 0, 0.09, 0, 0x8a5a2a), dome(0.19, 0, 0.09, 0, 0x8a5a2a, 1, 1.05, 1.1), tor(0.185, 0.018, 0, 0.115, 0, 0x3a2412), tor(0.33, 0.025, 0, 0.1, 0, 0x7a4a1e)],
  tophat: () => [cyl(0.29, 0.29, 0.02, 0, 0.13, 0, 0x14161c), cyl(0.175, 0.17, 0.3, 0, 0.28, 0, 0x14161c), cyl(0.176, 0.175, 0.055, 0, 0.17, 0, 0xc01a2a)],
  party: () => [cone(0.13, 0.36, 0, 0.32, 0, 0xff4fb4), sph(0.04, 0, 0.5, 0, 0xffe14a), tor(0.1, 0.012, 0, 0.26, 0, 0x4f8bff), tor(0.06, 0.012, 0, 0.36, 0, 0xb6ff4a)],
  viking: () => [dome(0.214, 0, 0.03, 0, 0x8a96a8), tor(0.21, 0.022, 0, 0.04, 0, 0x6a4a22), cone(0.05, 0.22, 0.24, 0.19, 0, 0xf0ead8, 0, -0.75), cone(0.05, 0.22, -0.24, 0.19, 0, 0xf0ead8, 0, 0.75), box(0.03, 0.17, 0.03, 0, 0.1, 0.21, 0x6a4a22)],
  chef: () => [cyl(0.2, 0.19, 0.12, 0, 0.14, 0, 0xfafafa), sph(0.13, -0.09, 0.27, 0, 0xffffff), sph(0.13, 0.09, 0.27, 0, 0xffffff), sph(0.13, 0, 0.3, 0.07, 0xffffff), sph(0.13, 0, 0.3, -0.07, 0xffffff)],
  santa: () => [cone(0.2, 0.36, 0.01, 0.28, -0.05, 0xc81e1e, -0.55), tor(0.2, 0.05, 0, 0.09, 0, 0xfafafa), sph(0.055, 0, 0.4, -0.2, 0xfafafa)],
  pirate: () => [dome(0.21, 0, 0.05, 0, 0x14161c, 1.05, 0.9, 1), box(0.56, 0.11, 0.05, 0, 0.14, 0.13, 0x14161c, -0.25), box(0.56, 0.11, 0.05, 0, 0.14, -0.13, 0x14161c, 0.25), box(0.05, 0.11, 0.3, 0.26, 0.13, 0, 0x14161c, 0, 0, 0.2), box(0.05, 0.11, 0.3, -0.26, 0.13, 0, 0x14161c, 0, 0, -0.2), sph(0.035, 0, 0.17, 0.17, 0xf0ead8)],
  propeller: () => [dome(0.208, 0, 0.03, 0, 0x4f8bff), box(0.24, 0.018, 0.17, 0, 0.055, 0.25, 0xffe14a, -0.08), cyl(0.012, 0.012, 0.08, 0, 0.27, 0, 0x3a3a3a), box(0.38, 0.012, 0.05, 0, 0.31, 0, 0xff5050, 0, 0.4), box(0.05, 0.012, 0.38, 0, 0.312, 0, 0xb6ff4a, 0, 0.4), sph(0.02, 0, 0.32, 0, 0xffe14a)],
  bunny: () => [cyl(0.05, 0.04, 0.34, 0.09, 0.32, -0.02, 0xfafafa, 0, -0.14), cyl(0.05, 0.04, 0.34, -0.09, 0.32, -0.02, 0xfafafa, 0, 0.14), cyl(0.028, 0.022, 0.25, 0.092, 0.32, 0.018, 0xffb0c8, 0, -0.14), cyl(0.028, 0.022, 0.25, -0.092, 0.32, 0.018, 0xffb0c8, 0, 0.14), tor(0.2, 0.012, 0, 0.1, 0, 0x3a3a48)],
  catears: () => [cone(0.075, 0.14, 0.12, 0.2, 0, 0x1e1e26, 0, -0.35), cone(0.075, 0.14, -0.12, 0.2, 0, 0x1e1e26, 0, 0.35), cone(0.04, 0.09, 0.122, 0.195, 0.03, 0xff8ab0, 0, -0.35), cone(0.04, 0.09, -0.122, 0.195, 0.03, 0xff8ab0, 0, 0.35)],
  phones: () => [tor(0.215, 0.018, 0, 0.02, 0, 0x22242c, 0, 0), cyl(0.08, 0.08, 0.06, 0.215, 0, 0, 0x22242c, 0, Math.PI / 2), cyl(0.08, 0.08, 0.06, -0.215, 0, 0, 0x22242c, 0, Math.PI / 2), cyl(0.05, 0.05, 0.065, 0.218, 0, 0, 0x3ff0d0, 0, Math.PI / 2, 0x3ff0d0, 1.2), cyl(0.05, 0.05, 0.065, -0.218, 0, 0, 0x3ff0d0, 0, Math.PI / 2, 0x3ff0d0, 1.2)],
  mohawk: () => [0, 1, 2, 3, 4, 5, 6].map((i) => { const a = -0.9 + i * 0.42; return cone(0.05, 0.2, 0, Math.cos(a) * 0.25, -Math.sin(a) * 0.25, 0xff2ad8, -a); }),
  afro: () => [sph(0.3, 0, 0.14, -0.04, 0x2a1a10), sph(0.2, 0.17, 0.08, -0.05, 0x2a1a10), sph(0.2, -0.17, 0.08, -0.05, 0x2a1a10)],
  grad: () => [dome(0.205, 0, 0.03, 0, 0x14161c, 1, 0.8, 1), box(0.48, 0.022, 0.48, 0, 0.19, 0, 0x14161c, 0, 0.78), cyl(0.008, 0.008, 0.18, 0.2, 0.11, 0.05, 0xffd24a), sph(0.02, 0, 0.21, 0, 0xffd24a)],
  police: () => [dome(0.208, 0, 0.05, 0, 0x16245c, 1.1, 0.7, 1.1), tor(0.2, 0.024, 0, 0.06, 0, 0x101828), box(0.25, 0.018, 0.13, 0, 0.05, 0.22, 0x0c0d12, -0.25), box(0.05, 0.05, 0.015, 0, 0.13, 0.215, 0xffd24a, -0.2)],
  sombrero: () => [cyl(0.44, 0.46, 0.022, 0, 0.1, 0, 0xc8983a), tor(0.44, 0.024, 0, 0.12, 0, 0xc01a2a), cyl(0.09, 0.18, 0.24, 0, 0.23, 0, 0xc8983a), tor(0.16, 0.018, 0, 0.14, 0, 0x2a8a3a), tor(0.3, 0.012, 0, 0.115, 0, 0x2a8a3a)],
  firehelm: () => [dome(0.214, 0, 0.03, 0, 0xc81e1e), cyl(0.27, 0.28, 0.02, 0, 0.05, -0.04, 0xc81e1e), box(0.05, 0.09, 0.2, 0, 0.21, 0.06, 0xffd24a, 0.45)],
  beret: () => [sph(0.22, 0.02, 0.15, 0, 0x8a1a2a, 1.08, 0.38, 1.08), sph(0.016, 0.02, 0.24, 0, 0x8a1a2a)],
  crown: () => [cyl(0.19, 0.17, 0.09, 0, 0.17, 0, 0xffc830), ...spikes(8, 0.175, 0.255, 0.1, 0xffc830, 0, 0, 0.035), sph(0.022, 0, 0.17, 0.18, 0xe02040, 1, 1, 1, 0xe02040, 1.5), sph(0.022, 0.18, 0.17, 0, 0x3060ff, 1, 1, 1, 0x3060ff, 1.5), sph(0.022, -0.18, 0.17, 0, 0x30d060, 1, 1, 1, 0x30d060, 1.5)],
  wizard: () => [cyl(0.32, 0.34, 0.02, 0, 0.09, 0, 0x2a1a7a), cone(0.19, 0.5, 0, 0.34, -0.02, 0x2a1a7a, -0.12), tor(0.19, 0.016, 0, 0.12, 0, 0xffd24a), sph(0.03, 0, 0.42, 0.11, 0xffd24a, 1, 1, 1, 0xffd24a, 1.4)],
  knight: () => [sph(0.222, 0, 0.015, 0, 0xa8b2c0), box(0.34, 0.04, 0.1, 0, 0.04, 0.19, 0x10141c), box(0.03, 0.17, 0.05, 0, -0.06, 0.215, 0x8a94a4), cone(0.03, 0.2, 0, 0.3, -0.02, 0xc02a2a), box(0.03, 0.14, 0.2, 0, 0.26, -0.06, 0xc02a2a)],
  halo: () => [tor(0.19, 0.022, 0, 0.32, 0, 0xfff4b0, Math.PI / 2, 0, 0xffe88a, 2.4)],
  devil: () => [cone(0.05, 0.2, 0.14, 0.21, 0.02, 0xc01a1a, 0, -0.45, 0xc01a1a, 0.5), cone(0.05, 0.2, -0.14, 0.21, 0.02, 0xc01a1a, 0, 0.45, 0xc01a1a, 0.5)],
  antenna: () => [cyl(0.01, 0.01, 0.2, 0.09, 0.27, 0, 0x8a96a8, 0, -0.25), cyl(0.01, 0.01, 0.2, -0.09, 0.27, 0, 0x8a96a8, 0, 0.25), sph(0.035, 0.117, 0.375, 0, 0x40e8ff, 1, 1, 1, 0x40e8ff, 2), sph(0.035, -0.117, 0.375, 0, 0xff5050, 1, 1, 1, 0xff5050, 2)],
  samurai: () => [dome(0.216, 0, 0.03, 0, 0x1a1a22), cyl(0.3, 0.33, 0.04, 0, 0.0, -0.05, 0x1a1a22, -0.4), box(0.05, 0.22, 0.015, 0.09, 0.27, 0.15, 0xd8b040, 0, 0, -0.45), box(0.05, 0.22, 0.015, -0.09, 0.27, 0.15, 0xd8b040, 0, 0, 0.45), sph(0.03, 0, 0.15, 0.2, 0xc01a2a)],
  astro: () => [sph(0.265, 0, 0.0, 0, 0xeef0f4), sph(0.2, 0, 0.0, 0.1, 0x10141c, 1, 0.82, 1), tor(0.2, 0.03, 0, -0.17, 0, 0xc8ccd4), box(0.05, 0.06, 0.03, 0.2, 0.14, 0.11, 0xe0702a)],
  shroom: () => [sph(0.31, 0, 0.11, 0, 0xd82a2a, 1, 0.55, 1), sph(0.05, 0.14, 0.26, 0.07, 0xfafafa), sph(0.045, -0.13, 0.25, 0.1, 0xfafafa), sph(0.05, 0, 0.27, -0.13, 0xfafafa), sph(0.04, 0.23, 0.17, -0.05, 0xfafafa), sph(0.04, -0.22, 0.17, -0.07, 0xfafafa)],
  flowers: () => { const out = [tor(0.19, 0.014, 0, 0.12, 0, 0x3a8a3a)], c = [0xff7ab0, 0xffe14a, 0xffffff, 0xff5a5a, 0xa66bff, 0x6ac8ff]; for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; out.push(sph(0.042, Math.sin(a) * 0.195, 0.125, Math.cos(a) * 0.195, c[i % 6])); out.push(sph(0.016, Math.sin(a) * 0.21, 0.135, Math.cos(a) * 0.21, 0xffd24a)); } return out; },
  // Legendary extras: lit from inside.
  l_crown: () => [cyl(0.2, 0.17, 0.11, 0, 0.17, 0, 0xffd24a, 0, 0, 0xffa020, 1.2), ...spikes(8, 0.18, 0.28, 0.17, 0xfff0a0, 0xffc040, 2.6, 0.04), sph(0.03, 0, 0.17, 0.19, 0xff2040, 1, 1, 1, 0xff2040, 3)],
  bolt: () => { const out = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; out.push(box(0.03, 0.2, 0.012, Math.sin(a) * 0.26, 0.2, Math.cos(a) * 0.26, 0xdfffff, 0, a, 0.5, 0x7fd8ff, 3)); } return out; },
  sunrays: () => spikes(12, 0.22, 0.2, 0.2, 0xffe88a, 0xffc040, 2.6, 0.03),
  antlers: () => { const out = []; for (const s of [-1, 1]) { out.push(cyl(0.016, 0.022, 0.28, s * 0.14, 0.28, 0, 0xc0ff70, 0, -s * 0.4, 0xc0ff70, 1.2)); out.push(cyl(0.012, 0.016, 0.13, s * 0.2, 0.32, 0.05, 0xc0ff70, 0.6, -s * 0.5, 0xc0ff70, 1.2)); out.push(cyl(0.012, 0.016, 0.12, s * 0.13, 0.3, 0.05, 0xc0ff70, 0.6, s * 0.5, 0xc0ff70, 1.2)); } return out; },
  flames: () => { const out = []; for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, h = 0.2 + (i % 3) * 0.1; out.push(cone(0.06, h, Math.sin(a) * 0.15, 0.17 + h / 2, Math.cos(a) * 0.15, 0xffc040, 0, 0, 0xff6a10, 3)); } out.push(cone(0.08, 0.44, 0, 0.36, 0, 0xfff060, 0, 0, 0xffa020, 3.2)); return out; },
  // Owner extras. The hood is open at the front so the eyes show.
  hood: () => [
    part(new THREE.SphereGeometry(0.245, 18, 12, Math.PI * 0.86, Math.PI * 1.28, 0, Math.PI * 0.82), M(0, 0.015, -0.012), 0x070b09),
    tor(0.205, 0.009, 0, -0.005, 0.04, 0x0a5a24, 0.25, 0, 0x20e060, 0.55, 1, 1.05),
    cone(0.1, 0.16, 0, 0.18, -0.2, 0x070b09, -1.0),
  ],
  // ShortGG: dark hair with a soft fringe and two buns, a pink gaming headset with little ears.
  hairgg: () => [
    part(new THREE.SphereGeometry(0.224, 18, 12, Math.PI * 0.92, Math.PI * 1.16, 0, Math.PI * 0.72), M(0, 0.005, -0.01), 0x1c1420),
    sph(0.11, 0, 0.13, 0.12, 0x1c1420, 1.75, 0.5, 0.62),
    sph(0.055, -0.15, 0.09, 0.14, 0x1c1420, 0.8, 1.15, 0.6), sph(0.055, 0.15, 0.09, 0.14, 0x1c1420, 0.8, 1.15, 0.6),
    sph(0.085, 0.15, 0.21, -0.06, 0x241a2a), sph(0.085, -0.15, 0.21, -0.06, 0x241a2a),
    sph(0.07, 0.19, -0.14, -0.05, 0x1c1420, 0.8, 2.4, 0.8), sph(0.07, -0.19, -0.14, -0.05, 0x1c1420, 0.8, 2.4, 0.8),
  ],
  headset: () => [
    tor(0.232, 0.016, 0, 0.035, -0.015, 0xffffff, 0, 0),
    cyl(0.078, 0.078, 0.05, 0.23, 0.02, 0, 0xffffff, 0, Math.PI / 2), cyl(0.078, 0.078, 0.05, -0.23, 0.02, 0, 0xffffff, 0, Math.PI / 2),
    cyl(0.05, 0.05, 0.055, 0.233, 0.02, 0, 0xff6aa8, 0, Math.PI / 2, 0xff5aa0, 1.8), cyl(0.05, 0.05, 0.055, -0.233, 0.02, 0, 0xff6aa8, 0, Math.PI / 2, 0xff5aa0, 1.8),
    cone(0.05, 0.1, 0.1, 0.26, -0.01, 0xffffff, 0, -0.3), cone(0.05, 0.1, -0.1, 0.26, -0.01, 0xffffff, 0, 0.3),
    cone(0.026, 0.06, 0.1, 0.255, 0.018, 0xff8ac0, 0, -0.3), cone(0.026, 0.06, -0.1, 0.255, 0.018, 0xff8ac0, 0, 0.3),
    cyl(0.008, 0.008, 0.13, 0.15, -0.09, 0.12, 0x22242c, 1.0, -0.7), sph(0.014, 0.08, -0.13, 0.17, 0x22242c),
  ],
  hemgg: () => [cyl(0.13, 0.2, 0.22, 0, 0.03, 0, 0xff6aa8), tor(0.2, 0.012, 0, -0.08, 0, 0xffffff)],
};
// Where each attaches when it isn't on the head.
export const GEAR_AT = { hemgg: 'hips' };

// ---------------------------------------------------------------- palette and building
const PAL = [];
function swatch(hex) {
  let i = PAL.indexOf(hex);
  if (i < 0) { i = PAL.length; PAL.push(hex); }
  return [((i % 16) + 0.5) / 16, 1 - (Math.floor(i / 16) + 0.5) / 16];
}

const PARTS = new Map();
export const gearParts = (id) => { if (!PARTS.has(id)) PARTS.set(id, GEAR[id] ? GEAR[id]() : []); return PARTS.get(id); };

let MAT = null;
// The phone gets the palette once, so all of it must exist before the first hat is shown.
export function gearMat() {
  if (MAT) return MAT;
  for (const id of Object.keys(GEAR)) for (const p of gearParts(id)) swatch(p.c);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  PAL.forEach((hex, i) => { g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.fillRect((i % 16) * 16, Math.floor(i / 16) * 16, 16, 16); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  MAT = panelMat(0xffffff, { map: tex, roughness: 0.62, metalness: 0.05, pattern: 0, side: THREE.DoubleSide });
  return MAT;
}

const GEOS = new Map();
export function gearGeo(id) {
  if (GEOS.has(id)) return GEOS.get(id);
  gearMat();
  const pos = [], nor = [], uvs = [], glo = [], col = new THREE.Color();
  for (const p of gearParts(id)) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m), a = g.attributes.position.array, n = g.attributes.normal.array, [u, v] = swatch(p.c);
    if (p.glow) col.setHex(p.glow).multiplyScalar(p.gk || 1); else col.setRGB(0, 0, 0);
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); uvs.push(u, v); glo.push(col.r, col.g, col.b);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  g.computeBoundingSphere();
  GEOS.set(id, g);
  return g;
}

// Flat triangles for the shop's little pictures: [ax, ay, bx, by, cx, cy, depth, r, g, b] sorted back to front.
const _v = new THREE.Vector3(), _e = new THREE.Euler(-0.18, -0.55, 0);
export function gearTris(id) {
  const out = [], rot = new THREE.Matrix4().makeRotationFromEuler(_e), col = new THREE.Color();
  for (const p of gearParts(id)) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m), a = g.attributes.position.array;
    col.setHex(p.c);
    for (let i = 0; i < a.length; i += 9) {
      const t = [];
      for (let k = 0; k < 3; k++) { _v.set(a[i + k * 3], a[i + k * 3 + 1], a[i + k * 3 + 2]).applyMatrix4(rot); t.push(_v.x, _v.y, _v.z); }
      const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (nz < 0) continue; // faces away
      const lit = 0.55 + 0.45 * Math.max(0, nx * -0.3 + ny * 0.6 + nz * 0.74);
      out.push([t[0], t[1], t[3], t[4], t[6], t[7], (t[2] + t[5] + t[8]) / 3, (p.c >> 16 & 255) * lit, (p.c >> 8 & 255) * lit, (p.c & 255) * lit]);
    }
    g.dispose();
  }
  out.sort((a, b) => a[6] - b[6]);
  return out;
}
