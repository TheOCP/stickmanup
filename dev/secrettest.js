// Can a real climber get through every relic course? Runs the game's own physics with a small autopilot, one jump at a time
// from each thing you stand on to the next, starting at many different moments, since most of it moves. A jump passes if at
// some moment the bot lands. It says "hit" if it only got there by being hit by an obstacle on the way, and FAIL if it never did.
// The moving parts run at the given difficulty speed, the fastest by default.
// Usage: node dev/secrettest.js [map key]
import { generateLevel, MAPS } from '../assets/js/level.js';
import { World, placeDyn } from '../assets/js/physics.js';
import { Body, PR } from '../assets/js/player.js';
import { Storm } from '../assets/js/storm.js';

const dt = 1 / 60, only = process.argv[2];
const none = { mx: 0, mz: 0, fx: 0, fz: -1, jump: false, jumpPressed: false, dash: false, grab: false, reel: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const P = {};
// Would this obstacle hit a climber here at time t? (The same tests as game.js hazards.)
function hit(o, me, t, S) {
  const feet = me.y - PR;
  if (!S.on(o) || Math.abs(o.y - feet) > 5 || Math.abs(o.x - me.x) + Math.abs(o.z - me.z) > 10) return false;
  switch (o.prim) {
    case 'sweep': {
      if (Math.abs(me.y - o.y) > 0.5 + o.w) return false;
      for (let k = 0; k < o.n; k++) {
        const a = S.laserAngle(o, t, k), ux = Math.cos(a), uz = -Math.sin(a), px = me.x - o.x, pz = me.z - o.z, q = clamp(px * ux + pz * uz, 0, o.len), dx = px - ux * q, dz = pz - uz * q;
        if (dx * dx + dz * dz < (0.42 + o.w) ** 2) return true;
      }
      return false;
    }
    case 'pendulum': { const p = S.pendulum(o, t, P); return Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < o.r + PR; }
    case 'crusher': {
      const st = S.crusher(o, t), c = Math.cos(o.ry), sn = Math.sin(o.ry), dx = me.x - o.x, dz = me.z - o.z;
      return st.down && st.h < 1.3 && Math.abs(dx * c - dz * sn) < o.hs + PR * 0.6 && Math.abs(dx * sn + dz * c) < o.hs + PR * 0.6 && feet < o.y + 1.4;
    }
    case 'spikes': {
      const st = S.pulse(o, t), c = Math.cos(o.ry), sn = Math.sin(o.ry), dx = me.x - o.x, dz = me.z - o.z;
      return st.on && Math.abs(dx * c - dz * sn) < o.hx + 0.1 && Math.abs(dx * sn + dz * c) < o.hz + 0.1 && feet < o.y + 0.6;
    }
    case 'windmill': {
      const dx = me.x - o.x, dy = me.y - o.y, dz = me.z - o.z;
      if (Math.abs(dx * o.ux + dz * o.uz) > 0.6) return false;
      const l = dx * o.uz - dz * o.ux;
      for (let k = 0; k < o.n; k++) {
        const a = S.blade(o, t, k), c = Math.cos(a), sn = Math.sin(a), q = clamp(l * c + dy * sn, 0, o.R), ex = l - c * q, ey = dy - sn * q;
        if (ex * ex + ey * ey < 0.34) return true;
      }
      return false;
    }
    case 'ring': {
      if (feet > o.y + 0.6 || feet < o.y - 0.8) return false;
      const r = S.ring(o, t, P).r;
      return r > 0.5 && Math.abs(Math.hypot(me.x - o.x, me.z - o.z) - r) < 0.38;
    }
    case 'comet': { const p = S.comet(o, t, P); return p.fly && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < o.r + PR; }
    case 'well': return Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z) < o.r + PR;
    default: return false;
  }
}

function setBlinks(L, S, t) { for (const c of L.blinks) c.on = S.on(c.blink) ? S.blink(c.blink, t).on : c.kind !== 'secret'; }
function setTime(world, L, S, t) { world.setTime(t); setBlinks(L, S, t); }

