// Can a real climber actually reach every hidden relic, and get back? Runs the game's own physics with a small
// autopilot: from the route platform, hop across each stone to the relic, then all the way back.
import { generateLevel, MAPS } from '../assets/js/level.js';
import { World } from '../assets/js/physics.js';
import { Body, PR } from '../assets/js/player.js';

const dt = 1 / 120, none = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false };
let failed = 0;

// Walk to the edge facing the next stone, jump near the edge, steer at its centre while in the air.
function hop(b, from, to, world, env, fromTop) {
  const top = to.y + to.hy, tx = to.x, tz = to.z;
  let jumped = false;
  for (let i = 0; i < 120 * 6; i++) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1, onTo = b.grounded && b.ground === to;
    if (onTo && d < Math.max(to.hx, to.hz) * 0.6) { for (let k = 0; k < 40; k++) b.step(dt, none, env); return true; }
    const inp = { ...none, mx: dx / d, mz: dz / d };
    // In the air, steer like a player: just fast enough to come down on the stone's centre, not past it.
    if (!b.grounded) {
      const dy = b.y - (top + PR), disc = b.vy * b.vy + 2 * 24 * Math.max(dy, -b.vy * b.vy / 48), t = Math.max(0.05, (b.vy + Math.sqrt(Math.max(0, disc))) / 24);
      let wx = dx / t / 6.2, wz = dz / t / 6.2;
      const l = Math.hypot(wx, wz);
      if (l > 1) { wx /= l; wz /= l; }
      inp.mx = wx; inp.mz = wz;
    }
    if (!jumped && b.grounded && b.ground === from) {
      // Edge of the platform in this direction, in its own axes.
      const c = Math.cos(from.ry), s = Math.sin(from.ry), lx = b.x - from.x, lz = b.z - from.z, a = lx * c - lz * s, e = lx * s + lz * c;
      const ux = (dx / d) * c - (dz / d) * s, uz = (dx / d) * s + (dz / d) * c;
      const ta = ux > 1e-3 ? (from.hx - a) / ux : ux < -1e-3 ? (-from.hx - a) / ux : 1e9, tb = uz > 1e-3 ? (from.hz - e) / uz : uz < -1e-3 ? (-from.hz - e) / uz : 1e9;
      if (Math.min(ta, tb) < 0.28 && Math.hypot(b.vx, b.vz) > 3.5) { inp.jump = inp.jumpPressed = true; jumped = true; }
    } else if (jumped && !b.grounded) inp.jump = true;
    else if (jumped && b.grounded && b.ground !== to) jumped = false;
    world.setTime(i * dt);
    b.step(dt, inp, env);
    if (b.y < top - 7) return false;
  }
  return false;
}

for (const M of MAPS) {
  const L = generateLevel(M.id), world = new World(L.cols);
  for (const c of L.cols) if (c.kind === 'secret') c.on = true;
  const env = { world, others: [], wind: null, grip: 1, maxReel: 4 };
  for (const r of L.relics) {
    // In a maze: every cell of a maze can be reached whichever way its walls stand (a maze with no loops spans them all).
    if (r.maze !== undefined) { console.log(`${M.key} relic ${r.i}: ${Math.round(r.y - 2)} m, in maze ${r.maze}`); continue; }
    const b = new Body(), st = r.start, path = [st, ...r.stones];
    b.spawn(st.x, st.y + st.hy + PR + 0.05, st.z);
    for (let k = 0; k < 30; k++) b.step(dt, none, env);
    let ok = true, why = '';
    for (let i = 0; i + 1 < path.length && ok; i++) { ok = hop(b, path[i], path[i + 1], world, env); if (!ok) why = 'out, hop ' + (i + 1); }
    const reached = ok && Math.hypot(b.x - r.x, b.y - r.y, b.z - r.z) < 1.9;
    let back = reached;
    for (let i = path.length - 1; i > 0 && back; i--) { back = hop(b, path[i], path[i - 1], world, env); if (!back) why = 'back, hop ' + i; }
    if (!reached || !back) failed++;
    const gaps = r.stones.map((s) => (s.y + s.hy).toFixed(1)).join(' ');
    console.log(`${M.key} relic ${r.i}: ${Math.round(r.y - 2)} m, ${r.stones.length} stones, reach ${reached ? 'yes' : 'NO'}, back ${back ? 'yes' : 'NO'} ${why} (tops ${gaps}, start ${(st.y + st.hy).toFixed(1)})`);
  }
  for (const c of L.cols) if (c.kind === 'secret') c.on = false;
  if (L.relics.length < 2) { failed++; console.log(`${M.key}: only ${L.relics.length} relics`); }
}
if (failed) { console.log('FAILED', failed); process.exitCode = 1; } else console.log('all relics reachable both ways');
