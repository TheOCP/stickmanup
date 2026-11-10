// Multiplayer. A star network: clients talk only to the host, the host relays.
// Transports: a StickManUp server (WebSocket relay) and Online (PeerJS/WebRTC).
import { LEVEL_VERSION, DIFFS, mapDef } from './level.js';
import { validColor } from './colors.js';
import { cleanLook, cleanRole } from './skins.js';

// +3: the host can change mid climb (becomeHost), and a room keeps the checkpoints of those who left.
export const PROTO = LEVEL_VERSION * 100 + 3;
// A phone's key in a room (main.js roomKey), and how long the others have to come back to a new host.
const WHO = /^[A-Za-z0-9]{8,24}$/;
const MOVE_WAIT = 20000;
// The chat (chat.js): how much each phone keeps, how much a newcomer gets to read back, and how long one message may be.
const CHAT_KEEP = 60, CHAT_JOIN = 40, CHAT_LEN = 140;
// No line breaks, no control characters, no direction tricks that turn the text around.
const cleanSay = (t) => Array.from(String(t == null ? '' : t).slice(0, CHAT_LEN * 4).replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, CHAT_LEN).join('');
function cleanChat(m) {
  if (!m || typeof m !== 'object') return null;
  const t = cleanSay(m.t);
  if (!t) return null;
  return { s: slotOk(m.s), n: String(m.n || 'Climber').slice(0, 14), c: validColor(m.c), w: typeof m.w === 'string' && WHO.test(m.w) ? m.w : '', t, at: Number.isFinite(m.at) ? m.at : Date.now() };
}

// Whoever hosts a public room can be a complete stranger, and so can whoever joins yours. Nothing they send is believed:
// whatever can reach the screen or your records is checked here, the one place every way of playing passes through.
const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const num = (v) => (Number.isFinite(v) ? v : 0);
const inList = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
const slotOk = (v) => (Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS ? v : 0);
// Any map there is (level.js mapDef: the worlds, the generated ones and the holiday ones).
const mapOk = (v) => (mapDef(v) ? v : 0);
function cleanRoomRules(r) {
  const o = {};
  if (r && typeof r === 'object') for (const k of ['cps', 'haz', 'rope']) if (Number.isInteger(r[k]) && r[k] >= 0 && r[k] < DIFFS.length) o[k] = r[k];
  if (r && r.ff === 1) o.ff = 1;
  // Ghosts off for everyone (ghost.js) and traitor mode (traitor.js).
  if (r && r.ng === 1) o.ng = 1;
  if (r && r.tr === 1) o.tr = 1;
  return o;
}
function cleanLobby(l) {
  const x = l && typeof l === 'object' ? l : {};
  return { map: mapOk(x.map), diff: inList(x.diff, DIFFS), rules: cleanRoomRules(x.rules), noCord: !!x.noCord, resume: !!x.resume };
}
function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  return Object.assign(g, {
    map: mapOk(g.map), diff: inList(g.diff, DIFFS), rules: cleanRoomRules(g.rules), noCord: !!g.noCord, t0: num(g.t0), base: num(g.base), cp: count(g.cp), falls: count(g.falls), mz: count(g.mz),
    pcp: g.pcp && typeof g.pcp === 'object' ? g.pcp : {}, doors: Array.isArray(g.doors) ? g.doors : [], stuns: Array.isArray(g.stuns) ? g.stuns : [], pos: g.pos && typeof g.pos === 'object' ? g.pos : {}, loose: Array.isArray(g.loose) ? g.loose : [],
    left: g.left && typeof g.left === 'object' && !Array.isArray(g.left) ? g.left : {}, back: !!g.back,
    climb: typeof g.climb === 'string' && /^[a-z0-9]{6,24}$/.test(g.climb) ? g.climb : undefined,
  });
}
const PREFIX = 'stickmanup-v1-';
// Address finders for WebRTC. (The relay servers PeerJS used to list no longer exist.)
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

