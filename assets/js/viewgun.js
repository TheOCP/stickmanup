// The weapon in your hands when the view goes to your eyes (inside a maze garden). The climber is hidden then, so this is
// what you see of yourself: your two stick arms, in your suit's colour, holding the gun low on the right. It sways as you
// run, comes up toward the middle while you aim, kicks and flashes when it fires, and dips out of the way when you stand
// right up against a wall. Watching a friend in a maze shows theirs.
import * as THREE from 'three';
import { gearGeo, gearMat, gunInfo } from './gear.js';
import { BEAMS } from './weapons.js';

const S = 0.36; // the gun's size here, next to the 1.3 it has in a climber's hands
// Where the gun sits in front of the eyes (right, up, forward), from the hip and while aiming.
const HIP = [0.15, -0.14, -0.3], AIM = [0.065, -0.115, -0.29];
// Where the arms come from, out of sight below the view, and where the hands hold the gun (its own units).
const SHOULDER = [new THREE.Vector3(0.24, -0.36, 0.06), new THREE.Vector3(-0.2, -0.38, 0.06)], GRIP = [0, -0.07, -0.012];
const hit = { nx: 0, ny: 0, nz: 0, d: 0 }, fwd = new THREE.Vector3(), hand = new THREE.Vector3(), dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class ViewGun {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.hold = new THREE.Group();
    this.root.add(this.hold);
    scene.add(this.root);
    this.guns = new Map();
    this.gun = null;
    this.id = null;
    this.info = null;
    const fm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.95 });
    fm.userData.live = true;
    this.flash = new THREE.Group();
    this.flash.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0).scale(1, 1, 2.6), fm), new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0).scale(2.2, 0.35, 0.9), fm), new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0).scale(0.35, 2.2, 0.9), fm));
    for (const m of this.flash.children) m.renderOrder = 4;
    this.flash.visible = false;
    this.hold.add(this.flash);
    this.flashMat = fm;
    // The arms: a stick from the shoulder and a round hand, like the climber's own.
    this.armMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1, emissive: 0x000000, emissiveIntensity: 0.6 });
    this.armMat.userData.live = true;
    const stick = new THREE.CylinderGeometry(0.019, 0.023, 1, 10), ball = new THREE.SphereGeometry(0.024, 12, 8);
    this.arms = [0, 1].map(() => {
      const a = new THREE.Mesh(stick, this.armMat), h = new THREE.Mesh(ball, this.armMat);
      this.root.add(a, h);
      return { a, h };
    });
    this.k = 0;
    this.phase = 0;
    this.bob = 0;
    this.kick = 0;
    this.pull = 0;
    this.aim = 0;
    this.fired = false;
  }

  setWeapon(w) {
    const id = w && gunInfo(w.id) ? w.id : null;
    if (id === this.id) return;
    this.id = id;
    if (this.gun) this.gun.visible = false;
    this.gun = null;
    if (!id) return;
    let m = this.guns.get(id);
    const info = gunInfo(id);
    if (!m) {
      m = new THREE.Mesh(gearGeo(id), gearMat());
      if (info.spin) {
        const sp = new THREE.Mesh(gearGeo(info.spin), gearMat());
        sp.position.set(info.spinAt[0], info.spinAt[1], info.spinAt[2]);
        m.add(sp);
        m.userData.spinner = sp;
      }
      m.scale.setScalar(S);
      this.hold.add(m);
      this.guns.set(id, m);
    }
    m.visible = true;
    this.gun = m;
    this.info = info;
    this.flash.position.set(info.muzzle[0] * S, info.muzzle[1] * S, info.muzzle[2] * S + 0.015);
    const beam = BEAMS[w.beam];
    this.flashMat.color.setHex(beam ? beam.c : 0xffd890).multiplyScalar(3.4);
  }

  // k: how far the view is through the eyes (0 to 1). o: { weapon (from weapons.js), aim (bool), speed, ground (bool),
  // shot (seconds since the last shot), world (to feel for walls), rig (the climber, for the colour of the arms) }.
  update(dt, cam, k, o) {
    this.k = k;
    const on = k >= 0.72 && !!o && !!o.weapon;
    if (on) this.setWeapon(o.weapon);
    if (!on || !this.gun) { if (this.root.visible) this.root.visible = false; return; }
    this.root.visible = true;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    const e = (rate) => 1 - Math.exp(-dt * rate);
    this.aim += ((o.aim ? 1 : 0) - this.aim) * e(14);
    // Running sways it, standing still lets it settle.
    const run = o.ground ? Math.min(1, (o.speed || 0) / 6) : 0;
    this.phase += dt * (4 + 7 * run);
    this.bob += (run - this.bob) * e(8);
    // A shot kicks it back and up.
    if (o.shot < 0.03 && !this.fired) { this.kick = 1; this.fired = true; }
    if (o.shot >= 0.03) this.fired = false;
    this.kick *= Math.exp(-dt * 16);
    // Close to a wall: down and in, so it never pokes through.
    let free = 0.75;
    if (o.world) {
      const f = fwd.set(0, 0, -1).applyQuaternion(cam.quaternion), p = cam.position;
      free = o.world.castSphere(p.x, p.y, p.z, p.x + f.x * 0.75, p.y + f.y * 0.75, p.z + f.z * 0.75, 0.07, hit) * 0.75;
    }
    this.pull += (Math.max(0, Math.min(1, (0.62 - free) / 0.35)) - this.pull) * e(12);
    const a = this.aim, b = this.bob * (1 - a * 0.7), breathe = Math.sin(this.phase * 0.35) * 0.003 * (1 - a);
    const x = HIP[0] + (AIM[0] - HIP[0]) * a + Math.sin(this.phase) * 0.007 * b;
    const y = HIP[1] + (AIM[1] - HIP[1]) * a + Math.abs(Math.cos(this.phase)) * 0.009 * b + breathe - this.pull * 0.08;
    const z = HIP[2] + (AIM[2] - HIP[2]) * a + this.kick * 0.035 + this.pull * 0.06;
    this.hold.position.set(x, y, z);
    // Pointing a touch in toward the crosshair.
    this.hold.rotation.set(this.kick * 0.14 - this.pull * 0.9 + Math.sin(this.phase) * 0.01 * b, Math.PI + 0.07 - 0.04 * a, 0);
    this.hold.updateMatrix();
    // The hands on the grip and on the front of the gun, the arms from below the view up to them.
    const L = o.rig && o.rig.limbMat;
    if (L) { this.armMat.color.copy(L.color); this.armMat.emissive.copy(L.emissive); }
    const fore = this.info.fore || GRIP;
    for (let i = 0; i < 2; i++) {
      const at = i === 0 ? GRIP : fore, A = this.arms[i];
      hand.set(at[0] * S, at[1] * S, at[2] * S).applyMatrix4(this.hold.matrix);
      A.h.position.copy(hand);
      dir.subVectors(hand, SHOULDER[i]);
      const len = dir.length();
      A.a.position.copy(SHOULDER[i]).addScaledVector(dir, 0.5);
      A.a.quaternion.setFromUnitVectors(UP, dir.divideScalar(len || 1));
      A.a.scale.set(1, len, 1);
    }
    const sp = this.gun.userData.spinner;
    if (sp) sp.rotation.z += dt * (o.shot < 0.25 ? 34 : 0);
    const fl = this.flash;
    fl.visible = o.shot < 0.05;
    if (fl.visible) { const s = 0.25 + Math.random() * 0.25; fl.scale.set(s, s, s * (o.weapon.scope ? 1.6 : 1)); fl.rotation.z = Math.random() * 6.28; }
  }
}
