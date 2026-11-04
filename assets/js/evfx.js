// What the maps' events look like (storm.js has what they do): the wave running round the waterfall, the marks of the
// city's lasers and the pirate ship's cannonballs, the balls in the air, the beams and blasts where they land, and the bee
// swarms. Pooled meshes, built once, shared by the climb and the watch screen.
import * as THREE from 'three';
import { WAVE_BAND, WAVE_H, LASER_R, CANNON_R, QUAKE_AT } from './storm.js';

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const live = (m) => { m.userData.live = true; return m; };
const basic = (hex, k, o = 1) => live(new THREE.MeshBasicMaterial({ color: HDR(hex, k), transparent: true, depthWrite: false, opacity: o }));
const COL = { laser: 0xff2a48, cannon: 0xffa030 };
const BEES = 16;

// A piece of a ring standing on the ground: from radius r0 to r1 and angle a0 to a1 (atan2(z, x), the way the wave runs),
// from height lo up to h(share of the way from a0 to a1) on top. Top, the two ends and both curved sides. In units of the climber's
// distance from the middle: the group is scaled by it.
function sector(r0, r1, a0, a1, h, na = 18, nr = 6, lo = 0) {
  const pos = [], idx = [];
  const at = (r, a, y) => { pos.push(r * Math.cos(a), y, r * Math.sin(a)); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  const A = (i) => a0 + ((a1 - a0) * i) / na, Rr = (j) => r0 + ((r1 - r0) * j) / nr;
  const top = [];
  for (let i = 0; i <= na; i++) { top.push([]); for (let j = 0; j <= nr; j++) top[i].push(at(Rr(j), A(i), h(i / na))); }
  for (let i = 0; i < na; i++) for (let j = 0; j < nr; j++) quad(top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]);
  // The curved sides, inside and out.
  for (const j of [0, nr]) for (let i = 0; i < na; i++) {
    const r = Rr(j), b0 = at(r, A(i), lo), b1 = at(r, A(i + 1), lo);
    quad(b0, b1, top[i + 1][j], top[i][j]);
  }
  // The two ends.
  for (const i of [0, na]) for (let j = 0; j < nr; j++) {
    const a = A(i), b0 = at(Rr(j), a, lo), b1 = at(Rr(j + 1), a, lo);
    quad(b0, b1, top[i][j + 1], top[i][j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class EventFx {
  constructor(scene) {
    this.scene = scene;
    // The wave: a wall of water as wide as the band that washes climbers along (storm.js inWave), tall at its front and
    // running out behind it, a white crest of foam along the top of the front. Built with the front at angle 0 and the
    // water behind it (toward negative angles), for a wave running the positive way round; mirrored for the other way.
    const B = WAVE_BAND, crest = WAVE_H + 0.25;
    const body = sector(0.45, 1.55, -B, 0, (k) => 0.3 + (crest - 0.3) * Math.pow(k, 2.2) * (1 - 0.25 * Math.max(0, k - 0.9) / 0.1));
    const foam = sector(0.44, 1.56, -0.07, 0.01, (k) => crest + 0.04 + 0.12 * Math.sin(k * Math.PI), 6, 10, crest - 0.1);
    this.wave = new THREE.Group();
    this.waveWater = new THREE.Mesh(body, basic(0x1e8ae6, 1.05, 0.74));
    this.waveFoam = new THREE.Mesh(foam, basic(0xffffff, 1.5, 0.92));
    this.waveWater.material.side = this.waveFoam.material.side = THREE.DoubleSide;
    this.wave.add(this.waveWater, this.waveFoam);
    this.wave.visible = false;
    scene.add(this.wave);
    // Marks on the ground: a ring that tightens and a fill that darkens until the shot lands.
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), dotGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.marks = Array.from({ length: 16 }, () => {
      const g = new THREE.Group(), ring = new THREE.Mesh(ringGeo, basic(0xffffff, 3)), fill = new THREE.Mesh(dotGeo, basic(0xffffff, 1.4, 0.2));
      g.add(ring, fill);
      g.visible = false;
      scene.add(g);
      return { g, ring, fill, used: false };
    });
    // Cannonballs on their way in from the sea, and the blasts where they land.
    const ball = new THREE.SphereGeometry(0.34, 14, 10), boom = new THREE.IcosahedronGeometry(1, 2);
    this.balls = Array.from({ length: 8 }, () => { const m = new THREE.Mesh(ball, new THREE.MeshStandardMaterial({ color: 0x23242a, roughness: 0.4, metalness: 0.6 })); m.visible = false; scene.add(m); return { m, used: false }; });
    this.booms = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(boom, basic(0xff9a30, 2.6, 0.7)); m.visible = false; scene.add(m); return { m, life: 0, r: 1 }; });
    // Laser beams straight down from the sky.
    const beam = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.beams = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(beam, basic(COL.laser, 4, 0.9)); m.visible = false; scene.add(m); return { m, life: 0 }; });
    // The quake's shock: a ring of dust running out across the ground from the viewer at each shock.
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), basic(0xffa860, 1.6, 0.7));
    this.shock.material.side = THREE.DoubleSide;
    this.shock.visible = false;
    this.shockLife = 0;
    this.shockKey = -1;
    scene.add(this.shock);
    // Bee swarms: a cloud of little bees buzzing round where the swarm is.
    const bee = new THREE.SphereGeometry(0.055, 6, 4).scale(1, 0.8, 1.5), beeMat = live(new THREE.MeshStandardMaterial({ color: 0xffc81a, emissive: 0x6a4a00, roughness: 0.5 }));
    this.swarms = Array.from({ length: 4 }, () => {
      const g = new THREE.Group();
      for (let j = 0; j < BEES; j++) g.add(new THREE.Mesh(bee, beeMat));
      g.visible = false;
      scene.add(g);
      return g;
    });
  }

  // T: the time; S: the storm (storm.js); ev: the event where the viewer is (null inside a maze garden); y: the viewer's
  // feet; viewX, viewZ: where the viewer is; markMaps: the marks of the lasers or cannonballs aimed at
  // each climber in sight; swarms: their bee swarms. Returns what landed in this frame, once each: [{ kind, x, y, z }].
  frame(T, dt, S, ev, y, viewX, viewZ, markMaps, swarms) {
    const viewR = Math.hypot(viewX, viewZ);
    const landed = [];
    // The wave, at the viewer's height.
    const wave = !!ev && ev.kind === 'wave' && ev.on;
    this.wave.visible = wave;
    if (wave) {
      // Mirrored (z) for a wave running the other way round, then turned so its front is where storm.js has it: a turn by
      // -f about y takes angle 0 to f. Scaled out to the viewer's distance from the middle.
      const r = Math.max(5, viewR || 10);
      this.wave.position.set(0, y - 0.04, 0);
      this.wave.rotation.set(0, -S.waveFront(ev), 0);
      this.wave.scale.set(r, 1 + 0.06 * Math.sin(T * 7), ev.sign > 0 ? r : -r);
      this.waveWater.material.opacity = 0.66 + 0.08 * Math.sin(T * 9);
    }
    // The quake: a new ring at each shock, where the viewer stands.
    if (ev && ev.kind === 'quake' && ev.on) {
      for (let i = 0; i < QUAKE_AT.length; i++) {
        if (ev.u < QUAKE_AT[i] || ev.u > QUAKE_AT[i] + 0.3 || this.shockKey === ev.k * 10 + i) continue;
        this.shockKey = ev.k * 10 + i;
        this.shockLife = 0.55;
        this.shock.position.set(viewX, y + 0.08, viewZ);
        this.shock.visible = true;
      }
    }
    if (this.shock.visible) {
      this.shockLife -= dt;
      const u = 1 - Math.max(0, this.shockLife / 0.55);
      this.shock.scale.setScalar(1 + 10 * u);
      this.shock.material.opacity = 0.75 * (1 - u);
      if (this.shockLife <= 0) this.shock.visible = false;
    }
    // Marks, balls in the air, and what lands.
    for (const M of this.marks) M.used = false;
    for (const B of this.balls) B.used = false;
    for (const marks of markMaps) {
      if (!marks) continue;
      for (const m of marks.values()) {
        if (T >= m.at) {
          if (!m.shown) { m.shown = true; landed.push(m); this.land(m); }
          continue;
        }
        if (T < m.mark) continue;
        const k = (T - m.mark) / (m.at - m.mark), M = this.marks.find((q) => !q.used);
        if (M) {
          M.used = true;
          M.g.visible = true;
          M.g.position.set(m.x, m.y + 0.06, m.z);
          const R = (m.kind === 'laser' ? LASER_R : CANNON_R) * (1.5 - k * 0.5);
          M.ring.scale.set(R, 1, R);
          M.fill.scale.set(R, 1, R);
          M.ring.material.color.copy(HDR(COL[m.kind], 3.2));
          M.fill.material.color.copy(HDR(COL[m.kind], 1.4));
          M.ring.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(k * 26));
          M.fill.material.opacity = 0.08 + k * 0.32;
        }
        if (m.kind === 'cannon') {
          const B = this.balls.find((q) => !q.used);
          if (B) {
            // In from the sea, beyond the climber, in a high arc.
            B.used = true;
            const r = Math.hypot(m.x, m.z) || 1, sx = m.x + (m.x / r) * 46, sz = m.z + (m.z / r) * 46, sy = m.y - 6;
            B.m.visible = true;
            B.m.position.set(sx + (m.x - sx) * k, sy + (m.y + 0.3 - sy) * k + 22 * 4 * k * (1 - k), sz + (m.z - sz) * k);
          }
        }
      }
    }
    for (const M of this.marks) if (!M.used) M.g.visible = false;
    for (const B of this.balls) if (!B.used) B.m.visible = false;
    for (const b of this.beams) {
      if (!b.m.visible) continue;
      b.life -= dt;
      b.m.material.opacity = Math.max(0, b.life / 0.35) * 0.9;
      b.m.scale.x = b.m.scale.z = 0.12 + 0.3 * Math.max(0, b.life / 0.35);
      if (b.life <= 0) b.m.visible = false;
    }
    for (const b of this.booms) {
      if (!b.m.visible) continue;
      b.life -= dt;
      const u = 1 - Math.max(0, b.life / 0.45);
      b.m.scale.setScalar(b.r * (0.3 + 0.7 * Math.sqrt(u)));
      b.m.material.opacity = 0.7 * (1 - u);
      if (b.life <= 0) b.m.visible = false;
    }
    // Swarms.
    let i = 0;
    for (const B of swarms) {
      if (!B || B.gone || i >= this.swarms.length) continue;
      const g = this.swarms[i++];
      g.visible = true;
      g.position.set(B.x, B.y, B.z);
      g.children.forEach((c, j) => {
        c.position.set(Math.sin(T * 7.3 + j * 1.3) * 0.42, Math.cos(T * 9.1 + j * 2.1) * 0.28, Math.sin(T * 8.2 + j * 0.7) * 0.42);
        c.rotation.y = T * 11 + j;
      });
    }
    for (; i < this.swarms.length; i++) this.swarms[i].visible = false;
    return landed;
  }

  land(m) {
    if (m.kind === 'laser') {
      const b = this.beams.find((q) => !q.m.visible) || this.beams[0];
      b.m.position.set(m.x, m.y + 30, m.z);
      b.m.scale.set(0.42, 60, 0.42);
      b.m.visible = true;
      b.life = 0.35;
    }
    const o = this.booms.find((q) => !q.m.visible) || this.booms[0];
    o.m.position.set(m.x, m.y + 0.4, m.z);
    o.m.material.color.copy(HDR(m.kind === 'laser' ? COL.laser : COL.cannon, 2.6));
    o.r = m.kind === 'laser' ? LASER_R : CANNON_R * 1.3;
    o.life = 0.45;
    o.m.scale.setScalar(0.3);
    o.m.visible = true;
  }

  clear() {
    this.wave.visible = false;
    for (const M of this.marks) M.g.visible = false;
    for (const B of this.balls) B.m.visible = false;
    for (const b of this.beams) b.m.visible = false;
    for (const b of this.booms) b.m.visible = false;
    for (const g of this.swarms) g.visible = false;
    this.shock.visible = false;
  }
}
