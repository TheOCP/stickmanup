'use strict';
// Friends: who asked whom, what everyone is doing right now, and who is watching whom.
//
// Two people are friends once one asked and the other said yes. Only then can either see what the other is doing.
// While the game is open it keeps one socket here, at /live, and says every few seconds what it is up to. That is only ever
// for showing to friends: nothing is paid on it, so a phone that lies about its height only fools its own friends.
//
// Watching: a phone only sends where its climbers are while somebody is watching it. The server passes that along to the
// watchers and nothing else, and it checks on every start that the two are friends and the climber allows it.
//
// On the socket, everything is JSON text:
//   hi        phone to server, first: its token and name
//   p         phone to server: what it is doing
//   watch     phone to server: start watching a friend, by player number
//   unwatch   phone to server: stop
//   g, s      climbing phone to watchers: who and where (the game, then many small updates)
//   watchers  server to climbing phone: who is watching (n and names), and whether to send at all (any)
//   over      server to watcher: there is nothing more to watch
//   cmd       a team member's phone to server: a line typed in the terminal. out (the answer) and act (do this) come back
//   list      a team member's phone to server: everyone in the game right now, and what they are doing
//   staff     server to phone: what this player may do, when it changes. roles: every role's tag and colour
//
// The team: someone allowed to /watch can watch anyone, and while vanished (/vanish) they are not in the list of who is
// watching, and their friends see them as offline. See staff.js.
const { WebSocketServer, WebSocket } = require('../vendor/ws');
const { Limiter, SocketRate } = require('./limits');

const MAX_FRIENDS = 200, MAX_ASKED = 50, MAX_WATCHERS = 8, MAX_MESSAGE = 32 * 1024, MAX_BUFFERED = 512 * 1024;
const MAX_SOCKETS = 20000, MAX_PER_IP = 64;
const ASKED = 0, FRIENDS = 1, DECLINED = 2;
// A socket that has said nothing for this long is still there, but no longer knows what it is doing.
const STALE = 60000;
const OLD_ASK = 90 * 86400000;

const int = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo);
const STATES = new Set(['menu', 'lobby', 'climb', 'watch']);

// What a phone says about itself, cut down to what can reach another player's screen.
function cleanPresence(p) {
  const st = STATES.has(p.st) ? p.st : 'menu', o = { st };
  if (st === 'lobby' || st === 'climb') {
    o.map = int(p.map, 0, 63);
    o.diff = int(p.diff, 0, 63);
    o.n = int(p.n, 1, 4);
    const r = p.room;
    if (r && typeof r === 'object' && (r.kind === 'server' || r.kind === 'online') && /^[A-Z0-9]{5}$/.test(String(r.code))) o.room = { kind: r.kind, code: String(r.code), locked: !!r.locked };
  }
  if (st === 'climb') {
    o.h = int(p.h, 0, 99999);
    o.top = int(p.top, 0, 99999);
    o.T = int(p.T, 0, 1e8);
    o.f = int(p.f, 0, 1e7);
    o.solo = !!p.solo;
    o.paused = !!p.paused;
    o.won = !!p.won;
  }
  return o;
}

// A Discord, Steam or Google name stays private. Players are known by the name they play under.
const shownName = (u) => u.game_name || (/^Guest \d+$/.test(u.name) ? u.name : '');

