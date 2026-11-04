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

const spikes = (n, r, y, h, c, glow, gk, w = 0.04) => {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(cone(w, h, Math.sin(a) * r, y, Math.cos(a) * r, c, Math.cos(a) * 0.35, -Math.sin(a) * 0.35, glow, gk)); }
  return out;
};

// Hats sit on a slant, like real ones: high over the forehead so the eyes stay clear, lower at the back of the head. Each
// is drawn upright and then tipped back. fit(r, front, back) cuts a ball of radius r round the head's centre so the cut is
// at height front over the forehead and at height back behind: e is the cut's height and w its radius, both upright.
const fit = (r, yf, yb) => { const a = Math.acos(yf / r), b = Math.acos(yb / r), th = (a + b) / 2; return { r, th, a: (a - b) / 2, e: r * Math.cos(th), w: r * Math.sin(th) }; };
const tip = (f, parts) => { const R = new THREE.Matrix4().makeRotationX(f.a); return parts.flat().map((p) => Object.assign({}, p, { m: R.clone().multiply(p.m) })); };
// The top of the hat: the ball above the cut, taller with sy.
const shell = (f, c, sy = 1, glow, gk) => part(new THREE.SphereGeometry(f.r, 26, 10, 0, Math.PI * 2, 0, f.th), M(0, f.e * (1 - sy), 0, 1, sy, 1), c, glow, gk);
// A ring round the ball, u above the cut and o further out.
const rim = (f, t, c, u = 0, o = 0, glow, gk) => tor(Math.sqrt(f.r * f.r - (f.e + u) ** 2) + o, t, 0, f.e + u, 0, c, Math.PI / 2, 0, glow, gk);
// A band hugging the ball from the cut up by h, t thick.
const cuff = (f, h, t, c, u = 0) => { const y0 = f.e + u, at = (y) => Math.sqrt(Math.max(0, f.r * f.r - y * y)) + t; return part(new THREE.CylinderGeometry(at(y0 + h), at(y0), h, 28, 1, true), M(0, y0 + h / 2, 0), c); };
// A brim round the cut out to radius R: flat, or rising by lift towards its edge (falling when lift is below 0).
const brim = (f, R, c, lift = 0, t = 0.018) => lift ? part(new THREE.CylinderGeometry(lift > 0 ? R : f.w, lift > 0 ? f.w : R, Math.abs(lift), 30, 1, true), M(0, f.e + lift / 2, 0), c) : part(new THREE.CylinderGeometry(R, R, t, 30), M(0, f.e - t / 2, 0), c);
// The peak of a cap: out L past the forehead and W wide, hanging down a little.
const peak = (f, L, W, c, droop = 0.14, span = 0.9) => part(new THREE.CylinderGeometry(1, 1, 0.016, 22, 1, false, -span, span * 2),
  new THREE.Matrix4().makeTranslation(0, f.e - 0.008, f.w).multiply(new THREE.Matrix4().makeRotationX(droop - f.a)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -f.w)).multiply(new THREE.Matrix4().makeScale(W, 1, f.w + L)), c);
// An arch over the top of the head from side to side (or from front to back with fb), from angle a0 to a1 (0 is the right
// side or the back, PI the left side or the front), so no band ever runs under the chin.
const over = (R, t, a0, a1, c, z = 0, fb = false, glow, gk) => part(new THREE.TorusGeometry(R, t, 8, 30, a1 - a0), M(0, 0, z, 1, 1, 1, 0, fb ? Math.PI / 2 : 0, a0), c, glow, gk);
// A piece of a ball: phi round the head (PI/2 is the front), theta down from the top.
const ball = (r, p0, pl, t0, tl, c, y = 0, glow, gk) => part(new THREE.SphereGeometry(r, 28, 12, p0, pl, t0, tl), M(0, y, 0), c, glow, gk);

const band = (c) => { const f = fit(0.2, 0.112, 0.045); return tip(f, [cuff(f, 0.04, 0.012, c), rim(f, 0.012, c, 0.0, 0.012), rim(f, 0.012, c, 0.04, 0.012), sph(0.026, 0, f.e + 0.02, -f.w - 0.016, c, 1, 0.8, 0.7),
  box(0.03, 0.11, 0.012, 0.03, f.e - 0.035, -f.w - 0.04, c, 0.35, 0, -0.35), box(0.03, 0.11, 0.012, -0.03, f.e - 0.035, -f.w - 0.04, c, 0.35, 0, 0.35)]); };
const CAP = fit(0.212, 0.125, -0.01);
const cap = (c, peakC, rimC = peakC) => tip(CAP, [shell(CAP, c), rim(CAP, 0.009, rimC), peak(CAP, 0.13, 0.2, peakC)]);

