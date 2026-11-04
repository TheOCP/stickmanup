// Can a real climber get through every maze garden, whichever way its walls stand, and is there no way over a wall?
// Runs the game's own physics with a small autopilot: from the checkpoint, along the way through to the far porch, then the
// hop onto the landing. Then, in the checkpoint's cell, it runs and jumps at every wall round it for a while.
import { generateLevel, MAPS, applyMaze, mazePath, mazeCell, mazeLayout, MAZE_CELL, MAZE_RIM, MAZE_WALL_H } from '../assets/js/level.js';
import { World } from '../assets/js/physics.js';
import { Body, PR } from '../assets/js/player.js';

const dt = 1 / 120, none = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false };
let failed = 0, runs = 0;

function walkTo(b, x, z, env, world, t0, floorY) {
  for (let i = 0; i < 120 * 5; i++) {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    const k = Math.min(1, d / 0.8);
    world.setTime(t0 + i * dt);
    b.step(dt, { ...none, mx: (dx / d) * k, mz: (dz / d) * k }, env);
    if (b.y < floorY - 1) return false;
  }
  return false;
}

// Jump from the porch to a landing straight ahead, steering at its middle.
function hop(b, to, env, world) {
  const top = to.y + to.hy;
  let jumped = false;
  for (let i = 0; i < 120 * 4; i++) {
    const dx = to.x - b.x, dz = to.z - b.z, d = Math.hypot(dx, dz) || 1;
    if (b.grounded && b.ground === to) return true;
    const inp = { ...none, mx: dx / d, mz: dz / d };
    if (!jumped && b.grounded && Math.hypot(b.vx, b.vz) > 4 && d < Math.max(to.hx, to.hz) + 2.4) { inp.jump = inp.jumpPressed = true; jumped = true; }
    else if (jumped && !b.grounded) inp.jump = true;
    world.setTime(i * dt);
    b.step(dt, inp, env);
    if (b.y < top - 6) return false;
  }
  return false;
}

for (const M of MAPS) {
  const L = generateLevel(M.id), world = new World(L.cols);
  const env = { world, others: [], wind: null, grip: 1, maxReel: 4, zips: [] };
  let ok = 0, n = 0, walls = 0, over = 0;
  for (const m of L.mazes) {
    const cp = L.cps.find((c) => c.maze === m.i), C = MAZE_CELL, S = m.N * C, rowW = (j) => ((m.N - 1) / 2 - j) * C;
    for (const v of [0, 3, 8, 21]) {
      applyMaze(L, v);
      n++; runs++;
      const b = new Body();
      b.spawn(cp.x + Math.cos(0.4) * 0.64, cp.y + PR + 0.4, cp.z + Math.sin(0.4) * 0.64);
      for (let k = 0; k < 60; k++) b.step(dt, none, env);
      let good = b.grounded && b.ground === m.floor, why = good ? '' : 'not standing on the floor at the checkpoint';
      for (const [i, j] of mazePath(m, v).slice(1)) {
        if (!good) break;
        const [x, z] = mazeCell(m, i, j);
        if (!walkTo(b, x, z, env, world, 0, m.y)) { good = false; why = `stuck going to cell ${i},${j}`; }
      }
      // Out through the far porch, and over to the landing.
      const u = S / 2 + MAZE_RIM / 2, w = rowW(m.xj);
      if (good && !walkTo(b, m.x + m.fx * u + m.nx * w, m.z + m.fz * u + m.nz * w, env, world, 0, m.y)) { good = false; why = 'stuck going out'; }
      if (good && !hop(b, m.land, env, world)) { good = false; why = 'missed the landing'; }
      if (good) ok++;
      else { failed++; console.log(`${M.key} maze ${m.i} (${m.N}) variant ${v}: ${why} at ${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.z.toFixed(1)}`); }
    }
    // Every wall round the checkpoint's cell: run at it jumping, and at the wall jump moment jump again. Nobody may end
    // up in the next cell or on top.
    applyMaze(L, 0);
    const lay = mazeLayout(m, 0), N = m.N, [cx, cz] = mazeCell(m, m.ei, m.ej);
    const nb = [[1, 0, m.ej * (N - 1) + m.ei], [0, 1, N * (N - 1) + m.ej * N + m.ei]];
    for (const [di, dj, e] of nb) {
      if (m.ei + di >= N || m.ej + dj >= N || !lay[e]) continue;
      walls++;
      const [tx, tz] = mazeCell(m, m.ei + di, m.ej + dj), b = new Body();
      b.spawn(cx, m.y + PR + 0.4, cz);
      for (let k = 0; k < 40; k++) b.step(dt, none, env);
      let top = 0, through = false;
      for (let i = 0; i < 120 * 4; i++) {
        const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
        b.step(dt, { ...none, mx: dx / d, mz: dz / d, jump: true, jumpPressed: i % 9 === 0, grab: i % 30 < 15 }, env);
        top = Math.max(top, b.y - PR - m.y);
        if (Math.hypot(b.x - tx, b.z - tz) < C / 2 - 0.2) through = true;
      }
      if (through || top > MAZE_WALL_H - 0.05) { over++; failed++; console.log(`${M.key} maze ${m.i}: got over or through a wall (feet up to ${top.toFixed(2)} m)`); }
    }
  }
  console.log(`${M.key}: ${L.mazes.length} mazes, ${ok} of ${n} walked through, ${walls} walls tried, ${over} crossed`);
}
console.log(failed ? `${failed} problems in ${runs} walks` : `all ${runs} walks got through, no wall crossed`);
process.exit(failed ? 1 : 0);
