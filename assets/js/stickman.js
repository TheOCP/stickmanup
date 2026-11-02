// Neon stickmen with procedural, slightly silly animation. The physics body is a sphere (PR = 0.42)
// centred at the waist; the figure stands about 1.6 m tall with its feet on the floor.
import { noiseGlsl } from './pattern.js';
import * as THREE from 'three';
import { F } from './player.js';
import { EMOTE } from './emotes.js';
import { COLORS } from './colors.js';
import { COL_W, COL_BACK, COL_ARMS, ARM_W, TEX, FIG_TOP, FIG_H, BODY_W, ARM_SPAN, FACE_W, FACE_H, drawFace, paintSuit, paintCape, suitIsDark } from './skins.js';
import { gearGeo, gearMat, GEAR_AT } from './gear.js';

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const WHITE = new THREE.Color(0xffffff);
const EP = {}, EV = new THREE.Vector3(), EMOTE_PIVOT = 0.35;

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
  // Blaster along the forearm's -y axis (forward when the arm points ahead): body, barrel and grip.
  gun: join(new THREE.BoxGeometry(0.09, 0.26, 0.11).translate(0, -0.08, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8).translate(0, -0.27, 0.01),
    new THREE.BoxGeometry(0.06, 0.06, 0.13).translate(0, 0.02, -0.08)),
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
};