export const GEAR = {
  cap: () => [...cap(0xd82a2a, 0xb01a1a), ...tip(CAP, [sph(0.02, 0, CAP.r, 0, 0xffffff)])],
  beanie: () => { const f = fit(0.214, 0.13, -0.02); return tip(f, [shell(f, 0x2a5ad8, 1.14), cuff(f, 0.05, 0.014, 0xe8e8f0), rim(f, 0.014, 0xe8e8f0, 0.003, 0.006), sph(0.05, 0, f.e * (1 - 1.14) + f.r * 1.14 + 0.035, 0, 0xffffff)]); },
  band_red: () => band(0xd82a2a),
  band_blue: () => band(0x2a6ad8),
  bucket: () => { const f = fit(0.212, 0.14, 0.02); return tip(f, [shell(f, 0xd8c79a, 0.92), brim(f, f.w + 0.085, 0xc8b78a, -0.035), tor(f.w + 0.085, 0.01, 0, f.e - 0.035, 0, 0xc8b78a), rim(f, 0.012, 0xb8a77a, 0.006)]); },
  cowboy: () => { const f = fit(0.205, 0.135, 0.05); return tip(f, [shell(f, 0x8a5a2a, 1.45), rim(f, 0.018, 0x3a2412, 0.014, 0.004), brim(f, 0.35, 0x8a5a2a, 0.035), brim(f, f.w + 0.02, 0x8a5a2a), tor(0.35, 0.016, 0, f.e + 0.035, 0, 0x7a4a1e)]); },
  tophat: () => { const f = fit(0.2, 0.15, 0.08); return tip(f, [part(new THREE.CylinderGeometry(0.175, 0.17, 0.3, 26), M(0, f.e + 0.15, 0), 0x14161c), part(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 30), M(0, f.e, 0), 0x14161c), part(new THREE.CylinderGeometry(0.173, 0.172, 0.055, 26, 1, true), M(0, f.e + 0.04, 0, 1.012, 1, 1.012), 0xc01a2a)]); },
  party: () => [cone(0.13, 0.36, 0, 0.32, 0, 0xff4fb4), sph(0.04, 0, 0.5, 0, 0xffe14a), tor(0.1, 0.012, 0, 0.26, 0, 0x4f8bff), tor(0.06, 0.012, 0, 0.36, 0, 0xb6ff4a)],
  viking: () => { const f = fit(0.214, 0.125, -0.02); return [...tip(f, [shell(f, 0x8a96a8), rim(f, 0.022, 0x6a4a22, 0.004), over(f.r + 0.004, 0.014, Math.PI / 2 - f.th, Math.PI / 2 + f.th, 0x6a4a22, 0, true),
    cone(0.05, 0.22, 0.235, f.e + 0.12, 0, 0xf0ead8, 0, -0.75), cone(0.05, 0.22, -0.235, f.e + 0.12, 0, 0xf0ead8, 0, 0.75)]), box(0.026, 0.075, 0.014, 0, 0.088, 0.198, 0x6a4a22, -0.28)]; },
  chef: () => { const f = fit(0.205, 0.13, 0.05); return tip(f, [part(new THREE.CylinderGeometry(f.w + 0.03, f.w + 0.014, 0.13, 28), M(0, f.e + 0.065, 0), 0xfafafa), sph(0.12, -0.09, f.e + 0.17, 0, 0xffffff), sph(0.12, 0.09, f.e + 0.17, 0, 0xffffff), sph(0.12, 0, f.e + 0.19, 0.08, 0xffffff), sph(0.12, 0, f.e + 0.19, -0.08, 0xffffff), sph(0.11, 0, f.e + 0.23, 0, 0xffffff)]); },
  santa: () => { const f = fit(0.212, 0.135, 0.0); return tip(f, [shell(f, 0xc81e1e), cone(0.19, 0.34, 0, f.e + 0.15, -0.04, 0xc81e1e, -0.35), rim(f, 0.042, 0xfafafa, 0.012, 0.012), sph(0.055, 0, f.e + 0.33, -0.115, 0xfafafa)]); },
  pirate: () => { const f = fit(0.212, 0.13, 0.0); return tip(f, [shell(f, 0x14161c, 1.1), brim(f, 0.33, 0x14161c, 0.1), brim(f, f.w + 0.01, 0x14161c), tor(0.33, 0.012, 0, f.e + 0.1, 0, 0xd8b040), sph(0.04, 0, f.e + 0.06, 0.29, 0xf0ead8, 1, 1, 0.6), box(0.1, 0.014, 0.01, 0, f.e + 0.015, 0.285, 0xf0ead8, 0, 0, 0.6), box(0.1, 0.014, 0.01, 0, f.e + 0.015, 0.285, 0xf0ead8, 0, 0, -0.6)]); },
  propeller: () => [...cap(0x4f8bff, 0xffe14a), cyl(0.012, 0.012, 0.08, 0, 0.245, 0, 0x3a3a3a), box(0.38, 0.012, 0.05, 0, 0.285, 0, 0xff5050, 0, 0.4), box(0.05, 0.012, 0.38, 0, 0.287, 0, 0xb6ff4a, 0, 0.4), sph(0.02, 0, 0.295, 0, 0xffe14a)],
  bunny: () => [cyl(0.05, 0.04, 0.34, 0.09, 0.36, -0.02, 0xfafafa, 0, -0.14), cyl(0.05, 0.04, 0.34, -0.09, 0.36, -0.02, 0xfafafa, 0, 0.14), cyl(0.028, 0.022, 0.25, 0.092, 0.36, 0.018, 0xffb0c8, 0, -0.14), cyl(0.028, 0.022, 0.25, -0.092, 0.36, 0.018, 0xffb0c8, 0, 0.14), over(0.212, 0.012, 0.15, Math.PI - 0.15, 0x3a3a48, -0.02)],
  catears: () => [cone(0.075, 0.14, 0.12, 0.2, 0, 0x1e1e26, 0, -0.35), cone(0.075, 0.14, -0.12, 0.2, 0, 0x1e1e26, 0, 0.35), cone(0.04, 0.09, 0.122, 0.195, 0.03, 0xff8ab0, 0, -0.35), cone(0.04, 0.09, -0.122, 0.195, 0.03, 0xff8ab0, 0, 0.35)],
  phones: () => [over(0.226, 0.018, 0.22, Math.PI - 0.22, 0x22242c), cyl(0.08, 0.08, 0.06, 0.215, 0, 0, 0x22242c, 0, Math.PI / 2), cyl(0.08, 0.08, 0.06, -0.215, 0, 0, 0x22242c, 0, Math.PI / 2), cyl(0.05, 0.05, 0.065, 0.218, 0, 0, 0x3ff0d0, 0, Math.PI / 2, 0x3ff0d0, 1.2), cyl(0.05, 0.05, 0.065, -0.218, 0, 0, 0x3ff0d0, 0, Math.PI / 2, 0x3ff0d0, 1.2)],
  mohawk: () => [0, 1, 2, 3, 4, 5, 6].map((i) => { const a = -0.9 + i * 0.42; return cone(0.05, 0.2, 0, Math.cos(a) * 0.25, -Math.sin(a) * 0.25, 0xff2ad8, -a); }),
  afro: () => [sph(0.3, 0, 0.2, -0.1, 0x2a1a10), sph(0.19, 0.18, 0.1, -0.09, 0x2a1a10), sph(0.19, -0.18, 0.1, -0.09, 0x2a1a10), sph(0.15, 0, 0.19, 0.05, 0x2a1a10, 1.3, 0.6, 1)],
  grad: () => [...tip(CAP, [shell(CAP, 0x14161c), rim(CAP, 0.008, 0x0c0d12)]), box(0.46, 0.022, 0.46, 0, 0.222, 0, 0x14161c, 0, 0.78), cyl(0.008, 0.008, 0.16, 0.22, 0.15, 0.05, 0xffd24a), sph(0.022, 0.22, 0.065, 0.05, 0xffd24a, 1, 1.4, 1), sph(0.02, 0, 0.236, 0, 0xffd24a)],
  police: () => { const f = CAP; return tip(f, [shell(f, 0x101828), cuff(f, 0.05, 0.012, 0x101828), sph(0.235, 0, f.e + 0.09, 0.005, 0x16245c, 1, 0.4, 1), peak(f, 0.12, 0.19, 0x0c0d12, 0.22), box(0.05, 0.05, 0.015, 0, f.e + 0.075, f.w + 0.02, 0xffd24a, -0.25)]); },
  sombrero: () => { const f = fit(0.205, 0.14, 0.07); return tip(f, [part(new THREE.CylinderGeometry(0.09, f.w + 0.012, 0.25, 26), M(0, f.e + 0.125, 0), 0xc8983a), brim(f, 0.44, 0xc8983a, 0.03), brim(f, f.w + 0.03, 0xc8983a), tor(0.44, 0.024, 0, f.e + 0.03, 0, 0xc01a2a), tor(f.w + 0.006, 0.018, 0, f.e + 0.03, 0, 0x2a8a3a), tor(0.3, 0.012, 0, f.e + 0.012, 0, 0x2a8a3a)]); },
  firehelm: () => { const f = fit(0.214, 0.13, -0.01); return tip(f, [shell(f, 0xc81e1e, 1.06), rim(f, 0.012, 0xa01414, 0.004), part(new THREE.CylinderGeometry(0.27, 0.28, 0.02, 30), M(0, f.e - 0.01, -0.05, 1, 1, 1.05), 0xc81e1e), over(f.r * 1.03, 0.016, Math.PI / 2 - f.th, Math.PI / 2 + f.th, 0xc81e1e, 0, true), box(0.1, 0.1, 0.014, 0, f.e + 0.075, f.w - 0.004, 0xffd24a, -0.42)]); },
  beret: () => { const f = fit(0.212, 0.135, 0.02); return tip(f, [shell(f, 0x8a1a2a), rim(f, 0.012, 0x6a1020, 0.004), sph(0.235, 0.025, f.e + 0.075, 0, 0x8a1a2a, 1.06, 0.36, 1.04), sph(0.016, 0.025, f.e + 0.165, 0, 0x8a1a2a)]); },
  crown: () => [cyl(0.19, 0.17, 0.09, 0, 0.17, 0, 0xffc830), ...spikes(8, 0.175, 0.255, 0.1, 0xffc830, 0, 0, 0.035), sph(0.022, 0, 0.17, 0.18, 0xe02040, 1, 1, 1, 0xe02040, 1.5), sph(0.022, 0.18, 0.17, 0, 0x3060ff, 1, 1, 1, 0x3060ff, 1.5), sph(0.022, -0.18, 0.17, 0, 0x30d060, 1, 1, 1, 0x30d060, 1.5)],
  wizard: () => { const f = fit(0.205, 0.14, 0.06); return tip(f, [brim(f, 0.33, 0x2a1a7a, 0.012), brim(f, f.w + 0.02, 0x2a1a7a), cone(f.w + 0.012, 0.5, 0, f.e + 0.25, -0.03, 0x2a1a7a, -0.12), tor(f.w + 0.004, 0.016, 0, f.e + 0.03, 0, 0xffd24a), sph(0.03, 0, f.e + 0.32, 0.11, 0xffd24a, 1, 1, 1, 0xffd24a, 1.4)]); },
  // Open at the front, so the face shows: a brow band, a thin nose guard between the eyes, cheek plates.
  knight: () => { const r = 0.222, t0 = Math.acos(0.125 / r), t1 = Math.acos(-0.11 / r), o = 0.22 * Math.PI; return [ball(r, 0, Math.PI * 2, 0, t0, 0xa8b2c0), ball(r, Math.PI / 2 + o, Math.PI * 2 - 2 * o, t0, t1 - t0, 0xa8b2c0),
    tor(Math.sqrt(r * r - 0.125 * 0.125) + 0.004, 0.016, 0, 0.125, 0, 0x8a94a4), box(0.024, 0.075, 0.014, 0, 0.088, 0.21, 0x8a94a4, -0.28), over(r + 0.004, 0.014, 0.1, Math.PI - 0.1, 0x8a94a4, 0, true), cone(0.03, 0.2, 0, 0.3, -0.02, 0xc02a2a), box(0.03, 0.14, 0.2, 0, 0.26, -0.06, 0xc02a2a)]; },
  halo: () => [tor(0.19, 0.022, 0, 0.32, 0, 0xfff4b0, Math.PI / 2, 0, 0xffe88a, 2.4)],
  devil: () => [cone(0.05, 0.2, 0.14, 0.21, 0.02, 0xc01a1a, 0, -0.45, 0xc01a1a, 0.5), cone(0.05, 0.2, -0.14, 0.21, 0.02, 0xc01a1a, 0, 0.45, 0xc01a1a, 0.5)],
  antenna: () => [cyl(0.01, 0.01, 0.2, 0.09, 0.27, 0, 0x8a96a8, 0, -0.25), cyl(0.01, 0.01, 0.2, -0.09, 0.27, 0, 0x8a96a8, 0, 0.25), sph(0.035, 0.117, 0.375, 0, 0x40e8ff, 1, 1, 1, 0x40e8ff, 2), sph(0.035, -0.117, 0.375, 0, 0xff5050, 1, 1, 1, 0xff5050, 2)],
  samurai: () => { const f = fit(0.216, 0.125, 0.0), o = 0.32 * Math.PI; return [...tip(f, [shell(f, 0x1a1a22), rim(f, 0.014, 0x8a1a1a, 0.004),
    part(new THREE.CylinderGeometry(f.w + 0.008, 0.29, 0.08, 28, 1, true, o, Math.PI * 2 - 2 * o), M(0, f.e - 0.04, 0), 0x1a1a22), part(new THREE.CylinderGeometry(0.28, 0.335, 0.07, 28, 1, true, o, Math.PI * 2 - 2 * o), M(0, f.e - 0.1, 0), 0x22222c)]),
    box(0.045, 0.22, 0.012, 0.085, 0.27, 0.16, 0xd8b040, 0, 0, -0.45), box(0.045, 0.22, 0.012, -0.085, 0.27, 0.16, 0xd8b040, 0, 0, 0.45), sph(0.03, 0, 0.152, 0.17, 0xc01a2a)]; },
  // A space helmet with its visor pushed up and the front open, so the face shows.
  astro: () => { const r = 0.255, t0 = Math.acos(0.15 / r), t1 = Math.acos(-0.15 / r), t2 = Math.PI * 0.8, o = 0.3 * Math.PI; return [ball(r, 0, Math.PI * 2, 0, t0, 0xeef0f4), ball(r, Math.PI / 2 + o, Math.PI * 2 - 2 * o, t0, t1 - t0, 0xeef0f4), ball(r, 0, Math.PI * 2, t1, t2 - t1, 0xeef0f4),
    ball(r + 0.008, Math.PI / 2 - o - 0.04, 2 * o + 0.08, 0.32, t0 - 0.3, 0x1c2430), tor(r * Math.sin(t2) + 0.004, 0.03, 0, r * Math.cos(t2), 0, 0xc8ccd4), box(0.05, 0.06, 0.03, 0.242, 0.06, 0.07, 0xe0702a, 0, 1.29)]; },
  shroom: () => { const f = fit(0.212, 0.13, 0.04); return tip(f, [part(new THREE.SphereGeometry(0.3, 26, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0, f.e, 0, 1, 0.62, 1), 0xd82a2a), part(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 30), M(0, f.e, 0), 0xf0e0c8),
    sph(0.05, 0.14, f.e + 0.15, 0.07, 0xfafafa), sph(0.045, -0.13, f.e + 0.15, 0.1, 0xfafafa), sph(0.05, 0, f.e + 0.17, -0.13, 0xfafafa), sph(0.04, 0.23, f.e + 0.08, -0.05, 0xfafafa), sph(0.04, -0.22, f.e + 0.08, -0.07, 0xfafafa), sph(0.035, 0.05, f.e + 0.18, 0.0, 0xfafafa)]); },
  flowers: () => { const f = fit(0.2, 0.13, 0.06), R = f.w + 0.012, out = [tor(R, 0.014, 0, f.e, 0, 0x3a8a3a)], c = [0xff7ab0, 0xffe14a, 0xffffff, 0xff5a5a, 0xa66bff, 0x6ac8ff]; for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; out.push(sph(0.042, Math.sin(a) * (R + 0.006), f.e + 0.005, Math.cos(a) * (R + 0.006), c[i % 6])); out.push(sph(0.016, Math.sin(a) * (R + 0.022), f.e + 0.015, Math.cos(a) * (R + 0.022), 0xffd24a)); } return tip(f, out); },
  // Legendary extras: lit from inside.
  l_crown: () => [cyl(0.2, 0.17, 0.11, 0, 0.17, 0, 0xffd24a, 0, 0, 0xffa020, 1.2), ...spikes(8, 0.18, 0.28, 0.17, 0xfff0a0, 0xffc040, 2.6, 0.04), sph(0.03, 0, 0.17, 0.19, 0xff2040, 1, 1, 1, 0xff2040, 3)],
  bolt: () => { const out = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; out.push(box(0.03, 0.2, 0.012, Math.sin(a) * 0.26, 0.2, Math.cos(a) * 0.26, 0xdfffff, 0, a, 0.5, 0x7fd8ff, 3)); } return out; },
  sunrays: () => spikes(12, 0.22, 0.2, 0.2, 0xffe88a, 0xffc040, 2.6, 0.03),
  antlers: () => { const out = []; for (const s of [-1, 1]) { out.push(cyl(0.016, 0.022, 0.28, s * 0.14, 0.28, 0, 0xc0ff70, 0, -s * 0.4, 0xc0ff70, 1.2)); out.push(cyl(0.012, 0.016, 0.13, s * 0.2, 0.32, 0.05, 0xc0ff70, 0.6, -s * 0.5, 0xc0ff70, 1.2)); out.push(cyl(0.012, 0.016, 0.12, s * 0.13, 0.3, 0.05, 0xc0ff70, 0.6, s * 0.5, 0xc0ff70, 1.2)); } return out; },
  flames: () => { const out = []; for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, h = 0.2 + (i % 3) * 0.1; out.push(cone(0.06, h, Math.sin(a) * 0.15, 0.17 + h / 2, Math.cos(a) * 0.15, 0xffc040, 0, 0, 0xff6a10, 3)); } out.push(cone(0.08, 0.44, 0, 0.36, 0, 0xfff060, 0, 0, 0xffa020, 3.2)); return out; },
  // Owner extras. The Hacker's hood: open at the front so the eyes show, two rings of light round the face, a mask over the
  // mouth with slits of light, code lines glowing over it with nodes where they end, a port with a ring of light on each
  // side and an aerial. hood_halo (zeros and ones going round the head) and hood_crown (shards of light turning the other
  // way above it) go with it.
  hood: () => {
    const ink = 0x070b09, dim = 0x0a5a24, G = 0x20ff60, hot = 0x8dffb4, R = 0.25, cy = 0.015, cz = -0.012, out = [
      part(new THREE.SphereGeometry(0.245, 22, 14, Math.PI * 0.86, Math.PI * 1.28, 0, Math.PI * 0.82), M(0, cy, cz), ink),
      cone(0.1, 0.16, 0, 0.18, -0.2, ink, -1.0),
      tor(0.205, 0.011, 0, -0.005, 0.04, dim, 0.25, 0, G, 1.8, 1, 1.05),
      tor(0.223, 0.0045, 0, -0.005, 0.03, dim, 0.25, 0, hot, 2.4, 1, 1.05),
      ball(0.209, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.62, Math.PI * 0.27, 0x0b120e),
    ];
    // Code lines from the back of the neck over the top, and across the back of the head, each ending in a node.
    for (const x of [-0.16, -0.08, 0.08, 0.16]) {
      const r = Math.sqrt(R * R - x * x), a0 = -0.35, a1 = Math.PI / 2 + 0.12;
      out.push(part(new THREE.TorusGeometry(r, 0.0045, 5, 26, a1 - a0), M(x, cy, cz, 1, 1, 1, 0, Math.PI / 2, a0), dim, G, 1.3));
      out.push(sph(0.013, x, cy + r * Math.sin(a0), cz - r * Math.cos(a0), hot, 1, 1, 1, G, 3.4));
    }
    for (const z of [-0.07, -0.15]) {
      const r = Math.sqrt(R * R - z * z);
      out.push(part(new THREE.TorusGeometry(r, 0.004, 5, 26, Math.PI - 0.5), M(0, cy, cz + z, 1, 1, 1, 0, 0, 0.25), dim, G, 1.2));
    }
    // The mask's slits.
    for (const x of [-0.07, -0.035, 0, 0.035, 0.07]) {
      const y = -0.12, z = Math.sqrt(0.212 * 0.212 - x * x - y * y);
      out.push(box(0.011, 0.055, 0.008, x, y, z, hot, -Math.asin(y / 0.212), Math.atan2(x, z), 0, G, 2.3));
    }
    // A port on each side with a ring of light, and an aerial on the right with a light at its tip.
    for (const s of [-1, 1]) {
      out.push(cyl(0.058, 0.064, 0.05, s * 0.245, 0, -0.03, ink, 0, Math.PI / 2));
      out.push(tor(0.05, 0.008, s * 0.272, 0, -0.03, dim, 0, Math.PI / 2, G, 3.2));
      out.push(sph(0.018, s * 0.276, 0, -0.03, hot, 1, 1, 1, G, 3.6));
    }
    out.push(cyl(0.006, 0.009, 0.24, 0.27, 0.13, -0.07, ink, -0.35, -0.3), sph(0.022, 0.3055, 0.2377, -0.1093, hot, 1, 1, 1, G, 4));
    return out;
  },
  hood_halo: () => {
    const R = 0.37, tilt = 0.14, y0 = 0.03, hot = 0x9dffc0, G = 0x40ff70, dim = 0x0a5a24, out = [tor(R, 0.0035, 0, y0, 0, dim, Math.PI / 2 + tilt, 0, G, 2.6)];
    const bits = '01101001110100';
    for (let i = 0; i < bits.length; i++) {
      const a = (i / bits.length) * Math.PI * 2, x = Math.sin(a) * R, z = Math.cos(a) * R * Math.cos(tilt), y = y0 - Math.cos(a) * R * Math.sin(tilt);
      out.push(bits[i] === '1' ? box(0.016, 0.07, 0.01, x, y, z, hot, 0, a, 0, G, 3.2) : tor(0.025, 0.0075, x, y, z, hot, 0, a, G, 3.2, 0.72, 1));
    }
    const R2 = 0.44, t2 = -0.32;
    out.push(tor(R2, 0.003, 0, 0, 0, dim, Math.PI / 2 + t2, 0, G, 2.2));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3, x = Math.sin(a) * R2, z = Math.cos(a) * R2 * Math.cos(t2), y = -Math.cos(a) * R2 * Math.sin(t2);
      out.push(box(0.022, 0.022, 0.022, x, y, z, hot, a, a * 1.7, 0, G, 3));
    }
    return out;
  },
  hood_crown: () => {
    const hot = 0xc8ffd8, G = 0x40ff70, out = [tor(0.2, 0.003, 0, 0.36, 0, 0x0a5a24, Math.PI / 2, 0, G, 2.4)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push(part(new THREE.OctahedronGeometry(0.03, 0), M(Math.sin(a) * 0.2, 0.36 + (i % 2) * 0.03, Math.cos(a) * 0.2, 0.8, 2.2, 0.8, 0, a - Math.PI / 2, -0.35), hot, G, 3.4));
    }
    out.push(part(new THREE.OctahedronGeometry(0.045, 0), M(0, 0.44, 0, 1, 1.6, 1), hot, G, 4));
    return out;
  },
  // ShortGG: dark hair with a soft fringe and two buns, a pink gaming headset with little ears.
  hairgg: () => [
    part(new THREE.SphereGeometry(0.214, 18, 12, Math.PI * 0.92, Math.PI * 1.16, 0, Math.PI * 0.72), M(0, 0.005, -0.01), 0x1c1420),
    sph(0.11, 0, 0.13, 0.12, 0x1c1420, 1.75, 0.5, 0.62),
    sph(0.055, -0.15, 0.09, 0.14, 0x1c1420, 0.8, 1.15, 0.6), sph(0.055, 0.15, 0.09, 0.14, 0x1c1420, 0.8, 1.15, 0.6),
    sph(0.085, 0.15, 0.21, -0.06, 0x241a2a), sph(0.085, -0.15, 0.21, -0.06, 0x241a2a),
    sph(0.07, 0.19, -0.14, -0.05, 0x1c1420, 0.8, 2.4, 0.8), sph(0.07, -0.19, -0.14, -0.05, 0x1c1420, 0.8, 2.4, 0.8),
  ],
  headset: () => [
    over(0.236, 0.016, 0.12, Math.PI - 0.12, 0xffffff, -0.015),
    cyl(0.078, 0.078, 0.05, 0.23, 0.02, 0, 0xffffff, 0, Math.PI / 2), cyl(0.078, 0.078, 0.05, -0.23, 0.02, 0, 0xffffff, 0, Math.PI / 2),
    cyl(0.05, 0.05, 0.055, 0.233, 0.02, 0, 0xff6aa8, 0, Math.PI / 2, 0xff5aa0, 1.8), cyl(0.05, 0.05, 0.055, -0.233, 0.02, 0, 0xff6aa8, 0, Math.PI / 2, 0xff5aa0, 1.8),
    cone(0.05, 0.1, 0.1, 0.26, -0.01, 0xffffff, 0, -0.3), cone(0.05, 0.1, -0.1, 0.26, -0.01, 0xffffff, 0, 0.3),
    cone(0.026, 0.06, 0.1, 0.255, 0.018, 0xff8ac0, 0, -0.3), cone(0.026, 0.06, -0.1, 0.255, 0.018, 0xff8ac0, 0, 0.3),
    cyl(0.008, 0.008, 0.13, 0.15, -0.09, 0.12, 0x22242c, 1.0, -0.7), sph(0.014, 0.08, -0.13, 0.17, 0x22242c),
  ],
  hemgg: () => [cyl(0.13, 0.2, 0.22, 0, 0.03, 0, 0xff6aa8), tor(0.2, 0.012, 0, -0.08, 0, 0xffffff)],
};
// Where each attaches when it isn't on the head: the hips, the back or the chest (both in the torso's own space, from the hips
// up), a tail (on the hips, behind) or a pair of wings on the shoulder blades. Some move by themselves.
// ---------------------------------------------------------------- hair
// Hair comes in two layers. The first stays on under a hat: close to the head over the top, and anything that hangs below
// where hats end (a fringe, a bob, a ponytail, long hair down the back). The second (id + '_top') is what a hat hides: buns,
// spikes, curls and the fuller top. With hair on, the hat grows by HAT_ON_HAIR, so it sits on the hair and none of the first
// layer can poke through it.
export const HAT_ON_HAIR = 1.08;
// The hair on the head: over the top down to the forehead at height top, and round the sides and the back down to low,
// leaving the face open from temple to temple (o round from the front). Thin enough to stay under any hat.
const scalp = (c, top = 0.132, low = -0.09, o = 0.3 * Math.PI, r = 0.214, glow, gk) => {
  const t0 = Math.acos(top / r), t1 = Math.acos(low / r);
  return [ball(r, 0, Math.PI * 2, 0, t0, c, 0, glow, gk), ball(r, Math.PI / 2 + o, Math.PI * 2 - 2 * o, t0, t1 - t0, c, 0, glow, gk)];
};
// More hair on top: the same ball lifted by dy (and moved back by dz), so it grows out of the hair below without a step.
const puff = (c, dy, dz = 0, top = 0.14, r = 0.214, glow, gk) => part(new THREE.SphereGeometry(r, 26, 10, 0, Math.PI * 2, 0, Math.acos((top - dy) / r)), M(0, dy, dz), c, glow, gk);
const crownOf = (c, r = 0.226, yf = 0.165, yb = 0.0, glow, gk) => { const f = fit(r, yf, yb); return tip(f, [shell(f, c, 1, glow, gk)]); };
const lump = (r, x, y, z, c, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => part(new THREE.SphereGeometry(r, 12, 9), M(x, y, z, sx, sy, sz, rx, ry, rz), c);
// Something built along +y, set d from the head's centre, pointing out: th down from the top, ph round from the front.
const radial = (geo, th, ph, d, c, glow, gk) => {
  const v = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
  return part(geo, new THREE.Matrix4().compose(v.clone().multiplyScalar(d), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v), new THREE.Vector3(1, 1, 1)), c, glow, gk);
};
// Locks of a fringe on the forehead, from x0 to x1, their middles at heights y0 to y1: they lie on the skin, so they stay
// under a hat's edge.
const fringeOf = (c, n, x0, x1, y0, y1, size = 0.045) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0.5, x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k, z = Math.sqrt(Math.max(0, 0.199 * 0.199 - x * x - y * y));
    out.push(part(new THREE.SphereGeometry(size, 12, 8), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, y, z).normalize()), new THREE.Vector3(1.25, 0.85, 0.4)), c));
  }
  return out;
};
const spikesOn = (c, rows, glow, gk) => { const out = []; for (const [th, n, len, w, off] of rows) for (let i = 0; i < n; i++) out.push(radial(new THREE.ConeGeometry(w, len, 8), th, ((i + off) / n) * Math.PI * 2, 0.19 + len / 2, c, glow, gk)); return out; };
// A bob or long hair: the part of a ball below a slanted cut (which sits below every hat's edge), open over the face.
const hangOf = (c, r, yf, yb, depth, open) => { const f = fit(r, yf, yb); return tip(f, [part(new THREE.SphereGeometry(r, 26, 8, Math.PI / 2 + open, Math.PI * 2 - 2 * open, f.th, depth), M(0, 0, 0), c)]); };
const HAIRS = {
  hr_short: (c = 0x5a3a22) => [[...scalp(c, 0.135, -0.07), ...fringeOf(c, 4, -0.08, 0.08, 0.124, 0.124, 0.038)],
    [puff(c, 0.01, -0.004), lump(0.06, 0.0, 0.19, 0.095, c, 1.7, 0.6, 1.2, 0.5), lump(0.055, 0.03, 0.21, 0.04, c, 1.7, 0.55, 1.3, 0.3)]],
  hr_swoop: (c = 0x1c1c24) => [[...scalp(c), ...fringeOf(c, 5, -0.11, 0.12, 0.13, 0.098, 0.046)],
    [puff(c, 0.012, -0.004), lump(0.07, -0.05, 0.2, 0.075, c, 2.0, 0.55, 1.0, 0.45, 0.45, -0.2), lump(0.065, 0.06, 0.18, 0.12, c, 1.8, 0.55, 0.9, 0.55, 0.5, -0.45), lump(0.055, 0.13, 0.13, 0.13, c, 1.3, 0.6, 0.8, 0.3, 0.9, -0.85)]],
  hr_pony: (c = 0xc8541e) => [[...scalp(c), ...fringeOf(c, 4, -0.08, 0.08, 0.124, 0.124, 0.038), tor(0.028, 0.012, 0, -0.07, -0.214, 0x2a8ad8, 0, 0),
    sph(0.05, 0, -0.1, -0.245, c, 1, 1.15, 1), sph(0.047, 0, -0.17, -0.268, c, 0.95, 1.2, 0.95), sph(0.043, 0, -0.24, -0.276, c, 0.9, 1.25, 0.9), sph(0.037, 0, -0.31, -0.272, c, 0.85, 1.3, 0.85), cone(0.03, 0.08, 0, -0.37, -0.266, c, Math.PI)],
    [puff(c, 0.01, -0.004)]],
  hr_spiky: (c = 0xf2c84a) => [[...scalp(c)], [puff(c, 0.008), ...spikesOn(c, [[0.05, 1, 0.17, 0.05, 0], [0.4, 5, 0.17, 0.05, 0], [0.75, 7, 0.15, 0.045, 0.5]])]],
  hr_long: (c = 0x6a3418) => [[...scalp(c, 0.132, -0.1), ...fringeOf(c, 5, -0.1, 0.1, 0.122, 0.122, 0.04), ...hangOf(c, 0.222, 0.06, -0.05, 0.45, 0.3 * Math.PI),
    part(new THREE.CylinderGeometry(0.21, 0.2, 0.3, 22, 1, true, 0.4 * Math.PI, 1.2 * Math.PI), M(0, -0.2, -0.02), c), lump(0.05, 0.19, -0.11, 0.07, c, 0.6, 2.2, 0.75), lump(0.05, -0.19, -0.11, 0.07, c, 0.6, 2.2, 0.75)],
    [...crownOf(c, 0.228, 0.165, 0.0)]],
  hr_bob: (c = 0x7a4ac8) => [[...scalp(c), ...fringeOf(c, 6, -0.12, 0.12, 0.118, 0.118, 0.04), ...hangOf(c, 0.236, 0.11, -0.05, 0.62, 0.3 * Math.PI)],
    [...crownOf(c, 0.232, 0.16, 0.0)]],
  hr_buns: (c = 0xff7ab8) => [[...scalp(c), ...fringeOf(c, 4, -0.08, 0.08, 0.124, 0.124, 0.038)],
    [puff(c, 0.008), sph(0.085, 0.135, 0.205, -0.03, c), sph(0.085, -0.135, 0.205, -0.03, c), radial(new THREE.TorusGeometry(0.062, 0.013, 7, 22).rotateX(Math.PI / 2), 0.593, 1.789, 0.205, 0xffe14a), radial(new THREE.TorusGeometry(0.062, 0.013, 7, 22).rotateX(Math.PI / 2), 0.593, -1.789, 0.205, 0xffe14a)]],
  hr_curly: (c = 0x3a2414) => {
    const low = [], top = [];
    for (let i = 0; i < 9; i++) { const a = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9; low.push(sph(0.046, Math.sin(a) * 0.205, -0.07, Math.cos(a) * 0.205, c)); }
    for (const [th, n, off] of [[0, 1, 0], [0.42, 6, 0], [0.8, 9, 0.5], [1.15, 8, 0.25]]) for (let i = 0; i < n; i++) top.push(radial(new THREE.SphereGeometry(0.058, 10, 8), th, ((i + off) / n) * Math.PI * 2, 0.205, c));
    return [[...scalp(c, 0.132, -0.09, 0.3 * Math.PI, 0.216), ...fringeOf(c, 4, -0.09, 0.09, 0.124, 0.124, 0.042), ...low], top];
  },
  hr_braids: (c = 0xe8c060) => {
    const out = [];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) out.push(sph(0.034, s * (0.1 + k * 0.006) + (k % 2 ? 0.008 : -0.008) * s, -0.085 - k * 0.052, -0.2 - k * 0.006, c, 1, 1.15, 1));
      out.push(tor(0.024, 0.009, s * 0.136, -0.4, -0.236, 0x30c070, Math.PI / 2), cone(0.026, 0.07, s * 0.136, -0.445, -0.236, c, Math.PI));
    }
    return [[...scalp(c), ...fringeOf(c, 4, -0.08, 0.08, 0.124, 0.124, 0.038), ...out], [puff(c, 0.01, -0.004)]];
  },
  hr_neon: (c = 0x0c3a48) => [[...scalp(c, 0.132, -0.09, 0.3 * Math.PI, 0.214, 0x20c8e8, 0.6)], [puff(c, 0.008, 0, 0.14, 0.214, 0x20c8e8, 0.6), ...spikesOn(0x40f0ff, [[0.05, 1, 0.19, 0.05, 0], [0.4, 5, 0.19, 0.05, 0], [0.75, 7, 0.16, 0.045, 0.5]], 0x40f0ff, 2.2)]],
};
export const HAIR_TOP = {};
for (const [id, make] of Object.entries(HAIRS)) { GEAR[id] = () => make()[0]; GEAR[id + '_top'] = () => make()[1]; HAIR_TOP[id] = id + '_top'; }
// The owner's hair keeps its shell and long locks under a hat; the fringe, side locks and buns go.
{ const make = GEAR.hairgg; GEAR.hairgg = () => make().filter((p, i) => i === 0 || i > 5); GEAR.hairgg_top = () => make().filter((p, i) => i > 0 && i < 6); HAIR_TOP.hairgg = 'hairgg_top'; }
// What a hat does to hair: 'all' hides it (closed helmets, the hood), 'top' hides the top layer, and the few that sit
// around or beside the hair leave it.
const LEAVES = new Set(['band_red', 'band_blue', 'halo', 'devil', 'antenna', 'catears', 'bunny', 'antlers', 'bolt', 'sunrays', 'phones', 'none']);
export const coverOf = (id) => (id === 'knight' || id === 'astro' || id === 'hood' ? 'all' : LEAVES.has(id) || !id ? null : 'top');

export const GEAR_AT = { hemgg: 'hips' };
export const GEAR_ANIM = {};

// ---------------------------------------------------------------- the weapons
// A gun is built with its grip at the origin, its barrel along +z and its top along +y. fore is where the other hand goes,
// muzzle where the shot leaves, spin a part that turns while firing.
const HALF = Math.PI / 2;
const tb = (r, l, x, y, z, c, glow, gk, n = 10) => part(new THREE.CylinderGeometry(r, r, l, n), M(x, y, z, 1, 1, 1, HALF), c, glow, gk);
const tp = (r0, r1, l, x, y, z, c, glow, gk, n = 10) => part(new THREE.CylinderGeometry(r1, r0, l, n), M(x, y, z, 1, 1, 1, HALF), c, glow, gk);
const bx = (w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0, glow, gk) => box(w, h, d, x, y, z, c, rx, ry, rz, glow, gk);
const lit = (w, h, d, x, y, z, c, gk = 2.4, rx = 0, ry = 0, rz = 0) => box(w, h, d, x, y, z, c, rx, ry, rz, c, gk);
const ring = (R, r, x, y, z, c, glow, gk) => part(new THREE.TorusGeometry(R, r, 6, 18), M(x, y, z), c, glow, gk);
const orb = (r, x, y, z, c, gk = 3) => part(new THREE.SphereGeometry(r, 10, 8), M(x, y, z), c, c, gk);
const shard = (r, l, x, y, z, c, rx = 0, ry = 0, rz = 0, glow, gk) => part(new THREE.OctahedronGeometry(r, 0), M(x, y, z, 1, l, 1, rx, ry, rz), c, glow, gk);

