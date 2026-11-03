// The glowing cord between climbers, and the pool of climbers and cords.
import * as THREE from 'three';
import { COLORS } from './colors.js';
import { Stickman } from './stickman.js';
import { panelMat } from './worldview.js';
export { COLORS, COLOR_CSS } from './colors.js';

const S = 48, RS = 6, RAD = 0.05;

// The coins near the camera: a handful of instances moved to whichever are closest, spinning.
const COIN_N = 36, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export class CoinPool {
  constructor(scene) {
    // A bright rim round a darker raised face, so it reads as a coin and not a yellow dot.
    const parts = [[new THREE.TorusGeometry(0.17, 0.038, 6, 18), [1.0, 0.68, 0.14]], [new THREE.CylinderGeometry(0.15, 0.15, 0.05, 18).rotateX(Math.PI / 2), [0.5, 0.31, 0.03]], [new THREE.BoxGeometry(0.045, 0.17, 0.066), [1.0, 0.68, 0.14]]];
    const pos = [], nor = [], glo = [], uvs = [];
    for (const [g0, c] of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0, a = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); glo.push(c[0], c[1], c[2]); uvs.push(0, 0); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();
    const mat = panelMat(0xffc830, { roughness: 0.42, metalness: 0.25, pattern: 0, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, COIN_N);
    this.mesh.frustumCulled = false;
    this.mesh.userData.fastIM = true;
    this.mesh.castShadow = false;
    this.near = [];
    this.acc = 9;
    this.clear();
    scene.add(this.mesh);
  }

  clear() {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < COIN_N; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.near.length = 0;
    this.acc = 9;
    this.mesh.visible = false;
  }

  // list: the map's coins; taken: a Set of the ones gone; cx, cy, cz: the camera.
  update(dt, t, list, taken, cx, cy, cz, buckets) {
    this.acc += dt;
    if (this.acc > 0.2) {
      this.acc = 0;
      const near = this.near;
      near.length = 0;
      const b0 = Math.floor((cy - 34) / 8), b1 = Math.floor((cy + 34) / 8);
      for (let b = b0; b <= b1; b++) {
        const B = buckets[b];
        if (!B) continue;
        for (const c of B) {
          if (taken.has(c.i)) continue;
          const d = (c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2;
          if (d < 1600) near.push([d, c]);
        }
      }
      near.sort((a, b) => a[0] - b[0]);
      near.length = Math.min(near.length, COIN_N);
      this.dirty = true;
    }
    this.mesh.visible = this.near.length > 0;
    if (!this.mesh.visible) return;
    for (let i = 0; i < COIN_N; i++) {
      const e = this.near[i];
      if (e && !taken.has(e[1].i)) {
        const c = e[1];
        _q.setFromAxisAngle(_up, t * 3.2 + c.ph);
        _p.set(c.x, c.y + Math.sin(t * 2 + c.ph) * 0.06, c.z);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
      } else _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// The relic you find in a hidden place: a slowly turning gem with a ring round it.
export class RelicMark {
  constructor(scene) {
    this.g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), new THREE.MeshStandardMaterial({ color: 0xffa030, emissive: 0xff8a10, emissiveIntensity: 2.6, roughness: 0.2, metalness: 0.4 }));
    gem.scale.y = 1.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.028, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc060).multiplyScalar(3) }));
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.018, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a30).multiplyScalar(2.4) }));
    this.gem = gem; this.ring = ring; this.ring2 = ring2;
    this.g.add(gem, ring, ring2);
    this.g.visible = false;
    scene.add(this.g);
  }

  show(r, t) {
    this.g.visible = !!r;
    if (!r) return;
    this.g.position.set(r.x, r.y + Math.sin(t * 1.6) * 0.1, r.z);
    this.gem.rotation.y = t * 1.2;
    this.ring.rotation.set(t * 1.1, t * 0.7, 0);
    this.ring2.rotation.set(-t * 0.8, 0, t * 0.9);
  }
}

