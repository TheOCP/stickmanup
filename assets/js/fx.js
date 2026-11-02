// Small pooled effects: gun tracers, lightning warning rings and the grapple line. Built once, reused.
import * as THREE from 'three';
import { COLORS } from './colors.js';

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
    this.tracers[k].m.material.color.copy(HDR(hex, 3));
    this.markers[k].ring.material.color.copy(HDR(hex, 3.2));
    this.markers[k].fill.material.color.copy(HDR(hex, 1.4));
  }

  tracer(slot, a, b, hit) {
    const t = this.tracers[slot % 4];
    stretch(t.m, a[0], a[1], a[2], b[0], b[1], b[2], 0.035);
    t.m.visible = true;
    t.life = 0.16;
    const s = this.sparks[slot % 4];
    s.m.position.set(b[0], b[1], b[2]);
    s.m.material.color.copy(hit ? HDR(0xffe08a, 4) : HDR(0xffffff, 1.5));
    s.big = hit ? 2.2 : 1;
    s.m.visible = true;
    s.life = 0.3;
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
      t.m.material.opacity = Math.max(0, t.life / 0.16);
      if (t.life <= 0) t.m.visible = false;
    }
  }

  clear() {
    for (const t of this.tracers) t.m.visible = false;
    for (const s of this.sparks) s.m.visible = false;
    for (const m of this.markers) m.g.visible = false;
    for (const h of this.hooks) h.visible = false;
  }
}
