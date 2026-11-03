// Copied from assets/js by dev/makesim.mjs. Do not edit here.
// One climb in progress: local physics, cords, remote climbers, hazards, abilities, team rules and camera.
import * as THREE from './stub-three.js';
import { Body, F, PR, cord } from './player.js';
import { Chain } from './chain.js';
import { COLORS } from './colors.js';
import { Storm } from './storm.js';
import { DIFFS, LEVEL_VERSION, cpEnabled, zoneAt } from './level.js';
import { EMOTE } from './emotes.js';
import { clamp, damp, store, r3, hash } from './util.js';
import { addCoins, firstWin, foundRelic, hasRelic, award, recordRun, addTotals, flushProfile } from './profile.js';
import * as cloud from './cloud.js';
import { resolveLook, plainLook } from './skins.js';

const STEP = 1 / 60, SEND = 1 / 20, DELAY = 0.11;
const NONE = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false, act: false, shield: false, aim: false, fire: false };
const hit = { nx: 0, ny: 0, nz: 0, d: 0 }, fwd = new THREE.Vector3(), tmpP = {};
const RANGE = 70, skipSoft = (c) => c.kind === 'hook';
// A coin is worth more the harder the difficulty, and so is reaching the top.

// Distance along a unit ray to a sphere, or -1.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const px = cx - ox, py = cy - oy, pz = cz - oz, t = px * dx + py * dy + pz * dz;
  if (t < 0) return -1;
  const d2 = px * px + py * py + pz * pz - t * t;
  return d2 > r * r ? -1 : t - Math.sqrt(r * r - d2);
}

export class Game {
  constructor(app, session, g) {
    this.app = app;
    this.s = session;
    this.L = app.level;
    this.W = app.world;
    this.R = app.renderer;
    this.map = g.map || 0;
    this.diff = g.diff;
    this.D = DIFFS[g.diff];
    this.storm = new Storm(this.L, g.diff);
    // Custom rules (game creation): checkpoints, hazards and cord length, each following the difficulty
    // unless set. cpl 0 every zone / 1 a few / 2 none; hazards 0 calm / 1 normal / 2 wild.
    this.rules = g.rules || {};
    this.cpl = this.rules.cps ?? g.diff;
    this.rope = DIFFS[this.rules.rope ?? g.diff].rope;
    this.storm.setHaz(this.rules.haz ?? g.diff);
    this.solo = session.mode === 'solo';
    this.t0 = g.t0;
    this.base = g.base || 0;
    this.soloT = this.base;
    this.cp = g.cp || 0;
    this.falls = Math.max(0, Math.floor(+g.falls) || 0);
    this.slot = session.slot;
    this.noCord = !!g.noCord; // multiplayer option: climb without being tied together
    // Checkpoints: tied together, the team shares one. Without the cord everyone has their own; the host
    // keeps track of them all by slot (pcp).
    if (this.noCord) {
      this.pcp = Object.assign({}, g.pcp);
      if (this.pcp[this.slot] !== undefined) this.cp = this.pcp[this.slot];
      this.pcp[this.slot] = this.cp;
    }
    this.me = new Body();
    const p = g.pos && g.pos[this.slot] ? g.pos[this.slot] : this.spawnPos(this.cp, this.slot);
    this.me.spawn(p[0], p[1], p[2]);
    this.robots = new Map();
    this.links = [];
    this.others = [];
    this.simT = this.time;
    this.sendAcc = 0;
    this.saveAcc = 0;
    this.hudAcc = 0;
    this.bgBolt = 2;
    this.cpSent = new Set();
    this.maxZone = -1;
    // Jumpers (angry dummies): the host runs them, everyone else follows the host's updates.
    this.jumpers = this.L.jumpers.map((j) => ({ j, x: j.x, y: j.y, z: j.z, vx: 0, vy: 0, vz: 0, yaw: j.ry, st: 0, t: 0, cd: 0, seen: -9, active: false, hitMe: false }));
    this.jrigs = new Map();
    for (const r of app.pool.jumpers || []) { r.hide(); if (this.L.jumpers[0]) { r.setColor(this.L.jumpers[0].look.c); r.bandMat.color.setHex(this.L.jumpers[0].look.g); } }
    this.won = false;
    this.winSent = false;
    this.splashed = false;
    this.knockCd = 0;
    this.shotCd = 0;
    this.aimK = 0;
    this.aiming = false;
    this.action = null;
    this.zaps = new Map(); // slot -> { k, x, y, z, struck } lightning aimed at each climber (storm map)
    // Each map's level objects are reused between games: close doors and mend floors from last time.
    for (const d of this.L.doors) d.col.on = true;
    for (const c of this.L.crumbles) { c.crumble.st = 0; c.crumble.t = 0; c.on = true; }
    app.view.resetDoors();
    this.doors = new Set(g.doors || []);
    for (const i of this.doors) this.openDoor(i, true);
    for (const st of g.stuns || []) this.storm.stun.set(st[0], { from: st[1], until: st[2] });
    this.wind = { x: 0, z: 0 };
    // Coins, relics and the record of this climb. Picking a saved climb back up keeps all three.
    const sf = g.base > 0 && session.isHost ? store.get(this.solo ? 'save.solo' : 'save.mp') : null, sv = sf && sf.v === LEVEL_VERSION ? sf : null;
    this.custom = ['cps', 'haz', 'rope'].some((k) => this.rules[k] !== undefined && this.rules[k] !== this.diff);
    // Real Hardcore or harder only: the hidden places don't exist with easier custom rules.
    this.hardcore = this.diff >= 2 && !this.custom;
    // Coins only count where the server can see the climb: alone, or in a room on the game server.
    this.earning = this.solo || !!(session.link && session.link.isServer);
    this.rec = null;
    cloud.runStart({ map: this.map, diff: this.diff, rules: this.rules, custom: this.custom, earning: this.earning, resumed: g.base > 0 && !!sv, run: sv && sv.climbId, rs: sv && sv.rs, name: session.name, mode: session.mode });
    app.view.setSecrets(this.hardcore);
    this.coinTaken = new Set((sv && sv.coins) || []);
    this.coinB = this.L.coinB || (this.L.coinB = {});
    if (!this.L.coinBuilt) { this.L.coinBuilt = true; for (const c of this.L.coins) (this.coinB[Math.floor(c.y / 8)] ||= []).push(c); }
    this.coinRow = 0;
    this.coinAcc = 0;
    this.relicNear = new Set();
    this.nearRelic = null;
    this.recAcc = 0;
    this.run = (sv && sv.run) || { id: Date.now().toString(36) + ((Math.random() * 1296) | 0).toString(36), map: this.map, diff: this.diff, custom: this.custom, h: 0, falls: 0, t: 0, coins: 0, won: false, when: Date.now(), players: 1 };
    if (!sv) addTotals(0, 1);
    app.ui.coins(this.run.coins);
    // Without the cord, climbers pass through each other (no bumping anyone off a ledge).
    this.env = { world: this.W, others: this.noCord ? [] : this.others, grip: this.D.grip, coyote: this.D.coyote, maxReel: this.rope - 1.2, wind: null };
    const th = Math.atan2(this.me.z, this.me.x);
    this.cam = { yaw: Math.PI - th, pitch: 0.34, d: 7, x: this.me.x, y: this.me.y + 0.7, z: this.me.z };

    // The moving parts start from this moment, so a rerun of this climb starts from exactly the same place.
    this.W.setTime(this.simT);
    session.on('event', (e) => this.onEvent(e));
    session.on('hostEvent', (e, from) => this.hostEvent(e, from));
    const lobbyRoster = session.h.roster;
    session.on('roster', (slot, joined) => {
      this.syncRoster();
      if (lobbyRoster) lobbyRoster(slot, joined);
    });
    session.on('S', (m) => {
      if (m.f !== undefined) this.falls = m.f;
      if (m.cp !== undefined && m.cp !== this.cp) { if (this.rec) this.rec.act('m', m.cp); this.cp = m.cp; app.view.setCheckpoints(this.cpl, this.cp); }
      if (m.jp) this.jumpNet(m.jp);
    });
    session.on('snapshot', (slot) => this.snapshot(slot));
    // Names and colours can change mid-game (Settings): redraw stickmen, cords and name tags.
    const lobbyH = session.h.lobby;
    session.on('lobby', () => { this.refreshPlayers(); if (lobbyH) lobbyH(); });
    session.on('gameTime', () => this.time);
    this.syncRoster();
    app.view.setCheckpoints(this.cpl, this.cp);
    // From here on the climb is written down, starting with everything it started from.
    this.rec = cloud.recorder({ mode: session.mode, slot: this.slot, map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, pcp: this.pcp, t: this.simT, cp: this.cp, falls: this.falls, doors: [...this.doors], stuns: g.stuns || [], pos: [p[0], p[1], p[2]], coins: [...this.coinTaken], resume: sv ? sv.rs : undefined, roster: [...session.players.keys()] });
  }

  get time() {
    return this.solo ? this.soloT : (this.s.now() - this.t0) / 1000 + this.base;
  }

  // On the checkpoint's pad (never out by the edge): a spot on a small ring round its pole, far enough apart
  // not to bump each other off.
  spawnPos(i, slot) {
    const cp = this.L.cps[i];
    const a = (slot / 4) * Math.PI * 2 + 0.4;
    return [cp.x + Math.cos(a) * 0.64, cp.y + PR + 0.4, cp.z + Math.sin(a) * 0.64];
  }

