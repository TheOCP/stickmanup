// One socket to the game server while the game is open. It says what this phone is up to, so friends can see it, and carries
// the climb to anyone watching. Coins and records have nothing to do with it: the game plays exactly the same without it.
import * as cloud from './cloud.js';
import { feedGame, feedState } from './spectate.js';
import { setRoleTable } from './skins.js';

const SEND_EVERY = 1 / 12, TELL_CLIMB = 5000, TELL_MENU = 15000;
const heard = new Map();
export const on = (k, f) => { if (!heard.has(k)) heard.set(k, []); heard.get(k).push(f); };
const emit = (k, v) => { for (const f of heard.get(k) || []) f(v); };

let o = null, ws = null, isReady = false, usedToken = '', retry = 0, retryT = null, replaced = false, noAccount = false;
let watching = null, watchers = 0, tellAcc = 0, lastState = '', lastTold = 0, feedAcc = 0, gameAcc = 0, gameKey = '';
// What this player may do as one of the team (null for everyone else), and the terminal's answers waiting for their line.
let team = null, cmdId = 0;
export const staff = () => team;

export const ready = () => isReady;
const sendObj = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

function later() {
  clearTimeout(retryT);
  retry = Math.min(retry + 1, 6);
  retryT = setTimeout(connect, Math.min(60000, 2500 * 2 ** retry));
}

function connect() {
  clearTimeout(retryT);
  if (ws || !o || document.hidden || replaced) return;
  const token = cloud.roomToken();
  // Nothing to ask with yet. tick() notices when there is.
  if (!token || cloud.banned() || !cloud.serverUrl()) { noAccount = true; return; }
  noAccount = false;
  let s;
  try { s = new WebSocket(cloud.wsUrl().replace(/\/ws$/, '/live')); } catch (e) { return later(); }
  ws = s;
  usedToken = token;
  s.onopen = () => s.send(JSON.stringify({ t: 'hi', token, name: o.name() }));
  s.onmessage = (e) => { if (ws === s) heardFrom(e.data); };
  s.onerror = () => {};
  s.onclose = () => {
    if (ws !== s) return;
    ws = null;
    isReady = false;
    watchers = 0;
    const w = watching;
    watching = null;
    if (w) w.over('lost');
    emit('watchers', { n: 0, names: [] });
    team = null;
    emit('staff', null);
    later();
  };
}

function heardFrom(text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  const w = watching;
  switch (m.t) {
    case 'ok':
      isReady = true; retry = 0; lastState = '';
      if (m.roles) setRoleTable(m.roles);
      team = m.staff && typeof m.staff === 'object' ? m.staff : null;
      emit('staff', team);
      emit('ready', m);
      break;
    case 'staff': team = m.staff && typeof m.staff === 'object' ? m.staff : null; emit('staff', team); break;
    case 'roles': if (m.roles) { setRoleTable(m.roles); emit('roles', m.roles); } break;
    case 'out': emit('out', m); break;
    case 'act': emit('act', m); break;
    case 'list': emit('list', m); break;
    case 's': if (w) w.state(m); break;
    case 'g': if (w) w.game(m); break;
    case 'watching': if (w) w.ok(m); break;
    case 'over': watching = null; if (w) w.over(m.why); break;
    case 'err': watching = null; if (w) w.err(String(m.why || '')); break;
    // Whoever just came along needs the whole picture, not only the next small update. Someone of the team can be watching
    // without being shown (any counts them, n doesn't).
    case 'watchers': watchers = Math.max(0, (m.any ?? m.n) | 0); gameKey = ''; emit('watchers', m); break;
    case 'count': emit('count', m); break;
    case 'req': emit('req', m); break;
    case 'friend': emit('friend', m); break;
    // Another phone is playing on this account: it keeps the socket, until this one is opened again.
    case 'replaced': replaced = true; break;
    // Banned, or the server is closed for now. The game finds out why from the server's own answer.
    case 'off': emit('off', m); break;
    default: break;
  }
}

export function startLive(opts) {
  o = opts;
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ws) ws.close(); return; }
    replaced = false;
    retry = 0;
    connect();
  });
}

export function watch(num, cb) {
  if (!isReady) return false;
  watching = cb;
  sendObj({ t: 'watch', num });
  return true;
}

// A line typed in the terminal. The answer comes back as 'out' with the same id.
export function command(line) {
  if (!isReady || !ws) return 0;
  sendObj({ t: 'cmd', id: ++cmdId, line: String(line).slice(0, 1500) });
  return cmdId;
}
// Everyone in the game now, for the team. Comes back as 'list'.
export function askList() { if (isReady) sendObj({ t: 'list' }); }

export function unwatch() {
  if (!watching) return;
  watching = null;
  sendObj({ t: 'unwatch' });
}

// Called every frame. Nothing in here may ever stop the game from drawing.
export function tick(dt) {
  if (!o) return;
  tellAcc += dt;
  if (tellAcc >= 1) {
    tellAcc = 0;
    // Signed in, out, or as somebody else since the socket opened.
    if (ws && usedToken !== cloud.roomToken()) ws.close();
    else if (!ws && noAccount && cloud.roomToken() && !cloud.banned()) connect();
    if (isReady) tell();
  }
  if (!isReady || watchers < 1) return;
  try {
    const g = o.climb();
    if (!g) return;
    gameAcc -= dt;
    if (gameAcc <= 0 || !gameKey) {
      gameAcc = 0.5;
      const text = JSON.stringify(feedGame(g));
      if (text !== gameKey) { gameKey = text; ws.send(text); }
    }
    feedAcc += dt;
    if (feedAcc >= SEND_EVERY) {
      feedAcc = 0;
      ws.send(JSON.stringify(feedState(g, o.paused())));
    }
  } catch (e) { /* the next frame tries again */ }
}

function tell() {
  const p = o.presence(), now = performance.now(), wait = p.st === 'menu' ? TELL_MENU : TELL_CLIMB;
  if (p.st === lastState && now - lastTold < wait) return;
  lastState = p.st;
  lastTold = now;
  sendObj(Object.assign({ t: 'p', name: o.name() }, p));
}
