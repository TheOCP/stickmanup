// Reruns climbs, away from the part of the server that answers people. Fed one chunk of a climb at a time, it plays the
// recorded sticks and buttons through the game's own physics (./sim, copied from the game by dev/makesim.mjs), and says
// what really happened: which coins were reached, whether the top was, and where the phone's story stopped matching.
// It never touches the database. The server hands it the history when it needs it (after a restart, say).
import './sim/env.js';
import zlib from 'node:zlib';
import { parentPort } from 'node:worker_threads';
import { generateLevel, MAPS, secretOn, applyMaze } from './sim/level.js';
import { World } from './sim/physics.js';
import { Game } from './sim/game.js';
import * as cloud from './sim/cloud.js';
import * as profile from './sim/profile.js';
import { PR } from './sim/player.js';
import { weaponOf } from './sim/weapons.js';

const STEP = 1 / 60;
const Q = 32767, PQ = 1024;
const MAX_LIVE = 64;
// A phone matches to the last bit. These only allow for something odd without calling anyone names.
const NEAR = 0.02;     // metres: counts as a perfect match
// Being out of step now and then proves nothing, however long a climb goes on: each second in step wins some room back. A hack
// is out of step every second, and uses all of it up in a few seconds.
const SLIP_LIMIT = 8;
const SLIP_BACK = 1 / 30;
const FAR = 25;        // metres: further out than this, it may be a teleport
const MAX_MOVE = 70;   // metres a second: nothing in the game moves a climber faster
const SAVE_SLACK = 3;  // metres: the rerun can be this much out of step at the moment of a save
const SHOT_BURST = 4;  // shots ahead of a weapon's rate, for a phone that stutters
const SHOT_SLACK = 25; // metres: a shot starts from a camera a little behind the climber
const GRAPPLE_REACH = 12.5;

// Everything that only makes noise or pictures: any property, any call, any number, and nothing happens.
const nothing = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing),
  set: () => true,
  apply: () => nothing,
  has: () => true,
});

const levels = new Map();
function levelOf(map) {
  let e = levels.get(map);
  if (!e) {
    // With a hundred and more maps only the few played lately are kept built.
    while (levels.size >= 16) levels.delete(levels.keys().next().value);
    const L = generateLevel(map);
    e = { L, W: new World(L.cols) };
  } else levels.delete(map);
  levels.set(map, e);
  return e;
}

// Stands in for the network. Alone, it does what a host does, because the phone did too. With others, what came from them
// is in the recording, so it just listens.
class FakeSession {
  constructor(mode, slot, roster) {
    this.mode = mode;
    this.slot = slot;
    this.isHost = mode === 'solo';
    this.name = '';
    this.link = null;
    this.h = {};
    this.players = new Map();
    for (const s of roster) this.players.set(s, { slot: s, name: '', color: null, look: null, samples: [] });
    if (!this.players.has(slot)) this.players.set(slot, { slot, name: '', color: null, look: null, samples: [] });
  }
  on(k, f) { this.h[k] = f; return this; }
  emit(k, ...a) { if (this.h[k]) return this.h[k](...a); return undefined; }
  now() { return 0; }
  toHost(e) { if (this.isHost) this.emit('hostEvent', e, this.slot); }
  toAll(e) { if (this.isHost) this.emit('event', e); }
  toSlot(s, e) { if (this.isHost && s === this.slot) this.emit('event', e); }
  hostState() {}
  sendState() {}
}

