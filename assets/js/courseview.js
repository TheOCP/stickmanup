// How the relic courses look on each map: their stones, gate, sign and vault in the map's own materials, with vines, trees and
// whatever else grows or hangs there all around them, and the obstacles that are something else on each map. How they work
// is all in level.js and storm.js: nothing in here changes that.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { tr } from './i18n.js';
import { standsOn } from './level.js';
import { styleFor, shapeGeo, patMat, noTrim, modelGeo, vegMat, mergedModels, detail } from './scenery.js';
import { HDR, mat4, canvasTex, merge, trimParts, panelMat } from './worldview.js';
import { facadeTex } from './coreview.js';

// What each map has around its courses (around):
//   isle    islets of their own, well below the stones, each with one tree and a few plants round it: the map's own floating islands.
//   wreck   torn steel blown about by the storm.
//   column  basalt spires going all the way down, round the outside of the volcano.
//   tower   skyscrapers going all the way down to the bay, with neon on their roofs, and what belongs on a roof.
const SKIN = {
  storm: { post: [1, 0x5a6272], hot: 0x3ff0d0, wrap: 'postcable', round: false, around: 'wreck', want: 16 },
  sunny: { post: [3, 0xc9a06a], hot: 0xffb04a, wrap: 'postrope', round: true, around: 'isle', isle: 'isletS', trees: ['palm'], small: ['rocks', 'grass', 'coral'], want: 12 },
  forest: { post: [16, 0x8a6a4a], hot: 0x9be564, wrap: 'postvine', cap: 'bush', capS: 1.2, round: true, around: 'isle', isle: 'isletG', trees: ['oak', 'pine', 'birch'], small: ['fern', 'bush', 'grass', 'flowers'], want: 16 },
  volcano: { post: [7, 0x8a7068], hot: 0xff5a2a, wrap: 'postchain', cap: 'brazier', capS: 2, round: false, around: 'column', want: 10 },
  city: { post: [1, 0x5a5e6e], hot: 0xff4fd8, wrap: 'postneon', round: false, around: 'tower', want: 7 },
  waterfall: { post: [13, 0xffffff], hot: 0x7fe8ff, wrap: 'postvine', cap: 'fern', capS: 1.4, round: true, around: 'isle', isle: 'isletW', trees: ['bamboo', 'oak', 'pine'], small: ['fern', 'reeds', 'grass'], want: 14 },
};
export const skinOf = (key) => SKIN[key] || SKIN.storm;
const BOXG = new THREE.BoxGeometry(1, 1, 1);
const pick = (R, a) => a[(R() * a.length) | 0];

// The material of a course's gate and vault.
export const postMat = (key) => { const s = skinOf(key); return patMat(s.post[0], s.post[1]); };

// How a stone that stays put is shaped and surfaced. Ice and bounce pads have none: what they do has to show.
const styleOf = (key, c) => (c.surf === 'ice' || c.surf === 'pad' ? null : styleFor(key, { kind: 'plat' }, c.zone, rng(c.x * 7 + c.z * 13)));

