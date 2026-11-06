// Talking to a StickManUp server: the room list, signing in, your coins, and keeping your progress on your account.
// Climbing still works without a connection, it just doesn't earn coins. Guests have an account too, with the coins kept on
// the server, known only by the token this phone holds. Signing in moves them to a real one that can't get lost.
//
// Signing in happens in the phone's browser, never in the game. The browser comes back to the app with a one time code,
// and only this copy of the game can use it, because only it knows the secret it started with (see server/lib/auth.js).
import { store } from './util.js';
import { flushProfile, mergeRecords, recordsOf, setRecords, setWallet, snapshot, restore, cleanRun, lookFromAccount, lookStamp } from './profile.js';
import { DIFFS } from './level.js';
import { itemKey, setRoleTable } from './skins.js';
import { Recorder, toBase64, fromBase64, deflate } from './replay.js';
import { SIM_BUILD } from './simbuild.js';

// The one game server this game talks to. Using another means changing this and building the game again.
export const SERVER = 'https://pointdesk.net:47810';
const N = window.Native;
import { DESK, IS_WEB } from './platform.js';
const PUSH_AFTER = 30000;
// Something new to wear goes off sooner, so the next phone you pick up has it on.
const LOOK_AFTER = 3000;
const REPORT_AFTER = 12000;
const RUN_MAX_AGE = 24 * 3600000;
const PENDING_MAX = 15 * 60000;

let address = '';
let acct = store.get('account', null);
let needsTerms = false;
let ban = store.get('banInfo', null);
let muted = false;
let timer = 0;
let timerAt = 0;
let lookSent = 0;
let lastSent = '';
let lastSync = 0;
let busy = null;
const hooks = {};
export const on = (k, f) => { hooks[k] = f; };
const emit = (k, ...a) => { if (hooks[k]) hooks[k](...a); };

// The test scripts run the page from their own little web server, with a game server of their own or none at all.
// The app always loads from appassets.androidplatform.net, so on a phone this never applies.
const TESTING = !!globalThis.location && location.hostname === '127.0.0.1';
export const setTestServer = (url) => { if (TESTING) address = url || ''; };
export const serverUrl = () => (TESTING ? address : SERVER);
export const wsUrl = () => serverUrl().replace(/^http/, 'ws') + '/ws';

// The account only counts on the server it belongs to.
export const account = () => (acct && acct.server === serverUrl() ? acct : null);
export const isGuest = () => { const a = account(); return !!a && a.user.provider === 'guest'; };
export const termsNeeded = () => !!account() && needsTerms;
// Why this player can't use the server, if they can't: { reason, until }.
export function banned() {
  if (ban && ban.until && ban.until < Date.now()) {
    ban = null;
    store.del('banInfo');
  }
  return ban;
}
// What a room on the server wants to know who you are by.
export const roomToken = () => (account() ? acct.token : '');
export const lastSaved = () => lastSync;

