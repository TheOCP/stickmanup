// Graffiti: the pictures of sprays.js, sprayed by the climbers on what they stand on or on the wall they hold. Only for the eyes:
// nothing here touches the climb. Everyone in the room sees a spray at once (game.js passes it on), and the server keeps the
// latest few of every player on every map, so whoever climbs there later finds them too (cloud.js, server/lib/sprays.js).
import * as THREE from 'three';
import { SPRAY, paintSpray } from './sprays.js';
import { PR } from './player.js';

// How many are drawn at once (the oldest go first), how big one is at most, a short pause so one tap is one spray, and how far
// from you the spot you look at may be.
const MAX = 90, BIG = 1.6, WAIT = 0.35, REACH = 9;
const texs = new Map(), Z = new THREE.Vector3(0, 0, 1), n0 = new THREE.Vector3(), q = new THREE.Quaternion(), qr = new THREE.Quaternion();
const fin = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function texOf(id) {
  let t = texs.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(paintSpray(SPRAY[id], 256));
    t.colorSpace = THREE.SRGBColorSpace;
    texs.set(id, t);
  }
  return t;
}
// Not on anything that moves, breaks, fades or switches off (doors, and the maze walls, which change).
const steady = (c) => !!c && !c.dyn && !c.crumble && !c.blink && !c.ghost && !c.trap && c.kind !== 'mwall' && c.kind !== 'door';

export class Graffiti {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.keys = new Set();
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.last = -1e9;
  }

  // A spray from anyone: id, where (x, y, z), which way the surface faces (nx, ny, nz), how it is turned (r) and how big (w).
  // The same one twice (from the room and from the server) is drawn once.
  add(s) {
    if (!s || typeof s.id !== 'string' || !Object.hasOwn(SPRAY, s.id)) return false;
    if (![s.x, s.y, s.z].every((v) => fin(v, 5000)) || ![s.nx, s.ny, s.nz, s.r].every((v) => fin(v, 10))) return false;
    const l = Math.hypot(s.nx, s.ny, s.nz);
    if (l < 0.5) return false;
    const key = `${s.id}:${Math.round(s.x * 4)}:${Math.round(s.y * 4)}:${Math.round(s.z * 4)}`;
    if (this.keys.has(key)) return false;
    const w = clamp(+s.w || BIG, 0.5, BIG);
    // Straight on, a wall facing exactly away has no shortest turn: a nudge gives it one, so it is never upside down.
    n0.set(s.nx / l, s.ny / l, s.nz / l);
    if (n0.z < -0.999) n0.x += 0.002;
    n0.normalize();
    q.setFromUnitVectors(Z, n0);
    qr.setFromAxisAngle(Z, s.r);
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: texOf(s.id), transparent: true, depthWrite: false }));
    m.quaternion.copy(q).multiply(qr);
    m.position.set(s.x + n0.x * 0.035, s.y + n0.y * 0.035, s.z + n0.z * 0.035);
    m.scale.set(w, w, 1);
    m.renderOrder = 3;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    this.scene.add(m);
    this.list.push({ m, key });
    this.keys.add(key);
    while (this.list.length > MAX) this.drop(this.list.shift());
    return true;
  }
  drop(o) {
    this.scene.remove(o.m);
    o.m.material.dispose();
    this.keys.delete(o.key);
  }
  clear() {
    for (const o of this.list) this.drop(o);
    this.list = [];
  }

  // Where a spray of mine would go now: where I look (the middle of the screen), on the first wall, floor or anything else
  // solid within reach. Otherwise on the wall I hold, or on what I stand on. { at } or { why } it can't.
  aim(g, now) {
    const me = g.me, W = g.app.world;
    if (!me || !W) return { why: 'Not now' };
    if (now - this.last < WAIT) return { why: '' };
    const yaw = g.cam ? g.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const look = this.look(g, W);
    if (look) return look;
    // On a wall: find it straight behind the way it faces.
    if (!me.grounded && me.time - me.wallT < 0.3) {
      for (const s of [1, -1]) {
        const nx = me.wallNx * s, nz = me.wallNz * s, y = me.y + 0.55, d = W.raycast(me.x, y, me.z, -nx, 0, -nz, PR + 0.8);
        if (d >= PR + 0.8) continue;
        const x = me.x - nx * d, z = me.z - nz * d;
        let ok = true;
        W.query(x, y, z, 0.3, (c) => { if (!steady(c)) ok = false; });
        if (!ok) return { why: 'Not on something that moves' };
        return { at: { x, y, z, nx, ny: 0, nz, r: 0, w: 1.3 } };
      }
    }
    if (!me.grounded) return { why: 'Stand on something or hold a wall to spray' };
    const c = me.ground;
    if (!steady(c)) return { why: 'Not on something that moves' };
    if (c.rx || c.rz) return { why: 'It is too steep here' };
    const feet = me.y - PR, small = c.r !== undefined ? c.r : Math.min(c.hx, c.hz), w = clamp(small * 1.8, 0.7, BIG);
    // On a big floor a step ahead of you, on a small stone right where you stand.
    let x = me.x, z = me.z;
    if (small > 1.2) {
      const ax = me.x + fx * 0.8, az = me.z + fz * 0.8, top = W.floorBelow(ax, feet + 0.3, az, 0.6);
      if (Math.abs(top - feet) < 0.12) { x = ax; z = az; }
    }
    const top = W.floorBelow(x, feet + 0.3, z, 0.6);
    if (top < feet - 0.3) return { why: 'Stand on something or hold a wall to spray' };
    return { at: { x, y: top, z, nx: 0, ny: 1, nz: 0, r: yaw, w } };
  }

  // Along the camera's line of sight: the nearest surface past the climber, with the way it faces. World.raycast only gives a
  // distance, so its walk over the colliders is used to test each one here, with the face that was hit.
  look(g, W) {
    const cam = g.app.renderer && g.app.renderer.camera, me = g.me;
    if (!cam) return null;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements, ox = e[12], oy = e[13], oz = e[14];
    let dx = -e[8], dy = -e[9], dz = -e[10];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // Nothing between the camera and the climber counts.
    const near = Math.max(0, (me.x - ox) * dx + (me.y - oy) * dy + (me.z - oz) * dz - 0.6), far = near + REACH + 2;
    let best = null;
    W.raycast(ox, oy, oz, dx, dy, dz, far, (c) => {
      const h = hitFace(c, ox, oy, oz, dx, dy, dz);
      if (h && h.t >= near && h.t <= far && (!best || h.t < best.t)) { best = h; best.c = c; }
      return true;
    });
    if (!best) return null;
    const x = ox + dx * best.t, y = oy + dy * best.t, z = oz + dz * best.t;
    if (Math.hypot(x - me.x, y - me.y, z - me.z) > REACH) return null;
    if (!steady(best.c)) return { why: 'Not on something that moves' };
    const [nx, ny, nz] = best.n, flat = ny > 0.7;
    // On a floor the top of the picture points away from the camera; on a wall it stands upright.
    return { at: { x, y, z, nx, ny, nz, r: flat ? (g.cam ? g.cam.yaw : 0) : 0, w: clamp(best.w, 0.6, BIG) } };
  }
}