function makeGame(run, head) {
  const { L, W } = levelOf(run.map);
  const secrets = L.cols.filter((c) => c.kind === 'secret');
  const app = {
    level: L, world: W, renderer: nothing, ui: nothing, sound: nothing, fx: nothing, input: nothing, settings: {}, finish: () => {},
    pool: { robots: [nothing, nothing, nothing, nothing], ropes: [nothing, nothing, nothing], jumpers: [] },
    view: new Proxy({ setSecrets(sec) { for (const c of secrets) c.on = secretOn(c, sec); } }, { get: (t, k) => t[k] || nothing }),
  };
  const roster = Array.isArray(head.roster) && head.mode !== 'solo' ? head.roster.filter((s) => Number.isInteger(s) && s >= 0 && s < 8).slice(0, 8) : [0];
  const s = new FakeSession(head.mode === 'solo' ? 'solo' : 'replay', head.mode === 'solo' ? 0 : head.slot | 0, roster);
  const g = {
    map: run.map, diff: run.diff, rules: run.rules, t0: 0, base: head.t, cp: head.cp | 0, falls: head.falls | 0, mz: head.mz | 0,
    doors: Array.isArray(head.doors) ? head.doors : [], stuns: Array.isArray(head.stuns) ? head.stuns : [],
    pos: Array.isArray(head.pos) && head.pos.every(Number.isFinite) ? { [s.slot]: head.pos } : null,
    noCord: !!head.noCord, pcp: head.pcp || {}, loose: Array.isArray(head.loose) ? head.loose : [],
    rest: head.mode === 'solo' && Array.isArray(head.rest) ? head.rest : null,
  };
  const game = new Game(app, s, g);
  game.simT = head.t;
  // The phone's own clock is only used for pictures and for choosing when to save. Physics time decides everything here.
  Object.defineProperty(game, 'time', { get() { return this.simT; } });
  game.save = () => {};
  game.noteRun = () => {};
  // Flying goes where the camera looks, which isn't written down. Where it ended is (act 'f').
  game.flyStep = () => {};
  game.coinTaken = new Set(Array.isArray(head.coins) ? head.coins : []);
  const live = {
    run, game, tick: 0, soft: 0, tainted: false, last: null, snapSeq: head.saves | 0, relics: new Set(), crumb: null, lastT: head.t, lastShot: -99, guns: new Set(),
    kicks: [], partners: null, pIdx: 0, stepNo: 0, coins: [], relicsNew: [], win: null, flags: [], h: 0, maxCp: head.cp | 0,
    op: {}, otherPool: [], kickCount: 0,
  };
  for (const r of head.foundRelics || []) live.relics.add(r);
  if (head.mode !== 'solo') {
    // Where others were comes from the recording, and so does whatever they did to this climber.
    game.partnerAt = (slot, op) => partnerAt(live, slot, op);
    game.jumpHits = () => {
      for (const k of live.kicks) game.zapKnock(k[0], k[1], k[2], 'kick', k[3] || 'kick');
      live.kicks.length = 0;
    };
    game.jumpAI = () => {};
  }
  return live;
}

function partnerAt(live, slot, op) {
  const p = live.partners;
  if (!p) return null;
  for (let i = live.pIdx; i < p.length && p[i] === live.stepNo; i += 9) {
    if (p[i + 1] !== 0 || p[i + 2] !== slot) continue;
    op.x = p[i + 3] / PQ; op.y = p[i + 4] / PQ; op.z = p[i + 5] / PQ; op.vy = p[i + 6] / PQ; op.reel = p[i + 7] / PQ; op.flags = p[i + 8];
    live.lastPartner = op;
    return op;
  }
  return null;
}

function othersFor(live) {
  const g = live.game, out = g.others, p = live.partners;
  out.length = 0;
  if (!p || g.noCord) return;
  let n = 0;
  for (let i = live.pIdx; i < p.length && p[i] === live.stepNo; i += 9) {
    if (p[i + 1] !== 1) continue;
    const o = live.otherPool[n] || (live.otherPool[n] = {});
    n++;
    o.x = p[i + 3] / PQ; o.y = p[i + 4] / PQ; o.z = p[i + 5] / PQ;
    out.push(o);
  }
}