class Friends {
  constructor(db, admin, rooms, staff) {
    this.db = db;
    this.admin = admin;
    this.rooms = rooms;
    this.staff = staff;
    this.terminal = null;
    this.wheres = new Map();
    this.whereNo = 0;
    const d = db.db;
    d.exec(`
      CREATE TABLE IF NOT EXISTS friends (
        a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state INTEGER NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE INDEX IF NOT EXISTS friends_b ON friends(b);
    `);
    const have = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!have.has('no_watch')) d.exec('ALTER TABLE users ADD COLUMN no_watch INTEGER NOT NULL DEFAULT 0');
    const q = (s) => d.prepare(s);
    const WHO = 'u.id, u.num, u.name, u.game_name, u.last_seen, u.no_watch';
    this.q = {
      me: q('SELECT id, num, name, game_name, no_watch, role FROM users WHERE id = ?'),
      byNum: q('SELECT id, num, name, game_name, no_watch, role FROM users WHERE num = ?'),
      search: q(`SELECT ${WHO} FROM users u WHERE u.game_name LIKE ? ESCAPE '\\' OR (u.game_name IS NULL AND u.name LIKE 'Guest %' AND u.name LIKE ? ESCAPE '\\')
        ORDER BY u.game_name = ? COLLATE NOCASE DESC, u.last_seen DESC LIMIT 25`),
      pair: q('SELECT a, b, state FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)'),
      put: q('INSERT OR REPLACE INTO friends (a, b, state, at) VALUES (?, ?, ?, ?)'),
      setState: q('UPDATE friends SET state = ?, at = ? WHERE a = ? AND b = ?'),
      drop: q('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)'),
      friends: q(`SELECT ${WHO}, f.at, u.climbs, (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id AND r.won = 1) AS wins
        FROM friends f JOIN users u ON u.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END WHERE f.state = ${FRIENDS} AND (f.a = ? OR f.b = ?)`),
      friendIds: q(`SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friends WHERE state = ${FRIENDS} AND (a = ? OR b = ?)`),
      asks: q(`SELECT ${WHO}, f.at FROM friends f JOIN users u ON u.id = f.a WHERE f.b = ? AND f.state = ${ASKED} ORDER BY f.at DESC LIMIT ${MAX_ASKED}`),
      asked: q(`SELECT ${WHO}, f.at FROM friends f JOIN users u ON u.id = f.b WHERE f.a = ? AND f.state = ${ASKED} ORDER BY f.at DESC LIMIT ${MAX_ASKED}`),
      countFriends: q(`SELECT COUNT(*) AS n FROM friends WHERE state = ${FRIENDS} AND (a = ? OR b = ?)`),
      countAsks: q(`SELECT COUNT(*) AS n FROM friends WHERE b = ? AND state = ${ASKED}`),
      countAsked: q(`SELECT COUNT(*) AS n FROM friends WHERE a = ? AND state = ${ASKED}`),
      setNoWatch: q('UPDATE users SET no_watch = ? WHERE id = ?'),
      oldAsks: q(`DELETE FROM friends WHERE state != ${FRIENDS} AND at < ?`),
      allOf: q('SELECT a, b, state, at FROM friends WHERE a = ? OR b = ?'),
      dropAll: q('DELETE FROM friends WHERE a = ? OR b = ?'),
    };
    this.live = new Map();
    this.sockets = new Set();
    this.perIp = new Map();
    this.askLimit = new Limiter(30, 30 / 3600);
    this.findLimit = new Limiter(30, 0.5);
    this.inviteLimit = new Limiter(12, 12 / 600);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false, clientTracking: false });
    this.beat = setInterval(() => this.heartbeat(), 25000);
    this.beat.unref();
    this.sweep = setInterval(() => { this.askLimit.sweep(); this.findLimit.sweep(); this.inviteLimit.sweep(); }, 60000);
    this.sweep.unref();
  }

  // ---------------------------------------------------------------- the list
  pairOf(a, b) { return this.q.pair.get(a, b, b, a) || null; }
  isFriend(a, b) { const p = this.pairOf(a, b); return !!p && p.state === FRIENDS; }
  friendIds(id) { return this.q.friendIds.all(id, id, id).map((r) => r.id); }
  isBanned(id) { return !!this.admin.banOf(id); }

  // What a friend gets to see about what someone is doing. Someone vanished is not there.
  now(id) { return this.vanished(id) ? { st: 'off' } : this.presence(id); }
  vanished(id) { return !!this.staff && this.staff.vanished(id); }
  // What someone is really doing, for the team.
  presence(id) {
    const ws = this.live.get(id);
    if (!ws || !ws.pres) return { st: 'off' };
    const t = Date.now();
    if (t - ws.presAt > STALE) return { st: 'menu' };
    const o = Object.assign({}, ws.pres);
    // The climb went on since the phone last said.
    if (o.st === 'climb' && !o.paused && !o.won) o.T += Math.floor((t - ws.presAt) / 1000);
    return o;
  }

  card(u) {
    const o = Object.assign(this.now(u.id), { num: u.num, name: shownName(u), climbs: u.climbs || 0, wins: u.wins || 0 });
    o.canWatch = o.st === 'climb' && !u.no_watch;
    // Vanished: last seen when they vanished, not just now.
    if (o.st === 'off') o.ago = Math.max(0, Date.now() - (this.vanished(u.id) ? this.staff.vanishedAt(u.id) : u.last_seen || 0));
    return o;
  }

  list(me) {
    const u = this.q.me.get(me);
    return {
      me: { num: u.num, name: shownName(u), watch: !u.no_watch },
      friends: this.q.friends.all(me, me, me).filter((f) => !this.isBanned(f.id)).map((f) => this.card(f)),
      asks: this.q.asks.all(me).filter((f) => !this.isBanned(f.id)).map((f) => ({ num: f.num, name: shownName(f) })),
      asked: this.q.asked.all(me).map((f) => ({ num: f.num, name: shownName(f) })),
    };
  }

  search(me, text) {
    if (!this.findLimit.take(me)) return { err: 'Too many searches. Wait a moment and try again.' };
    const t = String(text == null ? '' : text).normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 32), found = new Map();
    const add = (u) => { if (u && !found.has(u.id) && !this.isBanned(u.id)) found.set(u.id, u); };
    const num = /^#?\s*(\d{1,12})$/.exec(t);
    if (num) add(this.q.byNum.get(+num[1]));
    if (t.length >= 2) {
      const like = '%' + t.replace(/[\\%_]/g, '\\$&') + '%';
      for (const u of this.q.search.all(like, like, t)) add(u);
    }
    return { found: [...found.values()].slice(0, 25).map((u) => ({ num: u.num, name: shownName(u), rel: this.relation(me, u.id) })) };
  }

  relation(me, id) {
    if (me === id) return 'me';
    const p = this.pairOf(me, id);
    if (!p) return '';
    if (p.state === FRIENDS) return 'friend';
    if (p.a === me) return 'asked';
    return p.state === ASKED ? 'asks' : '';
  }

  // ---------------------------------------------------------------- asking, answering, leaving
  act(me, what, num) {
    const other = Number.isInteger(num) ? this.q.byNum.get(num) : null;
    if (!other || (this.isBanned(other.id) && what !== 'remove' && what !== 'cancel' && what !== 'decline')) return { err: 'No player has that ID.' };
    if (other.id === me) return { err: 'That is your own ID.' };
    const p = this.pairOf(me, other.id), mine = this.q.me.get(me), t = Date.now();
    if (what === 'add') {
      if (p && p.state === FRIENDS) return { ok: true };
      // They asked first, so this is a yes, even after saying no earlier.
      if (p && p.a === other.id) return this.becomeFriends(me, mine, other, t);
      // Already asked, or told no: asking again changes nothing and bothers nobody.
      if (p) return { ok: true };
      if (this.q.countFriends.get(me, me).n >= MAX_FRIENDS) return { err: 'Your friends list is full.' };
      if (this.q.countAsked.get(me).n >= MAX_ASKED) return { err: 'You have asked too many people. Wait for some answers first.' };
      if (!this.askLimit.take(me)) return { err: 'Too many requests. Try again later.' };
      this.q.put.run(me, other.id, ASKED, t);
      this.tell(other.id, { t: 'req', num: mine.num, name: shownName(mine) });
      this.pushCount(other.id);
      return { ok: true };
    }
    if (what === 'accept') {
      if (!p || p.a !== other.id || p.state === FRIENDS) return { err: 'That request is gone.' };
      return this.becomeFriends(me, mine, other, t);
    }
    if (what === 'decline') {
      if (p && p.a === other.id && p.state === ASKED) this.q.setState.run(DECLINED, t, other.id, me);
      this.pushCount(me);
      return { ok: true };
    }
    if (what === 'cancel') {
      if (p && p.a === me && p.state === ASKED) { this.q.drop.run(me, other.id, other.id, me); this.pushCount(other.id); }
      return { ok: true };
    }
    if (what === 'remove') {
      if (p && p.state === FRIENDS) {
        this.q.drop.run(me, other.id, other.id, me);
        this.stopBetween(me, other.id);
        this.pushCount(me);
        this.pushCount(other.id);
      }
      return { ok: true };
    }
    return { err: 'Bad request' };
  }

  becomeFriends(me, mine, other, t) {
    if (this.q.countFriends.get(me, me).n >= MAX_FRIENDS) return { err: 'Your friends list is full.' };
    if (this.q.countFriends.get(other.id, other.id).n >= MAX_FRIENDS) return { err: 'Their friends list is full.' };
    this.q.drop.run(me, other.id, other.id, me);
    this.q.put.run(other.id, me, FRIENDS, t);
    this.tell(other.id, { t: 'friend', num: mine.num, name: shownName(mine) });
    this.pushCount(me);
    this.pushCount(other.id);
    return { ok: true };
  }

  setWatch(me, allow) {
    this.q.setNoWatch.run(allow ? 0 : 1, me);
    const ws = this.live.get(me);
    if (!allow && ws) this.endWatchers(ws, 'closed');
    return { ok: true };
  }

  // A guest who signs in brings their friends along.
  moveGuest(from, to) {
    for (const r of this.q.allOf.all(from, from)) {
      const a = r.a === from ? to : r.a, b = r.b === from ? to : r.b;
      if (a === b || this.pairOf(a, b)) continue;
      this.q.put.run(a, b, r.state, r.at);
    }
    this.q.dropAll.run(from, from);
  }

  cleanup() { this.q.oldAsks.run(Date.now() - OLD_ASK); }

  // ---------------------------------------------------------------- the socket
  upgrade(req, socket, head, ip) {
    const refuse = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (this.sockets.size >= MAX_SOCKETS) return refuse(503, 'Server Full');
    if ((this.perIp.get(ip) || 0) >= MAX_PER_IP) return refuse(429, 'Too Many Connections');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws, ip));
  }

  connected(ws, ip) {
    this.sockets.add(ws);
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    ws.ip = ip;
    ws.alive = true;
    ws.uid = null;
    ws.pres = null;
    ws.presAt = 0;
    ws.target = null;
    ws.watchers = new Set();
    ws.rate = new SocketRate(200, 60, 1024 * 1024, 256 * 1024);
    ws.helloTimer = setTimeout(() => { if (!ws.uid) ws.close(4000, 'no hello'); }, 15000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => this.gone(ws));
    ws.on('message', (data, isBinary) => {
      ws.alive = true;
      if (isBinary) return ws.close(1003, 'text only');
      if (!ws.rate.take(data.length)) return;
      // One odd message must never take anyone else down with it.
      try {
        this.message(ws, data.toString());
      } catch (e) {
        console.error('live message failed:', e.message);
        ws.terminate();
      }
    });
  }

  sendText(ws, text) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(text);
  }
  send(ws, o) { this.sendText(ws, JSON.stringify(o)); }
  tell(id, o) { const ws = this.live.get(id); if (ws) this.send(ws, o); }

  // Where someone is on their climb right now. Only their own game knows: null if it doesn't say in time.
  askWhere(id, ms = 3000) {
    const ws = this.live.get(id);
    if (!ws) return Promise.resolve(null);
    return new Promise((done) => {
      const q = ++this.whereNo;
      const end = (p) => { clearTimeout(t); this.wheres.delete(q); done(p); };
      const t = setTimeout(() => end(null), ms);
      this.wheres.set(q, { id, end });
      this.send(ws, { t: 'where', q });
    });
  }
  hereIs(ws, m) {
    const w = this.wheres.get(m.q), p = m.pos;
    if (!w || w.id !== ws.uid) return;
    const ok = Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e5);
    w.end(ok ? { map: int(m.map, 0, 63), diff: int(m.diff, 0, 63), pos: p } : null);
  }

  message(ws, text) {
    if (!ws.uid) return this.hello(ws, text);
    // Passed along as it came. Watchers check it themselves, like everything else a stranger's phone sends.
    if (text.startsWith('{"t":"s"') || text.startsWith('{"t":"g"')) {
      for (const w of ws.watchers) this.sendText(w, text);
      return;
    }
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'p') {
      ws.pres = cleanPresence(m);
      ws.presAt = Date.now();
      if (typeof m.name === 'string' && m.name !== ws.gameName) { ws.gameName = m.name; this.admin.setGameName(ws.uid, m.name); }
      if (ws.watchers.size) {
        const note = this.roomNote(ws), key = JSON.stringify(note);
        if (key !== ws.roomSaid) { ws.roomSaid = key; for (const w of ws.watchers) this.send(w, note); }
      }
      if (ws.pres.st !== 'climb') this.endWatchers(ws, 'ended');
    } else if (m.t === 'watch') this.watch(ws, m.num);
    else if (m.t === 'unwatch') this.stopWatching(ws);
    else if (m.t === 'invite') this.invite(ws, m.num, m.pass);
    else if (m.t === 'cmd' && this.terminal) this.terminal.run(ws, m, (o) => this.send(ws, o)).catch((e) => console.error('terminal:', e.message));
    else if (m.t === 'list') this.staffList(ws);
    else if (m.t === 'here') this.hereIs(ws, m);
  }

  hello(ws, text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return ws.close(4000, 'bad hello'); }
    if (!m || m.t !== 'hi' || typeof m.token !== 'string') return ws.close(4000, 'bad hello');
    const off = this.rooms.isOff(ws.ip, m.token);
    if (off) { this.send(ws, { t: 'off', why: off }); return ws.close(4003, 'off'); }
    const id = this.db.sessionUser(m.token), u = id ? this.q.me.get(id) : null;
    if (!u) { this.send(ws, { t: 'bad' }); return ws.close(4001, 'no account'); }
    clearTimeout(ws.helloTimer);
    // One phone at a time for each account: the newest one is the one being played.
    const old = this.live.get(id);
    if (old) { this.send(old, { t: 'replaced' }); old.close(4002, 'replaced'); }
    ws.uid = id;
    ws.num = u.num;
    if (typeof m.name === 'string') { ws.gameName = m.name; this.admin.setGameName(id, m.name); }
    this.live.set(id, ws);
    this.admin.seen(id, ws.ip);
    const ok = { t: 'ok', num: u.num, name: shownName(this.q.me.get(id)) };
    if (this.staff) {
      ok.roles = this.staff.table();
      const st = this.staffInfo(id);
      if (st) ok.staff = st;
    }
    this.send(ws, ok);
    this.pushCount(id);
    for (const f of this.friendIds(id)) this.pushCount(f);
  }

  // ---------------------------------------------------------------- the team
  staffInfo(id) {
    const u = this.admin.info(id), st = u && this.staff.infoFor(u);
    if (st && this.terminal) st.menu = this.terminal.menu(u);
    return st;
  }
  // Someone's powers changed: their game hears it now. Without an id, everyone's (a role changed).
  staffChanged(id) {
    if (!this.staff) return;
    const tell = (ws) => this.send(ws, { t: 'staff', staff: this.staffInfo(ws.uid) });
    if (id) { const ws = this.live.get(id); if (ws) tell(ws); return; }
    for (const ws of this.live.values()) tell(ws);
  }
  // Every map has more coins now, or fewer (/coinboost): every game hears it straight away (the title says so).
  coinsChanged(x) {
    const msg = JSON.stringify({ t: 'coinx', x });
    for (const ws of this.live.values()) this.sendText(ws, msg);
  }
  rolesChanged() {
    const msg = JSON.stringify({ t: 'roles', roles: this.staff.table() });
    for (const ws of this.live.values()) this.sendText(ws, msg);
    this.staffChanged(null);
  }
  vanishChanged(id) {
    for (const f of this.friendIds(id)) this.pushCount(f);
    const ws = this.live.get(id);
    if (!ws) return;
    // Watching right now: from now on seen or not seen.
    if (ws.target) { ws.silent = !!ws.teamWatch && this.vanished(id); this.tellWatchers(ws.target); }
    this.staffChanged(id);
  }
  // Everyone in the game right now, climbing first.
  everyone() {
    const order = { climb: 0, lobby: 1, watch: 2, menu: 3, off: 4 }, out = [];
    for (const [id, ws] of this.live) out.push({ id, ws, p: this.presence(id), vanished: this.vanished(id) });
    return out.sort((a, b) => order[a.p.st] - order[b.p.st] || (b.p.h || 0) - (a.p.h || 0));
  }
  staffList(ws) {
    const me = this.admin.info(ws.uid);
    if (!this.staff || !this.staff.can(me, 'online')) return this.send(ws, { t: 'list', err: 'You may not see who is online.' });
    const players = this.everyone().slice(0, 300).map(({ id, p, vanished }) => {
      const u = this.q.me.get(id);
      return u ? Object.assign({}, p, { num: u.num, name: shownName(u) || `#${u.num}`, role: u.role || '', vanished, me: id === ws.uid, watched: this.live.get(id).watchers.size }) : null;
    }).filter(Boolean);
    this.send(ws, { t: 'list', players, rooms: this.rooms.stats() });
  }

  gone(ws) {
    this.sockets.delete(ws);
    clearTimeout(ws.helloTimer);
    const n = (this.perIp.get(ws.ip) || 1) - 1;
    if (n > 0) this.perIp.set(ws.ip, n); else this.perIp.delete(ws.ip);
    this.stopWatching(ws);
    this.endWatchers(ws, 'left');
    if (ws.uid && this.live.get(ws.uid) === ws) {
      this.live.delete(ws.uid);
      for (const f of this.friendIds(ws.uid)) this.pushCount(f);
    }
  }

  // How many friends are on, and how many people are waiting for an answer. For the button on the main menu.
  pushCount(id) {
    const ws = this.live.get(id);
    if (!ws) return;
    let on = 0;
    for (const f of this.friendIds(id)) if (this.live.has(f) && !this.vanished(f)) on++;
    this.send(ws, { t: 'count', on, req: this.q.countAsks.get(id).n });
  }

  // ---------------------------------------------------------------- watching
  // Asking a friend along: only to the room this phone says it is in, with a free spot, and only a friend who is online. The
  // password of a locked room comes along when the one asking knows it, so the friend gets straight in.
  invite(ws, num, pass) {
    const fail = (why) => this.send(ws, { t: 'inviteErr', why });
    if (!this.inviteLimit.take(ws.uid)) return fail('Too many invites. Wait a moment and try again.');
    const u = Number.isInteger(num) ? this.q.byNum.get(num) : null;
    if (!u || u.id === ws.uid || !this.isFriend(ws.uid, u.id) || this.isBanned(u.id)) return fail('You can only invite your friends.');
    const p = ws.pres, room = p && (p.st === 'climb' || p.st === 'lobby') && Date.now() - ws.presAt < STALE ? p.room : null;
    if (!room) return fail('Host or join a game first, then invite your friends to it.');
    if ((p.n || 1) >= 4) return fail('Your game is full.');
    const to = this.live.get(u.id), name = shownName(u);
    if (!to || this.vanished(u.id)) return fail(name ? `${name} is not online.` : 'Your friend is not online.');
    const me = this.q.me.get(ws.uid);
    const out = { t: 'invite', num: me.num, name: shownName(me), room: Object.assign({}, room), map: p.map, diff: p.diff, n: p.n || 1 };
    if (room.locked && room.kind === 'server' && typeof pass === 'string' && pass.length <= 64) out.pass = pass;
    this.send(to, out);
    this.send(ws, { t: 'invited', num: u.num, name });
  }

  watch(ws, num) {
    this.stopWatching(ws);
    const fail = (why) => this.send(ws, { t: 'err', why });
    const u = Number.isInteger(num) ? this.q.byNum.get(num) : null;
    // The team can watch anyone below their own rank, friend or not, and whatever their privacy setting says.
    const me = this.staff ? this.admin.info(ws.uid) : null;
    const team = !!(u && me && u.id !== me.id && this.staff.can(me, 'watch') && this.staff.outranks(me, u));
    if (!u || (!team && !this.isFriend(ws.uid, u.id))) return fail('You can only watch your friends.');
    if (u.no_watch && !team) return fail('This friend does not allow watching.');
    const target = this.live.get(u.id);
    if (!target || !target.pres || target.pres.st !== 'climb') return fail(team ? 'They are not climbing right now.' : 'This friend is not climbing right now.');
    if (target.watchers.size >= MAX_WATCHERS && !team) return fail('Too many people are watching this climb.');
    target.watchers.add(ws);
    ws.target = target;
    ws.teamWatch = team;
    ws.silent = team && this.vanished(ws.uid);
    this.send(ws, { t: 'watching', num: u.num, name: shownName(u) });
    this.send(ws, this.roomNote(target));
    this.tellWatchers(target);
  }

  // The room the climber watched is in, as their game says, so whoever watches can join them (the game's Join button).
  roomNote(target) {
    const p = target.pres, r = p && (p.st === 'climb' || p.st === 'lobby') && p.room ? p.room : null;
    return { t: 'wroom', room: r ? Object.assign({}, r) : null, n: (p && p.n) || 1 };
  }

  // The climbing phone starts or stops sending, and it can say who is looking.
  // Someone vanished watching is not counted, but the phone still has to send (any).
  tellWatchers(target) {
    const names = [];
    let n = 0;
    for (const w of target.watchers) {
      if (w.silent) continue;
      n++;
      const u = this.q.me.get(w.uid);
      if (u) names.push(shownName(u) || `#${u.num}`);
    }
    this.send(target, { t: 'watchers', n, names, any: target.watchers.size });
  }

  stopWatching(ws) {
    const target = ws.target;
    if (!target) return;
    ws.target = null;
    ws.silent = false;
    ws.teamWatch = false;
    target.watchers.delete(ws);
    this.tellWatchers(target);
  }

  endWatchers(target, why) {
    if (!target.watchers.size) return;
    for (const w of target.watchers) {
      w.target = null;
      this.send(w, { t: 'over', why });
    }
    target.watchers.clear();
    this.tellWatchers(target);
  }

  // No longer friends: no longer watching, either way round.
  stopBetween(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const w = this.live.get(x), t = this.live.get(y);
      if (w && t && w.target === t) {
        this.stopWatching(w);
        this.send(w, { t: 'over', why: 'closed' });
      }
    }
  }

  // ---------------------------------------------------------------- housekeeping
  kickUser(id, why) {
    const ws = this.live.get(id);
    if (!ws) return;
    this.send(ws, { t: 'off', why });
    ws.close(4003, 'off');
  }

  kickIp(ip, why) {
    const key = this.rooms.ipKey(ip);
    for (const ws of this.sockets) {
      if (this.rooms.ipKey(ws.ip) !== key) continue;
      this.send(ws, { t: 'off', why });
      ws.close(4003, 'off');
    }
  }

  heartbeat() {
    for (const ws of this.sockets) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch (e) {}
    }
  }

  stop() {
    clearInterval(this.beat);
    clearInterval(this.sweep);
    for (const ws of this.sockets) { try { ws.close(1001, 'stopping'); } catch (e) {} }
  }
}

module.exports = { Friends };
