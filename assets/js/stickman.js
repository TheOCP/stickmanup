// Neon stickmen with procedural, slightly silly animation. The physics body is a sphere (PR = 0.42)
// centred at the waist; the figure stands about 1.6 m tall with its feet on the floor.
import { noiseGlsl } from './pattern.js';
import * as THREE from 'three';
import { F } from './player.js';
import { EMOTE } from './emotes.js';
import { COLORS } from './colors.js';
import { COL_W, COL_BACK, COL_ARMS, ARM_W, TEX, FIG_TOP, FIG_H, BODY_W, ARM_SPAN, FACE_W, FACE_H, drawFace, paintSuit, paintLit, LIT_K, paintCape, suitIsDark } from './skins.js';
import { gearGeo, gearGeoMirror, gearMat, gunInfo, GEAR_AT, GEAR_ANIM, HAIR_TOP, HAT_ON_HAIR, coverOf } from './gear.js';
import { BEAMS } from './weapons.js';

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const WHITE = new THREE.Color(0xffffff);
const EP = {}, EV = new THREE.Vector3(), EMOTE_PIVOT = 0.35;

// How each kind of weapon is held, in the torso's own space: at is where the gun's grip sits, lean and crouch the body, hx and
// hz the head (a cheek down on the stock), stance the legs when standing still [legX, legX, knee, knee], and kick the recoil
// [back, up]. sling is where it rides when not in use.
// Weapons are drawn a size bigger than life, like everything else on a stickman.
const GS = 1.3;
const HOLDS = {
  pistol: { at: [-0.03, 0.47, 0.44], lean: 0.03, crouch: 0, hx: 0.04, hz: 0, stance: [-0.25, 0.3, 0.25, 0.1], kick: [0.05, 0.16], sling: 'hip' },
  smg: { at: [-0.075, 0.36, 0.3], lean: 0.08, crouch: 0.03, hx: 0.1, hz: 0.06, stance: [-0.3, 0.3, 0.3, 0.12], kick: [0.022, 0.03], sling: 'back' },
  shotgun: { at: [-0.1, 0.35, 0.27], lean: 0.08, crouch: 0.04, hx: 0.12, hz: 0.08, stance: [-0.35, 0.32, 0.36, 0.14], kick: [0.08, 0.16], sling: 'back' },
  rifle: { at: [-0.1, 0.38, 0.25], lean: 0.06, crouch: 0.03, hx: 0.14, hz: 0.12, stance: [-0.34, 0.32, 0.32, 0.12], kick: [0.03, 0.04], sling: 'back' },
  sniper: { at: [-0.085, 0.4, 0.23], lean: 0.12, crouch: 0.12, hx: 0.24, hz: 0.2, stance: [-0.55, 0.42, 0.75, 0.3], kick: [0.075, 0.14], sling: 'back' },
  heavy: { at: [-0.15, 0.13, 0.2], lean: -0.07, crouch: 0.07, hx: -0.02, hz: 0, stance: [-0.4, 0.4, 0.45, 0.25], kick: [0.018, 0.018], sling: 'back' },
  launcher: { at: [-0.19, 0.46, 0.0], lean: 0.1, crouch: 0.05, hx: 0.08, hz: -0.1, stance: [-0.42, 0.34, 0.45, 0.14], kick: [0.1, 0.2], sling: 'back' },
};
const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a), qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const SLUNG = {
  back: { p: new THREE.Vector3(-0.14, 0.13, -0.165), q: qz(-0.5).multiply(qx(-Math.PI / 2)) },
  hip: { p: new THREE.Vector3(-0.2, 0.0, 0.015), q: qx(Math.PI / 2) },
};
const qHold = new THREE.Quaternion(), vHold = new THREE.Vector3(), eHold = new THREE.Euler(), UPPER_L = 0.29, FORE_L = 0.29;
const IK = { ax: 0, az: 0, ay: 0, el: 0 };
// Reaches a hand to (tx, ty, tz), a place relative to the shoulder, with the elbow towards the pole. Rotations are for a
// shoulder in XZY order: the Y comes first and only turns the arm round itself, which is what points the elbow.
function reach(tx, ty, tz, px, py, pz) {
  let d = Math.hypot(tx, ty, tz) || 1e-3;
  const nx = tx / d, ny = ty / d, nz = tz / d;
  d = Math.min(d, UPPER_L + FORE_L - 0.002);
  const along = d * d / (2 * d) + (UPPER_L * UPPER_L - FORE_L * FORE_L) / (2 * d), out = Math.sqrt(Math.max(0, UPPER_L * UPPER_L - along * along));
  const dot = px * nx + py * ny + pz * nz;
  let qx0 = px - nx * dot, qy0 = py - ny * dot, qz0 = pz - nz * dot;
  const ql = Math.hypot(qx0, qy0, qz0) || 1;
  qx0 /= ql; qy0 /= ql; qz0 /= ql;
  const ex = nx * along + qx0 * out, ey = ny * along + qy0 * out, ez = nz * along + qz0 * out;
  const ux = ex / UPPER_L, uy = ey / UPPER_L, uz = ez / UPPER_L;
  const hx = nx * d, hy = ny * d, hz = nz * d, fx = (hx - ex) / FORE_L, fy = (hy - ey) / FORE_L, fz = (hz - ez) / FORE_L;
  const az = Math.asin(Math.max(-1, Math.min(1, ux)));
  const ax = Math.atan2(-uz, -uy);
  // The forearm as the upper arm sees it, before its own turn.
  const ca = Math.cos(ax), sa = Math.sin(ax), cz = Math.cos(az), sz = Math.sin(az);
  const y1 = fy * ca + fz * sa, z1 = -fy * sa + fz * ca, x2 = fx * cz + y1 * sz, y2 = -fx * sz + y1 * cz;
  IK.ax = ax; IK.az = az;
  IK.ay = Math.atan2(x2, z1);
  IK.el = -Math.acos(Math.max(-1, Math.min(1, -y2)));
  return IK;
}