  snapshot(slot) {
    const m = this.me, stuns = [];
    for (const [k, v] of this.storm.stun) stuns.push([k, v.from, v.until]);
    // A player joining a game without the cord starts with the host's checkpoint (they appear next to the host).
    if (this.noCord && this.pcp[slot] === undefined) this.pcp[slot] = this.cp;
    return { map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, pcp: this.pcp, t0: this.t0, base: this.base, cp: this.noCord ? this.pcp[slot] : this.cp, falls: this.falls, doors: [...this.doors], stuns,
      pos: { [slot]: [m.x + 0.6, m.y + 1.2, m.z] } };
  }

  // A player's chosen colour (their slot colour if they haven't picked one).
  colorOf(slot) {
    const p = this.s.players.get(slot);
    return (p && p.color) ?? COLORS[slot % 4];
  }

  // What someone wears. Their colour is for the cord, the name tag and their effects.
  dress(s, r) {
    const p = this.s.players.get(s), c = this.colorOf(s);
    r.setLook(p && p.look ? resolveLook(p.look, p.name) : plainLook(c));
    this.app.fx.setColor(s, c);
  }

  refreshPlayers() {
    for (const [s, r] of this.robots) this.dress(s, r);
    for (const lk of this.links) lk.mesh.setColors(this.colorOf(lk.a), this.colorOf(lk.b));
    this.app.ui.players(this);
  }

  // Climbers and cords come from the app-wide pool (never created or disposed mid-game).
  syncRoster() {
    const pool = this.app.pool, slots = [...this.s.players.keys()].sort((a, b) => a - b);
    for (const s of slots) if (!this.robots.has(s)) { const r = pool.robots[s % 4]; r.show(); this.robots.set(s, r); }
    for (const s of slots) this.dress(s, this.robots.get(s));
    if (this.rec && !this.solo) this.rec.act('R', slots);
    for (const [s, r] of this.robots) if (!this.s.players.has(s)) { r.hide(); this.robots.delete(s); }
    for (const l of this.links) l.mesh.mesh.visible = false;
    this.links = [];
    for (let i = 0; i + 1 < slots.length && !this.noCord; i++) {
      const a = slots[i], b = slots[i + 1], mesh = pool.ropes[i];
      mesh.setColors(this.colorOf(a), this.colorOf(b));
      this.links.push({ a, b, chain: new Chain(12), mesh, ten: 0, L: this.rope });
    }
    this.app.ui.players(this);
  }

