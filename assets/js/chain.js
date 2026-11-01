// The energy cord between two robots: a bead chain that drapes and wraps around ledges.
// Its path length tells the game how taut the cord is, and the first bead gives the pull direction.
const o = { nx: 0, ny: 0, nz: 0, d: 0 };

export class Chain {
  constructor(n = 12) {
    this.n = n;
    this.p = [];
    this.q = [];
    for (let i = 0; i <= n; i++) {
      this.p.push({ x: 0, y: 0, z: 0 });
      this.q.push({ x: 0, y: 0, z: 0 });
    }
    this.len = 0;
    this.dirA = { x: 0, y: 1, z: 0 };
    this.dirB = { x: 0, y: 1, z: 0 };
    this.ok = false;
  }

  reset(a, b) {
    const n = this.n;
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = Math.sin(t * Math.PI) * 0.3;
      const p = this.p[i];
      p.x = a.x + (b.x - a.x) * t; p.y = a.y + (b.y - a.y) * t - s; p.z = a.z + (b.z - a.z) * t;
      Object.assign(this.q[i], p);
    }
    this.ok = true;
  }

  step(a, b, L, world, dt) {
    const n = this.n, p = this.p, q = this.q, seg = L / n;
    if (!this.ok) this.reset(a, b);
    p[0].x = a.x; p[0].y = a.y; p[0].z = a.z;
    p[n].x = b.x; p[n].y = b.y; p[n].z = b.z;
    const g = -16 * dt * dt;
    for (let i = 1; i < n; i++) {
      const pi = p[i], qi = q[i];
      const vx = (pi.x - qi.x) * 0.95, vy = (pi.y - qi.y) * 0.95, vz = (pi.z - qi.z) * 0.95;
      qi.x = pi.x; qi.y = pi.y; qi.z = pi.z;
      pi.x += vx; pi.y += vy + g; pi.z += vz;
    }
    for (let k = 0; k < 10; k++) {
      for (let i = 0; i < n; i++) {
        const A = p[i], B = p[i + 1];
        const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= seg || d < 1e-9) continue;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === n ? 0 : 1, w = wa + wb;
        if (!w) continue;
        const f = (d - seg) / (d * w);
        A.x += dx * f * wa; A.y += dy * f * wa; A.z += dz * f * wa;
        B.x -= dx * f * wb; B.y -= dy * f * wb; B.z -= dz * f * wb;
      }
      if (k & 1) for (let i = 1; i < n; i++) world.pushOut(p[i], 0.07, o);
    }
    let len = 0;
    for (let i = 0; i < n; i++) len += Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y, p[i + 1].z - p[i].z);
    // A cord snagged far around geometry (or a teleport) snaps back to a straight line.
    if (!(len < L * 2.2)) {
      this.reset(a, b);
      len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    this.len = len;
    dir(p[0], p[1], a, b, this.dirA);
    dir(p[n], p[n - 1], b, a, this.dirB);
  }
}

function dir(from, to, a, b, out) {
  let dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-4) {
    dx = b.x - a.x; dy = b.y - a.y; dz = b.z - a.z;
    d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  }
  out.x = dx / d; out.y = dy / d; out.z = dz / d;
}