// Stand on `from` at its near end, then go for the nearest of `to`.
function attempt(world, L, S, env, from, to, t0, near, keep) {
  const b = new Body(), log = process.env.TRACE && t0 === 0 ? [] : null;
  let hop = false;
  let t = t0;
  for (const c of [from, ...to]) if (c.dyn) placeDyn(c, t);
  const target = () => { let best = to[0], bd = Infinity; for (const c of to) { if (!c.on) continue; const d = Math.hypot(c.x - b.x, c.z - b.z) + Math.abs(c.y - b.y) * 0.7; if (d < bd) { bd = d; best = c; } } return best; };
  // The near end of what we stand on, seen from where we are going.
  {
    const c0 = to[0], dx = c0.x - from.x, dz = c0.z - from.z, d = Math.hypot(dx, dz) || 1, co = Math.cos(from.ry), sn = Math.sin(from.ry), ux = (dx / d) * co - (dz / d) * sn, uz = (dx / d) * sn + (dz / d) * co;
    const a0 = from.dyn ? 0 : -Math.sign(ux) * Math.max(0, from.hx - 0.5), e0 = from.dyn ? 0 : -Math.sign(uz) * Math.max(0, from.hz - 0.5) * Math.min(1, Math.abs(uz) * 2);
    b.spawn(from.x + a0 * co + e0 * sn, from.y + from.hy + PR + 0.02, from.z - a0 * sn + e0 * co);
  }
  b.ground = from;
  let jumped = false, hits = 0, dashed = false, was = true;
  const n = (keep || 5) * 60;
  for (let i = 0; i < n; i++) {
    t += dt;
    setTime(world, L, S, t);
    // Go for the nearest part of it that is safely inside the edge, not its middle.
    const c = target(), co = Math.cos(c.ry), sn = Math.sin(c.ry), lx = b.x - c.x, lz = b.z - c.z, ax = clamp(lx * co - lz * sn, -Math.max(0, c.hx - 0.4), Math.max(0, c.hx - 0.4)), az = clamp(lx * sn + lz * co, -Math.max(0, c.hz - 0.4), Math.max(0, c.hz - 0.4));
    const tx = c.shaftOf ? c.shaftOf.fx : c.x + ax * co + az * sn, tz = c.shaftOf ? c.shaftOf.fz : c.z - ax * sn + az * co, top = c.y + c.hy, dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
    if (b.grounded && to.includes(b.ground) && Math.hypot(b.x - c.x, b.z - c.z) < Math.hypot(c.hx, c.hz) + 0.6) return { ok: true, hits };
    const inp = { ...none, mx: dx / d, mz: dz / d };
    let atEnd = false;
    // On the ground, first to the end of this stone nearest where we are going, along it and not off its side.
    if (b.grounded && b.ground === from && !from.dyn) {
      const cf = Math.cos(from.ry), sf = Math.sin(from.ry), rx = c.x - from.x, rz = c.z - from.z, ea = clamp(rx * cf - rz * sf, -Math.max(0, from.hx - 0.3), Math.max(0, from.hx - 0.3)), eb = clamp(rx * sf + rz * cf, -Math.max(0, from.hz - 0.3), Math.max(0, from.hz - 0.3));
      const qx = from.x + ea * cf + eb * sf - b.x, qz = from.z - ea * sf + eb * cf - b.z, ql = Math.hypot(qx, qz);
      if (ql > (Math.max(from.hx, from.hz) < 0.8 ? 0.1 : 0.3)) { inp.mx = qx / ql; inp.mz = qz / ql; } else atEnd = true;
    }
    if (!b.grounded) {
      // In the air, steer like a player: just fast enough to come down on the middle, not past it.
      const dy = b.y - (top + PR), disc = b.vy * b.vy + 2 * 24 * Math.max(dy, -b.vy * b.vy / 48), T = Math.max(0.05, (b.vy + Math.sqrt(Math.max(0, disc))) / 24);
      let wx = dx / T / 6.2, wz = dz / T / 6.2;
      const l = Math.hypot(wx, wz);
      if (l > 1) { wx /= l; wz /= l; }
      inp.mx = wx; inp.mz = wz;
      inp.jump = true;
      if (i > 8) jumped = true;
      // Too far for what is left of the jump: dash.
      const overFrom = Math.abs(b.x - from.x) < Math.max(from.hx, from.hz) && Math.abs(b.z - from.z) < Math.max(from.hx, from.hz);
      // Only when even the near edge of the stone is out of reach: landing on the edge is landing.
      const lEdge = Math.max(0, Math.hypot(dx, dz) - Math.min(c.hx, c.hz) * 0.7) / T / 6.2;
      if (jumped && !dashed && lEdge > 1.02 && b.vy < 2.5 && !(hop && overFrom)) { inp.dash = true; dashed = true; }
    } else if (b.ground === from) {
      // Landed back on it after jumping something on the way.
      jumped = false; dashed = false; hop = false;
      // From a moving stone, or on a wide one: only go when the target is about right.
      const hgap = d - Math.max(c.hx, c.hz) - Math.max(from.hx, from.hz) * 0.2, dyT = top - (b.y - PR);
      // Rings: jump them as they get close.
      let ringNear = false;
      for (const o of L.obs) if (o.prim === 'ring' && S.on(o) && Math.abs(o.y - (b.y - PR)) < 1) { const r = S.ring(o, t, P).r; if (r > 0.3 && Math.abs(Math.hypot(b.x - o.x, b.z - o.z) - r) < 1.15) ringNear = true; }
      const edge = (() => {
        const co = Math.cos(from.ry), sn = Math.sin(from.ry), lx = b.x - from.x, lz = b.z - from.z, a = lx * co - lz * sn, e = lx * sn + lz * co, ux = inp.mx * co - inp.mz * sn, uz = inp.mx * sn + inp.mz * co;
        const ta = ux > 1e-3 ? (from.hx - a) / ux : ux < -1e-3 ? (-from.hx - a) / ux : 1e9, tb = uz > 1e-3 ? (from.hz - e) / uz : uz < -1e-3 ? (-from.hz - e) / uz : 1e9;
        return Math.min(ta, tb);
      })();
      if (ringNear && !jumped && edge > 1.1) { inp.jumpPressed = inp.jump = true; hop = true; }
      else if (!jumped && (edge < 0.14 || atEnd) && Math.hypot(b.vx, b.vz) > 2.5) { inp.jumpPressed = inp.jump = true; jumped = true; }
      else if (near && !jumped && edge < 1 && dyT < 3 && hgap < 3 && Math.hypot(b.vx, b.vz) > 1) { inp.jumpPressed = inp.jump = true; jumped = true; }
    } else if (b.grounded) {
      if (!jumped) return { ok: false };
      jumped = false; dashed = false;
      return { ok: false };
    }
    b.step(dt, inp, env);
    if (log && i % 6 === 0) console.log(`     t${i} pos ${b.x.toFixed(2)} ${(b.y - PR - from.y - from.hy).toFixed(2)} ${b.z.toFixed(2)} v ${b.vx.toFixed(1)} ${b.vy.toFixed(1)} ${b.vz.toFixed(1)} ${b.grounded ? 'G' : 'air'}${b.ground && b.ground !== from ? ' on ' + b.ground.kind : ''} ${jumped ? 'J' : ''} ${b.contact && b.time - b.contactT < 0.1 ? 'touch ' + b.contact.kind : ''}`);
    for (const o of L.obs) if (hit(o, b, t, S)) { hits++; break; }
    // A bounce pad throws you off again before you ever stand on it.
    if (b.events.length) {
      if (b.events.some((e) => e.k === 'pad') && to.some((q) => q.surf === 'pad' && Math.hypot(b.x - q.x, b.z - q.z) < Math.hypot(q.hx, q.hz) + 0.6)) return { ok: true, hits };
      b.events.length = 0;
    }
    if (b.y < Math.min(from.y, ...to.map((q) => q.y)) - 7) return { ok: false };
    was = b.grounded;
  }
  return { ok: false };
}

