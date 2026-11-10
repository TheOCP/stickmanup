// The real server against real sockets, with fake Discord, Google and Steam sites, and with people trying to break it.
// Exit code 1 if anything fails. Usage: node dev/servertest.js
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const WebSocket = require('../server/vendor/ws');
const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '../server/server.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smu-server-'));
let failed = 0, passed = 0;
const check = (name, ok, info = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info !== '' ? '  [' + (typeof info === 'string' ? info : JSON.stringify(info)) + ']' : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const pkce = () => { const verifier = b64(crypto.randomBytes(32)); return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }; };

// ---------------------------------------------------------------- fake sign in sites
const mock = { steamValid: true, name: 'Ana', discordId: 'd1', googleSub: 'g1', tokens: 0, lastForm: null };
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname.endsWith('/token')) {
      const f = new URLSearchParams(body);
      mock.lastForm = f;
      const who = u.pathname.split('/')[1];
      if (f.get('client_secret') !== who + '-secret' || f.get('code') !== 'goodcode' || !f.get('redirect_uri').endsWith(`/auth/${who}/callback`)) { res.writeHead(400); return res.end('{}'); }
      mock.tokens++;
      return send({ access_token: 'tok-' + who });
    }
    if (u.pathname === '/discord/user') return req.headers.authorization === 'Bearer tok-discord' ? send({ id: mock.discordId, username: mock.name }) : (res.writeHead(401), res.end());
    if (u.pathname === '/google/user') return req.headers.authorization === 'Bearer tok-google' ? send({ sub: mock.googleSub, given_name: mock.name }) : (res.writeHead(401), res.end());
    if (u.pathname === '/steam/login' && req.method === 'POST') {
      const f = new URLSearchParams(body);
      mock.lastForm = f;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${mock.steamValid && f.get('openid.mode') === 'check_authentication'}\n`);
    }
    if (u.pathname === '/steam/players') return send({ response: { players: [{ personaname: mock.name }] } });
    if (u.pathname.startsWith('/steam/profiles/')) return res.end(`<?xml version="1.0"?><profile><steamID><![CDATA[${mock.name}]]></steamID></profile>`);
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
const M = `http://127.0.0.1:${mockServer.address().port}`;
const DEV = { discordAuth: M + '/discord/auth', discordToken: M + '/discord/token', discordUser: M + '/discord/user', googleAuth: M + '/google/auth', googleToken: M + '/google/token', googleUser: M + '/google/user', steamLogin: M + '/steam/login', steamPlayers: M + '/steam/players', steamProfile: M + '/steam/profiles/' };

// ---------------------------------------------------------------- starting a server
function startServer(env, wantReady = true) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { env: Object.assign({ PATH: process.env.PATH }, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => {
      out += d;
      const m = /on [^ ]+:(\d+),/.exec(out);
      if (m && wantReady) resolve({ p, port: +m[1], out: () => out });
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ p, code, out: () => out, exited: true }));
  });
}
const DATA = path.join(TMP, 'data');
const portFree = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => r(n)); }); });
const baseEnv = { PORT: String(portFree), HOST: '127.0.0.1', TRUST_PROXY: '1', DATA_DIR: DATA, DISCORD_CLIENT_ID: 'discord-id', DISCORD_CLIENT_SECRET: 'discord-secret', GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret', STEAM_LOGIN: '1', STEAM_API_KEY: 'steam-key', DEV_PROVIDER_URLS: JSON.stringify(DEV) };

const refuse = await startServer({ PORT: '0', HOST: '0.0.0.0', DATA_DIR: path.join(TMP, 'x') });
check('refuses to run unencrypted on the open internet', refuse.exited && refuse.code === 1, refuse.out());

let srv = await startServer(baseEnv);
const PORT = srv.port, B = `http://127.0.0.1:${PORT}`;
check('starts', !!PORT, srv.out());
const PUBLIC = B;

// Each part of the test comes from its own address, so the limits only bite where they are being tested.
let ipN = 1;
const newIp = () => `10.0.${(ipN >> 8) & 255}.${ipN++ & 255}`;
const api = async (p, o = {}) => {
  const ip = o.ip || newIp(), headers = Object.assign({ 'X-Forwarded-For': ip }, o.token ? { Authorization: 'Bearer ' + o.token } : {}, o.body !== undefined ? { 'Content-Type': 'application/json' } : {});
  const r = await fetch(B + p, { method: o.method || (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text, headers: r.headers };
};

// ---------------------------------------------------------------- basics
const info = (await api('/api/info')).json;
check('the info lists the sign ins that are set up', JSON.stringify(info.providers) === '["discord","steam","google"]', info.providers);
check('the info names who made the game', info.credits.join() === 'TheOCProductions,ShortGG', info.credits);
check('the info has the terms', /TheOCProductions and ShortGG/.test(info.terms) && /^[0-9a-f]{12}$/.test(info.termsVersion));
check('no secret anywhere in the info', !/secret|steam-key/.test(JSON.stringify(info)));
check('health answers', (await api('/api/health')).json.ok === true);
check('unknown address is a 404', (await api('/nope')).status === 404);
check('unknown api is a 404', (await api('/api/nope')).status === 404);
check('the front page has no scripts', !/<script/i.test((await api('/')).text));

// ---------------------------------------------------------------- rooms
class Sock {
  constructor(ip = newIp()) {
    this.q = []; this.waiting = []; this.closed = null;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'X-Forwarded-For': ip } });
    this.ws.on('message', (d) => { const s = d.toString(); if (this.waiting.length) this.waiting.shift()(s); else this.q.push(s); });
    this.ws.on('close', (c) => { this.closed = c; for (const w of this.waiting.splice(0)) w(null); });
    this.ws.on('error', () => {});
    this.ready = new Promise((r, j) => { this.ws.once('open', r); this.ws.once('error', j); this.ws.once('unexpected-response', () => j(new Error('refused'))); });
  }
  send(s) { this.ws.send(s); }
  ctl(o) { this.ws.send('!' + JSON.stringify(o)); }
  next(ms = 3000) { if (this.q.length) return Promise.resolve(this.q.shift()); return new Promise((r) => { const t = setTimeout(() => r(undefined), ms); this.waiting.push((v) => { clearTimeout(t); r(v); }); }); }
  async nextCtl(ms) { const s = await this.next(ms); return s && s[0] === '!' ? JSON.parse(s.slice(1)) : s; }
  whenClosed(ms = 3000) { return new Promise((r) => { if (this.closed !== null) return r(this.closed); const t = setTimeout(() => r(null), ms); this.ws.once('close', (c) => { clearTimeout(t); r(c); }); }); }
  close() { this.ws.close(); }
}
const PROTO = 1401;
async function hostRoom(o = {}) {
  const h = new Sock(); await h.ready;
  h.ctl(Object.assign({ t: 'host', proto: PROTO, name: 'Test room', host: 'Ana', pub: true, pass: '', map: 2, diff: 1 }, o));
  const m = await h.nextCtl();
  return { h, code: m && m.code, m };
}
async function joinRoom(code, pass = '', proto = PROTO, ip) {
  const c = new Sock(ip); await c.ready;
  c.ctl({ t: 'join', code, pass, proto });
  return { c, m: await c.nextCtl() };
}
const listed = async () => (await api('/api/rooms?proto=' + PROTO)).json.rooms;