async function call(path, o = {}) {
  const headers = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  // Signed out while this was on its way: it is nobody's any more, and an answer to it says nothing about whoever is here now.
  const who = acct;
  if (o.auth) {
    if (!who) return { ok: false, status: 0, json: {} };
    headers.Authorization = 'Bearer ' + who.token;
  }
  let r;
  try {
    r = await fetch(serverUrl() + path, { method: o.method || (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, keepalive: !!o.keepalive, signal: AbortSignal.timeout(o.timeout || 12000) });
  } catch (e) {
    return { ok: false, status: 0, json: {} };
  }
  let json = {};
  try { json = await r.json(); } catch (e) {}
  // The session is over. What the account has stays on the server until the next sign in.
  if (r.status === 401 && o.auth && acct === who) {
    const wasGuest = isGuest();
    forget();
    if (wasGuest) store.del('guestAcct');
    backToGuest();
    emit('expired');
  }
  if (r.status === 403 && json && json.banned) setBan(json);
  return { ok: r.ok, status: r.status, json };
}

function setBan(j) {
  const was = ban;
  ban = j && j.banned !== false ? { reason: String(j.reason || ''), until: +j.until || 0, num: j.num } : null;
  // Kept, so going offline or restarting doesn't end it. Only the server can.
  if (ban) store.set('banInfo', ban);
  else store.del('banInfo');
  if (ban && (!was || was.reason !== ban.reason || was.until !== ban.until)) {
    if (climb) stopClimb(climb, 'banned');
    emit('banned', ban);
  } else if (!ban && was) emit('unbanned');
}

export async function getInfo() {
  if (!serverUrl()) return null;
  // The terms come in the language the game is shown in.
  const r = await call('/api/info?lang=' + encodeURIComponent(document.documentElement.lang || 'en'), { timeout: 8000 });
  const ok = r.ok && r.json && typeof r.json.terms === 'string';
  // The tag and colour of every role, for the flags next to names.
  if (ok && r.json.roles) setRoleTable(r.json.roles);
  return ok ? r.json : null;
}
export async function getRooms(proto) {
  if (!serverUrl()) return null;
  const t0 = performance.now(), r = await call('/api/rooms?proto=' + encodeURIComponent(proto));
  if (!r.ok || !Array.isArray(r.json.rooms)) return null;
  return { rooms: r.json.rooms, online: r.json.online || {}, ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- signing in
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startLogin(provider, termsVersion) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set('auth.pending', { verifier, server: serverUrl(), t: Date.now() });
  const url = `${serverUrl()}/auth/${encodeURIComponent(provider)}/start?challenge=${challenge}&tos=${encodeURIComponent(termsVersion)}`;
  if (N && N.openUrl) N.openUrl(url);
  // A web page goes there itself and gets sent back. The PC app opens the real browser, which comes back through a link.
  else if (IS_WEB) location.href = url + '&ret=web';
  else window.open(url, '_blank');
}
export const cancelLogin = () => store.del('auth.pending');

// The browser came back with a code. Without a sign in we started ourselves, it means nothing.
export async function finishLogin(code) {
  const p = store.get('auth.pending', null);
  store.del('auth.pending');
  if (!p || Date.now() - p.t > PENDING_MAX || p.server !== serverUrl()) return false;
  const g = store.get('guestAcct', null);
  const r = await call('/auth/exchange', { body: { code: String(code), verifier: p.verifier, device: deviceId(), guest: g && g.server === p.server ? g.token : undefined } });
  if (r.status === 403 && r.json.banned) return false;
  if (!r.ok || typeof r.json.token !== 'string') {
    emit('loginFailed', r.json.err || (r.status ? 'Sign in failed. Please try again.' : 'Could not reach the server.'));
    return false;
  }
  // Remember the guest, to go back to when signing out. Whatever climb was going on belongs to them.
  await runEnd();
  await report();
  flushProfile();
  store.set('guest', { profile: snapshot(), best: store.get('best2', {}), solo: store.get('save.solo', null) });
  // What the account was last seen wearing, on whichever phone, comes on here.
  muted = true;
  lookFromAccount();
  muted = false;
  acct = { server: p.server, token: r.json.token, user: r.json.user, rev: 0 };
  needsTerms = !r.json.user.tosOk;
  store.set('account', acct);
  await refreshWallet();
  await syncNow();
  watchDevice();
  emit('signedIn', acct.user);
  if (r.json.moved) emit('guestMoved');
  return true;
}

export let guestError = '';
// Starting without signing in anywhere. They have just accepted the terms. A guest from before is simply picked up again.
export async function startGuest(termsVersion, name) {
  if (account()) return true;
  const g = store.get('guestAcct', null);
  if (g && g.server === serverUrl()) {
    acct = g;
    store.set('account', acct);
    if (termsVersion) await call('/api/tos', { auth: true, body: { version: termsVersion } });
    needsTerms = false;
    await refreshWallet();
    watchDevice();
    return true;
  }
  const r = await call('/api/guest', { body: { tos: termsVersion, device: deviceId(), name: String(name || '').slice(0, 14) } });
  if (!r.ok || typeof r.json.token !== 'string') {
    guestError = r.json.err || '';
    return false;
  }
  acct = { server: serverUrl(), token: r.json.token, user: r.json.user, rev: 0 };
  store.set('account', acct);
  store.set('guestAcct', acct);
  needsTerms = false;
  await refreshWallet();
  watchDevice();
  emit('changed');
  return true;
}
window.SMU_authCode = (code) => { finishLogin(code); };

// Ask again if the terms changed. Called at startup.
export async function start() {
  lookSent = lookStamp();
  store.watch = (k) => {
    if (muted || (k !== 'profile' && k !== 'best2' && k !== 'save.solo')) return;
    const t = k === 'profile' ? lookStamp() : lookSent;
    if (t !== lookSent) { lookSent = t; soon(LOOK_AFTER); } else soon();
  };
  if (N && N.authPending) {
    const c = N.authPending();
    if (c) await finishLogin(c);
  }
  if (DESK) DESK.onAuth((c) => { finishLogin(c); });
  if (IS_WEB) {
    const c = new URLSearchParams(location.search).get('code');
    if (c) {
      // It works only once, but still has no business staying in the address bar.
      history.replaceState(null, '', location.pathname);
      await finishLogin(c);
    }
  }
  checkNews();
  watchStanding();
  if (!account()) return;
  const r = await call('/api/me', { auth: true });
  if (r.ok && r.json.user) {
    acct.user = r.json.user;
    store.set('account', acct);
    needsTerms = !r.json.user.tosOk;
    if (r.json.ban) setBan(r.json.ban);
    if (ban) return;
    if (needsTerms) emit('terms');
    else {
      await refreshWallet();
      report();
      syncNow();
      watchDevice();
    }
  }
}

export async function acceptTerms(version) {
  const r = await call('/api/tos', { auth: true, body: { version } });
  if (!r.ok) return false;
  needsTerms = false;
  acct.user = r.json.user;
  store.set('account', acct);
  if (isGuest()) store.set('guestAcct', acct);
  await refreshWallet();
  syncNow();
  watchDevice();
  return true;
}

// ---------------------------------------------------------------- progress
const localData = () => {
  muted = true;
  flushProfile();
  muted = false;
  return { v: 1, profile: recordsOf(store.get('profile', {})), best: store.get('best2', {}), solo: store.get('save.solo', null) };
};
function applyData(d) {
  muted = true;
  setRecords(d.profile);
  store.set('best2', d.best || {});
  if (d.solo) store.set('save.solo', d.solo); else store.del('save.solo');
  muted = false;
  emit('changed');
}
// What the server keeps is only trusted as far as it looks like a save.
function cleanSolo(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.pos) || !s.pos.every(Number.isFinite)) return null;
  if (!Number.isFinite(s.t) || !Number.isFinite(s.falls) || !Number.isInteger(s.diff) || !Number.isInteger(s.map || 0)) return null;
  return s.run ? Object.assign({}, s, { run: cleanRun(s.run) }) : s;
}
// The same climb can't be on two phones at once: keep whichever got higher.
export function mergeData(a, b) {
  const best = {};
  for (const src of [b.best, a.best]) {
    for (const [k, t] of Object.entries(src && typeof src === 'object' ? src : {})) if (Number.isFinite(t) && t > 0 && (!best[k] || t < best[k])) best[k] = t;
  }
  // A climb from before the team reset this checkpoint can't come back from another phone.
  const gone = acct ? store.get('cpReset.' + acct.user.id, 0) : 0, keep = (s) => (s && gone && !(s.run && s.run.when > gone) ? null : s);
  a = Object.assign({}, a, { solo: keep(cleanSolo(a.solo)) });
  b = Object.assign({}, b, { solo: keep(cleanSolo(b.solo)) });
  const h = (s) => (s && s.pos ? s.pos[1] : -1);
  return { v: 1, profile: mergeRecords(a.profile || {}, b.profile || {}), best, solo: h(a.solo) >= h(b.solo) ? a.solo || null : b.solo || null };
}

