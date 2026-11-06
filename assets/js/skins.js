// Everything a climber can wear: suits (colours, flags, costumes, legendaries), faces and hats, with the
// painters that draw them. No three.js in here; stickman.js turns these into materials and the shop into
// thumbnails.
import { rng } from './util.js';
import { WEAPON, FREE_WEAPON } from './weapons.js';

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
  { id: 4, name: 'Team', css: '#ff3b5c' },
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
// Snowflakes: three crossing strokes with little branches.
// The pumpkin suit's striped stockings, shared with the faint glow it has in the dark.
const pumpkinStripes = (p, c) => { for (let fy = 0.2; fy > -0.3; fy -= 0.1) p.rect(c, -0.21, fy, 0.21, fy - 0.045); };
function flakes(p, c, n, seed) {
  const R = rng(seed), g = p.g;
  g.strokeStyle = c; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = R() * TEX, y = R() * TEX, r = 7 + R() * 9, a0 = R();
    g.lineWidth = 1.6 + R();
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI) / 3, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
      g.beginPath(); g.moveTo(x - cx, y - cy); g.lineTo(x + cx, y + cy); g.stroke();
      for (const e of [-1, 1]) for (const b of [-0.6, 0.6]) {
        const bx = x + e * cx * 0.6, by = y + e * cy * 0.6, ba = a + (e < 0 ? Math.PI : 0) + b;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * r * 0.35, by + Math.sin(ba) * r * 0.35); g.stroke();
      }
    }
  }
}
// Four pointed twinkles.
function sparkles(p, c, n, seed) {
  const R = rng(seed), g = p.g;
  g.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const x = R() * TEX, y = R() * TEX, r = 6 + R() * 8, w = r * 0.22;
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + w, y - w); g.lineTo(x + r, y); g.lineTo(x + w, y + w); g.lineTo(x, y + r); g.lineTo(x - w, y + w); g.lineTo(x - r, y); g.lineTo(x - w, y - w); g.closePath(); g.fill();
  }
}

