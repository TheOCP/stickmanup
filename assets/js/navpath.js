// The way up, for the arrow under the clock (main.js). level.js lists the route in the order it was laid, with the hooks,
// the door frames and the tops of lifts (in the air) in it too. Here it becomes a path of places to stand, each tied to
// the platform it is on, so the arrow knows where on the climb you are from whatever you stand on: after a fall, back at
// a checkpoint, off on a hidden path or riding a lift, it points the way on from there. In a maze garden it points at
// the way out (it does not solve the maze), and on the landing in front of one, at the way in.
import { MAZE_CELL, MAZE_RIM, MAZE_WALL_H, mazeCell } from './level.js';
import { PR } from './player.js';

const BOX = 0;
// Is (x, y, z) on top of collider c: inside its outline (give or take pad) and close to its top?
function onTop(c, x, y, z, pad, dy) {
  if (c.t !== BOX) return Math.hypot(x - c.x, z - c.z) < (c.r || 0) + pad && Math.abs(y - (c.y + c.hh)) < dy;
  const ex = x - c.x, ey = y - c.y, ez = z - c.z, m = c.m;
  const lx = ex * m[0] + ey * m[1] + ez * m[2], ly = ex * m[3] + ey * m[4] + ez * m[5], lz = ex * m[6] + ey * m[7] + ez * m[8];
  return Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad && Math.abs(ly - c.hy) < dy;
}
const dist = (p, x, y, z) => Math.hypot(p.x - x, p.y - y, p.z - z);

