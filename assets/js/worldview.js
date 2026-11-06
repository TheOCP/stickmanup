// Turns level data into meshes. Static pieces are instanced, moving pieces get one merged mesh each
// (body + glowing edge trim) so the phone draws the whole tower in few draw calls.
import * as THREE from 'three';
import { BOX } from './physics.js';
import { CORE_R, coreFlare, cpEnabled, secretOn, dvOn, MAZE_BODY } from './level.js';
import { tr } from './i18n.js';
import { TAU, rng, clamp } from './util.js';
import { PATTERN_GLSL, noiseGlsl } from './pattern.js';
import { styleFor, shapeGeo, patMat, noTrim, buildScenery, buildAnimals, fallMat, buildMist, detail, vegMat, beastRig, modelGeo, mergeGeos } from './scenery.js';
import { buildWildForest, buildWildlands } from './wildview.js';
import { stormLands, sunnyLands, calderaLands, cityLands, fallLands } from './backdrop.js';
import { buildMazes, showMaze, MAZE_BEAST } from './mazeview.js';
import { buildVolcanoView } from './volcanoview.js';
import { courseStones, courseDecor, courseGate, courseSweep, postMat, signTex, COMET_HEAD, WELL_HEAD, headMesh } from './courseview.js';
import { buildStart, updateStart } from './startview.js';
import { barkTex, rockTex as rockTexture, facadeTex, cityFacade, lighthouseTex, steelTex, stormTex, buildCoreDetail } from './coreview.js';

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

let SIMPLE = false, PATTERN = 1;
// Graphics level 3+: plain Lambert materials instead of the custom panel shader.
export function setSimple(v) {
  SIMPLE = v;
}
// A phone short of CPU time: the small animations run every second frame.
let THIN = false;
export function setThin(v) { THIN = v; }

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

