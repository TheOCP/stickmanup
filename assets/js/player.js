// Climber movement: a sphere with platformer controls, GRAB, a reelable cord, SHIELD and GRAPPLE.
import { collideSphere, toLocal, toWorld } from './physics.js';

export const PR = 0.42;
export const PC = {
  G: -24, SPEED: 6.2, GACC: 55, AACC: 20, ICE_ACC: 9, ICE_DEC: 3, JUMP: 9.4, PAD: 16.5,
  COYOTE: 0.12, BUFFER: 0.14, MAXFALL: -34, WALL_DRAIN: 0.22, GROUND_DRAIN: 0.05, REGEN: 0.45,
  REEL: 4.6, UNREEL: 3.0, CLIMB: 4.6, DRAG: 6.5, SHIELD: 1.0, SHIELD_CD: 2.2, ZIP: 19,
};
export const F = { GROUND: 1, ANCHOR: 2, ICE: 4, STUN: 8, CHARGE: 16, REEL: 32, MOVE: 64, SHIELD: 128, GRAPPLE: 256, HANG: 512, AIM: 1024 };

// How hard a robot resists the cord: clamped robots are immovable, grounded ones have grip.
export function invMass(flags) {
  if (flags & F.ANCHOR) return 0;
  if (flags & F.STUN) return 1;
  if (flags & F.GROUND) return flags & F.ICE ? 0.8 : 0.35;
  return 1;
}

const tmp = { x: 0, y: 0, z: 0 }, loc = { x: 0, y: 0, z: 0 }, hit = { nx: 0, ny: 0, nz: 0, d: 0 }, wind = { x: 0, y: 0, z: 0 };

// The cord between two climbers, applied by each phone to its own climber (me) against where it sees
// its partner (op: x, y, z, vy, flags). It pulls only past length L, softly and capped.
// ch (optional) is a bead chain draped over the geometry. Its first bead gives the way the cord leaves
// me (up over a ledge edge), and while one climber hangs well below the other its path length counts,
// so walking away from an edge hauls the partner up. At similar heights only the straight distance
// counts, so walking around pillars and corners never snags the cord or yanks anyone back.
// Returns how far past its length the cord is (negative = slack), or null when the gap is unrealistic.
export function cord(me, op, L, env, maxGap, ch, mine) {
  const dx = op.x - me.x, dy = op.y - me.y, dz = op.z - me.z, d = Math.hypot(dx, dy, dz);
  // A partner far beyond cord length means a teleport (respawn, late join): wait for fresh positions.
  if (d > maxGap || d < 1e-4) return null;
  const dir = ch && ch.ok ? (mine ? ch.dirA : ch.dirB) : null;
  const len = dir && Math.abs(dy) > 1.5 ? Math.max(d, Math.min(ch.len, d * 1.6)) : d;
  const ex = len - L;
  let ux = dx / d, uy = dy / d, uz = dz / d;
  // Trust the draped direction only while it still leads roughly toward the partner.
  if (dir && dir.x * ux + dir.y * uy + dir.z * uz > -0.2) { ux = dir.x; uy = dir.y; uz = dir.z; }
  const below = !(op.flags & (F.GROUND | F.ANCHOR)) && op.y < me.y - 1.2;
  // PULL: on solid ground, holding REEL with a partner hanging below plants your feet and hauls them in.
  const pulling = below && me.grounded && me.reelHeld;
  if (ex > 0.02) {
    // Hauling: a climber walking on solid ground with the partner hanging below holds firmer.
    const wm = me.invMass() * (pulling ? 0.12 : below && me.grounded && me.moving ? 0.4 : 1), wo = invMass(op.flags), s = wm + wo;
    // Springy and capped, so lag or a big gap never yanks anyone across the map in one step.
    if (s > 0) { me.pull(ux, uy, uz, Math.min(ex * 0.6, 0.3), wm / s); me.collide(env); }
  }
  if (ex > -0.15 && below && !pulling && (op.vy === undefined || op.vy <= 1)) me.dragToward(ux, uz);
  const free = !me.grounded && !me.anchored && !me.hook;
  if (free && ex > -0.15 && op.y > me.y + 0.8) me.hanging = true;
  // CLIMB (me holding REEL) or being PULLED (partner holding REEL): go up the cord at a steady speed,
  // then step over the ledge onto the partner's floor once level with it.
  if (free && ex > -0.6 && (me.reelHeld || op.flags & F.REEL)) {
    if (op.y > me.y + 0.8) me.vy = Math.max(me.vy, PC.CLIMB);
    else if (op.flags & (F.GROUND | F.ANCHOR) && op.y > me.y - 0.5) {
      const h = Math.hypot(dx, dz);
      if (h > 1.1) { me.vy = Math.max(me.vy, 2.4); me.vx = (dx / h) * 3.4; me.vz = (dz / h) * 3.4; }
    }
  }
  return ex;
}

