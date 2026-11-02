// Multiplayer. A star network: clients talk only to the host, the host relays.
// Transports: a StickManUp server (WebSocket relay), Online (PeerJS/WebRTC), Internet direct and WiFi (native TCP sockets via the Android
// bridge; direct opens the router port with UPnP), Bluetooth, and a BroadcastChannel stand-in so two
// browser tabs can test the netcode on a desktop.
import { LEVEL_VERSION, DIFFS, MAPS } from './level.js';
import { validColor } from './colors.js';
import { cleanLook } from './skins.js';

export const PROTO = LEVEL_VERSION * 100 + 1;

// Whoever hosts a public room can be a complete stranger, and so can whoever joins yours. Nothing they send is believed:
// whatever can reach the screen or your records is checked here, the one place every way of playing passes through.
const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const num = (v) => (Number.isFinite(v) ? v : 0);
const inList = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
function cleanRoomRules(r) {
  const o = {};
  if (r && typeof r === 'object') for (const k of ['cps', 'haz', 'rope']) if (Number.isInteger(r[k]) && r[k] >= 0 && r[k] < DIFFS.length) o[k] = r[k];
  return o;
}
function cleanLobby(l) {
  const x = l && typeof l === 'object' ? l : {};
  return { map: inList(x.map, MAPS), diff: inList(x.diff, DIFFS), rules: cleanRoomRules(x.rules), noCord: !!x.noCord, resume: !!x.resume };
}
function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  return Object.assign(g, {
    map: inList(g.map, MAPS), diff: inList(g.diff, DIFFS), rules: cleanRoomRules(g.rules), noCord: !!g.noCord, t0: num(g.t0), base: num(g.base), cp: count(g.cp), falls: count(g.falls),
    pcp: g.pcp && typeof g.pcp === 'object' ? g.pcp : {}, doors: Array.isArray(g.doors) ? g.doors : [], stuns: Array.isArray(g.stuns) ? g.stuns : [], pos: g.pos && typeof g.pos === 'object' ? g.pos : {},
  });
}
const PREFIX = 'stickmanup-v1-';
// Address finders for WebRTC. (The relay servers PeerJS used to list no longer exist.)
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

export const hasNative = () => !!(window.Native && window.Native.netHostLan);

// ---------- native bridge (WiFi / Bluetooth) ----------
const NB = { active: null, onFound: null, onBt: null };
window.NET_open = (id) => NB.active && NB.active.cb.open(id);
window.NET_msg = (id, s) => NB.active && NB.active.cb.msg(id, s);
window.NET_close = (id, why) => NB.active && NB.active.cb.close(id, why || '');
window.NET_fail = (why) => NB.active && NB.active.cb.error(why);
window.NET_found = (list) => NB.onFound && NB.onFound(list);
window.NET_bt = (state) => NB.onBt && NB.onBt(state);
window.NET_expose = (r) => { const f = NB.onExpose; NB.onExpose = null; if (f) f(r); };

// Direct internet hosting: ask the router to forward the game port and find the public address.
export function exposeHost(port) {
  if (!hasNative() || !window.Native.netExpose) return Promise.resolve({ ok: false, err: 'Needs the Android app' });
  return new Promise((res) => {
    NB.onExpose = res;
    window.Native.netExpose(port);
    setTimeout(() => { if (NB.onExpose === res) { NB.onExpose = null; res({ ok: false, err: 'Timed out' }); } }, 12000);
  });
}