// Shared bits for the costumes added in 4.10.6.
// Circuit traces: lines that turn at right angles and end in a pad.
function traces(p, c, w, seed, n) {
  const R = rng(seed), g = p.g;
  g.strokeStyle = c; g.fillStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    let x = R() * TEX, y = R() * TEX;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { if (k % 2) y += (R() - 0.5) * 120; else x += (R() - 0.5) * 120; g.lineTo(x, y); }
    g.stroke(); g.beginPath(); g.arc(x, y, w * 1.7, 0, 7); g.fill();
  }
}
// Zigzag lightning bolts.
function bolts(p, c, n, seed) {
  const R = rng(seed), g = p.g;
  g.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const x = R() * TEX, y = R() * TEX, k = 0.7 + R() * 0.8;
    g.beginPath();
    [[0, 0], [14, 0], [8, 16], [18, 16], [-2, 46], [4, 22], [-6, 22]].forEach(([a, b], j) => (j ? g.lineTo(x + a * k, y + b * k) : g.moveTo(x + a * k, y + b * k)));
    g.closePath(); g.fill();
  }
}
// Crystal facets: the whole sheet in triangles of the given colours.
function facets(p, seed, cols, edge) {
  const R = rng(seed), g = p.g, s = 32;
  for (let j = 0; j < TEX / s; j++) for (let i = 0; i < TEX / s; i++) {
    const x = i * s, y = j * s;
    for (const t of [[[x, y], [x + s, y], [x, y + s]], [[x + s, y], [x + s, y + s], [x, y + s]]]) {
      g.fillStyle = cols[(R() * cols.length) | 0];
      g.beginPath(); t.forEach(([a, b], k) => (k ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill();
      if (edge) { g.strokeStyle = edge; g.lineWidth = 1.2; g.stroke(); }
    }
  }
}
// A five petalled blossom.
function blossom(g, x, y, r, c, mid) {
  g.fillStyle = c;
  for (let k = 0; k < 5; k++) { const a = k * 1.2566; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.36, a, 0, 7); g.fill(); }
  g.fillStyle = mid; g.beginPath(); g.arc(x, y, r * 0.22, 0, 7); g.fill();
}
// A cog wheel.
function cog(g, x, y, r, c) {
  g.fillStyle = c;
  for (let k = 0; k < 10; k++) { g.save(); g.translate(x, y); g.rotate(k * 0.628); g.fillRect(-r * 0.14, -r * 1.18, r * 0.28, r * 0.36); g.restore(); }
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x, y, r * 0.35, 0, 7); g.fill();
}
// The neon bits of Synthwave: a sunset of stripes on the chest and a grid down the legs.
function synthNeon(p) {
  const g = p.g;
  p.both(() => ['#ff40d0', '#ff5aa0', '#ff8070', '#ffa040', '#ffd040'].forEach((k, i) => p.rect(k, -0.21, 0.66 - i * 0.05, 0.21, 0.635 - i * 0.05)));
  g.strokeStyle = '#40e0ff'; g.lineWidth = 2;
  for (let x = 0; x < COL_ARMS; x += 24) { g.beginPath(); g.moveTo(x, WAIST_Y); g.lineTo(x, TEX); g.stroke(); }
  for (let y = WAIST_Y; y < TEX; y += 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(COL_ARMS, y); g.stroke(); }
  p.armBand('#ff40d0', 0.6, 0.57);
}
// The lit parts of the Battle Mech: visor slits on the chest and a power core.
function mechLights(p, c) { p.both(() => { p.rect(c, -0.15, 0.7, -0.08, 0.68); p.rect(c, 0.08, 0.7, 0.15, 0.68); p.rect('#40e0ff', -0.03, 0.6, 0.03, 0.5); }); }

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
    p.both(() => p.rect('#b02020', -0.21, 0.36, 0.21, 0.3));
    p.head('#14161c');
    p.both((s) => { if (!s) p.rect(SKIN, -0.21, 1.1, 0.21, 0.98); });
    p.armBand('#b02020', 0.26, 0.2);
  },
  pirate: (p) => { p.hStripes('#f0f0f0', '#1a2a5a', 26); p.head(SKIN); p.legs('#3a2614'); p.feet('#14100c'); p.hands(SKIN); p.both(() => p.rect('#6a4a22', -0.21, 0.36, 0.21, 0.3)); },
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
    p.both(() => { for (const y of [0.05, -0.2]) p.rect('#4a5462', -0.21, y, 0.21, y - 0.04); });
    p.armBand('#4a5462', 0.5, 0.45);
  },
  knight: (p) => { p.all('#b8c0cc'); p.lines('#e4e8f0', 120, 3, 12); p.head('#9aa4b2'); p.rect('#c02a2a', -0.05, 0.82, 0.05, 0.28); p.rect('#c02a2a', -0.21, 0.66, 0.21, 0.58); },
  astro: (p) => { p.all('#eef0f4'); p.head(SKIN); p.both((s) => { if (s) { p.g.fillStyle = '#9aa2b0'; p.g.fillRect(40, HEAD_Y + 8, 112, 110); } else { p.g.fillStyle = '#e02a2a'; p.g.fillRect(50, HEAD_Y + 26, 34, 18); p.g.fillStyle = '#2a60e0'; p.g.fillRect(100, HEAD_Y + 26, 34, 18); } }); p.armBand('#e0702a', 0.62, 0.56); p.rect('#e0702a', -0.21, 0.05, 0.21, -0.02); },
  zombie: (p) => { p.all('#3f6a3a'); p.lines('#2a4626', 120, 7, 2); p.head('#7fae6a'); p.hands('#7fae6a'); p.torso('#5a4a3a'); p.lines('#2a2018', 50, 5, 14); p.legs('#2c2c3a'); p.blobs(['#6a1a1a'], 8, 5, 12, 9); },
  mummy: (p) => { p.all('#d8cca8'); for (let i = 0; i < 40; i++) { p.g.fillStyle = i % 2 ? '#bcae88' : '#e8dec0'; p.g.save(); p.g.translate(0, i * 14); p.g.rotate(-0.06 + (i % 3) * 0.04); p.g.fillRect(-20, 0, 560, 9); p.g.restore(); } p.both((s) => { if (!s) { p.g.fillStyle = '#17120c'; p.g.fillRect(30, Y(1.1), 132, 24); } }); },
  clown: (p) => { p.checks('#ff3040', '#ffe040', 8); p.dots('#3060ff', 30, 8, 16, 2); p.head('#fafafa'); p.hands('#fafafa'); p.feet('#e02030'); },
  santa: (p) => { p.all('#c81e1e'); p.head(SKIN); p.both(() => { p.rect('#f4f4f4', -0.21, 0.5, 0.21, 0.42); p.rect('#141414', -0.21, 0.34, 0.21, 0.28); }); p.feet('#141414'); p.hands('#f4f4f4'); },
  tux: (p) => {
    p.all('#14161c'); p.head(SKIN); p.hands(SKIN);
    p.front(() => { const g = p.g; g.fillStyle = '#f6f6f6'; g.beginPath(); g.moveTo(40, HEAD_Y); g.lineTo(152, HEAD_Y); g.lineTo(96, WAIST_Y - 30); g.closePath(); g.fill(); g.fillStyle = '#c01a2a'; g.fillRect(74, HEAD_Y + 6, 44, 18); });
  },
  cowboy: (p) => { p.all('#8a5a2a'); p.head(SKIN); p.hands(SKIN); p.legs('#2a4a78'); p.feet('#3a2412'); p.both((s) => { if (!s) { p.g.fillStyle = '#d8c090'; p.g.beginPath(); p.g.moveTo(50, HEAD_Y); p.g.lineTo(142, HEAD_Y); p.g.lineTo(96, HEAD_Y + 70); p.g.fill(); } }); p.rect('#f0d040', -0.05, 0.36, 0.05, 0.3); },
  fire: (p) => { p.all('#2a2a2e'); p.head(SKIN); p.both(() => { for (const y of [0.74, 0.5, 0.05, -0.2]) p.rect('#f0d020', -0.21, y, 0.21, y - 0.05); }); p.armBand('#f0d020', 0.65, 0.6); p.armBand('#f0d020', 0.4, 0.35); p.hands('#111111'); },
  doctor: (p) => { p.all('#f4f6f8'); p.head(SKIN); p.hands(SKIN); p.legs('#2a7a9a'); p.both((s) => { if (!s) { p.g.fillStyle = '#e02a2a'; p.g.fillRect(60, HEAD_Y + 44, 36, 12); p.g.fillRect(72, HEAD_Y + 32, 12, 36); } }); },
  hero: (p) => { p.all('#1f50d8'); p.head('#1f50d8'); p.legs('#1f50d8'); p.both(() => p.rect('#e01a2a', -0.21, 0.3, 0.21, 0.1)); p.feet('#e01a2a'); p.hands('#e01a2a'); p.both(() => { p.g.fillStyle = '#ffd820'; p.g.beginPath(); p.g.moveTo(96, HEAD_Y + 18); p.g.lineTo(150, HEAD_Y + 60); p.g.lineTo(96, HEAD_Y + 110); p.g.lineTo(42, HEAD_Y + 60); p.g.fill(); p.g.fillStyle = '#e01a2a'; p.g.font = 'bold 56px sans-serif'; p.g.textAlign = 'center'; p.g.fillText('S', 96, HEAD_Y + 82); }); },
  tiger: (p) => { p.all('#f08a1e'); const R = rng(17); p.g.fillStyle = '#17120a'; for (let i = 0; i < 90; i++) { const x = R() * TEX, y = R() * TEX; p.g.beginPath(); p.g.moveTo(x, y); p.g.quadraticCurveTo(x + 30, y + 8, x + 60, y - 4); p.g.quadraticCurveTo(x + 30, y + 22, x, y); p.g.fill(); } },
  zebra: (p) => { p.all('#f4f4f4'); const R = rng(23); p.g.fillStyle = '#121212'; for (let i = 0; i < 100; i++) { const x = R() * TEX, y = R() * TEX; p.g.beginPath(); p.g.moveTo(x, y); p.g.quadraticCurveTo(x + 40, y + 10, x + 80, y - 6); p.g.quadraticCurveTo(x + 40, y + 24, x, y); p.g.fill(); } },
  camo: (p) => { p.all('#5a6a3a'); p.blobs(['#3a4a26', '#7a7a4a', '#2a2a1c', '#6a7a46'], 150, 14, 34, 31); },
  snowcamo: (p) => { p.all('#e8ecf0'); p.blobs(['#b0b8c2', '#8a94a0', '#d0d6dc'], 130, 14, 32, 33); },
  galaxy: (p) => { p.all('#0c0830'); p.blobs(['#30107a', '#6a1a8a', '#1a2a8a', '#8a2a7a'], 60, 30, 70, 37); p.dots('#ffffff', 220, 0.8, 2.6, 41); },
  lava: (p) => { p.all('#1a0c08'); p.blobs(['#ff4a10', '#ffa020', '#c02008'], 70, 8, 26, 43); p.blobs(['#1a0c08'], 70, 8, 24, 47); },
  frost: (p) => { p.vgrad('#e8f8ff', '#5ab0e8'); p.lines('#ffffff', 160, 2.5, 51); flakes(p, '#ffffff', 30, 71); },
  gold: (p) => { p.vgrad('#ffe88a', '#b8860b'); p.lines('#fff4c0', 60, 3, 53); },
  chrome: (p) => { p.vgrad('#f4f8ff', '#6a7482'); p.lines('#ffffff', 50, 3, 57); p.both(() => { for (const y of [0.62, 0.3, 0.02]) p.rect('#4a5462', -0.21, y, 0.21, y - 0.012); }); p.armBand('#4a5462', 0.5, 0.488); },
  wizard: (p) => { p.all('#2a1a7a'); p.dots('#ffe060', 50, 2, 5, 59); sparkles(p, '#ffe060', 16, 73); p.head(SKIN); p.hands(SKIN); p.both(() => p.rect('#d8b040', -0.21, 0.33, 0.21, 0.29)); },
  vampire: (p) => { p.all('#16101a'); p.head('#e8e4e8'); p.hands('#e8e4e8'); p.front(() => { p.g.fillStyle = '#f2f2f2'; p.g.beginPath(); p.g.moveTo(52, HEAD_Y); p.g.lineTo(140, HEAD_Y); p.g.lineTo(96, HEAD_Y + 80); p.g.fill(); }); },
  toxic: (p) => { p.all('#1a1f12'); p.blobs(['#9cff2a', '#5ae02a'], 60, 6, 22, 61); p.dots('#e8ff70', 50, 2, 5, 63); },
  rainbow: (p) => { const c = ['#ff3040', '#ff8a20', '#ffe030', '#40d850', '#30a0ff', '#8050f0']; c.forEach((k, i) => { p.g.fillStyle = k; p.g.fillRect(0, (i / 6) * TEX, TEX, TEX / 6 + 1); }); },
  grid: (p) => { p.all('#0a0a20'); p.g.strokeStyle = '#ff2ad8'; p.g.lineWidth = 3; for (let i = 0; i < 20; i++) { p.g.beginPath(); p.g.moveTo(i * 26, 0); p.g.lineTo(i * 26, TEX); p.g.moveTo(0, i * 26); p.g.lineTo(TEX, i * 26); p.g.stroke(); } },
  pumpkin: (p) => {
    // Trick or treat: a purple coat with a leafy green collar and an orange belt, over striped stockings.
    p.all('#36204c'); p.head('#ee7a14'); p.legs('#1a1410'); p.hands('#1a1410');
    p.both(() => {
      pumpkinStripes(p, '#e8701a');
      p.rect('#e8701a', -0.21, 0.34, 0.21, 0.3);
      p.rect('#3c8a2a', -0.21, 0.82, 0.21, 0.77);
      p.g.fillStyle = '#4aa632';
      for (let x = 8; x < COL_W; x += 22) { p.g.beginPath(); p.g.ellipse(x, Y(0.77) + 5, 9, 6, 0.5, 0, 7); p.g.fill(); }
    });
    p.armBand('#3c8a2a', 0.82, 0.76); p.armBand('#e8701a', 0.27, 0.22);
  },
  samurai: (p) => { p.all('#7a1420'); p.head(SKIN); p.hands(SKIN); p.legs('#17141c'); p.both(() => { for (const y of [0.75, 0.65, 0.55, 0.45]) p.rect('#d8b040', -0.21, y, 0.21, y - 0.02); }); p.armBand('#17141c', 0.7, 0.4); },
  // Added in 4.10.6.
  diver: (p) => {
    p.all('#16343c'); p.head(SKIN); p.hands('#0c1418'); p.feet('#f0c020');
    p.both((sd) => { p.rect('#f08a20', -0.21, 0.8, 0.21, 0.74); p.rect('#2a8a9a', -0.21, 0.62, -0.13, 0.3); p.rect('#2a8a9a', 0.13, 0.62, 0.21, 0.3); p.rect('#f08a20', -0.21, -0.04, 0.21, -0.09); if (!sd) p.rect('#c8d0dc', -0.01, 0.8, 0.01, 0.32); });
    p.armBand('#f08a20', 0.64, 0.58); p.armBand('#2a8a9a', 0.5, 0.3);
  },
  chef: (p) => {
    const g = p.g;
    p.all('#f6f6f6'); p.legs('#1a1a1a');
    p.both(() => { for (let j = 0; j < 12; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2) p.rect('#ececec', -0.21 + i * 0.0525, 0.28 - j * 0.06, -0.21 + (i + 1) * 0.0525, 0.28 - (j + 1) * 0.06); });
    p.head(SKIN); p.hands(SKIN); p.feet('#1a1a1a');
    p.front(() => { g.fillStyle = '#b8bcc4'; for (const x of [-0.07, 0.07]) for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(X(x), Y(0.72 - k * 0.1), 6, 0, 7); g.fill(); } p.rect('#e02a2a', -0.09, 0.82, 0.09, 0.76); });
    p.armBand('#e4e4ea', 0.3, 0.24);
  },
  pilot: (p) => {
    p.all('#6a4028'); p.lines('#5a3420', 160, 3, 81); p.head(SKIN); p.hands('#3a2414'); p.legs('#a89468'); p.feet('#2a1a10');
    p.both((sd) => { p.rect('#efe4cc', -0.21, 0.82, 0.21, 0.73); p.rect('#3a2414', -0.21, 0.36, 0.21, 0.3); if (!sd) { p.rect('#d8b040', -0.16, 0.66, -0.03, 0.645); p.rect('#3a2414', -0.008, 0.73, 0.008, 0.36); } });
    p.armBand('#efe4cc', 0.3, 0.22); p.armBand('#4a2a18', 0.8, 0.72);
  },
  viking: (p) => {
    const g = p.g;
    p.all('#5a4a3a'); p.torso('#8a929e');
    p.both(() => {
      g.strokeStyle = '#5a626e'; g.lineWidth = 2;
      for (let y = HEAD_Y; y < WAIST_Y; y += 8) for (let x = (y / 8) % 2 ? 0 : 4; x < COL_W; x += 8) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI); g.stroke(); }
      p.rect('#cfc0a0', -0.21, 0.82, 0.21, 0.71); p.rect('#4a2e18', -0.21, 0.35, 0.21, 0.29); p.rect('#c8a040', -0.04, 0.35, 0.04, 0.29);
      for (const y of [0.12, -0.04, -0.2]) p.rect('#3a2a1a', -0.21, y, 0.21, y - 0.03);
    });
    p.arms('#8a929e'); p.armBand('#cfc0a0', 0.84, 0.72); p.head(SKIN); p.hands('#4a2e18'); p.feet('#3a2a1a');
  },
  pharaoh: (p) => {
    p.all(SKIN);
    p.both(() => {
      for (let i = 0; i < 9; i++) p.rect(i % 2 ? '#2a4ad0' : '#ffd24a', -0.21, 0.82 - i * 0.06, 0.21, 0.82 - (i + 1) * 0.06);
      p.rect('#f4f0e4', -0.21, 0.29, 0.21, 0.02);
      for (let x = -0.18; x < 0.2; x += 0.06) p.rect('#dcd6c4', x, 0.27, x + 0.012, 0.02);
      p.rect('#ffd24a', -0.21, 0.35, 0.21, 0.29); p.rect('#2a4ad0', -0.03, 0.35, 0.03, 0.29);
    });
    p.armBand('#ffd24a', 0.64, 0.58); p.armBand('#2a4ad0', 0.58, 0.55); p.armBand('#ffd24a', 0.3, 0.25); p.feet('#c8a040');
  },
  panda: (p) => { p.all('#f4f4f4'); p.arms('#17171a'); p.legs('#17171a'); p.both(() => p.rect('#17171a', -0.21, 0.8, 0.21, 0.66)); p.dots('#e8e8e8', 60, 3, 7, 115); p.head('#f4f4f4'); },
  fox: (p) => {
    const g = p.g;
    p.all('#e8701a'); p.lines('#d8601a', 120, 2, 87); p.head('#e8701a');
    p.front(() => { g.fillStyle = '#f8f0e4'; g.beginPath(); g.moveTo(X(-0.14), Y(0.82)); g.lineTo(X(0.14), Y(0.82)); g.quadraticCurveTo(X(0.17), Y(0.5), X(0), Y(0.3)); g.quadraticCurveTo(X(-0.17), Y(0.5), X(-0.14), Y(0.82)); g.fill(); });
    p.both(() => p.rect('#2a1a12', -0.21, -0.08, 0.21, -0.44)); p.hands('#2a1a12'); p.armBand('#2a1a12', 0.34, 0.2);
  },
  dino: (p) => {
    const R = rng(89), g = p.g;
    p.all('#3a9a3a');
    for (let i = 0; i < 260; i++) { g.fillStyle = R() < 0.5 ? '#2e8030' : '#4ab048'; g.beginPath(); g.arc(R() * TEX, R() * TEX, 4 + R() * 6, 0, 7); g.fill(); }
    p.front(() => { for (let k = 0; k < 7; k++) p.rect(k % 2 ? '#f0d060' : '#e8c048', -0.11, 0.8 - k * 0.075, 0.11, 0.8 - (k + 1) * 0.075); });
    p.back(() => p.rect('#2a6a2a', -0.04, 0.82, 0.04, 0.28)); p.head('#3a9a3a'); p.hands('#2e8030'); p.feet('#2a6a2a');
  },
  shark: (p) => {
    const g = p.g;
    p.vgrad('#6a7a8c', '#8a9aac');
    p.front(() => { g.fillStyle = '#f4f6f8'; g.beginPath(); g.moveTo(X(-0.15), Y(0.8)); g.quadraticCurveTo(X(0), Y(0.9), X(0.15), Y(0.8)); g.lineTo(X(0.12), Y(0.3)); g.lineTo(X(-0.12), Y(0.3)); g.fill(); });
    p.both((sd) => { for (let k = 0; k < 3; k++) p.rect('#3a4652', sd ? -0.19 : 0.15, 0.72 - k * 0.06, sd ? -0.15 : 0.19, 0.7 - k * 0.06); });
    p.head('#6a7a8c'); p.legs('#2a3a5a'); p.both(() => p.rect('#f0f0f0', -0.21, 0.2, 0.21, 0.17)); p.feet('#1a2030'); p.hands('#6a7a8c');
  },
  synth: (p) => { p.all('#1a0a2a'); synthNeon(p); p.head(SKIN); p.hands(SKIN); },
  circuit: (p) => {
    const R = rng(93), g = p.g;
    p.all('#145a30'); traces(p, '#d8b040', 3, 91, 70);
    for (let i = 0; i < 14; i++) {
      const x = R() * TEX, y = R() * TEX, w = 20 + R() * 30, h = 14 + R() * 24;
      g.fillStyle = '#14161c'; g.fillRect(x, y, w, h); g.fillStyle = '#c8c8d0';
      for (let k = 3; k < w - 2; k += 6) { g.fillRect(x + k, y - 3, 2, 3); g.fillRect(x + k, y + h, 2, 3); }
    }
    p.head(SKIN); p.hands('#145a30');
  },
  disco: (p) => {
    const R = rng(97), g = p.g;
    p.vgrad('#c8a0ff', '#6a3ac8');
    for (let y = 0; y < TEX; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < TEX; x += 10) { const l = R(); g.fillStyle = l < 0.2 ? '#ffffff' : l < 0.5 ? '#e0d0ff' : l < 0.75 ? '#b080f0' : '#ff80e0'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    p.head(SKIN); p.hands(SKIN); p.both(() => p.rect('#ffd24a', -0.21, 0.34, 0.21, 0.3));
  },
  steampunk: (p) => {
    const g = p.g;
    p.all('#5a3a22'); p.lines('#4a2e1a', 140, 3, 101); p.legs('#3a3a40'); p.head(SKIN); p.hands('#3a2414'); p.feet('#2a1a10');
    p.both((sd) => {
      if (!sd) { p.rect('#7a1a24', -0.1, 0.8, 0.1, 0.36); g.fillStyle = '#d8b040'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(X(0), Y(0.76 - k * 0.09), 5, 0, 7); g.fill(); } }
      else { cog(g, X(0), Y(0.6), 34, '#b08a3a'); cog(g, X(0.12), Y(0.44), 18, '#c89a40'); }
      p.rect('#2a1a10', -0.21, 0.36, 0.21, 0.31); p.rect('#d8b040', -0.03, 0.36, 0.03, 0.31);
    });
    p.armBand('#d8b040', 0.3, 0.27);
  },
  jester: (p) => {
    const g = p.g, w = 16, h = 24;
    p.all('#8a1aa8');
    g.fillStyle = '#ffd030';
    for (let j = 0; j <= TEX / h; j++) for (let i = 0; i <= TEX / (2 * w); i++) { const x = i * 2 * w + (j % 2) * w, y = j * h; g.beginPath(); g.moveTo(x, y - h / 2); g.lineTo(x + w / 2, y); g.lineTo(x, y + h / 2); g.lineTo(x - w / 2, y); g.closePath(); g.fill(); }
    p.both(() => { p.rect('#ffd030', -0.21, 0.28, 0, -0.44); p.rect('#8a1aa8', 0, 0.28, 0.21, -0.44); p.rect('#f4f4f4', -0.21, 0.82, 0.21, 0.76); });
    p.head(SKIN); p.hands('#ffd030');
  },
  cactus: (p) => {
    const g = p.g;
    p.all('#4a9a4a');
    for (let x = 0; x < TEX; x += 16) { g.fillStyle = '#3a8a3a'; g.fillRect(x, 0, 4, TEX); g.fillStyle = '#6ab86a'; g.fillRect(x + 8, 0, 2, TEX); }
    g.fillStyle = '#f4ecd0';
    for (let x = 2; x < TEX; x += 16) for (let y = ((x / 16) % 2) * 12; y < TEX; y += 24) { g.fillRect(x - 3, y, 6, 1.5); g.fillRect(x, y - 3, 1.5, 6); }
    p.front(() => blossom(g, X(0.08), Y(0.66), 18, '#ff5aa0', '#ffe060'));
    p.head(SKIN); p.feet('#c87a4a');
  },
  thunder: (p) => { p.vgrad('#2a3040', '#4a5262'); p.blobs(['#3a4252', '#5a6272', '#262c38'], 70, 14, 40, 103); bolts(p, '#ffe040', 18, 105); p.head(SKIN); p.hands('#262c38'); },
  koi: (p) => {
    const R = rng(107), g = p.g;
    p.vgrad('#3a9ad8', '#14406a');
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
    for (let i = 0; i < 30; i++) { g.beginPath(); g.ellipse(R() * TEX, R() * TEX, 10 + R() * 20, 4 + R() * 8, 0, 0, 7); g.stroke(); }
    for (let i = 0; i < 16; i++) {
      g.save(); g.translate(R() * TEX, R() * TEX); g.rotate(R() * 6.28);
      g.fillStyle = R() < 0.6 ? '#ff7a2a' : '#f4f4f4'; g.beginPath(); g.ellipse(0, 0, 18, 8, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(-30, -9); g.lineTo(-30, 9); g.fill();
      g.fillStyle = R() < 0.5 ? '#e02020' : '#ffffff'; g.beginPath(); g.ellipse(4, -2, 6, 4, 0, 0, 7); g.fill();
      g.restore();
    }
    g.fillStyle = '#3a9a3a';
    for (let i = 0; i < 10; i++) { const x = R() * TEX, y = R() * TEX; g.beginPath(); g.arc(x, y, 12, 0.4, 6.0); g.lineTo(x, y); g.fill(); }
    p.head(SKIN); p.hands(SKIN);
  },
  amethyst: (p) => { facets(p, 109, ['#8a4ad8', '#a060f0', '#6a2ab8', '#c090ff', '#7a3ac8'], 'rgba(255,255,255,0.25)'); p.head('#c8a8f0'); },
  mech: (p) => {
    const g = p.g;
    p.all('#4a5a6a');
    g.strokeStyle = '#2a323c'; g.lineWidth = 3;
    for (let y = 0; y < TEX; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(TEX, y); g.stroke(); }
    for (let x = 0; x < TEX; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TEX); g.stroke(); }
    g.fillStyle = '#9aa4b2';
    for (let y = 6; y < TEX; y += 48) for (let x = 6; x < TEX; x += 64) { g.fillRect(x, y, 4, 4); g.fillRect(x + 52, y, 4, 4); }
    p.head('#5a6a7a');
    p.both(() => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#1a1e24' : '#f0b020'; g.beginPath(); g.moveTo(k * 24, Y(0.34)); g.lineTo(k * 24 + 12, Y(0.34)); g.lineTo(k * 24 + 24, Y(0.28)); g.lineTo(k * 24 + 12, Y(0.28)); g.fill(); } });
    mechLights(p, '#ff6a1a');
    p.armBand('#f0b020', 0.66, 0.62); p.hands('#2a323c'); p.feet('#2a323c');
  },
  sakura: (p) => {
    const R = rng(113), g = p.g;
    p.vgrad('#ffd0e0', '#ff9ac0');
    for (let i = 0; i < 46; i++) blossom(g, R() * TEX, R() * TEX, 8 + R() * 8, R() < 0.5 ? '#ffffff' : '#ff6aa0', '#ffd040');
    p.head(SKIN); p.hands(SKIN);
    p.both((sd) => {
      p.rect('#c01a4a', -0.21, 0.42, 0.21, 0.3); p.rect('#ffd24a', -0.21, 0.375, 0.21, 0.355);
      if (!sd) { g.fillStyle = '#f8f4f0'; g.beginPath(); g.moveTo(X(-0.12), Y(0.82)); g.lineTo(X(0.03), Y(0.42)); g.lineTo(X(0.07), Y(0.42)); g.lineTo(X(-0.06), Y(0.82)); g.fill(); }
    });
    p.feet('#f8f4f0');
  },
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
  pt('diver', 'Deep Diver', 2, 1300, 0x2a8a9a, 'wow'),
  pt('chef', 'Master Chef', 2, 1000, 0xf6f6f6, 'happy', 'chef'),
  pt('pilot', 'Sky Pilot', 2, 1200, 0x6a4028, 'smirk'),
  pt('viking', 'Viking', 2, 1500, 0x8a929e, 'angry', 'viking'),
  pt('pharaoh', 'Pharaoh', 2, 1800, 0xffd24a, 'cool', null, { glow: 0.15 }),
  pt('panda', 'Panda', 2, 1100, 0xf4f4f4, 'cute'),
  pt('fox', 'Fox', 2, 1100, 0xe8701a, 'cat', 'catears'),
  pt('dino', 'Dino', 2, 1300, 0x3a9a3a, 'monster'),
  pt('shark', 'Shark', 2, 1300, 0x7a8a9c, 'smirk'),
  pt('synth', 'Synthwave', 2, 1700, 0xff40d0, 'cool', 'phones'),
  pt('circuit', 'Circuit Board', 2, 1600, 0x1a8a4a, 'visor', 'antenna'),
  pt('disco', 'Disco Fever', 2, 1500, 0xb080f0, 'cool', 'afro'),
  pt('steampunk', 'Steampunk', 2, 1600, 0x8a5a2a, 'nerd', 'tophat'),
  pt('jester', 'Jester', 2, 1200, 0x8a1aa8, 'tongue', 'party'),
  pt('cactus', 'Cactus', 2, 900, 0x4a9a4a, 'happy', 'flowers'),
  pt('thunder', 'Thundercloud', 2, 1700, 0x4a5262, 'angry'),
  pt('koi', 'Koi Pond', 2, 1400, 0x3a8ad0, 'wow'),
  pt('amethyst', 'Amethyst', 2, 2000, 0x9a5aff, 'hollow', null, { glow: 0.2 }),
  pt('mech', 'Battle Mech', 2, 2200, 0x4a5a6a, 'visor'),
  pt('sakura', 'Sakura', 2, 1400, 0xff9ac0, 'cute', 'flowers'),
];