export class Body {
  constructor() {
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.events = [];
    this.reset();
  }

  reset() {
    this.vx = this.vy = this.vz = 0;
    this.grounded = false; this.ground = null; this.onIce = false;
    this.contact = null; this.contactT = -1; this.time = 0;
    this.anchored = false; this.anchorCol = null; this.anchorL = { x: 0, y: 0, z: 0 }; this.anchorWall = false;
    this.grip = 1; this.gripLock = false;
    this.coyote = 0; this.buffer = 0; this.jumpHeld = false; this.stun = 0;
    this.reel = 0; this.charge = 0; this.moving = false;
    this.peakY = this.y; this.impact = 0;
    this.drag = { x: 0, z: 0, on: false };
    this.shield = 0; this.shieldCd = 0; this.thrown = 0; this.hook = null; this.hookT = 0; this.hanging = false; this.airT = 0;
  }

  spawn(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.reset();
  }

  get flags() {
    return (this.grounded ? F.GROUND : 0) | (this.anchored ? F.ANCHOR : 0) | (this.onIce ? F.ICE : 0) |
      (this.stun > 0 ? F.STUN : 0) | (this.charge > 0 ? F.CHARGE : 0) | (this.reel > 0.05 ? F.REEL : 0) | (this.moving ? F.MOVE : 0) |
      (this.shield > 0 ? F.SHIELD : 0) | (this.hook ? F.GRAPPLE : 0) | (this.hanging ? F.HANG : 0) | (this.aim ? F.AIM : 0);
  }

  invMass() {
    return invMass(this.flags);
  }