const INK = 0x262a33, DARK = 0x363c48, STEEL = 0x5a6474, MID = 0x8893a3, PALE = 0xb8c2d0, WOOD = 0x6e4324, WOOD2 = 0x915c30, TAN = 0xb39468, OLIVE = 0x5f7048;
const grip = (c = DARK, t = 0.3) => [bx(0.044, 0.135, 0.06, 0, -0.065, -0.012, c, t), bx(0.012, 0.012, 0.055, 0, -0.012, 0.045, STEEL), bx(0.009, 0.04, 0.012, 0, -0.03, 0.03, STEEL, -0.3)];
const mag = (z, h, c = INK, t = 0.2, w = 0.038, d = 0.066) => bx(w, h, d, 0, -0.02 - h / 2, z, c, t);
const rail = (z, l, y = 0.066, c = INK) => [bx(0.026, 0.012, l, 0, y, z, c)];
const irons = (z0, z1, y = 0.07, c = INK) => [bx(0.022, 0.03, 0.012, 0, y + 0.015, z0, c), bx(0.008, 0.034, 0.012, 0, y + 0.017, z1, c)];
const brake = (r, z, c = INK) => [tb(r, 0.07, 0, 0.02, z, c), tb(r * 0.62, 0.012, 0, 0.02, z + 0.04, 0x050505)];
const scope = (l, y, z, c = INK, glass = 0x60d0ff, r = 0.03) => [tb(r * 0.72, l, 0, y, z, c), tp(r * 0.72, r * 1.25, l * 0.24, 0, y, z + l * 0.5, c), tp(r * 1.25, r * 0.72, l * 0.2, 0, y, z - l * 0.5, c),
  tb(r * 1.15, 0.006, 0, y, z + l * 0.62, glass, glass, 2.2), tb(r * 0.9, 0.006, 0, y, z - l * 0.6, glass, glass, 1.2), bx(0.022, y - 0.06, 0.03, 0, (y + 0.06) / 2, z + l * 0.28, INK), bx(0.022, y - 0.06, 0.03, 0, (y + 0.06) / 2, z - l * 0.28, INK), tb(0.012, 0.03, 0.038, y, z, c, 0, 0, 6)];
const reddot = (y, z, c = 0xff3040) => [bx(0.036, 0.034, 0.05, 0, y, z, INK), lit(0.024, 0.02, 0.006, 0, y + 0.002, z + 0.026, c, 2.6)];

