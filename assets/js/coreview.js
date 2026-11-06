// The middle column and the side pillars up close. The forest's giant trunk and its side trees get bark in plates with
// deep furrows, lichen and moss, ivy climbing them, shelf fungi, and leafy branches that grow only where nothing of the
// climb is near: no platform, obstacle, maze, zipline or flying thing, and the room above each of them (for jumping and
// for the camera) stays empty. The side trees get full crowns. The storm and city towers get floors of offices with lit
// windows and steel fins, the lighthouse real stonework, the waterfall's rock ledges with moss, ferns and hanging ivy.
import * as THREE from 'three';
import { canvasTex, HDR, panelMat } from './worldview.js';
import { modelGeo, vegMat, detail } from './scenery.js';
import { TAU, rng } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler();

// ---------------------------------------------------------------- textures (all tile without seams)
// Draws at (x, y) and again across every edge it comes near.
function wrap(w, h, x, y, r, fn) {
  for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) {
    const X = x + dx, Y = y + dy;
    if (X + r < 0 || X - r > w || Y + r < 0 || Y - r > h) continue;
    fn(X, Y);
  }
}
const gauss = (R) => (R() + R() + R() - 1.5) / 1.5;

// Speckled moss: many small dots in a patch, never one flat blob.
function moss(g, w, h, R, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const cx = R() * w, cy = R() * h, sx = (o.sx || 8) + R() * (o.sx || 8) * 2, sy = (o.sy || 24) + R() * (o.sy || 24) * 2.5, hue = (o.hue || 88) + R() * 26;
    const dots = [];
    for (let k = 0, m = 60 + ((R() * 120) | 0); k < m; k++) dots.push([gauss(R) * sx, gauss(R) * sy, 0.7 + R() * 2.1, 18 + R() * 26, 0.45 + R() * 0.5]);
    wrap(w, h, cx, cy, Math.max(sx, sy) * 1.6, (X, Y) => {
      for (const [dx, dy, r, l, a] of dots) { g.fillStyle = `hsla(${hue},${40 + l}%,${l}%,${a})`; g.beginPath(); g.arc(X + dx, Y + dy, r, 0, TAU); g.fill(); }
    });
  }
}

