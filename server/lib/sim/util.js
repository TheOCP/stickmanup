// Copied from assets/js by dev/makesim.mjs. Do not edit here.
// Small shared helpers. No three.js here so the simulation code can run under node for tests.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Deterministic PRNG (mulberry32): every phone must build the exact same tower.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless hash of an integer to [0,1), used for time-based storm schedules.
export function hash(n) {
  let x = Math.imul((n | 0) ^ 0x27d4eb2d, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('smu.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('smu.' + k, JSON.stringify(v));
    } catch (e) {}
    if (store.watch) store.watch(k);
  },
  del(k) {
    try {
      localStorage.removeItem('smu.' + k);
    } catch (e) {}
    if (store.watch) store.watch(k);
  },
  // Told about every change (the account keeps progress up to date this way).
  watch: null,
};

export const r3 = (v) => Math.round(v * 1000) / 1000;
