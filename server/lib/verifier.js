'use strict';
// The server's side of a climb. A phone sends what it played a chunk at a time, this keeps it, has it played again in a
// worker (verify-worker.mjs), pays what the rerun found and raises a flag when the phone's story doesn't match.
//
// Set to watch, coins are still paid the old way and everything is only reported, so the checks can be proven on real phones
// before they cost anyone anything. Set to enforce, only what the rerun found is paid.
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DAY = 86400000;
const MAX_CHUNKS_PER_RUN = 600;
const MAX_DATA = 512 * 1024;
const MAX_TICKS = 2000;
const CHUNK_KEEP = 3 * DAY;
const FLAGGED_KEEP = 7 * DAY;
const WORK_TIMEOUT = 45000;
const MAX_QUEUE = 300;
const SNAPS_KEPT = 12;
const SAFE_RULE = (v) => (Number.isInteger(v) && v >= 0 && v <= 3 ? v : undefined);

const BUILD = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'sim/build.json'), 'utf8')).build; } catch (e) { return ''; }
})();

class Verifier {
  constructor(db, wallet, admin, env = {}) {
    this.d = db.db;
    this.wallet = wallet;
    this.admin = admin;
    this.env = env;
    this.build = BUILD;
    this.slack = Number.isFinite(+env.ANTICHEAT_SPEED_SLACK) && env.ANTICHEAT_SPEED_SLACK !== undefined ? +env.ANTICHEAT_SPEED_SLACK : 30;
    this.rooms = null;
    this.workers = [];
    this.count = Math.max(1, Math.min(8, +env.ANTICHEAT_WORKERS || 1));
    this.pending = new Map();
    this.nextId = 1;
    this.locks = new Map();
    this.stopped = false;
    this.stats = { chunks: 0, ticks: 0, flags: 0, ms: 0 };
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS run_chunks (
        run TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, at INTEGER NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (run, seq)
      );
    `);
    const q = (s) => this.d.prepare(s);
    this.q = {
      run: q('SELECT * FROM runs WHERE id = ?'),
      addChunk: q('INSERT OR REPLACE INTO run_chunks (run, seq, at, n, data) VALUES (?, ?, ?, ?, ?)'),
      history: q('SELECT data FROM run_chunks WHERE run = ? AND seq >= ? AND seq < ? ORDER BY seq'),
      update: q('UPDATE runs SET next_seq = ?, segment = ?, ticks = ?, last_at = ?, tainted = ?, verdict = ?, snaps = ?, seen = ?, best_h = ?, later = ?, build = ?, falls = ?, dead = ? WHERE id = ?'),
      markDead: q('UPDATE runs SET dead = 1 WHERE id = ?'),
      oldChunks: q('DELETE FROM run_chunks WHERE at < ? AND run NOT IN (SELECT id FROM runs WHERE tainted = 1)'),
      oldFlagged: q('DELETE FROM run_chunks WHERE at < ?'),
      recent: q('SELECT * FROM runs WHERE user_id = ? ORDER BY started DESC LIMIT ?'),
      partner: q(`SELECT MAX(COALESCE(last_at, started)) AS t, MAX(tainted) AS bad FROM runs WHERE user_id = ? AND mode != 'solo' AND started > ?`),
    };
  }

  // ---------------------------------------------------------------- the worker
  spawn(i) {
    const w = new Worker(path.join(__dirname, 'verify-worker.mjs'), { resourceLimits: { maxOldGenerationSizeMb: 512 } });
    w.jobs = new Set();
    w.on('message', (m) => {
      if (m.ready) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      w.jobs.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m.r);
    });
    const down = (why) => {
      console.error(`rerun worker stopped: ${why}`);
      for (const id of w.jobs) {
        const p = this.pending.get(id);
        if (p) { this.pending.delete(id); clearTimeout(p.timer); p.resolve({ error: 'worker stopped' }); }
      }
      w.jobs.clear();
      if (this.workers[i] === w) this.workers[i] = null;
    };
    w.on('error', (e) => down(e.message));
    w.on('exit', (c) => { if (!this.stopped) down('exit ' + c); });
    w.unref();
    return w;
  }
  // One climb always goes to the same worker, which is where its game is held.
  workerFor(run) {
    let h = 0;
    for (let i = 0; i < run.length; i++) h = (h * 31 + run.charCodeAt(i)) | 0;
    const i = Math.abs(h) % this.count;
    if (!this.workers[i]) this.workers[i] = this.spawn(i);
    return this.workers[i];
  }
  work(job) {
    return new Promise((resolve) => {
      const id = this.nextId++, w = this.workerFor(job.run.id);
      const timer = setTimeout(() => { this.pending.delete(id); w.jobs.delete(id); resolve({ error: 'too slow' }); }, WORK_TIMEOUT);
      this.pending.set(id, { resolve, timer });
      w.jobs.add(id);
      w.postMessage(Object.assign({ id }, job));
    });
  }
  queueLength() { return this.pending.size; }

  // ---------------------------------------------------------------- one at a time per climb
  chunk(user, body) {
    const key = String(body && body.run);
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.then(() => this.handle(user, body));
    const done = next.catch(() => {}).finally(() => { if (this.locks.get(key) === done) this.locks.delete(key); });
    this.locks.set(key, done);
    return next;
  }

  // Pay what the rules allow, by whichever rule is on. Answers what the phone wants to know.
  pay(user, r, o) {
    const res = this.wallet.report(user.id, Object.assign({ run: r.id }, o), { replay: o.replay });
    return { status: res.status, wallet: res.wallet, capped: res.capped, win: res.win, later: res.later || [], paid: res.paid || 0, first: res.first || 0 };
  }

  async handle(user, b) {
    const r = typeof b.run === 'string' ? this.q.run.get(b.run) : null;
    if (!r || r.user_id !== user.id) return { status: 404, err: 'That climb is not known here.' };
    if (r.dead) return { status: 200, stop: 'dead', wallet: this.wallet.get(user.id) };
    const mode = this.admin.mode, trusted = !!user.trusted;
    const enforce = mode === 'enforce' && !trusted;
    const claims = { coins: Array.isArray(b.coins) ? b.coins.slice(0, 2000) : [], relics: Array.isArray(b.relics) ? b.relics.slice(0, 40) : [], win: b.win && typeof b.win === 'object' ? b.win : null };
    const later = JSON.parse(r.later || '[]');

    // A phone on another version of the game can't be compared. Nobody's fault: it needs the update.
    if (b.build !== this.build) {
      if (enforce) return { status: 200, stop: 'update', wallet: this.wallet.get(user.id) };
      const p = this.pay(user, r, { coins: [...later, ...claims.coins], relics: claims.relics, win: claims.win });
      this.q.update.run(Number.isInteger(b.seq) ? b.seq + 1 : r.next_seq, r.segment, r.ticks + (b.n | 0), Date.now(), r.tainted, r.verdict, r.snaps, r.seen, r.best_h, JSON.stringify(p.later.slice(0, 2000)), String(b.build || '').slice(0, 32), r.falls, 0, r.id);
      return { status: 200, next: (b.seq | 0) + 1, wallet: p.wallet, capped: p.capped, winResult: p.win };
    }

    // Nothing played since last time, only something to say. Only an old list of coins can do this.
    if (b.data === undefined || b.data === null) {
      if (enforce) return { status: 200, next: r.next_seq, wallet: this.wallet.get(user.id) };
      const p = this.pay(user, r, { coins: [...later, ...claims.coins], relics: claims.relics, win: claims.win });
      return { status: 200, next: r.next_seq, wallet: p.wallet, capped: p.capped, winResult: p.win };
    }

    if (!Number.isInteger(b.seq) || b.seq < 0 || !Number.isInteger(b.n) || b.n < 0 || b.n > MAX_TICKS || typeof b.data !== 'string' || b.data.length > MAX_DATA) return { status: 400, err: 'Bad chunk' };
    // Sent twice, when the answer got lost the first time.
    if (b.seq < r.next_seq) return { status: 200, next: r.next_seq, wallet: this.wallet.get(user.id) };
    if (b.seq > r.next_seq) return { status: 200, next: r.next_seq, stop: 'gap', wallet: this.wallet.get(user.id) };
    if (b.seq >= MAX_CHUNKS_PER_RUN) { this.q.markDead.run(r.id); return { status: 200, stop: 'dead', wallet: this.wallet.get(user.id) }; }
    if (this.queueLength() > MAX_QUEUE) return { status: 503, err: 'Busy', retry: true };

    // Picking up a save: from what the server saw at that save, or not at all.
    let segment = r.segment, snapshot = null, unknownSave = false;
    const snaps = JSON.parse(r.snaps || '[]');
    if (b.fresh) {
      segment = b.seq;
      if (r.mode === 'solo') {
        if (b.resume !== undefined && b.resume !== null) snapshot = snaps.find((s) => s.seq === b.resume) || null;
        if (b.seq !== 0 && !snapshot) {
          if (enforce) { this.q.markDead.run(r.id); return { status: 200, stop: 'save', wallet: this.wallet.get(user.id) }; }
          unknownSave = true;
        }
      }
    } else if (r.snapshot_seq !== null && r.snapshot_seq !== undefined) {
      snapshot = snaps.find((s) => s.seq === r.snapshot_seq) || null;
    }

    const started = Date.now();
    let tainted = r.tainted || (unknownSave ? 1 : 0), result = null;
    const data = Buffer.from(b.data, 'base64');
    if (data.length === 0 || data.toString('base64').replace(/=+$/, '') !== b.data.replace(/=+$/, '')) return { status: 400, err: 'Bad chunk' };
    this.q.addChunk.run(r.id, b.seq, started, b.n, data);

    const job = { run: { id: r.id, map: r.map, diff: r.diff, rules: JSON.parse(r.rules || '{}'), snapshot }, seq: b.seq, segment, data: b.data };
    if (!tainted) {
      result = await this.work(job);
      if (result.miss) {
        const history = this.q.history.all(r.id, segment, b.seq).map((x) => Buffer.from(x.data).toString('base64'));
        result = await this.work(Object.assign({}, job, { history }));
      }
      if (result.error) {
        // Whatever went wrong here, it says nothing about the player.
        console.error(`rerun of a climb failed: ${result.error}`);
        if (/bad|no start|JSON|invalid|incorrect|unexpected|Unexpected/i.test(result.error)) {
          this.admin.flag(user.id, 'bad', 'Sent a climb recording that can not be read.', 20, r.id);
          tainted = 1;
        }
        result = null;
      }
    }

    // ---------------------------------------------------------------- what it found
    const elapsed = (Date.now() - r.started) / 1000, ticks = r.ticks + b.n, seen = new Set(JSON.parse(r.seen || '[]'));
    let verdict = r.verdict, best = r.best_h;
    if (result) {
      this.stats.chunks++;
      this.stats.ticks += b.n;
      this.stats.ms += Date.now() - started;
      for (const c of result.coins) seen.add(c);
      for (const x of result.relics) seen.add(x);
      if (result.h > best) best = result.h;
      for (const f of result.flags) {
        this.stats.flags++;
        this.admin.flag(user.id, f.kind, f.detail, f.score, r.id);
        verdict = f.detail;
        tainted = 1;
      }
      if (result.tainted) tainted = 1;
      for (const s of result.snaps) { snaps.push(s); while (snaps.length > SNAPS_KEPT) snaps.shift(); }
    }

    // The clock: the phone can't have played longer than the server has known about this climb.
    if (!tainted && ticks / 60 > elapsed + this.slack) {
      const factor = Math.round((ticks / 60 / Math.max(elapsed, 1)) * 10) / 10;
      const detail = `Game speed hack: played ${Math.round(ticks / 60)} s of climb in ${Math.round(elapsed)} s of real time (${factor}x).`;
      this.admin.flag(user.id, 'clock', detail, 60, r.id);
      verdict = detail;
      tainted = 1;
    }

    // A phone claiming coins the rerun never reached.
    if (result && !tainted) {
      const forged = claims.coins.filter((c) => !seen.has(c)), fakeRelics = claims.relics.filter((c) => !seen.has(c));
      // One that doesn't match could be a rounding accident on a phone, and pays nothing when enforcing anyway. Three can't be.
      const total = (r.forged | 0) + forged.length;
      if (forged.length) this.d.prepare('UPDATE runs SET forged = ? WHERE id = ?').run(total, r.id);
      if (total > 2 || fakeRelics.length) {
        const detail = fakeRelics.length ? `Claimed a relic it never reached: ${String(fakeRelics[0]).slice(0, 32)}.` : `Claimed ${total} coins it never reached.`;
        this.admin.flag(user.id, 'coins', detail, 40, r.id);
        verdict = detail;
        tainted = 1;
      }
    }

    // ---------------------------------------------------------------- paying
    let pay;
    if (enforce) {
      const fine = !tainted && result && this.partnersFine(user.id, r);
      pay = fine ? this.pay(user, r, { coins: result.coins, relics: result.relics, win: result.win, replay: true }) : { wallet: this.wallet.get(user.id), later: [] };
    } else {
      pay = this.pay(user, r, { coins: [...later, ...claims.coins], relics: claims.relics, win: claims.win });
    }

    this.q.update.run(b.seq + 1, segment, ticks, Date.now(), tainted ? 1 : 0, verdict || null, JSON.stringify(snaps), JSON.stringify([...seen]), best, JSON.stringify((pay.later || []).slice(0, 2000)), this.build, result ? result.falls | 0 : r.falls, 0, r.id);
    if (snapshot && b.fresh) this.d.prepare('UPDATE runs SET snapshot_seq = ? WHERE id = ?').run(snapshot.seq, r.id);
    this.admin.played(user.id, { map: r.map, diff: r.diff, h: best, newClimb: b.seq === 0 });

    const out = { status: 200, next: b.seq + 1, wallet: pay.wallet, capped: pay.capped, winResult: pay.win, paid: pay.paid };
    if (tainted && enforce) out.stop = 'tainted';
    return out;
  }

  // With others, what they did is part of this climb, so they have to be real and being checked too. Alone in a room with
  // nobody to pull you up, or with a made up partner that isn't sending any climb of its own, counts for nothing.
  partnersFine(id, r) {
    if (r.mode === 'solo') return true;
    const room = this.rooms && this.rooms.roomOf(id);
    if (!room) return false;
    const t = Date.now();
    if (room.users.length !== room.n) return false;
    for (const other of room.users) {
      if (other === id) continue;
      const p = this.q.partner.get(other, t - DAY);
      if (!p || !p.t || p.t < t - 120000 || p.bad) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- for the admins
  recent(id, n = 10) { return this.q.recent.all(id, n); }
  run(id) { return this.q.run.get(id); }
  cleanup() {
    const t = Date.now();
    this.q.oldChunks.run(t - CHUNK_KEEP);
    this.q.oldFlagged.run(t - FLAGGED_KEEP);
  }
  stop() {
    this.stopped = true;
    for (const w of this.workers) if (w) w.terminate();
  }
}

// What a phone may ask for in a climb's rules.
function cleanRules(o) {
  const out = {};
  for (const k of ['cps', 'haz', 'rope']) {
    const v = SAFE_RULE(o && o[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

module.exports = { Verifier, cleanRules, BUILD };