// Bark: columns of plates split by deep furrows, broken across by cracks, lit from the upper left, with knots,
// lichen and moss.
export function barkTex(seed) {
  const R = rng(seed);
  return canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#1a110a'; g.fillRect(0, 0, w, h);
    const cols = [];
    for (let x = 0; x < w;) { let cw = 16 + R() * 22; if (w - x - cw < 12) cw = w - x; cols.push([x, cw]); x += cw; }
    for (const [x0, cw] of cols) {
      for (let y = -R() * 160; y < h;) {
        const ph = 60 + R() * 190, hue = 22 + R() * 10, sat = 26 + R() * 14, l = 23 + R() * 14;
        const edge = [0, 1, 2, 3, 4, 5, 6].map(() => [1.5 + R() * 3, 1.5 + R() * 3]), tipT = 0.3 + R() * 0.4, tipB = 0.3 + R() * 0.4;
        const fib = []; for (let k = 0; k < cw / 3; k++) fib.push([R() * cw, R() * ph * 0.4, ph * (0.3 + R() * 0.6), R() < 0.5, 0.06 + R() * 0.16]);
        const draw = (Y) => {
          const gr = g.createLinearGradient(x0, 0, x0 + cw, 0);
          gr.addColorStop(0, `hsl(${hue},${sat}%,${l * 0.5}%)`);
          gr.addColorStop(0.3, `hsl(${hue},${sat}%,${l * 1.2}%)`);
          gr.addColorStop(0.7, `hsl(${hue},${sat}%,${l}%)`);
          gr.addColorStop(1, `hsl(${hue},${sat}%,${l * 0.45}%)`);
          g.fillStyle = gr;
          // Pointed at both ends, so the furrows run together round it like real ridged bark.
          const tp = Math.min(ph * 0.22, 26);
          g.beginPath();
          g.moveTo(x0 + cw * tipT, Y);
          edge.forEach(([a], k) => g.lineTo(x0 + a, Y + tp + (k / 6) * (ph - 2 * tp)));
          g.lineTo(x0 + cw * tipB, Y + ph);
          for (let k = 6; k >= 0; k--) g.lineTo(x0 + cw - edge[k][1], Y + tp + (k / 6) * (ph - 2 * tp));
          g.closePath(); g.fill();
          for (const [fx, fy, fl, dark, a] of fib) { g.strokeStyle = dark ? `rgba(10,6,2,${a})` : `rgba(190,150,110,${a * 0.7})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + fx, Y + fy); g.lineTo(x0 + fx + 1, Y + fy + fl); g.stroke(); }
        };
        draw(y);
        if (y < 0) draw(y + h);
        if (y + ph > h) draw(y - h);
        y += ph - 10 - R() * 8;
      }
    }
    // Knots: rings round a dark hole.
    for (let i = 0; i < 5; i++) {
      const x = R() * w, y = R() * h, rx = 9 + R() * 12, ry = rx * (1.5 + R() * 0.7);
      wrap(w, h, x, y, ry * 1.4, (X, Y) => {
        for (let k = 4; k >= 0; k--) { g.fillStyle = k % 2 ? '#5e4228' : '#2e1e10'; g.beginPath(); g.ellipse(X, Y, rx * (0.45 + k * 0.2), ry * (0.45 + k * 0.2), 0, 0, TAU); g.fill(); }
        g.fillStyle = '#0c0603'; g.beginPath(); g.ellipse(X, Y, rx * 0.36, ry * 0.32, 0, 0, TAU); g.fill();
      });
    }
    // Lichen: pale little rosettes.
    for (let i = 0; i < 34; i++) {
      const x = R() * w, y = R() * h, rings = [];
      for (let k = 0; k < 10; k++) rings.push([gauss(R) * 10, gauss(R) * 10, 1.5 + R() * 3.5]);
      wrap(w, h, x, y, 30, (X, Y) => { for (const [dx, dy, r] of rings) { g.fillStyle = 'rgba(176,188,150,0.32)'; g.beginPath(); g.arc(X + dx, Y + dy, r, 0, TAU); g.fill(); g.strokeStyle = 'rgba(206,214,180,0.5)'; g.lineWidth = 1; g.stroke(); } });
    }
    moss(g, w, h, R, 34);
  });
}

// Rock: blocks and ledges lit from above, cracks, dark wet streaks, moss along the tops of the ledges.
export function rockTex(seed) {
  const R = rng(seed);
  return canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#5c574c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) { g.fillStyle = `rgba(${R() < 0.5 ? '30,26,20' : '150,140,120'},${0.03 + R() * 0.06})`; g.fillRect(0, y, w, 6); }
    const ledges = [];
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, bw = 24 + R() * 60, bh = 12 + R() * 34, sk = (R() - 0.5) * 10, l = 30 + R() * 16, hue = 30 + R() * 20;
      ledges.push([x, y, bw]);
      wrap(w, h, x, y, bw + 10, (X, Y) => {
        g.fillStyle = `hsl(${hue},${6 + R() * 6}%,${l}%)`;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X + bw, Y + sk); g.lineTo(X + bw - 3, Y + bh + sk); g.lineTo(X + 2, Y + bh); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,250,235,0.2)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X, Y); g.lineTo(X + bw, Y + sk); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 3; g.beginPath(); g.moveTo(X + 2, Y + bh); g.lineTo(X + bw - 3, Y + bh + sk); g.stroke();
      });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const pts = []; let x = R() * w, y = R() * h; pts.push([x, y]);
      for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 30; y += 8 + R() * 26; pts.push([x, y]); }
      const a = 0.3 + R() * 0.4, lw = 1 + R() * 2.5;
      wrap(w, h, pts[0][0], pts[0][1] + 60, 120, (X, Y) => {
        const dx = X - pts[0][0], dy = Y - 60 - pts[0][1];
        g.strokeStyle = `rgba(26,22,18,${a})`; g.lineWidth = lw; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.stroke();
      });
    }
    // Wet streaks running down.
    for (let i = 0; i < 26; i++) {
      const x = R() * w, y = R() * h, sw = 4 + R() * 10, sl = 120 + R() * 300;
      wrap(w, h, x, y + sl / 2, sl, (X, Y) => { const gr = g.createLinearGradient(0, Y - sl / 2, 0, Y + sl / 2); gr.addColorStop(0, 'rgba(20,24,24,0)'); gr.addColorStop(0.3, 'rgba(20,24,24,0.22)'); gr.addColorStop(1, 'rgba(20,24,24,0)'); g.fillStyle = gr; g.fillRect(X - sw / 2, Y - sl / 2, sw, sl); });
    }
    // Moss sitting on the ledges, and some patches.
    for (const [x, y, bw] of ledges) {
      if (R() > 0.45) continue;
      const dots = []; for (let k = 0; k < bw * 1.6; k++) dots.push([R() * bw, -R() * 5 + gauss(R) * 2, 0.8 + R() * 1.8, 22 + R() * 24, 0.5 + R() * 0.45]);
      const hue = 85 + R() * 30;
      wrap(w, h, x, y, bw + 10, (X, Y) => { for (const [dx, dy, r, l, a] of dots) { g.fillStyle = `hsla(${hue},${40 + l}%,${l}%,${a})`; g.beginPath(); g.arc(X + dx, Y + dy, r, 0, TAU); g.fill(); } });
    }
    moss(g, w, h, R, 22, { sx: 10, sy: 14 });
  });
}

// Office floors: 6 bays and 12 floors per tile (one tile about 12.6 m wide and 42 m tall on the core). The map has
// the slabs, frames and glass; the glow map the lit rooms, each with a ceiling light, some with blinds or someone's
// plant or desk against the glass. City adds neon strips.
export function facadeTex(seed, city) {
  const R = rng(seed), W = 512, H = 1024, bays = 6, floors = 12, bw = W / bays, fh = H / floors;
  const hues = city ? [[300, 90], [195, 90], [45, 90], [30, 30], [0, 0]] : [[195, 60], [190, 30], [40, 70], [0, 0]];
  const rooms = [];
  for (let f = 0; f < floors; f++) {
    const dark = R() < 0.1, fl = R() < 0.25 ? hues[(R() * hues.length) | 0] : null;
    for (let b = 0; b < bays; b++) rooms.push({ f, b, on: !dark && R() < (city ? 0.6 : 0.5), hue: fl || hues[(R() * hues.length) | 0], l: 55 + R() * 25, blind: R() < 0.3 ? 0.2 + R() * 0.6 : 0, thing: R() < 0.3 ? ((R() * 3) | 0) : -1 });
  }
  const win = (b, f) => [b * bw + 9, f * fh + 16, bw - 18, fh - 26];
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = city ? '#2a2836' : '#2e3440'; g.fillRect(0, 0, W, H);
    for (let f = 0; f < floors; f++) {
      g.fillStyle = city ? '#4a4658' : '#56606e'; g.fillRect(0, f * fh, W, 9);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, f * fh, W, 2);
    }
    for (const q of rooms) {
      const [x, y, w, h] = win(q.b, q.f);
      g.fillStyle = '#10151e'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#3a5068'); gr.addColorStop(1, '#141c28');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = '#10151e'; g.fillRect(x + w / 2 - 1.5, y, 3, h);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x + 4, y + h - 4); g.lineTo(x + 14, y + 4); g.lineTo(x + 20, y + 4); g.lineTo(x + 10, y + h - 4); g.fill();
    }
    for (let b = 0; b <= bays; b++) { g.fillStyle = '#1c222c'; g.fillRect(b * bw - 2, 0, 4, H); }
  });
  const glow = canvasTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const q of rooms) {
      if (!q.on) continue;
      const [x, y, w, h] = win(q.b, q.f), [hu, sa] = q.hue;
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, `hsl(${hu},${sa}%,${Math.min(92, q.l + 18)}%)`); gr.addColorStop(1, `hsl(${hu},${sa}%,${q.l * 0.45}%)`);
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = `hsl(${hu},${sa * 0.5}%,94%)`; g.fillRect(x + 4, y + 2, w - 8, 3);
      if (q.blind) for (let yy = y; yy < y + h * q.blind; yy += 5) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, yy, w, 3); }
      g.fillStyle = 'rgba(0,0,0,0.75)';
      if (q.thing === 0) { g.fillRect(x + 8, y + h - 14, w * 0.45, 14); g.fillRect(x + 12, y + h - 22, 10, 8); }
      if (q.thing === 1) { g.beginPath(); g.arc(x + w - 14, y + h - 16, 8, 0, TAU); g.fill(); g.fillRect(x + w - 18, y + h - 9, 8, 9); }
      if (q.thing === 2) { g.beginPath(); g.arc(x + w * 0.4, y + h - 24, 5, 0, TAU); g.fill(); g.fillRect(x + w * 0.4 - 6, y + h - 19, 12, 19); }
      g.fillStyle = '#000'; g.fillRect(x + w / 2 - 1.5, y, 3, h);
    }
    if (city) {
      g.fillStyle = 'hsl(310,100%,62%)'; g.fillRect(bw * 2 - 3, 0, 6, H);
      g.fillStyle = 'hsl(190,100%,60%)'; g.fillRect(bw * 5 - 3, 0, 6, H);
      for (let f = 0; f < floors; f += 4) { g.fillStyle = 'hsl(190,100%,55%)'; g.fillRect(0, f * fh + 3, W, 3); }
    } else for (let f = 0; f < floors; f += 3) { g.fillStyle = 'hsl(188,90%,45%)'; g.fillRect(0, f * fh + 4, W, 2); }
  });
  for (const t of [map, glow]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, glow };
}

// City skyscrapers, each its own kind: 'glass' (a curtain wall of mirror glass), 'grid' (concrete with punched
// windows and air conditioners), 'neon' (dark panels, slit windows and light strips), 'deco' (brick with tall windows
// between stone piers) and 'tech' (white modules with round cornered windows). One tile is one face across and tileH
// metres up; the glow map has the lit rooms and lights. hue: the light strips' colour (neon, tech).
export function cityFacade(style, seed, hue = 190) {
  const R = rng(seed), W = 512, H = 1024;
  const S = { glass: [10, 6], grid: [6, 6], neon: [5, 6], deco: [4, 5], tech: [4, 6] }[style], cols = S[0], floors = S[1], fh = H / floors, cw = W / cols;
  const rooms = [];
  for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) rooms.push({ f, c, on: R() < (style === 'glass' ? 0.38 : 0.55), h: R(), l: R(), blind: R() < 0.3 ? R() * 0.7 : 0 });
  const roomCol = (q, a = 1) => {
    const [hu, sa] = q.h < 0.5 ? [36 + q.h * 30, 75] : q.h < 0.72 ? [200, 30] : q.h < 0.86 ? [hue, 70] : [300, 70];
    return `hsla(${hu},${sa}%,${52 + q.l * 26}%,${a})`;
  };
  const noise = (g, n, a, light) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${light && R() < 0.5 ? '255,255,255' : '0,0,0'},${a * R()})`; g.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 3); } };
  // Where each kind has its windows (x, y, w, h), floor f, column c.
  const win = {
    glass: (c, f) => [c * cw + 2, f * fh + 2, cw - 4, fh - 30],
    grid: (c, f) => [c * cw + cw * 0.2, f * fh + fh * 0.2, cw * 0.6, fh * 0.52],
    neon: (c, f) => [c * cw + 6, f * fh + fh * 0.36, cw - 12, fh * 0.26],
    deco: (c, f) => [c * cw + cw * 0.24, f * fh + fh * 0.16, cw * 0.52, fh * 0.64],
    tech: (c, f) => [c * cw + cw * 0.16, f * fh + fh * 0.2, cw * 0.68, fh * 0.5],
  }[style];
  const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const shape = (g, x, y, w, h) => {
    if (style === 'tech') rrect(g, x, y, w, h, 14);
    else if (style === 'deco') { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); }
    else { g.beginPath(); g.rect(x, y, w, h); }
  };
  const map = canvasTex(W, H, (g) => {
    const bg = { glass: '#183a4c', grid: '#8c8a84', neon: '#17151f', deco: '#7a402c', tech: '#d6dae0' }[style];
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (style === 'glass') {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#24566c'); gr.addColorStop(0.5, '#123040'); gr.addColorStop(1, '#1e4a5e');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // The sky in the glass: long bright slants.
      for (let i = 0; i < 7; i++) { const x = R() * W * 1.5 - W * 0.25, w = 20 + R() * 70; g.fillStyle = `rgba(190,230,255,${0.05 + R() * 0.08})`; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w - 300, H); g.lineTo(x - 300, H); g.fill(); }
      for (const q of rooms) { const [x, y, w, h] = win(q.c, q.f); g.fillStyle = `rgba(0,10,20,${R() * 0.3})`; g.fillRect(x, y, w, h); }
      for (let f = 0; f < floors; f++) { g.fillStyle = '#0c1c26'; g.fillRect(0, f * fh + fh - 28, W, 28); g.fillStyle = 'rgba(160,210,230,0.25)'; g.fillRect(0, f * fh + fh - 28, W, 2); }
      for (let c = 0; c <= cols; c++) { g.fillStyle = '#3a5464'; g.fillRect(c * cw - 2, 0, 4, H); }
      return;
    }
    if (style === 'deco') {
      // Brick courses, then stone piers and a band of stone at each floor.
      for (let y = 0; y < H; y += 12) for (let x = ((y / 12) % 2) * 17 - 17; x < W; x += 34) { g.fillStyle = `hsl(${12 + R() * 10},${38 + R() * 14}%,${26 + R() * 10}%)`; g.fillRect(x + 1, y + 1, 32, 10); }
      for (let c = 0; c <= cols; c++) { g.fillStyle = '#bba98a'; g.fillRect(c * cw - 11, 0, 22, H); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(c * cw + 9, 0, 3, H); }
      for (let f = 0; f < floors; f++) { g.fillStyle = '#c8b898'; g.fillRect(0, f * fh, W, 12); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, f * fh + 12, W, 3); }
    }
    if (style === 'grid') {
      for (let i = 0; i < 500; i++) { const x = R() * W, y = R() * H, r = 6 + R() * 30; wrap(W, H, x, y, r, (X, Y) => { g.fillStyle = `rgba(${R() < 0.5 ? '40,40,40' : '230,230,220'},${0.03 + R() * 0.05})`; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); }); }
      for (let f = 0; f < floors; f++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, f * fh, W, 4); }
    }
    if (style === 'neon') {
      for (let x = 0; x < W; x += 128) { g.fillStyle = '#26232f'; g.fillRect(x, 0, 3, H); }
      for (let y = 0; y < H; y += fh / 2) { g.fillStyle = '#26232f'; g.fillRect(0, y, W, 3); }
      for (let i = 0; i < 18; i++) { const x = R() * (W - 60), y = Math.floor(R() * floors) * fh + fh * 0.72; g.fillStyle = '#2c2a36'; g.fillRect(x, y, 50, 20); for (let k = 0; k < 5; k++) { g.fillStyle = '#0c0a12'; g.fillRect(x + 4, y + 3 + k * 3.5, 42, 1.5); } }
    }
    if (style === 'tech') {
      for (let x = 0; x < W; x += 128) { g.fillStyle = '#b8bec8'; g.fillRect(x, 0, 2, H); }
      for (let f = 0; f < floors; f++) { const gr = g.createLinearGradient(0, f * fh, 0, f * fh + fh); gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(0, f * fh, W, fh); g.fillStyle = '#9aa2ae'; g.fillRect(0, f * fh, W, 3); }
    }
    for (const q of rooms) {
      const [x, y, w, h] = win(q.c, q.f);
      if (style === 'grid' || style === 'deco') { g.fillStyle = 'rgba(0,0,0,0.45)'; shape(g, x - 4, y - 4, w + 8, h + 8); g.fill(); }
      if (style === 'tech') { g.fillStyle = '#8a929e'; shape(g, x - 5, y - 5, w + 10, h + 10); g.fill(); }
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#34485a'); gr.addColorStop(1, '#10161e');
      g.fillStyle = gr; shape(g, x, y, w, h); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x + 4, y + 4, 4, h * 0.5);
      if (style === 'grid') {
        g.fillStyle = '#b4b2aa'; g.fillRect(x - 6, y + h + 2, w + 12, 6);
        const st = g.createLinearGradient(0, y + h + 8, 0, y + h + 60); st.addColorStop(0, 'rgba(40,36,30,0.35)'); st.addColorStop(1, 'rgba(40,36,30,0)'); g.fillStyle = st; g.fillRect(x + w * 0.3, y + h + 8, 6, 52);
        if (R() < 0.3) { g.fillStyle = '#a8aaa8'; g.fillRect(x + w * 0.15, y + h + 10, w * 0.5, 26); for (let k = 0; k < 5; k++) { g.fillStyle = '#6a6c6a'; g.fillRect(x + w * 0.15 + 4, y + h + 14 + k * 4, w * 0.5 - 8, 1.5); } }
      }
      if (style === 'deco') { g.fillStyle = '#d8c8a8'; g.fillRect(x - 8, y + h, w + 16, 8); g.fillStyle = '#0c0f14'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.55, w, 3); }
      if (style === 'neon' || style === 'glass') { g.fillStyle = '#0a0a10'; g.fillRect(x + w - 3, y, 3, h); }
    }
    noise(g, 1800, 0.08, style !== 'neon');
  });
  const glow = canvasTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const q of rooms) {
      if (!q.on) continue;
      const [x, y, w, h] = win(q.c, q.f), gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, roomCol(q)); gr.addColorStop(1, roomCol(q, 0.45));
      g.fillStyle = gr; shape(g, x, y, w, h); g.fill();
      if (q.blind) for (let yy = y; yy < y + h * q.blind; yy += 6) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, yy, w, 3); }
      if (style === 'deco') { g.fillStyle = '#000'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.55, w, 3); }
      if (R() < 0.25) { g.fillStyle = 'rgba(0,0,0,0.7)'; const px = x + w * (0.2 + R() * 0.5); g.beginPath(); g.arc(px, y + h - h * 0.42, Math.min(w, h) * 0.07, 0, TAU); g.fill(); g.fillRect(px - Math.min(w, h) * 0.08, y + h - h * 0.35, Math.min(w, h) * 0.16, h * 0.35); }
    }
    if (style === 'neon') {
      // A strip of light along every floor, a second colour every other floor; little lights on the vents.
      for (let f = 0; f < floors; f++) { g.fillStyle = `hsl(${f % 2 ? hue : (hue + 120) % 360},100%,60%)`; g.fillRect(0, f * fh + 8, W, 5); }
      for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${R() < 0.5 ? hue : 330},100%,65%)`; g.fillRect(R() * W, R() * H, 3, 3); }
    }
    if (style === 'tech') for (let f = 0; f < floors; f++) { g.fillStyle = `hsl(${hue},100%,62%)`; g.fillRect(0, f * fh + fh * 0.84, W, 3); for (let x = 30; x < W; x += 128) { g.fillStyle = R() < 0.5 ? '#3f6' : `hsl(${hue},100%,70%)`; g.fillRect(x, f * fh + fh * 0.1, 6, 3); } }
    if (style === 'glass') for (let c = 1; c < cols; c += 3) { g.fillStyle = `hsla(${hue},100%,60%,0.6)`; g.fillRect(c * cw - 1, 0, 2, H); }
  });
  for (const t of [map, glow]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, glow, tileH: floors * 3.4 };
}

// The storm tower: a weather station of weathered concrete in courses, riveted iron ribs and belts with hazard
// stripes, a pipe running up, brass portholes (most lit warm), hatches, and rust and rain streaks down it all. One tile
// is a quarter of the way round (9.4 m) by 19 m tall, 54 px a metre both ways.
export function stormTex(seed) {
  const R = rng(seed), W = 512, H = 1024, course = 128, ribs = [0, 256], belt = 52;
  const holes = [], hatches = [], lamps = [];
  for (let c = 1; c < H / course; c++) for (const x0 of [30, 286]) {
    if (R() < 0.45) holes.push({ x: x0 + 40 + R() * 150, y: c * course + 40 + R() * 50, r: 13 + R() * 5, on: R() < 0.7, warm: R() });
  }
  hatches.push({ x: 60 + R() * 120, y: course * (2 + ((R() * 4) | 0)) + 14 });
  for (const x of [128, 384]) lamps.push({ x, y: belt / 2 });
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = '#626870'; g.fillRect(0, 0, W, H);
    // Concrete: blotches lighter and darker, then the joints of each pour.
    for (let i = 0; i < 900; i++) {
      const x = R() * W, y = R() * H, r = 4 + R() * 28, l = 34 + R() * 16;
      wrap(W, H, x, y, r, (X, Y) => { g.fillStyle = `hsla(215,${6 + R() * 6}%,${l}%,${0.05 + R() * 0.09})`; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); });
    }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + R() * 0.06})`; g.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
    for (let y = 0; y < H; y += course) {
      g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(0, y, W, 3);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, y + 3, W, 2);
      for (let x = 20; x < W; x += 64) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(x + (y / course) % 2 * 32, y + course / 2, 3, 0, TAU); g.fill(); }
    }
    // Rain: dark wet streaks from the top of each course.
    for (let i = 0; i < 160; i++) {
      const x = R() * W, y = Math.floor(R() * H / course) * course, len = 30 + R() * 110;
      const gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, 'rgba(10,14,20,0.32)'); gr.addColorStop(1, 'rgba(10,14,20,0)');
      g.fillStyle = gr; g.fillRect(x, y, 2 + R() * 5, len);
    }
    // The pipe, with brackets.
    const px = 410;
    const pg = g.createLinearGradient(px, 0, px + 24, 0); pg.addColorStop(0, '#2a2f36'); pg.addColorStop(0.35, '#7a828c'); pg.addColorStop(1, '#22262c');
    g.fillStyle = pg; g.fillRect(px, 0, 24, H);
    for (let y = 30; y < H; y += course) { g.fillStyle = '#1c2026'; g.fillRect(px - 6, y, 36, 10); g.fillStyle = 'rgba(160,80,30,0.35)'; g.fillRect(px - 2, y + 10, 6, 26 + R() * 30); }
    // Iron ribs with rivets and rust running down from them.
    for (const x0 of ribs) wrap(W, H, x0, H / 2, 40, (X) => {
      const rg = g.createLinearGradient(X - 15, 0, X + 15, 0); rg.addColorStop(0, '#22262d'); rg.addColorStop(0.5, '#4a515b'); rg.addColorStop(1, '#1e2228');
      g.fillStyle = rg; g.fillRect(X - 15, 0, 30, H);
      for (let y = 10; y < H; y += 24) for (const dx of [-8, 8]) {
        g.fillStyle = '#6a727c'; g.beginPath(); g.arc(X + dx, y, 2.6, 0, TAU); g.fill();
        if (R() < 0.12) { const gr = g.createLinearGradient(0, y, 0, y + 50); gr.addColorStop(0, 'rgba(150,70,25,0.55)'); gr.addColorStop(1, 'rgba(150,70,25,0)'); g.fillStyle = gr; g.fillRect(X + dx - 1.5, y, 3, 50); }
      }
    });
    // The belt round the tower: riveted iron, a hazard stripe under it, rust below.
    const bg = g.createLinearGradient(0, 0, 0, belt); bg.addColorStop(0, '#5a626c'); bg.addColorStop(0.3, '#3a4048'); bg.addColorStop(1, '#202429');
    g.fillStyle = bg; g.fillRect(0, 0, W, belt);
    for (let x = 6; x < W; x += 20) for (const y of [8, belt - 8]) { g.fillStyle = '#7a828c'; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); }
    for (let x = -20; x < W + 20; x += 28) { g.fillStyle = '#d8a020'; g.beginPath(); g.moveTo(x, belt); g.lineTo(x + 14, belt); g.lineTo(x + 24, belt + 12); g.lineTo(x + 10, belt + 12); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, belt + 12, W, 2);
    for (let i = 0; i < 40; i++) { const x = R() * W, len = 20 + R() * 90, gr = g.createLinearGradient(0, belt + 14, 0, belt + 14 + len); gr.addColorStop(0, 'rgba(140,64,22,0.5)'); gr.addColorStop(1, 'rgba(140,64,22,0)'); g.fillStyle = gr; g.fillRect(x, belt + 14, 2 + R() * 4, len); }
    // Hatches: a steel door with a wheel and a number.
    for (const h of hatches) {
      g.fillStyle = '#1a1e24'; g.fillRect(h.x - 4, h.y - 4, 76, 106);
      const dg = g.createLinearGradient(h.x, 0, h.x + 68, 0); dg.addColorStop(0, '#4a525c'); dg.addColorStop(1, '#2c3138');
      g.fillStyle = dg; g.fillRect(h.x, h.y, 68, 98);
      g.strokeStyle = '#7a828c'; g.lineWidth = 3; g.beginPath(); g.arc(h.x + 34, h.y + 46, 12, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(h.x + 22, h.y + 46); g.lineTo(h.x + 46, h.y + 46); g.moveTo(h.x + 34, h.y + 34); g.lineTo(h.x + 34, h.y + 58); g.stroke();
      g.fillStyle = 'rgba(230,230,220,0.8)'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('S-' + String(10 + ((R() * 80) | 0)), h.x + 34, h.y + 22);
    }
    // Portholes: a brass rim, bolts round it, dark glass (the light is in the glow map).
    for (const o of holes) wrap(W, H, o.x, o.y, o.r + 8, (X, Y) => {
      g.fillStyle = '#1a1c20'; g.beginPath(); g.arc(X, Y, o.r + 7, 0, TAU); g.fill();
      const rg = g.createRadialGradient(X - 3, Y - 3, o.r * 0.5, X, Y, o.r + 6); rg.addColorStop(0, '#d8b060'); rg.addColorStop(1, '#6a4a20');
      g.fillStyle = rg; g.beginPath(); g.arc(X, Y, o.r + 5, 0, TAU); g.fill();
      g.fillStyle = '#10141a'; g.beginPath(); g.arc(X, Y, o.r, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(X - o.r * 0.35, Y - o.r * 0.35, o.r * 0.3, 0, TAU); g.fill();
      for (let k = 0; k < 8; k++) { g.fillStyle = '#4a3a1a'; g.beginPath(); g.arc(X + Math.cos(k * 0.785) * (o.r + 3), Y + Math.sin(k * 0.785) * (o.r + 3), 1.5, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(120,56,20,0.35)'; g.fillRect(X - 2, Y + o.r + 6, 4, 18 + o.r);
    });
    for (const l of lamps) { g.fillStyle = '#2a0808'; g.beginPath(); g.arc(l.x, l.y, 7, 0, TAU); g.fill(); }
  });
  const glow = canvasTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const o of holes) {
      if (!o.on) continue;
      wrap(W, H, o.x, o.y, o.r, (X, Y) => {
        const gr = g.createRadialGradient(X, Y, 1, X, Y, o.r);
        gr.addColorStop(0, o.warm < 0.75 ? 'rgb(255,214,140)' : 'rgb(190,230,255)'); gr.addColorStop(1, o.warm < 0.75 ? 'rgb(150,90,30)' : 'rgb(60,110,150)');
        g.fillStyle = gr; g.beginPath(); g.arc(X, Y, o.r, 0, TAU); g.fill();
      });
    }
    for (const l of lamps) { const gr = g.createRadialGradient(l.x, l.y, 1, l.x, l.y, 7); gr.addColorStop(0, 'rgb(255,120,100)'); gr.addColorStop(1, 'rgb(160,10,10)'); g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, 7, 0, TAU); g.fill(); }
    for (const h of hatches) { g.fillStyle = 'rgb(80,255,140)'; g.fillRect(h.x + 76, h.y + 10, 5, 5); }
  });
  for (const t of [map, glow]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, glow };
}