function soon(ms = PUSH_AFTER) {
  if (!account() || isGuest() || needsTerms || (timer && Date.now() + ms >= timerAt)) return;
  clearTimeout(timer);
  timerAt = Date.now() + ms;
  timer = setTimeout(() => { timer = 0; push(); }, ms);
}

// Send what is here, over the version last seen. If another phone got there first, merge the two and go again.
async function send(data, keepalive) {
  const who = acct;
  for (let k = 0; k < 3; k++) {
    const text = JSON.stringify(data);
    if (text === lastSent) return true;
    if (text.length > 480 * 1024) return false;
    const r = await call('/api/save', { auth: true, method: 'PUT', body: { rev: acct.rev, data }, keepalive: keepalive && text.length < 60000 });
    if (acct !== who) return false;
    if (r.ok) {
      acct.rev = r.json.rev;
      store.set('account', acct);
      lastSent = text;
      lastSync = Date.now();
      return true;
    }
    if (r.status !== 409) return false;
    acct.rev = r.json.rev;
    data = r.json.data ? mergeData(data, r.json.data) : data;
    applyData(data);
  }
  return false;
}
async function push(keepalive) {
  if (!account() || isGuest() || needsTerms) return false;
  if (busy) await busy;
  if (!account()) return false;
  return send(localData(), keepalive);
}
// Going to the background or finishing a climb: don't wait.
export function flush() {
  if (timer) { clearTimeout(timer); timer = 0; }
  sealNow();
  saveClimbs();
  report();
  return push(true);
}

