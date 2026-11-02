// Everything a climber can wear: suits (colours, flags, costumes, legendaries), faces and hats, with the
// painters that draw them. No three.js in here; stickman.js turns these into materials and the shop into
// thumbnails.
import { rng } from './util.js';

// Older phones' browsers don't have this yet; faces and thumbnails use it.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    this.moveTo(x + k, y);
    this.arcTo(x + w, y, x + w, y + h, k);
    this.arcTo(x + w, y + h, x, y + h, k);
    this.arcTo(x, y + h, x, y, k);
    this.arcTo(x, y, x + w, y, k);
    this.closePath();
  };
}

// Rarity decides the colour of the card and how you get the thing.
export const RARITY = [
  { id: 0, name: 'Common', css: '#4fe06e' },
  { id: 1, name: 'Rare', css: '#4aa8ff' },
  { id: 2, name: 'Epic', css: '#b86bff' },
  { id: 3, name: 'Legendary', css: '#ff9a2e' },
  { id: 4, name: 'Owner', css: '#ff3b5c' },
];

// ---------------------------------------------------------------- how a suit texture is laid out
// A 512 x 512 canvas. Three columns: the body seen from the front, the body seen from behind and the arms.
// Height is shared: 1.24 m above the climber's centre at the top of the canvas, 0.44 m below it at the bottom.
export const TEX = 512, COL_W = 192, COL_FRONT = 0, COL_BACK = 192, COL_ARMS = 384, ARM_W = 128;
export const FIG_TOP = 1.24, FIG_H = 1.68, BODY_W = 0.42, ARM_SPAN = 0.48;
const Y = (fy) => ((FIG_TOP - fy) / FIG_H) * TEX;
// Across a body column, from a height and a sideways offset in metres (0 is the middle).
const PXM = COL_W / BODY_W;
const X = (fx) => COL_W / 2 + fx * PXM;
const HEAD_Y = Y(0.82), WAIST_Y = Y(0.28), ANKLE_Y = Y(-0.3), WRIST_Y = Y(0.2);

function P(g) {
  const fill = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const api = {
    g,
    all: (c) => fill(c, 0, 0, TEX, TEX),
    head: (c) => fill(c, 0, 0, COL_ARMS, HEAD_Y),
    torso: (c) => fill(c, 0, HEAD_Y, COL_ARMS, WAIST_Y - HEAD_Y),
    legs: (c) => fill(c, 0, WAIST_Y, COL_ARMS, TEX - WAIST_Y),
    feet: (c) => fill(c, 0, ANKLE_Y, COL_ARMS, TEX - ANKLE_Y),
    arms: (c) => fill(c, COL_ARMS, 0, ARM_W, TEX),
    hands: (c) => fill(c, COL_ARMS, WRIST_Y, ARM_W, TEX - WRIST_Y),
    // Runs fn once in each body column, with x from 0 to COL_W.
    both(fn) { for (const [cx, side] of [[COL_FRONT, 0], [COL_BACK, 1]]) { g.save(); g.beginPath(); g.rect(cx, 0, COL_W, TEX); g.clip(); g.translate(cx, 0); fn(side); g.restore(); } },
    front(fn) { g.save(); g.beginPath(); g.rect(COL_FRONT, 0, COL_W, TEX); g.clip(); g.translate(COL_FRONT, 0); fn(); g.restore(); },
    back(fn) { g.save(); g.beginPath(); g.rect(COL_BACK, 0, COL_W, TEX); g.clip(); g.translate(COL_BACK, 0); fn(); g.restore(); },
    rect: (c, fx0, fy0, fx1, fy1) => { g.fillStyle = c; g.fillRect(X(fx0), Y(fy0), (fx1 - fx0) * PXM, Y(fy1) - Y(fy0)); },
    armBand: (c, fy0, fy1) => fill(c, COL_ARMS, Y(fy0), ARM_W, Y(fy1) - Y(fy0)),
    hStripes(a, b, n) { const h = TEX / n; for (let i = 0; i < n; i++) fill(i % 2 ? b : a, 0, i * h, TEX, h + 1); },
    vStripes(a, b, n) {
      const w = COL_W / n;
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) fill(i % 2 ? b : a, c * COL_W + i * w, 0, w + 1, TEX);
      const aw = ARM_W / Math.max(2, n >> 1);
      for (let i = 0; i < Math.max(2, n >> 1); i++) fill(i % 2 ? b : a, COL_ARMS + i * aw, 0, aw + 1, TEX);
    },
    checks(a, b, n) { const s = TEX / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) fill((i + j) % 2 ? b : a, i * s, j * s, s + 1, s + 1); },
    dots(c, n, r0, r1, seed = 7) { const R = rng(seed); g.fillStyle = c; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(R() * TEX, R() * TEX, r0 + R() * (r1 - r0), 0, 7); g.fill(); } },
    blobs(colors, n, r0, r1, seed = 3) {
      const R = rng(seed);
      for (let i = 0; i < n; i++) {
        g.fillStyle = colors[(R() * colors.length) | 0];
        g.beginPath();
        g.ellipse(R() * TEX, R() * TEX, r0 + R() * (r1 - r0), r0 + R() * (r1 - r0), R() * 3, 0, 7);
        g.fill();
      }
    },
    vgrad(a, b, y0 = 0, y1 = TEX) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, y0, TEX, y1 - y0); },
    lines(c, n, w, seed = 5) {
      const R = rng(seed);
      g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round';
      for (let i = 0; i < n; i++) { const x = R() * TEX, y = R() * TEX, a = R() * 6.3, l = 12 + R() * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    },
  };
  return api;
}

const SKIN = '#f2c9a4', DARKSKIN = '#a9744a';

// ---------------------------------------------------------------- flags
// A flag draws into a rectangle (normalised 0..1 in both directions). at() gives a frame where 1 unit is the
// short side of the real surface, so circles and stars stay round even on the tall narrow body column.
// em is the height of a centred emblem: on the chest on a body, in the middle on a cape.
function flagTools(g, w, h, ratio, em) {
  const F = {
    w, h, em,
    bg(c) { g.fillStyle = c; g.fillRect(0, 0, w, h); },
    h3(...c) { const n = c.length; c.forEach((k, i) => { g.fillStyle = k; g.fillRect(0, (i / n) * h, w, h / n + 1); }); },
    v3(...c) { const n = c.length; c.forEach((k, i) => { g.fillStyle = k; g.fillRect((i / n) * w, 0, w / n + 1, h); }); },
    r(c, x0, y0, x1, y1) { g.fillStyle = c; g.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h); },
    at(cx, cy, fn) { g.save(); g.translate(cx * w, cy * h); g.scale(w, h * ratio); fn(g); g.restore(); },
    disc(c, cx, cy, rad) { F.at(cx, cy, () => { g.fillStyle = c; g.beginPath(); g.arc(0, 0, rad, 0, 7); g.fill(); }); },
    star(c, cx, cy, rad, rot = 0, n = 5) {
      F.at(cx, cy, () => {
        g.rotate(rot);
        g.fillStyle = c; g.beginPath();
        for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, q = i % 2 ? rad * 0.42 : rad; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
        g.closePath(); g.fill();
      });
    },
    // A line in normalised coordinates, thickness as a share of the height.
    line(c, x0, y0, x1, y1, t) { g.strokeStyle = c; g.lineWidth = t * h; g.lineCap = 'butt'; g.beginPath(); g.moveTo(x0 * w, y0 * h); g.lineTo(x1 * w, y1 * h); g.stroke(); },
    poly(c, pts) { g.fillStyle = c; g.beginPath(); for (const [x, y] of pts) g.lineTo(x * w, y * h); g.closePath(); g.fill(); },
    // Nordic cross, its upright a little towards the hoist.
    nordic(bg, c, c2) {
      F.bg(bg);
      F.r(c, 0.3, 0, 0.44, 1); F.r(c, 0, 0.42, 1, 0.58);
      if (c2) { F.r(c2, 0.335, 0, 0.405, 1); F.r(c2, 0, 0.47, 1, 0.53); }
    },
    union(x1 = 1, y1 = 1) {
      // Union Jack in the part of the flag from (0, 0) to (x1, y1).
      g.save(); g.beginPath(); g.rect(0, 0, w * x1, h * y1); g.clip();
      F.r('#012169', 0, 0, x1, y1);
      F.line('#ffffff', 0, 0, x1, y1, 0.13 * y1); F.line('#ffffff', x1, 0, 0, y1, 0.13 * y1);
      F.line('#c8102e', 0, 0, x1, y1, 0.05 * y1); F.line('#c8102e', x1, 0, 0, y1, 0.05 * y1);
      F.r('#ffffff', x1 * 0.42, 0, x1 * 0.58, y1); F.r('#ffffff', 0, y1 * 0.38, x1, y1 * 0.62);
      F.r('#c8102e', x1 * 0.46, 0, x1 * 0.54, y1); F.r('#c8102e', 0, y1 * 0.44, x1, y1 * 0.56);
      g.restore();
    },
  };
  return F;
}