{
  const { h, code, m } = await hostRoom({ pass: 'sesame' });
  check('hosting gives a 5 letter code', /^[A-Z2-9]{5}$/.test(code || ''), m);
  let list = await listed(), row = list.find((r) => r.code === code);
  check('a public room shows in the browser', !!row);
  check('it shows as locked', row && row.locked === true);
  check('the list has the room details', row && row.name === 'Test room' && row.host === 'Ana' && row.n === 1 && row.max === 4 && row.map === 2 && row.diff === 1, row);
  check('the list never carries the password or its hash', !/sesame|hash|salt/.test(JSON.stringify(list)));
  check('another version does not see it', !(await api('/api/rooms?proto=999')).json.rooms.length);
  check('the version must be given', (await api('/api/rooms')).status === 400 || (await api('/api/rooms?proto=abc')).status === 400);

  let j = await joinRoom(code, 'wrong');
  check('a wrong password is refused', j.m.t === 'err' && j.m.why === 'Wrong password.', j.m);
  j = await joinRoom(code, '');
  check('no password is refused', j.m.t === 'err', j.m);
  j = await joinRoom(code, 'sesame', 999);
  check('another version is refused', j.m.t === 'err' && /version/.test(j.m.why), j.m);
  j = await joinRoom('ZZZZZ', 'sesame');
  check('an unknown code is refused', j.m.t === 'err' && /No game/.test(j.m.why), j.m);

  const a = await joinRoom(code, 'sesame');
  check('the right password gets in', a.m.t === 'joined' && a.m.name === 'Test room', a.m);
  const up = await h.nextCtl();
  check('the host hears about it', up.t === 'peer+' && up.id === 1, up);
  a.c.send('{"k":"hello"}');
  check('messages reach the host, marked with who sent them', (await h.next()) === '1|{"k":"hello"}');
  h.send('1|{"k":"welcome"}');
  check('the host reaches the player', (await a.c.next()) === '{"k":"welcome"}');
  a.c.send('2|{"k":"fake"}');
  check('a player can not pretend to be another player', (await h.next()) === '1|2|{"k":"fake"}');
  h.send('77|{"k":"nobody"}');
  h.send('not a message');
  h.send('|x');
  h.send('1|ok');
  check('nonsense from the host goes nowhere', (await a.c.next()) === 'ok');

  const b = await joinRoom(code, 'sesame'); await h.next();
  const c = await joinRoom(code, 'sesame'); await h.next();
  check('a full room shows 4 of 4', (await listed()).find((r) => r.code === code).n === 4);
  const d = await joinRoom(code, 'sesame');
  check('a fifth climber is refused', d.m.t === 'err' && /full/.test(d.m.why), d.m);
  b.c.close();
  const down = await h.nextCtl();
  check('the host hears when someone leaves', down.t === 'peer-' && down.id === 2, down);
  h.ctl({ t: 'kick', id: 3 });
  const kicked = await c.c.nextCtl();
  check('the host can remove someone', kicked.t === 'closed' && /removed/.test(kicked.why), kicked);
  await h.nextCtl();
  h.ctl({ t: 'info', map: 4, diff: 3, started: true });
  await wait(60);
  const r2 = (await listed()).find((r) => r.code === code);
  check('the host keeps the list up to date', r2.map === 4 && r2.diff === 3 && r2.started === true, r2);
  h.ctl({ t: 'info', map: -5, diff: 'x', started: 'yes' });
  await wait(60);
  const r3 = (await listed()).find((r) => r.code === code);
  check('bad info is cleaned up', r3.map === 0 && r3.diff === 0, r3);
  h.close();
  const bye = await a.c.nextCtl();
  check('players are told when the host leaves', bye.t === 'closed' && /host left/.test(bye.why), bye);
  check('and are disconnected', (await a.c.whenClosed()) !== null);
  check('the room is gone from the list', !(await listed()).some((r) => r.code === code));
  check('and can not be joined', (await joinRoom(code, 'sesame')).m.t === 'err');
}
{
  const { h, code } = await hostRoom({ pub: false, name: '<img src=x onerror=alert(1)>‮\n\t  bad', host: 'x'.repeat(50) });
  check('a private room is not in the browser', !(await listed()).some((r) => r.code === code));
  const j = await joinRoom(code);
  check('but joins by its code', j.m.t === 'joined', j.m);
  check('control characters are cleaned out of names', !/[‮\n\t]/.test(j.m.name), j.m);
  h.close();
}
{
  const { h, code } = await hostRoom({ pub: true, pass: '' });
  const j = await joinRoom(code);
  check('no password needed when there is none', j.m.t === 'joined' && !(await listed()).find((r) => r.code === code).locked, j.m);
  // The last messages can still be on their way when the host is gone: the server must survive that.
  h.close();
  j.c.send('{"k":"late"}'); j.c.send('{"k":"late2"}');
  await wait(100);
  check('late messages after the host left do no harm', (await api('/api/health')).status === 200);
}