const GUNS = {
  // ------------------------------------------- sidearms
  w_blaster: () => ({ fore: [0.012, -0.075, 0.0], muzzle: [0, 0.03, 0.27], p: [...grip(STEEL), bx(0.05, 0.075, 0.2, 0, 0.03, 0.06, STEEL), bx(0.052, 0.024, 0.2, 0, 0.078, 0.06, DARK), tb(0.021, 0.09, 0, 0.03, 0.2, DARK), ring(0.03, 0.007, 0, 0.03, 0.235, 0x60e0ff, 0x60e0ff, 2.4), lit(0.054, 0.01, 0.14, 0, 0.042, 0.065, 0x60e0ff, 2.2), bx(0.016, 0.02, 0.016, 0, 0.098, 0.135, INK), bx(0.02, 0.018, 0.016, 0, 0.098, -0.02, INK)] }),
  w_scout: () => ({ fore: [0.012, -0.075, 0.0], muzzle: [0, 0.042, 0.215], p: [...grip(INK), bx(0.042, 0.03, 0.22, 0, 0.012, 0.075, DARK), bx(0.046, 0.042, 0.23, 0, 0.044, 0.08, MID), tb(0.012, 0.02, 0, 0.042, 0.2, INK), ...irons(-0.02, 0.17, 0.062), ...[0, 1, 2, 3].map((i) => bx(0.048, 0.03, 0.005, 0, 0.044, -0.02 + i * 0.012, INK))] }),
  w_revolver: () => ({ fore: [0.012, -0.08, 0.0], muzzle: [0, 0.052, 0.3], p: [bx(0.044, 0.14, 0.062, 0, -0.065, -0.018, WOOD2, 0.35), bx(0.012, 0.012, 0.055, 0, -0.012, 0.045, STEEL), bx(0.04, 0.078, 0.11, 0, 0.03, 0.03, STEEL), tb(0.047, 0.07, 0, 0.03, 0.05, MID, 0, 0, 7), ...[0, 1, 2, 3, 4, 5].map((i) => tb(0.011, 0.074, Math.cos(i * 1.047) * 0.03, 0.03 + Math.sin(i * 1.047) * 0.03, 0.05, INK, 0, 0, 6)), tb(0.018, 0.22, 0, 0.052, 0.19, STEEL), bx(0.022, 0.014, 0.21, 0, 0.073, 0.19, MID), bx(0.008, 0.026, 0.02, 0, 0.09, 0.285, INK), bx(0.012, 0.034, 0.012, 0, 0.078, -0.03, INK, -0.6)] }),
  w_handcannon: () => ({ fore: [0.012, -0.08, 0.0], muzzle: [0, 0.052, 0.335], p: [bx(0.05, 0.15, 0.07, 0, -0.07, -0.02, INK, 0.3), bx(0.012, 0.012, 0.06, 0, -0.012, 0.05, STEEL), bx(0.06, 0.09, 0.26, 0, 0.04, 0.1, STEEL), bx(0.064, 0.04, 0.3, 0, 0.082, 0.14, DARK), ...[0, 1, 2, 3, 4].map((i) => bx(0.066, 0.014, 0.022, 0, 0.09, 0.1 + i * 0.05, INK)), tb(0.03, 0.07, 0, 0.052, 0.3, INK), lit(0.066, 0.008, 0.2, 0, 0.056, 0.1, 0xffa030, 2), ...reddot(0.116, 0.02, 0xffa030)] }),
  w_viper: () => ({ fore: [0.012, -0.09, -0.005], muzzle: [0, 0.035, 0.235], p: [...grip(DARK), mag(-0.012, 0.2, INK, 0.25), bx(0.046, 0.066, 0.2, 0, 0.028, 0.06, 0x234a2e), bx(0.05, 0.024, 0.2, 0, 0.07, 0.06, INK), tb(0.016, 0.05, 0, 0.033, 0.195, INK), bx(0.02, 0.06, 0.03, 0, -0.012, 0.135, INK, 0.3), lit(0.052, 0.008, 0.16, 0, 0.044, 0.06, 0x70ff50, 2.2), ...reddot(0.098, 0.02, 0x70ff50), bx(0.05, 0.03, 0.05, 0, 0.03, -0.07, INK)] }),
  // ------------------------------------------- submachine guns
  w_buzz: () => ({ fore: [0.0, -0.05, 0.2], muzzle: [0, 0.03, 0.39], p: [...grip(DARK), mag(0.1, 0.18, INK, -0.1), bx(0.056, 0.08, 0.3, 0, 0.03, 0.11, STEEL), tb(0.017, 0.14, 0, 0.03, 0.31, INK), tb(0.026, 0.09, 0, 0.03, 0.33, DARK), bx(0.05, 0.03, 0.12, 0, -0.024, 0.2, DARK), ...rail(0.1, 0.22), ...irons(0.0, 0.22), bx(0.012, 0.012, 0.26, 0.02, 0.05, -0.16, MID), bx(0.012, 0.012, 0.26, -0.02, 0.05, -0.16, MID), bx(0.056, 0.05, 0.016, 0, 0.05, -0.29, INK)].flat() }),
  w_stinger: () => ({ fore: [0.0, -0.1, 0.235], muzzle: [0, 0.035, 0.425], p: [...grip(INK), mag(0.02, 0.22, INK, 0.2), bx(0.052, 0.09, 0.26, 0, 0.034, 0.09, 0xd8b030), bx(0.056, 0.03, 0.27, 0, 0.09, 0.09, INK), tb(0.03, 0.13, 0, 0.035, 0.31, INK), ...[0, 1, 2, 3].map((i) => bx(0.062, 0.05, 0.008, 0, 0.035, 0.26 + i * 0.03, DARK)), tb(0.012, 0.05, 0, 0.035, 0.4, INK), bx(0.024, 0.09, 0.03, 0, -0.05, 0.235, INK, 0.25), ...reddot(0.124, 0.08), bx(0.04, 0.06, 0.16, 0, 0.03, -0.1, INK), bx(0.05, 0.08, 0.02, 0, 0.018, -0.18, DARK)] }),
  w_ghost: () => ({ fore: [0.0, -0.09, 0.24], muzzle: [0, 0.05, 0.53], p: [...grip(INK), bx(0.05, 0.09, 0.3, 0, 0.04, 0.1, 0x232a36), bx(0.056, 0.022, 0.3, 0, 0.094, 0.1, INK), tb(0.034, 0.26, 0, 0.05, 0.4, INK), ...[0, 1, 2, 3, 4].map((i) => ring(0.036, 0.004, 0, 0.05, 0.3 + i * 0.05, 0x60e0ff, 0x60e0ff, 1.8)), mag(0.09, 0.2, INK, 0.05), bx(0.024, 0.09, 0.03, 0, -0.05, 0.24, DARK, 0.25), lit(0.058, 0.008, 0.24, 0, 0.06, 0.1, 0x60e0ff, 2.4), ...reddot(0.128, 0.08, 0x60e0ff), bx(0.012, 0.09, 0.012, 0, 0.0, -0.13, INK, 0.5), bx(0.05, 0.08, 0.02, 0, -0.01, -0.17, DARK)] }),
  // ------------------------------------------- shotguns
  w_pump: () => ({ fore: [0.0, -0.035, 0.31], muzzle: [0, 0.045, 0.62], p: [...grip(WOOD2), bx(0.052, 0.085, 0.2, 0, 0.03, 0.09, STEEL), tb(0.024, 0.46, 0, 0.045, 0.39, STEEL), tb(0.019, 0.34, 0, 0.0, 0.33, DARK), bx(0.056, 0.05, 0.13, 0, -0.005, 0.31, WOOD), ...[0, 1, 2, 3].map((i) => bx(0.058, 0.004, 0.008, 0, 0.02, 0.26 + i * 0.033, INK)), bx(0.05, 0.1, 0.27, 0, -0.03, -0.18, WOOD, -0.18), bx(0.056, 0.11, 0.02, 0, -0.058, -0.32, INK, -0.18), tb(0.028, 0.018, 0, 0.045, 0.61, INK), bx(0.012, 0.016, 0.012, 0, 0.076, 0.6, 0xff4030)] }),
  w_sweeper: () => ({ fore: [0.0, -0.05, 0.3], muzzle: [0, 0.05, 0.585], p: [...grip(INK), bx(0.056, 0.1, 0.3, 0, 0.034, 0.13, DARK), tb(0.092, 0.11, 0, -0.1, 0.11, INK, 0, 0, 12), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => tb(0.017, 0.114, Math.cos(i * 0.785) * 0.066, -0.1 + Math.sin(i * 0.785) * 0.066, 0.11, MID, 0, 0, 6)), tb(0.027, 0.3, 0, 0.05, 0.43, STEEL), bx(0.05, 0.036, 0.2, 0, 0.006, 0.34, INK), ...[0, 1, 2, 3, 4].map((i) => bx(0.058, 0.014, 0.02, 0, 0.082, 0.3 + i * 0.05, INK)), ...brake(0.035, 0.57), ...rail(0.14, 0.22, 0.09), bx(0.044, 0.1, 0.19, 0, 0.03, -0.14, INK), bx(0.056, 0.12, 0.022, 0, 0.018, -0.24, DARK)] }),
  w_dragonb: () => ({ fore: [0.0, -0.055, 0.3], muzzle: [0, 0.045, 0.66], p: [...grip(0x281410), bx(0.056, 0.09, 0.22, 0, 0.03, 0.09, 0x3a1a12), tb(0.031, 0.42, 0.031, 0.045, 0.41, 0x3a1a12), tb(0.031, 0.42, -0.031, 0.045, 0.41, 0x3a1a12), tp(0.03, 0.066, 0.1, 0.031, 0.045, 0.655, 0x281410), tp(0.03, 0.066, 0.1, -0.031, 0.045, 0.655, 0x281410), lit(0.012, 0.012, 0.36, 0, 0.082, 0.42, 0xff6a1a, 3), lit(0.012, 0.012, 0.36, 0, 0.008, 0.42, 0xff6a1a, 3), bx(0.09, 0.05, 0.14, 0, -0.01, 0.3, INK), ...[0, 1, 2].map((i) => shard(0.03, 1.8, 0, 0.1, 0.28 + i * 0.12, 0xff4a10, 0.6, 0, 0, 0xff4a10, 1.6)), bx(0.05, 0.1, 0.25, 0, -0.03, -0.17, 0x281410, -0.18), lit(0.052, 0.012, 0.22, 0, -0.02, -0.17, 0xff6a1a, 2.4, -0.18)] }),
  // ------------------------------------------- rifles
  w_carbine: () => ({ fore: [0.0, -0.045, 0.29], muzzle: [0, 0.045, 0.655], p: [...grip(DARK), mag(0.12, 0.17, INK, -0.22), bx(0.05, 0.09, 0.3, 0, 0.034, 0.1, OLIVE), bx(0.054, 0.065, 0.24, 0, 0.034, 0.36, OLIVE), ...[0, 1, 2, 3, 4].map((i) => bx(0.057, 0.012, 0.024, 0, 0.038, 0.28 + i * 0.04, INK)), tb(0.013, 0.2, 0, 0.045, 0.55, INK), ...brake(0.021, 0.62), ...rail(0.2, 0.42), ...reddot(0.094, 0.12), bx(0.016, 0.05, 0.016, 0, 0.094, 0.44, INK), tb(0.018, 0.2, 0, 0.042, -0.14, STEEL), bx(0.046, 0.09, 0.14, 0, 0.012, -0.27, OLIVE), bx(0.05, 0.1, 0.018, 0, 0.012, -0.345, INK)] }),
  w_stormar: () => ({ fore: [0.0, -0.06, 0.3], muzzle: [0, 0.05, 0.675], p: [...grip(INK), mag(0.11, 0.2, INK, -0.28, 0.04, 0.075), bx(0.056, 0.1, 0.32, 0, 0.038, 0.1, 0x2c323c), bx(0.06, 0.084, 0.27, 0, 0.042, 0.38, DARK), ...[0, 1, 2, 3, 4, 5].map((i) => bx(0.062, 0.05, 0.008, 0, 0.042, 0.28 + i * 0.038, 0x05060a)), tb(0.015, 0.14, 0, 0.05, 0.58, STEEL), ...brake(0.026, 0.64), ...rail(0.22, 0.48, 0.09), ...reddot(0.116, 0.12), bx(0.024, 0.08, 0.03, 0, -0.04, 0.3, INK, 0.25), bx(0.044, 0.08, 0.2, 0, 0.03, -0.17, DARK), bx(0.054, 0.12, 0.024, 0, 0.018, -0.28, INK), lit(0.062, 0.008, 0.18, 0, 0.076, 0.38, 0xffb040, 2)] }),
  w_razor: () => ({ fore: [0.0, -0.05, 0.31], muzzle: [0, 0.05, 0.56], p: [...grip(TAN), mag(-0.14, 0.17, INK, 0.1), bx(0.06, 0.12, 0.5, 0, 0.038, 0.06, TAN), bx(0.05, 0.03, 0.5, 0, 0.11, 0.06, 0x2a2620), bx(0.056, 0.05, 0.13, 0, -0.04, 0.31, 0x8a7350), tb(0.016, 0.12, 0, 0.05, 0.49, INK), ...brake(0.024, 0.53), ...scope(0.14, 0.158, 0.09, INK, 0xff5040, 0.026), bx(0.062, 0.12, 0.016, 0, 0.03, -0.2, INK), ...[0, 1, 2].map((i) => bx(0.062, 0.006, 0.08, 0, 0.0 + i * 0.024, 0.16, 0x2a2620))] }),
  w_nova: () => ({ fore: [0.0, -0.07, 0.32], muzzle: [0, 0.055, 0.72], p: [...grip(INK), bx(0.058, 0.11, 0.34, 0, 0.04, 0.1, 0xe2e8f0), bx(0.064, 0.09, 0.3, 0, 0.044, 0.4, 0xc8d0dc), lit(0.066, 0.016, 0.42, 0, 0.044, 0.3, 0x60e0ff, 3), ...[0, 1, 2].map((i) => ring(0.05, 0.007, 0, 0.055, 0.56 + i * 0.045, 0x60e0ff, 0x60e0ff, 2.6)), tb(0.016, 0.18, 0, 0.055, 0.62, INK), orb(0.02, 0, 0.055, 0.7, 0x9ff0ff, 3.5), mag(0.08, 0.15, 0x2a2f38, -0.2, 0.046, 0.09), bx(0.024, 0.08, 0.03, 0, -0.04, 0.32, INK, 0.25), ...scope(0.15, 0.17, 0.12, DARK, 0x60e0ff), bx(0.05, 0.1, 0.21, 0, 0.03, -0.18, 0xe2e8f0), bx(0.056, 0.13, 0.024, 0, 0.018, -0.29, INK), lit(0.052, 0.008, 0.16, 0, 0.056, -0.18, 0x60e0ff, 2.4)] }),
  // ------------------------------------------- snipers
  w_hunter: () => ({ fore: [0.0, -0.05, 0.33], muzzle: [0, 0.052, 0.825], p: [bx(0.052, 0.13, 0.07, 0, -0.06, -0.03, WOOD2, 0.5), bx(0.012, 0.012, 0.05, 0, -0.012, 0.04, STEEL), bx(0.056, 0.05, 0.56, 0, -0.012, 0.2, WOOD2), bx(0.05, 0.075, 0.2, 0, 0.038, 0.09, STEEL), tb(0.016, 0.56, 0, 0.052, 0.53, STEEL), tp(0.02, 0.014, 0.1, 0, 0.052, 0.27, STEEL), ...brake(0.022, 0.8), ...scope(0.28, 0.16, 0.1), tb(0.008, 0.06, 0.05, 0.05, 0.03, MID, 0, 0, 6), orb(0.016, 0.082, 0.05, 0.03, MID, 0), bx(0.052, 0.13, 0.3, 0, -0.03, -0.2, WOOD, -0.14), bx(0.058, 0.14, 0.022, 0, -0.05, -0.355, INK, -0.14)] }),
  w_longshot: () => ({ fore: [0.0, -0.06, 0.3], muzzle: [0, 0.052, 0.99], p: [...grip(INK), bx(0.056, 0.1, 0.34, 0, 0.034, 0.1, 0x3a4a34), bx(0.06, 0.05, 0.3, 0, 0.012, 0.36, 0x2e3b2a), tb(0.018, 0.68, 0, 0.052, 0.62, STEEL), tp(0.018, 0.038, 0.14, 0, 0.052, 0.92, INK), ...[0, 1, 2].map((i) => tb(0.04, 0.01, 0, 0.052, 0.88 + i * 0.03, DARK)), ...scope(0.34, 0.172, 0.12, INK, 0x70ff90, 0.036), mag(0.08, 0.1, INK, 0), bx(0.012, 0.2, 0.012, 0.04, -0.09, 0.46, STEEL, 0.5, 0, 0.3), bx(0.012, 0.2, 0.012, -0.04, -0.09, 0.46, STEEL, 0.5, 0, -0.3), bx(0.044, 0.09, 0.26, 0, 0.018, -0.2, 0x3a4a34), bx(0.05, 0.14, 0.024, 0, 0.002, -0.34, INK), bx(0.05, 0.03, 0.09, 0, 0.082, -0.18, INK)] }),
  w_phantom: () => ({ fore: [0.0, -0.08, 0.3], muzzle: [0, 0.05, 0.87], p: [...grip(INK), mag(0.09, 0.16, INK, -0.05, 0.04, 0.09), bx(0.052, 0.11, 0.36, 0, 0.038, 0.12, 0x20242c), bx(0.058, 0.086, 0.25, 0, 0.04, 0.4, 0x14171d), ...[0, 1, 2, 3, 4].map((i) => bx(0.06, 0.04, 0.01, 0, 0.04, 0.31 + i * 0.04, INK)), tb(0.036, 0.3, 0, 0.05, 0.71, INK), ...[0, 1, 2, 3].map((i) => tb(0.038, 0.012, 0, 0.05, 0.62 + i * 0.06, STEEL)), ...scope(0.26, 0.164, 0.14, DARK, 0xc070ff), bx(0.024, 0.09, 0.03, 0, -0.045, 0.3, INK, 0.25), bx(0.012, 0.11, 0.012, 0, 0.01, -0.13, STEEL, 0.5), bx(0.052, 0.1, 0.022, 0, -0.01, -0.21, INK), lit(0.06, 0.008, 0.22, 0, 0.066, 0.4, 0xc070ff, 2.2)] }),
  w_railspike: () => ({ fore: [0.0, -0.08, 0.3], muzzle: [0, 0.065, 1.02], p: [...grip(INK), bx(0.06, 0.12, 0.38, 0, 0.04, 0.12, 0x2b3442), bx(0.016, 0.03, 0.66, 0.032, 0.065, 0.68, STEEL), bx(0.016, 0.03, 0.66, -0.032, 0.065, 0.68, STEEL), lit(0.018, 0.014, 0.62, 0, 0.065, 0.68, 0x50c8ff, 3.2), ...[0, 1, 2, 3].map((i) => bx(0.1, 0.06, 0.016, 0, 0.065, 0.44 + i * 0.16, DARK)), ...scope(0.26, 0.186, 0.12, INK, 0x50c8ff, 0.034), bx(0.05, 0.08, 0.1, 0, -0.03, 0.14, 0x3a4a60), lit(0.052, 0.012, 0.09, 0, -0.03, 0.14, 0x50c8ff, 2.6), bx(0.024, 0.09, 0.03, 0, -0.05, 0.3, INK, 0.25), bx(0.048, 0.1, 0.24, 0, 0.03, -0.18, 0x2b3442), bx(0.056, 0.14, 0.024, 0, 0.018, -0.3, INK)] }),
  // ------------------------------------------- machine guns
  w_bulldog: () => ({ fore: [0.0, -0.05, 0.27], muzzle: [0, 0.05, 0.77], p: [...grip(DARK), bx(0.064, 0.12, 0.38, 0, 0.038, 0.1, 0x2d3320), tb(0.03, 0.34, 0, 0.05, 0.46, DARK), ...[0, 1, 2, 3, 4, 5, 6].map((i) => tb(0.034, 0.012, 0, 0.05, 0.34 + i * 0.045, INK)), tb(0.015, 0.14, 0, 0.05, 0.68, STEEL), ...brake(0.028, 0.74), bx(0.1, 0.12, 0.16, 0.0, -0.075, 0.12, 0x3f4730), bx(0.11, 0.012, 0.17, 0, -0.012, 0.12, INK), bx(0.012, 0.2, 0.012, 0.05, -0.09, 0.56, STEEL, 0.4, 0, 0.3), bx(0.012, 0.2, 0.012, -0.05, -0.09, 0.56, STEEL, 0.4, 0, -0.3), ...rail(0.16, 0.34, 0.104), ...reddot(0.128, 0.12), bx(0.05, 0.1, 0.22, 0, 0.012, -0.18, 0x2d3320), bx(0.058, 0.13, 0.022, 0, 0.0, -0.29, INK)] }),
  w_ironbelt: () => ({ fore: [0.0, 0.14, 0.2], muzzle: [0, 0.06, 0.84], p: [...grip(INK), bx(0.07, 0.14, 0.42, 0, 0.05, 0.12, STEEL), tb(0.021, 0.5, 0, 0.06, 0.56, MID), ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => tb(0.037, 0.016, 0, 0.06, 0.36 + i * 0.05, DARK)), tp(0.024, 0.052, 0.08, 0, 0.06, 0.82, INK), bx(0.012, 0.11, 0.012, 0.02, 0.17, 0.2, MID), bx(0.012, 0.11, 0.012, -0.02, 0.17, 0.2, MID), bx(0.06, 0.016, 0.016, 0, 0.14, 0.2, INK), bx(0.14, 0.14, 0.18, 0.1, -0.05, 0.11, 0x47502f), ...[0, 1, 2, 3, 4, 5, 6].map((i) => bx(0.018, 0.05, 0.016, 0.03 - i * 0.012 + 0.0, 0.03 + i * 0.012, 0.11, 0xd8a838)), ...reddot(0.142, 0.08), bx(0.05, 0.11, 0.2, 0, 0.012, -0.18, STEEL), bx(0.06, 0.14, 0.022, 0, 0.0, -0.285, INK)] }),
  w_ripper: () => ({ fore: [0.0, 0.145, 0.18], muzzle: [0, 0.055, 0.72], spin: 'w_ripper_b', spinAt: [0, 0.055, 0], p: [...grip(INK), bx(0.11, 0.15, 0.3, 0, 0.055, 0.1, 0x303642), tb(0.052, 0.09, 0, 0.055, 0.28, MID, 0, 0, 12), bx(0.014, 0.1, 0.014, 0.03, 0.17, 0.18, MID), bx(0.014, 0.1, 0.014, -0.03, 0.17, 0.18, MID), bx(0.08, 0.018, 0.018, 0, 0.145, 0.18, INK), tb(0.082, 0.14, 0, -0.1, 0.1, 0x47502f, 0, 0, 14), ...[0, 1, 2].map((i) => lit(0.114, 0.008, 0.008, 0, 0.1, -0.03 + i * 0.03, 0xff5030, 2.2)), bx(0.09, 0.09, 0.1, 0, 0.06, -0.09, INK)] }),
  w_ripper_b: () => [0, 1, 2, 3, 4, 5].flatMap((i) => [tb(0.0125, 0.46, Math.cos(i * 1.047) * 0.038, Math.sin(i * 1.047) * 0.038, 0.5, STEEL, 0, 0, 6)]).concat([tb(0.058, 0.022, 0, 0, 0.42, DARK, 0, 0, 12), tb(0.058, 0.022, 0, 0, 0.68, DARK, 0, 0, 12)]),
  // ------------------------------------------- launchers
  w_thumper: () => ({ fore: [0.0, -0.11, 0.26], muzzle: [0, 0.075, 0.57], p: [...grip(INK), bx(0.06, 0.11, 0.2, 0, 0.03, 0.08, OLIVE), tb(0.066, 0.42, 0, 0.075, 0.34, OLIVE, 0, 0, 12), tb(0.052, 0.012, 0, 0.075, 0.55, 0x050505), ...[0, 1, 2].map((i) => tb(0.072, 0.03, 0, 0.075, 0.18 + i * 0.16, INK, 0, 0, 12)), bx(0.024, 0.1, 0.03, 0, -0.06, 0.26, INK, 0.25), bx(0.014, 0.05, 0.05, 0, 0.17, 0.2, INK), lit(0.008, 0.012, 0.012, 0.01, 0.19, 0.2, 0xff4030, 3), bx(0.05, 0.1, 0.17, 0, 0.012, -0.12, OLIVE), bx(0.06, 0.12, 0.03, 0, 0.0, -0.21, INK), bx(0.024, 0.024, 0.13, 0.08, 0.03, 0.34, 0xffd030, 0, 0, 0, 0xff8020, 1.4)] }),
  // ------------------------------------------- added in 4.10.6
  w_zapper: () => ({ fore: [0.012, -0.075, 0.0], muzzle: [0, 0.035, 0.225], p: [...grip(0x3a3f4a), bx(0.048, 0.07, 0.17, 0, 0.032, 0.05, 0xf0f2f6), bx(0.05, 0.022, 0.15, 0, 0.074, 0.04, 0xff8a2a), tp(0.026, 0.016, 0.07, 0, 0.035, 0.17, 0xf0f2f6),
    ring(0.024, 0.006, 0, 0.035, 0.205, 0xffa040, 0xff8a20, 2.6), orb(0.012, 0, 0.035, 0.215, 0xffd090, 3), lit(0.052, 0.008, 0.08, 0, 0.05, 0.02, 0xff8a20, 2.2), bx(0.014, 0.018, 0.014, 0, 0.092, 0.1, INK)] }),
  w_duelist: () => ({ fore: [0.012, -0.08, 0.0], muzzle: [0, 0.05, 0.37], p: [bx(0.044, 0.14, 0.064, 0, -0.065, -0.02, WOOD2, 0.4), bx(0.012, 0.012, 0.055, 0, -0.012, 0.045, 0xc8b070), bx(0.044, 0.08, 0.12, 0, 0.03, 0.03, PALE),
    tb(0.016, 0.3, 0, 0.05, 0.21, PALE), bx(0.02, 0.016, 0.3, 0, 0.068, 0.21, MID), tb(0.02, 0.02, 0, 0.05, 0.355, 0xc8b070), ...[0, 1, 2].map((i) => bx(0.046, 0.006, 0.006, 0, 0.03, i * 0.03, 0xc8b070)),
    bx(0.008, 0.024, 0.016, 0, 0.084, 0.34, INK), bx(0.012, 0.034, 0.012, 0, 0.078, -0.03, INK, -0.6)] }),
  w_flaregun: () => ({ fore: [0.012, -0.08, 0.0], muzzle: [0, 0.045, 0.27], p: [...grip(0xd8601a), bx(0.06, 0.07, 0.1, 0, 0.03, 0.02, 0xe8701a), tb(0.04, 0.2, 0, 0.045, 0.16, 0xff8a2a, 0, 0, 14), tb(0.03, 0.012, 0, 0.045, 0.262, 0x1a0c06, 0, 0, 14),
    ring(0.042, 0.008, 0, 0.045, 0.1, 0x2a2a2e), ring(0.042, 0.008, 0, 0.045, 0.22, 0x2a2a2e), bx(0.014, 0.03, 0.03, 0, 0.09, -0.02, INK, -0.5), lit(0.044, 0.006, 0.12, 0, 0.087, 0.16, 0xffd040, 2.4)] }),
  w_twinfang: () => ({ fore: [0.012, -0.1, -0.005], muzzle: [0, 0.035, 0.25], p: [...grip(INK), mag(-0.012, 0.24, INK, 0.25), bx(0.048, 0.068, 0.21, 0, 0.03, 0.06, 0x8a1a2a), bx(0.052, 0.026, 0.21, 0, 0.074, 0.06, INK), tb(0.015, 0.06, 0, 0.035, 0.2, INK),
    shard(0.018, 2.4, 0, -0.012, 0.19, 0xe8e8f0, HALF + 0.2), lit(0.054, 0.008, 0.15, 0, 0.046, 0.06, 0xff3050, 2.4), ...reddot(0.1, 0.03, 0xff3050), bx(0.05, 0.03, 0.06, 0, 0.03, -0.075, INK)] }),
  w_compact: () => ({ fore: [0.0, -0.08, 0.17], muzzle: [0, 0.03, 0.33], p: [...grip(DARK), mag(0.02, 0.16, INK, 0.1), bx(0.052, 0.08, 0.24, 0, 0.03, 0.08, 0x4a5262), bx(0.054, 0.02, 0.24, 0, 0.078, 0.08, INK), tb(0.016, 0.1, 0, 0.03, 0.25, INK),
    bx(0.026, 0.09, 0.028, 0, -0.04, 0.17, INK, 0.2), ...irons(0.0, 0.18), bx(0.012, 0.012, 0.18, 0, 0.05, -0.12, MID), bx(0.04, 0.05, 0.014, 0, 0.04, -0.21, INK)] }),
  w_hornet: () => ({ fore: [0.0, -0.09, 0.22], muzzle: [0, 0.035, 0.47], p: [...grip(INK), bx(0.054, 0.09, 0.28, 0, 0.034, 0.1, 0x1a1a1e), ...[0, 1, 2, 3].map((i) => bx(0.056, 0.092, 0.02, 0, 0.034, i * 0.06, 0xf0c020)), mag(0.06, 0.2, INK, 0.15),
    tp(0.03, 0.018, 0.14, 0, 0.035, 0.32, 0x1a1a1e), tb(0.011, 0.06, 0, 0.035, 0.42, INK), cone(0.02, 0.05, 0, 0.035, 0.46, 0xf0c020, HALF), bx(0.024, 0.09, 0.03, 0, -0.05, 0.22, INK, 0.25), ...reddot(0.11, 0.1),
    bx(0.04, 0.06, 0.15, 0, 0.03, -0.1, 0x1a1a1e), bx(0.05, 0.08, 0.02, 0, 0.018, -0.18, 0xf0c020)] }),
  w_plasma: () => ({ fore: [0.0, -0.09, 0.24], muzzle: [0, 0.05, 0.5], p: [...grip(0x1c2430), bx(0.06, 0.1, 0.3, 0, 0.04, 0.1, 0xe8eef6), bx(0.064, 0.03, 0.26, 0, 0.1, 0.1, 0x2a3442), tb(0.028, 0.16, 0, 0.05, 0.31, 0x60f0ff, 0x30d0ff, 3, 12),
    ...[0, 1, 2].map((i) => ring(0.036, 0.008, 0, 0.05, 0.26 + i * 0.05, 0xe8eef6)), tp(0.03, 0.014, 0.1, 0, 0.05, 0.44, 0xe8eef6), orb(0.014, 0, 0.05, 0.49, 0x9ff8ff, 3.4), mag(0.08, 0.14, 0x2a3442, -0.1, 0.044, 0.07),
    lit(0.004, 0.06, 0.08, 0.031, 0.04, 0.08, 0x60f0ff, 2.6), lit(0.004, 0.06, 0.08, -0.031, 0.04, 0.08, 0x60f0ff, 2.6), bx(0.024, 0.09, 0.03, 0, -0.05, 0.24, 0x1c2430, 0.25), bx(0.05, 0.08, 0.14, 0, 0.03, -0.1, 0xe8eef6)] }),
  w_venom: () => ({ fore: [0.0, -0.09, 0.24], muzzle: [0, 0.045, 0.49], p: [...grip(0x1a2614), bx(0.054, 0.09, 0.3, 0, 0.036, 0.1, 0x2a3a1e), bx(0.058, 0.024, 0.28, 0, 0.092, 0.1, 0x14200e), tb(0.03, 0.22, 0, 0.045, 0.37, 0x1a2614),
    ...[0, 1, 2, 3].map((i) => ring(0.033, 0.005, 0, 0.045, 0.29 + i * 0.05, 0x8aff3a, 0x6aff20, 2)), cyl(0.026, 0.026, 0.12, 0.05, 0.03, 0.08, 0x8aff3a, HALF, 0, 0x6aff20, 2.4), cyl(0.03, 0.03, 0.016, 0.05, 0.03, 0.148, 0x14200e, HALF), cyl(0.03, 0.03, 0.016, 0.05, 0.03, 0.012, 0x14200e, HALF),
    mag(0.08, 0.17, 0x14200e, -0.05), bx(0.024, 0.09, 0.03, 0, -0.05, 0.24, 0x14200e, 0.25), ...reddot(0.124, 0.08, 0x8aff3a), bx(0.04, 0.07, 0.16, 0, 0.03, -0.1, 0x2a3a1e),
    ...[0, 1, 2].map((i) => cone(0.012, 0.04, 0, 0.12, i * 0.06, 0xd8f0c0, -0.4))] }),
  w_double: () => ({ fore: [0.0, -0.03, 0.3], muzzle: [0, 0.045, 0.62], p: [...grip(WOOD2), bx(0.06, 0.07, 0.12, 0, 0.03, 0.05, STEEL), tb(0.022, 0.5, 0.022, 0.045, 0.36, STEEL), tb(0.022, 0.5, -0.022, 0.045, 0.36, STEEL),
    tb(0.015, 0.012, 0.022, 0.045, 0.612, 0x050505), tb(0.015, 0.012, -0.022, 0.045, 0.612, 0x050505), bx(0.064, 0.04, 0.2, 0, 0.012, 0.3, WOOD), bx(0.008, 0.008, 0.48, 0, 0.069, 0.36, MID),
    bx(0.05, 0.1, 0.26, 0, -0.03, -0.17, WOOD, -0.16), bx(0.056, 0.11, 0.02, 0, -0.056, -0.305, INK, -0.16), bx(0.012, 0.02, 0.012, 0, 0.08, 0.6, 0xc8b070)] }),
  w_slug: () => ({ fore: [0.0, -0.04, 0.33], muzzle: [0, 0.05, 0.67], p: [...grip(INK), bx(0.058, 0.095, 0.22, 0, 0.034, 0.09, 0x2a2e36), tb(0.03, 0.46, 0, 0.05, 0.42, 0x3a404c), ...[0, 1, 2, 3, 4, 5].map((i) => tb(0.034, 0.01, 0, 0.05, 0.25 + i * 0.07, INK)),
    tb(0.02, 0.32, 0, 0.0, 0.34, DARK), bx(0.06, 0.06, 0.14, 0, -0.002, 0.33, 0xe8701a), ...brake(0.034, 0.64), ...rail(0.12, 0.2, 0.084), ...reddot(0.11, 0.1, 0xff8a20), bx(0.044, 0.09, 0.2, 0, 0.02, -0.15, INK), bx(0.056, 0.12, 0.024, 0, 0.012, -0.26, 0xe8701a)] }),
  w_cryo: () => ({ fore: [0.0, -0.05, 0.3], muzzle: [0, 0.05, 0.67], p: [...grip(0x1c2c3c), bx(0.06, 0.1, 0.24, 0, 0.034, 0.09, 0xd8eef8), tb(0.034, 0.4, 0, 0.05, 0.42, 0x8cc8e8), ...[0, 1, 2].map((i) => ring(0.044, 0.008, 0, 0.05, 0.3 + i * 0.1, 0x9ff0ff, 0x60d0ff, 2.6)),
    tp(0.034, 0.056, 0.08, 0, 0.05, 0.62, 0xd8eef8), tb(0.03, 0.01, 0, 0.05, 0.665, 0x60d0ff, 0x60d0ff, 3), cyl(0.032, 0.032, 0.16, 0, -0.035, 0.16, 0x9ff0ff, HALF, 0, 0x60d0ff, 1.6),
    ...[[0.04, 0.11, 0.3], [-0.04, 0.12, 0.42], [0.035, 0.1, 0.5]].map(([x, y, z], i) => shard(0.022, 2, x, y, z, 0xe8fcff, 0.3, i, x * 5, 0x60d0ff, 1.6)),
    bx(0.024, 0.09, 0.03, 0, -0.05, 0.28, 0x1c2c3c, 0.25), bx(0.048, 0.1, 0.2, 0, 0.026, -0.16, 0xd8eef8), bx(0.056, 0.12, 0.022, 0, 0.016, -0.265, 0x1c2c3c)] }),
  w_lever: () => ({ fore: [0.0, -0.035, 0.32], muzzle: [0, 0.05, 0.77], p: [bx(0.048, 0.13, 0.07, 0, -0.06, -0.03, WOOD2, 0.45), part(new THREE.TorusGeometry(0.045, 0.008, 6, 18), M(0, -0.06, 0.04, 1, 1, 1, 0, HALF, 0), 0xc8a050),
    bx(0.05, 0.08, 0.16, 0, 0.03, 0.07, 0xc8a050), tb(0.017, 0.62, 0, 0.05, 0.46, STEEL), tb(0.014, 0.5, 0, 0.018, 0.4, DARK), bx(0.054, 0.05, 0.24, 0, 0.012, 0.3, WOOD), ...irons(0.12, 0.74, 0.066),
    bx(0.05, 0.1, 0.3, 0, -0.025, -0.2, WOOD, -0.12), bx(0.056, 0.11, 0.02, 0, -0.045, -0.35, INK, -0.12)] }),
  w_tactical: () => ({ fore: [0.0, -0.07, 0.3], muzzle: [0, 0.048, 0.68], p: [...grip(INK), mag(0.11, 0.19, 0x5a4a32, -0.24, 0.04, 0.07), bx(0.054, 0.1, 0.3, 0, 0.036, 0.1, TAN), bx(0.058, 0.08, 0.26, 0, 0.04, 0.38, 0x8a7350),
    ...[0, 1, 2, 3, 4].map((i) => bx(0.06, 0.04, 0.008, 0, 0.04, 0.29 + i * 0.04, INK)), tb(0.014, 0.14, 0, 0.048, 0.58, INK), ...brake(0.024, 0.64), ...rail(0.22, 0.5, 0.088), ...reddot(0.114, 0.12, 0xff3040),
    tb(0.016, 0.08, 0.04, 0.0, 0.42, INK), tb(0.012, 0.006, 0.04, 0.0, 0.463, 0xfff4d0, 0xfff4d0, 3), bx(0.024, 0.09, 0.03, 0, -0.06, 0.3, INK, 0.25), bx(0.044, 0.08, 0.2, 0, 0.03, -0.17, TAN), bx(0.054, 0.12, 0.024, 0, 0.018, -0.28, INK)] }),
  w_tesla: () => ({ fore: [0.0, -0.07, 0.28], muzzle: [0, 0.07, 0.66], p: [...grip(0x2a1a10), bx(0.06, 0.11, 0.26, 0, 0.04, 0.08, 0x3a2a20), tb(0.014, 0.36, 0, 0.07, 0.42, 0x8a8e96),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ring(0.042 - i * 0.002, 0.009, 0, 0.07, 0.27 + i * 0.04, 0xc87a3a)), orb(0.04, 0, 0.07, 0.62, 0xd0c0ff, 3.6), ring(0.062, 0.006, 0, 0.07, 0.62, 0xb8a0ff, 0x9a70ff, 3),
    ...[0, 1, 2].map((i) => shard(0.008, 4, Math.cos(i * 2.1) * 0.05, 0.07 + Math.sin(i * 2.1) * 0.05, 0.6, 0xe8e0ff, 0, 0, i * 2.1 - HALF, 0x9a70ff, 3.4)),
    bx(0.03, 0.06, 0.08, 0, 0.13, 0.1, 0xc87a3a), cyl(0.02, 0.02, 0.05, 0, 0.18, 0.1, 0x8a8e96), orb(0.016, 0, 0.21, 0.1, 0xd0c0ff, 2.6),
    bx(0.024, 0.09, 0.03, 0, -0.05, 0.28, INK, 0.25), bx(0.05, 0.1, 0.2, 0, 0.03, -0.15, 0x3a2a20), bx(0.056, 0.12, 0.022, 0, 0.018, -0.255, 0xc87a3a)] }),
  w_starfall: () => ({ fore: [0.0, -0.06, 0.3], muzzle: [0, 0.05, 0.7], p: [...grip(0x2a1a3a), bx(0.056, 0.1, 0.32, 0, 0.038, 0.1, 0xf4e8ff), bx(0.06, 0.08, 0.26, 0, 0.042, 0.38, 0x3a2450), lit(0.062, 0.012, 0.44, 0, 0.05, 0.28, 0xffb0f0, 3),
    tb(0.016, 0.16, 0, 0.05, 0.6, 0xf4e8ff), ...[0, 1, 2, 3, 4].map((i) => shard(0.012, 3, Math.cos(i * 1.2566) * 0.035, 0.05 + Math.sin(i * 1.2566) * 0.035, 0.68, 0xffd0f8, 0, 0, i * 1.2566 - HALF, 0xffb0f0, 2.6)),
    orb(0.016, 0, 0.05, 0.68, 0xffffff, 4), mag(0.1, 0.16, 0x3a2450, -0.2), ...scope(0.14, 0.17, 0.12, 0x3a2450, 0xffb0f0), bx(0.024, 0.08, 0.03, 0, -0.04, 0.3, INK, 0.25),
    bx(0.044, 0.09, 0.2, 0, 0.03, -0.17, 0xf4e8ff), bx(0.054, 0.12, 0.024, 0, 0.018, -0.28, 0x3a2450)] }),
  w_dmr: () => ({ fore: [0.0, -0.06, 0.3], muzzle: [0, 0.05, 0.9], p: [...grip(INK), mag(0.09, 0.14, INK, -0.1, 0.04, 0.08), bx(0.054, 0.1, 0.34, 0, 0.036, 0.1, 0x3a3a34), bx(0.058, 0.07, 0.28, 0, 0.03, 0.4, 0x4a4a40), tb(0.017, 0.4, 0, 0.05, 0.68, STEEL),
    ...brake(0.026, 0.86), ...scope(0.26, 0.166, 0.12, INK, 0xffb040, 0.032), bx(0.012, 0.18, 0.012, 0.035, -0.08, 0.44, STEEL, 0.5, 0, 0.3), bx(0.012, 0.18, 0.012, -0.035, -0.08, 0.44, STEEL, 0.5, 0, -0.3),
    bx(0.044, 0.1, 0.24, 0, 0.012, -0.19, 0x3a3a34), bx(0.054, 0.12, 0.022, 0, 0.0, -0.32, INK), bx(0.03, 0.03, 0.12, 0, 0.075, -0.14, 0x3a3a34)] }),
  w_lancer: () => ({ fore: [0.0, -0.08, 0.3], muzzle: [0, 0.06, 1.04], p: [...grip(0x14081c), bx(0.058, 0.12, 0.38, 0, 0.04, 0.12, 0x1e1028), bx(0.016, 0.034, 0.7, 0.03, 0.06, 0.66, 0x6a3a90), bx(0.016, 0.034, 0.7, -0.03, 0.06, 0.66, 0x6a3a90), bx(0.076, 0.012, 0.7, 0, 0.088, 0.66, 0x3a2050),
    lit(0.018, 0.018, 0.68, 0, 0.06, 0.66, 0xff40d0, 3.4), ...[0, 1, 2, 3].map((i) => ring(0.05, 0.007, 0, 0.06, 0.42 + i * 0.18, 0xff80e0, 0xff40d0, 2.6)), orb(0.02, 0, 0.06, 1.02, 0xffa0f0, 4),
    ...scope(0.26, 0.19, 0.12, 0x14081c, 0xff40d0, 0.034), bx(0.024, 0.09, 0.03, 0, -0.05, 0.3, INK, 0.25), bx(0.048, 0.1, 0.24, 0, 0.02, -0.19, 0x1e1028), lit(0.05, 0.012, 0.2, 0, 0.07, -0.19, 0x40e0ff, 2.4),
    bx(0.054, 0.13, 0.024, 0, 0.005, -0.32, 0x14081c)] }),
  w_hacksaw: () => ({ fore: [0.0, 0.14, 0.2], muzzle: [0, 0.05, 0.78], p: [...grip(INK), bx(0.066, 0.12, 0.38, 0, 0.04, 0.1, 0x5a4a3a), tb(0.028, 0.34, 0, 0.05, 0.47, DARK), ...[0, 1, 2, 3, 4, 5].map((i) => tb(0.032, 0.012, 0, 0.05, 0.34 + i * 0.05, INK)),
    tb(0.015, 0.12, 0, 0.05, 0.7, STEEL), ...brake(0.028, 0.75), cyl(0.09, 0.09, 0.07, 0, -0.1, 0.1, 0x3a3020, 0, HALF), cyl(0.04, 0.04, 0.074, 0, -0.1, 0.1, 0x2a2418, 0, HALF),
    bx(0.012, 0.11, 0.012, 0.02, 0.17, 0.2, MID), bx(0.012, 0.11, 0.012, -0.02, 0.17, 0.2, MID), bx(0.06, 0.016, 0.016, 0, 0.14, 0.2, INK),
    bx(0.012, 0.2, 0.012, 0.05, -0.09, 0.58, STEEL, 0.4, 0, 0.3), bx(0.012, 0.2, 0.012, -0.05, -0.09, 0.58, STEEL, 0.4, 0, -0.3), ...reddot(0.12, 0.05), bx(0.05, 0.1, 0.2, 0, 0.02, -0.16, 0x5a4a3a), bx(0.06, 0.13, 0.024, 0, 0.01, -0.27, INK)] }),
  w_harpoon: () => ({ fore: [0.0, -0.11, 0.26], muzzle: [0, 0.07, 0.94], p: [...grip(0x1a2a2a), bx(0.06, 0.1, 0.22, 0, 0.03, 0.08, 0x2a5a5a), tb(0.04, 0.5, 0, 0.07, 0.38, 0x2a5a5a, 0, 0, 12), ...[0, 1, 2].map((i) => ring(0.046, 0.008, 0, 0.07, 0.18 + i * 0.18, 0xc8a050)),
    tb(0.012, 0.3, 0, 0.07, 0.72, 0xc8d0dc), cone(0.03, 0.08, 0, 0.07, 0.9, 0xe8eef6, HALF), ...[1, -1].map((sd) => bx(0.008, 0.008, 0.06, sd * 0.022, 0.07, 0.83, 0xc8d0dc, 0, sd * 0.5, 0)),
    bx(0.024, 0.1, 0.03, 0, -0.06, 0.26, 0x1a2a2a, 0.25), bx(0.05, 0.1, 0.17, 0, 0.012, -0.12, 0x2a5a5a), bx(0.06, 0.12, 0.03, 0, 0, -0.21, 0x1a2a2a), cyl(0.026, 0.026, 0.16, 0, 0.13, 0.12, 0xc8a050, HALF)] }),
  w_quake: () => ({ fore: [0.0, -0.12, 0.24], muzzle: [0, 0.09, 0.64], p: [...grip(0x2a1a10), tb(0.1, 0.5, 0, 0.09, 0.32, 0x4a3a30, 0, 0, 14), ...[0, 1, 2].map((i) => tb(0.106, 0.04, 0, 0.09, 0.14 + i * 0.17, 0x2a1e18, 0, 0, 14)),
    tb(0.08, 0.014, 0, 0.09, 0.572, 0xff6a1a, 0xff4a10, 3, 14), tp(0.1, 0.12, 0.08, 0, 0.09, 0.6, 0x2a1e18, 0, 0, 14),
    ...[0, 1, 2, 3, 4, 5].map((i) => shard(0.03, 1.3, Math.cos(i * 1.047) * 0.11, 0.09 + Math.sin(i * 1.047) * 0.11, 0.3, 0x5a4a40, HALF, 0, 0)), lit(0.012, 0.012, 0.3, 0, 0.2, 0.32, 0xff6a1a, 3),
    bx(0.024, 0.11, 0.03, 0, -0.07, 0.24, 0x2a1a10, 0.25), bx(0.05, 0.1, 0.16, 0, 0.012, -0.1, 0x4a3a30), bx(0.07, 0.13, 0.03, 0, 0, -0.19, 0x2a1e18)] }),
  // ------------------------------------------- the legendaries
  w_solar: () => ({ fore: [0.012, -0.09, 0.0], muzzle: [0, 0.052, 0.4], p: [bx(0.05, 0.15, 0.066, 0, -0.07, -0.02, 0x241808, 0.3), lit(0.052, 0.1, 0.012, 0, -0.07, -0.05, 0xffb030, 1.6, 0.3), bx(0.012, 0.012, 0.06, 0, -0.012, 0.05, 0xffc830), bx(0.06, 0.1, 0.22, 0, 0.038, 0.08, 0xffc830), bx(0.066, 0.036, 0.25, 0, 0.09, 0.09, 0xfff0a0, 0, 0, 0, 0xffa020, 0.5), tb(0.03, 0.2, 0, 0.052, 0.27, 0xffc830), ring(0.075, 0.012, 0, 0.052, 0.3, 0xfff4b0, 0xffb020, 3), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => shard(0.018, 2.2, Math.cos(i * 0.5236) * 0.105, 0.052 + Math.sin(i * 0.5236) * 0.105, 0.3, 0xffe070, 0, 0, i * 0.5236 - HALF, 0xffa020, 3)), orb(0.038, 0, 0.052, 0.3, 0xfff4b0, 4.5), tp(0.03, 0.05, 0.06, 0, 0.052, 0.385, 0xffc830), orb(0.022, 0, 0.052, 0.41, 0xffffc0, 5), lit(0.068, 0.01, 0.2, 0, 0.05, 0.08, 0xff8a20, 3)] }),
  w_frost: () => ({ fore: [0.0, -0.07, 0.3], muzzle: [0, 0.055, 0.78], p: [...grip(0x1c2c3c), bx(0.056, 0.1, 0.32, 0, 0.038, 0.1, 0xc8e8f8), bx(0.05, 0.08, 0.26, 0, 0.04, 0.38, 0x8cc8e8), lit(0.058, 0.012, 0.5, 0, 0.044, 0.3, 0x9ff0ff, 3.4), tb(0.016, 0.3, 0, 0.055, 0.6, 0xe0f8ff, 0x60d0ff, 1.2), ...[[0.08, 0.16, 0.5], [-0.07, 0.15, 0.56], [0.06, -0.05, 0.42], [-0.06, -0.05, 0.5], [0.02, 0.19, 0.3], [-0.03, 0.17, 0.2], [0.05, -0.02, 0.62]].map(([x, y, z], i) => shard(0.034, 2.1, x * 0.8, y, z, 0xc8f4ff, 0.5 - i * 0.2, i, x * 4, 0x60d0ff, 1.8)), shard(0.03, 3.4, 0, 0.055, 0.76, 0xe8fcff, HALF, 0, 0, 0x90e8ff, 3), mag(0.08, 0.16, 0x8cc8e8, -0.2, 0.046, 0.08), lit(0.03, 0.12, 0.06, 0, -0.1, 0.082, 0x9ff0ff, 2, -0.2), bx(0.024, 0.08, 0.03, 0, -0.04, 0.3, 0x1c2c3c, 0.25), ...scope(0.14, 0.17, 0.12, 0x1c2c3c, 0x9ff0ff), bx(0.05, 0.09, 0.2, 0, 0.03, -0.18, 0xc8e8f8), shard(0.05, 2.2, 0, 0.03, -0.32, 0xc8f4ff, HALF, 0, 0, 0x60d0ff, 1.6)] }),
  w_stormb: () => ({ fore: [0.0, -0.08, 0.28], muzzle: [0, 0.05, 0.7], p: [...grip(0x181430), bx(0.08, 0.12, 0.24, 0, 0.034, 0.09, 0x2a2450), tb(0.036, 0.44, 0.04, 0.05, 0.44, 0x3a3268, 0, 0, 12), tb(0.036, 0.44, -0.04, 0.05, 0.44, 0x3a3268, 0, 0, 12), ...[0, 1, 2, 3].map((i) => ring(0.095, 0.009, 0, 0.05, 0.32 + i * 0.1, 0xd0c0ff, 0x9a70ff, 3.2)), ...[0, 1, 2].map((i) => lit(0.01, 0.13, 0.02, 0.0, 0.05, 0.36 + i * 0.1, 0xe8e0ff, 4, 0, 0, 0.5 + i)), shard(0.045, 2.6, 0, 0.17, 0.3, 0xe8e0ff, 0.7, 0, 0.1, 0x9a70ff, 3), shard(0.04, 2.4, 0, 0.16, 0.48, 0xe8e0ff, 0.8, 0, -0.1, 0x9a70ff, 3), shard(0.035, 2.4, 0.08, -0.04, 0.3, 0xe8e0ff, -0.5, 0, -0.5, 0x9a70ff, 3), shard(0.035, 2.4, -0.08, -0.04, 0.3, 0xe8e0ff, -0.5, 0, 0.5, 0x9a70ff, 3), orb(0.05, 0, 0.05, 0.12, 0xd0c0ff, 3.4), tp(0.04, 0.05, 0.05, 0.04, 0.05, 0.68, 0x181430), tp(0.04, 0.05, 0.05, -0.04, 0.05, 0.68, 0x181430), bx(0.06, 0.08, 0.15, 0, -0.03, 0.28, 0x181430), bx(0.05, 0.1, 0.2, 0, 0.0, -0.16, 0x2a2450), lit(0.052, 0.012, 0.18, 0, 0.01, -0.16, 0x9a70ff, 3)] }),
  w_hellfire: () => ({ fore: [0.0, 0.16, 0.17], muzzle: [0, 0.055, 0.86], spin: 'w_hellfire_b', spinAt: [0, 0.055, 0], p: [...grip(0x180806), bx(0.13, 0.18, 0.34, 0, 0.06, 0.1, 0x2a100a), tb(0.066, 0.1, 0, 0.055, 0.3, 0x401a10, 0, 0, 14), bx(0.014, 0.12, 0.014, 0.035, 0.18, 0.17, MID), bx(0.014, 0.12, 0.014, -0.035, 0.18, 0.17, MID), bx(0.09, 0.018, 0.018, 0, 0.16, 0.17, INK), ...[0, 1, 2, 3].map((i) => shard(0.034, 2.8, 0.074, 0.12 + i * 0.012, -0.03 + i * 0.09, 0xff7a1a, 0.9, 0, -0.4, 0xff4a10, 3)), ...[0, 1, 2, 3].map((i) => shard(0.034, 2.8, -0.074, 0.12 + i * 0.012, -0.03 + i * 0.09, 0xff7a1a, 0.9, 0, 0.4, 0xff4a10, 3)), tb(0.11, 0.17, 0, -0.13, 0.1, 0x401a10, 0, 0, 14), ring(0.112, 0.01, 0, -0.13, 0.03, 0xffa040, 0xff5010, 3), ring(0.112, 0.01, 0, -0.13, 0.17, 0xffa040, 0xff5010, 3), orb(0.06, 0, -0.13, 0.19, 0xffb040, 4), bx(0.11, 0.1, 0.09, 0, 0.06, -0.1, 0x180806)] }),
  w_hellfire_b: () => [0, 1, 2, 3, 4, 5].flatMap((i) => [tb(0.016, 0.54, Math.cos(i * 1.047) * 0.048, Math.sin(i * 1.047) * 0.048, 0.58, 0x4a2010, 0xff4a10, 0.5, 6)]).concat([tb(0.074, 0.03, 0, 0, 0.42, 0x180806, 0, 0, 12), ring(0.076, 0.012, 0, 0, 0.62, 0xffa040, 0xff5010, 3.2), ring(0.076, 0.012, 0, 0, 0.8, 0xffc060, 0xff6010, 4), orb(0.026, 0, 0, 0.84, 0xffc060, 5)]),
  w_titan: () => ({ fore: [0.0, -0.1, 0.3], muzzle: [0, 0.07, 1.3], p: [...grip(0x141820), bx(0.08, 0.15, 0.46, 0, 0.05, 0.14, 0x1e2838), bx(0.024, 0.05, 0.98, 0.05, 0.07, 0.84, 0x4a5a70), bx(0.024, 0.05, 0.98, -0.05, 0.07, 0.84, 0x4a5a70), lit(0.03, 0.022, 0.92, 0, 0.07, 0.84, 0x50d0ff, 4.4), ...[0, 1, 2, 3, 4, 5].map((i) => ring(0.092, 0.012, 0, 0.07, 0.42 + i * 0.16, 0xa0e8ff, 0x30b0ff, 3)), ...[0, 1, 2].map((i) => tb(0.04, 0.1, 0.08, -0.02, 0.1 + i * 0.12, 0x2a3a50, 0x30b0ff, 0.6)), ...[0, 1, 2].map((i) => tb(0.04, 0.1, -0.08, -0.02, 0.1 + i * 0.12, 0x2a3a50, 0x30b0ff, 0.6)), ...scope(0.4, 0.22, 0.14, 0x141820, 0x50d0ff, 0.044), shard(0.05, 3, 0, 0.07, 1.32, 0xe0f8ff, HALF, 0, 0, 0x50d0ff, 4), bx(0.05, 0.3, 0.018, 0.075, -0.17, 0.7, STEEL, 0.45, 0, 0.3), bx(0.05, 0.3, 0.018, -0.075, -0.17, 0.7, STEEL, 0.45, 0, -0.3), bx(0.06, 0.12, 0.26, 0, 0.03, -0.22, 0x1e2838), bx(0.07, 0.17, 0.03, 0, 0.012, -0.36, 0x141820), lit(0.062, 0.012, 0.22, 0, 0.05, -0.22, 0x50d0ff, 3.2)] }),
  w_void: () => ({ fore: [0.0, -0.11, 0.22], muzzle: [0, 0.09, 0.72], p: [...grip(0x100818), tb(0.11, 0.46, 0, 0.09, 0.24, 0x1a0c2a, 0, 0, 16), ...[0, 1, 2, 3].map((i) => ring(0.122, 0.014, 0, 0.09, 0.06 + i * 0.12, 0xc070ff, 0x8020ff, 3)), bx(0.024, 0.11, 0.03, 0, -0.07, 0.22, 0x100818, 0.25), ring(0.19, 0.016, 0, 0.09, 0.62, 0xe0a0ff, 0xa030ff, 4), ring(0.135, 0.012, 0, 0.09, 0.53, 0xe0a0ff, 0xa030ff, 3.4), orb(0.1, 0, 0.09, 0.62, 0x100020, 0.2), ring(0.103, 0.01, 0, 0.09, 0.62, 0xffffff, 0xd080ff, 5), ...[0, 1, 2, 3, 4, 5].map((i) => shard(0.022, 3.4, Math.cos(i * 1.047) * 0.23, 0.09 + Math.sin(i * 1.047) * 0.23, 0.55, 0xc070ff, 0.5, 0, i * 1.047 - HALF, 0x8020ff, 3)), bx(0.018, 0.1, 0.26, 0, 0.24, 0.26, 0x1a0c2a), bx(0.08, 0.1, 0.13, 0, -0.02, -0.08, 0x1a0c2a), shard(0.05, 2.4, 0, 0.09, -0.11, 0xc070ff, HALF, 0, 0, 0x8020ff, 2.6)] }),
  w_dragon: () => ({ fore: [0.0, -0.12, 0.24], muzzle: [0, 0.09, 0.8], p: [...grip(0x200806), tb(0.096, 0.42, 0, 0.09, 0.22, 0x5a0f0a, 0, 0, 12), ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [0, 1, 2].map((k) => shard(0.034, 1.1, Math.cos(i * 0.785 + k * 0.39) * 0.1, 0.09 + Math.sin(i * 0.785 + k * 0.39) * 0.1, 0.08 + k * 0.13, 0x8a1810, HALF, 0, 0))), bx(0.024, 0.11, 0.03, 0, -0.07, 0.24, 0x200806, 0.25), bx(0.17, 0.09, 0.24, 0, 0.165, 0.56, 0x7a1410), bx(0.15, 0.04, 0.26, 0, 0.0, 0.57, 0x5a0f0a, -0.16), orb(0.075, 0, 0.09, 0.56, 0xffa030, 4.4), ...[0, 1, 2, 3, 4].map((i) => shard(0.014, 2.6, -0.056 + i * 0.028, 0.115, 0.68 - Math.abs(i - 2) * 0.012, 0xfff4d0, Math.PI)), ...[0, 1, 2, 3].map((i) => shard(0.012, 2.2, -0.04 + i * 0.027, 0.048, 0.67, 0xfff4d0)), orb(0.02, 0.078, 0.2, 0.62, 0xffe040, 5), orb(0.02, -0.078, 0.2, 0.62, 0xffe040, 5), shard(0.03, 4, 0.07, 0.27, 0.42, 0xd8c8a0, -1.1, 0, -0.3), shard(0.03, 4, -0.07, 0.27, 0.42, 0xd8c8a0, -1.1, 0, 0.3), ...[0, 1, 2, 3].map((i) => shard(0.024, 2.4, 0, 0.2 + i * 0.002, 0.34 - i * 0.12, 0xff5020, -0.4, 0, 0, 0xff3010, 2)), bx(0.09, 0.1, 0.14, 0, -0.02, -0.06, 0x200806), shard(0.05, 3.4, 0, 0.09, -0.08, 0x8a1810, HALF), shard(0.018, 2.4, 0.16, 0.14, 0.05, 0xff5020, 0, 0, -0.9, 0xff3010, 2), shard(0.018, 2.4, -0.16, 0.14, 0.05, 0xff5020, 0, 0, 0.9, 0xff3010, 2)] }),
};
const GUN_INFO = new Map();
export const gunInfo = (id) => {
  if (!GUN_INFO.has(id)) GUN_INFO.set(id, GUNS[id] ? GUNS[id]() : null);
  return GUN_INFO.get(id);
};
// Weapons are small next to a climber and the maps are dark: every part shines faintly in its own colour, so a gun reads
// against any background. Parts that glow keep their own glow.
const shine = (p) => (p.glow ? p : Object.assign({}, p, { glow: p.c, gk: 0.32 }));
for (const id of Object.keys(GUNS)) {
  GEAR[id] = () => { const g = gunInfo(id); return (Array.isArray(g) ? g : g ? g.p.flat() : []).map(shine); };
}