// Online play over WebRTC data channels; the public PeerJS server only introduces the phones.
class PeerLink {
  constructor() { this.conns = new Map(); this.early = []; this.canMove = true; }
  host(name, cb) {
    this.cb = cb;
    this.hosting = true;
    return new Promise((resolve) => {
      const attempt = (left) => {
        let code = '';
        for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
        const peer = (this.peer = new window.Peer(PREFIX + code, { debug: 0, config: { iceServers: ICE } }));
        peer.on('open', () => { this.code = code; resolve({ ok: true, code }); });
        peer.on('connection', (c) => this.wire(c));
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && left > 0) { peer.destroy(); attempt(left - 1); }
          else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') resolve({ ok: false, err: 'Could not reach the online server. Check your internet.' });
          else this.cb.error('Online error: ' + e.type);
        });
      };
      attempt(3);
    });
  }
  join(code, cb) {
    this.cb = cb;
    this.code = code.toUpperCase();
    const peer = (this.peer = new window.Peer({ debug: 0, config: { iceServers: ICE } }));
    const fail = setTimeout(() => this.cb.error('Could not connect. Some networks (often mobile data) block direct connections: ask the host to open a room on the game server.'), 15000);
    peer.on('open', () => this.dial(PREFIX + this.code, () => clearTimeout(fail)));
    // Should the host leave, this phone may be next in line, and then the others connect to it.
    peer.on('connection', (c) => this.wire(c));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', (e) => {
      clearTimeout(fail);
      if (this.moving) return this.moving(e);
      if (this.hosting || this.joined) return;
      this.cb.error(e.type === 'peer-unavailable' ? 'No game with that code.' : 'Could not connect (' + e.type + ').');
    });
  }
  dial(id, opened) {
    const c = this.peer.connect(id, { reliable: true, serialization: 'raw' });
    this.wire(c, () => { this.joined = true; if (opened) opened(); });
    return c;
  }
  wire(c, opened) {
    // Someone who dialled in before this phone heard that the host left: held until it runs the room.
    if (!opened && !this.hosting) {
      c.held = [];
      this.early.push(c);
      setTimeout(() => { if (c.held) c.close(); }, 15000);
    }
    c.on('open', () => { this.conns.set(c.peer, c); if (opened) opened(); if (!c.held) this.cb.open(c.peer); });
    c.on('data', (d) => { const s = typeof d === 'string' ? d : String(d); if (c.held) { if (c.held.length < 50) c.held.push(s); } else this.cb.msg(c.peer, s); });
    c.on('close', () => { if (this.conns.delete(c.peer) && !c.held) this.cb.close(c.peer, 'Connection closed'); });
    c.on('error', () => {});
  }
  // This phone's own address here, for the others to connect to if it is ever the host.
  get pid() { return this.peer && !this.peer.destroyed ? this.peer.id || '' : ''; }
  // The host left and this phone runs the room now.
  promote(cb) {
    this.cb = cb;
    this.hosting = true;
    this.moving = null;
    for (const c of this.early) {
      const q = c.held;
      if (!q) continue;
      c.held = null;
      if (c.open) { this.conns.set(c.peer, c); this.cb.open(c.peer); }
      for (const s of q) this.cb.msg(c.peer, s);
    }
    this.early = [];
    this.claim(0);
  }
  // The room's code belonged to the old host. Once it is free again this phone takes it, so the code friends have still works.
  claim(n) {
    if (this.stopped || !this.code || n > 24) return;
    const p = new window.Peer(PREFIX + this.code, { debug: 0, config: { iceServers: ICE } });
    p.on('open', () => { this.alias = p; });
    p.on('connection', (c) => this.wire(c));
    p.on('disconnected', () => { if (!p.destroyed) p.reconnect(); });
    p.on('error', (e) => { if (e.type === 'unavailable-id' && !this.stopped) { p.destroy(); this.claimT = setTimeout(() => this.claim(n + 1), 5000); } });
  }
  // Someone else runs the room now: over to them. done(false) when they can't be reached.
  moveTo(pid, cb, done) {
    this.cb = cb;
    let over = false, c = null;
    const end = (ok) => {
      if (over) return;
      over = true;
      clearTimeout(t);
      this.moving = null;
      if (!ok && c) c.close();
      done(ok);
    };
    const t = setTimeout(() => end(false), 10000);
    this.moving = (e) => { if (e.type === 'peer-unavailable') end(false); };
    try { c = this.dial(pid, () => end(true)); } catch (e) { end(false); }
  }
  send(id, s) { const c = this.conns.get(id); if (c && c.open) c.send(s); }
  close(id) { const c = this.conns.get(id); if (c) c.close(); }
  setInfo() {}
  stop() {
    this.stopped = true;
    clearTimeout(this.claimT);
    if (this.alias) this.alias.destroy();
    if (this.peer) this.peer.destroy();
  }
}