  // inp: { mx, mz (world move dir, length <= 1), jump, jumpPressed, grab, reel }
  // env: { world, others: [{x,y,z}], wind(body, out), grip (drain multiplier), maxReel }
  step(dt, inp, env) {
    this.time += dt;
    this.buffer = inp.jumpPressed ? PC.BUFFER : Math.max(0, this.buffer - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.shieldCd = Math.max(0, this.shieldCd - dt);
    this.moving = Math.abs(inp.mx) + Math.abs(inp.mz) > 0.1;

    this.reelHeld = !!inp.reel;
    this.reel = inp.reel ? Math.min(this.reel + PC.REEL * dt, env.maxReel) : Math.max(0, this.reel - PC.UNREEL * dt);
    if (this.anchored && inp.reel) this.charge = Math.min(1, this.charge + dt / 0.9);
    else {
      if (this.anchored && this.charge > 0.2) this.events.push({ k: 'sling', charge: this.charge });
      this.charge = 0;
    }
    if (this.gripLock && this.grip > 0.3) this.gripLock = false;

    if (this.anchored) {
      const c = this.anchorCol;
      if (!c.on || !inp.grab || this.grip <= 0 || this.stun > 0) this.release();
      else {
        toWorld(c, this.anchorL, tmp);
        this.x = tmp.x; this.y = tmp.y; this.z = tmp.z;
        this.vx = this.vy = this.vz = 0;
        this.grip = Math.max(0, this.grip - (this.anchorWall ? PC.WALL_DRAIN : PC.GROUND_DRAIN) * env.grip * dt);
        if (this.grip <= 0) { this.gripLock = true; this.release(); this.events.push({ k: 'slip' }); }
        return;
      }
    } else if (this.grounded) this.grip = Math.min(1, this.grip + PC.REGEN * dt);

    if (this.hook) { this.zip(dt, env); return; }

    // Ride moving platforms.
    let pvx = 0, pvy = 0, pvz = 0;
    const g = this.grounded ? this.ground : null;
    if (g && (g.dyn || g.crumble)) {
      toLocal(g, this.x, this.y, this.z, true, loc);
      toWorld(g, loc, tmp);
      pvx = (tmp.x - this.x) / dt; pvy = (tmp.y - this.y) / dt; pvz = (tmp.z - this.z) / dt;
      this.x = tmp.x; this.y = tmp.y; this.z = tmp.z;
    }
    // Conveyor belts carry you along their length (and you keep that speed if you jump off). Water does the
    // same: down a water slide, or sideways across a lazy river (side: along the platform's width).
    if (g && g.conv) {
      const m = g.m, sp = g.conv.sp, a = g.conv.side ? 6 : 0;
      this.x += m[a] * sp * dt; this.z += m[a + 2] * sp * dt;
      pvx += m[a] * sp; pvz += m[a + 2] * sp;
    }

    // Steering. Strong wind loosens your footing.
    wind.x = wind.y = wind.z = 0;
    if (env.wind) env.wind(this, wind);
    const windy = Math.abs(wind.x) + Math.abs(wind.z) > 4;
    const ice = this.grounded && this.onIce;
    let acc = this.grounded ? (ice ? (this.moving ? PC.ICE_ACC : PC.ICE_DEC) : PC.GACC) : PC.AACC;
    // Thrown (grapple, sling): keep the flight; the stick only nudges it.
    this.thrown = this.grounded ? 0 : Math.max(0, this.thrown - dt);
    if (this.thrown > 0) acc *= this.moving ? 0.2 : 0;
    if (this.stun > 0) acc *= 0.15;
    if (windy && this.grounded) acc *= 0.35;
    // A partner hanging off the cord drags you: stand still and you slide, walk away to haul them up.
    const dragged = this.drag.on && this.grounded;
    // Walking away from the edge digs your feet in and hauls the partner up (slowly, they're heavy).
    const haul = dragged && inp.mx * this.drag.x + inp.mz * this.drag.z < -0.3;
    let speed = PC.SPEED;
    // Mud (and tar, wet sand, gum): about half speed.
    const mud = this.grounded && this.ground && this.ground.surf === 'mud';
    if (mud) speed *= 0.5;
    if (dragged) { acc *= haul ? 0.5 : this.moving ? 0.25 : 0.12; speed *= haul ? 0.42 : 0.4; }
    let dvx = inp.mx * speed - this.vx, dvz = inp.mz * speed - this.vz;
    const dl = Math.hypot(dvx, dvz), mx = acc * dt;
    if (dl > mx) { dvx *= mx / dl; dvz *= mx / dl; }
    this.vx += dvx; this.vz += dvz;
    if (dragged && !haul) { this.vx += this.drag.x * PC.DRAG * dt; this.vz += this.drag.z * PC.DRAG * dt; }
    this.drag.on = false;

    const wf = this.grounded ? (ice ? 1 : 0.8) : 1;
    this.vx += wind.x * wf * dt; this.vy += wind.y * dt; this.vz += wind.z * wf * dt;

    this.vy = Math.max(PC.MAXFALL, this.vy + PC.G * dt);

    let jumped = false;
    if (this.buffer > 0 && (this.grounded || this.coyote > 0) && this.stun <= 0) {
      this.vy = (mud ? PC.JUMP * 0.8 : PC.JUMP) + Math.max(0, pvy) * 0.5;
      this.vx += pvx; this.vz += pvz;
      this.buffer = 0; this.coyote = 0; this.jumpHeld = true; jumped = true;
      this.events.push({ k: 'jump' });
    }
    if (this.jumpHeld && !inp.jump) {
      if (this.vy > 3) this.vy *= 0.55;
      this.jumpHeld = false;
    }
    if (this.vy <= 0) this.jumpHeld = false;

    const was = this.grounded, fallV = this.vy;
    this.grounded = false; this.ground = null;
    // Three substeps keep fast falls from skipping through thin beams.
    for (let s = 0; s < 3; s++) {
      this.x += (this.vx * dt) / 3; this.y += (this.vy * dt) / 3; this.z += (this.vz * dt) / 3;
      this.collide(env);
    }
    // Stick to the floor when walking down slopes or off descending platforms.
    if (was && !this.grounded && !jumped && this.vy <= 0.5) {
      const sy = this.y;
      this.y -= 0.24;
      this.collide(env);
      if (!this.grounded) this.y = sy;
    }
    this.onIce = this.grounded && this.ground && this.ground.surf === 'ice';
    this.coyote = this.grounded ? PC.COYOTE : Math.max(0, this.coyote - dt);
    if (this.grounded && !was) this.events.push({ k: 'land', drop: this.peakY - this.y, v: -fallV });
    if (this.grounded) this.peakY = this.y;
    else this.peakY = Math.max(this.peakY, this.y);
    this.airT = this.grounded ? 0 : this.airT + dt;

    if (inp.grab && !this.anchored && !this.gripLock && this.stun <= 0 && this.contact && this.time - this.contactT < 0.12) this.anchor();
  }

  collide(env) {
    for (let it = 0; it < 3; it++) {
      let any = false;
      env.world.query(this.x, this.y, this.z, PR, (c) => {
        if (collideSphere(c, this.x, this.y, this.z, PR, hit)) { this.resolve(c); any = true; }
      });
      for (const o of env.others) {
        const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < PR * 2 && d > 1e-4) {
          hit.nx = dx / d; hit.ny = dy / d; hit.nz = dz / d; hit.d = PR * 2 - d;
          this.resolve(null);
          any = true;
        }
      }
      if (!any) break;
    }
  }

