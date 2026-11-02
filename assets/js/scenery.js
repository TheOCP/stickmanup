// Scenery: platform shapes and surfaces that differ per map and zone, floating islands with trees and plants
// that suit each zone, small plants on the ledges, animals animated on the GPU (birds, butterflies and
// critters), and better waterfalls with spray. Everything here is drawn with few draw calls: plants and props
// are instanced and coloured from one small palette texture; animals are whole flocks in one mesh each.
import * as THREE from 'three';
import { TAU, rng } from './util.js';
import { CORE_R } from './level.js';
import { panelMat, HDR, mat4, canvasTex } from './worldview.js';

// Detail level from the graphics preset: 0 low (fewer islands and birds; no butterflies, critters, spray or
// ledge plants), 1 high, 2 ultra (more birds and butterflies).
let DETAIL = 1;
export function setDetail(d) { DETAIL = d; }

// ---------------------------------------------------------------- palette
// Each colour gets a 16 px swatch in a 256 px texture; model parts point their uvs at their swatch.
const PAL = [];
const palCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let palTex = null, palDirty = true;
function swatch(hex) {
  let i = PAL.indexOf(hex);
  if (i < 0) { i = PAL.length; PAL.push(hex); palDirty = true; }
  return [((i % 16) + 0.5) / 16, 1 - (Math.floor(i / 16) + 0.5) / 16];
}
function paletteTex() {
  if (!palTex) {
    palCanvas.width = palCanvas.height = 256;
    palTex = new THREE.CanvasTexture(palCanvas);
    palTex.colorSpace = THREE.SRGBColorSpace;
  }
  if (palDirty) {
    const g = palCanvas.getContext('2d');
    PAL.forEach((hex, i) => { g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.fillRect((i % 16) * 16, Math.floor(i / 16) * 16, 16, 16); });
    palTex.needsUpdate = true;
    palDirty = false;
  }
  return palTex;
}

