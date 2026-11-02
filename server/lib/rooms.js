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

class Rooms {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.sockets = new Set();
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
      if (peer) this.send(peer, text.slice(i + 1));
    } else if (ws.role === 'peer') {
      this.send(ws.room.host, ws.peerId + '|' + text);
    }
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