// Fetch what the account has, put the two together here and there. This is how progress reaches a new phone.
export function syncNow() {
  if (busy) return busy;
  busy = (async () => {
    if (!account() || isGuest() || needsTerms) return false;
    const who = acct, g = await call('/api/save', { auth: true });
    if (!g.ok || acct !== who) return false;
    acct.rev = g.json.rev;
    const local = localData(), data = g.json.data ? mergeData(local, g.json.data) : local;
    if (g.json.data) applyData(data);
    lastSent = g.json.data && JSON.stringify(g.json.data) === JSON.stringify(data) ? JSON.stringify(data) : '';
    const ok = await send(data);
    if (ok) lastSync = Date.now();
    return ok;
  })().finally(() => { busy = null; });
  return busy;
}

// ---------------------------------------------------------------- the coins
// The server holds them, for guests as well. This phone shows a copy, plus what it has earned that hasn't reached the server.
// Each climb gets written down as it is played (replay.js) and goes to the server a chunk at a time, where it is played
// again. If the connection drops the chunks wait here, and go when it comes back.
const START_GRACE = 20000;
const MAX_QUEUE = 80;
const STOP_WORDS = {
  update: 'Update StickManUp to earn coins again.',
  save: 'This saved climb can not earn more coins. A new climb can!',
  tainted: 'This climb has stopped counting for coins.',
  dead: 'This climb has stopped counting for coins.',
  gap: 'This climb has stopped counting for coins.',
  offline: 'No connection: this climb will not earn coins.',
};
let climbs = store.get('wallet.climbs', []);
// Nothing is being climbed yet when the game starts: what is listed here is left over from last time.
for (const c of climbs) c.live = false;
let climb = null;
let rec = null;
let reportTimer = 0;
let reporting = null;
let again = false;
const saveClimbs = () => store.set('wallet.climbs', climbs);
const coinValue = (c) => (DIFFS[c.diff] && DIFFS[c.diff].coin) || 0;
const waiting = () => climbs.reduce((n, c) => {
  if (c.dead) return n;
  let k = c.coins.length;
  for (const q of c.queue || []) k += q.claims.coins.length;
  const wins = (c.win ? 1 : 0) + (c.queue || []).filter((q) => q.claims.win).length;
  return n + k * coinValue(c) + wins * ((DIFFS[c.diff] && DIFFS[c.diff].summit) || 0);
}, 0);

function haveWallet(w) {
  if (!w || typeof w.coins !== 'number') return false;
  muted = true;
  setWallet(w, waiting());
  muted = false;
  emit('changed');
  return true;
}
export async function refreshWallet() {
  if (!account()) return false;
  const r = await call('/api/wallet', { auth: true });
  return r.ok && account() ? haveWallet(r.json) : false;
}

// Buying is the server's call, so it needs a connection. Answers what went wrong, or nothing.
// Ghost racing (ghost.js, server/lib/ghosts.js): yours, your room's and your friends' best climbs of a map and difficulty.
export async function fetchGhosts(map, diff, room) {
  if (!account()) return [];
  const r = await call(`/api/ghosts?map=${encodeURIComponent(map)}&diff=${encodeURIComponent(diff)}&room=${encodeURIComponent(room || '')}`, { auth: true });
  return r.ok && Array.isArray(r.json.ghosts) ? r.json.ghosts : [];
}
export function postGhost(map, diff, g) {
  if (!account()) return;
  call('/api/ghost', { auth: true, body: { map, diff, won: g.won, t: g.t, h: g.h, data: g.data } });
}

