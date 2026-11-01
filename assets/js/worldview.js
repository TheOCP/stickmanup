// Turns level data into meshes. Static pieces are instanced, moving pieces get one merged mesh each
// (body + glowing edge trim) so the phone draws the whole tower in few draw calls.
import * as THREE from 'three';
import { BOX } from './physics.js';
import { CORE_R, cpEnabled } from './level.js';
import { TAU, rng, clamp } from './util.js';
import { PATTERN_GLSL } from './pattern.js';

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

let SIMPLE = false, PATTERN = 1;
// Graphics level 3+: plain Lambert materials instead of the custom panel shader.
export function setSimple(v) {
  SIMPLE = v;
}

// Standard material with world-space panel lines and an optional per-vertex glow attribute.
export function panelMat(color, o = {}) {
  if (SIMPLE) {
    const { roughness, metalness, flatShading, pattern, ...rest } = o;
    return new THREE.MeshLambertMaterial(Object.assign({ color }, rest));
  }
  const { pattern = PATTERN, ...props } = o, pat = pattern;
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.62, metalness: 0.35 }, props));
  m.userData.panel = true;
  m.userData.pattern = pat;
  m.customProgramCacheKey = () => 'pat' + pat;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;\nvarying vec3 vSmuW;\nvarying vec3 vSmuN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;
        vec4 slw = vec4(transformed, 1.0); vec3 sln = objectNormal;
        #ifdef USE_INSTANCING
          slw = instanceMatrix * slw; sln = mat3(instanceMatrix) * sln;
        #endif
        vSmuW = (modelMatrix * slw).xyz; vSmuN = normalize(mat3(modelMatrix) * sln);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;\nvarying vec3 vSmuW;\nvarying vec3 vSmuN;\n' + PATTERN_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= smuPattern(${pat}, vSmuW, normalize(vSmuN));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
  };
  return m;
}

// Merges parts [{geo, m: Matrix4, glow: Color|null}] into one geometry with position, normal, aGlow.
function merge(parts) {
  const pos = [], nor = [], glo = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m);
    const a = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      if (p.glow) glo.push(p.glow.r, p.glow.g, p.glow.b);
      else glo.push(0, 0, 0);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  g.computeBoundingSphere();
  return g;
}