// ---------------------------------------------------------------- the shared level
// Several climbs of one map share its level in here, so floors that crumbled, doors that opened and maze walls are put back per climb.
function swapIn(live) {
  const g = live.game, L = g.L;
  for (const d of L.doors) d.col.on = !g.doors.has(d.i);
  L.crumbles.forEach((c, i) => {
    const s = live.crumb && live.crumb[i];
    c.crumble.st = s ? s[0] : 0;
    c.crumble.t = s ? s[1] : 0;
    c.on = s ? s[2] : true;
  });
  for (const c of L.cols) if (c.kind === 'secret') c.on = secretOn(c, g.storm.sec);
  // The maze gardens stand the way this climb last left them.
  if (L.mazes && L.mazes.length) applyMaze(L, g.mz | 0);
  g.W.setTime(live.lastT);
  profile.sink.relics = live.relics;
  cloud.sink.coin = (i) => { live.coins.push(i); };
  cloud.sink.relic = (id) => { live.relicsNew.push(id); };
  cloud.sink.win = (falls) => { if (!live.win) live.win = { falls: Number.isFinite(falls) ? falls : 1 }; };
}
function swapOut(live) {
  live.crumb = live.game.L.crumbles.map((c) => [c.crumble.st, c.crumble.t, c.on]);
}

// ---------------------------------------------------------------- reading a chunk
function unpack(b64) {
  const raw = zlib.inflateRawSync(Buffer.from(b64, 'base64'), { maxOutputLength: 8 * 1024 * 1024 });
  const textLen = raw.readUInt32LE(0), n = raw.readUInt32LE(4), pn = raw.readUInt32LE(8);
  if (n > 20000 || pn > 2000000 || 12 + textLen + n * 9 + pn * 4 !== raw.length) throw new Error('bad size');
  const meta = JSON.parse(raw.subarray(12, 12 + textLen).toString('utf8'));
  if (!Array.isArray(meta.acts) || !Array.isArray(meta.samples)) throw new Error('bad parts');
  const base = 12 + textLen;
  const cols = [0, 1, 2, 3].map((k) => {
    const out = new Int16Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) { v = (v + raw.readInt16LE(base + (k * n + i) * 2)) << 16 >> 16; out[i] = v; }
    return out;
  });
  const bits = raw.subarray(base + n * 8, base + n * 9);
  let partners = null;
  if (pn) {
    if (pn % 9) throw new Error('bad partners');
    partners = new Int32Array(pn);
    for (let i = 0; i < pn; i++) partners[i] = raw.readInt32LE(base + n * 9 + i * 4);
  }
  return { n, meta, cols, bits, partners };
}

// ---------------------------------------------------------------- why it doesn't match, in words
const m1 = (v) => Math.round(v * 10) / 10;
// Whether the phone's own climber jumped: further since it last said where it was than anything in the game can go, and not
// back to a checkpoint it has reached, which gains nothing. Otherwise it is the rerun that got out of step.
function jumped(live, s) {
  const l = live.last, g = live.game;
  if (!l) return true;
  if (Math.hypot(s[1] - l[1], s[2] - l[2], s[3] - l[3]) <= MAX_MOVE * Math.max(STEP, (s[0] - l[0]) * STEP)) return false;
  const top = Math.max(live.maxCp, g.cp);
  for (const c of g.L.cps) if (c.i <= top && Math.hypot(s[1] - c.x, s[2] - c.y, s[3] - c.z) < 5) return false;
  return true;
}
function explain(live, s) {
  const me = live.game.me, l = live.last, at = Math.round(live.game.simT);
  const dx = s[1] - me.x, dy = s[2] - me.y, dz = s[3] - me.z, off = Math.hypot(dx, dy, dz), side = Math.hypot(dx, dz);
  const dt = l ? Math.max(STEP, (s[0] - l[0]) * STEP) : 1;
  const phoneSide = l ? Math.hypot(s[1] - l[1], s[3] - l[3]) / dt : 0, physSide = l ? Math.hypot(me.x - l[1], me.z - l[3]) / dt : 0;
  const phoneUp = l ? (s[2] - l[2]) / dt : 0, physUp = l ? (me.y - l[2]) / dt : 0;
  const where = `at ${at} s, ${m1(me.y - PR)} m up`;
  if (off > FAR && jumped(live, s)) return { kind: 'teleport', score: 60, detail: `Teleported: the phone says it is ${m1(off)} m from where the physics put it, ${where}.` };
  if (dy > 0.25 && dy >= side) return { kind: 'fly', score: 50, detail: `Jump or fly hack: went ${m1(dy)} m higher than the physics allows (rising ${m1(phoneUp)} m/s where the physics says ${m1(physUp)} m/s), ${where}.` };
  if (side > 0.25 && phoneSide > physSide) return { kind: 'speed', score: 50, detail: `Speed hack: moving ${m1(phoneSide)} m/s where the physics says ${m1(physSide)} m/s, ${where}.` };
  if (dy < -0.25 && dy <= -side) return { kind: 'gravity', score: 10, detail: `Falling faster than the physics says: ${m1(-dy)} m lower, ${where}.` };
  return { kind: 'physics', score: 15, detail: `The climb does not match the physics: ${m1(off)} m off, ${where}.` };
}