// Graffiti kept on the server for a map (server/lib/sprays.js): the latest few of every climber. Nothing without a server.
export async function fetchSprays(map, lv) {
  if (!serverUrl()) return [];
  const r = await call(`/api/sprays?map=${encodeURIComponent(map)}&lv=${encodeURIComponent(lv)}`);
  return r.ok && Array.isArray(r.json.sprays) ? r.json.sprays : [];
}
// One of yours, to keep there. Only with an account: a guest's stays in the room it was sprayed in.
export function postSpray(map, lv, s) {
  if (!account()) return;
  call('/api/spray', { auth: true, body: { map, lv, id: s.id, x: s.x, y: s.y, z: s.z, nx: s.nx, ny: s.ny, nz: s.nz, r: s.r, w: s.w } });
}

export async function buyItem(item) {
  if (!account()) return 'Coins are kept on the game server. Open Account to get started.';
  const r = await call('/api/buy', { auth: true, body: { id: itemKey(item) } });
  if (r.json.wallet) haveWallet(r.json.wallet);
  if (r.ok) return null;
  if (r.status === 0) return 'You need a connection to buy things.';
  return r.json.err || 'That did not work. Please try again.';
}

export const runId = () => (climb ? climb.run : null);
// Whether this climb is earning anything at all right now.
export const counting = () => !!climb && !climb.dead;

export function runStart(o) {
  if (rec) { rec.seal(); rec = null; }
  if (climb) climb.live = false;
  climb = null;
  if (!o.earning) { emit('notCounting', 'room'); return; }
  if (!account() || needsTerms || ban) { emit('notCounting', ban ? 'banned' : 'guest'); return; }
  // Picking up a save needs the climb it belongs to, or the server can't know how it got there.
  if (o.resumed && (typeof o.run !== 'string' || !Number.isInteger(o.rs))) { emit('notCounting', 'save'); return; }
  climb = { run: o.resumed ? o.run : null, map: o.map, diff: o.diff, rules: o.rules || {}, mode: o.mode || 'solo', name: String(o.name || '').slice(0, 14), coins: [], relics: [], win: null, t: Date.now(), live: true, dead: false, seq: 0, fresh: true, resume: o.resumed ? o.rs : null, needSeq: !!o.resumed, queue: [], tail: null };
  climbs.push(climb);
  while (climbs.length > 8) climbs.shift();
  saveClimbs();
  report();
}
export function recorder(head) {
  if (!climb) return null;
  const c = climb;
  rec = new Recorder(head, (b) => sealed(c, b));
  rec.saves = climb.resume || 0;
  return rec;
}
// A chunk is full, or the climb stops. It waits here until the server has it.
function sealed(c, b, claims) {
  if (c.dead) return;
  const q = { seq: c.seq++, start: b.start, n: b.n, fresh: c.fresh, resume: c.fresh ? c.resume : null, raw: toBase64(b.bytes), data: null, claims: claims || { coins: c.coins.splice(0), relics: c.relics.splice(0), win: c.win } };
  if (!claims) c.win = null;
  c.fresh = false;
  c.tail = null;
  c.queue.push(q);
  if (c.queue.length > MAX_QUEUE) { stopClimb(c, 'offline'); return; }
  saveClimbs();
  packNext();
  reportSoon(800);
}
// Compressing is done between frames, oldest first. Anyone asking while it is going on waits for the same work.
let packing = null;
function packNext() {
  if (!packing) {
    packing = (async () => {
      try {
        for (;;) {
          const c = climbs.find((x) => x.queue.some((q) => !q.data && q.raw));
          if (!c) break;
          const q = c.queue.find((x) => !x.data && x.raw);
          q.data = toBase64(await deflate(fromBase64(q.raw)));
          q.raw = null;
        }
        saveClimbs();
      } catch (e) {
        // No compression on this phone: then the climb can't be sent, and nothing else is wrong.
      }
    })().finally(() => { packing = null; });
  }
  return packing;
}
// Saving a climb also keeps what was played since the last chunk, so a crash can't leave the server not knowing about a save.
export function climbSaved() {
  if (!climb || !rec) return;
  const b = rec.pack();
  climb.tail = b ? { start: b.start, n: b.n, raw: toBase64(b.bytes), fresh: climb.fresh, resume: climb.fresh ? climb.resume : null } : null;
  saveClimbs();
}
function stopClimb(c, why) {
  c.dead = true;
  c.queue = [];
  c.tail = null;
  c.coins = [];
  c.relics = [];
  c.win = null;
  saveClimbs();
  if (c === climb) emit('notCounting', why);
}
// The climb stops earning here, and what it earned so far goes to the server as usual.
export function runStop(why) {
  if (!climb) return;
  if (rec) { rec.seal(); rec = null; }
  climb.live = false;
  climb = null;
  saveClimbs();
  emit('notCounting', why);
}
export function runCoin(i) { if (counting()) climb.coins.push(i); }
export function runRelic(id) { if (counting()) { climb.relics.push(id); sealNow(); } }
export function runWin(falls) {
  if (!counting()) return;
  climb.win = { falls: Number.isFinite(falls) ? falls : 1 };
  sealNow();
}
function sealNow() { if (rec) rec.seal(); }
export function runEnd() {
  sealNow();
  rec = null;
  if (climb) climb.live = false;
  climb = null;
  saveClimbs();
  return report();
}