// Maple leaf outline, centred on 0, 0 with radius about 1.
const MAPLE = [[0, -1], [0.16, -0.68], [0.32, -0.76], [0.26, -0.3], [0.46, -0.5], [0.52, -0.34], [0.86, -0.4], [0.74, -0.08], [0.9, 0], [0.5, 0.34], [0.56, 0.54], [0.08, 0.46], [0.08, 0.92], [-0.08, 0.92], [-0.08, 0.46], [-0.56, 0.54], [-0.5, 0.34], [-0.9, 0], [-0.74, -0.08], [-0.86, -0.4], [-0.52, -0.34], [-0.46, -0.5], [-0.26, -0.3], [-0.32, -0.76], [-0.16, -0.68]];

const FLAG_DRAW = {
  de: (F) => F.h3('#111111', '#dd0000', '#ffce00'),
  us: (F) => {
    for (let i = 0; i < 13; i++) F.r(i % 2 ? '#ffffff' : '#b22234', 0, i / 13, 1, (i + 1) / 13 + 0.002);
    F.r('#3c3b6e', 0, 0, 0.46, 7 / 13);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) F.star('#ffffff', 0.04 + x * 0.075 + (y % 2) * 0.03, 0.05 + y * 0.095, 0.035);
  },
  cn: (F) => {
    F.bg('#de2910');
    F.star('#ffde00', 0.26, F.em - 0.08, 0.18);
    for (const [x, y] of [[0.56, -0.2], [0.68, -0.1], [0.68, 0.03], [0.56, 0.12]]) F.star('#ffde00', x, F.em - 0.08 + y * 0.5, 0.06, 0.5);
  },
  ru: (F) => F.h3('#f4f4f4', '#0039a6', '#d52b1e'),
  kr: (F) => {
    F.bg('#ffffff');
    F.at(0.5, F.em, (g) => {
      g.rotate(-0.59);
      g.fillStyle = '#c60c30'; g.beginPath(); g.arc(0, 0, 0.26, Math.PI, 0); g.fill();
      g.fillStyle = '#003478'; g.beginPath(); g.arc(0, 0, 0.26, 0, Math.PI); g.fill();
      g.fillStyle = '#c60c30'; g.beginPath(); g.arc(-0.13, 0, 0.13, 0, 7); g.fill();
      g.fillStyle = '#003478'; g.beginPath(); g.arc(0.13, 0, 0.13, 0, 7); g.fill();
    });
    // The four groups of bars, as tilted strokes in the corners round the circle.
    [[-1, -1, 3], [1, 1, 3], [1, -1, 3], [-1, 1, 3]].forEach(([sx, sy, n]) => {
      F.at(0.5, F.em, (g) => {
        g.translate(sx * 0.36, sy * 0.34);
        g.rotate(sx * sy > 0 ? -0.72 : 0.72);
        g.fillStyle = '#111111';
        for (let i = 0; i < n; i++) g.fillRect(-0.09, -0.06 + i * 0.05, 0.18, 0.032);
      });
    });
  },
  jp: (F) => { F.bg('#ffffff'); F.disc('#bc002d', 0.5, F.em, 0.3); },
  gb: (F) => F.union(),
  fr: (F) => F.v3('#002395', '#ffffff', '#ed2939'),
  it: (F) => F.v3('#009246', '#ffffff', '#ce2b37'),
  es: (F) => { F.bg('#aa151b'); F.r('#f1bf00', 0, 0.25, 1, 0.75); F.r('#8a1a1a', 0.26, 0.42, 0.36, 0.58); F.r('#d8a020', 0.28, 0.44, 0.34, 0.5); },
  ca: (F) => {
    F.bg('#ffffff'); F.r('#d80621', 0, 0, 0.25, 1); F.r('#d80621', 0.75, 0, 1, 1);
    F.at(0.5, F.em, (g) => { g.scale(0.27, 0.27); g.fillStyle = '#d80621'; g.beginPath(); for (const [x, y] of MAPLE) g.lineTo(x, y); g.closePath(); g.fill(); });
  },
  br: (F) => {
    F.bg('#009c3b');
    F.poly('#ffdf00', [[0.5, 0.08], [0.94, 0.5], [0.5, 0.92], [0.06, 0.5]]);
    F.disc('#002776', 0.5, 0.5, 0.2);
    F.at(0.5, 0.5, (g) => { g.strokeStyle = '#ffffff'; g.lineWidth = 0.035; g.beginPath(); g.arc(-0.06, 0.2, 0.3, -2.1, -0.45); g.stroke(); });
  },
  mx: (F) => { F.v3('#006847', '#ffffff', '#ce1126'); F.disc('#8c6239', 0.5, F.em, 0.09); F.disc('#3f7d3f', 0.5, F.em + 0.015, 0.05); },
  in: (F) => {
    F.h3('#ff9933', '#ffffff', '#138808');
    F.at(0.5, 0.5, (g) => {
      g.strokeStyle = '#000080'; g.lineWidth = 0.022; g.beginPath(); g.arc(0, 0, 0.13, 0, 7); g.stroke();
      g.lineWidth = 0.01; for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 0.13, Math.sin(a) * 0.13); g.stroke(); }
    });
  },
  tr: (F) => { F.bg('#e30a17'); F.disc('#ffffff', 0.42, F.em, 0.25); F.disc('#e30a17', 0.48, F.em, 0.2); F.star('#ffffff', 0.72, F.em, 0.1, -0.3); },
  ua: (F) => F.h3('#0057b7', '#ffd700'),
  pl: (F) => F.h3('#f4f4f4', '#dc143c'),
  nl: (F) => F.h3('#ae1c28', '#f4f4f4', '#21468b'),
  se: (F) => F.nordic('#006aa7', '#fecc00'),
  no: (F) => F.nordic('#ba0c2f', '#ffffff', '#00205b'),
  dk: (F) => F.nordic('#c60c30', '#ffffff'),
  fi: (F) => F.nordic('#ffffff', '#003580'),
  ch: (F) => { F.bg('#d52b1e'); F.at(0.5, F.em, (g) => { g.fillStyle = '#ffffff'; g.fillRect(-0.09, -0.3, 0.18, 0.6); g.fillRect(-0.3, -0.09, 0.6, 0.18); }); },
  at: (F) => F.h3('#ed2939', '#ffffff', '#ed2939'),
  be: (F) => F.v3('#111111', '#fae042', '#ed2939'),
  ie: (F) => F.v3('#169b62', '#ffffff', '#ff883e'),
  pt: (F) => { F.bg('#d6001c'); F.r('#046a38', 0, 0, 0.4, 1); F.disc('#ffd200', 0.4, F.em, 0.17); F.disc('#d6001c', 0.4, F.em, 0.09); F.disc('#ffffff', 0.4, F.em, 0.05); },
  gr: (F) => {
    for (let i = 0; i < 9; i++) F.r(i % 2 ? '#ffffff' : '#0d5eaf', 0, i / 9, 1, (i + 1) / 9 + 0.002);
    F.r('#0d5eaf', 0, 0, 0.4, 5 / 9); F.r('#ffffff', 0.16, 0, 0.24, 5 / 9); F.r('#ffffff', 0, 2 / 9, 0.4, 3 / 9);
  },
  ar: (F) => { F.h3('#74acdf', '#ffffff', '#74acdf'); F.disc('#f6b40e', 0.5, 0.5, 0.11); F.star('#f6b40e', 0.5, 0.5, 0.2, 0, 16); },
  au: (F) => {
    F.bg('#012169'); F.union(0.5, 0.5);
    F.star('#ffffff', 0.25, 0.76, 0.14, 0, 7);
    for (const [x, y] of [[0.76, 0.14], [0.62, 0.42], [0.88, 0.38], [0.76, 0.82]]) F.star('#ffffff', x, y, 0.07, 0, 7);
  },
  vn: (F) => { F.bg('#da251d'); F.star('#ffff00', 0.5, F.em, 0.3); },
  id: (F) => F.h3('#ff0000', '#ffffff'),
  th: (F) => { F.bg('#a51931'); F.r('#f4f5f8', 0, 1 / 6, 1, 5 / 6); F.r('#2d2a4a', 0, 2 / 6, 1, 4 / 6); },
  eg: (F) => { F.h3('#ce1126', '#ffffff', '#111111'); F.disc('#c09300', 0.5, 0.5, 0.1); },
  za: (F) => {
    F.r('#e03c31', 0, 0, 1, 0.5); F.r('#001489', 0, 0.5, 1, 1);
    F.poly('#ffffff', [[0, 0], [0.16, 0], [0.56, 0.36], [1, 0.36], [1, 0.64], [0.56, 0.64], [0.16, 1], [0, 1]]);
    F.poly('#007749', [[0, 0.08], [0.5, 0.42], [1, 0.42], [1, 0.58], [0.5, 0.58], [0, 0.92]]);
    F.poly('#ffb81c', [[0, 0.2], [0.34, 0.5], [0, 0.8]]);
    F.poly('#111111', [[0, 0.28], [0.25, 0.5], [0, 0.72]]);
  },
  ng: (F) => F.v3('#008751', '#ffffff', '#008751'),
  cz: (F) => { F.h3('#f4f4f4', '#d7141a'); F.poly('#11457e', [[0, 0], [0.5, 0.5], [0, 1]]); },
  hu: (F) => F.h3('#cd2a3e', '#ffffff', '#436f4d'),
  ro: (F) => F.v3('#002b7f', '#fcd116', '#ce1126'),
  nz: (F) => {
    F.bg('#012169'); F.union(0.5, 0.5);
    for (const [x, y] of [[0.75, 0.16], [0.62, 0.42], [0.88, 0.38], [0.75, 0.76]]) { F.star('#ffffff', x, y, 0.08); F.star('#cc142b', x, y, 0.05); }
  },
  co: (F) => { F.r('#fcd116', 0, 0, 1, 0.5); F.r('#003893', 0, 0.5, 1, 0.75); F.r('#ce1126', 0, 0.75, 1, 1); },
};

