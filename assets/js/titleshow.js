// Behind the menus: the team getting ready on the dock at the foot of the climb, tied together by their cords.
// Nothing here is faked. Every climber is a real physics body on the real map, so nobody can pass through anything, and
// they only ever walk over ground that was checked to be clear. A slow camera drifts through a few long shots and
// blends from one to the next, with no cuts and no chasing. The camera stays on the dock, where nothing stands in its way.
import { Body, PR } from './player.js';
import { Chain } from './chain.js';

const CORD = 6.5, REACH = 5, WALK = 0.42, BLEND = 3.5, TAU = Math.PI * 2;
const POSES = ['e_wave', 'e_clap', 'e_thumbs', 'e_salute', 'e_flex', 'e_laugh'];
const FLIPS = ['e_backflip', 'e_frontflip'];
const LOOPS = ['e_chill', 'e_floss'];

const lerp = (a, b, k) => a + (b - a) * k;
const pick = (a) => a[(Math.random() * a.length) | 0];
const smooth = (k) => k * k * (3 - 2 * k);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Each is [radius, angle, height] at the start of the shot and again at its end. Angles are from the middle of the team,
// on whichever side of it has the clearer view. c is the camera, l what it looks at.
const SHOTS = [
  // The team, from just in front and a little below their eyes, moving slowly in.
  { d: 17, fov: 52, face: 'out', c: [18.6, 0.25, 1.05, 17.8, 0.14, 1.3], l: [13, 0.02, 2.05, 13, 0, 2.25] },
  // From the side, on a longer lens, so the tower stands next to them.
  { d: 15, fov: 38, face: 'out', c: [18.2, 0.72, 1.0, 17.8, 0.58, 1.25], l: [12.8, 0.05, 1.75, 12.8, -0.03, 1.85] },
  // From behind them, looking up at what they are about to climb.
  { d: 14, fov: 56, face: 'in', c: [17.6, 0.26, 0.95, 16.9, 0.2, 1.1], l: [8.5, 0, 4.4, 8.5, 0, 5.4] },
  // Starting on the team and slowly tilting all the way up the climb.
  { d: 20, fov: 62, face: 'in', c: [18.4, 0.5, 1.3, 18, 0.36, 3.2], l: [9, 0, 2.8, 9, 0, 22] },
];
// Where the team starts: [radius, angle] from the start of the climb, in a loose curve.
const HOME = [[14.2, -0.27], [13.3, -0.09], [12.9, 0.09], [13.5, 0.27]];

export class TitleShow {
  constructor(level, world) {
    this.level = level;
    this.world = world;
    const c = level.cps[0];
    this.th = c.th;
    this.deck = c.y;
    this.env = { world, others: [], grip: 1, maxReel: 5, wind: null };
    this.o = {};
    this.t = 0;
    this.next = 2.5;
    this.shot = 0;
    this.shotT = 0;
    this.face = SHOTS[0].face;
    this.center = { x: 0, y: 0, z: 0 };
    this.cam = { x: 0, y: 0, z: 0 };
    this.look = { x: 0, y: 0, z: 0 };
    // Things drawn on the dock that aren't solid, like lamp posts and the start pole.
    this.posts = [{ x: c.x, z: c.z }];
    for (const d of level.decor || []) {
      const y = d.y ?? d.y0;
      if (d.x !== undefined && y !== undefined && y - c.y > -6 && y - c.y < 5) this.posts.push({ x: d.x, z: d.z });
    }
    this.spots = this.findSpots();
    this.team = this.place();
    this.ac = 0;
    for (const p of this.team) this.ac += wrap(Math.atan2(p.b.z, p.b.x) - this.th) / 4;
    this.ac += this.th;
    this.chains = [0, 1, 2].map(() => new Chain(12));
    this.rigs = SHOTS.map((s, i) => {
      const first = i % 2 ? -1 : 1;
      return Object.assign({}, s, { s: this.badView(s, -first) < this.badView(s, first) ? -first : first });
    });
  }

  polar(r, a, h, out = {}) {
    out.x = Math.cos(a) * r; out.y = this.deck + h; out.z = Math.sin(a) * r;
    return out;
  }

  // Anything solid in a ball this size, at this height over the deck?
  solid(x, z, h, r) {
    const p = { x, y: this.deck + h, z };
    this.world.pushOut(p, r, this.o);
    return Math.abs(p.x - x) + Math.abs(p.y - this.deck - h) + Math.abs(p.z - z) > 1e-4;
  }

  nearPost(x, z, r) {
    for (const p of this.posts) if (Math.hypot(p.x - x, p.z - z) < r) return true;
    return false;
  }

