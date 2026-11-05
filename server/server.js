#!/usr/bin/env node
'use strict';
// The StickManUp server: the server browser and room codes, the game relay, sign in with Discord, Steam or Google, saved
// progress, coins, the anticheat and the Discord bot. One process, one port, one SQLite file. Settings come from the
// environment (see README.md).
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const crypto = require('node:crypto');
const { DB } = require('./lib/db');
const { Rooms } = require('./lib/rooms');
const { Auth } = require('./lib/auth');
const { Limiter } = require('./lib/limits');
const { Wallet } = require('./lib/wallet');
const { Admin, ipKey } = require('./lib/admin');
const { Verifier, cleanRules, BUILD } = require('./lib/verifier');
const { Bot } = require('./lib/discord');
const { Attest } = require('./lib/attest');
const { Friends } = require('./lib/friends');
const { Staff } = require('./lib/staff');
const { Terminal } = require('./lib/terminal');

const VERSION = require('./package.json').version;
const env = process.env;
const MAX_BODY = 768 * 1024;
const MAX_SAVE = 512 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const cfg = {
  port: env.PORT ? +env.PORT : 47810,
  host: env.HOST || (env.TRUST_PROXY === '1' ? '127.0.0.1' : '0.0.0.0'),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
  termsFile: env.TERMS_FILE && fs.existsSync(env.TERMS_FILE) ? env.TERMS_FILE : path.join(__dirname, 'terms.txt'),
  tlsCert: env.TLS_CERT || '',
  tlsKey: env.TLS_KEY || '',
  trustProxy: env.TRUST_PROXY === '1',
  discord: { id: env.DISCORD_CLIENT_ID || '', secret: env.DISCORD_CLIENT_SECRET || '' },
  google: { id: env.GOOGLE_CLIENT_ID || '', secret: env.GOOGLE_CLIENT_SECRET || '' },
  steam: { on: env.STEAM_LOGIN === '1', key: env.STEAM_API_KEY || '' },
  devUrls: env.DEV_PROVIDER_URLS ? JSON.parse(env.DEV_PROVIDER_URLS) : null,
  webReturn: env.DEV_WEB_RETURN || '',
};

const tls = !!(cfg.tlsCert && cfg.tlsKey);
// Passwords and sign ins must never cross the internet unencrypted, and the Android app refuses it anyway.
if (!tls && !cfg.trustProxy && !LOOPBACK.has(cfg.host)) {
  console.error('Refusing to start: no TLS_CERT and TLS_KEY. Set them, or set TRUST_PROXY=1 behind your own HTTPS proxy, or HOST=127.0.0.1 to try it on this machine only.');
  process.exit(1);
}
if (!cfg.publicUrl) cfg.publicUrl = `${tls ? 'https' : 'http'}://127.0.0.1:${cfg.port}`;

const terms = fs.readFileSync(cfg.termsFile, 'utf8').trim();
const termsVersion = crypto.createHash('sha256').update(terms).digest('hex').slice(0, 12);
const db = new DB(cfg.dataDir);
const wallet = new Wallet(db, env);
const admin = new Admin(db, wallet, env);
const staff = new Staff(db, admin);
if (db.setting('dayCap')) wallet.setDayCap(+db.setting('dayCap'));
const verifier = new Verifier(db, wallet, admin, env);
const attest = new Attest(env);
verifier.staff = staff;
const rooms = verifier.rooms = new Rooms({
  who: (token) => db.sessionUser(token),
  isOff: (ip, token) => {
    if (admin.maintenance) return admin.maintenance;
    const id = token ? db.sessionUser(token) : null, u = id ? db.user(id) : null;
    const b = admin.banFor(id, ip, u ? u.device : null);
    return b ? `You are banned from this server. Reason: ${b.reason}` : null;
  },
  onCheat: (id, kind, detail, score) => admin.flag(id, kind, detail, score),
  ownsLook: (id, look) => { const u = db.user(id); return wallet.ownsLook(id, look, u ? u.role : ''); },
  roleOf: (id) => { const u = db.user(id); return u ? u.role : ''; },
  canJoinAny: (id) => staff.can(admin.info(id), 'join'),
  mayFly: (id) => staff.vanished(id),
  ipKey,
  // Old games have no token to give. Once the anticheat is enforcing, they need the update.
  needToken: () => admin.mode === 'enforce',
});
const friends = new Friends(db, admin, rooms, staff);
const auth = new Auth(cfg, db, termsVersion, admin);
admin.onBan = ({ userId, ip, reason }) => {
  const why = `You are banned from this server. Reason: ${reason}`;
  if (userId) { rooms.kickUser(userId, why); friends.kickUser(userId, why); }
  if (ip) { rooms.kickIp(ip, why); friends.kickIp(ip, why); }
};
const bot = new Bot({
  token: env.DISCORD_BOT_TOKEN || '', guild: env.DISCORD_BOT_GUILD || '', logChannel: env.DISCORD_BOT_LOG_CHANNEL || '', warnChannel: env.DISCORD_BOT_WARN_CHANNEL || '', admins: env.DISCORD_BOT_ADMINS || '',
  api: cfg.devUrls && cfg.devUrls.botApi, gateway: cfg.devUrls && cfg.devUrls.botGateway, registerEvery: +env.DISCORD_BOT_REGISTER_EVERY || 0,
}, { db, wallet, admin, verifier, rooms, friends, staff, version: VERSION });
// The same commands, typed in the game by the team. Answers go back over the live socket.
friends.terminal = new Terminal(bot.s, bot);

