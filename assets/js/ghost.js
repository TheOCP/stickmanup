// Ghost racing: your best climb of a map and difficulty, played back beside you as a see-through climber, and the best climbs
// of your friends and of the others in the room if you want them (main.js gets them from the server, server/lib/ghosts.js).
// Each player picks which ghosts they see (the pause menu); the host can switch them off for everyone (rules.ng). Only for the
// eyes: nothing here touches the climb.
//
// A climb is kept as four places a second, each five whole numbers: x and z to 2 cm, y to 3 cm, which way it faced, and the
// climber's flags (player.js F) so it is drawn running, hanging or in the air like the real one.
import * as THREE from 'three';
import { Stickman } from './stickman.js';
import { F, PR } from './player.js';

export const HZ = 4;
const MAX_T = 40 * 60, N = 5, MAX_GHOSTS = 4;
const q16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));

export function encode(a) {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decode(s) {
  try {
    const bin = atob(s), b = new Uint8Array(bin.length & ~1);
    for (let i = 0; i < b.length; i++) b[i] = bin.charCodeAt(i);
    return new Int16Array(b.buffer, 0, b.length / 2 - ((b.length / 2) % N));
  } catch (e) {
    return null;
  }
}
// Which climb is the better one: a win beats no win, a quicker win a slower one, and otherwise the higher one.
export const better = (a, b) => !!a && (!b || (a.won && !b.won) || (!!a.won === !!b.won && (a.won ? a.t < b.t - 0.05 : a.h > b.h + 0.5)));

// Records a climb as it happens, from its very first moment (a climb picked up again from a save has no start to race).
export class GhostRec {
  constructor() {
    this.a = new Int16Array(MAX_T * HZ * N);
    this.n = 0;
    this.next = 0;
    this.h = 0;
    this.dead = false;
  }
  step(t, me, yaw) {
    if (this.dead) return;
    if (this.n === 0 && t > 1) { this.dead = true; return; }
    while (t >= this.next) {
      if (this.n * N >= this.a.length) { this.dead = true; return; }
      const o = this.n * N;
      this.a[o] = q16(me.x * 50); this.a[o + 1] = q16(me.y * 32); this.a[o + 2] = q16(me.z * 50); this.a[o + 3] = q16(yaw * 5000); this.a[o + 4] = me.flags & 0x7fff;
      this.n++;
      this.next = this.n / HZ;
    }
    if (me.y > this.h) this.h = me.y;
  }
  // The finished climb, or null when there is nothing worth keeping.
  result(won, t) {
    if (this.dead || this.n < HZ * 5) return null;
    return { won: !!won, t: Math.round(t * 10) / 10, h: Math.round(this.h * 10) / 10, data: encode(this.a.subarray(0, this.n * N)) };
  }
}

// The ghosts of one climb.
export class Ghosts {
  constructor(scene) {
    this.scene = scene;
    this.rigs = [];
    this.list = [];
  }
  // list: [{ key, name, a (decode), won, t, h }]. Only the first few.
  set(list) {
    this.clear();
    this.list = list.filter((x) => x.a && x.a.length >= N * 2).slice(0, MAX_GHOSTS);
    this.list.forEach((x, i) => {
      let r = this.rigs[i];
      if (!r) {
        r = this.rigs[i] = new Stickman(this.scene, i);
        ghostly(r);
      }
      r.setColor(GHOST_COLORS[i]);
      x.rig = r;
      x.at = null;
    });
  }
  clear() {
    for (const r of this.rigs) r.hide();
    this.list = [];
  }
  // Where each ghost is at climb time t, drawn. world: for the floor under them. show(key): is that one wanted.
  update(dt, t, world, show) {
    for (const x of this.list) {
      const a = x.a, n = a.length / N, f = Math.max(0, t * HZ), i = Math.min(n - 2, Math.floor(f)), k = Math.min(1, f - i);
      if (!show(x.key)) { x.rig.hide(); x.at = null; continue; }
      const o = i * N, p = o + N;
      const X = (a[o] + (a[p] - a[o]) * k) / 50, Y = (a[o + 1] + (a[p + 1] - a[o + 1]) * k) / 32, Z = (a[o + 2] + (a[p + 2] - a[o + 2]) * k) / 50;
      // Past the end of its climb: at the top if it won, otherwise gone.
      const over = f > n - 1;
      if (over && !x.won) { x.rig.hide(); x.at = null; continue; }
      const vx = over ? 0 : ((a[p] - a[o]) / 50) * HZ, vy = over ? 0 : ((a[p + 1] - a[o + 1]) / 32) * HZ, vz = over ? 0 : ((a[p + 2] - a[o + 2]) / 50) * HZ;
      let yaw0 = a[o + 3] / 5000, yaw1 = a[p + 3] / 5000;
      if (yaw1 - yaw0 > Math.PI) yaw1 -= Math.PI * 2; else if (yaw0 - yaw1 > Math.PI) yaw1 += Math.PI * 2;
      const yaw = yaw0 + (yaw1 - yaw0) * k, flags = a[(k < 0.5 ? o : p) + 4];
      const gy = world ? world.floorBelow(X, Y, Z, 30) : Y - PR;
      x.rig.show();
      x.rig.update(dt, X, Y, Z, vx, vy, vz, flags & ~(F.AIM | F.SHIELD), 0, gy, yaw);
      x.at = { x: X, y: Y, z: Z };
    }
  }
}
const GHOST_COLORS = [0x8fe8ff, 0xffd27a, 0xc8a0ff, 0x9affc0];

// See-through and glowing, never casting a shadow, never in front of what it is behind.
function ghostly(r) {
  const done = new Set();
  const fix = (o) => {
    o.castShadow = false;
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (done.has(m)) continue;
      done.add(m);
      m.transparent = true;
      m.opacity = 0.4;
      m.depthWrite = false;
    }
  };
  r.g.traverse(fix);
  // No shadow on the ground: the one it has is taken out of the picture, and a stand in that is never drawn takes its place.
  r.scene.remove(r.blob);
  r.blob = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
}