function compare(live, s) {
  const me = live.game.me;
  if (!Array.isArray(s) || s.length < 7 || !s.every(Number.isFinite)) {
    live.flags.push({ kind: 'bad', score: 20, detail: 'The climb recording is broken in a way the game cannot produce.' });
    live.tainted = true;
    return;
  }
  const off = Math.hypot(s[1] - me.x, s[2] - me.y, s[3] - me.z);
  if (off <= NEAR) {
    live.soft = Math.max(0, live.soft - SLIP_BACK);
    live.last = s;
    return;
  }
  const f = explain(live, s);
  live.soft += off < 1 ? 1 : off < 5 ? 2 : 3;
  if (f.kind === 'teleport' || live.soft > SLIP_LIMIT) {
    live.flags.push(f);
    live.tainted = true;
    return;
  }
  // A slip: pick up from where the phone is, and let the next second tell.
  me.x = s[1]; me.y = s[2]; me.z = s[3]; me.vx = s[4]; me.vy = s[5]; me.vz = s[6];
  live.last = s;
}

// ---------------------------------------------------------------- actions between steps
function bad(live, kind, score, detail) {
  live.flags.push({ kind, score, detail });
  live.tainted = true;
}

// A shot on its way, by the weapon it says it came from: not faster than that weapon fires, over several shots. A phone that
// stutters fires by its own clock, so one pair of shots can be close together in physics time. Shots in the same step are the
// same blast. Which weapons were used goes back to be checked against what this player owns.
function shotInTime(live, gun) {
  const t = live.game.simT;
  live.guns.add(gun.id);
  if (t === live.lastShot) return true;
  live.shots = Math.min(SHOT_BURST, (live.shots ?? SHOT_BURST) + Math.max(0, t - live.lastShot) / (gun.rate * 0.8)) - 1;
  live.lastShot = t;
  return live.shots >= 0;
}

function snapshot(live) {
  const g = live.game, m = g.me;
  return { seq: ++live.snapSeq, t: g.simT, rest: g.rest, cp: g.cp, falls: g.falls, mz: g.mz, doors: [...g.doors], pos: [m.x, m.y + 0.3, m.z], coins: [...g.coinTaken], stuns: [...g.storm.stun].map(([k, v]) => [k, v.from, v.until]), foundRelics: [...live.relics], tick: live.tick };
}

