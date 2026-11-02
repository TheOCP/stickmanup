// Procedural but deterministic climbs, built zone by zone from hand-tuned templates. Every phone
// generates the identical level from the map's seed. Each map has its own route:
//   storm  - 'spiral': round and round the tower, counter-clockwise
//   sunny  - 'switchback': back and forth across the lighthouse in two lanes, turning at the ends
//   forest - 'trees': clockwise round the giant trunk, with branch walks out to side trees and up around them
import { makeBox, makeCyl } from './physics.js';
import { TAU, rng, clamp, angDiff } from './util.js';

export const LEVEL_VERSION = 8;
export const CORE_R = 6;
export const HEAD = 4.2; // minimum vertical spacing between layers of the route

export const DIFFS = [
  { id: 0, name: 'Easy', rope: 7.5, storm: 0.7, grip: 0.7, desc: 'Checkpoints in every zone, a long cord and a calmer storm.' },
  { id: 1, name: 'Normal', rope: 6.2, storm: 1.0, grip: 1.0, desc: 'Three checkpoints on the whole climb. The full storm.' },
  { id: 2, name: 'Hardcore', rope: 5.2, storm: 1.15, grip: 1.3, desc: 'No checkpoints and a short cord. A fall is a fall.' },
];

// Three maps, seven zones each. tpl = template weights; pattern = surface look (1 metal panels, 2 stone, 3 wood).
const Z = (name, sub, y1, color, tint, fog, sx, sz, gap, tpl, extra) => Object.assign({ name, sub, y1, color, tint, fog, sx, sz, gap, tpl }, extra);
export const MAPS = [
  {
    id: 0, key: 'storm', name: 'Storm Tower', desc: 'A neon tower in a lightning storm at night. When lightning marks you, SHIELD up. Lasers, rods, fans and ice.',
    seed: 77031, core: 'tower', pattern: 1, accent: '#3ff0d0', route: 'spiral',
    zones: [
      Z('Flooded Docks', 'SHIELD when lightning marks you', 100, 0x3ff0d0, 0x3d4652, 0x0b1820, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, crates: 2, laser: 1 }),
      Z('Turbine Halls', 'Cross between the gusts', 208, 0xff8a3d, 0x4a3d37, 0x1a1210, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, mover: 3, spinner: 2, fan: 3, stairs: 1, grapple: 1, laser: 2, swing: 1 }),
      Z('Lightning Rods', 'GRAB when the rods glow', 316, 0x9b7bff, 0x3b3858, 0x100d22, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { gap: 3, rods: 4, beam: 2, pad: 2, pillars: 1, door: 1, gate: 2, laser: 1 }),
      Z('Broken Elevator Shaft', 'Ride it up', 424, 0xffc23d, 0x4a4433, 0x18140a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { gap: 3, lift: 3, mover: 2, crumble: 3, stairs: 1, grapple: 1, gate: 2, swing: 1 }),
      Z('Floating Wreckage', 'Nothing here stands still', 532, 0xff4fb4, 0x4a3446, 0x1a0c18, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { gap: 2, tilt: 3, bob: 3, crumble: 2, pad: 1, beam: 1, door: 1, laser: 2, arrows: 1 }),
      Z('Ice Crown', 'Slippery when frozen', 640, 0x8fe9ff, 0x6a8292, 0x0e1a24, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { gap: 4, pillars: 2, beam: 2, iceslope: 2, bob: 1, grapple: 1, gate: 2, laser: 1 }, { ice: true }),
      Z('Eye of the Storm', 'Everything at once', 745, 0xffd76a, 0x5a4f40, 0x1c160c, [1.6, 2.5], [1.6, 2.4], [1.9, 3.0], { gap: 2, lift: 1, spinner: 1, rods: 2, crumble: 2, mover: 1, pillars: 1, beam: 1, tilt: 1, grapple: 1, door: 1, laser: 2, gate: 2 }),
    ],
  },
  {
    id: 1, key: 'sunny', name: 'Sunny Isles', desc: 'A white lighthouse over a turquoise sea. Zig-zag up past arrow traps and swinging platforms.',
    seed: 51207, core: 'lighthouse', pattern: 2, accent: '#ffb703', route: 'switchback',
    zones: [
      Z('Sandy Pier', 'Back and forth, up and up', 100, 0x2ec4b6, 0xd9c49c, 0x9fd3ef, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, crates: 2, swing: 1, arrows: 1 }),
      Z('Coral Cliffs', 'Bounce and crumble', 208, 0xff6b6b, 0xe3a47e, 0x9fd3ef, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, mover: 3, pad: 2, crumble: 2, grapple: 1, arrows: 2, swing: 2 }),
      Z('Lighthouse Steps', 'Round and round', 316, 0xe63946, 0xeeeeee, 0xa6d8f2, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { stairs: 2, gap: 3, spinner: 2, beam: 2, door: 1, arrows: 2, mover: 2 }),
      Z('Cloud Gardens', 'Floating in the breeze', 424, 0x5fa8d3, 0xf4f8fb, 0xb3defa, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { bob: 3, pad: 2, gap: 2, grapple: 1, tilt: 1, swing: 2, mover: 2 }),
      Z('Sky Bridges', 'Mind the gaps', 532, 0xffb703, 0xd6c7a1, 0xb9e0f7, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { beam: 3, mover: 2, tilt: 2, door: 1, gap: 2, arrows: 2, gate: 1 }),
      Z('Sun Spire', 'Hot and high', 640, 0xfb8500, 0xf3dfa2, 0xc4e6fa, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { lift: 2, crumble: 2, gap: 2, grapple: 1, spinner: 1, swing: 2, arrows: 2 }),
      Z('Golden Summit', 'Almost in the sun', 745, 0xffd60a, 0xf0d58d, 0xd0ecfb, [1.6, 2.5], [1.6, 2.4], [1.9, 3.0], { gap: 2, lift: 1, spinner: 1, crumble: 2, mover: 1, pillars: 1, beam: 1, tilt: 1, grapple: 1, door: 1, arrows: 2, swing: 2, gate: 1 }),
    ],
  },
  {
    id: 2, key: 'forest', name: 'Wild Forest', desc: 'Climb a giant tree in a misty forest. Monsters and bats try to knock you off.',
    seed: 90913, core: 'tree', pattern: 3, accent: '#9be564', route: 'trees',
    zones: [
      Z('Mossy Roots', 'Watch out for monsters', 100, 0x9be564, 0x6b5338, 0x6f8f86, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 4, stairs: 2, pillars: 2, beam: 2, monster: 1, crates: 1, arrows: 1 }),
      Z('Mushroom Grove', 'Bouncy and dangerous', 208, 0xff7eb6, 0x6d4c41, 0x7a7f8f, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { pad: 3, gap: 3, monster: 2, pillars: 1, grapple: 1, arrows: 2, swing: 1 }),
      Z('Hollow Trunk', 'Up through the tree', 316, 0xffc857, 0x5a4330, 0x8a7a5e, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { lift: 2, stairs: 2, door: 1, gap: 2, monster: 1, arrows: 2, mover: 2 }),
      Z('Vine Tangle', 'Swing from the hooks', 424, 0x7cfc00, 0x4a5a3a, 0x5f8a6a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { grapple: 3, beam: 2, bob: 1, monster: 1, gap: 1, swing: 3 }),
      Z('Firefly Canopy', 'Bats in the dark', 532, 0xf9f871, 0x3e5244, 0x34504a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { bats: 3, gap: 2, crumble: 2, mover: 2, monster: 1, arrows: 2 }),
      Z('Thorn Crown', 'Everything bites', 640, 0xff5d5d, 0x574436, 0x7a5a50, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { monster: 3, tilt: 2, gap: 2, door: 1, bats: 1, arrows: 2, swing: 1 }),
      Z('Treetop Sanctum', 'The top of the world', 745, 0xc6ff8f, 0x6a5a44, 0x9ec4a8, [1.6, 2.5], [1.6, 2.4], [1.9, 3.0], { gap: 2, monster: 2, bats: 1, grapple: 1, crumble: 1, pillars: 1, beam: 1, door: 1, arrows: 2, swing: 2 }),
    ],
  },
  {
    id: 3, key: 'volcano', name: 'Magma Chimney', desc: 'Climb the inside of a giant volcano. Ride lava geysers up and dodge falling rocks.',
    seed: 30517, core: 'crater', pattern: 2, accent: '#ff6a2a', route: 'crater',
    zones: [
      Z('Lava Lake', 'Stand on a vent and ride the eruption', 100, 0xff6a2a, 0x3a2a26, 0x2a0e08, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, geyser: 2, crumble: 1 }),
      Z('Ash Vents', 'Watch for shadows from above', 208, 0xff9a3d, 0x3d2e28, 0x2a120a, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, geyser: 3, rocks: 2, mover: 2, bob: 1, grapple: 1 }),
      Z('Obsidian Spires', 'Glassy and sharp', 316, 0xb06bff, 0x2a2430, 0x1a0c18, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { pillars: 3, gap: 3, rocks: 2, lift: 2, crumble: 2, door: 1 }),
      Z('Magma Falls', 'Rocks raining down', 424, 0xff4a2a, 0x40261e, 0x2e0c06, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { rocks: 3, gap: 3, swing: 2, geyser: 2, tilt: 1, grapple: 1 }),
      Z('Cinder Bridges', 'Mind the drop', 532, 0xffc23d, 0x3a3026, 0x26140a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { beam: 3, gap: 2, crumble: 3, bob: 2, geyser: 1, door: 1 }),
      Z('Fire Throat', 'Hot, hot, hot', 640, 0xff3a1a, 0x3a1e18, 0x300a04, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { geyser: 3, rocks: 3, mover: 2, gap: 2, lift: 1, grapple: 1 }),
      Z('Crater Rim', 'Out into the sky', 745, 0xffd76a, 0x4a3a30, 0x1c120c, [1.6, 2.5], [1.6, 2.4], [1.9, 3.0], { gap: 2, geyser: 2, rocks: 2, crumble: 2, pillars: 1, beam: 1, swing: 1, door: 1 }),
    ],
  },
  {
    id: 4, key: 'city', name: 'Neon Skyline', desc: 'Hop around a ring of skyscrapers on sky bridges and ziplines. Conveyors, drones and laser gates.',
    seed: 64229, core: 'spire', pattern: 1, accent: '#ff4fd8', route: 'towers',
    zones: [
      Z('Harbor Roofs', 'Climb a tower, cross to the next', 100, 0x3fd0ff, 0x2a3040, 0x3a2a4a, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, beam: 2, conveyor: 2, crates: 1 }),
      Z('Neon Alley', 'Conveyors everywhere', 208, 0xff4fd8, 0x2e2a3e, 0x40284a, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { conveyor: 3, gap: 3, gate: 2, mover: 2, grapple: 1 }),
      Z('Drone Patrol', 'Shoot them down', 316, 0x7cff6a, 0x283440, 0x2a3048, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { bats: 3, gap: 3, conveyor: 2, lift: 2, door: 1 }),
      Z('Billboard Heights', 'Ride the lifts', 424, 0xffb43d, 0x34303a, 0x4a2e3a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { lift: 3, mover: 3, gap: 2, swing: 1, gate: 1, conveyor: 1 }),
      Z('Sky Gardens', 'Green on the roofs', 532, 0x6aff9e, 0x2c3a34, 0x36344a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { gap: 3, bob: 2, tilt: 2, crumble: 2, bats: 2, grapple: 1 }),
      Z('Antenna Forest', 'Lasers and wind', 640, 0xa080ff, 0x2a2840, 0x241c3a, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { gate: 3, laser: 2, conveyor: 2, gap: 2, bats: 1, door: 1 }),
      Z('Spire Crown', 'The tallest roof in town', 745, 0xffe066, 0x3a3440, 0x2a1e3a, [1.6, 2.5], [1.6, 2.4], [1.9, 3.0], { gap: 2, conveyor: 2, gate: 2, bats: 2, lift: 1, mover: 1, grapple: 1 }),
    ],
  },
];
export const ZONES = MAPS[0].zones;