// Through a StickManUp server: it finds the room, checks the password and passes messages along. The host phone runs the
// climb as always. This works on every network, because every phone only connects out to the server.
class ServerLink {
  constructor(o) { this.url = o.url; this.room = o.room || {}; this.stopped = false; this.sentInfo = ''; this.isServer = true; this.token = o.token || ''; }
  connect(onReady, onFail) {
    let ws;
    try { ws = this.ws = new WebSocket(this.url); } catch (e) { return onFail('Could not reach the game server.'); }
    this.opener = setTimeout(() => { onFail('Could not reach the game server.'); ws.close(); }, 12000);
    ws.onopen = () => onReady();
    ws.onerror = () => {};
  }
  ctl(o) { if (this.ws && this.ws.readyState === 1) this.ws.send('!' + JSON.stringify(o)); }
  host(name, cb) {
    this.cb = cb;
    this.isHost = true;
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { clearTimeout(this.opener); if (!settled) { settled = true; resolve(r); } };
      // move: when this phone leaves, the server hands the room to someone still in it instead of closing it.
      this.connect(() => this.ctl({ t: 'host', proto: PROTO, token: this.token, host: name, name: this.room.name, pub: !!this.room.pub, pass: this.room.pass || '', map: this.room.map, diff: this.room.diff, move: 1 }), (err) => done({ ok: false, err }));
      this.ws.onmessage = (e) => {
        const d = String(e.data);
        if (!settled && d[0] === '!') {
          let m;
          try { m = JSON.parse(d.slice(1)); } catch (x) { return; }
          if (m.t === 'hosted') { this.startPing(); return done({ ok: true, code: m.code, name: m.name, pub: m.pub, locked: m.locked }); }
          if (m.t === 'err') return done({ ok: false, err: m.why });
        }
        this.hostIn(d);
      };
      this.ws.onclose = () => {
        if (!settled) done({ ok: false, err: 'Could not reach the game server.' });
        else if (!this.stopped) this.cb.error('Lost the connection to the game server.');
      };
    });
  }
  // What reaches a host: from the server itself, or 'id|payload' from a player.
  hostIn(d) {
    const cb = this.cb;
    if (d[0] === '!') {
      let m;
      try { m = JSON.parse(d.slice(1)); } catch (x) { return; }
      if (m.t === 'pong') this.gotPong(m);
      else if (m.t === 'err') cb.error(m.why);
      else if (m.t === 'peer+') cb.open(m.id);
      else if (m.t === 'peer-') cb.close(m.id, 'left');
      // Closed by an admin, or banned: the reason says more than losing the connection does.
      else if (m.t === 'closed') { this.stopped = true; cb.error(m.why); }
      return;
    }
    const i = d.indexOf('|');
    if (i > 0) cb.msg(+d.slice(0, i), d.slice(i + 1));
  }
  // The ping everyone sees: there and back to the game server, every 2 seconds, the middle of the last five (one slow trip
  // doesn't show). Not through the host and its game, which only waits for the host's next frame.
  startPing() {
    if (this.pingT) return;
    this.rtts = [];
    const go = () => this.ctl({ t: 'ping', c: performance.now() });
    go();
    this.pingT = setInterval(go, 2000);
  }
  gotPong(m) {
    const r = performance.now() - +m.c;
    if (!(r >= 0 && r < 30000)) return;
    this.rtts.push(r);
    if (this.rtts.length > 5) this.rtts.shift();
    const s = [...this.rtts].sort((a, b) => a - b);
    this.srvPing = Math.max(1, Math.round(s[s.length >> 1]));
  }
  // The host left and the server made this phone the host: the room carries on here, under the same code.
  promote(cb) {
    this.cb = cb;
    this.isHost = true;
  }
  join(target, cb) {
    this.cb = cb;
    let inside = false, told = false;
    const fail = (why) => { clearTimeout(this.opener); if (!told) { told = true; cb.error(why); } };
    this.connect(() => this.ctl({ t: 'join', proto: PROTO, token: this.token, code: target.code, pass: target.pass || '' }), fail);
    this.ws.onmessage = (e) => {
      const d = String(e.data);
      if (this.isHost) return this.hostIn(d);
      if (d[0] === '!') {
        let m;
        try { m = JSON.parse(d.slice(1)); } catch (x) { return; }
        if (m.t === 'pong') this.gotPong(m);
        else if (m.t === 'joined') { clearTimeout(this.opener); inside = true; this.startPing(); cb.open('host'); }
        else if (m.t === 'err') fail(m.why);
        else if (m.t === 'closed') { told = true; cb.close('host', m.why); }
        else if (m.t === 'promote' && inside) cb.promote({ code: String(m.code || ''), name: String(m.name || '').slice(0, 28), pub: !!m.pub, locked: !!m.locked });
        else if (m.t === 'newhost' && inside) cb.newHost();
        return;
      }
      cb.msg('host', d);
    };
    this.ws.onclose = () => {
      if (this.stopped || told) return;
      if (this.isHost) { told = true; return this.cb.error('Lost the connection to the game server.'); }
      if (inside) { told = true; cb.close('host', 'Lost the connection to the game server.'); }
      else fail('Could not reach the game server.');
    };
  }
  send(id, s) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(this.isHost ? id + '|' + s : s);
  }
  close(id) { this.ctl({ t: 'kick', id }); }
  // What the server browser shows about this room.
  setInfo(name, n, lobby, started) {
    if (!this.isHost || !lobby) return;
    const o = { t: 'info', map: lobby.map || 0, diff: lobby.diff || 0, started: !!started }, key = JSON.stringify(o);
    if (key === this.sentInfo) return;
    this.sentInfo = key;
    this.ctl(o);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.opener);
    clearInterval(this.pingT);
    if (this.ws) this.ws.close();
  }
}

