// The Discord bot against a pretend Discord: a real gateway socket and a real web API on this machine, and the real game
// server with its real database behind it. Every command gets used, people not on the list get refused, players' names can't
// break anything, buttons and forms work, Discord going away is survived. Not covered: the real Discord.
// Usage: node dev/bottest.js. Exit code 1 if anything fails.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require('../server/vendor/ws');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smu-bot-'));
let failed = 0, passed = 0;
const check = (name, ok, info = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info !== '' ? '  [' + (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 900) + ']' : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) return v; await wait(30); } };

const GUILD = '111111111111111111', LOG = '222222222222222222', WARN = '333333333333333333';
const ADMIN = '444444444444444444', ADMIN2 = '444444444444444445', STRANGER = '555555555555555555';
const TOKEN = 'test.bot.token', APP = '999999999999999999';

// ---------------------------------------------------------------- pretend Discord
const d = { notInvited: false, contentSwitchOff: false, socket: null, identifies: 0, resumes: 0, commands: null, puts: 0, posts: [], answers: new Map(), rateLimit: 0, badAuth: 0, patches: [], closeNext: 0 };
const web = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    const url = req.url, j = body ? JSON.parse(body) : null;
    const it = /^\/interactions\/(\d+)\/([^/]+)\/callback$/.exec(url);
    if (it) { d.answers.set(it[1], j); return send(204); }
    if (req.headers.authorization !== 'Bot ' + TOKEN) { d.badAuth++; return send(401, { message: 'unauthorized' }); }
    if (d.rateLimit > 0) { d.rateLimit--; return send(429, { retry_after: 0.05 }); }
    if (url === `/applications/${APP}/guilds/${GUILD}/commands`) {
      if (d.notInvited) return send(403, { message: 'Missing Access', code: 50001 });
      if (req.method === 'GET') return send(200, d.commands || []);
      if (req.method === 'PUT') { d.commands = j; d.puts++; return send(200, j); }
    }
    const m = /^\/channels\/(\d+)\/messages$/.exec(url);
    if (m) { d.posts.push({ channel: m[1], msg: j }); return send(200, { id: '1' }); }
    if (req.method === 'PATCH' && url.startsWith('/webhooks/')) { d.patches.push(j); return send(200, {}); }
    send(404, { message: 'not found' });
  });
});
const gw = new WebSocketServer({ server: web });
gw.on('connection', (ws) => {
  d.socket = ws;
  ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 700 } }));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.op === 1) ws.send(JSON.stringify({ op: 11 }));
    if (m.op === 2) {
      d.identifies++;
      d.lastIdentify = m.d;
      if (m.d.token !== TOKEN) return ws.close(4004);
      if (d.contentSwitchOff && (m.d.intents & (1 << 15))) return ws.close(4014);
      ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess', resume_gateway_url: `ws://127.0.0.1:${web.address().port}`, application: { id: APP }, user: { username: 'TestBot' } } }));
    }
    if (m.op === 6) {
      d.resumes++;
      d.lastResume = m.d;
      ws.send(JSON.stringify({ op: 0, t: 'RESUMED', s: (m.d.seq || 1) + 1, d: {} }));
    }
  });
});

let nextId = 1000, seq = 10;
function interact(type, data, who = ADMIN, guild = GUILD) {
  const id = String(++nextId);
  d.socket.send(JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', s: ++seq, d: { id, token: 'tok' + id, type, guild_id: guild, data, member: { user: { id: who, username: who === ADMIN ? 'owner' : 'someone' } } } }));
  return until(() => d.answers.get(id)).then((a) => a);
}
const text = (a) => (a && a.data && a.data.embeds && a.data.embeds[0] ? a.data.embeds[0].description : '');
// Typing in a channel. Answers what the bot wrote back there.
async function bang(content, o = {}) {
  const channel = o.channel || LOG, before = d.posts.length;
  d.socket.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: ++seq, d: { id: String(++nextId), channel_id: channel, guild_id: o.guild === undefined ? GUILD : o.guild, content, webhook_id: o.webhook, author: { id: o.who || ADMIN, username: (o.who || ADMIN) === ADMIN ? 'owner' : 'someone', bot: !!o.bot } } }));
  await wait(o.wait || 200);
  return d.posts.slice(before).filter((p) => p.channel === channel).map((p) => (p.msg.embeds && p.msg.embeds[0] ? p.msg.embeds[0].description : '')).join('\n');
}
function slash(name, options = {}, who) {
  return interact(2, { name, options: Object.entries(options).map(([k, value]) => ({ name: k, value })) }, who);
}