// Joins geometries (each already moved into place) into one, so a whole limb is a single draw call.
function join(...geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
// Limbs are capsules hanging down from their pivot (the joint), so rotating the pivot swings the limb
// and the rounded ends make smooth elbows and knees without extra joint meshes.
const limb = (r, len) => new THREE.CapsuleGeometry(r, len - r, 4, 10).translate(0, -len / 2, 0);
// Texture coordinates for a suit: each triangle looks up the front column, the back column or the arm column of
// the suit's texture (see skins.js), at where it sits on the figure standing straight. ox, oy: the part's joint.
function figure(g0, ox, oy, arm) {
  const g = g0.index ? g0.toNonIndexed() : g0, a = g.attributes.position.array, uv = new Float32Array((a.length / 3) * 2);
  const front = (x) => (COL_W / 2 + (x / BODY_W) * COL_W) / TEX, back = (x) => (COL_BACK + COL_W / 2 - (x / BODY_W) * COL_W) / TEX;
  const side = (x) => (COL_ARMS + ARM_W / 2 - (x / ARM_SPAN) * ARM_W) / TEX;
  for (let i = 0; i < a.length; i += 9) {
    const z = a[i + 2] + a[i + 5] + a[i + 8];
    for (let k = 0; k < 3; k++) {
      const x = a[i + k * 3] + ox, y = a[i + k * 3 + 1] + oy;
      uv[(i / 3 + k) * 2] = arm ? side(x) : z >= 0 ? front(x) : back(x);
      uv[(i / 3 + k) * 2 + 1] = 1 - (FIG_TOP - y) / FIG_H;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(g.attributes.normal.array, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
const THIGH = limb(0.078, 0.34), SHIN = join(limb(0.068, 0.33), new THREE.BoxGeometry(0.13, 0.08, 0.24).translate(0, -0.35, 0.05));
const UPPER = limb(0.066, 0.29), FORE = join(limb(0.06, 0.27), new THREE.SphereGeometry(0.078, 10, 8).translate(0, -0.29, 0));
// Heights of the joints above the climber's centre (the figure standing straight, as built below).
const HIP_Y = 0.3, KNEE_Y = HIP_Y - 0.34, SHOULDER_Y = HIP_Y + 0.46, ELBOW_Y = SHOULDER_Y - 0.29, HEAD_Y = HIP_Y + 0.5 + 0.22;
const SIDES = [-1, 1], HIP_X = 0.09, SHOULDER_X = 0.15;
// Eyes and mouth for the drawn faces: pieces of a sphere just off the head, each centred on its own origin so
// it can be squashed for blinks and shouts.
function facePatch(y0, y1, wide) {
  const R = 0.208, t0 = Math.acos(y1 / R), t1 = Math.acos(y0 / R), cy = (y0 + y1) / 2, cz = Math.sqrt(R * R - cy * cy);
  return { geo: new THREE.SphereGeometry(R, 14, 8, Math.PI / 2 - wide, wide * 2, t0, t1 - t0).translate(0, -cy, -cz), y: cy, z: cz };
}
const G = {
  thigh: SIDES.map((s) => figure(THIGH, s * HIP_X, HIP_Y)),
  shin: SIDES.map((s) => figure(SHIN, s * HIP_X, KNEE_Y)),
  upper: SIDES.map((s) => figure(UPPER, s * SHOULDER_X, SHOULDER_Y, true)),
  fore: SIDES.map((s) => figure(FORE, s * SHOULDER_X, ELBOW_Y, true)),
  torso: figure(new THREE.CapsuleGeometry(0.105, 0.38, 4, 14).translate(0, 0.27, 0), 0, HIP_Y),
  head: figure(new THREE.SphereGeometry(0.2, 22, 16), 0, HEAD_Y),
  eyes: join(new THREE.SphereGeometry(0.036, 10, 8).translate(-0.07, 0, 0), new THREE.SphereGeometry(0.036, 10, 8).translate(0.07, 0, 0)),
  mouth: new THREE.TorusGeometry(0.042, 0.014, 6, 16), shield: new THREE.SphereGeometry(0.95, 28, 20),
  // The flash at the muzzle: a star with a long middle.
  flash: join(new THREE.OctahedronGeometry(0.075, 0).scale(1, 1, 2.6), new THREE.OctahedronGeometry(0.06, 0).scale(2.2, 0.35, 0.9), new THREE.OctahedronGeometry(0.06, 0).scale(0.35, 2.2, 0.9)),
  blob: new THREE.CircleGeometry(0.55, 28).rotateX(-Math.PI / 2),
  eyesP: facePatch(-0.02, 0.14, 0.95),
  mouthP: facePatch(-0.15, -0.01, 0.85),
  // Hangs from the shoulders; its picture reads the right way round from behind, where you usually see it.
  cape: (() => {
    const g = new THREE.PlaneGeometry(0.46, 0.74, 1, 6).translate(0, -0.37, 0), uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) { uv.setX(i, 1 - uv.getX(i)); pos.setZ(i, -Math.pow(Math.max(0, -pos.getY(i)), 1.5) * 0.12); }
    g.computeVertexNormals();
    return g;
  })(),
  spark: new THREE.OctahedronGeometry(0.06, 0),
  // The Hacker's trail: a zero and a one.
  bit0: new THREE.TorusGeometry(0.05, 0.013, 4, 12).scale(0.72, 1, 1),
  bit1: new THREE.BoxGeometry(0.024, 0.12, 0.024),
};

// ---------------------------------------------------------------- materials for skins (made once each, when first worn)
const texOf = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; };
const SUIT_MATS = new Map(), FACE_MATS = new Map(), CAPE_MATS = new Map(), LEGEND_CAPES = new Map();
// A legendary suit's cape is made of the suit itself, seen from both sides.
function legendCape(suit) {
  let m = LEGEND_CAPES.get(suit.id);
  if (!m) { m = legendMat(suit.shader); m.side = THREE.DoubleSide; LEGEND_CAPES.set(suit.id, m); }
  return m;
}
function suitMat(suit) {
  let m = SUIT_MATS.get(suit.id);
  if (m) return m;
  if (suit.shader) m = legendMat(suit.shader);
  else {
    // Every suit tried on stays in memory for good, so they aren't painted any bigger than they're seen.
    const t = texOf(paintSuit(suit, 360));
    // The suit's own picture also glows a little, so it reads in the dark maps like the plain colours do; a suit with lit parts
    // glows from its own picture of them instead.
    const lit = suit.lit ? texOf(paintLit(suit, 360)) : null;
    m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: lit || t, emissive: 0xffffff, emissiveIntensity: lit ? LIT_K : suit.glow ?? 0.42, roughness: suit.rough ?? 0.5, metalness: suit.metal ?? 0.05 });
  }
  SUIT_MATS.set(suit.id, m);
  return m;
}
function faceMat(face, part, light) {
  const k = face.id + ':' + part + ':' + (light ? 1 : 0);
  let m = FACE_MATS.get(k);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = FACE_W; c.height = FACE_H;
  drawFace(c.getContext('2d'), face, part, light);
  m = new THREE.MeshBasicMaterial({ map: texOf(c), transparent: true, depthWrite: false, color: new THREE.Color(0xffffff).multiplyScalar(face.glow ?? 1) });
  FACE_MATS.set(k, m);
  return m;
}
function capeMat(spec) {
  let m = CAPE_MATS.get(spec);
  if (m) return m;
  const t = texOf(paintCape(spec));
  m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  CAPE_MATS.set(spec, m);
  return m;
}
const hexC = (x) => new THREE.Color(x);
// Legendary suits: alive, unlit and glowing. uv.y runs up the figure. See LEGENDS in skins.js for the modes.
const VOR = `vec3 vor(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y)), c = i + g, r = g + vec2(h21(c), h21(c + 37.0)) - f; float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; id = h21(c + 71.0); } else if (d < d2) d2 = d;
        }
        return vec3(sqrt(d1), sqrt(d2), id); }`;
function legendMat(S) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uMode: { value: S.mode }, uA: { value: hexC(S.a) }, uB: { value: hexC(S.b) }, uC: { value: hexC(S.c) } }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vN = mat3(modelViewMatrix) * normal; vV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float uT, uMode; uniform vec3 uA, uB, uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${noiseGlsl()}
      float fbm(vec2 p){ return 0.55 * n21(p) + 0.3 * n21(p * 2.1 + 3.7) + 0.15 * n21(p * 4.3 + 9.1); }
      vec3 hsv(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      ${VOR}
      void main(){
        vec3 col; vec2 u = vUv;
        vec3 N0 = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), V0 = normalize(vV); float fr = max(dot(N0, V0), 0.0);
        if (uMode < 0.5) {
          float n = fbm(vec2(u.x * 16.0, u.y * 11.0 - uT * 1.1));
          col = mix(uA, uB, smoothstep(0.32, 0.62, n)) + uC * pow(smoothstep(0.52, 0.8, n), 2.0) * 1.1;
        } else if (uMode < 1.5) {
          float k = floor(uT * 11.0), v = 1.0 - smoothstep(0.0, 0.045, abs(n21(vec2(u.x * 11.0 + k * 3.7, u.y * 7.0 + k * 1.3)) - 0.5));
          col = mix(uA, uB, 0.5 + 0.5 * n21(vec2(u.x * 5.0, u.y * 4.0 - uT * 0.4))) + uC * v * 1.8;
        } else if (uMode < 2.5) {
          col = hsv(fract(u.y * 1.4 + u.x * 0.6 - uT * 0.28)) * 0.62;
        } else if (uMode < 3.5) {
          col = mix(uA, uB, smoothstep(0.25, 0.75, fbm(vec2(u.x * 9.0 + uT * 0.05, u.y * 7.0)))) * 1.1;
          vec2 g = floor(u * vec2(90.0, 70.0));
          float s = step(0.965, h21(g));
          col += uC * s * (0.6 + 0.6 * sin(uT * 3.0 + h21(g + 3.0) * 40.0)) * 1.8;
        } else if (uMode < 4.5) {
          col = mix(uB, uA, 0.5 + 0.5 * sin(u.y * 26.0 + u.x * 9.0)) * 0.7;
          col += uC * pow(max(0.0, sin((u.y * 3.0 + u.x) * 3.2 - uT * 2.2)), 18.0) * 1.6;
        } else if (uMode < 5.5) {
          // The Hacker, after the one in Flashdeck's de_dust2 animation: a black stick figure (his green lens is the face and
          // gear.js 'monocle'), code raining faintly down him in two layers, each glyph a little grid of lit cells that keeps
          // changing, white hot at the head of each stream. Round him a wallhack's green outline, and a thin scan line going
          // up. The hacks show through: every so often bands of him tear sideways and the code in them burns at full strength,
          // with pink and cyan fringes on the tears, and every few seconds all of him flares up with it for a moment. The head
          // keeps only the outline and the tears, so the face reads. (Every h21 here is given whole numbers: on Android it
          // reads them from a texture.)
          float gt = floor(uT * 6.0), gOn = step(0.92, h21(vec2(gt, 4.0)));
          float by = u.y * 22.0 + gt * 7.0, band = floor(by), torn = gOn * step(0.55, h21(vec2(band, gt)));
          float tear = torn * (h21(vec2(band, gt + 9.0)) - 0.5) * 0.24;
          float flick = step(0.975, h21(vec2(floor(uT * 8.0), 17.0))), hot = max(torn, flick);
          // The hands (the arm column below the wrist, see skins.js) are where the hacking happens: the code burns in them.
          float arm = step(0.75, u.x), glove = arm * (1.0 - step(0.378, u.y));
          float k = max(max(hot, glove * 0.85), (1.0 - step(0.74, u.y)) * 0.12);
          vec2 q = vec2(u.x + tear, u.y);
          col = uA * (0.85 + 0.15 * step(0.5, fract(u.y * 150.0)));
          if (k > 0.0) {
            vec3 rain = vec3(0.0);
            for (int L = 0; L < 2; L++) {
              float fl = float(L), cols = fl < 0.5 ? 44.0 : 76.0, rows = fl < 0.5 ? 30.0 : 52.0;
              float cx = floor(q.x * cols), sp = (0.55 + h21(vec2(cx, 1.0 + fl * 7.0)) * 1.3) * (1.0 - fl * 0.35);
              float y = q.y * rows + uT * sp * 5.5 + h21(vec2(cx, 3.0 + fl)) * 60.0, cell = floor(y);
              vec2 gg = (vec2(fract(q.x * cols), fract(y)) - vec2(0.16, 0.1)) / vec2(0.68, 0.8);
              float inside = step(0.0, gg.x) * step(gg.x, 0.999) * step(0.0, gg.y) * step(gg.y, 0.999);
              float gk = floor(uT * (1.5 + 7.0 * h21(vec2(cell, cx + 11.0))));
              float lit = step(0.42, h21(floor(gg * vec2(3.0, 5.0)) + vec2(cx * 3.0 + gk * 5.0, cell * 5.0 + fl * 101.0))) * inside;
              float len = 9.0 + h21(vec2(cx, 5.0 + fl)) * 20.0, s = fract(cell / len + h21(vec2(cx, 6.0 + fl)));
              float tail = pow(max(0.0, 1.0 - s / 0.8), 2.0), hd = step(s, 1.05 / len);
              rain += lit * (uB * tail * (1.15 - fl * 0.6) + vec3(0.7, 1.0, 0.82) * hd * (2.4 - fl * 1.1) + uC * tail * tail * 0.35);
            }
            float fb = fract(by), fe = (1.0 - smoothstep(0.0, 0.1, min(fb, 1.0 - fb))) * torn;
            col = mix(col + rain * k, fb < 0.5 ? vec3(1.0, 0.25, 0.85) : vec3(0.2, 1.0, 1.0), fe * 0.85);
          }
          float scan = pow(max(0.0, 1.0 - abs(fract(u.y * 0.55 - uT * 0.24) - 0.5) * 16.0), 2.0);
          col = mix(col, uC * 1.15, smoothstep(0.62, 0.93, 1.0 - fr) * 0.9) + uC * scan * 0.5;
          // A cuff of light at each wrist and a green line round each sole.
          float cuff = arm * (1.0 - smoothstep(0.002, 0.009, abs(u.y - 0.384))), sole = (1.0 - arm) * (1.0 - smoothstep(0.002, 0.008, abs(u.y - 0.02)));
          col += uC * (cuff + sole) * 1.5;
        } else if (uMode < 6.5) {
          // Aurora: curtains of light rising and swaying.
          float w = fbm(vec2(u.x * 5.0 + uT * 0.12, u.y * 1.2 - uT * 0.25));
          float band = pow(0.5 + 0.5 * sin(u.x * 26.0 + w * 7.0 + uT * 0.9), 3.0), rise = smoothstep(-0.1, 0.9, u.y + w * 0.35);
          col = uA * (0.55 + 0.4 * w) + mix(uB, uC, rise) * band * rise * 1.7 + uC * pow(band, 10.0) * rise * 0.9;
          col += vec3(1.0) * step(0.992, h21(floor(u * vec2(120.0, 90.0)))) * (0.5 + 0.5 * sin(uT * 4.0 + u.x * 40.0));
        } else if (uMode < 7.5) {
          // Molten rock: dark stone split by glowing cracks that pulse.
          vec3 v = vor(u * vec2(16.0, 12.0) + vec2(0.0, -uT * 0.04));
          float e = v.y - v.x, crack = 1.0 - smoothstep(0.0, 0.09, e), core = 1.0 - smoothstep(0.0, 0.03, e);
          float pulse = 0.65 + 0.35 * sin(uT * 2.2 - u.y * 9.0 + v.z * 6.28), rock = 0.55 + 0.45 * fbm(u * vec2(30.0, 24.0));
          col = uA * rock * (0.8 + v.z * 0.5) + uB * crack * 1.5 * pulse + uC * core * 1.8 * pulse;
          col += uB * pow(fbm(vec2(u.x * 8.0, u.y * 6.0 - uT * 0.5)), 3.0) * 0.6;
        } else if (uMode < 8.5) {
          // Crystal: cut facets that catch the light as they turn, rainbow fire inside, sparkles.
          vec3 v = vor(u * vec2(13.0, 10.0));
          float face = fract(v.z * 7.0 + dot(N0, vec3(0.6, 0.9, 0.3)) * 1.4), sh = pow(0.5 + 0.5 * sin(face * 6.283 + uT * 0.8), 2.0);
          col = mix(uA, uB, v.z) * (0.45 + 0.8 * sh) + hsv(fract(v.z + fr * 0.6 + uT * 0.04)) * 0.32 * sh;
          col += uC * (1.0 - smoothstep(0.0, 0.05, v.y - v.x)) * 1.1;
          col += uC * step(0.988, h21(floor(u * vec2(90.0, 70.0)) + floor(uT * 4.0))) * 3.0;
        } else if (uMode < 9.5) {
          // Deep space: clouds of light folding into each other, and stars.
          vec2 p = u * vec2(7.0, 5.0);
          float a = fbm(p + vec2(uT * 0.15, -uT * 0.1)), b = fbm(p * 1.8 + a * 3.5 - vec2(0.0, uT * 0.22));
          col = uA + uB * pow(b, 2.2) * 1.8 + uC * pow(smoothstep(0.5, 0.9, b), 3.0) * 2.4;
          vec2 g = floor(u * vec2(110.0, 80.0));
          col += vec3(1.0) * step(0.985, h21(g)) * (0.4 + 0.6 * sin(uT * 3.0 + h21(g + 5.0) * 30.0)) * 1.6;
        } else if (uMode < 10.5) {
          // Circuits: traces with pulses running along them and nodes that blink.
          vec2 g = u * vec2(28.0, 20.0), i = floor(g), f = fract(g);
          float hx = step(0.42, h21(i)), vy = step(0.58, h21(i + 9.0));
          float lh = hx * (1.0 - smoothstep(0.035, 0.09, abs(f.y - 0.5))), lv = vy * (1.0 - smoothstep(0.035, 0.09, abs(f.x - 0.5))), line = max(lh, lv);
          float ph = pow(fract(g.x * 0.12 - uT * 0.6 + h21(vec2(i.y, 3.0))), 8.0) * lh, pv = pow(fract(g.y * 0.12 - uT * 0.6 + h21(vec2(i.x, 5.0))), 8.0) * lv;
          float node = (1.0 - smoothstep(0.1, 0.17, length(f - 0.5))) * hx * vy;
          col = uA + uB * line * 1.2 + uC * ((ph + pv) * 2.6 + node * (1.0 + 0.5 * sin(uT * 5.0 + h21(i) * 20.0)) + line * 0.25);
          col += uB * 0.3 * fbm(u * vec2(10.0, 8.0) + uT * 0.1);
        } else if (uMode < 11.5) {
          // Scales that shimmer in every colour as you turn.
          vec2 p = u * vec2(30.0, 24.0);
          p.x += 0.5 * mod(floor(p.y), 2.0);
          vec2 f = fract(p) - vec2(0.5, 0.0);
          float d = length(f * vec2(1.0, 1.25)), sc = 1.0 - smoothstep(0.5, 0.62, d), rim = smoothstep(0.38, 0.6, d) * sc;
          col = mix(uA, uB, f.y) * (0.45 + 0.55 * sc) + hsv(fract(fr * 0.9 + u.y * 0.35 + uT * 0.03)) * 0.38 * sc * (0.4 + f.y) + uC * rim * 0.9;
          col += uC * pow(max(0.0, sin((u.y * 2.0 + u.x) * 4.0 - uT * 1.8)), 16.0) * 0.8;
        } else if (uMode < 12.5) {
          // Spirit: smoke and wisps of light drifting up.
          float w = fbm(vec2(u.x * 9.0, u.y * 5.0 - uT * 0.45)), wisp = smoothstep(0.68, 0.94, fbm(vec2(u.x * 18.0 + w * 2.0, u.y * 3.0 - uT * 1.1)));
          col = (mix(uA, uB, w * w * w) + uC * wisp * 1.5) * (0.85 + 0.15 * sin(uT * 7.0 + u.y * 30.0));
        } else if (uMode < 13.5) {
          // A neon grid rolling up, and a sunset sweeping past.
          vec2 g = vec2(u.x * 22.0, u.y * 18.0 - uT * 0.9), f = abs(fract(g) - 0.5);
          float l = smoothstep(0.43, 0.48, max(f.x, f.y));
          col = mix(uA, uB, u.y) + uC * l * 1.5 + mix(vec3(1.0, 0.45, 0.2), uC, u.y) * pow(max(0.0, sin(u.y * 18.85 - uT * 2.0)), 30.0) * 0.6;
        } else {
          // Hologram: a different colour from every angle, with scan lines.
          col = mix(uA, hsv(fract(fr * 1.4 + u.y * 0.6 + u.x * 0.3 + uT * 0.08)), 0.75) * (0.7 + 0.3 * fbm(u * vec2(20.0, 16.0)));
          col += vec3(1.0) * 0.12 * step(0.5, fract(u.y * 120.0 - uT * 3.0)) + uC * pow(1.0 - fr, 3.0) * 0.6;
        }
        // The newer suits have a wave of light running up them every few seconds.
        if (uMode > 5.5) col += uC * pow(max(0.0, 1.0 - abs(fract(u.y * 0.7 - uT * 0.3) - 0.5) * 9.0), 3.0) * 0.4;
        vec3 N = N0;
        col *= 0.72 + 0.34 * max(N.y * 0.5 + 0.5, 0.0);
        col += uC * pow(1.0 - fr, 2.6) * (abs(uMode - 5.0) < 0.5 ? 0.0 : 0.32);
        gl_FragColor = vec4(min(col, vec3(4.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// The ribbon of light behind The Hacker: clean and smooth, a thin white hot core in a soft green glow, going deeper green and
// fading with age, a faint shimmer running back along it. The two crossed strips make it a tube from every side. uv.x is how
// old that part is (0 at the climber, 1 at the end), uv.y across.
const RIB_N = 36, RIB_LIFE = 0.55, CODE_BITS = 40;
// Its speedhack: copies of the climber in green light left behind while running fast, GHOSTS of them GHOST_DT apart, like the
// Hacker's blur in the video.
const GHOSTS = 3, GHOST_DT = 0.05, GHOST_FAST = 4.5;
function ribbonMat() {
  return new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uC: { value: new THREE.Color(0x40ff70) } }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float uT; uniform vec3 uC; varying vec2 vUv;
      void main(){
        float age = vUv.x, a = abs(vUv.y - 0.5) * 2.0;
        float fade = pow(1.0 - age, 1.6) * smoothstep(0.0, 0.08, age);
        float core = exp(-a * a * 70.0), glow = exp(-a * a * 5.0) * (1.0 - a);
        float shim = 0.85 + 0.15 * sin(age * 16.0 - uT * 12.0);
        vec3 col = uC * glow * 0.8 * shim + mix(vec3(0.85, 1.0, 0.9), uC, age) * core * 1.7;
        gl_FragColor = vec4(col, fade * min(1.0, glow * 0.65 + core * 0.7));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

let blobTex = null;
function shadowTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

export class Stickman {
  constructor(scene, slot) {
    const color = COLORS[slot % 4];
    this.color = color;
    this.g = new THREE.Group(); // at the physics centre, turned to face movement
    this.body = new THREE.Group(); // squash, lean and spin
    this.g.add(this.body);
    const limbMat = (this.limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.1), roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.6 }));
    // The head is the same colour as the body (a touch lighter), with a dark face drawn on it.
    const headMat = (this.headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.22), roughness: 0.3, metalness: 0.1, emissive: color, emissiveIntensity: 0.45 }));
    const ink = (this.inkMat = new THREE.MeshBasicMaterial({ color: 0x0a0d14 }));
    ink.userData.live = true;
    // These change colour while the game runs (the player's pick), so the native renderer must keep
    // checking them for changes; without this the phone never saw a new colour.
    for (const m of [limbMat, headMat]) m.userData.live = true;
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.scene = scene;
    this.limbs = []; // every body part that shows the suit
    const part = (geo, parent, x, y, z) => { const m = mesh(geo, limbMat, parent, x, y, z); this.limbs.push(m); return m; };
    const pivot = (parent, x, y, z) => {
      const p = new THREE.Group();
      p.position.set(x, y, z);
      parent.add(p);
      return p;
    };
    // Hips at +0.3 above the centre; legs reach the floor at -0.42.
    this.hips = pivot(this.body, 0, 0.3, 0);
    this.spine = pivot(this.hips, 0, 0, 0);
    part(G.torso, this.spine);
    this.neck = pivot(this.spine, 0, 0.5, 0);
    this.head = pivot(this.neck, 0, 0.22, 0);
    this.headMesh = mesh(G.head, headMat, this.head);
    this.limbs.push(this.headMesh);
    this.eyes = mesh(G.eyes, ink, this.head, 0, 0.035, 0.172);
    this.mouth = mesh(G.mouth, ink, this.head, 0, -0.07, 0.176);
    this.mouth.scale.set(1, 0.45, 1);
    // Drawn faces (shop) replace those two.
    const blank = (Stickman.blank || (Stickman.blank = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })));
    this.eyesP = mesh(G.eyesP.geo, blank, this.head, 0, G.eyesP.y, G.eyesP.z);
    this.mouthP = mesh(G.mouthP.geo, blank, this.head, 0, G.mouthP.y, G.mouthP.z);
    this.eyesP.castShadow = this.mouthP.castShadow = false;
    this.eyesP.visible = this.mouthP.visible = false;
    this.eyesP.renderOrder = this.mouthP.renderOrder = 3;
    this.faceStill = false;
    this.arms = SIDES.map((s, i) => {
      const sh = pivot(this.spine, s * SHOULDER_X, 0.46, 0);
      sh.rotation.order = 'XZY';
      part(G.upper[i], sh);
      const el = pivot(sh, 0, -0.29, 0);
      part(G.fore[i], el);
      return { sh, el, s };
    });
    this.legs = SIDES.map((s, i) => {
      const hp = pivot(this.hips, s * HIP_X, 0, 0);
      part(G.thigh[i], hp);
      const kn = pivot(hp, 0, -0.34, 0);
      part(G.shin[i], kn);
      return { hp, kn, s };
    });
    this.shieldMat = new THREE.MeshBasicMaterial({ color: HDR(0x7fd8ff, 1.4), transparent: true, opacity: 0.28, depthWrite: false });
    this.shieldMat.userData.live = true;
    this.shield = mesh(G.shield, this.shieldMat, this.g, 0, 0.25, 0);
    this.shield.castShadow = false;
    this.shield.visible = false;
    this.blob = new THREE.Mesh(G.blob, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, color: 0xffffff }));
    this.blob.renderOrder = 2;
    this.blob.material.userData.live = true;
    scene.add(this.g, this.blob);
    this.yaw = 0;
    this.phase = 0;
    this.squash = 0;
    this.spin = 0;
    this.t = Math.random() * 10;
    this.blinkT = 2;
    this.wasGround = true;
    // Life: idle moods, a cheer, head follow through on turns, and a flip angle the title runner sets.
    this.idleT = 0;
    this.idleNext = 2 + Math.random() * 3;
    this.idleAct = null;
    this.actT = 0;
    this.cheerT = 0;
    this.flip = 0;
    this.body.rotation.order = 'YXZ';
    this.emote = null; this.emoteT = 0; this.emRot = { x: 0, y: 0, z: 0 }; this.emLift = 0;
    this.yawVel = 0;
    this.climbPh = 0;
    // Skin state: extras made when first worn, and the trail of a legendary suit.
    this.gear = new Map();
    this.cape = null;
    this.capeA = 0;
    this.shader = null;
    this.trail = null;
    this.trails = {};
    this.lookKey = '';
    // The weapon: rides on the climber and comes to the hands when aiming. Made when first carried.
    this.weapon = null;
    this.gunRoot = null;
    this.guns = new Map();
    this.gunK = 0;
    this.gunInfo = null;
    this.spinner = null;
    this.kick = 0;
    this.lastShotSeen = 9;
    this.flash = null;
  }

  setWeapon(w) {
    if (w === this.weapon) return;
    this.weapon = w;
    if (!w) { if (this.gunRoot) this.gunRoot.visible = false; return; }
    if (!this.gunRoot) {
      this.gunRoot = new THREE.Group();
      this.spine.add(this.gunRoot);
      const fm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.95 });
      fm.userData.live = true;
      this.flash = new THREE.Mesh(G.flash, fm);
      this.flash.visible = false;
      this.flash.renderOrder = 4;
      this.gunRoot.add(this.flash);
    }
    this.gunRoot.visible = true;
    for (const [, m] of this.guns) m.visible = false;
    let m = this.guns.get(w.id);
    const info = gunInfo(w.id);
    if (!m) {
      m = new THREE.Mesh(gearGeo(w.id), gearMat());
      m.scale.setScalar(GS);
      m.castShadow = true;
      if (info.spin) {
        const sp = new THREE.Mesh(gearGeo(info.spin), gearMat());
        sp.position.set(info.spinAt[0], info.spinAt[1], info.spinAt[2]);
        sp.castShadow = true;
        m.add(sp);
        m.userData.spinner = sp;
      }
      this.gunRoot.add(m);
      this.guns.set(w.id, m);
    }
    m.visible = true;
    this.gunInfo = info;
    this.spinner = m.userData.spinner || null;
    this.flash.position.set(info.muzzle[0] * GS, info.muzzle[1] * GS, info.muzzle[2] * GS + 0.04);
    const beam = BEAMS[w.beam];
    this.flash.material.color.setHex(beam ? beam.c : 0xffd890).multiplyScalar(3.4);
  }

  // Where a shot leaves, in the world, right now.
  muzzle(out) {
    if (!this.gunRoot || !this.gunInfo) return out.set(this.g.position.x, this.g.position.y + 0.75, this.g.position.z);
    const m = this.gunInfo.muzzle;
    this.gunRoot.updateWorldMatrix(true, false);
    return out.set(m[0] * GS, m[1] * GS, m[2] * GS).applyMatrix4(this.gunRoot.matrixWorld);
  }

  // Everything a climber wears (a resolved look, see skins.js).
  setLook(L) {
    if (!L || L.key === this.lookKey) return;
    this.lookKey = L.key;
    this.setWeapon(L.weapon || null);
    const S = L.suit;
    this.setColor(S.c);
    const plain = !S.p && !S.flag && !S.shader;
    if (plain) {
      for (const m of this.limbs) m.material = this.limbMat;
      this.headMesh.material = this.headMat;
      this.shader = null;
    } else {
      const m = suitMat(S);
      for (const o of this.limbs) o.material = m;
      this.shader = S.shader ? m : null;
    }
    // Face: the classic one is real little shapes that blink and shout, the others are drawn.
    const light = suitIsDark(S), classic = L.face.id === 'smile';
    this.inkMat.color.setHex(light ? 0xf4f6ff : 0x0a0d14);
    this.eyes.visible = this.mouth.visible = classic;
    this.eyesP.visible = this.mouthP.visible = !classic;
    this.faceStill = !!L.face.still;
    if (!classic) { this.eyesP.material = faceMat(L.face, 'eyes', light); this.mouthP.material = faceMat(L.face, 'mouth', light); }
    // Hat, hair and the suit's own extras. Picked hair takes the place of a suit's own. A hat hides the hair's top layer
    // (or all of it, for a closed helmet) and sits a little bigger on what is left.
    const want = new Set(S.gear || []), hatId = L.hat.id !== 'none' ? L.hat.id : null, picked = L.hair && L.hair.id !== 'none' ? L.hair.id : null;
    let hair = picked;
    for (const id of want) if (HAIR_TOP[id]) { want.delete(id); hair = hair || id; }
    let cover = coverOf(hatId);
    for (const id of want) if (coverOf(id) === 'all') cover = 'all';
    if (hair && cover !== 'all') { want.add(hair); if (!cover) want.add(HAIR_TOP[hair]); }
    if (hatId) want.add(hatId);
    for (const [id, m] of this.gear) m.visible = want.has(id);
    for (const id of want) {
      if (this.gear.has(id)) continue;
      const at = GEAR_AT[id];
      let m;
      if (at === 'wings') {
        // Two wings on the shoulder blades, each turning on its own root.
        m = new THREE.Group();
        m.position.set(0, 0.4, -0.1);
        const l = new THREE.Mesh(gearGeo(id), gearMat()), r = new THREE.Mesh(gearGeoMirror(id), gearMat());
        l.position.x = 0.03; r.position.x = -0.03;
        l.castShadow = r.castShadow = true;
        m.add(l, r);
        m.userData.anim = 'flap'; m.userData.l = l; m.userData.r = r;
        this.spine.add(m);
      } else {
        m = new THREE.Mesh(gearGeo(id), gearMat());
        m.castShadow = true;
        if (GEAR_ANIM[id]) m.userData.anim = GEAR_ANIM[id];
        (at === 'hips' || at === 'tail' ? this.hips : at === 'back' || at === 'chest' ? this.spine : this.head).add(m);
      }
      this.gear.set(id, m);
    }
    if (hatId) this.gear.get(hatId).scale.setScalar(hair && cover !== 'all' ? HAT_ON_HAIR : 1);
    // Cape: flags always have one, a few costumes too.
    const spec = S.flag || S.cape;
    this.capeShader = null;
    if (spec) {
      const mat = spec === 'shader' && S.shader ? (this.capeShader = legendCape(S)) : capeMat(spec);
      if (!this.cape) {
        this.cape = new THREE.Mesh(G.cape, mat);
        this.cape.position.set(0, 0.45, -0.13);
        this.cape.castShadow = true;
        this.spine.add(this.cape);
      }
      this.cape.material = mat;
      this.cape.visible = true;
    } else if (this.cape) this.cape.visible = false;
    // Legendary trail: sparkles, or for The Hacker a ribbon of light, falling code and ghosts (trailFx 'code'). Each kind is made once
    // and kept, like everything else here.
    if (S.trail) {
      const fx = S.trailFx === 'code' ? 'code' : 'spark';
      if (this.trail && this.trail.fx !== fx) this.trailVis(this.trail, false);
      const T = (this.trail = this.trails[fx] || (this.trails[fx] = fx === 'code' ? this.codeTrail() : this.sparkTrail()));
      T.off = false;
      for (const m of T.tint) m.color.set(S.trail).multiplyScalar(2.4);
      if (T.uC) T.uC.value.set(S.trail);
      this.trailVis(T, this.g.visible);
    } else if (this.trail) { this.trailVis(this.trail, false); this.trail.off = true; }
  }

  trailVis(T, on) {
    for (const o of T.parts) o.visible = on;
    // Ghosts only ever show when made, never when the trail comes back.
    if (T.ghosts && !on) for (const set of T.ghosts) for (const m of set) m.visible = false;
  }

  sparkTrail() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    mat.userData.live = true;
    const im = new THREE.InstancedMesh(G.spark, mat, 12);
    im.frustumCulled = false;
    im.userData.fastIM = true;
    this.trailZero(im);
    this.scene.add(im);
    return { fx: 'spark', parts: [im], tint: [mat], im, i: 0, acc: 0, p: Array.from({ length: 12 }, () => ({ x: 0, y: 0, z: 0, life: 0 })) };
  }

  // The Hacker's: a clean ribbon of light streaming out behind (two crossed strips so it shows from every side), now and then a
  // zero or a one dropping off the climber and flipping as it falls, and the speedhack ghosts.
  codeTrail() {
    const bits = (geo) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
      mat.userData.live = true;
      const im = new THREE.InstancedMesh(geo, mat, CODE_BITS);
      im.frustumCulled = false;
      im.userData.fastIM = true;
      this.trailZero(im);
      this.scene.add(im);
      return im;
    };
    const im0 = bits(G.bit0), im1 = bits(G.bit1), geo = new THREE.BufferGeometry(), V = RIB_N * 4, idx = [];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(V * 3), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(V * 2), 2));
    for (let i = 0; i + 1 < RIB_N; i++) for (const o of [0, 2]) { const a = i * 4 + o, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    geo.userData.live = true;
    const mat = ribbonMat(), ribbon = new THREE.Mesh(geo, mat);
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 2;
    this.scene.add(ribbon);
    // The speedhack ghosts: one set of the body's parts for each, placed by copying where the real ones were. Each ghost
    // keeps its own see-through material; on every new copy they all move one back, so the oldest is the faintest.
    const ghosts = [];
    for (let r = 0; r < GHOSTS; r++) {
      const gm = new THREE.MeshBasicMaterial({ color: 0x30ff70, transparent: true, opacity: 0.5 - r * 0.14, depthWrite: false, blending: THREE.AdditiveBlending });
      ghosts.push(this.limbs.map((o) => {
        const m = new THREE.Mesh(o.geometry, gm);
        m.matrixAutoUpdate = false;
        m.visible = false;
        m.renderOrder = 1;
        this.scene.add(m);
        return m;
      }));
    }
    return { fx: 'code', parts: [im0, im1, ribbon], tint: [im0.material, im1.material], uC: mat.uniforms.uC, uT: mat.uniforms.uT, im0, im1, geo, i: 0, acc: 0,
      p: Array.from({ length: CODE_BITS }, () => ({ x: 0, y: 0, z: 0, vy: 0, life: 0, max: 1, one: false, r: 0, s: 1 })), pts: [], pool: [], empty: false,
      ghosts, gAcc: 0, gx: 0, gz: 0 };
  }

  // A new speedhack ghost where the body is now, the older ones one step back; none while slow, so they run out.
  ghostStep(T, dt, x, z, fast) {
    T.gAcc += dt;
    if (T.gAcc < GHOST_DT) return;
    T.gAcc = 0;
    const G0 = T.ghosts, jump = Math.abs(x - T.gx) + Math.abs(z - T.gz) > 3;
    T.gx = x; T.gz = z;
    for (let r = GHOSTS - 1; r > 0; r--) {
      const a = G0[r], b = G0[r - 1];
      for (let j = 0; j < a.length; j++) {
        a[j].visible = b[j].visible && !jump;
        if (a[j].visible) { a[j].matrix.copy(b[j].matrix); a[j].matrixWorldNeedsUpdate = true; }
      }
    }
    if (fast) this.g.updateMatrixWorld(true);
    const a = G0[0];
    for (let j = 0; j < a.length; j++) {
      a[j].visible = fast && this.limbs[j].visible;
      if (a[j].visible) { a[j].matrix.copy(this.limbs[j].matrixWorld); a[j].matrixWorldNeedsUpdate = true; }
    }
  }

  trailZero(im) {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < im.count; i++) im.setMatrixAt(i, z);
    im.instanceMatrix.needsUpdate = true;
  }

  // Sparkles left behind while moving.
  trailStep(dt, x, y, z, moving, t, sp = 0) {
    const T = this.trail;
    if (!T || T.off) return;
    if (T.fx === 'code') { this.ghostStep(T, dt, x, z, sp > GHOST_FAST && this.g.visible); return this.codeStep(T, dt, x, y, z, moving, t); }
    T.acc += dt;
    if (moving && T.acc > 0.06) {
      T.acc = 0;
      const q = T.p[T.i];
      T.i = (T.i + 1) % T.p.length;
      q.x = x + (Math.random() - 0.5) * 0.35; q.y = y + 0.2 + (Math.random() - 0.5) * 0.7; q.z = z + (Math.random() - 0.5) * 0.35; q.life = 0.72;
    }
    const m = Stickman.m4 || (Stickman.m4 = new THREE.Matrix4());
    let any = false;
    T.p.forEach((q, i) => {
      if (q.life > 0) { q.life -= dt; q.y += dt * 0.5; any = true; }
      const k = Math.max(0, q.life / 0.72);
      m.makeScale(k, k, k).setPosition(q.x, q.y, q.z);
      T.im.setMatrixAt(i, m);
    });
    if (any || T.was) T.im.instanceMatrix.needsUpdate = true;
    T.was = any;
  }

  codeStep(T, dt, x, y, z, moving, t) {
    // Seen through the climber's own eyes (a maze garden) nothing new is left: it would fall right across the view.
    const on = moving && this.g.visible;
    // Only a few, small, so the trail stays clean.
    T.acc += dt;
    if (on && T.acc > 0.09) {
      T.acc = 0;
      const q = T.p[T.i];
      T.i = (T.i + 1) % T.p.length;
      q.x = x + (Math.random() - 0.5) * 0.7; q.y = y - 0.2 + Math.random() * 1.0; q.z = z + (Math.random() - 0.5) * 0.7;
      q.vy = -(0.6 + Math.random() * 1.2); q.life = q.max = 0.7 + Math.random() * 0.5; q.one = Math.random() < 0.5; q.r = Math.random() * 6.283; q.s = 0.5 + Math.random() * 0.35;
    }
    const m = Stickman.m4 || (Stickman.m4 = new THREE.Matrix4()), Z = Stickman.m0 || (Stickman.m0 = new THREE.Matrix4().makeScale(0, 0, 0));
    const sv = Stickman.sv || (Stickman.sv = new THREE.Vector3());
    let any = false;
    for (let i = 0; i < T.p.length; i++) {
      const q = T.p[i];
      let k = 0;
      if (q.life > 0) {
        q.life -= dt; q.y += q.vy * dt; q.r += dt * 2.5; any = true;
        // Now and then a digit flips, like the code on the suit.
        if (Math.random() < dt * 5) q.one = !q.one;
        k = Math.max(0, Math.min(1, (q.max - q.life) * 14, q.life / 0.35)) * q.s;
      }
      m.makeRotationY(q.r).scale(sv.set(k, k, k)).setPosition(q.x, q.y, q.z);
      T.im1.setMatrixAt(i, q.one && k > 0 ? m : Z);
      T.im0.setMatrixAt(i, !q.one && k > 0 ? m : Z);
    }
    if (any || T.was) { T.im0.instanceMatrix.needsUpdate = true; T.im1.instanceMatrix.needsUpdate = true; }
    T.was = any;
    this.ribbonStep(T, dt, x, y, z, on);
    T.uT.value = (t || 0) % 3600;
  }

  // The ribbon follows where the chest has been for the last half second, narrowing towards its end.
  ribbonStep(T, dt, x, y, z, on) {
    const P = T.pts, cy = y + 0.3;
    // A respawn or a teleport: start again rather than draw a streak across the map.
    if (P.length && Math.abs(x - P[0].x) + Math.abs(cy - P[0].y) + Math.abs(z - P[0].z) > 4) { for (const p of P) T.pool.push(p); P.length = 0; }
    for (const p of P) p.a += dt;
    while (P.length && (P[P.length - 1].a > RIB_LIFE || P.length > RIB_N)) T.pool.push(P.pop());
    if (on && (!P.length || Math.hypot(x - P[0].x, cy - P[0].y, z - P[0].z) > 0.1)) {
      const p = T.pool.pop() || {};
      p.x = x; p.y = cy; p.z = z; p.a = 0;
      P.unshift(p);
      if (P.length > RIB_N) T.pool.push(P.pop());
    }
    if (!P.length && T.empty) return;
    T.empty = !P.length;
    const pos = T.geo.attributes.position.array, uv = T.geo.attributes.uv.array, n = P.length;
    for (let i = 0; i < RIB_N; i++) {
      const live = i < n, p = n ? P[Math.min(i, n - 1)] : null, px = p ? p.x : x, py = p ? p.y : cy, pz = p ? p.z : z;
      const a = n ? P[Math.max(0, Math.min(i, n - 1) - 1)] : null, b = n ? P[Math.min(i + 1, n - 1)] : null;
      let dx = a && b ? a.x - b.x : 0, dz = a && b ? a.z - b.z : 1;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const u = live ? Math.min(1, p.a / RIB_LIFE) : 1, w = live ? 0.2 * (1 - u * 0.8) : 0, o = i * 12, k = i * 8;
      pos[o] = px; pos[o + 1] = py + w; pos[o + 2] = pz;
      pos[o + 3] = px; pos[o + 4] = py - w; pos[o + 5] = pz;
      pos[o + 6] = px - dz * w; pos[o + 7] = py; pos[o + 8] = pz + dx * w;
      pos[o + 9] = px + dz * w; pos[o + 10] = py; pos[o + 11] = pz - dx * w;
      uv[k] = u; uv[k + 1] = 1; uv[k + 2] = u; uv[k + 3] = 0; uv[k + 4] = u; uv[k + 5] = 1; uv[k + 6] = u; uv[k + 7] = 0;
    }
    T.geo.attributes.position.needsUpdate = true;
    T.geo.attributes.uv.needsUpdate = true;
  }

  // The player's chosen colour (body and head).
  setColor(hex) {
    if (hex === this.color) return;
    this.color = hex;
    this.limbMat.color.setHex(hex).lerp(WHITE, 0.1);
    this.limbMat.emissive.setHex(hex);
    this.headMat.color.setHex(hex).lerp(WHITE, 0.22);
    this.headMat.emissive.setHex(hex);
  }

  // Arms up and a little happy bounce (checkpoint, summit).
  cheer() {
    this.cheerT = 1.6;
  }

  // Start an emote or stunt from emotes.js. Starting one again restarts it.
  playEmote(id) {
    const e = EMOTE[id];
    if (!e) return;
    // A flip cut short: on to the next from the short way round.
    const R = this.emRot;
    R.x = Math.atan2(Math.sin(R.x), Math.cos(R.x)); R.y = Math.atan2(Math.sin(R.y), Math.cos(R.y)); R.z = Math.atan2(Math.sin(R.z), Math.cos(R.z));
    this.emote = e;
    this.emoteT = 0;
  }

  stopEmote() {
    this.emote = null;
  }

  // flags from the physics body (or network); gy = floor height below for the contact shadow;
  // faceYaw = where the player is aiming (used while F.AIM is set); shot = seconds since the last shot; elev = how far up
  // they are aiming, in radians.
  update(dt, x, y, z, vx, vy, vz, flags, charge, gy, faceYaw, shot = 9, elev = 0) {
    this.t += dt;
    this.g.position.set(x, y, z);
    const sp = Math.hypot(vx, vz), ground = !!(flags & F.GROUND), anchored = !!(flags & F.ANCHOR), aim = !!(flags & F.AIM);
    if ((aim || (shot < 0.45 && this.weapon)) && faceYaw !== undefined) {
      let d = faceYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 20);
    } else if (sp > 0.6 && !(flags & F.STUN)) {
      let d = Math.atan2(vx, vz) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    this.g.rotation.y = this.yaw;
    this.yawVel += ((this.yaw - (this.prevYaw ?? this.yaw)) / Math.max(dt, 1e-3) - this.yawVel) * Math.min(1, dt * 10);
    this.prevYaw = this.yaw;
    this.cheerT = Math.max(0, this.cheerT - dt);
    if (ground && !this.wasGround && vy < -3) this.squash = Math.min(1, -vy / 14);
    this.wasGround = ground;
    this.squash = Math.max(0, this.squash - dt * 4);

    const A = this.arms, L = this.legs, t = this.t;
    // Pose targets (rotation.x swings forward/back, rotation.z spreads sideways).
    let lean = 0, crouch = 0, armX = [0, 0], armZ = [0.18, 0.18], armY = [0, 0], elbow = [-0.25, -0.25], legX = [0, 0], knee = [0, 0], headX = 0, mouthO = 0.45;
    let headY = Math.max(-0.5, Math.min(0.5, -this.yawVel * 0.06)), headZ = 0, twist = 0, bounce = 0, breathe = 0;
    const idle = ground && sp <= 0.4 && !anchored && !(flags & (F.STUN | F.AIM | F.HANG | F.GRAPPLE));
    if (!idle) { this.idleT = 0; this.idleAct = null; }
    if (flags & F.DASH) {
      // Dash: flat out forward, arms and legs trailing.
      lean = 0.95; armX = [0.95, 0.95]; armZ = [0.45, 0.45]; elbow = [-0.1, -0.1]; legX = [0.75, 0.25]; knee = [0.5, 1.0]; headX = -0.55; mouthO = 1.1;
    } else if (flags & F.WALL) {
      // Sliding down a wall: hands out in front against it, feet braced.
      armX = [-1.75, -1.95]; armZ = [0.45, 0.45]; elbow = [-0.45, -0.45]; legX = [-0.75, -0.25]; knee = [1.0, 0.5]; lean = -0.12; headX = 0.15; mouthO = 0.8;
    } else if (flags & F.KICK) {
      // Flying jump kick: one leg out straight, arms flung back.
      lean = -0.3; legX = [-1.75, 0.55]; knee = [0.05, 1.1]; armX = [0.8, 0.5]; armZ = [1.0, 1.0]; elbow = [-0.3, -0.3]; mouthO = 1.1;
    } else if (flags & F.STUN) {
      if (this.stiff) {
        // Paralysed: rigid, shaking, for a long time. Spinning round for a minute would look silly.
        const tr = Math.sin(t * 38) * 0.05;
        armX = [-0.5 + tr, -0.5 - tr]; armZ = [0.7, 0.7]; elbow = [-0.9, -0.9]; legX = [0.1, -0.1]; knee = [0.15, 0.15]; headX = 0.25 + tr; headZ = tr; lean = 0.12; mouthO = 1.4;
      } else {
        this.spin += dt * 14;
        armZ = [1.4, 1.4]; legX = [0.5, -0.5]; knee = [0.6, 0.6]; mouthO = 1.2;
      }
    } else if (flags & F.GRAPPLE) {
      armX = [-2.9, -0.4]; armZ = [0.1, 0.5]; elbow = [0, -0.6]; legX = [0.3, -0.5]; knee = [0.8, 0.5]; mouthO = 0.9;
    } else if (anchored) {
      crouch = 0.12; lean = 0.35; armX = [-1.2, -1.2]; armZ = [0.5, 0.5]; elbow = [-0.6, -0.6]; legX = [-0.9, -0.9]; knee = [1.4, 1.4];
      if (flags & F.CHARGE) { armX = [-0.4 - charge, -0.4 - charge]; elbow = [-1.4, -1.4]; }
    } else if (flags & F.HANG) {
      armX = [-3.0, -2.9]; armZ = [0.25, 0.25]; elbow = [-0.1, -0.1];
      const sw = Math.sin(t * 3) * 0.3;
      legX = [sw, -sw]; knee = [0.3, 0.4]; mouthO = 0.9;
      if (vy > 0.5) {
        // Climbing the cord hand over hand, legs kicking.
        this.climbPh += dt * 10;
        const c = Math.sin(this.climbPh);
        armX = [-2.9 + c * 0.45, -2.9 - c * 0.45]; elbow = [-0.3 - Math.max(0, c) * 0.9, -0.3 - Math.max(0, -c) * 0.9];
        legX = [c * 0.5, -c * 0.5]; knee = [0.6 + c * 0.3, 0.6 - c * 0.3]; mouthO = 0.7;
      }
    } else if (!ground) {
      if (vy > 1) { armX = [-2.5, -2.6]; armZ = [0.4, 0.4]; legX = [-0.9, 0.2]; knee = [1.3, 0.6]; mouthO = 0.6; }
      else if (vy < -7) {
        // Cartoon panic: arms windmill, legs keep running in midair, mouth wide open.
        const w = t * 16;
        armX = [w % 6.283 - 3.14, (w + 3.14) % 6.283 - 3.14]; armZ = [0.7, 0.7]; elbow = [-0.2, -0.2];
        const r = Math.sin(t * 18);
        legX = [r * 0.9, -r * 0.9]; knee = [0.6 + r * 0.4, 0.6 - r * 0.4]; mouthO = 1.6;
      } else { armX = [-1.4, -1.5]; armZ = [0.9, 0.9]; legX = [-0.5, 0.3]; knee = [0.9, 0.5]; mouthO = 0.8; }
    } else if (sp > 0.4) {
      // Run cycle: exaggerated swing that speeds up with running speed.
      this.phase += dt * (4 + sp * 1.5);
      const k = Math.min(1, sp / 6), p = this.phase, s = Math.sin(p);
      legX = [s * 0.95 * k, -s * 0.95 * k];
      knee = [Math.max(0, -Math.cos(p)) * 1.3 * k + 0.1, Math.max(0, Math.cos(p)) * 1.3 * k + 0.1];
      armX = [-s * 1.0 * k, s * 1.0 * k]; armZ = [0.25, 0.25]; elbow = [-0.9 * k - 0.2, -0.9 * k - 0.2];
      lean = 0.22 * k;
      crouch = -Math.abs(Math.sin(p)) * 0.05 * k;
      headX = Math.sin(p * 2) * 0.06;
      // Shoulders twist against the hips, like a real run.
      twist = -s * 0.24 * k;
    } else {
      // Idle: breathing and a little sway, and every few seconds something to do.
      const b = Math.sin(t * 2.2);
      breathe = b;
      armZ = [0.22 + b * 0.04, 0.22 + b * 0.04];
      headX = Math.sin(t * 0.7) * 0.08;
      this.idleT += dt;
      if (!this.idleAct && this.idleT > this.idleNext) {
        this.idleAct = ['look', 'stretch', 'wave', 'tap', 'scratch', 'look'][(Math.random() * 6) | 0];
        this.actT = 0;
      }
      const a = this.idleAct, u = (this.actT += dt);
      if (a === 'look') headY += Math.sin(u * 2.2) * 0.9;
      else if (a === 'stretch') { armX = [-2.95, -2.95]; armZ = [0.35, 0.35]; lean = -0.18; mouthO = 1.1; headX = -0.25; }
      else if (a === 'wave') { armX[0] = -2.6; armZ[0] = 0.45 + Math.sin(u * 12) * 0.35; elbow[0] = -0.45; mouthO = 0.9; headY += 0.2; }
      else if (a === 'tap') { armX = [0.25, 0.25]; armZ = [0.75, 0.75]; elbow = [-1.7, -1.7]; legX[1] = -0.15; knee[1] = 0.2 + Math.max(0, Math.sin(u * 12)) * 0.35; headZ = 0.1; }
      else if (a === 'scratch') { armX[0] = -2.3; armZ[0] = 0.95; elbow[0] = -2.1 + Math.sin(u * 16) * 0.15; headZ = 0.18; mouthO = 0.6; }
      if (a && u > (a === 'look' ? 2.8 : a === 'stretch' ? 2.2 : 1.8)) { this.idleAct = null; this.idleT = 0; this.idleNext = 3 + Math.random() * 4; }
    }
    if (this.cheerT > 0 && !(flags & (F.STUN | F.AIM))) {
      const w = Math.sin(t * 14);
      armX = [-2.8 + w * 0.3, -2.8 - w * 0.3]; armZ = [0.6, 0.6]; elbow = [-0.2, -0.2]; mouthO = 1.5;
      if (ground) bounce = Math.abs(Math.sin(t * 9)) * 0.14;
    }
    // An emote takes over the pose. Poses stop when you run or leave the ground; flips keep going. Getting hit,
    // grabbing, aiming, zipping or dashing stops anything.
    let legZ = [0, 0], rx = 0, ry = 0, rz = 0, lift = 0;
    const E = this.emote;
    if (E) {
      this.emoteT += dt;
      const u = this.emoteT, k = E.loop ? 0 : u / E.dur;
      if (anchored || flags & (F.STUN | F.AIM | F.GRAPPLE | F.DASH) || (!E.flip && (sp > 1 || !ground)) || k >= 1) this.emote = null;
      else {
        const p = EP;
        p.lean = lean; p.crouch = crouch; p.armX = armX; p.armZ = armZ; p.elbow = elbow; p.legX = legX; p.legZ = legZ; p.knee = knee;
        p.headX = headX; p.headY = headY; p.headZ = headZ; p.twist = twist; p.bounce = bounce; p.mouthO = mouthO;
        p.rx = p.ry = p.rz = p.lift = 0;
        E.pose(p, u, k);
        lean = p.lean; crouch = p.crouch; armX = p.armX; armZ = p.armZ; elbow = p.elbow; legX = p.legX; legZ = p.legZ; knee = p.knee;
        headX = p.headX; headY = p.headY; headZ = p.headZ; twist = p.twist; bounce = p.bounce; mouthO = p.mouthO;
        rx = p.rx; ry = p.ry; rz = p.rz; lift = p.lift;
        // A flip with no real jump under it (the shop, or the moment before the jump shows up from another phone).
        if (E.hop && ground) lift += Math.sin(Math.min(1, k) * Math.PI) * 0.7;
      }
    }
    // The weapon comes to the hands while aiming and a moment after a shot, and each kind has its own way of being held: both
    // hands really reach for the grip and the barrel, wherever the gun is pointing.
    const W = this.weapon, H = W ? HOLDS[W.hold] : null, holding = !!W && (aim || shot < 0.45) && !(flags & (F.STUN | F.GRAPPLE | F.DASH));
    if (W) {
      this.gunK += ((holding ? 1 : 0) - this.gunK) * Math.min(1, dt * (holding ? 15 : 8));
      if (shot < this.lastShotSeen) this.kick = 1;
      this.lastShotSeen = shot;
      this.kick = Math.max(0, this.kick - dt * 9);
      const up = Math.max(-1.15, Math.min(1.15, elev)), rec = this.kick * this.kick;
      if (holding) {
        lean = H.lean - up * 0.32;
        twist = 0;
        crouch += H.crouch;
        headX = H.hx - up * 0.55;
        headZ = H.hz;
        headY = 0;
        mouthO = shot < 0.1 ? 0.9 : 0.4;
        if (ground && sp < 0.4) { legX = [H.stance[0], H.stance[1]]; knee = [H.stance[2], H.stance[3]]; }
      }
      const R0 = this.gunRoot, sl = SLUNG[H.sling], k = this.gunK;
      eHold.set(-up - lean - H.kick[1] * rec, 0, 0);
      qHold.setFromEuler(eHold);
      vHold.set(H.at[0], H.at[1] + H.kick[1] * rec * 0.08, H.at[2] - H.kick[0] * rec);
      R0.position.lerpVectors(sl.p, vHold, k);
      R0.quaternion.slerpQuaternions(sl.q, qHold, k);
      if (holding) {
        const info = this.gunInfo, G0 = R0.position, q = R0.quaternion;
        // The right hand on the grip, the left on the barrel. Each elbow out and down.
        const put = (i, hx, hy, hz, px) => {
          vHold.set(hx * GS, hy * GS, hz * GS).applyQuaternion(q);
          const a = reach(G0.x + vHold.x - A[i].s * SHOULDER_X, G0.y + vHold.y - 0.46, G0.z + vHold.z, px, -1, -0.25);
          armX[i] = a.ax; armZ[i] = A[i].s * a.az; armY[i] = a.ay; elbow[i] = a.el;
        };
        put(0, 0, -0.04, -0.01, -0.75);
        put(1, info.fore[0], info.fore[1] - 0.012, info.fore[2], 0.8);
      }
      R0.visible = true;
      if (this.spinner) this.spinner.rotation.z += dt * (shot < 0.25 ? 34 : 0);
      const fl = this.flash;
      fl.visible = holding && shot < 0.05;
      if (fl.visible) { const s = 0.7 + Math.random() * 0.8; fl.scale.set(s, s, s * (W.scope ? 1.6 : 1)); fl.rotation.z = Math.random() * 6.28; }
    }
    if (!(flags & F.STUN)) this.spin *= Math.exp(-dt * 6);
    const ease = Math.min(1, dt * 14), lerp = (o, k, v) => { o[k] += (v - o[k]) * ease; };
    const handEase = holding ? Math.min(1, dt * 34) : ease, lerpH = (o, k, v) => { o[k] += (v - o[k]) * handEase; };
    for (let i = 0; i < 2; i++) {
      lerpH(A[i].sh.rotation, 'x', armX[i]);
      lerpH(A[i].sh.rotation, 'z', A[i].s * armZ[i]);
      lerpH(A[i].sh.rotation, 'y', armY[i]);
      lerpH(A[i].el.rotation, 'x', elbow[i]);
      lerp(L[i].hp.rotation, 'x', legX[i]);
      lerp(L[i].hp.rotation, 'z', L[i].s * legZ[i]);
      lerp(L[i].kn.rotation, 'x', knee[i]);
    }
    lerp(this.spine.rotation, 'x', lean);
    lerp(this.spine.rotation, 'y', twist);
    lerp(this.head.rotation, 'x', headX);
    lerp(this.head.rotation, 'y', headY);
    lerp(this.head.rotation, 'z', headZ);
    lerp(this.hips.position, 'y', 0.3 - crouch - this.squash * 0.18 + bounce);
    this.spine.scale.y = 1 + breathe * 0.02;
    const sq = this.squash;
    this.body.scale.set(1 + sq * 0.25, 1 - sq * 0.3, 1 + sq * 0.25);
    const R = this.emRot;
    if (this.emote && this.emote.flip) { R.x = rx; R.y = ry; R.z = rz; }
    else {
      // Coming out of a turn the short way round.
      if (!this.emote && (R.x || R.y || R.z)) { R.x = Math.atan2(Math.sin(R.x), Math.cos(R.x)); R.y = Math.atan2(Math.sin(R.y), Math.cos(R.y)); R.z = Math.atan2(Math.sin(R.z), Math.cos(R.z)); }
      R.x += (rx - R.x) * ease; R.y += (ry - R.y) * ease; R.z += (rz - R.z) * ease;
      if (!this.emote) { if (Math.abs(R.x) < 1e-3) R.x = 0; if (Math.abs(R.y) < 1e-3) R.y = 0; if (Math.abs(R.z) < 1e-3) R.z = 0; }
    }
    this.emLift += (lift - this.emLift) * ease;
    if (Math.abs(this.emLift) < 1e-3) this.emLift = 0;
    this.body.rotation.set(this.flip + R.x, this.spin + R.y, R.z);
    // The whole body turns round its middle, not round the point between its feet and its chest.
    if (R.x || R.y || R.z || this.emLift) {
      EV.set(0, EMOTE_PIVOT, 0).applyEuler(this.body.rotation);
      this.body.position.set(-EV.x, EMOTE_PIVOT - EV.y + this.emLift, -EV.z);
    } else this.body.position.set(0, 0, 0);
    this.mouth.scale.y += (mouthO - this.mouth.scale.y) * ease;
    this.blinkT -= dt;
    const blink = this.blinkT < 0.1 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    this.eyes.scale.y = flags & F.STUN ? 0.3 : blink * (mouthO > 1.1 ? 1.5 : 1);
    if (this.eyesP.visible && !this.faceStill) {
      this.eyesP.scale.y = flags & F.STUN ? 0.4 : blink * (mouthO > 1.1 ? 1.15 : 1);
      this.mouthP.scale.y = Math.min(1.25, 0.8 + this.mouth.scale.y * 0.42);
    }
    if (this.shader) this.shader.uniforms.uT.value = t % 3600;
    if (this.capeShader) this.capeShader.uniforms.uT.value = t % 3600;
    // Wings beat slowly on the ground and hard in the air; orbs and rings go round.
    for (const m of this.gear.values()) {
      const an = m.userData.anim;
      if (!an || !m.visible) continue;
      if (an === 'flap') {
        const f = Math.sin(t * (ground ? 2.2 : 8)), a = 0.28 + f * (ground ? 0.1 : 0.32);
        m.userData.l.rotation.set(0, a, f * 0.12);
        m.userData.r.rotation.set(0, -a, -f * 0.12);
      } else if (an === 'rev') m.rotation.y = -((t * 2.2) % 6.2832);
      else m.rotation.y = (t * 1.3) % 6.2832;
    }
    if (this.cape && this.cape.visible) {
      // Streams out behind when running or falling, sways a little when standing.
      const want = 0.08 + Math.min(1, sp / 6) * 0.85 + (ground ? 0 : Math.min(0.5, Math.abs(vy) * 0.05)) + Math.sin(t * (3 + sp)) * (0.04 + sp * 0.012);
      this.capeA += (want - this.capeA) * Math.min(1, dt * 7);
      this.cape.rotation.x = this.capeA;
    }
    if (this.trail) this.trailStep(dt, x, y, z, sp > 0.8 || Math.abs(vy) > 1.5, t, sp);
    this.shield.visible = !!(flags & F.SHIELD);
    if (this.shield.visible) this.shieldMat.opacity = 0.22 + Math.sin(t * 20) * 0.06;
    // Contact shadow on the floor below, fading with height.
    const h = y - gy;
    this.blob.visible = gy > -1e8 && h < 12;
    if (this.blob.visible) {
      const k = Math.max(0.25, 1 - h / 12);
      this.blob.position.set(x, gy + 0.03, z);
      this.blob.scale.set(k, 1, k);
      this.blob.material.opacity = k;
    }
  }

  hide() {
    this.emote = null;
    this.g.visible = false;
    this.blob.visible = false;
    if (this.trail) this.trailVis(this.trail, false);
  }

  show() {
    this.g.visible = true;
    if (this.trail && !this.trail.off) this.trailVis(this.trail, true);
  }
}
