// Collision world: oriented boxes and vertical cylinders, swept by sphere-shaped robots.
// Rotations use three.js Euler order 'YXZ' so physics and meshes always agree.
import { TAU, clamp } from './util.js';

export const BOX = 0, CYL = 1;
const CELL = 4;

function rotMatrix(rx, ry, rz, m) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Columns are the local X, Y, Z axes in world space.
  m[0] = cy * cz + sy * sx * sz; m[1] = cx * sz; m[2] = -sy * cz + cy * sx * sz;
  m[3] = -cy * sz + sy * sx * cz; m[4] = cx * cz; m[5] = sy * sz + cy * sx * cz;
  m[6] = sy * cx; m[7] = -sx; m[8] = cy * cx;
}

function base(t, x, y, z, props) {
  return Object.assign({
    t, x, y, z, rx: 0, ry: 0, rz: 0, m: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    px: x, py: y, pz: z, pm: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    on: true, dyn: null, surf: null, kind: 'plat', zone: 0, stamp: 0, vis: true,
    minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0,
  }, props);
}

export function makeBox(x, y, z, hx, hy, hz, rx = 0, ry = 0, rz = 0, props) {
  const c = base(BOX, x, y, z, props);
  c.hx = hx; c.hy = hy; c.hz = hz;
  setRot(c, rx, ry, rz);
  c.pm.set(c.m);
  return c;
}

export function makeCyl(x, y, z, r, hh, props) {
  const c = base(CYL, x, y, z, props);
  c.r = r; c.hh = hh;
  aabb(c);
  return c;
}

// A cylinder can widen toward its foot (r1 at the bottom, r at the top), like the giant tree and the lighthouse.
export const cylR = (c, y) => (c.r1 ? c.r + (c.r1 - c.r) * clamp((c.y + c.hh - y) / (2 * c.hh), 0, 1) : c.r);

export function setRot(c, rx, ry, rz) {
  c.rx = rx; c.ry = ry; c.rz = rz;
  rotMatrix(rx, ry, rz, c.m);
  aabb(c);
}

export function aabb(c) {
  let ex, ey, ez;
  if (c.t === BOX) {
    const m = c.m;
    ex = Math.abs(m[0]) * c.hx + Math.abs(m[3]) * c.hy + Math.abs(m[6]) * c.hz;
    ey = Math.abs(m[1]) * c.hx + Math.abs(m[4]) * c.hy + Math.abs(m[7]) * c.hz;
    ez = Math.abs(m[2]) * c.hx + Math.abs(m[5]) * c.hy + Math.abs(m[8]) * c.hz;
  } else {
    ex = ez = Math.max(c.r, c.r1 || 0); ey = c.hh;
  }
  c.minx = c.x - ex; c.maxx = c.x + ex;
  c.miny = c.y - ey; c.maxy = c.y + ey;
  c.minz = c.z - ez; c.maxz = c.z + ez;
}

// Moves a dynamic collider to where its motion puts it at game time t.
export function placeDyn(c, t) {
  const d = c.dyn;
  const f = (per, ph) => TAU * (t / per + ph);
  if (d.k === 'pp') {
    const s = 0.5 - 0.5 * Math.cos(f(d.per, d.ph));
    c.x = d.ax + (d.bx - d.ax) * s; c.y = d.ay + (d.by - d.ay) * s; c.z = d.az + (d.bz - d.az) * s;
    aabb(c);
  } else if (d.k === 'orbit') {
    const a = d.a0 + TAU * t / d.per;
    c.x = d.hx + Math.cos(a) * d.off; c.y = d.hy; c.z = d.hz + Math.sin(a) * d.off;
    setRot(c, 0, -a, 0);
  } else if (d.k === 'tilt') {
    const s = Math.sin(f(d.per, d.ph)) * d.amp;
    setRot(c, d.ax === 'x' ? s : 0, c.ry, d.ax === 'z' ? s : 0);
  } else if (d.k === 'turn') {
    // Turntable: spins on the spot, carrying whoever stands on it.
    setRot(c, 0, d.a0 + d.w * t, 0);
  } else if (d.k === 'swing') {
    // Pendulum: hangs L below the pivot and swings along (ux, uz); the deck stays level.
    const a = d.amp * Math.sin(f(d.per, d.ph));
    c.x = d.px + d.ux * Math.sin(a) * d.L; c.y = d.py - Math.cos(a) * d.L; c.z = d.pz + d.uz * Math.sin(a) * d.L;
    aabb(c);
  } else if (d.k === 'bob') {
    const w = f(d.per, d.ph);
    c.y = d.y0 + Math.sin(w) * d.amp;
    setRot(c, Math.sin(w * 0.5 + 1) * d.roll, c.ry, Math.cos(w * 0.7) * d.roll);
  }
}