// Epic costumes each carry something of their own (gear.js), and in some the parts that should shine are painted again (lit)
// and glow for real: neon lines, slime, lava, stars, reflective stripes.
const EPIC_GEAR = {
  ninja: ['ninjato'], pirate: ['parrot'], skeleton: ['bones_x'], robot: ['jetpack'], knight: ['shield_back'], astro: ['lifepack'], zombie: ['arrows'],
  mummy: ['scarab', 'wraps'], clown: ['balloons'], santa: ['sack'], tux: ['coattails', 'rose'], cowboy: ['lasso'], fire: ['airtank'], doctor: ['stetho'],
  hero: ['belt_hero'], tiger: ['tail_tiger'], zebra: ['tail_zebra'], camo: ['rucksack'], snowcamo: ['skis_back'], galaxy: ['planets'], lava: ['magma'],
  frost: ['ice_spikes'], gold: ['bling'], chrome: ['fins'], wizard: ['spellbook'], vampire: ['collar'], toxic: ['canister'], rainbow: ['rainbow_arc'],
  grid: ['disc_back'], pumpkin: ['candy_bucket'], samurai: ['sashimono'],
  diver: ['divetank'], chef: ['ladle'], pilot: ['scarf'], viking: ['roundshield'], pharaoh: ['pharaoh_collar'], panda: ['bamboo_back'], fox: ['tail_fox'],
  dino: ['dino_plates', 'tail_dino'], shark: ['fin_shark'], synth: ['keytar'], circuit: ['chip_back'], disco: ['discoball'], steampunk: ['cogs'], jester: ['bells'],
  cactus: ['spines'], thunder: ['cloud_back'], koi: ['koi_back'], amethyst: ['crystals_back'], mech: ['mech_pods'], sakura: ['parasol'],
};
const faint = (k, fn) => (p) => { p.g.globalAlpha = k; fn(p); p.g.globalAlpha = 1; };
const LIT = {
  grid: (p) => paintFn.grid(p),
  toxic: (p) => { p.blobs(['#9cff2a', '#5ae02a'], 60, 6, 22, 61); p.dots('#e8ff70', 50, 2, 5, 63); },
  lava: (p) => { p.blobs(['#ff4a10', '#ffa020', '#c02008'], 70, 8, 26, 43); p.blobs(['#000000'], 70, 8, 24, 47); },
  galaxy: (p) => { p.dots('#ffffff', 220, 0.8, 2.6, 41); },
  frost: (p) => flakes(p, '#e8fcff', 30, 71),
  wizard: (p) => { p.dots('#ffe060', 50, 2, 5, 59); sparkles(p, '#ffe060', 16, 73); },
  fire: (p) => { p.both(() => { for (const y of [0.74, 0.5, 0.05, -0.2]) p.rect('#f0f060', -0.21, y, 0.21, y - 0.05); }); p.armBand('#f0f060', 0.65, 0.6); p.armBand('#f0f060', 0.4, 0.35); },
  robot: (p) => p.both(() => { p.g.fillStyle = '#40e8ff'; for (let i = 0; i < 3; i++) p.g.fillRect(52 + i * 32, HEAD_Y + 44, 22, 40); }),
  skeleton: faint(0.5, (p) => paintFn.skeleton(p)),
  pumpkin: faint(0.45, (p) => { p.head('#ff9a30'); p.both(() => pumpkinStripes(p, '#ff8a2a')); }),
  synth: (p) => synthNeon(p),
  circuit: (p) => traces(p, '#40ff90', 2, 95, 30),
  disco: (p) => sparkles(p, '#ffffff', 40, 99),
  thunder: (p) => bolts(p, '#fff080', 18, 105),
  amethyst: (p) => { const R = rng(111), g = p.g; g.fillStyle = '#d0a0ff'; for (let i = 0; i < 26; i++) { const x = R() * TEX, y = R() * TEX, r = 8 + R() * 14; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.6, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.6, y); g.closePath(); g.fill(); } },
  mech: (p) => mechLights(p, '#ff8a2a'),
};
for (const x of SUITS) {
  if (EPIC_GEAR[x.id]) x.gear = EPIC_GEAR[x.id];
  if (LIT[x.id]) x.lit = LIT[x.id];
}

