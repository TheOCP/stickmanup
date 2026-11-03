// Automatic graphics against simulated phones. Usage: node dev/autoqtest.js
import { AutoQ, STEPS } from '../assets/js/autoq.js';
// Roughly what each step costs against step 0: less resolution, no edge smoothing, then per corner lighting.
const COST = [1, 0.84, 0.62, 0.48, 0.3, 0.22, 0.14, 0.1, 0.08];
if (COST.length !== STEPS.length) throw new Error('cost table out of date');
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
function run(fullCost, secs, { budget = 1000 / 60, start = 0, last, heat = () => 1, spike = () => 0 } = {}) {
  const q = new AutoQ({ budget, start, last }), log = [];
  for (let s = 0; s < secs; s++) {
    const load = fullCost * COST[q.level] * heat(s), lvl = q.level;
    q.tick(load, load * 1.08 + spike(s), load > budget ? Math.round((load / budget - 1) * 60) : 0, 60);
    log.push({ s, lvl, load, next: q.level });
  }
  return { q, log, changes: log.filter((l) => l.lvl !== l.next), over: log.filter((l) => l.load > budget) };
}
const B = 1000 / 60;
{ const r = run(7, 300); check('strong phone keeps full graphics', r.q.level === 0 && r.changes.length === 0, `changes ${r.changes.length}`); }
{ const r = run(13, 300); const after = r.log.slice(30); check('medium phone settles under the limit', after.every((l) => l.load < B * 0.82), `level ${r.q.level}, load ${after[after.length - 1].load.toFixed(1)} ms`);
  check('medium phone does not keep flipping', r.changes.filter((c) => c.s > 60).length <= 4, `${r.changes.filter((c) => c.s > 60).length} changes after a minute`); }
{ const r = run(60, 120); const t = r.log.findIndex((l) => l.load < B); check('weak phone (GPU 4x too slow) is under the limit within 10 s', t >= 0 && t <= 10, `after ${t} s at level ${r.log[t] && r.log[t].lvl}`); check('weak phone ends up steady', r.log.slice(20).every((l) => l.load < B * 0.95), `level ${r.q.level}`); }
{ const r = run(130, 120); const t = r.log.findIndex((l) => l.lvl === STEPS.length - 1); check('hopeless phone gets the lowest step fast', t >= 0 && t <= 12, `after ${t} s`); }
{ const r = run(7, 60, { start: 6 }); check('a remembered low step recovers when there is room', r.q.level <= 3, `level ${r.q.level} after a minute`); }
{ const r = run(9, 900, { heat: (s) => 1 + Math.min(1, s / 300) * 0.8 }); const lastBit = r.log.slice(-60); check('a phone heating up steps down and stays under', lastBit.every((l) => l.load < B * 0.85), `level ${r.q.level}, load ${lastBit[59].load.toFixed(1)} ms`); }
{ const r = run(11, 400, { spike: (s) => (s % 37 === 0 ? 6 : 0) }); check('a single slow second changes nothing', r.changes.filter((c) => c.s > 60).length <= 1, `${r.changes.length} changes`); }
{ const r = run(30, 100, { budget: 1000 / 120, last: 3 }); check('above 60 fps it never gives up the look', r.q.level <= 3 && !STEPS[r.q.level].lite, `level ${r.q.level}`); }
{ const r = run(10, 200, { budget: 1000 / 30 }); check('at 30 fps there is room for full graphics', r.q.level === 0); }
{ const q = new AutoQ(); for (let i = 0; i < 30; i++) q.tick(0, 0, 0, 60); check('no measurements, no changes', q.level === 0); }
{ const q = new AutoQ(); q.tick(8, 8, 0, 60); q.settle(); for (let i = 0; i < 3; i++) q.tick(200, 400, 30, 20); q.tick(8, 8, 0, 60); check('a map load is not held against the phone', q.level === 0, `level ${q.level}`); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