// Short codes for an internet address: IPv4 + port packed into 10 characters (Crockford base32).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function addrToCode(ip, port) {
  const p = ip.split('.').map(Number);
  let n = (BigInt(p[0]) << 40n) | (BigInt(p[1]) << 32n) | (BigInt(p[2]) << 24n) | (BigInt(p[3]) << 16n) | BigInt(port);
  let s = '';
  for (let i = 0; i < 10; i++) { s = B32[Number(n & 31n)] + s; n >>= 5n; }
  return s.slice(0, 5) + ' ' + s.slice(5);
}
// Accepts a code (spaces, any punctuation and lowercase are fine) or a plain "ip:port". Returns { ip, port } or null.
export function parseAddr(text) {
  const t = text.trim();
  const m = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (m) return { ip: m[1], port: +(m[2] || 47800) };
  const c = t.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (c.length !== 10) return null;
  let n = 0n;
  for (const ch of c) { const v = B32.indexOf(ch); if (v < 0) return null; n = (n << 5n) | BigInt(v); }
  const port = Number(n & 0xffffn), ip = [40n, 32n, 24n, 16n].map((s) => Number((n >> s) & 255n)).join('.');
  return port ? { ip, port } : null;
}

class NativeLink {
  constructor(kind) { this.kind = kind; }
  host(name, cb) {
    this.cb = cb;
    NB.active = this;
    const r = JSON.parse(this.kind === 'lan' ? window.Native.netHostLan(name) : window.Native.netHostBt(name));
    if (!r.ok) setTimeout(() => cb.error(r.err || 'Could not start hosting'), 0);
    return Promise.resolve(r);
  }
  join(target, cb) {
    this.cb = cb;
    NB.active = this;
    if (this.kind === 'lan') window.Native.netJoinLan(target.ip, target.port || 0);
    else window.Native.netJoinBt(target.addr);
  }
  send(id, s) { window.Native.netSend(id, s); }
  close(id) { window.Native.netClose(id); }
  setInfo(name, n) { window.Native.netInfo(name, n); }
  stop() {
    window.Native.netStop();
    if (NB.active === this) NB.active = null;
  }
}

export function lanDiscover(onList) {
  if (hasNative()) {
    NB.onFound = onList;
    window.Native.netDiscover(true);
    return () => { NB.onFound = null; window.Native.netDiscover(false); };
  }
  const ch = new BroadcastChannel('stickmanup-dev'), seen = new Map();
  ch.onmessage = (e) => {
    if (e.data.k !== 'here') return;
    seen.set(e.data.from, { name: e.data.name, ip: e.data.from, port: 0, n: e.data.n, t: Date.now() });
    for (const [k, v] of seen) if (Date.now() - v.t > 3000) seen.delete(k);
    onList([...seen.values()]);
  };
  return () => ch.close();
}

export function btPrepare(cb) {
  if (!hasNative()) return cb('none');
  NB.onBt = cb;
  window.Native.btPrepare();
}
export const btDevices = () => (hasNative() ? JSON.parse(window.Native.btDevices()) : []);
export const lanAddresses = () => (hasNative() ? JSON.parse(window.Native.netAddrs()) : ['dev-tab']);

// Desktop test transport: tabs in the same browser find each other over a BroadcastChannel.
class DevLink {
  constructor() {
    this.me = 'tab-' + Math.random().toString(36).slice(2, 7);
    this.ch = new BroadcastChannel('stickmanup-dev');
    this.peers = new Set();
  }
  host(name, cb) {
    this.cb = cb;
    this.name = name;
    this.n = 1;
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== this.me) return;
      if (m.k === 'conn') { this.peers.add(m.from); this.post({ k: 'acc', to: m.from }); cb.open(m.from); }
      else if (m.k === 'msg') cb.msg(m.from, m.d);
      else if (m.k === 'bye') { this.peers.delete(m.from); cb.close(m.from, 'left'); }
    };
    this.beacon = setInterval(() => this.ch.postMessage({ k: 'here', from: this.me, name: this.name, n: this.n }), 800);
    return Promise.resolve({ ok: true });
  }
  join(target, cb) {
    this.cb = cb;
    this.hostId = target.ip;
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== this.me) return;
      if (m.k === 'acc') { clearTimeout(this.to); cb.open(this.hostId); }
      else if (m.k === 'msg') cb.msg(this.hostId, m.d);
      else if (m.k === 'bye') cb.close(this.hostId, 'Host closed the game');
    };
    this.post({ k: 'conn', to: this.hostId });
    this.to = setTimeout(() => cb.error('No answer from that game'), 4000);
  }
  post(m) { m.from = this.me; this.ch.postMessage(m); }
  send(id, s) { this.post({ k: 'msg', to: id, d: s }); }
  close(id) { this.post({ k: 'bye', to: id }); }
  setInfo(name, n) { this.name = name; this.n = n; }
  stop() {
    clearInterval(this.beacon);
    for (const p of this.peers) this.post({ k: 'bye', to: p });
    if (this.hostId) this.post({ k: 'bye', to: this.hostId });
    this.ch.close();
  }
}