// Legendary suits are alive: they run on a shader (mode, three colours) and leave a trail. Twelve hide in the hidden places on
// Hardcore, three are earned by what you do on Hardcore, and the rest cost a fortune. Many have wings, things on their back, or
// a cape made of the suit itself (cape: 'shader').
// Modes: 0 flowing fire, 1 lightning, 2 rainbow, 3 galaxy, 4 gold sheen, 5 falling code, 6 aurora, 7 molten rock, 8 crystal,
// 9 deep space, 10 circuits, 11 shimmering scales, 12 spirit smoke, 13 neon grid, 14 hologram.
const L = (id, name, mode, a, b, c, o) => s(id, name, 3, -1, Object.assign({ tab: 'legend', c, shader: { mode, a, b, c: o.glow ?? c }, trail: c }, o));
const LOW = 'somewhere between 150 and 300 m', HIGH = 'somewhere between 550 and 750 m';
const low = (map) => `On ${map}, ${LOW}. Stop staring at the tower and turn round.`;
const high = (map) => `On ${map}, ${HIGH}. Only the brave step off the edge.`;
// The ones for sale wait in the maze gardens (level.js, MAZE_RELICS): the relic opens the shop, coins still buy them.
const maze = (map, h) => `On ${map}, in the maze garden at about ${h} m. The maze changes every time you go back to a checkpoint.`;
export const LEGENDS = [
  L('l_storm0', 'Stormcaller', 1, 0x0a1428, 0x2040a0, 0x7fd8ff, { relic: 'storm:0', price: 12000, hint: low('Storm Tower'), face: 'hollow', hat: 'bolt' }),
  L('l_storm1', 'Thunder God', 1, 0x180a30, 0x6030c0, 0xffe870, { relic: 'storm:1', price: 20000, hint: high('Storm Tower'), face: 'cool', hat: 'l_crown', cape: 'shader' }),
  L('l_sunny0', 'Golden Hour', 4, 0xffb030, 0xff7030, 0xfff0a0, { relic: 'sunny:0', price: 12000, hint: low('Sunny Isles'), face: 'cool', hat: 'sunrays' }),
  L('l_sunny1', 'Deep Sea King', 0, 0x02203a, 0x0a90a8, 0x70ffe0, { relic: 'sunny:1', price: 20000, hint: high('Sunny Isles'), face: 'hollow', hat: 'l_crown' }),
  L('l_forest0', 'Forest Spirit', 0, 0x0a2810, 0x30a040, 0xc0ff70, { relic: 'forest:0', price: 12000, hint: low('Wild Forest'), face: 'hollow', hat: 'antlers' }),
  L('l_forest1', 'Monster King', 3, 0x0a1a10, 0x503090, 0x9cff5a, { relic: 'forest:1', price: 20000, hint: high('Wild Forest'), face: 'monster', hat: 'devil', cape: 'shader' }),
  L('l_volcano0', 'Magma Lord', 0, 0x1a0604, 0xd02a08, 0xffb030, { relic: 'volcano:0', price: 12000, hint: low('Magma Chimney') + ' Here, the middle is the way.', face: 'angry', hat: 'flames' }),
  L('l_volcano1', 'Ash Phoenix', 0, 0x401008, 0xff6a10, 0xfff060, { relic: 'volcano:1', price: 20000, hint: high('Magma Chimney') + ' Here, the middle is the way.', face: 'cool', hat: 'flames', gear: ['wings_fire'] }),
  L('l_city0', 'Neon Ronin', 10, 0x07040f, 0x6a1a9a, 0xff40e0, { relic: 'city:0', price: 12000, hint: low('Neon Skyline'), face: 'visor', hat: 'samurai', gear: ['katana_back'] }),
  L('l_city1', 'Chrome Phantom', 4, 0x8090a8, 0x303848, 0x60e0ff, { relic: 'city:1', price: 20000, hint: high('Neon Skyline'), face: 'visor', hat: 'antenna' }),
  L('l_waterfall0', 'River Spirit', 0, 0x08305a, 0x20a0e0, 0xd0ffff, { relic: 'waterfall:0', price: 12000, hint: low('Waterfall'), face: 'hollow', hat: 'halo' }),
  L('l_waterfall1', 'Rainbow Dragon', 11, 0x14082a, 0x1a6ac0, 0xffffff, { relic: 'waterfall:1', price: 20000, hint: high('Waterfall'), face: 'cool', gear: ['wings_dragon_sky', 'horns_sky'], trail: 0xff70c0 }),
  L('l_summit', 'Summit King', 4, 0xffd24a, 0xb8860b, 0xfff4b0, { ach: 'summit', hint: 'Reach the top of any map on Hardcore.', face: 'cool', hat: 'l_crown', cape: 'shader' }),
  L('l_flawless', 'Flawless', 3, 0x101840, 0x20a0ff, 0xffffff, { ach: 'flawless', hint: 'Reach the top of any map on Hardcore without a single fall.', face: 'cool', hat: 'halo', gear: ['wings_energy'] }),
  L('l_hunter', 'Relic Hunter', 14, 0x3a2a10, 0x806020, 0xffc040, { ach: 'hunter', hint: 'Find all twelve relics on the hidden paths.', face: 'hollow', hat: 'l_crown', gear: ['orbs_gold'], trail: 0xffc040 }),
  // For sale, for a fortune, once their relic is found in a maze garden.
  L('l_seraph', 'Celestial Seraph', 4, 0xfff4dc, 0xc8a050, 0xffffff, { relic: 'sunny:m0', hint: maze('Sunny Isles', 380), price: 30000, face: 'cool', hat: 'halo', gear: ['wings_angel'], trail: 0xfff0b0 }),
  L('l_synth', 'Neon Drive', 13, 0x0a0018, 0x48005a, 0xff40d0, { relic: 'storm:m0', hint: maze('Storm Tower', 380), price: 25000, face: 'visor', hat: 'phones', gear: ['ring_synth'] }),
  L('l_cyber', 'Cyber Shogun', 10, 0x03070d, 0x1a6080, 0x30f0ff, { relic: 'city:m0', hint: maze('Neon Skyline', 380), price: 30000, face: 'visor', hat: 'samurai', gear: ['katana_back'] }),
  L('l_aurora', 'Aurora Empress', 6, 0x040a1e, 0x20e8a0, 0xb070ff, { relic: 'waterfall:m1', hint: maze('Waterfall', 715), price: 35000, face: 'cute', gear: ['wings_energy', 'crown_ice'], trail: 0x40ffc0 }),
  L('l_frost', 'Frost Wraith', 8, 0x0a2040, 0x58c0ff, 0xe8ffff, { relic: 'waterfall:m0', hint: maze('Waterfall', 375), price: 35000, face: 'hollow', gear: ['wings_ice', 'crown_ice'], trail: 0x9ff0ff }),
  L('l_reaper', 'Soul Reaper', 12, 0x05080a, 0x1c3038, 0x70ffc0, { relic: 'forest:m0', hint: maze('Wild Forest', 590), price: 40000, face: 'hollow', gear: ['hood', 'scythe_back'], cape: 'shader' }),
  L('l_infernal', 'Infernal Overlord', 7, 0x1a0606, 0xff4a10, 0xffd050, { relic: 'volcano:m0', hint: maze('Magma Chimney', 380), price: 45000, face: 'angry', gear: ['wings_dragon', 'horns_dragon'], cape: 'shader', trail: 0xff6a10 }),
  L('l_diamond', 'Diamond Sovereign', 8, 0x70b0f0, 0xe8f6ff, 0xffffff, { relic: 'sunny:m1', hint: maze('Sunny Isles', 710), price: 45000, face: 'cool', hat: 'crown', gear: ['ring_diamond'], trail: 0xc0f0ff }),
  L('l_voidking', 'Void Emperor', 9, 0x040108, 0x5a1ab0, 0xe8b0ff, { relic: 'storm:m1', hint: maze('Storm Tower', 710), price: 50000, face: 'hollow', gear: ['crown_void', 'orbs_void', 'wings_void'], cape: 'shader', trail: 0xa040ff }),
  L('l_prism', 'Prismatic', 14, 0x14141c, 0x8080a0, 0xffffff, { relic: 'city:m1', hint: maze('Neon Skyline', 645), price: 55000, face: 'cool', gear: ['ring_prism', 'wings_energy'], trail: 0xff70e0 }),
  L('l_dragonlord', 'Dragon Emperor', 11, 0x2a0604, 0xa0200c, 0xffc040, { relic: 'volcano:m1', hint: maze('Magma Chimney', 705), price: 60000, face: 'angry', hat: 'l_crown', gear: ['wings_dragon', 'horns_dragon'], cape: 'shader', trail: 0xff8a20 }),
  // For sale for a fortune, no relic needed.
  L('l_phoenixk', 'Phoenix King', 0, 0x2a0602, 0xff5a10, 0xffe060, { price: 32000, face: 'l_inferno', hat: 'l_phoenix', gear: ['wings_fire'], cape: 'shader', trail: 0xff9a30 }),
  L('l_starborn', 'Starborn', 3, 0x05061a, 0x4a2ab0, 0xffffff, { price: 34000, face: 'l_galaxyeyes', hat: 'l_galaxy', gear: ['wings_energy'], trail: 0xc8a8ff }),
  L('l_glacier', 'Glacier Monarch', 8, 0x0a3060, 0x9ae8ff, 0xffffff, { price: 30000, face: 'l_frostbite', hat: 'l_frostcrown', gear: ['wings_ice'], cape: 'shader', trail: 0xa8f0ff }),
  L('l_neonking', 'Neon Monarch', 13, 0x08001a, 0x3a0060, 0xff40d0, { price: 28000, face: 'l_overclock', hat: 'l_neon', gear: ['ring_synth'], trail: 0x30f0ff }),
  L('l_shadow', 'Shadow Lord', 12, 0x030206, 0x2a0a4a, 0xc070ff, { price: 36000, face: 'l_void', hat: 'l_voidhorns', gear: ['wings_void', 'orbs_void'], cape: 'shader', trail: 0x9a40ff }),
  L('l_stormrider', 'Storm Rider', 1, 0x06102a, 0x1a4ac0, 0x9ae8ff, { price: 30000, face: 'l_storm', gear: ['wings_energy', 'hr_plasma'], trail: 0x7fd8ff }),
  L('l_archangel', 'Archangel', 4, 0xfff8e8, 0xd8b060, 0xffffff, { price: 40000, face: 'l_divine', hat: 'l_holy', gear: ['wings_angel'], cape: 'shader', trail: 0xfff0b0 }),
  L('l_spectrum', 'Spectrum', 2, 0x101018, 0x6060a0, 0xffffff, { price: 38000, face: 'l_prismeyes', gear: ['ring_prism', 'hr_aurora'], trail: 0xff70e0 }),
];

