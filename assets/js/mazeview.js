// The maze gardens (level.js, maze), drawn in each map's style: a floor with a paved way through, walls (clipped hedges in
// the forest, sandstone on the beach, basalt columns with lava between them on the volcano, neon lit metal and concrete at
// night, mossy ruins by the waterfall), posts with a lamp, an urn or a topiary ball on top, trees and plants round the rim,
// a pond (lava on the volcano) with stones round it, small animals, and a shrine where a legendary relic waits. Only the
// inner walls ever change: showMaze puts them the way the colliders now have them (level.js applyMaze).
import * as THREE from 'three';
import { HDR, mat4 } from './worldview.js';
import { patMat, shapeGeo, modelGeo, vegMat, swarm, detail, FLORA, pickWeighted } from './scenery.js';
import { MAZE_CELL, MAZE_WALL_H, MAZE_WALL_T, MAZE_RIM } from './level.js';
import { TAU, rng } from './util.js';

const C = MAZE_CELL, H = MAZE_WALL_H, T = MAZE_WALL_T, RIM = MAZE_RIM, LEN = C + T, PH = H + 0.28;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BOXG = new THREE.BoxGeometry(1, 1, 1);

// Per map: the walls (shape, surface pattern, colour), their glowing trims, the posts and what sits on them, the rim and the
// paved way, what hangs underneath, the pond, and the animals (one that walks the rim, one that flies over).
const STYLE = {
  storm: { wall: 'metal', pat: 1, col: 0x4a5466, glow: [0x5af0ff], post: [8, 0x3a4250], cap: 'pylon', rim: [8, 0x5a6070], path: [4, 0x7a8698], under: ['chamfer', 1, 0x3a4250, 0.6],
    pond: { color: 0x1a3a5a, foam: 0x3a8aa8, alpha: 0.85, bed: 0x0e1a28 }, walk: ['crab', 0x5a6a9a, 2], fly: [0x7ff8ff, 2.4, 0.55] },
  sunny: { wall: 'block', pat: 2, col: 0xe8cf9a, post: [2, 0xd8bc84], cap: 'urn', rim: [6, 0xffffff], path: [2, 0xf4e6c8], under: ['isle1', 6, 0xffffff, 0.7],
    pond: { color: 0x3ad0d8, foam: 0x9af0f0, alpha: 0.8, bed: 0x2a8a8a }, walk: ['crab', null, 2], fly: [null, 0, 1.2] },
  forest: { wall: 'hedge', pat: 17, col: 0xffffff, post: [2, 0x9a9488], cap: 'topiary', rim: [5, 0xffffff], path: [6, 0xc8b090], under: ['isle0', 5, 0xffffff, 0.7],
    pond: { color: 0x3a8a9a, foam: 0x6ab8b8, alpha: 0.8, bed: 0x1a3a30, lily: true }, walk: ['rabbit', null, 3], fly: [null, 0, 1.2] },
  volcano: { wall: 'basalt', pat: 7, col: 0x8a7a76, glow: [0xff6a1a], post: [7, 0x6a5a56], cap: 'brazier', rim: [7, 0x9a8a86], path: [12, 0x5a5050], under: ['basalt1', 7, 0xb09a92, 0.8],
    pond: { color: 0xff5a10, foam: 0xffd040, alpha: 0.95, bed: 0x3a0a04 }, walk: ['lizard', null, 2], fly: [0xff8a3d, 1.8, 0.7] },
  city: { wall: 'neon', pat: 12, col: 0x9aa0b0, glow: [0xff40d0, 0x40f0ff], post: [1, 0x5a5e6e], cap: 'neonpost', rim: [12, 0xffffff], path: [10, 0xffffff], under: ['chamfer', 1, 0x4a4e5e, 0.6],
    pond: { color: 0x4ab8f0, foam: 0xa8e0ff, alpha: 0.8, bed: 0x1a3a5a }, walk: ['pigeon', null, 2], fly: [0xff70e0, 2.4, 0.55] },
  waterfall: { wall: 'ruin', pat: 13, col: 0xffffff, post: [13, 0xffffff], cap: 'mosscap', rim: [13, 0xffffff], path: [2, 0xc8c0a8], under: ['isle2', 13, 0xffffff, 0.7],
    pond: { color: 0x3ac0c8, foam: 0x8ae0e0, alpha: 0.8, bed: 0x1a4a4a, lily: true }, walk: ['frog', null, 3], fly: [null, 0, 1.2] },
};
// The creature in each map's mazes (scenery.js MODELS).
export const MAZE_BEAST = { storm: 'stormcrab', sunny: 'scorpion', forest: 'boar', volcano: 'imp', city: 'robodog', waterfall: 'croc' };