  // Open deck for this far round: level all the way, nothing standing on it and nothing to bump a head on.
  clear(x, z, r) {
    const W = this.world, top = this.deck + 3.2;
    if (this.nearPost(x, z, r + 0.45) || this.solid(x, z, 1, r)) return false;
    if (Math.abs(W.floorBelow(x, top, z, 4) - this.deck) > 0.06) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8;
      if (Math.abs(W.floorBelow(x + Math.cos(a) * r, top, z + Math.sin(a) * r, 4) - this.deck) > 0.06) return false;
    }
    return true;
  }

  findSpots() {
    const out = [];
    for (let r = 11.2; r <= 14.8; r += 0.6) {
      for (let a = -0.36; a <= 0.36; a += 0.06) {
        const x = Math.cos(this.th + a) * r, z = Math.sin(this.th + a) * r;
        if (this.clear(x, z, 0.8)) out.push({ x, z, r, a });
      }
    }
    return out;
  }

  place() {
    const taken = [];
    return HOME.map(([r, a], j) => {
      const want = { x: Math.cos(this.th + a) * r, z: Math.sin(this.th + a) * r };
      let best = null, bd = 1e9;
      for (const s of this.spots) {
        const d = dist(s, want);
        if (d < bd && taken.every((t) => dist(t, s) > 1.7)) { bd = d; best = s; }
      }
      const at = best || want;
      taken.push(at);
      const b = new Body();
      b.spawn(at.x, this.deck + PR + 0.02, at.z);
      return { j, b, home: at, goal: null, walkT: 0, jumpT: 0, jumpNow: false, loop: 0, face: this.face, faceWait: 0, tilt: (Math.random() - 0.5) * 0.9, watch: null, watchT: 0,
        inp: { mx: 0, mz: 0, fx: 0, fz: -1, jump: false, jumpPressed: false, dash: false, grab: false, reel: false } };
    });
  }

  // How much would be in the way of this shot, from this side.
  badView(s, side) {
    let bad = 0;
    const f = { x: 0, y: 0, z: 0 };
    this.polar(13.2, this.ac, 1, f);
    for (const u of [0, 0.5, 1]) {
      const p = this.at(s.c, side, u);
      if (this.nearPost(p.x, p.z, 1.8) || this.solid(p.x, p.z, p.y - this.deck, 0.4)) bad += 3;
      for (let k = 1; k < 8; k++) {
        const g = k / 8, x = lerp(p.x, f.x, g), y = lerp(p.y, f.y, g), z = lerp(p.z, f.z, g);
        if (this.nearPost(x, z, 0.7) || this.solid(x, z, y - this.deck, 0.15)) bad++;
      }
    }
    return bad;
  }

  at(v, side, u) {
    return this.polar(lerp(v[0], v[3], u), this.ac + side * lerp(v[1], v[4], u), lerp(v[2], v[5], u));
  }

  // A place to walk to: open ground all the way, in reach of the cords on both sides, and nobody in the way.
  goalFor(c) {
    const { b, j } = c, here = { x: b.x, z: b.z };
    for (let n = 0; n < 16; n++) {
      const s = pick(this.spots);
      if (!s) return null;
      const d = dist(s, here);
      if (d < 1.6 || d > 4.5) continue;
      let ok = true;
      for (const o of this.team) {
        if (o === c) continue;
        const p = { x: o.b.x, z: o.b.z }, g = Math.max(0, Math.min(1, ((p.x - here.x) * (s.x - here.x) + (p.z - here.z) * (s.z - here.z)) / (d * d)));
        if (Math.hypot(p.x - lerp(here.x, s.x, g), p.z - lerp(here.z, s.z, g)) < 1.2) ok = false;
        if (Math.abs(o.j - j) === 1 && dist(p, s) > REACH) ok = false;
      }
      for (let k = 1; ok && k * 0.5 < d; k++) {
        const g = (k * 0.5) / d;
        if (!this.clear(lerp(here.x, s.x, g), lerp(here.z, s.z, g), 0.45)) ok = false;
      }
      if (ok) return s;
    }
    return null;
  }

  // Every few seconds one of them does something, and the others might turn to watch.
  direct(dt, robots) {
    if ((this.next -= dt) > 0) return;
    this.next = 2.5 + Math.random() * 3.5;
    const free = this.team.filter((c) => !c.goal && c.loop <= 0 && !robots[c.j].emote && c.b.grounded);
    if (!free.length) return;
    const c = pick(free), r = robots[c.j], roll = Math.random();
    if (roll < 0.42) {
      if (this.team.some((o) => o.goal)) return;
      const g = this.goalFor(c);
      if (g) { c.goal = g; c.walkT = 0; c.watchT = 0; }
      return;
    }
    if (roll < 0.8) r.playEmote(pick(POSES));
    else if (roll < 0.92) { r.playEmote(pick(FLIPS)); c.jumpT = 0.26; c.jumpNow = true; }
    else { r.playEmote(pick(LOOPS)); c.loop = 4 + Math.random() * 3; return; }
    for (const o of this.team) {
      if (o !== c && !o.goal && Math.random() < 0.7) { o.watch = c; o.watchT = 2 + Math.random() * 1.5; }
    }
  }

  moveOne(c, dt) {
    const { b, inp } = c;
    inp.mx = inp.mz = 0;
    inp.jump = c.jumpT > 0;
    inp.jumpPressed = c.jumpNow;
    c.jumpNow = false;
    c.jumpT = Math.max(0, c.jumpT - dt);
    if (c.goal) {
      const dx = c.goal.x - b.x, dz = c.goal.z - b.z, d = Math.hypot(dx, dz);
      c.walkT += dt;
      if (d < 0.25 || c.walkT > 6) {
        c.goal = null;
        c.tilt = (Math.random() - 0.5) * 0.9;
      } else {
        const k = (WALK * Math.max(0.35, Math.min(1, d / 0.8))) / d;
        inp.mx = dx * k;
        inp.mz = dz * k;
      }
    }
    b.step(dt, inp, this.env);
    b.events.length = 0;
  }

  // The climbers and their cords, one frame. lookOf and colorOf say what each of them is wearing.
  update(dt, pool, lookOf, colorOf, time) {
    dt = Math.max(dt, 1e-3);
    this.t += dt;
    const robots = pool.robots, c0 = this.center;
    this.direct(dt, robots);
    const n = Math.max(1, Math.ceil(dt * 60)), h = dt / n;
    c0.x = c0.y = c0.z = 0;
    for (const c of this.team) {
      const r = robots[c.j], b = c.b;
      for (let i = 0; i < n; i++) this.moveOne(c, h);
      // Never expected, but it must not leave anybody swimming.
      if (b.y < this.deck - 2 || b.y > this.deck + 6) {
        b.spawn(c.home.x, this.deck + PR + 0.02, c.home.z);
        c.goal = null;
        for (let k = Math.max(0, c.j - 1); k <= Math.min(2, c.j); k++) this.chains[k].ok = false;
      }
      if (c.loop > 0 && (c.loop -= dt) <= 0) r.stopEmote();
      if (c.faceWait > 0 && (c.faceWait -= dt) <= 0) c.face = this.face;
      c.watchT = Math.max(0, c.watchT - dt);
      r.flip = 0;
      r.setLook(lookOf(c.j));
      r.show();
      if (!c.goal) {
        // Turn toward whatever they are facing now, at an easy pace.
        const R = Math.hypot(b.x, b.z) || 1, ox = b.x / R, oz = b.z / R;
        const want = c.watchT > 0 ? Math.atan2(c.watch.b.x - b.x, c.watch.b.z - b.z) : c.face === 'in' ? Math.atan2(-ox, -oz) + c.tilt * 0.5 : Math.atan2(ox, oz) + c.tilt;
        r.yaw += wrap(want - r.yaw) * Math.min(1, dt * 2.4);
      }
      r.update(dt, b.x, b.y, b.z, b.vx, b.vy, b.vz, b.flags, 0, this.deck);
      c0.x += b.x / 4; c0.y += b.y / 4; c0.z += b.z / 4;
    }
    for (let j = 0; j < 3; j++) {
      const ch = this.chains[j], rope = pool.ropes[j], A = this.team[j].b, B = this.team[j + 1].b;
      rope.setColors(colorOf(j), colorOf(j + 1));
      ch.step(A, B, CORD, this.world, Math.min(dt, 0.05));
      rope.mesh.visible = true;
      rope.update(ch.p, Math.max(0, Math.min(1, (Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) / CORD - 0.85) / 0.15)), time);
    }
  }

  // Where one shot's camera is, t seconds into it.
  pose(s, t, pos, look) {
    const u = Math.min(1, t / s.d);
    const p = this.at(s.c, s.s, u), l = this.at(s.l, s.s, u);
    pos.x = p.x; pos.y = p.y; pos.z = p.z;
    look.x = l.x; look.y = l.y; look.z = l.z;
  }

  camera(dt, cam) {
    const S = this.rigs;
    let A = S[this.shot];
    this.shotT += dt;
    if (this.shotT >= A.d) {
      this.shot = (this.shot + 1) % S.length;
      this.shotT = BLEND;
      A = S[this.shot];
    }
    const B = S[(this.shot + 1) % S.length], over = this.shotT - (A.d - BLEND), P = this.cam, L = this.look, t = this.t;
    this.pose(A, this.shotT, P, L);
    let fov = A.fov;
    if (over > 0) {
      const k = smooth(Math.min(1, over / BLEND)), p2 = {}, l2 = {};
      this.pose(B, over, p2, l2);
      for (const ax of ['x', 'y', 'z']) { P[ax] = lerp(P[ax], p2[ax], k); L[ax] = lerp(L[ax], l2[ax], k); }
      fov = lerp(A.fov, B.fov, k);
      if (B.face !== this.face) {
        this.face = B.face;
        for (const c of this.team) c.faceWait = 0.05 + Math.random() * 1.6;
      }
    }
    // A very slight drift, as if held by hand.
    P.x += Math.sin(t * 0.37) * 0.03; P.y += Math.sin(t * 0.53 + 1) * 0.025; P.z += Math.sin(t * 0.31 + 2) * 0.03;
    L.x += Math.sin(t * 0.29 + 0.5) * 0.04; L.y += Math.sin(t * 0.41) * 0.03;
    // Never inside anything.
    this.world.pushOut(P, 0.3, this.o);
    cam.position.set(P.x, P.y, P.z);
    cam.lookAt(L.x, L.y, L.z);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