// Merge parts { geo, m (Matrix4), c (hex), glow (hex or 0) } into one geometry with palette uvs.
function build(parts) {
  const pos = [], nor = [], uvs = [], glo = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const a = g.attributes.position.array, n = g.attributes.normal.array, [u, v] = swatch(p.c);
    const gl = p.glow ? HDR(p.glow, p.gk || 1) : null;
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      uvs.push(u, v);
      glo.push(gl ? gl.r : 0, gl ? gl.g : 0, gl ? gl.b : 0);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glo, 3));
  return g;
}
const P = (geo, m, c, glow, gk) => ({ geo, m, c, glow, gk });
// Scale defaults to 1. (mat4 is looked up late: worldview.js and this file import each other.)
const M = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => mat4(x, y, z, sx, sy, sz, rx, ry, rz);
const cyl = (r1, r2, h, s = 8) => new THREE.CylinderGeometry(r1, r2, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// ---------------------------------------------------------------- plants and props (about 1 unit = 1 m)
const MODELS = {
  pine: () => [P(cyl(0.12, 0.2, 1.4), M(0, 0.7, 0), 0x5a3e28), P(cone(1.0, 1.7, 9), M(0, 1.7, 0), 0x24603a), P(cone(0.8, 1.5, 9), M(0, 2.4, 0, 1, 1, 1, 0, 0.4), 0x2c6e40), P(cone(0.55, 1.2, 9), M(0, 3.1, 0, 1, 1, 1, 0, 0.8), 0x347a46)],
  frostpine: () => [P(cyl(0.12, 0.2, 1.4), M(0, 0.7, 0), 0x4a3a30), P(cone(1.0, 1.7, 9), M(0, 1.7, 0), 0xd8eef6), P(cone(0.8, 1.5, 9), M(0, 2.4, 0, 1, 1, 1, 0, 0.4), 0x5a8a8a), P(cone(0.55, 1.2, 9), M(0, 3.1, 0, 1, 1, 1, 0, 0.8), 0xeaf6fa)],
  oak: () => [P(cyl(0.14, 0.24, 1.8), M(0, 0.9, 0), 0x5e4028), P(cyl(0.06, 0.08, 0.9), M(0.3, 1.5, 0, 1, 1, 1, 0, 0, -0.7), 0x5e4028),
    P(ico(0.95, 1), M(0, 2.35, 0), 0x3f8a36), P(ico(0.7, 1), M(0.62, 2.0, 0.25), 0x4a9a3e), P(ico(0.72, 1), M(-0.55, 2.1, -0.2), 0x36803a), P(ico(0.6, 1), M(0.1, 2.85, -0.35), 0x56a646)],
  birch: () => [P(cyl(0.09, 0.13, 2.6), M(0, 1.3, 0), 0xeeeae2), P(box(0.19, 0.06, 0.05), M(0, 0.8, 0.1), 0x2a2a2a), P(box(0.17, 0.05, 0.05), M(0, 1.6, -0.1), 0x2a2a2a),
    P(ico(0.7, 1), M(0, 2.7, 0, 1, 1.3, 1), 0x9ad05a), P(ico(0.5, 1), M(0.35, 2.3, 0.2), 0xb4dc6a)],
  blossom: () => [P(cyl(0.11, 0.2, 1.5), M(0, 0.75, 0), 0x4a3028), P(cyl(0.06, 0.08, 0.8), M(-0.3, 1.4, 0, 1, 1, 1, 0, 0, 0.7), 0x4a3028),
    P(ico(0.85, 1), M(0, 2.1, 0), 0xffa8d0), P(ico(0.62, 1), M(0.58, 1.85, 0.2), 0xff8ac0), P(ico(0.65, 1), M(-0.55, 1.95, -0.15), 0xffc0dc), P(ico(0.5, 1), M(0.1, 2.6, 0.3), 0xffd4e6)],
  palm: () => {
    const parts = [];
    for (let k = 0; k < 6; k++) parts.push(P(cyl(0.16 - k * 0.012, 0.18 - k * 0.012, 0.75), M(k * k * 0.035, 0.35 + k * 0.7, 0, 1, 1, 1, 0, 0, -k * 0.07), 0x9a7a52));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      parts.push(P(box(0.32, 0.04, 1.9).translate(0, 0, 0.95), M(1.25, 4.15, 0, 1, 1, 1, 0.38, a, 0), k % 2 ? 0x3e9a3a : 0x4fb048));
    }
    parts.push(P(ico(0.14, 0), M(1.2, 3.95, 0.12), 0x6a4a28), P(ico(0.14, 0), M(1.32, 3.95, -0.1), 0x6a4a28));
    return parts;
  },
  bamboo: () => {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const x = Math.cos(k * 2.4) * 0.28, z = Math.sin(k * 2.4) * 0.28, h = 2.6 + (k % 3) * 0.6;
      parts.push(P(cyl(0.05, 0.06, h), M(x, h / 2, z), 0x7aaa3a));
      for (let y = 0.5; y < h; y += 0.55) parts.push(P(cyl(0.065, 0.065, 0.05), M(x, y, z), 0x4a7a2a));
      parts.push(P(cone(0.22, 0.6, 5), M(x + 0.15, h - 0.2, z, 1, 1, 0.3, 0, 0, -1.1), 0x5aa83a), P(cone(0.2, 0.5, 5), M(x - 0.12, h - 0.45, z, 1, 1, 0.3, 0, 0, 1.0), 0x6ab84a));
    }
    return parts;
  },
  dead: () => [P(cyl(0.1, 0.22, 2.4), M(0, 1.2, 0), 0x4a403a), P(cyl(0.04, 0.07, 1.1), M(0.35, 1.8, 0, 1, 1, 1, 0, 0, -0.9), 0x4a403a),
    P(cyl(0.035, 0.06, 0.9), M(-0.3, 2.1, 0.1, 1, 1, 1, 0.2, 0, 0.8), 0x4a403a), P(cyl(0.03, 0.05, 0.8), M(0.05, 2.5, -0.3, 1, 1, 1, -0.8, 0, 0), 0x4a403a), P(cyl(0.025, 0.04, 0.6), M(0.6, 2.25, 0.05, 1, 1, 1, 0, 0, -0.3), 0x4a403a)],
  shroom: () => [P(cyl(0.16, 0.24, 1.6), M(0, 0.8, 0), 0xf0e6d0), P(new THREE.SphereGeometry(0.95, 14, 7, 0, TAU, 0, Math.PI / 2), M(0, 1.5, 0, 1, 0.6, 1), 0xd8302a),
    P(cyl(0.9, 0.9, 0.05, 14), M(0, 1.5, 0), 0xf6e0c8), ...[0, 1, 2, 3, 4].map((k) => P(ico(0.12, 0), M(Math.cos(k * 1.3) * 0.55, 1.88 + (k % 2) * 0.06, Math.sin(k * 1.3) * 0.55), 0xffffff))],
  glowshroom: () => [P(cyl(0.12, 0.18, 1.2), M(0, 0.6, 0), 0xe8f0e0), P(new THREE.SphereGeometry(0.7, 12, 6, 0, TAU, 0, Math.PI / 2), M(0, 1.15, 0, 1, 0.55, 1), 0x3fd8c0, 0x3fe0c8, 0.9),
    P(cyl(0.66, 0.66, 0.04, 12), M(0, 1.15, 0), 0x9af0e0, 0x9af0e0, 0.6)],
  glowtree: () => [P(cyl(0.12, 0.2, 1.6), M(0, 0.8, 0), 0x3a2e28), P(ico(0.85, 1), M(0, 2.15, 0), 0x2a8a7a, 0x3fe0c8, 0.5), P(ico(0.6, 1), M(0.55, 1.85, 0.2), 0x2a7a6a, 0x3fe0c8, 0.45), P(ico(0.6, 1), M(-0.5, 1.95, -0.2), 0x2a8a7a, 0x5ff0d8, 0.5)],
  crystal: () => [0, 1, 2, 3, 4].map((k) => P(new THREE.OctahedronGeometry(0.3, 0), M(Math.cos(k * 1.9) * 0.3 * (k > 0), 0.55 + (k === 0) * 0.3, Math.sin(k * 1.9) * 0.3 * (k > 0), 0.8, 2.6 - (k > 0) * 1.0, 0.8, Math.cos(k) * 0.3 * (k > 0), 0, Math.sin(k) * 0.35 * (k > 0)), 0x9ae8ff, 0x7fd8ff, 0.8)),
  obsidian: () => [0, 1, 2, 3].map((k) => P(new THREE.OctahedronGeometry(0.3, 0), M(Math.cos(k * 1.9) * 0.28 * (k > 0), 0.5 + (k === 0) * 0.3, Math.sin(k * 1.9) * 0.28 * (k > 0), 0.8, 2.4 - (k > 0) * 0.9, 0.8, Math.cos(k) * 0.3 * (k > 0), 0, Math.sin(k) * 0.35 * (k > 0)), 0x3a2448, 0xb06bff, 0.5)),
  bush: () => [P(ico(0.5, 1), M(0, 0.35, 0), 0x3f8a36), P(ico(0.4, 1), M(0.4, 0.3, 0.15), 0x4a9a3e), P(ico(0.38, 1), M(-0.35, 0.3, -0.1), 0x36803a), P(ico(0.32, 1), M(0.05, 0.62, -0.2), 0x56a646)],
  flowers: () => {
    const parts = [], cols = [0xff5a8a, 0xffe066, 0xffffff, 0xb48cff, 0xff8a3d];
    for (let k = 0; k < 7; k++) {
      const x = Math.cos(k * 2.3) * 0.32 * (k % 3) / 2, z = Math.sin(k * 2.3) * 0.32 * (k % 3) / 2, h = 0.35 + (k % 3) * 0.12;
      parts.push(P(cyl(0.015, 0.015, h, 4), M(x, h / 2, z), 0x4a9a3a), P(ico(0.08, 0), M(x, h, z), cols[k % 5]));
    }
    parts.push(P(ico(0.22, 0), M(0, 0.08, 0, 1.4, 0.5, 1.4), 0x4a9a3e));
    return parts;
  },
  fern: () => [0, 1, 2, 3, 4, 5, 6].map((k) => P(cone(0.12, 0.9, 4), M(Math.cos(k * 0.9) * 0.2, 0.38, Math.sin(k * 0.9) * 0.2, 1, 1, 0.35, Math.sin(k * 0.9) * 0.7, 0, -Math.cos(k * 0.9) * 0.7), k % 2 ? 0x3e8a3a : 0x52a046)),
  grass: () => [0, 1, 2, 3, 4, 5].map((k) => P(cone(0.04, 0.5, 3), M(Math.cos(k * 1.1) * 0.12, 0.24, Math.sin(k * 1.1) * 0.12, 1, 1, 1, Math.sin(k) * 0.25, 0, Math.cos(k) * 0.25), k % 2 ? 0x6ab84a : 0x5aa83a)),
  cactus: () => [P(cyl(0.22, 0.25, 2.2, 10), M(0, 1.1, 0), 0x4a9a4a), P(ico(0.22, 1), M(0, 2.2, 0), 0x4a9a4a), P(cyl(0.12, 0.12, 0.5, 8), M(0.32, 1.2, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0x4a9a4a),
    P(cyl(0.12, 0.12, 0.7, 8), M(0.55, 1.5, 0), 0x4a9a4a), P(cyl(0.11, 0.11, 0.5, 8), M(-0.3, 1.5, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0x4a9a4a), P(cyl(0.11, 0.11, 0.6, 8), M(-0.5, 1.75, 0), 0x4a9a4a), P(ico(0.1, 0), M(0, 2.4, 0), 0xff5a8a)],
  coral: () => {
    const parts = [], cols = [0xff7a6a, 0xff9ad8, 0xffb43d];
    for (let k = 0; k < 7; k++) { const a = k * 0.9, l = 0.6 + (k % 3) * 0.3; parts.push(P(cyl(0.05, 0.09, l, 6), M(Math.cos(a) * 0.15, l / 2, Math.sin(a) * 0.15, 1, 1, 1, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), cols[k % 3]), P(ico(0.08, 0), M(Math.cos(a) * (0.15 + l * 0.45), l * 0.9, Math.sin(a) * (0.15 + l * 0.45)), cols[(k + 1) % 3])); }
    return parts;
  },
  reeds: () => [0, 1, 2, 3, 4, 5].map((k) => [P(cyl(0.02, 0.025, 1.4 + (k % 3) * 0.3, 4), M(Math.cos(k * 1.7) * 0.2, 0.7 + (k % 3) * 0.15, Math.sin(k * 1.7) * 0.2), 0x6a9a3a), P(cyl(0.05, 0.05, 0.25, 6), M(Math.cos(k * 1.7) * 0.2, 1.45 + (k % 3) * 0.3, Math.sin(k * 1.7) * 0.2), 0x6a4a2a)]).flat(),
  antenna: () => [P(cyl(0.05, 0.08, 3.2, 6), M(0, 1.6, 0), 0x8a8e96), P(box(0.9, 0.04, 0.04), M(0, 2.4, 0), 0x8a8e96), P(box(0.6, 0.04, 0.04), M(0, 2.9, 0), 0x8a8e96),
    P(cone(0.32, 0.18, 12), M(0.3, 1.6, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0xd8dce4), P(ico(0.07, 0), M(0, 3.25, 0), 0xff3030, 0xff3030, 2.5)],
  acunit: () => [P(box(0.9, 0.6, 0.7), M(0, 0.3, 0), 0xb8bcc4), P(cyl(0.24, 0.24, 0.04, 12), M(0, 0.62, 0), 0x3a3e46), P(box(0.92, 0.05, 0.05), M(0, 0.45, 0.36), 0x6a6e76)],
  tank: () => [P(cyl(0.6, 0.6, 1.2, 12), M(0, 1.8, 0), 0x8a6a4a), P(cone(0.68, 0.5, 12), M(0, 2.65, 0), 0x5a4a3a), ...[0, 1, 2, 3].map((k) => P(cyl(0.04, 0.04, 1.2, 4), M(Math.cos(k * 1.57 + 0.78) * 0.45, 0.6, Math.sin(k * 1.57 + 0.78) * 0.45), 0x4a4a4a))],
  lamp: () => [P(cyl(0.04, 0.07, 2.4, 6), M(0, 1.2, 0), 0x3a3e46), P(box(0.5, 0.04, 0.04), M(0.22, 2.35, 0), 0x3a3e46), P(cone(0.14, 0.16, 8), M(0.45, 2.25, 0), 0x3a3e46), P(ico(0.08, 0), M(0.45, 2.15, 0), 0xffd890, 0xffc87a, 3.0)],
  debris: () => [P(box(1.2, 0.08, 0.7), M(0, 0.3, 0, 1, 1, 1, 0.3, 0.4, 0.2), 0x5a6070), P(box(0.8, 0.06, 0.5), M(0.3, 0.5, -0.2, 1, 1, 1, -0.5, 1.2, 0.4), 0x6a7080),
    P(cyl(0.08, 0.08, 1.4, 8), M(-0.3, 0.4, 0.2, 1, 1, 1, 0.2, 0, 1.2), 0x4a5060), P(ico(0.06, 0), M(0.2, 0.62, 0.1), 0x3ff0d0, 0x3ff0d0, 2.0)],
  hut: () => [P(box(1.4, 1.0, 1.2), M(0, 0.5, 0), 0xd8b880), P(cone(1.15, 0.8, 4), M(0, 1.4, 0, 1, 1, 1, 0, Math.PI / 4), 0xc8a050), P(box(0.36, 0.6, 0.04), M(0, 0.3, 0.61), 0x6a4a2a)],
  ember: () => [P(new THREE.DodecahedronGeometry(0.4, 0), M(0, 0.25, 0, 1.2, 0.7, 1), 0x2a2220, 0xff5a1a, 0.35), P(new THREE.DodecahedronGeometry(0.25, 0), M(0.4, 0.15, 0.2), 0x2a2220, 0xff7a2a, 0.5)],
  umbrella: () => [P(cyl(0.03, 0.03, 2.0, 6), M(0, 1.0, 0, 1, 1, 1, 0.08, 0, 0), 0xeeeeee), P(cone(1.0, 0.45, 10), M(0, 2.05, 0.08), 0xff5a4a), P(cone(1.02, 0.12, 10), M(0, 1.84, 0.08), 0xffffff)],
  rocks: () => [P(new THREE.DodecahedronGeometry(0.35, 0), M(0, 0.2, 0, 1, 0.7, 1), 0x8a8478), P(new THREE.DodecahedronGeometry(0.25, 0), M(0.35, 0.12, 0.15), 0x7a746a), P(new THREE.DodecahedronGeometry(0.2, 0), M(-0.25, 0.1, -0.2), 0x9a9488)],
  planter: () => [P(box(1.0, 0.4, 0.5), M(0, 0.2, 0), 0x6a6e76), P(ico(0.32, 1), M(-0.25, 0.55, 0), 0x3f8a36), P(ico(0.3, 1), M(0.22, 0.52, 0.05), 0x4a9a3e), P(ico(0.08, 0), M(0.05, 0.7, 0.15), 0xff5a8a)],
};

// ---------------------------------------------------------------- platform shapes
// Unit shapes: x and z from -0.5 to 0.5 (scaled to the collider), the walkable top at y = 0.5, the collider
// body down to -0.5; some hang lower below it.
function squircle(n, k = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a), r = 0.5 / Math.pow(Math.pow(Math.abs(c), k) + Math.pow(Math.abs(s), k), 1 / k);
    pts.push([c * r, s * r]);
  }
  return pts;
}
function ringsGeo(rings, n, seed) {
  // rings: [y, scale, jitter]; a flat top cap and a point at the bottom.
  const R = rng(seed), base = squircle(n), pos = [];
  const ring = rings.map(([y, k, j]) => base.map(([x, z]) => { const q = 1 + (R() - 0.5) * j; return [x * k * q, y + (R() - 0.5) * j * 0.4 * (y < 0.4), z * k * q]; }));
  const tip = [(R() - 0.5) * 0.15, rings[rings.length - 1][0] - 0.6, (R() - 0.5) * 0.15];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) tri([0, 0.5, 0], ring[0][(i + 1) % n], ring[0][i]);
  for (let r = 0; r < ring.length - 1; r++) for (let i = 0; i < n; i++) {
    const a = ring[r][i], b = ring[r][(i + 1) % n], c = ring[r + 1][i], d = ring[r + 1][(i + 1) % n];
    tri(a, b, c); tri(b, d, c);
  }
  const last = ring[ring.length - 1];
  for (let i = 0; i < n; i++) tri(last[i], last[(i + 1) % n], tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function mergeGeos(list) {
  const pos = [], nor = [];
  for (const [geo, m] of list) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
const SHAPES = new Map();
export function shapeGeo(name) {
  if (SHAPES.has(name)) return SHAPES.get(name);
  let g;
  const v = +(name.match(/\d+$/) || [0])[0];
  if (name.startsWith('rock')) g = ringsGeo([[0.5, 1, 0], [0.15, 1.03, 0.12], [-0.5, 0.97, 0.18], [-1.3, 0.72, 0.3], [-2.1, 0.42, 0.35]], 16, 11 + v * 7);
  else if (name.startsWith('isle')) g = ringsGeo([[0.5, 1, 0], [0.2, 1.04, 0.1], [-0.4, 0.9, 0.22], [-1.0, 0.66, 0.3], [-1.7, 0.4, 0.35], [-2.3, 0.2, 0.3]], 18, 101 + v * 13);
  else if (name === 'chamfer') {
    const s = new THREE.Shape(), k = 0.38;
    s.moveTo(-0.5, -k); s.lineTo(-k, -0.5); s.lineTo(k, -0.5); s.lineTo(0.5, -k); s.lineTo(0.5, k); s.lineTo(k, 0.5); s.lineTo(-k, 0.5); s.lineTo(-0.5, k);
    g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.5, 0);
    g = mergeGeos([[g, new THREE.Matrix4()]]);
  } else if (name.startsWith('basalt')) {
    const R = rng(31 + v * 5), list = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const x = i * 0.21 + (j % 2 ? 0.105 : 0), z = j * 0.19;
      if (Math.abs(x) > 0.5 || Math.abs(z) > 0.5) continue;
      const bot = -0.5 - R() * 1.6, h = 0.5 - bot;
      list.push([new THREE.CylinderGeometry(0.122, 0.122, h, 6), new THREE.Matrix4().makeTranslation(x, 0.5 - h / 2, z)]);
    }
    g = mergeGeos(list);
  } else if (name === 'disc') g = mergeGeos([[new THREE.CylinderGeometry(0.6, 0.58, 1, 28), new THREE.Matrix4()]]);
  else if (name === 'lily') g = mergeGeos([[new THREE.CylinderGeometry(0.64, 0.62, 1, 26, 1, false, 0.17, TAU - 0.34), new THREE.Matrix4()]]);
  else if (name === 'cloud') {
    const list = [[new THREE.CylinderGeometry(0.58, 0.5, 0.4, 20), new THREE.Matrix4().makeTranslation(0, 0.3, 0)]];
    for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, r = 0.42; list.push([new THREE.SphereGeometry(0.22 + (k % 3) * 0.05, 7, 5), new THREE.Matrix4().makeTranslation(Math.cos(a) * r, 0.08 - (k % 2) * 0.15, Math.sin(a) * r)]); }
    list.push([new THREE.SphereGeometry(0.4, 8, 6), new THREE.Matrix4().makeTranslation(0, -0.35, 0)]);
    g = mergeGeos(list);
  } else if (name === 'planks') {
    const list = [];
    for (let k = 0; k < 5; k++) list.push([new THREE.BoxGeometry(0.188, 0.45, 1), new THREE.Matrix4().makeTranslation(-0.4 + k * 0.2, 0.275, 0)]);
    for (const x of [-0.32, 0.32]) list.push([new THREE.BoxGeometry(0.1, 1.2, 0.9), new THREE.Matrix4().makeTranslation(x, -0.55, 0)]);
    g = mergeGeos(list);
  } else if (name === 'raft') {
    const list = [];
    for (let k = 0; k < 7; k++) list.push([new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateZ(Math.PI / 2).scale(1, 0.9, 1 / 7), new THREE.Matrix4().makeTranslation(0, 0.05, -0.43 + k * (0.86 / 6))]);
    for (const x of [-0.35, 0.35]) list.push([new THREE.BoxGeometry(0.06, 0.3, 1.04), new THREE.Matrix4().makeTranslation(x, -0.45, 0)]);
    g = mergeGeos(list);
  } else if (name === 'mushcap') g = mergeGeos([[new THREE.CylinderGeometry(0.62, 0.66, 0.7, 22), new THREE.Matrix4().makeTranslation(0, 0.15, 0)],
    [new THREE.SphereGeometry(0.66, 22, 6, 0, TAU, Math.PI / 2, Math.PI / 2).scale(1, 0.55, 1), new THREE.Matrix4().makeTranslation(0, -0.2, 0)]]);
  else if (name === 'stem') g = mergeGeos([[new THREE.CylinderGeometry(0.14, 0.2, 3.4, 12), new THREE.Matrix4().makeTranslation(0, -1.9, 0)]]);
  else if (name === 'vine') g = mergeGeos([[new THREE.CylinderGeometry(0.04, 0.03, 3.2, 6), new THREE.Matrix4().makeTranslation(0.1, -1.9, 0.05)], [new THREE.CylinderGeometry(0.03, 0.02, 2.4, 6), new THREE.Matrix4().makeTranslation(-0.25, -1.5, -0.1)]]);
  else if (name === 'log') g = mergeGeos([[new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2), new THREE.Matrix4()]]);
  else if (name === 'girder') g = mergeGeos([[new THREE.BoxGeometry(1, 0.22, 1), new THREE.Matrix4().makeTranslation(0, 0.39, 0)], [new THREE.BoxGeometry(1, 0.6, 0.28), new THREE.Matrix4()], [new THREE.BoxGeometry(1, 0.22, 0.8), new THREE.Matrix4().makeTranslation(0, -0.39, 0)]]);
  else g = mergeGeos([[new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4()]]);
  SHAPES.set(name, g);
  return g;
}

