// No shortcuts: from nothing on the route can you jump (or jump and dash) onto a piece of it much further along, skipping
// what lies between. Two footprints count as a shortcut when the later one is less than SHORT_UP above the earlier one
// (and not far below it), within a jump and a dash of it edge to edge (shortcutReach), and more than SHORT_SKIP metres of
// route lies between them. Going back down to earlier route is fine, and so is anything close along the route (that is
// the route itself). The generator (level.js badness) lifts anything that would be one.
import { generateLevel, MAPS, overlap, SHORT_SKIP as SKIP, SHORT_UP, shortcutReach, standsOn } from '../assets/js/level.js';

let failed = 0;
for (const M of MAPS) {
  const L = generateLevel(M.id);
  // Things you stand on: not the space kept round mazes, not a whole maze garden, not hooks and frames high in the air.
  const R = L.recs.filter(standsOn);
  const bad = [];
  for (let i = 0; i < R.length; i++) for (let j = 0; j < R.length; j++) {
    const a = R[i], b = R[j];
    if (b.pl - a.pl <= SKIP) continue;
    const dy = b.y - a.y;
    if (dy >= SHORT_UP || dy <= -3.5) continue;
    const g = shortcutReach(dy);
    if (Math.hypot(a.x - b.x, a.z - b.z) > a.rad + b.rad + g || !overlap(a, b, g)) continue;
    bad.push({ a, b, dy, skip: b.pl - a.pl });
  }
  // One line per place: the biggest skip from each piece.
  const by = new Map();
  for (const s of bad) if (!by.has(s.a) || by.get(s.a).skip < s.skip) by.set(s.a, s);
  const list = [...by.values()].sort((p, q) => q.skip - p.skip);
  if (list.length) failed++;
  console.log(`${list.length ? 'BAD ' : 'ok  '} ${M.key}: ${list.length} places to skip from` + (list.length ? ': ' + list.slice(0, 8).map((s) => `${s.a.tag} ${s.a.y.toFixed(1)} to ${s.b.tag} ${s.b.y.toFixed(1)} skips ${s.skip.toFixed(0)} m`).join(' | ') : ''));
}
if (failed) { console.log('FAILED'); process.exitCode = 1; } else console.log('no shortcuts');
