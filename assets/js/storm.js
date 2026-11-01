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

  // Spinning laser bar: angle of beam k at time t.
  laserAngle(l, t, k = 0) {
    return TAU * (t / l.per + l.ph) + (k * TAU) / (l.n || 1);
  }

  // Laser curtain: on for `duty` of each period, flickering for the last 0.45 s before it switches on.
  gate(l, t) {
    const u = (((t / l.per + l.ph) % 1) + 1) % 1, left = (1 - u) * l.per;
    return { on: u < l.duty, warn: u >= l.duty && left < 0.45 ? 1 - left / 0.45 : 0 };
  }

  // Arrow trap: where its arrow is (if flying) and how close it is to firing (warn 0..1).
  arrow(a, t, out) {
    const u = ((((t / a.per + a.ph) % 1) + 1) % 1) * a.per, flight = a.range / a.speed;
    out.fly = u < flight;
    const d = Math.min(u, flight) * a.speed;
    out.x = a.x + a.dx * d; out.y = a.y; out.z = a.z + a.dz * d;
    out.warn = a.per - u < 0.55 ? 1 - (a.per - u) / 0.55 : 0;
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
    return (((t / f.per + f.ph) % 1) + 1) % 1 < 0.5;
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