// Draws a flag into the whole of a w x h canvas area already translated to its corner.
export function drawFlag(g, code, w, h, ratio, em) {
  const draw = FLAG_DRAW[code];
  if (draw) draw(flagTools(g, w, h, ratio, em));
}

// [code, name, main colour for the cord and name tag]
const FLAGS = [
  ['de', 'Germany', 0xdd0000], ['us', 'USA', 0x3c5bbe], ['cn', 'China', 0xde2910], ['ru', 'Russia', 0x0039a6], ['kr', 'South Korea', 0xc60c30], ['jp', 'Japan', 0xbc002d],
  ['gb', 'United Kingdom', 0x2a4aa8], ['fr', 'France', 0x2a4ac0], ['it', 'Italy', 0x009246], ['es', 'Spain', 0xf1bf00], ['ca', 'Canada', 0xd80621], ['br', 'Brazil', 0x009c3b],
  ['mx', 'Mexico', 0x006847], ['in', 'India', 0xff9933], ['tr', 'Turkey', 0xe30a17], ['ua', 'Ukraine', 0x0057b7], ['pl', 'Poland', 0xdc143c], ['nl', 'Netherlands', 0xff7a1a],
  ['se', 'Sweden', 0xfecc00], ['no', 'Norway', 0xba0c2f], ['dk', 'Denmark', 0xc60c30], ['fi', 'Finland', 0x2a60c0], ['ch', 'Switzerland', 0xd52b1e], ['at', 'Austria', 0xed2939],
  ['be', 'Belgium', 0xfae042], ['ie', 'Ireland', 0x169b62], ['pt', 'Portugal', 0x046a38], ['gr', 'Greece', 0x0d5eaf], ['ar', 'Argentina', 0x74acdf], ['au', 'Australia', 0x2a4aa8],
  ['nz', 'New Zealand', 0x2a4aa8], ['vn', 'Vietnam', 0xda251d], ['id', 'Indonesia', 0xff2020], ['th', 'Thailand', 0xa51931], ['eg', 'Egypt', 0xce1126], ['za', 'South Africa', 0x007749],
  ['ng', 'Nigeria', 0x008751], ['cz', 'Czechia', 0x2a60a0], ['hu', 'Hungary', 0xcd2a3e], ['ro', 'Romania', 0xfcd116], ['co', 'Colombia', 0xfcd116],
];

