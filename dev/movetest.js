// The new moves against the real physics and the real maps. Plain checks of wall jump and dash, then a little bot
// that really does every dash gap and every wall jump shaft on every map. Also checks every plain hop of the route
// against how far a jump really reaches. Exit code 1 if anything fails.
import { generateLevel, MAPS, DIFFS } from '../assets/js/level.js';
import { World, makeBox, BOX } from '../assets/js/physics.js';
import { Body, PC, PR, F } from '../assets/js/player.js';

const dt = 1 / 60;
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const input = (o = {}) => Object.assign({ mx: 0, mz: 0, fx: 0, fz: -1, jump: false, jumpPressed: false, dash: false, grab: false, reel: false }, o);
const envOf = (cols, extra) => Object.assign({ world: new World(cols), others: [], grip: 1, maxReel: 5, wind: null }, extra);
const run = (b, env, n, inp) => { for (let i = 0; i < n; i++) { env.world.setTime && env.world.setTime(b.time); b.step(dt, typeof inp === 'function' ? inp(i) : inp, env); } };
const box = (x, y, z, hx, hy, hz) => { const c = makeBox(x, y, z, hx, hy, hz, 0, 0, 0); c.kind = 'plat'; return c; };

// ---------------------------------------------------------------- how far a plain jump reaches
function jumpClears(gap, dy) {
  const A = box(0, -0.35, 0, 3, 0.35, 1), B = box(6 + gap, dy - 0.35, 0, 3, 0.35, 1), env = envOf([A, B]), b = new Body();
  b.spawn(-2.5, PR + 0.02, 0);
  let jumped = false;
  for (let i = 0; i < 400; i++) {
    const go = !jumped && b.x > 2.98 && b.grounded;
    if (go) jumped = true;
    b.step(dt, input({ mx: 1, jump: true, jumpPressed: go }), env);
    if (jumped && b.grounded && b.ground === B) return true;
    if (b.y < dy - 6) return false;
  }
  return false;
}
const maxJump = (dy) => { let g = 9; while (g > 0 && !jumpClears(g, dy)) g -= 0.05; return g; };
const REACH = new Map();
for (const dy of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) REACH.set(dy, maxJump(dy));
const reach = (dy) => {
  const q = Math.min(2, Math.max(-1.5, dy)), lo = Math.floor(q * 2) / 2, hi = Math.min(2, lo + 0.5);
  return REACH.get(lo) + (REACH.get(hi) - REACH.get(lo)) * ((q - lo) / 0.5);
};
console.log('furthest jump, edge to edge:', [...REACH].map(([d, g]) => `${d >= 0 ? '+' : ''}${d} m up ${g.toFixed(2)} m`).join(', '));

// ---------------------------------------------------------------- dash
{
  const floor = box(0, -0.5, 0, 40, 0.5, 40), env = envOf([floor]), b = new Body();
  b.spawn(0, PR + 0.01, 0);
  run(b, env, 5, input());
  const x0 = b.x;
  b.step(dt, input({ mx: 1, dash: true }), env);
  check('dash starts along the stick', b.dashT > 0 && b.flags & F.DASH);
  run(b, env, 9, input({ mx: 1 }));
  check('dash covers ground fast', b.x - x0 > 2.2, `${(b.x - x0).toFixed(2)} m in 0.17 s`);
  const cd = b.dashCd;
  b.step(dt, input({ mx: 1, dash: true }), env);
  check('dash has a cooldown', cd > 0 && !(b.flags & F.DASH));
  run(b, env, 50, input());
  b.step(dt, input({ dash: true }), env);
  check('no stick: dashes where the camera looks', b.flags & F.DASH && b.dashZ === -1);
  // One in the air, back after landing.
  run(b, env, 60, input());
  b.step(dt, input({ jump: true, jumpPressed: true }), env);
  run(b, env, 10, input({ jump: true }));
  const y0 = b.y;
  b.step(dt, input({ mx: 1, jump: true, dash: true }), env);
  run(b, env, 9, input({ mx: 1, jump: true }));
  check('air dash goes straight across', Math.abs(b.y - y0) < 0.02, `y moved ${(b.y - y0).toFixed(3)}`);
  run(b, env, 50, input({ jump: true }));
  b.step(dt, input({ dash: true, jump: true }), env);
  check('only one dash in the air', b.grounded || !(b.flags & F.DASH) || b.dashReady);
  run(b, env, 120, input());
  check('landing gives the dash back', b.dashReady && b.grounded);
  // Blocked by a wall: the dash ends at once.
  const wall = box(3, 2, 0, 0.5, 4, 5), e2 = envOf([floor, wall]), c = new Body();
  c.spawn(0, PR + 0.01, 0);
  run(c, e2, 5, input());
  c.step(dt, input({ mx: 1, dash: true }), e2);
  run(c, e2, 12, input({ mx: 1 }));
  check('a wall stops a dash', !(c.flags & F.DASH) && c.x < 3 - 0.5 - PR + 0.02, `x ${c.x.toFixed(2)}`);
  // Stunned, clamped: no dash.
  const s = new Body();
  s.spawn(0, PR + 0.01, 0);
  run(s, env, 5, input());
  s.stun = 1;
  s.step(dt, input({ mx: 1, dash: true }), env);
  check('no dash while stunned', !(s.flags & F.DASH));
}