function reportSoon(ms = REPORT_AFTER) {
  if (!reportTimer) reportTimer = setTimeout(() => { reportTimer = 0; report(); }, ms);
}
// One at a time, and anything that turned up meanwhile goes straight after.
export function report() {
  if (reporting) { again = true; return reporting; }
  if (!account() || needsTerms || ban || !climbs.length) return Promise.resolve(true);
  clearTimeout(reportTimer);
  reportTimer = 0;
  reporting = (async () => {
    let ok;
    do {
      again = false;
      ok = await sendClimbs();
    } while (again && account());
    return ok;
  })().finally(() => { reporting = null; });
  return reporting;
}
// What was left from last time: the bit played after the last whole chunk.
function recoverTail(c) {
  if (!c.tail || c.live) return;
  const t = c.tail;
  c.tail = null;
  c.queue.push({ seq: c.seq++, start: t.start, n: t.n, fresh: t.fresh, resume: t.resume, raw: t.raw, data: null, claims: { coins: c.coins.splice(0), relics: c.relics.splice(0), win: c.win } });
  c.win = null;
  c.fresh = false;
}
async function sendClimbs() {
  const who = acct;
  let ok = true, wallet = null;
  for (const c of [...climbs]) {
    if (!account()) return false;
    if (c.dead) { if (!c.live) climbs.splice(climbs.indexOf(c), 1); continue; }
    recoverTail(c);
    if (c.queue.some((q) => !q.data)) await packNext();
    if (!c.run) {
      const s = await call('/api/run/start', { auth: true, body: { map: c.map, diff: c.diff, custom: false, rules: c.rules, mode: c.mode, name: c.name, build: SIM_BUILD } });
      if (s.ok && s.json.run) c.run = s.json.run;
      else {
        // The server has to know about a climb from the start, or it can't believe how long it has been going.
        if (Date.now() - c.t > START_GRACE) stopClimb(c, 'offline');
        ok = false;
        reportSoon(4000);
        continue;
      }
    }
    if (c.needSeq) {
      const n = await call('/api/run/chunk', { auth: true, body: { run: c.run, build: SIM_BUILD } });
      if (n.status === 404) { stopClimb(c, 'save'); continue; }
      if (!n.ok || !Number.isInteger(n.json.next)) { ok = false; break; }
      if (n.json.stop) { stopClimb(c, n.json.stop); continue; }
      let seq = n.json.next;
      for (const q of c.queue) q.seq = seq++;
      c.seq = seq;
      c.needSeq = false;
    }
    while (c.queue.length && c.queue[0].data) {
      const q = c.queue[0];
      const r = await call('/api/run/chunk', { auth: true, keepalive: q.data.length < 50000, body: { run: c.run, seq: q.seq, build: SIM_BUILD, start: q.start, n: q.n, fresh: q.fresh || undefined, resume: q.resume === null ? undefined : q.resume, data: q.data, coins: q.claims.coins, relics: q.claims.relics, win: q.claims.win } });
      if (r.status === 404) { stopClimb(c, 'save'); break; }
      if (!r.ok) { ok = false; reportSoon(); break; }
      if (r.json.wallet) wallet = r.json.wallet;
      if (r.json.capped) emit('dayLimit');
      if (r.json.stop) { stopClimb(c, r.json.stop); break; }
      c.queue.shift();
      if (r.json.winResult === 'too fast' || r.json.winResult === 'too many') emit('winRefused');
      saveClimbs();
    }
    if (!ok) break;
    if (!c.live && !c.queue.length && !c.tail) climbs.splice(climbs.indexOf(c), 1);
  }
  saveClimbs();
  if (wallet && acct === who) haveWallet(wallet);
  return ok;
}