// Sphere overlap test. On hit fills o.nx/ny/nz (pointing from shape to sphere) and o.d (depth).
export function collideSphere(c, px, py, pz, r, o) {
  if (c.t === BOX) {
    const m = c.m, dx = px - c.x, dy = py - c.y, dz = pz - c.z;
    const lx = dx * m[0] + dy * m[1] + dz * m[2];
    const ly = dx * m[3] + dy * m[4] + dz * m[5];
    const lz = dx * m[6] + dy * m[7] + dz * m[8];
    const hx = c.hx, hy = c.hy, hz = c.hz;
    const ex = lx - clamp(lx, -hx, hx), ey = ly - clamp(ly, -hy, hy), ez = lz - clamp(lz, -hz, hz);
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > r * r) return false;
    let nx, ny, nz;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      nx = ex / d; ny = ey / d; nz = ez / d;
      o.d = r - d;
    } else {
      const qx = hx - Math.abs(lx), qy = hy - Math.abs(ly), qz = hz - Math.abs(lz);
      nx = ny = nz = 0;
      if (qy <= qx && qy <= qz) { ny = ly < 0 ? -1 : 1; o.d = qy + r; }
      else if (qx <= qz) { nx = lx < 0 ? -1 : 1; o.d = qx + r; }
      else { nz = lz < 0 ? -1 : 1; o.d = qz + r; }
    }
    o.nx = nx * m[0] + ny * m[3] + nz * m[6];
    o.ny = nx * m[1] + ny * m[4] + nz * m[7];
    o.nz = nx * m[2] + ny * m[5] + nz * m[8];
    return true;
  }
  const dx = px - c.x, dy = py - c.y, dz = pz - c.z, R = cylR(c, py), hh = c.hh;
  const rad = Math.sqrt(dx * dx + dz * dz);
  if (rad < R && Math.abs(dy) < hh) {
    const side = R - rad, top = hh - dy, bot = hh + dy;
    if (top <= side && top <= bot) { o.nx = 0; o.ny = 1; o.nz = 0; o.d = top + r; }
    else if (bot <= side) { o.nx = 0; o.ny = -1; o.nz = 0; o.d = bot + r; }
    else {
      const k = rad > 1e-6 ? 1 / rad : 0;
      o.nx = rad > 1e-6 ? dx * k : 1; o.ny = 0; o.nz = dz * k; o.d = side + r;
    }
    return true;
  }
  const ey = dy - clamp(dy, -hh, hh);
  let ex = 0, ez = 0;
  if (rad > R) { const s = 1 - R / rad; ex = dx * s; ez = dz * s; }
  const d2 = ex * ex + ey * ey + ez * ez;
  if (d2 > r * r || d2 < 1e-12) return false;
  const d = Math.sqrt(d2);
  o.nx = ex / d; o.ny = ey / d; o.nz = ez / d; o.d = r - d;
  return true;
}

// Local coordinates of a world point, using the collider's previous or current transform.
export function toLocal(c, px, py, pz, prev, out) {
  const m = prev ? c.pm : c.m, ox = prev ? c.px : c.x, oy = prev ? c.py : c.y, oz = prev ? c.pz : c.z;
  const dx = px - ox, dy = py - oy, dz = pz - oz;
  out.x = dx * m[0] + dy * m[1] + dz * m[2];
  out.y = dx * m[3] + dy * m[4] + dz * m[5];
  out.z = dx * m[6] + dy * m[7] + dz * m[8];
  return out;
}

export function toWorld(c, l, out) {
  const m = c.m;
  out.x = c.x + l.x * m[0] + l.y * m[3] + l.z * m[6];
  out.y = c.y + l.x * m[1] + l.y * m[4] + l.z * m[7];
  out.z = c.z + l.x * m[2] + l.y * m[5] + l.z * m[8];
  return out;
}

// Ray hits (distance along the unit ray, or -1). Boxes use a slab test in their own frame.
function rayBox(c, ox, oy, oz, dx, dy, dz) {
  const m = c.m, px = ox - c.x, py = oy - c.y, pz = oz - c.z;
  const lo = [px * m[0] + py * m[1] + pz * m[2], px * m[3] + py * m[4] + pz * m[5], px * m[6] + py * m[7] + pz * m[8]];
  const ld = [dx * m[0] + dy * m[1] + dz * m[2], dx * m[3] + dy * m[4] + dz * m[5], dx * m[6] + dy * m[7] + dz * m[8]];
  const h = [c.hx, c.hy, c.hz];
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) { if (Math.abs(lo[i]) > h[i]) return -1; continue; }
    let a = (-h[i] - lo[i]) / ld[i], b = (h[i] - lo[i]) / ld[i];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t1 < 0 ? -1 : Math.max(0, t0);
}

function rayCyl(c, ox, oy, oz, dx, dy, dz) {
  const px = ox - c.x, py = oy - c.y, pz = oz - c.z, R = cylR(c, oy), hh = c.hh;
  let best = -1;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - R * R, disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t >= 0 && Math.abs(py + dy * t) <= hh) { best = t; break; }
      }
      if (cc < 0 && Math.abs(py) <= hh) return 0;
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const yy of [hh, -hh]) {
      const t = (yy - py) / dy;
      if (t >= 0 && (best < 0 || t < best)) {
        const qx = px + dx * t, qz = pz + dz * t;
        if (qx * qx + qz * qz <= R * R) best = t;
      }
    }
  }
  return best;
}