// ---------------------------------------------------------------- wall jump
{
  const floor = box(0, -0.5, 0, 40, 0.5, 40), wall = box(2, 8, 0, 0.5, 8, 6), env = envOf([floor, wall]), b = new Body();
  const atWall = () => b.x > 1.5 - PR - 0.05;
  // Jump at the wall, press again on touching it.
  b.spawn(0, PR + 0.01, 0);
  run(b, env, 5, input());
  b.step(dt, input({ mx: 1, jump: true, jumpPressed: true }), env);
  let kicked = false, peak = 0;
  for (let i = 0; i < 90; i++) {
    const press = !kicked && atWall() && b.vy < 4;
    if (press) kicked = true;
    b.step(dt, input({ mx: kicked ? 0 : 1, jump: true, jumpPressed: press }), env);
    peak = Math.max(peak, b.y);
    if (b.events.some((e) => e.k === 'walljump')) break;
  }
  check('jump against a wall kicks off it', b.events.some((e) => e.k === 'walljump') && b.vx < -3 && b.vy > 5, `vx ${b.vx.toFixed(1)} vy ${b.vy.toFixed(1)}`);
  // The same wall won't kick twice in a row.
  b.events.length = 0;
  let second = false;
  for (let i = 0; i < 120 && !b.grounded; i++) {
    b.step(dt, input({ mx: 1, jump: true, jumpPressed: atWall() }), env);
    if (b.events.some((e) => e.k === 'walljump')) second = true;
  }
  check('one wall alone can\'t be climbed', !second);
  // Sliding down.
  const s = new Body();
  s.spawn(1.5 - PR, 12, 0);
  run(s, env, 60, input({ mx: 1 }));
  check('pressing into a wall slides down slowly', s.flags & F.WALL && Math.abs(s.vy - PC.WALL_SLIDE) < 0.01, `vy ${s.vy.toFixed(2)}`);
  // Not at all without a wall, or from the ground.
  const n = new Body();
  n.spawn(-10, 8, 0);
  run(n, env, 5, input());
  n.step(dt, input({ jumpPressed: true }), env);
  check('no wall jump without a wall', !n.events.some((e) => e.k === 'walljump') && n.vy < 0);
  // From a grab on a wall.
  const g = new Body();
  g.spawn(1.5 - PR, 6, 0);
  run(g, env, 3, input({ mx: 1, grab: true }));
  const was = g.anchored;
  g.step(dt, input({ mx: 1, grab: true, jump: true, jumpPressed: true }), env);
  check('jump from a wall grab kicks off', was && !g.anchored && g.vy > 5 && g.vx < -3, `vx ${g.vx.toFixed(1)}`);
  run(g, env, 5, input({ mx: 1, grab: true }));
  check('no grabbing straight back on', !g.anchored);
  // Insane: late jumps are gone.
  const coy = (coyote) => {
    const A = box(0, -0.35, 0, 2, 0.35, 2), e = envOf([A], coyote === undefined ? {} : { coyote }), c = new Body();
    c.spawn(1, PR + 0.01, 0);
    let t = 0;
    run(c, e, 5, input());
    for (; t < 60 && c.grounded; t++) c.step(dt, input({ mx: 1 }), e);
    const off = c.vy;
    run(c, e, 5, input({ mx: 1 }));
    c.step(dt, input({ mx: 1, jump: true, jumpPressed: true }), e);
    return c.vy > off + 3;
  };
  check('a late jump works on Normal', coy(undefined));
  check('a late jump fails on Insane', !coy(DIFFS[3].coyote));
}