// ---------------------------------------------------------------- the game server
let port, srv;
function api(p, body, token, method) {
  return new Promise((resolve, reject) => {
    const b = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || (b ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' }, token ? { Authorization: 'Bearer ' + token } : {}) }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} resolve(Object.assign(j, { _s: res.statusCode })); });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}
const start = (extra = {}) => new Promise((resolve) => {
  const env = Object.assign({}, process.env, { HOST: '127.0.0.1', PORT: '0', DATA_DIR: TMP, NODE_NO_WARNINGS: '1', TRUST_PROXY: '1', GUEST_LIMIT_BURST: '1000', GUEST_LIMIT_PER_HOUR: '100000', DISCORD_BOT_TOKEN: TOKEN, DISCORD_BOT_GUILD: GUILD, DISCORD_BOT_LOG_CHANNEL: LOG, DISCORD_BOT_WARN_CHANNEL: WARN, DISCORD_BOT_ADMINS: `${ADMIN}, ${ADMIN2}`, DEV_PROVIDER_URLS: JSON.stringify({ botApi: `http://127.0.0.1:${web.address().port}`, botGateway: `ws://127.0.0.1:${web.address().port}` }) }, extra);
  srv = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stderr.on('data', (c) => { srv.log += c; });
  srv.stdout.on('data', (c) => {
    srv.log += c;
    const m = / on 127\.0\.0\.1:(\d+)/.exec(String(c));
    if (m) { port = +m[1]; resolve(); }
  });
});
const stopServer = () => new Promise((r) => { srv.on('exit', r); srv.kill(); });
async function guest(name) {
  const info = await api('/api/info');
  const g = await api('/api/guest', { tos: info.termsVersion, device: crypto.randomBytes(16).toString('hex'), name });
  return { token: g.token, user: g.user };
}
const lastPost = (ch) => [...d.posts].reverse().find((p) => p.channel === ch);

async function main() {
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  await start();

  // ---------------- connecting
  await until(() => d.commands);
  check('the bot connects with its token, asking for no special access', d.identifies === 1 && d.lastIdentify.intents === 0);
  check('it sets up its commands on the one server', Array.isArray(d.commands) && d.puts === 1);
  const names = (d.commands || []).map((c) => c.name);
  check(`it has at least 40 commands (it has ${names.length})`, names.length >= 40);
  for (const need of ['ban', 'unban', 'givecoins', 'takecoins', 'players', 'lastplayed', 'recent', 'tempban', 'bans', 'flags', 'anticheat']) check(`it has /${need}`, names.includes(need));

  // What Discord itself would refuse.
  let shape = [];
  for (const c of d.commands) {
    if (!/^[a-z0-9_-]{1,32}$/.test(c.name)) shape.push(`${c.name}: name`);
    if (!c.description || c.description.length > 100) shape.push(`${c.name}: description`);
    if (c.options.length > 25) shape.push(`${c.name}: too many options`);
    let optional = false;
    for (const o of c.options) {
      if (!/^[a-z0-9_-]{1,32}$/.test(o.name)) shape.push(`${c.name}.${o.name}: name`);
      if (!o.description || o.description.length > 100) shape.push(`${c.name}.${o.name}: description`);
      if (o.required && optional) shape.push(`${c.name}.${o.name}: required after optional`);
      if (!o.required) optional = true;
      if (o.autocomplete && o.choices) shape.push(`${c.name}.${o.name}: autocomplete and choices`);
    }
    if (new Set(c.options.map((o) => o.name)).size !== c.options.length) shape.push(`${c.name}: twice the same option`);
  }
  check('Discord would accept every command as written', shape.length === 0 && names.length <= 100 && new Set(names).size === names.length, shape);

  // ---------------- logging
  const ana = await guest('Ana');
  const n0 = d.posts.length;
  const banner = await until(() => d.posts.find((p) => p.channel === LOG && /New guest/.test(p.msg.embeds[0].title)));
  check('a new player shows up in the log channel', !!banner && /Guest/.test(banner.msg.embeds[0].description) && /203\.0\.113\.9/.test(banner.msg.embeds[0].description), banner);
  check('messages can never ping anyone', d.posts.every((p) => p.msg.allowed_mentions && p.msg.allowed_mentions.parse.length === 0));
  const bob = await guest('Bob');
  const evil = await guest('@everyone **x** `<@1>`');
  void n0;

  // ---------------- only those on the list
  let a = await slash('stats', {}, STRANGER);
  check('someone not on the list is refused', /not allowed/.test(text(a)) && a.data.flags === 64, a);
  a = await slash('givecoins', { player: bob.user.id, amount: 100 }, STRANGER);
  check('and nothing happens', /not allowed/.test(text(a)) && (await api('/api/wallet', undefined, bob.token)).coins === 0, a);
  await until(() => d.posts.find((p) => /Refused/.test(p.msg.embeds[0].title)));
  check('the refusal is logged', !!d.posts.find((p) => /Refused/.test(p.msg.embeds[0].title) && p.msg.embeds[0].description.includes(STRANGER)));
  a = await interact(2, { name: 'stats', options: [] }, ADMIN, '777777777777777777');
  check('on another Discord server even an admin is refused', /not allowed/.test(text(a)), a);
  a = await interact(4, { name: 'player', options: [{ name: 'player', value: 'Gu', focused: true }] }, STRANGER);
  check('and strangers get no names from the suggestions', a.type === 8 && a.data.choices.length === 0, a);

  // ---------------- every command, with a sensible argument
  const R = await slash('stats');
  check('/stats answers privately', a && R.type === 4 && R.data.flags === 64 && /Players/.test(text(R)), R);
  a = await interact(4, { name: 'player', options: [{ name: 'player', value: 'Guest', focused: true }] });
  check('names are suggested while typing', a.type === 8 && a.data.choices.length >= 3 && /#\d+/.test(a.data.choices[0].name), a);
  a = await interact(4, { name: 'giveitem', options: [{ name: 'player', value: 'x' }, { name: 'item', value: 'a', focused: true }] });
  check('items are suggested too', a.type === 8 && a.data.choices.length > 0, a);

  const bobId = bob.user.id, bobNum = `#${bob.user.num}`;
  const items = await slash('catalog');
  const item = (/`([^`]+)`/.exec(text(items).replace(/\\/g, '')) || [])[1];
  check('/catalog lists what is on sale', !!item, text(items));
  const runs = [
    ['help', {}], ['help', { command: 'ban' }], ['player', { player: bobId }], ['player', { player: bobNum }], ['player', { player: String(bob.user.num) }], ['players', {}], ['players', { page: 2 }],
    ['search', { text: 'Guest' }], ['recent', {}], ['recent', { count: 3 }], ['lastplayed', {}], ['lastplayed', { player: bobId }], ['new', {}], ['online', {}], ['top', {}], ['top', { by: 'earned', count: 3 }], ['top', { by: 'climbs' }], ['top', { by: 'wins' }],
    ['stats', {}], ['alts', { player: bobId }], ['ip', { ip: '203.0.113.9' }], ['ips', { player: bobId }], ['note', { player: bobId, text: 'Watch this one' }], ['notes', { player: bobId }],
    ['coins', { player: bobId }], ['givecoins', { player: bobId, amount: 500, reason: 'a prize' }], ['takecoins', { player: bobId, amount: 100 }], ['setcoins', { player: bobId, amount: 1000, reason: 'fix' }], ['history', { player: bobId }], ['items', { player: bobId }],
    ['resetcheckpoint', { player: bobId, reason: 'stuck' }], ['giveitem', { player: bobId, item }], ['takeitem', { player: bobId, item }], ['catalog', { search: 'a' }], ['dailycap', {}], ['climbs', { player: bobId }], ['climb', { id: 'nothing' }],
    ['bans', {}], ['baninfo', { player: bobId }], ['flags', {}], ['flags', { player: bobId }], ['suspects', {}], ['clearflags', { player: bobId }], ['trust', { player: bobId }], ['untrust', { player: bobId }], ['anticheat', {}], ['phone', { player: bobId }],
    ['rooms', {}], ['status', {}], ['audit', {}], ['admins', {}], ['logguests', { on: true }], ['announce', { text: 'Hello climbers' }], ['announce', { text: 'off' }], ['maintenance', { on: false }], ['rename', { player: bobId, name: 'Bobby' }],
    ['kick', { player: bobId }], ['unban', { player: bobId }], ['unbanip', { ip: '198.51.100.7' }], ['unbanphone', { player: bobId }], ['closeroom', { code: 'ZZZZZ' }], ['banphone', { player: 'nobody here' }], ['signout', { player: bobId }],
  ];
  let wrong = [], used = new Set();
  for (const [name, o] of runs) {
    const r = await slash(name, o);
    used.add(name);
    if (!r || r.type !== 4 || !text(r) || /went wrong|does not know/.test(text(r))) wrong.push(`/${name} ${JSON.stringify(o)}: ${JSON.stringify(r)}`);
    if (text(r) && text(r).length > 4000) wrong.push(`/${name}: too long`);
    if (r && r.data.flags !== 64) wrong.push(`/${name}: not private`);
  }
  check(`${runs.length} ordinary uses of commands all answer`, wrong.length === 0, wrong);

  // ---------------- what they really do
  let w = await api('/api/wallet', undefined, bob.token);
  check('/setcoins, /givecoins and /takecoins change the real coins', w.coins === 1000, w);
  a = await slash('givecoins', { player: bobId, amount: 5 });
  w = await api('/api/wallet', undefined, bob.token);
  check('/givecoins adds to them', w.coins === 1005 && /1,005/.test(text(a)), [w, text(a)]);
  a = await slash('takecoins', { player: bobId, amount: 2000 });
  w = await api('/api/wallet', undefined, bob.token);
  check('/takecoins never goes below nothing', w.coins === 0, w);
  a = await slash('history', { player: bobId });
  check('/history shows who did it and why', /a prize/.test(text(a)) && /owner/.test(text(a)), text(a));
  a = await slash('players');
  check('/players lists numbers, names and IDs', text(a).includes(`#${ana.user.num}`) && text(a).includes(ana.user.id) && /Page|page/.test(text(a)), text(a));
  a = await slash('search', { text: 'Bobby' });
  check('/search finds the new name', text(a).includes('Bobby'), text(a));
  a = await slash('player', { player: 'Bobby' });
  check('/player finds them by name', text(a).includes(bobId), text(a));
  a = await slash('player', { player: 'nobody by this name' });
  check('an unknown player is explained', /No player/.test(text(a)), text(a));
  await guest('x');
  a = await slash('rename', { player: ana.user.id, name: 'Twin' });
  a = await slash('rename', { player: evil.user.id, name: 'Twin' });
  a = await slash('player', { player: 'Twin' });
  check('two with the same name: it lists them and asks for a number', /More than one/.test(text(a)) && text(a).includes(`#${ana.user.num}`) && text(a).includes(`#${evil.user.num}`), text(a));
  check('and nothing was done to either', !/Coins/.test(text(a)));
  a = await slash('rename', { player: evil.user.id, name: '@everyone **x**' });
  a = await slash('player', { player: evil.user.id });
  check('a name can not format messages or ping', text(a).includes('\\@everyone') && text(a).includes('\\*\\*x\\*\\*') && a.data.allowed_mentions.parse.length === 0, text(a));

  // ---------------- confirming the big ones
  a = await slash('giveall', { amount: 7, reason: 'party', confirm: false });
  check('/giveall without confirming does nothing', /Nothing/.test(text(a)) && (await api('/api/wallet', undefined, bob.token)).coins === 0, text(a));
  a = await slash('giveall', { amount: 7, reason: 'party', confirm: true });
  check('/giveall with confirming gives to everyone', (await api('/api/wallet', undefined, bob.token)).coins === 7 && (await api('/api/wallet', undefined, ana.token)).coins === 7, text(a));
  a = await slash('resetwallet', { player: bobId, reason: 'test', confirm: false });
  check('/resetwallet without confirming does nothing', (await api('/api/wallet', undefined, bob.token)).coins === 7);
  a = await slash('resetwallet', { player: bobId, reason: 'test', confirm: true });
  check('/resetwallet with confirming clears them', (await api('/api/wallet', undefined, bob.token)).coins === 0, text(a));
  a = await slash('giveitem', { player: bobId, item: 'no such thing' });
  check('/giveitem refuses what is not on sale', /not in the catalog/.test(text(a)), text(a));
  a = await slash('giveitem', { player: bobId, item });
  check('/giveitem gives', (await api('/api/wallet', undefined, bob.token)).own.includes(item), text(a));
  a = await slash('takeitem', { player: bobId, item });
  check('/takeitem takes', !(await api('/api/wallet', undefined, bob.token)).own.includes(item), text(a));

  // ---------------- bans
  a = await slash('ban', { player: bobId, reason: 'Flying around' });
  w = await api('/api/wallet', undefined, bob.token);
  check('/ban shuts a player out and the game hears the reason', w._s === 403 && w.banned && w.reason === 'Flying around' && w.num === bob.user.num, w);
  const banPost = await until(() => d.posts.find((p) => p.channel === WARN && /^Banned$/.test(p.msg.embeds[0].title)));
  check('a ban is announced in the warning channel with its reason and who did it', !!banPost && /Flying around/.test(banPost.msg.embeds[0].description) && /owner/.test(banPost.msg.embeds[0].description), banPost);
  a = await slash('baninfo', { player: bobId });
  check('/baninfo shows it', /banned/.test(text(a)) && /Flying around/.test(text(a)), text(a));
  a = await slash('bans');
  check('/bans lists it with its reason', /Flying around/.test(text(a).replace(/\\/g, '')), text(a));
  const me = await api('/api/me', undefined, bob.token);
  check('a banned player can still see why', me._s === 200 && me.ban && me.ban.reason === 'Flying around', me);
  a = await slash('unban', { player: bobId, reason: 'Was a mistake' });
  w = await api('/api/wallet', undefined, bob.token);
  check('/unban lets them back in', w._s === 200, w);
  const unbanPost = await until(() => d.posts.find((p) => p.channel === WARN && /^Unbanned$/.test(p.msg.embeds[0].title)));
  check('and is announced with its reason', !!unbanPost && /Was a mistake/.test(unbanPost.msg.embeds[0].description.replace(/\\/g, '')), unbanPost);
  a = await slash('baninfo', { player: bobId });
  check('the history of a lifted ban stays', /Flying around/.test(text(a)) && /Was a mistake|lifted/.test(text(a).replace(/\\/g, '')), text(a));
  a = await slash('unban', { player: bobId });
  check('unbanning someone not banned says so', /not banned/.test(text(a)), text(a));
  a = await slash('tempban', { player: bobId, days: 3, reason: 'Cool off' });
  w = await api('/api/wallet', undefined, bob.token);
  check('/tempban has an end date', w._s === 403 && w.until > Date.now() + 2.9 * 86400000 && w.until < Date.now() + 3.1 * 86400000, w);
  await slash('unban', { player: bobId });
  // By address.
  a = await slash('banip', { ip: '198.51.100.7', reason: 'A botnet' });
  const blocked = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/guest', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(Object.assign(JSON.parse(t), { _s: res.statusCode }))); });
    r.write(JSON.stringify({ tos: 'x' }));
    r.end();
  });
  check('/banip is at least not fooled by wrong terms', blocked._s === 409 || blocked._s === 403, blocked);
  const info = await api('/api/info');
  const blocked2 = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/guest', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(Object.assign(JSON.parse(t), { _s: res.statusCode }))); });
    r.write(JSON.stringify({ tos: info.termsVersion }));
    r.end();
  });
  check('/banip stops new guests from that address', blocked2._s === 403 && blocked2.reason === 'A botnet', blocked2);
  a = await slash('unbanip', { ip: '198.51.100.7', reason: 'gone' });
  check('/unbanip lifts it', /not banned any more/.test(text(a)), text(a));
  // On IPv6 one phone has a whole block of addresses.
  const from = (ip) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/guest', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(Object.assign(JSON.parse(t), { _s: res.statusCode }))); });
    r.write(JSON.stringify({ tos: info.termsVersion }));
    r.end();
  });
  a = await slash('banip', { ip: '2001:db8:1:2:aaaa::1', reason: 'Rotating' });
  check('an IPv6 address shows without backslashes', text(a).includes('`2001:db8:1:2:aaaa::1`'), text(a));
  check('a ban on an IPv6 address covers its whole block', (await from('2001:db8:1:2:bbbb:cccc:dddd:9'))._s === 403, '');
  check('but not the next block over', (await from('2001:db8:1:3::1'))._s === 200, '');
  a = await slash('unbanip', { ip: '2001:db8:1:2::7', reason: 'gone' });
  check('and lifting works from any address in the block', (await from('2001:db8:1:2:bbbb:cccc:dddd:9'))._s === 200, text(a));
  // By phone.
  const dev = crypto.randomBytes(16).toString('hex');
  const phoneGuest = await api('/api/guest', { tos: info.termsVersion, device: dev, name: 'P' });
  a = await slash('banphone', { player: phoneGuest.user.id, reason: 'Hacked phone' });
  const again = await api('/api/guest', { tos: info.termsVersion, device: dev, name: 'P2' });
  check('/banphone stops new accounts from that phone', again._s === 403 && again.reason === 'Hacked phone', again);
  a = await slash('alts', { player: phoneGuest.user.id });
  check('/alts answers', !!text(a), a);
  a = await slash('unbanphone', { player: phoneGuest.user.id });
  check('/unbanphone lifts it', (await api('/api/guest', { tos: info.termsVersion, device: dev, name: 'P3' }))._s === 200, text(a));

  // ---------------- cheater warnings
  const cheater = await guest('Sneaky');
  const before = d.posts.length;
  const rep = await api('/api/device', { device: crypto.randomBytes(16).toString('hex'), guard: { frida: true, root: true, sig: true, apps: [] } }, cheater.token);
  check('a phone report is taken', rep._s === 200, rep);
  const warned = await until(() => d.posts.slice(before).find((p) => p.channel === WARN && /Possible cheater/.test(p.msg.embeds[0].title)));
  check('a cheater warning goes to its own channel, with the reason', !!warned && /Frida/.test(warned.msg.embeds[0].description), warned);
  check('being rooted alone says nothing', !d.posts.slice(before).some((p) => /[Rr]oot/.test(JSON.stringify(p.msg))));
  const apps = await guest('Apps');
  const device2 = crypto.randomBytes(16).toString('hex');
  for (let k = 0; k < 5; k++) await api('/api/device', { device: device2, guard: { apps: ['ru.gameguardian'] } }, apps.token);
  const appFlags = await slash('flags', { player: apps.user.id });
  check('the same thing reported again and again counts once', /: 15 of/.test(text(appFlags)), text(appFlags));
  check('the warning has the buttons', warned && warned.msg.components[0].components.length === 3);
  a = await slash('phone', { player: cheater.user.id });
  check('/phone shows what it reported', /Frida/.test(text(a)) && /Rooted/.test(text(a)), text(a));
  a = await slash('flags', { player: cheater.user.id });
  check('/flags shows it', /Frida/.test(text(a)), text(a));
  a = await slash('suspects');
  check('/suspects shows it', text(a).includes(`#${cheater.user.num}`), text(a));
  const buttons = warned.msg.components[0].components.map((b) => b.custom_id);
  a = await interact(3, { custom_id: buttons[1] });
  check('the Player button shows the player', text(a).includes(cheater.user.id), a);
  a = await interact(3, { custom_id: buttons[0] }, STRANGER);
  check('the Ban button is refused for strangers', /not allowed/.test(text(a)), a);
  a = await interact(3, { custom_id: buttons[0] });
  check('the Ban button asks for a reason, filled in from the warning', a.type === 9 && a.data.custom_id === `ac:banreason:${cheater.user.id}` && /Frida/.test(a.data.components[0].components[0].value), a);
  a = await interact(5, { custom_id: `ac:banreason:${cheater.user.id}`, components: [{ type: 1, components: [{ custom_id: 'reason', value: 'Frida in the game' }] }] }, STRANGER);
  check('filling the form is refused for strangers', /not allowed/.test(text(a)) && (await api('/api/wallet', undefined, cheater.token))._s === 200, a);
  a = await interact(5, { custom_id: `ac:banreason:${cheater.user.id}`, components: [{ type: 1, components: [{ custom_id: 'reason', value: 'Frida in the game' }] }] });
  w = await api('/api/wallet', undefined, cheater.token);
  check('filling the form bans with that reason', w._s === 403 && w.reason === 'Frida in the game', w);
  await slash('unban', { player: cheater.user.id });
  a = await interact(3, { custom_id: buttons[2] });
  a = await slash('flags', { player: cheater.user.id });
  check('the Clear button forgets the flags', /: 0 of/.test(text(a)), text(a));
  a = await interact(3, { custom_id: 'something:old' });
  check('an unknown button is harmless', /too old/.test(text(a)), a);

  // ---------------- the anticheat switch, and news
  a = await slash('anticheat', { mode: 'enforce' });
  a = await slash('anticheat');
  check('/anticheat switches to enforcing', /enforce/.test(text(a)), text(a));
  a = await slash('anticheat', { mode: 'watch' });
  check('and back', /watch/.test(text(a)), text(a));
  a = await slash('announce', { text: 'Event tonight!', minutes: 60 });
  let i2 = await api('/api/info');
  check('/announce reaches the game', i2.announce && i2.announce.text === 'Event tonight!', i2.announce);
  await slash('announce', { text: 'off' });
  i2 = await api('/api/info');
  check('and can be taken away', !i2.announce, i2.announce);
  await slash('maintenance', { on: true, message: 'Back in five' });
  i2 = await api('/api/info');
  const closed = await api('/api/guest', { tos: info.termsVersion, device: dev, name: 'M' });
  check('/maintenance closes the doors and says why', i2.maintenance === 'Back in five' && closed._s === 503 && closed.err === 'Back in five', [i2.maintenance, closed]);
  await slash('maintenance', { on: false });
  a = await slash('dailycap', { amount: 12345 });
  a = await slash('dailycap');
  check('/dailycap changes the limit', /12,345/.test(text(a)), text(a));
  a = await slash('logguests', { on: false });
  const quiet = d.posts.length;
  await guest('Quiet');
  await wait(150);
  check('/logguests turns off the guest logging', d.posts.slice(quiet).every((p) => !/guest/i.test(p.msg.embeds[0].title)));
  await slash('logguests', { on: true });

  // ---------------- rooms
  const room = (token, msg) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.msgs = [];
    ws.on('message', (m) => { ws.msgs.push(String(m)); });
    ws.on('open', () => { ws.send('!' + JSON.stringify(Object.assign({ t: msg.t, token }, msg))); setTimeout(() => resolve(ws), 250); });
    ws.on('error', () => resolve(ws));
  });
  const hostWs = await room(ana.token, { t: 'host', proto: 1, host: 'Ana', name: 'Ana room', pub: true, map: 0, diff: 1 });
  const code = (JSON.parse(hostWs.msgs.find((m) => m.includes('"code"')).slice(1)) || {}).code;
  check('a room opens, with the player known', !!code, hostWs.msgs);
  a = await slash('rooms');
  check('/rooms shows it, and who is in it', text(a).includes(code) && text(a).includes(`#${ana.user.num}`), text(a));
  const peerWs = await room(cheater.token, { t: 'join', code, proto: 1 });
  a = await slash('kick', { player: cheater.user.id, reason: 'Behave' });
  await wait(250);
  check('/kick throws someone out, with the reason', peerWs.readyState !== WebSocket.OPEN && peerWs.msgs.some((m) => m.includes('Behave')), peerWs.msgs);
  // Banned from a room the moment the ban lands, and can't come back.
  const peer2 = await room(cheater.token, { t: 'join', code, proto: 1 });
  await slash('ban', { player: cheater.user.id, reason: 'Enough' });
  await wait(250);
  check('a ban throws them out of the room too', peer2.readyState !== WebSocket.OPEN && peer2.msgs.some((m) => m.includes('Enough')), peer2.msgs);
  const peer3 = await room(cheater.token, { t: 'join', code, proto: 1 });
  check('and they can not come back', peer3.msgs.some((m) => m.includes('Enough')), peer3.msgs);
  await slash('unban', { player: cheater.user.id });
  // Impossible speed in a room.
  const speedy = await guest('Speedy');
  const sp = await room(speedy.token, { t: 'join', code, proto: 1 });
  const flagsBefore = d.posts.length;
  for (let k = 0; k < 8; k++) {
    sp.send(JSON.stringify({ k: 'st', s: [k * 150, 0, 0, 0, 0, 0, 0, 1, 0, 0] }));
    await wait(280);
  }
  const fast = await until(() => d.posts.slice(flagsBefore).find((p) => /Possible cheater/.test(p.msg.embeds[0].title) && /m\/s/.test(p.msg.embeds[0].description)));
  check('moving impossibly fast in a room gets warned about', !!fast, d.posts.slice(flagsBefore));
  // A look nobody paid for.
  const dresser = await guest('Dresser');
  const dr = await room(dresser.token, { t: 'join', code, proto: 1 });
  hostWs.msgs.length = 0;
  dr.send(JSON.stringify({ k: 'info', name: 'Dresser', color: null, look: { s: item, f: 'smile', h: 'none' } }));
  await wait(250);
  const got = hostWs.msgs.find((m) => m.includes('"info"')) || '';
  check('wearing what you do not own reaches others without it', got !== '' && JSON.parse(got.slice(got.indexOf('|') + 1)).look === null, hostWs.msgs);
  const dressFlags = await slash('flags', { player: dresser.user.id });
  check('and is noted', /does not own/.test(text(dressFlags)), text(dressFlags));
  await slash('giveitem', { player: dresser.user.id, item });
  hostWs.msgs.length = 0;
  await wait(220);
  dr.send(JSON.stringify({ k: 'info', name: 'Dresser', color: null, look: { s: item, f: 'smile', h: 'none' } }));
  await wait(250);
  const got2 = hostWs.msgs.find((m) => m.includes('"info"')) || '';
  check('but once bought it goes through', got2 !== '' && JSON.parse(got2.slice(got2.indexOf('|') + 1)).look && JSON.parse(got2.slice(got2.indexOf('|') + 1)).look.s === item, hostWs.msgs);
  a = await slash('closeroom', { code, reason: 'Closing time' });
  await wait(250);
  check('/closeroom closes it, with the reason', hostWs.readyState !== WebSocket.OPEN && hostWs.msgs.some((m) => m.includes('Closing time')), hostWs.msgs);
  for (const s of [peer3, sp, dr]) { try { s.close(); } catch (e) {} }

  // ---------------- the slow one
  a = await slash('backup');
  check('/backup says to wait, then answers', a.type === 5 && a.data.flags === 64, a);
  await until(() => d.patches.length);
  check('and the backup is made', d.patches.length === 1 && /Backup made/.test(d.patches[0].embeds[0].description), d.patches);

  // ---------------- deleting, and what stays
  const gone = await guest('Gone');
  await slash('ban', { player: gone.user.id, reason: 'Bye' });
  a = await slash('deleteplayer', { player: gone.user.id, confirm: false });
  check('/deleteplayer without confirming does nothing', /Nothing/.test(text(a)), text(a));
  a = await slash('deleteplayer', { player: gone.user.id, confirm: true });
  a = await slash('player', { player: gone.user.id });
  check('/deleteplayer deletes', /No player/.test(text(a)), text(a));

  // ---------------- the audit
  a = await slash('audit', { count: 50 });
  check('/audit shows what admins did', /givecoins|setcoins|ban/.test(text(a)), text(a));
  check('every change was also written in the log channel', d.posts.some((p) => p.channel === LOG && /used \/ban/.test(p.msg.embeds[0].description.replace(/\\/g, ''))));
  const needed = (d.commands || []).map((c) => c.name).filter((n) => !used.has(n) && !['ban', 'tempban', 'banip', 'banphone', 'giveall', 'resetwallet', 'givecoins', 'deleteplayer', 'backup'].includes(n));
  check('the test used every command', needed.length === 0, needed);

  // ---------------- Discord being difficult
  d.rateLimit = 2;
  const c0 = d.posts.length;
  await guest('RateLimited');
  const after429 = await until(() => d.posts.slice(c0).find((p) => /New guest/.test(p.msg.embeds[0].title)));
  check('being told to slow down only delays a message', !!after429 && d.rateLimit === 0);
  const r0 = d.resumes;
  d.socket.close(4000);
  await until(() => d.resumes > r0, 9000);
  check('losing the connection: it comes back and carries on', d.resumes === r0 + 1 && d.lastResume.session_id === 'sess', d.resumes);
  await wait(50);
  a = await slash('stats');
  check('and commands work again', /Players/.test(text(a)), a);
  const i0 = d.identifies;
  d.socket.send(JSON.stringify({ op: 9, d: false }));
  await until(() => d.identifies > i0, 9000);
  check('told its session is no good: it signs in anew', d.identifies === i0 + 1);
  await wait(50);

  // ---------------- the same commands with a !
  {
  check('the bot asks to read messages', (d.lastIdentify.intents & (1 << 15)) !== 0 && (d.lastIdentify.intents & (1 << 9)) !== 0, d.lastIdentify.intents);
  const pal = await guest('Pal'), odd = await guest('Cool Guy');
  const palCoins = async () => (await api('/api/wallet', undefined, pal.token)).coins;
  const palStart = await palCoins();
  check('!help lists them with a !', /`!ban`/.test(await bang('!help')));
  check('!help ban shows how to use it', /!ban player reason \[days\] \[ip\] \[phone\]/.test(await bang('!help ban')));
  check('!status answers in the channel', /Server /.test(await bang('!status')) );
  check('capitals are fine', /Server /.test(await bang('!STATUS')));
  check('!players lists players', /Pal/.test(await bang('!players')));
  check('!player finds one by number', /Pal/.test(await bang(`!player #${pal.user.num}`)));
  check('a player can go by ID too', /Pal/.test(await bang(`!coins ${pal.user.id}`)));
  await bang(`!givecoins #${pal.user.num} 50 a nice gift`);
  check('!givecoins gives', (await palCoins()) === palStart + 50, await palCoins());
  await bang(`!takecoins #${pal.user.num} 20 too much`);
  check('!takecoins takes', (await palCoins()) === palStart + 30, await palCoins());
  check('the admin and the reason are written down', /owner[\s\S]*(gift|much)/.test(await bang('!audit')) || /gift|much/.test(await bang('!history #' + pal.user.num)));
  // What Discord checks for slash commands.
  const coinsNow = await palCoins();
  for (const [what, line, why] of [
    ['a negative amount', `!givecoins #${pal.user.num} -5 x`, /below/],
    ['zero', `!takecoins #${pal.user.num} 0 x`, /below/],
    ['too many coins', `!givecoins #${pal.user.num} 999999999999 x`, /above/],
    ['not a number', `!givecoins #${pal.user.num} lots x`, /whole number/],
    ['half a coin', `!givecoins #${pal.user.num} 1.5 x`, /whole number/],
    ['a number too big to hold', `!setcoins #${pal.user.num} 99999999999999999999 x`, /whole number/],
  ]) check(`${what} is refused`, why.test(await bang(line)), line);
  check('and none of that changed anything', (await palCoins()) === coinsNow, await palCoins());
  check('something missing shows how to use it', /Missing: player, amount[\s\S]*!givecoins player amount \[reason\]/.test(await bang('!givecoins')));
  check('a reason is required for a ban', /Missing: reason/.test(await bang(`!ban #${pal.user.num}`)));
  check('too long a reason is refused', /300 letters/.test(await bang(`!ban #${pal.user.num} ${'x'.repeat(301)}`)));
  check('a bad choice lists the good ones', /watch, enforce|enforce, watch/.test(await bang('!anticheat sometimes')));
  check('a confirmation has to be yes or no', /yes or no/.test(await bang(`!deleteplayer #${pal.user.num} maybe`)));
  check('leaving a confirmation out deletes nothing', /Missing: confirm/.test(await bang(`!deleteplayer #${pal.user.num}`)) && (await api('/api/wallet', undefined, pal.token))._s === 200);
  check('too many words are refused', /Too many words/.test(await bang('!stats and more')));
  // Bans.
  const b1 = await bang(`!ban #${pal.user.num} flying around the map days=3`);
  check('!ban takes a reason of many words and a named option', /flying around the map/.test(b1), b1);
  let row = await api('/api/wallet', undefined, pal.token);
  check('and the ban is real', row._s === 403 && /flying around the map/.test(JSON.stringify(row)), row);
  check('it shows in !baninfo', /flying around the map/.test(await bang(`!baninfo #${pal.user.num}`)));
  await bang(`!unban #${pal.user.num} sorry`);
  check('!unban lifts it', (await api('/api/wallet', undefined, pal.token))._s === 200);
  await bang('!ban "Cool Guy" a name in quotes');
  check('a name with spaces works in quotes', (await api('/api/wallet', undefined, odd.token))._s === 403);
  await bang('!unban \u201cCool Guy\u201d');
  check('curly phone quotes work too', (await api('/api/wallet', undefined, odd.token))._s === 200);
  // Who, and where.
  const c0 = await palCoins();
  const before2 = d.posts.length;
  check('in the log channel, a stranger is refused', /not allowed/.test(await bang(`!givecoins #${pal.user.num} 500 x`, { who: STRANGER })));
  check('and it gets logged', d.posts.slice(before2).some((p) => /is not on the list/.test(JSON.stringify(p.msg))));
  check('a stranger repeating it gets no more answers', (await bang(`!givecoins #${pal.user.num} 500 x`, { who: STRANGER })) === '');
  check('and nothing was given', (await palCoins()) === c0);
  const PUBLIC = '777777777777777777';
  check('elsewhere a stranger gets no answer, they may mean some other bot', (await bang('!help', { who: ADMIN2 + '9', channel: PUBLIC })) === '');
  const away = await bang(`!givecoins #${pal.user.num} 500 x`, { channel: PUBLIC, who: ADMIN2 });
  check('an admin in a public channel is pointed to the log channel', away.includes(`<#${LOG}>`), away);
  check('and it does not run there', (await palCoins()) === c0);
  check('and an IP lookup says nothing there', !/\d+\.\d+\.\d+\.\d+/.test(await bang('!ips #1', { channel: PUBLIC })));
  check('the warning channel works too', /Server /.test(await bang('!status', { channel: WARN })));
  await bang(`!givecoins #${pal.user.num} 500 x`, { bot: true });
  await bang(`!givecoins #${pal.user.num} 500 x`, { webhook: '123' });
  await bang(`!givecoins #${pal.user.num} 500 x`, { guild: '999' });
  await bang(`!givecoins #${pal.user.num} 500 x`, { guild: null });
  check('bots, webhooks, other servers and private messages are ignored', (await palCoins()) === c0, await palCoins());
  check('an unknown command gets a pointer', /!help/.test(await bang('!nonsense')));
  check('ordinary chat gets no answer', (await bang('! wow')) === '' && (await bang('hello !status')) === '' && (await bang('!!!')) === '' && (await bang('!')) === '');
  check('nothing typed can mention everyone', (await bang('!search @everyone')).length >= 0 && d.posts.slice(-1)[0].msg.allowed_mentions.parse.length === 0);
  // Every command can be written down.
  const { parseBang, usage, COMMANDS } = require(path.join(ROOT, 'server/lib/botcommands.js'));
  const sample = { 3: 'word', 4: '5', 5: 'yes' };
  const notParsed = COMMANDS.filter((c) => {
    const words = c.options.filter((o) => o.required).map((o) => (o.choices ? o.choices[0].value : sample[o.type]));
    const r = parseBang(`!${c.name} ${words.join(' ')}`);
    return !(r && r.data && r.data.name === c.name) || !usage(c).startsWith('!');
  }).map((c) => c.name);
  check(`all ${COMMANDS.length} commands can be typed`, notParsed.length === 0, notParsed);
  }

  // Discord silent, game still fine.
  const puts = d.puts;
  await stopServer();
  await start();
  await until(() => d.identifies > i0 + 1);
  await wait(300);
  check('after a restart the commands are not sent again without need', d.puts === puts, d.puts);
  check('the server log has no crash', !/TypeError|ReferenceError|Unhandled/.test(srv.log), srv.log);
  w = await api('/api/wallet', undefined, ana.token);
  check('everything is still there after a restart', w._s === 200 && w.coins === 7, w);
  a = await slash('dailycap');
  check('so are the settings', /12,345/.test(text(a)), text(a));
  await stopServer();

  // The switch for reading messages is off: only the ! commands go.
  await stopServer();
  d.contentSwitchOff = true;
  const before3 = d.posts.length;
  await start();
  const onlySlash = await until(() => d.lastIdentify && (d.lastIdentify.intents & (1 << 15)) === 0 && d.socket && d.socket.readyState === 1);
  await wait(800);
  check('without the switch the bot reconnects without asking to read messages', !!onlySlash, d.lastIdentify);
  check('the log channel is told what to do', d.posts.slice(before3).some((p) => /Message Content Intent/.test(JSON.stringify(p.msg))));
  check('slash commands still work', /Server /.test(text(await slash('status'))));
  check('and /status says the ! commands are off', /! commands off/.test(text(await slash('status'))));
  check('it says so in the server log too', /Message Content Intent/.test(srv.log));
  check('no crash', !/TypeError|ReferenceError|Unhandled/.test(srv.log), srv.log);
  d.contentSwitchOff = false;

  // Invited late, the usual order of things: the commands have to appear by themselves.
  await stopServer();
  d.notInvited = true;
  d.commands = null;
  const puts0 = d.puts;
  await start({ DISCORD_BOT_REGISTER_EVERY: '300' });
  await until(() => /Could not set up the slash commands/.test(srv.log));
  check('not on the server yet: it says why', /not on that server yet/.test(srv.log), srv.log);
  await wait(900);
  check('it says so once, not over and over', (srv.log.match(/Could not set up/g) || []).length === 1, srv.log);
  check('/status tells the trouble', /Could not set up the slash commands/.test(text(await slash('status'))));
  d.notInvited = false;
  await until(() => d.commands, 3000);
  check('invited later: the commands appear without a restart', Array.isArray(d.commands) && d.commands.length >= 40 && d.puts === puts0 + 1, d.puts);
  await wait(500);
  check('and then it stops trying', d.puts === puts0 + 1, d.puts);
  // Thrown off the server and invited back: Discord has forgotten them.
  await stopServer();
  d.commands = [];
  await start();
  await until(() => d.commands && d.commands.length);
  check('commands Discord has forgotten are set up again', d.commands.length >= 40);
  await stopServer();
  await start();
  await wait(600);
  check('and still not sent when they are there', d.puts === puts0 + 2, d.puts);

  // A bad token: the bot stops, the game does not.
  await start({ DISCORD_BOT_TOKEN: 'wrong' });
  await until(() => /refused the bot token/.test(srv.log));
  const i3 = d.identifies;
  await wait(300);
  check('a wrong token is reported and not tried again and again', /refused the bot token/.test(srv.log) && d.identifies === i3, srv.log);
  check('and the game carries on', (await api('/api/info')).name === 'StickManUp server');
  await stopServer();

  // No token: no bot at all.
  const i4 = d.identifies;
  await start({ DISCORD_BOT_TOKEN: '' });
  await wait(300);
  check('without a token the bot stays off', d.identifies === i4 && /Bot: off/.test(srv.log), srv.log);
  check('and the game runs', (await api('/api/info')).name === 'StickManUp server');
  await stopServer();

  // Nobody on the list means nobody.
  await start({ DISCORD_BOT_ADMINS: '' });
  await until(() => d.identifies > i4);
  await wait(100);
  a = await slash('stats');
  check('with an empty list nobody can use the bot, and it says how to fix that', /install\.sh --bot/.test(text(a)), a);
  await stopServer();

  gw.close();
  web.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); try { srv.kill(); } catch (x) {} process.exit(1); });