// The stones that stay put, shaped and surfaced like the map's own platforms. A marker keeps its green ring and lamp, so it can
// be told from the rest.
export function courseStones(view, r, keep) {
  const key = view.key, L = view.level, groups = new Map(), green = HDR(0x7ff8d8, 3.4), lampG = new THREE.CylinderGeometry(0.06, 0.09, 1.7, 6), ballG = new THREE.SphereGeometry(0.17, 10, 8);
  const groupOf = (gk, mat) => { if (!groups.has(gk)) groups.set(gk, { parts: [], mat: mat() }); return groups.get(gk).parts; };
  for (const c of r.stones) {
    if (c.dyn || c.crumble || c.blink || c.ghost) continue;
    const m = mat4(c.x, c.y, c.z, 1, 1, 1, c.rx, c.ry, c.rz), st = styleOf(key, c), size = new THREE.Vector3(c.hx * 2, c.hy * 2, c.hz * 2);
    const col = st ? (st.col === null ? L.zones[c.zone].tint : st.col) : 0;
    const parts = groupOf(st ? st.pat + ':' + col : c.look, () => (st ? patMat(st.pat, col) : view.lookMat(c.look))), glow = c.rest !== undefined ? HDR(0x7ff8d8, view.glowK) : HDR(c.look.g, view.glowK);
    parts.push({ geo: st ? shapeGeo(st.shape) : BOXG, m: m.clone().scale(size), glow: null });
    // A mushroom has its stem.
    if (st && st.under) groupOf(st.under.pat + ':' + st.under.col, () => patMat(st.under.pat, st.under.col)).push({ geo: shapeGeo(st.under.shape), m: m.clone().scale(size), glow: null });
    if (!st || !noTrim(key, st.shape)) for (const t of trimParts(c.hx, c.hy, c.hz, glow, true)) parts.push({ geo: t.geo, m: m.clone().multiply(t.m), glow: t.glow });
    if (c.rest !== undefined) {
      const ring = new THREE.TorusGeometry(Math.min(c.hx, c.hz) * 0.82, 0.05, 6, 28);
      parts.push({ geo: ring, m: m.clone().multiply(mat4(0, c.hy + 0.04, 0, 1, 1, 1, Math.PI / 2)), glow: green });
      parts.push({ geo: lampG, m: m.clone().multiply(mat4(c.hx * 0.72, c.hy + 0.85, c.hz * 0.72, 1, 1, 1)), glow: null });
      parts.push({ geo: ballG, m: m.clone().multiply(mat4(c.hx * 0.72, c.hy + 1.8, c.hz * 0.72, 1, 1, 1)), glow: green });
    }
  }
  for (const g of groups.values()) keep(view.add(new THREE.Mesh(merge(g.parts), g.mat)));
}

// What hangs under a stone depends on what the stone is: rope under planks, vines under the forest's rock, little engines under the
// pads that float in the city and the storm. Glass-smooth things have nothing.
function underOf(key, st) {
  if (!st) return null;
  const sh = st.shape;
  if (/^(planks|raft)/.test(sh)) return ['hangrope'];
  if (/^basalt/.test(sh) || (key === 'volcano' && /^rock/.test(sh))) return ['stalact'];
  if (/^rock/.test(sh)) return key === 'forest' || key === 'waterfall' ? ['hangvine0', 'hangvine1'] : key === 'sunny' ? ['hangweed'] : null;
  if (sh === 'chamfer' && key === 'city') return ['thrustC'];
  if (sh === 'chamfer' && key === 'storm') return ['thrustS'];
  return null;
}