// Online play over WebRTC data channels; the public PeerJS server only introduces the phones.
class PeerLink {
  constructor() { this.conns = new Map(); }
  host(name, cb) {
    this.cb = cb;
    return new Promise((resolve) => {
      const attempt = (left) => {
        let code = '';
        for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
        const peer = (this.peer = new window.Peer(PREFIX + code, { debug: 0, config: { iceServers: ICE } }));
        peer.on('open', () => resolve({ ok: true, code }));
        peer.on('connection', (c) => this.wire(c));
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && left > 0) { peer.destroy(); attempt(left - 1); }
          else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') resolve({ ok: false, err: 'Could not reach the online server. Check your internet.' });
          else cb.error('Online error: ' + e.type);
        });
      };
      attempt(3);
    });
  }
  join(code, cb) {
    this.cb = cb;
    const peer = (this.peer = new window.Peer({ debug: 0, config: { iceServers: ICE } }));
    const fail = setTimeout(() => cb.error('Could not connect. Some networks (often mobile data) block direct connections: ask the host to use Internet (direct) from a home WiFi.'), 15000);
    peer.on('open', () => {
      const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
      this.wire(c, () => clearTimeout(fail));
    });
    peer.on('error', (e) => {
      clearTimeout(fail);
      cb.error(e.type === 'peer-unavailable' ? 'No game with that code.' : 'Could not connect (' + e.type + ').');
    });
  }
  wire(c, opened) {
    c.on('open', () => { this.conns.set(c.peer, c); if (opened) opened(); this.cb.open(c.peer); });
    c.on('data', (d) => this.cb.msg(c.peer, typeof d === 'string' ? d : String(d)));
    c.on('close', () => { if (this.conns.delete(c.peer)) this.cb.close(c.peer, 'Connection closed'); });
    c.on('error', () => {});
  }
  send(id, s) { const c = this.conns.get(id); if (c && c.open) c.send(s); }
  close(id) { const c = this.conns.get(id); if (c) c.close(); }
  setInfo() {}
  stop() { if (this.peer) this.peer.destroy(); }
}