export function makeLink(kind, o) {
  if (kind === 'server') return new ServerLink(o);
  return new PeerLink();
}

// ---------- session ----------
export class Session {
  constructor(mode, name, link, color = null, look = null, role = '') {
    this.mode = mode; // 'solo' | 'host' | 'client'
    this.name = name;
    this.color = validColor(color);
    this.look = cleanLook(look);
    this.link = link;
    this.role = this.vouch(role);
    this.slot = 0;
    this.players = new Map();
    this.h = {};
    this.offset = 0;
    this.bestRtt = 1e9;
    this.ping = 0;
    this.lobby = { diff: 1, resume: false };
    this.game = null;
    // Which slot runs the room. It starts with whoever opened it, and moves on when they leave (becomeHost).
    this.hostSlot = 0;
    // This phone's own key (main.js), so a room knows someone again who left and came back (game.js remember).
    this.who = '';
    this.moving = false;
    // What was said in the room, the last CHAT_KEEP (chat.js). Every phone keeps it, so a new host has it too.
    this.chat = [];
    // The saved climbs the others have (main.js roomSave), by slot: whoever hosts can carry on one they were all part of.
    this.offers = new Map();
    if (mode !== 'client') this.players.set(0, this.player(0, name, null, this.color, this.look, this.role));
    if (mode === 'host') this.pgT = setInterval(() => this.sharePings(), 2000);
  }

  // This phone's ping: to the game server and back there, to the host in an Online room (the host itself has none there).
  get myPing() {
    const L = this.link;
    if (L && L.isServer && L.srvPing) return L.srvPing;
    return this.isHost ? 0 : this.ping;
  }
  // The host tells everyone everyone's ping, its own too, so each screen can show them all.
  sharePings() {
    if (!this.isHost || this.closed) return;
    const me = this.players.get(this.slot), p = {};
    if (me) me.ping = this.myPing;
    for (const pl of this.players.values()) if (pl.ping) p[pl.slot] = pl.ping;
    this.broadcast({ k: 'pg', p });
    this.emit('pings');
  }

  player(slot, name, id, color = null, look = null, role = '') {
    return { slot, name, id, color, look, role, samples: [], ping: 0, who: '', pid: '', wait: false };
  }

  // A flag only counts when it came through the game server, which writes them itself (server/lib/rooms.js). In
  // an Online room anyone could claim anything, so nobody has one there.
  vouch(role) {
    return this.mode === 'solo' || (this.link && this.link.isServer) ? cleanRole(role) : '';
  }

  // Changing your name or colour mid-game: update it here and tell everyone. A client tells the host,
  // the host passes the new player list on, and every screen redraws the stickmen and name tags.
  setMe(name, color, look, role) {
    this.name = String(name || 'Climber').slice(0, 14);
    this.color = validColor(color);
    if (look !== undefined) this.look = cleanLook(look);
    if (role !== undefined) this.role = this.vouch(role);
    const me = this.players.get(this.slot);
    if (me) { me.name = this.name; me.color = this.color; me.look = this.look; if (this.mode !== 'client') me.role = this.role; }
    if (this.mode === 'client') this.send(this.hostId, { k: 'info', name: this.name, color: this.color, look: this.look });
    else this.sendLobby();
  }