  // Remote climber at time t, interpolated between network samples (or extrapolated briefly).
  sample(slot, t, out) {
    const p = this.s.players.get(slot), S = p && p.samples;
    if (!S || !S.length) return null;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) if (S[i].t <= t) { a = S[i]; b = S[i + 1] || null; break; }
    const s = a.s;
    if (b && b.t > a.t) {
      const f = clamp((t - a.t) / (b.t - a.t), 0, 1), q = b.s;
      out.x = s[0] + (q[0] - s[0]) * f; out.y = s[1] + (q[1] - s[1]) * f; out.z = s[2] + (q[2] - s[2]) * f;
    } else {
      const e = clamp(t - a.t, 0, 0.2);
      out.x = s[0] + s[3] * e; out.y = s[1] + s[4] * e; out.z = s[2] + s[5] * e;
    }
    out.vx = s[3]; out.vy = s[4]; out.vz = s[5]; out.yaw = s[6]; out.flags = s[7]; out.reel = s[8]; out.charge = s[9];
    return out;
  }

  latest(slot, out) {
    const p = this.s.players.get(slot), S = p && p.samples;
    if (!S || !S.length) return null;
    return this.sample(slot, S[S.length - 1].t + clamp(this.time - S[S.length - 1].t, 0, 0.15), out);
  }

  update(dt, paused) {
    const app = this.app;
    if (this.solo) {
      if (paused) return this.drawSmooth(dt);
      this.soloT += dt;
    }
    const T = this.time;
    const inp = paused ? NONE : app.input.read(this.cam.yaw);

    this.others.length = 0;
    this.vis = this.vis || new Map();
    for (const slot of this.s.players.keys()) {
      if (slot === this.slot) continue;
      const o = this.vis.get(slot) || {};
      if (this.sample(slot, T - DELAY, o)) {
        // Rounded the way it gets written down, so the rerun bumps into exactly the same place.
        o.x = Math.round(o.x * 1024) / 1024; o.y = Math.round(o.y * 1024) / 1024; o.z = Math.round(o.z * 1024) / 1024;
        o.slot = slot;
        this.vis.set(slot, o);
        this.others.push(o);
      }
    }

    // Abilities are taps, handled once per frame. SHOOT aims while held and fires on release.
    if (inp.shield && this.L.mapKey === 'storm' && this.me.raiseShield()) { if (this.rec) this.rec.act('s'); app.sound.shield(); }
    if (inp.act && this.action) this.perform(this.action, T);
    this.aiming = this.me.aim = !!inp.aim && !this.me.hook;
    if (inp.fire) this.fire(T);

    // A jump tap is kept until a physics step uses it: at 120 fps half the frames run no physics step,
    // and a tap read on one of those frames used to be lost.
    if (inp.jumpPressed) this.jumpQueued = true;
    if (inp.dash) this.dashQueued = true;
    if (T - this.simT > 0.25 || T < this.simT - 0.25) { this.simT = T - STEP; if (this.rec) this.rec.act('t', this.simT); }
    let n = 0;
    while (this.simT + STEP <= T && n < 6) {
      const jp = this.jumpQueued, dq = this.dashQueued;
      this.jumpQueued = this.dashQueued = false;
      this.prevX = this.me.x; this.prevY = this.me.y; this.prevZ = this.me.z;
      this.playStep(jp === inp.jumpPressed && dq === !!inp.dash ? inp : Object.assign({}, inp, { jumpPressed: jp, dash: dq }));
      n++;
    }

    this.sendAcc += dt;
    if (!this.solo && this.sendAcc >= SEND) {
      this.sendAcc = 0;
      const m = this.me, st = [r3(m.x), r3(m.y), r3(m.z), r3(m.vx), r3(m.vy), r3(m.vz), r3(this.robots.get(this.slot).yaw), m.flags, r3(m.reel), r3(m.charge)];
      if (this.s.isHost) {
        const ex = this.noCord ? { f: this.falls } : { f: this.falls, cp: this.cp }, jp = this.jumpPack();
        if (jp.length) ex.jp = jp;
        this.s.hostState(T, st, ex);
      }
      else this.s.sendState(st);
    }
    this.saveAcc += dt;
    if (this.s.isHost && this.saveAcc > 4 && !this.won) { this.saveAcc = 0; this.save(); }
    this.recAcc += dt;
    if (this.recAcc > 3 && !this.won) { this.recAcc = 0; this.noteRun(); }
    this.drawSmooth(dt);
  }

  // Physics runs in fixed steps, which never line up exactly with the screen: some frames get no step and some
  // get two. Drawn as is, the climber jitters against the camera even at a perfect 60. So each frame draws the
  // climber at the exact point in time between the last two steps. (A jump in position is a teleport: no blend.)
  drawSmooth(dt) {
    const me = this.me, x = me.x, y = me.y, z = me.z, a = clamp((this.time - this.simT) / STEP, 0, 1);
    this.alpha = a;
    if (this.prevX !== undefined && Math.abs(x - this.prevX) + Math.abs(y - this.prevY) + Math.abs(z - this.prevZ) < 3) {
      me.x = this.prevX + (x - this.prevX) * a;
      me.y = this.prevY + (y - this.prevY) * a;
      me.z = this.prevZ + (z - this.prevZ) * a;
    }
    this.draw(dt);
    me.x = x; me.y = y; me.z = z;
  }

  // One physics step on the phone, written down first when this climb counts.
  playStep(inp) {
    const rec = this.rec;
    this.stepping = true;
    if (rec) { rec.stepping = true; this.step(rec.tick(inp)); rec.stepping = false; rec.done(this.me); }
    else this.step(inp);
    this.stepping = false;
    if (this.saveLater) { this.saveLater = false; this.save(); }
  }

  // Where a partner was for the cord, rounded the way it gets written down.
  partnerAt(slot, op) {
    if (!this.latest(slot, op)) return null;
    op.x = Math.round(op.x * 1024) / 1024; op.y = Math.round(op.y * 1024) / 1024; op.z = Math.round(op.z * 1024) / 1024;
    op.vy = Math.round((op.vy || 0) * 1024) / 1024; op.reel = Math.round((op.reel || 0) * 1024) / 1024;
    if (this.rec) this.rec.partner(0, slot, op);
    return op;
  }

  step(inp) {
    this.simT += STEP;
    for (const J of this.jumpers) if (J.active) { J.ox = J.x; J.oy = J.y; J.oz = J.z; }
    this.app.view.snapDyn();
    const t = this.simT, me = this.me, slot = this.slot;
    this.W.setTime(t);
    this.crumbles(STEP);
    const S = this.storm;
    for (const c of this.L.blinks) { c.on = !S.on(c.blink) || S.blink(c.blink, t).on; if (!c.on && me.anchorCol === c) me.release(); }
    for (const c of this.L.traps) { c.on = !S.on(c.trap) || !S.trap(c.trap, t).open; if (!c.on && me.anchorCol === c) me.release(); }
    const zone = zoneAt(this.L, me.y);
    this.env.wind = (b, o) => this.storm.wind(b, o, t, zone);
    if (this.rec && !this.solo && !this.noCord) for (const o of this.others) if (Math.abs(o.x - me.x) + Math.abs(o.y - me.y) + Math.abs(o.z - me.z) < 4) this.rec.partner(1, o.slot, o);
    me.step(STEP, inp, this.env);
    me.hanging = false;

    // The cord (see cord() in player.js): only my own climber is corrected; the partner's phone does theirs.
    // A bead chain draped over the geometry tells which way the cord leaves me (over an edge, say).
    const op = this.tmpO || (this.tmpO = {});
    for (const lk of this.links) {
      if (lk.a !== slot && lk.b !== slot) continue;
      if (!this.partnerAt(lk.a === slot ? lk.b : lk.a, op)) continue;
      const L = this.rope - Math.max(me.reel, op.reel || 0), mine = lk.a === slot, pc = lk.pc || (lk.pc = new Chain(10));
      if (Math.hypot(op.x - me.x, op.y - me.y, op.z - me.z) > this.rope * 3) { pc.ok = false; continue; }
      pc.step(mine ? me : op, mine ? op : me, L, this.W, STEP);
      cord(me, op, L, this.env, this.rope * 3, pc, mine);
    }

    this.storm.strikes(t - STEP, t, (r) => this.strike(r));
    if (this.solo || this.s.isHost) this.jumpAI(t, STEP);
    this.jumpHits(t);
    this.hazards(t);
    for (const e of me.events) this.bodyEvent(e);
    me.events.length = 0;
    this.checks();
    this.pickups();
  }

  // Coins are each climber's own, and stay gone after a fall. Relics only exist on Hardcore.
  pickups() {
    const me = this.me, b = Math.floor(me.y / 8);
    if (me.grounded) { const h = Math.min(1000, Math.round(me.y - PR - 2)); if (h > this.run.h) this.run.h = h; }
    this.coinAcc -= STEP;
    if (this.coinAcc < 0) this.coinRow = 0;
    for (let k = b - 1; k <= b + 1; k++) {
      const list = this.coinB[k];
      if (!list) continue;
      for (const c of list) {
        if (this.coinTaken.has(c.i)) continue;
        const dx = c.x - me.x, dz = c.z - me.z;
        if (dx * dx + dz * dz < 1.1 && Math.abs(c.y - me.y) < 1.3) this.takeCoin(c);
      }
    }
    if (!this.hardcore) return;
    for (const r of this.L.relics) {
      if (hasRelic(r.id)) continue;
      const d = Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z);
      if (d < 1.9) this.takeRelic(r);
      else if (d < 25 && !this.relicNear.has(r.id)) {
        this.relicNear.add(r.id);
        this.app.sound.relicHum();
        this.app.ui.toast('Something is humming nearby...', 'gold');
      }
    }
  }

  takeCoin(c) {
    const v = this.D.coin;
    this.coinTaken.add(c.i);
    cloud.runCoin(c.i);
    this.run.coins += v;
    if (cloud.counting()) addCoins(v);
    // Quick ones in a row climb in pitch.
    this.coinRow = Math.min(12, this.coinRow + 1);
    this.coinAcc = 1.2;
    this.app.sound.coin(this.coinRow);
    this.app.ui.coins(this.run.coins, true);
  }

  takeRelic(r) {
    const got = foundRelic(r.id), S = this.app.sound;
    cloud.runRelic(r.id);
    S.relic();
    this.app.ui.haptic('heavy');
    if (got[0]) this.app.ui.banner('Legendary found', got[0].name, got[1] ? `That was the last one. ${got[1].name} is yours too.` : 'Wear it from the shop', '#ff9a2e');
    this.nearRelic = null;
  }

  // Writes this climb into the records.
  noteRun() {
    const r = this.run;
    r.falls = this.falls;
    r.t = Math.round(this.time * 10) / 10;
    r.players = Math.max(r.players, this.s.players.size);
    r.when = Date.now();
    if (r.h >= 3 || r.won) recordRun(r);
  }

  // Monsters and bats knock you off on contact; lightning (sunny) strikes where it warned.
  hazards(t) {
    const me = this.me, L = this.L, k = this.storm.k;
    this.knockCd = Math.max(0, this.knockCd - STEP);
    const knock = (fx, fz, src) => {
      if (this.knockCd > 0) return;
      this.knockCd = 0.8;
      const d = Math.hypot(me.x - fx, me.z - fz) || 1, nx = (me.x - fx) / d, nz = (me.z - fz) / d;
      if (me.knock(nx * 9 * k, 6.5 * k, nz * 9 * k, 0.6)) {
        this.app.sound.bonk();
        this.app.ui.haptic('heavy');
        this.app.ui.toast(src === 'bat' ? 'Bat attack!' : 'Monster hit you!', 'bad');
      }
    };
    for (const m of L.monsters) {
      if (Math.abs(m.y - me.y) > 3 || Math.abs(m.ax - me.x) + Math.abs(m.az - me.z) > 14) continue;
      const p = this.storm.monsterPos(m, t, tmpP);
      if (!p.stunned && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < m.r + PR) knock(p.x, p.z, 'monster');
    }
    for (const b of L.bats) {
      if (!this.storm.on(b) || Math.abs(b.cy - me.y) > 3 || Math.abs(b.cx - me.x) + Math.abs(b.cz - me.z) > 12) continue;
      const p = this.storm.batPos(b, t, tmpP);
      if (!p.stunned && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < b.r + PR) knock(p.x, p.z, 'bat');
    }
    // Lasers: a spinning bar (jump over it) and on/off curtains across bridges.
    const S = this.storm, feet = me.y - PR;
    for (const l of L.lasers) {
      if (!S.on(l) || Math.abs(l.y - feet) > 4 || Math.abs(l.x - me.x) + Math.abs(l.z - me.z) > 9) continue;
      if (l.k === 'spin') {
        if (Math.abs(me.y - l.y) > 0.55) continue;
        for (let k = 0; k < (l.n || 1); k++) {
          const a = S.laserAngle(l, t, k), ux = Math.cos(a), uz = -Math.sin(a), px = me.x - l.x, pz = me.z - l.z;
          const along = clamp(px * ux + pz * uz, 0, l.len), dx = px - ux * along, dz = pz - uz * along;
          if (dx * dx + dz * dz < 0.45 * 0.45) {
            // Pushed the way the bar is sweeping.
            const s = Math.sign(l.per);
            this.zapKnock(uz * s * 7, 5, -ux * s * 7, 'laser');
          }
        }
      } else if (S.gate(l, t).on) {
        const px = me.x - l.x, pz = me.z - l.z, a = px * l.ux + pz * l.uz, b = px * -l.uz + pz * l.ux;
        if (Math.abs(a) < 0.35 && Math.abs(b) < l.w + 0.3 && feet > l.y - 0.6 && feet < l.y + l.h) {
          const back = Math.sign(a) || -Math.sign(me.vx * l.ux + me.vz * l.uz) || 1;
          this.zapKnock(l.ux * back * 7, 4.5, l.uz * back * 7, 'laser');
        }
      }
    }
    // Lava geysers: ride an eruption up from the vent; right next to it you get shoved away.
    for (const g of L.geysers) {
      if (!S.on(g) || Math.abs(g.y - feet) > 5 || Math.abs(g.x - me.x) + Math.abs(g.z - me.z) > 6) continue;
      const st = S.geyser(g, t);
      if (!st.on || feet < g.y - 0.4 || feet > g.y + 5) continue;
      const d = Math.hypot(me.x - g.x, me.z - g.z);
      if (d < 1.0) {
        if (me.vy < 15) { me.vy = 16.8; me.grounded = false; me.ground = null; this.app.sound.pad(); this.app.ui.haptic('tick'); }
      } else if (d < 1.9 && st.k < 0.3) this.zapKnock(((me.x - g.x) / d) * 6, 4, ((me.z - g.z) / d) * 6, 'geyser');
    }
    // Falling boulders.
    for (const r of L.rocks) {
      if (!S.on(r) || Math.abs(r.y - feet) > 3 || Math.abs(r.x - me.x) + Math.abs(r.z - me.z) > 5) continue;
      const st = S.rock(r, t, tmpP);
      const d = Math.hypot(me.x - r.x, me.z - r.z);
      if (st.fall > 0.75 && d < 1.25 && feet < r.y + 2.2) this.zapKnock(((me.x - r.x) / (d || 1)) * 8, 5, ((me.z - r.z) / (d || 1)) * 8, 'rock');
    }
    // Arrow traps.
    for (const a of L.arrows) {
      if (!S.on(a) || Math.abs(a.y - me.y) > 3 || Math.abs(a.x - me.x) + Math.abs(a.z - me.z) > 8) continue;
      const p = S.arrow(a, t, tmpP);
      if (p.fly && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < 0.55) this.zapKnock(a.dx * 7, 3.5, a.dz * 7, 'arrow');
    }
    this.obstacles(t, feet);
    const th = this.storm.thunder(t, this.slot);
    if (th) this.zap(this.slot, th, me, true);
  }

  // The themed obstacles (obstacles.js): only nearby ones, only those the hazard setting switches on.
  obstacles(t, feet) {
    const me = this.me, S = this.storm, L = this.L, P = tmpP;
    const away = (x, z, k, up, name) => {
      const dx = me.x - x, dz = me.z - z, d = Math.hypot(dx, dz) || 1;
      this.zapKnock((dx / d) * k, up, (dz / d) * k, 'obstacle', name);
    };
    for (const o of L.obs) {
      if (!S.on(o) || Math.abs(o.y - feet) > 5 || Math.abs(o.x - me.x) + Math.abs(o.z - me.z) > 10) continue;
      switch (o.prim) {
        case 'sweep': {
          if (Math.abs(me.y - o.y) > 0.5 + o.w) break;
          for (let k = 0; k < o.n; k++) {
            const a = S.laserAngle(o, t, k), ux = Math.cos(a), uz = -Math.sin(a), px = me.x - o.x, pz = me.z - o.z;
            const along = clamp(px * ux + pz * uz, 0, o.len), dx = px - ux * along, dz = pz - uz * along;
            if (dx * dx + dz * dz < (0.42 + o.w) * (0.42 + o.w)) { const sg = Math.sign(o.per); this.zapKnock(uz * sg * 7, 5, -ux * sg * 7, 'obstacle', o.name); }
          }
          break;
        }
        case 'pendulum': {
          const p = S.pendulum(o, t, P);
          // Knocked the way it is swinging.
          const sg = Math.cos(Math.PI * 2 * ((t * S.hs) / o.per + o.ph)) >= 0 ? 1 : -1;
          if (Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < o.r + PR) this.zapKnock(o.nx * sg * 8, 4, o.nz * sg * 8, 'obstacle', o.name);
          break;
        }
        case 'slider': {
          const p = S.slider(o, t, P), dx = me.x - p.x, dz = me.z - p.z;
          if (p.hide) break;
          if (o.shape === 'ram') {
            const a = dx * o.ux + dz * o.uz, b = dx * o.vx + dz * o.vz;
            if (Math.abs(a) < o.len / 2 + PR && Math.abs(b) < 0.3 + PR && feet < o.y + 1.15 && p.dir >= 0) this.zapKnock(o.vx * 9, 3, o.vz * 9, 'obstacle', o.name);
          } else if (o.shape === 'log') {
            const a = dx * o.ux + dz * o.uz, b = dx * -o.uz + dz * o.ux;
            if (Math.abs(a) < o.r + PR && Math.abs(b) < o.w / 2 && Math.abs(me.y - p.y) < o.r + PR) this.zapKnock(o.ux * p.dir * 7, 4, o.uz * p.dir * 7, 'obstacle', o.name);
          } else if (Math.hypot(dx, me.y - p.y, dz) < o.r + PR) this.zapKnock(o.ux * p.dir * 7, 4, o.uz * p.dir * 7, 'obstacle', o.name);
          break;
        }
        case 'crusher': {
          const st = S.crusher(o, t), c = Math.cos(o.ry), sn = Math.sin(o.ry), dx = me.x - o.x, dz = me.z - o.z;
          const a = dx * c - dz * sn, b = dx * sn + dz * c;
          if (st.down && st.h < 1.3 && Math.abs(a) < o.hs + PR * 0.6 && Math.abs(b) < o.hs + PR * 0.6 && feet < o.y + 1.4) away(o.x, o.z, 8, 4, o.name);
          break;
        }
        case 'spikes': {
          const st = S.pulse(o, t), c = Math.cos(o.ry), sn = Math.sin(o.ry), dx = me.x - o.x, dz = me.z - o.z;
          const a = dx * c - dz * sn, b = dx * sn + dz * c;
          if (st.on && Math.abs(a) < o.hx + 0.1 && Math.abs(b) < o.hz + 0.1 && feet < o.y + 0.6) away(o.x, o.z, 3, 9, o.name);
          break;
        }
        case 'leap': {
          const p = S.leap(o, t, P);
          if (p.on && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < 0.45 + PR) this.zapKnock(o.nx * o.dir * 7, 4, o.nz * o.dir * 7, 'obstacle', o.name);
          break;
        }
        case 'jet': {
          if (!S.pulse(o, t, 0.5).on) break;
          const px = me.x - o.x, pz = me.z - o.z, along = px * o.dx + pz * o.dz, lat = Math.abs(px * -o.dz + pz * o.dx);
          if (along > 0.2 && along < o.range && lat < 0.55 + along * 0.12 && Math.abs(me.y - o.y) < 1.0) this.zapKnock(o.dx * 7, 3, o.dz * 7, 'obstacle', o.name);
          break;
        }
      }
    }
    // Bumpers: bouncy posts that throw you away (no stun).
    this.bumpCd = Math.max(0, (this.bumpCd || 0) - STEP);
    for (const b of L.bumpers) {
      if (this.bumpCd > 0 || !S.on(b) || Math.abs(b.y - feet) > 1.5) continue;
      const dx = me.x - b.x, dz = me.z - b.z, d = Math.hypot(dx, dz);
      if (d < b.r + PR + 0.08 && feet < b.y + 1.0) {
        me.vx = (dx / (d || 1)) * 9 * S.k; me.vz = (dz / (d || 1)) * 9 * S.k; me.vy = Math.max(me.vy, 3.5);
        me.grounded = false; me.ground = null;
        this.bumpCd = 0.25;
        this.app.sound.pad();
        this.app.ui.haptic('tick');
      }
    }
  }

  // ----- jumpers (angry dummies) -----
  // Host: each one strolls along its ledge; when a climber comes near (and roughly level) it runs at them
  // and, close enough, jump kicks. It never leaves its ledge. Shot: stunned for a while.
  jumpAI(t, dt) {
    if (!this.jumpers.length) return;
    const S = this.storm, me = this.me, targets = [[me.x, me.y, me.z]];
    for (const pl of this.s.players.values()) if (pl.slot !== this.slot && pl.last) targets.push([pl.last[0], pl.last[1], pl.last[2]]);
    for (const J of this.jumpers) {
      const j = J.j;
      let near = false;
      for (const p of targets) if (Math.abs(p[1] - j.y) < 25 && Math.abs(p[0] - j.x) + Math.abs(p[2] - j.z) < 35) near = true;
      J.active = near && S.on(j);
      if (!J.active) continue;
      J.seen = t;
      const stun = S.stun.get(2000 + j.i);
      if (stun && t < stun.until) { J.st = 4; J.vx = J.vz = 0; this.jumpFall(J, dt); continue; }
      if (J.st === 4) J.st = 0;
      J.cd = Math.max(0, J.cd - dt);
      if (J.st === 2) {
        J.x += J.vx * dt; J.z += J.vz * dt;
        this.clampJ(J);
        if (this.jumpFall(J, dt)) { J.st = 3; J.t = 0.6; J.vx = J.vz = 0; }
        continue;
      }
      if (J.st === 3) { J.t -= dt; if (J.t <= 0) J.st = 0; this.jumpFall(J, dt); continue; }
      let best = null, bd = 1e9;
      for (const p of targets) {
        const d = Math.hypot(p[0] - J.x, p[2] - J.z), dy = p[1] - PR - j.y;
        if (dy > -1.5 && dy < 2.8 && d < 8.5 && d < bd) { bd = d; best = p; }
      }
      if (best) {
        const dx = best[0] - J.x, dz = best[2] - J.z, d = Math.max(0.01, bd);
        J.yaw = Math.atan2(dx, dz);
        if (d < 2.7 && J.cd <= 0) {
          // Jump kick: up and straight at them.
          const k = Math.min(7.5, d / 0.42 + 1);
          J.st = 2; J.cd = 1.5 / S.hs; J.vy = 6.2; J.vx = (dx / d) * k; J.vz = (dz / d) * k;
        } else {
          const sp = (d < 1.2 ? 0 : 4.6) * S.hs;
          J.st = 1; J.vx = (dx / d) * sp; J.vz = (dz / d) * sp;
          J.x += J.vx * dt; J.z += J.vz * dt;
          this.clampJ(J);
        }
      } else {
        // Patrol: stroll back and forth along the ledge.
        J.st = 0;
        const ax = Math.cos(j.ry), az = -Math.sin(j.ry), u = Math.sin(t * 0.45 + j.i * 1.7) * j.hx * 0.75;
        const dx = j.x + ax * u - J.x, dz = j.z + az * u - J.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { const sp = Math.min(1.5, d / dt); J.vx = (dx / d) * sp; J.vz = (dz / d) * sp; J.x += J.vx * dt; J.z += J.vz * dt; J.yaw = Math.atan2(dx, dz); }
        else J.vx = J.vz = 0;
      }
      this.jumpFall(J, dt);
    }
  }

  jumpFall(J, dt) {
    J.vy -= 24 * dt;
    J.y += J.vy * dt;
    if (J.y <= J.j.y) { J.y = J.j.y; J.vy = 0; return true; }
    return false;
  }

  clampJ(J) {
    const j = J.j, c = Math.cos(j.ry), s = Math.sin(j.ry), dx = J.x - j.x, dz = J.z - j.z;
    const a = clamp(dx * c - dz * s, -j.hx, j.hx), b = clamp(dx * s + dz * c, -j.hz, j.hz);
    J.x = j.x + a * c + b * s; J.z = j.z - a * s + b * c;
  }

  // Host: the jumpers near anyone, packed into the state message.
  jumpPack() {
    const out = [];
    for (const J of this.jumpers) if (J.active) out.push(J.j.i, r3(J.x), r3(J.y), r3(J.z), r3(J.yaw), J.st, r3(J.vx), r3(J.vz));
    return out;
  }

  // Everyone else: follow the host's jumpers.
  jumpNet(a) {
    const t = this.simT;
    for (let k = 0; k + 7 < a.length; k += 8) {
      const J = this.jumpers[a[k]];
      if (!J) continue;
      J.tx = a[k + 1]; J.ty = a[k + 2]; J.tz = a[k + 3]; J.yaw = a[k + 4]; J.st = a[k + 5]; J.vx = a[k + 6]; J.vz = a[k + 7];
      if (J.seen < t - 1) { J.x = J.tx; J.y = J.ty; J.z = J.tz; }
      J.seen = t;
    }
  }

  // Every player checks the kicks against their own climber.
  jumpHits(t) {
    const me = this.me, host = this.solo || this.s.isHost;
    for (const J of this.jumpers) {
      if (!host) {
        J.active = t - J.seen < 0.6;
        if (J.active && J.tx !== undefined) { const k = Math.min(1, STEP * 14); J.x += (J.tx - J.x) * k; J.y += (J.ty - J.y) * k; J.z += (J.tz - J.z) * k; }
      }
      if (!J.active || J.st !== 2) { J.hitMe = false; continue; }
      const fx = J.x + Math.sin(J.yaw) * 0.45, fz = J.z + Math.cos(J.yaw) * 0.45, fy = J.y + 0.75;
      if (!J.hitMe && Math.hypot(me.x - fx, me.y - fy, me.z - fz) < 1.05) {
        J.hitMe = true;
        const k = this.storm.k;
        if (this.rec && !this.solo) this.rec.acts.push([this.rec.tickNo, 'k', J.j.i, Math.sin(J.yaw) * 10 * k, 6, Math.cos(J.yaw) * 10 * k, J.j.name]);
        this.zapKnock(Math.sin(J.yaw) * 10 * k, 6, Math.cos(J.yaw) * 10 * k, 'kick', J.j.name + ' kicked you');
      }
    }
  }

  // Up to four nearby jumpers get a stickman rig each.
  drawJumpers(dt, T) {
    const rigs = this.app.pool.jumpers;
    if (!rigs || !this.jumpers.length) return;
    const cam = this.R.camera.position, list = [];
    for (const J of this.jumpers) if (J.active && Math.abs(J.y - cam.y) < 45 && Math.hypot(J.x - cam.x, J.z - cam.z) < 50) list.push(J);
    if (list.length && !this.jumpWarned) {
      this.jumpWarned = true;
      this.app.ui.toast(`${list[0].j.name} ahead! Jump past or SHOOT to stun`, 'bad');
    }
    list.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    const used = new Set();
    for (const J of list.slice(0, rigs.length)) {
      let r = this.jrigs.get(J);
      if (!r) { r = rigs.find((q) => ![...this.jrigs.values()].includes(q)); if (!r) continue; this.jrigs.set(J, r); r.show(); }
      used.add(r);
      const ground = J.y <= J.j.y + 0.02, flags = (ground ? F.GROUND : 0) | (J.st === 2 ? F.KICK : 0) | (J.st === 4 ? F.STUN : 0);
      if (Math.hypot(J.vx, J.vz) < 0.6 && J.st !== 4) { let d = J.yaw - r.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); r.yaw += d * Math.min(1, dt * 10); }
      // Between physics steps, like the player.
      const a = this.alpha ?? 1, blend = J.ox !== undefined && Math.abs(J.x - J.ox) + Math.abs(J.y - J.oy) + Math.abs(J.z - J.oz) < 3;
      r.update(dt, blend ? J.ox + (J.x - J.ox) * a : J.x, (blend ? J.oy + (J.y - J.oy) * a : J.y) + PR, blend ? J.oz + (J.z - J.oz) * a : J.z, J.vx, J.vy || 0, J.vz, flags, 0, J.j.y, J.yaw, 9);
    }
    for (const [J, r] of this.jrigs) if (!used.has(r)) { r.hide(); this.jrigs.delete(J); }
  }

  zapKnock(vx, vy, vz, src, name) {
    if (this.knockCd > 0) return;
    this.knockCd = 0.8;
    const k = this.storm.k;
    if (this.me.knock(vx * k, vy * k, vz * k, 0.5)) {
      this.app.sound[src === 'laser' ? 'zap' : 'bonk']();
      this.app.ui.haptic('heavy');
      if (src === 'laser') this.app.ui.flash('#ff3050');
      if (src === 'geyser') this.app.ui.flash('#ff7a1a');
      this.app.ui.toast(name ? name + '!' : { arrow: 'Hit by an arrow!', laser: 'Zapped by a laser!', geyser: 'Blasted by the eruption!', rock: 'Flattened by a boulder!' }[src] || 'Ouch!', 'bad');
    }
  }

  // Lightning aimed at a climber: it marks the spot when the warning starts and strikes there.
  zap(slot, th, pos, mine) {
    let z = this.zaps.get(slot);
    if (th.warn > 0 && (!z || z.k !== th.k)) {
      z = { k: th.k, x: pos.x, y: pos.y - PR, z: pos.z, struck: false };
      this.zaps.set(slot, z);
      if (mine) { this.app.sound.warn(); this.app.ui.haptic('tick'); }
    }
    if (!z || z.k !== th.k || z.struck || this.simT < th.strikeAt) return;
    z.struck = true;
    const cam = this.R.camera.position, cd = Math.hypot(cam.x - z.x, cam.y - z.y, cam.z - z.z);
    if (cd < 90) { this.R.bolt(z.x, z.y, z.z, 1.3); this.app.sound.thunder(cd * 0.4); }
    if (!mine) return;
    const me = this.me, d = Math.hypot(me.x - z.x, me.z - z.z);
    if (d < 2.4 && Math.abs(me.y - PR - z.y) < 3) {
      // Which way is a matter of luck, but the same luck for the rerun.
      const k = this.storm.k, a = hash(th.k * 17 + slot * 3 + 11) * Math.PI * 2;
      if (me.knock(Math.cos(a) * 8 * k, 9 * k, Math.sin(a) * 8 * k, 0.7)) {
        this.app.sound.zap();
        this.app.ui.flash('#ffe08a');
        this.app.ui.haptic('heavy');
        this.app.ui.toast('Zapped! Tap SHIELD when the ring appears', 'bad');
      }
    }
  }

  // What the ACTION button does right now: grapple a hook in reach, or shoot a target/monster in view.
  findAction(T) {
    const me = this.me, L = this.L;
    if (me.hook) return null;
    let best = null, bestD = 1e9;
    for (const a of L.anchors) {
      if (a.y < me.y + 0.5 || Math.abs(a.y - me.y) > 9) continue;
      const d = Math.hypot(a.x - me.x, a.y - me.y, a.z - me.z);
      if (d < 12.5 && d < bestD && this.clear(me.x, me.y + 0.5, me.z, a.x, a.y, a.z)) { best = { k: 'grapple', a }; bestD = d; }
    }
    return best;
  }

  // What is under the crosshair: the first solid surface or target along the camera's centre ray.
  // { t, x, y, z, kind?, i? }. The ray has to pass through the target; with aim assist on, targets count
  // as a little bigger, so a shot that only just misses still hits.
  aimHit(T) {
    const cam = this.R.camera, o = cam.position, L = this.L, me = this.me;
    cam.getWorldDirection(fwd);
    const dx = fwd.x, dy = fwd.y, dz = fwd.z;
    let t = this.W.raycast(o.x, o.y, o.z, dx, dy, dz, RANGE, skipSoft), kind = null, idx = -1;
    const near = (y) => Math.abs(y - me.y) < 40, grow = 1 + (this.app.settings.aimHelp || 0) * 0.8;
    const tryHit = (k, i, x, y, z, r) => {
      const h = raySphere(o.x, o.y, o.z, dx, dy, dz, x, y, z, r * grow);
      if (h >= 0 && h < t) { t = h; kind = k; idx = i; }
    };
    for (const d of L.doors) if (!this.doors.has(d.i) && near(d.by)) tryHit('door', d.i, d.bx, d.by, d.bz, 0.68);
    for (const m of L.monsters) if (near(m.y)) { const p = this.storm.monsterPos(m, T, tmpP); tryHit('monster', m.i, p.x, p.y, p.z, 0.75); }
    for (const b of L.bats) if (near(b.cy)) { const p = this.storm.batPos(b, T, tmpP); tryHit('bat', b.i, p.x, p.y, p.z, 0.55); }
    for (const J of this.jumpers) if (J.active && near(J.y)) tryHit('jumper', J.j.i, J.x, J.y + PR + 0.35, J.z, 0.7);
    return { t, x: o.x + dx * t, y: o.y + dy * t, z: o.z + dz * t, kind, i: idx };
  }

  fire(T) {
    if (this.shotCd > T || this.won) return;
    this.shotCd = T + 0.3;
    const me = this.me, h = this.aimHit(T), yaw = this.cam.yaw;
    // The shot leaves the right hand.
    const from = [r3(me.x + Math.cos(yaw) * 0.35), r3(me.y + 0.75), r3(me.z - Math.sin(yaw) * 0.35)], to = [r3(h.x), r3(h.y), r3(h.z)];
    this.app.fx.tracer(this.slot, from, to, !!h.kind);
    this.app.sound.shoot();
    this.lastShot = T;
    this.s.toHost({ k: 'shot', s: this.slot, a: from, b: to, h: h.kind ? 1 : 0 });
    if (h.kind === 'door') {
      if (this.rec && this.solo) this.rec.act('d', h.i);
      this.s.toHost({ k: 'door', i: h.i });
    } else if (h.kind) {
      const m = (h.kind === 'bat' ? 1000 : h.kind === 'jumper' ? 2000 : 0) + h.i, from = r3(T), until = r3(T + 5);
      if (this.rec && this.solo) this.rec.act('n', m, from, until);
      this.s.toHost({ k: 'stun', m, from, until });
    }
    if (h.kind) this.app.ui.haptic('tick');
  }

  // Line of sight: nothing solid between two points (the target itself excluded).
  clear(ax, ay, az, bx, by, bz) {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    return this.W.castSphere(ax, ay, az, bx, by, bz, 0.08, hit) * d > d - 0.9;
  }

  perform(a) {
    if (a.k === 'grapple' && this.me.grapple(a.a)) {
      if (this.rec) this.rec.act('g', this.L.anchors.indexOf(a.a));
      this.app.sound.grapple();
      this.app.ui.haptic('tick');
    }
  }

  openDoor(i, quiet) {
    const d = this.L.doors[i];
    if (!d) return;
    this.doors.add(i);
    d.col.on = false;
    this.app.view.openDoor(i);
    if (!quiet) { this.app.sound.door(); this.app.ui.toast('Door open!', 'good'); }
  }

  crumbles(dt) {
    for (const c of this.L.crumbles) {
      const k = c.crumble;
      if (k.st === 1 && (k.t += dt) > 0.7) {
        k.st = 2; k.t = 0; c.on = false;
        if (Math.abs(c.y - this.me.y) < 15) this.app.sound.crumble();
        if (this.me.anchorCol === c) this.me.release();
      } else if (k.st === 2 && (k.t += dt) > 4.5) { k.st = 0; k.t = 0; c.on = true; }
    }
  }

  crumble(i) {
    const c = this.L.crumbles[i];
    if (c && c.crumble.st === 0) { c.crumble.st = 1; c.crumble.t = 0; }
  }

  // Play an emote or stunt from the menu (or a wall jump's flip), here and on everyone else's phone.
  emote(id) {
    const em = EMOTE[id], me = this.me;
    if (!em) return;
    // A flip starts with a real jump when you're standing, no higher than a normal one.
    if (em.hop) { me.hop(); if (this.rec) this.rec.act('h'); }
    this.robots.get(this.slot).playEmote(id);
    if (em.icon) { this.app.ui.bubble(this.slot, em.icon); this.app.sound.emote(); }
    this.s.toHost({ k: 'emote', s: this.slot, e: id });
  }

  bodyEvent(e) {
    const S = this.app.sound, ui = this.app.ui;
    switch (e.k) {
      case 'jump': S.jump(); break;
      case 'walljump':
        S.walljump();
        ui.haptic('tick');
        this.emote('e_wallflip');
        break;
      case 'dash': {
        const m = this.me;
        S.dash();
        ui.haptic('tick');
        // A streak of light along the way. It looks the same on everyone's phone as a shot would.
        const a = [r3(m.x), r3(m.y), r3(m.z)], b = [r3(m.x + e.x * 2.4), r3(m.y), r3(m.z + e.z * 2.4)];
        this.app.fx.tracer(this.slot, a, b, false);
        this.s.toHost({ k: 'shot', s: this.slot, a, b, h: 0 });
        break;
      }
      case 'launch': S.pad(); S.jump(); ui.haptic('heavy'); break;
      case 'land':
        S.land(e.v);
        if (e.v > 14) ui.haptic('heavy');
        if (e.drop > 10) { this.s.toHost({ k: 'fall' }); ui.toast(`Fell ${Math.round(e.drop)} m`, 'bad'); }
        break;
      case 'grab': S.grab(); ui.haptic('tick'); break;
      case 'release': S.release(); break;
      case 'slip': S.slip(); ui.toast('Grip ran out!', 'bad'); ui.haptic('heavy'); break;
      case 'pad': S.pad(); ui.haptic('tick'); break;
      case 'flung': S.sling(); ui.haptic('heavy'); break;
      case 'sling': this.sling(e.charge); break;
      case 'blocked': S.block(); ui.toast('Blocked by your shield!', 'good'); break;
    }
  }

  sling(charge) {
    const me = this.me, op = {};
    let any = false;
    for (const lk of this.links) {
      if (lk.a !== this.slot && lk.b !== this.slot) continue;
      const other = lk.a === this.slot ? lk.b : lk.a;
      if (lk.ten < 0.9 || !this.latest(other, op)) continue;
      const dx = me.x - op.x, dz = me.z - op.z, d = Math.hypot(dx, dz) || 1;
      const h = 5 + 4 * charge, up = 8 + 7 * charge;
      this.s.toHost({ k: 'sling', to: other, v: [r3((dx / d) * h), r3(up), r3((dz / d) * h)] });
      any = true;
    }
    if (any) { this.app.sound.sling(); this.app.ui.haptic('heavy'); }
  }

  strike(r) {
    const me = this.me, cam = this.R.camera.position;
    const cd = Math.hypot(cam.x - r.x, cam.y - r.y, cam.z - r.z);
    if (cd < 70) { this.R.bolt(r.x, r.y + 3.3, r.z, Math.max(0.4, 1 - cd / 70)); this.app.sound.thunder(cd * 0.5); }
    const dx = me.x - r.x, dz = me.z - r.z, d = Math.hypot(dx, dz);
    if (d < r.rad && Math.abs(me.y - PR - r.y) < 3) {
      const k = this.storm.k, nx = d > 0.1 ? dx / d : 1, nz = d > 0.1 ? dz / d : 0;
      if (me.knock(nx * 8 * k, 7 * k, nz * 8 * k, 0.7)) {
        this.app.sound.zap();
        this.app.ui.haptic('heavy');
        this.app.ui.flash('#b07bff');
        this.app.ui.toast('Struck by lightning!', 'bad');
      } else this.app.ui.toast('Held on through the strike', 'good');
    }
  }

  checks() {
    const me = this.me, L = this.L;
    if (!isFinite(me.x + me.y + me.z)) { const p = this.spawnPos(this.cp, this.slot); me.spawn(p[0], p[1], p[2]); }
    if (me.y < 0.3 && !this.splashed) {
      this.splashed = true;
      this.app.sound.splash();
      this.app.ui.haptic('heavy');
      this.s.toHost({ k: 'splash' });
    }
    for (const cp of L.cps) {
      if (cp.i <= this.cp || this.cpSent.has(cp.i) || !cpEnabled(cp, this.cpl)) continue;
      if (Math.hypot(me.x - cp.x, me.z - cp.z) < 3 && Math.abs(me.y - PR - cp.y) < 1.3) { this.cpSent.add(cp.i); this.s.toHost({ k: 'cp', i: cp.i }); }
    }
    if (!this.winSent && me.grounded && me.y > L.top - 0.5 && Math.hypot(me.x, me.z) < L.summit.r) { this.winSent = true; this.s.toHost({ k: 'win' }); }
    const g = me.grounded && me.ground;
    if (g && g.crumble && g.crumble.st === 0) { this.crumble(g.crumble.i); this.s.toHost({ k: 'crumble', i: g.crumble.i }); }
    const z = zoneAt(L, me.y);
    if (z > this.maxZone) {
      if (this.maxZone >= 0 || z === 0) this.app.sound.zone();
      this.maxZone = z;
      this.app.ui.zoneTitle(z);
    }
  }

  // ----- host-only team rules -----
  hostEvent(e, from) {
    // Alone, time is physics time: nothing else ever decides what happens.
    const T = this.solo ? this.simT : this.time;
    if (e.k === 'restart' && this.rec && this.solo) this.rec.act('r');
    switch (e.k) {
      case 'splash':
      case 'restart': {
        // Tied together by the cord, the whole team goes back. Without the cord, only the one who fell
        // (or asked to restart) does; everyone else keeps climbing.
        const one = this.noCord && from !== undefined ? from : null, key = one === null ? 'team' : one;
        this.locks = this.locks || {};
        if (T < (this.locks[key] || 0)) return;
        this.locks[key] = T + 1.5;
        if (e.k === 'splash') this.falls++;
        if (this.cpl === 2 && one === null) this.cp = 0;
        // Without the cord, the one who fell goes back to their own checkpoint.
        const cp = one === null ? this.cp : this.pcp[one] || 0, pos = {}, at = this.cpl === 2 ? 0 : cp;
        for (const slot of one === null ? this.s.players.keys() : [one]) pos[slot] = this.spawnPos(at, slot);
        this.s.toAll({ k: 'respawn', cp, at, pos, falls: this.falls, why: e.k, only: one });
        break;
      }
      case 'cp':
        if (!cpEnabled(this.L.cps[e.i], this.cpl)) break;
        if (this.noCord && from !== undefined) {
          // Only the player who got there moves on; everyone hears about it.
          if (e.i > (this.pcp[from] || 0)) { this.pcp[from] = e.i; this.s.toAll({ k: 'cp', i: e.i, slot: from }); this.save(); }
        } else if (e.i > this.cp) { this.cp = e.i; this.s.toAll({ k: 'cp', i: e.i }); this.save(); }
        break;
      case 'sling': this.s.toSlot(e.to, e); break;
      case 'crumble': this.s.toAll(e); break;
      case 'fall': this.falls++; break;
      case 'door': if (!this.doors.has(e.i)) this.s.toAll(e); break;
      case 'stun': case 'shot': case 'emote': this.s.toAll(e); break;
      case 'win':
        if (!this.won) this.s.toAll({ k: 'win', t: T, falls: this.falls });
        break;
    }
  }

  onEvent(e) {
    const ui = this.app.ui;
    // With others, these come from elsewhere, so the rerun can't work them out and they get written down.
    if (this.rec && !this.solo && (e.k === 'respawn' || e.k === 'cp' || e.k === 'sling' || e.k === 'crumble' || e.k === 'door' || e.k === 'stun' || e.k === 'win')) this.rec.act('e', e);
    switch (e.k) {
      case 'respawn': {
        this.falls = e.falls;
        if (e.only !== null && e.only !== undefined && e.only !== this.slot) {
          // Someone else went back (no cord). Forget their old track so they don't glide across the map.
          const pl = this.s.players.get(e.only);
          if (pl) { pl.samples.length = 0; if (e.why === 'splash') ui.toast(`${pl.name} fell and went back`, ''); }
          break;
        }
        const p = (e.pos && e.pos[this.slot]) || this.spawnPos(e.at ?? e.cp, this.slot);
        this.me.spawn(p[0], p[1], p[2]);
        this.cp = e.cp;
        this.falls = e.falls;
        if (e.why === 'splash') addTotals(1, 0);
        this.splashed = false;
        this.cpSent.clear();
        for (const l of this.links) l.chain.ok = false;
        if (e.only === null || e.only === undefined) for (const pl of this.s.players.values()) if (pl.slot !== this.slot) pl.samples.length = 0;
        const th = Math.atan2(p[2], p[0]);
        Object.assign(this.cam, { yaw: Math.PI - th, x: p[0], y: p[1] + 0.7, z: p[2] });
        this.app.view.setCheckpoints(this.cpl, this.cp);
        const into = { volcano: 'Into the lava.', city: 'Into the bay.', forest: 'All the way down.', waterfall: 'Splash! Into the lagoon.' }[this.L.mapKey] || 'Into the sea.';
        ui.toast(e.why === 'restart' ? 'Restarting from the checkpoint' : this.cpl === 2 ? into + ' Back to the start!' : into + ' Back to the checkpoint.', 'bad');
        break;
      }
      case 'cp':
        if (e.slot !== undefined && e.slot !== this.slot) {
          // No cord: someone else's checkpoint, not mine.
          const pl = this.s.players.get(e.slot), r = this.robots.get(e.slot);
          if (r) r.cheer();
          if (pl) ui.toast(`${pl.name} reached a checkpoint`, '');
          break;
        }
        if (e.i > this.cp) { this.cp = e.i; this.app.view.setCheckpoints(this.cpl, this.cp); }
        for (const r of this.robots.values()) r.cheer();
        this.app.sound.checkpoint();
        ui.toast('Checkpoint reached', 'good');
        ui.haptic('tick');
        break;
      case 'sling': if (e.to === this.slot) this.me.fling(e.v[0], e.v[1], e.v[2]); break;
      case 'crumble': this.crumble(e.i); break;
      case 'door': if (!this.doors.has(e.i)) this.openDoor(e.i); break;
      case 'stun': this.storm.stun.set(e.m, { from: e.from, until: e.until }); this.app.sound.stun(); break;
      case 'shot': if (e.s !== this.slot) this.app.fx.tracer(e.s, e.a, e.b, !!e.h); break;
      case 'emote':
        if (e.s !== this.slot) {
          const r = this.robots.get(e.s), em = typeof e.e === 'string' && Object.hasOwn(EMOTE, e.e) ? EMOTE[e.e] : null;
          if (r && em) { r.playEmote(e.e); if (em.icon) ui.bubble(e.s, em.icon); }
        }
        break;
      case 'win': this.finish(e); break;
    }
  }

  save() {
    // Halfway through a physics step the climber isn't anywhere yet. It happens when the step is done.
    if (this.stepping) { this.saveLater = true; return; }
    const m = this.me, rs = this.rec ? this.rec.save() : undefined;
    cloud.climbSaved();
    store.set(this.solo ? 'save.solo' : 'save.mp', { v: LEVEL_VERSION, climbId: cloud.runId(), rs, map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, pcp: this.noCord ? this.pcp : undefined, t: this.solo ? this.simT : this.time, cp: this.cp, falls: this.falls, doors: [...this.doors], pos: [m.x, m.y + 0.3, m.z], coins: [...this.coinTaken], run: this.run });
  }

  finish(e) {
    if (this.won) return;
    this.won = true;
    for (const r of this.robots.values()) r.cheer();
    store.del(this.solo ? 'save.solo' : 'save.mp');
    // Best times only count when playing the difficulty's own rules (no custom rules).
    const custom = this.custom;
    const bonus = this.D.summit, unlocked = [];
    const counts = cloud.counting();
    cloud.runWin(e.falls);
    if (counts) addCoins(bonus);
    this.run.coins += bonus;
    // Easier custom rules don't count: otherwise Hardcore's bonus could be had with every checkpoint switched on.
    const first = this.custom || !counts ? 0 : firstWin(this.diff, this.D.first);
    this.run.coins += first;
    this.run.won = true;
    this.run.h = Math.max(this.run.h, Math.min(1000, Math.round(this.L.top - 2)));
    this.falls = e.falls;
    if (this.hardcore) {
      const a = award('summit'), b = e.falls === 0 ? award('flawless') : null;
      if (a) unlocked.push(a.name);
      if (b) unlocked.push(b.name);
    }
    this.noteRun();
    flushProfile();
    const key = this.map + ':' + this.diff + (custom ? ':custom' : ''), best = store.get('best2', {}), prev = best[key];
    if (!prev || e.t < prev) { best[key] = e.t; store.set('best2', best); }
    this.app.sound.win();
    this.app.finish({ firstWin: first, time: e.t, falls: e.falls, diff: this.diff, map: this.map, best: Math.min(prev || 1e9, e.t), record: !prev || e.t < prev, players: this.s.players.size, coins: this.run.coins, bonus, unlocked });
  }

  // ----- per-frame visuals -----
  draw(dt) {
    const app = this.app, R = this.R, me = this.me, T = this.time;
    if (!this.robots.has(this.slot)) this.syncRoster();
    const W = this.W;
    const faceYaw = Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
    this.robots.get(this.slot).update(dt, me.x, me.y, me.z, me.vx, me.vy, me.vz, me.flags, me.charge, W.floorBelow(me.x, me.y, me.z, 30), faceYaw, T - (this.lastShot || -9));
    for (const [slot, r] of this.robots) {
      if (slot === this.slot) continue;
      const o = this.vis && this.vis.get(slot);
      r.g.visible = !!o;
      if (!o) { r.hide(); continue; }
      r.update(dt, o.x, o.y, o.z, o.vx, o.vy, o.vz, o.flags, o.charge, W.floorBelow(o.x, o.y, o.z, 30), o.yaw, 9);
      const th = this.storm.thunder(T, slot);
      if (th) this.zap(slot, th, o, false);
    }
    this.drawJumpers(dt, T);
    const pos = (slot) => (slot === this.slot ? me : this.vis && this.vis.get(slot));
    // Cords are draped visually (beads settle over ledges) but only the straight line pulls.
    for (const lk of this.links) {
      const A = pos(lk.a), B = pos(lk.b);
      if (!A || !B) { lk.mesh.mesh.visible = false; continue; }
      lk.mesh.mesh.visible = true;
      const L = this.rope - Math.max(A.reel || 0, B.reel || 0);
      lk.chain.step(A, B, L, this.W, Math.min(dt, 0.05));
      lk.L = L;
      lk.ten = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) / L;
      lk.mesh.update(lk.chain.p, clamp((lk.ten - 0.85) / 0.15, 0, 1), T);
    }
    // Lightning warning rings (sunny) and the grapple line.
    for (const [slot, z] of this.zaps) {
      const th = this.storm.thunder(T, slot);
      app.fx.marker(slot, th && th.k === z.k && th.warn > 0 && !z.struck ? th.warn : 0, z.x, z.y, z.z);
    }
    app.fx.hook(this.slot, me.hook, me.x, me.y + 0.7, me.z);
    app.fx.update(dt);

    // Camera: orbit with drag, ease toward the climber, pull in when something blocks the view.
    // Aiming moves it in over the right shoulder and narrows the view so the crosshair is precise.
    const c = this.cam, [dx, dy] = app.input.takeCam(this.aiming), ak = (this.aimK = damp(this.aimK, this.aiming ? 1 : 0, 12, dt));
    c.yaw -= dx;
    c.pitch = clamp(c.pitch + dy, -0.6 * ak - 0.3 * (1 - ak), 1.25);
    if (dx || dy) this.camTouched = T;
    this.assistCamera(dt, T, ak);
    c.x = damp(c.x, me.x, 14, dt); c.z = damp(c.z, me.z, 14, dt);
    c.y = damp(c.y, me.y + 0.8, me.vy < -14 || me.hook ? 14 : 7, dt);
    const cp = Math.cos(c.pitch), ox = Math.sin(c.yaw) * cp, oy = Math.sin(c.pitch), oz = Math.cos(c.yaw) * cp;
    const px = c.x + Math.cos(c.yaw) * 0.75 * ak, py = c.y + 0.45 * ak, pz = c.z - Math.sin(c.yaw) * 0.75 * ak;
    const want = (6.2 + clamp(-me.vy - 14, 0, 12) * 0.15) * (1 - ak) + 2.5 * ak;
    const f = this.W.castSphere(px, py, pz, px + ox * want, py + oy * want, pz + oz * want, 0.28, hit);
    const d = Math.max(1.1 * (1 - ak) + 0.6 * ak, f * want - 0.15);
    c.d = d < c.d ? d : damp(c.d, d, 3 + ak * 9, dt);
    const cam = R.camera;
    cam.position.set(px + ox * c.d, Math.max(0.8, py + oy * c.d), pz + oz * c.d);
    cam.lookAt(px, py, pz);
    const fov = (66 + clamp(-me.vy - 12, 0, 20) * 0.5) * (1 - ak) + 48 * ak;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = damp(cam.fov, fov, 4, dt); cam.updateProjectionMatrix(); }

    // Weather, sky and sound.
    const zi = zoneAt(this.L, me.y), zone = this.L.zones[zi];
    const last = this.L.zones[this.L.zones.length - 1];
    const eye = clamp((me.y - last.y0) / (this.L.top - last.y0), 0, 1);
    const gust = this.storm.gust(T, zi);
    this.wind.x = this.wind.z = 0;
    if (gust && gust.on) {
      const r = Math.hypot(me.x, me.z) || 1;
      this.wind.x = gust.radial ? (me.x / r) * gust.str : (-me.z / r) * gust.sign * gust.str;
      this.wind.z = gust.radial ? (me.z / r) * gust.str : (me.x / r) * gust.sign * gust.str;
    }
    R.update(dt, cam.position, zone, eye, this.wind);
    R.shadowFocus(me.x, me.y, me.z);
    this.bgBolt -= dt;
    if (this.bgBolt <= 0 && this.L.mapKey === 'storm') {
      this.bgBolt = (2 + Math.random() * 7) * (1 - zi * 0.08) * (1 + eye * 3);
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 260;
      R.bolt(me.x + Math.cos(a) * r, Math.max(0, me.y - 60 + Math.random() * 50), me.z + Math.sin(a) * r, 2.2);
      app.sound.thunder(r);
    }
    app.sound.ambient(0.2 + (me.y / this.L.top) * 0.6 + (gust && gust.on ? 0.8 : gust && gust.warn ? gust.warn * 0.4 : 0), me.reel > 0.05 && app.input.btn.reel, me.charge,
      this.L.mapKey === 'storm' ? 1 - eye * 0.8 : 0, this.L.mapKey === 'waterfall' ? 1 : 0);
    app.view.camPos = cam.position;
    // One step back in time, the same moment the climber is drawn at: standing on a moving platform stays exact.
    app.view.update(T - STEP, dt, this.storm, this.alpha ?? 1);
    app.pool.coins.update(dt, T, this.L.coins, this.coinTaken, cam.position.x, cam.position.y, cam.position.z, this.coinB);
    app.pool.relic.show(this.nearRelic, T);
    // The soundtrack follows the map and gets busier the higher the climb.
    app.sound.setStyle(this.L.mapKey);
    app.sound.setIntensity(0.3 + clamp(me.y / this.L.top, 0, 1) * 0.7);

    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.action = this.findAction(T);
      this.reelMode = this.cordMode();
      this.nearRelic = null;
      if (this.hardcore) for (const r of this.L.relics) if (!hasRelic(r.id) && Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z) < 80) this.nearRelic = r;
      app.ui.hud(this, { T, zone: zi, gust, thunder: this.storm.thunder(T, this.slot) });
    }
    // Crosshair turns red over a target (checked ~12 times a second while aiming).
    if (this.aiming) {
      this.aimAcc = (this.aimAcc || 0) + dt;
      if (this.aimAcc > 0.08) { this.aimAcc = 0; this.aimHot = !!this.aimHit(T).kind; }
    } else this.aimHot = false;
    app.ui.cross(this.aiming && ak > 0.5, this.aimHot);
    app.ui.tags(this);
    app.ui.tips(this);
  }

  // Camera assist: while you run and leave the camera alone, it swings round behind you. Aim assist:
  // while aiming, the crosshair is pulled gently onto a target that is already close to it.
  assistCamera(dt, T, ak) {
    const S = this.app.settings, c = this.cam, me = this.me;
    // Follow strength (Settings, 0 off to 2): how fast it turns, and how far behind you it goes.
    const F = S.camFollow ?? 1;
    // Bouncing between walls the speed flips side to side every moment: the camera stays still until you are out.
    const bouncing = me.kickT !== undefined && me.time - me.kickT < 0.9;
    if (F > 0.01 && !this.aiming && !me.hook && !bouncing && T - (this.camTouched || -9) > 0.9 - Math.min(F, 2) * 0.2) {
      const sp = Math.hypot(me.vx, me.vz);
      if (sp > 1.5) {
        let e = Math.atan2(-me.vx, -me.vz) - c.yaw;
        e = Math.atan2(Math.sin(e), Math.cos(e));
        // How far round it goes: weak settings only turn part of the way.
        e *= Math.min(1, 0.35 + F * 0.65);
        // Running straight at the camera: leave it, so it never whips round.
        if (Math.abs(e) < 2.4) c.yaw += e * Math.min(1, dt * 1.6 * F) * Math.min(1, sp / 5);
        c.pitch += (0.32 - c.pitch) * Math.min(1, dt * 0.8 * F);
      }
    }
    const A = S.aimHelp ?? 0.5;
    if (A < 0.01 || !this.aiming || ak < 0.5) return;
    const cam = this.R.camera, o = cam.position, L = this.L;
    cam.getWorldDirection(fwd);
    let best = null, bestA = 0.05 + A * 0.12;
    const consider = (x, y, z) => {
      const vx = x - o.x, vy = y - o.y, vz = z - o.z, d = Math.hypot(vx, vy, vz);
      if (d < 1 || d > RANGE) return;
      const a = Math.acos(clamp((vx * fwd.x + vy * fwd.y + vz * fwd.z) / d, -1, 1));
      if (a < bestA && this.W.raycast(o.x, o.y, o.z, vx / d, vy / d, vz / d, d, skipSoft) > d - 0.9) { bestA = a; best = { vx, vy, vz, d }; }
    };
    for (const dr of L.doors) if (!this.doors.has(dr.i) && Math.abs(dr.by - me.y) < 30) consider(dr.bx, dr.by, dr.bz);
    for (const m of L.monsters) if (Math.abs(m.y - me.y) < 20) { const p = this.storm.monsterPos(m, T, tmpP); if (!p.stunned) consider(p.x, p.y, p.z); }
    for (const b of L.bats) if (Math.abs(b.cy - me.y) < 20) { const p = this.storm.batPos(b, T, tmpP); if (!p.stunned) consider(p.x, p.y, p.z); }
    for (const J of this.jumpers) if (J.active && J.st !== 4 && Math.abs(J.y - me.y) < 20) consider(J.x, J.y + PR + 0.35, J.z);
    if (!best) return;
    // Turn a share of the way toward it each frame (the camera looks along yaw + PI, pitch down = +).
    let ey = Math.atan2(best.vx, best.vz) - Math.atan2(fwd.x, fwd.z);
    ey = Math.atan2(Math.sin(ey), Math.cos(ey));
    const ep = Math.asin(clamp(best.vy / best.d, -1, 1)) - Math.asin(clamp(fwd.y, -1, 1)), k = Math.min(1, dt * 5) * A;
    c.yaw += ey * k;
    c.pitch -= ep * k;
  }

  // What the REEL button does right now: PULL a partner hanging below, CLIMB when I'm the one hanging.
  cordMode() {
    const me = this.me, op = this.tmpC || (this.tmpC = {});
    let mode = 'REEL';
    for (const lk of this.links) {
      if (lk.a !== this.slot && lk.b !== this.slot) continue;
      if (!this.latest(lk.a === this.slot ? lk.b : lk.a, op)) continue;
      if (me.grounded && op.y < me.y - 1.2 && !(op.flags & (F.GROUND | F.ANCHOR))) mode = 'PULL';
      else if (!me.grounded && !me.anchored && op.y > me.y + 0.8 && lk.ten > 0.85) mode = 'CLIMB';
    }
    return mode;
  }

  destroy() {
    if (!this.won) this.noteRun();
    flushProfile();
    this.app.pool.coins.clear();
    this.app.pool.relic.show(null);
    this.app.view.setSecrets(false);
    for (const r of this.robots.values()) r.hide();
    for (const l of this.links) l.mesh.mesh.visible = false;
    this.app.fx.clear();
    this.robots.clear();
    this.links = [];
    this.s.close();
  }
}
