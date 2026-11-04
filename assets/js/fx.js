// Small pooled effects: gun tracers, lightning warning rings and the grapple line. Built once, reused.
import * as THREE from 'three';
import { COLORS } from './colors.js';
import { BEAMS } from './weapons.js';

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

function stretch(m, ax, ay, az, bx, by, bz, r) {
  dir.set(bx - ax, by - ay, bz - az);
  const len = dir.length() || 1e-3;
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  m.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
  m.scale.set(r, len, r);
}

export class Fx {
  constructor(scene) {
    const live = (m) => { m.userData.live = true; return m; };
    this.tracers = COLORS.map((c) => {
      const m = new THREE.Mesh(beamGeo, live(new THREE.MeshBasicMaterial({ color: HDR(c, 3), transparent: true, depthWrite: false, opacity: 0 })));
      m.visible = false;
      scene.add(m);
      return { m, life: 0 };
    });
    // Extra streaks: the pellets of a shotgun, the jagged pieces of a lightning shot.
    this.extras = COLORS.map(() => Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(beamGeo, live(new THREE.MeshBasicMaterial({ color: HDR(0xffffff, 3), transparent: true, depthWrite: false, opacity: 0.9 })));
      m.visible = false;
      scene.add(m);
      return { m, life: 0, max: 0.16 };
    }));
    // The ball of light where a blast lands.
    this.blasts = COLORS.map(() => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), live(new THREE.MeshBasicMaterial({ color: HDR(0xffa040, 2.6), transparent: true, depthWrite: false, opacity: 0.6 })));
      m.visible = false;
      scene.add(m);
      return { m, life: 0, r: 1 };
    });
    const ringGeo = new THREE.RingGeometry(1.95, 2.4, 48).rotateX(-Math.PI / 2), dotGeo = new THREE.CircleGeometry(2.4, 48).rotateX(-Math.PI / 2);
    // Lightning warning rings in each player's own colour, so everyone can tell whose strike is coming.
    this.markers = COLORS.map((c) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, live(new THREE.MeshBasicMaterial({ color: HDR(c, 3.2), transparent: true, depthWrite: false })));
      const fill = new THREE.Mesh(dotGeo, live(new THREE.MeshBasicMaterial({ color: HDR(c, 1.4), transparent: true, depthWrite: false, opacity: 0.2 })));
      g.add(ring, fill);
      g.visible = false;
      scene.add(g);
      return { g, ring, fill };
    });
    // Impact sparks where a shot lands (bright when it hit a target).
    this.sparks = COLORS.map(() => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), live(new THREE.MeshBasicMaterial({ color: HDR(0xffffff, 3), transparent: true, depthWrite: false, opacity: 0 })));
      m.visible = false;
      scene.add(m);
      return { m, life: 0 };
    });
    this.hooks = COLORS.map(() => {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: HDR(0xdffcff, 2.5) }));
      m.visible = false;
      scene.add(m);
      return m;
    });
  }

  // A player's chosen colour for their shots and their lightning warning ring.
  setColor(slot, hex) {
    const k = slot % 4;
    this.tracers[k].base = hex;
    this.tracers[k].m.material.color.copy(HDR(hex, 3));
    this.markers[k].ring.material.color.copy(HDR(hex, 3.2));
    this.markers[k].fill.material.color.copy(HDR(hex, 1.4));
  }

  // gun: the weapon it came from, if known: how many streaks, what colour, how thick.
  tracer(slot, a, b, hit, gun) {
    const k = slot % 4, t = this.tracers[k], beam = gun && BEAMS[gun.beam], n = gun ? gun.n : 1;
    const col = beam ? HDR(beam.c, beam.k) : HDR(t.base ?? COLORS[k], 3), r = beam ? beam.r : 0.035, life = beam ? beam.life : 0.16;
    t.m.material.color.copy(col);
    t.max = life;
    t.life = life;
    t.m.visible = true;
    const ex = this.extras[k];
    if (beam && gun.beam === 'bolt') {
      // Jagged: from point to point, with the last piece on the main streak.
      let px = a[0], py = a[1], pz = a[2];
      const pieces = ex.length;
      for (let i = 0; i < pieces; i++) {
        const f = (i + 1) / (pieces + 1), q = 0.08 + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 0.035;
        const x = a[0] + (b[0] - a[0]) * f + (Math.random() - 0.5) * q * 2, y = a[1] + (b[1] - a[1]) * f + (Math.random() - 0.5) * q * 2, z = a[2] + (b[2] - a[2]) * f + (Math.random() - 0.5) * q * 2;
        stretch(ex[i].m, px, py, pz, x, y, z, r);
        ex[i].m.material.color.copy(col);
        ex[i].m.visible = true;
        ex[i].life = ex[i].max = life;
        px = x; py = y; pz = z;
      }
      stretch(t.m, px, py, pz, b[0], b[1], b[2], r);
    } else {
      stretch(t.m, a[0], a[1], a[2], b[0], b[1], b[2], r);
      // Pellets spread out round the middle one.
      const spread = 0.02 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + 0.1;
      for (let i = 0; i < ex.length; i++) {
        if (i >= n - 1) continue;
        stretch(ex[i].m, a[0], a[1], a[2], b[0] + (Math.random() - 0.5) * spread * 2, b[1] + (Math.random() - 0.5) * spread * 2, b[2] + (Math.random() - 0.5) * spread * 2, r * 0.7);
        ex[i].m.material.color.copy(col);
        ex[i].m.visible = true;
        ex[i].life = ex[i].max = life * 0.8;
      }
    }
    const s = this.sparks[k];
    s.m.position.set(b[0], b[1], b[2]);
    s.m.material.color.copy(hit ? HDR(0xffe08a, 4) : beam ? col : HDR(0xffffff, 1.5));
    s.big = (hit ? 2.2 : 1) * (beam ? 1.3 : 1);
    s.m.visible = true;
    s.life = 0.3;
  }

  // A blast's ball of light, as wide as what it reaches.
  blast(slot, x, y, z, gun) {
    const B = this.blasts[slot % 4], beam = BEAMS[gun.beam];
    B.m.position.set(x, y, z);
    B.m.material.color.copy(HDR(beam ? beam.c : 0xffa040, 2.8));
    B.r = gun.blast;
    B.life = 0.34;
    B.m.scale.setScalar(0.2);
    B.m.visible = true;
  }

  // k: warning progress 0..1 (0 hides). The ring tightens as the strike gets closer.
  marker(slot, k, x, y, z) {
    const m = this.markers[slot % 4];
    m.g.visible = k > 0;
    if (!m.g.visible) return;
    m.g.position.set(x, y + 0.05, z);
    const s = 1.6 - k * 0.6;
    m.ring.scale.set(s, 1, s);
    m.ring.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(k * 30));
    m.fill.material.opacity = 0.1 + k * 0.35;
  }

  hook(slot, a, x, y, z) {
    const m = this.hooks[slot % 4];
    m.visible = !!a;
    if (a) stretch(m, x, y, z, a.x, a.y, a.z, 0.025);
  }

  update(dt) {
    for (const s of this.sparks) {
      if (!s.m.visible) continue;
      s.life -= dt;
      s.m.scale.setScalar(s.big * (1.3 - s.life * 2));
      s.m.material.opacity = Math.max(0, s.life / 0.3);
      if (s.life <= 0) s.m.visible = false;
    }
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / (t.max || 0.16));
      if (t.life <= 0) t.m.visible = false;
    }
    for (const list of this.extras) for (const t of list) {
      if (!t.m.visible) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.m.visible = false;
    }
    for (const B of this.blasts) {
      if (!B.m.visible) continue;
      B.life -= dt;
      const u = 1 - Math.max(0, B.life / 0.34);
      B.m.scale.setScalar(B.r * (0.25 + 0.75 * Math.sqrt(u)));
      B.m.material.opacity = 0.65 * (1 - u);
      if (B.life <= 0) B.m.visible = false;
    }
  }

  clear() {
    for (const t of this.tracers) t.m.visible = false;
    for (const s of this.sparks) s.m.visible = false;
    for (const list of this.extras) for (const t of list) t.m.visible = false;
    for (const B of this.blasts) B.m.visible = false;
    for (const m of this.markers) m.g.visible = false;
    for (const h of this.hooks) h.visible = false;
  }
}