// ---------------------------------------------------------------- about this phone
// A number that stays with this phone and means nothing anywhere else, and what the app's own checks found (Guard.java).
export function deviceId() {
  if (N && N.deviceId) { const d = N.deviceId(); if (d) return d; }
  let d = store.get('deviceId', '');
  if (!d) {
    d = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    store.set('deviceId', d);
  }
  return d;
}
const guardNow = () => {
  try { return N && N.guard ? JSON.parse(N.guard()) : {}; } catch (e) { return {}; }
};
let lastGuard = '';
let deviceTimer = 0;
export async function reportDevice() {
  if (!account() || ban) return;
  const guard = guardNow(), text = JSON.stringify(guard);
  if (text === lastGuard) return;
  const r = await call('/api/device', { auth: true, body: { device: deviceId(), guard } });
  if (r.ok) lastGuard = text;
}
// Asking the phone's secure hardware to vouch for it, once each time the game starts. It takes a moment, so the phone calls back.
window.SMU_attested = async (text) => {
  let a;
  try { a = JSON.parse(text); } catch (e) { return; }
  if (!account()) return;
  await call('/api/device', { auth: true, body: { device: deviceId(), guard: guardNow(), attest: a } });
};
async function attestNow() {
  if (!N || !N.attestStart || !account() || ban) return;
  const c = await call('/api/attest/challenge', { auth: true, body: {} });
  if (c.ok && c.json.challenge) N.attestStart(c.json.challenge);
}
function watchDevice() {
  // Asking starts the checks, which take a moment. The answer goes a little later, and whenever it changes.
  guardNow();
  setTimeout(reportDevice, 6000);
  attestNow();
  clearInterval(deviceTimer);
  deviceTimer = setInterval(reportDevice, 120000);
}

// ---------------------------------------------------------------- news from the server
// A message from the admins, shown once, and whether the server is closed for the moment.
// ---------------------------------------------------------------- may this player play?
// The server decides, every half a minute and whenever a game ends. With no connection, what it said last stays.
let probe = null;
let standingTimer = 0;
export function setClimbProbe(f) { probe = f; }
// Friends. The server decides what comes back.
async function friendCall(path, body) {
  if (!account()) return { err: 'Please sign in' };
  const r = await call(path, body === undefined ? { auth: true, timeout: 8000 } : { auth: true, body, timeout: 8000 });
  return r.ok ? r.json : { err: (r.json && r.json.err) || 'Could not reach the game server.' };
}
export const friendList = () => friendCall('/api/friends');
export const friendSearch = (q) => friendCall('/api/friends/search', { q });
export const friendAct = (act, num) => friendCall('/api/friends/act', { act, num });
export const friendWatch = (allow) => friendCall('/api/friends/watch', { allow });

// The team reset this player's checkpoint (the resetcheckpoint command). Heard over the live socket or in the half minute
// check, and acted on once on each phone: the saved climbs started before it go, and a climb going on goes back to the start.
export function checkpointReset(at) {
  if (!account() || !Number.isFinite(at) || at <= 0) return;
  const key = 'cpReset.' + acct.user.id;
  if (at <= store.get(key, 0)) return;
  store.set(key, at);
  for (const k of ['save.solo', 'save.mp']) {
    const s = store.get(k, null);
    if (s && !(s.run && s.run.when > at)) store.del(k);
  }
  emit('cpReset', at);
}