// City skyscrapers (solid out to level.js TOWER_R, 5.9 m): the shape of each kind across, at height y, as [x, z] round
// its middle going the way the angle grows. Corners are listed twice so their edges stay sharp. rot turns it.
function towerLoop(kind, rot) {
  const poly = (n, r, a0) => () => { const out = []; for (let k = 0; k < n; k++) { const a = a0 + (k / n) * TAU, p = [Math.cos(a) * r, Math.sin(a) * r]; out.push(p, p.slice()); } return out; };
  if (kind === 'neon') return poly(8, 6.15, rot + Math.PI / 8);
  if (kind === 'deco') return poly(12, 6.0, rot);
  if (kind === 'grid') {
    // A square with big rounded corners.
    const h = 5.45, rc = 3.4, c = h - rc, out = [];
    for (let q = 0; q < 4; q++) {
      const cx = q === 0 || q === 3 ? c : -c, cz = q < 2 ? c : -c;
      for (let k = 0; k <= 6; k++) {
        const a = (q + k / 6) * (Math.PI / 2), x = cx + Math.cos(a) * rc, z = cz + Math.sin(a) * rc;
        out.push([x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
      }
    }
    return () => out;
  }
  if (kind === 'tech') {
    // An ellipse turning once every 320 m as it goes up.
    return (y) => {
      const ph = rot + (y / 320) * TAU, out = [];
      for (let k = 0; k < 48; k++) { const a = (k / 48) * TAU, x = Math.cos(a) * 6.25, z = Math.sin(a) * 5.55; out.push([x * Math.cos(ph) - z * Math.sin(ph), x * Math.sin(ph) + z * Math.cos(ph)]); }
      return out;
    };
  }
  const circle = Array.from({ length: 64 }, (_, k) => [Math.cos((k / 64) * TAU) * 5.9, Math.sin((k / 64) * TAU) * 5.9]);
  return () => circle;
}
// The wall of a skyscraper from y0 to y1 in rows: across, a whole number of texture tiles about tileW wide each; up,
// a tile every tileH.
function towerWall(loopAt, y0, y1, rows, tileW, tileH) {
  const pos = [], uv = [], idx = [];
  let N = 0, nT = 1;
  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows, loop = loopAt(y), len = [0];
    for (let i = 1; i <= loop.length; i++) { const a = loop[i - 1], b = loop[i % loop.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    if (!j) { N = loop.length; nT = Math.max(1, Math.round(len[N] / tileW)); }
    for (let i = 0; i <= N; i++) { const p = loop[i % N]; pos.push(p[0], y, p[1]); uv.push((len[i] / len[N]) * nT, y / tileH); }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + N + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
// A band round a loop at height y: out metres out from the wall, h tall (its outside, top and underside).
function bandAt(list, loop, y, out, h) {
  const n = loop.length, P = (p, k) => { const r = Math.hypot(p[0], p[1]) || 1; return [p[0] * (1 + k / r), p[1] * (1 + k / r)]; };
  const quad = (p, q, r, u) => list.push(p, r, q, p, u, r);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const ao = P(a, out), bo = P(b, out), ai = P(a, -0.05), bi = P(b, -0.05), y2 = y + h;
    quad([ao[0], y, ao[1]], [bo[0], y, bo[1]], [bo[0], y2, bo[1]], [ao[0], y2, ao[1]]);
    quad([ao[0], y2, ao[1]], [bo[0], y2, bo[1]], [bi[0], y2, bi[1]], [ai[0], y2, ai[1]]);
    quad([ai[0], y, ai[1]], [bi[0], y, bi[1]], [bo[0], y, bo[1]], [ao[0], y, ao[1]]);
    quad([bi[0], y, bi[1]], [ai[0], y, ai[1]], [ai[0], y2, ai[1]], [bi[0], y2, bi[1]]);
  }
}
// How far from the middle a loop reaches going out the way (nx, nz).
function rayLoop(loop, nx, nz) {
  let best = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], den = nx * ez - nz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = (a[0] * nz - a[1] * nx) / den, t = (a[0] * ez - a[1] * ex) / den;
    if (s >= -1e-6 && s <= 1 + 1e-6 && t > best) best = t;
  }
  return best;
}
function bandGeo(list) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
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

// A creature's limbs at this point of its stride (walk, in radians; faster when it hunts): legs swing, a beetle's or a crab's
// legs sweep round, wings beat, a tail sways, a jaw drops and claws snap while it comes for you. Still when stunned.
function poseLimbs(limbs, walk, hunt, stunned, t) {
  const k = hunt ? 1.35 : 1;
  for (const { o, l } of limbs) {
    const s = stunned ? 0 : Math.sin(walk + l.ph), a = l.amp * k;
    switch (l.move) {
      case 'leg': o.rotation.x = s * a; break;
      case 'side': o.rotation.y = s * a; o.position.y = l.at[1] + (stunned ? 0 : Math.max(0, Math.cos(walk + l.ph)) * 0.025); break;
      case 'arm': o.rotation.x = -s * a; break;
      case 'wing': o.rotation.z = l.side * (stunned ? -0.6 : 0.15 + 0.55 * Math.sin(t * (hunt ? 16 : 9) + l.ph)); break;
      case 'tail': o.rotation.y = stunned ? 0 : Math.sin(walk * 0.5 + l.ph) * a; break;
      case 'jaw': o.rotation.x = stunned ? 0.5 : hunt ? 0.2 + 0.25 * Math.max(0, Math.sin(walk * 0.7)) : 0.03; break;
      case 'claw': o.rotation.y = l.side * (stunned ? 0.4 : 0.1 + (hunt ? 0.3 : 0.1) * (0.5 + 0.5 * Math.sin(walk * 1.3 + l.ph))); break;
    }
  }
}

export class WorldView {
  // slow: built a little each frame by buildSlowly, and only put in the scene once done (main.js loadMapSoon).
  constructor(scene, level, slow = false) {
    this.scene = scene;
    this.level = level;
    this.root = new THREE.Group();
    if (!slow) scene.add(this.root);
    this.dyn = [];
    this.cps = [];
    this.rods = [];
    this.timeMats = []; // shader materials whose uT follows game time (scenery.js)
    this.onFrame = []; // called every update with (t, dt): wildview.js keeps its own lights in step with the scene's
    this.bands = new Map(); // height bands: see band()
    this.islandFalls = [];
    this.mistSpots = [];
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
    this.geyserFx = [];
    this.waters = [];
    this.fishFx = [];
    this.obsFx = [];
    this.looks = new Map();
    this.rockFx = [];
    this.convFx = null;
    this.camPos = null;
    this.key = level.mapKey;
    PATTERN = level.pattern;
    // Neon at night, painted trims by day, soft glow in the forest.
    this.glowK = { storm: 2.4, sunny: 1.05, forest: 1.15, volcano: 1.8, city: 2.2, waterfall: 1.05 }[this.key];
    this.zoneMats = level.zones.map((z) => panelMat(z.tint));
    this.iceMat = panelMat(0xa8d8ee, { roughness: 0.18, metalness: 0.1 });
    this.crumbleMat = panelMat(0x7a4a44);
    this.steps = [
      () => this.buildStatic(),
      () => this.buildDynamic(),
      () => this.buildRings(),
      () => this.buildCore(),
      () => this.buildSummit(),
      () => this.buildCheckpoints(),
      () => this.buildRods(),
      () => this.buildFans(),
      () => this.buildDecor(),
      () => this.buildDistant(),
      () => this.buildIsland(),
      () => this.buildMapDecor(),
      () => this.buildHooks(),
      () => this.buildDoors(),
      () => this.buildCreatures(),
      () => this.buildHazards(),
      () => this.buildSideTrees(),
      () => buildCoreDetail(this),
      () => this.buildVolcano(),
      () => this.buildVentsRocks(),
      () => this.buildCity(),
      () => this.buildObstacles(),
      () => this.buildZips(),
      () => this.buildFlows(),
      () => this.buildKickers(),
      () => this.buildWaterPark(),
      () => buildScenery(this),
      () => this.stormGear(),
      () => buildAnimals(this),
      () => this.buildSmallFalls(),
      () => buildMist(this, this.mistSpots),
      () => this.buildSecrets(),
      () => buildMazes(this),
      () => buildStart(this),
      () => this.freeze(),
    ];
    if (!slow) this.finish();
  }

  // All that is left of the building, now.
  finish() {
    while (this.steps.length) this.steps.shift()();
  }

  // A few build steps a frame, never more than about 8 ms of them unless one step is longer by itself, so a menu keeps
  // moving while a map is made. Says whether it got done: stop() says another map was picked meanwhile.
  async buildSlowly(stop) {
    while (this.steps.length) {
      const t0 = performance.now();
      do this.steps.shift()();
      while (this.steps.length && performance.now() - t0 < 8);
      if (!this.steps.length) break;
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (stop()) return false;
    }
    return true;
  }

  // The maze gardens' inner walls, the way the colliders have them now (game.js setMaze after level.js applyMaze).
  setMaze() {
    showMaze(this);
  }

  dispose() {
    this.scene.remove(this.root);
  }

  // The hidden courses (level.js, buildSecrets): the stones that stay put (the moving ones are in buildDynamic), a vault at the
  // end of each with a ring back to the route, the gate and sign where it leaves the route, and a pillar of light at both ends
  // so a course can be seen from far off. setSecrets shows what this climb has, markRelics takes away the pillars of what is found.
  buildSecrets() {
    const L = this.level, courses = (L.relics || []).filter((r) => r.stones);
    this.secretParts = [];
    this.relicBeams = [];
    this.facing = [];
    this.taken = [];
    if (!courses.length) return;
    const tint = (kind) => (kind === 'epic' ? 0xc070ff : kind === 'weapon' ? 0xffd040 : 0xffa030);
    const stone = postMat(this.key);
    const beam = (r, id, h, rad, a) => {
      const b = this.lightBeam(rad, h, tint(r.kind), a);
      this.root.add(b);
      b.visible = false;
      this.relicBeams.push({ id, o: b });
      return b;
    };
    // A build step for each course: all of them in one held up a map being made behind the menu for a third of a second.
    const one = (r) => {
      const sec = r.kind === 'epic' ? 'open' : 'hard', keep = (o) => { o.visible = false; this.secretParts.push({ sec, o, dv: r.dv }); return o; };
      courseStones(this, r, keep);
      courseDecor(this, r, keep);
      // The vault: four pillars with fire on top, a glowing ring on the floor and a pedestal under the relic.
      const v = r.vault, g = new THREE.Group(), gl = new THREE.MeshBasicMaterial({ color: HDR(tint(r.kind), 3) }), h = v.s / 2 - 0.35;
      g.position.set(v.x, v.y, v.z);
      g.rotation.y = v.ry;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 8), stone);
        p.position.set(a * h, 1.3, b * h);
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), gl);
        cap.position.set(a * h, 2.8, b * h);
        g.add(p, cap);
      }
      for (const b of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(v.s - 0.4, 0.16, 0.16), stone);
        bar.position.set(0, 2.62, b * h);
        g.add(bar);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.05, 6, 40), gl);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.42, 10), stone);
      ped.position.y = 0.21;
      g.add(ring, ped);
      // The way back: a ring on the floor with a curtain of light, and a board saying what it is.
      const wayBack = (parent, lx, ry, wx, wz) => {
        const out = new THREE.Group(), outM = new THREE.MeshBasicMaterial({ color: HDR(0x7ff8d8, 3) });
        out.position.set(lx, 0, 0);
        const oRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 32), outM);
        oRing.rotation.x = Math.PI / 2;
        oRing.position.y = 0.05;
        const curtain = this.lightBeam(0.62, 2.2, 0x7ff8d8, 0.55);
        curtain.position.y = 1.1;
        this.relicBeams.push({ o: curtain, part: true });
        const label = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: signTex(this.key, 512, 144, 0x7ff8d8, tr('WAY BACK')) }));
        label.position.y = 2.5;
        // It turns to whoever looks at it, so it can be read from anywhere.
        label.userData.anim = true;
        this.facing.push({ o: label, x: wx, z: wz, ry });
        out.add(oRing, curtain, label);
        parent.add(out);
      };
      wayBack(g, v.s / 2 - 0.75, v.ry, v.x + Math.cos(v.ry) * (v.s / 2 - 0.75), v.z - Math.sin(v.ry) * (v.s / 2 - 0.75));
      keep(g);
      this.add(g, false);
      if (r.back) {
        const b = new THREE.Group();
        b.position.set(r.back.x, r.back.y, r.back.z);
        wayBack(b, 0, 0, r.back.x, r.back.z);
        keep(b);
        this.add(b, false);
      }
      beam(r, r.id, 110, 0.5, 0.55).position.set(v.x, v.y + 55, v.z);
      const G = r.gate;
      courseGate(this, r, tint(r.kind), keep);
      beam(r, r.id, 70, 0.3, 0.6).position.set(G.x, G.y + 35, G.z);
      // Built after setSecrets ran (a map finished while a climb was starting): shown the way that climb has them.
      if (this.secNow !== undefined) this.setSecrets(this.secNow);
    };
    if (this.steps && this.steps.length) this.steps.unshift(...courses.map((r) => () => one(r)));
    else for (const r of courses) one(r);
  }

  // sec: which hidden paths this climb has ({ hard, open }, level.js ALL_SECRETS), or nothing for none.
  setSecrets(sec) {
    this.secNow = sec;
    for (const p of this.secretParts || []) p.o.visible = !!sec && !!sec[p.sec] && dvOn(p, sec);
    for (const c of this.level.cols) if (c.kind === 'secret') c.on = secretOn(c, sec);
    for (const d of this.dyn) if (d.c.kind === 'secret') { d.off = !secretOn(d.c, sec); d.mesh.visible = !d.off; }
    this.markRelics(this.relicHas);
  }

  // has(id): is this relic found? Its pillars of light go out.
  markRelics(has) {
    this.relicHas = has;
    const L = this.level, sec = this.secNow;
    for (const b of this.relicBeams || []) {
      if (b.part) continue;
      const r = L.relics.find((q) => q.id === b.id);
      b.o.visible = !!r && !!sec && !!sec[r.kind === 'epic' ? 'open' : 'hard'] && dvOn(r, sec) && !(has && has(b.id));
    }
  }

  // Performance: only animated things recompute transforms each frame, and only animated materials are
  // checked again by the native mirror. Everything else in the tower is frozen.
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

  // Height bands. Instanced meshes span the whole tower, so nothing would ever cull them: detailed platform
  // shapes, plants and flocks are kept per band and only drawn near the camera's height; far bands of
  // platforms show plain boxes instead (far enough away that the difference doesn't show).
  band(y) {
    const i = Math.floor(y / 50);
    if (!this.bands.has(i)) this.bands.set(i, { y0: i * 50, y1: i * 50 + 50, near: [], far: [], on: null });
    return this.bands.get(i);
  }

  updateBands() {
    const cy = this.camPos ? this.camPos.y : 20;
    for (const b of this.bands.values()) {
      const on = Math.max(0, b.y0 - cy, cy - b.y1) < 60;
      if (on === b.on) continue;
      b.on = on;
      for (const o of b.near) o.visible = on;
      for (const o of b.far) o.visible = !on;
    }
  }

  add(o, shadow = true) {
    if (shadow) { o.castShadow = true; o.receiveShadow = true; }
    this.root.add(o);
    return o;
  }

  buildStatic() {
    const L = this.level, R = rng(99);
    // The maze gardens are drawn by mazeview.js.
    // The city's skyscrapers are drawn by buildCity: a second box in the very same place made their windows flicker.
    const boxes = L.cols.filter((c) => c.t === BOX && c.vis !== false && !c.dyn && !c.crumble && !c.blink && !c.trap && c.kind !== 'door' && c.kind !== 'secret' && c.kind !== 'mfloor' && c.kind !== 'mwall' && c.kind !== 'mouter' && c.kind !== 'tower');
    const cyls = L.cols.filter((c) => c.t !== BOX && !c.dyn && (c.kind === 'pillar' || c.kind === 'hub' || c.kind === 'post'));
    const mat = panelMat(0xffffff);
    const col = new THREE.Color();
    const strips = [];
    // Platforms are dressed per map and zone (scenery.js): rocks, basalt columns, planks, clouds, mushrooms...
    // Each shape and surface becomes one instanced mesh.
    const groups = new Map(), SR = rng(1234), far = new Map();
    const group = (shape, pat, y) => {
      const b = y === undefined ? null : Math.floor(y / 50), k = shape + ':' + pat + ':' + b;
      if (!groups.has(k)) groups.set(k, { geo: shape === 'box0' ? BOXG : shapeGeo(shape), mat: pat < 0 ? mat : patMat(pat), list: [], y });
      return groups.get(k).list;
    };
    const farList = (y) => { const b = Math.floor(y / 50); if (!far.has(b)) far.set(b, { y, list: [] }); return far.get(b).list; };
    boxes.forEach((c) => {
      const z = L.zones[c.zone], st = styleFor(this.key, c, c.zone, SR);
      if (st) {
        const k = 0.88 + SR() * 0.24;
        if (st.col === null) col.setHex(z.tint).multiplyScalar(k); else col.setHex(st.col).multiplyScalar(k);
        const cm = colMatrix(c, c.hx * 2, c.hy * 2, c.hz * 2).clone();
        group(st.shape, st.pat, c.y).push([cm, col.getHex()]);
        farList(c.y).push([cm, col.getHex()]);
        if (st.under) group(st.under.shape, st.under.pat, c.y).push([cm, st.under.col]);
        if (!noTrim(this.key, st.shape) && (c.kind === 'plat' || c.kind === 'beam' || c.kind === 'pad' || c.kind === 'branch')) strips.push(c);
        return;
      }
      if (c.kind === 'crate') col.setHex(this.key === 'sunny' ? 0xc9a36b : 0x7a5a3c);
      else if (c.kind === 'branch') col.setHex(0x7a5634);
      else if (c.kind === 'wall') col.setHex(this.key === 'storm' ? 0x2a2f3a : this.key === 'sunny' ? 0xe8e2d4 : 0x4a3a2a);
      else if (c.kind === 'pad') col.setHex(z.color).multiplyScalar(0.5);
      else if (c.look) col.setHex(c.look.c);
      else if (c.surf === 'ice') col.setHex(0xb0dcf0);
      else col.setHex(z.tint);
      col.multiplyScalar(0.85 + R() * 0.3);
      group('box0', -1).push([colMatrix(c, c.hx * 2, c.hy * 2, c.hz * 2).clone(), col.getHex()]);
      if (c.kind === 'plat' || c.kind === 'beam' || c.kind === 'pad' || c.kind === 'branch') strips.push(c);
      if (c.kind === 'pad') this.pads.push(c);
    });
    for (const { geo, mat: gm, list, y } of groups.values()) {
      const im = new THREE.InstancedMesh(geo, gm, list.length);
      list.forEach(([m, hex], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(hex)); });
      this.add(im);
      if (y !== undefined) this.band(y).near.push(im);
    }
    for (const { list, y } of far.values()) {
      const im = new THREE.InstancedMesh(BOXG, mat, list.length);
      list.forEach(([m, hex], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(hex)); });
      this.add(im);
      this.band(y).far.push(im);
    }

    // The glowing edges are thousands of little boxes. On the simple scenery they are only drawn near the camera's height.
    const low = detail() === 0, stripGlow = new THREE.MeshBasicMaterial({ color: HDR(0xffffff, this.glowK) }), stripSets = new Map();
    for (const c of strips) {
      const b = low ? Math.floor(c.y / 50) : 0;
      if (!stripSets.has(b)) stripSets.set(b, []);
      stripSets.get(b).push(c);
    }
    const base = new THREE.Matrix4();
    for (const list of stripSets.values()) {
      const sm = new THREE.InstancedMesh(BOXG, stripGlow, list.length * 4);
      let k = 0;
      for (const c of list) {
        base.copy(colMatrix(c));
        // Storm: amber safety lights on the edges, not the zone's neon.
        const glowCol = new THREE.Color(this.key === 'storm' ? 0xffa83a : L.zones[c.zone].color);
        if (this.key === 'storm') glowCol.multiplyScalar(0.55);
        for (const p of trimParts(c.hx, c.hy, c.hz, null, c.kind !== 'beam')) {
          sm.setMatrixAt(k, _m2.multiplyMatrices(base, p.m));
          sm.setColorAt(k++, glowCol);
        }
      }
      sm.count = k;
      this.add(sm, false);
      if (low) this.band(list[0].y).near.push(sm);
    }

    // Pillars and the thin ring on top of each: there are over a hundred of them, so their corners add up.
    const cg = new THREE.CylinderGeometry(1, 1, 1, low ? 12 : 28);
    const cm = new THREE.InstancedMesh(cg, mat, cyls.length);
    const rg = new THREE.TorusGeometry(1, 0.035, low ? 3 : 4, low ? 16 : 28).rotateX(Math.PI / 2);
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
      if (!c.dyn && !c.crumble && !c.blink && !c.trap && !c.ghost) continue;
      const z = L.zones[c.zone];
      const glow = c.crumble ? HDR(0xff5a2a, 2.2) : c.look ? HDR(c.look.g, this.glowK) : HDR(z.color, this.glowK);
      const st = !c.crumble && !c.look && c.kind !== 'turn' ? styleFor(this.key, Object.assign({}, c, { kind: 'plat' }), c.zone, rng(c.x * 7 + c.z * 13)) : null;
      // Moving platforms are one mesh each, so they keep a cheap shape (the surface and colour still match).
      const cheap = st && /^(rock|isle|cloud|basalt|mushcap|lily|disc)/.test(st.shape) ? 'chamfer' : st && st.shape;
      const parts = [{ geo: st ? shapeGeo(cheap) : BOXG, m: mat4(0, 0, 0, c.hx * 2, c.hy * 2, c.hz * 2), glow: null }].concat(trimParts(c.hx, c.hy, c.hz, glow, true));
      let mat = c.crumble ? this.crumbleMat : c.look ? this.lookMat(c.look) : st ? patMat(st.pat, st.col === null ? z.tint : st.col) : c.surf === 'ice' ? this.iceMat : this.zoneMats[c.zone];
      // Blinking platforms fade in and out, so each gets its own see-through material.
      if (c.blink || c.ghost) {
        const from = mat;
        mat = from.clone();
        mat.onBeforeCompile = from.onBeforeCompile;
        mat.customProgramCacheKey = from.customProgramCacheKey;
        mat.transparent = true;
        mat.userData.live = true;
      }
      if (c.kind === 'car') { this.dyn.push(this.flyingCar(c)); continue; }
      const mesh = this.add(new THREE.Mesh(merge(parts), mat)), off = c.kind === 'secret';
      if (off) mesh.visible = false;
      this.dyn.push({ c, mesh, fall: 0, off });
    }
  }

  // City: a flying car you ride on the roof of (the roof is the collider's top). Glass all round under the roof, a
  // longer body below with its nose and tail out past the roof, hover pods with light under them, head and tail
  // lights. It turns round to face the way it is going (the body inside does; the collider stays as it is).
  flyingCar(c) {
    const R = rng(c.x * 3 + c.z * 5), hx = c.hx, hz = c.hz, top = c.hy;
    const paint = [0xc83030, 0xeeeae2, 0x3a3e46, 0xd8b020, 0x2a6ae8, 0x8a8e96][(R() * 6) | 0];
    const neon = [0x3fd0ff, 0xff4fd8, 0x7cff6a, 0xffb43d][(R() * 4) | 0];
    const G = (hex, k) => HDR(hex, k), CH = shapeGeo('chamfer'), CY = new THREE.CylinderGeometry(1, 1, 1, 14);
    const parts = [
      { geo: CH, m: mat4(0, top - 0.05, 0, hx * 2, 0.1, hz * 2), glow: null },
      { geo: BOXG, m: mat4(0, top - 0.28, 0, hx * 2 - 0.2, 0.36, hz * 2 - 0.14), glow: new THREE.Color(0x0e2a3c) },
      { geo: BOXG, m: mat4(0, top - 0.28, 0, 0.08, 0.36, hz * 2 - 0.1), glow: null },
      { geo: CH, m: mat4(0, top - 0.78, 0, hx * 2 + 1.5, 0.64, hz * 2 + 0.24), glow: null },
      { geo: CH, m: mat4(hx + 0.55, top - 0.55, 0, 0.9, 0.22, hz * 2 - 0.3), glow: null },
      { geo: BOXG, m: mat4(hx + 0.76, top - 0.74, hz * 0.62, 0.06, 0.13, 0.5), glow: G(0xffffff, 3) },
      { geo: BOXG, m: mat4(hx + 0.76, top - 0.74, -hz * 0.62, 0.06, 0.13, 0.5), glow: G(0xffffff, 3) },
      { geo: BOXG, m: mat4(-hx - 0.76, top - 0.7, 0, 0.05, 0.09, hz * 2 - 0.2), glow: G(0xff2030, 2.6) },
      { geo: BOXG, m: mat4(-hx - 0.5, top - 0.38, hz * 0.7, 0.7, 0.32, 0.06, 0, 0, -0.35), glow: null },
      { geo: BOXG, m: mat4(-hx - 0.5, top - 0.38, -hz * 0.7, 0.7, 0.32, 0.06, 0, 0, -0.35), glow: null },
      { geo: BOXG, m: mat4(0, top - 0.62, hz + 0.13, hx * 2 + 1.2, 0.05, 0.02), glow: G(neon, 2.4) },
      { geo: BOXG, m: mat4(0, top - 0.62, -hz - 0.13, hx * 2 + 1.2, 0.05, 0.02), glow: G(neon, 2.4) },
      { geo: BOXG, m: mat4(0, top - 1.11, 0, hx * 2 + 0.6, 0.02, hz * 2 - 0.2), glow: G(neon, 1.6) },
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push({ geo: CY, m: mat4(sx * (hx - 0.1), top - 1.12, sz * (hz + 0.05), 0.36, 0.26, 0.36), glow: null });
      parts.push({ geo: CY, m: mat4(sx * (hx - 0.1), top - 1.26, sz * (hz + 0.05), 0.26, 0.03, 0.26), glow: G(0x9ae8ff, 3) });
    }
    const body = new THREE.Mesh(merge(parts), panelMat(paint, { metalness: 0.65, roughness: 0.3, pattern: 0 }));
    body.castShadow = true;
    const mesh = this.add(new THREE.Group(), false);
    mesh.add(body);
    this.anim.push(body);
    return { c, mesh, fall: 0, off: false, car: body, face: 0 };
  }

  buildRings() {
    const L = this.level;
    for (const ring of L.rings) {
      const { y, rIn, rOut, a0, a1 } = ring, span = a1 - a0, seg = Math.max(12, Math.ceil((span / TAU) * 128));
      const tint = ring.zone === 0 ? { storm: 0x333944, sunny: 0xd9c49c, forest: 0x4f6b3a, volcano: 0x2e2420, city: 0x2a3040, waterfall: 0xd8ccb0 }[this.key] : L.zones[ring.zone].tint;
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
      const gm = new THREE.MeshBasicMaterial({ color: this.key === 'storm' ? HDR(0xffa83a, this.glowK * 0.55) : HDR(L.zones[ring.zone].color, this.glowK) });
      for (const r of [rOut - 0.06, rIn + 0.06]) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, seg, span).rotateX(-Math.PI / 2), gm);
        t.rotation.y = -a1;
        t.position.y = y + 0.01;
        this.add(t, false);
      }
    }
  }

  buildCore() {
    if (this.key === 'volcano') return;
    if (this.key === 'waterfall') return this.buildFallsCore();
    if (this.key === 'storm') return this.buildStormCore();
    if (this.key !== 'storm' && this.key !== 'city') return this.buildCoreAlt();
    const L = this.level, city = this.key === 'city';
    const H = L.top - 1.2 + 40;
    // Floors of offices (coreview.js): a tile is 6 bays by 12 floors, three tiles round.
    // City: white modules with round windows (coreview.js cityFacade), four tiles round.
    const { map, glow, tileH } = city ? cityFacade('tech', 41, 200) : Object.assign(facadeTex(5, false), { tileH: 42 });
    for (const t of [map, glow]) t.repeat.set(city ? 4 : 3, H / tileH);
    const m = panelMat(0xffffff, { map, metalness: 0.5, roughness: 0.4, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.9, pattern: 0 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R, H, 72, 1, true), m);
    core.position.y = (L.top - 1.2 - 40) / 2;
    this.add(core);
    for (const z of L.zones) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(CORE_R + 0.06, 0.14, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: HDR(z.color, 2.2) }));
      t.position.y = z.y0 - 1.4;
      this.add(t, false);
    }
  }

  // Storm: a weather station tower (coreview.js stormTex), each zone marked by an iron band with amber lamps round it.
  buildStormCore() {
    const L = this.level, H = L.top - 1.2 + 40;
    const { map, glow } = stormTex(5);
    for (const t of [map, glow]) t.repeat.set(4, H / 19);
    const m = panelMat(0xffffff, { map, metalness: 0.3, roughness: 0.62, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 1.1, pattern: 0 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R, H, 72, 1, true), m);
    core.position.y = (L.top - 1.2 - 40) / 2;
    this.add(core);
    const iron = panelMat(0x3a3e46, { metalness: 0.7, roughness: 0.45, pattern: 0 }), lampM = new THREE.MeshBasicMaterial({ color: HDR(0xffb040, 2.4) });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), lampM, L.zones.length * 24), mm = new THREE.Matrix4();
    let n = 0;
    for (const z of L.zones) {
      const y = z.y0 - 1.4, band = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R + 0.12, CORE_R + 0.12, 0.5, 72, 1, true), iron);
      band.position.y = y;
      this.add(band);
      for (const dy of [-0.3, 0.3]) {
        const lip = new THREE.Mesh(new THREE.TorusGeometry(CORE_R + 0.12, 0.06, 6, 72).rotateX(Math.PI / 2), iron);
        lip.position.y = y + dy;
        this.add(lip, false);
      }
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        lamps.setMatrixAt(n++, mm.makeTranslation(Math.cos(a) * (CORE_R + 0.22), y, Math.sin(a) * (CORE_R + 0.22)));
      }
    }
    lamps.count = n;
    this.add(lamps, false);
  }

  // Storm: the wind turbines on the islands turn (their towers are scenery, buildScenery notes where).
  stormGear() {
    if (this.key !== 'storm') return;
    const geo = modelGeo('rotor'), mat = vegMat(), R = rng(515);
    // Searchlights on rails round the tower, sweeping the storm.
    const beamM = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uC: { value: HDR(0xfff0d0, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uC; varying vec2 vUv;
        void main(){ float f = pow(vUv.y, 1.8) * 0.6; gl_FragColor = vec4(uC * f, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const len = 75, beamG = new THREE.CylinderGeometry(0.3, 7.5, len, 20, 1, true).rotateZ(Math.PI / 2).translate(CORE_R + 0.9 + len / 2, 0, 0).rotateZ(-0.1);
    const house = panelMat(0x2a2e35, { metalness: 0.7, roughness: 0.4, pattern: 0 }), lens = new THREE.MeshBasicMaterial({ color: HDR(0xfff0d0, 3) });
    this.level.zones.forEach((z, i) => {
      if (i % 2 || i === 0) return;
      const g = new THREE.Group(), y = z.y0 + 5;
      g.position.y = y;
      g.rotation.y = R() * TAU;
      const b = new THREE.Mesh(beamG, beamM);
      b.frustumCulled = false;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), house), l = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16).rotateY(Math.PI / 2), lens);
      h.position.x = CORE_R + 0.45;
      l.position.x = CORE_R + 0.91;
      g.add(b, h, l);
      this.add(g, false);
      this.spin.push({ o: g, axis: 'y', sp: (i % 4 ? 1 : -1) * (0.3 + R() * 0.2) });
    });
    // The tesla coils crackle: a few jagged arcs off each tip, flickering on and off.
    const arcM = new THREE.MeshBasicMaterial({ color: HDR(0xb8e8ff, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const arcs = [];
    for (const c of this.coils || []) {
      const tip = new THREE.Vector3(c.x, c.y + 2.95 * c.s, c.z), parts = [];
      for (let k = 0; k < 2; k++) {
        const a = R() * TAU, pts = [tip.clone()];
        for (let j = 1; j <= 5; j++) pts.push(new THREE.Vector3(tip.x + Math.cos(a) * j * 0.24 * c.s + (R() - 0.5) * 0.25, tip.y - j * j * 0.05 * c.s + (R() - 0.5) * 0.2, tip.z + Math.sin(a) * j * 0.24 * c.s + (R() - 0.5) * 0.25));
        parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 10, 0.022 * c.s, 4));
      }
      const m = new THREE.Mesh(mergeGeos(parts.map((g) => [g, new THREE.Matrix4()])), arcM);
      m.visible = false;
      this.add(m, false);
      arcs.push({ m, ph: R() * 10, sp: 5 + R() * 6 });
    }
    if (arcs.length) this.onFrame.push((t) => { for (const a of arcs) a.m.visible = ((t * a.sp + a.ph) % 3.1) < 0.35; });
    for (const t of this.rotors || []) {
      const g = new THREE.Group(), r = new THREE.Mesh(geo, mat);
      g.position.set(t.x, t.y, t.z);
      g.rotation.y = t.ry;
      g.scale.setScalar(t.s);
      r.position.set(0, 5.7, -0.64);
      g.add(r);
      this.add(g, false);
      this.spin.push({ o: r, axis: 'z', sp: 1.4 + ((t.x * 7 + t.z * 3) % 1 + 1) % 1 * 1.6 });
    }
  }

  // How wide the drawn core is at height y (it widens toward the foot on some maps), as the solid wall in level.js.
  coreAt(y) {
    const top = this.level.top - 1.2, H = top + 40;
    return CORE_R * (1 + (coreFlare(this.key) - 1) * Math.min(1, Math.max(0, (top - y) / H)));
  }

  // Sunny: a white lighthouse with red bands and warm windows. Forest: a giant bark trunk.
  buildCoreAlt() {
    const L = this.level, H = L.top - 1.2 + 40, sunny = this.key === 'sunny';
    // Textures from coreview.js. The lighthouse: a tile is a quarter of the way round and 30 m tall. The trunk: a third of
    // the way round and 25 m tall, so the bark plates keep their shape.
    const tex = sunny ? lighthouseTex(6) : barkTex(6);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(sunny ? 4 : 3, H / (sunny ? 30 : 25));
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: sunny ? 0.55 : 0.9, metalness: 0 });
    if (!sunny) {
      // Side trees reuse the bark, wrapped less often round their thinner trunks.
      // (their geometry scales its uvs to its height: one tile once round and 33 m up)
      const t2 = tex.clone();
      t2.repeat.set(1, 1);
      t2.needsUpdate = true;
      this.barkMat = new THREE.MeshStandardMaterial({ map: t2, roughness: 0.9, metalness: 0 });
      this.barkTex = tex;
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R * coreFlare(sunny ? 'sunny' : 'forest'), H, 72, 1, true), m);
    core.position.y = (L.top - 1.2 - 40) / 2;
    this.add(core);
    const accent = new THREE.MeshBasicMaterial({ color: HDR(sunny ? 0xffffff : 0x9be564, sunny ? 1.0 : 1.3) });
    for (const z of L.zones) {
      // Hugging the wall where it is at that height (it widens toward the foot), never sticking out past its solid skin.
      const t = new THREE.Mesh(new THREE.TorusGeometry(this.coreAt(z.y0 - 1.4) + 0.07, sunny ? 0.14 : 0.12, 8, 96).rotateX(Math.PI / 2), accent);
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
    // Arrows in the air over a dash gap, rungs up the walls of a wall jump shaft.
    const glow = [];
    for (const d of D('chev')) {
      const ry = Math.atan2(-d.uz, d.ux);
      for (const v of [1, -1]) glow.push(mat4(d.x - d.ux * 0.22, d.y + v * 0.22, d.z - d.uz * 0.22, 0.68, 0.13, 0.13, 0, ry, -v * Math.PI / 4));
    }
    for (const d of D('rung')) glow.push(mat4(d.x, d.y, d.z, d.s, 0.09, 0.05, 0, d.ry, 0));
    if (glow.length) {
      const gm = new THREE.InstancedMesh(BOXG, new THREE.MeshBasicMaterial({ color: HDR(0xff7a18, this.glowK) }), glow.length);
      glow.forEach((m, i) => gm.setMatrixAt(i, m));
      this.add(gm, false);
    }
  }

  // The ground the tower stands on: open sea (storm), a sandy beach island (sunny) or a forest island.
  buildIsland() {
    if (this.key === 'storm' || this.key === 'volcano' || this.key === 'city') return;
    if (this.key === 'waterfall') {
      // A green island ringed by a sandy beach, in a clear lagoon (the surf is drawn by the ocean shader).
      const R = 36;
      const sand = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 9, 3, 96, 1), new THREE.MeshStandardMaterial({ color: 0xead9a8, roughness: 1, metalness: 0 }));
      sand.position.y = -1.1;
      this.add(sand);
      const grass = new THREE.Mesh(new THREE.CircleGeometry(R - 6, 64).rotateX(-Math.PI / 2), panelMat(0x6aa83e, { pattern: 19, roughness: 1, metalness: 0 }));
      grass.position.y = 0.42;
      this.add(grass, false);
      // Long grass, ferns and flowers all over it, clear of the route, the pool and the trees.
      const L = this.level, Rg = rng(919), low = L.cols.filter((c) => c.kind !== 'dock' && c.kind !== 'core' && c.miny < 4 && c.maxy > -1);
      const hit = (x, z, r) => low.some((c) => x + r > c.minx && x - r < c.maxx && z + r > c.minz && z - r < c.maxz)
        || L.decor.some((d) => (d.k === 'palm' || d.k === 'fountain' || d.k === 'tree') && Math.hypot(d.x - x, d.z - z) < 0.9);
      const want = [260, 700, 1000][detail()], put = new Map(), MODELS_W = [['tuftT', 6], ['grass', 2], ['flowers', 1], ['fernT', 1]];
      for (let n = 0, tries = 0; n < want && tries < want * 6; tries++) {
        const a = Rg() * TAU, r = CORE_R + 7 + Math.sqrt(Rg()) * (R - 7.5 - CORE_R - 7), x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (hit(x, z, 0.5)) continue;
        let w = Rg() * 10, k = 'tuftT';
        for (const [mk, mw] of MODELS_W) if ((w -= mw) <= 0) { k = mk; break; }
        if (!put.has(k)) put.set(k, []);
        const sc = 0.8 + Rg() * 0.7;
        put.get(k).push(mat4(x, 0.42, z, sc, sc * (0.8 + Rg() * 0.5), sc, 0, Rg() * TAU, 0));
        n++;
      }
      const vm = vegMat(), band = this.band(0);
      for (const [k, list] of put) {
        const im = new THREE.InstancedMesh(modelGeo(k), vm, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m));
        this.add(im, false);
        band.near.push(im);
      }
      return;
    }
    const sunny = this.key === 'sunny', R = sunny ? 40 : 88;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 9, 3, 96, 1), sunny ? new THREE.MeshStandardMaterial({ color: 0xe9d6a4, roughness: 1, metalness: 0 })
      : panelMat(0x47732f, { pattern: 19, roughness: 1, metalness: 0 }));
    top.position.y = -1.1;
    this.add(top);
    if (sunny) {
      const wet = new THREE.Mesh(new THREE.RingGeometry(R - 1, R + 6, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xbfa57a, roughness: 0.35, metalness: 0 }));
      wet.position.y = 0.06;
      this.add(wet, false);
      // The surf on the beach is drawn by the ocean shader.
    }
    // The forest floor (grass, bare earth round the trunk, moss) is drawn by its surface (pattern.js 19).
  }

  buildMapDecor() {
    const L = this.level, D = (k) => L.decor.filter((d) => d.k === k), R = rng(77);
    if (this.key === 'sunny' || this.key === 'waterfall') {
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
      // Puffy clouds around the upper tower, slowly circling, well outside the route (level.js sees to that). Always
      // far off now, so fewer corners each.
      const clouds = D('cloud'), puff = new THREE.IcosahedronGeometry(1, 1), n = clouds.length * 5;
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
      // Birds: GPU flocks (scenery.js).
      this.gulls = [];
    } else if (this.key === 'forest') {
      // Trees, ferns, logs and long grass on the island (wildview.js).
      buildWildForest(this);
      const col = new THREE.Color();
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

  // The creatures (scenery.js beastRig): a body and the limbs that move as it walks, each map its own kind; the Wild
  // Forest's wolves out on the ledges and its boars in the mazes.
  // Creature sounds: a growl when one comes after you (again now and then while it does), a snarl as it bites and a yelp
  // when it is stunned. Louder the nearer it is, and never many at once.
  beastVoice(e, p) {
    const cam = this.camPos, now = performance.now(), lg = p.hunt ? p.lunge : 0;
    const was = e.v || (e.v = { hunt: false, stun: false, lg: 0, at: 0 });
    let ev = null, fresh = p.hunt && !was.hunt;
    if (p.stunned && !was.stun) ev = 'stun';
    else if (!p.stunned && lg > was.lg + 0.5) ev = 'bite';
    else if (p.hunt && !p.stunned && (!was.hunt || now > was.at)) ev = 'hunt';
    was.hunt = p.hunt; was.stun = p.stunned; was.lg = lg;
    if (!ev || !cam) return;
    const d = Math.hypot(p.x - cam.x, e.m.y - cam.y, p.z - cam.z), v = Math.min(1, 1.2 - d / 24);
    const gap = ev === 'hunt' && !fresh ? 1400 : 250;
    if (v <= 0.05 || now - (this.voiceAt || 0) < gap) return;
    this.voiceAt = now;
    was.at = now + 4000 + Math.random() * 3000;
    this.app.sound.beast(e.kind, ev, v);
  }

  buildCreatures() {
    const L = this.level;
    this.monsters = [];
    this.bats = [];
    if (!L.monsters.length && !L.bats.length) return;
    for (const m of L.monsters) {
      const kind = m.mz === undefined && this.key === 'forest' ? 'wolf' : MAZE_BEAST[this.key];
      const o = this.add(this.beastMesh(kind, m.mz !== undefined));
      this.anim.push(o, ...o.userData.limbs.map((l) => l.o));
      this.monsters.push({ m, o, p: {}, beast: true, limbs: o.userData.limbs, kind });
    }
    if (this.key === 'city') return this.buildDrones();
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
      // Waterfall: the flyers are flying fish.
      const o = this.add(new THREE.Mesh(this.key === 'waterfall' ? this.fishGeo(true) : bg, b.look ? this.lookMat(b.look) : bmat));
      o.scale.setScalar(1.5);
      this.anim.push(o);
      this.bats.push({ b, o, p: {} });
    }
  }

  // One creature. In a maze it turns about its middle and is no bigger than the corridors let it turn round in (the croc
  // and the storm crab come out a little smaller there): level.js MAZE_BODY, which keeps it off the walls.
  beastMesh(kind, maze) {
    const rig = beastRig(kind), mat = vegMat(), o = new THREE.Group(), g = new THREE.Group();
    const s = maze ? Math.min(1, (MAZE_BODY[this.key] || [rig.hl])[0] / rig.hl) : 1;
    g.scale.setScalar(s);
    if (maze) g.position.z = -rig.zc * s;
    const body = new THREE.Mesh(rig.body, mat);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    o.userData.limbs = rig.limbs.map((l) => {
      const mm = new THREE.Mesh(l.geo, mat);
      mm.position.set(l.at[0], l.at[1], l.at[2]);
      mm.castShadow = mm.receiveShadow = true;
      g.add(mm);
      return { o: mm, l };
    });
    o.add(g);
    return o;
  }

  buildDistant() {
    if (this.key !== 'storm') return this.buildDistantAlt();
    stormLands(this);
  }

  // Lasers (spinning bars and on/off curtains), arrow traps and the ropes of swinging platforms.
  buildHazards() {
    const L = this.level, col = { storm: 0xff2448, sunny: 0xff7a1a, forest: 0xff4a3a, volcano: 0xff5a2a, city: 0xff2a8a, waterfall: 0x3fe0ff }[this.key];
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
    const emitter = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.8, emissive: col, emissiveIntensity: 0.5 });
    const capGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.22, 16);
    for (const l of L.lasers) {
      const g = new THREE.Group();
      g.position.set(l.x, l.y, l.z);
      const mat = new THREE.MeshBasicMaterial({ color: HDR(l.look ? l.look.g : col, 3) });
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
      } else if (l.k === 'bar') {
        // Across a flying car's way: a bar between two hovering emitters, with a soft glow round it.
        g.rotation.y = Math.atan2(-l.ux, -l.uz);
        const b = new THREE.Mesh(beamGeo, mat);
        b.scale.set(l.w * 2, 1.4, 1.4);
        b.position.x = -l.w;
        g.add(b);
        const halo = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: HDR(l.look ? l.look.g : col, 1.2), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.set(l.w * 2, 4, 4);
        halo.position.x = -l.w;
        g.add(halo);
        for (const sd of [-1, 1]) {
          const pod = new THREE.Mesh(capGeo, emitter);
          pod.rotation.z = Math.PI / 2;
          pod.scale.set(0.9, 1.2, 0.9);
          pod.position.x = sd * (l.w + 0.1);
          g.add(pod);
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
      this.lasers.push({ l, g, mat, col: l.look ? l.look.g : col });
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
        const m = new THREE.Mesh(arrowGeo, a.look ? this.lookMat(a.look) : arrowMat);
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
    // A themed swing (vines in the forest, a hammock, a bucket, a window cleaner's cradle) brings its own colours.
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x4f7a2a, roughness: 0.9 }), lookRope = new Map();
    for (const sw of L.swings) {
      const d = sw.col.dyn, nx = -d.uz, nz = d.ux;
      const rm = !sw.look ? ropeMat : this.key === 'forest' ? vineMat : lookRope.get(sw.look.c) || lookRope.set(sw.look.c, new THREE.MeshStandardMaterial({ color: sw.look.c, roughness: 0.6, metalness: this.key === 'city' ? 0.6 : 0 })).get(sw.look.c);
      const bar = new THREE.Mesh(BOXG, barMat);
      bar.scale.set(2.8, 0.22, 0.22);
      bar.position.set(d.px, d.py + 0.1, d.pz);
      bar.rotation.y = Math.atan2(-nz, nx);
      this.add(bar);
      const ropes = [-1, 1].map((s2) => {
        const r = new THREE.Mesh(ropeGeo, rm);
        this.root.add(r);
        this.anim.push(r);
        return { r, s: s2 };
      });
      this.swingFx.push({ sw, d, nx, nz, ropes });
    }
  }

  // Side pillars the route climbs round, away from the core: forest trees (bark with a leafy crown), storm lightning
  // pylons (steel with glowing bands and a beacon), waterfall rock stacks (mossy, with a little fall down one side).
  // A trunk is straight, with a wider foot over the lowest 6 m when it stands on the ground: the same as its solid
  // shape in level.js, so nothing sinks into it.
  buildSideTrees() {
    const T = this.level.trees;
    if (!T.length) return;
    const R = rng(91), kind = T[0].kind || 'tree';
    // Their own copies of the textures (coreview.js), wrapped once round: the geometry scales its uvs to its height.
    const once = (t) => { const c = t.clone(); c.repeat.set(1, 1); c.needsUpdate = true; return c; };
    const bark = kind === 'pylon' ? new THREE.MeshStandardMaterial({ map: steelTex(8), roughness: 0.42, metalness: 0.6 })
      : kind === 'stack' ? (this.rockMat ? new THREE.MeshStandardMaterial({ map: once(this.rockMat.map), roughness: 0.92, metalness: 0 }) : new THREE.MeshStandardMaterial({ color: 0x6a6a64, roughness: 0.95 }))
      : (this.barkMat || new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.95 }));
    const tileH = kind === 'pylon' ? 16 : 33;
    this.sideMat = bark;
    const storm = this.key === 'storm', glow = new THREE.MeshBasicMaterial({ color: HDR(storm ? 0xffa83a : 0x3ff0d0, storm ? 1.3 : 2.2) }), beacon = new THREE.MeshBasicMaterial({ color: HDR(storm ? 0xff3a2a : 0x9b7bff, 3) });
    if (storm) this.blink.push({ m: beacon, base: 3, hex: 0xff3a2a, sp: 3, sq: true });
    const knots = [], roots = [];
    for (const t of T) {
      // From the ground, or floating on a knot of roots (or rock, or a steel cone) above older route (level.js decides).
      const floating = t.base > 0, low = floating ? t.base + 3 : t.base, h = t.top - low;
      // The texture keeps its shape whatever the height: one tile once round and tileH up.
      const bv = (g, len) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / tileH); return g; };
      const trunk = new THREE.Mesh(bv(new THREE.CylinderGeometry(t.r, t.r, h, 28, 1, !floating), h), bark);
      trunk.position.set(t.x, low + h / 2, t.z);
      this.add(trunk);
      if (!floating) {
        const foot = new THREE.Mesh(bv(new THREE.CylinderGeometry(t.r, t.r * 1.35, 6, 28, 1, true), 6), bark);
        foot.position.set(t.x, t.base + 3, t.z);
        this.add(foot);
      } else {
        knots.push(mat4(t.x, t.base + 1.5, t.z, t.r * 1.08, 3, t.r * 1.08));
        for (let i = 0; i < (kind === 'pylon' ? 0 : 7); i++) {
          const b = (i / 7) * TAU + R(), k = 0.7 + R() * 0.6;
          roots.push(mat4(t.x + Math.cos(b) * t.r * 0.72, t.base + 2 - 1.2 * k, t.z + Math.sin(b) * t.r * 0.72, k, k, k, Math.sin(b) * 0.45, 0, Math.PI - Math.cos(b) * 0.45));
        }
      }
      if (kind === 'pylon') {
        // Glowing bands flush with the steel every 8 m, a cap and a lightning rod with a beacon on top.
        for (let y = low + 4; y < t.top - 1; y += 8) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(t.r + 0.02, t.r + 0.02, 0.18, 28, 1, true), glow);
          band.position.set(t.x, y, t.z);
          this.add(band, false);
        }
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.7, t.r, 1.2, 28), bark);
        cap.position.set(t.x, t.top + 0.6, t.z);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 5, 8), bark);
        rod.position.set(t.x, t.top + 3.7, t.z);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), beacon);
        orb.position.set(t.x, t.top + 6.4, t.z);
        this.add(cap); this.add(rod); this.add(orb, false);
      } else if (kind === 'stack') {
        // A thin fall pouring down one side of the rock (its mossy top is coreview.js's).
        const th = R() * TAU, fg = new THREE.CylinderGeometry(t.r + 0.08, t.r + 0.08, h, 10, 1, true, th, 0.5);
        fg.userData.len = 0.5;
        this.flowUV(fg, 'sheet', th);
        const fall = new THREE.Mesh(fg, this.sideFall || (this.sideFall = fallMat(this, { speed: 0.5 })));
        fall.position.set(t.x, low + h / 2, t.z);
        this.add(fall, false);
      }
      // Trees get their crowns and branches in coreview.js.
    }
    // All the root knots of the map in two draws, however many trees float.
    const batch = (geo, list) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, bark, list.length);
      list.forEach((q, i) => m.setMatrixAt(i, q));
      m.frustumCulled = false;
      this.add(m, false);
    };
    batch(new THREE.CylinderGeometry(1, 0.17, 1, 16, 2), knots);
    batch(new THREE.ConeGeometry(0.55, 3.4, 7), roots);
  }

  // City drones: a body, four rotor rings and a red eye, one merged mesh each.
  buildDrones() {
    const body = HDR(0xff2a2a, 3), rotor = HDR(0x7fd8ff, 1.4);
    const parts = [
      { geo: new THREE.BoxGeometry(0.42, 0.16, 0.42), m: mat4(0, 0, 0, 1, 1, 1), glow: null },
      { geo: new THREE.SphereGeometry(0.07, 8, 6), m: mat4(0, -0.02, 0.22, 1, 1, 1), glow: body },
    ];
    for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
      parts.push({ geo: new THREE.BoxGeometry(0.34, 0.04, 0.05), m: mat4(x / 2, 0.02, z / 2, 1, 1, 1, 0, Math.atan2(x, z), 0), glow: null });
      parts.push({ geo: new THREE.TorusGeometry(0.15, 0.02, 4, 16).rotateX(Math.PI / 2), m: mat4(x, 0.05, z, 1, 1, 1), glow: rotor });
    }
    const g = merge(parts), mat = panelMat(0x30343e, { roughness: 0.4, metalness: 0.7, pattern: 0 });
    for (const b of this.level.bats) {
      const o = this.add(new THREE.Mesh(g, b.look ? this.lookMat(b.look) : mat));
      o.scale.setScalar(1.5);
      this.anim.push(o);
      this.bats.push({ b, o, p: {} });
    }
  }

  // A lit material in an obstacle's colours (shared between obstacles with the same look).
  lookMat(look) {
    let m = this.looks.get(look);
    if (!m) { m = panelMat(look.c, { roughness: 0.5, metalness: look.p ? 0.05 : 0.3, emissive: look.g, emissiveIntensity: look.e ?? 0.22, pattern: look.p || 0 }); this.looks.set(look, m); }
    return m;
  }

  // The themed obstacles (obstacles.js). Each gets its meshes here and an update for its animation.
  // Ziplines: a cable from post to post, a glowing grip ring where it can be grabbed, and in the forest a vine with
  // leaves along it. The posts themselves are colliders, drawn with the other posts.
  buildZips() {
    const Z = this.level.zips || [];
    if (!Z.length) return;
    const vine = this.key === 'forest', rope = this.key === 'sunny' || this.key === 'waterfall', R = rng(57);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8), leaves = [], cables = [], rings = [], caps = [];
    for (const z of Z) {
      const len = Math.hypot(z.px1 - z.px0, z.py1 - z.py0, z.pz1 - z.pz0), th = vine ? 0.07 : rope ? 0.055 : 0.035;
      const m = new THREE.Object3D();
      stretchTo(m, z.px0, z.py0, z.pz0, z.px1, z.py1, z.pz1);
      m.scale.set(th, len, th);
      m.updateMatrix();
      cables.push(m.matrix.clone());
      // Where your hands go on: a glowing ring round the cable just past the start post.
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(z.ux, z.uy, z.uz));
      for (const f of [0.2, 0.35, 0.5]) rings.push(new THREE.Matrix4().compose(new THREE.Vector3(z.ax + z.ux * f, z.ay + z.uy * f, z.az + z.uz * f), q, new THREE.Vector3(1, 1, 1)));
      for (const [x, y, zz] of [[z.px0, z.py0, z.pz0], [z.px1, z.py1, z.pz1]]) caps.push(mat4(x, y + 0.1, zz, 1, 1, 1));
      // Small leaves sprouting along the vine, never big enough to block the view of whoever rides it.
      if (vine) for (let d = 0.5; d < len - 0.4; d += 0.35 + R() * 0.4) {
        const f = d / len, s = 0.09 + R() * 0.06, a = R() * TAU;
        leaves.push(mat4(z.px0 + (z.px1 - z.px0) * f + Math.cos(a) * 0.08, z.py0 + (z.py1 - z.py0) * f + Math.sin(a) * 0.08, z.pz0 + (z.pz1 - z.pz0) * f, s * 1.9, s * 0.3, s, R() * 1.2, R() * TAU, R() * 1.2));
      }
    }
    const look = Z[0].look || { c: 0x555555, g: 0xffffff };
    const batch = (geo, mat, list, shadow) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((q, i) => im.setMatrixAt(i, q));
      im.frustumCulled = false;
      this.add(im, shadow);
    };
    // Steel cables glow a little, or they vanish against the dark maps.
    batch(cyl, new THREE.MeshStandardMaterial({ color: vine ? 0x4f7a2a : rope ? 0xc8a46a : 0x9aa4b4, roughness: vine || rope ? 0.9 : 0.35, metalness: vine || rope ? 0 : 0.8,
      emissive: vine || rope ? 0x000000 : 0x8aa6c8, emissiveIntensity: 0.55 }), cables, true);
    batch(new THREE.TorusGeometry(0.14, 0.035, 6, 14), new THREE.MeshBasicMaterial({ color: HDR(look.g, 2.4) }), rings, false);
    batch(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: look.c, roughness: 0.6 }), caps, true);
    batch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x5aa83a, roughness: 0.8, flatShading: true }), leaves, false);
  }

  buildObstacles() {
    const L = this.level, glowM = (look, k = 3) => new THREE.MeshBasicMaterial({ color: HDR(look.g, k) });
    const add = (o, obj, upd) => { this.root.add(obj); this.anim.push(obj); this.obsFx.push({ o, obj, upd }); obj.traverse((q) => { if (q !== obj) q.userData.anim = true; }); };
    const cyl = (r, h, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
    for (const o of L.obs) {
      const look = o.look, mat = this.lookMat(look);
      if (o.prim === 'sweep' && o.key === 'coursesweep' && courseSweep(this, o, add, mat)) continue;
      if (o.prim === 'sweep') {
        const g = new THREE.Group();
        g.position.set(o.x, o.y, o.z);
        const hub = new THREE.Mesh(cyl(0.3, 0.32, 16), mat);
        hub.position.y = -0.2;
        g.add(hub);
        for (let k = 0; k < o.n; k++) {
          const bar = look.s === 'laser' ? new THREE.Mesh(cyl(0.06, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0), glowM(look))
            : new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.26).translate(0.5, 0, 0), mat);
          bar.scale.x = o.len;
          bar.rotation.y = (k * Math.PI * 2) / o.n;
          g.add(bar);
        }
        add(o, g, (st, t) => { g.rotation.y = st.laserAngle(o, t); });
      } else if (o.prim === 'pendulum') {
        const g = new THREE.Group(), ux = o.nz, uz = -o.nx;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * (o.bar || 1), 0.16, 0.16), mat);
        bar.visible = o.bar !== 0;
        bar.position.set(o.x, o.y, o.z);
        bar.rotation.y = Math.atan2(-uz, ux);
        const rope = new THREE.Mesh(cyl(0.035, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 }));
        let head;
        if (look.s === 'log') head = new THREE.Mesh(cyl(o.r * 0.7, 1.4, 12).rotateZ(Math.PI / 2), mat);
        else if (look.s === 'anchor') head = new THREE.Mesh(merge([
          { geo: new THREE.BoxGeometry(0.16, 1.0, 0.16), m: mat4(0, 0.1, 0, 1, 1, 1), glow: null },
          { geo: new THREE.TorusGeometry(0.42, 0.08, 6, 16, Math.PI), m: mat4(0, -0.25, 0, 1, 1, 1, 0, 0, Math.PI), glow: null },
          { geo: new THREE.BoxGeometry(0.7, 0.12, 0.12), m: mat4(0, 0.45, 0, 1, 1, 1), glow: HDR(look.g, 1.2) },
        ]), mat);
        else head = new THREE.Mesh(new THREE.SphereGeometry(o.r, 18, 12), mat);
        head.castShadow = true;
        if (look.s === 'log') head.rotation.y = Math.atan2(-uz, ux);
        g.add(bar, rope, head);
        const P = {};
        add(o, g, (st, t) => {
          const p = st.pendulum(o, t, P);
          head.position.set(p.x, p.y, p.z);
          if (look.s !== 'log') head.rotation.z = p.a;
          stretchTo(rope, o.x, o.y, o.z, p.x, p.y, p.z);
        });
      } else if (o.prim === 'slider') {
        let m;
        if (o.shape === 'ram') { m = new THREE.Mesh(new THREE.BoxGeometry(o.len, 1.1, 0.6), mat); m.rotation.y = o.ry; }
        else if (o.shape === 'ball') m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 18, 12), mat);
        else if (o.shape === 'tube') m = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.68, o.r * 0.36, 10, 22),
          new THREE.MeshStandardMaterial({ color: [0xffd23d, 0xff5a8a, 0x3fe0a0, 0xff8a3d][o.i % 4], roughness: 0.3, metalness: 0.05 }));
        else if (o.shape === 'log') { m = new THREE.Mesh(cyl(o.r, o.w, 14), mat); }
        else m = new THREE.Mesh(merge([
          { geo: cyl(o.r, 0.08, 24).rotateX(Math.PI / 2), m: mat4(0, 0, 0, 1, 1, 1), glow: null },
          { geo: new THREE.TorusGeometry(o.r, 0.04, 6, 24), m: mat4(0, 0, 0, 1, 1, 1), glow: HDR(look.g, 2.5) },
        ]), mat);
        m.castShadow = true;
        const P = {}, g = new THREE.Group();
        g.add(m);
        add(o, g, (st, t) => {
          const p = st.slider(o, t, P);
          g.position.set(p.x, p.y, p.z);
          if (o.shape === 'ball') m.rotation.set(0, 0, -p.roll);
          else if (o.shape === 'tube') { g.rotation.y = o.ry; m.rotation.set(0, 0, -p.roll); g.visible = !p.hide; }
          else if (o.shape === 'log') { g.rotation.y = o.ry; m.rotation.set(Math.PI / 2, 0, 0); m.rotateY(p.roll); }
          else if (o.shape === 'disc') { g.rotation.y = o.ry; m.rotation.set(0, 0, t * 12); }
          // One way down a ramp: gone while it goes back up to the top.
          if (o.one) g.visible = !p.hide;
          if (p.warn > 0) g.position.x += Math.sin(t * 50) * 0.04;
        });
      } else if (o.prim === 'crusher') {
        const g = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(o.hs * 2, 1.0, o.hs * 2), mat);
        block.castShadow = true;
        const rod = new THREE.Mesh(cyl(0.16, 2.6, 10), this.lookMat(look));
        rod.position.y = 1.8;
        const warnM = glowM(look, 1.5);
        warnM.userData.live = true;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(o.hs * 2 + 0.04, 0.12, o.hs * 2 + 0.04), warnM);
        stripe.position.y = -0.4;
        g.add(block, rod, stripe);
        g.rotation.y = o.ry;
        add(o, g, (st, t) => {
          const c = st.crusher(o, t);
          g.position.set(o.x + (c.shake ? Math.sin(t * 60) * 0.05 * c.shake : 0), o.y + c.h + 0.5, o.z);
          warnM.color.setHex(look.g).multiplyScalar(1.2 + c.shake * 3);
        });
      } else if (o.prim === 'spikes' && look.s === 'water') {
        // Fountain grid: rows of water spouts that shoot up out of the deck.
        const parts = [], spout = new THREE.CylinderGeometry(0.07, 0.1, 1, 8, 1, true).translate(0, 0.5, 0);
        for (let a = -o.hx + 0.25; a <= o.hx - 0.25 + 1e-6; a += 0.5) for (let b = -o.hz + 0.25; b <= o.hz - 0.25 + 1e-6; b += 0.5) parts.push({ geo: spout, m: mat4(a, 0, b, 1, 1, 1), glow: null });
        const g2 = merge(parts);
        this.flowUV(g2, 'up');
        const m = new THREE.Mesh(g2, this.waterMat({ speed: -1.4, alpha: 0.8 }));
        const g = new THREE.Group();
        g.add(m);
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = o.ry;
        add(o, g, (st, t) => {
          const p = st.pulse(o, t);
          m.scale.y = p.on ? 1.3 : 0.02 + p.warn * 0.18;
          m.visible = p.on || p.warn > 0;
        });
      } else if (o.prim === 'leap') {
        // A fish riding an arc of water from one nozzle to the other, across the bridge.
        const g = new THREE.Group(), pts = [], P = {};
        for (let k = 0; k <= 16; k++) {
          const lo = o.lo ?? 0.8, f = k / 16, d = (-1 + 2 * f) * o.span * o.dir, H = o.h + lo;
          pts.push(new THREE.Vector3(o.x + o.nx * d, o.y - lo + H * 4 * f * (1 - f), o.z + o.nz * d));
        }
        const arcG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.08, 6, false);
        this.flowUV(arcG, 'tube', 6);
        const arc = new THREE.Mesh(arcG, this.waterMat({ speed: -1.2 * o.dir, alpha: 0.45 }));
        const noz = new THREE.CylinderGeometry(0.14, 0.22, 0.45, 10);
        for (const q of [pts[0], pts[16]]) { const n = new THREE.Mesh(noz, mat); n.position.set(q.x, q.y - 0.2, q.z); g.add(n); }
        const fish = new THREE.Mesh(this.fishGeo(), mat);
        fish.scale.setScalar(1.25);
        g.add(arc, fish);
        add(o, g, (st, t) => {
          const p = st.leap(o, t, P);
          fish.visible = p.on;
          if (p.on) { fish.position.set(p.x, p.y, p.z); fish.rotation.set(0, Math.atan2(-o.nz * o.dir, o.nx * o.dir), Math.atan(p.vy), 'YXZ'); }
        });
      } else if (o.prim === 'spikes') {
        const parts = [], cone = new THREE.ConeGeometry(0.11, 0.45, 6).translate(0, 0.22, 0);
        for (let a = -o.hx + 0.2; a <= o.hx - 0.2 + 1e-6; a += 0.42) for (let b = -o.hz + 0.2; b <= o.hz - 0.2 + 1e-6; b += 0.42) parts.push({ geo: cone, m: mat4(a, 0, b, 1, 1, 1), glow: null });
        const sm = this.lookMat(look).clone();
        sm.userData.live = true;
        const m = new THREE.Mesh(merge(parts), sm);
        const g = new THREE.Group();
        g.add(m);
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = o.ry;
        add(o, g, (st, t) => {
          const p = st.pulse(o, t);
          m.position.y = p.on ? 0 : -0.5 + p.warn * 0.12;
          sm.emissiveIntensity = p.on ? 0.6 : 0.22 + p.warn * (0.6 + Math.sin(t * 40) * 0.3);
        });
      } else if (o.prim === 'wheel') {
        // What holds the stones of a big wheel or a roundabout: they move by themselves (physics.js), this keeps up with them.
        const g = new THREE.Group(), rotor = new THREE.Group(), rim = mat;
        g.position.set(o.x, o.y, o.z);
        for (let k = 0; k < o.n; k++) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(o.R, 0.16, 0.16).translate(o.R / 2, 0, 0), rim);
          if (o.flat) arm.rotation.y = -(k * Math.PI * 2) / o.n;
          else arm.rotation.z = (k * Math.PI * 2) / o.n;
          rotor.add(arm);
        }
        const hub = new THREE.Mesh(cyl(0.42, o.flat ? 0.9 : 0.5, 18), rim);
        if (o.flat) {
          g.add(hub, rotor);
          add(o, g, (st, t) => { rotor.rotation.y = -((Math.PI * 2 * t) / o.per + o.a0); });
        } else {
          hub.rotation.x = Math.PI / 2;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(o.R, 0.07, 6, 56), glowM(look, 1.8));
          rotor.add(ring);
          g.rotation.y = -Math.atan2(o.uz, o.ux);
          g.add(hub, rotor);
          add(o, g, (st, t) => { rotor.rotation.z = o.a0 - (Math.PI * 2 * t) / o.per; });
        }
      } else if (o.prim === 'windmill') {
        const g = new THREE.Group(), rotor = new THREE.Group(), hub = new THREE.Mesh(cyl(0.34, 0.4, 16).rotateX(Math.PI / 2), mat);
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = Math.PI / 2 - Math.atan2(o.uz, o.ux);
        for (let k = 0; k < o.n; k++) {
          const arm = new THREE.Group(), blade = new THREE.Mesh(new THREE.BoxGeometry(o.R, 0.3, 0.14).translate(o.R / 2, 0, 0), mat), edge = new THREE.Mesh(new THREE.BoxGeometry(o.R - 0.3, 0.05, 0.16).translate(o.R / 2 + 0.15, 0.17, 0), glowM(look, 3));
          arm.add(blade, edge);
          arm.rotation.z = (k * Math.PI * 2) / o.n;
          rotor.add(arm);
        }
        g.add(hub, rotor);
        add(o, g, (st, t) => { rotor.rotation.z = st.blade(o, t); });
      } else if (o.prim === 'ring') {
        const g = new THREE.Group(), P = {};
        g.position.set(o.x, o.y, o.z);
        const m = new THREE.MeshBasicMaterial({ color: HDR(look.g, 3), transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        m.userData.live = true;
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.55, 48, 1, true).translate(0, 0.28, 0), m), core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), glowM(look, 2.4));
        core.position.y = 0.1;
        g.add(wall, core);
        add(o, g, (st, t) => {
          const p = st.ring(o, t, P);
          wall.visible = p.r > 0.3;
          wall.scale.set(p.r, 1, p.r);
          m.opacity = Math.min(1, (1 - p.k) * 2.2);
        });
      } else if (o.prim === 'comet') {
        const g = new THREE.Group(), P = {};
        const line = new THREE.MeshBasicMaterial({ color: HDR(look.g, 2.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        line.userData.live = true;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(o.span * 2, 0.05, 0.05), line);
        bar.position.set(o.x, o.y, o.z);
        const a = Math.atan2(-o.dz, o.dx);
        bar.rotation.y = a;
        const model = o.key === 'coursecomet' && COMET_HEAD[this.key];
        const head = model ? headMesh(model) : new THREE.Mesh(new THREE.SphereGeometry(o.r, 14, 10), glowM(look, 4));
        if (model) head.scale.setScalar(o.r / 0.5 * 1.15);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(o.r * 0.85, 3.2, 12, 1, true).rotateZ(Math.PI / 2).translate(-1.6, 0, 0), new THREE.MeshBasicMaterial({ color: HDR(look.g, 2.4), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        tail.rotation.y = a;
        g.add(bar, head, tail);
        add(o, g, (st, t) => {
          const p = st.comet(o, t, P);
          head.visible = tail.visible = p.fly;
          if (p.fly) { head.position.set(p.x, p.y, p.z); tail.position.set(p.x, p.y, p.z); if (model) head.rotation.set(t * 5, t * 3.4, 0); }
          bar.visible = p.warn > 0;
          line.opacity = p.warn > 0 ? 0.25 + p.warn * 0.75 * (Math.sin(t * 34) > -0.3 ? 1 : 0.4) : 0;
        });
      } else if (o.prim === 'well') {
        const g = new THREE.Group();
        g.position.set(o.x, o.y, o.z);
        // On a map with water it is a whirlpool, its rings lying flat. Lava glows. A plant or a magnet sits in the middle of some.
        const model = o.key === 'coursewell' && WELL_HEAD[this.key], water = o.key === 'coursewell' && (this.key === 'sunny' || this.key === 'waterfall');
        const core = model ? headMesh(model) : new THREE.Mesh(new THREE.SphereGeometry(o.r, 18, 12), new THREE.MeshBasicMaterial({ color: o.key !== 'coursewell' ? 0x050308 : this.key === 'volcano' ? HDR(look.g, 1.6) : look.c }));
        if (model) core.scale.setScalar(o.r / 0.5);
        const gm = new THREE.MeshBasicMaterial({ color: HDR(look.g, 2) });
        gm.userData.live = true;
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(o.r * 1.6, 0.05, 6, 36), gm), r2 = new THREE.Mesh(new THREE.TorusGeometry(o.r * 2.2, 0.035, 6, 40), gm);
        g.add(core, r1, r2);
        add(o, g, (st, t) => {
          const p = st.pulse(o, t, 0.5), k = p.on ? 1 : 0.35 + p.warn * 0.4;
          gm.color.setHex(look.g).multiplyScalar(0.9 + k * 2.6);
          if (water) { r1.rotation.set(Math.PI / 2, 0, t * 3 * k); r2.rotation.set(Math.PI / 2, 0, -t * 2 * k); }
          else {
            r1.rotation.set(t * 1.7, t * 2.3 * k, 0);
            r2.rotation.set(-t * 1.1, 0, t * 2.9 * k);
          }
          if (model === 'flytrap') { core.rotation.y = Math.sin(t * 2) * 0.5; core.scale.y = (o.r / 0.5) * (p.on ? 1 + Math.sin(t * 18) * 0.12 : 0.9); }
          const s = 1 + (p.on ? 0.1 * Math.sin(t * 16) : 0);
          r1.scale.setScalar(s);
          r2.scale.setScalar(s);
        });
      } else if (o.prim === 'jet') {
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), mat);
        const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.7, o.range, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, o.range / 2 + 0.3),
          new THREE.MeshBasicMaterial({ color: HDR(look.g, 2.6), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
        const nozM = glowM(look, 1.2);
        nozM.userData.live = true;
        const noz = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12).translate(0, 0, 0.31), nozM);
        g.add(box, flame, noz);
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = Math.atan2(o.dx, o.dz);
        add(o, g, (st, t) => {
          const p = st.pulse(o, t, 0.5);
          flame.visible = p.on;
          if (p.on) flame.scale.set(1 + Math.sin(t * 35) * 0.08, 1 + Math.cos(t * 29) * 0.08, Math.min(1, p.k * 8));
          nozM.color.setHex(look.g).multiplyScalar(p.on ? 3 : 1 + p.warn * 3);
        });
      }
    }
    // Bumpers: a squat post in the obstacle's colour with a glowing ring on top.
    const bG = cyl(0.45, 0.9, 20), rG = new THREE.TorusGeometry(0.42, 0.06, 6, 24).rotateX(Math.PI / 2);
    for (const b of L.bumpers) {
      const m = this.add(new THREE.Mesh(bG, this.lookMat(b.look)));
      m.position.set(b.x, b.y + 0.45, b.z);
      const ring = new THREE.Mesh(rG, new THREE.MeshBasicMaterial({ color: HDR(b.look.g, 2.4) }));
      ring.position.set(b.x, b.y + 0.92, b.z);
      this.add(ring, false);
    }
  }

  // ---------------------------------------------------------------- waterfall
  // Flowing water: streaks of foam drifting along v (v must grow the way the water comes from), fogged like
  // everything else. Shared time uniform, updated every frame.
  waterMat(o = {}) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uT: { value: 0 }, uS: { value: o.speed ?? 1 }, uA: { value: o.alpha ?? 0.75 },
        uC: { value: new THREE.Color(o.color ?? 0x5ad8f0) }, uF: { value: new THREE.Color(o.foam ?? 0xf4ffff) }, uE: { value: o.edge ? 1 : 0 },
      }]),
      vertexShader: `#include <fog_pars_vertex>
        varying vec2 vUv;
        void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform float uT, uS, uA, uE; uniform vec3 uC, uF; varying vec2 vUv;
        ${noiseGlsl()}
        void main(){
          vec2 p = vec2(vUv.x, vUv.y + uT * uS);
          float n = n21(p * vec2(10.0, 1.4)) * 0.6 + n21(p * vec2(26.0, 4.0) + 7.3) * 0.4;
          float streak = smoothstep(0.5, 0.88, n);
          vec3 col = mix(uC, uF, streak * 0.9);
          // Sheets (uE): u runs 0 to 1 across, so the sides fade out softly.
          float edge = uE > 0.5 ? smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x)) : 1.0;
          gl_FragColor = vec4(col, uA * (0.5 + 0.5 * streak) * edge);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.waters.push(m);
    return m;
  }

  // Sets uvs so water flows the right way: 'down' (falls: v grows with height), 'up' (jets), 'tube' (along a
  // TubeGeometry, u becomes the length), or a flat surface along local x ('x') or z ('z', sign = flow).
  flowUV(g, how, k = 1) {
    const pos = g.attributes.position;
    let uv = g.attributes.uv;
    if (!uv) { uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2); g.setAttribute('uv', uv); }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (how === 'down') uv.setXY(i, Math.atan2(x, z) * k, y * 0.06);
      else if (how === 'sheet') uv.setXY(i, (((Math.atan2(x, z) - k) % TAU) + TAU) % TAU / g.userData.len, y * 0.06);
      else if (how === 'up') uv.setXY(i, Math.atan2(x, z), -y * 0.6);
      else if (how === 'tube') uv.setXY(i, uv.getY(i), uv.getX(i) * k);
      else if (how === 'x') uv.setXY(i, z * 0.35, x * 0.18 * k);
      else uv.setXY(i, x * 0.35, -z * 0.18 * k);
    }
    uv.needsUpdate = true;
    return g;
  }

  // A cartoon fish, nose along +x (or +z for the flyers, which turn like bats).
  fishGeo(faceZ) {
    const key = faceZ ? '_fishZ' : '_fish';
    if (this[key]) return this[key];
    const g = merge([
      { geo: new THREE.SphereGeometry(0.5, 16, 10), m: mat4(0, 0, 0, 1, 0.5, 0.36), glow: null },
      { geo: new THREE.ConeGeometry(0.3, 0.42, 4), m: mat4(-0.68, 0, 0, 1, 1, 0.25, 0, 0, -Math.PI / 2), glow: null },
      { geo: new THREE.ConeGeometry(0.12, 0.3, 4), m: mat4(-0.05, 0.24, 0, 1, 1, 0.3, 0, 0, 0.5), glow: null },
      { geo: new THREE.SphereGeometry(0.05, 6, 4), m: mat4(0.32, 0.06, 0.13, 1, 1, 1), glow: HDR(0xffffff, 0.8) },
      { geo: new THREE.SphereGeometry(0.05, 6, 4), m: mat4(0.32, 0.06, -0.13, 1, 1, 1), glow: HDR(0xffffff, 0.8) },
    ]);
    if (faceZ) g.rotateY(-Math.PI / 2);
    return (this[key] = g);
  }

  rockTex(seed) { return rockTexture(seed); }

  // The climb goes round a mossy rock spire with waterfalls pouring down it into a plunge pool.
  buildFallsCore() {
    const L = this.level, R = rng(6), H = L.top - 1.2 + 40, y0 = (L.top - 1.2 - 40) / 2;
    const tex = this.rockTex(61);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, H / 40);
    this.rockMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_R, CORE_R * coreFlare('waterfall'), H, 72, 1, true), this.rockMat);
    core.position.y = y0;
    this.add(core);
    // The falls: curved sheets of water hugging the rock, streaming down, with spray where they land.
    const fallM = fallMat(this, { speed: 0.42 }), fallM2 = fallMat(this, { speed: 0.6, alpha: 0.55, color: 0xffffff, deep: 0x8ad0e8 });
    const mistM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const th = (i / 5) * TAU + R() * 0.5, len = 0.32 + R() * 0.22, r = CORE_R + 0.18;
      const g = new THREE.CylinderGeometry(r, r * 1.18, H, 12, 1, true, th, len);
      g.userData.len = len;
      this.flowUV(g, 'sheet', th);
      const sheet = new THREE.Mesh(g, fallM);
      sheet.position.y = y0;
      this.add(sheet, false);
      // A thinner, faster layer in front for depth.
      const g2 = new THREE.CylinderGeometry(r + 0.03, r * 1.18, H, 12, 1, true, th + len * 0.1, len * 0.8);
      g2.userData.len = len * 0.8;
      this.flowUV(g2, 'sheet', th + len * 0.1);
      const s2 = new THREE.Mesh(g2, fallM2);
      s2.position.y = y0;
      this.add(s2, false);
      this.mistSpots.push({ x: Math.sin(th + len / 2) * (CORE_R * 1.18 + 1.2), y: 0.6, z: Math.cos(th + len / 2) * (CORE_R * 1.18 + 1.2), r: 2.6, n: 16, rise: 6 });
      const mid = th + len / 2, mr = CORE_R * 1.18 + 1.5;
      const mist = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mistM);
      mist.scale.set(3.2, 1.4, 3.2);
      mist.position.set(Math.sin(mid) * mr, 0.6, Math.cos(mid) * mr);
      this.add(mist, false);
    }
    // The plunge pool round the foot of the rock.
    const pool = new THREE.Mesh(this.flowUV(new THREE.RingGeometry(CORE_R * 1.1, CORE_R + 6, 64, 2), 'x'), this.waterMat({ speed: 0.15, alpha: 0.85, color: 0x3fc8e0 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.46;
    this.add(pool, false);
    // Flower garlands at each zone gate.
    const leaf = new THREE.MeshStandardMaterial({ color: 0x4f9a40, roughness: 0.8 }), bloom = new THREE.MeshBasicMaterial({ color: HDR(0xff9ad8, 1.2) });
    for (const z of L.zones) {
      const cr = this.coreAt(z.y0 - 1.4), t = new THREE.Mesh(new THREE.TorusGeometry(cr + 0.06, 0.14, 8, 96).rotateX(Math.PI / 2), leaf);
      t.position.y = z.y0 - 1.4;
      this.add(t, false);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU, f = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bloom);
        f.position.set(Math.sin(a) * (cr + 0.1), z.y0 - 1.25, Math.cos(a) * (cr + 0.1));
        this.add(f, false);
      }
    }
  }

  // Waterfall: the rock pillars and cliffs round the lagoon (backdrop.js), and a rainbow.
  buildCliffs() {
    fallLands(this);
    // A rainbow arching out of the lagoon.
    const rm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uA: { value: 0.3 } },
      vertexShader: 'varying float vR; void main(){ vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uA; varying float vR;
        void main(){ float k = clamp((vR - 150.0) / 18.0, 0.0, 1.0);
          vec3 c = clamp(abs(mod(k * 4.6 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          gl_FragColor = vec4(c * uA * sin(k * 3.1416), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const bow = new THREE.Mesh(new THREE.RingGeometry(150, 168, 96, 1, 0, Math.PI), rm);
    const ba = 2.2;
    bow.position.set(Math.cos(ba) * 330, -14, Math.sin(ba) * 330);
    bow.rotation.y = Math.atan2(-Math.cos(ba), -Math.sin(ba));
    this.root.add(bow);
  }

  // Waterfall: lily pads, fountains and fish jumping in the lagoon.
  buildWaterPark() {
    if (this.key !== 'waterfall') return;
    const L = this.level, D = (k) => L.decor.filter((d) => d.k === k), R = rng(88);
    const lilies = D('lily'), col = new THREE.Color();
    const pad = new THREE.CircleGeometry(1, 18, 0.35, TAU - 0.7).rotateX(-Math.PI / 2);
    const pm = new THREE.InstancedMesh(pad, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }), lilies.length);
    const flowers = lilies.filter((d) => d.flower);
    const fl = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.3, 7).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xff5ab0, emissiveIntensity: 0.25 }), flowers.length);
    lilies.forEach((d, i) => { pm.setMatrixAt(i, mat4(d.x, d.y, d.z, d.s, 1, d.s, 0, d.ry, 0)); pm.setColorAt(i, col.setHSL(0.27 + R() * 0.07, 0.6, 0.3 + R() * 0.12)); });
    flowers.forEach((d, i) => { fl.setMatrixAt(i, mat4(d.x, d.y, d.z, 1, 1, 1)); fl.setColorAt(i, col.setHex([0xff9ad8, 0xffffff, 0xffd0f0][i % 3])); });
    this.add(pm, false); this.add(fl, false);
    // Fountains: a stone basin, a jet of water and a cascade spilling back down.
    const stone = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 });
    const pondM = this.waterMat({ speed: 0.12, alpha: 0.85, color: 0x4fd0e8 }), jetM = this.waterMat({ speed: -1.2, alpha: 0.8 }), fallM = this.waterMat({ speed: 0.6, alpha: 0.55 });
    for (const d of D('fountain')) {
      const s = d.s, g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * s, 1.75 * s, 0.6, 28), stone);
      basin.position.y = 0.3;
      const water = new THREE.Mesh(this.flowUV(new THREE.CircleGeometry(1.45 * s, 28).rotateX(-Math.PI / 2), 'x'), pondM);
      water.position.y = 0.62;
      const jet = new THREE.Mesh(this.flowUV(new THREE.CylinderGeometry(0.1, 0.16, 2.8 * s, 10, 1, true), 'up'), jetM);
      jet.position.y = 0.62 + 1.4 * s;
      const cas = new THREE.Mesh(this.flowUV(new THREE.ConeGeometry(1.25 * s, 1.9 * s, 22, 1, true), 'down', 3), fallM);
      cas.position.y = 0.62 + 2.8 * s - 0.95 * s;
      g.add(basin, water, jet, cas);
      this.root.add(g);
    }
    // Fish leaping out of the lagoon now and then (only drawn while the camera is low).
    const fishM = [0xff8a3d, 0xffd23d, 0x5ab8ff, 0xff5a8a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2 }));
    for (const [i, d] of D('fish').entries()) {
      const f = new THREE.Mesh(this.fishGeo(), fishM[i % 4]);
      f.scale.setScalar(d.s);
      f.visible = false;
      this.root.add(f);
      this.anim.push(f);
      const dx = Math.cos(d.ry), dz = -Math.sin(d.ry);
      this.fishFx.push((t, cam) => {
        const u = ((t / d.per + d.ph) % 1) * d.per, k = u / 1.2;
        f.visible = k < 1 && (!cam || cam.y < 140);
        if (!f.visible) return;
        const along = (k - 0.5) * 4;
        f.position.set(d.x + dx * along, -0.4 + 2.4 * 4 * k * (1 - k), d.z + dz * along);
        f.rotation.set(0, d.ry, Math.atan(2.4 * 4 * (1 - 2 * k) / 4), 'YXZ');
      });
    }
  }

  // Water slides and lazy rivers: flowing water on top (and side rails on the slides).
  buildFlows() {
    const flows = this.level.flows;
    if (!flows.length) return;
    const slideM = this.waterMat({ speed: 0.9, alpha: 0.8, color: 0x5ad8f8 }), riverM = this.waterMat({ speed: 0.5, alpha: 0.8, color: 0x3fb8e8 });
    for (const c of flows) {
      const g = new THREE.Group();
      g.position.set(c.x, c.y, c.z);
      g.rotation.set(c.rx, c.ry, c.rz, 'YXZ');
      const slide = c.kind === 'slide';
      const plane = new THREE.PlaneGeometry(c.hx * 2 - 0.05, c.hz * 2 - 0.1).rotateX(-Math.PI / 2);
      this.flowUV(plane, slide ? 'x' : 'z', slide ? 1 : Math.sign(c.conv.sp));
      const w = new THREE.Mesh(plane, slide ? slideM : riverM);
      w.position.y = c.hy + 0.025;
      g.add(w);
      if (slide) {
        // Half pipe: walls flaring out on both sides with a rounded lip.
        const wall = new THREE.BoxGeometry(c.hx * 2, 0.62, 0.08), lip = new THREE.CylinderGeometry(0.07, 0.07, c.hx * 2, 8).rotateZ(Math.PI / 2);
        const rm = new THREE.MeshStandardMaterial({ color: c.look ? c.look.c : 0x2a9ae8, roughness: 0.25, metalness: 0.1 });
        for (const sg of [-1, 1]) {
          const w2 = new THREE.Mesh(wall, rm);
          w2.position.set(0, c.hy + 0.26, sg * (c.hz + 0.12));
          w2.rotation.x = sg * 0.55;
          const l2 = new THREE.Mesh(lip, rm);
          l2.position.set(0, c.hy + 0.53, sg * (c.hz + 0.28));
          g.add(w2, l2);
        }
      }
      this.root.add(g);
    }
  }

  // Waterfall: little falls spilling off the floating islands (scenery.js decides where).
  buildSmallFalls() {
    if (!this.islandFalls.length) return;
    // Off the edge of a floating island: it pours over the lip and, with nothing below to land on, spreads out and
    // turns to spray on the way down (fallMat fade), with a cloud of mist where it is gone.
    const m = fallMat(this, { speed: 0.9, fade: true });
    for (const f of this.islandFalls) {
      const h = f.h * 1.5, g = new THREE.PlaneGeometry(f.w, h, 1, 8), pos = g.attributes.position, uv = g.attributes.uv, k01 = [];
      for (let k = 0; k < pos.count; k++) { uv.setXY(k, pos.getX(k) / f.w + 0.5, pos.getY(k) * 0.08); k01.push(0.5 - pos.getY(k) / h); }
      g.setAttribute('aK', new THREE.Float32BufferAttribute(k01, 1));
      const p = new THREE.Mesh(g, m);
      p.position.set(f.x, f.y - h / 2 + 0.1, f.z);
      p.rotation.y = f.ry + Math.PI / 2;
      this.add(p, false);
      this.mistSpots.push({ x: f.x, y: f.y - h * 0.75, z: f.z, r: f.w * 0.9, n: 10, rise: 3 });
    }
  }

  // Launch slide kickers: glowing arrows pointing where you'll fly.
  buildKickers() {
    const ks = this.level.cols.filter((c) => c.launch);
    if (!ks.length) return;
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, -0.35); sh.lineTo(0.1, -0.35); sh.lineTo(0.1, -0.6); sh.lineTo(0.6, 0); sh.lineTo(0.1, 0.6); sh.lineTo(0.1, 0.35); sh.lineTo(-0.5, 0.35);
    const ag = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
    for (const c of ks) {
      const m = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: HDR(c.look ? c.look.g : 0xffffff, 2.2) }));
      const s = Math.min(c.hx, c.hz) * 1.4;
      m.scale.setScalar(s);
      m.position.set(c.x, c.y + c.hy + 0.03, c.z);
      m.rotation.y = Math.atan2(-(c.launch.z - c.z), c.launch.x - c.x);
      this.add(m, false);
    }
  }

  // Vents and falling things: the volcano's own, and the themed ones every map now has.
  buildVentsRocks() {
    const L = this.level;
    // Vents: a dark ring with a glowing middle; when erupting, a column of fire.
    const ringG = new THREE.TorusGeometry(0.75, 0.16, 8, 24).rotateX(Math.PI / 2), coreG = new THREE.CircleGeometry(0.62, 20).rotateX(-Math.PI / 2);
    const colG = new THREE.CylinderGeometry(0.55, 0.9, 1, 16, 1, true).translate(0, 0.5, 0);
    const ringM = panelMat(0x1a1210, { roughness: 0.9, pattern: 0 });
    const colM = new THREE.MeshBasicMaterial({ color: HDR(0xff8a2a, 3), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const colFor = (look) => (look ? new THREE.MeshBasicMaterial({ color: HDR(look.g, 2.6), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }) : colM);
    for (const v of L.geysers) {
      const ring = this.add(new THREE.Mesh(ringG, ringM));
      ring.position.set(v.x, v.y + 0.05, v.z);
      const glowM = new THREE.MeshBasicMaterial({ color: HDR(v.look ? v.look.g : 0xff6a1a, 1.5) });
      glowM.userData.live = true;
      const core = new THREE.Mesh(coreG, glowM);
      core.position.set(v.x, v.y + 0.03, v.z);
      this.add(core, false);
      const col = new THREE.Mesh(colG, colFor(v.look));
      col.position.set(v.x, v.y, v.z);
      col.visible = false;
      this.root.add(col);
      this.anim.push(col);
      this.geyserFx.push({ v, glowM, col });
    }
    // Boulders: one rock and one shadow per drop spot.
    const rockG = new THREE.DodecahedronGeometry(0.75, 0), rockM = panelMat(0x3a2a24, { roughness: 1, emissive: 0xff4a10, emissiveIntensity: 0.15, pattern: 0 });
    const shadowG = new THREE.CircleGeometry(1.2, 24).rotateX(-Math.PI / 2);
    // Waterfall: tipping buckets drop a big blob of water instead of a rock.
    const blobG = new THREE.SphereGeometry(0.75, 16, 12).scale(1.1, 1.3, 1.1);
    const blobM = new THREE.MeshStandardMaterial({ color: 0x8fe8ff, roughness: 0.05, metalness: 0.1, emissive: 0x2a7a9a, emissiveIntensity: 0.6, transparent: true, opacity: 0.72 });
    for (const r of L.rocks) {
      const m = this.add(new THREE.Mesh(r.look && r.look.s === 'water' ? blobG : rockG, r.look ? (r.look.s === 'water' ? blobM : this.lookMat(r.look)) : rockM));
      m.visible = false;
      const shM = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
      shM.userData.live = true;
      const sh = new THREE.Mesh(shadowG, shM);
      sh.position.set(r.x, r.y + 0.04, r.z);
      this.add(sh, false);
      this.anim.push(m);
      this.rockFx.push({ r, m, sh, shM, p: {} });
    }
  }

  // Volcano: the inside of a hollow chimney (glowing cracks in dark rock), vents, boulders and embers.
  buildVolcano() {
    if (this.key !== 'volcano') return;
    // The chimney's rock inside and out, its lava and the lake that rises (volcanoview.js).
    buildVolcanoView(this);
  }

  // City: the ring of skyscrapers (lit windows, billboards, roof antennas) and the conveyor belts.
  buildCity() {
    const L = this.level;
    if (this.key === 'city') {
      const H = L.top + 20, y0 = -20, y1 = L.top;
      // Every tower its own kind of building and its own shape (towerLoop), its walls from coreview.js cityFacade.
      const KINDS = [['glass', 190, 0.75, 0.18], ['neon', 300, 0.5, 0.4], ['grid', 45, 0.08, 0.85], ['tech', 170, 0.3, 0.42], ['deco', 30, 0.05, 0.85]];
      const roof = panelMat(0x2a2836, { metalness: 0.5, roughness: 0.6, pattern: 0 }), steel = panelMat(0x3a3e46, { metalness: 0.8, roughness: 0.35, pattern: 0 });
      const ledgeM = panelMat(0x8a8e96, { metalness: 0.6, roughness: 0.5, pattern: 0, side: THREE.DoubleSide });
      this.cityTowers = [];
      for (const [ti, t] of L.towers.entries()) {
        const [kind, hue, metal, rough] = KINDS[ti % KINDS.length], loopAt = towerLoop(kind, t.a);
        const { map, glow, tileH } = cityFacade(kind, 51 + ti * 7, hue);
        const look = panelMat(0xffffff, { map, metalness: metal, roughness: rough, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: kind === 'glass' ? 1.1 : 1.0, pattern: 0 });
        const wall = new THREE.Mesh(towerWall(loopAt, y0, y1, kind === 'tech' ? Math.ceil((y1 - y0) / 4) : 1, 8.6, tileH), look);
        wall.position.set(t.x, 0, t.z);
        this.add(wall);
        // The roof: the shape at the top, closed.
        const top = loopAt(y1), sh = new THREE.Shape(top.map(([x, z]) => new THREE.Vector2(x, -z)));
        const cap = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), roof);
        cap.position.set(t.x, y1 + 0.01, t.z);
        this.add(cap);
        const glowM = new THREE.MeshBasicMaterial({ color: HDR(new THREE.Color().setHSL(hue / 360, 1, 0.58).getHex(), 2.0), side: THREE.DoubleSide });
        // Ledges round it every so often (not on the twisting one), lines of light under some, and each kind's own trim.
        const ledges = [], lights = [], every = { glass: 30, neon: 36, grid: 22, tech: 32, deco: 26 }[kind];
        for (let y = y0 + every; y < y1 - 6; y += every) {
          if (kind === 'tech') { bandAt(lights, loopAt(y), y, 0.06, 0.14); continue; }
          bandAt(ledges, loopAt(y), y, 0.3, 0.32);
          if (kind === 'glass' || kind === 'neon') bandAt(lights, loopAt(y), y - 0.1, 0.32, 0.06);
        }
        bandAt(ledges, top, y1 - 0.4, 0.22, 1.0);
        for (const [list, m] of [[ledges, ledgeM], [lights, glowM]]) {
          if (!list.length) continue;
          const o = new THREE.Mesh(bandGeo(list), m);
          o.position.set(t.x, 0, t.z);
          this.add(o, m !== glowM);
        }
        if (kind === 'glass') {
          // Two lines of light winding up round it.
          for (const ph of [0, Math.PI]) {
            const pts = [];
            for (let y = y0; y <= y1; y += 2) { const a = ph + (y / 46) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 6.02, y, Math.sin(a) * 6.02)); }
            const helix = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, 0.07, 5, false), glowM);
            helix.position.set(t.x, 0, t.z);
            this.add(helix, false);
          }
        }
        if (kind === 'neon' || kind === 'deco') {
          // Neon down every corner of the octagon; stone piers up the twelve corners of the brick one.
          const n = kind === 'neon' ? 8 : 12, r = kind === 'neon' ? 6.15 : 6.0, a0 = t.a + (kind === 'neon' ? Math.PI / 8 : 0);
          const im = new THREE.InstancedMesh(BOXG, kind === 'neon' ? glowM : panelMat(0xc8b898, { roughness: 0.85, metalness: 0, pattern: 0 }), n);
          for (let k = 0; k < n; k++) {
            const a = a0 + (k / n) * TAU, w = kind === 'neon' ? 0.12 : 0.55;
            im.setMatrixAt(k, mat4(t.x + Math.cos(a) * (r + (kind === 'neon' ? 0.02 : 0.1)), (y0 + y1) / 2, t.z + Math.sin(a) * (r + (kind === 'neon' ? 0.02 : 0.1)), w, y1 - y0, w, 0, -a, 0));
          }
          this.add(im, kind !== 'neon');
        }
        this.cityTowers.push({ t, kind, hue, loopAt, reach: (a, y) => rayLoop(loopAt(y), Math.cos(a), Math.sin(a)) });
        this.cityRoof(t, y1, ti, hue, steel);
      }
      this.citySigns(H);
    }
    // Conveyor belts: chevrons scrolling the way the belt moves.
    const belts = L.cols.filter((c) => c.conv && !c.flow);
    if (!belts.length) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(0x11141c) }, uB: { value: HDR(0xffc23d, 2.2) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uA, uB; varying vec2 vUv;
        void main(){ float s = fract(vUv.x - uTime * 0.9 - abs(vUv.y - 0.5) * 0.8);
          float k = smoothstep(0.42, 0.5, s) * (1.0 - smoothstep(0.62, 0.7, s));
          gl_FragColor = vec4(mix(uA, uB, k), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    for (const c of belts) {
      const g = new THREE.PlaneGeometry(c.hx * 2 - 0.2, c.hz * 2 - 0.2).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, k = (c.hx * 2) / 1.4, dir = c.conv.sp > 0 ? 1 : -1;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k * dir);
      const m = new THREE.Mesh(g, mat);
      m.position.set(c.x, c.y + c.hy + 0.015, c.z);
      m.rotation.y = c.ry;
      this.add(m, false);
    }
    this.convFx = mat;
  }

  // City: what stands on each tower's roof: a spire, a helipad, a stepped crown, a cluster of masts, or a water tank.
  cityRoof(t, y, ti, hue, steel) {
    const glowM = new THREE.MeshBasicMaterial({ color: HDR(new THREE.Color().setHSL(hue / 360, 1, 0.6).getHex(), 2.2) });
    const red = new THREE.MeshBasicMaterial({ color: HDR(0xff3040, 1.6) });
    const put = (geo, mat, x, yy, z, sx = 1, sy = 1, sz = 1, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(t.x + x, y + yy, t.z + z); m.scale.set(sx, sy, sz); m.rotation.y = ry; this.add(m, mat !== glowM && mat !== red); return m; };
    const CY = new THREE.CylinderGeometry(1, 1, 1, 16), CO = new THREE.ConeGeometry(1, 1, 16), ry = -t.a;
    switch (ti % 5) {
      case 0: // a spire with rings of light
        put(CY, steel, 0, 2, 0, 2.6, 4, 2.6);
        put(CO, steel, 0, 4 + 14, 0, 1.4, 28, 1.4);
        for (const k of [0, 1, 2, 3]) put(new THREE.TorusGeometry(1.2 - k * 0.25, 0.06, 6, 24).rotateX(Math.PI / 2), glowM, 0, 6 + k * 5, 0);
        put(new THREE.SphereGeometry(0.4, 10, 8), red, 0, 32.4, 0);
        break;
      case 1: { // a helipad on legs, lights round its edge and an H
        put(CY, steel, 0, 1.6, 0, 3.6, 0.3, 3.6);
        for (const k of [0, 1, 2, 3]) put(CY, steel, Math.cos(k * 1.57 + 0.78) * 2.2, 0.75, Math.sin(k * 1.57 + 0.78) * 2.2, 0.15, 1.5, 0.15);
        put(new THREE.TorusGeometry(3.5, 0.06, 6, 48).rotateX(Math.PI / 2), glowM, 0, 1.78, 0);
        for (const [x, z, w, d] of [[-0.6, 0, 0.25, 1.8], [0.6, 0, 0.25, 1.8], [0, 0, 1.0, 0.25]]) put(BOXG, glowM, x, 1.77, z, w, 0.02, d, ry);
        put(CY, steel, 2.6, 4, 2.6, 0.08, 6, 0.08);
        put(new THREE.SphereGeometry(0.3, 10, 8), red, 2.6, 7.1, 2.6);
        break;
      }
      case 2: // a stepped crown, each step edged with light
        for (const [k, w] of [[0, 6.4], [1, 4.6], [2, 2.8]]) {
          put(BOXG, steel, 0, 1.5 + k * 3, 0, w, 3, w, ry);
          put(BOXG, glowM, 0, 3.02 + k * 3, 0, w + 0.1, 0.06, w + 0.1, ry);
        }
        put(CY, steel, 0, 13, 0, 0.12, 8, 0.12);
        put(new THREE.SphereGeometry(0.35, 10, 8), red, 0, 17.2, 0);
        break;
      case 3: // masts and a dish
        for (const [x, z, h] of [[-2, -1.5, 14], [1.8, -2, 9], [0.5, 2.2, 18]]) {
          put(CY, steel, x, h / 2, z, 0.14, h, 0.14);
          put(new THREE.SphereGeometry(0.28, 10, 8), red, x, h + 0.2, z);
        }
        put(new THREE.SphereGeometry(1.6, 16, 8, 0, TAU, 0, 1.0).rotateX(-1.1), steel, -1.5, 2.6, 1.5, 1, 1, 1, ry + 0.7);
        put(BOXG, steel, 2, 1, 1.5, 2.2, 2, 1.4, ry);
        break;
      default: // a water tank on legs and a lit sign frame
        put(CY, panelMat(0x8a6a4a, { roughness: 0.9, pattern: 3 }), 1.5, 4.2, 1.5, 1.6, 3.2, 1.6);
        put(CO, steel, 1.5, 6.4, 1.5, 1.8, 1.2, 1.8);
        for (const k of [0, 1, 2, 3]) put(CY, steel, 1.5 + Math.cos(k * 1.57) * 1.3, 1.3, 1.5 + Math.sin(k * 1.57) * 1.3, 0.1, 2.6, 0.1);
        put(BOXG, steel, -1.8, 2.5, -1.2, 0.3, 5, 4, ry);
        put(BOXG, glowM, -1.6, 2.5, -1.2, 0.05, 4.6, 3.6, ry);
    }
  }

  // City: vertical neon signs on the towers' corners and big screens with adverts on their faces, each from one
  // picture of all of them (a column per sign, a cell per screen).
  citySigns(H) {
    const L = this.level, R = rng(616), d = detail(), WORDS = ['HOTEL', 'RAMEN', 'ARCADE', 'BAR', '24H', 'ROBOTS', 'SUSHI', 'CYBER', 'NOODLE', 'TAXI', 'CLUB', 'NEON'];
    const HUES = [190, 300, 45, 120, 330, 20, 270, 160];
    const words = canvasTex(1536, 1024, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 1536, 1024);
      WORDS.forEach((w, i) => {
        const x = i * 128, hu = HUES[i % HUES.length], n = w.length, step = Math.min(150, 960 / n);
        g.strokeStyle = `hsl(${hu},100%,62%)`; g.lineWidth = 8; g.strokeRect(x + 10, 10, 108, 1004);
        g.fillStyle = `hsl(${hu},100%,${70}%)`; g.font = `bold ${Math.min(96, step * 0.82)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = `hsl(${hu},100%,55%)`; g.shadowBlur = 18;
        for (let k = 0; k < n; k++) g.fillText(w[k], x + 64, 512 + (k - (n - 1) / 2) * step);
        g.shadowBlur = 0;
      });
    });
    const ADS = [['NEON COLA', 350, 'bottle'], ['SKYCAR', 190, 'car'], ['ROBOTIX', 120, 'bot'], ['MOON TRIPS', 260, 'moon'], ['PIXEL BURGER', 30, 'burger'], ['ZAP', 55, 'bolt']];
    const ads = canvasTex(1536, 512, (g) => {
      ADS.forEach(([text, hu, pic], i) => {
        const x = (i % 3) * 512, y = Math.floor(i / 3) * 256, gr = g.createLinearGradient(x, y, x + 512, y + 256);
        gr.addColorStop(0, `hsl(${hu},80%,22%)`); gr.addColorStop(1, `hsl(${(hu + 60) % 360},90%,12%)`);
        g.fillStyle = gr; g.fillRect(x, y, 512, 256);
        for (let k = 0; k < 12; k++) { g.fillStyle = `hsla(${hu},100%,70%,0.12)`; g.fillRect(x, y + k * 22, 512, 3); }
        g.save(); g.translate(x + 120, y + 128); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`;
        if (pic === 'bottle') { g.fillRect(-22, -30, 44, 100); g.fillRect(-10, -70, 20, 44); g.beginPath(); g.arc(0, -30, 22, Math.PI, 0); g.fill(); }
        else if (pic === 'car') { g.beginPath(); g.ellipse(0, 10, 90, 26, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(-10, -12, 44, 26, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.fillRect(70, 4, 18, 8); }
        else if (pic === 'bot') { g.fillRect(-50, -50, 100, 80); g.fillStyle = '#000'; g.fillRect(-36, -26, 72, 18); g.fillStyle = '#7fd8ff'; g.fillRect(-30, -22, 60, 10); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`; g.fillRect(-4, -80, 8, 30); }
        else if (pic === 'moon') { g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,0.25)'; for (const [a, b, r] of [[-20, -20, 14], [24, 10, 18], [-10, 34, 10]]) { g.beginPath(); g.arc(a, b, r, 0, TAU); g.fill(); } }
        else if (pic === 'burger') { g.beginPath(); g.ellipse(0, -20, 70, 40, 0, Math.PI, 0); g.fill(); g.fillStyle = '#5a3'; g.fillRect(-72, -18, 144, 12); g.fillStyle = '#842'; g.fillRect(-70, -6, 140, 22); g.fillStyle = `hsl(${(hu + 180) % 360},100%,70%)`; g.fillRect(-70, 16, 140, 20); }
        else { g.beginPath(); g.moveTo(-10, -90); g.lineTo(40, -90); g.lineTo(10, -10); g.lineTo(45, -10); g.lineTo(-30, 90); g.lineTo(-5, 10); g.lineTo(-40, 10); g.closePath(); g.fill(); }
        g.restore();
        g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
        const tw = g.measureText(text).width;
        if (tw > 256) g.font = `bold ${Math.floor(60 * 256 / tw)}px sans-serif`;
        g.shadowColor = `hsl(${hu},100%,60%)`; g.shadowBlur = 16; g.fillText(text, x + 236, y + 128); g.shadowBlur = 0;
        g.strokeStyle = `hsl(${hu},100%,65%)`; g.lineWidth = 6; g.strokeRect(x + 4, y + 4, 504, 248);
      });
    });
    // Signs flat, facing out, just clear of the wall; screens bent round it. Each a strip of columns [x, z] going the
    // way the angle grows.
    const quads = { words: [], ads: [] }, backs = [];
    const nSign = [5, 9, 13][d], nAd = [3, 6, 8][d];
    for (const { t, loopAt, reach } of this.cityTowers) {
      for (let k = 0; k < nSign + nAd; k++) {
        const ad = k >= nSign, a = R() * TAU, y = 8 + R() * (H - 60), nx = Math.cos(a), nz = Math.sin(a);
        const w = ad ? 5.6 : 1.1, h = ad ? 2.8 : 6 + R() * 3, ys = [y - h / 2, y, y + h / 2];
        const wi = (R() * WORDS.length) | 0, ai = (R() * ADS.length) | 0;
        const uv = ad ? [(ai % 3) / 3, 1 - (Math.floor(ai / 3) + 1) / 2, (ai % 3 + 1) / 3, 1 - Math.floor(ai / 3) / 2] : [wi / 12, 0, (wi + 1) / 12, 1];
        if (ad) {
          const r0 = Math.max(...ys.map((yy) => reach(a, yy))), span = w / r0, cols = [];
          for (let j = 0; j <= 10; j++) {
            const b = a + (j / 10 - 0.5) * span, r = Math.max(...ys.map((yy) => reach(b, yy))) + 0.22;
            cols.push([t.x + Math.cos(b) * r, t.z + Math.sin(b) * r]);
          }
          quads.ads.push({ cols, y, h, uv });
          continue;
        }
        let out = 0;
        for (const yy of ys) for (const [x, z] of loopAt(yy)) out = Math.max(out, x * nx + z * nz);
        const cx = t.x + nx * (out + 0.32), cz = t.z + nz * (out + 0.32);
        quads.words.push({ cols: [[cx + nz * w / 2, cz - nx * w / 2], [cx - nz * w / 2, cz + nx * w / 2]], y, h, uv });
        backs.push(mat4(t.x + nx * (out + 0.17), y, t.z + nz * (out + 0.17), 0.26, h + 0.3, w + 0.3, 0, -a, 0));
      }
    }
    const build = (list, tex, k) => {
      const pos = [], uvs = [], idx = [];
      for (const q of list) {
        const n = q.cols.length - 1, b0 = pos.length / 3;
        q.cols.forEach(([x, z], j) => {
          const u = q.uv[2] + (q.uv[0] - q.uv[2]) * (j / n);
          pos.push(x, q.y - q.h / 2, z, x, q.y + q.h / 2, z);
          uvs.push(u, q.uv[1], u, q.uv[3]);
        });
        for (let j = 0; j < n; j++) { const b = b0 + j * 2; idx.push(b, b + 2, b + 3, b, b + 3, b + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      this.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: HDR(0xffffff, k), side: THREE.DoubleSide })), false);
    };
    build(quads.words, words, 1.8);
    build(quads.ads, ads, 1.3);
    const bm = new THREE.InstancedMesh(BOXG, panelMat(0x1a1a22, { metalness: 0.7, roughness: 0.4, pattern: 0 }), backs.length);
    backs.forEach((m, i) => bm.setMatrixAt(i, m));
    this.add(bm);
  }

  // Far-off land round every map (backdrop.js, and wildview.js for the Wild Forest).
  buildDistantAlt() {
    if (this.key === 'volcano') return calderaLands(this);
    if (this.key === 'city') return cityLands(this);
    if (this.key === 'waterfall') return this.buildCliffs();
    if (this.key === 'forest') return buildWildlands(this);
    sunnyLands(this);
  }

  // Animate everything that moves. t is shared game time, warn(r) returns rod warning 0..1.
  // Before each physics step: where the moving platforms are now, so they can be drawn between two steps.
  snapDyn() {
    for (const d of this.dyn) { if (d.far) continue; const c = d.c; d.ox = c.x; d.oy = c.y; d.oz = c.z; d.ory = c.ry; }
  }

  update(t, dt, storm, alpha = 1) {
    // The clock the water and glow shaders see. It restarts every hour, so it stays small on long or resumed
    // climbs: phone GPUs lose precision on big numbers, and the moving water went flat and faded out.
    const wt = t % 3600;
    const tick = (this.tick = (this.tick || 0) + 1), eye = this.camPos, dyn = this.dyn;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i], c = d.c, m = d.mesh;
      if (d.off) continue;
      // Far above or below the camera a quarter of the updates is plenty: nobody can tell from there.
      const far = !!eye && Math.abs(c.y - eye.y) > 70;
      if (far && d.far && ((i + tick) & 3) !== 0) continue;
      if (d.far && !far) { d.ox = c.x; d.oy = c.y; d.oz = c.z; d.ory = c.ry; }
      d.far = far;
      if (d.ox === undefined || far) {
        m.position.set(c.x, c.y, c.z);
        if (d.lrx !== c.rx || d.lry !== c.ry || d.lrz !== c.rz) { d.lrx = c.rx; d.lry = c.ry; d.lrz = c.rz; m.rotation.set(c.rx, c.ry, c.rz, 'YXZ'); }
      } else {
        // The same moment the climber is drawn at, so standing on one stays exact.
        m.position.set(d.ox + (c.x - d.ox) * alpha, d.oy + (c.y - d.oy) * alpha, d.oz + (c.z - d.oz) * alpha);
        // Setting a rotation is slow, even to the same value, and most of these never turn.
        const dr = c.ry - d.ory, ry = Math.abs(dr) < 1 ? d.ory + dr * alpha : c.ry;
        if (d.lrx !== c.rx || d.lry !== ry || d.lrz !== c.rz) { d.lrx = c.rx; d.lry = ry; d.lrz = c.rz; m.rotation.set(c.rx, ry, c.rz, 'YXZ'); }
      }
      if (d.car && d.ox !== undefined && !far) {
        // Facing the way it goes: its own x axis is (cos ry, -sin ry) on the ground.
        const v = (c.x - d.ox) * Math.cos(c.ry) - (c.z - d.oz) * Math.sin(c.ry);
        if (Math.abs(v) > 1e-4) d.face = v > 0 ? 0 : Math.PI;
        const r = d.car.rotation.y;
        if (Math.abs(d.face - r) > 0.002) d.car.rotation.y = r + (d.face - r) * Math.min(1, dt * 3.5);
      }
      // Always solid, but it keeps fading out of sight.
      if (c.ghost) m.material.opacity = clamp(0.5 + 0.9 * Math.sin((Math.PI * 2 * t) / c.ghost.per + c.ghost.ph * Math.PI * 2), 0.04, 1);
      if (c.blink) {
        const st = storm.on(c.blink) ? storm.blink(c.blink, t) : { on: true, warn: 0 };
        m.visible = st.on;
        m.material.opacity = st.warn > 0 ? 0.35 + 0.65 * (Math.sin(t * 40) > 0 ? 1 : 0.3) : 1;
      } else if (c.trap) {
        const st = storm.on(c.trap) ? storm.trap(c.trap, t) : { open: false, warn: 0 };
        m.visible = !st.open;
        if (st.warn > 0) { m.position.x += (Math.random() - 0.5) * 0.06; m.position.z += (Math.random() - 0.5) * 0.06; }
      }
      if (c.crumble) {
        const s = c.crumble.st;
        if (s === 1) m.position.x += (Math.random() - 0.5) * 0.08, m.position.z += (Math.random() - 0.5) * 0.08;
        if (s === 2) { d.fall += far ? dt * 4 : dt; m.position.y -= d.fall * d.fall * 9; m.visible = d.fall < 1.4; }
        else { d.fall = 0; m.visible = true; }
      }
    }
    if (!THIN || (tick & 1) === 0) {
    const adt = THIN ? dt * 2 : dt;
    for (const c of this.pads) {
      const k = 1 + 0.12 * Math.sin(t * 6);
      c.fx.scale.set(k, 1, k);
    }
    for (const b of this.relicBeams || []) if (b.part || b.o.visible) b.o.material.uniforms.uT.value = wt;
    if (eye) for (const f of this.facing || []) {
      const dx = eye.x - f.x, dz = eye.z - f.z;
      if (dx * dx + dz * dz < 2500) f.o.rotation.y = Math.atan2(dx, dz) - f.ry;
    }
    for (const e of this.cps) { e.halo.rotation.y = t * 1.5; e.halo.rotation.x = Math.sin(t) * 0.4; e.beam.material.uniforms.uT.value = wt; }
    for (const r of this.rods) {
      const w = storm.rodWarn(r.r, t);
      r.warnMat.opacity = w * (0.55 + 0.45 * Math.sin(t * 30));
      r.tipMat.color.setHex(0xb9a6ff).multiplyScalar(2 + w * 6);
      r.tip.scale.setScalar(1 + w * 0.8);
    }
    for (const f of this.fans) {
      const on = storm.fanOn(f.f, t);
      f.spin += adt * (on ? 28 : 2.5);
      f.rotor.rotation.z = f.spin;
      f.sm.uniforms.uT.value = wt;
      f.sm.uniforms.uOn.value += ((on ? 1 : 0) - f.sm.uniforms.uOn.value) * Math.min(1, adt * 8);
    }
    for (const s of this.spin) s.o.rotation[s.axis] += s.sp * adt;
    for (const b of this.blink) {
      const k = b.sq ? (Math.sin(t * b.sp) > 0.6 ? 1 : 0.15) : 0.7 + 0.3 * Math.sin(t * b.sp);
      b.m.color.setHex(b.hex).multiplyScalar(b.base * k);
    }
    }
    // The drifting rocks are slow and the native side only takes them 15 times a second anyway.
    const rd = (tick & 3) === 0 ? this.rockData : null;
    if (rd) for (let i = 0; i < rd.length; i++) {
      const d = rd[i];
      this.rocks.setMatrixAt(i, mat4(d.x, d.y + Math.sin(t * 0.3 + i) * 1.5, d.z, d.s, d.s * 0.8, d.s, d.rx + t * d.sp, d.ry + t * d.sp * 0.7, 0));
    }
    if (rd) this.rocks.instanceMatrix.needsUpdate = true;
    this.beam.material.uniforms.uT.value = wt;
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
      const l = e.l, vis = near(l.y) && storm.on(l);
      if (l.k === 'spin') {
        e.g.visible = vis;
        if (vis) e.g.rotation.y = storm.laserAngle(l, t);
      } else if (l.k === 'bar') {
        e.g.visible = vis;
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
      if (!near(a.y) || !storm.on(a)) { e.m.visible = false; continue; }
      const p = storm.arrow(a, t, e.p);
      e.m.visible = p.fly;
      if (p.fly) e.m.position.set(p.x, p.y, p.z);
    }
    for (const e of this.obsFx) {
      const show = near(e.o.y) && storm.on(e.o);
      e.obj.visible = show;
      if (show) e.upd(storm, t);
    }
    for (const e of this.geyserFx) {
      const v = e.v;
      if (!near(v.y) || !storm.on(v)) { e.col.visible = false; continue; }
      const st = storm.geyser(v, t);
      e.col.visible = st.on;
      if (st.on) e.col.scale.set(1 + Math.sin(t * 30) * 0.08, 6.5 * Math.min(1, st.k * 6) * (1 - Math.max(0, st.k - 0.8) * 4), 1 + Math.cos(t * 26) * 0.08);
      e.glowM.color.setHex(v.look ? v.look.g : 0xff6a1a).multiplyScalar(st.on ? 4 : 1.2 + st.warn * (2 + Math.sin(t * 40) * 1.5));
    }
    for (const e of this.rockFx) {
      const r = e.r;
      if (!near(r.y) || !storm.on(r)) { e.m.visible = false; e.shM.opacity = 0; continue; }
      const st = storm.rock(r, t, e.p);
      e.m.visible = st.fall >= 0 || st.rest;
      if (e.m.visible) { e.m.position.set(r.x, st.rest && st.fall < 0 ? r.y + 0.7 - (t % 1) * 0 : st.y, r.z); e.m.rotation.set(t * 3 + r.i, t * 2, 0); }
      e.shM.opacity = st.warn * 0.55;
      const k = 0.4 + st.warn * 0.6;
      e.sh.scale.set(k, 1, k);
    }
    if (this.embers && cam) { this.embers.position.y = cam.y - 20 + ((t * 1.6) % 10); this.embers.rotation.y = t * 0.05; }
    if (this.convFx) this.convFx.uniforms.uTime.value = wt;
    for (const m of this.waters) m.uniforms.uT.value = wt;
    for (const m of this.timeMats) m.uniforms.uT.value = wt;
    for (const f of this.onFrame) f(t, dt);
    this.updateBands();
    for (const e of this.fishFx) e(t, cam);
    for (const e of this.swingFx) {
      const d = e.d, c = e.sw.col;
      for (const r of e.ropes) {
        const ax = d.px + e.nx * r.s * 1.0, az = d.pz + e.nz * r.s * 1.0, bx = c.x + e.nx * r.s * 1.0, bz = c.z + e.nz * r.s * 1.0;
        stretchTo(r.r, ax, d.py, az, bx, c.y + 0.25, bz);
      }
    }
    if (!cam || cam.y < 60) updateStart(this, t);
    for (const e of this.monsters) {
      const m = e.m, near = !cam || Math.abs(m.y - cam.y) < 45;
      e.o.visible = near;
      if (!near) continue;
      const p = storm.monsterPos(m, t, e.p), o = e.o;
      // A creature after you moves in the physics' 1/60 s steps: drawn between the last two, like your climber, so it
      // glides on a faster screen instead of stepping.
      if (p.hunt) {
        const k = Math.round(t * 60 + 1 - alpha), I = e.ip || (e.ip = { k: -9, x0: 0, z0: 0, x1: 0, z1: 0 });
        if (k - I.k !== 1 && k !== I.k || Math.abs(p.x - I.x1) + Math.abs(p.z - I.z1) > 2) { I.x0 = I.x1 = p.x; I.z0 = I.z1 = p.z; }
        else if (k !== I.k) { I.x0 = I.x1; I.z0 = I.z1; I.x1 = p.x; I.z1 = p.z; }
        I.k = k;
        p.x = I.x0 + (I.x1 - I.x0) * alpha; p.z = I.z0 + (I.z1 - I.z0) * alpha;
      } else if (e.ip) e.ip.k = -9;
      const dx = p.hunt ? p.hx : (m.bx - m.ax) * p.dir, dz = p.hunt ? p.hz : (m.bz - m.az) * p.dir;
      if (e.beast) {
        // Walks on the floor (the hop is only for the blob monsters): a little sway in its stride, a shake when stunned. After
        // you it runs, with its head low, and it snaps forward as it bites.
        const walk = p.stunned ? 0 : t * (p.hunt ? 15 : 9) + m.i, snap = p.hunt ? p.lunge * (m.mz !== undefined ? 0.15 : 0.5) : 0;
        o.position.set(p.x + dx * snap, m.y - 0.65 + Math.abs(Math.sin(walk)) * (p.hunt ? 0.05 : 0.025), p.z + dz * snap);
        o.rotation.set(0, dx || dz ? Math.atan2(dx, dz) : o.rotation.y, p.stunned ? Math.sin(t * 25) * 0.25 : Math.sin(walk) * 0.03, 'YXZ');
        if (e.limbs) poseLimbs(e.limbs, p.stunned ? 0 : walk, p.hunt, p.stunned, t);
        if (this.app && this.app.sound) this.beastVoice(e, p);
        continue;
      }
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, Math.atan2(dx, dz), p.stunned ? Math.sin(t * 25) * 0.3 : 0, 'YXZ');
      const sq = p.stunned ? 0.6 : 1 + 0.08 * Math.sin(t * 9 + m.i);
      o.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
    for (const e of this.bats) {
      const b = e.b, near = (!cam || Math.abs(b.cy - cam.y) < 45) && storm.on(b);
      e.o.visible = near;
      if (!near) continue;
      const p = storm.batPos(b, t, e.p), o = e.o;
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.stunned ? 0.9 : 0, -p.a + (b.per > 0 ? 0 : Math.PI), p.stunned ? t * 12 : 0, 'YXZ');
      const fl = this.key === 'city' || this.key === 'waterfall' ? 1 : p.stunned ? 0.5 : 1 + 0.45 * Math.sin(t * 22 + b.i);
      o.scale.set(1.5 * fl, 1.5, 1.5);
    }
  }
}

export { HDR, mat4, canvasTex, merge, trimParts };
