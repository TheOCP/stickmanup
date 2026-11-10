// One climb in progress: local physics, cords, remote climbers, hazards, abilities, team rules and camera.
import * as THREE from 'three';
import { Body, F, PR, cord } from './player.js';
import { Chain } from './chain.js';
import { placeDyn, toLocal, toWorld, BOX } from './physics.js';
import { COLORS } from './colors.js';
import { Storm, QUAKE_AT, WAVE_H, LASER_R, CANNON_R, markShots, beeStep, beeReach } from './storm.js';
import { DIFFS, layoutLV, cpEnabled, zoneAt, secretsFor, applyMaze, mazeCellAt, mazeWay, mazeChase, MAZE_BODY, MAZE_WALL_H, placeCoins, coinXOk } from './level.js';
import { EMOTE } from './emotes.js';
import { clamp, damp, store, r3, hash } from './util.js';
import { addCoins, firstWin, foundRelic, hasRelic, award, recordRun, addTotals, flushProfile } from './profile.js';
import * as cloud from './cloud.js';
import { resolveLook, plainLook } from './skins.js';
import { WEAPON, weaponOf } from './weapons.js';
import { myLook } from './profile.js';
import { teamSave, putTeamSave, dropTeamSave, CLIMB_ID } from './saves.js';

// Near enough to count as having got to the top. The rerun (server/lib/verify-worker.mjs, case 'win') asks the same.
const nearTop = (b, L, rope) => Math.hypot(b.x, b.z) < L.summit.r + rope * 3 && b.y > L.top - rope * 4;
const STEP = 1 / 60, SEND = 1 / 20, DELAY = 0.11;
// Seconds between saves: alone (each one also a point the anticheat can pick the climb up from), and with others. With others
// every SAVE_FULL-th one is that too, the rest only note where everyone is.
const SAVE_SOLO = 2, SAVE_MP = 1, SAVE_FULL = 4;
// Standing, holding on or hanging: a spot to be put back at, never one in the middle of a fall.
const FIRM = F.GROUND | F.ANCHOR | F.HANG;
const spotOk = (q) => Array.isArray(q) && q.length >= 3 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) && Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) < 1e5;
// A phone's key in a room (net.js WHO): who left with which checkpoint.
const WHO_KEY = /^[A-Za-z0-9]{8,24}$/;
// Flying (setFlying): metres a second, how much faster with the fast button, and how far out from the middle of the map.
const FLY_SPEED = 14, FLY_FAST = 4, FLY_ROOM = 600;
// Where SHIELD does something: Storm Tower (it takes a lightning strike) and the Wild Forest (it drives the bee swarm off).
export const SHIELD_MAPS = new Set(['storm', 'forest']);
const NONE = { mx: 0, mz: 0, jump: false, jumpPressed: false, grab: false, reel: false, act: false, shield: false, aim: false, fire: false };
const hit = { nx: 0, ny: 0, nz: 0, d: 0 }, fwd = new THREE.Vector3(), tmpP = {}, tmpH = {}, tmpW = { steps: 0, next: 0 };
// What a maze garden's creature does to you, by map.
// In each maze you have this many hearts. A bite takes one, and with none left you go back to the checkpoint.
export const MAZE_HEARTS = 3;
// A relic counts once you have stood this close to the end of its course (pickups).
const RELIC_NEAR = 3;
// How fast creatures come after you (you run at 6.2), and from how many cells away they notice you in a maze, by hazard setting.
const HUNT_SPEED = [2.2, 2.8, 3.4, 4.0], HUNT_CELLS = [3, 4, 5, 6];
// Volcano: the lava rises while you climb, in metres a second by difficulty: slow on Easy, faster the harder it gets.
// After a fall it is back LAVA_GAP under where you start again, and reaching a checkpoint lifts it to that far under the
// checkpoint if it was lower. It waits while you are in a maze garden or out on a course outside the crater.
const LAVA_RISE = [0.16, 0.28, 0.4, 0.52], LAVA_GAP = 26;
const MAZE_BITE = { storm: 'A storm crab pinched you!', sunny: 'A scorpion stung you!', forest: 'A wild boar charged you!', volcano: 'A fire imp burned you!', city: 'A robot dog bit you!', waterfall: 'A crocodile snapped at you!' };
const RANGE = 70, skipSoft = (c) => c.kind === 'hook';
// Seconds of aiming before a shot can leave: an accidental tap or click fires nothing.
const AIM_READY = 0.13;
const muzzleAt = new THREE.Vector3();
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
    this.cp = Number.isInteger(g.cp) && this.L.cps[g.cp] ? g.cp : 0;
    // Which climb this is, whoever runs it: every phone in it saves its own copy under it (saves.js).
    this.climb = typeof g.climb === 'string' && CLIMB_ID.test(g.climb) ? g.climb : null;
    this.falls = Math.max(0, Math.floor(+g.falls) || 0);
    this.slot = session.slot;
    this.noCord = !!g.noCord; // multiplayer option: climb without being tied together
    // Who joined a tied team after the start and has not reached the others yet: not on the cord (see catchUp).
    this.loose = new Set(Array.isArray(g.loose) ? g.loose.filter(Number.isInteger) : []);
    // Who is vanished right now (setFlying): nobody else draws them.
    this.hidden = new Set(Array.isArray(g.hide) ? g.hide.filter(Number.isInteger) : []);
    this.flying = false;
    // Checkpoints: tied together, the team shares one. Without the cord everyone has their own; the host
    // keeps track of them all by slot (pcp), and of whoever is still catching up with a tied team.
    this.pcp = {};
    if (g.pcp && typeof g.pcp === 'object') for (const k of Object.keys(g.pcp)) if (Number.isInteger(+k) && Number.isInteger(g.pcp[k]) && this.L.cps[g.pcp[k]]) this.pcp[k] = g.pcp[k];
    // Catching up on a tied team (a saved climb picked up again): from their own checkpoint, not the team's. A host keeps the
    // team's in cp and its own in pcp.
    if (!this.noCord && !session.isHost && this.loose.has(this.slot) && this.pcp[this.slot] !== undefined) this.cp = this.pcp[this.slot];
    if (this.noCord) {
      if (this.pcp[this.slot] !== undefined) this.cp = this.pcp[this.slot];
      this.pcp[this.slot] = this.cp;
    }
    // The team's checkpoint as the host last said it, kept even while catching up: needed if this phone ever runs the room.
    this.teamCp = this.cp;
    // Who left the room, by their key (net.js who), and the checkpoint they had: they get it back if they come again.
    this.left = {};
    this.addLeft(g.left);
    this.me = new Body();
    // Coming back to a climb going on: where the room last saw this climber stand (snapshot), or else where this phone's own copy
    // of the climb has them (saves.js), as long as that isn't inside a maze garden whose walls may have moved since.
    let gp = g.pos && spotOk(g.pos[this.slot]) ? g.pos[this.slot] : null, ownSpot = false;
    if (!gp && g.join && !session.isHost && this.climb && session.who) {
      const own = teamSave(this.climb), e = own && own.team && own.team[session.who];
      if (Array.isArray(e) && e.length >= 4 && spotOk([e[1], e[2], e[3]]) && !this.mazeAround({ x: e[1], y: e[2], z: e[3] })) { gp = [e[1], e[2], e[3]]; ownSpot = true; }
    }
    const p = gp || this.spawnPos(this.cp, this.slot);
    // Where this climber last stood (FIRM), for the saves.
    this.firm = [p[0], p[1] - 0.3, p[2], 1];
    this.me.spawn(p[0], p[1], p[2]);
    this.robots = new Map();
    this.links = [];
    this.others = [];
    this.simT = this.time;
    this.sendAcc = 0;
    this.saveAcc = 0;
    this.saveN = 0;
    this.saveSoon = false;
    this.savedRs = undefined;
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
    this.aimT = 0;
    this.scopeK = 0;
    this.aimElev = 0;
    this.shotAt = new Map();
    // Shots, kept for a friend watching this climb (spectate.js). Only the last few: nobody may be watching at all.
    this.feedShots = [];
    this.gun = weaponOf(myLook().w);
    this.action = null;
    this.zaps = new Map(); // slot -> { k, x, y, z, struck } lightning aimed at each climber (storm map)
    this.evMarks = new Map(); // the marks of the lasers and cannonballs aimed at me (storm.js shots), by event and shot
    this.evOther = new Map(); // slot -> the same for the others, from where they are seen (only to draw)
    this.bees = null; // the swarm after me: { k, x, y, z, gone }
    this.beesOther = new Map(); // slot -> the swarm after someone else (only to draw)
    // Each map's level objects are reused between games: close doors and mend floors from last time.
    for (const d of this.L.doors) d.col.on = true;
    for (const c of this.L.crumbles) { c.crumble.st = 0; c.crumble.t = 0; c.on = true; }
    app.view.resetDoors();
    this.doors = new Set(g.doors || []);
    for (const i of this.doors) this.openDoor(i, true);
    // The maze gardens: which way their walls stand. It changes each time the team goes back to a checkpoint.
    this.mazeSeen = false;
    this.hearts = MAZE_HEARTS;
    this.heartMaze = -1;
    this.heartOutT = 0;
    this.setMaze(g.mz);
    for (const st of g.stuns || []) this.storm.stun.set(st[0], { from: st[1], until: st[2] });
    this.wind = { x: 0, z: 0 };
    // Coins, relics and the record of this climb. Picking a saved climb back up keeps all three.
    // With others: this phone's own copy of this climb, when it was part of it before (the host's, or anyone's who left and came back).
    const sf = this.solo ? (g.base > 0 ? store.get('save.solo') : null) : this.climb ? teamSave(this.climb) : null, sv = sf && sf.v === layoutLV(sf.map) ? sf : null;
    // The coins: as many as the server gives right now (cloud.js coinX), or a climb picked up again keeps the ones it had (a save
    // from before there was a choice had the usual). The server's rerun gets them the same way (verify-worker.mjs levelOf).
    const cx = sv ? coinXOk(sv.cx) : cloud.coinX();
    if (cx && this.L.coinX !== cx) placeCoins(this.L, cx);
    this.custom = ['cps', 'haz', 'rope'].some((k) => this.rules[k] !== undefined && this.rules[k] !== this.diff);
    // Real Hardcore or harder only: what is earned up there doesn't count with custom rules. The relic courses are always there.
    this.hardcore = this.diff >= 2 && !this.custom;
    // Every hidden path, and of the hidden spots this difficulty's (level.js hideSpots).
    this.storm.sec = secretsFor(this.diff);
    // Coins only count where the server can see the climb: alone, or in a room on the game server.
    this.earning = this.solo || !!(session.link && session.link.isServer);
    this.rec = null;
    cloud.runStart({ cx: this.L.coinX, map: this.map, diff: this.diff, rules: this.rules, custom: this.custom, earning: this.earning, resumed: !!sv && (this.solo || (typeof sv.climbId === 'string' && Number.isInteger(sv.rs))), run: sv && sv.climbId, rs: sv && sv.rs, name: session.name, mode: session.mode });
    app.view.setSecrets(this.storm.sec);
    this.coinTaken = new Set((sv && sv.coins) || []);
    // The team moved this climber (teleport): this climb earns nothing more, picked up from a save or not.
    this.tped = !!(sv && sv.tp);
    this.coinB = this.L.coinB || (this.L.coinB = {});
    if (!this.L.coinBuilt) { this.L.coinBuilt = true; for (const c of this.L.coins) (this.coinB[Math.floor(c.y / 8)] ||= []).push(c); }
    this.coinRow = 0;
    this.coinAcc = 0;
    this.relicNear = new Set();
    this.nearRelic = null;
    this.relicAim = null;
    // The last marker reached on a hidden course, as [relic, marker]. A saved climb keeps it (so does the server's).
    this.rest = Array.isArray(g.rest) && g.rest.length === 2 ? g.rest : null;
    this.onCourse = this.rest ? this.rest[0] : -1;
    this.wayAt = this.wayOf(this.rest);
    this.wayFree = false;
    this.gateOff = -1;
    this.splashT = 0;
    this.lavaY = this.L.mapKey === 'volcano' ? (this.L.cps[this.cp] ? this.L.cps[this.cp].y : 2) - LAVA_GAP : null;
    this.lavaCp = this.cp;
    this.lavaWarn = false;
    app.view.markRelics(hasRelic);
    this.recAcc = 0;
    this.run = (sv && sv.run) || { id: Date.now().toString(36) + ((Math.random() * 1296) | 0).toString(36), map: this.map, diff: this.diff, custom: this.custom, h: 0, falls: 0, t: 0, coins: 0, won: false, when: Date.now(), players: 1 };
    if (!sv) addTotals(0, 1);
    app.ui.coins(this.run.coins);
    // Without the cord, climbers pass through each other (no bumping anyone off a ledge).
    this.env = { world: this.W, others: this.noCord ? [] : this.others, grip: this.D.grip, coyote: this.D.coyote, maxReel: this.rope - 1.2, wind: null, zips: this.L.zips || [] };
    this.cam = { yaw: this.startYaw(this.me.x, this.me.z, this.cp), pitch: 0.34, d: 7, x: this.me.x, y: this.me.y + 0.7, z: this.me.z };

    // The moving parts start from this moment, so a rerun of this climb starts from exactly the same place.
    this.W.setTime(this.simT);
    session.on('event', (e) => this.onEvent(e));
    session.on('hostEvent', (e, from) => this.hostEvent(e, from));
    const lobbyRoster = session.h.roster;
    session.on('roster', (slot, joined, gone) => {
      if (!joined && session.isHost && this.loose.has(slot)) this.setLoose([...this.loose].filter((s) => s !== slot));
      this.syncRoster();
      if (lobbyRoster) lobbyRoster(slot, joined, gone);
    });
    session.on('S', (m) => {
      if (m.cp !== undefined) this.teamCp = m.cp;
      if (m.f !== undefined) this.falls = m.f;
      if (m.cp !== undefined && m.cp !== this.cp && !this.loose.has(this.slot)) { if (this.rec) this.rec.act('m', m.cp); this.cp = m.cp; app.view.setCheckpoints(this.cpl, this.cp); }
      if (m.mz !== undefined && m.mz !== this.mz) this.onEvent({ k: 'maze', v: m.mz });
      if (m.jp) this.jumpNet(m.jp);
    });
    session.on('snapshot', (slot) => this.snapshot(slot));
    // Someone leaving, coming back to a new host, and this phone taking over as host (net.js).
    session.on('gone', (p) => this.remember(p));
    session.on('back', (slot, cp) => this.welcomeBack(slot, cp));
    session.on('myCp', () => this.cp);
    const lobbyPromoted = session.h.promoted;
    session.on('promoted', (room) => { this.takeOver(); if (lobbyPromoted) lobbyPromoted(room); });
    // Names and colours can change mid-game (Settings): redraw stickmen, cords and name tags.
    const lobbyH = session.h.lobby;
    session.on('lobby', () => { this.refreshPlayers(); if (lobbyH) lobbyH(); });
    session.on('gameTime', () => this.time);
    this.syncRoster();
    app.view.setCheckpoints(this.cpl, this.cp);
    // From here on the climb is written down, starting with everything it started from.
    this.rec = cloud.recorder({ mode: session.mode, slot: this.slot, map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, pcp: this.pcp, loose: [...this.loose], t: this.simT, cp: this.cp, falls: this.falls, mz: this.mz, doors: [...this.doors], stuns: g.stuns || [], pos: [p[0], p[1], p[2]], coins: [...this.coinTaken], resume: sv ? sv.rs : undefined, roster: [...session.players.keys()] });
    if (g.join && gp && (g.back || ownSpot)) app.ui.toast(this.noCord ? 'Back where you left off' : 'Back where you left off. The cord ties on when you reach your team.', 'good');
    else if (g.back && this.cp > 0) app.ui.toast(this.noCord ? 'Back at your checkpoint' : 'Back at your checkpoint. The cord ties on when you reach your team.', 'good');
    else if (this.loose.has(this.slot)) app.ui.toast('You start at the bottom. The cord ties on when you reach your team.', '');
  }

  // Climb time. In a team game it follows the host's clock, but read once a frame and moved on smoothly (tick): read
  // straight from the clock it lands wherever in the frame the reading happens, and jumps a little whenever the
  // estimate of the host's clock improves, and both show as stutter at a steady frame rate.
  get time() {
    return this.solo ? this.soloT : this.clk ?? this.netTime();
  }
  netTime() {
    return (this.s.now() - this.t0) / 1000 + this.base;
  }
  tick(dt) {
    const want = this.netTime(), next = (this.clk ?? want) + dt, err = want - next;
    this.clk = this.clk === undefined || Math.abs(err) > 0.25 ? want : next + err * Math.min(1, dt * 2);
  }

  // On the checkpoint's pad (never out by the edge): a spot on a small ring round its pole, far enough apart
  // not to bump each other off.
  spawnPos(i, slot) {
    const cp = this.L.cps[i];
    const a = (slot / 4) * Math.PI * 2 + 0.4;
    return [cp.x + Math.cos(a) * 0.64, cp.y + PR + 0.4, cp.z + Math.sin(a) * 0.64];
  }

  // Which way the camera looks on (re)starting at checkpoint i: at the start, at the first piece of the way up (the UP HERE
  // sign is off to the side of it);
  // anywhere else, round the middle.
  startYaw(x, z, i) {
    const S = this.L.startSign;
    if (!i && S && Math.hypot(x - S.x, z - S.z) < 12) { const dx = S.tx - x, dz = S.tz - z; return Math.atan2(-dx, -dz); }
    return Math.PI - Math.atan2(z, x);
  }

  snapshot(slot) {
    const stuns = [];
    for (const [k, v] of this.storm.stun) stuns.push([k, v.from, v.until]);
    // Whoever joins starts at the start of the map, not next to the host. Without the cord they have their own checkpoints
    // anyway. On a tied team they climb on their own until they reach the others (catchUp): a cord that long would drag
    // them all over the map. Someone who was here before and left starts again from the checkpoint they had then.
    // Back at the spot they last stood on even, when the room saw one (remember), unless it is in a maze garden: its walls move.
    const p = this.s.players.get(slot), e = p && p.who && Object.prototype.hasOwnProperty.call(this.left, p.who) ? this.left[p.who] : null;
    const at = e && this.L.cps[e[0]] ? e[0] : 0, spot = e && e.length >= 4 && !this.mazeAround({ x: e[1], y: e[2], z: e[3] }) ? [e[1], e[2], e[3]] : null;
    this.pcp[slot] = at;
    if (!this.noCord) this.setLoose([...this.loose, slot]);
    return { map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, pcp: this.pcp, loose: [...this.loose], t0: this.t0, base: this.base, cp: at, pos: spot ? { [slot]: spot } : undefined, falls: this.falls, mz: this.mz, doors: [...this.doors], stuns, hide: [...this.hidden], left: this.left, back: at > 0 || !!spot, join: 1, climb: this.climb || undefined };
  }

  // The checkpoints of those who left, and the spot they last stood on, from the host (event 'left', or with the snapshot), as
  // [checkpoint] or [checkpoint, x, y, z]. A plain number is from an older phone. At most a few dozen.
  addLeft(m) {
    if (!m || typeof m !== 'object') return;
    for (const k of Object.keys(m).slice(0, 40)) {
      const v = m[k], e = Array.isArray(v) ? v : [v], i = e[0];
      if (!WHO_KEY.test(k) || !Number.isInteger(i) || !this.L.cps[i]) continue;
      delete this.left[k];
      this.left[k] = e.length >= 4 && spotOk([e[1], e[2], e[3]]) ? [i, e[1], e[2], e[3]] : [i];
    }
    const ks = Object.keys(this.left);
    for (let n = 0; n < ks.length - 40; n++) delete this.left[ks[n]];
  }

  // Someone left the room (net.js dropSlot): the room keeps the checkpoint they had, and everyone hears it, so whoever runs the
  // room next knows it too.
  remember(p) {
    if (!this.s.isHost || this.solo || !p || !p.who || p.slot === this.slot) return;
    const i = this.noCord || this.loose.has(p.slot) ? this.pcp[p.slot] || 0 : this.cp, at = this.firmOf(p);
    this.s.toAll({ k: 'left', m: { [p.who]: at ? [i, at[0], at[1], at[2]] : [i] } });
  }

  // Back with this phone after the host changed: their own checkpoint (they know it best), and what they may have missed.
  welcomeBack(slot, cp) {
    if (!this.s.isHost || this.solo) return;
    if ((this.noCord || this.loose.has(slot)) && Number.isInteger(cp) && this.L.cps[cp]) this.pcp[slot] = cp;
    if (!this.noCord) this.setLoose([...this.loose]);
    this.s.toSlot(slot, { k: 'hide', s: [...this.hidden] });
    for (const i of this.doors) this.s.toSlot(slot, { k: 'door', i });
    if (Object.keys(this.left).length) this.s.toSlot(slot, { k: 'left', m: this.left });
  }

  // The host left and this phone runs the climb from here (net.js becomeHost). It heard everything a host decides as it
  // happened, so it just carries on. Catching up on a tied team its own checkpoint was its own; the host holds the team's.
  takeOver() {
    if (this.solo) return;
    if (!this.noCord && this.loose.has(this.slot)) {
      this.pcp[this.slot] = this.cp;
      this.cp = Number.isInteger(this.teamCp) && this.L.cps[this.teamCp] ? this.teamCp : 0;
    }
    this.pcp[this.slot] = this.noCord ? this.cp : this.pcp[this.slot] || 0;
    this.locks = {};
    this.catchT = 0;
    this.saveAcc = 0;
    if (this.app.traitor && this.app.traitor.takeOver) this.app.traitor.takeOver(this);
  }

  // The host says who isn't on the cord yet. The cord only goes between the others.
  setLoose(list) {
    this.s.toAll({ k: 'loose', s: [...new Set(list)], cp: this.cp });
  }

  // Someone catching up is tied on as soon as they reach anyone on the team, while the cord between them is still slack, so
  // nobody gets yanked.
  catchUp() {
    const a = this.tmpL || (this.tmpL = {}), b = this.tmpM || (this.tmpM = {}), left = new Set(this.loose), reach = this.rope - 1.5;
    const slots = [...this.s.players.keys()].sort((x, y) => x - y);
    // The traitor snapped the cord (traitor.js): nobody is on it. Once the snap is over it ties on again from the highest
    // climber, and the others join as they reach them.
    if (this.snapT && this.time >= this.snapT) {
      this.snapT = 0;
      let top = null, ty = -1e9;
      for (const s of left) {
        if (this.hidden.has(s)) continue;
        const w = s === this.slot ? this.me : this.latest(s, a) ? a : null;
        if (w && w.y > ty) { ty = w.y; top = s; }
      }
      if (top !== null) left.delete(top);
    }
    for (const s of this.loose) {
      if (this.hidden.has(s)) continue;
      // The host too, if the team moved them (they have no track of their own).
      const w = s === this.slot ? this.me : this.latest(s, a) ? a : null;
      if (!w) continue;
      // The cord goes between neighbours by slot, so those are the ones to be close to.
      const tied = slots.filter((o) => !left.has(o)), hi = tied.findIndex((o) => o > s), lo = hi < 0 ? tied.length - 1 : hi - 1;
      const near = (o) => { const q = o === this.slot ? this.me : this.latest(o, b); return !!q && Math.hypot(q.x - w.x, q.y - w.y, q.z - w.z) < reach; };
      if ((lo >= 0 || hi >= 0) && (lo < 0 || near(tied[lo])) && (hi < 0 || near(tied[hi]))) left.delete(s);
    }
    if (left.size !== this.loose.size) this.setLoose([...left]);
  }

  // The team reset this climber's checkpoint (the resetcheckpoint command, main.js).
  resetCheckpoint() {
    if (!this.won) this.s.toHost({ k: 'resetcp' });
  }

  // The team moved this climber (the tp command, main.js): next to someone, to a height (the checkpoint at or below it), or to
  // the top. A climb that jumped can't be played again on the server, so it stops earning here: what was found before this
  // still counts, and nothing after it does. So faking one gets nobody anything.
  teleport(m) {
    if (this.won) return;
    const L = this.L, me = this.me;
    let p;
    if (Array.isArray(m.pos)) {
      if (m.map !== this.map || m.diff !== this.diff || !isFinite(m.pos[0] + m.pos[1] + m.pos[2])) return;
      p = [m.pos[0], m.pos[1] + 0.2, m.pos[2]];
    } else if (m.top) p = [1.2, L.top + PR + 0.4, 0];
    else {
      const y = (m.h | 0) + 2;
      let c = L.cps[0];
      for (const o of L.cps) if (o.y <= y && o.y > c.y) c = o;
      p = this.spawnPos(c.i, this.slot);
    }
    // Moved while flying is just more flying: where it ends is written down when it ends.
    if (!this.flying) this.stopEarning('moved');
    // Moved by the team, so where you land is no shortcut on a course.
    this.wayFree = true;
    // A fall from here goes back to the last checkpoint below it. On a tied team they come off the cord until they reach the
    // others again, or it would drag everyone along.
    let cp = 0;
    for (const o of L.cps) if (o.y <= p[1] && o.i > cp && cpEnabled(o, this.cpl)) cp = o.i;
    if (this.solo) this.cp = cp;
    else {
      // The host of a tied team also holds the team's checkpoint: that one stays.
      if (!this.s.isHost || this.noCord) this.cp = cp;
      this.s.toHost({ k: 'tp', i: cp });
      // Already off the cord here, before the host's answer gets back.
      if (!this.noCord) { this.loose.add(this.slot); this.syncRoster(); }
    }
    me.spawn(p[0], p[1], p[2]);
    this.splashed = false;
    this.cpSent.clear();
    for (const l of this.links) l.chain.ok = false;
    Object.assign(this.cam, { x: p[0], y: p[1] + 0.7, z: p[2] });
    this.app.view.setCheckpoints(this.cpl, this.cp);
    this.save();
  }

  // A climb that moved by other means than climbing can't be played again on the server. What it found until now still counts.
  stopEarning(why) {
    if (this.tped) return;
    this.tped = true;
    this.rec = null;
    cloud.runStop(why);
    this.app.ui.toast('Teleported: no more coins on this climb', '');
  }

  // Vanished (the vanish command, main.js): gone for everyone else and flying, through anything, with nothing on the map able
  // to reach them. Coming back the climber just drops from where they are, and climbs on from there, earning again. The
  // recording says where the flight ended, and the server checks this player may fly at all (verify-worker.mjs, act 'f').
  setFlying(on) {
    if (on === this.flying || this.won) return;
    this.flying = on;
    const me = this.me;
    me.spawn(me.x, me.y, me.z);
    this.aiming = me.aim = false;
    // Wherever they come down is fine: it wasn't a jump.
    this.wayFree = true;
    if (this.rec) { if (on) this.rec.act('f', 1); else this.rec.act('f', 0, me.x, me.y, me.z, this.cp); }
    if (on) {
      this.bees = null;
      this.evMarks.clear();
    }
    if (this.solo) return;
    this.s.toHost({ k: 'hide', on });
    // Already off the cord here, before the host's answer gets back.
    if (on && !this.noCord) { this.loose.add(this.slot); this.syncRoster(); }
  }

  // One step of it: where the camera looks is forward, so looking up and pushing forward goes up.
  flyStep(inp) {
    const me = this.me, c = this.cam, k = this.app.input.keys, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const fx = inp.fx || 0, fz = inp.fz || 0, rx = -fz, rz = fx;
    const sy = inp.mx * fx + inp.mz * fz, sx = inp.mx * rx + inp.mz * rz;
    const up = (inp.jump ? 1 : 0) - (inp.grab || k.has('KeyC') || k.has('KeyQ') ? 1 : 0);
    const v = FLY_SPEED * (inp.reel ? FLY_FAST : 1);
    me.vx = damp(me.vx, (fx * cp * sy + rx * sx) * v, 8, STEP);
    me.vy = damp(me.vy, (-sp * sy + up) * v, 8, STEP);
    me.vz = damp(me.vz, (fz * cp * sy + rz * sx) * v, 8, STEP);
    me.x = clamp(me.x + me.vx * STEP, -FLY_ROOM, FLY_ROOM);
    me.y = clamp(me.y + me.vy * STEP, 0.8, this.L.top + 80);
    me.z = clamp(me.z + me.vz * STEP, -FLY_ROOM, FLY_ROOM);
  }

  // A player's chosen colour (their slot colour if they haven't picked one).
  colorOf(slot) {
    const p = this.s.players.get(slot);
    return (p && p.color) ?? COLORS[slot % 4];
  }

  // What someone wears. Their colour is for the cord, the name tag and their effects.
  dress(s, r) {
    const p = this.s.players.get(s), c = this.colorOf(s);
    r.setLook(p && p.look ? resolveLook(p.look, p.role) : plainLook(c));
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
    for (const s of this.hidden) if (!this.s.players.has(s)) this.hidden.delete(s);
    const tied = slots.filter((s) => !this.loose.has(s));
    for (let i = 0; i + 1 < tied.length && !this.noCord; i++) {
      const a = tied[i], b = tied[i + 1], mesh = pool.ropes[i];
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
    out.vx = s[3]; out.vy = s[4]; out.vz = s[5]; out.yaw = s[6]; out.flags = s[7]; out.reel = s[8]; out.charge = s[9]; out.elev = s[10] || 0;
    return out;
  }

  // Seen from here only (their own phone does their physics): another climber is drawn as they were DELAY ago, but a lift or
  // any moving platform as it is now, so one riding a lift sank into it on the way up (up to a metre on the fast ones) and
  // hung above it on the way down. One standing on a moving platform is carried along with it to where it is drawn now,
  // right on its top. Eased in and out, so stepping on or off doesn't jump.
  rideShift(o, slot, dt) {
    const sh = this.rideSh || (this.rideSh = new Map());
    let s = sh.get(slot);
    if (!s) sh.set(slot, (s = { x: 0, y: 0, z: 0 }));
    let tx = 0, ty = 0, tz = 0;
    if (o.flags & F.GROUND) {
      const k = this.rideK || (this.rideK = {}), L = this.rideL || (this.rideL = {}), P = this.rideP || (this.rideP = {});
      const t0 = this.time - DELAY, t1 = this.simT - STEP + (this.alpha ?? 1) * STEP;
      for (const c of this.W.dyn) {
        if (!c.dyn || !c.on || o.x < c.minx - 3 || o.x > c.maxx + 3 || o.z < c.minz - 3 || o.z > c.maxz + 3 || o.y < c.miny - 3 || o.y > c.maxy + 4) continue;
        // A copy, so the platform the physics uses stays where it is.
        const m = k.m;
        Object.assign(k, c);
        k.m = m && m.length === c.m.length ? m : new Float64Array(c.m.length);
        k.m.set(c.m);
        placeDyn(k, t0);
        toLocal(k, o.x, o.y, o.z, false, L);
        const box = k.t === BOX, top = box ? k.hy : k.hh;
        if (box ? Math.abs(L.x) > k.hx + 0.15 || Math.abs(L.z) > k.hz + 0.15 : Math.hypot(L.x, L.z) > k.r + 0.15) continue;
        if (L.y < -top || L.y > top + PR + 0.6) continue;
        L.y = top + PR;
        placeDyn(k, t1);
        toWorld(k, L, P);
        tx = P.x - o.x; ty = P.y - o.y; tz = P.z - o.z;
        break;
      }
    }
    const f = Math.min(1, dt * 14);
    s.x += (tx - s.x) * f; s.y += (ty - s.y) * f; s.z += (tz - s.z) * f;
    return s;
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
    } else this.tick(dt);
    const T = this.time;
    const inp = paused ? NONE : app.input.read(this.cam.yaw);

    this.others.length = 0;
    this.vis = this.vis || new Map();
    for (const slot of this.s.players.keys()) {
      if (slot === this.slot) continue;
      if (this.hidden.has(slot)) { this.vis.delete(slot); continue; }
      const o = this.vis.get(slot) || {};
      if (this.sample(slot, T - DELAY, o)) {
        // Rounded the way it gets written down, so the rerun bumps into exactly the same place.
        o.x = Math.round(o.x * 1024) / 1024; o.y = Math.round(o.y * 1024) / 1024; o.z = Math.round(o.z * 1024) / 1024;
        o.slot = slot;
        this.vis.set(slot, o);
        this.others.push(o);
      }
    }
    if (this.loose.size && this.s.isHost && !(T < this.catchT)) { this.catchT = T + 0.25; this.catchUp(); }

    // Abilities are taps, handled once per frame. A shot only ever leaves while aiming: hold SHOOT and let go, or hold the aim
    // button and pull the trigger. Automatic weapons keep firing for as long as it is held.
    // Flying the buttons only steer: no shots or shield from someone who isn't there.
    const acts = this.flying ? NONE : inp;
    if (acts.shield && SHIELD_MAPS.has(this.L.mapKey) && this.me.raiseShield()) { if (this.rec) this.rec.act('s'); app.sound.shield(); }
    if (acts.act && this.action) this.perform(this.action, T);
    const ready = this.aiming && this.aimT >= AIM_READY, gun = (this.gun = weaponOf(myLook().w));
    this.aiming = this.me.aim = !!acts.aim && !this.me.hook;
    this.aimT = this.aiming ? this.aimT + dt : 0;
    if (acts.fire) {
      if (ready) this.fire(T);
      else if (app.ui.aimFirst) app.ui.aimFirst();
    } else if (gun.auto && this.aiming && this.aimT >= AIM_READY && (acts.fireHold || (acts.aimFlow && this.aimT >= 0.3))) this.fire(T);

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
      const m = this.me, st = [r3(m.x), r3(m.y), r3(m.z), r3(m.vx), r3(m.vy), r3(m.vz), r3(this.robots.get(this.slot).yaw), m.flags, r3(m.reel), r3(m.charge), r3(this.aimElev)];
      if (this.s.isHost) {
        const ex = this.noCord ? { f: this.falls, mz: this.mz } : { f: this.falls, cp: this.cp, mz: this.mz }, jp = this.jumpPack();
        if (jp.length) ex.jp = jp;
        this.s.hostState(T, st, ex);
      }
      else this.s.sendState(st);
    }
    // Where everyone else last stood (firmOf), for the saves and for whoever leaves.
    if (!this.solo) for (const p of this.s.players.values()) { const st = p.last; if (p.slot !== this.slot && Array.isArray(st) && st[7] & FIRM) p.firmS = st; }
    // Everyone saves, not only whoever runs the room: once it is empty, anyone who was in it can carry on (main.js roomSave).
    this.saveAcc += dt;
    if (!this.won && (this.saveSoon || this.saveAcc >= (this.solo ? SAVE_SOLO : SAVE_MP))) {
      this.saveAcc = 0;
      this.saveSoon = false;
      this.save(this.solo || this.saveN++ % SAVE_FULL === 0);
    }
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
    // A blinking stone stays solid where its hazard setting is off, but one on a hidden course that isn't there stays away.
    for (const c of this.L.blinks) { c.on = S.on(c.blink) ? S.blink(c.blink, t).on : c.kind !== 'secret'; if (!c.on && me.anchorCol === c) me.release(); }
    for (const c of this.L.traps) { c.on = !S.on(c.trap) || !S.trap(c.trap, t).open; if (!c.on && me.anchorCol === c) me.release(); }
    if (this.flying) {
      // The map goes on around it, and a host still runs its creatures for the others.
      this.flyStep(inp);
      if (this.s.isHost && !this.solo) this.jumpAI(t, STEP);
      return;
    }
    // No gusts inside a maze garden.
    const zone = this.mazeAround(me) ? -1 : zoneAt(this.L, me.y);
    this.env.wind = (b, o) => this.storm.wind(b, o, t, zone);
    if (this.rec && !this.solo && !this.noCord) for (const o of this.others) if (Math.abs(o.x - me.x) + Math.abs(o.y - me.y) + Math.abs(o.z - me.z) < 4) this.rec.partner(1, o.slot, o);
    me.step(STEP, inp, this.env);
    if (me.flags & FIRM) { const f = this.firm; f[0] = me.x; f[1] = me.y; f[2] = me.z; f[3] = 1; }
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
    this.mapEvent(t);
    for (const e of me.events) this.bodyEvent(e);
    me.events.length = 0;
    this.checks();
    this.pickups();
  }

  // Coins are each climber's own, and stay gone after a fall. Relics are there on every climb.
  pickups() {
    if (this.tped) return;
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
    for (const r of this.L.relics) {
      if (hasRelic(r.id) || !this.relicHere(r)) continue;
      const d = Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z);
      // In a maze garden it has to be from its own cell, not through the wall next to it. At the end of a course, by way of the course.
      if (d < (r.maze !== undefined ? 1.35 : 1.9)) {
        if (!r.way || (this.onCourse === r.i && this.wayAt >= r.way.length - 1 - RELIC_NEAR)) this.takeRelic(r);
      } else if (d < 25 && !this.relicNear.has(r.id)) {
        this.relicNear.add(r.id);
        this.app.sound.relicHum();
        this.app.ui.toast(r.kind === 'suit' ? 'Something is humming nearby...' : r.kind === 'epic' ? 'Something epic is hidden close by' : 'The legendary vault is close', 'gold');
      } else if (r.gate && !this.relicNear.has(r.id + 'g') && Math.hypot(r.gate.x - me.x, r.gate.y - me.y, r.gate.z - me.z) < 22) {
        // The gate to its course.
        this.relicNear.add(r.id + 'g');
        this.app.sound.relicHum();
        this.app.ui.toast(r.kind === 'suit' ? 'A relic course starts near here. Find the gate.' : r.kind === 'epic' ? 'A hidden course starts near here. Find the purple gate.' : 'The legendary course starts near here. Find the gate.', 'gold');
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

  // Is this relic there on this climb? The hidden spots are each on one difficulty only.
  relicHere(r) { return r.dv === undefined || r.dv === this.diff; }

  takeRelic(r) {
    const got = foundRelic(r.id), S = this.app.sound;
    cloud.runRelic(r.id);
    S.relic();
    this.app.ui.haptic('heavy');
    if (got && got.name) this.app.ui.banner(got.title, got.name, got.sub, r.kind === 'epic' ? '#c070ff' : '#ff9a2e');
    this.nearRelic = null;
    this.relicAim = null;
    this.app.view.markRelics(hasRelic);
    if (this.app.ui.players) this.app.ui.players(this);
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

  // Creatures come after you. In a maze they notice you from a few cells away, walk the corridors to you (never through a
  // wall) and don't let go while you stay in it. On a ledge they turn on you as you come near and stay on their platform.
  // This runs on each climber's own climb, so a rerun gets the same, and each player is hunted on their own screen.
  // Gives back the maze you are in, or null.
  huntStep(t) {
    const me = this.me, S = this.storm, L = this.L, hunt = S.hunt, M = this.mazeAround(me), P = tmpH, W = tmpW;
    // A new maze: hearts full again.
    if (M && this.heartMaze !== M.i) { this.heartMaze = M.i; this.hearts = MAZE_HEARTS; }
    // None left: back to the checkpoint. If that didn't get through (a short lock after another respawn), it is said again.
    if (this.hearts <= 0 && this.simT >= this.heartOutT) { this.heartOutT = this.simT + 2; this.s.toHost({ k: 'hearts' }); }
    const speed = (HUNT_SPEED[S.haz] ?? HUNT_SPEED[1]) * STEP, cells = HUNT_CELLS[S.haz] ?? HUNT_CELLS[1], you = M ? mazeCellAt(M, me.x, me.z) : 0;
    for (const m of L.monsters) {
      let h = hunt.get(m.i), tx, tz;
      if (m.mz !== undefined) {
        // In its maze only, and only with you in it too.
        if (!M || m.mz !== M.i) { if (h) hunt.delete(m.i); continue; }
        if (!h) {
          S.patrolPos(m, t, P);
          if (mazeWay(M, this.mz, mazeCellAt(M, P.x, P.z), you, W).steps > cells) continue;
          h = { x: P.x, z: P.z, hx: 0, hz: 1, wait: 0, lunge: 0 };
          hunt.set(m.i, h);
        }
        // Along the middle of the corridors, never through a wall (level.js mazeChase).
        h.lunge = Math.max(0, h.lunge - STEP * 3);
        if (h.wait > 0) { h.wait -= STEP; continue; }
        const st = S.stun.get(m.i);
        if (st && t >= st.from && t < st.until) continue;
        mazeChase(M, this.mz, h, you, me.x, me.z, speed, MAZE_BODY[L.mapKey] || MAZE_BODY.storm);
        continue;
      } else if (m.hl !== undefined) {
        // On its ledge: toward you if you are on it or coming, else back to its beat.
        if (!h && Math.abs(m.y - me.y) > 2.4) continue;
        const ex = me.x - m.cx, ez = me.z - m.cz, a = ex * m.fx + ez * m.fz, b = ez * m.fx - ex * m.fz;
        if (Math.abs(m.y - me.y) < 2.4 && Math.abs(a) < m.hl + 3 && Math.abs(b) < m.hw + 3) {
          if (!h) { S.patrolPos(m, t, P); h = { x: P.x, z: P.z, hx: 0, hz: 1, wait: 0, lunge: 0 }; hunt.set(m.i, h); }
          const qa = clamp(a, -m.hl, m.hl), qb = clamp(b, -m.hw, m.hw);
          tx = m.cx + qa * m.fx - qb * m.fz; tz = m.cz + qa * m.fz + qb * m.fx;
        } else {
          if (!h) continue;
          S.patrolPos(m, t, P);
          if (Math.abs(P.x - h.x) + Math.abs(P.z - h.z) < 0.7) { hunt.delete(m.i); continue; }
          tx = P.x; tz = P.z;
        }
      } else continue;
      h.lunge = Math.max(0, h.lunge - STEP * 3);
      if (h.wait > 0) { h.wait -= STEP; continue; }
      const s = S.stun.get(m.i);
      if (s && t >= s.from && t < s.until) continue;
      const dx = tx - h.x, dz = tz - h.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-4) { h.hx = dx / d; h.hz = dz / d; }
      if (d <= speed) { h.x = tx; h.z = tz; }
      else { h.x += (dx / d) * speed; h.z += (dz / d) * speed; }
    }
    return M;
  }

  // Monsters and bats knock you off on contact; lightning (sunny) strikes where it warned.
  hazards(t) {
    const me = this.me, L = this.L, k = this.storm.k, inMaze = this.huntStep(t);
    this.inMazeNow = !!inMaze;
    this.knockCd = Math.max(0, this.knockCd - STEP);
    const knock = (fx, fz, src) => {
      if (this.knockCd > 0) return false;
      this.knockCd = 0.8;
      const d = Math.hypot(me.x - fx, me.z - fz) || 1, nx = (me.x - fx) / d, nz = (me.z - fz) / d;
      if (me.knock(nx * 9 * k, 6.5 * k, nz * 9 * k, 0.6)) {
        this.app.sound.bonk();
        this.app.ui.haptic('heavy');
        this.app.ui.toast(src === 'bat' ? 'Bat attack!' : src === 'maze' ? MAZE_BITE[L.mapKey] || 'Monster hit you!' : 'Monster hit you!', 'bad');
        return true;
      }
      return false;
    };
    for (const m of L.monsters) {
      if (Math.abs(m.y - me.y) > 3) continue;
      const p = this.storm.monsterPos(m, t, tmpP), h = this.storm.hunt.get(m.i);
      // Just bitten: it lets go for a moment, so you can get away.
      if (h && h.wait > 0) continue;
      // Outside the forest every map's monsters are its own creature (the same as in its maze gardens).
      if (!p.stunned && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < m.r + PR && knock(p.x, p.z, m.mz !== undefined || L.mapKey !== 'forest' ? 'maze' : 'monster')) {
        if (h) { h.wait = 1.3; h.lunge = 1; }
        if (inMaze && m.mz === inMaze.i && this.hearts > 0) {
          this.hearts--;
          if (this.hearts <= 0) { this.heartOutT = this.simT; this.app.ui.toast('Out of hearts: back to the checkpoint', 'bad'); }
        }
      }
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
      } else if (l.k === 'bar') {
        // Over a flying car's way: hop over it as the car carries you through.
        const px = me.x - l.x, pz = me.z - l.z, a = px * l.ux + pz * l.uz, b = px * -l.uz + pz * l.ux;
        if (Math.abs(a) < 0.35 && Math.abs(b) < l.w && Math.abs(me.y - l.y) < 0.55) {
          const back = Math.sign(a) || -Math.sign(me.vx * l.ux + me.vz * l.uz) || 1;
          this.zapKnock(l.ux * back * 5, 4, l.uz * back * 5, 'laser');
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
        // What only the hidden courses have.
        case 'windmill': {
          const dx = me.x - o.x, dy = me.y - o.y, dz = me.z - o.z;
          if (Math.abs(dx * o.ux + dz * o.uz) > 0.6) break;
          const l = dx * o.uz - dz * o.ux;
          for (let k = 0; k < o.n; k++) {
            const a = S.blade(o, t, k), c = Math.cos(a), sn = Math.sin(a), q = clamp(l * c + dy * sn, 0, o.R), ex = l - c * q, ey = dy - sn * q;
            if (ex * ex + ey * ey < 0.34) {
              // Knocked the way the blade is going.
              const sg = (-sn * Math.sign(o.per)) >= 0 ? 1 : -1;
              this.zapKnock(o.uz * sg * 7, 4, -o.ux * sg * 7, 'obstacle', o.name);
              break;
            }
          }
          break;
        }
        case 'ring': {
          if (feet > o.y + 0.6 || feet < o.y - 0.8) break;
          const r = S.ring(o, t, P).r;
          if (r > 0.5 && Math.abs(Math.hypot(me.x - o.x, me.z - o.z) - r) < 0.38) away(o.x, o.z, 7, 4, o.name);
          break;
        }
        case 'comet': {
          const p = S.comet(o, t, P);
          if (p.fly && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) < o.r + PR) this.zapKnock(o.dx * 8, 3.5, o.dz * 8, 'obstacle', o.name);
          break;
        }
        case 'well':
          if (Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z) < o.r + PR) away(o.x, o.z, 9, 5, o.name);
          break;
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
    const S = this.storm, me = this.me, targets = this.flying ? [] : [[me.x, me.y, me.z]];
    for (const pl of this.s.players.values()) if (pl.slot !== this.slot && pl.last && !this.hidden.has(pl.slot)) targets.push([pl.last[0], pl.last[1], pl.last[2]]);
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

  // The map's own event (storm.js) on my climber. Nothing of it reaches into a maze garden: no marks are put down there and
  // nothing lands, washes or shakes anyone inside one.
  mapEvent(t) {
    const me = this.me, S = this.storm, ev = S.event(t, zoneAt(this.L, me.y)), calm = !!this.mazeAround(me), feet = me.y - PR;
    if (!ev || ev.kind === 'gust') return;
    if (ev.kind === 'wave') {
      // The water just behind the front washes you along with it, unless you are holding on or in the air above it.
      if (calm || me.anchored || me.ride || !S.inWave(ev, me.x, me.z)) return;
      if (feet - this.W.floorBelow(me.x, me.y, me.z, 30) > WAVE_H) return;
      const r = Math.hypot(me.x, me.z) || 1, ux = me.x / r, uz = me.z / r;
      this.zapKnock(-uz * ev.sign * 8 + ux * 3, 3.5, ux * ev.sign * 8 + uz * 3, 'wave');
    } else if (ev.kind === 'laser' || ev.kind === 'cannon') {
      if (markShots(S, this.evMarks, ev, me.x, feet, me.z, t, calm)) { this.app.sound.warn(); this.app.ui.haptic('tick'); }
      for (const m of this.evMarks.values()) {
        if (m.struck || t < m.at) continue;
        m.struck = true;
        const R = m.kind === 'laser' ? LASER_R : CANNON_R, dx = me.x - m.x, dz = me.z - m.z, d = Math.hypot(dx, dz);
        if (calm || d > R || Math.abs(feet - m.y) > 2.5) continue;
        const a = hash(m.key * 13 + 7000) * Math.PI * 2, nx = d > 0.2 ? dx / d : Math.cos(a), nz = d > 0.2 ? dz / d : Math.sin(a);
        this.zapKnock(nx * 7, m.kind === 'laser' ? 5 : 7, nz * 7, m.kind);
      }
    } else if (ev.kind === 'quake') {
      // Three shocks: feet on the ground get thrown, anyone in the air or holding on rides it out.
      for (let i = 0; i < QUAKE_AT.length; i++) {
        const at = ev.start + QUAKE_AT[i];
        if (at <= t - STEP || at > t || calm || !me.grounded || me.anchored) continue;
        const a = hash(ev.k * 11 + i + 5000) * Math.PI * 2;
        this.knockCd = 0;
        this.zapKnock(Math.cos(a) * 3.2, 7.5, Math.sin(a) * 3.2, 'quake');
      }
    } else if (ev.kind === 'bees') {
      const B = (this.bees = beeStep(this.bees, ev, me.x, me.y, me.z, STEP, calm)), got = beeReach(B, me.x, me.y, me.z, me.shield > 0);
      if (got === 'shield') {
        // A raised shield: the bees bounce off it and the swarm scatters.
        this.app.sound.shield();
        this.app.ui.haptic('tick');
        this.app.ui.toast('Your shield drove the bees off!', 'good');
        this.app.fx.blast(this.slot, B.x, B.y, B.z, { beam: '', blast: 2.4 });
      } else if (got === 'hit') {
        const dx = me.x - B.x, dz = me.z - B.z, d = Math.hypot(dx, dz) || 1;
        this.zapKnock((dx / d) * 6, 4.5, (dz / d) * 6, 'bees');
      }
    }
  }

  zapKnock(vx, vy, vz, src, name) {
    if (this.knockCd > 0) return;
    this.knockCd = 0.8;
    const k = this.storm.k;
    if (this.me.knock(vx * k, vy * k, vz * k, 0.5)) {
      this.app.sound[src === 'laser' ? 'zap' : src === 'wave' ? 'splash' : 'bonk']();
      this.app.ui.haptic('heavy');
      if (src === 'laser') this.app.ui.flash('#ff3050');
      if (src === 'geyser' || src === 'cannon') this.app.ui.flash('#ff7a1a');
      if (src === 'wave') this.app.ui.flash('#40c8ff');
      this.app.ui.toast(name ? name + '!' : { arrow: 'Hit by an arrow!', laser: 'Zapped by a laser!', geyser: 'Blasted by the eruption!', rock: 'Flattened by a boulder!', wave: 'Washed away by the wave!', cannon: 'Hit by a cannonball!', quake: 'Thrown by the quake!', bees: 'Stung by the bees!' }[src] || 'Ouch!', 'bad');
    }
  }

  // Lightning aimed at a climber: it marks the spot when the warning starts and strikes there.
  zap(slot, th, pos, mine) {
    let z = this.zaps.get(slot);
    // Inside a maze garden the lightning can't find you: no mark when it would start, no strike if you got in since.
    const calm = !!this.mazeAround(pos);
    if (th.warn > 0 && (!z || z.k !== th.k)) {
      z = { k: th.k, x: pos.x, y: pos.y - PR, z: pos.z, struck: calm };
      this.zaps.set(slot, z);
      if (mine && !calm) { this.app.sound.warn(); this.app.ui.haptic('tick'); }
    }
    if (!z || z.k !== th.k || z.struck || this.simT < th.strikeAt) return;
    z.struck = true;
    if (calm) return;
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
  // { t, x, y, z, kind?, i? }. The ray has to pass through the target; a weapon can count targets as bigger, and with aim assist
  // on they count as a little bigger still, so a shot that only just misses still hits.
  aimHit(T) {
    const cam = this.R.camera, o = cam.position, L = this.L, me = this.me, gun = this.gun, reach = gun.range, span = Math.max(40, reach);
    cam.getWorldDirection(fwd);
    const dx = fwd.x, dy = fwd.y, dz = fwd.z;
    let t = this.W.raycast(o.x, o.y, o.z, dx, dy, dz, reach, skipSoft), kind = null, idx = -1;
    const near = (y) => Math.abs(y - me.y) < span, grow = gun.hit * (1 + (this.app.settings.aimHelp || 0) * 0.8);
    const tryHit = (k, i, x, y, z, r) => {
      const h = raySphere(o.x, o.y, o.z, dx, dy, dz, x, y, z, r * grow);
      if (h >= 0 && h < t) { t = h; kind = k; idx = i; }
    };
    for (const d of L.doors) if (!this.doors.has(d.i) && near(d.by)) tryHit('door', d.i, d.bx, d.by, d.bz, 0.68);
    for (const m of L.monsters) if (near(m.y)) { const p = this.storm.monsterPos(m, T, tmpP); tryHit('monster', m.i, p.x, p.y, p.z, 0.75); }
    for (const b of L.bats) if (near(b.cy)) { const p = this.storm.batPos(b, T, tmpP); tryHit('bat', b.i, p.x, p.y, p.z, 0.55); }
    for (const J of this.jumpers) if (J.active && near(J.y)) tryHit('jumper', J.j.i, J.x, J.y + PR + 0.35, J.z, 0.7);
    if (this.friendlyFire) for (const q of this.others) tryHit('player', q.slot, q.x, q.y + 0.3, q.z, 0.5);
    return { t, x: o.x + dx * t, y: o.y + dy * t, z: o.z + dz * t, kind, i: idx };
  }

  // Friends can be shot off the climb, if the host of the game said so.
  get friendlyFire() { return !this.solo && this.rules.ff === 1; }

  fire(T) {
    const gun = this.gun;
    if (this.shotCd > T || this.won) return;
    this.shotCd = T + gun.rate;
    const h = this.aimHit(T), rig = this.robots.get(this.slot);
    // The shot leaves the muzzle of the weapon in the hands.
    rig.muzzle(muzzleAt);
    const a = [r3(muzzleAt.x), r3(muzzleAt.y), r3(muzzleAt.z)], to = [r3(h.x), r3(h.y), r3(h.z)];
    this.app.fx.tracer(this.slot, a, to, !!h.kind, gun);
    this.app.sound.shoot(gun.snd);
    this.lastShot = T;
    this.noteShot(this.slot, a, to, !!h.kind, gun.id, T);
    this.s.toHost({ k: 'shot', s: this.slot, a, b: to, h: h.kind ? 1 : 0, w: gun.id });
    if (h.kind === 'door') this.shootDoor(h.i, gun);
    else if (h.kind === 'player') this.shootFriend(h.i, h, gun);
    else if (h.kind) this.paralyse((h.kind === 'bat' ? 1000 : h.kind === 'jumper' ? 2000 : 0) + h.i, T, gun);
    // A blast reaches everything round where it landed.
    if (gun.blast) {
      const R2 = gun.blast * gun.blast, inside = (x, y, z) => (x - h.x) * (x - h.x) + (y - h.y) * (y - h.y) + (z - h.z) * (z - h.z) < R2, L = this.L;
      this.app.fx.blast(this.slot, h.x, h.y, h.z, gun);
      for (const d of L.doors) if (!this.doors.has(d.i) && !(h.kind === 'door' && h.i === d.i) && inside(d.bx, d.by, d.bz)) this.shootDoor(d.i, gun);
      for (const m of L.monsters) { const p = this.storm.monsterPos(m, T, tmpP); if (inside(p.x, p.y, p.z)) this.paralyse(m.i, T, gun); }
      for (const b of L.bats) { const p = this.storm.batPos(b, T, tmpP); if (inside(p.x, p.y, p.z)) this.paralyse(1000 + b.i, T, gun); }
      for (const J of this.jumpers) if (J.active && inside(J.x, J.y + PR, J.z)) this.paralyse(2000 + J.j.i, T, gun);
      if (this.friendlyFire) for (const q of this.others) if (!(h.kind === 'player' && h.i === q.slot) && inside(q.x, q.y, q.z)) this.shootFriend(q.slot, h, gun);
    }
    if (h.kind) this.app.ui.haptic('tick');
  }

  noteShot(slot, a, b, hit, w, T) {
    if (!Array.isArray(a) || !Array.isArray(b)) return;
    const f = this.feedShots;
    f.push([slot, +a[0], +a[1], +a[2], +b[0], +b[1], +b[2], hit ? 1 : 0, String(w || ''), r3(T)]);
    if (f.length > 16) f.shift();
  }

  shootDoor(i, gun) {
    if (this.rec && this.solo) this.rec.act('d', i, gun.id);
    this.s.toHost({ k: 'door', i });
  }

  // Something already paralysed stays as it is: starting again would make it jump to where it would have been by now.
  paralyse(m, T, gun) {
    const was = this.storm.stun.get(m);
    if (was && T < was.until) return;
    const from = r3(T), until = r3(T + gun.stun);
    if (this.rec && this.solo) this.rec.act('n', m, from, until, gun.id);
    this.s.toHost({ k: 'stun', m, from, until });
  }

  // Thrown away from the shooter and up, off whatever they stand on or hold on to.
  shootFriend(slot, h, gun) {
    const q = this.others.find((o) => o.slot === slot);
    if (!q) return;
    let dx = q.x - this.me.x, dz = q.z - this.me.z;
    const d = Math.hypot(dx, dz) || 1, k = gun.knock;
    dx /= d; dz /= d;
    const me = this.s.players.get(this.slot);
    this.s.toHost({ k: 'ff', to: slot, s: this.slot, v: [r3(dx * k), r3(Math.max(5, k * 0.55)), r3(dz * k)], n: String((me && me.name) || '').slice(0, 14) });
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

  // The emote picked for checkpoints (main.js emote menu) plays when you reach one. Never a flip: that would be a jump.
  cpEmote() {
    const id = this.app.settings.cpEmote, em = typeof id === 'string' && Object.hasOwn(EMOTE, id) ? EMOTE[id] : null;
    if (em && !em.hop && this.me.grounded) this.emote(id);
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
        this.noteShot(this.slot, a, b, false, '', this.time);
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
      } else this.app.ui.toast('Your shield took the strike', 'good');
    }
  }

  // Volcano: the lava going up (LAVA_RISE), and a warning when it gets close below you.
  lavaStep() {
    const cp = this.L.cps[this.cp], me = this.me;
    if (this.lavaCp !== this.cp) { this.lavaCp = this.cp; if (cp) this.lavaY = Math.max(this.lavaY, cp.y - LAVA_GAP); }
    if (this.onCourse < 0 && !this.inMazeNow && !this.won) this.lavaY = Math.min(this.L.top - 12, this.lavaY + (LAVA_RISE[this.storm.haz] ?? LAVA_RISE[1]) * STEP);
    const below = me.y - PR - this.lavaY;
    if (below < 9 && !this.lavaWarn) { this.lavaWarn = true; this.app.ui.toast('The lava is close!', 'bad'); this.app.ui.haptic('tick'); }
    else if (below > 20) this.lavaWarn = false;
  }

  checks() {
    const me = this.me, L = this.L;
    if (!isFinite(me.x + me.y + me.z)) { const p = this.spawnPos(this.cp, this.slot); me.spawn(p[0], p[1], p[2]); }
    // A fall right after a respawn hits the host's short lock and is ignored, so if nothing has happened after two seconds it is said again.
    if (this.splashed && this.simT > this.splashT + 2) this.splashed = false;
    if (this.lavaY !== null) this.lavaStep();
    if ((me.y < 0.3 || (this.lavaY !== null && me.y - PR < this.lavaY)) && !this.splashed) {
      this.splashed = true;
      this.splashT = this.simT;
      this.app.sound.splash();
      this.app.ui.haptic('heavy');
      this.s.toHost({ k: 'splash' });
    }
    this.courseChecks();
    for (const cp of L.cps) {
      if (cp.i <= this.cp || this.cpSent.has(cp.i) || !cpEnabled(cp, this.cpl)) continue;
      if (Math.hypot(me.x - cp.x, me.z - cp.z) < 3 && Math.abs(me.y - PR - cp.y) < 1.3) { this.cpSent.add(cp.i); this.s.toHost({ k: 'cp', i: cp.i }); this.cpEmote(); }
    }
    if (!this.winSent && (!this.tped || this.solo) && me.grounded && me.y > L.top - 0.5 && Math.hypot(me.x, me.z) < L.summit.r) { this.winSent = true; this.s.toHost({ k: 'win' }); }
    const g = me.grounded && me.ground;
    if (g && g.crumble && g.crumble.st === 0) { this.crumble(g.crumble.i); this.s.toHost({ k: 'crumble', i: g.crumble.i }); }
    if (g && g.kind === 'mfloor') {
      if (!this.mazeSeen) { this.mazeSeen = true; this.app.ui.toast('A maze! You have 3 hearts in here, and it changes every time you go back to a checkpoint', ''); }
    }
    const z = zoneAt(L, me.y);
    if (z > this.maxZone) {
      if (this.maxZone >= 0 || z === 0) this.app.sound.zone();
      this.maxZone = z;
      this.app.ui.zoneTitle(z);
    }
  }

  // The hidden courses: the markers along them, a fall back to the last marker, and the ring at the end that takes you back to the route.
  // How far along a course a marker is, -1 for none.
  wayOf(rest) {
    const r = rest && this.L.relics[rest[0]], q = r && r.rests && r.rests[rest[1]];
    return q ? q.c.wi : -1;
  }

  // Nobody gets onto a course but by its way in, anywhere up to the second marker. Nor is a course a way up the route: off it
  // and onto the route above where it started, you are back where it started.
  courseSkip(r) {
    this.splashed = true;
    this.splashT = this.simT;
    this.s.toHost({ k: 'course', r, n: -1, skip: 1 });
  }

  courseChecks() {
    const me = this.me, L = this.L, g = me.grounded && me.ground;
    // A gate that is a portal: walk into it.
    if (!this.splashed) {
      for (const r of L.relics) {
        const G = r.portal && this.onCourse !== r.i && this.relicHere(r) && r.gate;
        if (!G) continue;
        const d = Math.hypot(me.x - G.x, me.z - G.z);
        // Just sent back here: the gate only takes you again once you have stepped away from it.
        if (this.gateOff === r.i) { if (d > 2) this.gateOff = -1; continue; }
        if (d < 1.15 && me.y - PR > G.y - 0.4 && me.y - PR < G.y + 3) {
          this.splashed = true;
          this.splashT = this.simT;
          this.s.toHost({ k: 'course', r: r.i, n: 0, in: 1 });
          return;
        }
      }
    }
    if (g) {
      if (this.wayFree) {
        this.wayFree = false;
        this.onCourse = -1;
        this.wayAt = -1;
        if (g.kind === 'secret') { this.onCourse = g.ri; this.wayAt = g.wi; }
      }
      if (g.kind === 'secret') {
        // From anywhere else a course only counts from its way in. Once on it, how you get along it is up to you: stones are
        // never counted, since pads throw you past some without you ever standing on them, and the cord can pull you past others.
        const r = L.relics[g.ri], been = this.onCourse === g.ri ? this.wayAt : -1;
        if (been < 0 && g.wi > r.entry) {
          if (!this.splashed) this.courseSkip(g.ri);
          return;
        }
        this.onCourse = g.ri;
        this.wayAt = Math.max(been, g.wi);
        if (g.rest !== undefined && (!this.rest || this.rest[0] !== g.ri || this.rest[1] !== g.rest)) {
          this.rest = [g.ri, g.rest];
          this.app.sound.checkpoint();
          this.app.ui.haptic('tick');
          this.app.ui.toast('Course marker reached: a fall brings you back here', 'good');
        }
      } else {
        const r = this.onCourse >= 0 && L.relics[this.onCourse], st = r && r.start;
        if (st && me.y - PR > st.y + st.hy + 3) {
          if (!this.splashed) this.courseSkip(r.i);
          return;
        }
        this.onCourse = -1;
        this.wayAt = -1;
        this.rest = null;
      }
    }
    if (this.rest && !this.splashed) {
      const r = L.relics[this.rest[0]], q = r && r.rests && r.rests[this.rest[1]];
      if (!q) this.rest = null;
      else if (me.y < q.y - 14) {
        this.splashed = true;
        this.splashT = this.simT;
        this.app.ui.haptic('heavy');
        this.s.toHost({ k: 'course', r: this.rest[0], n: this.rest[1], fall: 1 });
      }
    }
    if (this.onCourse >= 0 && g && !this.splashed) {
      // The ring at its end, and through a portal one where you arrive too: there is no other way off that course.
      const r = L.relics[this.onCourse], x = r && r.exit, b = r && r.back;
      if ((x && Math.hypot(me.x - x.x, me.z - x.z) < 1 && Math.abs(me.y - PR - x.y) < 1.2) || (b && Math.hypot(me.x - b.x, me.z - b.z) < 0.75 && Math.abs(me.y - PR - b.y) < 1.2)) {
        this.splashed = true;
        this.splashT = this.simT;
        this.s.toHost({ k: 'course', r: this.onCourse, n: -1 });
      }
    }
  }

  // Where a course sends someone: marker n of relic r, or with n -1 the route platform the course starts from.
  coursePos(r, n, slot) {
    const q = this.L.relics[r], a = (slot / 4) * Math.PI * 2 + 0.4;
    if (!q || !q.rests) return null;
    const p = n >= 0 ? q.rests[n] : { x: q.start.x, y: q.start.y + q.start.hy, z: q.start.z };
    return p ? [p.x + Math.cos(a) * 0.5, p.y + PR + 0.4, p.z + Math.sin(a) * 0.5] : null;
  }

  // ----- host-only team rules -----
  hostEvent(e, from) {
    // Alone, time is physics time: nothing else ever decides what happens.
    const T = this.solo ? this.simT : this.time;
    if (e.k === 'restart' && this.rec && this.solo) this.rec.act('r');
    switch (e.k) {
      case 'splash':
      case 'hearts':
      case 'restart': {
        // Tied together by the cord, the whole team goes back. Without the cord, or not on it yet, only the one who fell
        // (or asked to restart) does; everyone else keeps climbing.
        const one = (this.noCord || this.loose.has(from)) && from !== undefined ? from : null, key = one === null ? 'team' : one;
        this.locks = this.locks || {};
        if (T < (this.locks[key] || 0)) return;
        this.locks[key] = T + 1.5;
        if (e.k === 'splash' || e.k === 'hearts') this.falls++;
        if (this.cpl === 2 && one === null) this.cp = 0;
        // The whole team back at the checkpoint: the maze gardens change, so the way through has to be found again.
        // (Without the cord one climber going back leaves them alone: the others may be inside one. So does a team going back
        // while someone is still catching up.)
        if (one === null && !this.loose.size) this.mz++;
        // Without the cord, the one who fell goes back to their own checkpoint.
        const cp = one === null ? this.cp : this.pcp[one] || 0, pos = {}, at = this.cpl === 2 ? 0 : cp;
        for (const slot of one === null ? this.s.players.keys() : [one]) pos[slot] = this.spawnPos(at, slot);
        this.s.toAll({ k: 'respawn', cp, at, pos, falls: this.falls, mz: this.mz, why: e.k, only: one });
        break;
      }
      case 'course': {
        // As with any fall: tied together, the whole team goes; without the cord, only the one it happened to.
        const one = (this.noCord || this.loose.has(from)) && from !== undefined ? from : null, key = one === null ? 'team' : one, pos = {};
        this.locks = this.locks || {};
        if (T < (this.locks[key] || 0)) return;
        if (!this.coursePos(e.r, e.n, 0)) return;
        this.locks[key] = T + 1.5;
        if (e.fall) this.falls++;
        for (const slot of one === null ? this.s.players.keys() : [one]) pos[slot] = this.coursePos(e.r, e.n, slot);
        const cp = one === null ? this.cp : this.pcp[one] || 0;
        this.s.toAll({ k: 'respawn', cp, at: cp, pos, falls: this.falls, mz: this.mz, why: e.fall ? 'course' : e.skip ? 'courseskip' : e.in ? 'coursein' : 'courseout', only: one, rest: [e.r, e.n] });
        break;
      }
      case 'resetcp': {
        // Alone, or the host of a tied team (they all share one checkpoint): back to the start of the map, the whole team.
        // Anyone else goes back alone, and on a tied team climbs on their own until they reach the others again.
        if (this.rec && this.solo) this.rec.act('x');
        const one = from === undefined || (from === this.slot && !this.noCord) ? null : from, pos = {};
        if (one === null) {
          this.cp = 0;
          if (!this.loose.size) this.mz++;
        } else {
          this.pcp[one] = 0;
          if (!this.noCord) this.setLoose([...this.loose, one]);
        }
        for (const slot of one === null ? this.s.players.keys() : [one]) pos[slot] = this.spawnPos(0, slot);
        this.s.toAll({ k: 'respawn', cp: 0, at: 0, pos, falls: this.falls, mz: this.mz, why: 'reset', only: one });
        this.save();
        break;
      }
      case 'cp':
        if (!cpEnabled(this.L.cps[e.i], this.cpl)) break;
        // The traitor jammed them (traitor.js).
        if (this.app.traitor && this.app.traitor.jammed(T)) break;
        if ((this.noCord || this.loose.has(from)) && from !== undefined) {
          // Only the player who got there moves on; everyone hears about it.
          if (e.i > (this.pcp[from] || 0)) { this.pcp[from] = e.i; this.s.toAll({ k: 'cp', i: e.i, slot: from }); this.save(); }
        } else if (e.i > this.cp) { this.cp = e.i; this.s.toAll({ k: 'cp', i: e.i }); this.save(); }
        break;
      // The host switches the ghosts off (or on again) for everyone (ghost.js, rules.ng).
      case 'ghosts':
        if (from !== undefined && from !== this.slot) break;
        this.rules.ng = e.off ? 1 : 0;
        this.s.toAll({ k: 'ghosts', off: !!e.off });
        break;
      // Traitor mode (traitor.js): sabotages, calling a vote and the votes, all decided here.
      case 'tr':
        if (this.app.traitor) this.app.traitor.hostEv(this, e, from);
        break;
      case 'hide':
        // Vanished: gone for the others and off the cord. Back again, they climb on their own until they reach them.
        if (from === undefined) break;
        if (e.on) { this.hidden.add(from); if (!this.noCord) this.setLoose([...this.loose, from]); }
        else this.hidden.delete(from);
        this.s.toAll({ k: 'hide', s: [...this.hidden] });
        break;
      case 'tp':
        // The team moved them: their own checkpoint from here, and off the cord until they reach the others again.
        if (from === undefined || !Number.isInteger(e.i) || !this.L.cps[e.i]) break;
        this.pcp[from] = e.i;
        if (!this.noCord) this.setLoose([...this.loose, from]);
        this.save();
        break;
      case 'sling': this.s.toSlot(e.to, e); break;
      case 'crumble': this.s.toAll(e); break;
      case 'fall': this.falls++; break;
      case 'door': if (!this.doors.has(e.i)) this.s.toAll(e); break;
      case 'stun': case 'shot': case 'emote': case 'ff': case 'spray': this.s.toAll(e); break;
      case 'win':
        if (!this.won) {
          const tr = this.app.traitor ? this.app.traitor.winInfo(this) : undefined;
          this.s.toAll(Object.assign({ k: 'win', t: T, falls: this.falls }, tr ? { tr } : {}));
        }
        break;
    }
  }

  ownFall(e) { return this.s.isHost && !this.solo && !this.noCord && e.only !== null && e.only !== undefined; }

  onEvent(e) {
    const ui = this.app.ui;
    // With others, these come from elsewhere, so the rerun can't work them out and they get written down.
    if (this.rec && !this.solo && (e.k === 'respawn' || e.k === 'cp' || e.k === 'sling' || e.k === 'crumble' || e.k === 'door' || e.k === 'stun' || e.k === 'win' || e.k === 'ff' || e.k === 'maze' || e.k === 'loose')) this.rec.act('e', e);
    // A checkpoint, a fall back to one, someone leaving: saved on this phone straight away (the next frame), not a second later.
    if (!this.solo && (e.k === 'cp' || e.k === 'respawn' || e.k === 'loose' || e.k === 'left' || e.k === 'maze' || e.k === 'door')) this.saveSoon = true;
    switch (e.k) {
      case 'respawn': {
        this.falls = e.falls;
        // Everyone keeps track of everyone's checkpoint, should they ever run the room (takeOver).
        if (e.why === 'reset' && Number.isInteger(e.only)) this.pcp[e.only] = 0;
        if (e.mz !== undefined && e.mz !== this.mz) this.setMaze(e.mz);
        if (e.only !== null && e.only !== undefined && e.only !== this.slot) {
          // Someone else went back (no cord). Forget their old track so they don't glide across the map.
          const pl = this.s.players.get(e.only);
          if (pl) { pl.samples.length = 0; if (e.why === 'splash') ui.toast(`${pl.name} fell and went back`, ''); }
          break;
        }
        // The team went back, and I'm not on the cord yet: I climb on.
        if ((e.only === null || e.only === undefined) && this.loose.has(this.slot)) {
          for (const pl of this.s.players.values()) if (pl.slot !== this.slot) pl.samples.length = 0;
          break;
        }
        const p = (e.pos && e.pos[this.slot]) || this.spawnPos(e.at ?? e.cp, this.slot);
        this.me.spawn(p[0], p[1], p[2]);
        if (this.lavaY !== null) { this.lavaY = p[1] - PR - LAVA_GAP; this.lavaWarn = false; }
        // Back at a marker it still counts, anywhere else it starts over.
        this.rest = e.rest && e.rest[1] >= 0 ? e.rest : null;
        this.onCourse = this.rest ? this.rest[0] : -1;
        this.wayAt = this.wayOf(this.rest);
        this.gateOff = e.rest && e.rest[1] < 0 ? e.rest[0] : -1;
        // The host of a tied team, moved by the team and off the cord for now: only their own fall, not the team's checkpoint.
        if (!this.ownFall(e)) this.cp = e.cp;
        this.falls = e.falls;
        if (e.why === 'splash' || e.why === 'course' || e.why === 'hearts') addTotals(1, 0);
        // Hearts full again, and whatever was after you has lost you.
        this.hearts = MAZE_HEARTS;
        this.heartMaze = -1;
        this.storm.hunt.clear();
        this.splashed = false;
        this.cpSent.clear();
        for (const l of this.links) l.chain.ok = false;
        if (e.only === null || e.only === undefined) for (const pl of this.s.players.values()) if (pl.slot !== this.slot) pl.samples.length = 0;
        // Back on a course, looking the way it goes on.
        const mark = this.rest && this.L.relics[this.rest[0]].rests[this.rest[1]];
        Object.assign(this.cam, { yaw: mark ? Math.atan2(-Math.cos(mark.a), -Math.sin(mark.a)) : this.startYaw(p[0], p[2], e.at ?? e.cp), x: p[0], y: p[1] + 0.7, z: p[2] });
        this.app.view.setCheckpoints(this.cpl, this.cp);
        if (e.why === 'course' || e.why === 'courseout') { ui.toast(e.why === 'course' ? 'Back to the last course marker' : 'Back on the route', ''); break; }
        if (e.why === 'hearts') break;
        if (e.why === 'coursein') { this.app.sound.relicHum(); ui.toast('Through the gate: this course runs outside the crater', 'gold'); break; }
        if (e.why === 'courseskip') { ui.toast('No shortcuts: a course only counts from its gate, all the way', 'bad'); break; }
        const into = { volcano: 'Into the lava.', city: 'Into the bay.', forest: 'All the way down.', waterfall: 'Splash! Into the lagoon.' }[this.L.mapKey] || 'Into the sea.';
        ui.toast(e.why === 'reset' ? 'The team sent you back to the start of the map.' : e.why === 'restart' ? 'Restarting from the checkpoint' : this.cpl === 2 ? into + ' Back to the start!' : into + ' Back to the checkpoint.', 'bad');
        break;
      }
      case 'cp':
        if (Number.isInteger(e.i) && this.L.cps[e.i]) {
          if (Number.isInteger(e.slot)) this.pcp[e.slot] = e.i;
          else if (e.i > this.teamCp) this.teamCp = e.i;
        }
        if (e.slot !== undefined && e.slot !== this.slot) {
          // No cord: someone else's checkpoint, not mine.
          const pl = this.s.players.get(e.slot), r = this.robots.get(e.slot);
          if (r) r.cheer();
          if (pl) ui.toast(`${pl.name} reached a checkpoint`, '');
          break;
        }
        // The team's checkpoint isn't mine until I'm on the cord.
        if (e.slot === undefined && this.loose.has(this.slot)) break;
        if (e.i > this.cp && !(this.s.isHost && !this.solo && !this.noCord && e.slot !== undefined)) { this.cp = e.i; this.app.view.setCheckpoints(this.cpl, this.cp); }
        for (const r of this.robots.values()) r.cheer();
        this.app.sound.checkpoint();
        ui.toast('Checkpoint reached', 'good');
        ui.haptic('tick');
        break;
      case 'loose': {
        const was = this.loose.has(this.slot);
        this.loose = new Set(Array.isArray(e.s) ? e.s.filter(Number.isInteger) : []);
        if (was && !this.loose.has(this.slot)) {
          // Caught up: from here on the team's checkpoint is mine too.
          if (Number.isInteger(e.cp) && this.L.cps[e.cp]) { this.cp = e.cp; this.cpSent.clear(); this.app.view.setCheckpoints(this.cpl, this.cp); }
          ui.toast('You reached your team: the cord is on', 'good');
        }
        this.syncRoster();
        break;
      }
      case 'hide':
        this.hidden = new Set(Array.isArray(e.s) ? e.s.filter(Number.isInteger) : []);
        if (this.vis) for (const s of this.hidden) this.vis.delete(s);
        this.syncRoster();
        break;
      case 'left': this.addLeft(e.m); break;
      case 'sling': if (e.to === this.slot) this.me.fling(e.v[0], e.v[1], e.v[2]); break;
      case 'maze': if (e.v !== this.mz) this.setMaze(e.v); break;
      case 'crumble': this.crumble(e.i); break;
      case 'door': if (!this.doors.has(e.i)) this.openDoor(e.i); break;
      case 'stun': this.storm.stun.set(e.m, { from: e.from, until: e.until }); this.app.sound.stun(); break;
      case 'shot':
        if (e.s !== this.slot) {
          const shotBy = WEAPON[e.w];
          this.shotAt.set(e.s, this.time);
          this.noteShot(e.s, e.a, e.b, !!e.h, e.w, this.time);
          this.app.fx.tracer(e.s, e.a, e.b, !!e.h, shotBy);
          if (shotBy) {
            this.app.sound.shoot(shotBy.snd, 0.5);
            if (shotBy.blast) this.app.fx.blast(e.s, e.b[0], e.b[1], e.b[2], shotBy);
          }
        }
        break;
      case 'ff':
        if (e.to === this.slot && this.rules.ff === 1 && Array.isArray(e.v)) this.zapKnock(+e.v[0] || 0, +e.v[1] || 0, +e.v[2] || 0, 'shot', `Shot by ${String(e.n || 'a friend').slice(0, 14)}`);
        break;
      // Graffiti from someone else (graffiti.js, through main.js): only for the eyes.
      case 'spray':
        if (e.s !== this.slot && this.app.onSpray) this.app.onSpray(e);
        break;
      case 'emote':
        if (e.s !== this.slot) {
          const r = this.robots.get(e.s), em = typeof e.e === 'string' && Object.hasOwn(EMOTE, e.e) ? EMOTE[e.e] : null;
          if (r && em) { r.playEmote(e.e); if (em.icon) ui.bubble(e.s, em.icon); }
        }
        break;
      case 'win': this.finish(e); break;
      case 'tr': if (this.app.traitor) this.app.traitor.ev(this, e); break;
      case 'ghosts':
        this.rules.ng = e.off ? 1 : 0;
        if (this.app.ui.ghostsSaid) this.app.ui.ghostsSaid(!!e.off);
        break;
    }
  }

  // Stand the maze walls the way variant v has them (level.js applyMaze), here and on screen.
  setMaze(v) {
    this.mz = Math.max(0, Math.floor(+v) || 0);
    if (!this.L.mazes || !this.L.mazes.length) return;
    applyMaze(this.L, this.mz);
    // The walls stand differently now: nobody can be followed through them.
    this.storm.hunt.clear();
    this.app.view.setMaze(this.mz);
  }

  // full: also a point the anticheat can pick the climb up from (alone every save is). With others the ones in between only
  // note where everyone is, which costs next to nothing.
  save(full = true) {
    if (this.won) return;
    // Halfway through a physics step the climber isn't anywhere yet. It happens when the step is done.
    if (this.stepping) { this.saveLater = true; return; }
    // Alone, a save is where the server picks the climb up again, and it doesn't follow a flight. The last one from before it stands.
    if (this.flying && this.solo) return;
    const m = this.me;
    if (full || this.solo) {
      this.savedRs = this.rec ? this.rec.save() : undefined;
      cloud.climbSaved();
    }
    const sv = { v: layoutLV(this.map), cx: this.L.coinX, climbId: cloud.runId(), rs: this.savedRs, rest: this.solo ? this.rest : undefined, map: this.map, diff: this.diff, rules: this.rules, noCord: this.noCord, t: this.solo ? this.simT : this.time, cp: this.cp, falls: this.falls, mz: this.mz, doors: [...this.doors], pos: [m.x, m.y + 0.3, m.z], coins: [...this.coinTaken], run: this.run, tp: this.tped || undefined };
    if (this.solo) { store.set('save.solo', sv); return; }
    if (!this.climb) return;
    // With others: the team's checkpoint, and everyone's own checkpoint and spot by their key, so each of them gets their own
    // back, whatever place in the room they have next time (main.js resumeGame).
    sv.climb = this.climb;
    sv.when = Date.now();
    sv.cp = this.teamCheckpoint();
    sv.team = {};
    sv.left = {};
    for (const p of this.s.players.values()) {
      const who = p.slot === this.slot ? this.s.who : p.who;
      if (!who) continue;
      const loose = !this.noCord && this.loose.has(p.slot) ? 1 : 0, cp = this.cpOf(p.slot);
      // Where they last stood. Flying or vanished they can be anywhere: then only their checkpoint.
      const f = this.firm, at = p.slot === this.slot ? (this.flying || !f[3] ? null : [r3(f[0]), r3(f[1] + 0.3), r3(f[2])]) : this.firmOf(p);
      sv.team[who] = at && spotOk(at) ? [cp, at[0], at[1], at[2], loose] : [cp];
    }
    for (const k of Object.keys(this.left)) if (!sv.team[k]) sv.left[k] = this.left[k];
    putTeamSave(sv);
  }

  // Where someone else last stood or held on, from what this phone heard of them (frame loop, firmS), lifted a little like a spawn.
  firmOf(p) {
    const st = p && !p.wait && !this.hidden.has(p.slot) ? p.firmS : null;
    return st && spotOk(st) ? [r3(st[0]), r3(st[1] + 0.3), r3(st[2])] : null;
  }

  // The team's checkpoint: the host holds it in cp, everyone else hears it (teamCp), which is their own too unless catching up.
  teamCheckpoint() {
    return this.s.isHost || !Number.isInteger(this.teamCp) || !this.L.cps[this.teamCp] ? this.cp : this.teamCp;
  }
  // A climber's own checkpoint: the team's when tied to it, otherwise their own (pcp, and on this phone cp).
  cpOf(slot) {
    if (!this.noCord && !this.loose.has(slot)) return this.teamCheckpoint();
    if (slot === this.slot && (this.noCord || !this.s.isHost)) return this.cp;
    const i = this.pcp[slot];
    return Number.isInteger(i) && this.L.cps[i] ? i : 0;
  }

  finish(e) {
    if (this.won) return;
    this.won = true;
    for (const r of this.robots.values()) r.cheer();
    if (this.solo) store.del('save.solo');
    else if (this.climb) dropTeamSave(this.climb);
    // Without the cord, or still catching up, someone else can get to the top while this climber is nowhere near it. The climb
    // ends for everyone, but the top and its bonus are only for those who are there. (The rerun checks the same.)
    const far = this.tped || ((this.noCord || this.loose.has(this.slot)) && !nearTop(this.me, this.L, this.rope));
    // Best times only count when playing the difficulty's own rules (no custom rules).
    const custom = this.custom;
    const bonus = far ? 0 : this.D.summit, unlocked = [];
    const counts = cloud.counting();
    if (!far) cloud.runWin(e.falls);
    if (counts && bonus) addCoins(bonus);
    this.run.coins += bonus;
    // Easier custom rules don't count: otherwise Hardcore's bonus could be had with every checkpoint switched on.
    const first = far || this.custom || !counts ? 0 : firstWin(this.diff, this.D.first);
    this.run.coins += first;
    if (!far) {
      this.run.won = true;
      this.run.h = Math.max(this.run.h, Math.min(1000, Math.round(this.L.top - 2)));
    }
    this.falls = e.falls;
    if (this.hardcore && !far) {
      const a = award('summit'), b = e.falls === 0 ? award('flawless') : null;
      if (a) unlocked.push(a.name);
      if (b) unlocked.push(b.name);
    }
    this.noteRun();
    flushProfile();
    const key = this.map + ':' + this.diff + (custom ? ':custom' : ''), best = store.get('best2', {}), prev = best[key];
    if (!far && (!prev || e.t < prev)) { best[key] = e.t; store.set('best2', best); }
    this.app.sound.win();
    this.app.finish({ far, tr: e.tr && typeof e.tr === 'object' ? e.tr : null, firstWin: first, time: e.t, falls: e.falls, diff: this.diff, map: this.map, best: far ? prev || 0 : Math.min(prev || 1e9, e.t), record: !far && (!prev || e.t < prev), players: this.s.players.size, coins: this.run.coins, bonus, unlocked });
  }

  // ----- per-frame visuals -----
  draw(dt) {
    const app = this.app, R = this.R, me = this.me, T = this.time;
    this.drawAt = this.drawAt || new Map();
    if (!this.robots.has(this.slot)) this.syncRoster();
    const W = this.W;
    const faceYaw = Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
    const myRig = this.robots.get(this.slot);
    this.aimElev = -this.cam.pitch;
    myRig.update(dt, me.x, me.y, me.z, me.vx, me.vy, me.vz, me.flags, me.charge, W.floorBelow(me.x, me.y, me.z, 30), faceYaw, T - (this.lastShot || -9), this.aimElev);
    for (const [slot, r] of this.robots) {
      if (slot === this.slot) continue;
      const o = this.vis && this.vis.get(slot);
      r.g.visible = !!o;
      if (!o) { r.hide(); continue; }
      const d = this.rideShift(o, slot, dt), at = this.drawAt.get(slot) || {};
      at.x = o.x + d.x; at.y = o.y + d.y; at.z = o.z + d.z; at.reel = o.reel;
      this.drawAt.set(slot, at);
      r.update(dt, at.x, at.y, at.z, o.vx, o.vy, o.vz, o.flags, o.charge, W.floorBelow(at.x, at.y, at.z, 30), o.yaw, T - (this.shotAt.get(slot) ?? -9), o.elev);
      const th = this.storm.thunder(T, slot);
      if (th) this.zap(slot, th, o, false);
      // The lasers, cannonballs and bees after them, from where they are seen (their own phone does the hitting).
      const evO = this.storm.event(T, zoneAt(this.L, o.y)), calmO = !!this.mazeAround(o);
      if (!this.evOther.has(slot)) this.evOther.set(slot, new Map());
      markShots(this.storm, this.evOther.get(slot), evO, o.x, o.y - PR, o.z, T, calmO);
      const BO = beeStep(this.beesOther.get(slot), evO, o.x, o.y, o.z, dt, calmO);
      this.beesOther.set(slot, BO);
      // Their shield drives it off, or it stings them: either way it goes, as on their phone.
      if (beeReach(BO, o.x, o.y, o.z, !!(o.flags & F.SHIELD)) === 'shield') this.app.fx.blast(slot, BO.x, BO.y, BO.z, { beam: '', blast: 2.4 });
    }
    for (const slot of this.evOther.keys()) if (!this.vis || !this.vis.get(slot)) { this.evOther.delete(slot); this.beesOther.delete(slot); }
    this.drawJumpers(dt, T);
    const pos = (slot) => (slot === this.slot ? me : this.vis && this.vis.get(slot) && this.drawAt.get(slot));
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
    const gunNow = this.gun, zoomed = this.aiming && gunNow.zoom < 48, aimFov = 48 + (gunNow.zoom - 48) * (zoomed ? 1 : 0);
    // A scoped weapon looks through its sight: the view goes to the eye, narrows, and turns slower to match.
    const sk = (this.scopeK = damp(this.scopeK, this.aiming && gunNow.scope ? 1 : 0, 13, dt));
    const c = this.cam, [dx, dy] = app.input.takeCam(this.aiming, zoomed ? gunNow.zoom / 48 : 1), ak = (this.aimK = damp(this.aimK, this.aiming ? 1 : 0, 12, dt));
    // Inside a maze garden the view goes to the eyes, aiming or not: walls and a roof all round, and nobody sees the way
    // from above. Out through a doorway it comes back.
    const fk = (this.fpK = damp(this.fpK || 0, this.flying || this.mazeAround(me) ? 1 : 0, 9, dt));
    c.yaw -= dx;
    // Flying: straight up and straight down are ways to go too.
    c.pitch = this.flying ? clamp(c.pitch + dy, -1.5, 1.5) : clamp(c.pitch + dy, -0.6 * ak - 0.3 * (1 - ak) - 0.75 * fk * (1 - ak), 1.25);
    // Only a real look holds the camera follow back. A hand resting on the mouse or a thumb resting on the screen sends tiny
    // moves all the time, and counting those, the follow would hardly ever get a turn. They go both ways, so they cancel out.
    const lookFade = Math.exp(-dt * 3);
    this.lookX = clamp((this.lookX || 0) * lookFade + dx, -0.06, 0.06);
    this.lookY = clamp((this.lookY || 0) * lookFade + dy, -0.06, 0.06);
    // A thumb that has really dragged the camera keeps it until it is lifted, however slowly it moves.
    if (((dx || dy) && Math.hypot(this.lookX, this.lookY) > 0.03) || app.input.camHeld()) this.camTouched = T;
    if (!this.flying) this.assistCamera(dt, T, ak);
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
    const ek = Math.max(sk, fk);
    if (ek > 0.01) {
      const ex = me.x - ox * 0.18, ey = me.y + 1.02 - oy * 0.18, ez = me.z - oz * 0.18;
      cam.position.set(cam.position.x + (ex - cam.position.x) * ek, cam.position.y + (ey - cam.position.y) * ek, cam.position.z + (ez - cam.position.z) * ek);
      cam.lookAt(cam.position.x - ox * 6, cam.position.y - oy * 6, cam.position.z - oz * 6);
    }
    if (ek >= 0.72) { myRig.g.visible = false; this.hidMe = true; } else if (this.hidMe) { myRig.g.visible = true; this.hidMe = false; }
    let fov = (66 + clamp(-me.vy - 12, 0, 20) * 0.5) * (1 - ak) + aimFov * ak;
    fov += (74 - fov) * fk * (1 - ak);
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = damp(cam.fov, fov, 4 + (zoomed ? 12 : 0), dt); cam.updateProjectionMatrix(); }

    // Weather, sky and sound.
    const zi = zoneAt(this.L, me.y), zone = this.L.zones[zi];
    const last = this.L.zones[this.L.zones.length - 1];
    const eye = clamp((me.y - last.y0) / (this.L.top - last.y0), 0, 1);
    // The map's event where I am (none inside a maze garden): the storm's gust blows the weather about, the rest is drawn
    // by app.evfx.
    const indoor = !!this.mazeAround(me), ev = indoor || this.flying ? null : this.storm.event(T, zi), gust = ev && ev.kind === 'gust' ? ev : null;
    R.indoor = indoor;
    this.wind.x = this.wind.z = 0;
    if (gust && gust.on) {
      const r = Math.hypot(me.x, me.z) || 1;
      this.wind.x = gust.radial ? (me.x / r) * gust.str : (-me.z / r) * gust.sign * gust.str;
      this.wind.z = gust.radial ? (me.z / r) * gust.str : (me.x / r) * gust.sign * gust.str;
    }
    if (app.evfx) {
      for (const m of app.evfx.frame(T, dt, this.storm, ev, me.y - PR, me.x, me.z, [this.evMarks, ...this.evOther.values()], [this.bees, ...this.beesOther.values()])) {
        const cd = Math.hypot(cam.position.x - m.x, cam.position.y - m.y, cam.position.z - m.z);
        if (cd < 70) { if (m.kind === 'laser') app.sound.zap(); else app.sound.thunder(4 + cd * 0.4); }
      }
    }
    // The swarm after me buzzes louder the closer it gets.
    const B = this.bees;
    if (B && !B.gone && (this.buzzT = (this.buzzT || 0) - dt) <= 0) {
      const bd = Math.hypot(me.x - B.x, me.y - B.y, me.z - B.z);
      this.buzzT = 0.38;
      if (bd < 14) app.sound.buzz(1 - bd / 14);
    }
    // The quake shakes the view at each shock, and rumbles.
    if (ev && ev.kind === 'quake' && ev.on) {
      let q = 0;
      for (let i = 0; i < QUAKE_AT.length; i++) {
        q = Math.max(q, Math.exp(-Math.abs(ev.u - QUAKE_AT[i]) * 7));
        if (ev.u >= QUAKE_AT[i] && this.quakeHeard !== ev.k * 10 + i) { this.quakeHeard = ev.k * 10 + i; app.sound.thunder(6); app.ui.haptic('heavy'); }
      }
      cam.position.x += (Math.random() - 0.5) * 0.22 * q; cam.position.y += (Math.random() - 0.5) * 0.22 * q; cam.position.z += (Math.random() - 0.5) * 0.22 * q;
    }
    R.update(dt, cam.position, zone, eye, this.wind);
    R.shadowFocus(me.x, me.y, me.z);
    this.bgBolt -= dt;
    if (this.bgBolt <= 0 && this.L.mapKey === 'storm' && !indoor && !this.flying) {
      this.bgBolt = (2 + Math.random() * 7) * (1 - zi * 0.08) * (1 + eye * 3);
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 260;
      R.bolt(me.x + Math.cos(a) * r, Math.max(0, me.y - 60 + Math.random() * 50), me.z + Math.sin(a) * r, 2.2);
      app.sound.thunder(r);
    }
    const roar = ev && (ev.kind === 'gust' || ev.kind === 'wave') ? (ev.on ? 0.8 : ev.warn * 0.4) : 0;
    app.sound.ambient(0.2 + (me.y / this.L.top) * 0.6 + roar, me.reel > 0.05 && app.input.btn.reel, me.charge,
      this.L.mapKey === 'storm' ? 1 - eye * 0.8 : 0, this.L.mapKey === 'waterfall' ? 1 : 0);
    app.view.camPos = cam.position;
    app.view.lavaY = this.lavaY;
    // One step back in time, the same moment the climber is drawn at: standing on a moving platform stays exact.
    app.view.update(T - STEP, dt, this.storm, this.alpha ?? 1);
    // Moved by the team (teleport), coins can't be picked up on this climb any more: then none are shown either.
    if (!this.tped) app.pool.coins.update(dt, T, this.L.coins, this.coinTaken, cam.position.x, cam.position.y, cam.position.z, this.coinB);
    else if (app.pool.coins.mesh.visible) app.pool.coins.clear();
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
      this.relicAim = null;
      let aimD = Infinity;
      for (const r of this.L.relics) {
        if (hasRelic(r.id) || !this.relicHere(r)) continue;
        if (Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z) < 80) this.nearRelic = r;
        // The marker on the screen points at the gate, and once you are on the course at the relic.
        const q = r.gate && this.onCourse !== r.i ? r.gate : r, d = Math.hypot(q.x - me.x, q.y - me.y, q.z - me.z);
        if ((Math.abs(q.y - me.y) < 45 || this.onCourse === r.i) && d < aimD) { aimD = d; this.relicAim = { x: q.x, y: q.y, z: q.z, kind: r.kind, d }; }
      }
      const z0 = this.zaps.get(this.slot), th0 = this.storm.thunder(T, this.slot);
      app.ui.hud(this, { T, zone: zi, ev, thunder: th0 && !this.flying && !(z0 && z0.k === th0.k && z0.struck) && !this.mazeAround(me) ? th0 : null });
    }
    // Crosshair turns red over a target (checked ~12 times a second while aiming).
    if (this.aiming) {
      this.aimAcc = (this.aimAcc || 0) + dt;
      if (this.aimAcc > 0.08) { this.aimAcc = 0; const seen = this.aimHit(T); this.aimHot = !!seen.kind; this.aimDist = seen.t; }
    } else this.aimHot = false;
    app.ui.cross(this.aiming && ak > 0.5 && !gunNow.scope, this.aimHot);
    if (app.ui.scope) app.ui.scope(sk > 0.7, this.aimHot, this.aimDist);
    app.ui.tags(this);
    app.ui.tips(this);
    if (app.ui.nav) app.ui.nav(this);
    if (app.ui.foes) app.ui.foes(this);
    if (app.ui.relicMark) app.ui.relicMark(this);
    if (app.ui.hearts) app.ui.hearts(this);
  }

  // The maze garden a climber is inside, under its roof (the doorways too), or null.
  mazeAround(b) {
    const feet = b.y - PR;
    for (const m of this.L.mazes || []) {
      if (feet < m.y - 0.8 || feet > m.y + MAZE_WALL_H - 0.3) continue;
      const ex = b.x - m.x, ez = b.z - m.z;
      if (Math.abs(ex * m.fx + ez * m.fz) < m.half + 0.05 && Math.abs(ex * m.nx + ez * m.nz) < m.half + 0.05) return m;
    }
    return null;
  }

  // Camera assist: while you run and leave the camera alone, it swings round behind you. Aim assist:
  // while aiming, the crosshair is pulled gently onto a target that is already close to it.
  assistCamera(dt, T, ak) {
    const S = this.app.settings, c = this.cam, me = this.me;
    // Follow strength (Settings, 0 off to 2): how fast it turns, and how far behind you it goes.
    const F = S.camFollow ?? 1;
    // Bouncing between walls the speed flips side to side every moment: the camera stays still until you are out.
    // (Only a kick since the last respawn: the climber's clock starts again at 0 then.)
    const bouncing = me.kickT !== undefined && me.time >= me.kickT && me.time - me.kickT < 0.9;
    // Through the eyes in a maze garden: level, looking a little down at the way ahead.
    const pitchTo = (this.fpK || 0) > 0.5 ? 0.1 : 0.32;
    if (F > 0.01 && !this.aiming && !me.hook && !bouncing && T - (this.camTouched || -9) > 0.9 - Math.min(F, 2) * 0.2) {
      const sp = Math.hypot(me.vx, me.vz);
      if (sp > 1.5) {
        let e = Math.atan2(-me.vx, -me.vz) - c.yaw;
        e = Math.atan2(Math.sin(e), Math.cos(e));
        // Running straight at the camera: leave it, so it never whips round. (Checked before the next line, or weak settings
        // would turn it after all, and with the controls following the camera you would run in circles.)
        // How far round it goes: weak settings only turn part of the way.
        // Through the eyes in a maze garden it doesn't turn at all: the view is yours there, and turning it after every slide
        // along a wall made it jerk about while you looked round.
        const own = Math.max(0, 1 - (this.fpK || 0) * 1.5);
        if (Math.abs(e) < 2.4 && own > 0) c.yaw += e * own * Math.min(1, 0.35 + F * 0.65) * Math.min(1, dt * 1.6 * F) * Math.min(1, sp / 5);
        c.pitch += (pitchTo - c.pitch) * Math.min(1, dt * 0.8 * F);
      }
    }
    const A = S.aimHelp ?? 0.5;
    if (A < 0.01 || !this.aiming || ak < 0.5) return;
    const cam = this.R.camera, o = cam.position, L = this.L;
    cam.getWorldDirection(fwd);
    let best = null, bestA = 0.05 + A * 0.12;
    const consider = (x, y, z) => {
      const vx = x - o.x, vy = y - o.y, vz = z - o.z, d = Math.hypot(vx, vy, vz);
      if (d < 1 || d > Math.max(RANGE, this.gun.range)) return;
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
    if (this.app.evfx) this.app.evfx.clear();
    this.R.indoor = false;
    this.robots.clear();
    this.links = [];
    this.s.close();
  }
}