// Through a StickManUp server: it finds the room, checks the password and passes messages along. The host phone runs the
// climb as always. This works on every network, because every phone only connects out to the server.
class ServerLink {
  constructor(o) { this.url = o.url; this.room = o.room || {}; this.stopped = false; this.sentInfo = ''; }
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
      this.connect(() => this.ctl({ t: 'host', proto: PROTO, host: name, name: this.room.name, pub: !!this.room.pub, pass: this.room.pass || '', map: this.room.map, diff: this.room.diff }), (err) => done({ ok: false, err }));
      this.ws.onmessage = (e) => {
        const d = String(e.data);
        if (d[0] === '!') {
          let m;
          try { m = JSON.parse(d.slice(1)); } catch (x) { return; }
          if (m.t === 'hosted') done({ ok: true, code: m.code, name: m.name, pub: m.pub, locked: m.locked });
          else if (m.t === 'err') { if (settled) cb.error(m.why); else done({ ok: false, err: m.why }); }
          else if (m.t === 'peer+') cb.open(m.id);
          else if (m.t === 'peer-') cb.close(m.id, 'left');
          return;
        }
        const i = d.indexOf('|');
        if (i > 0) cb.msg(+d.slice(0, i), d.slice(i + 1));
      };
      this.ws.onclose = () => {
        if (!settled) done({ ok: false, err: 'Could not reach the game server.' });
        else if (!this.stopped) cb.error('Lost the connection to the game server.');
      };
    });
  }
  join(target, cb) {
    this.cb = cb;
    let inside = false, told = false;
    const fail = (why) => { clearTimeout(this.opener); if (!told) { told = true; cb.error(why); } };
    this.connect(() => this.ctl({ t: 'join', proto: PROTO, code: target.code, pass: target.pass || '' }), fail);
    this.ws.onmessage = (e) => {
      const d = String(e.data);
      if (d[0] === '!') {
        let m;
        try { m = JSON.parse(d.slice(1)); } catch (x) { return; }
        if (m.t === 'joined') { clearTimeout(this.opener); inside = true; cb.open('host'); }
        else if (m.t === 'err') fail(m.why);
        else if (m.t === 'closed') { told = true; cb.close('host', m.why); }
        return;
      }
      cb.msg('host', d);
    };
    this.ws.onclose = () => {
      if (this.stopped || told) return;
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
    if (this.ws) this.ws.close();
  }
}

export function makeLink(kind, o) {
  if (kind === 'server') return new ServerLink(o);
  if (kind === 'online') return new PeerLink();
  if (kind === 'direct') kind = 'lan'; // the same TCP transport, reached over the internet
  return hasNative() ? new NativeLink(kind) : new DevLink();
}

// ---------- session ----------
export class Session {
  constructor(mode, name, link, color = null, look = null) {
    this.mode = mode; // 'solo' | 'host' | 'client'
    this.name = name;
    this.color = validColor(color);
    this.look = cleanLook(look);
    this.link = link;
    this.slot = 0;
    this.players = new Map();
    this.h = {};
    this.offset = 0;
    this.bestRtt = 1e9;
    this.ping = 0;
    this.lobby = { diff: 1, resume: false };
    this.game = null;
    if (mode !== 'client') this.players.set(0, this.player(0, name, null, this.color, this.look));
  }

  player(slot, name, id, color = null, look = null) {
    return { slot, name, id, color, look, samples: [], ping: 0 };
  }

  // Changing your name or colour mid-game: update it here and tell everyone. A client tells the host,
  // the host passes the new player list on, and every screen redraws the stickmen and name tags.
  setMe(name, color, look) {
    this.name = String(name || 'Climber').slice(0, 14);
    this.color = validColor(color);
    if (look !== undefined) this.look = cleanLook(look);
    const me = this.players.get(this.slot);
    if (me) { me.name = this.name; me.color = this.color; me.look = this.look; }
    if (this.mode === 'client') this.send(this.hostId, { k: 'info', name: this.name, color: this.color, look: this.look });
    else this.sendLobby();
  }

  on(k, fn) { this.h[k] = fn; return this; }
  emit(k, ...a) { if (this.h[k]) this.h[k](...a); }
  now() { return performance.now() + this.offset; }
  get isHost() { return this.mode !== 'client'; }

