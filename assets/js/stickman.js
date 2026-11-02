// Neon stickmen with procedural, slightly silly animation. The physics body is a sphere (PR = 0.42)
// centred at the waist; the figure stands about 1.6 m tall with its feet on the floor.
import * as THREE from 'three';
import { F } from './player.js';
import { COLORS } from './colors.js';

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const WHITE = new THREE.Color(0xffffff);

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
const G = {
  thigh: limb(0.078, 0.34),
  shin: join(limb(0.068, 0.33), new THREE.BoxGeometry(0.13, 0.08, 0.24).translate(0, -0.35, 0.05)),
  upper: limb(0.066, 0.29),
  fore: join(limb(0.06, 0.27), new THREE.SphereGeometry(0.078, 10, 8).translate(0, -0.29, 0)),
  torso: new THREE.CapsuleGeometry(0.105, 0.38, 4, 14).translate(0, 0.27, 0),
  head: new THREE.SphereGeometry(0.2, 26, 20),
  eyes: join(new THREE.SphereGeometry(0.036, 10, 8).translate(-0.07, 0, 0), new THREE.SphereGeometry(0.036, 10, 8).translate(0.07, 0, 0)),
  mouth: new THREE.TorusGeometry(0.042, 0.014, 6, 16), shield: new THREE.SphereGeometry(0.95, 28, 20),
  // Blaster along the forearm's -y axis (forward when the arm points ahead): body, barrel and grip.
  gun: join(new THREE.BoxGeometry(0.09, 0.26, 0.11).translate(0, -0.08, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8).translate(0, -0.27, 0.01),
    new THREE.BoxGeometry(0.06, 0.06, 0.13).translate(0, 0.02, -0.08)),
  blob: new THREE.CircleGeometry(0.55, 28).rotateX(-Math.PI / 2),
};

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
    const ink = new THREE.MeshBasicMaterial({ color: 0x0a0d14 });
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
    const pivot = (parent, x, y, z) => {
      const p = new THREE.Group();
      p.position.set(x, y, z);
      parent.add(p);
      return p;
    };
    // Hips at +0.3 above the centre; legs reach the floor at -0.42.
    this.hips = pivot(this.body, 0, 0.3, 0);
    this.spine = pivot(this.hips, 0, 0, 0);
    mesh(G.torso, limbMat, this.spine);
    this.neck = pivot(this.spine, 0, 0.5, 0);
    this.head = pivot(this.neck, 0, 0.22, 0);
    mesh(G.head, headMat, this.head);
    this.eyes = mesh(G.eyes, ink, this.head, 0, 0.035, 0.172);
    this.mouth = mesh(G.mouth, ink, this.head, 0, -0.07, 0.176);
    this.mouth.scale.set(1, 0.45, 1);
    this.arms = [-1, 1].map((s) => {
      const sh = pivot(this.spine, s * 0.15, 0.46, 0);
      mesh(G.upper, limbMat, sh);
      const el = pivot(sh, 0, -0.29, 0);
      mesh(G.fore, limbMat, el);
      // The right hand (x < 0 when facing +z) holds the blaster while aiming.
      if (s < 0) {
        this.gun = mesh(G.gun, gunMat, el, 0, -0.36, 0.02);
        this.gun.visible = false;
      }
      return { sh, el, s };
    });
    this.legs = [-1, 1].map((s) => {
      const hp = pivot(this.hips, s * 0.09, 0, 0);
      mesh(G.thigh, limbMat, hp);
      const kn = pivot(hp, 0, -0.34, 0);
      mesh(G.shin, limbMat, kn);
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
    this.yawVel = 0;
    this.climbPh = 0;
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
    if (flags & F.STUN) {
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
    this.body.rotation.set(this.flip, this.spin, 0);
    this.mouth.scale.y += (mouthO - this.mouth.scale.y) * ease;
    this.blinkT -= dt;
    const blink = this.blinkT < 0.1 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    this.eyes.scale.y = flags & F.STUN ? 0.3 : blink * (mouthO > 1.1 ? 1.5 : 1);
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
    this.g.visible = false;
    this.blob.visible = false;
  }

  show() {
    this.g.visible = true;
  }
}
