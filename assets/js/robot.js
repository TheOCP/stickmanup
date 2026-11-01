// The glowing cord between climbers, and the pool of climbers and cords.
import * as THREE from 'three';
import { COLORS } from './colors.js';
import { Stickman } from './stickman.js';
export { COLORS, COLOR_CSS } from './colors.js';

const S = 48, RS = 6, RAD = 0.05;

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
    this.u.uTime.value = t;
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
  const ropes = [0, 1, 2].map(() => new RopeMesh(scene, COLORS[0], COLORS[1]));
  const hidden = [];
  robots.forEach((r, i) => {
    r.g.position.set(i * 2, 1.2, 0);
    r.g.traverse((o) => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; hidden.push(o); } });
  });
  return {
    robots,
    ropes,
    warm: 4,
    tick() {
      if (this.warm <= 0 || --this.warm > 0) return;
      for (const o of hidden) o.frustumCulled = true;
      for (const r of robots) r.hide();
      for (const l of ropes) l.mesh.visible = false;
    },
  };
}