const limits = {
  auth: new Limiter(20, 20 / 60),
  api: new Limiter(120, 2),
  save: new Limiter(30, 30 / 60),
  wallet: new Limiter(120, 2),
  // Whole phone networks can share one address, so this only stops someone making accounts by the hundred.
  guest: new Limiter(+env.GUEST_LIMIT_BURST || 20, (+env.GUEST_LIMIT_PER_HOUR || 20) / 3600),
  device: new Limiter(30, 30 / 3600),
  friends: new Limiter(60, 1),
};
const sweep = setInterval(() => { for (const l of Object.values(limits)) l.sweep(); }, 60000);
sweep.unref();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function clientIp(req) {
  if (cfg.trustProxy) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (f) return f.replace(/^::ffff:/, '');
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // No cookies are used, only a token the game holds, so any page may ask. The app's own address is a fixed fake one.
    'Access-Control-Allow-Origin': '*',
  }, headers));
  res.end(body);
}
const json = (res, status, o) => send(res, status, JSON.stringify(o), { 'Content-Type': 'application/json; charset=utf-8' });

// What the browser shows at the end of signing in. No scripts, nothing from elsewhere.
function page(res, status, title, text, button) {
  const refresh = button ? `<meta http-equiv="refresh" content="1;url=${esc(button.href)}">` : '';
  send(res, status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>StickManUp</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1020;color:#e8eefc;font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
main{max-width:420px}h1{font-size:24px;margin:0 0 10px}p{color:#a9b4cc;margin:0 0 18px}a{display:inline-block;padding:14px 26px;border-radius:12px;background:#3ff0d0;color:#04121a;font-weight:700;text-decoration:none}small{display:block;margin-top:26px;color:#6c7890}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>${button ? `<a href="${esc(button.href)}">${esc(button.text)}</a>` : ''}<small>StickManUp by TheOCProductions and ShortGG</small></main></body></html>`, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Too big: answer, and stop keeping what still comes. The request timeout ends it if it never stops.
      if (size > MAX_BODY) {
        chunks.length = 0;
        reject(Object.assign(new Error('too big'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
  });
}

function signedIn(req) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  if (!m) return null;
  const id = db.sessionUser(m[1]);
  return id ? { id, token: m[1] } : null;
}

const publicUser = (u) => ({ id: u.id, num: u.num, name: u.name, provider: u.provider, created: u.created, tosOk: u.tos === termsVersion });
const deviceOf = (d) => (typeof d === 'string' && /^[0-9a-f]{16,64}$/.test(d) ? d : null);

// What each thing a phone can report counts for. Being rooted alone never counts: plenty of honest people are, the owner too.
// What is merely installed counts for nothing either, it is only kept as a note: having a tool isn't using it on this game.
const GUARD_SCORES = [
  ['sig', (g) => g.sig === false, 'phone', 80, 'Running a changed copy of the app: the signature is not the official one.'],
  ['assets', (g) => g.assets === false, 'phone', 60, 'The game files inside the app have been changed.'],
  ['frida', (g) => !!g.frida, 'phone', 60, 'Frida, a tool for changing running apps, was found in the game.'],
  ['dbg', (g) => !!g.dbg, 'phone', 20, 'A debugger is attached to the game.'],
  ['hook', (g) => !!g.hook, 'phone', 0, 'Xposed or a similar hooking tool is on the phone.'],
  ['apps', (g) => Array.isArray(g.apps) && g.apps.length > 0, 'phone', 0, 'Cheat tools are installed on the phone.'],
];
function cleanGuard(g) {
  if (!g || typeof g !== 'object') return null;
  const b = (k) => (g[k] === true ? true : g[k] === false ? false : undefined), s = (k) => (typeof g[k] === 'string' ? g[k].slice(0, 60) : undefined);
  return { sig: b('sig'), assets: b('assets'), dbg: b('dbg'), frida: b('frida'), hook: b('hook'), root: b('root'), emu: b('emu'), apps: Array.isArray(g.apps) ? g.apps.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 60)) : undefined, model: s('model'), sdk: s('sdk'), version: s('version') };
}
function deviceReport(id, user, b) {
  const device = deviceOf(b.device), g = cleanGuard(b.guard) || {};
  // Each thing counts once per account, not once per start of the game: having a cheat app installed shouldn't add up to a ban.
  const before = admin.devices(id, 1)[0], said = new Set((before && before.guard && before.guard.said) || []);
  const once = (key, kind, detail, score) => {
    if (said.has(key)) return;
    said.add(key);
    admin.flag(id, kind, detail, score);
  };
  if (b.attest && typeof b.attest === 'object') {
    const a = attest.check(id, b.attest);
    g.attest = a.text;
    if (a.flag) once(a.notOfficial ? 'attestApp' : 'attestBad', 'attest', a.flag, a.score || 10);
    if (a.notOfficial) g.sig = false;
  } else if (before && before.guard && before.guard.attest) g.attest = before.guard.attest;
  for (const [k, on, kind, score, detail] of GUARD_SCORES) if (on(g)) once(k, kind, k === 'apps' ? `${detail} ${g.apps.join(', ')}` : detail, score);
  g.said = [...said];
  if (device) admin.setDevice(id, device, g);
  const off = device ? admin.banRow('device', device) : null;
  return off ? admin.showBan(off, user) : { ok: true };
}

async function route(req, res) {
  const ip = clientIp(req), url = new URL(req.url, 'http://x'), p = url.pathname, method = req.method;

  if (method === 'OPTIONS') {
    return send(res, 204, '', { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
  }

  // Signing in, in the browser.
  const a = /^\/auth\/(discord|google|steam)\/(start|callback)$/.exec(p);
  if (a && method === 'GET') {
    if (!limits.auth.take(ip)) return page(res, 429, 'Slow down', 'Too many tries. Wait a minute and start again from the game.');
    if (a[2] === 'start') {
      const r = auth.start(a[1], url.searchParams.get('challenge'), url.searchParams.get('tos'), url.searchParams.get('ret'));
      if (r.err) return page(res, 400, 'Could not sign in', r.err);
      return send(res, 302, '', { Location: r.url });
    }
    const r = await auth.finish(a[1], url.searchParams, ip);
    if (r.err) return page(res, 400, 'Not signed in', r.err);
    return page(res, 200, `Hi ${r.name}`, 'You are signed in. Going back to the game...', { href: r.link, text: 'Back to StickManUp' });
  }

  if (method === 'GET' && p === '/') return page(res, 200, 'StickManUp server', 'This server is running. Open StickManUp to play.');
  if (method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, version: VERSION });

  if (!limits.api.take(ip)) return json(res, 429, { err: 'Too many requests' });

  if (method === 'GET' && p === '/api/info') {
    return json(res, 200, { name: 'StickManUp server', version: VERSION, credits: ['TheOCProductions', 'ShortGG'], terms, termsVersion, providers: auth.providers(), webReturn: true, online: rooms.stats(), build: BUILD, announce: admin.liveAnnouncement(), maintenance: admin.maintenance || undefined, roles: staff.table() });
  }
  if (method === 'GET' && p === '/api/rooms') {
    const proto = +url.searchParams.get('proto');
    if (!Number.isInteger(proto)) return json(res, 400, { err: 'Which version?' });
    return json(res, 200, { rooms: rooms.list(proto), online: rooms.stats() });
  }
  if (method === 'POST' && p === '/auth/exchange') {
    if (!limits.auth.take(ip)) return json(res, 429, { err: 'Too many tries' });
    const b = await readJson(req);
    const r = b && auth.exchange(b.code, b.verifier);
    if (!r) return json(res, 400, { err: 'That sign in has expired. Please try again.' });
    const u = db.user(r.userId), device = deviceOf(b && b.device), off = admin.banFor(r.userId, ip, device);
    if (off) return json(res, 403, admin.showBan(off, u));
    // What the guest on this phone earned comes along, if the account has nothing yet.
    let moved = false;
    if (b && typeof b.guest === 'string') {
      const g = db.sessionUser(b.guest), gu = g ? db.user(g) : null;
      if (gu && gu.provider === 'guest') {
        moved = wallet.moveGuest(g, r.userId);
        friends.moveGuest(g, r.userId);
        // A flag moves along with the rest.
        if (gu.role && !db.user(r.userId).role) { admin.setRole(r.userId, gu.role); admin.setRole(g, ''); }
      }
    }
    if (device) admin.setDevice(r.userId, device);
    admin.seen(r.userId, ip);
    return json(res, 200, { token: db.newSession(r.userId), user: publicUser(db.user(r.userId)), moved });
  }
  // Starting as a guest: an account all the same, with its coins kept here. They accepted the terms to get this far.
  if (method === 'POST' && p === '/api/guest') {
    if (admin.maintenance) return json(res, 503, { err: admin.maintenance });
    const b = await readJson(req);
    if (!b || b.tos !== termsVersion) return json(res, 409, { err: 'The terms have changed', termsVersion });
    const device = deviceOf(b.device), off = admin.banFor(null, ip, device);
    if (off) return json(res, 403, admin.showBan(off));
    if (!limits.guest.take(ip)) return json(res, 429, { err: 'Too many new guests from this address. Try again later.' });
    const g = db.newGuest(termsVersion);
    db.renameGuest(g.id);
    if (device) admin.setDevice(g.id, device);
    if (b.name) admin.setGameName(g.id, b.name);
    admin.seen(g.id, ip);
    admin.notify.signin({ user: db.user(g.id), provider: 'guest', ip, isNew: true });
    return json(res, 200, { token: db.newSession(g.id), user: publicUser(db.user(g.id)) });
  }

  // Every copy of the game asks this every half a minute, signed in or not: may this person play, and is there anything to tell them?
  // The answer is worked out here from the account, the address and the phone, so nothing done to the game can change it.
  // The phone also says how high it is. That is only for showing on Discord, nothing is paid on it.
  if (method === 'POST' && p === '/api/standing') {
    const b = (await readJson(req)) || {};
    const me = signedIn(req), user = me ? db.user(me.id) : null, device = deviceOf(b.device);
    if (user) {
      admin.seen(user.id, ip);
      if (device && device !== user.device) admin.setDevice(user.id, device);
      const c = b.climb;
      if (c && typeof c === 'object' && Number.isInteger(c.map) && Number.isInteger(c.diff) && Number.isInteger(c.h)) {
        admin.played(user.id, { map: Math.max(0, Math.min(20, c.map)), diff: Math.max(0, Math.min(20, c.diff)), h: Math.max(0, Math.min(2000, c.h)), live: true });
      }
    }
    const off = admin.banFor(user ? user.id : null, ip, device) || (user && user.device ? admin.banRow('device', user.device) : null);
    if (off) return json(res, 200, { ban: admin.showBan(off, user) });
    return json(res, 200, { ban: null, inbox: user ? admin.inbox(user.id) : [], cpReset: user ? user.cp_reset : 0 });
  }

  // Everything below needs an account.
  if (!p.startsWith('/api/')) return json(res, 404, { err: 'Not found' });
  const known = (p === '/api/wallet' && method === 'GET') || (method === 'POST' && (p === '/api/inbox/read' || p === '/api/wallet/import' || p === '/api/buy' || p === '/api/run/start' || p === '/api/run/report' || p === '/api/run/chunk' || p === '/api/device' || p === '/api/attest/challenge')) || (p === '/api/me' && (method === 'GET' || method === 'DELETE')) || (p === '/api/logout' && method === 'POST') || (p === '/api/tos' && method === 'POST') || (p === '/api/save' && (method === 'GET' || method === 'PUT')) || (p === '/api/friends' && method === 'GET') || (method === 'POST' && (p === '/api/friends/search' || p === '/api/friends/act' || p === '/api/friends/watch'));
  if (!known) return json(res, 404, { err: 'Not found' });
  const me = signedIn(req);
  if (!me) return json(res, 401, { err: 'Please sign in' });
  const user = db.user(me.id);
  if (!user) return json(res, 401, { err: 'Please sign in' });
  admin.seen(me.id, ip);

  // Banned: the game gets told why, and can still leave or delete the account. Nothing else.
  const off = admin.banFor(me.id, ip, user.device);
  if (p === '/api/me' && method === 'GET') return json(res, 200, { user: publicUser(user), ban: off ? admin.showBan(off, user) : undefined });
  if (p === '/api/me') {
    db.deleteUser(me.id);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/logout') {
    db.endSession(me.token);
    return json(res, 200, { ok: true });
  }
  if (off) return json(res, 403, admin.showBan(off, user));
  // Friends. What a friend can see of someone is decided in lib/friends.js, never by the phone asking.
  if (p.startsWith('/api/friends')) {
    if (!limits.friends.take(me.id)) return json(res, 429, { err: 'Too many requests. Try again later.' });
    if (p === '/api/friends') return json(res, 200, friends.list(me.id));
    const b = await readJson(req);
    if (!b || typeof b !== 'object') return json(res, 400, { err: 'Bad request' });
    if (p === '/api/friends/search') {
      const r = friends.search(me.id, b.q);
      return json(res, r.err ? 429 : 200, r);
    }
    if (p === '/api/friends/watch') return json(res, 200, friends.setWatch(me.id, !!b.allow));
    const r = friends.act(me.id, b.act, b.num);
    return json(res, r.err ? 400 : 200, r);
  }
  if (p === '/api/inbox/read') {
    const b = (await readJson(req)) || {};
    admin.inboxRead(me.id, b.ids);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/run/start' && admin.maintenance) return json(res, 503, { err: admin.maintenance });
  // What a phone says about itself. It can lie, so it can only ever count against it, and a hardware check says how far to believe it.
  if (p === '/api/attest/challenge') {
    if (!limits.device.take(me.id)) return json(res, 429, { err: 'Too many requests' });
    return json(res, 200, { challenge: attest.newChallenge(me.id) });
  }
  if (p === '/api/device') {
    if (!limits.device.take(me.id)) return json(res, 429, { err: 'Too many requests' });
    const b = await readJson(req);
    if (!b || typeof b !== 'object') return json(res, 400, { err: 'Bad request' });
    const r = deviceReport(me.id, user, b);
    return json(res, r.banned ? 403 : 200, r);
  }
  if (p === '/api/tos') {
    const b = await readJson(req);
    if (!b || b.version !== termsVersion) return json(res, 409, { err: 'The terms have changed', termsVersion });
    db.acceptTerms(me.id, termsVersion);
    return json(res, 200, { user: publicUser(db.user(me.id)) });
  }
  // The money. Nothing below this ever takes a phone's word for a balance.
  if (p.startsWith('/api/wallet') || p === '/api/buy' || p.startsWith('/api/run/')) {
    if (!limits.wallet.take(me.id)) return json(res, 429, { err: 'Too many requests' });
    if (p === '/api/wallet') return json(res, 200, Object.assign(wallet.get(me.id), { role: user.role }));
    const b = await readJson(req);
    if (!b || typeof b !== 'object') return json(res, 400, { err: 'Bad request' });
    if (p === '/api/wallet/import') {
      const r = wallet.importGuest(me.id, b);
      return json(res, r.status, { wallet: r.wallet });
    }
    if (p === '/api/buy') {
      const r = wallet.buy(me.id, b.id);
      return json(res, r.status, { err: r.err, wallet: r.wallet });
    }
    if (p === '/api/run/start') {
      if (b.name) admin.setGameName(me.id, b.name);
      const run = wallet.startRun(me.id, b.rules ? Object.assign({}, b, { rules: cleanRules(b.rules) }) : b);
      if (run) admin.played(me.id, { map: b.map, diff: b.diff, h: 0, newClimb: false });
      return run ? json(res, 200, { run, build: BUILD }) : json(res, 400, { err: 'Bad climb' });
    }
    if (p === '/api/run/chunk') {
      const r = await verifier.chunk(user, b);
      const { status, ...out } = r;
      return json(res, status, out);
    }
    // Older games report coins with nothing to check them against. Once the anticheat is enforcing that pays nothing.
    if (admin.mode === 'enforce' && !user.trusted) return json(res, 200, { paid: 0, accepted: [], later: [], update: true, wallet: wallet.get(me.id) });
    const r = wallet.report(me.id, b);
    const { status, ...out } = r;
    return json(res, status, out);
  }
  if (method === 'GET') return json(res, 200, db.getSave(me.id));

  // Saving. Only over the version it was based on, so two phones can't silently overwrite each other.
  if (!limits.save.take(me.id)) return json(res, 429, { err: 'Too many saves' });
  const b = await readJson(req);
  if (!b || !Number.isInteger(b.rev) || b.rev < 0 || !b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return json(res, 400, { err: 'Bad save' });
  // Only records and the saved climb are kept this way. Whatever else a phone says about itself is not listened to.
  const pr = b.data.profile && typeof b.data.profile === 'object' ? b.data.profile : {};
  b.data.profile = { eq: pr.eq, runs: pr.runs, totals: pr.totals };
  const text = JSON.stringify(b.data);
  if (Buffer.byteLength(text) > MAX_SAVE) return json(res, 413, { err: 'Save too big' });
  const rev = db.putSave(me.id, b.rev, text);
  if (rev < 0) return json(res, 409, db.getSave(me.id));
  return json(res, 200, { rev });
}

function handler(req, res) {
  route(req, res).catch((e) => {
    const status = e.status || 500;
    if (status === 500) console.error('request failed:', e.message);
    if (!res.headersSent) json(res, status, { err: status === 500 ? 'Server error' : 'Bad request' });
    else res.destroy();
  });
}

const readTls = () => ({ cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey) });
const server = tls ? https.createServer(Object.assign({ minVersion: 'TLSv1.2' }, readTls()), handler) : http.createServer(handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 10000;
server.maxHeadersCount = 60;
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  const where = new URL(req.url, 'http://x').pathname;
  if (where === '/ws') return rooms.upgrade(req, socket, head, clientIp(req));
  if (where === '/live') return friends.upgrade(req, socket, head, clientIp(req));
  socket.destroy();
});
server.on('clientError', (e, socket) => socket.destroy());

// A renewed certificate: systemctl reload picks it up without dropping a single game.
process.on('SIGHUP', () => {
  if (!tls) return;
  try {
    server.setSecureContext(readTls());
    console.log('certificate reloaded');
  } catch (e) {
    console.error('could not reload the certificate:', e.message);
  }
});

function backupNow() {
  try {
    db.backup();
    db.cleanup();
    wallet.cleanup();
    admin.cleanup();
    verifier.cleanup();
    friends.cleanup();
  } catch (e) {
    console.error('backup failed:', e.message);
  }
}
const daily = setInterval(backupNow, 86400000);
daily.unref();

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  rooms.stop();
  friends.stop();
  auth.stop();
  bot.stop();
  verifier.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

server.listen(cfg.port, cfg.host, () => {
  console.log(`StickManUp server ${VERSION} on ${cfg.host}:${server.address().port}, ${tls ? 'HTTPS' : 'plain HTTP'}. Public address: ${cfg.publicUrl}. Sign in: ${auth.providers().join(', ') || 'none set up yet'}. Accounts: ${db.userCount()}. Anticheat: ${admin.mode}. Bot: ${bot.on ? 'on' : 'off'}.`);
  backupNow();
  bot.start();
  attest.refresh();
});
