#!/usr/bin/env node
'use strict';
// The StickManUp server: the server browser and room codes, the game relay, sign in with Discord, Steam or Google, and
// saved progress. One process, one port, one SQLite file. Settings come from the environment (see README.md).
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
const rooms = new Rooms();
const auth = new Auth(cfg, db, termsVersion);

const limits = {
  auth: new Limiter(20, 20 / 60),
  api: new Limiter(120, 2),
  save: new Limiter(30, 30 / 60),
  wallet: new Limiter(120, 2),
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

const publicUser = (u) => ({ id: u.id, name: u.name, provider: u.provider, created: u.created, tosOk: u.tos === termsVersion });

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
      const r = auth.start(a[1], url.searchParams.get('challenge'), url.searchParams.get('tos'));
      if (r.err) return page(res, 400, 'Could not sign in', r.err);
      return send(res, 302, '', { Location: r.url });
    }
    const r = await auth.finish(a[1], url.searchParams);
    if (r.err) return page(res, 400, 'Not signed in', r.err);
    return page(res, 200, `Hi ${r.name}`, 'You are signed in. Going back to the game...', { href: r.link, text: 'Back to StickManUp' });
  }

  if (method === 'GET' && p === '/') return page(res, 200, 'StickManUp server', 'This server is running. Open StickManUp to play.');
  if (method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, version: VERSION });

  if (!limits.api.take(ip)) return json(res, 429, { err: 'Too many requests' });

  if (method === 'GET' && p === '/api/info') {
    return json(res, 200, { name: 'StickManUp server', version: VERSION, credits: ['TheOCProductions', 'ShortGG'], terms, termsVersion, providers: auth.providers(), online: rooms.stats() });
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
    return json(res, 200, { token: db.newSession(r.userId), user: publicUser(db.user(r.userId)) });
  }

  // Everything below needs an account.
  if (!p.startsWith('/api/')) return json(res, 404, { err: 'Not found' });
  const known = (p === '/api/wallet' && method === 'GET') || (method === 'POST' && (p === '/api/wallet/import' || p === '/api/buy' || p === '/api/run/start' || p === '/api/run/report')) || (p === '/api/me' && (method === 'GET' || method === 'DELETE')) || (p === '/api/logout' && method === 'POST') || (p === '/api/tos' && method === 'POST') || (p === '/api/save' && (method === 'GET' || method === 'PUT'));
  if (!known) return json(res, 404, { err: 'Not found' });
  const me = signedIn(req);
  if (!me) return json(res, 401, { err: 'Please sign in' });
  const user = db.user(me.id);
  if (!user) return json(res, 401, { err: 'Please sign in' });

  if (p === '/api/me' && method === 'GET') return json(res, 200, { user: publicUser(user) });
  if (p === '/api/me') {
    db.deleteUser(me.id);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/logout') {
    db.endSession(me.token);
    return json(res, 200, { ok: true });
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
    if (p === '/api/wallet') return json(res, 200, wallet.get(me.id));
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
      const run = wallet.startRun(me.id, b);
      return run ? json(res, 200, { run }) : json(res, 400, { err: 'Bad climb' });
    }
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
  if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
  rooms.upgrade(req, socket, head, clientIp(req));
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
  auth.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

server.listen(cfg.port, cfg.host, () => {
  console.log(`StickManUp server ${VERSION} on ${cfg.host}:${server.address().port}, ${tls ? 'HTTPS' : 'plain HTTP'}. Public address: ${cfg.publicUrl}. Sign in: ${auth.providers().join(', ') || 'none set up yet'}. Accounts: ${db.userCount()}.`);
  backupNow();
});
