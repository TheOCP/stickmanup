// The dock at the foot of the climb: an UP HERE sign in the map's style with a big glowing arrow over it that points at the
// first piece of the route (level.js startSign), and plants and props along both edges of the dock, clear of the way.
import * as THREE from 'three';
import { HDR, mat4, canvasTex } from './worldview.js';
import { modelGeo, vegMat, detail, patMat } from './scenery.js';
import { tr } from './i18n.js';
import { TAU, rng } from './util.js';

// Per map: the board (background, frame and text colours, a wood grain or not), the glow of the arrow, the post, and the
// props along the dock's edges ([model, weight]).
const LOOK = {
  storm: { bg: '#141a26', frame: '#5af0ff', text: '#bff8ff', grain: false, glow: 0x5af0ff, post: [1, 0x4a5466], props: [['debris', 2], ['acunit', 2], ['pylon', 3], ['antenna', 1], ['tank', 1]] },
  sunny: { bg: '#c89a5a', frame: '#7a4e22', text: '#fff6e0', grain: true, glow: 0xffb030, post: [3, 0xb08458], props: [['umbrella', 2], ['urn', 3], ['flowers', 3], ['rocks', 2], ['palm', 1]] },
  forest: { bg: '#6a4628', frame: '#3a2414', text: '#f4ecd0', grain: true, glow: 0x9be564, post: [16, 0x8a6a4a], props: [['fern', 3], ['shroom', 2], ['glowshroom', 2], ['bush', 2], ['flowers', 2], ['rocks', 1], ['topiary', 1]] },
  volcano: { bg: '#1e1412', frame: '#ff6a1a', text: '#ffd080', grain: false, glow: 0xff7a1a, post: [7, 0x6a5a56], props: [['brazier', 3], ['obsidian', 2], ['ember', 3], ['dead', 1], ['rocks', 1]] },
  city: { bg: '#120a1e', frame: '#ff40d0', text: '#ffe0f8', grain: false, glow: 0xff40d0, post: [1, 0x5a5e6e], props: [['planter', 3], ['neonpost', 3], ['acunit', 1], ['lamp', 1], ['antenna', 1]] },
  waterfall: { bg: '#d8c890', frame: '#5a7a3a', text: '#2a3a1a', grain: true, glow: 0x5ae0c8, post: [9, 0xd8c890], props: [['reeds', 2], ['fern', 3], ['flowers', 3], ['bamboo', 1], ['mosscap', 2], ['bush', 1]] },
};

