// Nothing on the route may sit inside a tall solid: the central column (as wide as it is drawn), the side trees and
// their crowns, or the skyscrapers. Checks every collider at every point of its movement, plus coins and checkpoints.
// With a path, checks another copy of level.js for comparison. Usage: node dev/columntest.js [path to level.js]
const path = process.argv[2] ? (await import('node:url')).pathToFileURL(process.argv[2]).href : '../assets/js/level.js';
const { generateLevel, MAPS, CORE_R, coreRadius } = await import(path);
const FLARE = { sunny: 1.08, forest: 1.25, waterfall: 1.18 };
const coreAt = coreRadius || ((key, y) => CORE_R * (1 + ((FLARE[key] || 1) - 1) * Math.min(1, Math.max(0, (1002 - y) / 1042))));
const SKIP = new Set(['core', 'trunk', 'tower', 'summit', 'dock', 'pier', 'crate']);

// Where a collider can ever be: [x, z, radius] from its real rotation, the same maths as physics.js aabb().
function reach(c) {
  const d = c.dyn, rad = c.t === undefined || c.r === undefined ? Math.hypot(c.hx || 0, c.hz || 0) : c.r, out = [];
  if (d && d.k === 'turn') return [[c.x, c.z, rad]];
  if (d && d.k === 'orbit') return [[d.hx, d.hz, d.off + c.hx]];
  if (d && d.k === 'pp') { for (let i = 0; i <= 8; i++) out.push([d.ax + (d.bx - d.ax) * i / 8, d.az + (d.bz - d.az) * i / 8, rad]); return out; }
  if (d && d.k === 'swing') { const w = d.L * Math.sin(d.amp); for (let i = -4; i <= 4; i++) out.push([d.px + d.ux * w * i / 4, d.pz + d.uz * w * i / 4, rad]); return out; }
  if (c.r !== undefined) return [[c.x, c.z, c.r]];
  const m = c.m, nx = Math.max(2, Math.ceil(c.hx / 0.25)), nz = Math.max(2, Math.ceil(c.hz / 0.25));
  for (let i = -nx; i <= nx; i++) for (let j = -nz; j <= nz; j++) {
    const lx = c.hx * i / nx, lz = c.hz * j / nz;
    out.push([c.x + m[0] * lx + m[6] * lz, c.z + m[2] * lx + m[8] * lz, 0]);
  }
  return out;
}
const span = (c) => {
  const d = c.dyn, v = c.r !== undefined ? c.hh : (c.rx || c.rz ? Math.hypot(c.hx, c.hy, c.hz) : c.hy);
  if (d && d.k === 'pp') return [Math.min(d.ay, d.by) - v, Math.max(d.ay, d.by) + v];
  if (d && d.k === 'bob') return [c.y - d.amp - v, c.y + d.amp + v];
  return [c.y - v, c.y + v];
};

let fails = 0;
for (const M of MAPS) {
  const L = generateLevel(M.id), hasCore = L.cols.some((c) => c.kind === 'core');
  const towers = L.cols.filter((c) => c.kind === 'tower');
  // How far inside a solid a point is at height y; above 0 is inside.
  const depth = (x, z, y, rad, kind) => {
    let worst = -1e9;
    if (hasCore) worst = Math.max(worst, (kind === 'ring' ? CORE_R : coreAt(M.key, y)) + rad - Math.hypot(x, z));
    for (const t of L.trees || []) {
      const lo = t.base === undefined ? -2 : t.base;
      if (y >= lo - 1 && y <= t.top + 0.5) worst = Math.max(worst, t.r + rad - Math.hypot(x - t.x, z - t.z));
      else if (y > t.top + 0.5 && y < t.top + 9) worst = Math.max(worst, 6 + rad - Math.hypot(x - t.x, z - t.z));
    }
    for (const t of towers) {
      const dx = x - t.x, dz = z - t.z, m = t.m, lx = Math.abs(dx * m[0] + dz * m[2]), lz = Math.abs(dx * m[6] + dz * m[8]);
      worst = Math.max(worst, Math.min(t.hx + rad - lx, t.hz + rad - lz));
    }
    return worst;
  };
  const bad = {}, list = [];
  let n = 0;
  for (const c of L.cols) {
    if (SKIP.has(c.kind)) continue;
    n++;
    const [y0, y1] = span(c);
    let worst = -1e9;
    for (const [x, z, rad] of reach(c)) for (const y of [y0, y1]) worst = Math.max(worst, depth(x, z, y, rad, c.kind));
    if (worst > 0.02) { bad[c.kind] = (bad[c.kind] || 0) + 1; list.push([c.kind, Math.round(c.y), +worst.toFixed(2)]); }
  }
  const coins = (L.coins || []).filter((k) => depth(k.x, k.z, k.y, 0) > 0).length;
  const cps = (L.cps || []).filter((k) => depth(k.x, k.z, k.y, 1) > 0).length;
  const total = list.length + coins + cps;
  fails += total;
  console.log(`${M.key}: ${n} pieces, ${list.length} inside a solid ${JSON.stringify(bad)}, ${coins} coins, ${cps} checkpoints` + (L.trees && L.trees.length ? `, ${L.trees.length} side trees` : ''));
  if (list.length) console.log('   deepest', JSON.stringify(list.sort((a, b) => b[2] - a[2]).slice(0, 5)));
}
console.log(fails ? `${fails} INSIDE` : 'all clear');
process.exit(fails ? 1 : 0);