// Windows for the city's skyscrapers: a tile of the texture is 12.57 m wide and 42 m tall, as on the map's own towers.
function towerMesh(view, list) {
  const pos = [], nor = [], uv = [], glo = [];
  const face = (ax, az, bx, bz, nx, nz, w, h) => {
    const u = w / 12.57, v = h / 42, tri = [[ax, 0, az, 0, 0], [bx, 0, bz, u, 0], [bx, h, bz, u, v], [ax, 0, az, 0, 0], [bx, h, bz, u, v], [ax, h, az, 0, v]];
    for (const q of tri) { pos.push(q[0], q[1], q[2]); nor.push(nx, 0, nz); uv.push(q[3], q[4]); glo.push(0, 0, 0); }
  };
  for (const t of list) {
    const e = t.w / 2, x0 = t.x - e, x1 = t.x + e, z0 = t.z - e, z1 = t.z + e;
    face(x0, z1, x1, z1, 0, 1, t.w, t.top);
    face(x1, z1, x1, z0, 1, 0, t.w, t.top);
    face(x1, z0, x0, z0, 0, -1, t.w, t.top);
    face(x0, z0, x0, z1, -1, 0, t.w, t.top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  if (!view.courseFacade) {
    const { map, glow } = facadeTex(61, true);
    view.courseFacade = panelMat(0xffffff, { map, metalness: 0.55, roughness: 0.4, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 1.0, pattern: 0 });
  }
  return new THREE.Mesh(g, view.courseFacade);
}

// Decoration, with nothing inside anything else: every piece has its own room (view.taken), and none of it is near enough to a stone
// to be taken for something to stand on. It only looks: there is nothing here to stand on or bump into.
export function courseDecor(view, r, keep) {
  const key = view.key, L = view.level, sk = skinOf(key), R = rng(r.i * 977 + 31), low = detail() === 0, list = [], towers = [];
  const put = (name, x, y, z, s = 1, ry = 0, sy = s) => list.push([name, mat4(x, y, z, s, sy, s, 0, ry, 0)]);
  const stay = r.stones.filter((c) => !c.dyn && !c.ghost && !c.blink && !c.crumble);
  // Under the stones, spread evenly round each one so no two strands touch, and only where nothing is below to hang into.
  const clearBelow = (x, z, y0, len, self) => r.stones.every((o) => o === self || o.y + o.hy > y0 || o.y + o.hy < y0 - len - 0.5 || Math.hypot(o.x - x, o.z - z) > Math.hypot(o.hx, o.hz) + 0.5);
  for (const c of stay) {
    const st = styleOf(key, c), under = underOf(key, st), small = Math.min(c.hx, c.hz);
    if (!under) continue;
    const engine = /^thrust/.test(under[0]), n = engine ? (small > 1.2 ? 4 : 1) : Math.max(1, Math.round(Math.min(small * 2.4, 6) * (low ? 0.5 : 1))), a0 = R() * TAU, cs = Math.cos(c.ry), sn = Math.sin(c.ry);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * TAU) / n, d = n === 1 ? 0 : small * 0.62, u = Math.cos(a) * d, v = Math.sin(a) * d, x = c.x + cs * u + sn * v, z = c.z - sn * u + cs * v, y = c.y - c.hy;
      if (clearBelow(x, z, y, 3.2, c)) put(under[k % under.length], x, y, z, engine ? 1 : 0.85 + R() * 0.3, R() * TAU);
    }
    // On the bigger natural stones, one plant at the edge, unless there is something dangerous to watch for on it.
    if (sk.small && st.pat !== 3 && small > 1.25 && c.rest === undefined && R() < 0.6 && !L.obs.some((o) => o.sec && Math.hypot(o.x - c.x, o.z - c.z) < 6)) {
      const a = R() * TAU;
      put(pick(R, sk.small), c.x + Math.cos(a) * small * 0.72, c.y + c.hy, c.z + Math.sin(a) * small * 0.72, 0.7 + R() * 0.3, R() * TAU);
    }
  }
  const v = r.vault, h = v.s / 2 - 0.35, cs = Math.cos(v.ry), sn = Math.sin(v.ry);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(sk.wrap, v.x + (a * h * cs + b * h * sn), v.y, v.z + (b * h * cs - a * h * sn), 1, R() * TAU, 0.76);
  // All around the course, out past the route and the map's own islands. Nothing touches anything: not a stone and not another piece.
  if (!view.courseOut) { view.courseOut = 0; for (const q of L.recs) if (standsOn(q)) view.courseOut = Math.max(view.courseOut, Math.hypot(q.x, q.z) + q.rad); view.courseOut += 9; }
  const taken = view.taken, fits = (x, z, y0, y1, rad) => {
    if (y0 < -1 || Math.hypot(x, z) < view.courseOut + rad) return false;
    for (const t of taken) if (t.y1 > y0 && t.y0 < y1 && Math.hypot(t.x - x, t.z - z) < t.r + rad) return false;
    for (const c of L.cols) if (c.maxx >= x - rad && c.minx <= x + rad && c.maxz >= z - rad && c.minz <= z + rad && c.maxy >= y0 && c.miny <= y1) return false;
    return true;
  };
  const want = Math.round((sk.want + stay.length * 0.2) * (low ? 0.4 : 1));
  for (let tries = 0, made = 0; tries < want * 10 && made < want; tries++) {
    const q = stay[(R() * stay.length) | 0], a = R() * TAU, far = 7 + R() * 10, x = q.x + Math.cos(a) * far, z = q.z + Math.sin(a) * far;
    if (sk.around === 'isle') {
      const y = q.y - 11 - R() * 13, s = 1.3 + R() * 0.6, ts = 1.5 + R() * 0.9, rad = 2.2 + ts * 0.7;
      if (!fits(x, z, y - 2.5, y + ts * 5, rad)) continue;
      taken.push({ x, z, y0: y - 2.5, y1: y + ts * 5, r: rad });
      put(sk.isle, x, y, z, s, R() * TAU);
      put(pick(R, sk.trees), x, y + 0.08, z, ts, R() * TAU);
      // Round the tree, on the rim, on opposite sides.
      const b = R() * TAU;
      for (let k = 0; k < 2; k++) put(pick(R, sk.small), x + Math.cos(b + k * Math.PI) * s * 0.9, y + 0.08, z + Math.sin(b + k * Math.PI) * s * 0.9, 0.7 + R() * 0.4, R() * TAU);
    } else if (sk.around === 'wreck') {
      const y = q.y - 3 - R() * 12, s = 1 + R() * 0.8, rad = 1.8 * s;
      if (!fits(x, z, y - rad, y + rad, rad)) continue;
      taken.push({ x, z, y0: y - rad, y1: y + rad, r: rad });
      list.push(['wreck' + ((R() * 3) | 0), mat4(x, y, z, s, s, s, R() * 3, R() * 6, R() * 3)]);
    } else if (sk.around === 'column') {
      const top = q.y - 15 - R() * 18, w = 1.3 + R() * 1.1, rad = w * 1.2;
      if (!fits(x, z, 0, top + 6, rad)) continue;
      taken.push({ x, z, y0: 0, y1: top + 6, r: rad });
      list.push(['basaltcol', mat4(x, top, z, w, top, w, 0, R() * 6, 0)]);
      put('basalttop', x, top, z, w, R() * 6);
      if (R() < 0.5) put('dead', x, top + 0.05, z, 1.4 + R() * 0.6, R() * 6);
    } else {
      const w = 7 + R() * 4, d = far + w * 0.7, tx = q.x + Math.cos(a) * d, tz = q.z + Math.sin(a) * d, top = q.y - 17 - R() * 18, rad = w * 0.75 + 1;
      if (!fits(tx, tz, 0, top + 7, rad)) continue;
      taken.push({ x: tx, z: tz, y0: 0, y1: top + 7, r: rad });
      towers.push({ x: tx, z: tz, w, top });
      list.push(['roofbox', mat4(tx, top + 0.4, tz, w, 0.4, w)], ['roofneon', mat4(tx, top + 0.4, tz, w, 1, w)]);
      // One thing to a corner of the roof.
      for (const [u, k] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (R() < 0.75) put(pick(R, ['acunit', 'acunit', 'tank', 'antenna', 'lamp']), tx + u * w * 0.26, top + 0.4, tz + k * w * 0.26, 1.1, R() * 6);
    }
    made++;
  }
  if (list.length) keep(view.add(new THREE.Mesh(mergedModels(list), vegMat()), false));
  if (towers.length) keep(view.add(towerMesh(view, towers), false));
}

// A board in the map's own style, with the words on it in a dark outline so they can always be read.
export function signTex(key, w, h, tint, big, small) {
  return canvasTex(w, h, (x) => {
    const R = rng(w * 7 + h + (big.length * 31)), planks = (base, line, grain, n) => {
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      for (let i = 1; i < n; i++) { x.fillStyle = line; x.fillRect(0, (h * i) / n - 2, w, 4); }
      x.strokeStyle = grain; x.lineWidth = 1.5;
      for (let i = 0; i < 26; i++) { const y = R() * h, l = 60 + R() * 180, s = R() * w; x.beginPath(); x.moveTo(s, y); x.quadraticCurveTo(s + l / 2, y + (R() - 0.5) * 8, s + l, y); x.stroke(); }
    };
    const blots = (col, n) => { x.fillStyle = col; for (let i = 0; i < n; i++) { const a = R() < 0.5, px = a ? R() * w : (R() < 0.5 ? 0 : w), py = a ? (R() < 0.5 ? 0 : h) : R() * h; x.beginPath(); x.arc(px, py, 10 + R() * 22, 0, TAU); x.fill(); } };
    const frame = (col, lw) => { x.strokeStyle = col; x.lineWidth = lw; x.strokeRect(lw / 2 + 4, lw / 2 + 4, w - lw - 8, h - lw - 8); };
    switch (key) {
      case 'forest': planks('#4a3220', '#2a1c10', 'rgba(20,12,6,.5)', 3); blots('#4f7a34', 16); blots('#2f6a2a', 10); break;
      case 'sunny': planks('#b88a56', '#7a5a34', 'rgba(70,44,20,.45)', 3); frame('#e8d4a8', 8); break;
      case 'waterfall': planks('#46585a', '#2a383a', 'rgba(16,28,30,.5)', 3); blots('#3f7a4a', 14); break;
      case 'volcano': {
        x.fillStyle = '#17100e'; x.fillRect(0, 0, w, h);
        x.strokeStyle = '#ff5a1a'; x.lineWidth = 2.5;
        for (let i = 0; i < 10; i++) { let px = R() * w, py = R() * h; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (R() - 0.5) * 70; py += (R() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); }
        frame('#3a2a26', 12);
        break;
      }
      case 'city': {
        x.fillStyle = '#12101c'; x.fillRect(0, 0, w, h);
        x.strokeStyle = 'rgba(64,224,255,.16)'; x.lineWidth = 2;
        for (let i = 16; i < w; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
        frame('#ff4fd8', 7);
        break;
      }
      default: {
        x.fillStyle = '#2c323e'; x.fillRect(0, 0, w, h);
        const b = Math.round(h * 0.1);
        for (const y0 of [0, h - b]) { x.save(); x.beginPath(); x.rect(0, y0, w, b); x.clip(); x.fillStyle = '#e8c020'; x.fillRect(0, y0, w, b); x.fillStyle = '#16181e'; for (let i = -b; i < w + b; i += 44) { x.beginPath(); x.moveTo(i, y0 + b); x.lineTo(i + 22, y0 + b); x.lineTo(i + 22 + b, y0); x.lineTo(i + b, y0); x.closePath(); x.fill(); } x.restore(); }
      }
    }
    const hex = '#' + tint.toString(16).padStart(6, '0'), text = (t, y, px, col) => {
      x.font = `bold ${px}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.lineWidth = Math.max(6, px * 0.2); x.strokeStyle = '#0a0806'; x.strokeText(t, w / 2, y, w * 0.88);
      x.fillStyle = col; x.fillText(t, w / 2, y, w * 0.88);
    };
    if (small) { text(big, h * 0.38, Math.round(h * 0.3), hex); text(small, h * 0.72, Math.round(h * 0.17), '#fff2d0'); }
    else text(big, h * 0.52, Math.round(h * 0.54), hex);
  });
}

// The gate where a course leaves the route: posts and a lintel in the map's own material with spikes on them, whatever grows
// there wound round them, and the sign on top, turning to whoever looks at it. Its glowing strip and veil say which kind it is.
export function courseGate(view, r, tint, keep) {
  const key = view.key, sk = skinOf(key), G = r.gate, gate = new THREE.Group(), kind = HDR(tint, 2.6), parts = [];
  gate.position.set(G.x, G.y, G.z);
  gate.rotation.y = Math.PI / 2 - G.a;
  const postG = sk.round ? new THREE.CylinderGeometry(0.2, 0.27, 3.5, 8) : new THREE.BoxGeometry(0.28, 3.5, 0.28), spike = new THREE.ConeGeometry(0.06, 0.34, 4), side = sk.round ? 0.23 : 0.14;
  const hotGlow = HDR(sk.hot, 1.6);
  for (const s of [-1, 1]) {
    parts.push({ geo: postG, m: mat4(s * 1.35, 1.75, 0, 1, 1, 1), glow: null });
    for (const y of [1.1, 1.95, 2.8]) parts.push({ geo: spike, m: mat4(s * (1.35 + side + 0.15), y, 0, 1, 1, 1, 0, 0, -s * Math.PI / 2), glow: hotGlow });
    parts.push({ geo: spike, m: mat4(s * 1.3, 3.72, 0, 1, 1, 1), glow: hotGlow });
  }
  parts.push({ geo: new THREE.BoxGeometry(3.3, 0.28, 0.34), m: mat4(0, 3.4, 0, 1, 1, 1), glow: null });
  parts.push({ geo: new THREE.BoxGeometry(2.5, 0.06, 0.36), m: mat4(0, 3.24, 0, 1, 1, 1), glow: kind });
  const grow = [];
  for (const s of [-1, 1]) {
    grow.push([sk.wrap, mat4(s * 1.35, 0, 0, 1, 1, 1, 0, s, 0)]);
    if (sk.cap) grow.push([sk.cap, mat4(s * 1.35, 3.55, 0, sk.capS, sk.capS, sk.capS, 0, s, 0)]);
  }
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 3.1), new THREE.MeshBasicMaterial({ color: HDR(tint, r.portal ? 1.6 : 0.5), transparent: true, opacity: r.portal ? 0.72 : 0.32, depthWrite: false, side: THREE.DoubleSide }));
  veil.position.y = 1.55;
  gate.add(new THREE.Mesh(merge(parts), postMat(key)), new THREE.Mesh(mergedModels(grow), vegMat()), veil);
  // On the near side of the pillar of light that goes up through the gate, so the light never washes over the words.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({ map: signTex(key, 512, 256, tint, tr(r.kind === 'epic' ? 'EPIC' : r.kind === 'weapon' ? 'LEGENDARY' : 'RELIC'), tr('THIS WAY')) }));
  board.position.z = 0.4;
  const turn = new THREE.Group();
  turn.position.y = 4.1;
  turn.userData.anim = true;
  turn.add(board);
  gate.add(turn);
  view.facing.push({ o: turn, x: G.x, z: G.z, ry: gate.rotation.y });
  keep(gate);
  view.add(gate, false);
}

// The spinning bars of a course are something else on each map. Their reach and height stay what they are. Says if it was done.
export function courseSweep(view, o, add, mat) {
  const key = view.key;
  if (key === 'city') return false;
  const g = new THREE.Group(), angles = [];
  for (let k = 0; k < o.n; k++) angles.push((k * TAU) / o.n);
  g.position.set(o.x, o.y, o.z);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.32, 14), mat);
  hub.position.y = -0.2;
  g.add(hub);
  const R = rng((o.x * 13 + o.z * 7) | 0);
  const swap = (a, b, speed) => { g.add(a, b); add(o, g, (st, t) => { g.rotation.y = st.laserAngle(o, t); const f = Math.sin(t * speed + o.ph * 9) > 0; a.visible = f; b.visible = !f; }); return true; };
  if (key === 'forest' || key === 'sunny') {
    // A flock: birds flying wing to wing along each bar, beaks the way they go, their wings beating in two frames.
    const flock = (name) => {
      const list = [], Q = rng((o.x * 3 + o.z * 5) | 0), heading = o.per > 0 ? Math.PI : 0;
      for (const b of angles) for (let d = 0.6; d <= o.len; d += 0.55) {
        const j = (Q() - 0.5) * 0.24, y = (Q() - 0.5) * 0.14;
        list.push([name, mat4(Math.cos(b) * d + Math.sin(b) * j, y, -Math.sin(b) * d + Math.cos(b) * j, 1.25, 1.25, 1.25, 0, b + heading, 0)]);
      }
      return new THREE.Mesh(mergedModels(list), vegMat());
    };
    const up = key === 'forest' ? 'birdU' : 'gullU', down = key === 'forest' ? 'birdD' : 'gullD';
    return swap(flock(up), flock(down), 24);
  }
  if (key === 'storm') {
    // A crackling arc: a jagged line along each bar, two shapes of it taking turns.
    const arc = () => {
      const parts = [];
      for (const b of angles) {
        let d = 0.25, off = 0;
        while (d < o.len) {
          const nd = d + 0.42, no = (R() - 0.5) * 0.26, mx = (d + nd) / 2, my = (off + no) / 2, len = Math.hypot(0.42, no - off), tilt = Math.atan2(no - off, 0.42);
          parts.push({ geo: BOXG, m: mat4(Math.cos(b) * mx, my, -Math.sin(b) * mx, len, 0.05, 0.05, 0, b, tilt), glow: null });
          d = nd; off = no;
        }
      }
      return new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ color: HDR(0x9ff8ff, 3.2) }));
    };
    return swap(arc(), arc(), 44);
  }
  if (key === 'volcano') {
    // A fire bar: balls of fire down each bar, two sizes taking turns so it flickers.
    const fire = (k) => {
      const parts = [], ball = new THREE.IcosahedronGeometry(1, 1);
      for (const b of angles) for (let d = 0.35; d <= o.len; d += 0.36) {
        const s = (0.16 - (d / o.len) * 0.05) * (k + (R() - 0.5) * 0.3);
        parts.push({ geo: ball, m: mat4(Math.cos(b) * d, 0, -Math.sin(b) * d, s, s, s), glow: null });
      }
      return new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ color: HDR(0xff7a2a, 3) }));
    };
    return swap(fire(1), fire(1.25), 30);
  }
  // Waterfall: a hard jet of water down each bar, its spray shifting.
  const jet = (k) => {
    const parts = [], tube = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2), drop = new THREE.IcosahedronGeometry(1, 0);
    for (const b of angles) {
      parts.push({ geo: tube, m: mat4(Math.cos(b) * o.len * 0.5, 0, -Math.sin(b) * o.len * 0.5, o.len, 0.08, 0.08, 0, b, 0), glow: null });
      for (let d = 0.5 + k * 0.2; d <= o.len + 0.2; d += 0.4) parts.push({ geo: drop, m: mat4(Math.cos(b) * d + (R() - 0.5) * 0.14, (R() - 0.5) * 0.14, -Math.sin(b) * d + (R() - 0.5) * 0.14, 0.07, 0.07, 0.07), glow: null });
    }
    return new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ color: HDR(0x9ff0ff, 1.5), transparent: true, opacity: 0.82, depthWrite: false }));
  };
  return swap(jet(0), jet(1), 26);
}

// What falls on a course on each map, or null for a ball of light. It is modelled at about the size of radius 0.5.
export const COMET_HEAD = { forest: 'beehive', sunny: 'coconut', waterfall: 'boulder', city: 'dronebomb', volcano: 'lavabomb' };
// What sits in the middle of a gravity well on each map, and the colour of its core where it has none.
export const WELL_HEAD = { forest: 'flytrap', city: 'magnet' };
export const headMesh = (name) => new THREE.Mesh(modelGeo(name), vegMat());
