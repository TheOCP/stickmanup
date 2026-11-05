// Graffiti: what you can spray on the towers. Sorted by rarity, and found like everything else that is rare: the common and
// rare ones are simply for sale, every epic and legendary one waits in a hidden spot of its own on its map (map, see relics.js
// and level.js hideSpots). Only the catalog is here, and the finish every piece gets. The drawings are in sprayart.js.
import { ART } from './sprayart.js';

const S = (id, name, r, price, burst, edge, map) => ({ id: 's_' + id, art: id, name, r, price, kind: 'spray', tab: 'sprays', burst, edge, map });
const WHITE = '#fff8ee';

export const SPRAYS = [
  // Common
  // Everyone has these three.
  S('smiley', 'Big Grin', 0, 0, '#7a3cff', WHITE),
  S('heart', 'Spray Heart', 0, 0, '#ffd23c', WHITE),
  S('star', 'Lucky Star', 0, 0, '#2a6bff', WHITE),
  S('bolt', 'Lightning', 0, 150, '#ff3c8a', WHITE),
  S('flame', 'Hot Flame', 0, 180, '#3a1a6a', WHITE),
  S('peace', 'Peace', 0, 180, '#ff8a3c', WHITE),
  S('paw', 'Paw Print', 0, 180, '#3ce0c0', WHITE),
  S('mushroom', 'Red Cap', 0, 200, '#3a9a4a', WHITE),
  S('cherries', 'Cherries', 0, 200, '#ffd8e8', WHITE),
  S('donut', 'Donut', 0, 200, '#4ac8ff', WHITE),
  S('icecream', 'Triple Scoop', 0, 220, '#ff78b8', WHITE),
  S('cactus', 'Happy Cactus', 0, 220, '#ffc23c', WHITE),
  S('rainbow', 'Rainbow', 0, 220, '#2a4aa0', WHITE),
  S('cloud', 'Angry Cloud', 0, 250, '#ffd23c', WHITE),
  S('coin', 'Lucky Coin', 0, 250, '#c0306a', WHITE),
  S('eye', 'All Seeing', 0, 250, '#ff4a4a', WHITE),
  S('notes', 'Music Notes', 0, 250, '#ffe24a', WHITE),
  S('arrows', 'Up Up Up', 0, 250, '#14c8a0', WHITE),
  // Rare
  S('blackcat', 'Cute Black Cat', 1, 600, '#b050ff', WHITE),
  S('sleepcat', 'Sleepy Kitten', 1, 500, '#4a78e0', WHITE),
  S('panda', 'Panda', 1, 500, '#44d078', WHITE),
  S('bunny', 'Bunny', 1, 500, '#ff90c8', WHITE),
  S('ghost', 'Little Ghost', 1, 500, '#5a30c0', WHITE),
  S('pumpkin', 'Jack', 1, 550, '#3a1a6a', '#ffc23c'),
  S('alien', 'Alien', 1, 550, '#d040ff', '#c8ff5a'),
  S('ufo', 'UFO', 1, 600, '#1a2a78', '#8affe0'),
  S('rocket', 'Rocket', 1, 600, '#1a2a78', WHITE),
  S('planet', 'Ringed Planet', 1, 650, '#101a50', '#ffd88a'),
  S('shuriken', 'Ninja Star', 1, 650, '#d0203c', WHITE),
  S('sword', 'Flame Sword', 1, 700, '#3a1040', '#ffc23c'),
  S('crown', 'Crown', 1, 700, '#6a1ac8', '#ffe88a'),
  S('diamond', 'Diamond', 1, 750, '#ff3ca0', WHITE),
  S('fireheart', 'Burning Heart', 1, 750, '#3a1040', '#ffc23c'),
  S('skullrose', 'Skull and Rose', 1, 800, '#a01030', WHITE),
  S('octopus', 'Octopus', 1, 800, '#14a0c8', WHITE),
  S('frog', 'Frog Prince', 1, 800, '#ffc23c', WHITE),
  // Epic: each in a hidden spot on its map
  S('cyberskull', 'Cyber Skull', 2, 1500, '#0a2a4a', '#3ff0d0', 'storm'),
  S('thunderfist', 'Thunder Fist', 2, 1600, '#1a1a6a', '#ffe24a', 'storm'),
  S('shark', 'Surf Shark', 2, 1500, '#ffb03c', WHITE, 'sunny'),
  S('pirate', 'Pirate Skull', 2, 1600, '#a01030', '#ffd23c', 'sunny'),
  S('owl', 'Wise Owl', 2, 1500, '#1a4a30', '#c8ff5a', 'forest'),
  S('mushking', 'Mushroom King', 2, 1600, '#5a30a0', '#ffe88a', 'forest'),
  S('demon', 'Demon', 2, 1500, '#2a0810', '#ff6a2a', 'volcano'),
  S('golem', 'Lava Golem', 2, 1600, '#2a0810', '#ffb03c', 'volcano'),
  S('boombox', 'Boombox', 2, 1500, '#ff2a9a', '#40e8ff', 'city'),
  S('neonkitty', 'Neon Kitty', 2, 1600, '#1a0a40', '#ff4fd8', 'city'),
  S('frostfox', 'Frost Fox', 2, 1500, '#0a3a6a', '#bff0ff', 'waterfall'),
  S('jelly', 'Jellyfish', 2, 1600, '#0a1a5a', '#ff9ae8', 'waterfall'),
  // Legendary: each at the end of a long hidden course on its map
  S('thunderdragon', 'Thunder Dragon', 3, 4000, '#0a1a4a', '#ffe24a', 'storm'),
  S('thunderbird', 'Thunderbird', 3, 4000, '#1a1050', '#6ad8ff', 'storm'),
  S('phoenix', 'Golden Phoenix', 3, 4000, '#6a0a2a', '#ffe88a', 'sunny'),
  S('kraken', 'Kraken', 3, 4000, '#0a3a5a', '#ffd23c', 'sunny'),
  S('spirit', 'Forest Spirit', 3, 4000, '#0a3020', '#a0ffb0', 'forest'),
  S('emerald', 'Emerald Dragon', 3, 4000, '#2a1050', '#c8ff5a', 'forest'),
  S('firedragon', 'Fire Dragon', 3, 4000, '#2a0408', '#ffb03c', 'volcano'),
  S('hellskull', 'Flaming Skull', 3, 4000, '#2a0408', '#ff7a2a', 'volcano'),
  S('oni', 'Oni Mask', 3, 4000, '#180820', '#ff3c5a', 'city'),
  S('tiger', 'Neon Tiger', 3, 4000, '#180830', '#ff4fd8', 'city'),
  S('koi', 'Koi Dragon', 3, 4000, '#0a2a5a', '#ffd8a0', 'waterfall'),
  S('wolf', 'Ice Wolf', 3, 4000, '#0a2050', '#bff0ff', 'waterfall'),
];
export const SPRAY = Object.fromEntries(SPRAYS.map((s) => [s.id, s]));