  on(k, fn) { this.h[k] = fn; return this; }
  emit(k, ...a) { if (this.h[k]) this.h[k](...a); }
  now() { return performance.now() + this.offset; }
  get isHost() { return this.mode !== 'client'; }

  // ----- host -----
  host() {
    return this.link.host(this.name, this.hostCb());
  }
  hostCb() {
    return {
      open: () => {},
      msg: (id, s) => this.hostMsg(id, s),
      close: (id) => this.drop(id),
      error: (e) => this.emit('error', e),
    };
  }

  // The host left and this phone runs the room from here on. Everyone else keeps their place and comes back to it (hello with
  // back); whoever hasn't after a while is taken as gone.
  becomeHost(room) {
    if (this.closed || this.isHost) return;
    const old = this.hostSlot;
    this.mode = 'host';
    this.hostSlot = this.slot;
    this.moving = false;
    // Continuing a saved climb meant the old host's choice. The others offer theirs again (main.js newHost).
    this.lobby.resume = false;
    this.offers = new Map();
    clearInterval(this.pinger);
    clearInterval(this.pgT);
    this.pgT = setInterval(() => this.sharePings(), 2000);
    for (const p of this.players.values()) if (p.slot !== this.slot) { p.id = null; p.wait = true; }
    this.link.promote(this.hostCb());
    this.emit('promoted', room || null);
    const gone = this.players.get(old);
    if (gone && old !== this.slot) this.dropSlot(gone);
    clearTimeout(this.waitT);
    this.waitT = setTimeout(() => { for (const p of [...this.players.values()]) if (p.wait) this.dropSlot(p); }, MOVE_WAIT);
    this.sendLobby();
  }

  slotOf(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return null;
  }

  hostMsg(id, s) {
    let m;
    try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const p = this.slotOf(id);
    switch (m.k) {
      case 'hello': {
        if (m.v !== PROTO) return this.deny(id, 'That phone has a different StickManUp version. Update both to the same release.');
        if (p) break;
        const name = String(m.name || 'Climber').slice(0, 14), who = typeof m.who === 'string' && WHO.test(m.who) ? m.who : '';
        const pid = this.link && !this.link.isServer && typeof id === 'string' ? id.slice(0, 64) : '';
        // Back after the host changed: the same place as before, and the climb goes on for them where it was. Even after
        // taking too long, as long as nobody else got the place meanwhile.
        const back = Number.isInteger(m.back) && m.back >= 0 && m.back < MAX_PLAYERS && m.back !== this.slot ? m.back : -1;
        let was = back >= 0 ? this.players.get(back) : null;
        if (back >= 0 && !was) {
          was = Object.assign(this.player(back, name, null), { wait: true, who });
          this.players.set(back, was);
          this.emit('roster', back, true);
        }
        if (was && was.wait && (!was.who || was.who === who)) {
          Object.assign(was, { id, name, color: validColor(m.color), look: cleanLook(m.look), role: this.vouch(m.role), who, pid, wait: false });
          if (!this.game || m.ing) {
            this.send(id, { k: 'welcome', slot: was.slot, back: 1, hs: this.slot, players: this.list(), lobby: this.lobby });
            this.sendLobby();
            this.emit('back', was.slot, m.cp);
            break;
          }
          // Still in the lobby there while the climb started here: in they come, like anyone joining.
          this.send(id, { k: 'welcome', slot: was.slot, hs: this.slot, players: this.list(), lobby: this.lobby, game: this.emitGet('snapshot', was.slot), chat: this.chat.slice(-CHAT_JOIN) });
          this.sendLobby();
          break;
        }
        let slot = -1;
        for (let i = 0; i < MAX_PLAYERS; i++) if (!this.players.has(i)) { slot = i; break; }
        if (slot < 0) return this.deny(id, 'This game is full (4 robots).');
        this.players.set(slot, Object.assign(this.player(slot, name, id, validColor(m.color), cleanLook(m.look), this.vouch(m.role)), { who, pid }));
        this.send(id, { k: 'welcome', slot, hs: this.slot, players: this.list(), lobby: this.lobby, game: this.game ? this.emitGet('snapshot', slot) : null, chat: this.chat.slice(-CHAT_JOIN) });
        this.sendLobby();
        this.emit('roster', slot, true);
        break;
      }
      // On the host's clock, which a host that took over carries on from the old one (now()).
      case 'ping':
        if (p && Number.isFinite(m.r) && m.r > 0) p.ping = Math.round(m.r);
        this.send(id, { k: 'pong', c: m.c, h: this.now() });
        break;
      case 'info':
        if (p) { p.name = String(m.name || p.name).slice(0, 14); p.color = validColor(m.color); p.look = cleanLook(m.look); p.role = this.vouch(m.role); this.sendLobby(); }
        break;
      case 'st': if (p) { if (Number.isFinite(m.r) && m.r > 0) p.ping = Math.round(m.r); this.push(p, this.emitGet('gameTime'), m.s); } break;
      case 'ev': if (p && m.e && typeof m.e === 'object') this.emit('hostEvent', m.e, p.slot); break;
      case 'chat': if (p) this.hostChat(p, m.t); break;
      // Their saved climbs, in the lobby (main.js cleans them before anything is done with them).
      case 'sv': if (p && !this.game && Array.isArray(m.s)) { this.offers.set(p.slot, m.s.slice(0, 4)); this.emit('offer', p.slot); } break;
      case 'bye': this.drop(id); break;
    }
  }

