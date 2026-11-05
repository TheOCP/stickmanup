'use strict';
// Graffiti: what the climbers sprayed on each map (the pictures are in the game, assets/js/sprays.js). The server keeps the
// latest few of every player on every map, so whoever climbs there later sees them too. Only ever pictures from the game's
// own list, never any text, and only ones the player owns.
//
//   POST /api/spray            one of yours: map, lv (the game's LEVEL_VERSION), id, x y z, nx ny nz (the way the surface
//                              faces), r (how it is turned), w (how big)
//   GET  /api/sprays?map=&lv=  the latest ones on a map, for that version of it (a new version moves the walls they were on)
const catalog = require('./catalog.json');
const { Limiter } = require('./limits');

const PER_PLAYER = 6, SHOW = 160, MAX_MAP = 10000;
const num = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

class Sprays {
  constructor(db, wallet) {
    this.d = db.db;
    this.wallet = wallet;
    this.limit = new Limiter(6, 1 / 3);
    this.ids = new Set(catalog.sprays || []);
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS sprays (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map INTEGER NOT NULL, lv INTEGER NOT NULL, item TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, nx REAL NOT NULL, ny REAL NOT NULL, nz REAL NOT NULL, r REAL NOT NULL, w REAL NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sprays_map ON sprays(map, lv, n);
      CREATE INDEX IF NOT EXISTS sprays_user ON sprays(user_id, map);
    `);
    const q = (s) => this.d.prepare(s);
    this.q = {
      add: q('INSERT INTO sprays (user_id, map, lv, item, x, y, z, nx, ny, nz, r, w, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      mine: q('SELECT n FROM sprays WHERE user_id = ? AND map = ? ORDER BY n DESC'),
      del: q('DELETE FROM sprays WHERE n = ?'),
      list: q('SELECT item, x, y, z, nx, ny, nz, r, w FROM sprays WHERE map = ? AND lv = ? ORDER BY n DESC LIMIT ?'),
      wipe: q('DELETE FROM sprays WHERE user_id = ?'),
    };
  }

  // { status, err } for one of yours.
  add(userId, b) {
    if (!this.limit.take(userId)) return { status: 429, err: 'Too many' };
    const map = b.map, lv = b.lv, id = b.id;
    if (!Number.isInteger(map) || map < 0 || map > MAX_MAP || !Number.isInteger(lv) || lv < 0 || lv > 100000) return { status: 400, err: 'Bad map' };
    if (typeof id !== 'string' || !this.ids.has(id)) return { status: 400, err: 'No such picture' };
    if (Object.hasOwn(catalog.items, id) && !this.wallet.get(userId).own.includes(id)) return { status: 403, err: 'Not yours' };
    if (![b.x, b.y, b.z].every((v) => num(v, 5000)) || ![b.nx, b.ny, b.nz, b.r].every((v) => num(v, 10)) || !num(b.w, 2)) return { status: 400, err: 'Bad place' };
    const l = Math.hypot(b.nx, b.ny, b.nz);
    if (l < 0.5) return { status: 400, err: 'Bad place' };
    this.q.add.run(userId, map, lv, id, b.x, b.y, b.z, b.nx / l, b.ny / l, b.nz / l, b.r, Math.max(0.5, b.w), Date.now());
    // Only your latest few on each map.
    const mine = this.q.mine.all(userId, map);
    for (const row of mine.slice(PER_PLAYER)) this.q.del.run(row.n);
    return { status: 200 };
  }

  list(map, lv) {
    if (!Number.isInteger(map) || !Number.isInteger(lv)) return [];
    return this.q.list.all(map, lv, SHOW).map((s) => ({ id: s.item, x: s.x, y: s.y, z: s.z, nx: s.nx, ny: s.ny, nz: s.nz, r: s.r, w: s.w }));
  }

  // All of a player's, gone (the team's /clearsprays).
  wipe(userId) { return Number(this.q.wipe.run(userId).changes || 0); }
}

module.exports = { Sprays };