// Surface pattern ids (pattern.js): 1 metal, 2 stone, 3 wood, 4 hex tiles, 5 grass on rock, 6 sand on rock,
// 7 basalt, 8 tread plate, 9 bamboo, 10 marble, 11 coral, 12 concrete, 13 moss on wet stone, 14 snow on rock,
// 15 cloud, 16 bark.
const PATMATS = new Map();
export function patMat(pat, color = 0xffffff, o = {}) {
  const key = pat + ':' + color + ':' + (o.rough ?? '');
  if (!PATMATS.has(key)) PATMATS.set(key, panelMat(color, { pattern: pat, roughness: o.rough ?? ({ 10: 0.3, 14: 0.4, 8: 0.45, 1: 0.45 }[pat] ?? 0.85), metalness: pat === 1 || pat === 8 ? 0.55 : 0.02 }));
  return PATMATS.get(key);
}

// Natural shapes on the daytime maps go without the glowing edge trim (it outlines the box, not the rock).
const NATURAL = /^(rock|isle|disc|lily|cloud|mushcap|basalt|planks|raft|log)/;
export const noTrim = (key, shape) => (key === 'sunny' || key === 'forest' || key === 'waterfall') && NATURAL.test(shape);

// How each map dresses its platforms: { shape, pat, col (hex or null for the zone tint), under (hanging part) }.
export function styleFor(key, c, zi, R) {
  if (c.kind === 'pier') {
    switch (key) {
      case 'sunny': return { shape: 'planks', pat: 3, col: 0xc9a06a };
      case 'waterfall': return { shape: 'planks', pat: 3, col: 0xb89464 };
      case 'forest': return { shape: 'planks', pat: 3, col: 0x8a6a46 };
      case 'volcano': return { shape: 'basalt0', pat: 7, col: 0xa08a82 };
      case 'city': return { shape: 'chamfer', pat: 12, col: 0xa8acb8 };
      default: return { shape: 'chamfer', pat: 4, col: 0x8e98a8 };
    }
  }
  const beam = c.kind === 'beam' || c.kind === 'branch';
  if (c.kind !== 'plat' && !beam) return null;
  if (c.look || c.surf === 'ice' || c.surf === 'mud') return null;
  const rock = 'rock' + ((R() * 3) | 0);
  switch (key) {
    case 'storm':
      if (beam) return { shape: 'girder', pat: 1, col: 0x4a5260 };
      if (zi === 4) return { shape: rock, pat: 8, col: 0x5a6070 };
      if (zi === 5 || zi === 8) return { shape: rock, pat: 14, col: 0xffffff };
      return { shape: 'chamfer', pat: R() < 0.5 ? 8 : 4, col: null };
    case 'sunny':
      if (beam) return { shape: 'box', pat: 3, col: 0xc9a36b };
      if (zi <= 1) return { shape: 'planks', pat: 3, col: 0xd0aa70 };
      if (zi === 3) return { shape: 'cloud', pat: 15, col: 0xffffff };
      return R() < 0.6 ? { shape: rock, pat: 6, col: 0xffffff } : { shape: 'chamfer', pat: 2, col: null };
    case 'forest':
      if (beam) return { shape: 'log', pat: 16, col: 0x8a6a4a };
      if (zi === 1 && R() < 0.75) return { shape: 'mushcap', pat: 0, col: [0xd8302a, 0xe8702a, 0xa84ad8, 0xe8c040][(R() * 4) | 0], under: { shape: 'stem', pat: 0, col: 0xf0e6d0 } };
      if (zi === 2) return { shape: 'planks', pat: 3, col: 0xb08458 };
      return { shape: rock, pat: zi === 3 || zi === 4 ? 13 : 5, col: 0xffffff, under: zi === 3 && R() < 0.5 ? { shape: 'vine', pat: 0, col: 0x3a7a32 } : null };
    case 'volcano':
      if (beam) return { shape: 'box', pat: 7, col: 0x9a827a };
      if (zi === 2) return { shape: rock, pat: 7, col: 0x7a6a8e };
      return { shape: 'basalt' + ((R() * 2) | 0), pat: 7, col: 0xb09a92 };
    case 'city':
      if (beam) return { shape: 'girder', pat: 1, col: 0x5a5e6e };
      return { shape: 'chamfer', pat: 12, col: null };
    case 'waterfall':
      if (beam) return { shape: 'box', pat: 9, col: 0xd8c890 };
      if (zi === 1) return { shape: 'lily', pat: 0, col: [0x4ab84a, 0x3aa840, 0x5ac85a][(R() * 3) | 0], under: { shape: 'vine', pat: 0, col: 0x3a8a3a } };
      if (zi === 2) return { shape: 'raft', pat: 9, col: 0xd8c890 };
      if (zi === 5) return { shape: rock, pat: 11, col: 0xffffff };
      if (zi === 6 || zi === 8) return { shape: 'disc', pat: 10, col: 0xffffff };
      return { shape: rock, pat: 13, col: 0xffffff };
  }
  return null;
}