// The lighthouse: whitewashed stone in courses, red bands with weathered edges, arched windows with stone frames,
// sills and teal shutters. One tile is about 9.4 m round by 30 m tall (54 px a metre across, 34 up), so shapes are
// drawn squashed upright to come out right on the tower.
export function lighthouseTex(seed) {
  const R = rng(seed), K = 34 / 54;
  const t = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#cfcac0'; g.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += 12, row++) {
      for (let x = row % 2 ? -22 : 0; x < w; x += 44) {
        g.fillStyle = `hsl(40,${10 + R() * 10}%,${87 + R() * 9}%)`; g.fillRect(x + 1.5, y + 1.2, 41, 10);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1.5, y + 1.2, 41, 1.5);
        g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 1.5, y + 10, 41, 1.5);
        if (R() < 0.08) { g.fillStyle = 'rgba(120,110,90,0.18)'; g.fillRect(x + 4 + R() * 20, y + 3, 8 + R() * 10, 4); }
      }
    }
    for (let y = 0; y < h; y += 512) {
      g.fillStyle = '#b42a26'; g.fillRect(0, y, w, 128);
      for (let r = 0; r < 128; r += 12) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(0, y + r + 10, w, 1.5); }
      for (let x = 0; x < w; x += 44) { g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(x, y, 2, 128); }
      for (let x = 0; x < w; x += 3) if (R() < 0.3) { g.fillStyle = 'rgba(180,42,38,0.45)'; g.fillRect(x, y + 128, 3, 2 + R() * 9); }
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, y, w, 3);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + 125, w, 3);
    }
    const arch = (x, y, rx, bottom) => { g.beginPath(); g.moveTo(x - rx, bottom); g.lineTo(x - rx, y); g.ellipse(x, y, rx, rx * K, 0, Math.PI, 0); g.lineTo(x + rx, bottom); g.closePath(); g.fill(); };
    for (let y = 300; y < h; y += 512) for (let x = 64; x < w; x += 128) {
      g.fillStyle = '#a8a294'; arch(x, y, 38, y + 78);
      g.fillStyle = '#26323e'; arch(x, y, 31, y + 72);
      const gr = g.createLinearGradient(0, y - 20, 0, y + 70); gr.addColorStop(0, '#c8e6f6'); gr.addColorStop(1, '#5a8aae');
      g.fillStyle = gr; arch(x, y + 2, 26, y + 68);
      g.fillStyle = '#26323e'; g.fillRect(x - 1.5, y - 18, 3, 88); g.fillRect(x - 26, y + 24, 52, 3);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x - 21, y, 5, 22);
      g.fillStyle = '#2e8a8a'; g.fillRect(x - 58, y - 14, 17, 86); g.fillRect(x + 41, y - 14, 17, 86);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 9; k++) { g.fillRect(x - 58, y - 10 + k * 9, 17, 2); g.fillRect(x + 41, y - 10 + k * 9, 17, 2); }
      g.fillStyle = '#ebe6da'; g.fillRect(x - 44, y + 76, 88, 8);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 44, y + 84, 88, 3);
      // A flower box under every other window.
      if ((x / 128 | 0) % 2 === 0) {
        g.fillStyle = '#8a5a34'; g.fillRect(x - 34, y + 87, 68, 12);
        for (let k = 0; k < 16; k++) { g.fillStyle = k % 3 ? '#4a9a3a' : ['#ff5a8a', '#ffe066', '#ffffff'][k % 3 === 0 ? (k / 3) % 3 : 0]; g.beginPath(); g.arc(x - 30 + k * 4 + R() * 2, y + 86 - R() * 6, 3 + R() * 2, 0, TAU); g.fill(); }
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Steel for the storm's lightning pylons: plates with seams and rivets, streaks of rust and rain, a hazard band. One
// tile is once round and 16 m up.
export function steelTex(seed) {
  const R = rng(seed);
  const t = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2c323c'; g.fillRect(0, 0, w, h);
    const pw = w / 8, ph = h / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) {
      const x = i * pw + (j % 2 ? pw / 2 : 0), l = 24 + R() * 10;
      for (const X of [x, x - w]) {
        const gr = g.createLinearGradient(X, 0, X + pw, 0); gr.addColorStop(0, `hsl(215,10%,${l - 6}%)`); gr.addColorStop(0.4, `hsl(215,12%,${l + 6}%)`); gr.addColorStop(1, `hsl(215,10%,${l - 8}%)`);
        g.fillStyle = gr; g.fillRect(X + 2, j * ph + 2, pw - 4, ph - 4);
        g.fillStyle = 'rgba(200,210,225,0.5)';
        for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(X + 7 + (k % 3) * (pw - 14) / 2, j * ph + (k < 3 ? 7 : ph - 7), 1.8, 0, TAU); g.fill(); }
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = R() * w, y = R() * h, sl = 30 + R() * 140, rust = R() < 0.35;
      const gr = g.createLinearGradient(0, y, 0, y + sl); gr.addColorStop(0, rust ? 'rgba(140,70,30,0.35)' : 'rgba(10,14,20,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, 2 + R() * 4, sl);
    }
    for (let x = -h; x < w; x += 28) { g.fillStyle = '#d8b020'; g.beginPath(); g.moveTo(x, h - 4); g.lineTo(x + 14, h - 4); g.lineTo(x + 30, h - 20); g.lineTo(x + 16, h - 20); g.fill(); }
    g.fillStyle = '#14181e'; g.fillRect(0, h - 24, w, 4); g.fillRect(0, h - 4, w, 4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- what must stay clear
// Everything of the climb as boxes, grown by the room round them that must stay empty: some to the sides, a lot above
// (to stand, jump and for the camera behind you), a little below. Bucketed by height so lookups stay quick.
export function clearance(L, o = {}) {
  const B = new Map(), CELL = 8;
  const put = (x0, y0, z0, x1, y1, z1) => {
    const b = [x0, y0, z0, x1, y1, z1];
    for (let k = Math.floor(y0 / CELL); k <= Math.floor(y1 / CELL); k++) { if (!B.has(k)) B.set(k, []); B.get(k).push(b); }
  };
  const side = o.side ?? 1.8;
  const grow = (x0, y0, z0, x1, y1, z1, s = side, up = 2.4, down = 1.2) => put(x0 - s, y0 - down, z0 - s, x1 + s, y1 + up, z1 + s);
  for (const c of L.cols) {
    if (c.kind === 'core' || (o.skip && o.skip(c))) continue;
    // Moving ones get room for where they go; on top, room to stand and jump.
    const mv = c.dyn ? 6 : 0;
    grow(c.minx - mv, c.miny - mv, c.minz - mv, c.maxx + mv, c.maxy + mv + 4.2, c.maxz + mv);
  }
  for (const q of L.recs || []) {
    if (q.guard || (o.skipRec && o.skipRec(q))) continue;
    const ex = Math.abs(q.c) * q.hx + Math.abs(q.s) * q.hz, ez = Math.abs(q.s) * q.hx + Math.abs(q.c) * q.hz;
    grow(q.x - ex, q.y, q.z - ez, q.x + ex, q.y + q.h, q.z + ez);
  }
  const PTS = [['x', 'y', 'z'], ['ax', 'ay', 'az'], ['bx', 'by', 'bz'], ['tx', 'ty', 'tz'], ['cx', 'cy', 'cz'], ['px0', 'py0', 'pz0'], ['px1', 'py1', 'pz1']];
  const pts = (q, out) => { for (const [a, b, c] of PTS) if (typeof q[a] === 'number' && typeof q[c] === 'number') out.push([q[a], typeof q[b] === 'number' ? q[b] : q.y ?? q.cy ?? 0, q[c]]); };
  for (const k of ['obs', 'moves', 'zips', 'anchors', 'bats', 'monsters', 'arrows', 'rocks', 'lasers', 'fans', 'jumpers', 'coins', 'relics', 'signs', 'bumpers', 'geysers', 'doors', 'swings', 'decor', 'cps', 'mazes']) {
    for (const q of L[k] || []) {
      const p = [];
      pts(q, p);
      if (q.col) pts(q.col, p);
      if (!p.length) continue;
      let e = 1 + Math.max(q.r || 0, q.rad || 0, q.w || 0, q.reach || 0, q.range || 0, Math.abs(q.a || 0), Math.abs(q.b || 0), q.hx || 0, q.hz || 0), up = 3, down = 1;
      if (k === 'rocks') up = 26;
      if (k === 'swings') { e += 5; up = 9; }
      // The camera looks down into a maze from high up.
      if (k === 'mazes') { e = (q.half ?? q.N * 1.3 + 1.6) + 3; up = 16; }
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const [x, y, z] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
      grow(x0, y0, z0, x1, y1, z1, e, up, down);
    }
  }
  for (const t of o.trees || []) grow(t.x - t.r, t.base, t.z - t.r, t.x + t.r, t.top + 4, t.z + t.r, 1.2, 0, 0);
  const hit = (x, y, z, r) => {
    for (let k = Math.floor((y - r) / CELL); k <= Math.floor((y + r) / CELL); k++) {
      for (const b of B.get(k) || []) if (x + r > b[0] && x - r < b[3] && y + r > b[1] && y - r < b[4] && z + r > b[2] && z - r < b[5]) return true;
    }
    return false;
  };
  return {
    hit,
    // Along a segment, every 0.7 m.
    seg(a, d, len, r) { for (let s = 0; s <= len + 0.01; s += 0.7) if (hit(a.x + d.x * s, a.y + d.y * s, a.z + d.z * s, r)) return true; return false; },
    // Something new that later things keep clear of (no extra room).
    take(x, y, z, r) { put(x - r, y - r, z - r, x + r, y + r, z + r); },
  };
}

// ---------------------------------------------------------------- branches, crowns and things on bark
// Collects instances per model and per height band, then draws each lot as one instanced mesh, only near the camera.
function batcher(view) {
  const lots = new Map();
  return {
    add(key, m, tint) {
      const y = m.elements[13], k = key + '|' + Math.floor(y / 50);
      if (!lots.has(k)) lots.set(k, { key, y, list: [] });
      lots.get(k).list.push([m, tint]);
    },
    draw(geoOf, matOf) {
      const col = new THREE.Color();
      for (const { key, y, list } of lots.values()) {
        const im = new THREE.InstancedMesh(geoOf(key), matOf(key), list.length);
        list.forEach(([m, t], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(t ?? 0xffffff)); });
        view.add(im, key !== 'ivy');
        view.band(y).near.push(im);
      }
    },
  };
}

// A matrix that stands the unit model at p, its up axis along d, scaled (sx, len, sz).
function along(p, d, sx, len, sz = sx) {
  tmpQ.setFromUnitVectors(UP, d);
  return new THREE.Matrix4().compose(p, tmpQ, tmpS.set(sx, len, sz));
}
// A matrix for a model at (x, y, z), turned ry about up, then tilted rx, scaled.
function place(x, y, z, s, ry = 0, rx = 0, sy = s, sz = s) {
  tmpE.set(rx, ry, 0, 'YXZ');
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE), tmpS.set(s, sy, sz));
}