// ---------------------------------------------------------------- the finish
const TAU = Math.PI * 2;
// The same specks and drips for a piece on every phone, so it looks like the one everybody knows.
function dice(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 13), 1274126177) + 0x6d2b79f5 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
}
const canvas = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };

// A burst of paint behind the piece: one soft cloud, then what flew off it.
function burst(g, n, color, R) {
  const m = n / 2;
  g.fillStyle = color;
  g.save();
  g.shadowColor = color; g.shadowBlur = n * 0.05;
  g.beginPath();
  const k = 15, r0 = n * 0.37;
  for (let i = 0; i <= k; i++) {
    const a = (i / k) * TAU, r = r0 * (0.88 + R() * 0.2), x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else { const b = ((i - 0.5) / k) * TAU, q = r0 * (0.9 + R() * 0.28); g.quadraticCurveTo(m + Math.cos(b) * q, m + Math.sin(b) * q, x, y); }
  }
  g.closePath();
  g.fill();
  g.restore();
  for (let i = 0; i < 26; i++) {
    const a = R() * TAU, r = r0 * (1.02 + R() * 0.3), s = n * (0.004 + R() * R() * 0.028);
    g.beginPath(); g.arc(m + Math.cos(a) * r, m + Math.sin(a) * r, s, 0, TAU); g.fill();
  }
  for (let i = 0; i < 300; i++) {
    const a = R() * TAU, r = r0 * (0.9 + R() * 0.46), s = n * (0.0015 + R() * 0.0035);
    g.globalAlpha = 0.25 + R() * 0.6;
    g.beginPath(); g.arc(m + Math.cos(a) * r, m + Math.sin(a) * r, s, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
}

// Paint running down from the piece's lowest edges.
function drips(g, n, art, color, R, count) {
  const a = art.getContext('2d').getImageData(0, 0, n, n).data;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(n * (0.2 + R() * 0.6));
    let y = n - 1;
    while (y > 0 && a[(y * n + x) * 4 + 3] < 200) y--;
    if (y < n * 0.25) continue;
    const w = n * (0.009 + R() * 0.012), len = Math.min(n * (0.05 + R() * R() * 0.15), n - y - w * 2 - 2);
    if (len < n * 0.02) continue;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - w * 1.8, y - w);
    g.quadraticCurveTo(x - w, y + w, x - w * 0.8, y + len * 0.5);
    g.lineTo(x - w * 0.8, y + len);
    g.arc(x, y + len, w * 1.15, Math.PI, 0, true);
    g.lineTo(x + w * 0.8, y + len * 0.5);
    g.quadraticCurveTo(x + w, y + w, x + w * 1.8, y - w);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.beginPath(); g.ellipse(x - w * 0.3, y + len, w * 0.26, w * 0.45, 0, 0, TAU); g.fill();
  }
}