export class NavPath {
  constructor(L) {
    // Everything that could be stood on, by the height of its top.
    const byTop = new Map();
    for (const c of L.cols) {
      if (c.kind === 'mwall' || c.kind === 'mouter') continue;
      const k = Math.floor(c.maxy || c.y + (c.hy ?? c.hh ?? 0));
      (byTop.get(k) || byTop.set(k, []).get(k)).push(c);
    }
    const moving = L.cols.filter((c) => c.dyn || c.blink || c.kind === 'bob' || c.kind === 'mover' || c.kind === 'swing');
    this.pts = [];
    this.byCol = new Map();
    for (const [x, y, z] of L.route || []) {
      const on = [];
      for (let k = Math.floor(y) - 2; k <= Math.floor(y) + 1; k++) for (const c of byTop.get(k) || []) if (onTop(c, x, y, z, 0.25, 0.7)) on.push(c);
      // Something that moves is somewhere else now than where it was laid: the closest one will do.
      if (!on.length) {
        let best = 3, m = null;
        for (const c of moving) {
          const p = c.dyn;
          // A lift or a platform that goes to and fro: only somewhere along its way (a grapple hook in the air beside a
          // lift is not on it).
          if (p && p.k === 'pp') {
            const sx = p.bx - p.ax, sy = p.by - p.ay, sz = p.bz - p.az, l2 = sx * sx + sy * sy + sz * sz || 1, hy = c.hy ?? c.hh ?? 0;
            const t = Math.max(0, Math.min(1, ((x - p.ax) * sx + (y - hy - p.ay) * sy + (z - p.az) * sz) / l2));
            const d = Math.hypot(p.ax + sx * t - x, p.az + sz * t - z);
            if (d < Math.min(best, Math.max(c.hx || 0, c.hz || 0, c.r || 0) + 0.5) && Math.abs(p.ay + sy * t + hy - y) < 1) { best = d; m = c; }
            continue;
          }
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < best && Math.abs(c.y - y) < 2.5) { best = d; m = c; }
        }
        if (m) on.push(m);
      }
      // Nothing to stand on (a hook, the top of a lift), or only the top of a wall a door is in: left out, so the arrow
      // never points into the air or up at a door frame.
      if (!on.length || on.every((c) => c.kind === 'wall')) continue;
      const i = this.pts.length;
      this.pts.push({ x, y, z, c: on[0] });
      for (const c of on) (this.byCol.get(c) || this.byCol.set(c, []).get(c)).push(i);
    }
    // The maze gardens: the gap in the wall on the way in, on the way out, and the first place on the path after it.
    this.mazes = (L.mazes || []).map((m) => {
      const out = (i, j, s) => { const [x, z] = mazeCell(m, i, j); return { x: x + m.fx * s, y: m.y, z: z + m.fz * s }; };
      const porchIn = out(m.ei, m.ej, -(MAZE_CELL / 2 + MAZE_RIM / 2)), porchOut = out(m.xi, m.xj, MAZE_CELL / 2 + MAZE_RIM / 2);
      const land = { x: porchOut.x + m.fx * 3.4, y: m.y, z: porchOut.z + m.fz * 3.4 };
      let exit = -1, best = 6;
      this.pts.forEach((p, i) => { const d = dist(p, land.x, land.y, land.z); if (d < best && Math.abs(p.y - m.y) < 1.5) { best = d; exit = i; } });
      return { m, porchIn, porchOut, exit, landIn: m.landIn };
    });
    this.k = -1;
    this.last = null;
    this.maze = null;
    this.ground = null;
  }

  // The closest place on the path you could be at: below you is likelier than above, and near where you were before.
  nearest(x, feet, z) {
    let best = 1e9, bi = -1;
    const P = this.pts, k = this.k;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], dy = p.y - feet;
      const s = Math.hypot(p.x - x, p.z - z) + (dy > 0.5 ? dy * 3 : Math.abs(dy) * 1.5) + (k >= 0 ? Math.min(4, Math.abs(i - k) * 0.01) : 0);
      if (s < best) { best = s; bi = i; }
    }
    return bi;
  }

  // Which of the places on the platform you stand on: the closest, and if it has more than one there (a hub the route
  // comes back to), the one nearest where you were on the path. With no idea yet, the one furthest along.
  pick(list, x, y, z) {
    const P = this.pts;
    let near = 1e9;
    for (const i of list) near = Math.min(near, dist(P[i], x, y, z));
    let bi = -1;
    for (const i of list) {
      if (dist(P[i], x, y, z) > near + 1) continue;
      if (bi < 0) bi = i;
      else if (this.k >= 0 ? Math.abs(i - this.k) < Math.abs(bi - this.k) : i > bi) bi = i;
    }
    return bi;
  }

  inMaze(x, feet, z) {
    for (const q of this.mazes) {
      const m = q.m, ex = x - m.x, ez = z - m.z, u = ex * m.fx + ez * m.fz, w = ex * m.nx + ez * m.nz;
      if (Math.abs(u) < m.half + 0.2 && Math.abs(w) < m.half + 0.2 && feet > m.y - 1 && feet < m.y + MAZE_WALL_H + 0.5) return q;
    }
    return null;
  }

  // Call every frame with the climber (a player.js Body).
  update(me) {
    if (!this.pts.length) return;
    const feet = me.y - PR;
    // A jump of more than a few metres in one frame: back at a checkpoint, or moved by the game. Start over.
    if (this.last && Math.hypot(me.x - this.last[0], me.y - this.last[1], me.z - this.last[2]) > 8) { this.k = -1; this.ground = null; }
    this.last = [me.x, me.y, me.z];
    this.maze = this.inMaze(me.x, feet, me.z);
    if (this.maze) {
      if (this.maze.exit >= 0) this.k = this.maze.exit - 1;
      return;
    }
    const g = me.grounded ? me.ground : null;
    if (g) {
      const list = this.byCol.get(g);
      if (list) { this.k = this.pick(list, me.x, feet, me.z); this.ground = g; return; }
      // Riding a lift: the next place is still the top.
      if (g.kind === 'lift' && this.k >= 0) return;
      // On something off the path (a crate, the dock, a hidden path): worked out again only when that changes.
      if (g !== this.ground || this.k < 0) { this.k = this.nearest(me.x, feet, me.z); this.ground = g; }
      return;
    }
    // In the air, on a wall or hanging on the cord: where you last stood still counts, unless nothing is known yet.
    if (this.k < 0) this.k = this.nearest(me.x, feet, me.z);
  }

  // Where the arrow points: a place to stand, {x, y, z}, or null.
  target(me) {
    const P = this.pts, feet = me.y - PR;
    if (this.maze) {
      const q = this.maze, o = q.porchOut;
      return Math.hypot(o.x - me.x, o.z - me.z) > 1.5 || q.exit < 0 ? o : P[q.exit];
    }
    const k = this.k;
    if (k < 0 || !P.length) return null;
    // On the landing in front of a maze garden: the way in.
    const here = P[k].c;
    for (const q of this.mazes) if (q.landIn && q.landIn === here) return q.porchIn;
    // A little way on, past whatever is right under your feet.
    let t = k + 1;
    while (t < P.length - 1 && t < k + 6 && dist(P[t], me.x, feet, me.z) < 2.5) t++;
    return P[Math.min(t, P.length - 1)];
  }
}
