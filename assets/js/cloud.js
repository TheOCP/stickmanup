// Talking to a StickManUp server: the room list, signing in, and keeping your progress on your account.
// Everything still works without a server or an account. Guests just keep their progress on this phone.
//
// Signing in happens in the phone's browser, never in the game. The browser comes back to the app with a one time code,
// and only this copy of the game can use it, because only it knows the secret it started with (see server/lib/auth.js).
import { store } from './util.js';
import { flushProfile, mergeRecords, recordsOf, setRecords, setWallet, snapshot, restore, cleanRun, buy as guestBuy } from './profile.js';
import { DIFFS } from './level.js';
import { itemKey } from './skins.js';

// The server this build of the game uses unless Settings says otherwise.
export const DEFAULT_SERVER = '';
const N = window.Native;
const PUSH_AFTER = 30000;
const REPORT_AFTER = 12000;
const RUN_MAX_AGE = 24 * 3600000;
const PENDING_MAX = 15 * 60000;

let address = '';
let acct = store.get('account', null);
let needsTerms = false;
let muted = false;
let timer = 0;
let lastSent = '';
let lastSync = 0;
let busy = null;
const hooks = {};
export const on = (k, f) => { hooks[k] = f; };
const emit = (k, ...a) => { if (hooks[k]) hooks[k](...a); };

// What someone typed into a clean address. Empty for none, null if it can't be used. Only encrypted addresses,
// because room passwords and sign ins pass through it, and Android refuses anything else anyway.
export function cleanAddress(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t;
  let u;
  try { u = new URL(t); } catch (e) { return null; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) || u.username || u.password) return null;
  return u.origin;
}
export function setAddress(text) {
  const a = cleanAddress(text);
  if (a === null) return false;
  address = a;
  return true;
}
export const serverUrl = () => address || DEFAULT_SERVER;
export const wsUrl = () => serverUrl().replace(/^http/, 'ws') + '/ws';

// The account only counts on the server it belongs to.
export const account = () => (acct && acct.server === serverUrl() ? acct : null);
export const termsNeeded = () => !!account() && needsTerms;
export const lastSaved = () => lastSync;

async function call(path, o = {}) {
  const headers = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.auth) headers.Authorization = 'Bearer ' + acct.token;
  let r;
  try {
    r = await fetch(serverUrl() + path, { method: o.method || (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, keepalive: !!o.keepalive, signal: AbortSignal.timeout(o.timeout || 12000) });
  } catch (e) {
    return { ok: false, status: 0, json: {} };
  }
  let json = {};
  try { json = await r.json(); } catch (e) {}
  // The session is over. What the account has stays on the server until the next sign in.
  if (r.status === 401 && o.auth && acct) {
    forget();
    backToGuest();
    emit('expired');
  }
  return { ok: r.ok, status: r.status, json };
}

export async function getInfo() {
  if (!serverUrl()) return null;
  const r = await call('/api/info', { timeout: 8000 });
  return r.ok && r.json && typeof r.json.terms === 'string' ? r.json : null;
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
  else window.open(url, '_blank');
}
export const cancelLogin = () => store.del('auth.pending');

// The browser came back with a code. Without a sign in we started ourselves, it means nothing.
export async function finishLogin(code) {
  const p = store.get('auth.pending', null);
  store.del('auth.pending');
  if (!p || Date.now() - p.t > PENDING_MAX || p.server !== serverUrl()) return false;
  const r = await call('/auth/exchange', { body: { code: String(code), verifier: p.verifier } });
  if (!r.ok || typeof r.json.token !== 'string') {
    emit('loginFailed', r.json.err || (r.status ? 'Sign in failed. Please try again.' : 'Could not reach the server.'));
    return false;
  }
  acct = { server: p.server, token: r.json.token, user: r.json.user, rev: 0 };
  needsTerms = !r.json.user.tosOk;
  store.set('account', acct);
  // Remember the guest, to go back to when signing out.
  flushProfile();
  store.set('guest', { profile: snapshot(), best: store.get('best2', {}), solo: store.get('save.solo', null) });
  await refreshWallet();
  await syncNow();
  emit('signedIn', acct.user);
  return true;
}
window.SMU_authCode = (code) => { finishLogin(code); };