  emitGet(k, ...a) { return this.h[k] ? this.h[k](...a) : null; }

  deny(id, why) {
    this.send(id, { k: 'deny', why });
    setTimeout(() => this.link.close(id), 300);
  }

  drop(id) {
    const p = this.slotOf(id);
    if (p) this.dropSlot(p);
  }
  dropSlot(p) {
    if (!this.players.has(p.slot) || p.slot === this.slot) return;
    // Before they are gone from the list: the climb keeps their checkpoint for when they come back (game.js remember).
    this.emit('gone', p);
    this.players.delete(p.slot);
    this.offers.delete(p.slot);
    this.sendLobby();
    this.emit('roster', p.slot, false);
  }

  list() {
    // The game server needs to know who is who to write their flags: the host's own line is the one without an id, and 0 is
    // someone not back yet after the host changed. Nobody else needs those ids. In an Online room everyone gets the others'
    // addresses instead (pid), to know where to go should the host leave.
    const sv = this.link && this.link.isServer, mine = this.link && this.link.pid;
    return [...this.players.values()].map((p) => ({
      slot: p.slot, name: p.name, color: p.color, look: p.look, ping: p.ping, role: p.role, w: (p.slot === this.slot ? this.who : p.who) || undefined,
      pid: sv ? undefined : (p.slot === this.slot ? mine : p.pid) || undefined,
      id: sv && p.slot !== this.slot ? p.id || 0 : undefined,
    }));
  }

  sendLobby() {
    if (this.link && this.link.setInfo) this.link.setInfo(this.name, this.players.size, this.lobby, !!this.game);
    this.broadcast({ k: 'lobby', players: this.list(), lobby: this.lobby, hs: this.slot });
    this.emit('lobby');
  }

  setLobby(l) {
    Object.assign(this.lobby, l);
    this.sendLobby();
  }

  send(id, o) { if (this.link) this.link.send(id, JSON.stringify(o)); }

  broadcast(o) {
    if (!this.link) return;
    const s = JSON.stringify(o);
    for (const p of this.players.values()) if (p.id) this.link.send(p.id, s);
  }

  // ----- chat (chat.js) -----
  // Through the host like everything else. The host writes who said it, so nobody can speak as someone else.
  say(text) {
    const t = cleanSay(text);
    if (!t) return;
    if (this.isHost) this.hostChat(this.players.get(this.slot), t);
    else this.send(this.hostId, { k: 'chat', t });
  }
  hostChat(p, text) {
    const t = cleanSay(text);
    if (!p || p.wait || !t) return;
    // A few at once, then about one a second: nobody floods the room.
    const now = Date.now();
    p.chatB = Math.min(5, (p.chatB ?? 5) + (now - (p.chatT || now)) / 1000);
    p.chatT = now;
    if (p.chatB < 1) return;
    p.chatB -= 1;
    const m = { s: p.slot, n: p.name, c: p.color, w: (p.slot === this.slot ? this.who : p.who) || '', t, at: now };
    this.addChat(m);
    this.broadcast({ k: 'chat', m });
    this.emit('chat', m);
  }
  addChat(m) {
    this.chat.push(m);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
  }

  // Game events: clients ask the host, the host decides and tells everyone.
  toHost(e) {
    if (this.isHost) this.emit('hostEvent', e, this.slot);
    else this.send(this.hostId, { k: 'ev', e });
  }
  toAll(e) {
    this.broadcast({ k: 'ev', e });
    this.emit('event', e);
  }
  toSlot(slot, e) {
    if (slot === this.slot) return this.emit('event', e);
    const p = this.players.get(slot);
    if (p && p.id) this.send(p.id, { k: 'ev', e });
  }

