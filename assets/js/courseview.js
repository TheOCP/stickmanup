// How the relic courses look on each map: their stones, gate, sign and vault in the map's own materials, with vines, trees and
// whatever else grows or hangs there all around them, and the obstacles that are something else on each map. How they work
// is all in level.js and storm.js: nothing in here changes that.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { tr } from './i18n.js';
import { coreRadius } from './level.js';
import { styleFor, shapeGeo, patMat, noTrim, modelGeo, vegMat, mergedModels, detail } from './scenery.js';
import { HDR, mat4, canvasTex, merge, trimParts } from './worldview.js';

const SKIN = {
  storm: { post: [1, 0x5a6272], hot: 0x3ff0d0, trees: ['antenna', 'lamp', 'tank', 'debris', 'antenna'], bits: ['debris', 'acunit', 'pylon'], hang: ['hangcable'], hangN: 0.8, isle: 'isletM', wrap: 'postcable', cap: 'pylon', capS: 1.4, round: false, trees0: 10 },
  sunny: { post: [3, 0xc9a06a], hot: 0xffb04a, trees: ['palm', 'palm', 'palm', 'cactus', 'palm'], bits: ['rocks', 'coral', 'grass'], hang: ['hangrope'], hangN: 0.9, isle: 'isletS', wrap: 'postrope', cap: 'coral', capS: 0.8, round: true, trees0: 12 },
  forest: { post: [16, 0x8a6a4a], hot: 0x9be564, trees: ['oak', 'pine', 'birch', 'oak', 'pine', 'bamboo', 'shroom', 'glowshroom'], bits: ['fern', 'bush', 'grass', 'flowers'], hang: ['hangvine0', 'hangvine1'], hangN: 1.7, isle: 'isletG', wrap: 'postvine', cap: 'bush', capS: 1.2, round: true, trees0: 20 },
  volcano: { post: [7, 0x8a7068], hot: 0xff5a2a, trees: ['dead', 'dead', 'obsidian', 'ember', 'dead'], bits: ['ember', 'obsidian', 'brazier'], hang: ['hangchain'], hangN: 0.8, isle: 'isletB', wrap: 'postchain', cap: 'brazier', capS: 2, round: false, trees0: 8 },
  city: { post: [1, 0x5a5e6e], hot: 0xff4fd8, trees: ['antenna', 'lamp', 'antenna', 'tank'], bits: ['acunit', 'neonpost', 'planter'], hang: ['hangneon', 'hangcable'], hangN: 0.8, isle: 'isletC', wrap: 'postneon', cap: 'neonpost', capS: 2, round: false, trees0: 10 },
  waterfall: { post: [13, 0xffffff], hot: 0x7fe8ff, trees: ['bamboo', 'oak', 'bamboo', 'pine', 'reeds'], bits: ['fern', 'reeds', 'mosscap', 'grass'], hang: ['hangvine0', 'hangvine1'], hangN: 1.4, isle: 'isletW', wrap: 'postvine', cap: 'fern', capS: 1.4, round: true, trees0: 16 },
};
export const skinOf = (key) => SKIN[key] || SKIN.storm;
const BOXG = new THREE.BoxGeometry(1, 1, 1);
const pick = (R, a) => a[(R() * a.length) | 0];

// The material of a course's gate and vault.
export const postMat = (key) => { const s = skinOf(key); return patMat(s.post[0], s.post[1]); };