export async function checkStanding() {
  if (!serverUrl()) return;
  const c = probe ? probe() : null;
  const r = await call('/api/standing', { auth: !!account(), body: { device: deviceId(), climb: c || undefined }, timeout: 8000 });
  if (r.status !== 200) return;
  setBan(r.json.ban || null);
  checkpointReset(r.json.cpReset);
  const list = Array.isArray(r.json.inbox) ? r.json.inbox.filter((m) => m && Number.isInteger(m.id) && typeof m.text === 'string') : [];
  if (!list.length) return;
  emit('inbox', list);
  if (account()) {
    call('/api/inbox/read', { auth: true, body: { ids: list.map((m) => m.id) } });
    refreshWallet();
  }
}
function watchStanding() {
  checkStanding();
  clearInterval(standingTimer);
  standingTimer = setInterval(checkStanding, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStanding(); });
}

export async function checkNews() {
  const info = await getInfo();
  if (!info) return;
  emit('maintenance', info.maintenance || '');
  // The day's climb, when the team picked it on the server (/daily); otherwise it goes by the date.
  emit('daily', Number.isInteger(info.daily) ? info.daily : -1);
  if (info.announce && info.announce.id !== store.get('news.seen', '')) {
    store.set('news.seen', info.announce.id);
    emit('announce', info.announce.text);
  }
}

// ---------------------------------------------------------------- leaving
function forget() {
  clearTimeout(reportTimer);
  reportTimer = 0;
  clearInterval(deviceTimer);
  lastGuard = '';
  climbs = [];
  climb = null;
  rec = null;
  store.del('wallet.climbs');
  if (timer) { clearTimeout(timer); timer = 0; }
  acct = null;
  needsTerms = false;
  lastSent = '';
  lastSync = 0;
  store.del('account');
}
// You go back to the guest you were before signing in, with nothing of the account left on the phone.
function backToGuest() {
  const g = store.get('guest', null);
  muted = true;
  restore(g && g.profile);
  store.set('best2', (g && g.best) || {});
  if (g && g.solo) store.set('save.solo', g.solo); else store.del('save.solo');
  store.del('guest');
  muted = false;
  const a = store.get('guestAcct', null);
  if (a && a.server === serverUrl()) {
    acct = a;
    store.set('account', acct);
    refreshWallet();
    watchDevice();
  }
  emit('changed');
}
// First make sure everything has reached the server, unless told to go anyway. That can't take forever: past this, the player
// gets asked. A banned player, or one with new terms to accept, can't send anything, so there's nothing to wait for.
const LEAVE_WAIT = 8000;
export async function signOut(force) {
  const me = account();
  if (!me) return true;
  const guest = isGuest();
  if (!force && !ban && !needsTerms) {
    const saved = (async () => {
      const sent = await report();
      return (guest || (await syncNow())) && sent;
    })().catch(() => false);
    const ok = await Promise.race([saved, new Promise((done) => setTimeout(done, LEAVE_WAIT, false))]);
    // The server may have ended the session meanwhile, and then this is already done.
    if (!ok) return acct !== me;
  }
  // A guest's session stays good on the server: Play as guest picks the same one up again, coins and all.
  if (guest) {
    forget();
    haveWallet({ coins: 0, earned: 0, own: [], relics: [], ach: [], role: '' });
    return true;
  }
  await call('/api/logout', { auth: true, method: 'POST', body: {}, timeout: 5000 });
  forget();
  backToGuest();
  return true;
}
// Someone who won't accept new terms just leaves. The account stays on the server. A guest stays too, and plays without coins.
export async function declineTerms() {
  if (!account()) return;
  if (isGuest()) { forget(); emit('changed'); return; }
  await call('/api/logout', { auth: true, method: 'POST', body: {}, timeout: 5000 });
  forget();
  backToGuest();
}
// The account and everything on the server go.
export async function deleteAccount() {
  if (!account()) return false;
  const r = await call('/api/me', { auth: true, method: 'DELETE' });
  if (!r.ok) return false;
  const wasGuest = isGuest();
  forget();
  if (wasGuest) store.del('guestAcct');
  backToGuest();
  return true;
}