  startGame(g) {
    this.game = g;
    if (this.link && this.link.setInfo) this.link.setInfo(this.name, this.players.size, g, true);
    this.broadcast(Object.assign({ k: 'start' }, g));
    this.emit('start', g);
  }

  // Host: 20 Hz world state for everyone.
  hostState(t, mine, extra) {
    const me = this.players.get(this.slot);
    if (me) me.last = mine;
    const p = {};
    for (const pl of this.players.values()) if (pl.last) p[pl.slot] = pl.last;
    // o: which line is the host's own, once that isn't slot 0 (the game server looks at it, server/lib/rooms.js watch).
    this.broadcast(Object.assign({ k: 'S', t, p }, this.slot ? { o: this.slot } : null, extra));
  }

  push(p, t, s) {
    p.last = s;
    p.samples.push({ t, s });
    if (p.samples.length > 24) p.samples.shift();
  }

  // ----- client -----
  join(target) {
    this.link.join(target, this.clientCb());
  }
  clientCb() {
    return {
      open: (id) => {
        this.hostId = id;
        this.hello();
        clearInterval(this.pinger);
        this.pingNow();
        this.pinger = setInterval(() => this.pingNow(), 2000);
      },
      msg: (id, s) => this.clientMsg(s),
      close: (id, why) => { if (!this.hostGone()) this.emit('closed', why && why !== 'left' ? why : 'The host left the game.'); },
      error: (e) => this.emit('error', e),
      // The game server's two ways of saying the host left: this phone runs the room now, or someone else does.
      promote: (room) => this.becomeHost(room),
      newHost: () => this.awaitHost(),
    };
  }
  hello() {
    const o = { k: 'hello', v: PROTO, name: this.name, color: this.color, look: this.look, who: this.who || undefined };
    // Coming back to a new host: the slot this phone had, whether it is climbing, and its own checkpoint.
    if (this.moving) Object.assign(o, { back: this.slot, ing: !!this.game, cp: this.emitGet('myCp') ?? undefined });
    this.send(this.hostId, o);
  }

  // The host is gone. In an Online room nobody else can decide who is next, so it is the lowest slot still here, and everyone
  // works that out the same way. (The game server picks one itself and says so: promote and newHost.) Alone, this phone just
  // becomes the host of its own room, and the code still works for anyone who wants to join.
  hostGone() {
    const L = this.link;
    if (this.closed || !this.inRoom || !L || L.isServer || !L.canMove) return false;
    const old = this.hostSlot, hp = this.players.get(old), order = [...this.players.values()].filter((p) => p.slot !== old && (p.slot === this.slot || p.pid)).map((p) => p.slot).sort((a, b) => a - b);
    // Maybe only this phone's own connection dropped: the old host first, if it is still there it takes this phone back.
    if (hp && hp.pid) order.unshift(old);
    this.tryNext(order);
    return true;
  }
  tryNext(order) {
    if (this.closed) return;
    const s = order.shift();
    if (s === undefined) return this.emit('closed', 'The host left the game.');
    if (s === this.slot) return this.becomeHost(null);
    const p = this.players.get(s);
    if (!p || !p.pid) return this.tryNext(order);
    this.awaitHost(s);
    this.link.moveTo(p.pid, this.clientCb(), (ok) => { if (!ok) this.tryNext(order); });
  }
  // Someone else runs the room now. The old host is gone from the list; this phone says hello to the new one again.
  awaitHost(next) {
    const old = this.hostSlot;
    if (old !== this.slot && this.players.has(old)) { this.players.delete(old); this.emit('roster', old, false); }
    if (next !== undefined) this.hostSlot = next;
    this.bestRtt = 1e9;
    if (!this.moving) { this.moving = true; this.emit('moving'); }
    if (this.link.isServer) this.hello();
  }

  // This phone's saved climbs, for the host to carry one on (main.js roomSave).
  offer(list) { if (!this.isHost && this.hostId && Array.isArray(list) && list.length) this.send(this.hostId, { k: 'sv', s: list.slice(0, 4) }); }

  pingNow() { this.send(this.hostId, { k: 'ping', c: performance.now(), r: this.myPing || undefined }); }

