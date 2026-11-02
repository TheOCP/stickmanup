// Storm hazards driven purely by shared game time, so every phone sees the same strikes and gusts.
import { hash, TAU } from './util.js';
import { DIFFS } from './level.js';

const GUST_SLOT = 18, GUST_LEN = 2.4, GUST_WARN = 1.6;
const GUST_STR = { 4: 18, 5: 22, 6: 24 };

function inBox(c, x, y, z) {
  const m = c.m, dx = x - c.x, dy = y - c.y, dz = z - c.z;
  return Math.abs(dx * m[0] + dy * m[1] + dz * m[2]) < c.hx && Math.abs(dx * m[3] + dy * m[4] + dz * m[5]) < c.hy &&
    Math.abs(dx * m[6] + dy * m[7] + dz * m[8]) < c.hz;
}

// Storm-map lightning aimed at climbers: every few seconds each one gets a short warning ring, then a strike there.
const THUNDER = [{ every: 8, warn: 1.0 }, { every: 6.5, warn: 0.8 }, { every: 5.2, warn: 0.65 }];

export class Storm {
  constructor(level, diff) {
    this.L = level;
    this.k = DIFFS[diff].storm;
    this.th = THUNDER[diff] || THUNDER[1];
    this.setHaz(diff);
    this.stun = new Map(); // monster index -> { from, until } (frozen where it was hit)
  }

  // Thunder for player slot at time t: { k (strike id), warn 0..1, strikeAt, phase 'warn'|'idle' }.
  thunder(t, slot) {
    if (this.L.mapKey !== 'storm') return null;
    const P = this.th.every, k = Math.floor(t / P), at = k * P + 1.5 + hash(k * 13 + slot * 7 + 5) * (P - 2.5);
    const w = this.th.warn;
    return { k, strikeAt: at, warn: t > at - w && t < at ? 1 - (at - t) / w : 0, due: at };
  }

  monsterPos(m, t, out) {
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

  // Hazard setting 0 calm, 1 normal, 2 wild: how hard knocks are, how fast obstacles move, and which
  // of them are switched on at all (each has a lvl; it's active from that setting up).
  setHaz(h) {
    this.haz = h;
    this.k = [0.7, 1.0, 1.15][h];
    this.hs = [0.8, 1.0, 1.22][h];
    this.th = THUNDER[h] || THUNDER[1];
  }
  on(o) { return o.lvl === undefined || o.lvl <= this.haz; }

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
    } else {
      f = 0.5 - 0.5 * Math.cos(TAU * u);
      dir = Math.sin(TAU * u) >= 0 ? 1 : -1;
      const d = o.a + (o.b - o.a) * f;
      out.x = o.x + o.ux * d; out.z = o.z + o.uz * d; out.y = o.y + o.r;
      out.roll = d / o.r;
      out.warn = 0;
    }
    out.dir = dir;
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

  // Gust state for a zone at time t: { warn 0..1, on, sign, radial, str }.
  gust(t, zone) {
    const s = GUST_STR[zone];
    if (!s) return null;
    const k = Math.floor(t / GUST_SLOT), start = k * GUST_SLOT + 4 + hash(k) * 8, dt = t - start;
    return {
      warn: dt < 0 && dt > -GUST_WARN ? 1 + dt / GUST_WARN : 0,
      on: dt >= 0 && dt < GUST_LEN,
      sign: hash(k + 1000) < 0.5 ? -1 : 1,
      radial: hash(k + 2000) < 0.35,
      str: s * this.k,
    };
  }

  // Wind acceleration at a robot's position.
  wind(b, out, t, zone) {
    for (const f of this.L.fans) {
      if (Math.abs(b.y - f.y) > 4 || !this.fanOn(f, t) || !inBox(f.reg, b.x, b.y, b.z)) continue;
      out.x += f.dx * 34 * this.k;
      out.z += f.dz * 34 * this.k;
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