  resolve(c) {
    const { nx, ny, nz, d } = hit;
    this.x += nx * d; this.y += ny * d; this.z += nz * d;
    const vn = this.vx * nx + this.vy * ny + this.vz * nz;
    if (vn < 0) { this.vx -= nx * vn; this.vy -= ny * vn; this.vz -= nz * vn; }
    if (ny > 0.6) {
      if (c && c.surf === 'pad') {
        this.vy = PC.PAD;
        this.events.push({ k: 'pad' });
        return;
      }
      this.grounded = true;
      this.ground = c;
    }
    if (c) { this.contact = c; this.contactT = this.time; this.contactWall = ny < 0.6; }
  }

  anchor() {
    const c = this.contact;
    this.anchored = true;
    this.anchorCol = c;
    this.anchorWall = this.contactWall;
    toLocal(c, this.x, this.y, this.z, false, this.anchorL);
    this.vx = this.vy = this.vz = 0;
    this.events.push({ k: 'grab' });
  }

  release() {
    if (!this.anchored) return;
    this.anchored = false;
    this.anchorCol = null;
    this.events.push({ k: 'release' });
  }

  // Cord pull computed by the game: dir points from this robot along the cord.
  pull(dx, dy, dz, amount, share) {
    if (share <= 0) return;
    this.x += dx * amount * share; this.y += dy * amount * share; this.z += dz * amount * share;
    const vr = this.vx * dx + this.vy * dy + this.vz * dz;
    if (vr < 0) { this.vx -= dx * vr * share; this.vy -= dy * vr * share; this.vz -= dz * vr * share; }
  }

  // Called by the game when a taut cord leads to a dangling partner.
  dragToward(dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-3 || this.anchored) return;
    this.drag.x = dx / l; this.drag.z = dz / l; this.drag.on = true;
  }

  // SHIELD: a short bubble that blocks lightning and monster hits.
  raiseShield() {
    if (this.shieldCd > 0) return false;
    this.shield = PC.SHIELD;
    this.shieldCd = PC.SHIELD_CD;
    this.events.push({ k: 'shield' });
    return true;
  }

  // GRAPPLE: zip toward a hook, then get flung onto the platform beyond it.
  grapple(a) {
    if (this.hook || this.anchored) return false;
    this.hook = a;
    this.hookT = 0;
    this.grounded = false; this.ground = null;
    this.events.push({ k: 'grapple' });
    return true;
  }

  zip(dt, env) {
    const a = this.hook;
    this.hookT += dt;
    const dx = a.x - this.x, dy = a.y - 1.3 - this.y, dz = a.z - this.z, d = Math.hypot(dx, dy, dz);
    if (d < 1.1 || this.hookT > 1.6) {
      // Ballistic throw that lands on the platform's middle about 0.85 s later.
      const T = 0.85, tx = a.tx - this.x, ty = a.ty - this.y, tz = a.tz - this.z;
      this.vx = tx / T; this.vz = tz / T; this.vy = (ty - 0.5 * PC.G * T * T) / T;
      this.thrown = T + 0.1;
      this.hook = null;
      this.events.push({ k: 'flung' });
      return;
    }
    const sp = Math.min(PC.ZIP, 7 + this.hookT * 30);
    this.vx = (dx / d) * sp; this.vy = (dy / d) * sp; this.vz = (dz / d) * sp;
    for (let s = 0; s < 3; s++) {
      this.x += (this.vx * dt) / 3; this.y += (this.vy * dt) / 3; this.z += (this.vz * dt) / 3;
      this.collide(env);
    }
    this.peakY = Math.max(this.peakY, this.y);
  }

  knock(vx, vy, vz, stun) {
    if (this.shield > 0) { this.events.push({ k: 'blocked' }); return false; }
    if (this.anchored) return false;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.stun = stun;
    this.grounded = false; this.ground = null;
    return true;
  }

  fling(vx, vy, vz) {
    if (this.anchored || this.hook) return;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.thrown = 0.5;
    this.grounded = false; this.ground = null;
    this.events.push({ k: 'flung' });
  }
}