// The two personal suits. Whoever goes by that name wears them. (Anyone could type the name: there is no
// server to check it against.)
export const OWNERS = [
  s('o_theocp', 'The Hacker', 4, -1, { tab: 'legend', team: ['owner'], c: 0x40ff70, shader: { mode: 5, a: 0x050706, b: 0x12c040, c: 0x40ff70 }, trail: 0x40ff70, trailFx: 'code', face: 'hacker', gear: ['monocle', 'glider', 'hood_crown'], hint: 'Only for TheOCP.' }),
  s('o_shortgg', 'GG Girl', 4, -1, { tab: 'legend', team: ['owner', 'admin'], c: 0xff6aa8, p: paintFn.fengish, face: 'cute', gear: ['hairgg', 'headset', 'hemgg'], trail: 0xff8ac0, glow: 0.22, hint: 'Only for ShortGG.' }),
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
// A star of n points (outer radius R, inner r), a heart s wide with its dip at y, a spiral out to R.
const star = (g, x, y, R, r, c, n = 5) => { g.fillStyle = c; g.beginPath(); for (let k = 0; k < n * 2; k++) { const a = -Math.PI / 2 + (k * Math.PI) / n, d = k % 2 ? r : R; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } g.closePath(); g.fill(); };
const heart = (g, x, y, s, c) => { const k = s / 30; g.fillStyle = c; g.beginPath(); g.moveTo(x, y + 18 * k); g.bezierCurveTo(x - 28 * k, y - 2 * k, x - 12 * k, y - 20 * k, x, y - 6 * k); g.bezierCurveTo(x + 12 * k, y - 20 * k, x + 28 * k, y - 2 * k, x, y + 18 * k); g.fill(); };
const spiral = (g, x, y, R, c, w = 4) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); for (let a = 0; a < 6 * Math.PI; a += 0.2) { const d = (a / (6 * Math.PI)) * R; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } g.stroke(); };
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
  // ------------------------------------------- added in 4.10.33
  f('grin', 'Big Grin', 0, 60, (g, i) => twoEyes(g, i, 11), (g, i) => { g.fillStyle = i; g.beginPath(); g.moveTo(34, 12); g.quadraticCurveTo(64, 58, 94, 12); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(42, 13, 44, 8); }),
  f('lol', 'LOL', 0, 60, (g, i) => { line(g, i, 7, [[20, 40], [34, 26], [48, 40]]); line(g, i, 7, [[80, 40], [94, 26], [108, 40]]); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.arc(64, 12, 24, 0, Math.PI); g.closePath(); g.fill(); g.fillStyle = '#e0506a'; g.beginPath(); g.arc(64, 30, 11, Math.PI, 0); g.fill(); }),
  f('blush', 'Blush', 0, 70, (g, i) => { twoEyes(g, i, 11); g.fillStyle = 'rgba(255,90,140,0.55)'; for (const x of [16, 112]) { g.beginPath(); g.ellipse(x, 56, 14, 7, 0, 0, 7); g.fill(); } }, (g, i) => smile(g, i, 16, 6)),
  f('oops', 'Oops', 0, 70, (g, i) => { dot(g, LX, EY, 15, '#ffffff'); dot(g, RX, EY, 15, '#ffffff'); dot(g, LX - 7, EY - 3, 7, '#0a0d14'); dot(g, RX - 7, EY - 3, 7, '#0a0d14'); }, (g, i) => { arc(g, i, 6, 58, 24, 8, 0, 7); }),
  f('meh', 'Meh', 0, 60, (g, i) => { for (const x of [LX, RX]) { dot(g, x, EY + 4, 11, i); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(x - 14, EY - 12, 28, 14); line(g, i, 5, [[x - 14, EY + 2], [x + 14, EY + 2]]); } }, (g, i) => line(g, i, 6, [[40, 28], [52, 24], [64, 28], [76, 24], [88, 28]])),
  f('sideeye', 'Side Eye', 0, 80, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x, EY, 18, 11, 0, 0, 7); g.fill(); dot(g, x + 9, EY, 8, '#0a0d14'); line(g, '#0a0d14', 5, [[x - 18, EY - 12], [x + 18, EY - 9]]); } }, (g, i) => line(g, i, 6, [[50, 28], [80, 26]])),
  f('nervous', 'Nervous', 0, 80, (g, i) => { twoEyes(g, i, 10); line(g, i, 5, [[20, 14], [46, 20]]); line(g, i, 5, [[108, 14], [82, 20]]); }, (g, i) => { g.fillStyle = '#ffffff'; g.strokeStyle = i; g.lineWidth = 4; g.beginPath(); g.roundRect(36, 16, 56, 20, 6); g.fill(); g.stroke(); for (let x = 46; x < 90; x += 10) line(g, i, 3, [[x, 17], [x, 35]], false); }),
  f('kiss', 'Kiss', 0, 90, (g, i) => { arc(g, i, 6, LX, 30, 12, 0.3, Math.PI - 0.3); arc(g, i, 6, RX, 30, 12, 0.3, Math.PI - 0.3); }, (g) => { const x = 66, y = 30; g.fillStyle = '#ff3a6a'; g.beginPath(); g.moveTo(x, y + 12); g.bezierCurveTo(x - 18, y, x - 8, y - 12, x, y - 4); g.bezierCurveTo(x + 8, y - 12, x + 18, y, x, y + 12); g.fill(); }),
  f('yawn', 'Yawn', 0, 60, (g, i) => { line(g, i, 6, [[20, 36], [48, 32]]); line(g, i, 6, [[80, 32], [108, 36]]); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.ellipse(64, 28, 13, 19, 0, 0, 7); g.fill(); g.fillStyle = '#e0506a'; g.beginPath(); g.ellipse(64, 38, 8, 6, 0, 0, 7); g.fill(); }),
  f('starry', 'Starry Eyed', 0, 120, (g) => { star(g, LX, EY, 18, 8, '#ffd23a'); star(g, RX, EY, 18, 8, '#ffd23a'); dot(g, LX - 4, EY - 5, 3, '#ffffff'); dot(g, RX - 4, EY - 5, 3, '#ffffff'); }, (g, i) => smile(g, i, 22, 7)),
  f('hmm', 'Hmm', 0, 80, (g, i) => { twoEyes(g, i, 10); line(g, i, 6, [[20, 18], [48, 18]]); line(g, i, 6, [[80, 14], [94, 6], [108, 12]]); }, (g, i) => line(g, i, 6, [[48, 28], [80, 24]])),
  f('uwu', 'UwU', 0, 100, (g, i) => { arc(g, i, 7, LX, 42, 12, Math.PI + 0.3, -0.3); arc(g, i, 7, RX, 42, 12, Math.PI + 0.3, -0.3); g.fillStyle = 'rgba(255,90,140,0.5)'; g.beginPath(); g.ellipse(14, 54, 12, 6, 0, 0, 7); g.ellipse(114, 54, 12, 6, 0, 0, 7); g.fill(); }, (g, i) => line(g, i, 5, [[46, 20], [55, 30], [64, 22], [73, 30], [82, 20]])),
  f('cheeky', 'Cheeky', 0, 100, (g, i) => { line(g, i, 7, [[20, 38], [34, 30], [48, 38]]); dot(g, RX, EY, 12, i); }, (g, i) => { smile(g, i, 20, 6); g.fillStyle = '#e0506a'; g.beginPath(); g.roundRect(68, 24, 18, 20, 8); g.fill(); }),
  f('dots', 'Dot Eyes', 0, 50, (g, i) => twoEyes(g, i, 6), (g, i) => arc(g, i, 4, 64, 18, 8, 0.3, Math.PI - 0.3)),
  f('shock', 'Shocked', 0, 90, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 17, '#ffffff'); dot(g, x, EY, 4, '#0a0d14'); } }, (g, i) => { g.fillStyle = i; g.beginPath(); g.ellipse(64, 30, 11, 16, 0, 0, 7); g.fill(); }),
  f('bored', 'Bored', 0, 50, (g, i) => { for (const x of [LX, RX]) { dot(g, x, EY + 6, 9, i); line(g, i, 6, [[x - 15, EY + 1], [x + 15, EY + 1]]); } }, (g, i) => line(g, i, 6, [[44, 30], [84, 30]])),
  // Rare
  f('goldtooth', 'Gold Tooth', 1, 260, (g, i) => { twoEyes(g, i, 11); line(g, i, 6, [[80, 14], [108, 20]]); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.moveTo(36, 14); g.quadraticCurveTo(64, 50, 92, 14); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(44, 15, 40, 7); g.fillStyle = '#ffc828'; g.fillRect(66, 15, 9, 8); }),
  f('mustache', 'Mustache', 1, 280, (g, i) => twoEyes(g, i, 10), (g) => { g.fillStyle = '#3a2414'; g.beginPath(); g.moveTo(64, 14); g.bezierCurveTo(48, 6, 30, 10, 22, 26); g.bezierCurveTo(36, 18, 50, 26, 64, 22); g.bezierCurveTo(78, 26, 92, 18, 106, 26); g.bezierCurveTo(98, 10, 80, 6, 64, 14); g.fill(); line(g, '#0a0d14', 5, [[52, 40], [76, 40]]); }),
  f('goatee', 'Goatee', 1, 260, (g, i) => { twoEyes(g, i, 10); line(g, i, 6, [[18, 16], [48, 20]]); line(g, i, 6, [[110, 16], [80, 20]]); }, (g, i) => { smile(g, i, 16, 6); g.fillStyle = '#2a1a10'; g.beginPath(); g.moveTo(52, 36); g.lineTo(76, 36); g.lineTo(64, 60); g.fill(); g.fillRect(44, 12, 40, 5); }),
  f('roundglasses', 'Round Glasses', 1, 280, (g, i) => { twoEyes(g, i, 8); arc(g, '#c8a040', 4, LX, EY, 20, 0, 7); arc(g, '#c8a040', 4, RX, EY, 20, 0, 7); arc(g, '#c8a040', 4, 64, EY + 4, 12, Math.PI + 0.6, -0.6); }, (g, i) => smile(g, i, 16, 6)),
  f('aviators', 'Aviators', 1, 340, (g) => { for (const x of [LX, RX]) { const gr = g.createLinearGradient(0, 18, 0, 54); gr.addColorStop(0, '#2a3a5a'); gr.addColorStop(1, '#c86a2a'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 22, 22); g.lineTo(x + 22, 22); g.quadraticCurveTo(x + 22, 56, x, 54); g.quadraticCurveTo(x - 22, 56, x - 22, 22); g.fill(); g.strokeStyle = '#d8c070'; g.lineWidth = 3; g.stroke(); line(g, 'rgba(255,255,255,0.7)', 3, [[x - 12, 44], [x - 2, 30]]); } line(g, '#d8c070', 3, [[56, 24], [72, 24]]); }, (g, i) => line(g, i, 6, [[46, 26], [70, 28], [84, 20]])),
  f('heartshades', 'Heart Shades', 1, 360, (g) => { for (const x of [LX, RX]) heart(g, x, 30, 26, '#ff3a8a'); line(g, '#ff3a8a', 5, [[52, 26], [76, 26]]); line(g, 'rgba(255,255,255,0.75)', 3, [[LX - 10, 28], [LX - 4, 22]]); line(g, 'rgba(255,255,255,0.75)', 3, [[RX - 10, 28], [RX - 4, 22]]); }, (g, i) => smile(g, i, 20, 6)),
  f('starshades', 'Star Shades', 1, 360, (g) => { for (const x of [LX, RX]) star(g, x, EY, 24, 10, '#ffb81a'); line(g, '#ffb81a', 5, [[56, 30], [72, 30]]); for (const x of [LX, RX]) star(g, x, EY, 15, 6, '#1a1a2a'); }, (g, i) => smile(g, i, 20, 6)),
  f('glasses3d', '3D Glasses', 1, 320, (g) => { g.fillStyle = '#f4f4f4'; g.beginPath(); g.roundRect(6, 16, 116, 36, 6); g.fill(); g.fillStyle = '#ff3a3a'; g.fillRect(12, 22, 44, 24); g.fillStyle = '#30d8ff'; g.fillRect(72, 22, 44, 24); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.arc(64, 14, 18, 0, Math.PI); g.fill(); }),
  f('robotface', 'Robot Face', 1, 320, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#10141c'; g.fillRect(x - 17, EY - 13, 34, 26); g.fillStyle = '#ffd040'; g.fillRect(x - 10, EY - 6, 20, 12); } }, (g) => { g.fillStyle = '#10141c'; g.fillRect(36, 14, 56, 22); g.fillStyle = '#ffd040'; for (let x = 40; x < 90; x += 9) g.fillRect(x, 18, 5, 14); }, { still: true }),
  f('sus', 'Suspicious', 1, 260, (g, i) => { for (const x of [LX, RX]) { dot(g, x, EY + 3, 11, i); g.clearRect(x - 14, EY - 12, 28, 11); line(g, i, 6, [[x - 15, EY - 1], [x + 15, EY + 3]]); } }, (g, i) => arc(g, i, 6, 60, 46, 14, Math.PI + 0.6, -0.6)),
  f('evilgrin', 'Evil Grin', 1, 340, (g, i) => { twoEyes(g, i, 10); line(g, i, 8, [[14, 14], [50, 30]]); line(g, i, 8, [[114, 14], [78, 30]]); }, (g, i) => { g.fillStyle = i; g.beginPath(); g.moveTo(24, 8); g.quadraticCurveTo(64, 56, 104, 8); g.quadraticCurveTo(64, 30, 24, 8); g.fill(); g.fillStyle = '#ffffff'; for (let x = 36; x < 94; x += 10) { g.beginPath(); g.moveTo(x, 13 + Math.abs(64 - x) * -0.06); g.lineTo(x + 8, 13); g.lineTo(x + 4, 22); g.fill(); } }),
  f('sweaty', 'Sweaty', 1, 260, (g, i) => { twoEyes(g, i, 10); g.fillStyle = '#6ac8ff'; g.beginPath(); g.moveTo(118, 4); g.quadraticCurveTo(126, 18, 118, 22); g.quadraticCurveTo(110, 18, 118, 4); g.fill(); }, (g, i) => line(g, i, 6, [[40, 28], [50, 22], [60, 28], [70, 22], [80, 28], [90, 22]])),
  f('money', 'Money Eyes', 1, 400, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#20c060'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', x, EY + 2); } }, (g, i) => { g.fillStyle = i; g.beginPath(); g.arc(64, 12, 24, 0, Math.PI); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(44, 12, 40, 7); }),
  f('hypno', 'Hypnotized', 1, 340, (g, i) => { for (const x of [LX, RX]) spiral(g, x, EY, 19, i); }, (g, i) => line(g, i, 6, [[44, 26], [56, 30], [68, 24], [80, 30]]), { still: true }),
  f('zzz', 'Fast Asleep', 1, 260, (g, i) => { arc(g, i, 6, LX, 28, 12, 0.3, Math.PI - 0.3); arc(g, i, 6, RX, 28, 12, 0.3, Math.PI - 0.3); g.fillStyle = '#7ab0ff'; g.font = 'bold 20px sans-serif'; g.fillText('z', 112, 14); g.font = 'bold 14px sans-serif'; g.fillText('z', 122, 4); }, (g, i) => dot(g, 64, 26, 7, i), { still: true }),
  f('pandaeyes', 'Panda Eyes', 1, 300, (g) => { for (const [x, s] of [[LX, 1], [RX, -1]]) { g.fillStyle = '#14141a'; g.beginPath(); g.ellipse(x, EY + 2, 22, 16, s * -0.5, 0, 7); g.fill(); dot(g, x, EY, 8, '#ffffff'); dot(g, x + 1, EY + 1, 4, '#0a0d14'); } }, (g) => { g.fillStyle = '#14141a'; g.beginPath(); g.ellipse(64, 10, 9, 6, 0, 0, 7); g.fill(); arc(g, '#14141a', 4, 56, 20, 8, 0.2, Math.PI - 0.2); arc(g, '#14141a', 4, 72, 20, 8, 0.2, Math.PI - 0.2); }, { still: true }),
  f('bunnyface', 'Bunny Face', 1, 280, (g, i) => { dot(g, LX, EY, 13, i); dot(g, RX, EY, 13, i); shiny(g, LX, EY, 13); shiny(g, RX, EY, 13); }, (g) => { g.fillStyle = '#ff8ab0'; g.beginPath(); g.moveTo(58, 6); g.lineTo(70, 6); g.lineTo(64, 13); g.fill(); line(g, '#0a0d14', 4, [[64, 13], [64, 20]]); arc(g, '#0a0d14', 4, 58, 20, 6, 0, Math.PI); arc(g, '#0a0d14', 4, 70, 20, 6, 0, Math.PI); g.fillStyle = '#ffffff'; g.strokeStyle = '#0a0d14'; g.lineWidth = 2; g.beginPath(); g.rect(58, 25, 6, 9); g.rect(64, 25, 6, 9); g.fill(); g.stroke(); }),
  f('puppy', 'Puppy', 1, 300, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 16, '#3a2414'); dot(g, x, EY, 10, '#0a0d14'); dot(g, x - 5, EY - 6, 5, '#ffffff'); dot(g, x + 4, EY + 5, 2, '#ffffff'); } }, (g) => { g.fillStyle = '#0a0d14'; g.beginPath(); g.ellipse(64, 8, 9, 6, 0, 0, 7); g.fill(); arc(g, '#0a0d14', 4, 56, 18, 8, 0.1, Math.PI - 0.2); arc(g, '#0a0d14', 4, 72, 18, 8, 0.2, Math.PI - 0.1); g.fillStyle = '#ff6a8a'; g.beginPath(); g.roundRect(58, 24, 12, 18, 6); g.fill(); }),
  // Epic
  f('cyclops', 'Cyclops', 2, 900, (g) => { dot(g, 64, EY, 24, '#ffffff'); dot(g, 64, EY, 13, '#30a060'); dot(g, 64, EY, 7, '#0a0d14'); dot(g, 58, EY - 6, 4, '#ffffff'); line(g, '#0a0d14', 7, [[36, 8], [64, 4], [92, 8]]); }, (g, i) => { smile(g, i, 22, 7); g.fillStyle = '#ffffff'; g.fillRect(52, 28, 8, 8); g.fillRect(70, 28, 8, 8); }),
  f('demon', 'Demon', 2, 1200, (g) => { for (const [x, s] of [[LX, 1], [RX, -1]]) { g.save(); g.shadowColor = '#ff2010'; g.shadowBlur = 10; g.fillStyle = '#ff3a1a'; g.beginPath(); g.moveTo(x - 18 * s, EY - 10); g.lineTo(x + 18 * s, EY + 2); g.lineTo(x - 12 * s, EY + 10); g.closePath(); g.fill(); g.restore(); g.fillStyle = '#ffe080'; g.fillRect(x - 2, EY - 4, 4, 9); } }, (g) => { g.fillStyle = '#0a0d14'; g.beginPath(); g.moveTo(26, 10); g.quadraticCurveTo(64, 52, 102, 10); g.quadraticCurveTo(64, 26, 26, 10); g.fill(); g.fillStyle = '#ffffff'; for (const x of [44, 80]) { g.beginPath(); g.moveTo(x - 5, 16); g.lineTo(x + 5, 16); g.lineTo(x, 32); g.fill(); } }, { glow: 1.4, still: true }),
  f('ghostface', 'Ghost', 2, 900, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#0a0d14'; g.beginPath(); g.ellipse(x, EY, 13, 19, 0, 0, 7); g.fill(); } }, (g) => { g.fillStyle = '#0a0d14'; g.beginPath(); g.ellipse(64, 30, 12, 18, 0, 0, 7); g.fill(); }, { still: true }),
  f('spider', 'Spider Eyes', 2, 1100, (g) => { g.save(); g.shadowColor = '#ff2040'; g.shadowBlur = 8; for (const [x, y, r] of [[LX, EY, 12], [RX, EY, 12], [LX + 18, EY - 16, 7], [RX - 18, EY - 16, 7], [LX - 14, EY - 18, 6], [RX + 14, EY - 18, 6], [56, 12, 5], [72, 12, 5]]) { dot(g, x, y, r + 2, '#1a0006'); dot(g, x, y, r, '#e0102a'); dot(g, x - r * 0.3, y - r * 0.3, r * 0.25, '#ffb0b8'); } g.restore(); }, (g, i) => { line(g, i, 5, [[48, 14], [44, 34]]); line(g, i, 5, [[80, 14], [84, 34]]); }, { glow: 1.1, still: true }),
  f('lasereyes', 'Laser Eyes', 2, 1300, (g) => { g.save(); g.shadowColor = '#ff1a1a'; g.shadowBlur = 14; for (const x of [LX, RX]) { dot(g, x, EY, 14, '#ff2a1a'); dot(g, x, EY, 7, '#fff0e0'); line(g, 'rgba(255,60,30,0.8)', 4, [[x - 24, EY], [x + 24, EY]]); line(g, 'rgba(255,60,30,0.8)', 4, [[x, EY - 20], [x, EY + 20]]); } g.restore(); }, (g, i) => line(g, i, 7, [[44, 26], [84, 26]]), { glow: 1.9, still: true }),
  f('kitsune', 'Kitsune', 2, 1100, (g) => { for (const [x, s] of [[LX, 1], [RX, -1]]) { g.fillStyle = '#e82a2a'; g.beginPath(); g.moveTo(x - 20 * s, EY + 8); g.quadraticCurveTo(x, EY - 18, x + 22 * s, EY - 14); g.quadraticCurveTo(x + 4 * s, EY - 2, x - 20 * s, EY + 8); g.fill(); g.fillStyle = '#0a0d14'; g.beginPath(); g.moveTo(x - 14 * s, EY + 6); g.quadraticCurveTo(x, EY - 6, x + 16 * s, EY - 6); g.quadraticCurveTo(x, EY + 4, x - 14 * s, EY + 6); g.fill(); } line(g, '#e82a2a', 4, [[64, 4], [64, 18]]); dot(g, 64, 4, 4, '#e82a2a'); }, (g) => { line(g, '#e82a2a', 4, [[30, 22], [44, 30]]); line(g, '#e82a2a', 4, [[98, 22], [84, 30]]); arc(g, '#0a0d14', 5, 64, 14, 14, 0.4, Math.PI - 0.4); }, { still: true }),
  f('oni', 'Oni', 2, 1200, (g) => { for (const [x, s] of [[LX, 1], [RX, -1]]) { dot(g, x, EY + 2, 14, '#ffd02a'); dot(g, x, EY + 2, 6, '#0a0d14'); line(g, '#0a0d14', 9, [[x - 20 * s, EY - 18], [x + 18 * s, EY - 6]]); } }, (g) => { g.fillStyle = '#0a0d14'; g.beginPath(); g.roundRect(28, 10, 72, 30, 12); g.fill(); g.fillStyle = '#ffffff'; for (const x of [34, 86]) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x + 8, 40); g.lineTo(x + 4, 18); g.fill(); } for (let x = 44; x < 84; x += 8) g.fillRect(x, 10, 6, 7); }, { still: true }),
  f('gasmask', 'Gas Mask', 2, 1000, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 20, '#3a4048'); dot(g, x, EY, 15, '#7ad0a0'); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(x - 5, EY - 5, 6, 3, -0.6, 0, 7); g.fill(); } }, (g) => { g.fillStyle = '#3a4048'; g.beginPath(); g.moveTo(40, 4); g.lineTo(88, 4); g.lineTo(80, 40); g.lineTo(48, 40); g.fill(); dot(g, 64, 30, 15, '#2a3038'); for (let k = -2; k <= 2; k++) line(g, '#5a6470', 3, [[58 + k * 3, 22], [58 + k * 3, 38]]); }, { still: true }),
  f('cyborg', 'Cyborg', 2, 1200, (g, i) => { dot(g, LX, EY, 11, i); g.fillStyle = '#4a5260'; g.beginPath(); g.roundRect(68, 12, 54, 44, 8); g.fill(); g.save(); g.shadowColor = '#ff2030'; g.shadowBlur = 10; dot(g, RX, EY, 12, '#ff2a3a'); g.restore(); dot(g, RX, EY, 5, '#ffe0e0'); line(g, '#8a94a4', 2, [[70, 50], [120, 50]]); line(g, '#8a94a4', 2, [[118, 14], [118, 54]]); }, (g, i) => { line(g, i, 6, [[40, 26], [72, 26]]); line(g, '#4a5260', 6, [[72, 26], [90, 26]]); }, { glow: 1.25 }),
  f('glitch', 'Glitch', 2, 1300, (g) => { for (const x of [LX, RX]) { g.fillStyle = 'rgba(255,40,80,0.9)'; g.fillRect(x - 15, EY - 12, 26, 24); g.fillStyle = 'rgba(40,220,255,0.9)'; g.fillRect(x - 9, EY - 10, 26, 24); g.fillStyle = '#ffffff'; g.fillRect(x - 12, EY - 11, 24, 22); g.fillStyle = '#0a0d14'; g.fillRect(x - 6, EY - 6, 12, 12); } for (let y = 6; y < 64; y += 9) { g.fillStyle = y % 2 ? 'rgba(40,220,255,0.6)' : 'rgba(255,40,80,0.6)'; g.fillRect((y * 37) % 90, y, 30, 2); } }, (g) => { g.fillStyle = '#ff2a50'; g.fillRect(40, 20, 50, 8); g.fillStyle = '#2ad8ff'; g.fillRect(36, 26, 50, 8); g.fillStyle = '#0a0d14'; g.fillRect(38, 22, 50, 9); }, { glow: 1.3, still: true }),
  f('sugarskull', 'Sugar Skull', 2, 1100, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 18, '#0a0d14'); for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; dot(g, x + Math.cos(a) * 21, EY + Math.sin(a) * 21, 3.5, ['#ff4a8a', '#ffd02a', '#30d0ff', '#7aff6a'][k % 4]); } dot(g, x, EY, 5, '#ff4a8a'); } heart(g, 64, 10, 14, '#ff4a8a'); }, (g) => { g.fillStyle = '#0a0d14'; g.beginPath(); g.moveTo(64, 2); g.lineTo(56, 14); g.lineTo(72, 14); g.fill(); line(g, '#0a0d14', 3, [[30, 30], [98, 30]]); for (let x = 34; x < 98; x += 8) line(g, '#0a0d14', 3, [[x, 24], [x, 36]]); }, { still: true }),
  f('snake', 'Snake Eyes', 2, 1000, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#d8e030'; g.beginPath(); g.ellipse(x, EY, 17, 13, 0, 0, 7); g.fill(); g.fillStyle = '#0a0d14'; g.beginPath(); g.ellipse(x, EY, 3.5, 12, 0, 0, 7); g.fill(); } }, (g, i) => { line(g, i, 5, [[44, 20], [84, 20]]); line(g, '#e02a4a', 4, [[64, 20], [64, 38], [58, 46]]); line(g, '#e02a4a', 4, [[64, 38], [70, 46]]); }, { still: true }),
  f('owl', 'Owl', 2, 1000, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 22, '#f8f0e0'); dot(g, x, EY, 16, '#ff9a1a'); dot(g, x, EY, 9, '#0a0d14'); dot(g, x - 4, EY - 4, 3, '#ffffff'); } line(g, '#5a3a1a', 6, [[14, 10], [50, 18]]); line(g, '#5a3a1a', 6, [[114, 10], [78, 18]]); }, (g) => { g.fillStyle = '#e8a020'; g.beginPath(); g.moveTo(56, 4); g.lineTo(72, 4); g.lineTo(64, 22); g.fill(); }, { still: true }),
  // Legendary: lit from inside, each with something round the eyes (gear.js f_*).
  f('l_inferno', 'Inferno', 3, 9000, (g) => { g.save(); g.shadowColor = '#ff5a10'; g.shadowBlur = 14; for (const [x, s] of [[LX, 1], [RX, -1]]) { const gr = g.createRadialGradient(x, EY + 4, 2, x, EY, 22); gr.addColorStop(0, '#fff8c0'); gr.addColorStop(0.35, '#ffc030'); gr.addColorStop(0.75, '#ff5010'); gr.addColorStop(1, 'rgba(160,20,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - 20, EY + 14); g.quadraticCurveTo(x - 22, EY - 8, x - 8 * s, EY - 30); g.quadraticCurveTo(x - 2, EY - 12, x + 6, EY - 22); g.quadraticCurveTo(x + 10, EY - 8, x + 16 * s, EY - 26); g.quadraticCurveTo(x + 24, EY - 2, x + 20, EY + 14); g.closePath(); g.fill(); } g.restore(); for (const x of [LX, RX]) { g.fillStyle = '#2a0600'; g.beginPath(); g.ellipse(x, EY + 4, 3, 8, 0, 0, 7); g.fill(); } },
    (g) => { g.save(); g.shadowColor = '#ff6a10'; g.shadowBlur = 12; g.fillStyle = '#ff7a20'; g.beginPath(); g.moveTo(26, 10); g.quadraticCurveTo(64, 54, 102, 10); g.quadraticCurveTo(64, 30, 26, 10); g.fill(); g.restore(); g.fillStyle = '#fff0b0'; g.beginPath(); g.moveTo(40, 18); g.quadraticCurveTo(64, 40, 88, 18); g.quadraticCurveTo(64, 28, 40, 18); g.fill(); }, { glow: 1.9, still: true, gear: ['f_inferno'] }),
  f('l_void', 'Void Gaze', 3, 10000, (g) => { for (const x of [LX, RX]) { dot(g, x, EY, 21, '#06020c'); g.save(); g.shadowColor = '#b050ff'; g.shadowBlur = 12; spiral(g, x, EY, 17, '#c070ff', 3); dot(g, x, EY, 4, '#ffffff'); g.restore(); arc(g, '#8030e0', 3, x, EY, 21, 0, 7); } },
    (g) => { g.save(); g.shadowColor = '#a040ff'; g.shadowBlur = 10; line(g, '#d8a0ff', 4, [[36, 22], [50, 30], [64, 24], [78, 30], [92, 22]]); g.restore(); }, { glow: 1.8, still: true, gear: ['f_void'] }),
  f('l_galaxyeyes', 'Galaxy Eyes', 3, 11000, (g) => { for (const x of [LX, RX]) { const gr = g.createRadialGradient(x - 4, EY - 4, 2, x, EY, 22); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#ff7ad8'); gr.addColorStop(0.55, '#6a3ae0'); gr.addColorStop(0.85, '#10206a'); gr.addColorStop(1, '#050818'); g.fillStyle = gr; g.beginPath(); g.arc(x, EY, 21, 0, 7); g.fill(); for (let k = 0; k < 9; k++) dot(g, x + Math.cos(k * 2.4) * (6 + (k * 7) % 13), EY + Math.sin(k * 2.4) * (6 + (k * 7) % 13), k % 3 ? 1.2 : 2, '#ffffff'); star(g, x + 7, EY - 8, 6, 2, '#ffffff'); arc(g, 'rgba(160,200,255,0.8)', 2, x, EY, 21, 0, 7); } },
    (g) => { g.save(); g.shadowColor = '#a070ff'; g.shadowBlur = 8; arc(g, '#e0c8ff', 5, 64, 10, 20, 0.5, Math.PI - 0.5); g.restore(); }, { glow: 1.6, still: true, gear: ['f_galaxy'] }),
  f('l_storm', 'Storm Eyes', 3, 9500, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#04102a'; g.beginPath(); g.ellipse(x, EY, 24, 19, 0, 0, 7); g.fill(); }
    g.save(); g.shadowColor = '#20b8ff'; g.shadowBlur = 12; for (const [x, s] of [[LX, -1], [RX, 1]]) { dot(g, x, EY, 13, '#1aa8ff'); dot(g, x, EY, 7, '#d8f8ff'); line(g, '#40d0ff', 3, [[x + 10 * s, EY - 6], [x + 18 * s, EY - 14], [x + 15 * s, EY - 6], [x + 24 * s, EY - 16]]); line(g, '#40d0ff', 3, [[x + 8 * s, EY + 8], [x + 16 * s, EY + 14], [x + 22 * s, EY + 10]]); } g.restore(); },
    (g) => { g.fillStyle = '#04102a'; g.beginPath(); g.roundRect(34, 14, 60, 24, 10); g.fill(); g.save(); g.shadowColor = '#20b8ff'; g.shadowBlur = 8; line(g, '#40d0ff', 4, [[40, 24], [52, 30], [62, 20], [74, 30], [88, 22]]); g.restore(); }, { glow: 1.35, still: true, gear: ['f_storm'] }),
  f('l_divine', 'Divine Light', 3, 12000, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#2a1600'; g.beginPath(); g.arc(x, EY, 26, 0, 7); g.fill(); }
    g.save(); g.shadowColor = '#ffb000'; g.shadowBlur = 12; for (const x of [LX, RX]) { for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283; line(g, '#ffb820', 3, [[x + Math.cos(a) * 13, EY + Math.sin(a) * 13], [x + Math.cos(a) * (k % 2 ? 19 : 25), EY + Math.sin(a) * (k % 2 ? 19 : 25)]]); } dot(g, x, EY, 11, '#ffc030'); dot(g, x, EY, 6, '#fff4c0'); } g.restore(); },
    (g) => { g.fillStyle = '#2a1600'; g.beginPath(); g.roundRect(38, 10, 52, 26, 12); g.fill(); g.save(); g.shadowColor = '#ffb000'; g.shadowBlur = 8; arc(g, '#ffc030', 5, 64, 6, 18, 0.5, Math.PI - 0.5); g.restore(); }, { glow: 1.35, still: true, gear: ['f_divine'] }),
  f('l_overclock', 'Overclocked', 3, 10000, (g) => { g.fillStyle = '#03101a'; g.beginPath(); g.roundRect(4, 12, 120, 44, 14); g.fill();
    g.save(); g.shadowColor = '#00d8ff'; g.shadowBlur = 8; for (const x of [LX, RX]) { g.strokeStyle = '#18d8ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 20, EY - 8); g.lineTo(x - 20, EY - 16); g.lineTo(x - 12, EY - 16); g.moveTo(x + 12, EY - 16); g.lineTo(x + 20, EY - 16); g.lineTo(x + 20, EY - 8); g.moveTo(x + 20, EY + 8); g.lineTo(x + 20, EY + 16); g.lineTo(x + 12, EY + 16); g.moveTo(x - 12, EY + 16); g.lineTo(x - 20, EY + 16); g.lineTo(x - 20, EY + 8); g.stroke(); g.fillStyle = '#18d8ff'; g.fillRect(x - 12, EY - 4, 24, 8); dot(g, x, EY, 3, '#e0ffff'); } g.restore();
    g.fillStyle = 'rgba(24,216,255,0.22)'; for (let y = 16; y < 54; y += 4) g.fillRect(8, y, 112, 1); },
    (g) => { g.fillStyle = '#03101a'; g.beginPath(); g.roundRect(30, 10, 68, 32, 10); g.fill(); g.save(); g.shadowColor = '#00d8ff'; g.shadowBlur = 6; g.fillStyle = '#18d8ff'; for (let k = 0; k < 9; k++) { const h = 4 + Math.abs(Math.sin(k * 1.7)) * 16; g.fillRect(36 + k * 6.5, 26 - h / 2, 4, h); } g.restore(); }, { glow: 1.35, still: true, gear: ['f_overclock'] }),
  f('l_frostbite', 'Frozen Gaze', 3, 9500, (g) => { for (const x of [LX, RX]) { g.fillStyle = '#061a36'; g.beginPath(); g.moveTo(x, EY - 26); g.lineTo(x + 24, EY); g.lineTo(x, EY + 26); g.lineTo(x - 24, EY); g.closePath(); g.fill(); }
    g.save(); g.shadowColor = '#40c8ff'; g.shadowBlur = 10; for (const x of [LX, RX]) { const gr = g.createRadialGradient(x, EY, 2, x, EY, 16); gr.addColorStop(0, '#e8fcff'); gr.addColorStop(0.45, '#60d0ff'); gr.addColorStop(1, '#1a70d0'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, EY - 16); g.lineTo(x + 14, EY); g.lineTo(x, EY + 16); g.lineTo(x - 14, EY); g.closePath(); g.fill();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283 + 0.5; line(g, '#70d8ff', 2, [[x + Math.cos(a) * 17, EY + Math.sin(a) * 17], [x + Math.cos(a) * 25, EY + Math.sin(a) * 25]]); } } g.restore(); },
    (g) => { g.fillStyle = '#061a36'; g.beginPath(); g.roundRect(38, 16, 52, 20, 9); g.fill(); g.save(); g.shadowColor = '#40c8ff'; g.shadowBlur = 6; line(g, '#70d8ff', 4, [[44, 26], [84, 26]]); g.restore(); }, { glow: 1.35, still: true, gear: ['f_frost'] }),
  f('l_prismeyes', 'Prism Eyes', 3, 12000, (g) => { const C = ['#ff2a40', '#ff8a10', '#ffd820', '#30d050', '#2a90ff', '#9a50ff']; for (const x of [LX, RX]) dot(g, x, EY, 25, '#0a0a14');
    g.save(); g.shadowColor = '#ffffff'; g.shadowBlur = 4; for (const x of [LX, RX]) { for (let k = 0; k < 6; k++) arc(g, C[k], 3, x, EY, 21 - k * 3.4, 0, 7); dot(g, x, EY, 3, '#ffffff'); } g.restore(); },
    (g) => { g.fillStyle = '#0a0a14'; g.beginPath(); g.roundRect(34, 8, 60, 30, 12); g.fill(); const gr = g.createLinearGradient(40, 0, 88, 0); ['#ff2a40', '#ffd820', '#30d050', '#2a90ff', '#9a50ff'].forEach((c, k) => gr.addColorStop(k / 4, c)); g.strokeStyle = gr; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(64, 6, 20, 0.5, Math.PI - 0.5); g.stroke(); }, { glow: 1.3, still: true, gear: ['f_prism'] }),
  f('hacker', 'Hacker', 4, -1, (g) => {
    g.save();
    g.beginPath(); g.rect(0, 28, 70, 40); g.clip();
    g.shadowColor = '#40ff70'; g.shadowBlur = 8;
    const gr = g.createLinearGradient(0, 28, 0, 50);
    gr.addColorStop(0, '#0c6a2a'); gr.addColorStop(0.3, '#2ee060'); gr.addColorStop(1, '#d0ffe0');
    g.fillStyle = gr; g.beginPath(); g.ellipse(LX, 33, 20, 16, 0, 0, 7); g.fill();
    g.restore();
    line(g, '#0a0d14', 6, [[13, 28], [56, 27]]);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(45, 34, 4, 2.6, -0.3, 0, 7); g.fill();
    line(g, '#f4f8f6', 9, [[82, 40], [107, 28]]);
  }, () => {}, { glow: 1.5, still: true, hidden: true }),
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
  h('sunvisor', 'Sun Visor', 0, 70), h('trucker', 'Trucker Cap', 0, 90), h('snapback', 'Backwards Cap', 0, 90), h('bandana', 'Bandana', 0, 80), h('newsboy', 'Flat Cap', 0, 110),
  h('earmuffs', 'Earmuffs', 0, 100), h('bowler', 'Bowler Hat', 0, 140),
  h('fedora', 'Fedora', 1, 320), h('ushanka', 'Fur Hat', 1, 340), h('papercrown', 'Paper Crown', 1, 260), h('straw', 'Straw Hat', 1, 300), h('hardhat', 'Hard Hat', 1, 280),
  h('jesterhat', 'Jester Hat', 1, 360), h('unicorn', 'Unicorn Horn', 1, 420), h('froghat', 'Frog Hat', 1, 380), h('tiara', 'Tiara', 1, 400), h('aviator', 'Aviator Cap', 1, 380),
  h('ufo', 'Little UFO', 2, 1400), h('crystalcrown', 'Crystal Crown', 2, 1600), h('cybervisor', 'Cyber Visor', 2, 1300), h('jelly', 'Jellyfish', 2, 1200), h('raincloud', 'Storm Cloud', 2, 1100),
  h('nemes', 'Pharaoh Headdress', 2, 1500),
  h('l_phoenix', 'Phoenix Crest', 3, 12000), h('l_galaxy', 'Galaxy Halo', 3, 14000), h('l_frostcrown', 'Frost Crown', 3, 12000), h('l_voidhorns', 'Void Horns', 3, 13000),
  h('l_neon', 'Neon Crown', 3, 11000), h('l_holy', 'Holy Wings', 3, 15000),
  // Only as part of a legendary suit.
  Object.assign(h('l_crown', 'Blazing Crown', 3, -1), { hidden: true }), Object.assign(h('bolt', 'Storm Bolts', 3, -1), { hidden: true }), Object.assign(h('sunrays', 'Sun Rays', 3, -1), { hidden: true }),
  Object.assign(h('antlers', 'Antlers', 3, -1), { hidden: true }), Object.assign(h('flames', 'Living Flames', 3, -1), { hidden: true }),
];
export const HAT = Object.fromEntries(HATS.map((x) => [x.id, x]));

// ---------------------------------------------------------------- hair (the shapes are in gear.js)
const hr = (id, name, r, price) => ({ id, name, r, price, kind: 'hair', tab: 'hair' });
export const HAIRS = [
  hr('none', 'No Hair', 0, 0),
  hr('hr_short', 'Short Crop', 0, 120), hr('hr_swoop', 'Side Swoop', 0, 150), hr('hr_pony', 'Ponytail', 0, 180),
  hr('hr_spiky', 'Spiky', 1, 280), hr('hr_long', 'Long Hair', 1, 300), hr('hr_bob', 'Purple Bob', 1, 300), hr('hr_buns', 'Space Buns', 1, 320),
  hr('hr_curly', 'Curls', 1, 320), hr('hr_braids', 'Braids', 1, 340), hr('hr_neon', 'Neon Spikes', 1, 650),
  hr('hr_buzz', 'Buzz Cut', 0, 100), hr('hr_bowl', 'Bowl Cut', 0, 130), hr('hr_messy', 'Messy', 0, 150), hr('hr_slick', 'Slicked Back', 0, 160), hr('hr_bangs', 'Bangs', 0, 170),
  hr('hr_sidepart', 'Side Part', 0, 140),
  hr('hr_twin', 'Twin Tails', 1, 360), hr('hr_topknot', 'Top Knot', 1, 300), hr('hr_dreads', 'Dreadlocks', 1, 380), hr('hr_quiff', 'Quiff', 1, 320), hr('hr_wavy', 'Long Waves', 1, 360),
  hr('hr_pixie', 'Pink Pixie', 1, 320), hr('hr_mullet', 'Mullet', 1, 300), hr('hr_highpony', 'High Ponytail', 1, 340), hr('hr_silver', 'Silver Spikes', 1, 420),
  hr('hr_golden', 'Golden Spikes', 2, 1400), hr('hr_ice', 'Ice Spikes', 2, 1300), hr('hr_rainbow', 'Rainbow Locks', 2, 1500), hr('hr_mane', 'Wild Mane', 2, 1200), hr('hr_sakura', 'Sakura', 2, 1300),
  hr('hr_flame', 'Living Flame', 3, 12000), hr('hr_star', 'Starlight', 3, 14000), hr('hr_plasma', 'Plasma', 3, 12000), hr('hr_aurora', 'Aurora', 3, 13000),
];
export const HAIR = Object.fromEntries(HAIRS.map((x) => [x.id, x]));

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
    legendStill(p, g, S, cc(S.a), cc(S.b), cc(S.c));
  } else { g.fillStyle = '#' + suit.c.toString(16).padStart(6, '0'); g.fillRect(0, 0, TEX, TEX); }
  return c;
}

