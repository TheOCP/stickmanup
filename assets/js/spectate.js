// Watching a friend climb. This never touches the physics or the record of a climb: it draws what the friend's phone says,
// and everything that phone says is checked here first, because a phone can say anything.
import { F, PR } from './player.js';
import { Chain } from './chain.js';
import { COLORS, validColor } from './colors.js';
import { Storm } from './storm.js';
import { DIFFS, MAPS, zoneAt } from './level.js';
import { EMOTE } from './emotes.js';
import { clamp, damp, r3 } from './util.js';
import { resolveLook, plainLook, cleanLook, cleanRole } from './skins.js';

const STEP = 1 / 60, DELAY = 0.25, KEEP = 48;
const hit = { nx: 0, ny: 0, nz: 0, d: 0 };

// ---------- what the climbing phone sends ----------
// The whole picture. Sent again whenever it changes. The first two keys have to stay first: the server looks for them.
export function feedGame(g) {
  const players = [];
  for (const [s, p] of g.s.players) players.push({ s, name: String(p.name || ''), color: g.colorOf(s), look: p.look || null, role: p.role || '' });
  return { t: 'g', map: g.map, diff: g.diff, rules: g.rules, noCord: g.noCord, rope: g.rope, doors: [...g.doors], me: g.slot, players };
}

// Where everyone is right now.
export function feedState(g, paused) {
  const me = g.me, rob = g.robots, emote = (s) => { const r = rob.get(s); return r && r.emote ? r.emote.id : 0; };
  const self = rob.get(g.slot), p = [[g.slot, r3(me.x), r3(me.y), r3(me.z), r3(me.vx), r3(me.vy), r3(me.vz), r3(self ? self.yaw : 0), me.flags, r3(me.reel), r3(me.charge), emote(g.slot)]];
  for (const [s, v] of g.vis || []) {
    if (s !== g.slot && g.s.players.has(s)) p.push([s, r3(v.x), r3(v.y), r3(v.z), r3(v.vx), r3(v.vy), r3(v.vz), r3(v.yaw || 0), v.flags | 0, r3(v.reel || 0), r3(v.charge || 0), emote(s)]);
  }
  const m = { t: 's', T: r3(g.time), f: g.falls, p };
  const j = g.jumpPack();
  if (j.length) m.j = j;
  if (paused) m.z = 1;
  if (g.won) m.w = 1;
  return m;
}