export class RopeMesh {
  constructor(scene, colA, colB) {
    const pos = new Float32Array(S * RS * 3), at = new Float32Array(S * RS), idx = [];
    for (let s = 0; s < S; s++) for (let r = 0; r < RS; r++) at[s * RS + r] = s / (S - 1);
    for (let s = 0; s < S - 1; s++) {
      for (let r = 0; r < RS; r++) {
        const a = s * RS + r, b = s * RS + ((r + 1) % RS), c = a + RS, d = b + RS;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    g.setIndex(idx);
    this.u = { uA: { value: new THREE.Color(colA) }, uB: { value: new THREE.Color(colB) }, uTen: { value: 0 }, uTime: { value: 0 } };
    g.userData.live = true;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: 'attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uA, uB; uniform float uTen, uTime; varying float vT;
        void main(){
          vec3 c = mix(uA, uB, vT);
          float pulse = pow(0.5 + 0.5 * sin(vT * 28.0 - uTime * 9.0), 8.0);
          c *= 1.7 + pulse * 2.2;
          float hot = smoothstep(0.75, 1.0, uTen);
          c = mix(c, vec3(4.0, 1.3, 0.9) * (0.75 + 0.35 * sin(uTime * 45.0)), hot * 0.75);
          gl_FragColor = vec4(clamp(c, 0.0, 20.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.pos = pos;
    scene.add(this.mesh);
  }

  update(P, tension, t) {
    const n = P.length - 1, pos = this.pos;
    let px = 0, py = 0, pz = 0;
    const cr = (a, b, c, d, f) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    const pts = [];
    for (let s = 0; s < S; s++) {
      const u = (s / (S - 1)) * n, i = Math.min(Math.floor(u), n - 1), f = u - i;
      const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, n)];
      pts.push(cr(p0.x, p1.x, p2.x, p3.x, f), cr(p0.y, p1.y, p2.y, p3.y, f), cr(p0.z, p1.z, p2.z, p3.z, f));
    }
    for (let s = 0; s < S; s++) {
      const a = Math.max(s - 1, 0) * 3, b = Math.min(s + 1, S - 1) * 3;
      let tx = pts[b] - pts[a], ty = pts[b + 1] - pts[a + 1], tz = pts[b + 2] - pts[a + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // normal = t x up (or t x X when the cord is vertical)
      let nx = -tz, ny = 0, nz = tx;
      if (Math.hypot(nx, nz) < 0.2) { nx = 0; ny = tz; nz = -ty; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      px = pts[s * 3]; py = pts[s * 3 + 1]; pz = pts[s * 3 + 2];
      for (let r = 0; r < RS; r++) {
        const ang = (r / RS) * Math.PI * 2, c = Math.cos(ang) * RAD, si = Math.sin(ang) * RAD, k = (s * RS + r) * 3;
        pos[k] = px + nx * c + bx * si; pos[k + 1] = py + ny * c + by * si; pos[k + 2] = pz + nz * c + bz * si;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.u.uTen.value = tension;
    this.u.uTime.value = t % 3600;
  }

  setColors(a, b) {
    this.u.uA.value.setHex(a);
    this.u.uB.value.setHex(b);
  }
}

// Four climbers and three cords, created once and drawn for a few frames at startup so every shader they
// need is built before play. Games show and hide them; nothing is ever disposed.
export function makePool(scene) {
  const robots = [0, 1, 2, 3].map((s) => new Stickman(scene, s));
  // Rigs for the angry dummies (jumpers): a headband and angry brows, no gun.
  const jumpers = [0, 1, 2, 3].map(() => {
    const r = new Stickman(scene, 0);
    r.bandMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    r.bandMat.userData.live = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.035, 6, 24), r.bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.07;
    r.head.add(band);
    for (const s of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), new THREE.MeshBasicMaterial({ color: 0x0a0d14 }));
      brow.position.set(s * 0.06, 0.1, 0.176);
      brow.rotation.z = s * 0.45;
      r.head.add(brow);
    }
    if (r.gun) r.gun.visible = false;
    return r;
  });
  const ropes = [0, 1, 2].map(() => new RopeMesh(scene, COLORS[0], COLORS[1]));
  const coins = new CoinPool(scene), relic = new RelicMark(scene);
  const hidden = [];
  [...robots, ...jumpers].forEach((r, i) => {
    r.g.position.set(i * 2, 1.2, 0);
    r.g.traverse((o) => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; hidden.push(o); } });
  });
  return {
    robots,
    jumpers,
    ropes,
    coins,
    relic,
    warm: 4,
    tick() {
      if (this.warm <= 0 || --this.warm > 0) return;
      for (const o of hidden) o.frustumCulled = true;
      for (const r of robots) r.hide();
      for (const r of jumpers) r.hide();
      for (const l of ropes) l.mesh.visible = false;
    },
  };
}
