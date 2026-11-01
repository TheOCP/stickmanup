// Headless physics checks: landing, walking, jump height, cord hanging and dragging, riding movers.
import { generateLevel } from '../assets/js/level.js';
import { World, makeBox } from '../assets/js/physics.js';
import { Body, PR, cord } from '../assets/js/player.js';
import { Chain } from '../assets/js/chain.js';

const L = generateLevel();
const world = new World(L.cols);
const dt = 1 / 60;
const none = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false };
const env = (others = []) => ({ world, others, wind: null, grip: 1, maxReel: 4 });
const sx = Math.cos(L.spawn.th) * L.spawn.r, sz = Math.sin(L.spawn.th) * L.spawn.r;
let t = 0;
const tick = (bodies, inputs, n, link) => {
  for (let i = 0; i < n; i++) {
    t += dt; world.setTime(t);
    bodies.forEach((b, k) => b.step(dt, inputs[k] || none, env(bodies.filter((o) => o !== b))));
    if (link) link();
  }
};
const f = (v) => v.toFixed(2);

const a = new Body();
a.spawn(sx, 5, sz);
tick([a], [none], 120);
console.log('1 land   y=', f(a.y), 'expect', f(2 + PR), 'grounded', a.grounded);
const x0 = a.x, z0 = a.z;
tick([a], [{ ...none, mx: 0, mz: 1 }], 60);
console.log('2 walk   dist/1s=', f(Math.hypot(a.x - x0, a.z - z0)));
tick([a], [none], 30);
let peak = a.y, y0 = a.y;
tick([a], [{ ...none, jump: true, jumpPressed: true }], 1);
for (let i = 0; i < 60; i++) { tick([a], [{ ...none, jump: true }], 1); peak = Math.max(peak, a.y); }
console.log('3 jump   height=', f(peak - y0), 'grounded after', a.grounded);

// Cord test on a test ledge: box top at y=10, edge at x=2.
const ledge = makeBox(0, 9.5, 300, 2, 0.5, 2);
const w2 = new World([ledge]);
const env2 = (others) => ({ world: w2, others, wind: null, grip: 1, maxReel: 4 });
function run(anchorA, seconds, input) {
  const A = new Body(), B = new Body(), Lr = 6.2, ch = new Chain(10);
  A.spawn(0.5, 10 + PR, 300); B.spawn(2.6, 10.5, 300);
  const inA = { ...none, grab: anchorA, ...(input || {}) }, idle = { ...none, grab: anchorA };
  for (let i = 0; i < seconds * 60; i++) {
    A.step(dt, input && input.after > i / 60 ? idle : inA, env2([B])); B.step(dt, none, env2([A]));
    const Leff = Lr - Math.max(A.reel, B.reel), sA = { x: A.x, y: A.y, z: A.z, vy: A.vy, flags: A.flags }, sB = { x: B.x, y: B.y, z: B.z, vy: B.vy, flags: B.flags };
    A.hanging = B.hanging = false;
    ch.step(A, B, Leff, w2, dt);
    cord(A, sB, Leff, env2([B]), 100, ch, true);
    cord(B, sA, Leff, env2([A]), 100, ch, false);
  }
  return { A, B, ch: { len: Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) }, Lr };
}
let r = run(true, 3);
console.log('4 anchored hold: A', f(r.A.x), f(r.A.y), 'anchored', r.A.anchored, '| B', f(r.B.x), f(r.B.y), '| cord', f(r.ch.len), 'of', r.Lr);
r = run(false, 1.0);
console.log('5 no grab 1s: A slid to x=', f(r.A.x), 'y=', f(r.A.y), '| B y=', f(r.B.y));
r = run(false, 2.5);
console.log('5b no grab 2.5s: A x=', f(r.A.x), 'y=', f(r.A.y), '(fell off?)', r.A.y < 9);
r = run(false, 2.9, { mx: -1, after: 1.5 });
console.log('5c hang 1.5s, then walk away 1.4s: A x=', f(r.A.x), 'y=', f(r.A.y), '| B y=', f(r.B.y), '(was ~5.2 while hanging)');
r = run(true, 3, { reel: true });
console.log('6 grab+reel: B y=', f(r.B.y), 'B x=', f(r.B.x), 'cord', f(r.ch.len));

// Ride a mover: find one and stand on it.
const mv = L.cols.find((c) => c.kind === 'mover');
world.setTime(0); world.setTime(0.001);
const m = new Body();
m.spawn(mv.x, mv.y + mv.hy + PR + 0.05, mv.z);
t = 0;
tick([m], [none], 1);
const start = [mv.x, mv.z];
tick([m], [none], 180);
const off = Math.hypot(m.x - mv.x, m.z - mv.z);
console.log('7 mover moved', f(Math.hypot(mv.x - start[0], mv.z - start[1])), 'm; robot still on it (offset', f(off), ') grounded', m.grounded);