// ---------------------------------------------------------------- suits
const paintFn = {
  ref: (p) => { p.vStripes('#111111', '#f0f0f0', 8); p.head(SKIN); p.legs('#111111'); },
  prisoner: (p) => { p.hStripes('#f0f0f0', '#222222', 20); p.head(SKIN); },
  bee: (p) => { p.hStripes('#f6c81e', '#17120a', 16); p.head('#f6c81e'); },
  candy: (p) => { p.hStripes('#f4f4f4', '#e02030', 22); },
  melon: (p) => { p.all('#ff4a5a'); p.dots('#1a1208', 90, 3, 6, 11); p.head('#2aa84a'); p.legs('#2aa84a'); p.arms('#2aa84a'); },
  denim: (p) => { p.all('#2d4f86'); p.lines('#3f66a5', 400, 2, 9); p.head(SKIN); p.torso('#f2f2f2'); },
  checker: (p) => p.checks('#f0f0f0', '#141414', 14),
  polka: (p) => { p.all('#e23a6e'); p.dots('#ffffff', 130, 7, 12, 4); },
  jersey: (p) => { p.all('#1f6ae0'); p.head(SKIN); p.legs('#101a30'); p.hands(SKIN); p.both(() => { p.g.fillStyle = '#ffffff'; p.g.font = 'bold 120px sans-serif'; p.g.textAlign = 'center'; p.g.fillText('7', 96, 250); }); },
  pixel: (p) => { const R = rng(21), c = ['#22d0ff', '#ff3fa8', '#ffe040', '#50f070', '#8060ff']; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { p.g.fillStyle = c[(R() * 5) | 0]; p.g.fillRect(i * 32, j * 32, 33, 33); } },
  flame: (p) => { p.vgrad('#ffe040', '#d81a0a'); p.head('#111111'); p.dots('#ff8020', 60, 8, 20, 6); },
  sky: (p) => { p.vgrad('#2a7ae0', '#bfe8ff'); p.blobs(['#ffffff'], 24, 14, 34, 8); },
  sunset: (p) => p.vgrad('#3a1a7a', '#ff9040'),
  mint: (p) => { p.all('#c4f5e0'); p.dots('#3a2a20', 120, 3, 7, 13); },
  ninja: (p) => {
    p.all('#14161c');
    p.lines('#22252e', 300, 3, 4);
    p.rect('#b02020', -0.21, 0.36, 0.21, 0.3);
    p.head('#14161c');
    p.both((s) => { if (!s) p.rect(SKIN, -0.21, 1.1, 0.21, 0.98); });
    p.armBand('#b02020', 0.26, 0.2);
  },
  pirate: (p) => { p.hStripes('#f0f0f0', '#1a2a5a', 26); p.head(SKIN); p.legs('#3a2614'); p.feet('#14100c'); p.hands(SKIN); p.rect('#6a4a22', -0.21, 0.36, 0.21, 0.3); },
  skeleton: (p) => {
    p.all('#0e0e12');
    const g = p.g; g.strokeStyle = '#efece0'; g.lineCap = 'round';
    p.head('#efece0');
    p.both(() => {
      g.lineWidth = 12; g.beginPath(); g.moveTo(96, HEAD_Y); g.lineTo(96, WAIST_Y); g.stroke();
      g.lineWidth = 7; for (let i = 0; i < 4; i++) { const y = HEAD_Y + 22 + i * 26; g.beginPath(); g.moveTo(52, y); g.quadraticCurveTo(96, y + 14, 140, y); g.stroke(); }
      g.lineWidth = 11; for (const x of [58, 134]) { g.beginPath(); g.moveTo(x, WAIST_Y + 6); g.lineTo(x, TEX - 16); g.stroke(); }
    });
    g.lineWidth = 11; for (const x of [COL_ARMS + 30, COL_ARMS + 98]) { g.beginPath(); g.moveTo(x, Y(0.82)); g.lineTo(x, WRIST_Y + 20); g.stroke(); }
  },
  robot: (p) => {
    p.all('#8a96a8'); p.head('#a8b4c6');
    p.both(() => { p.g.fillStyle = '#2a3442'; p.g.fillRect(40, HEAD_Y + 30, 112, 70); p.g.fillStyle = '#40e8ff'; for (let i = 0; i < 3; i++) p.g.fillRect(52 + i * 32, HEAD_Y + 44, 22, 40); });
    for (const y of [0.05, -0.2]) p.rect('#4a5462', -0.21, y, 0.21, y - 0.04);
    p.armBand('#4a5462', 0.5, 0.45);
  },
  knight: (p) => { p.all('#b8c0cc'); p.lines('#e4e8f0', 120, 3, 12); p.head('#9aa4b2'); p.rect('#c02a2a', -0.05, 0.82, 0.05, 0.28); p.rect('#c02a2a', -0.21, 0.66, 0.21, 0.58); },
  astro: (p) => { p.all('#eef0f4'); p.head(SKIN); p.both((s) => { if (s) { p.g.fillStyle = '#9aa2b0'; p.g.fillRect(40, HEAD_Y + 8, 112, 110); } else { p.g.fillStyle = '#e02a2a'; p.g.fillRect(50, HEAD_Y + 26, 34, 18); p.g.fillStyle = '#2a60e0'; p.g.fillRect(100, HEAD_Y + 26, 34, 18); } }); p.armBand('#e0702a', 0.62, 0.56); p.rect('#e0702a', -0.21, 0.05, 0.21, -0.02); },
  zombie: (p) => { p.all('#3f6a3a'); p.lines('#2a4626', 120, 7, 2); p.head('#7fae6a'); p.hands('#7fae6a'); p.torso('#5a4a3a'); p.lines('#2a2018', 50, 5, 14); p.legs('#2c2c3a'); p.blobs(['#6a1a1a'], 8, 5, 12, 9); },
  mummy: (p) => { p.all('#d8cca8'); for (let i = 0; i < 40; i++) { p.g.fillStyle = i % 2 ? '#bcae88' : '#e8dec0'; p.g.save(); p.g.translate(0, i * 14); p.g.rotate(-0.06 + (i % 3) * 0.04); p.g.fillRect(-20, 0, 560, 9); p.g.restore(); } p.both((s) => { if (!s) { p.g.fillStyle = '#17120c'; p.g.fillRect(30, Y(1.1), 132, 24); } }); },
  clown: (p) => { p.checks('#ff3040', '#ffe040', 8); p.dots('#3060ff', 30, 8, 16, 2); p.head('#fafafa'); p.hands('#fafafa'); p.feet('#e02030'); },
  santa: (p) => { p.all('#c81e1e'); p.head(SKIN); p.rect('#f4f4f4', -0.21, 0.5, 0.21, 0.42); p.rect('#141414', -0.21, 0.34, 0.21, 0.28); p.feet('#141414'); p.hands('#f4f4f4'); },
  tux: (p) => {
    p.all('#14161c'); p.head(SKIN); p.hands(SKIN);
    p.front(() => { const g = p.g; g.fillStyle = '#f6f6f6'; g.beginPath(); g.moveTo(40, HEAD_Y); g.lineTo(152, HEAD_Y); g.lineTo(96, WAIST_Y - 30); g.closePath(); g.fill(); g.fillStyle = '#c01a2a'; g.fillRect(74, HEAD_Y + 6, 44, 18); });
  },
  cowboy: (p) => { p.all('#8a5a2a'); p.head(SKIN); p.hands(SKIN); p.legs('#2a4a78'); p.feet('#3a2412'); p.both((s) => { if (!s) { p.g.fillStyle = '#d8c090'; p.g.beginPath(); p.g.moveTo(50, HEAD_Y); p.g.lineTo(142, HEAD_Y); p.g.lineTo(96, HEAD_Y + 70); p.g.fill(); } }); p.rect('#f0d040', -0.05, 0.36, 0.05, 0.3); },
  fire: (p) => { p.all('#2a2a2e'); p.head(SKIN); for (const y of [0.74, 0.5, 0.05, -0.2]) p.rect('#f0d020', -0.21, y, 0.21, y - 0.05); p.armBand('#f0d020', 0.65, 0.6); p.armBand('#f0d020', 0.4, 0.35); p.hands('#111111'); },
  doctor: (p) => { p.all('#f4f6f8'); p.head(SKIN); p.hands(SKIN); p.legs('#2a7a9a'); p.both((s) => { if (!s) { p.g.fillStyle = '#e02a2a'; p.g.fillRect(60, HEAD_Y + 44, 36, 12); p.g.fillRect(72, HEAD_Y + 32, 12, 36); } }); },
  hero: (p) => { p.all('#1f50d8'); p.head('#1f50d8'); p.legs('#1f50d8'); p.rect('#e01a2a', -0.21, 0.3, 0.21, 0.1); p.feet('#e01a2a'); p.hands('#e01a2a'); p.both(() => { p.g.fillStyle = '#ffd820'; p.g.beginPath(); p.g.moveTo(96, HEAD_Y + 18); p.g.lineTo(150, HEAD_Y + 60); p.g.lineTo(96, HEAD_Y + 110); p.g.lineTo(42, HEAD_Y + 60); p.g.fill(); p.g.fillStyle = '#e01a2a'; p.g.font = 'bold 56px sans-serif'; p.g.textAlign = 'center'; p.g.fillText('S', 96, HEAD_Y + 82); }); },
  tiger: (p) => { p.all('#f08a1e'); const R = rng(17); p.g.fillStyle = '#17120a'; for (let i = 0; i < 90; i++) { const x = R() * TEX, y = R() * TEX; p.g.beginPath(); p.g.moveTo(x, y); p.g.quadraticCurveTo(x + 30, y + 8, x + 60, y - 4); p.g.quadraticCurveTo(x + 30, y + 22, x, y); p.g.fill(); } },
  zebra: (p) => { p.all('#f4f4f4'); const R = rng(23); p.g.fillStyle = '#121212'; for (let i = 0; i < 100; i++) { const x = R() * TEX, y = R() * TEX; p.g.beginPath(); p.g.moveTo(x, y); p.g.quadraticCurveTo(x + 40, y + 10, x + 80, y - 6); p.g.quadraticCurveTo(x + 40, y + 24, x, y); p.g.fill(); } },
  camo: (p) => { p.all('#5a6a3a'); p.blobs(['#3a4a26', '#7a7a4a', '#2a2a1c', '#6a7a46'], 150, 14, 34, 31); },
  snowcamo: (p) => { p.all('#e8ecf0'); p.blobs(['#b0b8c2', '#8a94a0', '#d0d6dc'], 130, 14, 32, 33); },
  galaxy: (p) => { p.all('#0c0830'); p.blobs(['#30107a', '#6a1a8a', '#1a2a8a', '#8a2a7a'], 60, 30, 70, 37); p.dots('#ffffff', 220, 0.8, 2.6, 41); },
  lava: (p) => { p.all('#1a0c08'); p.blobs(['#ff4a10', '#ffa020', '#c02008'], 70, 8, 26, 43); p.blobs(['#1a0c08'], 70, 8, 24, 47); },
  frost: (p) => { p.vgrad('#e8f8ff', '#5ab0e8'); p.lines('#ffffff', 160, 2.5, 51); },
  gold: (p) => { p.vgrad('#ffe88a', '#b8860b'); p.lines('#fff4c0', 60, 3, 53); },
  chrome: (p) => { p.vgrad('#f4f8ff', '#6a7482'); p.lines('#ffffff', 50, 3, 57); },
  wizard: (p) => { p.all('#2a1a7a'); p.dots('#ffe060', 50, 2, 5, 59); p.head(SKIN); p.hands(SKIN); },
  vampire: (p) => { p.all('#16101a'); p.head('#e8e4e8'); p.hands('#e8e4e8'); p.front(() => { p.g.fillStyle = '#f2f2f2'; p.g.beginPath(); p.g.moveTo(52, HEAD_Y); p.g.lineTo(140, HEAD_Y); p.g.lineTo(96, HEAD_Y + 80); p.g.fill(); }); },
  toxic: (p) => { p.all('#1a1f12'); p.blobs(['#9cff2a', '#5ae02a'], 60, 6, 22, 61); p.dots('#e8ff70', 50, 2, 5, 63); },
  rainbow: (p) => { const c = ['#ff3040', '#ff8a20', '#ffe030', '#40d850', '#30a0ff', '#8050f0']; c.forEach((k, i) => { p.g.fillStyle = k; p.g.fillRect(0, (i / 6) * TEX, TEX, TEX / 6 + 1); }); },
  grid: (p) => { p.all('#0a0a20'); p.g.strokeStyle = '#ff2ad8'; p.g.lineWidth = 3; for (let i = 0; i < 20; i++) { p.g.beginPath(); p.g.moveTo(i * 26, 0); p.g.lineTo(i * 26, TEX); p.g.moveTo(0, i * 26); p.g.lineTo(TEX, i * 26); p.g.stroke(); } },
  pumpkin: (p) => { p.all('#17120e'); p.head('#ee7a14'); p.torso('#3a2a18'); p.lines('#5a3a18', 60, 6, 67); },
  samurai: (p) => { p.all('#7a1420'); p.head(SKIN); p.hands(SKIN); p.legs('#17141c'); for (const y of [0.75, 0.65, 0.55, 0.45]) p.rect('#d8b040', -0.21, y, 0.21, y - 0.02); p.armBand('#17141c', 0.7, 0.4); },
  // Owner suits.
  fengish: (p) => {
    // A gamer girl's outfit: pink and white jacket over dark leggings.
    p.all('#3c3a58');
    p.head('#f6d6bc');
    p.torso('#ff6aa8');
    p.both((s) => {
      const g = p.g;
      g.fillStyle = '#ffffff';
      g.fillRect(0, HEAD_Y + 6, 34, 165); g.fillRect(158, HEAD_Y + 6, 34, 165);
      if (s) { g.fillStyle = '#ffffff'; g.font = 'bold 76px sans-serif'; g.textAlign = 'center'; g.fillText('GG', 96, HEAD_Y + 100); }
      else { g.fillStyle = '#17121e'; g.fillRect(90, HEAD_Y, 12, 165); }
    });
    p.arms('#ffffff');
    p.armBand('#ff6aa8', 0.84, 0.66);
    p.armBand('#ff6aa8', 0.38, 0.28);
    p.hands('#f6d6bc');
    p.feet('#ffffff');
  },
};