// Ask again if the terms changed. Called at startup.
export async function start() {
  store.watch = (k) => { if (!muted && (k === 'profile' || k === 'best2' || k === 'save.solo')) soon(); };
  if (N && N.authPending) {
    const c = N.authPending();
    if (c) await finishLogin(c);
  }
  if (!account()) return;
  const r = await call('/api/me', { auth: true });
  if (r.ok && r.json.user) {
    acct.user = r.json.user;
    store.set('account', acct);
    needsTerms = !r.json.user.tosOk;
    if (needsTerms) emit('terms');
    else {
      await refreshWallet();
      report();
      syncNow();
    }
  }
}

export async function acceptTerms(version) {
  const r = await call('/api/tos', { auth: true, body: { version } });
  if (!r.ok) return false;
  needsTerms = false;
  acct.user = r.json.user;
  store.set('account', acct);
  await refreshWallet();
  syncNow();
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
  a = Object.assign({}, a, { solo: cleanSolo(a.solo) });
  b = Object.assign({}, b, { solo: cleanSolo(b.solo) });
  const h = (s) => (s && s.pos ? s.pos[1] : -1);
  return { v: 1, profile: mergeRecords(a.profile || {}, b.profile || {}), best, solo: h(a.solo) >= h(b.solo) ? a.solo || null : b.solo || null };
}

function soon() {
  if (!account() || needsTerms || timer) return;
  timer = setTimeout(() => { timer = 0; push(); }, PUSH_AFTER);
}

// Send what is here, over the version last seen. If another phone got there first, merge the two and go again.
async function send(data, keepalive) {
  for (let k = 0; k < 3; k++) {
    const text = JSON.stringify(data);
    if (text === lastSent) return true;
    if (text.length > 480 * 1024) return false;
    const r = await call('/api/save', { auth: true, method: 'PUT', body: { rev: acct.rev, data }, keepalive: keepalive && text.length < 60000 });
    if (r.ok) {
      acct.rev = r.json.rev;
      store.set('account', acct);
      lastSent = text;
      lastSync = Date.now();
      return true;
    }
    if (r.status !== 409 || !acct) return false;
    acct.rev = r.json.rev;
    data = r.json.data ? mergeData(data, r.json.data) : data;
    applyData(data);
  }
  return false;
}
async function push(keepalive) {
  if (!account() || needsTerms) return false;
  if (busy) await busy;
  if (!account()) return false;
  return send(localData(), keepalive);
}
// Going to the background or finishing a climb: don't wait.
export function flush() {
  if (timer) { clearTimeout(timer); timer = 0; }
  saveClimbs();
  report();
  return push(true);
}

