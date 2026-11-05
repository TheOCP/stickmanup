// Watching a friend climb. This never touches the physics or the record of a climb: it draws what the friend's phone says,
// and everything that phone says is checked here first, because a phone can say anything.
import { F, PR } from './player.js';
import { Chain } from './chain.js';
import { COLORS, validColor } from './colors.js';
import { Storm, QUAKE_AT, markShots, beeStep } from './storm.js';
import { DIFFS, MAPS, zoneAt, pathsOf, applyMaze, MAZE_WALL_H } from './level.js';
import { EMOTE } from './emotes.js';
import { clamp, damp, r3 } from './util.js';
import { resolveLook, plainLook, cleanLook, cleanRole } from './skins.js';
import { weaponOf } from './weapons.js';

const STEP = 1 / 60, DELAY = 0.25, KEEP = 48;
const hit = { nx: 0, ny: 0, nz: 0, d: 0 };
// Flying, metres a second, and how far out from the middle of the map it goes.
const FLY_SPEED = 14, FLY_FAST = 4, FLY_ROOM = 600;

// ---------- what the climbing phone sends ----------
// The whole picture. Sent again whenever it changes. The first two keys have to stay first: the server looks for them.
export function feedGame(g) {
  const players = [];
  for (const [s, p] of g.s.players) players.push({ s, name: String(p.name || ''), color: g.colorOf(s), look: p.look || null, role: p.role || '' });
  return { t: 'g', map: g.map, diff: g.diff, rules: g.rules, noCord: g.noCord, rope: g.rope, doors: [...g.doors], mz: g.mz, me: g.slot, players, ct: coinBits(g) };
}

