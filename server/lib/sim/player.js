// Copied from assets/js by dev/makesim.mjs. Do not edit here.
// Climber movement: a sphere with platformer controls, wall jump, dash, GRAB, a reelable cord, SHIELD and GRAPPLE.
import { collideSphere, toLocal, toWorld } from './physics.js';

export const PR = 0.42;
export const PC = {
  G: -24, SPEED: 6.2, GACC: 55, AACC: 20, ICE_ACC: 9, ICE_DEC: 3, JUMP: 9.4, PAD: 16.5,
  COYOTE: 0.12, BUFFER: 0.14, MAXFALL: -34, WALL_DRAIN: 0.22, GROUND_DRAIN: 0.05, REGEN: 0.45,
  REEL: 4.6, UNREEL: 3.0, CLIMB: 4.6, DRAG: 6.5, SHIELD: 1.0, SHIELD_CD: 2.2, ZIP: 19,
  WALL_JUMP: 9.0, WALL_PUSH: 7.2, WALL_SLIDE: -3.6, WALL_TOUCH: 0.12, WALL_NOGRAB: 0.25,
  DASH: 15, DASH_T: 0.16, DASH_END: 8, DASH_CD: 0.7, DASH_BUFFER: 0.1,
};
export const F = { GROUND: 1, ANCHOR: 2, ICE: 4, STUN: 8, CHARGE: 16, REEL: 32, MOVE: 64, SHIELD: 128, GRAPPLE: 256, HANG: 512, AIM: 1024, KICK: 2048, DASH: 4096, WALL: 8192 };

// How hard a robot resists the cord: clamped robots are immovable, grounded ones have grip.
export function invMass(flags) {
  if (flags & F.ANCHOR) return 0;
  if (flags & F.STUN) return 1;
  if (flags & F.GROUND) return flags & F.ICE ? 0.8 : 0.35;
  return 1;
}