// [id, name, colour hex]; the first ten are the free colours you could always pick.
const PLAIN = [
  ['c0', 'Mint', 0x3ff0d0], ['c1', 'Pink', 0xff4fb4], ['c2', 'Lime', 0xb6ff4a], ['c3', 'Amber', 0xffb43d], ['c4', 'Blue', 0x4f8bff],
  ['c5', 'Violet', 0xa66bff], ['c6', 'Red', 0xff5050], ['c7', 'Yellow', 0xffe14a], ['c8', 'White', 0xf0f4ff], ['c9', 'Grey', 0x8a96aa],
];
const COLOURS = [
  ['Crimson', 0xb0122a], ['Coral', 0xff7a5c], ['Tangerine', 0xff8a1e], ['Sunflower', 0xf5c518], ['Olive', 0x7d8a2e], ['Forest', 0x1f7a3f],
  ['Emerald', 0x12c47a], ['Teal', 0x0f9d9d], ['Sky', 0x6cc8ff], ['Royal', 0x2b55e0], ['Navy', 0x16245c], ['Indigo', 0x4b2fb8],
  ['Grape', 0x7a2fa8], ['Magenta', 0xe01fa0], ['Rose', 0xff8fb8], ['Peach', 0xffc39a], ['Cream', 0xf6ecd0], ['Sand', 0xd8bc86],
  ['Chocolate', 0x6a3f22], ['Slate', 0x566176], ['Charcoal', 0x2a2e36], ['Jet Black', 0x0c0d10],
];

const s = (id, name, r, price, o) => Object.assign({ id, name, r, price, kind: 'suit', tab: 'suits' }, o);
const pt = (id, name, r, price, c, face, hat, more) => s(id, name, r, price, Object.assign({ c, p: paintFn[id], face, hat }, more));

export const SUITS = [
  ...PLAIN.map(([id, name, c]) => s(id, name, 0, 0, { c })),
  ...COLOURS.map(([name, c], i) => s('k' + i, name, 0, 60 + (i % 4) * 30, { c })),
  ...FLAGS.map(([code, name, c]) => s('f_' + code, name, 1, 300, { c, flag: code, tab: 'flags' })),
  pt('ref', 'Referee', 1, 280, 0xf0f0f0),
  pt('prisoner', 'Prisoner', 1, 280, 0xf0f0f0),
  pt('bee', 'Bumblebee', 1, 300, 0xf6c81e),
  pt('candy', 'Candy Cane', 1, 320, 0xe02030),
  pt('melon', 'Watermelon', 1, 320, 0xff4a5a),
  pt('denim', 'Denim Day', 1, 280, 0x3f66a5),
  pt('checker', 'Racing Flag', 1, 340, 0xf0f0f0),
  pt('polka', 'Polka Dots', 1, 300, 0xe23a6e),
  pt('jersey', 'Number 7', 1, 340, 0x1f6ae0),
  pt('pixel', 'Pixels', 1, 380, 0x22d0ff),
  pt('flame', 'Hot Rod', 1, 380, 0xff8020),
  pt('sky', 'Cloudy Day', 1, 360, 0x6ab8f0),
  pt('sunset', 'Sunset', 1, 360, 0xff9040),
  pt('mint', 'Choc Mint', 1, 320, 0xc4f5e0),
  pt('ninja', 'Ninja', 2, 1200, 0x14161c, 'ninja', 'band_red'),
  pt('pirate', 'Pirate', 2, 1200, 0x1a2a5a, 'patch', 'pirate'),
  pt('skeleton', 'Skeleton', 2, 1300, 0xefece0, 'skull'),
  pt('robot', 'Robot', 2, 1300, 0x8a96a8, 'visor', 'antenna'),
  pt('knight', 'Knight', 2, 1400, 0xb8c0cc, null, 'knight'),
  pt('astro', 'Astronaut', 2, 1500, 0xeef0f4, null, 'astro'),
  pt('zombie', 'Zombie', 2, 1200, 0x7fae6a, 'stitched'),
  pt('mummy', 'Mummy', 2, 1200, 0xd8cca8, 'hollow'),
  pt('clown', 'Clown', 2, 1100, 0xff3040, 'clown', 'afro'),
  pt('santa', 'Santa', 2, 1200, 0xc81e1e, 'happy', 'santa'),
  pt('tux', 'Tuxedo', 2, 1300, 0xf6f6f6, 'smirk', 'tophat'),
  pt('cowboy', 'Cowboy', 2, 1100, 0x8a5a2a, 'smirk', 'cowboy'),
  pt('fire', 'Firefighter', 2, 1100, 0xf0d020, null, 'firehelm'),
  pt('doctor', 'Doctor', 2, 1000, 0xf4f6f8, 'nerd'),
  pt('hero', 'Super Stick', 2, 1600, 0x1f50d8, 'cool', null, { cape: '#d81a2a' }),
  pt('tiger', 'Tiger', 2, 1000, 0xf08a1e, 'cat', 'catears'),
  pt('zebra', 'Zebra', 2, 1000, 0xf4f4f4),
  pt('camo', 'Camouflage', 2, 900, 0x5a6a3a),
  pt('snowcamo', 'Snow Camo', 2, 900, 0xb0b8c2),
  pt('galaxy', 'Galaxy', 2, 1800, 0x6a1a8a),
  pt('lava', 'Lava Rock', 2, 1600, 0xff4a10),
  pt('frost', 'Frostbite', 2, 1400, 0x5ab0e8),
  pt('gold', 'Solid Gold', 2, 2500, 0xffd24a, null, null, { metal: 0.9, rough: 0.28, glow: 0.3 }),
  pt('chrome', 'Chrome', 2, 2200, 0xc8d0dc, null, null, { metal: 0.95, rough: 0.2, glow: 0.2 }),
  pt('wizard', 'Wizard', 2, 1400, 0x4a3ac0, null, 'wizard', { cape: '#2a1a7a' }),
  pt('vampire', 'Vampire', 2, 1400, 0xc01a2a, 'vampire', null, { cape: '#7a0a14' }),
  pt('toxic', 'Toxic', 2, 1300, 0x9cff2a, 'alien'),
  pt('rainbow', 'Rainbow', 2, 1700, 0xff8a20),
  pt('grid', 'Neon Grid', 2, 1500, 0xff2ad8),
  pt('pumpkin', 'Pumpkin Head', 2, 1300, 0xee7a14, 'pumpkin'),
  pt('samurai', 'Samurai', 2, 1600, 0x7a1420, 'angry', 'samurai'),
];