// ---------------------------------------------------------------- the real maps
let total = { dash: 0, chimney: 0 };
for (const M of MAPS) {
  const L = generateLevel(M.id), solid = new Set();
  const env = envOf(L.cols.filter((c) => !c.secret && c.kind !== 'secret'));
  env.world.setTime && env.world.setTime(0);

  // A dash gap: from the edge, a full speed jump, then a dash near the top of the jump.
  let bad = [];
  for (const m of L.moves.filter((q) => q.k === 'dash')) {
    const b = new Body(), back = Math.max(0.1, m.sa - 1.2);
    b.spawn(m.ax + m.ux * back, m.ay + PR + 0.02, m.az + m.uz * back);
    const inp = (o) => input(Object.assign({ mx: m.ux, mz: m.uz, jump: true }, o));
    run(b, env, 3, input());
    let jumped = false, dashed = false, ok = false, at = 0;
    for (let i = 0; i < 300; i++) {
      const along = (b.x - m.ax) * m.ux + (b.z - m.az) * m.uz;
      const go = !jumped && (b.grounded ? along > m.sa - 0.05 : b.coyote > 0);
      if (go) { jumped = true; at = i; }
      const dash = jumped && !dashed && !b.grounded && b.vy < 1.5 && i > at + 6;
      if (dash) dashed = true;
      b.step(dt, inp({ jumpPressed: go, dash }), env);
      if (jumped && b.grounded && Math.abs(b.y - PR - m.by) < 0.1 && (b.x - m.bx) ** 2 + (b.z - m.bz) ** 2 < 9) { ok = true; break; }
      if (b.y < m.ay - 8) break;
    }
    // And it really needs the dash.
    const no = new Body();
    no.spawn(m.ax + m.ux * back, m.ay + PR + 0.02, m.az + m.uz * back);
    run(no, env, 3, input());
    let j2 = false, plain = false;
    for (let i = 0; i < 300; i++) {
      const along = (no.x - m.ax) * m.ux + (no.z - m.az) * m.uz;
      const go = !j2 && (no.grounded ? along > m.sa - 0.02 : no.coyote > 0);
      if (go) j2 = true;
      no.step(dt, inp({ jumpPressed: go }), env);
      if (j2 && no.grounded && Math.abs(no.y - PR - m.by) < 0.1 && (no.x - m.bx) ** 2 + (no.z - m.bz) ** 2 < 9) { plain = true; break; }
      if (no.y < m.ay - 8) break;
    }
    total.dash++;
    if (!ok) { const u = env.world, c0 = L.cols.find((c) => Math.abs(c.x - m.ax) < 0.01 && Math.abs(c.z - m.az) < 0.01); bad.push(`dash gap at ${m.ay.toFixed(0)} m (${m.g.toFixed(2)} m wide, by ${(m.by - m.ay).toFixed(2)}, from ${c0 ? c0.kind + (c0.dyn ? ' moving' : '') + (c0.surf ? ' ' + c0.surf : '') + (c0.crumble ? ' crumble' : '') : 'nothing'}) can't be crossed`); }
    if (plain) bad.push(`dash gap at ${m.ay.toFixed(0)} m (${m.g.toFixed(2)} m wide) doesn't need a dash`);
  }

  // A shaft: from the platform before it onto the open floor, in between the walls, bounce until above them, then
  // over the far wall onto the way out.
  for (const m of L.moves.filter((q) => q.k === 'chimney')) {
    const e = new Body();
    e.spawn(m.ax, m.ay + PR + 0.02, m.az);
    run(e, env, 3, input());
    let arrived = false, jumpedIn = false;
    for (let i = 0; i < 300; i++) {
      const dx = m.fx - e.x, dz = m.fz - e.z, d = Math.hypot(dx, dz) || 1, onFloor = e.grounded && Math.abs(e.y - PR - m.y) < 0.1 && d < 2.2;
      if (onFloor) { arrived = true; break; }
      const go = !jumpedIn && (e.grounded ? false : e.coyote > 0);
      if (go) jumpedIn = true;
      // In the air, slow enough not to fly past it.
      const air = !e.grounded && d < 1;
      e.step(dt, input({ mx: air ? 0 : dx / d, mz: air ? 0 : dz / d, jump: true, jumpPressed: go }), env);
      if (e.y < m.y - 6) break;
    }
    total.chimney++;
    // Nothing else hangs in its air, secret stones included.
    for (const c of L.cols) {
      if (c.kick || c.shaft) continue;
      const v = c.t === BOX ? c.hy : c.hh, rad = c.t === BOX ? 0 : c.r;
      if (c.dyn || c.y + v < m.y + 0.1 || c.y - v > m.y + m.H + 1.2) continue;
      const dx = c.x - m.x, dz = c.z - m.z;
      if (Math.abs(dx * m.nx + dz * m.nz) < m.W / 2 + rad && Math.abs(dx * m.ox + dz * m.oz) < m.deep / 2 + rad) bad.push(`wall jump shaft at ${m.y.toFixed(0)} m has a ${c.kind} in it at ${c.y.toFixed(1)}`);
    }
    if (!arrived) bad.push(`wall jump shaft at ${m.y.toFixed(0)} m: can't get onto its floor from the platform before it`);
    // Whichever wall you go for first, and whether you kick the moment you touch or a little late, you have to get out.
    for (const first of [1, -1]) for (const late of [0, 5]) {
      const b = new Body();
      b.spawn(m.x, m.y + PR + 0.02, m.z);
      run(b, env, 3, input());
      let dir = first, ok = false, kicks = 0, started = false, out = false, touched = 0;
      for (let i = 0; i < 900; i++) {
        // Going for the low wall and above it.
        if (dir > 0 && b.y > m.y + m.F + PR + 0.05) out = true;
        const ex = m.tx - b.x, ez = m.tz - b.z, el = Math.hypot(ex, ez) || 1;
        const mx = out ? ex / el : m.nx * dir, mz = out ? ez / el : m.nz * dir;
        const facing = b.time - b.wallT < 0.05 && (b.wallNx * m.nx + b.wallNz * m.nz) * dir < -0.7;
        touched = facing && !out ? touched + 1 : 0;
        let press = false;
        if (!started && b.grounded) { press = true; started = true; }
        else if (touched > late) { press = true; dir = -dir; kicks++; touched = 0; }
        b.step(dt, input({ mx, mz, jump: true, jumpPressed: press }), env);
        if (b.grounded && Math.abs(b.y - PR - m.ty) < 0.15) { ok = true; break; }
        if (b.grounded && b.y < m.y + PR + 0.2 && kicks > 0) break;
      }
      const how = `${first > 0 ? 'low' : 'tall'} wall first${late ? ', kicking late' : ''}`;
      if (!ok) bad.push(`wall jump shaft at ${m.y.toFixed(0)} m (walls ${m.F.toFixed(1)} and ${m.H.toFixed(1)} m), ${how}: got to ${b.y.toFixed(1)}, top ${m.ty.toFixed(1)}`);
      // The first shaft on a map teaches the move, so one good kick may do there.
      else if (kicks < (m.F < 4.5 ? 1 : 2)) bad.push(`wall jump shaft at ${m.y.toFixed(0)} m, ${how}: climbed with only ${kicks} kicks`);
    }
  }

  // Every plain hop has to be within a jump, with room to spare.
  let hopMax = 0, tight = 0;
  for (const h of L.hops) {
    if (h.dash) continue;
    hopMax = Math.max(hopMax, h.g);
    if (h.g > reach(h.dy) - 0.5) { tight++; if (tight <= 3) bad.push(`hop ${h.g.toFixed(2)} m wide, ${h.dy.toFixed(2)} m up in zone ${h.zone + 1}: a jump only reaches ${reach(h.dy).toFixed(2)} m`); }
  }
  const lifts = L.cols.filter((c) => c.kind === 'lift').length;
  check(`${M.key}: dash gaps ${L.moves.filter((q) => q.k === 'dash').length}, wall jump shafts ${L.moves.filter((q) => q.k === 'chimney').length}, widest hop ${hopMax.toFixed(2)} m, lifts ${lifts}`, !bad.length, bad.slice(0, 6).join('; '));
}
console.log(`tried ${total.dash} dash gaps and ${total.chimney} shafts`);
if (fails.length) { console.log('FAILED:', fails.length); process.exit(1); }
console.log('all good');