// How far below the zipline cable the body hangs.
export const RIDE_HANG = 1.15;

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
    this.ride = null; this.rideS = 0; this.rideV = 0; this.rideT = 0; this.noRide = 0;
    this.wallT = -1; this.wallNx = 0; this.wallNz = 0; this.kickNx = 0; this.kickNz = 0; this.kicked = false; this.sliding = false; this.noGrab = 0;
    this.dashT = 0; this.dashCd = 0; this.dashBuf = 0; this.dashReady = true; this.dashX = 0; this.dashZ = 0;
    // The clock above starts again at 0, so a wall kick from before would look like one still going on (the camera waits for those).
    this.kickT = undefined;
  }

  spawn(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.reset();
  }

  get flags() {
    return (this.grounded ? F.GROUND : 0) | (this.anchored ? F.ANCHOR : 0) | (this.onIce ? F.ICE : 0) |
      (this.stun > 0 ? F.STUN : 0) | (this.charge > 0 ? F.CHARGE : 0) | (this.reel > 0.05 ? F.REEL : 0) | (this.moving ? F.MOVE : 0) |
      (this.shield > 0 ? F.SHIELD : 0) | (this.hook ? F.GRAPPLE : 0) | (this.hanging || this.ride ? F.HANG : 0) | (this.aim ? F.AIM : 0) | (this.dashT > 0 ? F.DASH : 0) | (this.sliding ? F.WALL : 0);
  }

  invMass() {
    return invMass(this.flags);
  }

  // inp: { mx, mz (world move dir, length <= 1), fx, fz (where the camera looks), jump, jumpPressed, dash, grab, reel }
  // env: { world, others: [{x,y,z}], wind(body, out), grip (drain multiplier), maxReel, coyote (seconds, optional) }
  step(dt, inp, env) {
    this.time += dt;
    this.buffer = inp.jumpPressed ? PC.BUFFER : Math.max(0, this.buffer - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.shieldCd = Math.max(0, this.shieldCd - dt);
    this.moving = Math.abs(inp.mx) + Math.abs(inp.mz) > 0.1;
    this.dashBuf = inp.dash ? PC.DASH_BUFFER : Math.max(0, this.dashBuf - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.noGrab = Math.max(0, this.noGrab - dt);
    this.sliding = false;

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
      // Jump while clamped to a wall: push off it. Only here does a wall jump not care which wall came last,
      // and the push always carries you too far out to get back to the same wall any higher.
      if (c.on && this.buffer > 0 && this.anchorWall && this.anchorNx !== undefined && this.stun <= 0) {
        this.wallNx = this.anchorNx; this.wallNz = this.anchorNz;
        this.release();
        this.wallJump();
      } else if (!c.on || !inp.grab || this.grip <= 0 || this.stun > 0) this.release();
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
    // Ziplines: jump up into the cable and you grab it on your own, then ride it down.
    this.noRide = Math.max(0, this.noRide - dt);
    if (!this.ride && !this.grounded && !this.noRide && this.stun <= 0 && env.zips && env.zips.length) this.tryRide(env.zips);
    if (this.ride) { this.rideStep(dt); return; }

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

    // Jump and dash at the same moment: the jump goes first, then the dash.
    if (this.dashBuf > 0 && !(this.buffer > 0 && (this.grounded || this.coyote > 0))) this.startDash(inp);
    if (this.dashT > 0) {
      const was = this.grounded;
      this.dashStep(dt, env);
      this.drag.on = false;
      this.landed(was, 0, dt, env);
      this.tryGrab(inp);
      return;
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

    // Pressing into a wall on the way down: slide down it slowly.
    if (!this.grounded && this.vy < PC.WALL_SLIDE && this.stun <= 0 && this.time - this.wallT < PC.WALL_TOUCH && inp.mx * this.wallNx + inp.mz * this.wallNz < -0.25) {
      this.vy = PC.WALL_SLIDE;
      this.sliding = true;
    }

    let jumped = false;
    if (this.buffer > 0 && (this.grounded || this.coyote > 0) && this.stun <= 0) {
      this.vy = (mud ? PC.JUMP * 0.8 : PC.JUMP) + Math.max(0, pvy) * 0.5;
      this.vx += pvx; this.vz += pvz;
      this.buffer = 0; this.coyote = 0; this.jumpHeld = true; jumped = true;
      this.events.push({ k: 'jump' });
    } else if (this.buffer > 0 && this.canWallJump()) {
      this.wallJump();
      jumped = true;
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
      this.probeFloor(env);
    }
    // Launched off a kicker this step: in the air, whatever else we brushed against.
    if (this.launched) { this.launched = false; this.grounded = false; this.ground = null; }
    this.landed(was, fallV, dt, env);
    this.tryGrab(inp);
  }

  // Feeling for a floor just below. If there's none, nothing was touched: the side of the ledge you just walked off
  // doesn't count as a wall.
  probeFloor(env) {
    const sy = this.y, t = this.wallT, nx = this.wallNx, nz = this.wallNz;
    this.y -= 0.24;
    this.collide(env);
    if (!this.grounded) { this.y = sy; this.wallT = t; this.wallNx = nx; this.wallNz = nz; }
  }

  landed(was, fallV, dt, env) {
    this.onIce = this.grounded && this.ground && this.ground.surf === 'ice';
    this.coyote = this.grounded ? env.coyote ?? PC.COYOTE : Math.max(0, this.coyote - dt);
    if (this.grounded) { this.dashReady = true; this.kicked = false; }
    if (this.grounded && !was) this.events.push({ k: 'land', drop: this.peakY - this.y, v: -fallV });
    if (this.grounded) this.peakY = this.y;
    else this.peakY = Math.max(this.peakY, this.y);
    this.airT = this.grounded ? 0 : this.airT + dt;
  }

  tryGrab(inp) {
    // Slick walls (the maze gardens) give nothing to hold on to.
    if (inp.grab && !this.anchored && !this.gripLock && !this.noGrab && this.stun <= 0 && this.contact && !this.contact.slick && this.time - this.contactT < 0.12) this.anchor();
  }

  // A wall was touched a moment ago, and it isn't the one the last wall jump left from (facing the same way):
  // two walls facing each other can be climbed, one wall alone can't.
  canWallJump() {
    if (this.grounded || this.stun > 0 || this.time - this.wallT >= PC.WALL_TOUCH) return false;
    return !(this.kicked && this.wallNx * this.kickNx + this.wallNz * this.kickNz > 0.7);
  }

  wallJump() {
    this.kickT = this.time;
    const nx = this.wallNx, nz = this.wallNz, vn = this.vx * nx + this.vz * nz;
    // Up and away from the wall, keeping some of the speed along it. For a moment the stick only nudges the
    // flight, so holding toward the wall still carries you off it.
    this.vx = (this.vx - nx * vn) * 0.6 + nx * PC.WALL_PUSH;
    this.vz = (this.vz - nz * vn) * 0.6 + nz * PC.WALL_PUSH;
    this.vy = PC.WALL_JUMP;
    this.thrown = 0.16;
    this.buffer = 0; this.coyote = 0; this.jumpHeld = true;
    this.kicked = true; this.kickNx = nx; this.kickNz = nz;
    this.wallT = -1;
    this.noGrab = PC.WALL_NOGRAB;
    this.dashReady = true;
    this.dashT = 0;
    this.events.push({ k: 'walljump' });
  }

  // An emote's flip: a plain jump, only from the ground.
  hop() {
    if (!this.grounded || this.anchored || this.stun > 0 || this.hook) return false;
    this.vy = PC.JUMP;
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0;
    this.events.push({ k: 'jump' });
    return true;
  }

  // DASH: a short, fast burst along the stick (or where the camera looks), straight across with gravity off.
  // One in the air, then it needs the ground, a wall jump or a grab to come back.
  startDash(inp) {
    if (this.dashT > 0 || this.dashCd > 0 || !this.dashReady || this.stun > 0 || this.anchored || this.hook) return;
    let dx = inp.mx, dz = inp.mz;
    if (!this.moving) { dx = inp.fx || 0; dz = inp.fz || 0; }
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return;
    this.dashX = dx / l; this.dashZ = dz / l;
    this.dashT = PC.DASH_T;
    this.dashCd = PC.DASH_CD;
    this.dashBuf = 0;
    if (!this.grounded) this.dashReady = false;
    this.thrown = 0;
    this.jumpHeld = false;
    this.events.push({ k: 'dash', x: this.dashX, z: this.dashZ });
  }

  dashStep(dt, env) {
    this.dashT = Math.max(0, this.dashT - dt);
    this.vx = this.dashX * PC.DASH; this.vz = this.dashZ * PC.DASH; this.vy = 0;
    const was = this.grounded;
    this.grounded = false; this.ground = null;
    for (let s = 0; s < 3; s++) {
      this.x += (this.vx * dt) / 3; this.z += (this.vz * dt) / 3;
      this.collide(env);
    }
    // Keep to the floor over small steps on the ground, so a ground dash doesn't lift off before the edge.
    if (was && !this.grounded) this.probeFloor(env);
    // Ran into something: the dash is over.
    const blocked = Math.hypot(this.vx, this.vz) < PC.DASH * 0.5;
    if (blocked) this.dashT = 0;
    else if (this.dashT <= 0) { this.vx = this.dashX * PC.DASH_END; this.vz = this.dashZ * PC.DASH_END; }
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
      // Kicker at the bottom of a launch slide: thrown toward the ledge ahead (the stick only nudges the flight).
      if (c && c.launch) {
        const T = c.launch, g = -PC.G, dy = T.y + PR - this.y, vy = Math.max(T.vy, Math.sqrt(Math.max(0, 2 * g * dy)) + 2);
        const ft = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * g * dy))) / g;
        this.vx = (T.x - this.x) / ft; this.vy = vy; this.vz = (T.z - this.z) / ft;
        this.thrown = 1.4;
        this.launched = true;
        this.events.push({ k: 'launch' });
        return;
      }
      this.grounded = true;
      this.ground = c;
    }
    if (c) { this.contact = c; this.contactT = this.time; this.contactWall = ny < 0.6; }
    // Nearly upright surface: good to slide down or jump off. Other climbers don't count, and nor do slick walls.
    if (c && !c.slick && Math.abs(ny) < 0.35) {
      const h = Math.hypot(nx, nz);
      if (h > 1e-3) { this.wallT = this.time; this.wallNx = nx / h; this.wallNz = nz / h; }
    }
  }

  anchor() {
    const c = this.contact;
    this.anchored = true;
    this.anchorCol = c;
    this.anchorWall = this.contactWall;
    toLocal(c, this.x, this.y, this.z, false, this.anchorL);
    this.vx = this.vy = this.vz = 0;
    const onWall = this.anchorWall && this.time - this.wallT < PC.WALL_TOUCH;
    this.anchorNx = onWall ? this.wallNx : undefined; this.anchorNz = onWall ? this.wallNz : undefined;
    this.dashT = 0;
    this.dashReady = true;
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
    this.dashT = 0;
    this.dashReady = true;
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

  // Hands on a zipline cable (a: start, high; b: end, low): grab it when they come within reach in the air.
  tryRide(zips) {
    const hx0 = this.x, hy0 = this.y + RIDE_HANG, hz0 = this.z;
    for (const z of zips) {
      if (hy0 > z.ay + 1 || hy0 < z.by - 1 || hx0 < z.minx || hx0 > z.maxx || hz0 < z.minz || hz0 > z.maxz) continue;
      // Up to 1 m behind where the cable starts still grabs it (at its start).
      const hx = hx0 - z.ax, hy = hy0 - z.ay, hz = hz0 - z.az, s0 = hx * z.ux + hy * z.uy + hz * z.uz;
      if (s0 < -1 || s0 > z.len - 1.5) continue;
      const s = Math.max(0, s0), ex = hx - z.ux * s, ey = hy - z.uy * s, ez = hz - z.uz * s;
      if (ex * ex + ey * ey + ez * ez > 0.8 * 0.8) continue;
      this.ride = z; this.rideS = s; this.rideT = 0;
      this.rideV = Math.max(4, this.vx * z.ux + this.vy * z.uy + this.vz * z.uz);
      this.dashT = 0; this.dashReady = true; this.buffer = 0;
      this.events.push({ k: 'grab' });
      return;
    }
  }

  // Riding: gravity along the cable speeds you up (never slower than a walk, never faster than z.max). JUMP lets go
  // early; at the end you are thrown off forward onto the landing.
  rideStep(dt) {
    const z = this.ride;
    this.rideT += dt;
    this.rideV = Math.min(z.max, Math.max(4, this.rideV - PC.G * -z.uy * dt * 0.55 - 0.3 * dt));
    this.rideS += this.rideV * dt;
    const end = this.rideS >= z.len - 0.35, let_go = this.buffer > 0 && this.rideT > 0.3;
    this.grounded = false; this.ground = null; this.coyote = 0;
    if (end || let_go) {
      const v = this.rideV;
      this.vx = z.ux * v; this.vz = z.uz * v; this.vy = z.uy * v + (end ? 3.2 : 2.4);
      this.ride = null; this.noRide = 0.6; this.thrown = 0.3; this.buffer = 0;
      this.events.push({ k: 'release' });
      return;
    }
    const s = this.rideS;
    this.x = z.ax + z.ux * s; this.y = z.ay + z.uy * s - RIDE_HANG; this.z = z.az + z.uz * s;
    this.vx = z.ux * this.rideV; this.vy = z.uy * this.rideV; this.vz = z.uz * this.rideV;
    this.peakY = this.y;
  }

  knock(vx, vy, vz, stun) {
    if (this.shield > 0) { this.events.push({ k: 'blocked' }); return false; }
    // Knocked off a zipline too.
    if (this.ride) { this.ride = null; this.noRide = 0.8; }
    // Holding on is no protection: a hit tears you loose. Stunned, you can't grab again straight away.
    this.release();
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.dashT = 0;
    this.stun = stun;
    this.grounded = false; this.ground = null;
    return true;
  }

  fling(vx, vy, vz) {
    if (this.anchored || this.hook) return;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.dashT = 0;
    this.thrown = 0.5;
    this.grounded = false; this.ground = null;
    this.events.push({ k: 'flung' });
  }
}