// What of a suit shines when it has a lit painter: the suit itself, dimmed, with the lit parts on top at full strength. The
// material multiplies this by LIT_K, so the dimmed rest glows as much as any other suit and the lit parts far more.
export const LIT_K = 2.2;
export function paintLit(suit, size = TEX) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#000000'; g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.42 / LIT_K; g.drawImage(paintSuit(suit, size), 0, 0); g.globalAlpha = 1;
  g.scale(size / TEX, size / TEX);
  suit.lit(P(g));
  return c;
}

// A still picture of each shader, for the shop's cards.
function legendStill(p, g, S, A, B, C) {
  const R = rng(9 + S.mode), line = (c, w, pts) => { g.strokeStyle = c; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  const walk = (n, step) => { const out = []; let x = R() * TEX, y = R() * TEX; for (let i = 0; i < n; i++) { out.push([x, y]); x += (R() - 0.5) * step; y += (R() - 0.3) * step; } return out; };
  switch (S.mode) {
    case 2: paintFn.rainbow(p); break;
    case 5: {
      // Black with faint streams of little glyphs, a few bands torn sideways where the code burns bright, pink and cyan on
      // their edges, and a green scan line.
      const u = TEX / 128, glyphs = (x, y0, len, a) => {
        for (let k = 0; k < len; k++) {
          g.globalAlpha = (1 - k / len) * a;
          g.fillStyle = k === 0 ? '#e4fff0' : k < 2 ? C : B;
          for (let b = 0; b < 4; b++) if (R() > 0.35) g.fillRect(x + (b % 2) * 4 * u, y0 - k * 11 * u + ((b / 2) | 0) * 4 * u, 3 * u, 3 * u);
        }
        g.globalAlpha = 1;
      };
      p.all(A);
      for (let i = 0; i < 60; i++) glyphs(((R() * 40) | 0) * (TEX / 40), R() * TEX, 4 + ((R() * 9) | 0), 0.35);
      for (let i = 0; i < 5; i++) {
        const y = R() * TEX * 0.9, h = (3 + R() * 6) * u, dx = (R() - 0.5) * 12 * u;
        g.save(); g.beginPath(); g.rect(0, y, TEX, h); g.clip();
        g.fillStyle = A; g.fillRect(0, y, TEX, h);
        for (let x = 0; x < TEX; x += TEX / 40) glyphs(x + dx, y + h, 2 + ((R() * 3) | 0), 1);
        g.restore();
        g.fillStyle = 'rgba(255,64,216,0.85)'; g.fillRect(0, y, TEX, 0.8 * u);
        g.fillStyle = 'rgba(51,255,255,0.85)'; g.fillRect(0, y + h - 0.8 * u, TEX, 0.8 * u);
      }
      g.fillStyle = C; g.globalAlpha = 0.7; g.fillRect(0, TEX * 0.32, TEX, u); g.globalAlpha = 1;
      break;
    }
    case 6: { p.vgrad(B, A); g.globalAlpha = 0.45; for (let i = 0; i < 16; i++) { g.fillStyle = i % 3 ? C : B; g.fillRect(R() * TEX, R() * TEX * 0.4, 6 + R() * 18, TEX * 0.6); } g.globalAlpha = 1; break; }
    case 7: { p.all(A); for (let i = 0; i < 26; i++) { const w = walk(7, 70); line(B, 7, w); line(C, 2.5, w); } break; }
    case 8: { p.vgrad(B, A); for (let i = 0; i < 70; i++) { const x = R() * TEX, y = R() * TEX, r = 18 + R() * 30; g.fillStyle = R() > 0.5 ? A : B; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.globalAlpha = 1; g.strokeStyle = C; g.lineWidth = 1.5; g.stroke(); } break; }
    case 9: { p.all(A); p.blobs([B, C], 22, 10, 36, 41); p.dots('#ffffff', 90, 1, 2.5, 13); break; }
    case 10: { p.all(A); for (let i = 0; i < 60; i++) { const x = ((R() * 40) | 0) * 13, y = ((R() * 34) | 0) * 15, h = R() > 0.5; line(i % 4 ? B : C, i % 4 ? 2 : 3, [[x, y], h ? [x + 40 + R() * 60, y] : [x, y + 40 + R() * 60]]); } p.dots(C, 30, 3, 5, 17); break; }
    case 11: { p.all(A); for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) { const cx = x * 18 + (y % 2) * 9, cy = y * 18; g.fillStyle = (x + y) % 3 ? B : A; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI); g.fill(); g.strokeStyle = C; g.lineWidth = 1.2; g.stroke(); } break; }
    case 12: { p.vgrad(B, A); g.globalAlpha = 0.5; p.blobs([C, B], 18, 8, 30, 23); g.globalAlpha = 1; break; }
    case 13: { p.vgrad(B, A); for (let i = 0; i < TEX; i += 26) { line(C, 2, [[i, 0], [i, TEX]]); line(C, 2, [[0, i], [TEX, i]]); } break; }
    case 14: { paintFn.rainbow(p); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, TEX, TEX); for (let y = 0; y < TEX; y += 6) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y, TEX, 2); } break; }
    default: p.vgrad(A, B); p.blobs([C, B], 26, 6, 24, 77);
  }
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

