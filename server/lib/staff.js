'use strict';
// Who may do what. Every player can have one role: the flag shown next to their name in the game. A role has a tag, a colour,
// a rank and a list of permissions, and one player can also be given or refused single permissions of their own.
//
// A permission is the name of a command (ban, givecoins, watch...), a group of commands (@bans, @coins...), or * for all.
// Ranks keep it in order: nobody can act on someone of the same rank or higher, or hand out a role, a rank or a permission
// they don't have themselves. The owner role can always do everything, and the people on the Discord bot's list count as owners.
//
// Vanish lives here too: a vanished player looks offline to their friends, and nobody is told when they watch.
const { GROUPS, COMMANDS } = require('./botcommands');

const KEY = /^[a-z][a-z0-9_]{1,15}$/;
const HEX = /^#?([0-9a-f]{6})$/i;
const OWNER = 'owner';
const OWNER_RANK = 1000;
// Always there, whatever was changed: these three keep their keys (the team suits and older games know them).
const FIXED = new Set(['owner', 'admin', 'mod']);
const STARTERS = [
  { key: 'owner', tag: 'OWNER', color: '#ff3b5c', rank: OWNER_RANK, perms: ['*'] },
  { key: 'admin', tag: 'ADMIN', color: '#e8690c', rank: 80, perms: ['@players', '@coins', '@climbs', '@bans', '@anticheat', '@rooms', '@live', 'status', 'stats', 'announce', 'audit', 'setrole', 'roles', 'perms'] },
  { key: 'mod', tag: 'MOD', color: '#2f7bff', rank: 50, perms: ['player', 'search', 'online', 'recent', 'lastplayed', 'notes', 'note', 'tell', 'flags', 'suspects', 'kick', 'tempban', 'baninfo', 'bans', 'rooms', '@live', 'roles', 'perms'] },
  { key: 'family', tag: 'FAMILY', color: '#b04cff', rank: 20, perms: [] },
  { key: 'vip', tag: 'VIP', color: '#e0a800', rank: 10, perms: [] },
  { key: 'friend', tag: 'FRIEND', color: '#1fae6a', rank: 10, perms: [] },
];
const ALL = new Set(COMMANDS.map((c) => c.name));
const GROUP_OF = {};
for (const [g, list] of Object.entries(GROUPS)) for (const n of list) GROUP_OF[n] = g;
// Anyone with any permission at all may see the help, and what they themselves may do.
const ALWAYS = new Set(['help', 'perms']);

const cleanTag = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 12);