// A wall jump shaft: bounce between the walls and out over the low one.
function shaftRun(world, L, S, env, floor, exit) {
  const m = floor.shaftOf, t0 = 0, b = new Body();
  setTime(world, L, S, t0);
  for (let side = 0; side < 2; side++) {
    for (let delay = 8; delay < 30; delay += 2) {
      b.spawn(m.cx + m.ux * (side ? -0.6 : 0.6), m.y + PR + 0.02, m.cz);
      let dir = side ? -1 : 1, t = t0, lastKick = -1, jumpedOnce = false;
      for (let i = 0; i < 900; i++) {
        t += dt;
        setTime(world, L, S, t);
        const inp = { ...none, mx: m.ux * dir, mz: m.uz * dir };
        const high = b.y > m.y + m.F + 0.2;
        if (high) { const dx = exit.x - b.x, dz = exit.z - b.z, d = Math.hypot(dx, dz) || 1; inp.mx = dx / d; inp.mz = dz / d; }
        if (b.grounded && b.ground === exit) return true;
        if (!jumpedOnce && b.grounded) { inp.jump = inp.jumpPressed = true; jumpedOnce = true; }
        else if (!high && b.canWallJump() && i - lastKick > delay) { inp.jump = inp.jumpPressed = true; dir = -dir; lastKick = i; }
        else inp.jump = true;
        b.step(dt, inp, env);
        if (b.y < m.y - 3) break;
      }
    }
  }
  return false;
}