  // ----- host -----
  host() {
    return this.link.host(this.name, {
      open: () => {},
      msg: (id, s) => this.hostMsg(id, s),
      close: (id) => this.drop(id),
      error: (e) => this.emit('error', e),
    });
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
        let slot = -1;
        for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players.has(i)) { slot = i; break; }
        if (slot < 0) return this.deny(id, 'This game is full (4 robots).');
        this.players.set(slot, this.player(slot, String(m.name || 'Climber').slice(0, 14), id, validColor(m.color), cleanLook(m.look)));
        this.send(id, { k: 'welcome', slot, players: this.list(), lobby: this.lobby, game: this.game ? this.emitGet('snapshot', slot) : null });
        this.sendLobby();
        this.emit('roster', slot, true);
        break;
      }
      case 'ping': this.send(id, { k: 'pong', c: m.c, h: performance.now() }); break;
      case 'info':
        if (p) { p.name = String(m.name || p.name).slice(0, 14); p.color = validColor(m.color); p.look = cleanLook(m.look); this.sendLobby(); }
        break;
      case 'st': if (p) { if (Number.isFinite(m.r) && m.r > 0) p.ping = Math.round(m.r); this.push(p, this.emitGet('gameTime'), m.s); } break;
      case 'ev': if (p && m.e && typeof m.e === 'object') this.emit('hostEvent', m.e, p.slot); break;
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
    if (!p) return;
    this.players.delete(p.slot);
    this.sendLobby();
    this.emit('roster', p.slot, false);
  }

  list() {
    return [...this.players.values()].map((p) => ({ slot: p.slot, name: p.name, color: p.color, look: p.look, ping: p.ping }));
  }

  sendLobby() {
    if (this.link && this.link.setInfo) this.link.setInfo(this.name, this.players.size, this.lobby, !!this.game);
    this.broadcast({ k: 'lobby', players: this.list(), lobby: this.lobby });
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
    const me = this.players.get(0);
    if (me) me.last = mine;
    const p = {};
    for (const pl of this.players.values()) if (pl.last) p[pl.slot] = pl.last;
    this.broadcast(Object.assign({ k: 'S', t, p }, extra));
  }

  push(p, t, s) {
    p.last = s;
    p.samples.push({ t, s });
    if (p.samples.length > 24) p.samples.shift();
  }

  // ----- client -----
  join(target) {
    this.link.join(target, {
      open: (id) => {
        this.hostId = id;
        this.send(id, { k: 'hello', v: PROTO, name: this.name, color: this.color, look: this.look });
        this.pingNow();
        this.pinger = setInterval(() => this.pingNow(), 2000);
      },
      msg: (id, s) => this.clientMsg(s),
      close: (id, why) => this.emit('closed', why && why !== 'left' ? why : 'The host left the game.'),
      error: (e) => this.emit('error', e),
    });
  }

  pingNow() { this.send(this.hostId, { k: 'ping', c: performance.now() }); }

  clientMsg(s) {
    let m;
    try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.k) {
      case 'welcome':
        if (!Number.isInteger(m.slot) || m.slot < 1 || m.slot >= MAX_PLAYERS) return this.emit('error', 'That game answered strangely, so you were not connected.');
        this.slot = m.slot;
        this.roster(m.players);
        this.lobby = cleanLobby(m.lobby);
        m.game = cleanGame(m.game);
        this.emit('welcome', m);
        break;
      case 'deny': this.emit('error', m.why); break;
      case 'lobby': this.lobby = cleanLobby(m.lobby); this.roster(m.players); this.emit('lobby'); break;
      case 'start': this.game = cleanGame(m); this.emit('start', m); break;
      case 'S':
        if (m.f !== undefined) m.f = count(m.f);
        if (m.cp !== undefined) m.cp = count(m.cp);
        for (const k in m.p) {
          const slot = +k, p = this.players.get(slot);
          if (p && slot !== this.slot) this.push(p, m.t, m.p[k]);
        }
        this.emit('S', m);
        break;
      case 'ev':
        if (!m.e || typeof m.e !== 'object') break;
        if (m.e.falls !== undefined) m.e.falls = count(m.e.falls);
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
      q.name = name; q.ping = count(p.ping); q.color = validColor(p.color); q.look = cleanLook(p.look);
      before.delete(p.slot);
    }
    for (const s of before) { this.players.delete(s); this.emit('roster', s, false); }
  }

  sendState(s) {
    if (!this.isHost) this.send(this.hostId, { k: 'st', s, r: this.ping });
  }

  close() {
    clearInterval(this.pinger);
    if (this.link) {
      if (!this.isHost && this.hostId) this.send(this.hostId, { k: 'bye' });
      const l = this.link;
      setTimeout(() => l.stop(), 150);
    }
    this.h = {};
  }
}
