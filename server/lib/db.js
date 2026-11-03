'use strict';
// Accounts, sessions and saves in one SQLite file (built into Node, nothing to install or run beside it).
// Session tokens are only stored as a hash, so a copy of this file can't be used to sign in as anyone.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DAY = 86400000;
const SESSION_DAYS = 180;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

class DB {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.dir = dataDir;
    this.file = path.join(dataDir, 'stickmanup.db');
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        tos_version TEXT,
        tos_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (provider, subject)
      );
      CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS saves (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        rev INTEGER NOT NULL,
        data TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
    // Servers from before these existed get them added. Nothing already there changes.
    const have = new Set(this.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    for (const [col, def] of [['num', 'INTEGER'], ['last_ip', 'TEXT'], ['game_name', 'TEXT'], ['device', 'TEXT'], ['last_played', 'INTEGER'], ['last_map', 'INTEGER'], ['last_diff', 'INTEGER'], ['last_h', 'INTEGER'], ['trusted', 'INTEGER NOT NULL DEFAULT 0'], ['climbs', 'INTEGER NOT NULL DEFAULT 0']]) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
    // Every player has a short number, easy to read out and to type: #1042.
    this.db.exec('BEGIN');
    let num = this.db.prepare('SELECT COALESCE(MAX(num), 0) AS n FROM users').get().n;
    const setNum = this.db.prepare('UPDATE users SET num = ? WHERE id = ?');
    for (const u of this.db.prepare('SELECT id FROM users WHERE num IS NULL ORDER BY created, rowid').all()) setNum.run(++num, u.id);
    this.db.exec('COMMIT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_num ON users(num)');
    const q = (s) => this.db.prepare(s);
    this.q = {
      identity: q('SELECT user_id FROM identities WHERE provider = ? AND subject = ?'),
      addUser: q('INSERT INTO users (id, name, created, last_seen, tos_version, tos_at, num) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      getSetting: q('SELECT v FROM settings WHERE k = ?'),
      putSetting: q('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
      maxNum: q('SELECT COALESCE(MAX(num), 0) AS n FROM users'),
      addIdentity: q('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)'),
      seen: q('UPDATE users SET name = ?, last_seen = ?, tos_version = ?, tos_at = ? WHERE id = ?'),
      user: q(`SELECT u.id, u.name, u.created, u.tos_version, u.tos_at, u.num, u.trusted, u.device, i.provider FROM users u LEFT JOIN identities i ON i.user_id = u.id WHERE u.id = ? ORDER BY i.provider = 'guest' LIMIT 1`),
      addSession: q('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)'),
      session: q('SELECT user_id, expires FROM sessions WHERE token_hash = ?'),
      touch: q('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
      delSession: q('DELETE FROM sessions WHERE token_hash = ?'),
      oldSessions: q('DELETE FROM sessions WHERE expires < ?'),
      lastSeen: q('UPDATE users SET last_seen = ? WHERE id = ?'),
      tos: q('UPDATE users SET tos_version = ?, tos_at = ? WHERE id = ?'),
      delUser: q('DELETE FROM users WHERE id = ?'),
      save: q('SELECT rev, data, updated FROM saves WHERE user_id = ?'),
      putSave: q(`INSERT INTO saves (user_id, rev, data, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated = excluded.updated`),
      users: q('SELECT COUNT(*) AS n FROM users'),
    };
  }

  // Numbers are never used twice, even after an account is deleted.
  nextNum() {
    const n = Math.max(+this.setting('lastNum') || 0, this.q.maxNum.get().n) + 1;
    this.setSetting('lastNum', String(n));
    return n;
  }
  setting(k) { const r = this.q.getSetting.get(k); return r ? r.v : ''; }
  setSetting(k, v) { this.q.putSetting.run(k, String(v)); }

  // The person behind this Discord, Steam or Google account. Created the first time. They accepted these terms just now.
  signIn(provider, subject, name, tosVersion) {
    const now = Date.now(), row = this.q.identity.get(provider, subject);
    let id;
    if (row) {
      id = row.user_id;
      this.q.seen.run(name, now, tosVersion, now, id);
    } else {
      id = crypto.randomBytes(12).toString('base64url');
      this.db.exec('BEGIN');
      try {
        this.q.addUser.run(id, name, now, now, tosVersion, now, this.nextNum());
        this.q.addIdentity.run(provider, subject, id);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
    return id;
  }

  // Playing without signing in anywhere: an account all the same, known only by the phone that holds its token.
  newGuest(tosVersion) {
    const subject = crypto.randomBytes(16).toString('base64url');
    return { id: this.signIn('guest', subject, 'Guest', tosVersion), subject };
  }

  // Guests are told apart by their number.
  renameGuest(id) {
    const n = this.q.user.get(id).num;
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(`Guest ${n}`, id);
  }

  user(id) {
    const u = this.q.user.get(id);
    return u ? { id: u.id, name: u.name, provider: u.provider, created: u.created, tos: u.tos_version, num: u.num, trusted: u.trusted, device: u.device } : null;
  }

  // A new random token. Only its hash is kept.
  newSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    this.q.addSession.run(hashToken(token), userId, now, now + SESSION_DAYS * DAY);
    return token;
  }

  // Who does this token belong to? Sessions stay alive while they are used.
  sessionUser(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const h = hashToken(token), s = this.q.session.get(h), now = Date.now();
    if (!s) return null;
    if (s.expires < now) {
      this.q.delSession.run(h);
      return null;
    }
    // At most once a day: this is the only write a plain read would cause.
    if (s.expires - now < (SESSION_DAYS - 1) * DAY) {
      this.q.touch.run(now + SESSION_DAYS * DAY, h);
      this.q.lastSeen.run(now, s.user_id);
    }
    return s.user_id;
  }

  endSession(token) { this.q.delSession.run(hashToken(token)); }
  acceptTerms(id, version) { this.q.tos.run(version, Date.now(), id); }
  // Sessions, identities and the save go with it.
  deleteUser(id) { this.q.delUser.run(id); }

  getSave(id) {
    const s = this.q.save.get(id);
    return s ? { rev: s.rev, data: JSON.parse(s.data), updated: s.updated } : { rev: 0, data: null, updated: 0 };
  }

  // Only over the version it was based on. Returns the new rev, or -1 if someone else got there first.
  putSave(id, baseRev, json) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.q.save.get(id), rev = cur ? cur.rev : 0;
      if (rev !== baseRev) {
        this.db.exec('ROLLBACK');
        return -1;
      }
      this.q.putSave.run(id, rev + 1, json, Date.now());
      this.db.exec('COMMIT');
      return rev + 1;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // A daily copy, keeping the last week.
  backup() {
    const dir = path.join(this.dir, 'backups');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, new Date().toISOString().slice(0, 10) + '.db');
    if (fs.existsSync(file)) fs.rmSync(file);
    // The name is made above from a date, and the folder from the server's own settings.
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    fs.chmodSync(file, 0o600);
    const all = fs.readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d\.db$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 7))) fs.rmSync(path.join(dir, f));
    return file;
  }

  cleanup() { this.q.oldSessions.run(Date.now()); }
  userCount() { return this.q.users.get().n; }
  close() { this.db.close(); }
}

module.exports = { DB, hashToken };
