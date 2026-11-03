'use strict';
// Everything that runs the game rather than plays it: looking players up, what they have been flagged for, who is banned
// and why, notes, and a record of what the admins did. The Discord bot is one way in (discord.js and botcommands.js), but
// nothing here depends on it, and the server works the same with no bot at all.
const crypto = require('node:crypto');
const net = require('node:net');

const DAY = 86400000;
const WARN_EVERY = 10 * 60000;
const SEEN_EVERY = 60000;
const IP_KEEP = 90 * DAY;
const FLAG_KEEP = 180 * DAY;
const AUDIT_KEEP = 365 * DAY;
const SCORE_DAYS = 30;
const ONLINE_FOR = 3 * 60000;

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const LIKE = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// What a ban on an address really covers: the address, or on IPv6 the /64 block that one phone or home gets.
function ipKey(ip) {
  const s = String(ip || '').toLowerCase().split('%')[0];
  if (!net.isIPv6(s)) return s;
  const [a, b] = s.split('::');
  const left = a ? a.split(':') : [], right = b ? b.split(':') : [];
  const all = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return all.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

class Admin {
  constructor(db, wallet, env = {}) {
    this.db = db;
    this.d = db.db;
    this.wallet = wallet;
    this.env = env;
    this.notify = { signin() {}, flag() {}, ban() {}, unban() {}, note() {} };
    this.presence = new Map();
    this.warned = new Map();
    this.seenAt = new Map();
    this.banScore = Math.max(1, +env.ANTICHEAT_BAN_SCORE || 100);
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, score INTEGER NOT NULL, run TEXT, cleared INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS flags_user ON flags(user_id, at);
      CREATE INDEX IF NOT EXISTS flags_at ON flags(at);
      CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL, value TEXT NOT NULL, user_id TEXT, name TEXT, reason TEXT NOT NULL, by_who TEXT NOT NULL,
        at INTEGER NOT NULL, until INTEGER, lifted_at INTEGER, lifted_by TEXT, lift_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS bans_value ON bans(kind, value);
      CREATE INDEX IF NOT EXISTS bans_user ON bans(user_id);
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        at INTEGER NOT NULL, by_who TEXT NOT NULL, text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_user ON notes(user_id);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, who TEXT NOT NULL, cmd TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_ips (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL,
        PRIMARY KEY (user_id, ip)
      );
      CREATE INDEX IF NOT EXISTS user_ips_ip ON user_ips(ip);
      CREATE TABLE IF NOT EXISTS user_devices (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, guard TEXT,
        PRIMARY KEY (user_id, device)
      );
      CREATE INDEX IF NOT EXISTS user_devices_device ON user_devices(device);
    `);
    const q = (s) => this.d.prepare(s);
    this.q = {
      seenIp: q(`INSERT INTO user_ips (user_id, ip, first, last) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, ip) DO UPDATE SET last = excluded.last`),
      lastIp: q('UPDATE users SET last_ip = ?, last_seen = ? WHERE id = ?'),
      gameName: q('UPDATE users SET game_name = ? WHERE id = ?'),
      device: q(`INSERT INTO user_devices (user_id, device, first, last, guard) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, device) DO UPDATE SET last = excluded.last, guard = COALESCE(excluded.guard, guard)`),
      userDevice: q('UPDATE users SET device = ? WHERE id = ?'),
      played: q('UPDATE users SET last_played = ?, last_map = ?, last_diff = ?, last_h = ?, climbs = climbs + ? WHERE id = ?'),
      addFlag: q('INSERT INTO flags (user_id, at, kind, detail, score, run) VALUES (?, ?, ?, ?, ?, ?)'),
      score: q('SELECT COALESCE(SUM(score), 0) AS s FROM flags WHERE user_id = ? AND cleared = 0 AND at > ?'),
      flagsOf: q('SELECT * FROM flags WHERE user_id = ? ORDER BY at DESC LIMIT ?'),
      flagsAll: q('SELECT f.*, u.num, u.name, u.game_name FROM flags f JOIN users u ON u.id = f.user_id WHERE f.cleared = 0 ORDER BY f.at DESC LIMIT ?'),
      clearFlags: q('UPDATE flags SET cleared = 1 WHERE user_id = ? AND cleared = 0'),
      suspects: q(`SELECT u.id, u.num, u.name, u.game_name, SUM(f.score) AS score, COUNT(*) AS n, MAX(f.at) AS last FROM flags f JOIN users u ON u.id = f.user_id
        WHERE f.cleared = 0 AND f.at > ? GROUP BY u.id ORDER BY score DESC LIMIT ?`),
      addBan: q('INSERT INTO bans (kind, value, user_id, name, reason, by_who, at, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      activeBan: q('SELECT * FROM bans WHERE kind = ? AND value = ? AND lifted_at IS NULL AND (until IS NULL OR until > ?) ORDER BY at DESC LIMIT 1'),
      liftUser: q('UPDATE bans SET lifted_at = ?, lifted_by = ?, lift_reason = ? WHERE user_id = ? AND lifted_at IS NULL'),
      liftValue: q('UPDATE bans SET lifted_at = ?, lifted_by = ?, lift_reason = ? WHERE kind = ? AND value = ? AND lifted_at IS NULL'),
      bansActive: q('SELECT * FROM bans WHERE lifted_at IS NULL AND (until IS NULL OR until > ?) AND kind != \'identity\' ORDER BY at DESC LIMIT ? OFFSET ?'),
      bansCount: q('SELECT COUNT(*) AS n FROM bans WHERE lifted_at IS NULL AND (until IS NULL OR until > ?) AND kind != \'identity\''),
      banHistory: q('SELECT * FROM bans WHERE user_id = ? AND kind != \'identity\' ORDER BY at DESC LIMIT ?'),
      addNote: q('INSERT INTO notes (user_id, at, by_who, text) VALUES (?, ?, ?, ?)'),
      notes: q('SELECT * FROM notes WHERE user_id = ? ORDER BY at DESC LIMIT ?'),
      addAudit: q('INSERT INTO audit (at, who, cmd, detail) VALUES (?, ?, ?, ?)'),
      audit: q('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
      byNum: q('SELECT id FROM users WHERE num = ?'),
      byId: q('SELECT id FROM users WHERE id = ?'),
      byName: q(`SELECT id, num, name, game_name, last_played FROM users WHERE name = ? COLLATE NOCASE OR game_name = ? COLLATE NOCASE ORDER BY last_seen DESC LIMIT 25`),
      search: q(`SELECT id, num, name, game_name, last_seen, last_played FROM users WHERE name LIKE ? ESCAPE '\\' OR game_name LIKE ? ESCAPE '\\' OR id = ? OR num = ? ORDER BY last_seen DESC LIMIT ?`),
      full: q(`SELECT u.*, i.provider FROM users u LEFT JOIN identities i ON i.user_id = u.id WHERE u.id = ? LIMIT 1`),
      list: q(`SELECT u.id, u.num, u.name, u.game_name, u.last_seen, u.last_played, i.provider FROM users u LEFT JOIN identities i ON i.user_id = u.id GROUP BY u.id ORDER BY u.num LIMIT ? OFFSET ?`),
      recent: q(`SELECT u.id, u.num, u.name, u.game_name, u.last_played, u.last_map, u.last_diff, u.last_h, u.last_ip FROM users u WHERE u.last_played IS NOT NULL ORDER BY u.last_played DESC LIMIT ?`),
      newest: q(`SELECT u.id, u.num, u.name, u.game_name, u.created, u.last_ip, i.provider FROM users u LEFT JOIN identities i ON i.user_id = u.id GROUP BY u.id ORDER BY u.created DESC LIMIT ?`),
      topCoins: q(`SELECT u.id, u.num, u.name, u.game_name, w.coins AS v FROM wallets w JOIN users u ON u.id = w.user_id ORDER BY w.coins DESC LIMIT ?`),
      topEarned: q(`SELECT u.id, u.num, u.name, u.game_name, w.earned AS v FROM wallets w JOIN users u ON u.id = w.user_id ORDER BY w.earned DESC LIMIT ?`),
      topClimbs: q(`SELECT u.id, u.num, u.name, u.game_name, u.climbs AS v FROM users u ORDER BY u.climbs DESC LIMIT ?`),
      topWins: q(`SELECT u.id, u.num, u.name, u.game_name, COUNT(r.id) AS v FROM runs r JOIN users u ON u.id = r.user_id WHERE r.won = 1 GROUP BY u.id ORDER BY v DESC LIMIT ?`),
      ipsOf: q('SELECT ip, first, last FROM user_ips WHERE user_id = ? ORDER BY last DESC LIMIT ?'),
      devicesOf: q('SELECT device, first, last, guard FROM user_devices WHERE user_id = ? ORDER BY last DESC LIMIT ?'),
      sameIp: q(`SELECT DISTINCT u.id, u.num, u.name, u.game_name, x.ip AS via FROM user_ips a JOIN user_ips x ON x.ip = a.ip AND x.user_id != a.user_id JOIN users u ON u.id = x.user_id WHERE a.user_id = ? LIMIT ?`),
      sameDevice: q(`SELECT DISTINCT u.id, u.num, u.name, u.game_name FROM user_devices a JOIN user_devices x ON x.device = a.device AND x.user_id != a.user_id JOIN users u ON u.id = x.user_id WHERE a.user_id = ? LIMIT ?`),
      usersOnIp: q(`SELECT u.id, u.num, u.name, u.game_name, x.last FROM user_ips x JOIN users u ON u.id = x.user_id WHERE x.ip = ? ORDER BY x.last DESC LIMIT ?`),
      identities: q('SELECT provider, subject FROM identities WHERE user_id = ?'),
      trust: q('UPDATE users SET trusted = ? WHERE id = ?'),
      rename: q('UPDATE users SET name = ?, game_name = ? WHERE id = ?'),
      endSessions: q('DELETE FROM sessions WHERE user_id = ?'),
      countUsers: q('SELECT COUNT(*) AS n FROM users'),
      countGuests: q(`SELECT COUNT(*) AS n FROM identities WHERE provider = 'guest'`),
      activeSince: q('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?'),
      playedSince: q('SELECT COUNT(*) AS n FROM users WHERE last_played > ?'),
      coinsTotal: q('SELECT COALESCE(SUM(coins), 0) AS c, COALESCE(SUM(earned), 0) AS e FROM wallets'),
      climbsToday: q('SELECT COUNT(*) AS n, COALESCE(SUM(won), 0) AS w FROM runs WHERE started > ?'),
      oldIps: q('DELETE FROM user_ips WHERE last < ?'),
      oldFlags: q('DELETE FROM flags WHERE at < ?'),
      oldAudit: q('DELETE FROM audit WHERE at < ?'),
      oldGuests: q(`DELETE FROM users WHERE id IN (
        SELECT u.id FROM users u JOIN identities i ON i.user_id = u.id LEFT JOIN wallets w ON w.user_id = u.id
        WHERE i.provider = 'guest' AND u.last_seen < ? AND COALESCE(w.earned, 0) = 0)`),
    };
  }

  // ---------------------------------------------------------------- settings that can change while running
  get mode() { const m = this.db.setting('anticheat') || this.env.ANTICHEAT_MODE; return m === 'enforce' ? 'enforce' : 'watch'; }
  setMode(m) { this.db.setSetting('anticheat', m === 'enforce' ? 'enforce' : 'watch'); }
  get announcement() { try { return JSON.parse(this.db.setting('announce') || 'null'); } catch (e) { return null; } }
  announce(text, minutes) {
    if (!text) return this.db.setSetting('announce', '');
    const a = { id: crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 400), until: minutes > 0 ? now() + minutes * 60000 : 0 };
    this.db.setSetting('announce', JSON.stringify(a));
    return a;
  }
  liveAnnouncement() {
    const a = this.announcement;
    return a && (!a.until || a.until > now()) ? { id: a.id, text: a.text } : null;
  }
  get maintenance() { return this.db.setting('maintenance') || ''; }
  setMaintenance(text) { this.db.setSetting('maintenance', text ? String(text).slice(0, 300) : ''); }
  get logGuests() { return this.db.setting('logGuests') !== '0'; }
  setLogGuests(on) { this.db.setSetting('logGuests', on ? '1' : '0'); }

  // ---------------------------------------------------------------- who is around
  seen(id, ip) {
    const k = id + '|' + ip, t = now();
    if (this.seenAt.get(k) > t - SEEN_EVERY) { this.touch(id, ip); return; }
    this.seenAt.set(k, t);
    this.q.seenIp.run(id, ip, t, t);
    this.q.lastIp.run(ip, t, id);
    this.touch(id, ip);
  }
  touch(id, ip) {
    const p = this.presence.get(id) || {};
    p.at = now();
    p.ip = ip;
    this.presence.set(id, p);
  }
  setGameName(id, name) {
    const n = String(name == null ? '' : name).normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (n) this.q.gameName.run(n, id);
    return n;
  }
  setDevice(id, device, guard) {
    if (!/^[0-9a-f]{16,64}$/.test(String(device))) return false;
    const t = now();
    this.q.device.run(id, device, t, t, guard ? JSON.stringify(guard).slice(0, 4000) : null);
    this.q.userDevice.run(device, id);
    return true;
  }
  played(id, o) {
    this.q.played.run(now(), o.map | 0, o.diff | 0, o.h | 0, o.newClimb ? 1 : 0, id);
    const p = this.presence.get(id) || {};
    Object.assign(p, { at: now(), map: o.map, diff: o.diff, h: o.h, climbing: now() });
    this.presence.set(id, p);
  }
  online() {
    const t = now() - ONLINE_FOR, out = [];
    for (const [id, p] of this.presence) {
      if (p.at < t) { this.presence.delete(id); continue; }
      out.push(Object.assign({ id }, p));
    }
    return out.sort((a, b) => b.at - a.at);
  }

  // ---------------------------------------------------------------- finding players
  // By number (#12 or 12), by id, or by name. Several people can share a name, and then the answer says who they are.
  find(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { none: true };
    const num = /^#?(\d{1,12})$/.exec(t);
    if (num) {
      const r = this.q.byNum.get(+num[1]);
      if (r) return { id: r.id };
    }
    const r = this.q.byId.get(t);
    if (r) return { id: r.id };
    const rows = this.q.byName.all(t, t);
    if (rows.length === 1) return { id: rows[0].id };
    if (rows.length > 1) return { many: rows };
    return { none: true };
  }
  search(text, n = 25) {
    const t = String(text || '').trim();
    if (!t) return this.q.list.all(n, 0);
    const l = LIKE(t), num = /^#?(\d{1,12})$/.exec(t);
    return this.q.search.all(l, l, t, num ? +num[1] : -1, n);
  }
  info(id) { return this.q.full.get(id) || null; }
  label(u) {
    if (!u) return 'nobody';
    const n = u.game_name && u.game_name !== u.name ? `${u.name} (plays as ${u.game_name})` : u.name;
    return `${n} #${u.num}`;
  }
  list(page, size) { return this.q.list.all(size, Math.max(0, page) * size); }
  recent(n) { return this.q.recent.all(n); }
  newest(n) { return this.q.newest.all(n); }
  top(what, n) {
    if (what === 'earned') return this.q.topEarned.all(n);
    if (what === 'climbs') return this.q.topClimbs.all(n);
    if (what === 'wins') return this.q.topWins.all(n);
    return this.q.topCoins.all(n);
  }
  ips(id, n = 10) { return this.q.ipsOf.all(id, n); }
  devices(id, n = 5) {
    return this.q.devicesOf.all(id, n).map((d) => {
      let guard = null;
      try { guard = d.guard ? JSON.parse(d.guard) : null; } catch (e) { guard = null; }
      return { device: d.device, first: d.first, last: d.last, guard };
    });
  }
  alts(id, n = 20) { return { ip: this.q.sameIp.all(id, n), device: this.q.sameDevice.all(id, n) }; }
  usersOnIp(ip, n = 25) { return this.q.usersOnIp.all(String(ip), n); }
  stats() {
    const t = now(), c = this.q.coinsTotal.get(), r = this.q.climbsToday.get(t - DAY);
    return {
      players: this.q.countUsers.get().n, guests: this.q.countGuests.get().n, active: this.q.activeSince.get(t - DAY).n, played: this.q.playedSince.get(t - DAY).n,
      coins: c.c, earned: c.e, climbs: r.n, wins: r.w, bans: this.q.bansCount.get(t).n, suspects: this.q.suspects.all(t - SCORE_DAYS * DAY, 1000).length,
    };
  }
  rename(id, name) {
    const u = this.info(id);
    const n = String(name).normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!u || !n) return false;
    this.q.rename.run(n, n.slice(0, 14), id);
    return true;
  }
  endSessions(id) { return this.q.endSessions.run(id).changes; }
  deletePlayer(id) { this.db.deleteUser(id); }

  // ---------------------------------------------------------------- flags
  // Something a player did that the game can't do. Kept with the reason, and it adds up. Automatic bans only happen when
  // the anticheat is set to enforce, and never for someone marked as trusted.
  flag(id, kind, detail, score, run) {
    const u = this.info(id);
    if (!u) return null;
    const text = String(detail).slice(0, 500), s = Math.max(0, score | 0);
    this.q.addFlag.run(id, now(), String(kind).slice(0, 24), text, s, run || null);
    const total = this.score(id), key = id + '|' + kind, t = now();
    console.log(`flag: ${this.label(u)} [${kind}] ${text} (score ${total})`);
    if (!(this.warned.get(key) > t - WARN_EVERY)) {
      this.warned.set(key, t);
      this.notify.flag({ user: u, kind, detail: text, score: s, total, run, mode: this.mode });
    }
    if (this.mode === 'enforce' && !u.trusted && s > 0 && total >= this.banScore && !this.banOf(id)) {
      this.ban({ userId: id, reason: `Automatic: ${text}`, by: 'anticheat', device: u.device || null });
    }
    return total;
  }
  score(id) { return this.q.score.get(id, now() - SCORE_DAYS * DAY).s; }
  flags(id, n = 10) { return id ? this.q.flagsOf.all(id, n) : this.q.flagsAll.all(n); }
  clearFlags(id) { return this.q.clearFlags.run(id).changes; }
  suspects(n = 15) { return this.q.suspects.all(now() - SCORE_DAYS * DAY, n); }
  trust(id, on) { this.q.trust.run(on ? 1 : 0, id); }

  // ---------------------------------------------------------------- bans
  // A ban on a player also covers the sign in behind the account, so deleting the account and coming back doesn't get
  // around it. IP and device bans are extra and only happen when asked for.
  ban(o) {
    const t = now(), until = o.days > 0 ? t + o.days * DAY : null, reason = String(o.reason || 'No reason given').slice(0, 300), by = String(o.by || 'admin').slice(0, 80);
    const u = o.userId ? this.info(o.userId) : null, name = u ? this.label(u) : null;
    const add = (kind, value) => this.q.addBan.run(kind, String(value), u ? u.id : null, name, reason, by, t, until);
    if (u) {
      add('user', u.id);
      for (const i of this.q.identities.all(u.id)) add('identity', hash(i.provider + ':' + i.subject));
      this.endSessionsSoft(u.id);
    }
    if (o.ip) add('ip', ipKey(o.ip));
    if (o.device) add('device', o.device);
    this.notify.ban({ user: u, ip: o.ip || null, device: o.device || null, reason, by, until });
    if (this.onBan) this.onBan({ userId: u ? u.id : null, ip: o.ip || null, reason, until });
    return { reason, until };
  }
  // Sessions stay: the game has to be able to ask why it can't do anything, and show the reason.
  endSessionsSoft() {}
  unban(userId, by, why) {
    const u = this.info(userId), n = this.q.liftUser.run(now(), String(by).slice(0, 80), String(why || '').slice(0, 300), userId).changes;
    if (n) this.notify.unban({ user: u, by, reason: why || '' });
    return n;
  }
  unbanValue(kind, value, by, why) {
    if (kind === 'ip') value = ipKey(value);
    const n = this.q.liftValue.run(now(), String(by).slice(0, 80), String(why || '').slice(0, 300), kind, String(value)).changes;
    if (n) this.notify.unban({ ip: kind === 'ip' ? value : null, device: kind === 'device' ? value : null, by, reason: why || '' });
    return n;
  }
  banRow(kind, value) { return value ? this.q.activeBan.get(kind, kind === 'ip' ? ipKey(value) : String(value), now()) || null : null; }
  banOf(id) { return this.banRow('user', id); }
  // Whichever applies: this player, this address, this phone.
  banFor(id, ip, device) { return this.banRow('user', id) || this.banRow('ip', ip) || this.banRow('device', device); }
  banForIdentity(provider, subject) { return this.banRow('identity', hash(provider + ':' + subject)); }
  bans(page, size) { return { rows: this.q.bansActive.all(now(), size, Math.max(0, page) * size), total: this.q.bansCount.get(now()).n }; }
  banHistory(id, n = 10) { return this.q.banHistory.all(id, n); }
  // What a banned player gets told.
  showBan(b, u) { return { banned: true, reason: b.reason, until: b.until || 0, num: u ? u.num : undefined }; }

  // ---------------------------------------------------------------- notes and the record of what admins did
  addNote(id, by, text) { this.q.addNote.run(id, now(), String(by).slice(0, 80), String(text).slice(0, 500)); }
  notes(id, n = 10) { return this.q.notes.all(id, n); }
  audit(who, cmd, detail) { this.q.addAudit.run(now(), String(who).slice(0, 80), String(cmd).slice(0, 40), String(detail).slice(0, 500)); }
  auditLog(n = 15) { return this.q.audit.all(n); }

  cleanup() {
    const t = now();
    this.q.oldIps.run(t - IP_KEEP);
    this.q.oldFlags.run(t - FLAG_KEEP);
    this.q.oldAudit.run(t - AUDIT_KEEP);
    this.q.oldGuests.run(t - 60 * DAY);
    this.seenAt.clear();
    for (const [k, v] of this.warned) if (v < t - WARN_EVERY) this.warned.delete(k);
  }
}

module.exports = { Admin, hash, ipKey };