// The coins already taken, one bit each: a few hundred letters even for a whole climb.
function coinBits(g) {
  const n = g.L.coins.length, b = new Uint8Array((n + 7) >> 3);
  for (const i of g.coinTaken) if (Number.isInteger(i) && i >= 0 && i < n) b[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function coinSet(text, n) {
  const out = new Set();
  if (typeof text !== 'string' || text.length > 4096) return out;
  let s;
  try { s = atob(text); } catch (e) { return out; }
  for (let k = 0; k < s.length; k++) {
    const x = s.charCodeAt(k);
    if (x) for (let j = 0; j < 8; j++) if (x & (1 << j) && k * 8 + j < n) out.add(k * 8 + j);
  }
  return out;
}

// Where everyone is right now.
export function feedState(g, paused) {
  const me = g.me, rob = g.robots, emote = (s) => { const r = rob.get(s); return r && r.emote ? r.emote.id : 0; };
  const self = rob.get(g.slot), p = [[g.slot, r3(me.x), r3(me.y), r3(me.z), r3(me.vx), r3(me.vy), r3(me.vz), r3(self ? self.yaw : 0), me.flags, r3(me.reel), r3(me.charge), emote(g.slot), r3(g.aimElev || 0)]];
  for (const [s, v] of g.vis || []) {
    if (s !== g.slot && g.s.players.has(s)) p.push([s, r3(v.x), r3(v.y), r3(v.z), r3(v.vx), r3(v.vy), r3(v.vz), r3(v.yaw || 0), v.flags | 0, r3(v.reel || 0), r3(v.charge || 0), emote(s), r3(v.elev || 0)]);
  }
  // c: where this phone's camera looks, so whoever watches through the climber's eyes (in a maze) sees what they see.
  const m = { t: 's', T: r3(g.time), f: g.falls, mz: g.mz, p, c: [r3(g.cam.yaw), r3(g.cam.pitch)] };
  if (g.feedShots && g.feedShots.length) m.sh = g.feedShots.splice(0).map((a) => a.map((v) => (typeof v === 'number' ? r3(v) : v)));
  const j = g.jumpPack();
  if (j.length) m.j = j;
  if (paused) m.z = 1;
  if (g.won) m.w = 1;
  return m;
}

// ---------- what the watching phone does with it ----------
const inList = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
const rule = (v, d) => (Number.isInteger(v) && v >= 0 && v < DIFFS.length ? v : d);
const goodShot = (a) => Array.isArray(a) && a.length >= 10 && Number.isInteger(a[0]) && a[0] >= 0 && a[0] < 4 && [1, 2, 3, 4, 5, 6, 9].every((i) => Number.isFinite(a[i]) && Math.abs(a[i]) < 1e5) && typeof a[8] === 'string' && a[8].length < 24;
const goodRow = (a) => Array.isArray(a) && a.length >= 11 && Number.isInteger(a[0]) && a[0] >= 0 && a[0] < 4 && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((i) => Number.isFinite(a[i]) && Math.abs(a[i]) < 1e6);

export class Spectator {
  constructor(app, hooks) {
    this.app = app;
    this.hooks = hooks;
    this.R = app.renderer;
    this.ready = false;
    this.map = -1;
    this.diff = -1;
    this.frames = [];
    this.lastT = 0;
    this.clock = null;
    this.falls = 0;
    this.held = false;
    this.won = false;
    this.players = new Map();
    this.robots = new Map();
    this.vis = new Map();
    this.links = [];
    this.emotes = new Map();
    this.looks = new Map();
    this.jump = [];
    this.jrigs = new Map();
    this.doors = new Set();
    this.coinTaken = new Set();
    this.shots = [];
    this.shotAt = new Map();
    this.focus = 0;
    this.touched = -9;
    this.snap = true;
    this.infoAcc = 0;
    this.bgBolt = 2;
    this.wind = { x: 0, z: 0 };
    this.cam = { yaw: 0.6, pitch: 0.34, d: 7, x: 0, y: 5, z: 0 };
    // A finger anywhere that isn't a button turns the camera.
    this.drag = null;
    this.fly = null;
    this.wantFly = false;
    this.orbited = false;
    this.flyPad = { sx: 0, sy: 0, up: false, down: false, fast: false };
    const el = this.dragEl = document.getElementById('menu');
    this.onDown = (e) => { if (!e.target.closest('button, .spstick')) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
    this.onMove = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      app.input.camDX += e.clientX - d.x;
      app.input.camDY += e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
    };
    this.onUp = (e) => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; };
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
  }

  // The whole picture: which climb this is and who is in it.
  setGame(g) {
    const app = this.app, map = inList(g.map, MAPS), diff = inList(g.diff, DIFFS), rules = g.rules && typeof g.rules === 'object' ? g.rules : {};
    if (map !== this.map || diff !== this.diff) {
      this.hooks.loadMap(map);
      this.map = map;
      this.diff = diff;
      this.L = app.level;
      this.W = app.world;
      for (const r of app.pool.robots) { r.hide(); r.flip = 0; }
      for (const r of app.pool.jumpers || []) {
        r.hide();
        if (this.L.jumpers[0]) { r.setColor(this.L.jumpers[0].look.c); r.bandMat.color.setHex(this.L.jumpers[0].look.g); }
      }
      for (const l of app.pool.ropes) l.mesh.visible = false;
      this.robots.clear();
      this.looks.clear();
      this.emotes.clear();
      this.jrigs.clear();
      this.links = [];
      this.pairKey = null;
      this.storm = new Storm(this.L, diff);
      this.storm.setHaz(rule(rules.haz, diff));
      this.rope = DIFFS[rule(rules.rope, diff)].rope;
      for (const d of this.L.doors) d.col.on = true;
      for (const c of this.L.crumbles) { c.crumble.st = 0; c.crumble.t = 0; c.on = true; }
      app.view.resetDoors();
      this.doors = new Set();
      this.mz = -1;
      const custom = ['cps', 'haz', 'rope'].some((k) => rules[k] !== undefined && rules[k] !== diff);
      this.storm.sec = pathsOf(diff, custom);
      app.view.setSecrets(this.storm.sec);
      app.pool.coins.clear();
      app.pool.relic.show(null);
      // Coins sorted into 8 m slices of height, the same as a climb does it.
      if (!this.L.coinBuilt) { this.L.coinBuilt = true; this.L.coinB = this.L.coinB || {}; for (const c of this.L.coins) (this.L.coinB[Math.floor(c.y / 8)] ||= []).push(c); }
      this.coinTaken = new Set();
      this.shots = [];
      this.shotAt.clear();
      this.frames.length = 0;
      this.clock = null;
      this.snap = true;
    }
    if (Array.isArray(g.doors)) {
      for (const i of g.doors) {
        if (!Number.isInteger(i) || !this.L.doors[i] || this.doors.has(i)) continue;
        this.doors.add(i);
        this.L.doors[i].col.on = false;
        app.view.openDoor(i);
      }
    }
    if (g.ct !== undefined) this.coinTaken = coinSet(g.ct, this.L.coins.length);
    this.setMaze(g.mz);
    const noCord = !!g.noCord, seen = new Map();
    for (const p of Array.isArray(g.players) ? g.players.slice(0, 4) : []) {
      if (!p || !Number.isInteger(p.s) || p.s < 0 || p.s > 3) continue;
      seen.set(p.s, { slot: p.s, name: String(p.name || '').slice(0, 20), color: validColor(p.color) ?? COLORS[p.s], look: cleanLook(p.look), role: cleanRole(p.role) });
    }
    if (!seen.size) return;
    this.players = seen;
    const pool = app.pool, slots = [...seen.keys()].sort((a, b) => a - b);
    for (const [s, r] of this.robots) if (!seen.has(s)) { r.hide(); this.robots.delete(s); this.looks.delete(s); }
    for (const s of slots) {
      const p = seen.get(s);
      let r = this.robots.get(s);
      if (!r) { r = pool.robots[s]; r.show(); this.robots.set(s, r); }
      const key = JSON.stringify([p.look, p.role, p.color]);
      if (this.looks.get(s) !== key) {
        this.looks.set(s, key);
        r.setLook(p.look ? resolveLook(p.look, p.role) : plainLook(p.color));
        app.fx.setColor(s, p.color);
      }
    }
    const pairKey = noCord ? '' : slots.join();
    if (pairKey !== this.pairKey) {
      this.pairKey = pairKey;
      for (const l of this.links) l.mesh.mesh.visible = false;
      this.links = [];
      for (let i = 0; i + 1 < slots.length && !noCord; i++) this.links.push({ a: slots[i], b: slots[i + 1], chain: new Chain(12), mesh: pool.ropes[i] });
    }
    for (const lk of this.links) lk.mesh.setColors(seen.get(lk.a).color, seen.get(lk.b).color);
    if (!this.ready || !seen.has(this.focus)) this.focus = seen.has(g.me) ? g.me : slots[0];
    // The climber whose phone this comes from: the only one whose camera is known.
    this.sender = Number.isInteger(g.me) ? g.me : -1;
    this.ready = true;
    this.hooks.team(this);
  }

  // The maze gardens' walls, the way the climb has them now.
  setMaze(v) {
    if (!Number.isInteger(v) || v < 0 || v === this.mz || !this.L) return;
    this.mz = v;
    if (this.L.mazes && this.L.mazes.length) { applyMaze(this.L, v); this.app.view.setMaze(v); }
  }

  // Where everyone is right now.
  state(m) {
    const T = +m.T;
    if (!this.ready || !Number.isFinite(T) || !Array.isArray(m.p)) return;
    // A new climb, or the same one picked up again.
    if (T < this.lastT - 2) { this.frames.length = 0; this.clock = null; this.snap = true; }
    const off = T - performance.now() / 1000;
    this.clock = this.clock === null || Math.abs(off - this.clock) > 1 ? off : this.clock + (off - this.clock) * 0.05;
    this.falls = Number.isInteger(m.f) && m.f >= 0 ? m.f : 0;
    if (m.mz !== this.mz) this.setMaze(m.mz);
    this.held = !!m.z;
    this.won = !!m.w;
    if (Array.isArray(m.j)) this.jump = m.j.slice(0, 80); else this.jump = [];
    // Shots wait until the moment they were fired comes round, like everything else here.
    if (Array.isArray(m.sh)) for (const a of m.sh.slice(0, 16)) if (goodShot(a) && this.shots.length < 48) this.shots.push(a);
    if (T <= this.lastT && this.frames.length) return;
    this.lastT = T;
    const p = new Map();
    for (const a of m.p.slice(0, 4)) if (goodRow(a)) p.set(a[0], a);
    const c = Array.isArray(m.c) && m.c.length === 2 && m.c.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6) ? [m.c[0], clamp(m.c[1], -1.6, 1.6)] : null;
    this.frames.push({ t: T, p, c });
    if (this.frames.length > KEEP) this.frames.shift();
  }

  // The climber at time t, between the two updates either side of it.
  sample(slot, t, o) {
    let a = null, b = null;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const fr = this.frames[i];
      if (!fr.p.has(slot)) continue;
      if (fr.t <= t) { a = fr; break; }
      b = fr;
    }
    if (!a) { if (!b) return null; a = b; b = null; }
    const s = a.p.get(slot);
    if (b) {
      const q = b.p.get(slot);
      // Back to a checkpoint is a jump, not a flight.
      const k = Math.abs(q[1] - s[1]) + Math.abs(q[2] - s[2]) + Math.abs(q[3] - s[3]) > 12 ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
      o.x = s[1] + (q[1] - s[1]) * k; o.y = s[2] + (q[2] - s[2]) * k; o.z = s[3] + (q[3] - s[3]) * k;
    } else {
      const e = this.held ? 0 : clamp(t - a.t, 0, 0.2);
      o.x = s[1] + s[4] * e; o.y = s[2] + s[5] * e; o.z = s[3] + s[6] * e;
    }
    o.vx = s[4]; o.vy = s[5]; o.vz = s[6]; o.yaw = s[7]; o.flags = s[8] | 0; o.reel = s[9]; o.charge = s[10];
    o.elev = Number.isFinite(s[12]) ? clamp(s[12], -1.6, 1.6) : 0;
    return o;
  }

  // Where someone looks at time t. For the climber on the phone this comes from, its camera (older versions don't send
  // it); for anyone else, the way they face.
  lookOf(slot, o, t) {
    if (slot === this.sender) {
      let a = null, b = null;
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const fr = this.frames[i];
        if (!fr.c) continue;
        if (fr.t <= t) { a = fr; break; }
        b = fr;
      }
      if (a && b) {
        const k = clamp((t - a.t) / (b.t - a.t || 1), 0, 1), turn = Math.atan2(Math.sin(b.c[0] - a.c[0]), Math.cos(b.c[0] - a.c[0]));
        return { yaw: a.c[0] + turn * k, pitch: a.c[1] + (b.c[1] - a.c[1]) * k };
      }
      if (a || b) { const f = a || b; return { yaw: f.c[0], pitch: f.c[1] }; }
    }
    return { yaw: (o.yaw || 0) + Math.PI, pitch: -(o.elev || 0) };
  }

  emoteOf(slot) {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const a = this.frames[i].p.get(slot);
      if (a) return typeof a[11] === 'string' && Object.hasOwn(EMOTE, a[11]) ? a[11] : 0;
    }
    return 0;
  }

  update(dt) {
    if (!this.ready) return;
    const app = this.app, R = this.R, W = this.W, L = this.L, now = performance.now() / 1000;
    this.view = null;
    const T = this.clock === null ? 0 : this.held ? this.lastT : now + this.clock - DELAY;
    // This is what reads the controller's sticks. What it says about moving only matters while flying.
    const inp = app.input.read(0);
    // Lifts and other moving platforms to where they are at this moment. Without this they stood still while the climber
    // rode them, and the climber seemed to sink into them.
    W.setTime(T - STEP);
    for (const [slot, r] of this.robots) {
      const o = this.vis.get(slot) || {}, got = this.sample(slot, T, o);
      r.g.visible = !!got;
      if (!got) { this.vis.delete(slot); r.hide(); continue; }
      // Standing on something: exactly on top of it, whatever the timing of the updates did in between.
      const fl = W.floorBelow(o.x, o.y + 0.3, o.z, 30);
      if (o.flags & F.GROUND && fl > -50 && Math.abs(fl + PR - o.y) < 0.5) o.y = fl + PR;
      this.vis.set(slot, o);
      const e = this.emoteOf(slot);
      if (e !== (this.emotes.get(slot) || 0)) { this.emotes.set(slot, e); if (e) r.playEmote(e); }
      r.update(dt, o.x, o.y, o.z, o.vx, o.vy, o.vz, o.flags, o.charge, fl, o.yaw, T - (this.shotAt.get(slot) ?? -9), o.elev);
    }
    this.playShots(T);
    // The map's event after each of them (lasers, cannonballs, bees), worked out here the way their phones do.
    const evM = this.evMarks || (this.evMarks = new Map()), evB = this.evBees || (this.evBees = new Map());
    for (const [slot, o] of this.vis) {
      const ev = this.storm.event(T, zoneAt(L, o.y)), calm = this.inMaze(o);
      if (!evM.has(slot)) evM.set(slot, new Map());
      markShots(this.storm, evM.get(slot), ev, o.x, o.y - PR, o.z, T, calm);
      evB.set(slot, beeStep(evB.get(slot), ev, o.x, o.y, o.z, dt, calm));
    }
    for (const slot of evM.keys()) if (!this.vis.has(slot)) { evM.delete(slot); evB.delete(slot); }
    for (const lk of this.links) {
      const A = this.vis.get(lk.a), B = this.vis.get(lk.b);
      if (!A || !B) { lk.mesh.mesh.visible = false; continue; }
      lk.mesh.mesh.visible = true;
      const len = this.rope - Math.max(A.reel || 0, B.reel || 0);
      lk.chain.step(A, B, len, W, Math.min(dt, 0.05));
      lk.mesh.update(lk.chain.p, clamp((Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) / len - 0.85) / 0.15, 0, 1), T);
    }
    this.drawJumpers(dt);
    app.fx.update(dt);

    const me = this.vis.get(this.focus) || this.vis.values().next().value;
    if (!me && !this.fly) return;
    const [dx, dy] = app.input.takeCam(false), cam = R.camera;
    if (this.fly) this.flyCam(dt, dx, dy, inp);
    else this.orbitCam(dt, T, now, me, dx, dy);
    if (this.wantFly) { this.wantFly = false; this.setFly(true); }
    // The weather, the map's event and the sound are for wherever the camera is.
    const at = this.fly || me, inMaze = this.inMaze(at);

    const zi = zoneAt(L, at.y), last = L.zones[L.zones.length - 1], eye = clamp((at.y - last.y0) / (L.top - last.y0), 0, 1);
    // Their map's event, none inside a maze garden: the storm's gust blows the weather, app.evfx draws the rest.
    const ev = inMaze ? null : this.storm.event(T, zi), gust = ev && ev.kind === 'gust' ? ev : null;
    R.indoor = inMaze;
    for (const m of app.evfx.frame(T, dt, this.storm, ev, at.y - PR, at.x, at.z, [...this.evMarks.values()], [...this.evBees.values()])) {
      const cd = Math.hypot(cam.position.x - m.x, cam.position.y - m.y, cam.position.z - m.z);
      if (cd < 70) { if (m.kind === 'laser') app.sound.zap(); else app.sound.thunder(4 + cd * 0.4); }
    }
    if (ev && ev.kind === 'quake' && ev.on) {
      let q = 0;
      for (let i = 0; i < QUAKE_AT.length; i++) {
        q = Math.max(q, Math.exp(-Math.abs(ev.u - QUAKE_AT[i]) * 7));
        if (ev.u >= QUAKE_AT[i] && this.quakeHeard !== ev.k * 10 + i) { this.quakeHeard = ev.k * 10 + i; app.sound.thunder(6); }
      }
      cam.position.x += (Math.random() - 0.5) * 0.22 * q; cam.position.y += (Math.random() - 0.5) * 0.22 * q; cam.position.z += (Math.random() - 0.5) * 0.22 * q;
    }
    this.wind.x = this.wind.z = 0;
    if (gust && gust.on) {
      const r = Math.hypot(at.x, at.z) || 1;
      this.wind.x = gust.radial ? (at.x / r) * gust.str : (-at.z / r) * gust.sign * gust.str;
      this.wind.z = gust.radial ? (at.z / r) * gust.str : (at.x / r) * gust.sign * gust.str;
    }
    R.update(dt, cam.position, L.zones[zi], eye, this.wind);
    R.shadowFocus(at.x, at.y, at.z);
    this.bgBolt -= dt;
    if (this.bgBolt <= 0 && L.mapKey === 'storm' && !inMaze) {
      this.bgBolt = (2 + Math.random() * 7) * (1 - zi * 0.08) * (1 + eye * 3);
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 260;
      R.bolt(at.x + Math.cos(a) * r, Math.max(0, at.y - 60 + Math.random() * 50), at.z + Math.sin(a) * r, 2.2);
      app.sound.thunder(r);
    }
    app.sound.ambient(0.2 + (at.y / L.top) * 0.6 + (ev && (ev.kind === 'gust' || ev.kind === 'wave') && ev.on ? 0.8 : 0), false, 0, L.mapKey === 'storm' ? 1 - eye * 0.8 : 0, L.mapKey === 'waterfall' ? 1 : 0);
    app.view.camPos = cam.position;
    app.view.update(T - STEP, dt, this.storm, 1);
    app.pool.coins.update(dt, T, L.coins, this.coinTaken, cam.position.x, cam.position.y, cam.position.z, L.coinB);
    app.sound.setStyle(L.mapKey);
    app.sound.setIntensity(0.3 + clamp(at.y / L.top, 0, 1) * 0.7);
    app.ui.tags(this.tagsView || (this.tagsView = { vis: this.vis, s: { players: this.players } }));
    this.tagsView.s.players = this.players;

    this.infoAcc += dt;
    if (this.infoAcc > 0.2 && me) {
      this.infoAcc = 0;
      const p = this.players.get(this.focus), marks = [];
      for (const [s, v] of this.vis) marks.push([s, clamp(v.y / L.top, 0, 1) * 100]);
      this.hooks.info({ name: p ? p.name : '', map: MAPS[this.map].name, diff: DIFFS[this.diff].name, T: Math.max(0, T), h: Math.max(0, Math.round(me.y - PR - 2)), top: Math.round(L.top - 2), falls: this.falls, held: this.held, won: this.won, marks });
    }
  }

  // Round whoever is being watched, the way the game's own camera goes.
  orbitCam(dt, T, now, me, dx, dy) {
    const W = this.W, R = this.R, c = this.cam;
    if (this.snap) { this.snap = false; c.x = me.x; c.y = me.y + 0.8; c.z = me.z; c.yaw = Math.atan2(me.x, me.z) || 0.6; }
    // In a maze garden, through their eyes, looking where they look (the walls and the roof would only get in the way).
    const inMaze = this.inMaze(me);
    const fk = (this.fpK = damp(this.fpK || 0, inMaze ? 1 : 0, 9, dt)), rig = this.robots.get(this.focus);
    if (inMaze) {
      // They turn the view, not the finger here: it follows them the shortest way round.
      const lk = this.lookOf(this.focus, me, T), k = Math.min(1, dt * 22);
      c.yaw += Math.atan2(Math.sin(lk.yaw - c.yaw), Math.cos(lk.yaw - c.yaw)) * k;
      c.pitch += (clamp(lk.pitch, -1.05, 1.25) - c.pitch) * k;
      this.touched = now;
    } else {
      c.yaw -= dx;
      // Looking up from the eyes is allowed further than round the back; out of a maze that eases back.
      c.pitch = clamp(c.pitch + dy, -0.3 - 0.75 * fk, 1.25);
      if (dx || dy) this.touched = now;
      // Left alone, the camera comes round behind whoever it follows.
      if (now - this.touched > 3 && Math.hypot(me.vx, me.vz) > 2) {
        const want = Math.atan2(-me.vx, -me.vz) - c.yaw;
        c.yaw += Math.atan2(Math.sin(want), Math.cos(want)) * Math.min(1, dt * 0.8);
      }
    }
    c.x = damp(c.x, me.x, 14, dt); c.z = damp(c.z, me.z, 14, dt);
    c.y = damp(c.y, me.y + 0.8, me.vy < -14 ? 14 : 7, dt);
    const cp = Math.cos(c.pitch), ox = Math.sin(c.yaw) * cp, oy = Math.sin(c.pitch), oz = Math.cos(c.yaw) * cp;
    const want = 6.2 + clamp(-me.vy - 14, 0, 12) * 0.15;
    const f = W.castSphere(c.x, c.y, c.z, c.x + ox * want, c.y + oy * want, c.z + oz * want, 0.28, hit);
    const d = Math.max(1.1, f * want - 0.15);
    c.d = d < c.d ? d : damp(c.d, d, 3, dt);
    const cam = R.camera;
    cam.position.set(c.x + ox * c.d, Math.max(0.8, c.y + oy * c.d), c.z + oz * c.d);
    cam.lookAt(c.x, c.y, c.z);
    if (fk > 0.01) {
      // Their eyes, where the game puts them. Updates come 12 times a second, so the eyes glide between them instead of
      // stepping (a jump back to a checkpoint is not glided).
      const ex = me.x - ox * 0.18, ey = me.y + 1.02 - oy * 0.18, ez = me.z - oz * 0.18, E = this.eye || (this.eye = { x: ex, y: ey, z: ez });
      if (Math.abs(E.x - ex) + Math.abs(E.y - ey) + Math.abs(E.z - ez) > 3) { E.x = ex; E.y = ey; E.z = ez; }
      else { E.x = damp(E.x, ex, 24, dt); E.y = damp(E.y, ey, 24, dt); E.z = damp(E.z, ez, 24, dt); }
      // Nearly there is there: what is left of the camera round the back would only shake.
      const k = fk > 0.99 ? 1 : fk;
      cam.position.set(cam.position.x + (E.x - cam.position.x) * k, cam.position.y + (E.y - cam.position.y) * k, cam.position.z + (E.z - cam.position.z) * k);
      cam.lookAt(cam.position.x - ox * 6, cam.position.y - oy * 6, cam.position.z - oz * 6);
    } else this.eye = null;
    if (rig && fk >= 0.72) rig.g.visible = false;
    // Their gun, as they see it (main.js draws it with viewgun.js).
    if (rig) this.view = { weapon: rig.weapon, aim: !!(me.flags & F.AIM), speed: Math.hypot(me.vx, me.vz), ground: !!(me.flags & F.GROUND), shot: T - (this.shotAt.get(this.focus) ?? -9), world: W, rig };
    // Wider through the eyes, and narrowed while they aim, the way their own screen is.
    const ak = (this.aimK = damp(this.aimK || 0, inMaze && me.flags & F.AIM ? 1 : 0, 12, dt)), gun = rig && rig.weapon ? weaponOf(rig.weapon.id) : null;
    let fov = 66 + clamp(-me.vy - 12, 0, 20) * 0.5;
    fov += (74 - fov) * fk;
    fov += (Math.min(48, gun ? gun.zoom : 48) - fov) * ak;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = damp(cam.fov, fov, 4 + 12 * ak, dt); cam.updateProjectionMatrix(); }
    this.orbited = true;
  }

  // Flying, for the team: it goes where the camera looks, through anything. This is only a camera, it isn't in the climb at
  // all, so nobody there can see it and nothing about the climb changes.
  flyCam(dt, dx, dy, inp) {
    const f = this.fly, t = this.flyPad, cam = this.R.camera, k = this.app.input.keys, foc = document.activeElement;
    // Space goes up here, and on a button it would also press that button again when let go.
    if (foc && foc.tagName === 'BUTTON') foc.blur();
    f.yaw -= dx;
    f.pitch = clamp(f.pitch + dy, -1.5, 1.5);
    const cp = Math.cos(f.pitch), lx = -Math.sin(f.yaw) * cp, ly = -Math.sin(f.pitch), lz = -Math.cos(f.yaw) * cp, rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    // read(0) gives sideways as mx and forwards as minus mz.
    const sx = clamp(inp.mx + t.sx, -1, 1), sy = clamp(t.sy - inp.mz, -1, 1);
    const up = (inp.jump || t.up ? 1 : 0) - (inp.grab || t.down || k.has('KeyC') || k.has('KeyQ') ? 1 : 0);
    const v = FLY_SPEED * (inp.reel || t.fast ? FLY_FAST : 1);
    f.vx = damp(f.vx, (lx * sy + rx * sx) * v, 8, dt);
    f.vy = damp(f.vy, (ly * sy + up) * v, 8, dt);
    f.vz = damp(f.vz, (lz * sy + rz * sx) * v, 8, dt);
    f.x = clamp(f.x + f.vx * dt, -FLY_ROOM, FLY_ROOM);
    f.y = clamp(f.y + f.vy * dt, 0.8, this.L.top + 80);
    f.z = clamp(f.z + f.vz * dt, -FLY_ROOM, FLY_ROOM);
    cam.position.set(f.x, f.y, f.z);
    cam.lookAt(f.x + lx, f.y + ly, f.z + lz);
    if (Math.abs(cam.fov - 70) > 0.1) { cam.fov = damp(cam.fov, 70, 6, dt); cam.updateProjectionMatrix(); }
  }

  // From where the camera is right now, looking the same way. Before anything was drawn that is nowhere, so it waits a frame.
  setFly(on) {
    if (on && !this.orbited) { this.wantFly = true; return; }
    this.wantFly = false;
    if (on === !!this.fly) return;
    const t = this.flyPad;
    t.sx = t.sy = 0;
    t.up = t.down = false;
    if (on) {
      const p = this.R.camera.position, c = this.cam;
      this.fly = { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, yaw: c.yaw, pitch: clamp(c.pitch, -1.5, 1.5) };
    } else {
      this.fly = null;
      this.snap = true;
    }
    if (this.hooks.fly) this.hooks.fly(on);
  }

  // Next to someone, with them in view.
  flyTo(slot = this.focus) {
    const f = this.fly, o = this.vis.get(slot);
    if (!f || !o) return;
    const cp = Math.cos(f.pitch);
    f.x = o.x + Math.sin(f.yaw) * cp * 6;
    f.y = Math.max(0.8, o.y + 0.8 + Math.sin(f.pitch) * 6);
    f.z = o.z + Math.cos(f.yaw) * cp * 6;
    f.vx = f.vy = f.vz = 0;
  }

  // Inside a maze garden (where nothing of the map's event reaches).
  inMaze(o) {
    for (const m of this.L.mazes || []) {
      const feet = o.y - PR, ex = o.x - m.x, ez = o.z - m.z;
      if (feet > m.y - 0.8 && feet < m.y + MAZE_WALL_H - 0.3 && Math.abs(ex * m.fx + ez * m.fz) < m.half + 0.05 && Math.abs(ex * m.nx + ez * m.nz) < m.half + 0.05) return true;
    }
    return false;
  }

  // Every shot whose moment has come: the streak of light, its sound and its blast.
  playShots(T) {
    const app = this.app, cam = this.R.camera.position;
    for (let i = 0; i < this.shots.length; ) {
      const a = this.shots[i];
      // Ones from long ago (a climb picked up again) are dropped.
      if (a[9] > T && a[9] < T + 5) { i++; continue; }
      this.shots.splice(i, 1);
      if (a[9] < T - 2 || a[9] > T + 5) continue;
      const gun = weaponOf(a[8]), from = [a[1], a[2], a[3]], to = [a[4], a[5], a[6]];
      this.shotAt.set(a[0], a[9]);
      app.fx.tracer(a[0], from, to, !!a[7], gun);
      if (gun.blast && a[7]) app.fx.blast(a[0], to[0], to[1], to[2], gun);
      const d = Math.hypot(from[0] - cam.x, from[1] - cam.y, from[2] - cam.z);
      if (d < 70) app.sound.shoot(gun.snd, clamp(1 - d / 70, 0.15, 0.8));
    }
  }

  // The angry dummies, where the climbing phone says they are.
  drawJumpers(dt) {
    const rigs = this.app.pool.jumpers;
    if (!rigs) return;
    const used = new Set(), a = this.jump;
    for (let k = 0; k + 7 < a.length; k += 8) {
      const J = this.L.jumpers[a[k]];
      if (!J || ![1, 2, 3, 4, 6, 7].every((i) => Number.isFinite(a[k + i]))) continue;
      let e = this.jrigs.get(J);
      if (!e) {
        const r = rigs.find((q) => ![...this.jrigs.values()].some((x) => x.r === q));
        if (!r) continue;
        e = { r, x: a[k + 1], y: a[k + 2], z: a[k + 3] };
        this.jrigs.set(J, e);
        r.show();
      }
      used.add(J);
      e.x = damp(e.x, a[k + 1], 14, dt); e.y = damp(e.y, a[k + 2], 14, dt); e.z = damp(e.z, a[k + 3], 14, dt);
      const st = a[k + 5], flags = (e.y <= J.y + 0.02 ? F.GROUND : 0) | (st === 2 ? F.KICK : 0) | (st === 4 ? F.STUN : 0);
      e.r.update(dt, e.x, e.y + PR, e.z, a[k + 6], 0, a[k + 7], flags, 0, J.y, a[k + 4], 9);
    }
    for (const [J, e] of this.jrigs) if (!used.has(J)) { e.r.hide(); this.jrigs.delete(J); }
  }

  follow(slot) {
    if (!this.players.has(slot)) return;
    this.focus = slot;
    this.flyTo(slot);
    this.hooks.team(this);
  }

  destroy() {
    const app = this.app, el = this.dragEl;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    for (const r of this.robots.values()) r.hide();
    for (const e of this.jrigs.values()) e.r.hide();
    for (const l of this.links) l.mesh.mesh.visible = false;
    this.robots.clear();
    this.jrigs.clear();
    this.links = [];
    app.fx.clear();
    app.evfx.clear();
    this.R.indoor = false;
    app.view.setSecrets(false);
    if (this.L) {
      for (const d of this.L.doors) d.col.on = true;
      app.view.resetDoors();
    }
    const tags = document.getElementById('tags');
    if (tags) tags.innerHTML = '';
    app.input.camDX = app.input.camDY = 0;
  }
}