// ---------------------------------------------------------------- abuse
{
  const ip = newIp(), { h, code } = await hostRoom({ pass: 'real' });
  let last;
  for (let i = 0; i < 8; i++) last = (await joinRoom(code, 'guess' + i, PROTO, ip)).m;
  check('guessing a password is stopped', /Too many password tries/.test(last.why), last);
  const right = await joinRoom(code, 'real', PROTO, ip);
  check('even the right one, for a while', right.m.t === 'err', right.m);
  const other = await joinRoom(code, 'real');
  check('others can still get in', other.m.t === 'joined', other.m);
  h.close();
}
{
  const ip = newIp(), got = [];
  for (let i = 0; i < 40; i++) { const c = new Sock(ip); await c.ready; c.ctl({ t: 'join', code: 'NOPE1', proto: PROTO }); got.push((await c.nextCtl()).why); }
  check('trying codes one after another is stopped', got.some((w) => /Too many tries/.test(w)), got.slice(-2));
}
{
  const ip = newIp(), socks = [];
  for (let i = 0; i < 4; i++) socks.push((await hostRoom({})).h);
  const hosts = [];
  for (let i = 0; i < 6; i++) { const h = new Sock(ip); await h.ready; h.ctl({ t: 'host', proto: PROTO, pub: false }); hosts.push({ h, m: await h.nextCtl() }); }
  check('one address can not open endless rooms', hosts.filter((x) => x.m.t === 'hosted').length === 4 && /most rooms/.test(hosts[5].m.why), hosts.map((x) => x.m.t));
  for (const x of [...hosts.map((y) => y.h), ...socks]) x.close();
}
{
  const ip = newIp(), socks = [];
  let refused = 0;
  for (let i = 0; i < 30; i++) { const s = new Sock(ip); try { await s.ready; socks.push(s); } catch (e) { refused++; } }
  check('one address can not open endless connections', refused === 6, refused);
  for (const s of socks) s.close();
}
{
  const s = new Sock(); await s.ready; s.ws.send(Buffer.from([1, 2, 3]));
  check('binary is refused', (await s.whenClosed()) === 1003);
  const t = new Sock(); await t.ready; t.send('!not json'); t.send('!null'); t.send('![1,2]'); t.send('!{"t":"what"}'); t.send('no role yet');
  t.ctl({ t: 'host', proto: 'x' });
  check('garbage is ignored and bad hosting refused', (await t.nextCtl()).t === 'err');
  const u = new Sock(); await u.ready; u.send('!' + 'x'.repeat(5000));
  check('an oversized control message is refused', (await u.whenClosed()) === 1009);
  const v = new Sock(); await v.ready; v.send('x'.repeat(600 * 1024));
  check('an oversized message is refused', (await v.whenClosed()) === 1009);
  const { h } = await hostRoom({});
  for (let i = 0; i < 3000 && h.ws.readyState === 1; i++) h.send('1|flood');
  check('flooding gets you disconnected', (await h.whenClosed()) === 4008);
  // Raw rubbish straight on the socket, in the handshake and as a broken frame.
  await new Promise((r) => { const c = net.connect(PORT, '127.0.0.1', () => { c.write('GARBAGE\r\n\r\n\x00\x01\x02'); setTimeout(() => { c.destroy(); r(); }, 100); }); c.on('error', r); });
  await new Promise((r) => { const c = net.connect(PORT, '127.0.0.1', () => { c.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`); setTimeout(() => { c.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])); setTimeout(() => { c.destroy(); r(); }, 100); }, 50); }); c.on('error', r); });
  await new Promise((r) => { const c = net.connect(PORT, '127.0.0.1', () => { c.write(`GET /other HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`); c.on('close', r); setTimeout(() => { c.destroy(); r(); }, 300); }); c.on('error', r); });
  check('the server survives all of that', (await api('/api/health')).status === 200);
  check('and never crashed', srv.p.exitCode === null, srv.out());
}

// ---------------------------------------------------------------- signing in
const TOS = info.termsVersion;
async function startLogin(provider, o = {}) {
  const k = pkce(), r = await api(`/auth/${provider}/start?challenge=${o.challenge || k.challenge}&tos=${o.tos || TOS}`, { ip: o.ip });
  const loc = r.headers.get('location');
  return { k, r, loc, state: loc ? (new URL(loc).searchParams.get('state') || new URLSearchParams(new URL(new URL(loc).searchParams.get('openid.return_to')).search).get('state')) : null };
}
const appCode = (text) => { const m = /stickmanup:\/\/auth\?code=([A-Za-z0-9_-]+)/.exec(text); return m && m[1]; };
const callback = (provider, q, ip) => api(`/auth/${provider}/callback?${new URLSearchParams(q)}`, { ip });
const exchange = (code, verifier) => api('/auth/exchange', { body: { code, verifier } });
function steamQuery(state, id, over = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${id}`;
  return Object.assign({ state, 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': DEV.steamLogin, 'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': `${PUBLIC}/auth/steam/callback?state=${state}`, 'openid.response_nonce': 'n', 'openid.assoc_handle': 'h', 'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'x' }, over);
}
async function signIn(provider, o = {}) {
  const s = await startLogin(provider);
  const page = provider === 'steam' ? await callback(provider, steamQuery(s.state, o.id || '76561198000000001')) : await callback(provider, { code: 'goodcode', state: s.state });
  const code = appCode(page.text), ex = code ? await exchange(code, s.k.verifier) : null;
  return { s, page, code, ex, token: ex && ex.json && ex.json.token, user: ex && ex.json && ex.json.user };
}

{
  check('signing in needs a real challenge', (await startLogin('discord', { challenge: 'short' })).r.status === 400);
  check('signing in needs the current terms accepted', (await startLogin('discord', { tos: 'old' })).r.status === 400);
  const ds = await startLogin('discord');
  check('Discord starts at Discord', ds.r.status === 302 && ds.loc.startsWith(DEV.discordAuth) && /scope=identify/.test(ds.loc) && !/email/.test(ds.loc), ds.loc);
  check('no secret in the address', !/secret/.test(ds.loc));
  const gs = await startLogin('google');
  check('Google starts at Google, asking no email', gs.loc.startsWith(DEV.googleAuth) && new URL(gs.loc).searchParams.get('scope') === 'openid profile', gs.loc);
  check('an unknown provider is a 404', (await api(`/auth/twitter/start?challenge=${pkce().challenge}&tos=${TOS}`)).status === 404);

  const made = await signIn('discord');
  check('Discord sign in works', made.token && made.user.name === 'Ana' && made.user.provider === 'discord' && made.user.tosOk === true, made.ex && made.ex.json);
  check('the browser page sends you back to the app', /Back to StickManUp/.test(made.page.text) && /http-equiv="refresh"/.test(made.page.text));
  check('the page names who made the game', /TheOCProductions and ShortGG/.test(made.page.text));
  check('the page has no scripts and a strict policy', !/<script/i.test(made.page.text) && /default-src 'none'/.test(made.page.headers.get('content-security-policy')));
  check('the secret went to Discord, by form, not in the address', mock.lastForm.get('client_secret') === 'discord-secret');
  const again = await signIn('discord');
  check('the same person gets the same account', again.user.id === made.user.id);
  check('and that does not end the session on the other phone', (await api('/api/me', { token: made.token })).status === 200);
  mock.discordId = 'd2';
  const other = await signIn('discord');
  check('someone else gets their own account', other.user.id !== made.user.id);
  mock.discordId = 'd1';

  const gg = await signIn('google');
  check('Google sign in works', gg.token && gg.user.provider === 'google', gg.ex && gg.ex.json);
  const st = await signIn('steam');
  check('Steam sign in works, with the name from Steam', st.token && st.user.provider === 'steam' && st.user.name === 'Ana', st.ex && st.ex.json);
  check('Steam was asked to confirm the answer', mock.lastForm.get('openid.mode') === 'check_authentication' && mock.lastForm.get('openid.claimed_id').endsWith('76561198000000001'));

  // Trying to get into someone else's account.
  let s = await startLogin('discord');
  const p1 = await callback('discord', { code: 'goodcode', state: s.state });
  const p2 = await callback('discord', { code: 'goodcode', state: s.state });
  check('a sign in state works once', appCode(p1.text) && !appCode(p2.text));
  check('someone else who gets the link, without the secret, gets nothing', (await exchange(appCode(p1.text), pkce().verifier)).status === 400);
  check('and that used the code up, so the secret is no use after', (await exchange(appCode(p1.text), s.k.verifier)).status === 400);
  s = await startLogin('discord');
  const p3 = await callback('discord', { code: 'goodcode', state: s.state });
  check('a code works once', (await exchange(appCode(p3.text), s.k.verifier)).status === 200 && (await exchange(appCode(p3.text), s.k.verifier)).status === 400);
  check('a made up state is refused', !appCode((await callback('discord', { code: 'goodcode', state: 'made-up' })).text));
  s = await startLogin('discord');
  check('a state from another provider is refused', !appCode((await callback('google', { code: 'goodcode', state: s.state })).text));
  s = await startLogin('discord');
  check('a bad code at Discord is refused', !appCode((await callback('discord', { code: 'bad', state: s.state })).text));
  s = await startLogin('discord');
  check('cancelling at Discord signs nobody in', /cancelled/.test((await callback('discord', { error: 'access_denied', state: s.state })).text));
  check('bad exchange bodies are refused', (await exchange(123, null)).status === 400 && (await api('/auth/exchange', { body: 'not json' })).status === 400);

  const forged = async (over, id = '76561198000000002') => { const q = await startLogin('steam'); return appCode((await callback('steam', steamQuery(q.state, id, over(q)))).text); };
  mock.steamValid = false;
  check('Steam not confirming refuses it', !(await forged(() => ({}))));
  mock.steamValid = true;
  check('Steam: another return address is refused', !(await forged(() => ({ 'openid.return_to': 'https://evil.example/' }))));
  check('Steam: another endpoint is refused', !(await forged(() => ({ 'openid.op_endpoint': 'https://evil.example/login' }))));
  check('Steam: a fake id is refused', !(await forged(() => ({ 'openid.claimed_id': 'https://evil.example/openid/id/76561198000000002' }))));
  check('Steam: an id that differs from the identity is refused', !(await forged(() => ({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000003' }))));
  check('Steam: an unsigned id is refused', !(await forged(() => ({ 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce' }))));
  check('Steam: a cancel signs nobody in', !(await forged(() => ({ 'openid.mode': 'cancel' }))));

  mock.name = '<script>alert(1)</script>';
  mock.discordId = 'xss';
  const xs = await signIn('discord');
  check('a nasty name is escaped on the page', !/<script>alert/.test(xs.page.text) && /&lt;script&gt;/.test(xs.page.text));
  mock.name = 'Ana'; mock.discordId = 'd1';

  const burst = newIp();
  let limited = false;
  for (let i = 0; i < 30 && !limited; i++) limited = (await api(`/auth/discord/start?challenge=${pkce().challenge}&tos=${TOS}`, { ip: burst })).status === 429;
  check('starting sign ins endlessly is stopped', limited);

  // ------------------------------------------------------------ saves
  const t = made.token, t2 = other.token;
  check('no token, no account', (await api('/api/me')).status === 401 && (await api('/api/save')).status === 401);
  check('a made up token is refused', (await api('/api/me', { token: b64(crypto.randomBytes(32)) })).status === 401);
  const e = (await api('/api/save', { token: t })).json;
  check('a new account has no save', e.rev === 0 && e.data === null, e);
  const first = await api('/api/save', { token: t, method: 'PUT', body: { rev: 0, data: { best: { a: 50 }, profile: { totals: { falls: 50 } } } } });
  check('saving works', first.status === 200 && first.json.rev === 1, first.json);
  const read = (await api('/api/save', { token: t })).json;
  check('the save comes back', read.rev === 1 && read.data.best.a === 50 && read.data.profile.totals.falls === 50, read);
  const stale = await api('/api/save', { token: t, method: 'PUT', body: { rev: 0, data: { best: { a: 1 } } } });
  check('saving over a newer save is refused and hands it back', stale.status === 409 && stale.json.rev === 1 && stale.json.data.best.a === 50, stale.json);
  check('nobody else sees my save', (await api('/api/save', { token: t2 })).json.data === null);
  check('a save must be an object', (await api('/api/save', { token: t, method: 'PUT', body: { rev: 1, data: [1] } })).status === 400 && (await api('/api/save', { token: t, method: 'PUT', body: { rev: 1, data: 'x' } })).status === 400);
  check('the rev must be a number', (await api('/api/save', { token: t, method: 'PUT', body: { rev: '1', data: {} } })).status === 400);
  check('a save has a size limit', (await api('/api/save', { token: t, method: 'PUT', body: { rev: 1, data: { x: 'y'.repeat(600 * 1024) } } })).status === 413);
  check('a huge body is refused', (await api('/api/save', { token: t, method: 'PUT', body: { rev: 1, data: { x: 'y'.repeat(900 * 1024) } } })).status === 413);
  check('terms: accepting the wrong version is refused', (await api('/api/tos', { token: t, body: { version: 'old' } })).status === 409);
  check('terms: accepting the current one works', (await api('/api/tos', { token: t, body: { version: TOS } })).json.user.tosOk === true);

  // Only hashes of session tokens are on disk.
  const disk = fs.readFileSync(path.join(DATA, 'stickmanup.db')).toString('latin1') + (fs.existsSync(path.join(DATA, 'stickmanup.db-wal')) ? fs.readFileSync(path.join(DATA, 'stickmanup.db-wal')).toString('latin1') : '');
  check('session tokens are not in the database file', !disk.includes(t) && !disk.includes(t2));
  check('no provider secrets in the database file', !disk.includes('discord-secret'));
  check('the data folder is private', (fs.statSync(DATA).mode & 0o077) === 0, (fs.statSync(DATA).mode & 0o777).toString(8));
  const bk = path.join(DATA, 'backups');
  check('a backup was made and is private', fs.existsSync(bk) && fs.readdirSync(bk).length === 1 && (fs.statSync(path.join(bk, fs.readdirSync(bk)[0])).mode & 0o077) === 0);

  // ------------------------------------------------------------ staying and leaving
  srv.p.kill('SIGTERM');
  await new Promise((r) => srv.p.on('exit', r));
  srv = await startServer(baseEnv);
  check('accounts and saves survive a restart', (await api('/api/save', { token: t })).json.data.best.a === 50);
  check('signing out ends that session', (await api('/api/logout', { token: st.token, method: 'POST', body: {} })).status === 200 && (await api('/api/me', { token: st.token })).status === 401);
  const del = await api('/api/me', { token: t, method: 'DELETE' });
  check('deleting an account works', del.status === 200 && del.json.ok === true);
  check('the sessions go with it', (await api('/api/me', { token: t })).status === 401 && (await api('/api/me', { token: again.token })).status === 401);
  const back = await signIn('discord');
  check('coming back later makes a new empty account', back.user.id !== made.user.id && (await api('/api/save', { token: back.token })).json.data === null);
  srv.p.kill('SIGTERM');
  await new Promise((r) => srv.p.on('exit', r));

  // Changed terms: everyone is asked again.
  const tf = path.join(TMP, 'terms.txt');
  fs.writeFileSync(tf, 'New terms.');
  srv = await startServer(Object.assign({}, baseEnv, { TERMS_FILE: tf }));
  const ni = (await api('/api/info')).json;
  check('changed terms get a new version', ni.termsVersion !== TOS && ni.terms === 'New terms.');
  check('and the account has to accept them again', (await api('/api/me', { token: back.token })).json.user.tosOk === false);
  check('signing in with the old terms is refused', (await startLogin('discord')).r.status === 400);
  check('accepting them clears that', (await api('/api/tos', { token: back.token, body: { version: ni.termsVersion } })).json.user.tosOk === true);
  srv.p.kill('SIGTERM');
  await new Promise((r) => srv.p.on('exit', r));
}

// ---------------------------------------------------------------- no sign ins set up, and real encryption
{
  const crt = path.join(TMP, 'c.pem'), key = path.join(TMP, 'k.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const s = await startServer({ PORT: String(portFree), HOST: '0.0.0.0', DATA_DIR: path.join(TMP, 'tlsdata'), TLS_CERT: crt, TLS_KEY: key });
  const get = (p) => new Promise((res, rej) => https.get({ host: '127.0.0.1', port: s.port, path: p, rejectUnauthorized: false, agent: false }, (r) => { const cert = r.socket.getPeerCertificate().fingerprint256; let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res({ status: r.statusCode, text: d, cert })); }).on('error', rej));
  const h = await get('/api/health');
  check('runs on its own over HTTPS', h.status === 200 && JSON.parse(h.text).ok === true, h);
  check('no sign in set up means none offered', JSON.parse((await get('/api/info')).text).providers.length === 0);
  check('a sign in that is not set up is refused', (await get(`/auth/discord/start?challenge=${pkce().challenge}&tos=x`)).status === 400);
  const w = new WebSocket(`wss://127.0.0.1:${s.port}/ws`, { rejectUnauthorized: false });
  const opened = await new Promise((r) => { w.on('open', () => r(true)); w.on('error', () => r(false)); });
  check('rooms work over encrypted sockets', opened);
  const plain = await new Promise((r) => { const c = net.connect(s.port, '127.0.0.1', () => { c.write('GET /api/health HTTP/1.1\r\nHost: x\r\n\r\n'); }); let d = ''; c.on('data', (x) => { d += x; }); c.on('close', () => r(d)); c.on('error', () => r(d)); setTimeout(() => c.destroy(), 500); });
  check('it does not answer unencrypted', !plain.includes('"ok"'), plain.slice(0, 60));
  w.close();
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=renewed'], { stdio: 'ignore' });
  s.p.kill('SIGHUP');
  await wait(300);
  const again = await get('/api/health');
  check('a renewed certificate is picked up without a restart', again.status === 200 && again.cert !== h.cert && /certificate reloaded/.test(s.out()), s.out().slice(-120));
  s.p.kill('SIGTERM');
}

// ---- the coins: a server of its own, so its time limits can be short enough to wait for
{
  const CAT = JSON.parse(fs.readFileSync(new URL('../server/lib/catalog.json', import.meta.url)));
  const W = path.join(TMP, 'walletdata');
  const wEnv = Object.assign({}, baseEnv, { DATA_DIR: W, WALLET_MIN_WIN_SECONDS: '1', WALLET_DAILY_CAP: '6000', WALLET_IMPORT_CAP: '500' });
  srv.p.kill('SIGTERM');
  await wait(300);
  srv = await startServer(wEnv);
  let n = 500;
  const person = async () => signIn('steam', { id: '7656119900000' + String(n++).padStart(4, '0') });
  const a = (await person()).token, b = (await person()).token;
  const me = async (t = a) => (await api('/api/wallet', { token: t })).json;
  const post = (p, body, token = a) => api(p, { token, body });

  check('coins need an account', (await api('/api/wallet')).status === 401 && (await api('/api/buy', { body: { id: 'x' } })).status === 401);
  let w = await me();
  check('a new account has nothing', w.coins === 0 && w.earned === 0 && w.own.length === 0 && w.imported === false, w);

  // No way of just saying you are rich
  const save = await api('/api/save', { token: a, method: 'PUT', body: { rev: 0, data: { v: 1, coins: 999999, profile: { coins: 999999, earned: 999999, own: Object.keys(CAT.items), relics: ['storm:0'], ach: ['win0'], runs: {}, totals: {} } } } });
  check('a save can still be written', save.status === 200, save.text);
  w = await me();
  check('a save claiming coins and things changes nothing', w.coins === 0 && w.own.length === 0 && w.relics.length === 0 && w.ach.length === 0, w);
  const back = (await api('/api/save', { token: a })).json;
  check('and the claim is not even kept', back.data.profile.coins === undefined && back.data.profile.own === undefined, back);
  for (const body of [{ coins: 999999 }, { balance: 999999 }]) check('nothing else takes a balance', (await post('/api/wallet', body)).status === 404);

  const cheap = Object.entries(CAT.items).sort((x, y) => x[1] - y[1]), pricey = cheap[cheap.length - 1];
  const [c1, p1] = cheap[0], [c2, p2] = cheap[1];
  check('nothing can be bought without coins', (await post('/api/buy', { id: c1 })).status === 402 && (await me()).own.length === 0);

  // The old way of bringing a guest's coins along is gone: anyone could have made those up.
  let r = await post('/api/wallet/import', { coins: 999999, own: [c1, 'made_up', 7, null, '__proto__', pricey[0]] });
  w = r.json.wallet;
  check('claiming to have been a rich guest brings nothing', w.coins === 0 && w.own.length === 0, w);
  r = await post('/api/wallet/import', { coins: -5, own: 'nope' }, b);
  check('a nonsense import gives nothing', r.json.wallet.coins === 0, r.text);
  check('a negative import is not a debt', (await me(b)).coins === 0);
  // Coins for the shop, as if earned.
  {
    const { DatabaseSync } = await import('node:sqlite');
    const id = (await api('/api/me', { token: a })).json.user.id, d0 = new DatabaseSync(path.join(W, 'stickmanup.db'));
    d0.prepare('UPDATE wallets SET coins = 500, earned = 500 WHERE user_id = ?').run(id);
    d0.close();
  }

  // Buying
  for (const id of ['made_up', '', 5, null, '__proto__', 'constructor']) check(`can't buy ${id}`, (await post('/api/buy', { id })).status === 400);
  const before = await me();
  r = await post('/api/buy', { id: c2 });
  check('buying takes the real price', r.status === 200 && r.json.wallet.coins === before.coins - p2 && r.json.wallet.own.includes(c2), r.text);
  const after = r.json.wallet.coins;
  r = await post('/api/buy', { id: c2 });
  check('buying twice pays once', r.status === 200 && r.json.wallet.coins === after, r.text);
  r = await post('/api/buy', { id: pricey[0] });
  check('too expensive is refused', r.status === 402 && r.json.wallet.coins === after, r.text);
  const third = cheap.find(([k, v]) => v <= after && k !== c1 && k !== c2);
  const both = await Promise.all([1, 2, 3, 4, 5].map(() => post('/api/buy', { id: third[0] })));
  check('five buys at once pay once', both.every((x) => x.status === 200) && (await me()).coins === after - third[1], (await me()).coins);

  // A climb
  for (const body of [{ map: 99, diff: 0 }, { map: 0, diff: 99 }, { map: '0', diff: 0 }, { map: -1, diff: 0 }, {}]) check(`a bad climb is refused ${JSON.stringify(body)}`, (await post('/api/run/start', body)).status === 400);
  const base = (await me(b)).coins, V = CAT.diffs[3].coin;
  const run = (await post('/api/run/start', { map: 0, diff: 3 }, b)).json.run;
  check('a climb starts', typeof run === 'string');
  r = await post('/api/run/report', { run, coins: [0, 1, 2, 2, 2, -1, 99999, 'x', null, 1.5] }, b);
  check('each real coin pays once, at the value of the difficulty', r.json.accepted.length === 3 && r.json.paid === 3 * V && r.json.wallet.coins === base + 3 * V, r.text);
  r = await post('/api/run/report', { run, coins: [0, 1, 2] }, b);
  check('the same coins never pay again', r.json.paid === 0 && r.json.accepted.length === 0, r.text);
  r = await post('/api/run/report', { run, coins: Array.from({ length: CAT.maps[0].coins }, (_, i) => i) }, b);
  check('all the coins at once is too fast: most have to wait', r.json.accepted.length <= 40 && r.json.later.length > 100, r.json.accepted.length + ' ' + r.json.later.length);
  check('someone else cannot use your climb', (await post('/api/run/report', { run, coins: [200] }, a)).status === 404);
  check('a made up climb gives nothing', (await post('/api/run/report', { run: 'madeup', coins: [1] }, b)).status === 404 && (await post('/api/run/report', { coins: [1] }, b)).status === 404);

  // Winning
  const c0 = (await me(b)).coins;
  const quick = (await post('/api/run/start', { map: 1, diff: 0 }, b)).json.run;
  r = await post('/api/run/report', { run: quick, win: { falls: 0 } }, b);
  check('a win right after starting pays nothing', r.json.win === 'too fast' && r.json.paid === 0 && !r.json.wallet.ach.includes('win0'), r.text);
  await wait(1100);
  r = await post('/api/run/report', { run: quick, win: { falls: 0 } }, b);
  check('after a climb of real length it pays the top and the first win', r.json.win === 'ok' && r.json.first === CAT.diffs[0].first && r.json.paid === CAT.diffs[0].summit + CAT.diffs[0].first && r.json.wallet.ach.includes('win0'), r.text);
  const c1b = (await me(b)).coins;
  r = await post('/api/run/report', { run: quick, win: { falls: 0 } }, b);
  check('one climb wins once', r.json.paid === 0 && (await me(b)).coins === c1b, r.text);
  await wait(1100);
  const again = (await post('/api/run/start', { map: 1, diff: 0 }, b)).json.run;
  await wait(1100);
  r = await post('/api/run/report', { run: again, win: { falls: 0 } }, b);
  check('a second win pays the top but not the first win bonus again', r.json.win === 'ok' && r.json.first === 0 && r.json.paid === CAT.diffs[0].summit, r.text);
  const custom = (await post('/api/run/start', { map: 1, diff: 1, custom: true }, b)).json.run;
  await wait(1100);
  r = await post('/api/run/report', { run: custom, win: { falls: 0 } }, b);
  check('custom rules get no first win bonus', r.json.first === 0 && !r.json.wallet.ach.includes('win1'), r.text);

  // A saved climb picked up again
  await wait(1100);
  const saved = (await post('/api/run/start', { map: 2, diff: 0 }, b)).json.run;
  await post('/api/run/report', { run: saved, coins: [5, 6] }, b);
  await wait(1100);
  r = await post('/api/run/report', { run: saved, coins: [5, 6, 7], win: { falls: 2 } }, b);
  check('a climb picked up again keeps its clock and its coins', r.json.win === 'ok' && r.json.accepted.length === 1 && r.json.accepted[0] === 7, r.text);

  // Relics and legendaries
  const easy = (await post('/api/run/start', { map: 0, diff: 1 }, b)).json.run;
  r = await post('/api/run/report', { run: easy, relics: ['storm:0'] }, b);
  check('no relics below Hardcore', !r.json.wallet.relics.includes('storm:0'), r.text);
  const hard = (await post('/api/run/start', { map: 0, diff: 2 }, b)).json.run;
  r = await post('/api/run/report', { run: hard, relics: ['storm:0', 'sunny:0', 'made_up'] }, b);
  check('a relic counts only on its own map', r.json.wallet.relics.includes('storm:0') && !r.json.wallet.relics.includes('sunny:0') && !r.json.wallet.relics.includes('made_up'), r.text);

  // The daily limit, and the speed limit across several climbs at once
  const big = (await person()).token;
  await post('/api/wallet/import', {}, big);
  let got = 0;
  const allRuns = [];
  for (let i = 0; i < 6; i++) allRuns.push((await post('/api/run/start', { map: 1, diff: 3 }, big)).json.run);
  for (const ru of allRuns) got += (await post('/api/run/report', { run: ru, coins: Array.from({ length: 30 }, (_, i) => i) }, big)).json.accepted.length;
  check('six climbs at once are no faster than one', got <= 70, got);
  const capPerson = (await person()).token;
  await post('/api/wallet/import', {}, capPerson);
  const capEnv = Object.assign({}, wEnv, { WALLET_DAILY_CAP: '20', WALLET_COINS_PER_SECOND: '1000', WALLET_COIN_BURST: '1000' });
  srv.p.kill('SIGTERM');
  await wait(300);
  srv = await startServer(capEnv);
  const cr = (await post('/api/run/start', { map: 1, diff: 3 }, capPerson)).json.run;
  r = await post('/api/run/report', { run: cr, coins: Array.from({ length: 100 }, (_, i) => i) }, capPerson);
  check('the daily limit stops the coins and says so', r.json.paid === 20 && r.json.capped === true && r.json.wallet.dayLeft === 0, r.text);
  await wait(1100);
  const hadW = await me(capPerson);
  const fw = (await post('/api/run/start', { map: 1, diff: 2 }, capPerson)).json.run;
  await wait(1100);
  r = await post('/api/run/report', { run: fw, win: { falls: 3 } }, capPerson);
  check('a first win still pays past the daily limit', r.json.first === CAT.diffs[2].first && r.json.wallet.coins === hadW.coins + CAT.diffs[2].first, r.text);

  // Nobody fills the disk with climbs
  const many = (await person()).token;
  const oldest = (await post('/api/run/start', { map: 0, diff: 0 }, many)).json.run;
  let newest = oldest;
  for (let i = 0; i < 45; i++) newest = (await post('/api/run/start', { map: 0, diff: 0 }, many)).json.run;
  check('only so many climbs are kept per person', (await post('/api/run/report', { run: oldest, coins: [] }, many)).status === 404 && (await post('/api/run/report', { run: newest, coins: [] }, many)).status === 200);

  // It survives
  srv.p.kill('SIGTERM');
  await wait(300);
  srv = await startServer(wEnv);
  const kept = await me(b);
  srv.p.kill('SIGTERM');
  await wait(300);
  srv = await startServer(wEnv);
  const kept2 = await me(b);
  check('the wallet survives a restart', JSON.stringify(kept2) === JSON.stringify(kept), kept2);
  const stillRun = await post('/api/run/report', { run, coins: [] }, b);
  check('and so does a climb in progress', stillRun.status === 200, stillRun.text);

  // A guest signing in: the coins move once, and only to an empty account.
  {
    const { DatabaseSync } = await import('node:sqlite');
    const hand = (id, coins) => { const d = new DatabaseSync(path.join(W, 'stickmanup.db')); d.prepare('UPDATE wallets SET coins = ?, earned = ? WHERE user_id = ?').run(coins, coins, id); d.close(); };
    const newGuest = async () => (await api('/api/guest', { body: { tos: TOS, device: crypto.randomBytes(16).toString('hex'), name: 'G' } })).json;
    const asAccount = async (id, guestToken) => {
      const st = await startLogin('steam'), page = await callback('steam', steamQuery(st.state, id));
      return (await api('/auth/exchange', { body: { code: appCode(page.text), verifier: st.k.verifier, guest: guestToken } })).json;
    };
    const coinsOf = async (token) => (await api('/api/wallet', { token })).json.coins;
    const g1 = await newGuest();
    check('a guest starts with nothing', (await coinsOf(g1.token)) === 0, await coinsOf(g1.token));
    hand(g1.user.id, 300);
    const a1 = await asAccount('76561198000000071', g1.token);
    check('signing in to a new account brings a guest\'s coins', a1.moved === true && (await coinsOf(a1.token)) === 300, a1);
    check('and the guest has none left', (await coinsOf(g1.token)) === 0);
    const again = await asAccount('76561198000000072', g1.token);
    check('so they can not be moved twice', !again.moved && (await coinsOf(again.token)) === 0, again);
    const g2 = await newGuest();
    await coinsOf(g2.token);
    hand(g2.user.id, 500);
    const a2 = await asAccount('76561198000000071', g2.token);
    check('an account that already has coins takes none from a guest', !a2.moved && (await coinsOf(a2.token)) === 300, a2);
    { const gw = await api('/api/wallet', { token: g2.token }); check('and the guest keeps theirs, nothing is lost', gw.json.coins === 500, gw.status + ' ' + gw.text); }
    const notGuest = await asAccount('76561198000000073', a2.token);
    check('only a guest can be emptied this way', !notGuest.moved && (await coinsOf(a2.token)) === 300, notGuest);
    const rubbish = await asAccount('76561198000000074', 'not a token');
    check('a made up guest token does nothing', !rubbish.moved && (await coinsOf(rubbish.token)) === 0, rubbish);
  }

  // Deleting
  check('deleting an account deletes the wallet', (await api('/api/me', { token: b, method: 'DELETE' })).status === 200 && (await api('/api/wallet', { token: b })).status === 401);
  const { DatabaseSync } = await import('node:sqlite');
  const dbx = new DatabaseSync(path.join(W, 'stickmanup.db'), { readOnly: true });
  const left = dbx.prepare("SELECT COUNT(*) AS n FROM wallets w WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = w.user_id)").get().n + dbx.prepare("SELECT COUNT(*) AS n FROM runs r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)").get().n + dbx.prepare("SELECT COUNT(*) AS n FROM ledger l WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.user_id)").get().n;
  check('nothing of it is left behind', left === 0, left);
  const led = dbx.prepare('SELECT COUNT(*) AS n FROM ledger').get().n;
  check('money movements are written down', led > 0, led);
  dbx.close();
  srv.p.kill('SIGTERM');
}

mockServer.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