export class World {
  constructor(cols) {
    this.cols = cols;
    this.cells = new Map();
    this.dyn = [];
    this.big = [];
    this.stamp = 0;
    for (const c of cols) {
      if (c.dyn || c.crumble) { this.dyn.push(c); continue; }
      if (c.maxy - c.miny > 60) { this.big.push(c); continue; }
      for (let k = Math.floor(c.miny / CELL); k <= Math.floor(c.maxy / CELL); k++) {
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(c);
      }
    }
  }

  setTime(t) {
    for (const c of this.dyn) {
      c.px = c.x; c.py = c.y; c.pz = c.z; c.pm.set(c.m);
      if (c.dyn) placeDyn(c, t);
    }
  }

  query(x, y, z, rad, fn) {
    const s = ++this.stamp;
    const x0 = x - rad, x1 = x + rad, y0 = y - rad, y1 = y + rad, z0 = z - rad, z1 = z + rad;
    const hit = (c) => c.on && c.maxx >= x0 && c.minx <= x1 && c.maxy >= y0 && c.miny <= y1 && c.maxz >= z0 && c.minz <= z1;
    for (let k = Math.floor(y0 / CELL); k <= Math.floor(y1 / CELL); k++) {
      const a = this.cells.get(k);
      if (!a) continue;
      for (const c of a) {
        if (c.stamp === s) continue;
        c.stamp = s;
        if (hit(c)) fn(c);
      }
    }
    for (const c of this.dyn) if (hit(c)) fn(c);
    for (const c of this.big) if (hit(c)) fn(c);
  }

  // Pushes a point out of all geometry (used for rope beads). Returns the moved point.
  pushOut(p, r, o) {
    this.query(p.x, p.y, p.z, r, (c) => {
      if (c.solidRope === false) return;
      if (collideSphere(c, p.x, p.y, p.z, r, o)) {
        p.x += o.nx * o.d; p.y += o.ny * o.d; p.z += o.nz * o.d;
      }
    });
    return p;
  }

  overlaps(x, y, z, r, o) {
    let any = false;
    this.query(x, y, z, r, (c) => {
      if (!any && c.solidCam !== false && collideSphere(c, x, y, z, r, o)) any = true;
    });
    return any;
  }

  // Height of the highest floor surface under (x, z) between y - depth and y (or -1e9): contact shadows.
  floorBelow(x, y, z, depth) {
    let best = -1e9;
    const s = ++this.stamp, y0 = y - depth;
    const test = (c) => {
      if (!c.on || c.maxx < x || c.minx > x || c.maxz < z || c.minz > z || c.miny > y || c.maxy < y0) return;
      let top;
      if (c.t === BOX) {
        const m = c.m, dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx * m[0] + dz * m[2]) > c.hx || Math.abs(dx * m[6] + dz * m[8]) > c.hz) return;
        top = c.y + c.hy * m[4];
      } else {
        if (Math.hypot(x - c.x, z - c.z) > c.r) return;
        top = c.y + c.hh;
      }
      if (top <= y + 0.1 && top > best) best = top;
    };
    for (let k = Math.floor(y0 / CELL); k <= Math.floor(y / CELL); k++) {
      const a = this.cells.get(k);
      if (!a) continue;
      for (const c of a) { if (c.stamp === s) continue; c.stamp = s; test(c); }
    }
    for (const c of this.dyn) test(c);
    for (const c of this.big) test(c);
    return best;
  }

  // Distance along a ray (unit direction d) to the first solid surface, or maxD if nothing is hit.
  raycast(ox, oy, oz, dx, dy, dz, maxD, skip) {
    let best = maxD;
    const s = ++this.stamp, ex = ox + dx * maxD, ey = oy + dy * maxD, ez = oz + dz * maxD;
    const x0 = Math.min(ox, ex), x1 = Math.max(ox, ex), y0 = Math.min(oy, ey), y1 = Math.max(oy, ey), z0 = Math.min(oz, ez), z1 = Math.max(oz, ez);
    const test = (c) => {
      if (!c.on || (skip && skip(c)) || c.maxx < x0 || c.minx > x1 || c.maxy < y0 || c.miny > y1 || c.maxz < z0 || c.minz > z1) return;
      const t = c.t === BOX ? rayBox(c, ox, oy, oz, dx, dy, dz) : rayCyl(c, ox, oy, oz, dx, dy, dz);
      if (t >= 0 && t < best) best = t;
    };
    for (let k = Math.floor(y0 / CELL); k <= Math.floor(y1 / CELL); k++) {
      const a = this.cells.get(k);
      if (!a) continue;
      for (const c of a) { if (c.stamp === s) continue; c.stamp = s; test(c); }
    }
    for (const c of this.dyn) test(c);
    for (const c of this.big) test(c);
    return best;
  }

  // Fraction (0..1) along a->b before a sphere of radius r first touches geometry.
  castSphere(ax, ay, az, bx, by, bz, r, o) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const n = Math.max(1, Math.ceil(len / (r * 0.9)));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      if (this.overlaps(ax + dx * f, ay + dy * f, az + dz * f, r, o)) return (i - 1) / n;
    }
    return 1;
  }
}
