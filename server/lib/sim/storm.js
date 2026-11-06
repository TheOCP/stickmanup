// Copied from assets/js by dev/makesim.mjs. Do not edit here.
// Storm hazards driven purely by shared game time, so every phone sees the same strikes and gusts.
import { hash, TAU } from './util.js';
import { DIFFS, dvOn } from './level.js';

const GUST_SLOT = 18, GUST_WARN = 1.6;
const GUST_STR = { 4: 18, 5: 22, 6: 24 };
// Each map's own trouble high up, in the zones where the storm's gusts blow (GUST_STR), on the same clock: the storm keeps
// its gusts, a wave runs round the waterfall, the city locks lasers on you, the pirate ship off the islands fires its
// cannons, the volcano quakes and the forest's bees come after you. None of it inside a maze garden (game.js).
export const EVENT_OF = { storm: 'gust', waterfall: 'wave', city: 'laser', sunny: 'cannon', volcano: 'quake', forest: 'bees' };
const EV_LEN = { gust: 2.4, wave: 4.0, laser: 4.3, cannon: 4.6, quake: 2.6, bees: 7.0 };
// Lasers: four shots, each aimed where you are when its mark appears. Cannons: two volleys of three balls, one on you and
// two beside. Quakes: three shocks, and only feet on the ground feel them.
export const LASER_N = 4, LASER_GAP = 1.0, LASER_WARN = 0.9, LASER_R = 1.5;
export const CANNON_V = 2, CANNON_N = 3, CANNON_GAP = 2.1, CANNON_WARN = 1.5, CANNON_R = 1.6, CANNON_OFF = 2.5;
export const QUAKE_AT = [0.5, 1.3, 2.1];
export const WAVE_BAND = 0.5, WAVE_H = 0.9, BEE_SPEED = 4.4, BEE_R = 0.9;

function inBox(c, x, y, z) {
  const m = c.m, dx = x - c.x, dy = y - c.y, dz = z - c.z;
  return Math.abs(dx * m[0] + dy * m[1] + dz * m[2]) < c.hx && Math.abs(dx * m[3] + dy * m[4] + dz * m[5]) < c.hy &&
    Math.abs(dx * m[6] + dy * m[7] + dz * m[8]) < c.hz;
}

// Storm-map lightning aimed at climbers: every few seconds each one gets a short warning ring, then a strike there.
const THUNDER = [{ every: 8, warn: 1.0 }, { every: 6.5, warn: 0.8 }, { every: 5.2, warn: 0.65 }, { every: 4.4, warn: 0.55 }];

export class Storm {
  constructor(level, diff) {
    this.L = level;
    this.k = DIFFS[diff].storm;
    this.th = THUNDER[diff] || THUNDER[1];
    this.setHaz(diff);
    this.stun = new Map(); // monster index -> { from, until } (frozen where it was hit)
    this.hunt = new Map(); // monster index -> where it is while it comes after you (game.js huntStep)
  }

  // Thunder for player slot at time t: { k (strike id), warn 0..1, strikeAt, phase 'warn'|'idle' }.
  thunder(t, slot) {
    if (this.L.mapKey !== 'storm') return null;
    const P = this.th.every, k = Math.floor(t / P), at = k * P + 1.5 + hash(k * 13 + slot * 7 + 5) * (P - 2.5);
    const w = this.th.warn;
    return { k, strikeAt: at, warn: t > at - w && t < at ? 1 - (at - t) / w : 0, due: at };
  }

  monsterPos(m, t, out) {
    const s = this.stun.get(m.i), h = this.hunt.get(m.i);
    if (h) {
      out.x = h.x; out.z = h.z; out.y = m.y; out.dir = 1;
      out.hunt = true; out.hx = h.hx; out.hz = h.hz; out.lunge = h.lunge;
      out.stunned = !!s && t >= s.from && t < s.until;
      return out;
    }
    out.hunt = false;
    return this.patrolPos(m, t, out);
  }