// The stones that stay put, shaped and surfaced like the map's own platforms. Ice and bounce pads keep their looks, because what
// they do has to show. A marker keeps its green ring and lamp, so it can be told from the rest.
export function courseStones(view, r, keep) {
  const key = view.key, L = view.level, groups = new Map(), green = HDR(0x7ff8d8, 3.4), lampG = new THREE.CylinderGeometry(0.06, 0.09, 1.7, 6), ballG = new THREE.SphereGeometry(0.17, 10, 8);
  for (const c of r.stones) {
    if (c.dyn || c.crumble || c.blink || c.ghost) continue;
    const m = mat4(c.x, c.y, c.z, 1, 1, 1, c.rx, c.ry, c.rz), plain = c.surf === 'ice' || c.surf === 'pad';
    const st = plain ? null : styleFor(key, { kind: 'plat' }, c.zone, rng(c.x * 7 + c.z * 13));
    const col = st ? (st.col === null ? L.zones[c.zone].tint : st.col) : 0, gk = st ? st.pat + ':' + col : c.look;
    if (!groups.has(gk)) groups.set(gk, { parts: [], mat: st ? patMat(st.pat, col) : view.lookMat(c.look) });
    const parts = groups.get(gk).parts, glow = c.rest !== undefined ? HDR(0x7ff8d8, view.glowK) : HDR(c.look.g, view.glowK);
    parts.push({ geo: st ? shapeGeo(st.shape) : BOXG, m: m.clone().scale(new THREE.Vector3(c.hx * 2, c.hy * 2, c.hz * 2)), glow: null });
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

// Vines and the like under the stones, plants on the big ones, wound round the vault's pillars, and trees all around on islets of
// their own, wherever there is room for them. It only looks: there is nothing here to stand on or bump into.
export function courseDecor(view, r, keep) {
  const key = view.key, L = view.level, sk = skinOf(key), R = rng(r.i * 977 + 31), low = detail() === 0, list = [];
  const put = (name, x, y, z, s = 1, ry = 0, sy = s) => list.push([name, mat4(x, y, z, s, sy, s, 0, ry, 0)]);
  const stay = r.stones.filter((c) => !c.dyn && !c.ghost && !c.blink && !c.crumble);
  for (const c of stay) {
    const small = Math.min(c.hx, c.hz);
    for (let k = sk.hangN * (low ? 0.5 : 1); k > 0; k--) {
      if (k < 1 && R() > k) break;
      const a = R() * TAU, d = small * (0.3 + R() * 0.5);
      put(pick(R, sk.hang), c.x + Math.cos(a) * d, c.y - c.hy, c.z + Math.sin(a) * d, 0.8 + R() * 0.5, R() * TAU);
    }
    if (small > 1 && c.rest === undefined && R() < 0.8) {
      const a = R() * TAU, d = small * 0.8;
      put(pick(R, sk.bits), c.x + Math.cos(a) * d, c.y + c.hy, c.z + Math.sin(a) * d, 0.7 + R() * 0.5, R() * TAU);
    }
  }
  const v = r.vault, h = v.s / 2 - 0.35, cs = Math.cos(v.ry), sn = Math.sin(v.ry);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(sk.wrap, v.x + (a * h * cs + b * h * sn), v.y, v.z + (b * h * cs - a * h * sn), 1, R() * TAU, 0.76);
  // Trees, more the longer the course. Never in the way of the route or the tower.
  const towers = L.towers || [], crater = key === 'volcano', want = Math.round((sk.trees0 + stay.length * 0.4) * (low ? 0.4 : 1)), far = 3.4;
  const free = (x, y, z) => {
    const rad = Math.hypot(x, z);
    if (crater ? rad > 14.5 : !towers.length && rad < coreRadius(key, y) + 3) return false;
    for (const t of towers) if (Math.hypot(x - t.x, z - t.z) < (t.r || 7) + 3) return false;
    for (const t of L.trees || []) if (Math.hypot(x - t.x, z - t.z) < 5) return false;
    for (const c of L.cols) if (c.maxx >= x - far && c.minx <= x + far && c.maxz >= z - far && c.minz <= z + far && c.maxy >= y - 1.5 && c.miny <= y + 7) return false;
    return true;
  };
  for (let tries = 0, made = 0; tries < want * 6 && made < want; tries++) {
    const q = stay[(R() * stay.length) | 0], a = R() * TAU, d = 4.5 + R() * 6, x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d, y = q.y - 1.5 - R() * 6;
    if (!free(x, y, z)) continue;
    made++;
    put(sk.isle, x, y, z, 1 + R() * 0.5, R() * TAU);
    for (let n = 1 + ((R() * 3) | 0); n > 0; n--) {
      const b = R() * TAU, e = R() * 0.8;
      put(pick(R, sk.trees), x + Math.cos(b) * e, y + 0.06, z + Math.sin(b) * e, 1.4 + R() * 1.2, R() * TAU);
    }
    put(pick(R, sk.bits), x + (R() - 0.5) * 1.6, y + 0.06, z + (R() - 0.5) * 1.6, 0.8 + R() * 0.5, R() * TAU);
  }
  if (list.length) keep(view.add(new THREE.Mesh(mergedModels(list), vegMat()), false));
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
  const postG = sk.round ? new THREE.CylinderGeometry(0.2, 0.27, 3.5, 8) : new THREE.BoxGeometry(0.28, 3.5, 0.28), spike = new THREE.ConeGeometry(0.06, 0.34, 4);
  const hotGlow = HDR(sk.hot, 1.6);
  for (const s of [-1, 1]) {
    parts.push({ geo: postG, m: mat4(s * 1.35, 1.75, 0, 1, 1, 1), glow: null });
    for (const y of [1.1, 1.95, 2.8]) parts.push({ geo: spike, m: mat4(s * 1.62, y, 0, 1, 1, 1, 0, 0, -s * Math.PI / 2), glow: hotGlow });
    parts.push({ geo: spike, m: mat4(s * 1.3, 3.72, 0, 1, 1, 1), glow: hotGlow });
  }
  parts.push({ geo: new THREE.BoxGeometry(3.3, 0.28, 0.34), m: mat4(0, 3.4, 0, 1, 1, 1), glow: null });
  parts.push({ geo: new THREE.BoxGeometry(2.5, 0.06, 0.36), m: mat4(0, 3.24, 0, 1, 1, 1), glow: kind });
  const grow = [];
  for (const s of [-1, 1]) {
    grow.push([sk.wrap, mat4(s * 1.35, 0, 0, 1, 1, 1, 0, s, 0)]);
    grow.push([sk.cap, mat4(s * 1.5, 3.55, 0, sk.capS, sk.capS, sk.capS, 0, s, 0)]);
  }
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 3.1), new THREE.MeshBasicMaterial({ color: HDR(tint, 0.5), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
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