// ---------------------------------------------------------------- zone flora (islands and ledges)
// Per map, per zone: island top (pattern), trees, small things. [model, weight].
const T = (isle, trees, small) => ({ isle, trees, small });
const FLORA = {
  storm: [T(8, [['lamp', 2], ['acunit', 1], ['tank', 1], ['debris', 2]], [['debris', 1]]), T(8, [['acunit', 2], ['antenna', 1], ['lamp', 1]], [['debris', 1]]),
    T(8, [['antenna', 3], ['lamp', 1]], [['debris', 1]]), T(8, [['debris', 3], ['lamp', 1]], [['debris', 1]]), T(8, [['debris', 4], ['antenna', 1]], [['debris', 1]]),
    T(14, [['frostpine', 3], ['crystal', 2]], [['crystal', 1]]), T(8, [['antenna', 2], ['crystal', 2]], [['crystal', 1]]), T(8, [['crystal', 3], ['antenna', 1]], [['crystal', 1]]), T(14, [['crystal', 4]], [['crystal', 1]])],
  sunny: [T(6, [['palm', 3], ['hut', 1], ['umbrella', 1]], [['rocks', 1], ['grass', 1]]), T(6, [['palm', 2], ['coral', 2], ['bush', 1]], [['coral', 1], ['flowers', 1]]),
    T(5, [['palm', 2], ['bush', 2], ['flowers', 1]], [['flowers', 2], ['grass', 1]]), T(5, [['blossom', 2], ['flowers', 3], ['bush', 1]], [['flowers', 2]]),
    T(6, [['palm', 3], ['umbrella', 1]], [['grass', 1], ['rocks', 1]]), T(6, [['cactus', 3], ['palm', 1]], [['rocks', 1]]), T(5, [['palm', 2], ['flowers', 2]], [['flowers', 1]]),
    T(5, [['blossom', 2], ['flowers', 3]], [['flowers', 2]]), T(6, [['palm', 2], ['blossom', 1]], [['flowers', 1]])],
  forest: [T(5, [['oak', 3], ['bush', 2], ['fern', 2]], [['fern', 2], ['grass', 1], ['bush', 1]]), T(13, [['shroom', 4], ['fern', 1]], [['glowshroom', 1], ['fern', 1]]),
    T(5, [['oak', 2], ['pine', 2], ['bush', 1]], [['fern', 1], ['grass', 1]]), T(13, [['oak', 2], ['fern', 2], ['bush', 2]], [['fern', 2]]),
    T(13, [['glowtree', 3], ['glowshroom', 2]], [['glowshroom', 2]]), T(5, [['dead', 3], ['bush', 1]], [['rocks', 1], ['grass', 1]]), T(5, [['pine', 4]], [['fern', 1], ['rocks', 1]]),
    T(5, [['oak', 3], ['bush', 1]], [['bush', 1], ['flowers', 1]]), T(5, [['birch', 3], ['blossom', 1], ['flowers', 1]], [['flowers', 2]])],
  volcano: [T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['obsidian', 3], ['ember', 1]], [['obsidian', 1]]),
    T(7, [['dead', 2], ['ember', 2]], [['ember', 1]]), T(7, [['ember', 2], ['dead', 1]], [['ember', 1]]), T(7, [['obsidian', 2], ['ember', 2]], [['ember', 1]]),
    T(7, [['obsidian', 3], ['ember', 1]], [['obsidian', 1]]), T(7, [['dead', 3]], [['ember', 1]]), T(5, [['pine', 3], ['bush', 1]], [['grass', 1]])],
  city: [T(12, [['acunit', 3], ['tank', 1], ['antenna', 1]], [['acunit', 1]]), T(12, [['acunit', 2], ['lamp', 2]], [['planter', 1]]), T(12, [['antenna', 2], ['acunit', 2]], [['acunit', 1]]),
    T(12, [['tank', 2], ['acunit', 2]], [['planter', 1]]), T(5, [['oak', 2], ['bush', 2], ['flowers', 1]], [['planter', 2]]), T(12, [['antenna', 4]], [['acunit', 1]]),
    T(12, [['acunit', 2], ['lamp', 1]], [['planter', 1]]), T(5, [['bush', 2], ['oak', 1], ['flowers', 1]], [['planter', 1]]), T(12, [['antenna', 2], ['lamp', 1]], [['planter', 1]])],
  waterfall: [T(6, [['palm', 3], ['bush', 1], ['umbrella', 1]], [['flowers', 1], ['grass', 1]]), T(5, [['reeds', 2], ['fern', 2], ['bush', 1], ['flowers', 1]], [['reeds', 1], ['flowers', 1]]),
    T(13, [['bamboo', 4], ['fern', 1]], [['fern', 2]]), T(5, [['blossom', 2], ['flowers', 3]], [['flowers', 2]]), T(5, [['palm', 2], ['umbrella', 2]], [['flowers', 1], ['grass', 1]]),
    T(11, [['coral', 4]], [['coral', 2]]), T(5, [['pine', 2], ['bush', 2], ['flowers', 1]], [['flowers', 1], ['bush', 1]]), T(13, [['birch', 2], ['fern', 2]], [['fern', 1]]),
    T(5, [['blossom', 3], ['flowers', 2]], [['flowers', 2]])],
};
const pick = (list, R) => { let s = 0; for (const [, w] of list) s += w; let x = R() * s; for (const [k, w] of list) if ((x -= w) <= 0) return k; return list[0][0]; };

