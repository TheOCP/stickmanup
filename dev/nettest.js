// Networked cord physics: each robot is simulated by its own "phone" and sees its partner 100 ms late,
// applying only its own share of the cord correction (the same cord() the game uses).
import { World, makeBox } from '../assets/js/physics.js';
import { Body, PR, cord } from '../assets/js/player.js';
import { Chain } from '../assets/js/chain.js';

const dt = 1 / 60, LAG = 6, ROPE = 6.2;
const none = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false };
const W = new World([makeBox(0, 9.5, 0, 2, 0.5, 2), makeBox(0, -0.5, 0, 30, 0.5, 30)]);
const env = (others) => ({ world: W, others, wind: null, grip: 1, maxReel: ROPE - 1.2 });
const snap = (b) => ({ x: b.x, y: b.y, z: b.z, vy: b.vy, flags: b.flags, reel: b.reel });

function run(inA, inB, secs, setup) {
  const A = new Body(), B = new Body(), cA = new Chain(10), cB = new Chain(10);
  A.spawn(0.5, 10 + PR, 0); B.spawn(2.6, 10.5, 0);
  if (setup) setup(A, B);
  const histA = [], histB = [];
  let minBy = 99, maxPull = 0;
  for (let i = 0; i < secs * 60; i++) {
    histA.push(snap(A)); histB.push(snap(B));
    const oB = histB[Math.max(0, histB.length - 1 - LAG)], oA = histA[Math.max(0, histA.length - 1 - LAG)];
    const step = (me, op, inp, ch, first) => {
      const before = [me.x, me.y, me.z];
      me.step(dt, inp, env([op]));
      me.hanging = false;
      const L = ROPE - Math.max(me.reel, op.reel);
      if (Math.hypot(op.x - me.x, op.y - me.y, op.z - me.z) > ROPE * 3) ch.ok = false;
      else ch.step(first ? me : op, first ? op : me, L, W, dt);
      cord(me, op, L, env([op]), ROPE * 3, ch, first);
      maxPull = Math.max(maxPull, Math.hypot(me.x - before[0], me.y - before[1], me.z - before[2]));
    };
    step(A, oB, inA, cA, true);
    step(B, oA, inB, cB, false);
    minBy = Math.min(minBy, B.y);
  }
  const d = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
  return { A: [A.x, A.y].map((v) => v.toFixed(2)), B: [B.x, B.y].map((v) => v.toFixed(2)), dist: d.toFixed(2), minBy: minBy.toFixed(2), maxStep: maxPull.toFixed(2), anchored: A.anchored };
}

console.log('1 A grabs, B dangles (4s):      ', JSON.stringify(run({ ...none, grab: true }, none, 4)));
console.log('2 A idle, B dangles (4s):       ', JSON.stringify(run(none, none, 4)));
console.log('3 A grabs+reels B up (4s):      ', JSON.stringify(run({ ...none, grab: true, reel: true }, none, 4)));
console.log('4 teleport-sized gap is ignored:', JSON.stringify(run(none, none, 0.5, (A, B) => B.spawn(60, 10.5, 0))));