  clientMsg(s) {
    let m;
    try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.k) {
      case 'welcome':
        if (!Number.isInteger(m.slot) || m.slot < 0 || m.slot >= MAX_PLAYERS) return this.emit('error', 'That game answered strangely, so you were not connected.');
        this.hostSlot = slotOk(m.hs);
        // Back with the new host: same slot, same climb, nothing starts over.
        if (m.back && this.moving && m.slot === this.slot) {
          this.moving = false;
          this.roster(m.players);
          this.lobby = cleanLobby(m.lobby);
          this.emit('newHost', this.hostSlot);
          this.emit('lobby');
          break;
        }
        // Mid climb and not let back into it: this phone's climb can't go on in that room.
        if (this.moving && this.game) { this.moving = false; return this.emit('closed', 'The host left the game.'); }
        this.moving = false;
        this.inRoom = true;
        this.slot = m.slot;
        this.roster(m.players);
        this.lobby = cleanLobby(m.lobby);
        m.game = cleanGame(m.game);
        if (m.game) this.game = m.game;
        // What was said before this phone came in.
        if (Array.isArray(m.chat)) this.chat = m.chat.slice(-CHAT_KEEP).map(cleanChat).filter(Boolean);
        this.emit('welcome', m);
        break;
      case 'deny': this.emit('error', m.why); break;
      case 'chat': {
        const c = cleanChat(m.m);
        if (c) { this.addChat(c); this.emit('chat', c); }
        break;
      }
      case 'pg':
        if (m.p && typeof m.p === 'object') for (const k in m.p) { const q = this.players.get(+k); if (q && +k !== this.slot) q.ping = Math.min(99999, count(m.p[k])); }
        this.emit('pings');
        break;
      case 'lobby': this.hostSlot = slotOk(m.hs); this.lobby = cleanLobby(m.lobby); this.roster(m.players); this.emit('lobby'); break;
      case 'start': this.game = cleanGame(m); this.emit('start', m); break;
      case 'S':
        if (m.f !== undefined) m.f = count(m.f);
        if (m.cp !== undefined) m.cp = count(m.cp);
        if (m.mz !== undefined) m.mz = count(m.mz);
        for (const k in m.p) {
          const slot = +k, p = this.players.get(slot);
          if (p && slot !== this.slot) this.push(p, m.t, m.p[k]);
        }
        this.emit('S', m);
        break;
      case 'ev':
        if (!m.e || typeof m.e !== 'object') break;
        if (m.e.falls !== undefined) m.e.falls = count(m.e.falls);
        if (m.e.mz !== undefined) m.e.mz = count(m.e.mz);
        if (m.e.k === 'maze') m.e.v = count(m.e.v);
        if (m.e.t !== undefined) m.e.t = num(m.e.t);
        this.emit('event', m.e);
        break;
      case 'pong': {
        const now = performance.now(), rtt = now - m.c;
        this.ping = Math.round(rtt);
        // Trust the fastest round trips most when estimating the host clock.
        if (rtt < this.bestRtt * 1.3) {
          const off = m.h + rtt / 2 - now;
          this.offset = this.bestRtt === 1e9 ? off : this.offset * 0.7 + off * 0.3;
          this.bestRtt = Math.min(this.bestRtt * 1.05, rtt);
        }
        break;
      }
    }
  }

  roster(list) {
    if (!Array.isArray(list)) return;
    const before = new Set(this.players.keys());
    for (const p of list) {
      if (!p || !Number.isInteger(p.slot) || p.slot < 0 || p.slot >= MAX_PLAYERS) continue;
      const name = String(p.name || 'Climber').slice(0, 14);
      if (!this.players.has(p.slot)) { this.players.set(p.slot, this.player(p.slot, name, null)); this.emit('roster', p.slot, true); }
      const q = this.players.get(p.slot);
      q.name = name; q.ping = count(p.ping); q.color = validColor(p.color); q.look = cleanLook(p.look); q.role = this.vouch(p.role);
      q.who = typeof p.w === 'string' && WHO.test(p.w) ? p.w : '';
      q.pid = typeof p.pid === 'string' ? p.pid.slice(0, 64) : '';
      before.delete(p.slot);
    }
    for (const s of before) { this.players.delete(s); this.emit('roster', s, false); }
  }

  sendState(s) {
    if (!this.isHost) this.send(this.hostId, { k: 'st', s, r: this.myPing });
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    clearInterval(this.pgT);
    clearTimeout(this.waitT);
    if (this.link) {
      if (!this.isHost && this.hostId) this.send(this.hostId, { k: 'bye' });
      const l = this.link;
      setTimeout(() => l.stop(), 150);
    }
    this.h = {};
  }
}