// ---------------------------------------------------------------- legendary extras: wings, things on the back, horns, crowns
// A wing is made for the left side (+x), from its root on the shoulder blade outwards; the right one is the same, mirrored.
const ell = (x, y, z, w, l, t, rz, c, glow, gk) => part(new THREE.SphereGeometry(1, 12, 7), M(x, y, z, w, l, t, 0, 0, rz), c, glow, gk);
const blade = (x, y, z, w, l, t, rz, c, glow, gk) => part(new THREE.OctahedronGeometry(1, 0), M(x, y, z, w, l, t, 0, 0, rz), c, glow, gk);
const stick = (a, b, r0, r1, c, glow, gk, z = 0) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  return part(new THREE.CylinderGeometry(r1, r0, L, 8), M((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, 1, 1, 1, 0, 0, Math.atan2(-dx, dy)), c, glow, gk);
};
// rows: [count, shortest, longest, width, from angle, to angle, depth, colour, glow, glow strength]
function featherWing(shape, bone, rows) {
  const out = [], along = (s) => [0.04 + 0.62 * s, 0.03 + 0.38 * s - 0.1 * s * s];
  for (let k = 0; k < 6; k++) out.push(stick(along(k / 6), along((k + 1) / 6), bone[0] * (1 - k * 0.1), bone[0] * (1 - (k + 1) * 0.1), bone[1], bone[2], bone[3]));
  for (const [n, l0, l1, w, a0, a1, z, c, glow, gk] of rows) for (let i = 0; i < n; i++) {
    const s = i / (n - 1), [bx, by] = along(0.1 + 0.9 * s), len = l0 + (l1 - l0) * s, rz = a0 + (a1 - a0) * s;
    out.push(shape(bx + Math.sin(rz) * len * 0.5, by - Math.cos(rz) * len * 0.5, z - s * 0.03, w, len / 2, 0.02, rz, c, glow, gk));
  }
  return out;
}
// Bones that spread from the wrist like fingers, with skin stretched between them.
function dragonWing(cb, cs, glow, gk) {
  const out = [], root = [0.03, 0.02], wr = [0.36, 0.34], tips = [[1.0, 0.5], [0.98, 0.08], [0.8, -0.3], [0.5, -0.46]];
  out.push(stick(root, wr, 0.036, 0.026, cb, glow, gk * 0.4));
  out.push(cone(0.028, 0.13, wr[0] + 0.03, wr[1] + 0.07, 0, cb, 0, -0.45, glow, gk));
  for (const t of tips) { out.push(stick(wr, t, 0.022, 0.01, cb, glow, gk * 0.6)); out.push(cone(0.014, 0.07, t[0] + (t[0] - wr[0]) * 0.06, t[1] + (t[1] - wr[1]) * 0.06, 0, cb, 0, Math.atan2(-(t[0] - wr[0]), t[1] - wr[1]), glow, gk)); }
  const pts = [], tri = (a, b, c) => { for (const p of [a, b, c]) pts.push(p[0], p[1], -0.05 * Math.hypot(p[0], p[1])); };
  const mid = (a, b, k = 0.7) => [wr[0] + ((a[0] + b[0]) / 2 - wr[0]) * k, wr[1] + ((a[1] + b[1]) / 2 - wr[1]) * k];
  for (let i = 0; i < tips.length - 1; i++) { const m = mid(tips[i], tips[i + 1]); tri(wr, tips[i], m); tri(wr, m, tips[i + 1]); }
  const low = [0.22, -0.34];
  tri(wr, tips[3], low); tri(root, wr, low); tri(root, low, [0.04, -0.22]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  out.push(part(g, M(0, 0, 0), cs, cs, 0.35));
  return out;
}
const curve = (side, c, glow, gk, big = 1) => {
  // A horn that sweeps up, out and back, in segments getting thinner.
  const out = [];
  let x = side * 0.11, y = 0.12, z = 0.03;
  for (let k = 0; k < 6; k++) {
    const t = k / 6, dx = side * 0.035 * big, dy = (0.07 - t * 0.05) * big, dz = -(0.015 + t * 0.06) * big, L = Math.hypot(dx, dy, dz), r0 = 0.05 * big * (1 - t * 0.75), r1 = 0.05 * big * (1 - (t + 1 / 6) * 0.75);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    out.push(part(new THREE.CylinderGeometry(r1, r0, L, 8), new THREE.Matrix4().compose(new THREE.Vector3(x + dx / 2, y + dy / 2, z + dz / 2), q, new THREE.Vector3(1, 1, 1)), c, k > 3 ? glow : 0, k > 3 ? gk : 0));
    x += dx; y += dy; z += dz;
  }
  return out;
};
const ringOf = (n, r, y, f) => { const out = []; for (let i = 0; i < n; i++) out.push(...f(Math.sin((i / n) * 6.283) * r, y, Math.cos((i / n) * 6.283) * r, (i / n) * 6.283, i)); return out; };

Object.assign(GEAR, {
  wings_angel: () => featherWing(ell, [0.03, 0xfff6e0, 0xffd070, 1.1], [
    [10, 0.34, 0.66, 0.058, 0.05, 1.0, -0.01, 0xfffaf0, 0xfff0c8, 0.6], [8, 0.2, 0.36, 0.052, 0.1, 0.85, 0.012, 0xffffff, 0xffe8b0, 0.75], [6, 0.11, 0.17, 0.046, 0.0, 0.55, 0.026, 0xfff8e8, 0xffd890, 1.0]]),
  wings_fire: () => featherWing(ell, [0.03, 0xff7a1a, 0xff4a10, 2.2], [
    [10, 0.36, 0.7, 0.05, 0.05, 1.05, -0.01, 0xffa030, 0xff5a10, 2.6], [8, 0.2, 0.36, 0.045, 0.1, 0.85, 0.012, 0xfff060, 0xffa020, 3.0], [6, 0.1, 0.16, 0.04, 0.0, 0.55, 0.026, 0xfffff0, 0xffd040, 3.4]]),
  wings_energy: () => featherWing(blade, [0.022, 0xc0ffff, 0x40e0ff, 3.0], [
    [9, 0.38, 0.74, 0.05, 0.05, 1.0, -0.01, 0x9ff4ff, 0x30d0ff, 2.6], [7, 0.2, 0.34, 0.045, 0.1, 0.8, 0.012, 0xe0ffff, 0x60e0ff, 3.0]]),
  wings_ice: () => featherWing(blade, [0.026, 0xe8fcff, 0x80d8ff, 1.8], [
    [9, 0.36, 0.7, 0.06, 0.05, 1.0, -0.01, 0xd8f6ff, 0x60c8ff, 1.3], [7, 0.2, 0.34, 0.05, 0.1, 0.8, 0.012, 0xffffff, 0x90e0ff, 1.9], [5, 0.1, 0.16, 0.04, 0.0, 0.5, 0.026, 0xffffff, 0xc0f0ff, 2.4]]),
  wings_void: () => featherWing(blade, [0.03, 0x100818, 0xa040ff, 1.8], [
    [9, 0.38, 0.74, 0.06, 0.05, 1.05, -0.01, 0x1a0a2a, 0x8020ff, 0.9], [7, 0.2, 0.34, 0.05, 0.1, 0.8, 0.012, 0x2a0f40, 0xc060ff, 1.7]]),
  wings_dragon: () => dragonWing(0x3a1610, 0x6a140c, 0xff6a20, 1.6),
  wings_dragon_sky: () => dragonWing(0x182a48, 0x1a5a9a, 0x80e0ff, 1.8),
  horns_dragon: () => [...curve(1, 0x7a5236, 0xffa040, 2.2), ...curve(-1, 0x7a5236, 0xffa040, 2.2)],
  horns_sky: () => [...curve(1, 0xe8f0ff, 0x80e0ff, 2.4, 0.9), ...curve(-1, 0xe8f0ff, 0x80e0ff, 2.4, 0.9)],
  crown_ice: () => [tor(0.19, 0.016, 0, 0.13, 0, 0xd8f6ff, Math.PI / 2, 0, 0x80d8ff, 1.6), ...ringOf(9, 0.18, 0.22, (x, y, z, a, i) => [part(new THREE.OctahedronGeometry(1, 0), M(x, y + (i % 2 ? 0 : 0.05), z, 0.035, i % 2 ? 0.1 : 0.17, 0.035, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3), 0xe8fcff, 0x70d0ff, 2)])],
  crown_void: () => [tor(0.17, 0.014, 0, 0.32, 0, 0x2a0f40, Math.PI / 2, 0, 0xb050ff, 2.4), tor(0.13, 0.01, 0, 0.36, 0, 0x2a0f40, Math.PI / 2, 0, 0xe0a0ff, 3),
    ...ringOf(7, 0.165, 0.42, (x, y, z, a) => [part(new THREE.OctahedronGeometry(1, 0), M(x, y, z, 0.03, 0.12, 0.03, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25), 0x1a0a2a, 0xa040ff, 1.6)]), sph(0.04, 0, 0.5, 0, 0xffffff, 1, 1, 1, 0xd080ff, 4)],
  // In the torso's own space: the hips are at 0, the shoulders at 0.46, the back at z -0.11.
  katana_back: () => {
    const A = [-0.24, 0.78], B = [0.2, 0.02], at = (k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k], z = -0.16;
    return [stick(at(0), at(0.2), 0.02, 0.02, 0x14161c, 0, 0, z), stick(at(0.21), at(0.215), 0.06, 0.06, 0xd8b040, 0, 0, z), stick(at(0.22), at(1.0), 0.012, 0.004, 0xbff8ff, 0x30f0ff, 2.6, z),
      ...[0.03, 0.08, 0.13, 0.18].map((k) => stick(at(k), at(k + 0.012), 0.024, 0.024, 0x30f0ff, 0x30f0ff, 2.2, z))];
  },
  scythe_back: () => {
    const A = [0.3, 0.98], B = [-0.28, -0.3], z = -0.17, top = [A[0] - 0.02, A[1] + 0.02];
    const arcGeo = new THREE.TorusGeometry(0.3, 0.026, 4, 20, 2.1);
    return [stick(A, B, 0.02, 0.02, 0x5a4a3c, 0x70ffc0, 0.25, z), stick(A, [A[0] - 0.02, A[1] + 0.05], 0.03, 0.03, 0x8a9494, 0, 0, z),
      part(arcGeo, M(top[0] - 0.3, top[1] - 0.06, z, 1, 1, 0.35, 0, 0, -0.2), 0xe0fff0, 0x70ffc0, 2.8), sph(0.035, A[0], A[1] + 0.03, z, 0x70ffc0, 1, 1, 1, 0x70ffc0, 3)];
  },
  orbs_void: () => ringOf(3, 0.6, 0.55, (x, y, z) => [sph(0.075, x, y, z, 0x14081c, 1, 1, 1, 0x8020ff, 1.2), tor(0.11, 0.008, x, y, z, 0xe0a0ff, Math.PI / 2 + 0.4, 0, 0xc060ff, 3)]),
  orbs_gold: () => ringOf(4, 0.58, 0.5, (x, y, z, a, i) => [sph(0.06, x, y, z, [0xffd040, 0xff70c0, 0x40e0ff, 0x70ff90][i], 1, 1, 1, [0xffb020, 0xff40a0, 0x20c0ff, 0x40ff70][i], 2.8)]),
  ring_diamond: () => [tor(0.6, 0.012, 0, 0.42, 0, 0xffffff, Math.PI / 2 + 0.3, 0, 0xc0f0ff, 2.6), tor(0.66, 0.008, 0, 0.42, 0, 0xffffff, Math.PI / 2 - 0.35, 0, 0x80d8ff, 2.2),
    ...ringOf(6, 0.6, 0.42, (x, y, z) => [part(new THREE.OctahedronGeometry(0.045, 0), M(x, y + z * 0.3, z, 1, 1.6, 1), 0xffffff, 0xc0f0ff, 3)])],
  ring_prism: () => [tor(0.62, 0.012, 0, 0.4, 0, 0xff70e0, Math.PI / 2 + 0.3, 0, 0xff40d0, 2.8), tor(0.62, 0.012, 0, 0.4, 0, 0x40e0ff, Math.PI / 2 - 0.3, 0, 0x30c0ff, 2.8), tor(0.7, 0.008, 0, 0.4, 0, 0xfff070, Math.PI / 2, 0, 0xffd040, 2.4)],
  ring_synth: () => [tor(0.6, 0.014, 0, 0.1, 0, 0xff40d0, Math.PI / 2, 0, 0xff40d0, 3), tor(0.6, 0.014, 0, 0.75, 0, 0x30f0ff, Math.PI / 2, 0, 0x30f0ff, 3)],
});
for (const id of ['wings_angel', 'wings_fire', 'wings_energy', 'wings_ice', 'wings_void', 'wings_dragon', 'wings_dragon_sky']) GEAR_AT[id] = 'wings';
for (const id of ['katana_back', 'scythe_back', 'orbs_void', 'orbs_gold', 'ring_diamond', 'ring_prism', 'ring_synth']) GEAR_AT[id] = 'back';
for (const id of ['orbs_void', 'orbs_gold', 'ring_diamond', 'ring_prism', 'ring_synth']) GEAR_ANIM[id] = 'spin';

// ---------------------------------------------------------------- epic extras: one thing each costume carries
// 'back' and 'chest' sit on the torso (its own space: the hips at 0, the shoulders at y 0.46, the back at z -0.105 and the chest
// at +0.105, the head's centre at y 0.72 with radius 0.2), 'hips' and 'tail' on the hips. On the shop's cards things on the back
// and tails are drawn behind the climber, the rest in front.
// A bent tube through points, thinner towards the end; col is a colour or gives one for each piece.
const tube = (pts, r0, r1, col, glow, gk, n = 8) => {
  const out = [], up = new THREE.Vector3(0, 1, 0), last = pts.length - 1;
  for (let k = 0; k < last; k++) {
    const a = pts[k], b = pts[k + 1], d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    out.push(part(new THREE.CylinderGeometry(r0 + ((r1 - r0) * (k + 1)) / last, r0 + ((r1 - r0) * k) / last, L * 1.06, n),
      new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)),
      typeof col === 'function' ? col(k) : col, glow, gk));
  }
  return out;
};
// Parts built round their own origin, moved and turned as one.
const place = (parts, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = M(x, y, z, 1, 1, 1, rx, ry, rz); return parts.map((p) => Object.assign({}, p, { m: m.clone().multiply(p.m) })); };
const rock = (r, x, y, z, c, t = 0, glow, gk) => part(new THREE.IcosahedronGeometry(r, 0), M(x, y, z, 1, 0.85, 1, t, t * 2, 0), c, glow, gk);
// Half a ring standing up, its ends at the sides.
const arch = (R, r, x, y, z, c, glow, gk) => part(new THREE.TorusGeometry(R, r, 5, 22, Math.PI), M(x, y, z), c, glow, gk);