  // Where a creature is on its beat.
  patrolPos(m, t, out) {
    const s = this.stun.get(m.i), tt = s && t >= s.from && t < s.until ? s.from : t;
    const f = 0.5 - 0.5 * Math.cos(TAU * (tt / m.per + m.ph));
    out.x = m.ax + (m.bx - m.ax) * f; out.z = m.az + (m.bz - m.az) * f;
    out.y = m.y + Math.abs(Math.sin(TAU * (tt / m.per + m.ph) * 2)) * 0.35;
    out.stunned = tt !== t;
    out.dir = Math.sin(TAU * (tt / m.per + m.ph)) >= 0 ? 1 : -1;
    return out;
  }

  batPos(b, t, out) {
    const s = this.stun.get(1000 + b.i), tt = s && t >= s.from && t < s.until ? s.from : t;
    const a = TAU * (tt / b.per + b.ph);
    out.x = b.cx + Math.cos(a) * b.rad; out.z = b.cz + Math.sin(a) * b.rad;
    out.y = b.cy + Math.sin(a * 2) * 0.6;
    out.a = a;
    out.stunned = tt !== t;
    return out;
  }

  // Hazard setting 0 calm, 1 normal, 2 wild, 3 insane: how hard knocks are, how fast obstacles move, and which
  // of them are switched on at all (each has a lvl; it's active from that setting up).
  setHaz(h) {
    this.haz = h;
    this.k = [0.7, 1.0, 1.15, 1.3][h];
    this.hs = [0.8, 1.0, 1.22, 1.38][h];
    this.th = THUNDER[h] || THUNDER[1];
  }
  // The traps on a hidden path (o.sec) only exist while that path does: game.js sets which ones are there.
  // A hidden spot's traps only on the difficulty it is there on (o.dv).
  on(o) { return (o.sec === undefined || !!(this.sec && this.sec[o.sec] && dvOn(o, this.sec))) && (o.lvl === undefined || o.lvl <= this.haz); }

  // Spinning bars (lasers, fire bars, branches...): angle of bar k at time t.
  laserAngle(l, t, k = 0) {
    return TAU * ((t * this.hs * (l.sp || 1)) / l.per + l.ph) + (k * TAU) / (l.n || 1);
  }

  // Pendulum: where the swinging weight is (out: x, y, z, a = swing angle).
  pendulum(o, t, out) {
    const a = o.amp * Math.sin(TAU * ((t * this.hs * (o.sp || 1)) / o.per + o.ph)), s = Math.sin(a) * o.L;
    out.x = o.x + o.nx * s; out.y = o.y - Math.cos(a) * o.L; out.z = o.z + o.nz * s; out.a = a;
    return out;
  }