// Floating islands round the climb (ledges on the crater wall, balconies on the city towers), trees and
// plants by zone, and small plants on the bigger ledges of the route.
export function buildScenery(view) {
  const L = view.level, key = view.key, F = FLORA[key];
  if (!F) return;
  const R = rng(4242), inst = new Map(), isles = new Map();
  // Plants are kept per height band (view.band) so only those near the camera are drawn.
  const put = (model, m, tint) => { const y = m.elements[13], k = model + '|' + Math.floor(y / 50); if (!inst.has(k)) inst.set(k, { model, y, list: [] }); inst.get(k).list.push([m, tint]); };
  const putIsle = (shape, pat, m) => { const k = shape + ':' + pat; if (!isles.has(k)) isles.set(k, { shape, pat, list: [] }); isles.get(k).list.push(m); };
  const towers = L.cols.filter((c) => c.kind === 'tower'), trees = L.trees || [];
  const tint = new THREE.Color();
  L.zones.forEach((z, zi) => {
    const f = F[Math.min(zi, F.length - 1)], n = (key === 'city' ? 14 : 9) - (DETAIL === 0 ? 4 : 0);
    for (let k = 0; k < n; k++) {
      const y = z.y0 + R() * (z.y1 - z.y0);
      let x, zz, s, top, ry = R() * TAU;
      if (key === 'volcano') {
        // A ledge sticking out of the crater wall.
        const a = R() * TAU; x = Math.cos(a) * 21.8; zz = Math.sin(a) * 21.8; s = 2.5 + R() * 2.5; ry = -a;
      } else if (key === 'city') {
        // A balcony garden on one face of a skyscraper.
        const t = towers[(R() * towers.length) | 0];
        if (!t) continue;
        const face = ((R() * 4) | 0) * (Math.PI / 2) - t.ry, d = t.hx + 1.0;
        x = t.x + Math.cos(face) * d; zz = t.z - Math.sin(face) * d; s = 2.2; ry = -face;
      } else {
        const a = R() * TAU, r = key === 'forest' ? 38 + R() * 10 : 26 + R() * 13;
        x = Math.cos(a) * r; zz = Math.sin(a) * r; s = 3 + R() * 4.5;
        if (trees.some((t) => Math.hypot(t.x - x, t.z - zz) < 10)) continue;
      }
      top = y;
      if (key === 'city') put('planter', M(x, top, zz, 1.4, 1.4, 1.4, 0, ry), null);
      putIsle(key === 'city' ? 'chamfer' : 'isle' + ((R() * 3) | 0), f.isle, M(x, top - 0.5 * (key === 'city' ? 0.5 : 1.2), zz, s, key === 'city' ? 0.5 : 1.2, s * (0.75 + R() * 0.25), 0, ry));
      const nt = key === 'city' ? 1 : 1 + ((R() * 2.6) | 0);
      for (let j = 0; j < nt; j++) {
        const a = R() * TAU, d = R() * s * 0.28, sc = 0.8 + R() * 0.7;
        tint.setHSL(0, 0, 0.85 + R() * 0.3);
        put(pick(f.trees, R), M(x + Math.cos(a) * d, top, zz + Math.sin(a) * d, sc, sc, sc, 0, R() * TAU), tint.getHex());
      }
      for (let j = 0; j < 2 + ((R() * 3) | 0); j++) {
        const a = R() * TAU, d = s * (0.2 + R() * 0.22), sc = 0.7 + R() * 0.6;
        put(pick(f.small, R), M(x + Math.cos(a) * d, top, zz + Math.sin(a) * d, sc, sc, sc, 0, R() * TAU), null);
      }
      // Waterfall: some islands spill a little waterfall off one edge.
      if (key === 'waterfall' && R() < 0.45) view.islandFalls.push({ x: x + Math.cos(ry) * s * 0.42, y: top, z: zz - Math.sin(ry) * s * 0.42, w: s * 0.35, h: 6 + R() * 10, ry });
    }
  });
  // Small plants near the edges of the bigger route ledges (they don't get in the way: no collision).
  for (const c of DETAIL ? L.cols : []) {
    if (c.kind !== 'plat' || c.dyn || c.look || Math.min(c.hx, c.hz) < 1.3 || R() > 0.4) continue;
    const f = F[Math.min(c.zone, F.length - 1)], ax = Math.cos(c.ry), az = -Math.sin(c.ry), bx = Math.sin(c.ry), bz = Math.cos(c.ry);
    for (let j = 0; j < 1 + ((R() * 2) | 0); j++) {
      const u = (R() < 0.5 ? -1 : 1) * (c.hx - 0.25), v = (R() * 2 - 1) * (c.hz - 0.3), sw = R() < 0.5, sc = 0.45 + R() * 0.35;
      const px = sw ? u : (R() * 2 - 1) * (c.hx - 0.3), pz = sw ? v : (R() < 0.5 ? -1 : 1) * (c.hz - 0.25);
      put(pick(f.small, R), M(c.x + ax * px + bx * pz, c.y + c.hy, c.z + az * px + bz * pz, sc, sc, sc, 0, R() * TAU), null);
    }
  }
  // Draw: one instanced mesh per island shape and per model.
  const col = new THREE.Color();
  for (const { shape, pat, list } of isles.values()) {
    const im = new THREE.InstancedMesh(shapeGeo(shape), patMat(pat), list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHSL(0, 0, 0.88 + ((i * 37) % 23) / 100)); });
    view.add(im);
  }
  const mat = vegMat();
  for (const { model, y, list } of inst.values()) {
    const geo = modelGeo(model), im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, t], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(t ?? 0xffffff)); });
    view.add(im, model !== 'grass' && model !== 'flowers' && model !== 'fern');
    view.band(y).near.push(im);
  }
  paletteTex();
}
const GEOS = new Map();
export function modelGeo(name) {
  if (!GEOS.has(name)) GEOS.set(name, build(MODELS[name]()));
  return GEOS.get(name);
}
let VEG = null;
export function vegMat() {
  // The phone gets the palette once, so every model's colours must be in it before the first map is drawn.
  // Otherwise trees that first appear on a later map come out black there.
  if (!VEG) {
    for (const k of Object.keys(MODELS)) modelGeo(k);
    VEG = panelMat(0xffffff, { map: paletteTex(), roughness: 0.82, metalness: 0, pattern: 0 });
  }
  return VEG;
}