// A limb: a tapering bark cylinder, base radius 1 at y 0 to 0.55 at y 1, closed at the tip.
let LIMB = null;
const limbGeo = () => LIMB || (LIMB = new THREE.CylinderGeometry(0.55, 1, 1, 10, 3).translate(0, 0.5, 0));

// Tints so neighbouring clumps are not all one green.
function leafTint(R) { const l = 0.8 + R() * 0.28; return new THREE.Color(l * (0.94 + R() * 0.1), l, l * (0.82 + R() * 0.2)).getHex(); }

// Plans one branch from p along d: the limb, two smaller ones from part way along, and leaf clumps at the ends. Grows it
// only if every part is clear, then marks it taken so later branches stay off it.
function branch(R, C, out, p, d, len, thick, leaf, big = 1) {
  const parts = [[p.clone(), d.clone(), len, thick]], clumps = [];
  const tip = p.clone().addScaledVector(d, len);
  clumps.push([tip.clone().addScaledVector(d, 0.3).add(new THREE.Vector3(0, 0.35, 0)), (1.35 + R() * 0.5) * big]);
  for (const s of [-1, 1]) {
    if (R() < 0.18) continue;
    const at = p.clone().addScaledVector(d, len * (0.42 + R() * 0.24)), yaw = s * (0.5 + R() * 0.45), c = Math.cos(yaw), sn = Math.sin(yaw);
    const sd = new THREE.Vector3(d.x * c - d.z * sn, d.y + 0.28 + R() * 0.2, d.x * sn + d.z * c).normalize(), sl = len * (0.42 + R() * 0.2);
    parts.push([at, sd, sl, thick * 0.55]);
    clumps.push([at.clone().addScaledVector(sd, sl + 0.25).add(new THREE.Vector3(0, 0.3, 0)), (1.0 + R() * 0.4) * big]);
  }
  if (len > 4.5) clumps.push([p.clone().addScaledVector(d, len * 0.78).add(new THREE.Vector3(0, 0.8, 0)), (0.9 + R() * 0.3) * big]);
  // The first metre is inside the trunk: only what sticks out has to be clear.
  for (let i = 0; i < parts.length; i++) {
    const [a, dd, l, t] = parts[i], skip = i === 0 ? 1.2 : 0;
    if (C.seg(a.clone().addScaledVector(dd, skip), dd, l - skip, t + 0.25)) return false;
  }
  for (const [c, s] of clumps) if (C.hit(c.x, c.y, c.z, s * 1.15)) return false;
  for (const [a, dd, l, t] of parts) {
    out.add('limb', along(a, dd, t, l));
    for (let s = 0; s <= l; s += 1.5) C.take(a.x + dd.x * s, a.y + dd.y * s, a.z + dd.z * s, t + 0.4);
  }
  for (const [c, s] of clumps) {
    out.add(leaf, place(c.x, c.y, c.z, s, R() * TAU, (R() - 0.5) * 0.3), leafTint(R));
    C.take(c.x, c.y, c.z, s * 1.2);
  }
  return true;
}