Object.assign(GEAR, {
  // Ninja: a plain blade in a black scabbard, the grip bound in red.
  ninjato: () => {
    const A = [-0.2, 0.76], B = [0.2, -0.02], at = (k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k], z = -0.15;
    return [stick(at(0), at(0.24), 0.02, 0.02, 0xb01a24, 0, 0, z), ...[0.03, 0.08, 0.13, 0.18].map((k) => stick(at(k), at(k + 0.025), 0.022, 0.022, 0x14161c, 0, 0, z)),
      stick(at(0.245), at(0.265), 0.052, 0.052, 0xc8a040, 0, 0, z), stick(at(0.27), at(1), 0.024, 0.02, 0x101216, 0, 0, z),
      stick(at(0.45), at(0.48), 0.028, 0.028, 0xb01a24, 0, 0, z), stick(at(0.96), at(1), 0.025, 0.022, 0xc8a040, 0, 0, z)];
  },
  // Pirate: a parrot on the left shoulder.
  // Out past the edge of the head: the head is wide, and the shoulders are under it.
  parrot: () => {
    const x = 0.24, y = 0.58, z = -0.02, hx = x + 0.02;
    return [sph(0.055, x, y, z, 0xe0302a, 1, 1.35, 1.1), sph(0.046, hx, y + 0.085, z + 0.025, 0xe0302a),
      cone(0.017, 0.05, hx, y + 0.072, z + 0.085, 0xffc830, Math.PI / 2 + 0.5), sph(0.014, hx, y + 0.06, z + 0.062, 0x2a2a2a),
      ...[1, -1].flatMap((s) => [sph(0.012, hx + s * 0.03, y + 0.095, z + 0.05, 0xffffff), sph(0.006, hx + s * 0.034, y + 0.097, z + 0.059, 0x101010),
        sph(0.032, x + s * 0.046, y - 0.01, z - 0.01, 0x2a6ad8, 0.45, 1.4, 1.15), sph(0.02, x + s * 0.05, y - 0.05, z - 0.03, 0xffc830, 0.4, 1, 0.8),
        box(0.012, 0.03, 0.012, x + s * 0.016, y - 0.078, z + 0.012, 0x3a3a3a)]),
      box(0.04, 0.17, 0.012, x, y - 0.12, z - 0.07, 0x2a6ad8, 0.5), box(0.026, 0.13, 0.012, x, y - 0.1, z - 0.058, 0x30b040, 0.45)];
  },
  // Skeleton: two big crossed bones.
  bones_x: () => {
    const out = [];
    for (const s of [-1, 1]) {
      const a = [-0.16 * s, 0.5], b = [0.16 * s, 0.06], z = s > 0 ? -0.165 : -0.135, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), px = -dy / L, py = dx / L;
      out.push(stick(a, b, 0.022, 0.022, 0xefe8d4, 0, 0, z));
      for (const p of [a, b]) for (const k of [-1, 1]) out.push(sph(0.033, p[0] + px * k * 0.026, p[1] + py * k * 0.026, z, 0xefe8d4));
    }
    return out;
  },
  // Robot: twin jets with blue flames.
  jetpack: () => {
    const z = -0.2, out = [box(0.1, 0.26, 0.07, 0, 0.3, -0.14, 0x4a5464), box(0.24, 0.03, 0.08, 0, 0.42, -0.15, 0x363c48)];
    for (const s of [-1, 1]) {
      const x = s * 0.075;
      out.push(cyl(0.05, 0.05, 0.28, x, 0.3, z, 0xa8b2c0), sph(0.05, x, 0.44, z, 0xa8b2c0, 1, 0.7, 1), tor(0.051, 0.009, x, 0.36, z, 0xff4a3a),
        cyl(0.03, 0.044, 0.06, x, 0.135, z, 0x363c48), tor(0.03, 0.007, x, 0.104, z, 0x40e8ff, Math.PI / 2, 0, 0x40e8ff, 2.6),
        cyl(0.028, 0.002, 0.12, x, 0.04, z, 0xc8f8ff, 0, 0, 0x40e8ff, 3));
    }
    return out;
  },
  // Knight: a white shield with a red cross.
  shield_back: () => {
    const z = -0.16, y = 0.27;
    return [box(0.03, 0.2, 0.04, 0, y, -0.125, 0x5a4028), cyl(0.19, 0.19, 0.026, 0, y, z, 0xf0f0f0, Math.PI / 2), tor(0.19, 0.016, 0, y, z, 0xb8c0cc, 0),
      box(0.05, 0.3, 0.01, 0, y, z - 0.016, 0xc02a2a), box(0.3, 0.05, 0.01, 0, y + 0.03, z - 0.016, 0xc02a2a), sph(0.03, 0, y + 0.03, z - 0.02, 0xd8b040, 1, 1, 0.6)];
  },
  // Astronaut: the life support pack, its lights and the hose to the helmet.
  lifepack: () => {
    const z = -0.18;
    return [box(0.24, 0.34, 0.13, 0, 0.3, z, 0xeef0f4), box(0.25, 0.07, 0.136, 0, 0.43, z, 0xc8ccd4), box(0.25, 0.03, 0.136, 0, 0.16, z, 0xc8ccd4),
      box(0.13, 0.1, 0.01, 0.04, 0.27, z - 0.066, 0x2a3040), ...[0xff4040, 0x40ff70, 0x40c0ff].map((c, i) => sph(0.012, i * 0.03, 0.295, z - 0.072, c, 1, 1, 0.5, c, 3)),
      box(0.06, 0.035, 0.01, 0.05, 0.25, z - 0.072, 0x40c0ff, 0, 0, 0, 0x40c0ff, 0.8), ...[0, 1, 2].map((i) => box(0.07, 0.008, 0.01, -0.07, 0.22 + i * 0.03, z - 0.066, 0x8a96a8)),
      ...tube([[0.1, 0.44, -0.12], [0.15, 0.52, -0.06], [0.14, 0.58, 0.04]], 0.014, 0.014, 0x9aa2b0)];
  },
  // Zombie: somebody already tried.
  arrows: () => {
    const one = [cyl(0.008, 0.008, 0.34, 0, 0, -0.15, 0x8a6a40, Math.PI / 2), box(0.004, 0.05, 0.08, 0, 0, -0.29, 0xe8e0d0), box(0.05, 0.004, 0.08, 0, 0, -0.29, 0xd82a2a),
      cyl(0.011, 0.011, 0.012, 0, 0, -0.325, 0x2a2a2a, Math.PI / 2)];
    return [...place(one, 0.05, 0.36, -0.08, 0.5, 0.35), ...place(one, -0.06, 0.16, -0.08, -0.2, -0.3)];
  },
  // Mummy: a scarab on the chest, and loose ends of bandage at the back.
  scarab: () => [sph(0.032, 0, 0.36, 0.108, 0x2a6ad8, 1, 1.25, 0.45, 0x2a6ad8, 0.5), sph(0.016, 0, 0.405, 0.108, 0xd8b040, 1, 1, 0.5),
    ...[1, -1].map((s) => box(0.05, 0.022, 0.008, s * 0.042, 0.365, 0.106, 0xd8b040, 0, 0, s * 0.35)), ...tube([[-0.07, 0.47, 0.085], [0, 0.4, 0.112], [0.07, 0.47, 0.085]], 0.005, 0.005, 0xd8b040)],
  wraps: () => [[0.06, -0.02, 0.12, 0xd8cca8], [-0.045, -0.05, -0.1, 0xc8bc98], [0.01, 0.3, 0.2, 0xe0d6b4]].map(([x, y, rz, c], i) => box(0.04, 0.26, 0.006, x, y - 0.1, -0.11 - i * 0.004, c, 0.12, 0, rz)),
  // Clown: three balloons on strings.
  balloons: () => {
    const knot = [0, 0.4, -0.12], out = [];
    for (const [x, y, z, c] of [[0.02, 1.36, -0.46, 0xff3040], [0.2, 1.24, -0.42, 0xffd030], [-0.17, 1.26, -0.4, 0x3a8aff]]) {
      out.push(sph(0.12, x, y, z, c, 1, 1.18, 1, c, 0.3), cone(0.022, 0.035, x, y - 0.15, z, c, Math.PI),
        ...tube([knot, [x * 0.45, (knot[1] + y) / 2, (knot[2] + z) / 2 - 0.08], [x, y - 0.16, z]], 0.004, 0.004, 0xf4f4f4, 0, 0, 4));
    }
    return out;
  },
  // Santa: the sack, full of presents.
  sack: () => [sph(0.17, 0.02, 0.33, -0.25, 0x7a4a24, 1.05, 1.2, 0.82), tor(0.1, 0.02, 0.02, 0.53, -0.25, 0x5a3418, Math.PI / 2 + 0.2),
    box(0.11, 0.11, 0.11, -0.03, 0.57, -0.25, 0x2a9a4a, 0.3, 0.5), box(0.113, 0.022, 0.113, -0.03, 0.57, -0.25, 0xffd24a, 0.3, 0.5), box(0.022, 0.113, 0.113, -0.03, 0.57, -0.25, 0xffd24a, 0.3, 0.5),
    box(0.09, 0.09, 0.09, 0.08, 0.56, -0.29, 0x3a6ad8, -0.2, 0.3), box(0.092, 0.018, 0.092, 0.08, 0.56, -0.29, 0xffffff, -0.2, 0.3),
    cyl(0.028, 0.028, 0.14, 0.05, 0.6, -0.2, 0xe02030, 0.4, -0.3)],
  // Tuxedo: tails, and a rose.
  coattails: () => [1, -1].map((s) => box(0.085, 0.34, 0.014, s * 0.048, -0.1, -0.106, 0x14161c, 0.1, 0, s * 0.05)),
  rose: () => [sph(0.026, 0.072, 0.42, 0.085, 0xc01a2a, 1, 1, 0.7), tor(0.016, 0.007, 0.072, 0.42, 0.1, 0x8a0a1a, 0), box(0.03, 0.012, 0.006, 0.05, 0.4, 0.088, 0x2a8a3a, 0, 0, 0.6)],
  // Cowboy: a coiled lasso at the hip.
  lasso: () => [...[0, 1, 2].map((i) => tor(0.085 + i * 0.008, 0.01, -0.19 - i * 0.006, -0.03 + i * 0.01, 0, 0xc8a060, 0, Math.PI / 2)), box(0.012, 0.06, 0.03, -0.19, 0.06, 0, 0x6a4a22)],
  // Firefighter: the air tank and its hose.
  airtank: () => {
    const z = -0.19;
    return [cyl(0.075, 0.075, 0.34, 0, 0.27, z, 0xd8dce4), sph(0.075, 0, 0.44, z, 0xd8dce4, 1, 0.6, 1), sph(0.075, 0, 0.1, z, 0xd8dce4, 1, 0.5, 1),
      tor(0.077, 0.012, 0, 0.18, z, 0xf0e020, Math.PI / 2, 0, 0xf0ff60, 0.9), tor(0.077, 0.012, 0, 0.36, z, 0xf0e020, Math.PI / 2, 0, 0xf0ff60, 0.9),
      cyl(0.018, 0.018, 0.05, 0, 0.5, z, 0x2a2a2e), cyl(0.032, 0.032, 0.014, 0, 0.53, z, 0xd82a2a), box(0.2, 0.04, 0.05, 0, 0.3, -0.125, 0x2a2a2e),
      ...tube([[0, 0.53, z], [-0.08, 0.57, -0.17], [-0.15, 0.5, -0.05], [-0.14, 0.38, 0.09]], 0.012, 0.012, 0x2a2a2e)];
  },
  // Doctor: a stethoscope round the neck.
  stetho: () => {
    const c = 0x2a2e36;
    return [...tube([[0.1, 0.5, 0.05], [0.08, 0.53, -0.07], [0, 0.545, -0.115], [-0.08, 0.53, -0.07], [-0.1, 0.5, 0.05]], 0.008, 0.008, c),
      ...[1, -1].flatMap((s) => tube([[s * 0.1, 0.5, 0.05], [s * 0.075, 0.44, 0.1], [s * 0.03, 0.36, 0.112], [0, 0.34, 0.112]], 0.008, 0.008, c)),
      ...tube([[0, 0.34, 0.112], [0.02, 0.28, 0.114], [0.025, 0.24, 0.116]], 0.009, 0.009, c),
      cyl(0.03, 0.03, 0.014, 0.025, 0.225, 0.118, 0xc8d0dc, Math.PI / 2), cyl(0.02, 0.02, 0.016, 0.025, 0.225, 0.121, 0x9aa4b2, Math.PI / 2)];
  },
  // Super Stick: a golden belt with a shining buckle.
  belt_hero: () => [tor(0.1, 0.016, 0, 0.04, 0, 0xffd24a, Math.PI / 2, 0, 0xffb020, 0.4), box(0.07, 0.05, 0.02, 0, 0.04, 0.1, 0xffe070, 0, 0, 0, 0xffc040, 1.6)],
  // Tiger and zebra: tails.
  tail_tiger: () => [...tube([[0, 0.03, -0.09], [0, -0.02, -0.19], [0, -0.09, -0.29], [0.02, -0.13, -0.4], [0.04, -0.11, -0.51], [0.05, -0.04, -0.6], [0.05, 0.05, -0.65], [0.04, 0.13, -0.66]],
    0.036, 0.024, (k) => (k % 2 ? 0x17120a : 0xf08a1e)), sph(0.026, 0.04, 0.14, -0.66, 0x17120a)],
  tail_zebra: () => [...tube([[0, 0.03, -0.09], [0, -0.03, -0.17], [0, -0.13, -0.22], [0, -0.25, -0.24]], 0.022, 0.016, (k) => (k % 2 ? 0x121212 : 0xf4f4f4)), sph(0.05, 0, -0.34, -0.245, 0x121212, 0.7, 1.7, 0.7)],
  // Camouflage: an army rucksack with a bedroll.
  rucksack: () => {
    const z = -0.18;
    return [box(0.24, 0.3, 0.14, 0, 0.27, z, 0x4a5a30), box(0.245, 0.08, 0.15, 0, 0.4, z - 0.004, 0x3a4a26, -0.08), box(0.13, 0.1, 0.03, 0, 0.2, z - 0.08, 0x56663a),
      ...[1, -1].map((s) => box(0.05, 0.14, 0.1, s * 0.14, 0.22, z + 0.01, 0x56663a)),
      cyl(0.05, 0.05, 0.3, 0, 0.47, z, 0x2e3a22, 0, Math.PI / 2), ...[1, -1].map((s) => tor(0.052, 0.008, s * 0.08, 0.47, z, 0x1a1e12, 0, Math.PI / 2)),
      ...[1, -1].map((s) => box(0.03, 0.2, 0.012, s * 0.07, 0.29, -0.11, 0x2a3220))];
  },
  // Snow camo: skis and poles.
  skis_back: () => {
    const z = -0.21, out = [];
    for (const s of [-1, 1]) {
      out.push(box(0.05, 0.9, 0.014, s * 0.034, 0.28, z, 0xe8303a), box(0.012, 0.88, 0.016, s * 0.034, 0.28, z, 0xf4f4f4),
        box(0.05, 0.08, 0.014, s * 0.034, 0.75, z - 0.022, 0xe8303a, -0.7),
        cyl(0.007, 0.007, 0.86, s * 0.11, 0.26, -0.24, 0x3a424c, 0, s * 0.1), tor(0.03, 0.005, s * 0.153, -0.12, -0.24, 0x1a1a1a), cyl(0.012, 0.012, 0.08, s * 0.072, 0.64, -0.24, 0x1a1a1a, 0, s * 0.1));
    }
    out.push(...[0.12, 0.38].map((y) => box(0.16, 0.025, 0.12, 0, y, -0.165, 0x2a2f38)));
    return out;
  },
  // Galaxy: a ringed planet and a moon going round.
  planets: () => [sph(0.07, 0.46, 0.62, 0, 0xc890ff, 1, 1, 1, 0x8a40ff, 0.7), tor(0.12, 0.01, 0.46, 0.62, 0, 0xffe0a0, Math.PI / 2 + 0.45, 0, 0xffc060, 1.2),
    sph(0.04, -0.44, 0.78, 0.12, 0x9ff0ff, 1, 1, 1, 0x60d0ff, 1.4), sph(0.025, -0.1, 0.95, -0.42, 0xfff4b0, 1, 1, 1, 0xffe080, 2.4)],
  // Lava rock: smouldering stones on the shoulders.
  magma: () => {
    const out = [];
    for (const s of [-1, 1]) out.push(rock(0.075, s * 0.19, 0.5, -0.01, 0x2a120a, 0.3 * s), rock(0.05, s * 0.23, 0.47, 0.05, 0x3a1a0e, 0.7 * s), rock(0.045, s * 0.16, 0.52, -0.09, 0x2a120a, 1.1 * s),
      shard(0.02, 2.2, s * 0.2, 0.58, 0, 0xffa030, 0.3, 0, -s * 0.5, 0xff5a10, 3), shard(0.016, 2, s * 0.25, 0.52, -0.04, 0xffa030, -0.3, 0, -s * 0.8, 0xff5a10, 3),
      shard(0.014, 1.8, s * 0.17, 0.47, 0.06, 0xffa030, 0.4, 0, -s * 0.3, 0xff5a10, 2.6));
    return out;
  },
  // Frostbite: ice growing out of the shoulders.
  ice_spikes: () => {
    const out = [];
    for (const s of [-1, 1]) out.push(shard(0.03, 4, s * 0.2, 0.58, -0.02, 0xd8f6ff, 0, 0, -s * 0.6, 0x60c8ff, 1.3), shard(0.024, 3.4, s * 0.23, 0.53, 0.04, 0xd8f6ff, 0.3, 0, -s * 1, 0x60c8ff, 1.3),
      shard(0.022, 3, s * 0.17, 0.57, -0.08, 0xd8f6ff, -0.4, 0, -s * 0.3, 0x80d8ff, 1.6));
    return out;
  },
  // Solid gold: a thick chain and a medallion.
  bling: () => [tor(0.135, 0.013, 0, 0.47, 0, 0xffd24a, Math.PI / 2 + 0.55, 0, 0xffb020, 0.5),
    cyl(0.046, 0.046, 0.014, 0, 0.36, 0.115, 0xffd24a, Math.PI / 2, 0, 0xffb020, 0.6), tor(0.046, 0.008, 0, 0.36, 0.123, 0xfff0a0, 0, 0, 0xffc040, 1), sph(0.018, 0, 0.36, 0.123, 0xff2040, 1, 1, 0.6, 0xff2040, 2.4)],
  // Chrome: swept fins with glowing edges.
  fins: () => [[0, 0.36, 0.22, 0.15, 0], [0.09, 0.3, 0.16, 0.11, -0.35], [-0.09, 0.3, 0.16, 0.11, 0.35]].flatMap(([x, y, h, d, rz]) =>
    place([box(0.014, h, d, 0, 0, 0, 0xc8d0dc), box(0.018, h * 0.92, 0.012, 0, 0, -d / 2, 0x60e0ff, 0, 0, 0, 0x60e0ff, 2.2)], x, y, -0.1 - d / 2, -0.55, 0, rz)),
  // Wizard: a spellbook on the belt.
  spellbook: () => [tor(0.104, 0.009, 0, 0.03, 0, 0x5a3a1e), box(0.012, 0.06, 0.012, 0.2, 0.02, 0, 0x5a3a1e),
    ...place([box(0.05, 0.17, 0.13, 0, 0, 0, 0x4a1a7a), box(0.04, 0.16, 0.012, 0, 0, 0.06, 0xf0e6c8), box(0.006, 0.06, 0.06, 0.026, 0, 0, 0xffd24a, 0, 0, 0, 0xffc040, 2.2),
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => box(0.054, 0.025, 0.025, 0, a * 0.075, b * 0.055, 0xd8b040))], 0.215, -0.08, 0, 0, 0, 0.12)],
  // Vampire: a high collar, red inside, and a ruby brooch.
  collar: () => [part(new THREE.CylinderGeometry(0.24, 0.13, 0.22, 20, 1, true, Math.PI / 2 + 0.3, Math.PI - 0.6), M(0, 0.61, 0), 0x16101a),
    part(new THREE.CylinderGeometry(0.234, 0.124, 0.215, 20, 1, true, Math.PI / 2 + 0.32, Math.PI - 0.64), M(0, 0.61, 0), 0xa01020),
    sph(0.022, 0, 0.47, 0.104, 0xe01a2a, 1, 1, 0.5, 0xff2030, 1.6), tor(0.026, 0.006, 0, 0.47, 0.108, 0xd8b040, 0)],
  // Toxic: a glowing canister, piped round to the front.
  canister: () => {
    const z = -0.19;
    return [cyl(0.068, 0.068, 0.28, 0, 0.28, z, 0x9cff2a, 0, 0, 0x7aff20, 1.5), cyl(0.078, 0.078, 0.045, 0, 0.44, z, 0x2a2f38), cyl(0.078, 0.078, 0.045, 0, 0.12, z, 0x2a2f38),
      cyl(0.03, 0.03, 0.04, 0, 0.48, z, 0x3a404c), ...[0.2, 0.36].map((y) => tor(0.07, 0.01, 0, y, z, 0xffd030)),
      ...[[0.02, 0.22], [-0.03, 0.3], [0.025, 0.37]].map(([x, y]) => sph(0.016, x, y, z - 0.062, 0xf0ffb0, 1, 1, 1, 0xd0ff60, 2.6)),
      box(0.16, 0.04, 0.06, 0, 0.3, -0.13, 0x2a2f38), ...tube([[0, 0.5, z], [-0.1, 0.52, -0.16], [-0.17, 0.4, -0.03], [-0.17, 0.25, 0.05]], 0.011, 0.011, 0x2a2f38)];
  },
  // Rainbow: a rainbow over the shoulders, from cloud to cloud.
  rainbow_arc: () => [...[0xff3040, 0xff8a20, 0xffe030, 0x40d850, 0x30a0ff, 0x8050f0].map((c, i) => arch(0.33 - i * 0.022, 0.012, 0, 0.42, -0.24, c, c, 0.7)),
    ...[1, -1].flatMap((s) => [sph(0.06, s * 0.28, 0.42, -0.24, 0xffffff, 1.2, 0.8, 0.8), sph(0.045, s * 0.33, 0.44, -0.23, 0xffffff), sph(0.045, s * 0.23, 0.45, -0.25, 0xffffff)])],
  // Neon grid: a light disc on the back.
  disc_back: () => {
    const z = -0.15, y = 0.32;
    return [box(0.04, 0.12, 0.04, 0, y, -0.12, 0x14081c), cyl(0.125, 0.125, 0.02, 0, y, z, 0x14081c, Math.PI / 2), tor(0.125, 0.014, 0, y, z, 0xff2ad8, 0, 0, 0xff2ad8, 2.6),
      tor(0.07, 0.008, 0, y, z - 0.012, 0x30f0ff, 0, 0, 0x30f0ff, 2.4), sph(0.022, 0, y, z - 0.012, 0xffffff, 1, 1, 0.5, 0xff80f0, 2.6)];
  },
  // Pumpkin head: a pumpkin pail of sweets on the belt.
  candy_bucket: () => {
    const x = 0.26, y = -0.12, z = 0.02;
    return [tor(0.104, 0.009, 0, 0.03, 0, 0x2a1a0e), box(0.012, 0.09, 0.012, 0.21, 0.0, z, 0x2a1a0e, 0, 0, 0.4),
      sph(0.075, x, y, z, 0xee7a14, 1, 0.82, 1), tor(0.05, 0.01, x, y + 0.058, z, 0x2a1a0e), arch(0.06, 0.006, x, y + 0.06, z, 0x17120e),
      ...[1, -1].map((s) => cone(0.014, 0.022, x + s * 0.025, y + 0.01, z + 0.073, 0xffd040, Math.PI / 2, 0, 0xffa020, 2.6)), box(0.04, 0.012, 0.01, x, y - 0.025, z + 0.072, 0xffd040, 0, 0, 0, 0xffa020, 2.6),
      sph(0.016, x + 0.015, y + 0.07, z, 0xff3a6a), sph(0.014, x - 0.02, y + 0.068, z + 0.01, 0x40c0ff), sph(0.013, x, y + 0.072, z - 0.02, 0xffe040)];
  },
  // Samurai: a banner on a pole, high over the helmet.
  sashimono: () => {
    const z = -0.22, px = -0.07;
    return [cyl(0.01, 0.01, 1.08, px, 0.66, z, 0x2a1a10), cyl(0.008, 0.008, 0.27, px + 0.13, 1.19, z, 0x2a1a10, 0, Math.PI / 2),
      box(0.24, 0.48, 0.008, px + 0.13, 0.94, z, 0xc01a2a), cyl(0.07, 0.07, 0.012, px + 0.13, 0.95, z, 0xffd24a, Math.PI / 2, 0, 0xffb020, 0.4),
      ...[0.2, 0.42].map((y) => box(0.1, 0.03, 0.12, px, y, -0.16, 0x17141c))];
  },
});
// The epic costumes added in 4.10.6.
const leafy = (x, y, z, rz, c, k = 1) => part(new THREE.ConeGeometry(0.04 * k, 0.15 * k, 5), M(x, y, z, 1, 1, 0.3, 0, 0, rz), c);
Object.assign(GEAR, {
  // Deep diver: twin yellow tanks and the hose to the mouth.
  divetank: () => {
    const z = -0.2;
    return [...[1, -1].flatMap((sd) => [cyl(0.058, 0.058, 0.32, sd * 0.064, 0.27, z, 0xf0c020), sph(0.058, sd * 0.064, 0.43, z, 0xf0c020, 1, 0.6, 1), sph(0.058, sd * 0.064, 0.11, z, 0xf0c020, 1, 0.5, 1),
      tor(0.06, 0.008, sd * 0.064, 0.2, z, 0x2a2a2e), cyl(0.014, 0.014, 0.05, sd * 0.064, 0.49, z, 0x9aa4b2)]),
      box(0.2, 0.03, 0.05, 0, 0.34, -0.14, 0x2a2a2e), box(0.2, 0.03, 0.05, 0, 0.18, -0.14, 0x2a2a2e), cyl(0.026, 0.026, 0.16, 0, 0.51, z, 0x3a404c, 0, Math.PI / 2),
      ...tube([[0.08, 0.51, z], [0.15, 0.57, -0.1], [0.13, 0.6, 0.04], [0.06, 0.63, 0.15]], 0.013, 0.013, 0x2a2a2e)];
  },
  // Master chef: a ladle and a whisk on the apron string.
  ladle: () => [tor(0.104, 0.009, 0, 0.03, 0, 0xf4f4f4), box(0.012, 0.05, 0.012, 0.205, 0.0, 0.02, 0xc8d0dc),
    cyl(0.008, 0.008, 0.2, 0.215, -0.11, 0.05, 0xc8d0dc, 0, 0.12), sph(0.038, 0.226, -0.215, 0.05, 0xc8d0dc, 1, 0.55, 1),
    cyl(0.009, 0.009, 0.1, 0.205, -0.07, -0.05, 0x6a4a22), ...[0, 1, 2, 3].map((i) => tor(0.024, 0.003, 0.205, -0.15, -0.05, 0xc8d0dc, 0, i * 0.785))],
  // Sky pilot: a long white scarf, its end blowing back over the shoulder.
  scarf: () => [tor(0.11, 0.024, 0, 0.56, 0, 0xf4f0e8), ...tube([[0.05, 0.54, 0.1], [0.07, 0.46, 0.12], [0.08, 0.36, 0.12]], 0.026, 0.018, 0xf4f0e8),
    ...tube([[-0.07, 0.56, -0.08], [-0.13, 0.55, -0.18], [-0.2, 0.52, -0.28], [-0.27, 0.5, -0.36]], 0.026, 0.014, 0xe8e2d4)],
  // Viking: a round painted shield with an iron boss, and an axe behind it.
  roundshield: () => {
    const z = -0.17, y = 0.28;
    return [box(0.03, 0.2, 0.04, 0, y, -0.125, 0x5a4028), cyl(0.2, 0.2, 0.026, 0, y, z, 0x8a5a2a, Math.PI / 2), ...[0, 1, 2, 3, 4].map((i) => box(0.008, 0.36, 0.004, -0.15 + i * 0.075, y, z - 0.0145, 0x6a4220)),
      box(0.4, 0.045, 0.006, 0, y, z - 0.017, 0xc02a2a), box(0.045, 0.4, 0.006, 0, y, z - 0.018, 0xc02a2a), tor(0.2, 0.016, 0, y, z, 0x6a6e76, 0), sph(0.05, 0, y, z - 0.016, 0x9aa2b0, 1, 1, 0.6),
      cyl(0.012, 0.012, 0.5, 0.12, 0.36, -0.22, 0x6a4a22, 0, -0.5), box(0.02, 0.12, 0.1, 0.23, 0.56, -0.22, 0x9aa2b0, 0, 0, -0.5)];
  },
  // Pharaoh: a broad collar of gold, lapis and turquoise, and an ankh.
  pharaoh_collar: () => [part(new THREE.CylinderGeometry(0.15, 0.25, 0.14, 24, 1, true), M(0, 0.52, 0), 0xffd24a), part(new THREE.CylinderGeometry(0.152, 0.252, 0.05, 24, 1, true), M(0, 0.5, 0), 0x2a5ad8),
    part(new THREE.CylinderGeometry(0.154, 0.254, 0.02, 24, 1, true), M(0, 0.465, 0), 0x40c8b0),
    tor(0.03, 0.008, 0, 0.385, 0.122, 0xffd24a, 0, 0, 0xffb020, 0.6), box(0.016, 0.07, 0.01, 0, 0.3, 0.122, 0xffd24a, 0, 0, 0, 0xffb020, 0.6), box(0.07, 0.016, 0.01, 0, 0.345, 0.122, 0xffd24a, 0, 0, 0, 0xffb020, 0.6)],
  // Panda: bamboo over the back.
  bamboo_back: () => {
    const out = [box(0.24, 0.03, 0.05, 0, 0.32, -0.14, 0x3a6a22)];
    for (const [x, h, rz] of [[-0.06, 0.8, 0.12], [0.02, 0.92, -0.05], [0.09, 0.74, -0.18]]) {
      out.push(cyl(0.022, 0.026, h, x, 0.3, -0.18, 0x7aaa3a, 0, rz));
      for (let k = -2; k <= 2; k++) out.push(cyl(0.027, 0.027, 0.018, x - Math.sin(rz) * k * h * 0.2, 0.3 + Math.cos(rz) * k * h * 0.2, -0.18, 0x4a7a2a, 0, rz));
      const tx = x - Math.sin(rz) * h * 0.5, ty = 0.3 + Math.cos(rz) * h * 0.5;
      out.push(leafy(tx + 0.05, ty - 0.02, -0.18, -1.0, 0x5aa83a), leafy(tx - 0.05, ty - 0.05, -0.18, 1.0, 0x6ab84a), leafy(tx + 0.04, ty - 0.14, -0.18, -1.3, 0x5aa83a, 0.8));
    }
    return out;
  },
  // Fox: a big bushy tail with a white tip.
  tail_fox: () => [...tube([[0, 0.03, -0.09], [0, -0.04, -0.2], [0.02, -0.08, -0.33], [0.05, -0.04, -0.46], [0.06, 0.05, -0.54]], 0.045, 0.075, 0xe8701a), sph(0.08, 0.065, 0.11, -0.56, 0xf4f0e8, 0.9, 1.1, 0.9)],
  // Dino: plates down the back and a stubby tail.
  dino_plates: () => [0.5, 0.38, 0.26, 0.14, 0.02].map((y, i) => part(new THREE.OctahedronGeometry(0.075 - i * 0.007, 0), M(0, y, -0.14, 0.35, 1.2, 1), i % 2 ? 0xf0c030 : 0xe8a020)),
  tail_dino: () => [...tube([[0, 0.03, -0.09], [0, -0.06, -0.2], [0, -0.14, -0.32], [0, -0.18, -0.46]], 0.075, 0.02, 0x3a9a3a), ...[0, 1, 2].map((i) => part(new THREE.OctahedronGeometry(0.04, 0), M(0, 0.02 - i * 0.07, -0.18 - i * 0.11, 0.35, 1, 1), 0xf0c030))],
  // Shark: a tall dorsal fin.
  fin_shark: () => [part(new THREE.ConeGeometry(0.13, 0.32, 4), M(0, 0.42, -0.2, 0.22, 1, 1, -0.55), 0x5a6a7c), box(0.03, 0.2, 0.06, 0, 0.32, -0.13, 0x5a6a7c)],
  // Synthwave: a keytar slung on the back, its keys lit.
  keytar: () => place([box(0.5, 0.1, 0.03, 0, 0, 0, 0x1a1028), ...[...Array(12)].map((_, i) => box(0.024, 0.06, 0.006, -0.17 + i * 0.03, -0.005, -0.018, i % 3 ? 0xf4f4f4 : 0xff40d0, 0, 0, 0, i % 3 ? 0x40e0ff : 0xff40d0, 1.6)),
    box(0.16, 0.05, 0.03, 0.31, 0.02, 0, 0x2a1a40), box(0.12, 0.008, 0.006, 0, 0.045, -0.016, 0xff40d0, 0, 0, 0, 0xff40d0, 2.4), box(0.03, 0.2, 0.012, -0.1, 0.08, 0.03, 0x2a2a2e, 0, 0, 0.6)], 0, 0.3, -0.18, 0, 0, 0.5),
  // Circuit board: a processor on the back, its pins lit.
  chip_back: () => {
    const z = -0.14, y = 0.3, out = [box(0.2, 0.2, 0.02, 0, y, z, 0x1a1e24), box(0.12, 0.12, 0.012, 0, y, z - 0.014, 0x2a3038), box(0.05, 0.05, 0.006, 0, y, z - 0.021, 0x40ff90, 0, 0, 0, 0x40ff90, 2.2)];
    for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) { const d = -0.075 + i * 0.03; out.push(box(0.03, 0.01, 0.01, sd * 0.115, y + d, z, 0xd8b040, 0, 0, 0, 0xffc040, 0.6), box(0.01, 0.03, 0.01, d, y + sd * 0.115, z, 0xd8b040, 0, 0, 0, 0xffc040, 0.6)); }
    return out;
  },
  // Disco: a mirror ball on a pole over the shoulder, throwing coloured light.
  discoball: () => {
    const ball = new THREE.IcosahedronGeometry(0.1, 1);
    ball.computeVertexNormals();
    // Out to the side and up, so a big afro doesn't hide it.
    const bx = 0.3, by = 1.2, bz = -0.2;
    return [...tube([[0.12, 0.34, -0.15], [0.2, 0.75, -0.19], [bx, by - 0.1, bz]], 0.009, 0.009, 0x8a8e96), box(0.04, 0.05, 0.04, 0.12, 0.32, -0.14, 0x2a2a2e), part(ball, M(bx, by, bz), 0xe0e8f4, 0xffffff, 0.35),
      ...[[0.05, 0.03, 0.08, 0xff40d0], [-0.06, -0.02, 0.07, 0x40e0ff], [0.02, -0.07, -0.08, 0xffe040], [-0.04, 0.07, -0.07, 0x80ff60]].map(([x, y, z, c]) => sph(0.014, bx + x, by + y, bz + z, c, 1, 1, 1, c, 3))];
  },
  // Steampunk: brass cogs on the back, a pipe and a pressure gauge.
  cogs: () => {
    const wheel = (r, x, y, c) => [cyl(r, r, 0.03, x, y, -0.15, c, Math.PI / 2), cyl(r * 0.35, r * 0.35, 0.04, x, y, -0.155, 0x5a3a1a, Math.PI / 2),
      ...[...Array(8)].map((_, i) => box(r * 0.3, r * 0.3, 0.03, x + Math.cos(i * 0.785) * r, y + Math.sin(i * 0.785) * r, -0.15, c, 0, 0, i * 0.785))];
    return [...wheel(0.1, -0.04, 0.34, 0xc8a040), ...wheel(0.065, 0.1, 0.2, 0xb08a3a), ...wheel(0.05, 0.08, 0.46, 0xd8b050),
      ...tube([[-0.12, 0.1, -0.15], [-0.14, 0.3, -0.17], [-0.1, 0.5, -0.17], [-0.02, 0.56, -0.15]], 0.016, 0.016, 0xb07a3a),
      cyl(0.04, 0.04, 0.02, -0.15, 0.24, -0.19, 0xf0e8d0, Math.PI / 2), tor(0.04, 0.007, -0.15, 0.24, -0.2, 0xb07a3a, 0), box(0.004, 0.03, 0.004, -0.15, 0.25, -0.202, 0xc01a1a, 0, 0, 0.6)];
  },
  // Jester: a collar of points with a bell on each.
  bells: () => [tor(0.15, 0.02, 0, 0.56, 0, 0x8a1aa8), ...[...Array(8)].flatMap((_, i) => {
    const a = (i / 8) * Math.PI * 2, x = Math.sin(a) * 0.17, z = Math.cos(a) * 0.17;
    return [cone(0.045, 0.11, x, 0.5, z, i % 2 ? 0xffd030 : 0x8a1aa8, Math.PI), sph(0.022, x, 0.43, z, 0xffd24a, 1, 1, 1, 0xffb020, 0.6)];
  })],
  // Cactus: spines down the back and a pink flower on the shoulder.
  spines: () => [...[...Array(14)].map((_, i) => cone(0.008, 0.06, (i < 7 ? -1 : 1) * 0.06, 0.05 + (i % 7) * 0.075, -0.135, 0xf4ecd0, -Math.PI / 2)),
    sph(0.026, 0.14, 0.6, 0.02, 0xffe060), ...[0, 1, 2, 3, 4].map((k) => sph(0.03, 0.14 + Math.cos(k * 1.2566) * 0.04, 0.6, 0.02 + Math.sin(k * 1.2566) * 0.04, 0xff5aa0, 1, 0.4, 1))],
  // Thundercloud: a little storm cloud over the shoulder, throwing bolts.
  cloud_back: () => [sph(0.09, 0.2, 0.95, -0.12, 0x5a6070, 1.3, 0.8, 1), sph(0.07, 0.1, 0.93, -0.1, 0x6a7080), sph(0.07, 0.3, 0.92, -0.12, 0x4a505e), sph(0.06, 0.18, 1.0, -0.06, 0x6a7080),
    shard(0.018, 3, 0.16, 0.8, -0.12, 0xfff4a0, 0, 0, 0.4, 0xffe040, 3), shard(0.016, 2.6, 0.26, 0.78, -0.12, 0xfff4a0, 0, 0, -0.3, 0xffe040, 3), cyl(0.006, 0.006, 0.4, 0.1, 0.72, -0.14, 0x3a404c, 0, 0.3)],
  // Koi pond: two koi leaping round each other on the back.
  koi_back: () => {
    const fish = (x, y, rz, c, c2) => place([sph(0.05, 0, 0, 0, c, 0.7, 1.6, 0.6), sph(0.022, 0.02, 0.03, 0.02, c2, 1, 1.4, 0.6), part(new THREE.ConeGeometry(0.04, 0.07, 4), M(0, -0.1, 0, 1, 1, 0.25, Math.PI), c),
      sph(0.008, 0.018, 0.06, 0.025, 0x101010), sph(0.008, -0.018, 0.06, 0.025, 0x101010)], x, y, -0.18, 0, 0, rz);
    return [...fish(-0.07, 0.36, 0.6, 0xff6a20, 0xffffff), ...fish(0.08, 0.24, -2.5, 0xf4f4f4, 0xe02020), tor(0.14, 0.006, 0, 0.3, -0.16, 0x9ff0ff, 0, 0, 0x60d0ff, 1)];
  },
  // Amethyst: glowing crystals growing out of the back and shoulders.
  crystals_back: () => [[0, 0.42, -0.16, 4.2, 0.2], [0.09, 0.36, -0.15, 3.2, -0.4], [-0.08, 0.34, -0.15, 3.4, 0.45], [0.15, 0.56, -0.05, 2.6, -0.7], [-0.15, 0.56, -0.05, 2.6, 0.7], [0.02, 0.24, -0.15, 2.4, 0.1]]
    .map(([x, y, z, l, rz], i) => shard(0.032, l, x, y, z, i % 2 ? 0xc890ff : 0x9a5aff, -0.35, 0, rz, 0x8a40ff, 1.4)),
  // Battle mech: missile pods on both shoulders and a power pack.
  mech_pods: () => [...[1, -1].flatMap((sd) => [box(0.12, 0.1, 0.18, sd * 0.21, 0.63, -0.04, 0x4a5a6a), box(0.124, 0.022, 0.184, sd * 0.21, 0.69, -0.04, 0xf0b020), box(0.04, 0.06, 0.06, sd * 0.16, 0.56, -0.04, 0x2a3038),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([a, b]) => [cyl(0.02, 0.02, 0.02, sd * 0.21 + a * 0.03, 0.63 + b * 0.025, 0.052, 0x1a1e24, Math.PI / 2), sph(0.012, sd * 0.21 + a * 0.03, 0.63 + b * 0.025, 0.06, 0xff4030, 1, 1, 0.5, 0xff3020, 2.4)])]),
    box(0.16, 0.2, 0.06, 0, 0.36, -0.15, 0x3a4652), box(0.1, 0.012, 0.006, 0, 0.42, -0.183, 0xf0b020, 0, 0, 0, 0xf0b020, 2.2)],
  // Sakura: a paper parasol over the shoulder.
  parasol: () => place([cyl(0.008, 0.008, 0.9, 0, 0.45, 0, 0x6a3a22), part(new THREE.ConeGeometry(0.42, 0.15, 16, 1, true), M(0, 0.86, 0), 0xffc0d8),
    part(new THREE.ConeGeometry(0.2, 0.072, 16, 1, true), M(0, 0.903, 0), 0xff7aa8), tor(0.42, 0.008, 0, 0.785, 0, 0xc0306a), sph(0.02, 0, 0.94, 0, 0x6a3a22), cyl(0.014, 0.014, 0.12, 0, 0.02, 0, 0x2a1a10)],
  0.1, 0.12, -0.17, -0.35, 0, -0.35),
});
const EPIC_AT = {
  back: ['ninjato', 'bones_x', 'jetpack', 'shield_back', 'lifepack', 'arrows', 'wraps', 'balloons', 'sack', 'airtank', 'rucksack', 'skis_back', 'planets', 'fins', 'canister', 'rainbow_arc', 'disc_back', 'sashimono',
    'divetank', 'roundshield', 'bamboo_back', 'dino_plates', 'fin_shark', 'keytar', 'chip_back', 'discoball', 'cogs', 'spines', 'cloud_back', 'koi_back', 'crystals_back', 'parasol'],
  chest: ['parrot', 'scarab', 'rose', 'stetho', 'magma', 'ice_spikes', 'bling', 'collar', 'scarf', 'pharaoh_collar', 'bells', 'mech_pods'],
  hips: ['lasso', 'belt_hero', 'spellbook', 'candy_bucket', 'ladle'],
  tail: ['coattails', 'tail_tiger', 'tail_zebra', 'tail_fox', 'tail_dino'],
};
for (const [at, ids] of Object.entries(EPIC_AT)) {
  for (const id of ids) {
    GEAR_AT[id] = at;
    // Like the suits they come with, these shine faintly in their own colours, so they read in the dark maps.
    const make = GEAR[id];
    GEAR[id] = () => make().map((q) => (q.glow ? q : Object.assign({}, q, { glow: q.c, gk: 0.38, soft: true })));
  }
}
GEAR_ANIM.planets = 'spin';
GEAR_ANIM.hood_halo = 'spin';
GEAR_ANIM.hood_crown = 'rev';
// Taller than a hat: the shop draws the climber smaller so they fit on the card.
export const GEAR_TALL = new Set(['balloons', 'sashimono', 'discoball', 'cloud_back', 'parasol']);