// Where a ray first enters a collider, the outward face there and how big a picture fits on it, or null.
function hitFace(c, ox, oy, oz, dx, dy, dz) {
  if (c.hx !== undefined) {
    const m = c.m, px = ox - c.x, py = oy - c.y, pz = oz - c.z;
    const lo = [px * m[0] + py * m[1] + pz * m[2], px * m[3] + py * m[4] + pz * m[5], px * m[6] + py * m[7] + pz * m[8]];
    const ld = [dx * m[0] + dy * m[1] + dz * m[2], dx * m[3] + dy * m[4] + dz * m[5], dx * m[6] + dy * m[7] + dz * m[8]];
    const h = [c.hx, c.hy, c.hz];
    let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (Math.abs(lo[i]) > h[i]) return null; continue; }
      let a = (-h[i] - lo[i]) / ld[i], b = (h[i] - lo[i]) / ld[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) { t0 = a; ax = i; sg = ld[i] > 0 ? -1 : 1; }
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
    // From inside it, or behind: no face to paint.
    if (ax < 0 || t0 < 0) return null;
    const n = [m[ax * 3] * sg, m[ax * 3 + 1] * sg, m[ax * 3 + 2] * sg], o = [0, 1, 2].filter((i) => i !== ax);
    return { t: t0, n, w: 1.8 * Math.min(h[o[0]], h[o[1]]) };
  }
  if (c.r === undefined) return null;
  // A standing cylinder: its side or its top.
  const px = ox - c.x, py = oy - c.y, pz = oz - c.z, R = c.r1 ? Math.max(c.r, c.r1) : c.r, hh = c.hh;
  let best = null;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - R * R, disc = b * b - 4 * a * cc;
    if (cc < 0) return null;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && Math.abs(py + dy * t) <= hh) {
        const hx = px + dx * t, hz = pz + dz * t, k = Math.hypot(hx, hz) || 1;
        best = { t, n: [hx / k, 0, hz / k], w: Math.min(1.3, hh * 1.6) };
      }
    }
  }
  if (dy < -1e-9 && py > hh) {
    const t = (hh - py) / dy, hx = px + dx * t, hz = pz + dz * t;
    if (t >= 0 && hx * hx + hz * hz <= c.r * c.r && (!best || t < best.t)) best = { t, n: [0, 1, 0], w: c.r * 1.8 };
  }
  return best;
}