// What someone is wearing, from their saved picks: { s, f, h, r, w } ids (suit, face, hat, hair, weapon). Anything unknown
// falls back to the free look, and the team suits only work with a flag from the server.
export function resolveLook(look, role) {
  const l = look || {};
  let suit = SUIT[l.s] || SUIT[FREE_SUIT];
  if (suit.team && !suit.team.includes(role)) suit = SUIT[FREE_SUIT];
  // No hat or the classic face picked: the suit may bring its own.
  const fid = l.f && l.f !== 'smile' ? l.f : suit.face || 'smile', hid = l.h && l.h !== 'none' ? l.h : suit.hat || 'none';
  const face = FACE[fid] || FACE.smile, hat = HAT[hid] || HAT.none;
  const weapon = typeof l.w === 'string' && Object.hasOwn(WEAPON, l.w) ? WEAPON[l.w] : WEAPON[FREE_WEAPON];
  const hair = typeof l.r === 'string' && Object.hasOwn(HAIR, l.r) ? HAIR[l.r] : HAIR.none;
  return { suit, face, hat, hair, weapon, key: suit.id + '|' + face.id + '|' + hat.id + '|' + hair.id + '|' + weapon.id };
}
// A plain stickman in one colour (the extra climbers on the title screen).
const PLAINS = new Map();
export function plainLook(c) {
  if (!PLAINS.has(c)) PLAINS.set(c, { suit: { id: 'plain' + c, c }, face: FACE.smile, hat: HAT.none, hair: HAIR.none, key: 'plain' + c });
  return PLAINS.get(c);
}
const known = (table, id) => typeof id === 'string' && Object.hasOwn(table, id);
// What marks a thing as yours. Some faces and hats are named like a suit ('santa' is both), and owning one is not owning
// the other.
export const itemKey = (it) => ((it.kind === 'face' || it.kind === 'hat') && Object.hasOwn(SUIT, it.id) ? it.kind + ':' + it.id : it.id);
export const cleanLook = (l) => (l && typeof l === 'object' ? { s: known(SUIT, l.s) ? l.s : FREE_SUIT, f: known(FACE, l.f) ? l.f : 'smile', h: known(HAT, l.h) ? l.h : 'none', r: known(HAIR, l.r) ? l.r : 'none', w: known(WEAPON, l.w) ? l.w : FREE_WEAPON } : null);
// The flags someone can have. A name means nothing: only the server says who has which (server/lib/rooms.js).
export const ROLE_TAGS = { owner: 'OWNER', admin: 'ADMIN', mod: 'MOD' };
// Roles can be made on the server (Friend, VIP, Family, or anything): it says each one's tag and colour (live.js).
const ROLE_KEY = /^[a-z][a-z0-9_]{1,15}$/;
const BUILT_IN = { owner: '#ff3b5c', admin: '#e8690c', mod: '#2f7bff' };
let roleTable = {};
export function setRoleTable(t) {
  const out = {};
  if (t && typeof t === 'object') {
    for (const [k, v] of Object.entries(t)) {
      if (!ROLE_KEY.test(k) || !v || typeof v !== 'object') continue;
      const tag = String(v.tag || k).replace(/[^\p{L}\p{N} _.!?&+#*]/gu, '').trim().toUpperCase().slice(0, 12);
      out[k] = { tag: tag || k.toUpperCase(), color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#6a7a99' };
    }
  }
  roleTable = out;
}
export const cleanRole = (r) => (typeof r === 'string' && ROLE_KEY.test(r) ? r : '');
export const roleKeys = () => (Object.keys(roleTable).length ? Object.keys(roleTable) : Object.keys(ROLE_TAGS));
// What a flag says and its colour, or null for none.
export function roleInfo(r) {
  const k = cleanRole(r);
  if (!k) return null;
  return roleTable[k] || (ROLE_TAGS[k] ? { tag: ROLE_TAGS[k], color: BUILT_IN[k] } : { tag: k.toUpperCase().slice(0, 12), color: '#6a7a99' });
}