// ---------------------------------------------------------------- animals (whole flocks animated in the shader)
// Model parts with a wing flag: w 0 body, -1/+1 wing (flaps round the body's long axis), 2 leg (swings).
const A = (geo, m, c, w = 0) => ({ geo, m, c, w });
const lo = (r) => new THREE.OctahedronGeometry(r, 0), quad = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
const ANIMALS = {
  gull: (c = [0xf4f4f0, 0xb8bcc4, 0x2a2a2a, 0xffa030]) => [A(lo(0.12), M(0, 0, 0, 1, 0.9, 2.6), c[0]), A(lo(0.085), M(0, 0.06, 0.3), c[0]),
    A(cone(0.025, 0.11, 5), M(0, 0.05, 0.42, 1, 1, 1, Math.PI / 2), c[3]), A(quad(0.16, 0.14), M(0, 0.02, -0.33), c[1]),
    A(quad(0.44, 0.2), M(0.27, 0.03, 0, 1, 1, 1, 0, 0.08), c[1], 1), A(quad(0.24, 0.14), M(0.6, 0.03, -0.04, 1, 1, 1, 0, 0.25), c[2], 1),
    A(quad(0.44, 0.2), M(-0.27, 0.03, 0, 1, 1, 1, 0, -0.08), c[1], -1), A(quad(0.24, 0.14), M(-0.6, 0.03, -0.04, 1, 1, 1, 0, -0.25), c[2], -1)],
  parrot: () => [A(lo(0.12), M(0, 0, 0, 1, 1, 2.3), 0xe8302a), A(lo(0.09), M(0, 0.07, 0.27), 0xe8302a), A(cone(0.035, 0.1, 5), M(0, 0.05, 0.38, 1, 1, 1, 1.9), 0xf0e0c0),
    A(quad(0.06, 0.5), M(0, -0.02, -0.5), 0x2a6ae8), A(quad(0.4, 0.2), M(0.24, 0.03, 0), 0xffd23d, 1), A(quad(0.24, 0.15), M(0.54, 0.03, -0.03, 1, 1, 1, 0, 0.25), 0x2a6ae8, 1),
    A(quad(0.4, 0.2), M(-0.24, 0.03, 0), 0xffd23d, -1), A(quad(0.24, 0.15), M(-0.54, 0.03, -0.03, 1, 1, 1, 0, -0.25), 0x2a6ae8, -1)],
  eagle: () => ANIMALS.gull([0x6a4a2e, 0x5a3e26, 0x3a2a1a, 0xffc030]).concat([A(lo(0.09), M(0, 0.07, 0.31), 0xf4f4f0)]),
  butterfly: () => [A(box(0.03, 0.03, 0.2), M(0, 0, 0), 0x2a2a2a), A(quad(0.2, 0.16), M(0.11, 0, 0.04, 1, 1, 1, 0, 0.3), 0xffffff, 1), A(quad(0.15, 0.12), M(0.09, 0, -0.08, 1, 1, 1, 0, -0.3), 0xe8e8e8, 1),
    A(quad(0.2, 0.16), M(-0.11, 0, 0.04, 1, 1, 1, 0, -0.3), 0xffffff, -1), A(quad(0.15, 0.12), M(-0.09, 0, -0.08, 1, 1, 1, 0, 0.3), 0xe8e8e8, -1)],
  crab: () => [A(lo(0.16), M(0, 0.1, 0, 1.3, 0.55, 1), 0xd84a2a), A(ico(0.03, 0), M(0.06, 0.2, 0.12), 0x111111), A(ico(0.03, 0), M(-0.06, 0.2, 0.12), 0x111111),
    A(lo(0.07), M(0.2, 0.12, 0.16, 1.2, 0.7, 1), 0xe85a3a), A(lo(0.07), M(-0.2, 0.12, 0.16, 1.2, 0.7, 1), 0xe85a3a),
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((k) => A(box(0.18, 0.025, 0.025), M(s * 0.2, 0.05, -0.06 + k * 0.07, 1, 1, 1, 0, 0, s * 0.5), 0xc83a22, 2)))],
  frog: () => [A(lo(0.15), M(0, 0.12, 0, 1, 0.75, 1.2), 0x4ab84a), A(lo(0.05), M(0.07, 0.22, 0.09), 0xf0f0e0), A(lo(0.05), M(-0.07, 0.22, 0.09), 0xf0f0e0),
    A(ico(0.025, 0), M(0.07, 0.23, 0.13), 0x111111), A(ico(0.025, 0), M(-0.07, 0.23, 0.13), 0x111111), A(box(0.07, 0.05, 0.2), M(0.13, 0.05, -0.08), 0x3aa83a, 2), A(box(0.07, 0.05, 0.2), M(-0.13, 0.05, -0.08), 0x3aa83a, 2)],
  turtle: () => [A(new THREE.SphereGeometry(0.4, 6, 3, 0, TAU, 0, Math.PI / 2), M(0, 0, 0, 1, 0.6, 1.2), 0x4a6a3a), A(lo(0.12), M(0, 0.02, 0.55), 0x8aa86a),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => A(box(0.22, 0.04, 0.1), M(s * 0.4, 0, f * 0.3, 1, 1, 1, 0, s * f * 0.4), 0x8aa86a, 2))],
  deer: () => [A(box(0.3, 0.32, 0.8), M(0, 0.85, 0), 0x9a6a3e), A(box(0.12, 0.38, 0.12), M(0, 1.12, 0.38, 1, 1, 1, -0.5), 0x9a6a3e), A(box(0.16, 0.16, 0.3), M(0, 1.32, 0.52), 0x8a5a32),
    A(ico(0.04, 0), M(0, 1.3, 0.68), 0x1a1a1a), A(box(0.04, 0.22, 0.04), M(0.06, 1.48, 0.46, 1, 1, 1, -0.3, 0, -0.4), 0x5a3e26), A(box(0.04, 0.22, 0.04), M(-0.06, 1.48, 0.46, 1, 1, 1, -0.3, 0, 0.4), 0x5a3e26),
    A(box(0.1, 0.12, 0.06), M(0, 0.95, -0.42), 0xf4f0e8), ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => A(box(0.07, 0.7, 0.07), M(s * 0.1, 0.35, f * 0.3), 0x7a5232, 2))],
  lizard: () => [A(box(0.16, 0.1, 0.5), M(0, 0.06, 0), 0x3a2a24), A(box(0.12, 0.08, 0.14), M(0, 0.06, 0.3), 0x3a2a24), A(cone(0.06, 0.5, 4), M(0, 0.05, -0.48, 1, 0.6, 1, -Math.PI / 2), 0x3a2a24),
    A(ico(0.03, 0), M(0.04, 0.08, 0.08), 0xff6a1a), A(ico(0.03, 0), M(-0.03, 0.08, -0.08), 0xff6a1a), ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => A(box(0.14, 0.03, 0.04), M(s * 0.12, 0.03, f * 0.15), 0x2a1e1a, 2))],
  dolphin: () => [A(lo(0.4), M(0, 0, 0, 0.8, 0.8, 2.6), 0x7a8a9a), A(cone(0.08, 0.4, 5), M(0, 0.02, 1.1, 1, 1, 1, Math.PI / 2), 0x8a9aaa), A(cone(0.18, 0.4, 4), M(0, 0.38, -0.1, 0.3, 1, 1), 0x6a7a8a),
    A(quad(0.6, 0.2), M(0, 0, -1.05), 0x6a7a8a), A(box(0.3, 0.04, 0.14), M(0.3, -0.12, 0.3, 1, 1, 1, 0, 0, -0.4), 0x6a7a8a), A(box(0.3, 0.04, 0.14), M(-0.3, -0.12, 0.3, 1, 1, 1, 0, 0, 0.4), 0x6a7a8a)],
};
const SWARM_VS = `#include <fog_pars_vertex>
  uniform float uT, uMode, uFlap, uSide;
  attribute vec3 aCol; attribute float aW; attribute vec4 aP; attribute vec4 aQ;
  varying vec3 vC; varying float vL;
  vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  void main(){
    float ph = aP.w, R = aQ.x, sp = aQ.y, amp = aQ.z, sz = aQ.w, a = uT * sp + ph * 6.2832, bank = 0.0, pitch = 0.0;
    vec3 c, d;
    if (uMode < 0.5) {
      c = aP.xyz + vec3(cos(a) * R, sin(a * 0.6 + ph * 5.0) * amp, sin(a) * R);
      d = vec3(-sin(a), 0.0, cos(a)) * sign(sp); bank = 0.35 * sign(sp);
    } else if (uMode < 1.5) {
      c = aP.xyz + vec3(sin(a) * R + sin(a * 2.3 + ph) * R * 0.35, sin(a * 1.7 + ph * 3.0) * amp, cos(a * 1.3) * R);
      d = normalize(vec3(cos(a) * R + cos(a * 2.3 + ph) * R * 0.8, 0.001, -sin(a * 1.3) * R * 1.3));
    } else if (uMode < 2.5) {
      float h = ph * 6.2832; vec3 f = vec3(sin(h), 0.0, cos(h));
      c = aP.xyz + f * sin(a) * R; d = f * (cos(a) >= 0.0 ? 1.0 : -1.0);
    } else if (uMode < 3.5) {
      float h = ph * 6.2832; vec3 f = vec3(sin(h), 0.0, cos(h));
      c = aP.xyz + f * sin(a * 0.5) * R; c.y += max(0.0, sin(a * 3.0)) * amp; d = f * (cos(a * 0.5) >= 0.0 ? 1.0 : -1.0);
    } else {
      // Swimming round a circle at the surface, now and then leaping out (dolphins).
      c = aP.xyz + vec3(cos(a) * R, 0.0, sin(a) * R); d = vec3(-sin(a), 0.0, cos(a)) * sign(sp);
      float j = sin(a * 0.5 + ph * 7.0); float up = amp * max(0.0, j) * max(0.0, j); c.y += up - 0.4;
      pitch = -cos(a * 0.5 + ph * 7.0) * step(0.0, j) * 0.9;
    }
    vec3 p = position * sz, n = normal;
    if (abs(aW) > 0.5 && abs(aW) < 1.5) { float ang = sin(uT * uFlap + ph * 40.0) * 0.8 * sign(aW); p.xy = rot2(p.xy, ang); n.xy = rot2(n.xy, ang); }
    if (aW > 1.5) { float ang = sin(uT * 10.0 + ph * 30.0 + position.z * 25.0) * 0.45; p.yz = rot2(p.yz, ang * sign(position.x)); }
    p.yz = rot2(p.yz, pitch); n.yz = rot2(n.yz, pitch);
    p.xy = rot2(p.xy, bank); n.xy = rot2(n.xy, bank);
    float yaw = atan(d.x, d.z) + uSide, cy = cos(yaw), sy = sin(yaw);
    p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
    n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
    vC = aCol;
    vL = 0.5 + 0.65 * max(dot(normalize(n), normalize(vec3(0.4, 0.9, 0.3))), 0.0);
    vec4 mvPosition = viewMatrix * vec4(c + p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SWARM_FS = `#include <fog_pars_fragment>
  uniform float uLight, uGlow; varying vec3 vC; varying float vL;
  void main(){
    gl_FragColor = vec4(vC * (vL * uLight + uGlow), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
// One mesh per flock: list of { x, y, z, ph, R, sp, amp, sz, tint }.
function swarm(view, animal, list, o = {}) {
  if (!list.length) return;
  const parts = ANIMALS[animal](), tmpl = [];
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()).applyMatrix4(p.m);
    const c = new THREE.Color(p.c);
    tmpl.push([g.attributes.position.array, g.attributes.normal.array, c, p.w]);
    g.dispose();
  }
  const pos = [], nor = [], col = [], wf = [], ap = [], aq = [];
  let cx = 0, cy = 0, cz = 0, rad = 0;
  for (const s of list) { cx += s.x / list.length; cy += s.y / list.length; cz += s.z / list.length; }
  for (const s of list) {
    rad = Math.max(rad, Math.hypot(s.x - cx, s.y - cy, s.z - cz) + s.R + s.amp + 3);
    const t = new THREE.Color(s.tint ?? 0xffffff);
    for (const [pa, na, c, w] of tmpl) for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]); nor.push(na[i], na[i + 1], na[i + 2]);
      col.push(c.r * t.r, c.g * t.g, c.b * t.b); wf.push(w); ap.push(s.x, s.y, s.z, s.ph); aq.push(s.R, s.sp, s.amp, s.sz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(wf, 1));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(aq, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad);
  const m = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uMode: { value: o.mode ?? 0 }, uFlap: { value: o.flap ?? 9 }, uSide: { value: o.side ?? 0 }, uLight: { value: o.light ?? 1 }, uGlow: { value: o.glow ?? 0 } }]),
    vertexShader: SWARM_VS, fragmentShader: SWARM_FS,
  });
  view.timeMats.push(m);
  const mesh = new THREE.Mesh(g, m);
  view.root.add(mesh);
  if (cy > 30) view.band(cy).near.push(mesh);
}

