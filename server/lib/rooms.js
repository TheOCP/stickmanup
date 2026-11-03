'use strict';
// Rooms and the relay. A room is one host phone plus up to three others. The host phone still runs the climb, exactly as
// in every other way of playing. The server finds the room, checks the password and passes messages along.
//
// On the socket, everything is text:
//   !{json}          a message for or from the server itself
//   id|payload       host and server: a message to or from player id
//   payload          player and server: a message to or from the host
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('../vendor/ws');
const { Limiter, SocketRate } = require('./limits');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const MAX_MESSAGE = 512 * 1024;
const MAX_BUFFERED = 4 * 1024 * 1024;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const scrypt = (pass, salt) => new Promise((res, rej) => crypto.scrypt(pass, salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
// What people can see of a name: no control characters or line breaks, a sensible length.
const cleanText = (s, max) => String(s == null ? '' : s).normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const small = (v) => (Number.isInteger(v) && v >= 0 && v < 64 ? v : 0);
// Faster than anything in the game can go, with room to spare. Respawns are one jump, not a pattern, so it takes several.
const MAX_SPEED = 60;
const MAX_FAST = 4;

class Rooms {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.sockets = new Set();
    // Who a token belongs to, whether they are shut out, and telling someone about what a room saw. All from server.js.
    this.who = opts.who || (() => null);
    this.isOff = opts.isOff || (() => null);
    this.onCheat = opts.onCheat || (() => {});
    this.ownsLook = opts.ownsLook || (() => true);
    this.roleOf = opts.roleOf || (() => '');
    this.needToken = opts.needToken || (() => false);
    this.ipKey = opts.ipKey || ((x) => x);
    this.perIp = new Map();
    this.ipRooms = new Map();
    this.maxSockets = opts.maxSockets || 5000;
    this.maxPerIp = opts.maxPerIp || 24;
    this.maxRooms = opts.maxRooms || 1000;
    this.maxRoomsPerIp = opts.maxRoomsPerIp || 4;
    this.createLimit = new Limiter(10, 10 / 60);
    this.joinLimit = new Limiter(30, 30 / 60);
    this.passLimit = new Limiter(6, 6 / 60);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false, clientTracking: false });
    this.beat = setInterval(() => this.heartbeat(), 25000);
    this.beat.unref();
    this.sweep = setInterval(() => { this.createLimit.sweep(); this.joinLimit.sweep(); this.passLimit.sweep(); }, 60000);
    this.sweep.unref();
  }

  upgrade(req, socket, head, ip) {
    const refuse = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (this.sockets.size >= this.maxSockets) return refuse(503, 'Server Full');
    if ((this.perIp.get(ip) || 0) >= this.maxPerIp) return refuse(429, 'Too Many Connections');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws, ip));
  }

  connected(ws, ip) {
    this.sockets.add(ws);
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    ws.ip = ip;
    ws.alive = true;
    ws.role = null;
    ws.room = null;
    ws.peerId = 0;
    ws.busy = false;
    ws.rate = new SocketRate(500, 250, 4 * 1024 * 1024, 2 * 1024 * 1024);
    ws.userId = null;
    ws.lastPos = null;
    ws.lastCheck = 0;
    ws.fast = 0;
    ws.warned = false;
    ws.lookAt = 0;
    ws.lookFlag = false;
    // Say what you came for quickly, or go.
    ws.helloTimer = setTimeout(() => { if (!ws.role) ws.close(4000, 'no hello'); }, 15000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => this.gone(ws));
    ws.on('message', (data, isBinary) => {
      ws.alive = true;
      if (isBinary) return ws.close(1003, 'text only');
      if (!ws.rate.take(data.length)) return ws.close(4008, 'too fast');
      // One odd message must never take everyone else's game down with it.
      try {
        this.message(ws, data.toString());
      } catch (e) {
        console.error('message failed:', e.message);
        ws.terminate();
      }
    });
  }

  message(ws, text) {
    if (text[0] === '!') return this.control(ws, text);
    // The room can already be gone while the last messages are still arriving.
    if (!ws.room) return;
    if (ws.role === 'host') {
      const i = text.indexOf('|');
      if (i < 1 || i > 8) return;
      const peer = ws.room.peers.get(+text.slice(0, i));
      const out = this.checkPlayers(ws, text.slice(i + 1));
      if (peer && out !== null) this.send(peer, out);
      this.watch(ws, text.slice(i + 1));
    } else if (ws.role === 'peer') {
      const out = this.checkPlayers(ws, text);
      if (out === null) return;
      this.watch(ws, out);
      this.send(ws.room.host, ws.peerId + '|' + out);
    }
  }

  // Items are bought on the server, and in a room that is where anyone else's copy comes from. Wearing what you don't own
  // reaches the others without it. A peer's own message says it directly, a host's is its line in the player list.
  // The flags are the server's word alone: whatever a phone says about them is replaced here, before anyone else sees it.
  checkPlayers(ws, text) {
    const host = ws.role === 'host';
    // Something written with escapes could be hiding what it really is, so those get read as well.
    const maybe = text.includes('\\u') || (host ? text.includes('players') : text.includes('hello') || text.includes('info'));
    if (!maybe) return text;
    let m;
    try { m = JSON.parse(text); } catch (e) { return text; }
    if (!m || typeof m !== 'object') return text;
    if (host ? !Array.isArray(m.players) : m.k !== 'hello' && m.k !== 'info') return text;
    const now = Date.now();
    if (!host && m.k === 'info' && now - ws.lookAt < 200) return null;
    ws.lookAt = now;
    const me = host ? m.players.find((p) => p && p.slot === 0) : m;
    if (ws.userId && me && me.look && !this.ownsLook(ws.userId, me.look)) {
      if (!ws.lookFlag) {
        ws.lookFlag = true;
        this.onCheat(ws.userId, 'look', 'Wearing items in a room that it does not own.', 5);
      }
      me.look = null;
    }
    if (host) this.stampAll(ws, m.players);
    else {
      ws.sentName = m.name ? String(m.name).slice(0, 14) : ws.sentName || 'Climber';
      m.role = this.flagOf(ws);
    }
    return JSON.stringify(m);
  }
  flagOf(ws) { return (ws.userId && this.roleOf(ws.userId)) || ''; }
  // A host can't lend out a flag either: a line only gets one if it really is that person, under the name they gave themselves.
  stampAll(host, players) {
    const seen = new Set();
    for (const p of players) {
      if (!p || typeof p !== 'object') continue;
      const who = p.slot === 0 ? host : host.room.peers.get(+p.id);
      const real = who && !seen.has(who) && (who === host || p.name === who.sentName);
      if (real) seen.add(who);
      p.role = real ? this.flagOf(who) : '';
      delete p.id;
    }
  }

  // A quick look at where someone says they are, a few times a second. The relay never changes what it passes on for this:
  // the climb's own rerun does the real checking, and this catches what is plain from here, like moving at 200 m/s.
  watch(ws, text) {
    if (!ws.userId || ws.warned) return;
    const now = Date.now();
    if (now - ws.lastCheck < 250 || text.length > 2000) return;
    const own = ws.role === 'host' ? text.startsWith('{"k":"S"') : text.startsWith('{"k":"st"');
    if (!own) return;
    ws.lastCheck = now;
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    const s = ws.role === 'host' ? m.p && m.p[0] : m.s;
    if (!Array.isArray(s) || s.length < 3) return;
    if (!s.slice(0, 6).every(Number.isFinite)) return this.caught(ws, 'room', 'Sent an impossible position in a room.', 30);
    if (ws.lastPos) {
      const dt = (now - ws.lastPos.t) / 1000, d = Math.hypot(s[0] - ws.lastPos.x, s[1] - ws.lastPos.y, s[2] - ws.lastPos.z);
      if (dt > 0.1 && dt < 3) {
        const v = d / dt;
        if (v > MAX_SPEED) {
          if (++ws.fast >= MAX_FAST) this.caught(ws, 'room', `Moving ${Math.round(v)} m/s in room ${ws.room.code}, over and over. Nothing in the game goes faster than about 20 m/s.`, 40);
        } else if (ws.fast > 0 && v < MAX_SPEED / 2) ws.fast--;
      }
    }
    ws.lastPos = { t: now, x: s[0], y: s[1], z: s[2] };
    if (Math.hypot(s[3] || 0, s[4] || 0, s[5] || 0) > 120) this.caught(ws, 'room', `Says it is moving at ${Math.round(Math.hypot(s[3], s[4], s[5]))} m/s in room ${ws.room.code}.`, 30);
  }
  caught(ws, kind, detail, score) {
    ws.warned = true;
    this.onCheat(ws.userId, kind, detail, score);
  }

  // Someone who can't keep up is dropped rather than filling the server's memory.
  send(ws, text) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED) return ws.terminate();
    ws.send(text);
  }

  tell(ws, o) { this.send(ws, '!' + JSON.stringify(o)); }
  err(ws, why, closeAfter = true) {
    this.tell(ws, { t: 'err', why });
    if (closeAfter) ws.close(1000);
  }

  control(ws, text) {
    if (text.length > 4096) return ws.close(1009, 'too long');
    let m;
    try { m = JSON.parse(text.slice(1)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!ws.role) {
      // Only one thing at a time while a password is being worked out.
      if (ws.busy) return;
      const off = this.isOff(ws.ip, typeof m.token === 'string' ? m.token : null);
      if (off) return this.err(ws, off);
      ws.userId = typeof m.token === 'string' ? this.who(m.token) : null;
      if (!ws.userId && this.needToken()) return this.err(ws, 'Please update StickManUp, and accept the terms in the game, to play on the server.');
      if (m.t === 'host') return this.host(ws, m).catch(() => this.err(ws, 'Could not open the room.'));
      if (m.t === 'join') return this.join(ws, m).catch(() => this.err(ws, 'Could not join the room.'));
      return;
    }
    if (ws.role === 'host' && ws.room) {
      const r = ws.room;
      if (m.t === 'info') {
        r.map = small(m.map);
        r.diff = small(m.diff);
        r.started = !!m.started;
      } else if (m.t === 'kick') {
        const peer = r.peers.get(m.id);
        if (peer) {
          this.tell(peer, { t: 'closed', why: 'The host removed you from the game.' });
          peer.close(1000);
        }
      }
    }
  }

  newCode() {
    for (let k = 0; k < 50; k++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }

  async host(ws, m) {
    const mine = this.ipRooms.get(ws.ip) || 0;
    if (!this.createLimit.take(ws.ip)) return this.err(ws, 'Too many rooms opened. Wait a minute and try again.');
    if (mine >= this.maxRoomsPerIp) return this.err(ws, 'You already have the most rooms open that one address may have.');
    if (this.rooms.size >= this.maxRooms) return this.err(ws, 'The server is full right now. Try again later.');
    if (!Number.isInteger(m.proto) || m.proto < 0) return this.err(ws, 'Update StickManUp to host here.');
    const pass = typeof m.pass === 'string' ? m.pass.slice(0, 64) : '';
    ws.busy = true;
    let salt = null, hash = null;
    if (pass) {
      salt = crypto.randomBytes(16);
      hash = await scrypt(pass, salt);
    }
    ws.busy = false;
    // Gone while the password was hashed.
    if (ws.readyState !== WebSocket.OPEN) return;
    const code = this.newCode();
    if (!code) return this.err(ws, 'The server is full right now. Try again later.');
    const hostName = cleanText(m.host, 14) || 'Climber';
    const room = {
      code, proto: m.proto, name: cleanText(m.name, 28) || `${hostName}'s climb`, hostName, pub: !!m.pub, salt, hash,
      map: small(m.map), diff: small(m.diff), started: false, host: ws, peers: new Map(), nextId: 1, created: Date.now(),
    };
    this.rooms.set(code, room);
    this.ipRooms.set(ws.ip, mine + 1);
    ws.role = 'host';
    ws.room = room;
    clearTimeout(ws.helloTimer);
    this.tell(ws, { t: 'hosted', code, name: room.name, pub: room.pub, locked: !!hash });
  }

  async join(ws, m) {
    if (!this.joinLimit.take(ws.ip)) return this.err(ws, 'Too many tries. Wait a minute and try again.');
    const code = typeof m.code === 'string' ? m.code.toUpperCase().slice(0, 5) : '';
    const room = this.rooms.get(code);
    if (!room) return this.err(ws, 'No game with that code.');
    if (m.proto !== room.proto) return this.err(ws, 'That game is on a different StickManUp version. Update both to the same release.');
    if (room.hash) {
      // Guessing is limited per address and room before any work is done, whether the guess turns out right or wrong.
      if (!this.passLimit.take(ws.ip + '/' + code)) return this.err(ws, 'Too many password tries. Wait a minute and try again.');
      const pass = typeof m.pass === 'string' ? m.pass.slice(0, 64) : '';
      ws.busy = true;
      const got = await scrypt(pass, room.salt);
      ws.busy = false;
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!crypto.timingSafeEqual(got, room.hash)) return this.err(ws, 'Wrong password.');
    }
    // The room can have closed or filled up while that was being worked out.
    if (this.rooms.get(code) !== room) return this.err(ws, 'That game has ended.');
    if (room.peers.size >= MAX_PLAYERS - 1) return this.err(ws, 'This game is full (4 climbers).');
    const id = room.nextId++;
    room.peers.set(id, ws);
    ws.role = 'peer';
    ws.room = room;
    ws.peerId = id;
    clearTimeout(ws.helloTimer);
    this.tell(ws, { t: 'joined', name: room.name });
    this.tell(room.host, { t: 'peer+', id });
  }

  gone(ws) {
    clearTimeout(ws.helloTimer);
    this.sockets.delete(ws);
    const n = (this.perIp.get(ws.ip) || 1) - 1;
    if (n > 0) this.perIp.set(ws.ip, n); else this.perIp.delete(ws.ip);
    const room = ws.room;
    if (!room) return;
    if (ws.role === 'host') {
      this.rooms.delete(room.code);
      const r = (this.ipRooms.get(ws.ip) || 1) - 1;
      if (r > 0) this.ipRooms.set(ws.ip, r); else this.ipRooms.delete(ws.ip);
      for (const peer of room.peers.values()) {
        this.tell(peer, { t: 'closed', why: 'The host left the game.' });
        peer.room = null;
        peer.close(1000);
      }
      room.peers.clear();
    } else if (ws.role === 'peer') {
      if (room.peers.delete(ws.peerId)) this.tell(room.host, { t: 'peer-', id: ws.peerId });
    }
  }

  heartbeat() {
    for (const ws of this.sockets) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }

  // ---------------------------------------------------------------- for the admins
  all() {
    const out = [];
    for (const r of this.rooms.values()) {
      const users = [r.host.userId, ...[...r.peers.values()].map((p) => p.userId)].filter(Boolean);
      out.push({ code: r.code, name: r.name, n: r.peers.size + 1, map: r.map, diff: r.diff, pub: r.pub, locked: !!r.hash, started: r.started, users });
    }
    return out;
  }
  closeRoom(code, why) {
    const r = this.rooms.get(code);
    if (!r) return false;
    this.tell(r.host, { t: 'closed', why });
    r.host.close(1000);
    return true;
  }
  // Out of whatever rooms they are in. A host going takes the room along, the same as when a host leaves.
  kickUser(id, why) {
    let n = 0;
    for (const ws of [...this.sockets]) {
      if (ws.userId !== id || !ws.room) continue;
      this.tell(ws, { t: 'closed', why });
      ws.close(1000);
      n++;
    }
    return n;
  }
  kickIp(ip, why) {
    let n = 0;
    for (const ws of [...this.sockets]) {
      if (this.ipKey(ws.ip) !== this.ipKey(ip)) continue;
      this.tell(ws, { t: 'closed', why });
      ws.close(1000);
      n++;
    }
    return n;
  }
  // Is anyone else in this person's room who could really be their partner?
  roomOf(id) {
    for (const r of this.rooms.values()) {
      const users = [r.host.userId, ...[...r.peers.values()].map((p) => p.userId)];
      if (users.includes(id)) return { code: r.code, users: users.filter(Boolean), n: users.length };
    }
    return null;
  }

  // The public rooms for this version of the game, newest first.
  list(proto, max = 200) {
    const out = [];
    for (const r of this.rooms.values()) {
      if (!r.pub || r.proto !== proto) continue;
      out.push({ code: r.code, name: r.name, host: r.hostName, n: r.peers.size + 1, max: MAX_PLAYERS, map: r.map, diff: r.diff, locked: !!r.hash, started: r.started, t: r.created });
    }
    out.sort((a, b) => b.t - a.t);
    return out.slice(0, max);
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.peers.size + 1;
    return { rooms: this.rooms.size, players };
  }

  stop() {
    clearInterval(this.beat);
    clearInterval(this.sweep);
    for (const ws of this.sockets) ws.terminate();
  }
}

module.exports = { Rooms, cleanText, CODE_CHARS };