// ---------------------------------------------------------------- palette and building
const PAL = [], PAL_W = 32;
function swatch(hex) {
  let i = PAL.indexOf(hex);
  if (i < 0) { i = PAL.length; PAL.push(hex); }
  return [((i % PAL_W) + 0.5) / PAL_W, 1 - (Math.floor(i / PAL_W) + 0.5) / PAL_W];
}

const PARTS = new Map();
export const gearParts = (id) => { if (!PARTS.has(id)) PARTS.set(id, GEAR[id] ? GEAR[id]() : []); return PARTS.get(id); };

let MAT = null;
// The phone gets the palette once, so all of it must exist before the first hat is shown.
export function gearMat() {
  if (MAT) return MAT;
  for (const id of Object.keys(GEAR)) for (const p of gearParts(id)) swatch(p.c);
  const c = document.createElement('canvas');
  c.width = c.height = PAL_W * 16;
  const g = c.getContext('2d');
  PAL.forEach((hex, i) => { g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.fillRect((i % PAL_W) * 16, Math.floor(i / PAL_W) * 16, 16, 16); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  MAT = panelMat(0xffffff, { map: tex, roughness: 0.62, metalness: 0.05, pattern: 0, side: THREE.DoubleSide });
  return MAT;
}

// The same shape for the other side: x turned round, and each triangle the other way round so it still faces out.
const MIRRORS = new Map();
export function gearGeoMirror(id) {
  if (MIRRORS.has(id)) return MIRRORS.get(id);
  const src = gearGeo(id), out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'aGlow']) {
    const a = src.attributes[name].array, n = src.attributes[name].itemSize, b = new Float32Array(a.length);
    for (let v = 0; v < a.length / n; v++) {
      const from = v - (v % 3) + [0, 2, 1][v % 3];
      for (let k = 0; k < n; k++) b[v * n + k] = a[from * n + k] * ((name === 'position' || name === 'normal') && k === 0 ? -1 : 1);
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(b, n));
  }
  out.computeBoundingSphere();
  MIRRORS.set(id, out);
  return out;
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
const _v = new THREE.Vector3(), VIEWS = { head: new THREE.Euler(-0.18, -0.55, 0), gun: new THREE.Euler(-0.14, 1.28, 0), front: new THREE.Euler(-0.12, 0, 0) };
// view: 'head' for hats, 'gun' from the side, 'front' for things on the back.
export function gearTris(id, view = 'head') {
  const gun = view === 'gun', out = [], rot = new THREE.Matrix4().makeRotationFromEuler(VIEWS[view]);
  for (const p of gearParts(id)) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m), a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 9) {
      const t = [];
      for (let k = 0; k < 3; k++) { _v.set(a[i + k * 3], a[i + k * 3 + 1], a[i + k * 3 + 2]).applyMatrix4(rot); t.push(_v.x, _v.y, _v.z); }
      const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (nz < 0) continue; // faces away
      const lit = p.glow && !p.soft ? 1.15 : 0.55 + 0.45 * Math.max(0, nx * -0.3 + ny * 0.6 + nz * 0.74), bright = gun && !p.glow ? 1.5 : 1;
      out.push([t[0], t[1], t[3], t[4], t[6], t[7], (t[2] + t[5] + t[8]) / 3, Math.min(255, (p.c >> 16 & 255) * lit * bright + (gun ? 18 : 0)), Math.min(255, (p.c >> 8 & 255) * lit * bright + (gun ? 18 : 0)), Math.min(255, (p.c & 255) * lit * bright + (gun ? 18 : 0))]);
    }
    g.dispose();
  }
  out.sort((a, b) => a[6] - b[6]);
  return out;
}
