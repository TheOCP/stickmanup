'use strict';
// Ghost racing: everyone's best climb of each map and difficulty, for the game to play back beside them (assets/js/ghost.js).
// Only for the eyes, so nothing is paid on it. A climb is four places a second, each five 16 bit numbers, in base64.
//
//   POST /api/ghost               your climb: map, diff, won, t (seconds), h (highest metres), data. Kept if it beats your best.
//   GET  /api/ghosts?map=&diff=&room=
//                                 yours, the others' in your room (when you are in it), and your friends' best ones
const HZ = 4, N = 5, MAX_T = 40 * 60, MAX_DATA = Math.ceil((MAX_T * HZ * N * 2 * 4) / 3) + 8, FRIENDS = 5;

const better = (a, b) => !!a && (!b || (a.won && !b.won) || (!!a.won === !!b.won && (a.won ? a.t < b.t - 0.05 : a.h > b.h + 0.5)));

class Ghosts {
  constructor(db, friends, rooms) {
    this.db = db;
    this.d = db.db;
    this.friends = friends;
    this.rooms = rooms;
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS ghosts (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map INTEGER NOT NULL, diff INTEGER NOT NULL, won INTEGER NOT NULL, t REAL NOT NULL, h REAL NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (user_id, map, diff)
      );
    `);
    const q = (s) => this.d.prepare(s);
    this.q = {
      get: q('SELECT won, t, h, data FROM ghosts WHERE user_id = ? AND map = ? AND diff = ?'),
      head: q('SELECT won, t, h FROM ghosts WHERE user_id = ? AND map = ? AND diff = ?'),
      put: q('INSERT OR REPLACE INTO ghosts (user_id, map, diff, won, t, h, data, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    };
  }

  put(userId, b) {
    const map = b.map, diff = b.diff, won = b.won === true, t = b.t, h = b.h, data = b.data;
    if (!Number.isInteger(map) || map < 0 || map > 10000 || !Number.isInteger(diff) || diff < 0 || diff > 3) return { status: 400, err: 'Bad map' };
    if (typeof t !== 'number' || !(t > 1 && t <= MAX_T) || typeof h !== 'number' || !(h >= 0 && h <= 1200)) return { status: 400, err: 'Bad climb' };
    if (typeof data !== 'string' || data.length > MAX_DATA || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return { status: 400, err: 'Bad climb' };
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length % (N * 2)) return { status: 400, err: 'Bad climb' };
    // As many places as the time says: four a second.
    const n = bytes.length / (N * 2);
    if (n < HZ * 5 || n > t * HZ + HZ * 3 || (won && n < t * HZ - HZ * 3)) return { status: 400, err: 'Bad climb' };
    // The highest place in it is the height it says.
    let top = -1e9;
    for (let i = 0; i < n; i++) top = Math.max(top, bytes.readInt16LE(i * N * 2 + 2) / 32);
    if (Math.abs(top - h) > 1.5) return { status: 400, err: 'Bad climb' };
    const was = this.q.head.get(userId, map, diff), got = { won, t, h };
    if (was && !better(got, { won: !!was.won, t: was.t, h: was.h })) return { status: 200, kept: false };
    this.q.put.run(userId, map, diff, won ? 1 : 0, t, h, data, Date.now());
    return { status: 200, kept: true };
  }

  list(me, map, diff, roomCode) {
    if (!Number.isInteger(map) || !Number.isInteger(diff)) return [];
    const out = [], seen = new Set();
    const add = (id, how) => {
      if (seen.has(id)) return;
      const g = this.q.get.get(id, map, diff);
      if (!g) return;
      seen.add(id);
      const u = this.db.user(id);
      out.push({ key: id === me ? 'me' : 'u' + String(id).slice(0, 10), name: id === me ? '' : String((u && (u.game_name || u.name)) || 'Climber').slice(0, 20), how, won: !!g.won, t: g.t, h: g.h, data: g.data });
    };
    add(me, 'me');
    // The others in your room, only while you are in it too.
    const r = roomCode && this.rooms ? this.rooms.all().find((x) => x.code === String(roomCode).toUpperCase()) : null;
    if (r && r.users.includes(me)) for (const id of r.users) add(id, 'room');
    // Your friends' best few.
    if (this.friends) {
      const f = [];
      for (const id of this.friends.friendIds(me)) {
        if (seen.has(id)) continue;
        const g = this.q.head.get(id, map, diff);
        if (g) f.push([id, { won: !!g.won, t: g.t, h: g.h }]);
      }
      f.sort((a, b) => (better(a[1], b[1]) ? -1 : better(b[1], a[1]) ? 1 : 0));
      for (const [id] of f.slice(0, FRIENDS)) add(id, 'friend');
    }
    return out;
  }
}

module.exports = { Ghosts, better };