// ---------- what the watching phone does with it ----------
const inList = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
const rule = (v, d) => (Number.isInteger(v) && v >= 0 && v < DIFFS.length ? v : d);
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
    this.focus = 0;
    this.touched = -9;
    this.snap = true;
    this.infoAcc = 0;
    this.bgBolt = 2;
    this.wind = { x: 0, z: 0 };
    this.cam = { yaw: 0.6, pitch: 0.34, d: 7, x: 0, y: 5, z: 0 };
    // A finger anywhere that isn't a button turns the camera.
    this.drag = null;
    const el = this.dragEl = document.getElementById('menu');
    this.onDown = (e) => { if (!e.target.closest('button')) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
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
      const custom = ['cps', 'haz', 'rope'].some((k) => rules[k] !== undefined && rules[k] !== diff);
      app.view.setSecrets(diff >= 2 && !custom);
      app.pool.coins.clear();
      app.pool.relic.show(null);
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
    this.ready = true;
    this.hooks.team(this);
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
    this.held = !!m.z;
    this.won = !!m.w;
    if (Array.isArray(m.j)) this.jump = m.j.slice(0, 80); else this.jump = [];
    if (T <= this.lastT && this.frames.length) return;
    this.lastT = T;
    const p = new Map();
    for (const a of m.p.slice(0, 4)) if (goodRow(a)) p.set(a[0], a);
    this.frames.push({ t: T, p });
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
    return o;
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
    const T = this.clock === null ? 0 : this.held ? this.lastT : now + this.clock - DELAY;
    // This is what reads the controller's sticks. What it says about moving is for playing, so it goes nowhere.
    app.input.read(0);
    for (const [slot, r] of this.robots) {
      const o = this.vis.get(slot) || {}, got = this.sample(slot, T, o);
      r.g.visible = !!got;
      if (!got) { this.vis.delete(slot); r.hide(); continue; }
      this.vis.set(slot, o);
      const e = this.emoteOf(slot);
      if (e !== (this.emotes.get(slot) || 0)) { this.emotes.set(slot, e); if (e) r.playEmote(e); }
      r.update(dt, o.x, o.y, o.z, o.vx, o.vy, o.vz, o.flags, o.charge, W.floorBelow(o.x, o.y, o.z, 30), o.yaw, 9);
    }
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
    if (!me) return;
    const c = this.cam;
    if (this.snap) { this.snap = false; c.x = me.x; c.y = me.y + 0.8; c.z = me.z; c.yaw = Math.atan2(me.x, me.z) || 0.6; }
    const [dx, dy] = app.input.takeCam(false);
    c.yaw -= dx;
    c.pitch = clamp(c.pitch + dy, -0.3, 1.25);
    if (dx || dy) this.touched = now;
    // Left alone, the camera comes round behind whoever it follows.
    if (now - this.touched > 3 && Math.hypot(me.vx, me.vz) > 2) {
      const want = Math.atan2(-me.vx, -me.vz) - c.yaw;
      c.yaw += Math.atan2(Math.sin(want), Math.cos(want)) * Math.min(1, dt * 0.8);
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
    const fov = 66 + clamp(-me.vy - 12, 0, 20) * 0.5;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = damp(cam.fov, fov, 4, dt); cam.updateProjectionMatrix(); }

    const zi = zoneAt(L, me.y), last = L.zones[L.zones.length - 1], eye = clamp((me.y - last.y0) / (L.top - last.y0), 0, 1), gust = this.storm.gust(T, zi);
    this.wind.x = this.wind.z = 0;
    if (gust && gust.on) {
      const r = Math.hypot(me.x, me.z) || 1;
      this.wind.x = gust.radial ? (me.x / r) * gust.str : (-me.z / r) * gust.sign * gust.str;
      this.wind.z = gust.radial ? (me.z / r) * gust.str : (me.x / r) * gust.sign * gust.str;
    }
    R.update(dt, cam.position, L.zones[zi], eye, this.wind);
    R.shadowFocus(me.x, me.y, me.z);
    this.bgBolt -= dt;
    if (this.bgBolt <= 0 && L.mapKey === 'storm') {
      this.bgBolt = (2 + Math.random() * 7) * (1 - zi * 0.08) * (1 + eye * 3);
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 260;
      R.bolt(me.x + Math.cos(a) * r, Math.max(0, me.y - 60 + Math.random() * 50), me.z + Math.sin(a) * r, 2.2);
      app.sound.thunder(r);
    }
    app.sound.ambient(0.2 + (me.y / L.top) * 0.6 + (gust && gust.on ? 0.8 : 0), false, 0, L.mapKey === 'storm' ? 1 - eye * 0.8 : 0, L.mapKey === 'waterfall' ? 1 : 0);
    app.view.camPos = cam.position;
    app.view.update(T - STEP, dt, this.storm, 1);
    app.sound.setStyle(L.mapKey);
    app.sound.setIntensity(0.3 + clamp(me.y / L.top, 0, 1) * 0.7);
    app.ui.tags(this.tagsView || (this.tagsView = { vis: this.vis, s: { players: this.players } }));
    this.tagsView.s.players = this.players;

    this.infoAcc += dt;
    if (this.infoAcc > 0.2) {
      this.infoAcc = 0;
      const p = this.players.get(this.focus), marks = [];
      for (const [s, v] of this.vis) marks.push([s, clamp(v.y / L.top, 0, 1) * 100]);
      this.hooks.info({ name: p ? p.name : '', map: MAPS[this.map].name, diff: DIFFS[this.diff].name, T: Math.max(0, T), h: Math.max(0, Math.round(me.y - PR - 2)), top: Math.round(L.top - 2), falls: this.falls, held: this.held, won: this.won, marks });
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