export function buildAnimals(view) {
  const L = view.level, key = view.key, R = rng(777), top = L.top;
  // Flocks spread up the whole climb (each flock circles its own spot), plus big circles round the tower.
  const flocks = (n, per, rMin, rMax, sz, sp, tints) => {
    // One mesh per band of height, so flocks far above or below are culled.
    const bands = new Map();
    for (let f = 0; f < n; f++) {
      const y = 8 + R() * (top + 10), a = R() * TAU, r = rMin + R() * (rMax - rMin), b = Math.floor(y / 120);
      if (!bands.has(b)) bands.set(b, []);
      for (let k = 0; k < per; k++) bands.get(b).push({ x: Math.cos(a) * r, y: y + (R() - 0.5) * 3, z: Math.sin(a) * r, ph: R(), R: 3 + R() * 6, sp: (0.25 + R() * 0.25) * (f % 2 ? 1 : -1) * sp, amp: 1 + R() * 1.5, sz: sz * (0.85 + R() * 0.3), tint: tints ? tints[(R() * tints.length) | 0] : null });
    }
    return [...bands.values()];
  };
  const birds = { storm: ['gull', [0x3a3a44]], sunny: ['gull', null], forest: ['gull', [0x8a6a3e, 0x6a8a4a, 0x4a6a9a, 0xc8a04a]], volcano: ['gull', [0xff8a3d]], city: ['gull', [0x9a9aa8, 0x7a7a88]], waterfall: ['parrot', [0xffffff, 0x3aa8ff, 0x5ad86a, 0xffd23d]] }[key];
  const light = key === 'storm' ? 0.45 : key === 'city' ? 0.7 : key === 'volcano' ? 0.8 : 1;
  for (const list of flocks([14, 32, 44][DETAIL], 4, 12, 34, key === 'forest' ? 1.0 : 1.4, 1, birds[1])) swarm(view, birds[0], list, { light, glow: key === 'volcano' ? 0.6 : 0, flap: key === 'storm' ? 7 : 9 });
  if (key === 'sunny' || key === 'waterfall') for (const list of flocks(18, 2, 30, 60, 1.6, 0.6, null)) swarm(view, 'gull', list, { light, flap: 6 });
  if (key === 'forest') for (const list of flocks(16, 1, 30, 60, 3.2, 0.35, null)) swarm(view, 'eagle', list, { light, flap: 3.5 });
  if (DETAIL === 0) return;
  // Butterflies near the route on the green maps.
  if (key === 'sunny' || key === 'forest' || key === 'waterfall') {
    const cols = [0xff9a3d, 0x5ab8ff, 0xffe066, 0xff6ab8, 0xb48cff, 0xffffff], bands = new Map();
    for (let k = 0; k < (DETAIL === 2 ? 320 : 200); k++) {
      const y = 2 + R() * (top - 4), a = R() * TAU, r = 8 + R() * 12, b = Math.floor(y / 60);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ph: R(), R: 0.8 + R() * 1.6, sp: 0.6 + R() * 0.5, amp: 0.6, sz: 1.2 + R() * 0.6, tint: cols[(R() * cols.length) | 0] });
    }
    for (const list of bands.values()) swarm(view, 'butterfly', list, { mode: 1, flap: 22, light: 1.15 });
  }
  // Critters on the ground.
  const ring = (n, rMin, rMax, y, f) => Array.from({ length: n }, () => { const a = R() * TAU, r = rMin + R() * (rMax - rMin); return Object.assign({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ph: R(), tint: null }, f()); });
  if (key === 'sunny') {
    swarm(view, 'crab', ring(14, 31, 39, 0.42, () => ({ R: 0.8 + R(), sp: 0.5 + R() * 0.4, amp: 0, sz: 1.2 })), { mode: 2, side: Math.PI / 2 });
    swarm(view, 'dolphin', ring(8, 60, 140, 0, () => ({ R: 14 + R() * 10, sp: (0.12 + R() * 0.05) * (R() < 0.5 ? 1 : -1), amp: 2.6, sz: 1.3 })), { mode: 4 });
  }
  if (key === 'forest') swarm(view, 'deer', ring(10, 26, 70, 0.4, () => ({ R: 2 + R() * 4, sp: 0.12 + R() * 0.08, amp: 0, sz: 1.3 })), { mode: 2 });
  if (key === 'waterfall') {
    const lilies = L.decor.filter((d) => d.k === 'lily');
    swarm(view, 'frog', lilies.filter((d, i) => i % 3 === 0).map((d) => ({ x: d.x, y: d.y + 0.03, z: d.z, ph: R(), R: 0.25, sp: 0.4 + R() * 0.3, amp: 0.35, sz: 1.4, tint: null })), { mode: 3 });
    swarm(view, 'turtle', ring(10, 42, 80, 0.12, () => ({ R: 4 + R() * 6, sp: (0.06 + R() * 0.05) * (R() < 0.5 ? 1 : -1), amp: 0, sz: 1.6 })), { mode: 4 });
  }
  if (key === 'volcano') swarm(view, 'lizard', ring(16, 21.2, 21.8, 0, () => ({ R: 1.2, sp: 0.4, amp: 0, sz: 2.2 })).map((s) => Object.assign(s, { y: 6 + R() * (top - 20) })), { mode: 2, glow: 0.2 });
}