// The board's face: UP HERE in big letters, and an arrow toward the way up (side: -1 left, 1 right; up: how steep).
function boardTex(look, side, up) {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = look.bg; g.fillRect(0, 0, w, h);
    if (look.grain) {
      const R = rng(7);
      for (let y = 0; y < h; y += 40) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, w, 3); }
      for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(0,0,0,${0.05 + R() * 0.1})`; g.lineWidth = 1 + R() * 2; const y = R() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w / 3, y + R() * 8 - 4, (w * 2) / 3, y + R() * 8 - 4, w, y + R() * 6 - 3); g.stroke(); }
    }
    g.strokeStyle = look.frame; g.lineWidth = 18; g.strokeRect(9, 9, w - 18, h - 18);
    g.fillStyle = look.text; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 92px sans-serif';
    g.fillText(tr('UP HERE'), w / 2 - side * 60, 108, 360);
    g.font = 'bold 34px sans-serif';
    g.fillText(tr('The climb starts here'), w / 2 - side * 60, 196, 360);
    // The arrow: a shape, turned toward the way up.
    g.save();
    g.translate(side > 0 ? w - 92 : 92, 160);
    g.rotate(-Math.atan2(up, side));
    g.fillStyle = look.frame;
    g.beginPath();
    g.moveTo(70, 0); g.lineTo(10, -52); g.lineTo(10, -22); g.lineTo(-62, -22); g.lineTo(-62, 22); g.lineTo(10, 22); g.lineTo(10, 52); g.closePath();
    g.fill();
    g.restore();
  });
}

export function buildStart(view) {
  const L = view.level, S = L.startSign, look = LOOK[view.key];
  view.startArrow = null;
  if (!look) return;
  if (S) {
    const g = new THREE.Group();
    g.position.set(S.x, S.y, S.z);
    g.rotation.y = S.ry;
    const postMat = patMat(look.post[0], look.post[1]);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.0, 10), postMat);
    post.position.y = 1.5;
    // Which way the arrow goes as seen from in front of the board, and from behind it.
    const dx = S.tx - S.x, dz = S.tz - S.z, rx = Math.cos(S.ry), rz = -Math.sin(S.ry), dh = Math.hypot(dx, dz) || 1;
    const side = dx * rx + dz * rz >= 0 ? 1 : -1, up = Math.max(0.35, Math.min(2.5, (S.ty - S.y - 2.4) / dh + 0.6));
    const board = (front) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: boardTex(look, front ? side : -side, up), color: HDR(0xffffff, view.key === 'storm' || view.key === 'city' || view.key === 'volcano' ? 1.5 : 1.05) }));
      m.position.set(0, 2.55, front ? 0.215 : -0.215);
      m.rotation.y = front ? 0 : Math.PI;
      return m;
    };
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.56, 1.66, 0.42), postMat);
    back.position.y = 2.55;
    g.add(post, back, board(true), board(false));
    view.add(g);
    // The big arrow: hovering over the sign, pointing at the first piece of the route, sliding along its length.
    const shaft = new THREE.CylinderGeometry(0.22, 0.22, 2.2, 12).translate(0, 1.1, 0), head = new THREE.ConeGeometry(0.66, 1.3, 16).translate(0, 2.85, 0);
    const am = new THREE.MeshBasicMaterial({ color: HDR(look.glow, 2.4) });
    const arrow = new THREE.Group();
    arrow.add(new THREE.Mesh(shaft, am), new THREE.Mesh(head, am));
    const from = new THREE.Vector3(S.x, S.y + 4.2, S.z), dir = new THREE.Vector3(S.tx, S.ty, S.tz).sub(from).normalize();
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arrow.position.copy(from);
    view.add(arrow, false);
    view.anim.push(arrow);
    view.startArrow = { o: arrow, from, dir };
  }
  // Along the dock's two edges: by the middle and out by the water. Nothing on the way to the first platform, the piers,
  // the crates or the sign.
  const R = rng(4711), inst = new Map(), core = view.coreAt(2), n = detail() === 0 ? 18 : 40;
  const pick = () => { let s = 0; for (const [, w] of look.props) s += w; let x = R() * s; for (const [k, w] of look.props) if ((x -= w) <= 0) return k; return look.props[0][0]; };
  const solid = L.cols.filter((c) => c.kind !== 'dock' && c.kind !== 'core' && c.y - (c.hy ?? c.hh ?? 0) < 6 && c.y + (c.hy ?? c.hh ?? 0) > 1.5);
  const free = (x, z) => solid.every((c) => {
    if (c.r !== undefined) return Math.hypot(c.x - x, c.z - z) > c.r + 0.9;
    const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.ry), sn = Math.sin(c.ry);
    return Math.abs(dx * cs - dz * sn) > c.hx + 0.9 || Math.abs(dx * sn + dz * cs) > c.hz + 0.9;
  }) && (!L.route.length || Math.hypot(x - L.route[0][0], z - L.route[0][2]) > 3) && (!S || Math.hypot(x - S.x, z - S.z) > 2);
  const sp = L.spawn;
  for (let k = 0; k < n; k++) {
    const inner = k % 2 === 0, r = inner ? core + 0.7 + R() * 0.6 : 18.0 + R() * 0.5, a = R() * TAU;
    if (Math.abs(Math.atan2(Math.sin(a - sp.th), Math.cos(a - sp.th))) < 0.35) continue;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z)) continue;
    let model = pick();
    if (model === 'palm' && inner) model = 'flowers';
    const sc = (model === 'palm' || model === 'tank' || model === 'dead' ? 0.7 : 0.8) + R() * 0.4;
    if (!inst.has(model)) inst.set(model, []);
    inst.get(model).push(mat4(x, 2, z, sc, sc, sc, 0, R() * TAU, 0));
  }
  const mat = vegMat();
  for (const [model, list] of inst) {
    const im = new THREE.InstancedMesh(modelGeo(model), mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    view.add(im, model !== 'flowers' && model !== 'fern');
  }
}

// The arrow over the sign slides along itself, pointing the way.
export function updateStart(view, t) {
  const a = view.startArrow;
  if (!a) return;
  const k = 0.35 * Math.sin(t * 3);
  a.o.position.set(a.from.x + a.dir.x * k, a.from.y + a.dir.y * k, a.from.z + a.dir.z * k);
}