const PR_TOP = 0.6;
const SIGNS = [
  'Climb to the very top. You are tied together: if one falls, everyone feels it.',
  'Jump across the gaps. Stay close: the cord only reaches so far.',
  'Partner slipping? Hold GRAB to clamp on and hold them up.',
  'Hold REEL to pull the cord in and haul a hanging partner up.',
  'While clamped, hold REEL, then let go: you fling your partner upward.',
  'Fall into the ocean and the team restarts from the last checkpoint.',
];

export function cpEnabled(cp, diff) {
  if (cp.start) return true;
  if (diff === 0) return true;
  if (diff === 1) return !!cp.normal;
  return false;
}

export function zoneAt(level, y) {
  for (let i = level.zones.length - 1; i >= 0; i--) if (y >= level.zones[i].y0 - 0.5) return i;
  return 0;
}

export function generateLevel(mapId = 0) {
  const MAP = MAPS[mapId] || MAPS[0], ZONE_LIST = MAP.zones;
  const R = rng(MAP.seed);
  const rr = (a, b) => a + R() * (b - a);
  const out = {
    map: MAP.id, mapKey: MAP.key, core: MAP.core, pattern: MAP.pattern,
    cols: [], rings: [], decor: [], cps: [], fans: [], rods: [], signs: [], crumbles: [], zones: [],
    anchors: [], doors: [], monsters: [], bats: [], lasers: [], arrows: [], swings: [], trees: [], geysers: [], rocks: [], towers: [],
    plats: 0, spawn: null, summit: null, top: 0,
  };
  const recs = [], buckets = [];
  let TAG = 'start';
  let zone = 0, ZD = ZONE_LIST[0], zonePlats = 0, lastY = 2;
  // Route frame: platforms are placed in polar coordinates around (CX, CZ), going round in direction DIR,
  // with centres between BAND.lo (+ half the platform depth) and BAND.hi.
  const ROUTE = MAP.route || 'spiral', MAIN = ROUTE === 'crater' ? { lo: 10.0, hi: 16.5 } : { lo: 7.5, hi: 14.2 };
  let CX = 0, CZ = 0, DIR = ROUTE === 'trees' || ROUTE === 'crater' ? -1 : 1, BAND = MAIN, pathLen = 0, lastP = null;
  const intro = { grapple: false, door: false, monster: false };

  const add = (c, kind, extra) => {
    c.kind = kind; c.zone = zone;
    if (extra) Object.assign(c, extra);
    out.cols.push(c);
    return c;
  };
  const polar = (th, r) => [CX + Math.cos(th) * r, CZ + Math.sin(th) * r];
  const virt = (th, r, y, sx, sz) => {
    const [x, z] = polar(th, r);
    return { th, r, y, sx, sz, x, z, ry: -(th + Math.PI / 2) };
  };
  // Footprints of everything walkable, as oriented rectangles in world space (x, z, half sizes, yaw)
  // with their height and how far along the route they were placed. Bucketed by height for speed.
  // h = clear height needed above it (HEAD for anything you stand on; less for hooks and door frames).
  function recBox(x, z, hx, hz, ry, y, h = HEAD) {
    const q = { x, z, hx, hz, ry, y, h, pl: pathLen, rad: Math.hypot(hx, hz), c: Math.cos(ry), s: Math.sin(ry), tag: TAG };
    recs.push(q);
    const k = Math.max(0, Math.floor(y / 4));
    (buckets[k] || (buckets[k] = [])).push(q);
    return q;
  }
  function rec(p) {
    if (p.x !== undefined && p.ry !== undefined) return recBox(p.x, p.z, p.sx / 2, p.sz / 2, p.ry, p.y);
    const [x, z] = polar(p.th, p.r);
    return recBox(x, z, p.sx / 2, p.sz / 2, -(p.th + Math.PI / 2), p.y);
  }

  // How much higher than y a new footprint must go to clear everything placed earlier on the route that
  // it overlaps from above: it must sit q.h above anything below it, and HEAD below anything above it.
  // (The last few metres of route are its own neighbours and are skipped.) Negative = no conflict.
  const RECENT = 14;
  function need(x, z, hx, hz, ry, y) {
    let m = -1e9;
    const a = { x, z, hx, hz, c: Math.cos(ry), s: Math.sin(ry), rad: Math.hypot(hx, hz) };
    const k1 = Math.min(buckets.length - 1, Math.floor((y + HEAD) / 4) + 1);
    for (let k = Math.max(0, Math.floor((y - HEAD) / 4)); k <= k1; k++) {
      const B = buckets[k];
      if (!B) continue;
      for (const q of B) {
        if (q.y + q.h <= y || q.y - y >= HEAD || q.y + q.h <= m || q.pl > pathLen - RECENT) continue;
        const dx = q.x - x, dz = q.z - z, rr2 = q.rad + a.rad + 0.3;
        if (dx * dx + dz * dz > rr2 * rr2 || !overlap(a, q, 0.3)) continue;
        m = q.y + q.h;
      }
    }
    return m - y;
  }
  const needAt = (th, r, sx, sz, y) => { const [x, z] = polar(th, r); return need(x, z, sx / 2, sz / 2, -(th + Math.PI / 2), y); };

  function plat(th, r, y, sx, sz, o = {}) {
    const t = o.thick || 0.7;
    const [x, z] = polar(th, r);
    const ry = -(th + Math.PI / 2) + (o.dry || 0);
    // Last-moment fix: lift a platform a little if it would sit too close under or over older route.
    if (!o.norec) { const nd = need(x, z, sx / 2, sz / 2, ry, y); if (nd > 0 && nd <= 0.6) y += nd; }
    const surf = o.surf !== undefined ? o.surf : ZD.ice ? 'ice' : null;
    const c = add(makeBox(x, y - t / 2, z, sx / 2, t / 2, sz / 2, 0, ry, 0), o.kind || 'plat', { surf });
    const p = { th, r, y, sx, sz, x, z, ry, col: c };
    if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
    lastP = p;
    lastY = y;
    if (!o.norec) rec(p);
    out.plats++;
    zonePlats++;
    if (zone === 0 && !o.nosign) maybeSign(p);
    return p;
  }

  function maybeSign(p) {
    const at = { 2: 1, 6: 2, 11: 3, 16: 4, 22: 5 }[zonePlats];
    if (at === undefined) return;
    sign(p, SIGNS[at]);
  }

  function sign(p, text) {
    const [ox, oz] = polar(p.th, p.r + p.sz / 2 + 0.8);
    out.signs.push({ x: ox, y: p.y + 2.4, z: oz, text });
  }

  function support(p, ux, uz) {
    const ax = Math.cos(p.ry), az = -Math.sin(p.ry), bx = Math.sin(p.ry), bz = Math.cos(p.ry);
    return (Math.abs(ux * ax + uz * az) * p.sx) / 2 + (Math.abs(ux * bx + uz * bz) * p.sz) / 2;
  }
  function gapTo(a, th, r, sx, sz) {
    const b = virt(th, r, 0, sx, sz);
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    return d - support(a, dx / d, dz / d) - support(b, dx / d, dz / d);
  }
  // Angle for the next platform so the edge-to-edge gap along the line between centres is g.
  function thetaFor(a, g, r, sx, sz) {
    let lo = 0.01, hi = 2.2;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (gapTo(a, a.th + DIR * mid, r, sx, sz) < g) lo = mid;
      else hi = mid;
    }
    return a.th + DIR * (lo + hi) / 2;
  }
  // Near the summit everything stays outside the summit disc's footprint.
  const finalStretch = () => zone === ZONE_LIST.length - 1 && lastY > ZD.y1 - 18;
  const rLo = (sz) => (finalStretch() && BAND === MAIN ? 10.4 + sz / 2 : BAND.lo + sz / 2);
  const nextR = (cur, sz) => clamp(cur.r + rr(-1.6, 1.6), rLo(sz), Math.max(rLo(sz), BAND.hi));
  const size = () => [rr(ZD.sx[0], ZD.sx[1]), rr(ZD.sz[0], ZD.sz[1])];
  const between = (a, b, inset) => {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const sa = support(a, ux, uz) - inset, sb = support(b, ux, uz) - inset;
    return { ax: a.x + ux * sa, az: a.z + uz * sa, bx: b.x - ux * sb, bz: b.z - uz * sb, ux, uz, ry: Math.atan2(-uz, ux) };
  };

  // Switchback lanes (sunny) and side trees (forest).
  const LANES = { inner: { lo: 7.6, hi: 10.0 }, outer: { lo: 12.6, hi: 15.6 } };
  const SAT_D = 27, SAT_TR = 2.6;
  // City: five skyscrapers in a ring round the central spire; the route climbs round one, crosses to the next.
  const TOWERS = [], TW = 4.2, TBAND = { lo: TW * Math.SQRT2 + 1.3, hi: TW * Math.SQRT2 + 5.2 };
  let tower = -1, visitStart = 0, visitLaps = 1;
  if (ROUTE === 'towers') {
    for (let k = 0; k < 5; k++) {
      const a = 0.45 + (k / 5) * TAU, x = Math.cos(a) * 28, z = Math.sin(a) * 28;
      TOWERS.push({ x, z, a, half: TW });
    }
    out.towers = TOWERS;
  }
  function newVisit(p) { visitStart = p.th; visitLaps = rr(0.75, 1.05); }
  let legStart = 0, legLen = 0, legN = 0, sinceTurn = 99;
  function newLeg(p) {
    legStart = p.th;
    legLen = (legN % 2 ? 1.9 : 2.7) + rr(-0.2, 0.2);
    legN++;
    sinceTurn = 0;
  }
  // Re-express a placed platform in the current route frame.
  function reframe(p) {
    const th0 = Math.atan2(p.z - CZ, p.x - CX);
    return Object.assign({}, p, { th: th0, r: Math.hypot(p.x - CX, p.z - CZ) });
  }
  // Stepping platforms in a straight line from cur to a landing at (tx, tz), rising to height ty.
  function walkTo(cur, tx, tz, ty) {
    const dx = tx - cur.x, dz = tz - cur.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, ry = Math.atan2(-uz, ux);
    let at = cur, y = cur.y;
    const left = () => Math.hypot(tx - at.x, tz - at.z);
    for (let n = 0; n < 14; n++) {
      // The landing (3 x 3) comes once the gap to it is jumpable and the height has been reached.
      const gapToLanding = left() - support(at, ux, uz) - 1.5, last = gapToLanding < 2.0 && ty - y < 1.1;
      const s = last ? 3.0 : rr(2.0, 2.5), g = rr(1.4, 1.9), off = support(at, ux, uz) + g + s / 2;
      // Out of room but still too low: step sideways-up in place (a little staircase) before going on.
      const climb = !last && left() - off < 3.5;
      const x = last ? tx : climb ? at.x - uz * (s + g) * (n % 2 ? 1 : -1) * 0.5 + ux * 0.2 : at.x + ux * off;
      const z = last ? tz : climb ? at.z + ux * (s + g) * (n % 2 ? 1 : -1) * 0.5 + uz * 0.2 : at.z + uz * off;
      const remain = Math.max(1, Math.ceil(left() / 4.2));
      y = last ? Math.max(y - 0.4, Math.min(y + 1.05, ty)) : Math.min(y + 1.05, y + Math.max(-0.4, climb ? 1.0 : (ty - y) / remain));
      const nd = need(x, z, s / 2, s / 2, ry, y);
      if (nd > 0 && nd <= 0.6) y += nd;
      const t = 0.7, c = add(makeBox(x, y - t / 2, z, s / 2, t / 2, s / 2, 0, ry, 0), 'branch', { surf: null });
      at = { x, z, y, sx: s, sz: s, ry, col: c, th: 0, r: 0 };
      if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
      recBox(x, z, s / 2, s / 2, ry, y);
      lastP = at;
      lastY = y;
      out.plats++;
      zonePlats++;
      if (last) break;
    }
    return at;
  }

  // ---------- templates ----------
  const T0 = {
    gap(cur, o = {}) {
      const [sx, sz] = o.size || size();
      const g = o.g !== undefined ? o.g : rr(ZD.gap[0], ZD.gap[1]);
      const dy = o.dy !== undefined ? o.dy : g > 2.3 ? rr(-0.5, 0.55) : rr(-0.3, 1.15);
      const r = nextR(cur, sz);
      return plat(thetaFor(cur, g, r, sx, sz), r, cur.y + dy, sx, sz, o);
    },
    stairs(cur, n = 3 + ((R() * 3) | 0)) {
      for (let i = 0; i < n; i++) {
        const sx = rr(1.6, 2.1), sz = rr(1.9, 2.5);
        const r = clamp(cur.r + rr(-0.7, 0.7), Math.max(BAND.lo + 1.9, rLo(sz)), Math.max(BAND.lo + 1.9, BAND.hi - 0.4));
        cur = plat(thetaFor(cur, rr(0.6, 1.1), r, sx, sz), r, cur.y + rr(0.9, 1.1), sx, sz);
      }
      return cur;
    },
    pillars(cur) {
      const n = 3 + ((R() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const rad = rr(0.6, 0.9), r = nextR(cur, rad * 2);
        const th = thetaFor(cur, rr(1.2, 2.1), r, rad * 2, rad * 2), y = cur.y + rr(-0.3, 0.8);
        const [x, z] = polar(th, r);
        const c = add(makeCyl(x, y - 3, z, rad, 3), 'pillar', { surf: ZD.ice ? 'ice' : null });
        cur = { th, r, y, sx: rad * 2, sz: rad * 2, x, z, ry: -(th + Math.PI / 2), col: c };
        if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
        lastP = cur;
        lastY = y;
        rec(cur);
        out.plats++;
      }
      return T.gap(cur, { g: rr(1.2, 2.0) });
    },
    beam(cur, o = {}) {
      const len = o.len || rr(5, 7.5), w = o.w || (ZD.ice ? 0.85 : rr(0.55, 0.75)), rise = o.rise !== undefined ? o.rise : rr(0, 1.6);
      const [sx, sz] = size();
      const r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, len, r, sx, sz), r, cur.y + rise, sx, sz);
      const b = between(cur, nxt, 0.25);
      const blen = Math.hypot(b.bx - b.ax, b.bz - b.az), dy = nxt.y - cur.y;
      const slope = Math.atan2(dy, blen), l3 = Math.hypot(blen, dy);
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2;
      // Box centre sits 0.2 below the walking surface along the beam's own up axis.
      const c = makeBox(mx - Math.sin(slope) * 0.2 * -b.ux, my - Math.cos(slope) * 0.2, mz - Math.sin(slope) * 0.2 * -b.uz,
        l3 / 2, 0.2, w / 2, 0, b.ry, slope);
      add(c, 'beam', { surf: o.surf !== undefined ? o.surf : ZD.ice ? 'ice' : null });
      recBox(mx, mz, blen / 2, w / 2 + 0.2, b.ry, Math.max(cur.y, nxt.y));
      return nxt;
    },
    crates(cur) {
      const p = T.gap(cur, { size: [rr(3.8, 4.6), rr(3.0, 3.6)] });
      const n = 1 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const s = rr(0.9, 1.2), ox = rr(-p.sx / 2 + 0.7, p.sx / 2 - 0.7), oz = rr(-p.sz / 2 + 0.7, p.sz / 2 - 0.7);
        const ax = Math.cos(p.ry), az = -Math.sin(p.ry), bx = Math.sin(p.ry), bz = Math.cos(p.ry);
        add(makeBox(p.x + ax * ox + bx * oz, p.y + s / 2, p.z + az * ox + bz * oz, s / 2, s / 2, s / 2, 0, p.ry + rr(-0.4, 0.4), 0), 'crate');
      }
      return p;
    },
    mover(cur) {
      const [sx, sz] = size();
      const r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(6.5, 9.0), r, sx, sz), r, cur.y + rr(-0.4, 0.8), sx, sz);
      const b = between(cur, nxt, -1.3);
      const c = makeBox(b.ax, cur.y - 0.3, b.az, 1.1, 0.3, 1.1, 0, b.ry, 0);
      c.dyn = { k: 'pp', ax: b.ax, ay: cur.y - 0.3, az: b.az, bx: b.bx, by: nxt.y - 0.3, bz: b.bz, per: rr(5.5, 7.5), ph: R() };
      add(c, 'mover', { surf: ZD.ice ? 'ice' : null });
      recBox((b.ax + b.bx) / 2, (b.az + b.bz) / 2, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 1.1, 1.1, b.ry, Math.max(cur.y, nxt.y));
      return nxt;
    },
    spinner(cur) {
      const armL = rr(3.4, 4.0), [sx, sz] = size(), r = Math.max(nextR(cur, sz), CORE_R + armL + 1.6);
      const nxt = plat(thetaFor(cur, 2 * (armL + 0.85), r, sx, sz), r, cur.y + rr(-0.3, 0.5), sx, sz);
      const b = between(cur, nxt, 0);
      const hx = (b.ax + b.bx) / 2, hz = (b.az + b.bz) / 2, hy = (cur.y + nxt.y) / 2;
      add(makeCyl(hx, hy - 0.3, hz, 0.9, 0.3), 'hub');
      const per = rr(8, 11) * (R() < 0.5 ? 1 : -1), arms = 3;
      for (let i = 0; i < arms; i++) {
        const c = makeBox(hx, hy - 0.25, hz, armL / 2, 0.25, 0.5);
        c.dyn = { k: 'orbit', hx, hy: hy - 0.25, hz, off: armL / 2 + 0.5, a0: (i * TAU) / arms, per };
        add(c, 'arm', { surf: ZD.ice ? 'ice' : null });
      }
      recBox(hx, hz, armL + 0.5, armL + 0.5, 0, hy);
      return nxt;
    },
    fan(cur) {
      const nxt = T.beam(cur, { len: rr(6, 8), w: 1.25, rise: rr(0, 0.6) });
      const thm = (cur.th + nxt.th) / 2, ym = (cur.y + nxt.y) / 2;
      const b = between(cur, nxt, 0.25);
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, rm = Math.hypot(mx, mz);
      const [fx, fz] = polar(thm, CORE_R + 0.5);
      const reg = makeBox(mx + (mx / rm) * 1.2, ym + 1.6, mz + (mz / rm) * 1.2, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 0.5, 2.4, 3.2, 0, b.ry, 0);
      out.fans.push({ x: fx, y: ym + 1.5, z: fz, dx: Math.cos(thm), dz: Math.sin(thm), th: thm, reach: rm + 4 - CORE_R, reg, per: rr(4.6, 6), ph: R(), str: 30 });
      return nxt;
    },
    rods(cur) {
      const n = 2 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const sx = rr(2.8, 3.4), sz = rr(2.6, 3.0), r = nextR(cur, sz);
        cur = plat(thetaFor(cur, rr(ZD.gap[0], ZD.gap[1] - 0.3), r, sx, sz), r, cur.y + rr(-0.2, 1.0), sx, sz);
        const [x, z] = polar(cur.th, r + sz / 2 - 0.35);
        add(makeCyl(x, cur.y + 1.6, z, 0.14, 1.6), 'rod');
        out.rods.push({ x, y: cur.y, z, h: 3.2, per: rr(6, 8), ph: R(), rad: 3.4, zone });
      }
      return cur;
    },
    pad(cur) {
      const r = clamp(cur.r + rr(-0.6, 0.6), BAND.lo + 1.9, Math.max(BAND.lo + 1.9, BAND.hi - 0.6));
      const pad = plat(thetaFor(cur, rr(0.8, 1.3), r, 1.7, 1.7), r, cur.y + rr(-0.2, 0.3), 1.7, 1.7, { surf: 'pad', kind: 'pad' });
      return T.gap(pad, { g: rr(1.2, 2.0), dy: rr(4.0, 5.0) });
    },
    lift(cur, h) {
      const H = h ? Math.max(5, h) : rr(5, 8), s = 2.4, r = clamp(cur.r + rr(-0.5, 0.5), BAND.lo + 2.1, Math.max(BAND.lo + 2.1, BAND.hi - 0.8));
      const th = thetaFor(cur, 0.7, r, s, s);
      const [x, z] = polar(th, r), ry = -(th + Math.PI / 2);
      const c = makeBox(x, cur.y - 0.3, z, s / 2, 0.3, s / 2, 0, ry, 0);
      c.dyn = { k: 'pp', ax: x, ay: cur.y - 0.3, az: z, bx: x, by: cur.y + H - 0.3, bz: z, per: rr(6, 8), ph: R() };
      add(c, 'lift', { surf: ZD.ice ? 'ice' : null });
      out.decor.push({ k: 'cage', x, z, y0: cur.y - 1, y1: cur.y + H + 1.5, s: s + 0.5, ry });
      const top = { th, r, y: cur.y + H, sx: s, sz: s, x, z, ry };
      rec(top);
      return T.gap(top, { g: rr(0.9, 1.5), dy: rr(-0.2, 0.4) });
    },
    crumble(cur) {
      const n = 3 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const s = rr(1.5, 1.9), r = nextR(cur, s);
        cur = plat(thetaFor(cur, rr(1.3, 2.1), r, s, s), r, cur.y + rr(-0.2, 0.7), s, s, { kind: 'crumble' });
        cur.col.crumble = { st: 0, t: 0, i: out.crumbles.length };
        out.crumbles.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 2.0) });
    },
    tilt(cur) {
      for (let i = 0; i < 2; i++) {
        cur = T.gap(cur, { size: [rr(3.0, 3.6), rr(2.2, 2.6)], g: rr(1.5, 2.4), dy: rr(-0.2, 0.7) });
        cur.col.dyn = { k: 'tilt', ax: R() < 0.5 ? 'x' : 'z', amp: rr(0.18, 0.3), per: rr(4.5, 6.5), ph: R() };
        cur.col.kind = 'tilt';
      }
      return cur;
    },
    bob(cur) {
      for (let i = 0; i < 3; i++) {
        const sx = rr(1.7, 2.6), sz = rr(1.7, 2.4), r = nextR(cur, sz), amp = rr(0.7, 1.2);
        cur = plat(thetaFor(cur, rr(1.5, 2.1), r, sx, sz), r, cur.y + rr(-0.1, 0.6), sx, sz,
          { kind: 'bob', thick: rr(0.9, 1.6), dry: rr(-0.4, 0.4), surf: ZD.ice ? 'ice' : null });
        cur.col.dyn = { k: 'bob', y0: cur.col.y, amp, per: rr(4, 6.5), ph: R(), roll: rr(0.04, 0.09) };
        recs[recs.length - 1].y += amp;
      }
      return T.gap(cur, { g: rr(1.5, 2.0), dy: rr(-0.4, 0.4) });
    },
    // A gap too wide to jump, with a hook above it: GRAPPLE zips you up and flings you across.
    grapple(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(8.5, 11), r, sx, sz), r, cur.y + rr(0.5, 3), sx, sz, { nosign: true });
      const b = between(cur, nxt, 0);
      const ax = (b.ax + b.bx) / 2, az = (b.az + b.bz) / 2, ay = Math.max(cur.y, nxt.y) + rr(5, 6.5);
      out.anchors.push({ i: out.anchors.length, x: ax, y: ay, z: az, tx: nxt.x, ty: nxt.y + PR_TOP, tz: nxt.z, zone });
      recBox(ax, az, 1, 1, 0, ay + 1.6, 2.2);
      if (zone === 0 && !intro.grapple) { intro.grapple = true; sign(cur, 'See a glowing hook? Tap GRAPPLE to zip up and fly across.'); }
      return nxt;
    },
    // A narrow bridge blocked by a door. Shoot the round target to open it for the whole team.
    door(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(6.5, 8), r, sx, sz), r, cur.y, sx, sz, { nosign: true });
      const b = between(cur, nxt, 0.25), y = cur.y;
      const blen = Math.hypot(b.bx - b.ax, b.bz - b.az), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
      add(makeBox(mx, y - 0.2, mz, blen / 2, 0.2, 0.75, 0, b.ry, 0), 'beam', { surf: ZD.ice ? 'ice' : null });
      // Wall: the frame and side panels are permanent, the middle panel is the door.
      const nx = -b.uz, nz = b.ux;
      for (const s2 of [-1, 1]) add(makeBox(mx + nx * s2 * 2.15, y + 2.3, mz + nz * s2 * 2.15, 0.25, 2.3, 1.4, 0, b.ry, 0), 'wall');
      add(makeBox(mx, y + 4.15, mz, 0.25, 0.45, 0.8, 0, b.ry, 0), 'wall');
      const door = add(makeBox(mx, y + 1.85, mz, 0.18, 1.85, 0.8, 0, b.ry, 0), 'door');
      // Target on a post off to the side, facing the player's approach.
      const tr = Math.hypot(mx - CX, mz - CZ), ox = (mx - CX) / tr, oz = (mz - CZ) / tr;
      const bx = mx + ox * 3.2 - b.ux * 1.5, bz = mz + oz * 3.2 - b.uz * 1.5, by = y + 3.6;
      add(makeCyl(bx, y + 1.5, bz, 0.12, 2.2), 'post');
      out.doors.push({ i: out.doors.length, col: door, x: mx, y, z: mz, ry: b.ry, bx, by, bz, fx: -b.ux, fz: -b.uz, zone });
      recBox(mx, mz, blen / 2, 2.4, b.ry, y + 4.6, 1.2);
      if (zone === 0 && !intro.door) { intro.door = true; sign(cur, 'Door in the way? SHOOT the round target to open it.'); }
      return nxt;
    },
    // A wide platform patrolled by a monster that knocks robots off. Time it, GRAB, or SHOOT to stun it.
    monster(cur) {
      const p = T.gap(cur, { size: [rr(5, 6), rr(3.2, 3.8)], g: rr(1.4, 2.2), dy: rr(-0.2, 0.6), nosign: true });
      const ax = Math.cos(p.ry), az = -Math.sin(p.ry), half = p.sx / 2 - 0.9;
      out.monsters.push({ i: out.monsters.length, ax: p.x - ax * half, az: p.z - az * half, bx: p.x + ax * half, bz: p.z + az * half,
        y: p.y + 0.65, per: rr(3.2, 4.6), ph: R(), r: 0.65, zone });
      if (zone === 0 && !intro.monster) { intro.monster = true; sign(p, 'Monsters knock you off. Time it, hold GRAB, or SHOOT to stun them.'); }
      return T.gap(p, { g: rr(1.3, 2.0) });
    },
    // Gaps with bats circling through them.
    bats(cur) {
      for (let i = 0; i < 3; i++) {
        const prev = cur;
        cur = T.gap(cur, { g: rr(1.8, 2.5), dy: rr(-0.2, 0.7) });
        const b = between(prev, cur, 0);
        out.bats.push({ i: out.bats.length, cx: (b.ax + b.bx) / 2, cy: Math.max(prev.y, cur.y) + 1.1, cz: (b.az + b.bz) / 2,
          rad: rr(2.2, 3), per: rr(3, 4.5) * (R() < 0.5 ? 1 : -1), ph: R(), r: 0.45, zone });
      }
      return cur;
    },
    // A wide platform with a laser bar spinning low across it: jump over it as it comes round.
    laser(cur) {
      const p = T.gap(cur, { size: [rr(4.6, 5.4), rr(3.8, 4.4)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.5) });
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.16, 0.3), 'post');
      out.lasers.push({ i: out.lasers.length, k: 'spin', x: p.x, y: p.y + 0.5, z: p.z, len: Math.min(p.sx, p.sz) / 2 + 0.2,
        per: rr(2.4, 3.4) * (R() < 0.5 ? 1 : -1), ph: R(), n: zone >= 3 ? 2 : 1, zone });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // A bridge with a laser curtain across it that switches on and off: cross while it's off.
    gate(cur) {
      const nxt = T.beam(cur, { len: rr(5.5, 7), w: 1.2, rise: rr(0, 0.5) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2, nx = -b.uz, nz = b.ux;
      for (const s2 of [-1, 1]) add(makeCyl(mx + nx * s2 * 1.0, my + 1.25, mz + nz * s2 * 1.0, 0.13, 1.35), 'post');
      out.lasers.push({ i: out.lasers.length, k: 'gate', x: mx, y: my, z: mz, ux: b.ux, uz: b.uz, w: 0.9, h: 2.4, per: rr(2.8, 3.6), ph: R(), duty: 0.5, zone });
      return nxt;
    },
    // Arrow traps beside a bridge, firing across it one after another.
    arrows(cur) {
      const nxt = T.beam(cur, { len: rr(6, 7.5), w: rr(0.9, 1.1), rise: rr(0, 0.8) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
      let nx = -b.uz, nz = b.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
      const n = 2 + (R() < 0.5 ? 1 : 0), per = rr(2.2, 2.8), ph0 = R();
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / (n + 1), px = b.ax + (b.bx - b.ax) * f, pz = b.az + (b.bz - b.az) * f, py = cur.y + (nxt.y - cur.y) * f;
        const lx = px + nx * 2.4, lz = pz + nz * 2.4;
        add(makeCyl(lx, py - 0.45, lz, 0.14, 0.7), 'post');
        out.arrows.push({ i: out.arrows.length, x: lx, y: py + 0.6, z: lz, dx: -nx, dz: -nz, range: 4.4, speed: 13, per, ph: ph0 + k / n, zone });
      }
      return nxt;
    },
    // A platform swinging like a pendulum across a gap too wide to jump: ride it over.
    swing(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(5.2, 6.4), r, sx, sz), r, cur.y + rr(-0.2, 0.5), sx, sz);
      const b = between(cur, nxt, 0), half = Math.hypot(b.bx - b.ax, b.bz - b.az) / 2;
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, L = rr(3.0, 3.5), base = Math.min(cur.y, nxt.y) - 0.25;
      const amp = Math.asin(Math.min(0.85, Math.max(0.3, half - 1.5) / L)), py = base + L;
      const c = makeBox(mx, base, mz, 1.1, 0.25, 1.1, 0, b.ry, 0);
      c.dyn = { k: 'swing', px: mx, py, pz: mz, ux: b.ux, uz: b.uz, L, amp, per: rr(3.4, 4.4), ph: R() };
      add(c, 'swing', { surf: null });
      out.swings.push({ col: c, x: mx, y: py, z: mz, ry: b.ry });
      recBox(mx, mz, half, 1.2, b.ry, Math.max(cur.y, nxt.y) + 0.6);
      return nxt;
    },
    // Sunny: the switchback turn. Hop sideways into the other lane and head back the other way.
    turn(cur) {
      const toInner = BAND === LANES.outer, nb = toInner ? LANES.inner : LANES.outer, [sx, sz] = [rr(2.6, 3.2), rr(2.4, 2.8)];
      const want = toInner ? cur.r - cur.sz / 2 - 1.4 - sz / 2 : cur.r + cur.sz / 2 + 1.4 + sz / 2;
      const th = cur.th + DIR * 0.12, r = clamp(want, nb.lo + sz / 2, Math.max(nb.lo + sz / 2, nb.hi)), y = cur.y + rr(0.5, 1.0);
      // The other lane may have older route close above or below here: climb first, then hop over.
      const nd = needAt(th, r, sx + 1, sz + 1, y);
      if (nd > 0.6) return T.lift(cur, nd + 1.4);
      BAND = nb;
      const p = plat(th, r, y, sx, sz);
      DIR = -DIR;
      newLeg(p);
      return p;
    },
    // Forest: walk out along branches to a side tree, climb round it, then come back to the main trunk.
    excursion(cur) {
      let phi = null;
      for (let k = 0; k < 10 && phi === null; k++) {
        const a = cur.th + DIR * (0.25 + k * 0.4), x = Math.cos(a) * SAT_D, z = Math.sin(a) * SAT_D;
        if (out.trees.every((t) => Math.hypot(t.x - x, t.z - z) > 21 || cur.y > t.top + 10)) phi = a;
      }
      if (phi === null) return T.gap(cur);
      const ux = Math.cos(phi), uz = Math.sin(phi), Sx = ux * SAT_D, Sz = uz * SAT_D;
      const tree = { x: Sx, z: Sz, r: SAT_TR, y0: cur.y, top: 0, zone };
      // Out along the branch to a landing on the near side of the side tree.
      cur = walkTo(cur, Sx - ux * 6.2, Sz - uz * 6.2, cur.y + rr(1.0, 2.0));
      const saved = { CX, CZ, DIR, BAND };
      CX = Sx; CZ = Sz; DIR = -saved.DIR; BAND = { lo: SAT_TR + 1.3, hi: SAT_TR + 4.8 };
      cur = reframe(cur);
      const start = cur.th, startY = cur.y, home = Math.atan2(-Sz, -Sx), turns = rr(1.15, 1.6);
      // Round a small tree only short pieces fit (long bridges would cut across the circle).
      const ok = ['gap', 'gap', 'stairs', 'pillars', 'crumble', 'bob', 'tilt', 'monster', 'bats', 'pad'];
      // Where the branch back to the main trunk will land, and how high it must be to clear the route below.
      const backNeed = () => {
        const [wx, wz] = polar(cur.th, cur.r), b = Math.atan2(wz, wx), hx = Math.cos(b) * 12.5, hz = Math.sin(b) * 12.5;
        return Math.max(0, need(hx, hz, 1.5, 1.5, -(b + Math.PI / 2), cur.y + 0.8));
      };
      for (let n = 0; n < 90; n++) {
        const went = Math.abs(cur.th - start) / TAU;
        if (went > turns && Math.abs(angDiff(cur.th, home)) < 0.55 && backNeed() < 2.5) break;
        const at = cur, g = place(() => guard(at), at);
        if (g) { cur = g; continue; }
        // Round a small tree the laps are short, so keep climbing at least 6.5 m per lap.
        if (cur.y < startY + went * 6.5 - 0.4) { cur = place(() => T.stairs(at, 2), at); continue; }
        const k = pickTpl();
        cur = place(() => T[ok.includes(k) ? k : 'gap'](at), at);
      }
      tree.top = cur.y + 3;
      out.trees.push(tree);
      add(makeCyl(Sx, tree.top / 2 - 1, Sz, SAT_TR, tree.top / 2 + 1), 'trunk');
      CX = saved.CX; CZ = saved.CZ; DIR = saved.DIR; BAND = saved.BAND;
      // Back along a branch to the main trunk, high enough above the route below.
      const back = Math.atan2(cur.z, cur.x), hx = Math.cos(back) * 12.5, hz = Math.sin(back) * 12.5;
      cur = walkTo(cur, hx, hz, cur.y + 0.8 + Math.max(0, need(hx, hz, 1.5, 1.5, -(back + Math.PI / 2), cur.y + 0.8)));
      return reframe(cur);
    },
    // Volcano: a vent in the middle of a platform erupts every few seconds. Standing on it launches you
    // up to the ledge high above; standing next to it gets you shoved off.
    geyser(cur) {
      const p = T.gap(cur, { size: [rr(3.4, 4.2), rr(3.0, 3.6)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.4) });
      out.geysers.push({ i: out.geysers.length, x: p.x, y: p.y, z: p.z, per: rr(3.2, 4.2), ph: R(), dur: 1.2, zone });
      return T.gap(p, { g: rr(1.0, 1.5), dy: rr(4.4, 5.2) });
    },
    // Volcano: boulders drop onto a wide ledge. A shadow grows where the next one will land.
    rocks(cur) {
      const p = T.gap(cur, { size: [rr(5, 6), rr(3.6, 4.2)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.5) });
      const n = 2 + (R() < 0.5 ? 1 : 0), ax = Math.cos(p.ry), az = -Math.sin(p.ry), per = rr(3.4, 4.6);
      for (let k = 0; k < n; k++) {
        const o = (k / (n - 1) - 0.5) * (p.sx - 1.6);
        out.rocks.push({ i: out.rocks.length, x: p.x + ax * o, y: p.y, z: p.z + az * o, per, ph: k / n + R() * 0.15, zone });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // City: a long conveyor belt that carries you along (with you or against you).
    conveyor(cur) {
      const sx = rr(6, 7.5), sz = rr(2.2, 2.6), r = nextR(cur, sz);
      const p = plat(thetaFor(cur, rr(1.2, 1.8), r, sx, sz), r, cur.y + rr(-0.2, 0.5), sx, sz, { kind: 'conveyor', surf: null });
      p.col.conv = { sp: rr(2.4, 3.6) * (R() < 0.5 ? 1 : -1) };
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // City: leave this tower for the next one, over a sky bridge or by zipline from a hook in the gap.
    cross(cur) {
      const nb = (tower + 1) % TOWERS.length, A = TOWERS[tower], B = TOWERS[nb];
      const dx = A.x - B.x, dz = A.z - B.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, lx = B.x + ux * 9.4, lz = B.z + uz * 9.4;
      let land;
      if (R() < 0.45) {
        CX = B.x; CZ = B.z; BAND = TBAND;
        land = plat(Math.atan2(lz - CZ, lx - CX), 9.4, cur.y + rr(0.4, 1.6), 3.2, 3.0, { nosign: true });
        const hx = (cur.x + land.x) / 2, hz = (cur.z + land.z) / 2, hy = Math.max(cur.y, land.y) + rr(5, 6);
        out.anchors.push({ i: out.anchors.length, x: hx, y: hy, z: hz, tx: land.x, ty: land.y + PR_TOP, tz: land.z, zone });
        recBox(hx, hz, 1, 1, 0, hy + 1.6, 2.2);
      } else {
        land = walkTo(cur, lx, lz, cur.y + rr(1, 2));
        CX = B.x; CZ = B.z; BAND = TBAND;
      }
      tower = nb;
      land = reframe(land);
      newVisit(land);
      return land;
    },
    iceslope(cur) {
      return T.beam(cur, { len: rr(6, 7.5), w: 1.3, rise: rr(1.0, 1.4), surf: 'ice' });
    },
  };

  // Every section is checked right after it is placed. If anything in it sits too close above or below
  // older route, the section is undone and the route climbs straight up with a lift instead, so the
  // finished level always keeps its clearances (dev/leveltest.js checks the same rule).
  const LISTS = ['cols', 'rings', 'decor', 'cps', 'fans', 'rods', 'signs', 'crumbles', 'anchors', 'doors', 'monsters', 'bats', 'lasers', 'arrows', 'swings', 'trees', 'geysers', 'rocks'];
  function snapshot() {
    const n = {};
    for (const k of LISTS) n[k] = out[k].length;
    return { n, recs: recs.length, pathLen, lastP, lastY, zonePlats, plats: out.plats, intro: Object.assign({}, intro),
      CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps };
  }
  function restore(q) {
    for (const k of LISTS) out[k].length = q.n[k];
    for (let i = recs.length - 1; i >= q.recs; i--) {
      const r = recs[i], b = buckets[Math.max(0, Math.floor(r.y / 4))];
      b.splice(b.lastIndexOf(r), 1);
    }
    recs.length = q.recs;
    ({ pathLen, lastP, lastY, zonePlats, CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps } = q);
    out.plats = q.plats;
    Object.assign(intro, q.intro);
  }
  // How far the new footprints (from index `from`) would have to rise to clear everything older.
  function badness(from) {
    let raise = 0;
    for (let i = from; i < recs.length; i++) {
      const q = recs[i];
      for (let k = Math.max(0, Math.floor((q.y - HEAD) / 4) - 1); k <= Math.floor((q.y + HEAD) / 4) + 1; k++) {
        const B = buckets[k];
        if (!B) continue;
        for (const r of B) {
          if (r === q || r.pl >= q.pl - RECENT) continue;
          const lo = r.y <= q.y ? r : q, hi = lo === r ? q : r;
          if (hi.y - lo.y >= lo.h - 0.01) continue;
          const dx = r.x - q.x, dz = r.z - q.z, rr2 = r.rad + q.rad;
          if (dx * dx + dz * dz > rr2 * rr2 || !overlap(r, q, 0)) continue;
          raise = Math.max(raise, r.y + r.h - q.y + 0.05);
        }
      }
    }
    return raise;
  }
  function place(fn, at) {
    for (let k = 0; k < 4; k++) {
      const snap = snapshot(), res = fn(), raise = badness(snap.recs);
      if (raise <= 0) return res;
      restore(snap);
      fn = () => T.lift(at, Math.min(12, raise + 1.2));
    }
    return fn();
  }

  // Each template call tags the footprints it records (for the clearance test's reports).
  const T = {};
  for (const k in T0) T[k] = (...args) => { const prev = TAG; TAG = k; const r = T0[k](...args); TAG = prev; return r; };

  function pickTpl() {
    const w = ZD.tpl;
    let sum = 0;
    for (const k in w) sum += w[k];
    let x = R() * sum;
    for (const k in w) if ((x -= w[k]) <= 0) return k;
    return 'gap';
  }

  // Look ~1.4 rad ahead; if the layer below would be too close, climb stairs first.
  function guard(cur, span = 2.4, extra = 0.6) {
    let worst = -1e9;
    const sp = Math.min(span, 18 / Math.max(3, cur.r));
    for (let d = 0.1; d <= sp; d += 0.1) {
      for (const dr of [-1, 0, 1]) worst = Math.max(worst, needAt(cur.th + DIR * d, Math.max(BAND.lo + 1, cur.r + dr), 3.6, 3.6, cur.y - extra));
    }
    // A big climb needed soon is done in one go with a lift; small ones with a few stairs.
    if (worst > 2.4) return T.lift(cur, Math.min(9, worst + 1.4));
    return worst > 0 ? T.stairs(cur, Math.ceil(worst / 0.9) + 2) : null;
  }

  function ring(y, rIn, rOut, a0, a1, kind, recIt) {
    const n = Math.ceil((a1 - a0) / 0.2), da = (a1 - a0) / n, rm = (rIn + rOut) / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + 0.5) * da;
      const [x, z] = polar(a, rm);
      add(makeBox(x, y - 0.6, z, (rOut * da) / 2 + 0.06, 0.6, (rOut - rIn) / 2, 0, -(a + Math.PI / 2), 0), kind, { vis: false });
      if (recIt) rec({ th: a, y, r: rm, sx: rm * da, sz: rOut - rIn });
    }
    out.rings.push({ y, rIn, rOut, a0, a1, zone });
  }

  function checkpoint(th, r, y, o) {
    const [x, z] = polar(th, r);
    out.cps.push(Object.assign({ i: out.cps.length, x, y, z, th, zone }, o));
  }

  // ---------- build ----------
  ring(2, CORE_R + 0.3, 19, 0, TAU, 'dock', false);
  for (let i = 0; i < 4; i++) {
    const a = 0.9 + i * 1.57, [x, z] = polar(a, 25);
    add(makeBox(x, 1.4, z, 1.6, 0.6, 6.5, 0, -(a + Math.PI / 2), 0), 'pier');
  }
  for (let i = 0; i < 14; i++) {
    const a = 1.4 + i * 0.37, r = rr(13, 17.5), s = rr(0.8, 1.3), [x, z] = polar(a, r);
    add(makeBox(x, 2 + s / 2, z, s / 2, s / 2, s / 2, 0, rr(0, 3), 0), 'crate');
  }
  if (MAP.key === 'storm') {
    for (let i = 0; i < 12; i++) {
      const [x, z] = polar((i / 12) * TAU + 0.2, 18.3);
      out.decor.push({ k: 'lamp', x, y: 2, z });
    }
  }
  out.spawn = { th: 0.12, r: 12.5, y: 2 };
  checkpoint(0.12, 12.5, 2, { start: true, normal: true });
  out.signs.push({ x: Math.cos(0.12) * 17.5, y: 4.6, z: Math.sin(0.12) * 17.5, text: SIGNS[0] });
  let cur = virt(0.12 + DIR * 0.38, 12.5, 2, 2.4, 6);
  if (ROUTE === 'switchback') { BAND = LANES.outer; newLeg(cur); }
  let nextExc = 0;
  if (ROUTE === 'towers') {
    // Off the dock and over to the nearest skyscraper.
    tower = 0;
    let best = 1e9;
    TOWERS.forEach((t, k) => { const dd = Math.hypot(t.x - cur.x, t.z - cur.z); if (dd < best) { best = dd; tower = k; } });
    const t = TOWERS[tower], d = Math.hypot(t.x, t.z);
    cur = walkTo(cur, t.x - (t.x / d) * 9.4, t.z - (t.z / d) * 9.4, 3.2);
    CX = t.x; CZ = t.z; BAND = TBAND; DIR = 1;
    cur = reframe(cur);
    newVisit(cur);
  }

  for (zone = 0; zone < ZONE_LIST.length; zone++) {
    ZD = ZONE_LIST[zone];
    zonePlats = 0;
    const zi = { name: ZD.name, sub: ZD.sub, color: ZD.color, fog: ZD.fog, tint: ZD.tint, y0: cur.y, y1: ZD.y1 };
    if (zone > 0 && ROUTE === 'towers') {
      // No ring round a core here: a wide rooftop pad starts the zone.
      const at0 = cur;
      cur = place(() => T.gap(at0, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at0);
      zi.y0 = cur.y;
      checkpoint(cur.th, cur.r, cur.y, { normal: zone % 2 === 0 });
    } else if (zone > 0) {
      // Zone gate: a wide three-quarter ring that doubles as a safety net and checkpoint.
      const rIn = 7.0, rOut = 16.5, rm = 11.75, span = TAU * 0.72;
      let th0;
      for (let k = 0; k < 40; k++) {
        th0 = cur.th + DIR * (cur.sx / 2 + 1.1) / cur.r;
        let worst = -1e9;
        for (let a = 0; a <= span; a += 0.1) worst = Math.max(worst, needAt(th0 + DIR * a, rm, 2, rOut - rIn, cur.y + 0.9));
        if (worst <= 0) break;
        cur = T.stairs(cur, Math.ceil(worst) + 1);
      }
      const y = cur.y + 0.9;
      zi.y0 = y;
      ring(y, rIn, rOut, DIR > 0 ? th0 : th0 - span, DIR > 0 ? th0 + span : th0, 'ring', true);
      checkpoint(th0 + DIR * 0.55, rm, y, { normal: zone % 2 === 0 });
      cur = virt(th0 + DIR * (span - 1.1 / rm), rm, y, 2.2, rOut - rIn);
      lastP = cur;
      pathLen += span * rm;
      if (ROUTE === 'switchback') newLeg(cur);
    }
    out.zones.push(zi);
    nextExc = zi.y0 + 12;
    let midDone = zone === 0;
    const mid = (zi.y0 + ZD.y1) / 2;
    while (cur.y < ZD.y1) {
      const at = cur, g = place(() => guard(at), at);
      if (g) { cur = g; continue; }
      if (!midDone && cur.y > mid) {
        cur = place(() => T.gap(at, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at);
        checkpoint(cur.th, cur.r, cur.y, { mid: true });
        midDone = true;
        continue;
      }
      // Special areas are long and tall; make sure the layer below is far enough away first.
      const g2 = place(() => guard(at, 2.8, 1.5), at);
      if (g2) { cur = g2; continue; }
      sinceTurn++;
      // Sunny: the last stretch below the summit runs in the outer lane, clear of the summit disc.
      if (ROUTE === 'switchback' && finalStretch() && BAND === LANES.inner) { cur = place(() => T.turn(at), at); continue; }
      // Sunny: turn round at the end of each leg. Forest: now and then a trip out to a side tree.
      if (ROUTE === 'switchback' && DIR * (cur.th - legStart) > legLen && !finalStretch()) { cur = place(() => T.turn(at), at); continue; }
      if (ROUTE === 'towers') {
        // Done with this tower once round far enough and facing the next one: cross over.
        const nt = TOWERS[(tower + 1) % TOWERS.length], face = Math.atan2(nt.z - CZ, nt.x - CX);
        if (Math.abs(cur.th - visitStart) / TAU > visitLaps && Math.abs(angDiff(cur.th, face)) < 0.45) { cur = place(() => T.cross(at), at); continue; }
      }
      if (ROUTE === 'trees' && zone < ZONE_LIST.length - 1 && cur.y > nextExc && cur.y < ZD.y1 - 24 && (zone > 0 || zonePlats > 16)) {
        cur = place(() => T.excursion(at), at);
        nextExc = cur.y + 34;
        continue;
      }
      // The first zone teaches each special area early on.
      if (zone === 0 && zonePlats >= 6 && !intro.grapple) cur = place(() => T.grapple(at), at);
      else if (zone === 0 && zonePlats >= 12 && !intro.door) cur = place(() => T.door(at), at);
      else if (zone === 0 && MAP.key === 'forest' && zonePlats >= 3 && !intro.monster) cur = place(() => T.monster(at), at);
      else if (finalStretch()) { const k = ['gap', 'gap', 'stairs', 'pillars', 'beam', 'crumble'][(R() * 6) | 0]; cur = place(() => T[k](at), at); }
      else {
        // Big sweeping things stay away from the switchback turns, where the other lane is close by.
        let k = pickTpl();
        if (ROUTE === 'switchback' && (k === 'spinner' || k === 'fan') && (sinceTurn < 4 || BAND === LANES.inner)) k = 'mover';
        if ((ROUTE === 'towers' || ROUTE === 'crater') && (k === 'spinner' || k === 'fan')) k = 'mover';
        cur = place(() => T[k](at), at);
      }
    }
    zi.y1 = cur.y;
  }

  // Summit: a disc capping the core, reached from one last ledge.
  zone = ZONE_LIST.length - 1;
  if (ROUTE === 'switchback' && BAND === LANES.inner) cur = T.turn(cur);
  if (ROUTE === 'towers') {
    // From the last tower over to the central spire, whose roof is the summit.
    const b = Math.atan2(cur.z, cur.x);
    cur = walkTo(cur, Math.cos(b) * 12.5, Math.sin(b) * 12.5, cur.y + 1);
    CX = 0; CZ = 0; BAND = MAIN; DIR = 1;
    cur = reframe(cur);
  }
  for (let k = 0; k < 40; k++) {
    if (need(0, 0, 9.8, 9.8, 0, cur.y + 1.8) <= 0) break;
    cur = T.stairs(cur, 2);
  }
  const last = plat(thetaFor(cur, 1.4, 12.0, 2.4, 2.2), 12.0, cur.y + 0.8, 2.4, 2.2);
  const top = last.y + 1.0;
  add(makeCyl(0, top - 0.6, 0, 9.6, 0.6), 'summit');
  out.summit = { x: 0, y: top, z: 0, r: 4.5 };
  out.top = top;
  out.zones[out.zones.length - 1].y1 = top;
  if (ROUTE !== 'crater') add(makeCyl(0, (top - 1.2 - 40) / 2, 0, CORE_R, (top - 1.2 + 40) / 2), 'core');
  for (const t of TOWERS) add(makeBox(t.x, (top - 20) / 2, t.z, TW, (top + 20) / 2, TW, 0, -t.a, 0), 'tower');

  // Zone decorations, all visual only, different for each map.
  const dz = (k, n, f) => { for (let i = 0; i < n; i++) out.decor.push(Object.assign({ k }, f(i))); };
  const zy = (i) => out.zones[i];
  const around = (rMin, rMax) => { const a = rr(0, TAU), r = rr(rMin, rMax); return [Math.cos(a) * r, Math.sin(a) * r, a]; };
  if (MAP.key === 'storm') {
    dz('rotor', 10, () => { const a = rr(0, TAU), y = rr(zy(1).y0 + 4, zy(1).y1); return { x: Math.cos(a) * (CORE_R + 0.2), y, z: Math.sin(a) * (CORE_R + 0.2), th: a, s: rr(2.2, 3.4) }; });
    dz('coil', 10, () => { const [x, z] = around(20, 34); return { x, y: rr(zy(2).y0, zy(2).y1), z, s: rr(1.5, 3) }; });
    dz('rock', 40, () => { const [x, z] = around(19, 38); return { x, y: rr(zy(4).y0 - 10, zy(4).y1 + 10), z, s: rr(1, 4), rx: rr(0, 3), ry: rr(0, 3), sp: rr(0.1, 0.4) }; });
    for (const c of out.cols) {
      if (c.zone === 5 && c.kind === 'plat' && R() < 0.7) {
        for (let i = 0; i < 3; i++) out.decor.push({ k: 'icicle', x: c.x + rr(-c.hx, c.hx) * 0.6, y: c.y - c.hy, z: c.z + rr(-c.hz, c.hz) * 0.6, s: rr(0.5, 1.4) });
      }
    }
    dz('halo', 8, (i) => { const a = (i / 8) * TAU, r = rr(18, 26); return { x: Math.cos(a) * r, y: rr(zy(6).y0 + 10, top + 30), z: Math.sin(a) * r, s: rr(3, 6), rx: rr(-0.6, 0.6), ry: a }; });
  } else if (MAP.key === 'sunny') {
    // A sandy island with palms, boats out at sea and puffy clouds drifting around the upper tower.
    dz('palm', 22, () => { const [x, z] = around(20, 34); return { x, y: 0.4, z, s: rr(0.8, 1.3), ry: rr(0, TAU), lean: rr(-0.35, 0.35) }; });
    dz('boat', 7, () => { const [x, z, a] = around(70, 180); return { x, y: 0, z, s: rr(1, 2), ry: a + rr(-0.5, 0.5) }; });
    dz('cloud', 34, () => { const [x, z] = around(22, 60); return { x, y: rr(zy(2).y0, top + 40), z, s: rr(4, 9), sp: rr(0.02, 0.06) }; });
    dz('gull', 10, () => ({ x: 0, y: rr(20, top), z: 0, r: rr(18, 40), sp: rr(0.15, 0.3) * (R() < 0.5 ? 1 : -1), ph: R() * TAU }));
  } else {
    // A forest island: trees all around, mushrooms and vines on the climb, fireflies higher up.
    dz('tree', 60, () => { const [x, z] = around(21, 75); return { x, y: 0.4, z, s: rr(0.8, 1.6), ry: rr(0, TAU) }; });
    dz('branch', 18, (i) => { const a = rr(0, TAU); return { x: Math.cos(a) * CORE_R, y: rr(20, top - 10), z: Math.sin(a) * CORE_R, th: a, s: rr(2.5, 5) }; });
    for (const c of out.cols) {
      if (c.kind === 'plat' && c.zone === 1 && R() < 0.5) out.decor.push({ k: 'mushroom', x: c.x + rr(-c.hx, c.hx) * 0.5, y: c.y + c.hy, z: c.z + rr(-c.hz, c.hz) * 0.5, s: rr(0.4, 0.8) });
      if (c.kind === 'plat' && (c.zone === 3 || c.zone === 4) && R() < 0.6) out.decor.push({ k: 'vine', x: c.x + rr(-c.hx, c.hx) * 0.7, y: c.y - c.hy, z: c.z + rr(-c.hz, c.hz) * 0.7, s: rr(1.5, 4) });
    }
    dz('firefly', 70, () => { const [x, z] = around(8, 26); return { x, y: rr(zy(3).y0, top), z, sp: rr(0.4, 1.2), ph: R() * TAU }; });
  }

  out.recs = recs;
  // Forest: no decorative trees standing inside a side tree's climb.
  if (out.trees.length) out.decor = out.decor.filter((d) => d.k !== 'tree' || out.trees.every((t) => Math.hypot(d.x - t.x, d.z - t.z) > 11));
  return out;
}

// Do two oriented rectangles (x, z, hx, hz, c = cos yaw, s = sin yaw) overlap, with margin m? (2D SAT)
export function overlap(a, b, m) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const ax = [a.c, -a.s, a.s, a.c, b.c, -b.s, b.s, b.c];
  for (let i = 0; i < 8; i += 2) {
    const ux = ax[i], uz = ax[i + 1];
    const ra = a.hx * Math.abs(a.c * ux - a.s * uz) + a.hz * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux - b.s * uz) + b.hz * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb + m) return false;
  }
  return true;
}