// ---------------------------------------------------------------- waterfalls
// Falling water: deep blue-white layers streaming down, foam clumps, ragged see-through edges.
export function fallMat(view, o = {}) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uT: { value: 0 }, uS: { value: o.speed ?? 0.5 }, uA: { value: o.alpha ?? 0.92 },
      uC: { value: new THREE.Color(o.color ?? 0xcff2fa) }, uD: { value: new THREE.Color(o.deep ?? 0x3a9ac0) },
    }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float uT, uS, uA; uniform vec3 uC, uD; varying vec2 vUv;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n21(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float v = vUv.y + uT * uS;
        float n1 = n21(vec2(vUv.x * 16.0, v * 0.8));
        float n2 = n21(vec2(vUv.x * 38.0 + 3.1, v * 2.4 + uT * 0.7));
        float n3 = n21(vec2(vUv.x * 7.0 + 9.7, v * 0.35 + uT * 0.2));
        float streak = smoothstep(0.3, 0.95, n1 * 0.55 + n2 * 0.45);
        float foam = smoothstep(0.6, 0.88, n3 * 0.55 + n2 * 0.45);
        vec3 col = mix(uD, uC, 0.35 + 0.65 * streak);
        col = mix(col, vec3(1.0), foam * 0.8);
        float edge = smoothstep(0.0, 0.1 + 0.1 * n1, vUv.x) * (1.0 - smoothstep(0.9 - 0.1 * n2, 1.0, vUv.x));
        gl_FragColor = vec4(col * (0.85 + 0.3 * streak), uA * edge * (0.7 + 0.3 * max(streak, foam)));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  view.timeMats.push(m);
  return m;
}

// Spray and mist where falls land: soft puffs rising and spreading, as camera-facing quads in one mesh.
export function buildMist(view, spots) {
  if (!spots.length || DETAIL === 0) return;
  const R = rng(99), pos = [], ap = [], aq = [];
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  let cx = 0, cy = 0, cz = 0;
  for (const s of spots) { cx += s.x / spots.length; cy += s.y / spots.length; cz += s.z / spots.length; }
  let rad = 0;
  for (const s of spots) {
    rad = Math.max(rad, Math.hypot(s.x - cx, s.y - cy, s.z - cz) + s.r * 3 + 10);
    for (let k = 0; k < (s.n || 14); k++) {
      const a = R() * TAU, r = R() * s.r, ph = R();
      for (const [u, v] of corners) { pos.push(u, v, 0); ap.push(s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r, ph); aq.push(s.r * (0.6 + R() * 0.5), 0.25 + R() * 0.2, s.rise ?? 4, 0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(aq, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 } }]),
    vertexShader: `#include <fog_pars_vertex>
      uniform float uT; attribute vec4 aP; attribute vec4 aQ; varying vec2 vQ; varying float vA;
      void main(){
        float life = fract(uT * aQ.y + aP.w), size = aQ.x * (0.5 + life * 1.2);
        vec3 c = aP.xyz + vec3(sin(aP.w * 40.0) * life * 1.5, life * aQ.z, cos(aP.w * 33.0) * life * 1.5);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = c + (right * position.x + up * position.y) * size;
        vQ = position.xy; vA = (1.0 - life) * smoothstep(0.0, 0.15, life);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      varying vec2 vQ; varying float vA;
      void main(){
        float d = length(vQ) * 2.0, a = (1.0 - smoothstep(0.3, 1.0, d)) * vA * 0.42;
        gl_FragColor = vec4(vec3(0.94, 0.98, 1.0), a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  view.timeMats.push(m);
  view.root.add(new THREE.Mesh(g, m));
}