// ---------------------------------------------------------------- materials for skins (made once each, when first worn)
const texOf = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; };
const SUIT_MATS = new Map(), FACE_MATS = new Map(), CAPE_MATS = new Map();
function suitMat(suit) {
  let m = SUIT_MATS.get(suit.id);
  if (m) return m;
  if (suit.shader) m = legendMat(suit.shader);
  else {
    // Every suit tried on stays in memory for good, so they aren't painted any bigger than they're seen.
    const t = texOf(paintSuit(suit, 360));
    // The suit's own picture also glows a little, so it reads in the dark maps like the plain colours do.
    m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: suit.glow ?? 0.42, roughness: suit.rough ?? 0.5, metalness: suit.metal ?? 0.05 });
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
      void main(){
        vec3 col; vec2 u = vUv;
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
        } else {
          // Thin falling code on a black suit; the head stays black inside the hood so only the eyes show.
          float cx = floor(u.x * 92.0), sp = 1.0 + h21(vec2(cx, 1.0)) * 2.0, y = u.y * 74.0 + uT * sp * 5.0, cell = floor(y);
          float tail = fract(-y / 26.0 + h21(vec2(cx, 2.0))), glyph = step(0.4, h21(vec2(cx, cell) + floor(uT * 7.0))) * step(0.5, fract(u.x * 92.0));
          col = uA + (uB * glyph * pow(tail, 5.0) * 0.8 + uC * glyph * step(0.97, tail) * 0.9) * step(u.y, 0.74);
        }
        vec3 N = normalize(vN);
        col *= 0.72 + 0.34 * max(N.y * 0.5 + 0.5, 0.0);
        col += uC * pow(1.0 - max(dot(N, normalize(vV)), 0.0), 2.6) * (uMode > 4.5 ? 0.05 : 0.32);
        gl_FragColor = vec4(min(col, vec3(4.0)), 1.0);
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
    const gunMat = (this.gunMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.35, metalness: 0.7, emissive: color, emissiveIntensity: 0.35 }));
    // These change colour while the game runs (the player's pick), so the native renderer must keep
    // checking them for changes; without this the phone never saw a new colour.
    for (const m of [limbMat, headMat, this.gunMat]) m.userData.live = true;
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
      part(G.upper[i], sh);
      const el = pivot(sh, 0, -0.29, 0);
      part(G.fore[i], el);
      // The right hand (x < 0 when facing +z) holds the blaster while aiming.
      if (s < 0) {
        this.gun = mesh(G.gun, gunMat, el, 0, -0.36, 0.02);
        this.gun.visible = false;
      }
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
    this.lookKey = '';
  }

  // Everything a climber wears (a resolved look, see skins.js).
  setLook(L) {
    if (!L || L.key === this.lookKey) return;
    this.lookKey = L.key;
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
    // Hat and the suit's own extras.
    const want = new Set(S.gear || []);
    if (L.hat.id !== 'none') want.add(L.hat.id);
    for (const [id, m] of this.gear) m.visible = want.has(id);
    for (const id of want) {
      if (this.gear.has(id)) continue;
      const m = new THREE.Mesh(gearGeo(id), gearMat());
      m.castShadow = true;
      (GEAR_AT[id] === 'hips' ? this.hips : this.head).add(m);
      this.gear.set(id, m);
    }
    // Cape: flags always have one, a few costumes too.
    const spec = S.flag || S.cape;
    if (spec) {
      if (!this.cape) {
        this.cape = new THREE.Mesh(G.cape, capeMat(spec));
        this.cape.position.set(0, 0.45, -0.13);
        this.cape.castShadow = true;
        this.spine.add(this.cape);
      }
      this.cape.material = capeMat(spec);
      this.cape.visible = true;
    } else if (this.cape) this.cape.visible = false;
    // Legendary trail.
    if (S.trail) {
      if (!this.trail) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
        mat.userData.live = true;
        const im = new THREE.InstancedMesh(G.spark, mat, 12);
        im.frustumCulled = false;
        im.userData.fastIM = true;
        this.trailZero(im);
        this.scene.add(im);
        this.trail = { im, mat, i: 0, acc: 0, p: Array.from({ length: 12 }, () => ({ x: 0, y: 0, z: 0, life: 0 })) };
      }
      this.trail.mat.color.set(S.trail).multiplyScalar(2.4);
      this.trail.im.visible = this.g.visible;
    } else if (this.trail) { this.trail.im.visible = false; this.trail.off = true; }
    if (this.trail) this.trail.off = !S.trail;
  }

  trailZero(im) {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < im.count; i++) im.setMatrixAt(i, z);
    im.instanceMatrix.needsUpdate = true;
  }

  // Sparkles left behind while moving.
  trailStep(dt, x, y, z, moving) {
    const T = this.trail;
    if (!T || T.off) return;
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

  // The player's chosen colour (body, head and the blaster's glow).
  setColor(hex) {
    if (hex === this.color) return;
    this.color = hex;
    this.limbMat.color.setHex(hex).lerp(WHITE, 0.1);
    this.limbMat.emissive.setHex(hex);
    this.headMat.color.setHex(hex).lerp(WHITE, 0.22);
    this.headMat.emissive.setHex(hex);
    this.gunMat.emissive.setHex(hex);
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
  // faceYaw = where the player is aiming (used while F.AIM is set); shot = seconds since the last shot.
  update(dt, x, y, z, vx, vy, vz, flags, charge, gy, faceYaw, shot = 9) {
    this.t += dt;
    this.g.position.set(x, y, z);
    const sp = Math.hypot(vx, vz), ground = !!(flags & F.GROUND), anchored = !!(flags & F.ANCHOR), aim = !!(flags & F.AIM);
    if (aim && faceYaw !== undefined) {
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
    let lean = 0, crouch = 0, armX = [0, 0], armZ = [0.18, 0.18], elbow = [-0.25, -0.25], legX = [0, 0], knee = [0, 0], headX = 0, mouthO = 0.45;
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
      this.spin += dt * 14;
      armZ = [1.4, 1.4]; legX = [0.5, -0.5]; knee = [0.6, 0.6]; mouthO = 1.2;
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
    // Aiming overrides the arms: right arm straight ahead with the blaster, left hand steadying it.
    if (aim && !(flags & (F.STUN | F.GRAPPLE))) {
      armX[0] = -1.57 - (shot < 0.12 ? 0.35 * (1 - shot / 0.12) : 0); armZ[0] = 0.05; elbow[0] = 0;
      armX[1] = -1.25; armZ[1] = -0.45; elbow[1] = -0.5;
      if (ground && sp < 0.4) { legX = [-0.25, 0.3]; knee = [0.25, 0.1]; }
    }
    if (this.gun) this.gun.visible = aim || shot < 0.4;
    if (!(flags & F.STUN)) this.spin *= Math.exp(-dt * 6);
    const ease = Math.min(1, dt * 14), lerp = (o, k, v) => { o[k] += (v - o[k]) * ease; };
    for (let i = 0; i < 2; i++) {
      lerp(A[i].sh.rotation, 'x', armX[i]);
      lerp(A[i].sh.rotation, 'z', A[i].s * armZ[i]);
      lerp(A[i].el.rotation, 'x', elbow[i]);
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
    if (this.cape && this.cape.visible) {
      // Streams out behind when running or falling, sways a little when standing.
      const want = 0.08 + Math.min(1, sp / 6) * 0.85 + (ground ? 0 : Math.min(0.5, Math.abs(vy) * 0.05)) + Math.sin(t * (3 + sp)) * (0.04 + sp * 0.012);
      this.capeA += (want - this.capeA) * Math.min(1, dt * 7);
      this.cape.rotation.x = this.capeA;
    }
    if (this.trail) this.trailStep(dt, x, y, z, sp > 0.8 || Math.abs(vy) > 1.5);
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
    if (this.trail) this.trail.im.visible = false;
  }

  show() {
    this.g.visible = true;
    if (this.trail && !this.trail.off) this.trail.im.visible = true;
  }
}
