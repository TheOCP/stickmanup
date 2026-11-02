'use strict';
// The coins of everyone who is signed in. The balance and what they own live only here, so editing a phone changes nothing
// and nothing can be bought without enough coins.
//
// The one thing the server has to take a phone's word for is what happened in a climb, because the phone runs the climb.
// So that word is checked against what a climb can really give: every coin once per climb, no faster than a climber can
// collect them, a win only after a climb's worth of time, each first win bonus once, and a limit per day. Lying can get
// you what playing all day would, and no more. catalog.json is made from the game's own tables by dev/makecatalog.mjs.
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
    const q = (s) => this.d.prepare(s);
    this.q = {
      add: q(`INSERT OR IGNORE INTO wallets (user_id, coins, earned, own, relics, ach, imported, day, day_earned) VALUES (?, 0, 0, '[]', '[]', '[]', 0, ?, 0)`),
      get: q('SELECT * FROM wallets WHERE user_id = ?'),
      put: q('UPDATE wallets SET coins = ?, earned = ?, own = ?, relics = ?, ach = ?, imported = ?, day = ?, day_earned = ? WHERE user_id = ?'),
      log: q('INSERT INTO ledger (user_id, at, delta, why) VALUES (?, ?, ?, ?)'),
      addRun: q('INSERT INTO runs (id, user_id, map, diff, custom, started, coins, won) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'),
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

  // The first time on an account, what you had as a guest comes along, up to a limit: nobody can check how a guest got it.
  // Things first, the cheapest first, then coins with what is left.
  importGuest(id, o) {
    return this.tx(() => {
      const w = this.load(id);
      if (w.imported) return { status: 409, wallet: this.show(w) };
      let left = this.importCap, value = 0;
      const own = unique(o && o.own, (x) => typeof x === 'string' && catalog.items[x] > 0).sort((a, b) => catalog.items[a] - catalog.items[b]);
      for (const item of own) {
        const price = catalog.items[item];
        if (price > left) break;
        left -= price;
        value += price;
        if (!w.own.includes(item)) w.own.push(item);
      }
      const coins = Math.min(left, Math.floor(num(o && o.coins, 0)));
      w.coins += coins;
      w.earned += coins + value;
      w.imported = 1;
      this.store(id, w);
      if (coins + value) this.q.log.run(id, Date.now(), coins, 'guest coins and things worth ' + value);
      return { status: 200, wallet: this.show(w) };
    });
  }

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
    this.q.addRun.run(run, id, map, diff, o.custom ? 1 : 0, Date.now(), '[]');
    this.q.extraRuns.run(id, id, MAX_RUNS);
    return run;
  }

  // A phone says what happened in its climb. Answers what counted. What can't count yet comes back in `later` to send again.
  report(id, o) {
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
      let allow = Math.min(fresh.length, Math.max(0, Math.floor(elapsed * this.rate + this.burst) - taken.size));
      while (allow > 0 && !this.coinLimit.take(id, allow)) allow = Math.floor(allow / 2);
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
        if (elapsed < this.minWin) out.win = 'too fast';
        else if (!this.winLimit.take(id)) out.win = 'too many';
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