const BOXG = new THREE.BoxGeometry(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
// Places a unit cylinder (along y) between two points.
function stretchTo(m, ax, ay, az, bx, by, bz) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length() || 1e-3;
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  m.quaternion.setFromUnitVectors(_up, _dir.divideScalar(len));
  m.scale.set(1, len, 1);
}
const mat4 = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
};
const colMatrix = (c, sx = 1, sy = 1, sz = 1) => {
  _e.set(c.rx, c.ry, c.rz, 'YXZ');
  return _m.compose(_p.set(c.x, c.y, c.z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
};

// Edge trim boxes in a box collider's local frame (top edges; beams only get the long sides).
function trimParts(hx, hy, hz, glow, allFour) {
  const t = 0.035, w = 0.08, y = hy + t / 2 - 0.004, out = [];
  out.push({ geo: BOXG, m: mat4(0, y, hz - w / 2, hx * 2, t, w), glow });
  out.push({ geo: BOXG, m: mat4(0, y, -hz + w / 2, hx * 2, t, w), glow });
  if (allFour) {
    out.push({ geo: BOXG, m: mat4(hx - w / 2, y, 0, w, t, hz * 2 - w * 2), glow });
    out.push({ geo: BOXG, m: mat4(-hx + w / 2, y, 0, w, t, hz * 2 - w * 2), glow });
  }
  return out;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class WorldView {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.dyn = [];
    this.cps = [];
    this.rods = [];
    this.fans = [];
    this.pads = [];
    this.spin = [];
    this.blink = [];
    this.anim = [];
    this.doors = [];
    this.monsters = [];
    this.bats = [];
    this.lasers = [];
    this.arrowFx = [];
    this.swingFx = [];
    this.camPos = null;
    this.key = level.mapKey;
    PATTERN = level.pattern;
    // Neon at night, painted trims by day, soft glow in the forest.
    this.glowK = { storm: 2.4, sunny: 1.05, forest: 1.15 }[this.key];
    this.zoneMats = level.zones.map((z) => panelMat(z.tint));
    this.iceMat = panelMat(0xa8d8ee, { roughness: 0.18, metalness: 0.1 });
    this.crumbleMat = panelMat(0x7a4a44);
    this.buildStatic();
    this.buildDynamic();
    this.buildRings();
    this.buildCore();
    this.buildSummit();
    this.buildCheckpoints();
    this.buildRods();
    this.buildFans();
    this.buildDecor();
    this.buildDistant();
    this.buildIsland();
    this.buildMapDecor();
    this.buildHooks();
    this.buildDoors();
    this.buildCreatures();
    this.buildHazards();
    this.buildSideTrees();
    this.freeze();
  }

  dispose() {
    this.scene.remove(this.root);
  }

  // Performance: only animated things recompute transforms each frame, and only animated materials are
  // re-checked by the native mirror. Everything else in the tower is frozen.
  freeze() {
    const anim = [...this.dyn.map((d) => d.mesh), ...this.pads.map((c) => c.fx), ...this.cps.map((e) => e.halo),
      ...this.rods.map((r) => r.tip), ...this.fans.map((f) => f.rotor), ...this.spin.map((s) => s.o), this.summitOrb, ...this.anim];
    for (const o of anim) o.userData.anim = true;
    for (const m of [...this.cps.flatMap((e) => [e.orbMat, e.ringMat]), ...this.rods.flatMap((r) => [r.tipMat, r.warnMat]), ...this.blink.map((b) => b.m)]) m.userData.live = true;
    this.root.traverse((o) => {
      if (o.userData.anim) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }

  add(o, shadow = true) {
    if (shadow) { o.castShadow = true; o.receiveShadow = true; }
    this.root.add(o);
    return o;
  }

  buildStatic() {
    const L = this.level, R = rng(99);
    const boxes = L.cols.filter((c) => c.t === BOX && c.vis !== false && !c.dyn && !c.crumble && c.kind !== 'door');
    const cyls = L.cols.filter((c) => c.t !== BOX && !c.dyn && (c.kind === 'pillar' || c.kind === 'hub' || c.kind === 'post'));
    const mat = panelMat(0xffffff);
    const bm = new THREE.InstancedMesh(BOXG, mat, boxes.length);
    const col = new THREE.Color();
    const strips = [];
    boxes.forEach((c, i) => {
      bm.setMatrixAt(i, colMatrix(c, c.hx * 2, c.hy * 2, c.hz * 2));
      const z = L.zones[c.zone];
      if (c.kind === 'crate') col.setHex(this.key === 'sunny' ? 0xc9a36b : 0x7a5a3c);
      else if (c.kind === 'branch') col.setHex(0x7a5634);
      else if (c.kind === 'wall') col.setHex(this.key === 'storm' ? 0x2a2f3a : this.key === 'sunny' ? 0xe8e2d4 : 0x4a3a2a);
      else if (c.kind === 'pier') col.setHex(0x3a3f48);
      else if (c.kind === 'pad') col.setHex(z.color).multiplyScalar(0.5);
      else if (c.surf === 'ice') col.setHex(0xb0dcf0);
      else col.setHex(z.tint);
      col.multiplyScalar(0.85 + R() * 0.3);
      bm.setColorAt(i, col);
      if (c.kind === 'plat' || c.kind === 'beam' || c.kind === 'pad' || c.kind === 'branch') strips.push(c);
      if (c.kind === 'pad') this.pads.push(c);
    });
    this.add(bm);

    const sm = new THREE.InstancedMesh(BOXG, new THREE.MeshBasicMaterial({ color: HDR(0xffffff, this.glowK) }), strips.length * 4);
    let k = 0;
    const base = new THREE.Matrix4();
    for (const c of strips) {
      base.copy(colMatrix(c));
      const glowCol = new THREE.Color(L.zones[c.zone].color);
      for (const p of trimParts(c.hx, c.hy, c.hz, null, c.kind !== 'beam')) {
        sm.setMatrixAt(k, _m2.multiplyMatrices(base, p.m));
        sm.setColorAt(k++, glowCol);
      }
    }
    sm.count = k;
    this.add(sm, false);

    const cg = new THREE.CylinderGeometry(1, 1, 1, 28);
    const cm = new THREE.InstancedMesh(cg, mat, cyls.length);
    const rg = new THREE.TorusGeometry(1, 0.035, 6, 36).rotateX(Math.PI / 2);
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: HDR(0xffffff, this.glowK) }), cyls.length);
    cyls.forEach((c, i) => {
      cm.setMatrixAt(i, colMatrix(c, c.r, c.hh * 2, c.r));
      col.setHex(c.surf === 'ice' ? 0xb0dcf0 : L.zones[c.zone].tint).multiplyScalar(0.85 + R() * 0.3);
      cm.setColorAt(i, col);
      rm.setMatrixAt(i, mat4(c.x, c.y + c.hh + 0.01, c.z, c.r - 0.04, 1, c.r - 0.04));
      rm.setColorAt(i, col.setHex(L.zones[c.zone].color));
    });
    this.add(cm);
    this.add(rm, false);

    // Jump pads: pulsing glow discs.
    const pg = new THREE.CircleGeometry(0.72, 32).rotateX(-Math.PI / 2);
    for (const c of this.pads) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: HDR(L.zones[c.zone].color, 2.2), transparent: true }));
      m.position.set(c.x, c.y + c.hy + 0.02, c.z);
      this.add(m, false);
      c.fx = m;
    }
  }

  buildDynamic() {
    const L = this.level;
    for (const c of L.cols) {
      if (!c.dyn && !c.crumble) continue;
      const z = L.zones[c.zone];
      const glow = c.crumble ? HDR(0xff5a2a, 2.2) : HDR(z.color, this.glowK);
      const parts = [{ geo: BOXG, m: mat4(0, 0, 0, c.hx * 2, c.hy * 2, c.hz * 2), glow: null }].concat(trimParts(c.hx, c.hy, c.hz, glow, true));
      const mat = c.crumble ? this.crumbleMat : c.surf === 'ice' ? this.iceMat : this.zoneMats[c.zone];
      const mesh = this.add(new THREE.Mesh(merge(parts), mat));
      this.dyn.push({ c, mesh, fall: 0 });
    }
  }

  buildRings() {
    const L = this.level;
    for (const ring of L.rings) {
      const { y, rIn, rOut, a0, a1 } = ring, span = a1 - a0, seg = Math.max(12, Math.ceil((span / TAU) * 128));
      const tint = ring.zone === 0 ? { storm: 0x333944, sunny: 0xd9c49c, forest: 0x4f6b3a }[this.key] : L.zones[ring.zone].tint;
      const mat = panelMat(tint, { side: THREE.DoubleSide });
      const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, seg, 3, -a1, span).rotateX(-Math.PI / 2), mat);
      top.position.y = y;
      this.add(top);
      for (const r of [rIn, rOut]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.2, seg, 1, true, Math.PI / 2 - a1, span), mat);
        w.position.y = y - 0.6;
        this.add(w);
      }
      if (span < TAU - 0.01) {
        for (const a of [a0, a1]) {
          const cap = new THREE.Mesh(BOXG, mat);
          cap.scale.set(0.12, 1.2, rOut - rIn);
          cap.position.set(Math.cos(a) * (rIn + rOut) / 2, y - 0.6, Math.sin(a) * (rIn + rOut) / 2);
          cap.rotation.y = -(a + Math.PI / 2);
          this.add(cap);
        }
      }
      const gm = new THREE.MeshBasicMaterial({ color: HDR(L.zones[ring.zone].color, this.glowK) });
      for (const r of [rOut - 0.06, rIn + 0.06]) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, seg, span).rotateX(-Math.PI / 2), gm);
        t.rotation.y = -a1;
        t.position.y = y + 0.01;
        this.add(t, false);
      }
    }
  }

  buildCore() {
    if (this.key !== 'storm') return this.buildCoreAlt();
    const L = this.level, R = rng(5);
    const H = L.top - 1.2 + 40;
    const win = canvasTex(256, 1024, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let y = 8; y < h; y += 22) {
        for (let x = 6; x < w; x += 18) {
          if (R() < 0.22) {
            g.fillStyle = R() < 0.7 ? `hsl(${190 + R() * 30},80%,${45 + R() * 25}%)` : `hsl(${30 + R() * 20},90%,${50 + R() * 20}%)`;
            g.fillRect(x, y, 10, 12);
          }
        }
      }
      g.fillStyle = 'rgba(63,240,208,0.35)';
      g.fillRect(127, 0, 2, h);
    });
    win.wrapS = win.wrapT = THREE.RepeatWrapping;
    win.repeat.set(10, H / 38);
    const m = panelMat(0x262c38, { metalness: 0.55, roughness: 0.45, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.85 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R, H, 72, 1, true), m);
    core.position.y = (L.top - 1.2 - 40) / 2;
    this.add(core);
    for (const z of L.zones) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(CORE_R + 0.06, 0.14, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: HDR(z.color, 2.2) }));
      t.position.y = z.y0 - 1.4;
      this.add(t, false);
    }
  }

  // Sunny: a white lighthouse with red bands and warm windows. Forest: a giant bark trunk.
  buildCoreAlt() {
    const L = this.level, R = rng(6), H = L.top - 1.2 + 40, sunny = this.key === 'sunny';
    const tex = canvasTex(512, 1024, (g, w, h) => {
      if (sunny) {
        g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 20; x < w; x += 40) { g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.05})`; g.fillRect(x, y, 38, 14); }
        g.fillStyle = '#c8322f'; for (let y = 0; y < h; y += 256) g.fillRect(0, y, w, 64);
        for (let y = 112; y < h; y += 256) for (let x = 36; x < w; x += 128) {
          g.fillStyle = '#2b3a4a'; g.fillRect(x, y, 60, 46);
          g.fillStyle = '#8fc4e8'; g.fillRect(x + 5, y + 5, 23, 36); g.fillRect(x + 32, y + 5, 23, 36);
          g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 7, y + 7, 6, 16);
        }
      } else {
        g.fillStyle = '#4a3624'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
          const x = R() * w, y = R() * h, l = 40 + R() * 160;
          g.strokeStyle = `rgba(${R() < 0.5 ? '20,12,6' : '120,90,60'},${0.15 + R() * 0.35})`;
          g.lineWidth = 1 + R() * 4;
          g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + R() * 10 - 5, y + l / 3, x + R() * 10 - 5, y + l * 0.66, x + R() * 6 - 3, y + l); g.stroke();
        }
        for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(90,140,60,${0.25 + R() * 0.4})`; g.beginPath(); g.ellipse(R() * w, R() * h, 6 + R() * 20, 4 + R() * 12, 0, 0, TAU); g.fill(); }
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(sunny ? 4 : 3, H / (sunny ? 60 : 30));
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: sunny ? 0.55 : 0.9, metalness: 0 });
    if (!sunny) {
      // Side trees reuse the bark, wrapped less often round their thinner trunks.
      const t2 = tex.clone();
      t2.repeat.set(1, 40);
      t2.needsUpdate = true;
      this.barkMat = new THREE.MeshStandardMaterial({ map: t2, roughness: 0.9, metalness: 0 });
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R * (sunny ? 1.08 : 1.25), H, 72, 1, true), m);
    core.position.y = (L.top - 1.2 - 40) / 2;
    this.add(core);
    const accent = new THREE.MeshBasicMaterial({ color: HDR(sunny ? 0xffffff : 0x9be564, sunny ? 1.0 : 1.3) });
    for (const z of L.zones) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(CORE_R + 0.08, sunny ? 0.22 : 0.12, 8, 96).rotateX(Math.PI / 2), accent);
      t.position.y = z.y0 - 1.4;
      this.add(t, false);
    }
  }

  buildSummit() {
    const L = this.level, s = L.summit, gold = 0xffd76a;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 1.2, 96), panelMat(0x6e6250));
    disc.position.set(0, s.y - 0.6, 0);
    this.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9.55, 0.08, 8, 128).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: HDR(gold, 2.5) }));
    rim.position.y = s.y + 0.01;
    this.add(rim, false);
    const goal = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.2, s.r, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: HDR(gold, 2.0), transparent: true, opacity: 0.8 }));
    goal.position.y = s.y + 0.03;
    this.add(goal, false);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 6), panelMat(0x8a7a5a, { emissive: gold, emissiveIntensity: 0.3 }));
    spire.position.set(0, s.y + 3, 0);
    this.add(spire);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), new THREE.MeshBasicMaterial({ color: HDR(gold, 4) }));
    orb.position.set(0, s.y + 6.8, 0);
    this.add(orb, false);
    this.beam = this.add(this.lightBeam(1.4, 420, gold, 0.5), false);
    this.beam.position.set(0, s.y + 6.8 + 210, 0);
    this.summitOrb = orb;
  }

  lightBeam(r, h, color, a) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uC: { value: HDR(color, 1.5) }, uA: { value: a }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uC; uniform float uA, uT; varying vec2 vUv;
        void main(){ float f = (1.0 - vUv.y) * (0.75 + 0.25 * sin(vUv.y * 40.0 - uT * 3.0));
          gl_FragColor = vec4(clamp(uC * f * uA, 0.0, 20.0), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), m);
    b.frustumCulled = false;
    return b;
  }

  buildCheckpoints() {
    for (const cp of this.level.cps) {
      const g = new THREE.Group();
      g.position.set(cp.x, cp.y, cp.z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.14, 32), panelMat(0x2a3140));
      pad.position.y = 0.07;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.5, 10), panelMat(0x3a4250, { metalness: 0.7 }));
      pole.position.y = 1.25;
      const orbMat = new THREE.MeshBasicMaterial({ color: HDR(0x7a8aa0, 1.0) });
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), orbMat);
      orb.position.y = 2.75;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, 40), orbMat);
      halo.position.y = 2.75;
      const ringMat = new THREE.MeshBasicMaterial({ color: HDR(0x7a8aa0, 0.6) });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 6, 48).rotateX(Math.PI / 2), ringMat);
      ring.position.y = 0.15;
      const beam = this.lightBeam(0.14, 70, 0x9ffff0, 0.22);
      beam.position.y = 2.75 + 35;
      beam.visible = false;
      g.add(pad, pole, orb, halo, ring, beam);
      pad.castShadow = pole.castShadow = true;
      this.root.add(g);
      this.cps.push({ cp, g, orbMat, ringMat, halo, beam });
    }
  }

  // Show only the checkpoints this difficulty uses; light reached and current ones.
  setCheckpoints(diff, current) {
    for (const e of this.cps) {
      e.g.visible = cpEnabled(e.cp, diff);
      const z = this.level.zones[e.cp.zone];
      const on = e.cp.i <= current;
      e.orbMat.color.copy(e.cp.i === current ? HDR(0x9ffff0, 1.6) : on ? HDR(z.color, 1.6) : HDR(0x6a7890, 0.9));
      e.ringMat.color.copy(e.orbMat.color).multiplyScalar(0.45);
      e.beam.visible = e.cp.i === current;
    }
  }

  buildRods() {
    const metal = panelMat(0x3a3e4c, { metalness: 0.8, roughness: 0.3 });
    const coilGlow = HDR(0x9b7bff, 2.2);
    const parts = [{ geo: new THREE.CylinderGeometry(0.07, 0.15, 3.2, 10), m: mat4(0, 1.6, 0, 1, 1, 1), glow: null }];
    for (const h of [1.0, 1.7, 2.4]) parts.push({ geo: new THREE.TorusGeometry(0.24, 0.04, 6, 20).rotateX(Math.PI / 2), m: mat4(0, h, 0, 1, 1, 1), glow: coilGlow });
    const geo = merge(parts);
    const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
    for (const r of this.level.rods) {
      const g = new THREE.Group();
      g.position.set(r.x, r.y, r.z);
      const pole = new THREE.Mesh(geo, metal);
      pole.castShadow = true;
      const tipMat = new THREE.MeshBasicMaterial({ color: HDR(0xb9a6ff, 2) });
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), tipMat);
      tip.position.y = 3.3;
      const warnMat = new THREE.MeshBasicMaterial({ color: HDR(0xb07bff, 2.5), transparent: true, opacity: 0, depthWrite: false });
      const warn = new THREE.Mesh(ringGeo, warnMat);
      warn.scale.setScalar(r.rad);
      warn.position.y = 0.04;
      g.add(pole, tip, warn);
      this.root.add(g);
      this.rods.push({ r, tip, tipMat, warnMat });
    }
  }

  buildFans() {
    const metal = panelMat(0x4a4450, { metalness: 0.7, roughness: 0.35 });
    for (const f of this.level.fans) {
      const g = new THREE.Group();
      g.position.set(f.x, f.y, f.z);
      g.rotation.y = Math.atan2(f.dx, f.dz);
      const housing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.16, 8, 32), metal);
      const rotor = new THREE.Group();
      rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16).rotateX(Math.PI / 2), metal));
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(BOXG, metal);
        b.scale.set(0.32, 1.3, 0.06);
        b.position.set(Math.sin((i / 5) * TAU) * 0.7, Math.cos((i / 5) * TAU) * 0.7, 0);
        b.rotation.set(0, 0.5, -(i / 5) * TAU);
        rotor.add(b);
      }
      const sm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uOn: { value: 0 }, uC: { value: HDR(0xffb070, 1.2) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uT, uOn; uniform vec3 uC; varying vec2 vUv;
          void main(){ float s = pow(0.5 + 0.5 * sin(vUv.y * 30.0 + uT * 18.0 + sin(vUv.x * 25.0) * 2.0), 6.0);
            float fade = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
            gl_FragColor = vec4(uC * s * fade * uOn * 0.5, 1.0);
            #include <colorspace_fragment>
          }`,
      });
      const len = f.reach;
      const stream = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.8, len, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2), sm);
      g.add(housing, rotor, stream);
      housing.castShadow = true;
      this.root.add(g);
      this.fans.push({ f, rotor, sm, spin: 0 });
    }
  }

  buildDecor() {
    const L = this.level, D = (k) => L.decor.filter((d) => d.k === k);
    const lamps = D('lamp');
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 3, 8), panelMat(0x30343c), lamps.length);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: HDR(0xffc77a, 3) }), lamps.length);
    lamps.forEach((d, i) => { post.setMatrixAt(i, mat4(d.x, d.y + 1.5, d.z, 1, 1, 1)); bulb.setMatrixAt(i, mat4(d.x, d.y + 3.05, d.z, 1, 1, 1)); });
    this.add(post); this.add(bulb, false);

    const metal = panelMat(0x5a4a42, { metalness: 0.7, roughness: 0.4 });
    for (const d of D('rotor')) {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      g.rotation.y = Math.atan2(Math.cos(d.th), Math.sin(d.th));
      const rot = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(BOXG, metal);
        b.scale.set(0.4, d.s, 0.08);
        b.position.set(Math.sin((i / 4) * TAU) * d.s * 0.5, Math.cos((i / 4) * TAU) * d.s * 0.5, 0.3);
        b.rotation.set(0, 0.4, -(i / 4) * TAU);
        rot.add(b);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.s * 1.05, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color: HDR(0xff8a3d, 2) }));
      g.add(rot, ring);
      this.root.add(g);
      this.spin.push({ o: rot, axis: 'z', sp: 2 + Math.random() * 3 });
    }

    for (const d of D('coil')) {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      const h = d.s * 4;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * d.s, 0.5 * d.s, h, 10), panelMat(0x30304a));
      p.position.y = -h / 2;
      g.add(p);
      const gm = new THREE.MeshBasicMaterial({ color: HDR(0x9b7bff, 2.2) });
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.5 * d.s, 0.06 * d.s, 6, 24).rotateX(Math.PI / 2), gm);
        t.position.y = -h * (0.2 + i * 0.18);
        g.add(t);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.6 * d.s, 16, 12), gm);
      g.add(top);
      this.root.add(g);
      this.blink.push({ m: gm, base: 2.2, hex: 0x9b7bff, sp: 7 + Math.random() * 5 });
    }

    const rocks = D('rock');
    this.rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), panelMat(0x4a3a48), rocks.length);
    this.rockData = rocks;
    this.add(this.rocks);

    const ice = D('icicle');
    const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 1, 6).rotateX(Math.PI).translate(0, -0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0xcfefff, roughness: 0.1, metalness: 0.1, emissive: 0x3a6a88, transparent: true, opacity: 0.88 }), ice.length);
    ice.forEach((d, i) => im.setMatrixAt(i, mat4(d.x, d.y, d.z, d.s * 0.8, d.s, d.s * 0.8)));
    this.add(im, false);

    for (const d of D('halo')) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(d.s, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: HDR(0xffd76a, 2.2) }));
      t.position.set(d.x, d.y, d.z);
      t.rotation.set(d.rx, d.ry, 0);
      this.root.add(t);
      this.spin.push({ o: t, axis: 'y', sp: 0.2 });
    }

    const cages = D('cage');
    const bars = [];
    for (const d of cages) {
      const h = d.y1 - d.y0, s = d.s / 2, ax = Math.cos(d.ry), az = -Math.sin(d.ry), bx = Math.sin(d.ry), bz = Math.cos(d.ry);
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) bars.push(mat4(d.x + (ax * u + bx * v) * s, d.y0 + h / 2, d.z + (az * u + bz * v) * s, 0.12, h, 0.12, 0, d.ry, 0));
      for (let y = d.y0; y <= d.y1; y += 2.5) {
        bars.push(mat4(d.x + bx * s, y, d.z + bz * s, d.s, 0.1, 0.1, 0, d.ry, 0));
        bars.push(mat4(d.x - bx * s, y, d.z - bz * s, d.s, 0.1, 0.1, 0, d.ry, 0));
      }
    }
    const cm = new THREE.InstancedMesh(BOXG, new THREE.MeshStandardMaterial({ color: 0x8a6a20, emissive: 0x6a4a00, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.4 }), bars.length);
    bars.forEach((m, i) => cm.setMatrixAt(i, m));
    this.add(cm, false);
  }

  // The ground the tower stands on: open sea (storm), a sandy beach island (sunny) or a forest island.
  buildIsland() {
    if (this.key === 'storm') return;
    const sunny = this.key === 'sunny', R = sunny ? 40 : 88;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 9, 3, 96, 1), new THREE.MeshStandardMaterial({ color: sunny ? 0xe9d6a4 : 0x47732f, roughness: 1, metalness: 0 }));
    top.position.y = -1.1;
    this.add(top);
    if (sunny) {
      const wet = new THREE.Mesh(new THREE.RingGeometry(R - 1, R + 6, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xbfa57a, roughness: 0.35, metalness: 0 }));
      wet.position.y = 0.06;
      this.add(wet, false);
      const foam = new THREE.Mesh(new THREE.RingGeometry(R + 5, R + 7.5, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
      foam.position.y = 0.09;
      foam.material.userData.live = true;
      this.foam = foam;
      this.add(foam, false);
    } else {
      // Darker grass rings and dirt under the trees for depth.
      const dirt = new THREE.Mesh(new THREE.RingGeometry(19, 30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b4a30, roughness: 1, metalness: 0 }));
      dirt.position.y = 0.42;
      this.add(dirt, false);
    }
  }

  buildMapDecor() {
    const L = this.level, D = (k) => L.decor.filter((d) => d.k === k), R = rng(77);
    if (this.key === 'sunny') {
      // Palms: a leaning trunk and drooping fronds, instanced.
      const palms = D('palm');
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 7, 8, 4).translate(0, 3.5, 0);
      const pos = trunkGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setX(i, pos.getX(i) + (y / 7) ** 2 * 1.4); }
      trunkGeo.computeVertexNormals();
      const frond = new THREE.BoxGeometry(0.7, 0.06, 3.2).translate(0, 0, 1.6);
      const fp = frond.attributes.position;
      for (let i = 0; i < fp.count; i++) { const z = fp.getZ(i); fp.setY(i, fp.getY(i) - (z / 3.2) ** 2 * 1.2); fp.setX(i, fp.getX(i) * (1 - z / 4)); }
      frond.computeVertexNormals();
      const parts = [];
      for (let k = 0; k < 7; k++) parts.push({ geo: frond, m: mat4(1.4, 7, 0, 1, 1, 1, -0.15, (k / 7) * TAU, 0), glow: null });
      parts.push({ geo: new THREE.SphereGeometry(0.35, 8, 6), m: mat4(1.35, 6.8, 0.2, 1, 1, 1), glow: null });
      const crown = merge(parts);
      const tm = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.9 }), palms.length);
      const lm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }), palms.length);
      const col = new THREE.Color();
      palms.forEach((d, i) => {
        const m = mat4(d.x, d.y, d.z, d.s, d.s, d.s, 0, d.ry, d.lean * 0.3);
        tm.setMatrixAt(i, m);
        lm.setMatrixAt(i, m);
        lm.setColorAt(i, col.setHSL(0.27 + R() * 0.06, 0.55, 0.32 + R() * 0.1));
      });
      this.add(tm); this.add(lm);
      // Sailboats out at sea.
      const hull = new THREE.CylinderGeometry(1.2, 0.6, 1, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 3.2);
      const boat = merge([
        { geo: hull, m: mat4(0, 0.3, 0, 1, 1, 1), glow: null },
        { geo: new THREE.CylinderGeometry(0.08, 0.08, 7, 6), m: mat4(0, 4, 0, 1, 1, 1), glow: null },
      ]);
      const sail = new THREE.BufferGeometry();
      sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, -0.2, 0, 7.2, 0, 0, 1.2, 3.2], 3));
      sail.computeVertexNormals();
      const boats = D('boat');
      const bm = new THREE.InstancedMesh(boat, new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }), boats.length);
      const sm = new THREE.InstancedMesh(sail, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), boats.length);
      boats.forEach((d, i) => { const m = mat4(d.x, d.y, d.z, d.s, d.s, d.s, 0, d.ry, 0); bm.setMatrixAt(i, m); sm.setMatrixAt(i, m); sm.setColorAt(i, col.setHex([0xffffff, 0xff6b5a, 0x5ab8ff, 0xffd25a][i % 4])); });
      this.add(bm); this.add(sm);
      // Puffy clouds around the upper tower, slowly circling.
      const clouds = D('cloud'), puff = new THREE.IcosahedronGeometry(1, 2), n = clouds.length * 5;
      const cm = new THREE.InstancedMesh(puff, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xc8d8ff, emissiveIntensity: 0.25 }), n);
      let k = 0;
      for (const d of clouds) for (let j = 0; j < 5; j++) {
        const s = d.s * (0.5 + R() * 0.5);
        cm.setMatrixAt(k++, mat4(d.x + (R() - 0.5) * d.s * 2.2, d.y + (R() - 0.3) * d.s * 0.4, d.z + (R() - 0.5) * d.s * 1.4, s, s * 0.6, s));
      }
      cm.frustumCulled = false;
      this.cloudGroup = new THREE.Group();
      this.cloudGroup.add(cm);
      this.root.add(this.cloudGroup);
      this.anim.push(this.cloudGroup);
      // Gulls gliding in circles.
      const wing = new THREE.BoxGeometry(0.9, 0.03, 0.22);
      const gull = merge([
        { geo: wing, m: mat4(-0.42, 0.12, 0, 1, 1, 1, 0, 0, 0.35), glow: null },
        { geo: wing, m: mat4(0.42, 0.12, 0, 1, 1, 1, 0, 0, -0.35), glow: null },
        { geo: new THREE.SphereGeometry(0.12, 8, 6).scale(1, 1, 2.2), m: mat4(0, 0, 0, 1, 1, 1), glow: null },
      ]);
      const gm = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
      this.gulls = D('gull').map((d) => {
        const pivot = new THREE.Group(), g = new THREE.Mesh(gull, gm);
        pivot.position.y = d.y;
        g.position.x = d.r;
        g.rotation.y = d.sp > 0 ? Math.PI : 0;
        g.scale.setScalar(1.6);
        pivot.add(g);
        this.root.add(pivot);
        this.anim.push(pivot, g);
        return { d, pivot, g };
      });
    } else if (this.key === 'forest') {
      // Trees: trunk plus three stacked foliage cones, instanced, with per-tree colour.
      const trees = D('tree');
      const trunk = new THREE.CylinderGeometry(0.35, 0.6, 6, 8).translate(0, 3, 0);
      const fol = merge([4, 6.5, 9].map((y, j) => ({ geo: new THREE.ConeGeometry(3.4 - j * 0.8, 4.2, 9), m: mat4(0, y, 0, 1, 1, 1, 0, j, 0), glow: null })));
      const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 }), trees.length);
      const fm = new THREE.InstancedMesh(fol, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), trees.length);
      const col = new THREE.Color();
      trees.forEach((d, i) => {
        const m = mat4(d.x, d.y, d.z, d.s, d.s * (0.9 + R() * 0.4), d.s, 0, d.ry, 0);
        tm.setMatrixAt(i, m);
        fm.setMatrixAt(i, m);
        fm.setColorAt(i, col.setHSL(0.26 + R() * 0.08, 0.5, 0.2 + R() * 0.1));
      });
      this.add(tm); this.add(fm);
      // Giant branches growing out of the trunk with leafy clumps at the ends.
      const branches = D('branch');
      const limb = new THREE.CylinderGeometry(0.25, 0.6, 1, 8).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
      const bm = new THREE.InstancedMesh(limb, new THREE.MeshStandardMaterial({ color: 0x4e3824, roughness: 1 }), branches.length);
      const clump = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x3c6e2a, roughness: 0.9, flatShading: true }), branches.length * 3);
      branches.forEach((d, i) => {
        const len = d.s * 2.2, ry = -d.th;
        bm.setMatrixAt(i, mat4(d.x, d.y, d.z, len, 1, 1, 0, ry, 0.25));
        const ex = d.x + Math.cos(d.th) * len, ez = d.z + Math.sin(d.th) * len, ey = d.y + len * 0.25;
        for (let j = 0; j < 3; j++) clump.setMatrixAt(i * 3 + j, mat4(ex + (R() - 0.5) * 2, ey + R() * 1.2, ez + (R() - 0.5) * 2, d.s * 0.55, d.s * 0.4, d.s * 0.55));
      });
      this.add(bm); this.add(clump);
      // Mushrooms on ledges (glowing caps) and hanging vines.
      const mush = D('mushroom');
      const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 0.4, 8).translate(0, 0.2, 0), new THREE.MeshStandardMaterial({ color: 0xece2cc, roughness: 0.8 }), mush.length);
      const cap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 12, 6, 0, TAU, 0, Math.PI / 2).translate(0, 0.36, 0),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xff5a3c, emissiveIntensity: 0.25 }), mush.length);
      mush.forEach((d, i) => {
        const m = mat4(d.x, d.y, d.z, d.s, d.s, d.s, 0, R() * TAU, 0);
        stem.setMatrixAt(i, m); cap.setMatrixAt(i, m);
        cap.setColorAt(i, col.setHex(R() < 0.6 ? 0xd8322a : 0x8a5ad8));
      });
      this.add(stem, false); this.add(cap, false);
      const vines = D('vine');
      const vm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 1, 5).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.9 }), vines.length);
      vines.forEach((d, i) => vm.setMatrixAt(i, mat4(d.x, d.y, d.z, 1, d.s, 1, (R() - 0.5) * 0.2, 0, (R() - 0.5) * 0.2)));
      this.add(vm, false);
      // Fireflies drifting around the trunk.
      const ff = D('firefly');
      const fm2 = new THREE.MeshBasicMaterial({ color: HDR(0xd8ff7a, 3) });
      const fi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), fm2, ff.length);
      ff.forEach((d, i) => fi.setMatrixAt(i, mat4(d.x, d.y, d.z, 1, 1, 1)));
      fi.frustumCulled = false;
      this.fireGroup = new THREE.Group();
      this.fireGroup.add(fi);
      this.root.add(this.fireGroup);
      this.anim.push(this.fireGroup);
      this.blink.push({ m: fm2, base: 3, hex: 0xd8ff7a, sp: 2.3 });
    }
  }

  // Grapple hooks: a glowing ring hanging under a short metal stub.
  buildHooks() {
    const glow = new THREE.MeshBasicMaterial({ color: HDR(0x7ff8ff, 2.6) });
    const metal = panelMat(0x5a6070, { metalness: 0.8, roughness: 0.3, pattern: 0 });
    const stub = new THREE.CylinderGeometry(0.18, 0.18, 1.2, 10), ring = new THREE.TorusGeometry(0.42, 0.07, 8, 28);
    const halo = new THREE.RingGeometry(0.75, 0.85, 32);
    for (const a of this.level.anchors) {
      const s = this.add(new THREE.Mesh(stub, metal));
      s.position.set(a.x, a.y + 0.9, a.z);
      const r = new THREE.Mesh(ring, glow);
      r.position.set(a.x, a.y, a.z);
      this.add(r, false);
      const h = new THREE.Mesh(halo, new THREE.MeshBasicMaterial({ color: HDR(0x7ff8ff, 1.6), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      h.position.set(a.x, a.y, a.z);
      this.add(h, false);
      this.spin.push({ o: r, axis: 'y', sp: 1.8 });
      this.spin.push({ o: h, axis: 'y', sp: -1.2 });
    }
  }

  // Doors: a sliding panel per door and a bullseye target that turns green when shot.
  buildDoors() {
    this.doors = [];
    const key = this.key;
    const panelM = panelMat(key === 'storm' ? 0x3a3f4c : 0x7a5434, { metalness: key === 'storm' ? 0.7 : 0.05, roughness: key === 'storm' ? 0.35 : 0.8, pattern: key === 'storm' ? 1 : 3 });
    const bull = canvasTex(128, 128, (g) => {
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e8322e'; g.beginPath(); g.arc(64, 64, 62 - i * 12.5, 0, TAU); g.fill(); }
    });
    const disc = new THREE.CylinderGeometry(0.62, 0.62, 0.08, 32).rotateX(Math.PI / 2);
    for (const d of this.level.doors) {
      const c = d.col, m = new THREE.Mesh(BOXG, panelM);
      m.scale.set(c.hx * 2, c.hy * 2, c.hz * 2);
      m.position.set(c.x, c.y, c.z);
      m.rotation.set(c.rx, c.ry, c.rz, 'YXZ');
      this.add(m);
      const lightMat = new THREE.MeshBasicMaterial({ color: HDR(0xff3b30, 2.4) });
      lightMat.userData.live = true;
      const light = new THREE.Mesh(BOXG, lightMat);
      light.scale.set(c.hx * 2 + 0.04, 0.12, c.hz * 1.4);
      light.position.set(0, 1.1 / (c.hy * 2), 0);
      light.scale.divide(m.scale);
      m.add(light);
      const tMat = new THREE.MeshBasicMaterial({ map: bull, color: HDR(0xffffff, 1.4) });
      tMat.userData.live = true;
      const t = new THREE.Mesh(disc, tMat);
      t.position.set(d.bx, d.by, d.bz);
      t.lookAt(d.bx + d.fx - (d.bx - d.x) * 0.3, d.by, d.bz + d.fz - (d.bz - d.z) * 0.3);
      this.add(t, false);
      this.anim.push(m);
      this.doors.push({ d, m, y0: c.y, lightMat, tMat, open: false, k: 0 });
    }
  }

  resetDoors() {
    for (const e of this.doors) {
      e.open = false;
      e.k = 0;
      e.m.position.y = e.y0;
      e.lightMat.color.copy(HDR(0xff3b30, 2.4));
      e.tMat.color.copy(HDR(0xffffff, 1.4));
    }
  }

  openDoor(i) {
    const e = this.doors && this.doors[i];
    if (!e || e.open) return;
    e.open = true;
    e.lightMat.color.copy(HDR(0x3cff7a, 2.4));
    e.tMat.color.copy(HDR(0x9cffb0, 1.6));
  }

  // Forest creatures: one merged mesh each (body plus glowing eyes and mouth) to keep draw calls low.
  buildCreatures() {
    const L = this.level;
    this.monsters = [];
    this.bats = [];
    if (!L.monsters.length && !L.bats.length) return;
    const eye = HDR(0xfff36a, 4), mouth = HDR(0xff5a3c, 3);
    const mg = merge([
      { geo: new THREE.SphereGeometry(0.7, 20, 14).scale(1, 0.85, 1), m: mat4(0, 0, 0, 1, 1, 1), glow: null },
      { geo: new THREE.ConeGeometry(0.16, 0.5, 8), m: mat4(-0.34, 0.66, 0.1, 1, 1, 1, 0, 0, 0.4), glow: HDR(0xff7ad8, 0.6) },
      { geo: new THREE.ConeGeometry(0.16, 0.5, 8), m: mat4(0.34, 0.66, 0.1, 1, 1, 1, 0, 0, -0.4), glow: HDR(0xff7ad8, 0.6) },
      { geo: new THREE.SphereGeometry(0.17, 12, 8), m: mat4(-0.24, 0.2, 0.56, 1, 1, 1), glow: eye },
      { geo: new THREE.SphereGeometry(0.17, 12, 8), m: mat4(0.24, 0.2, 0.56, 1, 1, 1), glow: eye },
      { geo: new THREE.BoxGeometry(0.5, 0.1, 0.12), m: mat4(0, -0.16, 0.62, 1, 1, 1), glow: mouth },
      { geo: new THREE.SphereGeometry(0.16, 8, 6), m: mat4(-0.35, -0.5, 0.1, 1, 0.6, 1.3), glow: null },
      { geo: new THREE.SphereGeometry(0.16, 8, 6), m: mat4(0.35, -0.5, 0.1, 1, 0.6, 1.3), glow: null },
    ]);
    const mm = panelMat(0x8a3ab0, { roughness: 0.5, metalness: 0.05, pattern: 0, emissive: 0x2a0a3a, emissiveIntensity: 1 });
    for (const m of L.monsters) {
      const o = this.add(new THREE.Mesh(mg, mm));
      this.anim.push(o);
      this.monsters.push({ m, o, p: {} });
    }
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.15, 0.75, 0.1, -0.05, 0.55, 0, 0.25, 0, 0, -0.15, 0.55, 0, 0.25, 0, 0, 0.2], 3));
    wing.computeVertexNormals();
    const bg = merge([
      { geo: new THREE.SphereGeometry(0.22, 12, 8), m: mat4(0, 0, 0, 1, 1, 1.2), glow: null },
      { geo: wing, m: mat4(0.12, 0, 0, 1, 1, 1), glow: null },
      { geo: wing, m: mat4(-0.12, 0, 0, -1, 1, 1), glow: null },
      { geo: new THREE.SphereGeometry(0.05, 6, 4), m: mat4(-0.08, 0.06, 0.24, 1, 1, 1), glow: HDR(0xff2a2a, 3) },
      { geo: new THREE.SphereGeometry(0.05, 6, 4), m: mat4(0.08, 0.06, 0.24, 1, 1, 1), glow: HDR(0xff2a2a, 3) },
    ]);
    const bmat = panelMat(0x2a2230, { roughness: 0.6, metalness: 0.1, pattern: 0, side: THREE.DoubleSide });
    for (const b of L.bats) {
      const o = this.add(new THREE.Mesh(bg, bmat));
      o.scale.setScalar(1.5);
      this.anim.push(o);
      this.bats.push({ b, o, p: {} });
    }
  }

  buildDistant() {
    if (this.key !== 'storm') return this.buildDistantAlt();
    const R = rng(4242), n = 18;
    const sp = new THREE.InstancedMesh(BOXG, new THREE.MeshStandardMaterial({ color: 0x0c121c, roughness: 0.9 }), n);
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: HDR(0xff3040, 3), fog: false }), n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R() * 0.3, r = 130 + R() * 160, h = 120 + R() * 420, w = 8 + R() * 18;
      sp.setMatrixAt(i, mat4(Math.cos(a) * r, h / 2 - 10, Math.sin(a) * r, w, h, w * (0.6 + R() * 0.8), 0, R() * 3, 0));
      lights.setMatrixAt(i, mat4(Math.cos(a) * r, h - 9, Math.sin(a) * r, 1, 1, 1));
    }
    this.root.add(sp, lights);
    this.blink.push({ m: lights.material, base: 3, hex: 0xff3040, sp: 1.6, sq: true });
  }

  // Lasers (spinning bars and on/off curtains), arrow traps and the ropes of swinging platforms.
  buildHazards() {
    const L = this.level, col = { storm: 0xff2448, sunny: 0xff7a1a, forest: 0xff4a3a }[this.key];
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
    const emitter = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.8, emissive: col, emissiveIntensity: 0.5 });
    const capGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.22, 16);
    for (const l of L.lasers) {
      const g = new THREE.Group();
      g.position.set(l.x, l.y, l.z);
      const mat = new THREE.MeshBasicMaterial({ color: HDR(col, 3) });
      if (l.k === 'spin') {
        const cap = new THREE.Mesh(capGeo, emitter);
        cap.position.y = 0.1;
        g.add(cap);
        for (let k = 0; k < (l.n || 1); k++) {
          const b = new THREE.Mesh(beamGeo, mat);
          b.scale.set(l.len, 1, 1);
          b.rotation.y = (k * TAU) / (l.n || 1);
          g.add(b);
        }
      } else {
        mat.transparent = true;
        mat.depthWrite = false;
        mat.userData.live = true;
        g.rotation.y = Math.atan2(-l.ux, -l.uz); // local +x runs across the bridge
        for (const h of [0.35, 1.1, 1.85]) {
          const b = new THREE.Mesh(beamGeo, mat);
          b.scale.set(2.0, 1, 1);
          b.position.set(-1.0, h, 0);
          g.add(b);
        }
      }
      this.root.add(g);
      this.anim.push(g);
      this.lasers.push({ l, g, mat, col });
    }
    // Arrow traps: an instanced launcher body and glowing muzzle each, plus one pooled arrow per trap.
    const A = L.arrows;
    if (A.length) {
      const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.42, 0.55), panelMat(this.key === 'storm' ? 0x3a3e4a : 0x6a4a30, { pattern: this.key === 'storm' ? 1 : 3 }), A.length);
      const muzzle = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: HDR(0xffb040, 2.5) }), A.length);
      const arrowGeo = merge([
        { geo: new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6).rotateX(Math.PI / 2), m: mat4(0, 0, 0, 1, 1, 1), glow: null },
        { geo: new THREE.ConeGeometry(0.06, 0.18, 8).rotateX(Math.PI / 2), m: mat4(0, 0, 0.52, 1, 1, 1), glow: HDR(0xffd070, 1.2) },
        { geo: new THREE.BoxGeometry(0.16, 0.01, 0.16), m: mat4(0, 0, -0.42, 1, 1, 1, 0, Math.PI / 4, 0), glow: null },
        { geo: new THREE.BoxGeometry(0.01, 0.16, 0.16), m: mat4(0, 0, -0.42, 1, 1, 1, 0, Math.PI / 4, 0), glow: null },
      ]);
      const arrowMat = panelMat(0x8a6a44, { pattern: 0, roughness: 0.6 });
      A.forEach((a, i) => {
        const ry = Math.atan2(a.dx, a.dz);
        body.setMatrixAt(i, mat4(a.x, a.y, a.z, 1, 1, 1, 0, ry, 0));
        muzzle.setMatrixAt(i, mat4(a.x + a.dx * 0.28, a.y, a.z + a.dz * 0.28, 1, 1, 1, 0, ry, 0));
        const m = new THREE.Mesh(arrowGeo, arrowMat);
        m.rotation.y = ry;
        m.visible = false;
        this.root.add(m);
        this.anim.push(m);
        this.arrowFx.push({ a, m, p: {} });
      });
      this.add(body);
      this.add(muzzle, false);
    }
    // Swings: a crossbar at the pivot and two ropes down to the deck, redrawn as it swings.
    const ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: this.key === 'storm' ? 0x5a6070 : 0x8a7050, roughness: 0.8, metalness: this.key === 'storm' ? 0.7 : 0 });
    const barMat = panelMat(this.key === 'storm' ? 0x3a3f4c : 0x6a4a2c, { pattern: this.key === 'storm' ? 1 : 3 });
    for (const sw of L.swings) {
      const d = sw.col.dyn, nx = -d.uz, nz = d.ux;
      const bar = new THREE.Mesh(BOXG, barMat);
      bar.scale.set(2.8, 0.22, 0.22);
      bar.position.set(d.px, d.py + 0.1, d.pz);
      bar.rotation.y = Math.atan2(-nz, nx);
      this.add(bar);
      const ropes = [-1, 1].map((s2) => {
        const r = new THREE.Mesh(ropeGeo, ropeMat);
        this.root.add(r);
        this.anim.push(r);
        return { r, s: s2 };
      });
      this.swingFx.push({ sw, d, nx, nz, ropes });
    }
  }

  // Forest side trees: a bark trunk (same look as the giant tree) with a leafy crown on top.
  buildSideTrees() {
    const T = this.level.trees;
    if (!T.length) return;
    const R = rng(91);
    const bark = this.barkMat || new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a30, roughness: 0.85, flatShading: true });
    const blob = new THREE.IcosahedronGeometry(1, 1);
    for (const t of T) {
      const h = t.top + 2, trunk = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r * 1.35, h, 28, 1, true), bark);
      trunk.position.set(t.x, h / 2 - 2, t.z);
      this.add(trunk);
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(blob, leaf), a = R() * TAU, rr2 = i ? 2.5 + R() * 2.5 : 0;
        c.position.set(t.x + Math.cos(a) * rr2, t.top + 2.5 + R() * 2.5, t.z + Math.sin(a) * rr2);
        c.scale.set(3.4 + R() * 1.6, 2.2 + R(), 3.4 + R() * 1.6);
        this.add(c);
      }
    }
  }

  // Sunny: far-off green islands. Forest: rolling hills of trees on the horizon.
  buildDistantAlt() {
    const R = rng(4243), sunny = this.key === 'sunny', n = sunny ? 9 : 26;
    const geo = sunny ? new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2) : new THREE.ConeGeometry(1, 1, 10);
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: sunny ? 0x4f8a48 : 0x2c4a2a, roughness: 1, flatShading: !sunny }), n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R() * 0.4, r = sunny ? 260 + R() * 220 : 170 + R() * 160, w = sunny ? 30 + R() * 50 : 25 + R() * 40;
      m.setMatrixAt(i, sunny ? mat4(Math.cos(a) * r, -2, Math.sin(a) * r, w, 8 + R() * 22, w * (0.5 + R() * 0.6), 0, R() * 3, 0)
        : mat4(Math.cos(a) * r, (25 + R() * 60) / 2 - 2, Math.sin(a) * r, w, 25 + R() * 60, w, 0, R() * 3, 0));
    }
    this.root.add(m);
  }

  // Animate everything that moves. t is shared game time, warn(r) returns rod warning 0..1.
  update(t, dt, storm) {
    for (const d of this.dyn) {
      const c = d.c, m = d.mesh;
      m.position.set(c.x, c.y, c.z);
      m.rotation.set(c.rx, c.ry, c.rz, 'YXZ');
      if (c.crumble) {
        const s = c.crumble.st;
        if (s === 1) m.position.x += (Math.random() - 0.5) * 0.08, m.position.z += (Math.random() - 0.5) * 0.08;
        if (s === 2) { d.fall += dt; m.position.y -= d.fall * d.fall * 9; m.visible = d.fall < 1.4; }
        else { d.fall = 0; m.visible = true; }
      }
    }
    for (const c of this.pads) {
      const k = 1 + 0.12 * Math.sin(t * 6);
      c.fx.scale.set(k, 1, k);
    }
    for (const e of this.cps) { e.halo.rotation.y = t * 1.5; e.halo.rotation.x = Math.sin(t) * 0.4; e.beam.material.uniforms.uT.value = t; }
    for (const r of this.rods) {
      const w = storm.rodWarn(r.r, t);
      r.warnMat.opacity = w * (0.55 + 0.45 * Math.sin(t * 30));
      r.tipMat.color.setHex(0xb9a6ff).multiplyScalar(2 + w * 6);
      r.tip.scale.setScalar(1 + w * 0.8);
    }
    for (const f of this.fans) {
      const on = storm.fanOn(f.f, t);
      f.spin += dt * (on ? 28 : 2.5);
      f.rotor.rotation.z = f.spin;
      f.sm.uniforms.uT.value = t;
      f.sm.uniforms.uOn.value += ((on ? 1 : 0) - f.sm.uniforms.uOn.value) * Math.min(1, dt * 8);
    }
    for (const s of this.spin) s.o.rotation[s.axis] += s.sp * dt;
    for (const b of this.blink) {
      const k = b.sq ? (Math.sin(t * b.sp) > 0.6 ? 1 : 0.15) : 0.7 + 0.3 * Math.sin(t * b.sp);
      b.m.color.setHex(b.hex).multiplyScalar(b.base * k);
    }
    const rd = this.rockData;
    for (let i = 0; i < rd.length; i++) {
      const d = rd[i];
      this.rocks.setMatrixAt(i, mat4(d.x, d.y + Math.sin(t * 0.3 + i) * 1.5, d.z, d.s, d.s * 0.8, d.s, d.rx + t * d.sp, d.ry + t * d.sp * 0.7, 0));
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    this.beam.material.uniforms.uT.value = t;
    this.summitOrb.scale.setScalar(1 + 0.1 * Math.sin(t * 2));
    if (this.foam) this.foam.material.opacity = 0.4 + 0.2 * Math.sin(t * 1.3);
    if (this.cloudGroup) this.cloudGroup.rotation.y = t * 0.012;
    if (this.fireGroup) { this.fireGroup.rotation.y = t * 0.05; this.fireGroup.position.y = Math.sin(t * 0.7) * 0.8; }
    if (this.gulls) for (const e of this.gulls) {
      e.pivot.rotation.y = e.d.ph + t * e.d.sp;
      e.g.position.y = Math.sin(t * 0.8 + e.d.ph) * 1.5;
      e.g.rotation.z = Math.sin(t * 1.1 + e.d.ph) * 0.25;
      e.g.scale.x = 1.6 * (0.85 + 0.15 * Math.sin(t * 7 + e.d.ph));
    }
    for (const e of this.doors) {
      if (!e.open || e.k >= 1) continue;
      e.k = Math.min(1, e.k + dt * 0.9);
      const f = e.k * e.k * (3 - 2 * e.k);
      e.m.position.y = e.y0 - f * (e.d.col.hy * 2 + 0.1);
    }
    // Creatures and traps near the camera only (far ones are hidden: cheaper on every phone).
    const cam = this.camPos;
    const near = (y) => !cam || Math.abs(y - cam.y) < 45;
    for (const e of this.lasers) {
      const l = e.l, vis = near(l.y);
      if (l.k === 'spin') {
        e.g.visible = vis;
        if (vis) e.g.rotation.y = storm.laserAngle(l, t);
      } else {
        const st = storm.gate(l, t), show = vis && (st.on || st.warn > 0);
        e.g.visible = show;
        if (show) {
          const k = st.on ? 1 : (Math.sin(t * 60) > 0 ? 0.5 : 0.1) * st.warn;
          e.mat.color.setHex(e.col).multiplyScalar(3 * k);
          e.mat.opacity = st.on ? 1 : 0.6;
        }
      }
    }
    for (const e of this.arrowFx) {
      const a = e.a;
      if (!near(a.y)) { e.m.visible = false; continue; }
      const p = storm.arrow(a, t, e.p);
      e.m.visible = p.fly;
      if (p.fly) e.m.position.set(p.x, p.y, p.z);
    }
    for (const e of this.swingFx) {
      const d = e.d, c = e.sw.col;
      for (const r of e.ropes) {
        const ax = d.px + e.nx * r.s * 1.0, az = d.pz + e.nz * r.s * 1.0, bx = c.x + e.nx * r.s * 1.0, bz = c.z + e.nz * r.s * 1.0;
        stretchTo(r.r, ax, d.py, az, bx, c.y + 0.25, bz);
      }
    }
    for (const e of this.monsters) {
      const m = e.m, near = !cam || Math.abs(m.y - cam.y) < 45;
      e.o.visible = near;
      if (!near) continue;
      const p = storm.monsterPos(m, t, e.p), o = e.o;
      o.position.set(p.x, p.y, p.z);
      const dx = (m.bx - m.ax) * p.dir, dz = (m.bz - m.az) * p.dir;
      o.rotation.set(0, Math.atan2(dx, dz), p.stunned ? Math.sin(t * 25) * 0.3 : 0, 'YXZ');
      const sq = p.stunned ? 0.6 : 1 + 0.08 * Math.sin(t * 9 + m.i);
      o.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
    for (const e of this.bats) {
      const b = e.b, near = !cam || Math.abs(b.cy - cam.y) < 45;
      e.o.visible = near;
      if (!near) continue;
      const p = storm.batPos(b, t, e.p), o = e.o;
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.stunned ? 0.9 : 0, -p.a + (b.per > 0 ? 0 : Math.PI), p.stunned ? t * 12 : 0, 'YXZ');
      const fl = p.stunned ? 0.5 : 1 + 0.45 * Math.sin(t * 22 + b.i);
      o.scale.set(1.5 * fl, 1.5, 1.5);
    }
  }
}