const painted = new Map(), urls = new Map();
// The same as a picture to put in a page.
export function sprayUrl(item, n = 96) {
  const key = item.id + '/' + n;
  if (!urls.has(key)) urls.set(key, paintSpray(item, n).toDataURL('image/png'));
  return urls.get(key);
}
// The finished piece on a canvas of its own, n pixels wide. Rarer ones are finished better.
export function paintSpray(item, n = 256) {
  const key = item.id + '/' + n;
  if (painted.has(key)) return painted.get(key);
  const R = dice(item.id), art = canvas(n), a = art.getContext('2d');
  a.lineJoin = a.lineCap = 'round';
  // A margin all round, for the edge and the line outside it.
  a.translate(n * 0.06, n * 0.06);
  a.scale((n * 0.88) / 100, (n * 0.88) / 100);
  ART[item.art](new Can(a));
  // The shape of the piece in the colour of its edge.
  const edge = canvas(n), e = edge.getContext('2d');
  e.drawImage(art, 0, 0);
  e.globalCompositeOperation = 'source-in';
  e.fillStyle = item.edge;
  e.fillRect(0, 0, n, n);

  const out = canvas(n), g = out.getContext('2d');
  burst(g, n, item.burst, R);
  if (item.r >= 2) {
    // Neon round the epic and legendary ones.
    g.save();
    g.shadowColor = item.edge; g.shadowBlur = n * (item.r === 3 ? 0.075 : 0.045);
    for (let i = 0; i < (item.r === 3 ? 3 : 2); i++) g.drawImage(edge, 0, 0);
    g.restore();
  }
  const r1 = n * 0.016;
  for (let i = 0; i < 18; i++) { const t = (i / 18) * TAU; g.drawImage(edge, Math.cos(t) * r1, Math.sin(t) * r1); }
  // A dark line outside the edge, so it stands out on anything.
  const line = canvas(n), l = line.getContext('2d'), r2 = n * 0.026;
  for (let i = 0; i < 20; i++) { const t = (i / 20) * TAU; l.drawImage(edge, Math.cos(t) * r2, Math.sin(t) * r2); }
  l.globalCompositeOperation = 'source-in';
  l.fillStyle = 'rgba(12,8,20,.85)';
  l.fillRect(0, 0, n, n);
  const under = canvas(n), u = under.getContext('2d');
  u.drawImage(line, 0, 0);
  u.drawImage(out, 0, 0);
  g.clearRect(0, 0, n, n);
  g.drawImage(under, 0, 0);
  drips(g, n, edge, item.edge, R, 2 + item.r);
  g.drawImage(art, 0, 0);
  drips(g, n, art, item.burst, R, 1 + item.r);
  // Sparks on the legendary ones.
  if (item.r === 3) {
    for (let i = 0; i < 9; i++) {
      const t = R() * TAU, r = n * (0.3 + R() * 0.17), x = n / 2 + Math.cos(t) * r, y = n / 2 + Math.sin(t) * r, s = n * (0.012 + R() * 0.022);
      g.fillStyle = item.edge;
      g.beginPath();
      for (let k = 0; k < 8; k++) { const q = (k / 8) * TAU, d = k % 2 ? s * 0.22 : s; g.lineTo(x + Math.cos(q) * d, y + Math.sin(q) * d); }
      g.closePath(); g.fill();
    }
  }
  // Sprayed, not printed: a little of the wall shows through.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n * 1.6; i++) {
    g.globalAlpha = 0.1 + R() * 0.25;
    g.beginPath(); g.arc(R() * n, R() * n, n * (0.001 + R() * 0.0028), 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  painted.set(key, out);
  return out;
}

// What the drawings are made with: a 100 by 100 box, thick lines, round ends.
const INK = '#15111d';
export class Can {
  constructor(g) { this.g = g; }
  // A colour, or a list of colours from top to bottom of the box (or of o.y).
  fill(f, o) {
    if (!Array.isArray(f)) return f;
    const [y0, y1] = (o && o.y) || [0, 100], gr = this.g.createLinearGradient(0, y0, 0, y1);
    f.forEach((c, i) => gr.addColorStop(i / (f.length - 1), c));
    return gr;
  }
  shape(P, f, o = {}) {
    const g = this.g;
    if (o.a !== undefined) g.globalAlpha = o.a;
    if (f) { g.fillStyle = this.fill(f, o); g.fill(P, o.rule || 'nonzero'); }
    if (o.ink !== false) { g.strokeStyle = o.ink || INK; g.lineWidth = o.lw || 2; g.stroke(P); }
    g.globalAlpha = 1;
  }
  p(d, f, o) { this.shape(new Path2D(d), f, o); }
  e(x, y, rx, ry, rot, f, o) { const P = new Path2D(); P.ellipse(x, y, rx, ry, rot, 0, TAU); this.shape(P, f, o); }
  o(x, y, r, f, o) { this.e(x, y, r, r, 0, f, o); }
  // A line with nothing to fill. Under it, if asked, a thicker dark one.
  l(d, color, lw = 2, ink = 0) {
    const g = this.g, P = new Path2D(d);
    if (ink) { g.strokeStyle = INK; g.lineWidth = lw + ink; g.stroke(P); }
    g.strokeStyle = color; g.lineWidth = lw; g.stroke(P);
  }
  // A shine: white with no line round it.
  hi(x, y, rx, ry = rx, rot = 0, a = 0.75) { this.e(x, y, rx, ry, rot, '#ffffff', { ink: false, a }); }
  // A big cute eye: dark with two lights.
  eye(x, y, r, color = '#1a1020') {
    this.o(x, y, r, color, { lw: 1.2 });
    this.hi(x - r * 0.32, y - r * 0.36, r * 0.36, r * 0.36, 0, 0.95);
    this.hi(x + r * 0.34, y + r * 0.3, r * 0.17, r * 0.17, 0, 0.85);
  }
  star(x, y, r, q = 0.45, n = 5, rot = -Math.PI / 2) {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = rot + (i / (n * 2)) * TAU, v = i % 2 ? r * q : r;
      d += (i ? 'L' : 'M') + (x + Math.cos(a) * v).toFixed(2) + ' ' + (y + Math.sin(a) * v).toFixed(2);
    }
    return d + 'Z';
  }
  // A flame standing on (x, y): w wide and h high, its point leaning by lean.
  flame(x, y, w, h, lean = 0) {
    return `M${x} ${y}C${x - w * 0.55} ${y} ${x - w * 0.62} ${y - h * 0.38} ${x - w * 0.34} ${y - h * 0.56}C${x - w * 0.3} ${y - h * 0.44} ${x - w * 0.2} ${y - h * 0.4} ${x - w * 0.13} ${y - h * 0.44}C${x - w * 0.22} ${y - h * 0.66} ${x + lean * 0.3} ${y - h * 0.84} ${x + lean} ${y - h}C${x + lean * 0.6 + w * 0.06} ${y - h * 0.78} ${x + w * 0.38} ${y - h * 0.62} ${x + w * 0.46} ${y - h * 0.38}C${x + w * 0.56} ${y - h * 0.2} ${x + w * 0.36} ${y} ${x} ${y}Z`;
  }
  // Fire in three colours.
  fire(x, y, w, h, lean = 0) {
    this.p(this.flame(x, y, w, h, lean), ['#ffc23c', '#ff6a1a', '#e01a1a'], { y: [y - h, y] });
    this.p(this.flame(x, y - h * 0.04, w * 0.62, h * 0.68, lean * 0.6), ['#fff0a0', '#ffb01a'], { y: [y - h * 0.7, y], ink: false });
    this.p(this.flame(x, y - h * 0.05, w * 0.3, h * 0.36, lean * 0.3), ['#ffffff', '#ffe88a'], { y: [y - h * 0.4, y], ink: false });
  }
}