// The forest's giant trunk: ivy, shelf fungi and branches. Side trees: crowns and a few branches. Waterfall: ferns, moss
// and ivy on the rock. The other maps: steel fins and strips on the storm and city towers.
export function buildCoreDetail(view) {
  const L = view.level, key = view.key, D = detail(), R = rng(3301), top = L.top - 1.2;
  const out = batcher(view);
  const barkFor = view.barkTex;
  const limbMat = barkFor ? (() => { const t = barkFor.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1.6); t.needsUpdate = true; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0 }); })() : null;
  const veg = vegMat();
  const geoOf = (k) => (k === 'limb' ? limbGeo() : modelGeo(k)), matOf = (k) => (k === 'limb' ? limbMat : veg);
  // Outward at angle a on a column of radius r: the turn that faces a model's +z out.
  const face = (a) => Math.atan2(Math.cos(a), Math.sin(a));
  if (key === 'forest') {
    // Ivy in long runs up the trunk, hugging it inside the solid skin (it never sticks out where you walk).
    const runs = D === 0 ? 40 : 90;
    for (let i = 0; i < runs; i++) {
      let a = R() * TAU, y = 2 + R() * (top - 8);
      const n = 3 + ((R() * 10) | 0);
      for (let k = 0; k < n && y < top - 3; k++, y += 2.6) {
        a += (R() - 0.5) * 0.06;
        const r = view.coreAt(y) + 0.01, s = 0.9 + R() * 0.35;
        out.add('ivy', place(Math.cos(a) * r, y, Math.sin(a) * r, s, face(a), 0, s, 0.8), leafTint(R));
        if (R() < 0.5) { const b = a + (R() < 0.5 ? -1 : 1) * 0.05; out.add('ivy', place(Math.cos(b) * r, y + 1.2, Math.sin(b) * r, s * 0.8, face(b), 0, s * 0.8, 0.8), leafTint(R)); }
      }
    }
    // Shelf fungi where nobody walks right by.
    const C = clearance(L, { trees: L.trees, side: 1.2 });
    for (let i = 0, n = D === 0 ? 60 : 140; i < n; i++) {
      const a = R() * TAU, y = 3 + R() * (top - 8), r = view.coreAt(y);
      if (C.hit(Math.cos(a) * (r + 0.4), y, Math.sin(a) * (r + 0.4), 0.5)) continue;
      const s = 0.7 + R() * 0.8;
      out.add('bracket', place(Math.cos(a) * r, y, Math.sin(a) * r, s, face(a), 0, s, s * 1.1));
    }
    // Branches with leaves, wherever there is room: up to two in every 10 m of height.
    const CB = clearance(L, { trees: L.trees });
    let grown = 0;
    for (let y0 = 10; y0 < top - 14; y0 += 10) {
      let got = 0;
      for (let k = 0; k < 18 && got < (D === 0 ? 1 : 2); k++) {
        const y = y0 + R() * 10, a = R() * TAU, r = view.coreAt(y), len = 3.5 + R() * 3.5, el = 0.22 + R() * 0.45, yaw = (R() - 0.5) * 0.7;
        const d = new THREE.Vector3(Math.cos(a + yaw) * Math.cos(el), Math.sin(el), Math.sin(a + yaw) * Math.cos(el));
        const p = new THREE.Vector3(Math.cos(a) * (r - 1.0), y, Math.sin(a) * (r - 1.0));
        if (branch(R, CB, out, p, d, len + 1.0, 0.3 + len * 0.045, R() < 0.7 ? 'canopy' : 'canopy2')) got++;
      }
      grown += got;
    }
    view.coreBranches = grown;
  }
  // The side trees: a crown of limbs and leaves on top, and branches lower down where there is room.
  const T = L.trees || [];
  if (T.length && T[0].kind === 'tree') {
    const C = clearance(L, { skip: (c) => c.kind === 'trunk' });
    for (const t of T) {
      const floating = t.base > 0, low = floating ? t.base + 3 : t.base;
      for (let y = low + 5; y < t.top - 3; y += 4) {
        if (R() < 0.4) continue;
        const a = R() * TAU, len = 2.4 + R() * 2.2, el = 0.35 + R() * 0.4;
        const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
        branch(R, C, out, new THREE.Vector3(t.x + Math.cos(a) * (t.r - 0.6), y + R() * 3, t.z + Math.sin(a) * (t.r - 0.6)), d, len + 0.6, 0.18 + len * 0.04, 'canopy');
      }
      // The crown: limbs fanning steeply up and out from the top, big clumps high above the end of the climb round it
      // (its own last lap is left out of the check, but not the branch back to the main trunk: the crown starts well
      // above where anyone there jumps).
      const near = (x, z) => Math.hypot(x - t.x, z - t.z) < 8.5;
      const Ct = clearance(L, { skip: (c) => near(c.x, c.z) && c.maxy < t.top + 0.5 && c.kind !== 'branch', skipRec: (q) => near(q.x, q.z) && q.y < t.top - 2.5 });
      // A drawn trunk carries on up into the crown (it stands on the trunk's flat top, 3 m above the last platform).
      if (Ct.seg(new THREE.Vector3(t.x, t.top + 0.5, t.z), UP, 7, 1.9)) continue;
      out.add('limb', along(new THREE.Vector3(t.x, t.top - 2, t.z), UP, t.r * 0.8, 9.5));
      const cy = t.top - 1, n = 7 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + R() * 0.5, el = 0.95 + R() * 0.3, len = 5.5 + R() * 2.5;
        const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
        branch(R, Ct, out, new THREE.Vector3(t.x + Math.cos(a) * 0.5, cy, t.z + Math.sin(a) * 0.5), d, len, 0.5, R() < 0.6 ? 'canopy' : 'canopy2', 1.35);
      }
      for (const [dx, dy, dz, s] of [[0, 8.2, 0, 3.0], [1.6, 7.0, 1.2, 2.4], [-1.5, 7.2, -1.0, 2.4]]) {
        if (Ct.hit(t.x + dx, t.top + dy, t.z + dz, s)) continue;
        out.add('canopy', place(t.x + dx, t.top + dy, t.z + dz, s, R() * TAU), leafTint(R));
        Ct.take(t.x + dx, t.top + dy, t.z + dz, s);
      }
      view.crowns = (view.crowns || 0) + 1;
    }
  }
  // Waterfall: the rock stacks get mossy ferny tops, and ivy and ferns grow on the big rock where nobody passes.
  if (key === 'waterfall') {
    const C = clearance(L, { skip: (c) => c.kind === 'trunk', side: 1.2 });
    for (const t of T) {
      for (let k = 0; k < 7; k++) {
        const a = R() * TAU, rr = k ? t.r * (0.4 + R() * 0.55) : 0, x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr, s = k ? 0.9 + R() * 0.6 : 1.6;
        if (C.hit(x, t.top + 0.6, z, s * 0.8)) continue;
        out.add('mossclump', place(x, t.top + 0.25, z, s, R() * TAU), leafTint(R));
      }
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + R() * 0.3, x = t.x + Math.cos(a) * (t.r - 0.1), z = t.z + Math.sin(a) * (t.r - 0.1);
        if (C.hit(x, t.top, z, 0.6)) continue;
        out.add(R() < 0.6 ? 'fern' : 'flowers', place(x, t.top, z, 1 + R() * 0.5, R() * TAU));
      }
    }
    for (let i = 0, n = D === 0 ? 50 : 120; i < n; i++) {
      const a = R() * TAU, y = 4 + R() * (top - 10), r = view.coreAt(y);
      if (C.hit(Math.cos(a) * (r + 0.5), y + 1, Math.sin(a) * (r + 0.5), 0.8)) continue;
      if (R() < 0.6) out.add('ivy', place(Math.cos(a) * (r + 0.02), y, Math.sin(a) * (r + 0.02), 1 + R() * 0.4, face(a), 0, 1.2 + R() * 0.5, 0.8), leafTint(R));
      else out.add('fern', place(Math.cos(a) * (r + 0.1), y, Math.sin(a) * (r + 0.1), 1 + R() * 0.5, face(a), 1.1));
    }
  }
  out.draw(geoOf, matOf);
  // Storm and city: steel fins up the tower, a few of them lit, flush with the wall (inside its solid skin).
  if (key === 'storm') {
    // Copper lightning conductors up the tower on iron brackets.
    const R0 = L.top - 1.2, H = R0 + 40, y = (R0 - 40) / 2, n = 6, r = view.coreAt(y) + 0.32;
    const rod = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), panelMat(0xb87333, { metalness: 0.85, roughness: 0.35, pattern: 0 }), n);
    const brackets = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.4;
      rod.setMatrixAt(k, place(Math.cos(a) * r, y, Math.sin(a) * r, 1, 0, 0, H, 1));
      for (let yy = -38; yy < R0; yy += 5) brackets.push(place(Math.cos(a) * (r - 0.15), yy, Math.sin(a) * (r - 0.15), 1, face(a), 0, 0.1, 0.12));
    }
    const br = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1, 1), panelMat(0x2a2e35, { metalness: 0.7, roughness: 0.5, pattern: 0 }), brackets.length);
    brackets.forEach((m, i) => br.setMatrixAt(i, m));
    rod.frustumCulled = br.frustumCulled = false;
    view.add(rod, false);
    view.add(br, false);
  }
  if (key === 'city') {
    const R0 = L.top - 1.2, H = R0 + 40, y = (R0 - 40) / 2, n = 16;
    const fin = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1, 0.18), panelMat(key === 'city' ? 0x3a3646 : 0x46505e, { metalness: 0.75, roughness: 0.35, pattern: 0 }), n);
    const lit = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.03), new THREE.MeshBasicMaterial({ color: HDR(key === 'city' ? 0xff40d0 : 0x5af0ff, 2.2) }), n / 4);
    for (let k = 0, j = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.13, r = view.coreAt(y) + 0.1;
      fin.setMatrixAt(k, place(Math.cos(a) * r, y, Math.sin(a) * r, 1, face(a), 0, H, 1));
      if (k % 4 === 0) lit.setMatrixAt(j++, place(Math.cos(a) * (r + 0.1), y, Math.sin(a) * (r + 0.1), 1, face(a), 0, H, 1));
    }
    fin.frustumCulled = lit.frustumCulled = false;
    view.add(fin, false);
    view.add(lit, false);
    // A steel ledge ring every twelve floors (42 m), flush.
    const rings = [];
    for (let yy = 42 - 20; yy < R0; yy += 42) rings.push(yy);
    const ring = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.5, 64, 1, true), panelMat(key === 'city' ? 0x4a4658 : 0x56606e, { metalness: 0.7, roughness: 0.4, pattern: 0 }), rings.length);
    rings.forEach((yy, i) => { const r = view.coreAt(yy) + 0.06; ring.setMatrixAt(i, new THREE.Matrix4().makeScale(r, 1, r).setPosition(0, yy, 0)); });
    ring.frustumCulled = false;
    view.add(ring, false);
  }
}