class Staff {
  constructor(db, admin) {
    this.db = db;
    this.admin = admin;
    const d = (this.d = db.db);
    d.exec(`
      CREATE TABLE IF NOT EXISTS roles (key TEXT PRIMARY KEY, tag TEXT NOT NULL, color TEXT NOT NULL, rank INTEGER NOT NULL, perms TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS user_perms (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        perm TEXT NOT NULL, allow INTEGER NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (user_id, perm)
      );
    `);
    const have = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!have.has('vanish')) d.exec('ALTER TABLE users ADD COLUMN vanish INTEGER NOT NULL DEFAULT 0');
    const q = (s) => d.prepare(s);
    this.q = {
      all: q('SELECT * FROM roles'),
      put: q('INSERT OR REPLACE INTO roles (key, tag, color, rank, perms, created) VALUES (?, ?, ?, ?, ?, ?)'),
      drop: q('DELETE FROM roles WHERE key = ?'),
      holders: q('SELECT id, num, name, game_name FROM users WHERE role = ? ORDER BY num LIMIT ?'),
      countHolders: q('SELECT COUNT(*) AS n FROM users WHERE role = ?'),
      clearRole: q("UPDATE users SET role = '' WHERE role = ?"),
      userPerms: q('SELECT perm, allow FROM user_perms WHERE user_id = ? ORDER BY perm'),
      setPerm: q('INSERT OR REPLACE INTO user_perms (user_id, perm, allow, at) VALUES (?, ?, ?, ?)'),
      dropPerm: q('DELETE FROM user_perms WHERE user_id = ? AND perm = ?'),
      withPerms: q('SELECT DISTINCT user_id FROM user_perms'),
      vanish: q('SELECT vanish FROM users WHERE id = ?'),
      setVanish: q('UPDATE users SET vanish = ? WHERE id = ?'),
    };
    const t = Date.now();
    for (const r of STARTERS) if (!this.q.all.all().some((x) => x.key === r.key)) this.q.put.run(r.key, r.tag, r.color, r.rank, JSON.stringify(r.perms), t);
    this.load();
    this.vanishCache = new Map();
  }

  load() {
    this.roles = new Map();
    for (const r of this.q.all.all()) {
      let perms = [];
      try { perms = JSON.parse(r.perms); } catch (e) { perms = []; }
      this.roles.set(r.key, { key: r.key, tag: r.tag, color: r.color, rank: r.key === OWNER ? OWNER_RANK : r.rank, perms: Array.isArray(perms) ? perms : [], fixed: FIXED.has(r.key) });
    }
  }
  save(r) { this.q.put.run(r.key, r.tag, r.color, r.rank, JSON.stringify(r.perms), Date.now()); this.load(); }

  // ---------------------------------------------------------------- roles
  list() { return [...this.roles.values()].sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key)); }
  role(key) { return this.roles.get(String(key || '').toLowerCase()) || null; }
  // By key or by tag, ignoring case.
  findRole(text) {
    const t = String(text || '').trim().toLowerCase();
    return this.role(t) || this.list().find((r) => r.tag.toLowerCase() === t) || null;
  }
  holders(key, n = 15) { return { rows: this.q.holders.all(key, n), total: this.q.countHolders.get(key).n }; }
  // What every game needs to draw the flags: the tag and colour of each.
  table() { const o = {}; for (const r of this.roles.values()) o[r.key] = { tag: r.tag, color: r.color }; return o; }

  create(key, tag, color, rank) {
    const k = String(key || '').toLowerCase();
    if (!KEY.test(k)) return { err: 'A role key is 2 to 16 small letters, numbers or _, starting with a letter. Like vip or tester_2.' };
    if (this.roles.has(k)) return { err: `There is already a role called ${k}.` };
    if (k === 'none') return { err: '"none" means no role, so it can not be one.' };
    const c = color === undefined ? '#6a7a99' : this.color(color);
    if (!c) return { err: 'A colour is written like #ff8800.' };
    const r = { key: k, tag: cleanTag(tag) || k.toUpperCase().slice(0, 12), color: c, rank: Math.max(1, Math.min(OWNER_RANK - 1, rank || 10)), perms: [] };
    this.save(r);
    return { role: this.role(k) };
  }
  edit(key, o) {
    const r = this.role(key);
    if (!r) return { err: 'No such role.' };
    const next = { ...r };
    if (o.tag !== undefined) { next.tag = cleanTag(o.tag); if (!next.tag) return { err: 'The tag needs at least one letter.' }; }
    if (o.color !== undefined) { next.color = this.color(o.color); if (!next.color) return { err: 'A colour is written like #ff8800.' }; }
    if (o.rank !== undefined) {
      if (r.key === OWNER) return { err: 'The owner always has the top rank.' };
      next.rank = Math.max(1, Math.min(OWNER_RANK - 1, o.rank | 0));
    }
    this.save(next);
    return { role: this.role(r.key) };
  }
  remove(key) {
    const r = this.role(key);
    if (!r) return { err: 'No such role.' };
    if (r.fixed) return { err: `${r.tag} is built in and can't be deleted. Its tag, colour, rank and permissions can still be changed.` };
    const n = this.q.clearRole.run(r.key).changes;
    this.q.drop.run(r.key);
    this.load();
    return { n };
  }
  color(text) { const m = HEX.exec(String(text || '').trim()); return m ? '#' + m[1].toLowerCase() : null; }

  // ---------------------------------------------------------------- permissions
  // A command, @group or *, written any way round: "@Bans", "bans" (a group) or "BAN".
  perm(text) {
    const t = String(text || '').trim().toLowerCase().replace(/^\//, '');
    if (t === '*' || t === 'all') return '*';
    const g = t.replace(/^@/, '');
    if (t.startsWith('@') && GROUPS[g]) return '@' + g;
    if (ALL.has(t)) return t;
    if (GROUPS[g]) return '@' + g;
    return null;
  }
  // Every name a permission can have, for suggestions.
  permNames() { return ['*', ...Object.keys(GROUPS).map((g) => '@' + g), ...ALL]; }
  setRolePerm(key, perm, add) {
    const r = this.role(key);
    if (!r) return { err: 'No such role.' };
    if (r.key === OWNER) return { err: 'The owner can always do everything.' };
    const has = r.perms.includes(perm);
    if (add === has) return { same: true };
    r.perms = add ? [...r.perms, perm] : r.perms.filter((p) => p !== perm);
    this.save(r);
    return { ok: true };
  }
  // allow, deny (even if the role allows it) or reset (back to what the role says).
  setUserPerm(id, perm, mode) {
    if (mode === 'reset') return this.q.dropPerm.run(id, perm).changes > 0;
    this.q.setPerm.run(id, perm, mode === 'allow' ? 1 : 0, Date.now());
    return true;
  }
  userPerms(id) { return this.q.userPerms.all(id); }

  rankOf(u) { const r = u && this.role(u.role); return r ? r.rank : 0; }
  isOwner(u) { return !!u && u.role === OWNER; }
  // May this player use this command (or permission)? u is a row of users, with role and id.
  can(u, name) {
    if (!u) return false;
    if (this.isOwner(u)) return true;
    const role = this.role(u.role), mine = new Map(this.userPerms(u.id).map((r) => [r.perm, !!r.allow]));
    const given = new Set(role ? role.perms : []);
    for (const [p, on] of mine) if (on) given.add(p);
    const denied = (p) => mine.get(p) === false;
    const n = String(name);
    if (n.startsWith('@')) return !denied(n) && !denied('*') && (given.has('*') || given.has(n));
    if (n === '*') return given.has('*') && !denied('*');
    const g = GROUP_OF[n];
    if (denied(n) || (g && denied('@' + g)) || denied('*')) return false;
    if (given.has('*') || given.has(n) || (g && given.has('@' + g))) return true;
    return ALWAYS.has(n) && this.isStaff(u);
  }
  // Every command this player may use.
  commandsOf(u) { return COMMANDS.map((c) => c.name).filter((n) => this.can(u, n)); }
  // Staff is anyone who may use any command at all.
  isStaff(u) {
    if (!u) return false;
    if (this.isOwner(u)) return true;
    const role = this.role(u.role);
    if (role && role.perms.length) return true;
    return this.userPerms(u.id).some((r) => r.allow);
  }
  // Higher ranks can act on lower ones, and the owner on everyone else.
  outranks(a, b) { return this.isOwner(a) ? !this.isOwner(b) || a.id === b.id : this.rankOf(a) > this.rankOf(b); }

  // ---------------------------------------------------------------- vanish
  // The time it started, or 0.
  vanishedAt(id) {
    if (!id) return 0;
    if (!this.vanishCache.has(id)) { const r = this.q.vanish.get(id); this.vanishCache.set(id, r ? r.vanish : 0); }
    return this.vanishCache.get(id);
  }
  vanished(id) { return this.vanishedAt(id) > 0; }
  setVanish(id, on) {
    const v = on ? Date.now() : 0;
    this.q.setVanish.run(v, id);
    this.vanishCache.set(id, v);
    if (this.vanishCache.size > 5000) this.vanishCache.clear();
    return v;
  }

  // What the game needs to know about its own player's powers. Null for everyone who has none.
  infoFor(u) {
    if (!this.isStaff(u)) return null;
    const role = this.role(u.role);
    return { cmds: this.commandsOf(u), vanished: this.vanished(u.id), role: role ? role.key : '', rank: this.rankOf(u) };
  }
}

module.exports = { Staff, OWNER, OWNER_RANK, GROUP_OF };