function mergeParts(list) {
  const pos = [], nor = [];
  for (const [geo, m] of list) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => mat4(x, y, z, 1, 1, 1, rx, ry, rz);
const hash = (x, y, z, a) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + a * 4.13) * 43758.5453; return s - Math.floor(s) - 0.5; };

// One wall a cell long, centred on its middle, long along x.
function wallGeo(kind) {
  if (kind === 'hedge') {
    // Leafy and a little uneven, rounded off along the top. (Moved by where a corner is, so the sides stay joined.)
    const g = new THREE.BoxGeometry(LEN, H, 0.38, 8, 6, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), top = Math.max(0, (y - (H / 2 - 0.3)) / 0.3);
      p.setXYZ(i, x + hash(x, y, z, 1) * 0.07, y + hash(x, y, z, 2) * 0.07 - top * top * 0.05, z * (1 - top * 0.3) + hash(x, y, z, 3) * 0.08);
    }
    g.computeVertexNormals();
    return mergeParts([[g, new THREE.Matrix4()]]);
  }
  if (kind === 'block') return mergeParts([[B(LEN, 0.2, 0.38), at(0, -H / 2 + 0.1, 0)], [B(LEN, H - 0.36, 0.3), at(0, 0.02, 0)], [B(LEN + 0.04, 0.16, 0.42), at(0, H / 2 - 0.08, 0)]]);
  if (kind === 'metal') {
    const list = [[B(LEN, H - 0.1, 0.26), at(0, -0.05, 0)], [B(LEN, 0.1, 0.34), at(0, H / 2 - 0.05, 0)]];
    for (const x of [-1.1, -0.37, 0.37, 1.1]) list.push([B(0.12, H - 0.1, 0.34), at(x, -0.05, 0)]);
    return mergeParts(list);
  }
  if (kind === 'basalt') {
    // Columns side by side, their tops uneven, with a gap between each for the lava to show through.
    const list = [], n = 9, step = (LEN - 0.3) / (n - 1);
    for (let k = 0; k < n; k++) {
      const h = H - Math.abs(hash(k, 1, 2, 3)) * 0.5;
      list.push([new THREE.CylinderGeometry(0.15, 0.15, h, 6), at(-LEN / 2 + 0.15 + k * step, -H / 2 + h / 2, hash(k, 4, 5, 6) * 0.04)]);
    }
    list.push([B(LEN, H * 0.82, 0.12), at(0, -H * 0.09, 0)]);
    return mergeParts(list);
  }
  if (kind === 'neon') return mergeParts([[B(LEN, H - 0.12, 0.28), at(0, -0.06, 0)], [B(LEN, 0.12, 0.34), at(0, H / 2 - 0.06, 0)], [B(0.22, H - 0.12, 0.32), at(-LEN / 2 + 0.26, -0.06, 0)], [B(0.22, H - 0.12, 0.32), at(LEN / 2 - 0.26, -0.06, 0)]]);
  // Ruins: rows of big stones, some of the top ones gone lower.
  const list = [];
  for (let r = 0; r < 3; r++) {
    let x = -LEN / 2;
    for (let k = 0; x < LEN / 2 - 0.05; k++) {
      const l = Math.min(LEN / 2 - x, 0.6 + Math.abs(hash(r, k, 1, 2)) * 1.0), hr = H / 3 - (r === 2 ? Math.abs(hash(r, k, 3, 4)) * 0.4 : 0);
      list.push([B(l - 0.03, hr - 0.03, 0.3 + hash(r, k, 5, 6) * 0.05), at(x + l / 2, -H / 2 + r * (H / 3) + hr / 2, hash(r, k, 7, 8) * 0.04)]);
      x += l;
    }
  }
  return mergeParts(list);
}
// The glowing parts of a wall (drawn on their own, lit up).
function glowGeo(kind) {
  if (kind === 'basalt') {
    const list = [], n = 9, step = (LEN - 0.3) / (n - 1);
    for (let k = 0; k < n - 1; k++) list.push([B(0.05, H * 0.72, 0.2), at(-LEN / 2 + 0.15 + (k + 0.5) * step, -H / 2 + H * 0.38, 0)]);
    return mergeParts(list);
  }
  return mergeParts([[B(LEN, 0.04, 0.05), at(0, H / 2 + 0.02, 0.15)], [B(LEN, 0.04, 0.05), at(0, H / 2 + 0.02, -0.15)], [B(LEN - 0.1, 0.05, 0.3), at(0, 0.35, 0)]]);
}
// A post where walls meet, from the floor up: a foot, the shaft and a slab on top for the lamp or plant.
function postGeo(kind) {
  if (kind === 'basalt') return mergeParts([[new THREE.CylinderGeometry(0.21, 0.24, PH, 6), at(0, PH / 2, 0)]]);
  if (kind === 'hedge') return mergeParts([[B(0.46, 0.18, 0.46), at(0, 0.09, 0)], [new THREE.CylinderGeometry(0.17, 0.19, H, 10), at(0, H / 2, 0)], [B(0.46, 0.12, 0.46), at(0, PH - 0.06, 0)]]);
  return mergeParts([[B(0.46, 0.18, 0.46), at(0, 0.09, 0)], [B(0.34, H, 0.34), at(0, H / 2, 0)], [B(0.46, 0.12, 0.46), at(0, PH - 0.06, 0)]]);
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
// Where a wall goes, from its collider (whichever way round it lies): a long one in pieces a cell long, a short one stretched.
function wallMatrices(c) {
  const along = c.hx >= c.hz, len = 2 * Math.max(c.hx, c.hz), n = Math.max(1, Math.round((len - T) / C)), out = [];
  const ang = c.ry + (along ? 0 : Math.PI / 2), dx = Math.cos(ang), dz = -Math.sin(ang);
  _e.set(0, ang, 0, 'YXZ');
  _q.setFromEuler(_e);
  for (let k = 0; k < n; k++) {
    const o = n === 1 ? 0 : (k - (n - 1) / 2) * C;
    out.push(new THREE.Matrix4().compose(_p.set(c.x + dx * o, c.y, c.z + dz * o), _q, _s.set(n === 1 ? len / LEN : 1, 1, 1)));
  }
  return out;
}

export function buildMazes(view) {
  const L = view.level, st = STYLE[view.key];
  view.mazes = [];
  if (!st || !L.mazes || !L.mazes.length) return;
  const low = detail() === 0, R = rng(2718), col = new THREE.Color();
  const wGeo = wallGeo(st.wall), wMat = patMat(st.pat, st.col), gGeo = st.glow ? glowGeo(st.wall) : null;
  const gMat = st.glow ? new THREE.MeshBasicMaterial({ color: HDR(0xffffff, view.glowK) }) : null;
  const postMat = patMat(st.post[0], st.post[1]);
  // Things for the whole map, drawn as one instanced mesh each.
  const outer = [], outerGlow = [], posts = [], floors = [], paths = [], unders = [], curbs = [], beds = [];
  // Plants and props: per model and height band, like the islands (scenery.js).
  const inst = new Map();
  const put = (model, m, tint = null) => { const y = m.elements[13], k = model + '|' + Math.floor(y / 50); if (!inst.has(k)) inst.set(k, { model, y, list: [] }); inst.get(k).list.push([m, tint]); };
  const tint = new THREE.Color();
  for (const m of L.mazes) {
    const N = m.N, S = N * C, half = m.half, y = m.y, ry = m.ry, glowCol = st.glow ? st.glow[m.i % st.glow.length] : 0;
    const P = (u, w) => [m.x + m.fx * u + m.nx * w, m.z + m.fz * u + m.nz * w];
    const rowW = (j) => ((N - 1) / 2 - j) * C, colU = (i) => (i - (N - 1) / 2) * C;
    const F = mz(L, m), f = F.zone;
    // The floor, the paved way through (and out over both porches) and what hangs underneath.
    floors.push(mat4(m.x, y - 0.35, m.z, half * 2, 0.7, half * 2, 0, ry, 0));
    paths.push(mat4(m.x, y - 0.025, m.z, S + 0.1, 0.06, S + 0.1, 0, ry, 0));
    for (const [u, j] of [[-(S / 2 + RIM / 2), m.ej], [S / 2 + RIM / 2, m.xj]]) { const [x, z] = P(u, rowW(j)); paths.push(mat4(x, y - 0.025, z, RIM + 0.1, 0.06, C - T, 0, ry, 0)); }
    const ugc = st.under[2], sy = st.under[3];
    unders.push([mat4(m.x, y - 0.64 - 0.5 * sy, m.z, half * 2, sy, half * 2, 0, ry, 0), ugc]);
    // A low kerb round the edge, open where the porches are.
    const e = half - 0.08;
    for (const s of [-1, 1]) { const [x, z] = P(0, s * e); curbs.push(mat4(x, y + 0.06, z, half * 2, 0.12, 0.16, 0, ry, 0)); }
    for (const [s, jp] of [[-1, m.ej], [1, m.xj]]) {
      const w0 = rowW(jp) + C / 2 - T / 2, w1 = rowW(jp) - C / 2 + T / 2;
      for (const [a, b] of [[w0, half], [-half, w1]]) { if (b - a < 0.1) continue; const [x, z] = P(s * e, (a + b) / 2); curbs.push(mat4(x, y + 0.06, z, 0.16, 0.12, b - a, 0, ry, 0)); }
    }
    // The walls: the inner ones change (one mesh for this maze), the outside and the fences never do.
    const inner = m.walls.map((c) => wallMatrices(c)[0]);
    for (const c of L.cols) if (c.kind === 'mouter' && c.mz === m.i) for (const w of wallMatrices(c)) { outer.push(w); if (st.glow) outerGlow.push([w, glowCol]); }
    const iw = new THREE.InstancedMesh(wGeo, wMat, inner.length);
    inner.forEach((w, k) => { iw.setMatrixAt(k, m.walls[k].on ? w : ZERO); iw.setColorAt(k, col.setHSL(0, 0, 0.9 + ((k * 37) % 19) / 100)); });
    view.add(iw);
    view.band(y).near.push(iw);
    let ig = null;
    if (st.glow) {
      ig = new THREE.InstancedMesh(gGeo, gMat, inner.length);
      inner.forEach((w, k) => { ig.setMatrixAt(k, m.walls[k].on ? w : ZERO); ig.setColorAt(k, col.setHex(glowCol)); });
      view.add(ig, false);
      view.band(y).near.push(ig);
    }
    view.mazes.push({ m, inner, iw, ig });
    // Posts on every corner, and at the far ends of the porch fences.
    for (let k = 0; k <= N; k++) for (let l = 0; l <= N; l++) { const [x, z] = P((k - N / 2) * C, (N / 2 - l) * C); posts.push([x, y, z]); }
    for (const [s, jp] of [[-1, m.ej], [1, m.xj]]) for (const d of [-1, 1]) { const [x, z] = P(s * (half - 0.1), rowW(jp) + (d * C) / 2); posts.push([x, y, z]); }
    // Round the rim: trees on the corners and along the side away from the camera's usual place, small plants elsewhere,
    // and a pond along the other side with stones round it.
    const corner = S / 2 + RIM / 2, small = (x, z, k = 1) => { const sc = (0.6 + R() * 0.5) * k; put(pickWeighted(f.small, R), mat4(x, y, z, sc, sc, sc, 0, R() * TAU, 0)); };
    const tree = (x, z, k) => { const sc = k * (0.8 + R() * 0.3); tint.setHSL(0, 0, 0.85 + R() * 0.3); put(pickWeighted(f.trees, R), mat4(x, y, z, sc, sc, sc, 0, R() * TAU, 0), tint.getHex()); };
    for (const su of [-1, 1]) { const [x, z] = P(su * corner, corner); tree(x, z, 0.85); }
    for (const su of [-1, 1]) { const [x, z] = P(su * corner, -corner); small(x, z, 1.2); }
    for (let i = 0; i < N; i++) {
      const [x, z] = P(colU(i) + (R() - 0.5) * 0.8, corner + (R() - 0.5) * 0.3);
      if (i % 2 && !low) tree(x, z, 0.6); else small(x, z);
    }
    for (const [su, jp] of [[-1, m.ej], [1, m.xj]]) for (let j = 0; j < N; j++) {
      if (j === jp || (low && j % 2)) continue;
      const [x, z] = P(su * corner, rowW(j) + (R() - 0.5) * 0.6);
      small(x, z);
    }
    // The pond: two to three cells long along the outer side, in the middle.
    const pl = Math.min(3, N - 2) * C - 0.5, pw = RIM - 0.55, pu = (R() - 0.5) * (S - pl - C) * 0.5, [px, pz] = P(pu, -corner);
    beds.push([mat4(px, y + 0.012, pz, pl + 0.1, 0.02, pw + 0.1, 0, ry, 0), st.pond.bed]);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(pl, pw).rotateX(-Math.PI / 2), view.waterMat({ speed: 0.03, alpha: st.pond.alpha, color: st.pond.color, foam: st.pond.foam }));
    water.position.set(px, y + 0.035, pz);
    water.rotation.y = ry;
    view.add(water, false);
    view.band(y).near.push(water);
    for (let t = 0; t < 1; t += 0.3 / (pl + pw)) {
      // Round the edge, stone by stone.
      const per = t * 2 * (pl + pw), side = per < pl ? 0 : per < pl + pw ? 1 : per < 2 * pl + pw ? 2 : 3;
      const q = side === 0 ? per : side === 1 ? per - pl : side === 2 ? per - pl - pw : per - 2 * pl - pw;
      const u = side === 0 ? -pl / 2 + q : side === 1 ? pl / 2 : side === 2 ? pl / 2 - q : -pl / 2, w = side === 0 ? pw / 2 : side === 1 ? pw / 2 - q : side === 2 ? -pw / 2 : -pw / 2 + q;
      const [x, z] = P(pu + u * 1.04, -corner + w * 1.1), sc = 0.35 + R() * 0.25;
      put('rocks', mat4(x, y, z, sc, sc * 0.8, sc, 0, R() * TAU, 0));
    }
    if (st.pond.lily && !low) for (let k = 0; k < 3; k++) { const [x, z] = P(pu + (R() - 0.5) * (pl - 0.6), -corner + (R() - 0.5) * (pw - 0.4)); put(k ? 'lilypad' : 'lotus', mat4(x, y + 0.04, z, 1, 1, 1, 0, R() * TAU, 0)); }
    if (st.pond.lily) for (const s of [-1, 1]) { const [x, z] = P(pu + s * (pl / 2 + 0.2), -corner); put('reeds', mat4(x, y, z, 0.7, 0.7, 0.7, 0, R() * TAU, 0)); }
    // The relic's shrine (there whenever the hidden paths are, like the relic).
    const rel = (L.relics || []).find((r) => r.maze === m.i);
    if (rel) {
      const sh = new THREE.Mesh(modelGeo('shrine'), vegMat());
      sh.position.set(m.rx, y, m.rz);
      view.add(sh, false);
      sh.visible = false;
      (view.secretParts ||= []).push({ sec: 'hard', o: sh });
    }
    // Animals: one kind on the rim, little fliers over the walls.
    if (!low) {
      const walkers = [], [wk, wt, mode] = st.walk;
      for (let k = 0; k < 4; k++) {
        // Along the side with the trees, and the two sides with the porches (never the pond's).
        const [x, z] = k < 2 ? P(colU((R() * N) | 0), corner) : P((k % 2 ? 1 : -1) * corner, rowW((R() * N) | 0));
        walkers.push({ x, y: y + 0.02, z, ph: R(), R: 0.5, sp: 0.4 + R() * 0.3, amp: mode === 3 ? 0.3 : 0, sz: wk === 'frog' || wk === 'rabbit' ? 1.3 : 1.1, tint: wt });
      }
      swarm(view, wk, walkers, { mode, side: wk === 'crab' ? Math.PI / 2 : 0, light: view.key === 'storm' ? 0.6 : view.key === 'city' ? 0.8 : 1, glow: view.key === 'volcano' ? 0.2 : 0 });
      const [ft, fg, fs] = st.fly, fl = [];
      const cols = [0xff9a3d, 0x5ab8ff, 0xffe066, 0xff6ab8, 0xb48cff, 0xffffff];
      for (let k = 0; k < 7; k++) { const [x, z] = P((R() - 0.5) * S, (R() - 0.5) * S); fl.push({ x, y: y + 1.6 + R() * 1.6, z, ph: R(), R: 0.8 + R() * 1.2, sp: 0.6 + R() * 0.5, amp: 0.6, sz: fs, tint: ft ?? cols[(R() * cols.length) | 0] }); }
      swarm(view, 'butterfly', fl, { mode: 1, flap: fg ? 30 : 22, light: fg ? 0.4 : 1.15, glow: fg });
    }
  }
  // The shared meshes.
  const many = (geo, mat, list, shadow = true, colors = null) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, Array.isArray(m) ? m[0] : m); im.setColorAt(i, col.setHex(Array.isArray(m) ? m[1] : colors ?? 0xffffff)); });
    view.add(im, shadow);
    return im;
  };
  many(BOXG, patMat(st.rim[0], st.rim[1]), floors);
  many(BOXG, patMat(st.path[0], st.path[1]), paths, false);
  many(shapeGeo(st.under[0]), patMat(st.under[1]), unders);
  many(BOXG, postMat, curbs, false);
  many(BOXG, patMat(0), beds, false);
  many(wGeo, wMat, outer);
  if (st.glow) many(gGeo, gMat, outerGlow, false);
  many(postGeo(st.wall), postMat, posts.map(([x, y, z]) => mat4(x, y, z, 1, 1, 1, 0, 0, 0)));
  const caps = posts.map(([x, y, z], i) => mat4(x, y + PH, z, 1, 1, 1, 0, (i * 1.7) % TAU, 0));
  for (const m of caps) put(st.cap, m);
  const mat = vegMat();
  for (const { model, y, list } of inst.values()) {
    const im = new THREE.InstancedMesh(modelGeo(model), mat, list.length);
    list.forEach(([m, t], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(t ?? 0xffffff)); });
    view.add(im, model !== 'grass' && model !== 'flowers' && model !== 'fern' && model !== 'lilypad' && model !== 'lotus');
    view.band(y).near.push(im);
  }
}

// The flora of the zone a maze is in (scenery.js FLORA).
function mz(L, m) {
  const list = FLORA[L.mapKey] || FLORA.forest;
  return { zone: list[Math.min(m.zone ?? 0, list.length - 1)] };
}

// Stand the inner walls the way their colliders are now.
export function showMaze(view) {
  for (const e of view.mazes || []) {
    const walls = e.m.walls;
    for (let k = 0; k < walls.length; k++) {
      const w = walls[k].on ? e.inner[k] : ZERO;
      e.iw.setMatrixAt(k, w);
      if (e.ig) e.ig.setMatrixAt(k, w);
    }
    e.iw.instanceMatrix.needsUpdate = true;
    if (e.ig) e.ig.instanceMatrix.needsUpdate = true;
  }
}