// Legendary suits are alive: they run on a shader (mode, three colours) and leave a trail. Coins can't buy
// them. Twelve hide in the hidden places on Hardcore, three are earned by what you do on Hardcore.
// Modes: 0 flowing fire, 1 lightning, 2 rainbow, 3 galaxy, 4 gold sheen, 5 falling code.
const L = (id, name, mode, a, b, c, o) => s(id, name, 3, -1, Object.assign({ tab: 'legend', c, shader: { mode, a, b, c: o.glow ?? c }, trail: c }, o));
const LOW = 'somewhere between 150 and 300 m', HIGH = 'somewhere between 550 and 750 m';
const low = (map) => `Hardcore on ${map}, ${LOW}. Stop staring at the tower and turn round.`;
const high = (map) => `Hardcore on ${map}, ${HIGH}. Only the brave step off the edge.`;
export const LEGENDS = [
  L('l_storm0', 'Stormcaller', 1, 0x0a1428, 0x2040a0, 0x7fd8ff, { relic: 'storm:0', hint: low('Storm Tower'), face: 'hollow', hat: 'bolt' }),
  L('l_storm1', 'Thunder God', 1, 0x180a30, 0x6030c0, 0xffe870, { relic: 'storm:1', hint: high('Storm Tower'), face: 'cool', hat: 'l_crown' }),
  L('l_sunny0', 'Golden Hour', 4, 0xffb030, 0xff7030, 0xfff0a0, { relic: 'sunny:0', hint: low('Sunny Isles'), face: 'cool', hat: 'sunrays' }),
  L('l_sunny1', 'Deep Sea King', 0, 0x02203a, 0x0a90a8, 0x70ffe0, { relic: 'sunny:1', hint: high('Sunny Isles'), face: 'hollow', hat: 'l_crown' }),
  L('l_forest0', 'Forest Spirit', 0, 0x0a2810, 0x30a040, 0xc0ff70, { relic: 'forest:0', hint: low('Wild Forest'), face: 'hollow', hat: 'antlers' }),
  L('l_forest1', 'Monster King', 3, 0x0a1a10, 0x503090, 0x9cff5a, { relic: 'forest:1', hint: high('Wild Forest'), face: 'monster', hat: 'devil' }),
  L('l_volcano0', 'Magma Lord', 0, 0x1a0604, 0xd02a08, 0xffb030, { relic: 'volcano:0', hint: low('Magma Chimney') + ' Here, the middle is the way.', face: 'angry', hat: 'flames' }),
  L('l_volcano1', 'Ash Phoenix', 0, 0x401008, 0xff6a10, 0xfff060, { relic: 'volcano:1', hint: high('Magma Chimney') + ' Here, the middle is the way.', face: 'cool', hat: 'flames' }),
  L('l_city0', 'Neon Ronin', 3, 0x0a0a20, 0xc020c0, 0x30f0ff, { relic: 'city:0', hint: low('Neon Skyline'), face: 'visor', hat: 'samurai' }),
  L('l_city1', 'Chrome Phantom', 4, 0x8090a8, 0x303848, 0x60e0ff, { relic: 'city:1', hint: high('Neon Skyline'), face: 'visor', hat: 'antenna' }),
  L('l_waterfall0', 'River Spirit', 0, 0x08305a, 0x20a0e0, 0xd0ffff, { relic: 'waterfall:0', hint: low('Waterfall'), face: 'hollow', hat: 'halo' }),
  L('l_waterfall1', 'Rainbow Dragon', 2, 0xffffff, 0xffffff, 0xffffff, { relic: 'waterfall:1', hint: high('Waterfall'), face: 'cool', hat: 'devil', trail: 0xff70c0 }),
  L('l_summit', 'Summit King', 4, 0xffd24a, 0xb8860b, 0xfff4b0, { ach: 'summit', hint: 'Reach the top of any map on Hardcore.', face: 'cool', hat: 'l_crown' }),
  L('l_flawless', 'Flawless', 3, 0x101840, 0x20a0ff, 0xffffff, { ach: 'flawless', hint: 'Reach the top of any map on Hardcore without a single fall.', face: 'cool', hat: 'halo' }),
  L('l_hunter', 'Relic Hunter', 2, 0xffffff, 0xffffff, 0xffffff, { ach: 'hunter', hint: 'Find all twelve hidden relics.', face: 'hollow', hat: 'l_crown', trail: 0xffc040 }),
];

// The two personal suits. Whoever goes by that name wears them. (Anyone could type the name: there is no
// server to check it against.)
export const OWNERS = [
  s('o_theocp', 'The Hacker', 4, -1, { tab: 'legend', owner: 'theocp', role: 'OWNER', c: 0x40ff70, shader: { mode: 5, a: 0x020604, b: 0x12c040, c: 0x70ffa0 }, trail: 0x40ff70, face: 'hacker', gear: ['hood'], hint: 'Only for TheOCP.' }),
  s('o_shortgg', 'GG Girl', 4, -1, { tab: 'legend', owner: 'shortgg', role: 'ADMIN', c: 0xff6aa8, p: paintFn.fengish, face: 'cute', gear: ['hairgg', 'headset', 'hemgg'], trail: 0xff8ac0, glow: 0.22, hint: 'Only for ShortGG.' }),
];

export const ALL_SUITS = [...SUITS, ...LEGENDS, ...OWNERS];
export const SUIT = Object.fromEntries(ALL_SUITS.map((x) => [x.id, x]));
export const FREE_SUIT = 'c0';

// ---------------------------------------------------------------- faces
// Eyes and mouth each draw on a 128 x 64 canvas that wraps round the front of the head. ink is dark or light
// to suit the head underneath. Colours other than ink are free.
const EW = 128, EH = 64, LX = 34, RX = 94, EY = 34;
const dot = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
const line = (g, c, w, pts, round = true) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = round ? 'round' : 'butt'; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
const arc = (g, c, w, x, y, r, a0, a1) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
const twoEyes = (g, ink, r = 12) => { dot(g, LX, EY, r, ink); dot(g, RX, EY, r, ink); };
const smile = (g, ink, r = 24, w = 7) => arc(g, ink, w, 64, 8, r, 0.45, Math.PI - 0.45);
const frown = (g, ink, r = 22, w = 7) => arc(g, ink, w, 64, 56, r, Math.PI + 0.5, -0.5);
const shiny = (g, x, y, r) => dot(g, x - r * 0.3, y - r * 0.35, r * 0.34, '#ffffff');
const f = (id, name, r, price, eyes, mouth, o) => Object.assign({ id, name, r, price, kind: 'face', tab: 'faces', eyes, mouth }, o);