  // Slider: rolling ball/log/saw along the platform, or a ram shoving across it (fast out, slow back).
  slider(o, t, out) {
    const u = ((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1;
    let f, dir;
    if (o.shape === 'ram') {
      f = u < 0.18 ? u / 0.18 : u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
      dir = u < 0.18 ? 1 : u < 0.45 ? 0 : -1;
      const d = o.a + (o.b - o.a) * f;
      out.x = o.x + o.vx * d; out.z = o.z + o.vz * d; out.y = o.y + 0.55;
      out.warn = u > 0.85 ? (u - 0.85) / 0.15 : 0;
    } else if (o.one) {
      // One way, down a slope: rolls from the top end to the bottom, then pops back up at the top.
      f = Math.min(1, u / 0.8);
      dir = -1;
      const d = o.b - (o.b - o.a) * f;
      out.x = o.x + o.ux * d; out.z = o.z + o.uz * d; out.y = o.y + (o.slope || 0) * d + o.r;
      out.roll = d / o.r;
      out.hide = u >= 0.8;
      out.warn = u > 0.92 ? 1 : 0;
    } else {
      f = 0.5 - 0.5 * Math.cos(TAU * u);
      dir = Math.sin(TAU * u) >= 0 ? 1 : -1;
      const d = o.a + (o.b - o.a) * f;
      out.x = o.x + o.ux * d; out.z = o.z + o.uz * d; out.y = o.y + (o.slope || 0) * d + o.r;
      out.roll = d / o.r;
      out.warn = 0;
    }
    out.dir = dir;
    return out;
  }

  // Leaping fish: where it is along its arc across the bridge (out.on while in the air, warn just before).
  leap(o, t, out) {
    const u = (((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1) * o.per, s = u / o.dur, k = Math.min(1, s);
    const lo = o.lo ?? 0.8, d = (-1 + 2 * k) * o.span * o.dir, H = o.h + lo;
    out.on = s < 1;
    out.x = o.x + o.nx * d; out.z = o.z + o.nz * d;
    out.y = o.y - lo + H * 4 * k * (1 - k);
    out.vy = H * 4 * (1 - 2 * k) / (2 * o.span);
    out.warn = !out.on && u > o.per - 0.6 ? 1 - (o.per - u) / 0.6 : 0;
    return out;
  }

  // Crusher: how high the block's underside is above the floor (2.2 up to 0 slammed), and a shake
  // warning before it drops.
  crusher(o, t) {
    const u = ((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1, P = o.per;
    const tUp = 0.55, tFall = tUp + 0.12 / P, tDown = tFall + 0.45 / P;
    if (u < tUp) return { h: 2.2, shake: u > tUp - 0.6 / P ? 1 - (tUp - u) / (0.6 / P) : 0, down: false };
    if (u < tFall) return { h: 2.2 * (1 - (u - tUp) / (tFall - tUp)), shake: 0, down: true };
    if (u < tDown) return { h: 0, shake: 0, down: true };
    return { h: 2.2 * Math.min(1, (u - tDown) / (1 - tDown)), shake: 0, down: false };
  }

  // On/off things (spikes, jets): on for `duty` of the period; warn 0..1 just before they come on.
  pulse(o, t, lead = 0.6) {
    const u = ((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1, left = (1 - u) * o.per;
    return { on: u < o.duty, warn: u >= o.duty && left < lead ? 1 - left / lead : 0, k: u < o.duty ? u / o.duty : 0 };
  }

  // Shock ring: grows along the floor from its middle, over and over. out: r how far it has got, k 0 to 1.
  ring(o, t, out) {
    const u = ((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1;
    out.r = u * o.rmax; out.k = u;
    return out;
  }

  // Comet: flies along its line and comes round again. out: where it is, fly while it is on its way, warn 0 to 1 just before.
  comet(o, t, out) {
    const u = (((((t * this.hs * (o.sp || 1)) / o.per + o.ph) % 1) + 1) % 1) * o.per, flight = (2 * o.span) / o.speed;
    const d = Math.min(u, flight) * o.speed - o.span;
    out.fly = u < flight;
    out.x = o.x + o.dx * d; out.y = o.y; out.z = o.z + o.dz * d;
    out.warn = o.per - u < 0.8 ? 1 - (o.per - u) / 0.8 : 0;
    return out;
  }

  // Windmill: the angle of blade k, in the plane across the bridge.
  blade(o, t, k = 0) {
    return TAU * ((t * this.hs * (o.sp || 1)) / o.per + o.ph) + (k * TAU) / o.n;
  }

  // Blinking platforms: solid for `duty` of the period, flickering for the last 0.6 s before they go.
  blink(b, t) {
    const u = ((((t * this.hs * (b.sp || 1)) / b.per + b.ph) % 1) + 1) % 1, left = (b.duty - u) * b.per;
    return { on: u < b.duty, warn: u < b.duty && left < 0.6 ? 1 - left / 0.6 : 0 };
  }

  // Trapdoors: open for `open` seconds of each period, rattling for half a second before.
  trap(tr, t) {
    const u = ((((t * this.hs * (tr.sp || 1)) / tr.per + tr.ph) % 1) + 1) % 1 * tr.per;
    return { open: u < tr.open, warn: u > tr.per - 0.5 ? (u - (tr.per - 0.5)) / 0.5 : 0, k: u < tr.open ? u / tr.open : 0 };
  }

  // Laser curtain: on for `duty` of each period, flickering for the last 0.45 s before it switches on.
  gate(l, t) {
    const u = ((((t * this.hs * (l.sp || 1)) / l.per + l.ph) % 1) + 1) % 1, left = (1 - u) * l.per;
    return { on: u < l.duty, warn: u >= l.duty && left < 0.45 ? 1 - left / 0.45 : 0 };
  }

  // Arrow trap: where its arrow is (if flying) and how close it is to firing (warn 0..1).
  arrow(a, t, out) {
    const u = (((((t * this.hs * (a.sp || 1)) / a.per + a.ph) % 1) + 1) % 1) * a.per, flight = a.range / a.speed;
    out.fly = u < flight;
    const d = Math.min(u, flight) * a.speed;
    out.x = a.x + a.dx * d; out.y = a.y; out.z = a.z + a.dz * d;
    out.warn = a.per - u < 0.55 ? 1 - (a.per - u) / 0.55 : 0;
    return out;
  }

  // Volcano vent: erupting for the first `dur` seconds of each period; warn 0..1 just before it goes.
  geyser(g, t) {
    const u = (((((t * this.hs * (g.sp || 1)) / g.per + g.ph) % 1) + 1) % 1) * g.per;
    return { on: u < g.dur, k: u < g.dur ? u / g.dur : 0, warn: g.per - u < 0.9 ? 1 - (g.per - u) / 0.9 : 0 };
  }

  // Falling boulder: a shadow grows for 1.4 s, the rock falls for the last 0.45 s, lands at the end of
  // the period and sits there for half a second. out: { warn 0..1, fall 0..1 or -1, rest, y }.
  rock(r, t, out) {
    const u = (((((t * this.hs * (r.sp || 1)) / r.per + r.ph) % 1) + 1) % 1) * r.per;
    out.warn = r.per - u < 1.4 ? 1 - (r.per - u) / 1.4 : 0;
    out.fall = r.per - u < 0.45 ? 1 - (r.per - u) / 0.45 : -1;
    out.rest = u < 0.5;
    out.y = out.fall >= 0 ? r.y + 0.7 + 16 * (1 - out.fall * out.fall) : r.y + 0.7;
    return out;
  }

  rodWarn(r, t) {
    const ph = (((t / r.per + r.ph) % 1) + 1) % 1, left = (1 - ph) * r.per;
    return left < 1.4 ? 1 - left / 1.4 : 0;
  }

  // Calls fn(rod) for every rod that strikes in (t0, t1].
  strikes(t0, t1, fn) {
    if (t1 <= t0) return;
    for (const r of this.L.rods) if (Math.floor(t1 / r.per + r.ph) > Math.floor(t0 / r.per + r.ph)) fn(r);
  }

  fanOn(f, t) {
    return this.on(f) && ((((t * this.hs * (f.sp || 1)) / f.per + f.ph) % 1) + 1) % 1 < 0.5;
  }

  // The map's event in a zone at time t: { kind, k (which one), start, u (seconds since it started), len, warn 0..1 (the
  // last moments before it), on, sign, radial, str, a0 }, or null where there is none.
  event(t, zone) {
    const kind = EVENT_OF[this.L.mapKey], s = GUST_STR[zone];
    if (!kind || !s) return null;
    const k = Math.floor(t / GUST_SLOT), start = k * GUST_SLOT + 4 + hash(k) * 8, u = t - start, len = EV_LEN[kind];
    return {
      kind, k, start, u, len,
      warn: u < 0 && u > -GUST_WARN ? 1 + u / GUST_WARN : 0,
      on: u >= 0 && u < len,
      sign: hash(k + 1000) < 0.5 ? -1 : 1,
      radial: hash(k + 2000) < 0.35,
      str: s * this.k,
      a0: hash(k + 3000) * TAU,
    };
  }

  // Gust state for a zone at time t (the storm only): { warn 0..1, on, sign, radial, str }.
  gust(t, zone) {
    const e = this.event(t, zone);
    return e && e.kind === 'gust' ? e : null;
  }

  // The wave's front: the angle round the falls it has reached, and whether (x, z) is in the water just behind it.
  waveFront(e) { return e.a0 + e.sign * TAU * (e.u / e.len); }
  inWave(e, x, z) {
    if (!e || e.kind !== 'wave' || !e.on) return false;
    const d = ((((this.waveFront(e) - Math.atan2(z, x)) * e.sign) % TAU) + TAU) % TAU;
    return d < WAVE_BAND;
  }

  // The aimed shots of a laser or cannon event: [{ id, mark (when its mark appears), at (when it lands), dx, dz (how far
  // from the aim it lands) }].
  shots(e) {
    const out = [];
    if (!e) return out;
    if (e.kind === 'laser') for (let i = 0; i < LASER_N; i++) out.push({ id: i, mark: e.start + i * LASER_GAP, at: e.start + i * LASER_GAP + LASER_WARN, dx: 0, dz: 0 });
    if (e.kind === 'cannon') for (let v = 0; v < CANNON_V; v++) for (let b = 0; b < CANNON_N; b++) {
      const a = hash(e.k * 7 + v * 3 + b + 4000) * TAU, d = b ? CANNON_OFF : 0;
      out.push({ id: v * CANNON_N + b, mark: e.start + v * CANNON_GAP, at: e.start + v * CANNON_GAP + CANNON_WARN, dx: Math.cos(a) * d, dz: Math.sin(a) * d });
    }
    return out;
  }

  // Wind acceleration at a robot's position.
  wind(b, out, t, zone) {
    for (const f of this.L.fans) {
      if (Math.abs(b.y - f.y) > 4 || !this.fanOn(f, t) || !inBox(f.reg, b.x, b.y, b.z)) continue;
      out.x += f.dx * 34 * this.k;
      out.z += f.dz * 34 * this.k;
    }
    // Gravity wells on the hidden courses: on and off, they pull you toward them, in the air as well.
    for (const w of this.L.wells) {
      const dx = w.x - b.x, dy = w.y - b.y, dz = w.z - b.z;
      if (Math.abs(dy) > w.reach || Math.abs(dx) + Math.abs(dz) > w.reach * 1.5 || !this.on(w) || !this.pulse(w, t).on) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d > w.reach || d < 0.01) continue;
      out.x += (dx / d) * w.str * this.k;
      out.z += (dz / d) * w.str * this.k;
    }
    const g = this.gust(t, zone);
    if (g && g.on) {
      const r = Math.hypot(b.x, b.z) || 1, cx = b.x / r, cz = b.z / r;
      if (g.radial) { out.x += cx * g.str; out.z += cz * g.str; }
      else { out.x += -cz * g.sign * g.str; out.z += cx * g.sign * g.str; }
    }
    return out;
  }
}

// Puts down the marks of an event's aimed shots where a climber (x, z, feet at y) is when each mark appears, but not inside
// a maze garden (calm), and forgets old ones. marks: key -> { key, kind, x, y, z, mark, at, struck }. Says whether a mark
// went down right on them.
export function markShots(S, marks, ev, x, y, z, t, calm) {
  let mine = false;
  if (ev && (ev.kind === 'laser' || ev.kind === 'cannon')) {
    for (const sh of S.shots(ev)) {
      const key = ev.k * 100 + sh.id;
      if (marks.has(key) || calm || t < sh.mark || t >= sh.at) continue;
      marks.set(key, { key, kind: ev.kind, x: x + sh.dx, y, z: z + sh.dz, mark: sh.mark, at: sh.at, struck: false });
      if (!sh.dx && !sh.dz) mine = true;
    }
  }
  for (const [key, m] of marks) if (t > m.at + 2 || t < m.mark - 1) marks.delete(key);
  return mine;
}

// The swarm after a climber at (x, y, z): it comes out of the trees beside them when the event starts, flies after them a
// little slower than they run, and gives up when the event is over or they get into a maze garden (calm).
export function beeStep(B, ev, x, y, z, dt, calm) {
  if (!ev || ev.kind !== 'bees') return B && B.gone ? B : null;
  if ((!B || B.k !== ev.k) && ev.on && !calm) {
    const a = hash(ev.k * 5 + 6000) * TAU;
    B = { k: ev.k, x: x + Math.cos(a) * 7, y: y + 1.2, z: z + Math.sin(a) * 7, gone: false };
  }
  if (!B || B.k !== ev.k || B.gone) return B;
  if (!ev.on || calm) { B.gone = true; return B; }
  const dx = x - B.x, dy = y + 0.3 - B.y, dz = z - B.z, d = Math.hypot(dx, dy, dz) || 1, m = Math.min(d, BEE_SPEED * dt);
  B.x += (dx / d) * m; B.y += (dy / d) * m; B.z += (dz / d) * m;
  return B;
}