function act(live, a, snaps, quiet) {
  const g = live.game, me = g.me, L = g.L, solo = g.solo;
  switch (a[1]) {
    case 's':
      // SHIELD works on Storm Tower and in the Wild Forest (game.js SHIELD_MAPS).
      if ((L.mapKey !== 'storm' && L.mapKey !== 'forest') || !me.raiseShield()) live.soft++;
      break;
    case 'g': {
      const anchor = L.anchors[a[2]];
      if (!anchor) return bad(live, 'grapple', 40, 'Grappled a hook that does not exist.');
      const d = Math.hypot(anchor.x - me.x, anchor.y - me.y, anchor.z - me.z);
      // The button goes by what was in reach a moment ago, and the climber may be falling fast past it.
      if (d > GRAPPLE_REACH + 1 + Math.hypot(me.vx, me.vy, me.vz) * 0.4) return bad(live, 'grapple', 40, `Grappled a hook ${m1(d)} m away. The reach is 12.5 m.`);
      me.grapple(anchor);
      break;
    }
    case 'h': me.hop(); break;
    case 'r': if (solo) g.hostEvent({ k: 'restart' }, 0); break;
    // The team reset this checkpoint: back to the start. Nothing to gain from it, so it needs no checking.
    case 'x': if (solo) g.hostEvent({ k: 'resetcp' }, 0); break;
    case 't': {
      const t = a[2];
      if (!Number.isFinite(t)) return bad(live, 'bad', 20, 'The climb recording has an impossible time in it.');
      if (solo && t < g.simT - 0.5) return bad(live, 'time', 40, `Went back in time by ${m1(g.simT - t)} s.`);
      g.simT = t;
      break;
    }
    case 'd': {
      if (!solo) break;
      const d = L.doors[a[2]];
      if (!d) return bad(live, 'door', 30, 'Opened a door that does not exist.');
      const far = Math.hypot(d.bx - me.x, d.by - me.y, d.bz - me.z), gun = weaponOf(a[3]);
      if (far > gun.range + gun.blast + SHOT_SLACK) return bad(live, 'door', 30, `Shot a door button from ${m1(far)} m away with the ${gun.name}.`);
      if (!shotInTime(live, gun)) return bad(live, 'door', 20, `Shooting faster than the ${gun.name} can.`);
      g.hostEvent({ k: 'door', i: a[2] }, 0);
      break;
    }
    case 'n': {
      if (!solo) break;
      const m = a[2], from = a[3], until = a[4], gun = weaponOf(a[5]);
      if (!Number.isFinite(from) || !Number.isFinite(until) || until - from > gun.stun + 0.01 || until < from || Math.abs(from - g.simT) > 1) return bad(live, 'stun', 30, `Paralysed something for longer than the ${gun.name} can.`);
      if (!shotInTime(live, gun)) return bad(live, 'stun', 20, `Shooting faster than the ${gun.name} can.`);
      g.storm.stun.set(m, { from, until });
      break;
    }
    case 'v': {
      const s = snapshot(live);
      if (!quiet) snaps.push(s);
      break;
    }
    case 'k': {
      if (solo) break;
      if (++live.kickCount > 4 + live.tick / 30) return bad(live, 'kick', 20, 'Kicked far more often than the jumpers can.');
      const j = L.jumpers[a[2]];
      if (!j || Math.hypot(j.x - me.x, j.y - me.y, j.z - me.z) > 60) return bad(live, 'kick', 30, 'Knocked by a jumper that is nowhere near.');
      live.kicks.push([a[3], a[4], a[5], String(a[6] || '').slice(0, 24)]);
      break;
    }
    case 'R': {
      if (solo || !Array.isArray(a[2])) break;
      const slots = a[2].filter((s) => Number.isInteger(s) && s >= 0 && s < 8).slice(0, 8);
      for (const s of [...g.s.players.keys()]) if (!slots.includes(s) && s !== g.slot) g.s.players.delete(s);
      for (const s of slots) if (!g.s.players.has(s)) g.s.players.set(s, { slot: s, name: '', color: null, look: null, samples: [] });
      g.syncRoster();
      break;
    }
    case 'f': {
      // Vanished: flying, or back from it. Whether this player may fly goes back to the server to check, and nothing a phone
      // says about a flight it isn't allowed gets past that.
      live.flew = true;
      g.setFlying(!!a[2]);
      if (a[2]) break;
      if (![a[3], a[4], a[5]].every(Number.isFinite)) return bad(live, 'bad', 20, 'The climb recording is broken in a way the game cannot produce.');
      me.spawn(a[3], a[4], a[5]);
      if (Number.isInteger(a[6]) && L.cps[a[6]]) { g.cp = a[6]; live.maxCp = Math.max(live.maxCp, a[6]); }
      live.last = [live.tick, a[3], a[4], a[5], 0, 0, 0];
      break;
    }
    case 'e': if (!solo) return event(live, a[2]);
      break;
    case 'm':
      // The team's checkpoint, in the host's regular update. Believed if the climber could be part of it.
      if (solo || !Number.isInteger(a[2]) || !L.cps[a[2]]) break;
      g.cp = a[2];
      if (nearCp(live, L.cps[a[2]])) live.maxCp = Math.max(live.maxCp, a[2]);
      break;
  }
  return undefined;
}

