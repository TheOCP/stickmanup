'use strict';
// Everyone's coins, guests included. The balance and what they own live only here, so editing a phone changes nothing and
// nothing can be bought without enough coins.
//
// What a climb pays comes from the server's own rerun of it (verifier.js). The older rules below are for when that isn't the
// final word: every coin once per climb, no faster than a climber can collect them, a win only after a climb's worth of
// time, each first win bonus once, and a limit per day. catalog.json is made from the game's own tables by dev/makecatalog.mjs.
const crypto = require('node:crypto');
const catalog = require('./catalog.json');
const { Limiter } = require('./limits');

const DAY = 86400000;
// Long enough for a saved climb to be picked up again, which keeps its clock and the coins already paid.
const RUN_KEEP = 30 * DAY;
const MAX_RUNS = 40;
const LEDGER_KEEP = 180 * DAY;
const MAX_LIST = 2000;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const today = () => new Date().toISOString().slice(0, 10);
const unique = (list, ok) => [...new Set(Array.isArray(list) ? list.slice(0, MAX_LIST).filter(ok) : [])];

class Wallet {
  constructor(db, env = {}) {
    this.d = db.db;
    this.importCap = Math.floor(num(env.WALLET_IMPORT_CAP, 5000));
    this.dayCap = Math.floor(num(env.WALLET_DAILY_CAP, 20000));
    this.minWin = num(env.WALLET_MIN_WIN_SECONDS, 120);
    this.rate = num(env.WALLET_COINS_PER_SECOND, 6);
    this.burst = Math.floor(num(env.WALLET_COIN_BURST, 30));
    // Several climbs at once are not a way around the speed limits: these count the whole account.
    this.coinLimit = new Limiter(Math.max(this.burst * 2, 60), this.rate);
    this.winLimit = new Limiter(2, 1 / Math.max(this.minWin, 1));
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        coins INTEGER NOT NULL, earned INTEGER NOT NULL,
        own TEXT NOT NULL, relics TEXT NOT NULL, ach TEXT NOT NULL,
        imported INTEGER NOT NULL, day TEXT NOT NULL, day_earned INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map INTEGER NOT NULL, diff INTEGER NOT NULL, custom INTEGER NOT NULL,
        started INTEGER NOT NULL, coins TEXT NOT NULL, won INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id);
      CREATE TABLE IF NOT EXISTS ledger (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        at INTEGER NOT NULL, delta INTEGER NOT NULL, why TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, at);
    `);
    // Servers from before climbs were rerun get these added.
    const have = new Set(this.d.prepare('PRAGMA table_info(runs)').all().map((c) => c.name));
    for (const [col, def] of [['rules', 'TEXT'], ['forged', 'INTEGER NOT NULL DEFAULT 0'], ['mode', "TEXT NOT NULL DEFAULT 'solo'"], ['next_seq', 'INTEGER NOT NULL DEFAULT 0'], ['segment', 'INTEGER NOT NULL DEFAULT 0'], ['ticks', 'INTEGER NOT NULL DEFAULT 0'], ['last_at', 'INTEGER'], ['tainted', 'INTEGER NOT NULL DEFAULT 0'], ['verdict', 'TEXT'], ['snaps', 'TEXT'], ['seen', 'TEXT'], ['best_h', 'INTEGER NOT NULL DEFAULT 0'], ['later', 'TEXT'], ['build', 'TEXT'], ['falls', 'INTEGER NOT NULL DEFAULT 0'], ['dead', 'INTEGER NOT NULL DEFAULT 0'], ['snapshot_seq', 'INTEGER']]) {
      if (!have.has(col)) this.d.exec(`ALTER TABLE runs ADD COLUMN ${col} ${def}`);
    }
    const q = (s) => this.d.prepare(s);
    this.q = {
      add: q(`INSERT OR IGNORE INTO wallets (user_id, coins, earned, own, relics, ach, imported, day, day_earned) VALUES (?, 0, 0, '[]', '[]', '[]', 0, ?, 0)`),
      get: q('SELECT * FROM wallets WHERE user_id = ?'),
      put: q('UPDATE wallets SET coins = ?, earned = ?, own = ?, relics = ?, ach = ?, imported = ?, day = ?, day_earned = ? WHERE user_id = ?'),
      log: q('INSERT INTO ledger (user_id, at, delta, why) VALUES (?, ?, ?, ?)'),
      addRun: q('INSERT INTO runs (id, user_id, map, diff, custom, started, coins, won, rules, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'),
      ledgerOf: q('SELECT at, delta, why FROM ledger WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT ?'),
      allIds: this.d.prepare('SELECT id AS user_id FROM users'),
      run: q('SELECT * FROM runs WHERE id = ?'),
      putRun: q('UPDATE runs SET coins = ?, won = ? WHERE id = ?'),
      oldRuns: q('DELETE FROM runs WHERE started < ?'),
      extraRuns: q('DELETE FROM runs WHERE user_id = ? AND id NOT IN (SELECT id FROM runs WHERE user_id = ? ORDER BY started DESC, rowid DESC LIMIT ?)'),
      oldLedger: q('DELETE FROM ledger WHERE at < ?'),
    };
  }

  tx(fn) {
    this.d.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.d.exec('COMMIT');
      return r;
    } catch (e) {
      this.d.exec('ROLLBACK');
      throw e;
    }
  }

  load(id) {
    this.q.add.run(id, today());
    const w = this.q.get.get(id);
    const out = { coins: w.coins, earned: w.earned, own: JSON.parse(w.own), relics: JSON.parse(w.relics), ach: JSON.parse(w.ach), imported: w.imported, day: w.day, dayEarned: w.day_earned };
    if (out.day !== today()) { out.day = today(); out.dayEarned = 0; }
    return out;
  }
  store(id, w) {
    this.q.put.run(w.coins, w.earned, JSON.stringify(w.own), JSON.stringify(w.relics), JSON.stringify(w.ach), w.imported, w.day, w.dayEarned, id);
  }
  // What the phone gets to see.
  show(w) {
    return { coins: w.coins, earned: w.earned, own: w.own, relics: w.relics, ach: w.ach, imported: !!w.imported, dayLeft: Math.max(0, this.dayCap - w.dayEarned) };
  }
  get(id) { return this.show(this.load(id)); }

  // Older phones ask to bring along the coins they kept themselves. Nobody can check how those were got, so nothing comes.
  importGuest(id) {
    return this.tx(() => {
      const w = this.load(id);
      w.imported = 1;
      this.store(id, w);
      return { status: 200, wallet: this.show(w) };
    });
  }

  // Signing in for the first time: what the guest on this phone earned moves to the new account. An account that already
  // has something keeps what it has, and the guest stays as it was, for when you sign out again.
  moveGuest(guestId, id) {
    if (guestId === id) return false;
    return this.tx(() => {
      const g = this.load(guestId), w = this.load(id);
      if (w.earned > 0 || w.coins > 0 || w.own.length || !(g.earned > 0 || g.own.length)) return false;
      w.coins = g.coins;
      w.earned = g.earned;
      w.own = g.own;
      w.relics = g.relics;
      w.ach = g.ach;
      w.imported = 1;
      this.store(id, w);
      this.q.log.run(id, Date.now(), g.coins, 'moved from guest');
      g.coins = 0; g.earned = 0; g.own = []; g.relics = []; g.ach = [];
      this.store(guestId, g);
      this.q.log.run(guestId, Date.now(), -w.coins, 'moved to an account');
      return true;
    });
  }

  // ---------------------------------------------------------------- what admins can do
  history(id, n = 15) { return this.q.ledgerOf.all(id, n); }
  // Give (or with a minus, take). Never below zero. Answers the new balance.
  adjust(id, delta, why) {
    return this.tx(() => {
      const w = this.load(id), before = w.coins;
      w.coins = Math.max(0, w.coins + Math.trunc(delta));
      if (delta > 0) w.earned += w.coins - before;
      this.store(id, w);
      this.q.log.run(id, Date.now(), w.coins - before, String(why).slice(0, 200));
      return w.coins;
    });
  }
  setCoins(id, coins, why) {
    return this.tx(() => {
      const w = this.load(id), before = w.coins;
      w.coins = Math.max(0, Math.trunc(coins));
      this.store(id, w);
      this.q.log.run(id, Date.now(), w.coins - before, String(why).slice(0, 200));
      return w.coins;
    });
  }
  reset(id, why) {
    return this.tx(() => {
      const w = this.load(id), before = w.coins;
      w.coins = 0; w.earned = 0; w.own = []; w.relics = []; w.ach = [];
      this.store(id, w);
      this.q.log.run(id, Date.now(), -before, String(why).slice(0, 200));
    });
  }
  giveItem(id, item, why) {
    if (!Object.hasOwn(catalog.names, item)) return false;
    return this.tx(() => {
      const w = this.load(id);
      if (w.own.includes(item)) return false;
      w.own.push(item);
      this.store(id, w);
      this.q.log.run(id, Date.now(), 0, String('given ' + item + ': ' + why).slice(0, 200));
      return true;
    });
  }
  takeItem(id, item, why) {
    return this.tx(() => {
      const w = this.load(id), i = w.own.indexOf(item);
      if (i < 0) return false;
      w.own.splice(i, 1);
      this.store(id, w);
      this.q.log.run(id, Date.now(), 0, String('taken ' + item + ': ' + why).slice(0, 200));
      return true;
    });
  }
  // Coins for everyone at once, an event say. Answers how many got them.
  giveAll(delta, why) {
    let n = 0;
    for (const r of this.q.allIds.all()) { this.adjust(r.user_id, delta, why); n++; }
    return n;
  }
  // All that can be given, as [key, name, price], with what is not for sale first. A price of 0 means it can't be bought.
  catalogList() {
    return Object.entries(catalog.names).map(([k, name]) => [k, name, catalog.items[k] || 0]).sort((a, b) => (a[2] ? 1 : 0) - (b[2] ? 1 : 0) || a[1].localeCompare(b[1]));
  }
  itemName(item) { return Object.hasOwn(catalog.names, item) ? catalog.names[item] : item; }
  // By its key or by its name. Some names are shared, like a suit and a face both called Ninja.
  findItem(text) {
    const t = String(text || '').trim();
    if (Object.hasOwn(catalog.names, t)) return { key: t };
    const low = t.toLowerCase(), hits = Object.keys(catalog.names).filter((k) => catalog.names[k].toLowerCase() === low);
    return hits.length === 1 ? { key: hits[0] } : hits.length ? { many: hits } : {};
  }
  get mapNames() { return catalog.maps.map((m) => m.key); }
  // Does this person really own what they are wearing? Free things and things earned another way aren't on sale.
  // What someone is wearing, by the names the shop sells it under. Faces and hats that share a name with a suit are told apart.
  ownsLook(id, look, role = '') {
    if (!look || typeof look !== 'object') return true;
    // The team suits go with a flag from the bot.
    if (typeof look.s === 'string' && Object.hasOwn(catalog.team, look.s) && !catalog.team[look.s].includes(role)) return false;
    const key = (kind, x) => (Object.hasOwn(catalog.items, `${kind}:${x}`) ? `${kind}:${x}` : x);
    const keys = [look.s, look.f && key('face', look.f), look.h && key('hat', look.h), look.w].filter((k) => typeof k === 'string');
    const w = this.load(id);
    return keys.every((k) => !Object.hasOwn(catalog.items, k) || w.own.includes(k));
  }
  setDayCap(n) { this.dayCap = Math.max(0, Math.floor(n)); }

  buy(id, item) {
    const price = typeof item === 'string' && Object.hasOwn(catalog.items, item) ? catalog.items[item] : 0;
    if (!(price > 0)) return { status: 400, err: 'That is not for sale.' };
    return this.tx(() => {
      const w = this.load(id);
      // Pressing twice must not pay twice.
      if (w.own.includes(item)) return { status: 200, wallet: this.show(w) };
      if (w.coins < price) return { status: 402, err: 'Not enough coins.', wallet: this.show(w) };
      w.coins -= price;
      w.own.push(item);
      this.store(id, w);
      this.q.log.run(id, Date.now(), -price, 'bought ' + item);
      return { status: 200, wallet: this.show(w) };
    });
  }

  startRun(id, o) {
    const map = o && o.map, diff = o && o.diff;
    if (!Number.isInteger(map) || !catalog.maps[map] || !Number.isInteger(diff) || !catalog.diffs[diff]) return null;
    const run = crypto.randomBytes(16).toString('base64url');
    this.load(id);
    // With rules sent along the server works out for itself whether they are the difficulty's own.
    const rules = o.rules && typeof o.rules === 'object' ? o.rules : null;
    const custom = rules ? ['cps', 'haz', 'rope'].some((k) => rules[k] !== undefined && rules[k] !== diff) : !!o.custom;
    const mode = o.mode === 'host' || o.mode === 'client' ? o.mode : 'solo';
    this.q.addRun.run(run, id, map, diff, custom ? 1 : 0, Date.now(), '[]', JSON.stringify(rules || {}), mode);
    this.q.extraRuns.run(id, id, MAX_RUNS);
    return run;
  }

  // A phone says what happened in its climb. Answers what counted. What can't count yet comes back in `later` to send again.
  // With replay set, this list is what the server itself saw happen, so the limits for guessing at honesty don't apply.
  report(id, o, how = {}) {
    const r = typeof (o && o.run) === 'string' ? this.q.run.get(o.run) : null;
    if (!r || r.user_id !== id) return { status: 404, err: 'That climb is not known here.' };
    const M = catalog.maps[r.map], D = catalog.diffs[r.diff], elapsed = (Date.now() - r.started) / 1000;
    return this.tx(() => {
      const w = this.load(id), taken = new Set(JSON.parse(r.coins)), out = { status: 200, paid: 0, accepted: [], later: [], relics: [], first: 0, win: null, capped: false };
      let dayRoom = Math.max(0, this.dayCap - w.dayEarned);
      const payDay = (n, why) => {
        const got = Math.min(n, dayRoom);
        if (got < n) out.capped = true;
        dayRoom -= got;
        w.coins += got;
        w.earned += got;
        w.dayEarned += got;
        out.paid += got;
        if (got) this.q.log.run(id, Date.now(), got, why);
      };

      // Coins: each one once, no faster than they can be collected.
      const fresh = unique(o.coins, (i) => Number.isInteger(i) && i >= 0 && i < M.coins && !taken.has(i));
      let allow = fresh.length;
      if (!how.replay) {
        allow = Math.min(fresh.length, Math.max(0, Math.floor(elapsed * this.rate + this.burst) - taken.size));
        while (allow > 0 && !this.coinLimit.take(id, allow)) allow = Math.floor(allow / 2);
      }
      out.accepted = fresh.slice(0, allow);
      out.later = fresh.slice(allow);
      for (const i of out.accepted) taken.add(i);
      if (allow) payDay(allow * D.coin, 'coins');

      // Relics: on real Hardcore or Insane, only the ones that exist on this map.
      if (r.diff >= 2 && !r.custom) {
        for (const relic of unique(o.relics, (x) => typeof x === 'string' && M.relics.includes(x))) {
          out.relics.push(relic);
          if (!w.relics.includes(relic)) w.relics.push(relic);
        }
        if (w.relics.length >= catalog.relicCount && !w.ach.includes('hunter')) w.ach.push('hunter');
      }

      // The top: once per climb, and only after a climb's worth of time.
      let won = r.won;
      if (o.win && !won) {
        if (!how.replay && elapsed < this.minWin) out.win = 'too fast';
        else if (!how.replay && !this.winLimit.take(id)) out.win = 'too many';
        else {
          won = 1;
          out.win = 'ok';
          payDay(D.summit, 'summit');
          const flag = 'win' + r.diff;
          if (!r.custom && !w.ach.includes(flag)) {
            w.ach.push(flag);
            // A once in a lifetime bonus doesn't count toward the daily limit.
            w.coins += D.first;
            w.earned += D.first;
            out.paid += D.first;
            out.first = D.first;
            this.q.log.run(id, Date.now(), D.first, 'first win ' + r.diff);
          }
          if (r.diff >= 2 && !r.custom) {
            if (!w.ach.includes('summit')) w.ach.push('summit');
            if (o.win.falls === 0 && !w.ach.includes('flawless')) w.ach.push('flawless');
          }
        }
      }
      this.q.putRun.run(JSON.stringify([...taken]), won, r.id);
      this.store(id, w);
      out.wallet = this.show(w);
      return out;
    });
  }

  cleanup() {
    const now = Date.now();
    this.q.oldRuns.run(now - RUN_KEEP);
    this.q.oldLedger.run(now - LEDGER_KEEP);
    this.coinLimit.sweep();
    this.winLimit.sweep();
  }
}

module.exports = { Wallet };