let fails = 0, soft = 0, jumps = 0;
const onlyRelic = process.argv[3], onlyStep = process.argv[4] === undefined ? -1 : +process.argv[4];
for (const M of MAPS) {
  if (only && M.key !== only) continue;
  const L = generateLevel(M.id), world = new World(L.cols), S = new Storm(L, 3);
  for (const c of L.cols) if (c.kind === 'secret') c.on = true;
  S.sec = { hard: true, open: true };
  if (S.setHaz) S.setHaz(3);
  S.thunder = () => null;
  const env = { world, others: [], grip: 1, maxReel: 4, wind: null };
  for (const r of L.relics) {
    if (!r.way || (onlyRelic && r.id !== onlyRelic)) continue;
    const bad = [], hitOnly = [];
    let prev = [r.start];
    for (let w = 0; w < r.way.length; w++) {
      const to = r.way[w], from = prev;
      prev = to;
      if (onlyStep >= 0 && w !== onlyStep) continue;
      if (onlyStep >= 0) console.log(`     from ${from[0].x.toFixed(2)} ${from[0].z.toFixed(2)} to ${to[0].x.toFixed(2)} ${to[0].z.toFixed(2)}`);
      jumps++;
      let done = false, onlyHit = false;
      if (from[0].shaftOf) { done = shaftRun(world, L, S, env, from[0], to[0]); }
      else {
        const moving = to.some((c) => c.dyn || c.blink) || from.some((c) => c.dyn || c.blink);
        for (let k = 0; k < (moving ? 90 : 30) && !done; k++) {
          const t0 = k * 0.21, a = from[k % from.length];
          // Wait until this stone is under us.
          env.wind = (b, o) => S.wind(b, o, t0 + b.time, 0);
          const got = attempt(world, L, S, env, a, to, t0, moving, 5);
          if (got.ok && !got.hits) done = true;
          else if (got.ok) onlyHit = true;
        }
      }
      if (!done && onlyHit) hitOnly.push(w);
      else if (!done) {
        const f = from[0], g = to[0], desc = (c) => `${c.hx.toFixed(2)}x${c.hz.toFixed(2)}${c.dyn ? ' ' + c.dyn.k : ''}${c.blink ? ' blink' : ''}${c.surf ? ' ' + c.surf : ''}${c.crumble ? ' crumble' : ''}${c.shaftOf ? ' shaft' : ''}`, dx = g.x - f.x, dz = g.z - f.z;
        bad.push(`${w}`);
        console.log(`   ${r.id} step ${w}: ${desc(f)} to ${desc(g)}, centres ${Math.hypot(dx, dz).toFixed(2)} apart, ${(g.y + g.hy - f.y - f.hy).toFixed(2)} up, near: ${L.obs.filter((o) => o.sec && Math.hypot(o.x - g.x, o.z - g.z) < 9 && Math.abs(o.y - g.y) < 7).map((o) => o.prim).join(' ')}`);
      }
    }
    fails += bad.length; soft += hitOnly.length;
    console.log(`${r.id.padEnd(13)} ${String(r.way.length).padStart(2)} steps  ${bad.length ? 'FAIL ' + bad.join(' ') : 'ok'}${hitOnly.length ? '  hit at ' + hitOnly.join(' ') : ''}   ${r.made.join(' ')}`);
  }
  for (const c of L.cols) if (c.kind === 'secret') c.on = false;
}
console.log(`${jumps} jumps, ${fails} never made, ${soft} only made by taking a hit`);
if (fails) process.exitCode = 1;