// Someone on the cord can be a long way from where the team's checkpoint was reached, and a phone can lag. Not across the map.
function nearCp(live, c) {
  const g = live.game, me = g.me, reach = g.rope * 3 + 45;
  if (Math.hypot(me.x - c.x, me.y - c.y, me.z - c.z) < reach) return true;
  const l = live.lastPartner;
  return !!l && Math.hypot(l.x - c.x, l.y - c.y, l.z - c.z) < reach;
}

// What others sent this climber, checked against what they could have done.
function event(live, e) {
  const g = live.game, L = g.L, me = g.me;
  if (!e || typeof e !== 'object') return bad(live, 'bad', 20, 'The climb recording is broken in a way the game cannot produce.');
  switch (e.k) {
    case 'respawn': {
      const at = e.at ?? e.cp;
      if (!Number.isInteger(at) || !L.cps[at]) return bad(live, 'respawn', 30, 'Sent back to a checkpoint that does not exist.');
      // Only what happens to this climber counts: someone else on their own checkpoint, or a team going back while this
      // one is still catching up, moves nothing here.
      if (e.only === g.slot || ((e.only === null || e.only === undefined) && !g.loose.has(g.slot))) {
        // A phone left behind by its team looks just like this. It stops counting, and nobody gets called anything.
        if (at > live.maxCp) { live.tainted = true; return undefined; }
        // Sent along a hidden course: to one of its markers, or back to where it starts.
        const course = e.rest !== undefined, ok = course && Array.isArray(e.rest) && Number.isInteger(e.rest[0]) && Number.isInteger(e.rest[1]) ? g.coursePos(e.rest[0], e.rest[1], g.slot) : null;
        if (course && !ok) return bad(live, 'respawn', 30, 'Sent to a course marker that does not exist.');
        const want = ok || g.spawnPos(at, g.slot), p = e.pos && e.pos[g.slot];
        if (p && Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) > 0.5) return bad(live, 'respawn', 60, 'Respawned somewhere other than the checkpoint: a teleport.');
      }
      g.onEvent(e);
      break;
    }
    case 'cp': {
      const c = Number.isInteger(e.i) && L.cps[e.i];
      if (!c) return bad(live, 'respawn', 30, 'Reached a checkpoint that does not exist.');
      if (e.slot === g.slot || (e.slot === undefined && !g.loose.has(g.slot))) {
        // The same: a phone that was left behind. The climb stops counting.
        if (!nearCp(live, c)) { live.tainted = true; return undefined; }
        if (e.i > live.maxCp) live.maxCp = e.i;
      }
      g.onEvent(e);
      break;
    }
    case 'sling': {
      const v = e.v;
      if (e.to === g.slot) {
        if (!Array.isArray(v) || !v.every(Number.isFinite) || Math.hypot(v[0], v[2]) > 9.5 || v[1] > 15.5 || v[1] < 0) return bad(live, 'sling', 50, 'Thrown by a partner harder than the cord can throw.');
        if (++live.kickCount > 4 + live.tick / 30) return bad(live, 'sling', 20, 'Thrown far more often than partners can.');
      }
      g.onEvent(e);
      break;
    }
    case 'win': {
      // The summit counts for the team, but someone has to be near it. Here that is checked on this climber, or the partner on the cord.
      const l = live.lastPartner;
      const close = (b) => Math.hypot(b.x, b.z) < L.summit.r + g.rope * 3 && b.y > L.top - g.rope * 4;
      // Without the cord, or still catching up, someone else got there. The climb ends, and game.js finish pays this one nothing.
      if (!close(me) && (g.noCord || g.loose.has(g.slot))) { g.onEvent(e); break; }
      if (!close(me) && !(l && close(l))) {
        // With nobody on the cord it can only be made up. With someone, this phone may just have been left behind.
        if (!l) return bad(live, 'win', 60, `Claimed the top from ${m1(L.top - me.y)} m below it.`);
        live.tainted = true;
        return undefined;
      }
      g.onEvent(e);
      break;
    }
    case 'ff': {
      const v = e.v;
      if (e.to === g.slot) {
        if (!g.rules || g.rules.ff !== 1) return bad(live, 'ff', 40, 'Shot by a friend in a game without friendly fire.');
        if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite) || Math.hypot(v[0], v[1], v[2]) > 62) return bad(live, 'ff', 50, 'Thrown by a friend harder than any weapon can.');
        if (++live.kickCount > 4 + live.tick / 30) return bad(live, 'ff', 20, 'Thrown by friends far more often than weapons can.');
      }
      g.onEvent(e);
      break;
    }
    case 'crumble': case 'door': case 'stun':
      g.onEvent(e);
      break;
    case 'loose': {
      // Caught up with the team: their checkpoint counts as reached too, if this climber is anywhere near that high.
      const was = g.loose.has(g.slot);
      g.onEvent(e);
      if (was && !g.loose.has(g.slot) && Number.isInteger(e.cp) && L.cps[e.cp] && L.cps[e.cp].y < me.y + g.rope * 3 + 45) live.maxCp = Math.max(live.maxCp, e.cp);
      break;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- playing it
function backFirst(live, acts, ai, s) {
  const me = live.game.me;
  if (Math.hypot(s[1] - me.x, s[2] - me.y, s[3] - me.z) <= NEAR) return false;
  for (let i = ai; i < acts.length && acts[i][0] <= live.tick; i++) if (acts[i][1] === 'e' && acts[i][2] && acts[i][2].k === 'respawn') return true;
  return false;
}

const inp = { mx: 0, mz: 0, fx: 0, fz: 0, jump: false, jumpPressed: false, dash: false, grab: false, reel: false };

function play(live, chunk, snaps, quiet) {
  const { n, meta, cols, bits, partners } = chunk, g = live.game;
  const acts = meta.acts.slice().sort((a, b) => a[0] - b[0]), samples = meta.samples;
  let ai = 0, si = 0, pi = 0;
  live.partners = partners;
  live.pIdx = 0;
  swapIn(live);
  try {
    const end = live.tick + n;
    for (let k = 0; k < n && !live.tainted; k++) {
      while (ai < acts.length && acts[ai][0] <= live.tick && !live.tainted) act(live, acts[ai++], snaps, quiet);
      if (live.tainted) break;
      live.stepNo = k;
      if (partners) {
        while (pi < partners.length && partners[pi] < k) pi += 9;
        live.pIdx = pi;
        othersFor(live);
      }
      inp.mx = cols[0][k] / Q; inp.mz = cols[1][k] / Q; inp.fx = cols[2][k] / Q; inp.fz = cols[3][k] / Q;
      const b = bits[k];
      inp.jump = !!(b & 1); inp.jumpPressed = !!(b & 2); inp.dash = !!(b & 4); inp.grab = !!(b & 8); inp.reel = !!(b & 16);
      g.step(inp);
      live.lastT = g.simT;
      live.tick++;
      const h = Math.round(g.me.y - PR - 2);
      if (g.me.grounded && h > live.h) live.h = h;
      while (si < samples.length && samples[si][0] < live.tick) si++;
      if (si < samples.length && samples[si][0] === live.tick) {
        const s = samples[si++];
        if (!g.flying) {
          // A host's own fall happens inside the step, so that phone had already gone back when it noted where it was.
          if (backFirst(live, acts, ai, s)) while (ai < acts.length && acts[ai][0] <= live.tick && !live.tainted) act(live, acts[ai++], snaps, quiet);
          if (!live.tainted) compare(live, s);
        }
      }
    }
    while (ai < acts.length && acts[ai][0] <= end && !live.tainted) act(live, acts[ai++], snaps, quiet);
    if (live.soft > SLIP_LIMIT && !live.tainted) {
      live.flags.push({ kind: 'physics', score: 15, detail: 'The climb keeps slipping from the physics.' });
      live.tainted = true;
    }
  } finally {
    swapOut(live);
  }
}

// ---------------------------------------------------------------- the climbs being watched
const lives = new Map();
function remember(id, live) {
  lives.delete(id);
  lives.set(id, live);
  while (lives.size > MAX_LIVE) lives.delete(lives.keys().next().value);
}

function freshGame(run, chunk) {
  const head = chunk.meta.head;
  if (!head || typeof head !== 'object') throw new Error('no start');
  if (head.mode === 'solo') {
    // A climb alone starts at the bottom, or from what the server itself saw at a save.
    const from = run.snapshot;
    if (from) return makeGame(run, { mode: 'solo', slot: 0, t: from.t, cp: from.cp, falls: from.falls, mz: from.mz, doors: from.doors, pos: from.pos, coins: from.coins, stuns: [], foundRelics: from.foundRelics, saves: from.seq });
    return makeGame(run, { mode: 'solo', slot: 0, t: 0, cp: 0, falls: 0, doors: [], pos: null, coins: [], stuns: [], saves: 0 });
  }
  return makeGame(run, { mode: head.mode, slot: head.slot, roster: head.roster, t: Number.isFinite(head.t) ? head.t : 0, cp: head.cp, falls: head.falls, mz: head.mz, doors: head.doors, pos: head.pos, coins: head.coins, stuns: head.stuns, noCord: head.noCord, pcp: head.pcp, loose: head.loose, saves: 0 });
}

function handle(m) {
  let live = lives.get(m.run.id);
  const first = m.seq === m.segment;
  if (first) live = null;
  if (!live && !first) {
    // Not in memory any more: play the climb so far again, from the history the server keeps.
    if (!m.history) return { miss: true };
  }
  if (m.history) {
    live = null;
    for (const h of m.history) {
      const c = unpack(h);
      if (!live) live = freshGame(m.run, c);
      if (!live.tainted) play(live, c, [], true);
    }
    live.coins = []; live.relicsNew = []; live.win = null; live.flags = [];
  }
  if (m.data === null) {
    if (live) remember(m.run.id, live);
    return { tick: live ? live.tick : 0, coins: [], relics: [], win: null, flags: [], snaps: [], h: live ? live.h : 0, soft: live ? live.soft : 0 };
  }
  const c = unpack(m.data);
  if (!live) live = freshGame(m.run, c);
  if (c.meta.head && m.run.snapshot && c.meta.head.pos && live.tick === 0) {
    // What the phone resumed from has to be what the server saw.
    const a = c.meta.head.pos, b = m.run.snapshot.pos, off = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (off > SAVE_SLACK) live.flags.push({ kind: 'teleport', score: 60, detail: `Picked up a saved climb ${m1(off)} m from where it was saved: an edited save.` });
    if (off > SAVE_SLACK) live.tainted = true;
  }
  const snaps = [];
  if (!live.tainted) play(live, c, snaps, false);
  remember(m.run.id, live);
  const out = { tick: live.tick, simT: live.game.simT, coins: live.coins, relics: live.relicsNew, win: live.win, flags: live.flags, snaps, h: live.h, soft: live.soft, guns: [...live.guns], flew: !!live.flew, tainted: live.tainted, cp: live.game.cp, falls: live.game.falls };
  live.coins = []; live.relicsNew = []; live.win = null; live.flags = [];
  return out;
}

parentPort.on('message', (m) => {
  if (m.t === 'forget') { lives.delete(m.run); return; }
  let r;
  try {
    r = handle(m);
  } catch (e) {
    r = { error: String(e && e.message) };
  }
  parentPort.postMessage({ id: m.id, r });
});
parentPort.postMessage({ ready: true, maps: MAPS.length });
