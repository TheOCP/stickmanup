// Graffiti: the pictures of sprays.js, sprayed by the climbers on what they stand on or on the wall they hold. Only for the eyes:
// nothing here touches the climb. Everyone in the room sees a spray at once (game.js passes it on), and the server keeps the
// latest few of every player on every map, so whoever climbs there later finds them too (cloud.js, server/lib/sprays.js).
import * as THREE from 'three';
import { SPRAY, paintSpray } from './sprays.js';
import { PR } from './player.js';

// How many are drawn at once (the oldest go first), how big one is at most, and how long between two of your own.
const MAX = 90, BIG = 1.6, WAIT = 2.5;
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

  // Where a spray of mine would go now: on the wall I hold or slide down, or on what I stand on, the top of the picture
  // away from the camera. { at } or { why } it can't.
  aim(g, now) {
    const me = g.me, W = g.app.world;
    if (!me || !W) return { why: 'Not now' };
    if (now - this.last < WAIT) return { why: 'The can needs a moment' };
    const yaw = g.cam ? g.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
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
}
