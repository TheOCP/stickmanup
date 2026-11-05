// No shortcuts to a relic. From the second marker of a course on (the first, through a portal), nothing on the route is within a
// jump and a dash of it, on any map, nor a drop of up to 60 m on the maps where the course is out in the open. Before that the
// stones can be near the route where the course starts, but nowhere else, or they would be a way up the route. Other courses are out of
// reach too. game.js courseChecks sends back whoever gets there anyway, from higher up still. This also says how long, how high
// and how far out each course is.
// Usage: node dev/courseshortcuttest.js
import { generateLevel, MAPS, overlap, SHORT_SKIP } from '../assets/js/level.js';

const dropReach = (dy) => 6.2 * ((9.4 + Math.sqrt(88.36 + 48 * dy)) / 24) + 3;
const boxOf = (c) => ({ x: c.x, z: c.z, hx: c.hx, hz: c.hz, c: Math.cos(c.ry || 0), s: Math.sin(c.ry || 0) });
let failed = 0;
for (const M of MAPS) {
  const L = generateLevel(M.id), route = L.recs.filter((q) => !q.guard && q.tag !== 'secret'), lines = [];
  for (const r of L.relics) {
    if (!r.way) continue;
    let best = null, bd = 1e9, ys = [1e9, -1e9], far = 1e9;
    for (const q of route) { const d = Math.abs(q.x - r.start.x) + Math.abs(q.z - r.start.z) + Math.abs(q.y - (r.start.y + r.start.hy)); if (d < bd) { bd = d; best = q; } }
    const bad = [];
    r.way.forEach((w, i) => { for (const c of w) {
      const a = boxOf(c), top = c.y + c.hy, past = i > r.entry || (r.portal && i >= r.entry);
      ys[0] = Math.min(ys[0], top); ys[1] = Math.max(ys[1], top);
      if (past) far = Math.min(far, Math.hypot(c.x, c.z));
      if (c.dyn) continue;
      for (const q of route) {
        const dy = q.y - top;
        if (!past && Math.abs(q.pl - best.pl) <= SHORT_SKIP) continue;
        if (dy < -3.5 || dy > (past && !r.portal ? 60 : 3)) continue;
        const g = past && !r.portal && dy > 0 ? dropReach(dy) : 7.5;
        if (Math.hypot(q.x - c.x, q.z - c.z) <= q.rad + Math.hypot(c.hx, c.hz) + g && overlap(a, q, g)) { bad.push(`stone ${i} from ${q.tag} ${dy.toFixed(1)} m above it`); break; }
      }
      for (const o of L.relics) if (o !== r && o.way) for (const e of o.stones) {
        const dy = e.y + e.hy - top;
        if (Math.abs(dy) < 3.5 && overlap(a, boxOf(e), 7.5)) { bad.push(`stone ${i} from ${o.id}`); break; }
      }
    } });
    if (bad.length) failed++;
    lines.push(`  ${bad.length ? 'BAD' : 'ok '} ${r.id.padEnd(13)} ${String(r.way.length).padStart(3)} steps, ${String(Math.round(ys[1] - ys[0])).padStart(3)} m up, from ${Math.round(far)} m out, ${r.rests.length} markers${r.portal ? ', portal' : ''}${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
  }
  console.log(M.key + '\n' + lines.join('\n'));
}
if (failed) { console.log('FAILED: ' + failed); process.exitCode = 1; } else console.log('no shortcuts to any relic');