export const FACES = [
  f('smile', 'Classic', 0, 0, (g, i) => twoEyes(g, i), (g, i) => smile(g, i)),
  f('happy', 'Happy', 0, 50, (g, i) => { arc(g, i, 7, LX, 42, 13, Math.PI + 0.3, -0.3); arc(g, i, 7, RX, 42, 13, Math.PI + 0.3, -0.3); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.arc(64, 12, 26, 0.1, Math.PI - 0.1); g.closePath(); g.fill(); dot(g, 64, 32, 7, '#e0506a'); }),
  f('sad', 'Sad', 0, 50, (g, i) => { twoEyes(g, i, 10); line(g, i, 5, [[20, 16], [44, 8]]); line(g, i, 5, [[108, 16], [84, 8]]); }, (g, i) => frown(g, i)),
  f('wow', 'Surprised', 0, 60, (g, i) => { dot(g, LX, EY, 15, i); dot(g, RX, EY, 15, i); shiny(g, LX, EY, 15); shiny(g, RX, EY, 15); }, (g, i) => dot(g, 64, 30, 14, i)),
  f('sleepy', 'Sleepy', 0, 60, (g, i) => { line(g, i, 7, [[20, 38], [48, 38]]); line(g, i, 7, [[80, 38], [108, 38]]); }, (g, i) => dot(g, 64, 28, 6, i)),
  f('flat', 'Unimpressed', 0, 70, (g, i) => { twoEyes(g, i, 9); line(g, i, 6, [[20, 22], [48, 22]]); line(g, i, 6, [[80, 22], [108, 22]]); }, (g, i) => line(g, i, 7, [[46, 28], [82, 28]])),
  f('wink', 'Wink', 0, 80, (g, i) => { dot(g, LX, EY, 12, i); line(g, i, 7, [[80, 38], [94, 30], [108, 38]]); }, (g, i) => smile(g, i)),
  f('smirk', 'Smirk', 0, 80, (g, i) => twoEyes(g, i, 10), (g, i) => line(g, i, 7, [[44, 30], [68, 32], [86, 20]])),
  f('angry', 'Angry', 1, 250, (g, i) => { twoEyes(g, i, 10); line(g, i, 8, [[16, 12], [50, 28]]); line(g, i, 8, [[112, 12], [78, 28]]); }, (g, i) => frown(g, i, 20, 8)),
  f('cool', 'Shades', 1, 300, (g) => { g.fillStyle = '#0c0d12'; g.beginPath(); g.roundRect(10, 20, 48, 28, 8); g.roundRect(70, 20, 48, 28, 8); g.fill(); g.fillRect(10, 22, 108, 7); line(g, '#ffffff', 3, [[20, 40], [32, 28]]); line(g, '#ffffff', 3, [[80, 40], [92, 28]]); }, (g, i) => smile(g, i, 20, 6), { still: true }),
  f('cute', 'Cute', 1, 300, (g, i) => { dot(g, LX, 34, 16, i); dot(g, RX, 34, 16, i); shiny(g, LX, 34, 16); shiny(g, RX, 34, 16); dot(g, LX + 5, 40, 3, '#ffffff'); dot(g, RX + 5, 40, 3, '#ffffff'); }, (g, i) => { g.fillStyle = 'rgba(255,110,150,0.65)'; g.beginPath(); g.ellipse(18, 14, 15, 8, 0, 0, 7); g.ellipse(110, 14, 15, 8, 0, 0, 7); g.fill(); smile(g, i, 12, 5); }),
  f('cat', 'Kitty', 1, 300, (g, i) => { arc(g, i, 7, LX, 42, 13, Math.PI + 0.3, -0.3); arc(g, i, 7, RX, 42, 13, Math.PI + 0.3, -0.3); }, (g, i) => { arc(g, i, 5, 52, 18, 12, 0.2, Math.PI - 0.1); arc(g, i, 5, 76, 18, 12, 0.1, Math.PI - 0.2); line(g, i, 3, [[4, 18], [30, 24]]); line(g, i, 3, [[4, 32], [30, 30]]); line(g, i, 3, [[124, 18], [98, 24]]); line(g, i, 3, [[124, 32], [98, 30]]); }),
  f('derp', 'Derp', 1, 280, (g, i) => { dot(g, LX, 30, 15, '#ffffff'); dot(g, RX, 36, 11, '#ffffff'); dot(g, LX + 5, 24, 7, '#0a0d14'); dot(g, RX - 3, 40, 6, '#0a0d14'); }, (g, i) => { line(g, i, 7, [[40, 20], [84, 26]]); g.fillStyle = '#e0506a'; g.beginPath(); g.roundRect(66, 24, 18, 22, 8); g.fill(); }),
  f('tongue', 'Silly', 1, 260, (g, i) => { twoEyes(g, i, 11); }, (g, i) => { smile(g, i, 22, 6); g.fillStyle = '#e0506a'; g.beginPath(); g.roundRect(54, 26, 24, 26, 10); g.fill(); }),
  f('cry', 'Crying', 1, 260, (g, i) => { line(g, i, 7, [[20, 34], [48, 34]]); line(g, i, 7, [[80, 34], [108, 34]]); g.fillStyle = '#6ac8ff'; g.fillRect(26, 34, 14, 30); g.fillRect(88, 34, 14, 30); }, (g, i) => frown(g, i, 20, 7), { still: true }),
  f('dizzy', 'Dizzy', 1, 280, (g, i) => { for (const x of [LX, RX]) { line(g, i, 6, [[x - 12, 22], [x + 12, 46]]); line(g, i, 6, [[x + 12, 22], [x - 12, 46]]); } }, (g, i) => line(g, i, 6, [[40, 30], [52, 24], [64, 30], [76, 24], [88, 30]]), { still: true }),
  f('love', 'In Love', 1, 320, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#ff2a60'; g.beginPath(); g.moveTo(x, 50); g.bezierCurveTo(x - 30, 26, x - 12, 6, x, 22); g.bezierCurveTo(x + 12, 6, x + 30, 26, x, 50); g.fill(); } }, (g, i) => smile(g, i), { still: true }),
  f('nerd', 'Nerd', 1, 280, (g, i) => { twoEyes(g, i, 7); arc(g, i, 5, LX, EY, 19, 0, 7); arc(g, i, 5, RX, EY, 19, 0, 7); line(g, i, 5, [[53, 32], [75, 32]]); }, (g, i) => { smile(g, i, 16, 6); g.fillStyle = '#ffffff'; g.fillRect(58, 26, 12, 10); }, { still: true }),
  f('ninja', 'Ninja', 2, 900, (g, i) => { line(g, '#ffffff', 8, [[20, 34], [48, 42]]); line(g, '#ffffff', 8, [[108, 34], [80, 42]]); dot(g, 40, 42, 4, '#0a0d14'); dot(g, 88, 42, 4, '#0a0d14'); }, () => {}, { still: true }),
  f('patch', 'Eye Patch', 2, 800, (g, i) => { dot(g, RX, EY, 11, i); g.fillStyle = '#0c0d12'; g.beginPath(); g.roundRect(14, 18, 42, 34, 12); g.fill(); line(g, '#0c0d12', 4, [[0, 8], [128, 2]]); }, (g, i) => line(g, i, 7, [[44, 24], [84, 30]])),
  f('skull', 'Skull', 2, 1000, (g) => { dot(g, LX, EY, 17, '#0c0d12'); dot(g, RX, EY, 17, '#0c0d12'); }, (g) => { g.fillStyle = '#0c0d12'; g.beginPath(); g.moveTo(64, 2); g.lineTo(54, 18); g.lineTo(74, 18); g.fill(); for (let k = 0; k < 6; k++) g.fillRect(30 + k * 12, 30, 8, 22); }, { still: true }),
  f('visor', 'Robot Visor', 2, 1000, (g) => { g.fillStyle = '#10141c'; g.beginPath(); g.roundRect(6, 18, 116, 34, 12); g.fill(); g.fillStyle = '#40e8ff'; g.fillRect(14, 30, 100, 10); }, (g) => { g.fillStyle = '#10141c'; for (let k = 0; k < 5; k++) g.fillRect(34 + k * 13, 22, 8, 16); }, { still: true }),
  f('stitched', 'Stitched', 2, 900, (g) => { dot(g, LX, EY, 14, '#f0e04a'); dot(g, LX, EY, 5, '#0c0d12'); dot(g, RX, EY, 9, '#0c0d12'); line(g, '#0c0d12', 3, [[80, 14], [108, 22]]); }, (g) => { line(g, '#0c0d12', 5, [[30, 30], [98, 30]]); for (let k = 0; k < 6; k++) line(g, '#0c0d12', 4, [[36 + k * 11, 20], [36 + k * 11, 40]]); }, { still: true }),
  f('hollow', 'Glowing Eyes', 2, 1100, (g) => { dot(g, LX, EY, 12, '#ffffff'); dot(g, RX, EY, 12, '#ffffff'); }, () => {}, { glow: 2.2, still: true }),
  f('clown', 'Clown Grin', 2, 900, (g) => { dot(g, LX, EY, 12, '#0c0d12'); dot(g, RX, EY, 12, '#0c0d12'); line(g, '#3060ff', 4, [[LX, 6], [LX, 16]]); line(g, '#3060ff', 4, [[RX, 6], [RX, 16]]); }, (g) => { dot(g, 64, 8, 12, '#ff2030'); arc(g, '#ff2030', 12, 64, 4, 42, 0.3, Math.PI - 0.3); }, { still: true }),
  f('vampire', 'Vampire', 2, 900, (g, i) => { twoEyes(g, '#c0102a', 9); line(g, '#0c0d12', 6, [[16, 14], [50, 26]]); line(g, '#0c0d12', 6, [[112, 14], [78, 26]]); }, (g) => { line(g, '#0c0d12', 6, [[36, 20], [92, 20]]); g.fillStyle = '#ffffff'; for (const x of [44, 74]) { g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 10, 20); g.lineTo(x + 5, 40); g.fill(); } }, { still: true }),
  f('alien', 'Alien', 2, 1000, (g) => { for (const [x, sgn] of [[LX, 1], [RX, -1]]) { g.fillStyle = '#0a0d14'; g.beginPath(); g.ellipse(x, 34, 22, 14, sgn * 0.6, 0, 7); g.fill(); } }, (g, i) => line(g, i, 4, [[54, 30], [74, 30]]), { still: true }),
  f('monster', 'Monster', 2, 1100, (g) => { dot(g, LX, EY, 13, '#ffe040'); dot(g, RX, EY, 13, '#ffe040'); g.fillStyle = '#0c0d12'; g.fillRect(LX - 3, EY - 12, 6, 24); g.fillRect(RX - 3, EY - 12, 6, 24); }, (g, i) => { g.fillStyle = '#0c0d12'; g.beginPath(); g.moveTo(24, 16); g.quadraticCurveTo(64, 62, 104, 16); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(34 + k * 11, 19); g.lineTo(44 + k * 11, 19); g.lineTo(39 + k * 11, 30); g.fill(); } }, { still: true }),
  f('pumpkin', 'Jack o Lantern', 2, 900, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#ffd02a'; g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 16, 46); g.lineTo(x - 16, 46); g.fill(); } }, (g) => { g.fillStyle = '#ffd02a'; g.beginPath(); g.moveTo(18, 14); g.lineTo(34, 24); g.lineTo(46, 14); g.lineTo(64, 26); g.lineTo(82, 14); g.lineTo(94, 24); g.lineTo(110, 14); g.quadraticCurveTo(64, 72, 18, 14); g.fill(); }, { glow: 1.5, still: true }),
  // Owner faces.
  f('hacker', 'Hacker', 4, -1, (g) => { dot(g, LX, 36, 10, '#40ff70'); dot(g, RX, 36, 10, '#40ff70'); line(g, '#40ff70', 4, [[20, 22], [48, 28]]); line(g, '#40ff70', 4, [[108, 22], [80, 28]]); }, () => {}, { glow: 2.6, still: true, hidden: true }),
];
export const FACE = Object.fromEntries(FACES.map((x) => [x.id, x]));

