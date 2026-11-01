// Multiplayer. A star network: clients talk only to the host, the host relays.
// Transports: Online (PeerJS/WebRTC), Internet direct and WiFi (native TCP sockets via the Android
// bridge; direct opens the router port with UPnP), Bluetooth, and a BroadcastChannel stand-in so two
// browser tabs can test the netcode on a desktop.
import { LEVEL_VERSION } from './level.js';

export const PROTO = LEVEL_VERSION * 100 + 1;
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

export function makeLink(kind) {
  if (kind === 'online') return new PeerLink();
  if (kind === 'direct') kind = 'lan'; // the same TCP transport, reached over the internet
  return hasNative() ? new NativeLink(kind) : new DevLink();
}

// ---------- session ----------
export class Session {
  constructor(mode, name, link) {
    this.mode = mode; // 'solo' | 'host' | 'client'
    this.name = name;
    this.link = link;
    this.slot = 0;
    this.players = new Map();
    this.h = {};
    this.offset = 0;
    this.bestRtt = 1e9;
    this.ping = 0;
    this.lobby = { diff: 1, resume: false };
    this.game = null;
    if (mode !== 'client') this.players.set(0, this.player(0, name, null));
  }

  player(slot, name, id) {
    return { slot, name, id, samples: [], ping: 0 };
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
    const p = this.slotOf(id);
    switch (m.k) {
      case 'hello': {
        if (m.v !== PROTO) return this.deny(id, 'That phone has a different StickManUp version. Update both to the same release.');
        let slot = -1;
        for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players.has(i)) { slot = i; break; }
        if (slot < 0) return this.deny(id, 'This game is full (4 robots).');
        this.players.set(slot, this.player(slot, String(m.name || 'Climber').slice(0, 14), id));
        this.send(id, { k: 'welcome', slot, players: this.list(), lobby: this.lobby, game: this.game ? this.emitGet('snapshot', slot) : null });
        this.sendLobby();
        this.emit('roster', slot, true);
        break;
      }
      case 'ping': this.send(id, { k: 'pong', c: m.c, h: performance.now() }); break;
      case 'st': if (p) { p.ping = m.r || p.ping; this.push(p, this.emitGet('gameTime'), m.s); } break;
      case 'ev': if (p) this.emit('hostEvent', m.e, p.slot); break;
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
    return [...this.players.values()].map((p) => ({ slot: p.slot, name: p.name, ping: p.ping }));
  }

  sendLobby() {
    if (this.link && this.link.setInfo) this.link.setInfo(this.name, this.players.size);
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
        this.send(id, { k: 'hello', v: PROTO, name: this.name });
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
    switch (m.k) {
      case 'welcome':
        this.slot = m.slot;
        this.roster(m.players);
        this.lobby = m.lobby;
        this.emit('welcome', m);
        break;
      case 'deny': this.emit('error', m.why); break;
      case 'lobby': this.lobby = m.lobby; this.roster(m.players); this.emit('lobby'); break;
      case 'start': this.game = m; this.emit('start', m); break;
      case 'S':
        for (const k in m.p) {
          const slot = +k, p = this.players.get(slot);
          if (p && slot !== this.slot) this.push(p, m.t, m.p[k]);
        }
        this.emit('S', m);
        break;
      case 'ev': this.emit('event', m.e); break;
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
    const before = new Set(this.players.keys());
    for (const p of list) {
      if (!this.players.has(p.slot)) { this.players.set(p.slot, this.player(p.slot, p.name, null)); this.emit('roster', p.slot, true); }
      const q = this.players.get(p.slot);
      q.name = p.name; q.ping = p.ping;
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