// Fetch what the account has, put the two together here and there. This is how progress reaches a new phone.
export function syncNow() {
  if (busy) return busy;
  busy = (async () => {
    if (!account() || needsTerms) return false;
    const g = await call('/api/save', { auth: true });
    if (!g.ok || !acct) return false;
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

// ---------------------------------------------------------------- the coins of an account
// The server holds them. This phone shows a copy, plus what it has earned that the server hasn't heard about yet.
// Climbs are reported as they go. If the connection drops they wait here, and the server decides what still counts.
let climbs = store.get('wallet.climbs', []);
// Nothing is being climbed yet when the game starts: what is listed here is left over from last time.
for (const c of climbs) c.live = false;
let climb = null;
let reportTimer = 0;
let reporting = null;
let again = false;
const saveClimbs = () => store.set('wallet.climbs', climbs);
const waiting = () => climbs.reduce((n, c) => n + c.coins.length * ((DIFFS[c.diff] && DIFFS[c.diff].coin) || 0), 0);

function haveWallet(w) {
  if (!w || typeof w.coins !== 'number') return false;
  muted = true;
  setWallet(w, waiting());
  muted = false;
  emit('changed');
  return true;
}
// The first time on an account, what you had as a guest comes along, as far as the server allows.
export async function refreshWallet() {
  if (!account()) return false;
  const r = await call('/api/wallet', { auth: true });
  if (!r.ok || !account()) return false;
  if (r.json.imported) return haveWallet(r.json);
  // Someone already signed in from before the server held the coins has no guest kept aside: what is here is theirs.
  const g = store.get('guest', null), p = (g && g.profile) || snapshot();
  const i = await call('/api/wallet/import', { auth: true, body: { coins: p.coins, own: p.own } });
  return haveWallet(i.json.wallet);
}

// Buying is the server's call when signed in, so it needs a connection. Answers what went wrong, or nothing.
export async function buyItem(item) {
  if (!account()) return guestBuy(item) ? null : 'Not enough coins.';
  const r = await call('/api/buy', { auth: true, body: { id: itemKey(item) } });
  if (r.json.wallet) haveWallet(r.json.wallet);
  if (r.ok) return null;
  if (r.status === 0) return 'You need a connection to buy things on your account.';
  return r.json.err || 'That did not work. Please try again.';
}

export const runId = () => (climb ? climb.run : null);
export function runStart(o) {
  if (climb) climb.live = false;
  climb = null;
  if (!account() || needsTerms) return;
  climb = { run: typeof o.run === 'string' ? o.run : null, map: o.map, diff: o.diff, custom: !!o.custom, coins: [], relics: [], win: null, t: Date.now(), live: true };
  climbs.push(climb);
  while (climbs.length > 8) climbs.shift();
  saveClimbs();
  report();
}
export function runCoin(i) {
  if (!climb) return;
  climb.coins.push(i);
  reportSoon();
}
export function runRelic(id) {
  if (!climb) return;
  climb.relics.push(id);
  report();
}
export function runWin(falls) {
  if (!climb) return;
  climb.win = { falls: Number.isFinite(falls) ? falls : 1 };
  report();
}
export function runEnd() {
  if (climb) climb.live = false;
  climb = null;
  saveClimbs();
  return report();
}

function reportSoon() {
  if (!reportTimer) reportTimer = setTimeout(() => { reportTimer = 0; report(); }, REPORT_AFTER);
}
// One at a time, and anything that turned up meanwhile goes straight after. Coins the server says are too quick to count
// yet stay here and go again in a moment.
export function report() {
  if (reporting) { again = true; return reporting; }
  if (!account() || needsTerms || !climbs.length) return Promise.resolve(true);
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
async function sendClimbs() {
  let ok = true, wallet = null;
  for (const c of [...climbs]) {
    if (!account()) return false;
    if (!c.live && Date.now() - c.t > RUN_MAX_AGE) { climbs.splice(climbs.indexOf(c), 1); continue; }
    if (!c.run) {
      const s = await call('/api/run/start', { auth: true, body: { map: c.map, diff: c.diff, custom: c.custom } });
      if (!s.ok || !s.json.run) { ok = false; break; }
      c.run = s.json.run;
    }
    if (c.coins.length || c.relics.length || c.win) {
      const sent = { coins: [...c.coins], relics: [...c.relics], win: c.win };
      const r = await call('/api/run/report', { auth: true, body: { run: c.run, ...sent } });
      // The server no longer knows this climb, an old save perhaps. What it found goes under a new one next time.
      if (r.status === 404) { c.run = null; ok = false; continue; }
      if (!r.ok) { ok = false; break; }
      const done = new Set(r.json.accepted || []);
      c.coins = c.coins.filter((i) => !done.has(i));
      c.relics = c.relics.filter((x) => !sent.relics.includes(x));
      if (sent.win) {
        c.win = null;
        if (r.json.win === 'too fast' || r.json.win === 'too many') emit('winRefused');
      }
      if (r.json.capped) emit('dayLimit');
      if (r.json.wallet) wallet = r.json.wallet;
    }
    if (!c.live && !c.coins.length && !c.relics.length && !c.win) climbs.splice(climbs.indexOf(c), 1);
  }
  saveClimbs();
  if (wallet) haveWallet(wallet);
  if (climbs.some((c) => c.coins.length || c.relics.length || c.win)) reportSoon();
  return ok;
}

// ---------------------------------------------------------------- leaving
function forget() {
  clearTimeout(reportTimer);
  reportTimer = 0;
  climbs = [];
  climb = null;
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
  emit('changed');
}
// First make sure everything has reached the server, unless told to go anyway.
export async function signOut(force) {
  if (!account()) return true;
  if (!force) {
    const sent = await report();
    if (!(await syncNow()) || !sent) return false;
  }
  await call('/api/logout', { auth: true, method: 'POST', body: {} });
  forget();
  backToGuest();
  return true;
}
// Someone who won't accept new terms just leaves. The account stays on the server.
export async function declineTerms() {
  if (!account()) return;
  await call('/api/logout', { auth: true, method: 'POST', body: {}, timeout: 5000 });
  forget();
  backToGuest();
}
// The account and everything on the server go.
export async function deleteAccount() {
  if (!account()) return false;
  const r = await call('/api/me', { auth: true, method: 'DELETE' });
  if (!r.ok) return false;
  forget();
  backToGuest();
  return true;
}