export function drawFace(g, face, part, light) {
  g.clearRect(0, 0, EW, EH);
  (face[part] || (() => {}))(g, light ? '#f4f6ff' : '#0a0d14');
}
export const FACE_W = EW, FACE_H = EH;

// ---------------------------------------------------------------- hats (the shapes are in gear.js)
const h = (id, name, r, price) => ({ id, name, r, price, kind: 'hat', tab: 'hats' });
export const HATS = [
  h('none', 'No Hat', 0, 0),
  h('cap', 'Baseball Cap', 0, 80), h('beanie', 'Beanie', 0, 80), h('band_red', 'Red Headband', 0, 60), h('band_blue', 'Blue Headband', 0, 60), h('bucket', 'Bucket Hat', 0, 100),
  h('cowboy', 'Cowboy Hat', 1, 300), h('tophat', 'Top Hat', 1, 320), h('party', 'Party Hat', 1, 260), h('viking', 'Viking Helmet', 1, 400), h('chef', 'Chef Hat', 1, 280),
  h('santa', 'Santa Hat', 1, 280), h('pirate', 'Pirate Hat', 1, 340), h('propeller', 'Propeller Cap', 1, 340), h('bunny', 'Bunny Ears', 1, 300), h('catears', 'Cat Ears', 1, 300),
  h('phones', 'Headphones', 1, 320), h('mohawk', 'Mohawk', 1, 320), h('afro', 'Afro', 1, 340), h('grad', 'Graduation Cap', 1, 300), h('police', 'Police Cap', 1, 320),
  h('sombrero', 'Sombrero', 1, 360), h('firehelm', 'Fire Helmet', 1, 340), h('beret', 'Beret', 1, 260),
  h('crown', 'Royal Crown', 2, 1500), h('wizard', 'Wizard Hat', 2, 1200), h('knight', 'Knight Helmet', 2, 1300), h('halo', 'Halo', 2, 1400), h('devil', 'Devil Horns', 2, 1100),
  h('antenna', 'Antennae', 2, 900), h('samurai', 'Samurai Helmet', 2, 1500), h('astro', 'Space Helmet', 2, 1400), h('shroom', 'Mushroom Cap', 2, 1000), h('flowers', 'Flower Crown', 2, 1000),
  // Only as part of a legendary suit.
  Object.assign(h('l_crown', 'Blazing Crown', 3, -1), { hidden: true }), Object.assign(h('bolt', 'Storm Bolts', 3, -1), { hidden: true }), Object.assign(h('sunrays', 'Sun Rays', 3, -1), { hidden: true }),
  Object.assign(h('antlers', 'Antlers', 3, -1), { hidden: true }), Object.assign(h('flames', 'Living Flames', 3, -1), { hidden: true }),
];
export const HAT = Object.fromEntries(HATS.map((x) => [x.id, x]));

// ---------------------------------------------------------------- painting
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// Paints a suit into a canvas (size 512 for the game, smaller for shop thumbnails).
export function paintSuit(suit, size = TEX) {
  const c = canvas(size, size), g = c.getContext('2d'), k = size / TEX;
  g.scale(k, k);
  if (suit.flag) {
    // Flags use the whole figure: head, chest and legs together show the flag on each side, as do the arms.
    const hr = BODY_W / FIG_H;
    for (const cx of [COL_FRONT, COL_BACK]) { g.save(); g.translate(cx, 0); g.beginPath(); g.rect(0, 0, COL_W, TEX); g.clip(); drawFlag(g, suit.flag, COL_W, TEX, hr, 0.36); g.restore(); }
    g.save(); g.translate(COL_ARMS, 0); g.beginPath(); g.rect(0, 0, ARM_W, TEX); g.clip(); drawFlag(g, suit.flag, ARM_W, TEX, ARM_SPAN / FIG_H, 0.36); g.restore();
  } else if (suit.p) suit.p(P(g));
  else if (suit.shader) {
    // Only used for the shop picture: the shader's colours as a still image.
    const cc = (x) => '#' + x.toString(16).padStart(6, '0'), S = suit.shader, p = P(g);
    if (S.mode === 2) paintFn.rainbow(p);
    else if (S.mode === 5) { p.all(cc(S.a)); const R = rng(9); g.fillStyle = cc(S.c); for (let i = 0; i < 240; i++) g.fillRect(((R() * 48) | 0) * 10.7, R() * TEX, 7, 9 + R() * 16); }
    else { p.vgrad(cc(S.a), cc(S.b)); p.blobs([cc(S.c), cc(S.b)], 26, 6, 24, 77); }
  } else { g.fillStyle = '#' + suit.c.toString(16).padStart(6, '0'); g.fillRect(0, 0, TEX, TEX); }
  return c;
}

// A suit's colour for its cord and name tag: a black suit still needs a cord you can see.
export function tagColor(c) {
  const l = lumOf(c);
  if (l >= 0.34) return c;
  const k = (0.34 - l) / (1 - l), mix = (v) => Math.round(v + (255 - v) * k);
  return (mix((c >> 16) & 255) << 16) | (mix((c >> 8) & 255) << 8) | mix(c & 255);
}

// A landscape picture of a flag or plain colour, for a cape.
export function paintCape(spec) {
  const c = canvas(256, 256), g = c.getContext('2d');
  if (FLAG_DRAW[spec]) drawFlag(g, spec, 256, 256, 0.46 / 0.74, 0.5);
  else { g.fillStyle = spec; g.fillRect(0, 0, 256, 256); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  return c;
}

// Is the head of this suit dark? Then faces are drawn in a light ink.
const inkCache = new Map();
export function suitIsDark(suit) {
  if (inkCache.has(suit.id)) return inkCache.get(suit.id);
  let lum;
  if (suit.shader) lum = suit.shader.mode === 2 ? 0.7 : (lumOf(suit.shader.a) + lumOf(suit.shader.b)) / 2;
  else if (!suit.p && !suit.flag) lum = lumOf(suit.c);
  else {
    const c = paintSuit(suit, 64), d = c.getContext('2d').getImageData(6, 5, 12, 4).data;
    lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    lum /= d.length / 4;
  }
  const dark = lum < 0.42;
  inkCache.set(suit.id, dark);
  return dark;
}
const lumOf = (x) => (0.3 * ((x >> 16) & 255) + 0.59 * ((x >> 8) & 255) + 0.11 * (x & 255)) / 255;

// What someone is wearing, from their saved picks: { s, f, h } ids. Anything unknown falls back to the free
// look, and the two personal suits only work under the right name.
export const ownerKey = (name) => { const n = String(name || '').trim().toLowerCase(); return n === 'theocp' || n === 'shortgg' ? n : null; };
export function resolveLook(look, name) {
  const l = look || {};
  let suit = SUIT[l.s] || SUIT[FREE_SUIT];
  if (suit.owner && suit.owner !== ownerKey(name)) suit = SUIT[FREE_SUIT];
  // No hat or the classic face picked: the suit may bring its own.
  const fid = l.f && l.f !== 'smile' ? l.f : suit.face || 'smile', hid = l.h && l.h !== 'none' ? l.h : suit.hat || 'none';
  const face = FACE[fid] || FACE.smile, hat = HAT[hid] || HAT.none;
  return { suit, face, hat, key: suit.id + '|' + face.id + '|' + hat.id };
}
// A plain stickman in one colour (the extra climbers on the title screen).
const PLAINS = new Map();
export function plainLook(c) {
  if (!PLAINS.has(c)) PLAINS.set(c, { suit: { id: 'plain' + c, c }, face: FACE.smile, hat: HAT.none, key: 'plain' + c });
  return PLAINS.get(c);
}
export const cleanLook = (l) => (l && typeof l === 'object' ? { s: SUIT[l.s] ? l.s : FREE_SUIT, f: FACE[l.f] ? l.f : 'smile', h: HAT[l.h] ? l.h : 'none' } : null);
export const roleOf = (look, name) => { const k = ownerKey(name), s = look && SUIT[look.s]; return k && s && s.owner === k ? s.role : null; };
