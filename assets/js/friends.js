// The Friends screen: your player ID, your friends and what they are doing, requests and search. Also opens watching a friend.
// Everything shown here comes from the game server, which decides what a friend may see (server/lib/friends.js).
import * as cloud from './cloud.js';
import * as live from './live.js';
import { Spectator } from './spectate.js';
import { MAPS, DIFFS } from './level.js';
import { css, COLORS } from './colors.js';
import { fmtTime, clamp } from './util.js';

const $ = (q) => document.querySelector(q);
let ctx = null, view = null, known = null, count = { on: 0, req: 0 }, leaveNow = null;

// ---------- the button on the main menu ----------
export const friendBadge = () => (count.req ? `<i class="frc req">${count.req}</i>` : '') + (count.on ? `<i class="frc on">${count.on}</i>` : '');

export function initFriends(c) {
  ctx = c;
  const shown = (m) => (m.name ? String(m.name).slice(0, 20) : `Player #${m.num | 0}`);
  live.on('count', (m) => {
    count = { on: Math.max(0, m.on | 0), req: Math.max(0, m.req | 0) };
    const el = $('#frCount');
    if (el) el.innerHTML = friendBadge();
    if (view && ctx.app.screen === 'friends') refresh(view);
  });
  live.on('req', (m) => ctx.ui.toast(`${shown(m)} wants to be your friend`, 'good'));
  live.on('friend', (m) => ctx.ui.toast(`${shown(m)} is now your friend`, 'good'));
}

// ---------- how someone is doing, in words ----------
const nameOf = (f) => (f.name ? `<span class="frname">${ctx.esc(f.name)}</span>` : `<span>Player #${f.num}</span>`);
const fallsText = (n) => (n === 1 ? '1 fall' : `${n} falls`);
function agoText(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Last seen just now';
  if (min < 60) return `Last seen ${min} min ago`;
  if (min < 2880) return `Last seen ${Math.floor(min / 60)} h ago`;
  return `Last seen ${Math.floor(min / 1440)} d ago`;
}
function status(f) {
  const map = MAPS[f.map] ? MAPS[f.map].name : '', diff = DIFFS[f.diff] ? DIFFS[f.diff].name : '';
  if (f.st === 'climb') {
    const word = f.won ? 'Reached the top!' : f.paused ? 'Paused' : 'Climbing';
    return { dot: 'climb', a: `${word} · ${map} · ${diff}`, b: `${f.h} m of ${f.top} m · ${fmtTime(f.T)} · ${fallsText(f.f)} · ${f.solo ? 'Solo' : `${f.n}/4 climbers`}`, pct: f.top ? clamp(f.h / f.top, 0, 1) * 100 : 0 };
  }
  if (f.st === 'lobby') return { dot: 'lobby', a: `In a lobby · ${map} · ${diff}`, b: `${f.n}/4 climbers` };
  if (f.st === 'watch') return { dot: 'on', a: 'Watching a friend' };
  if (f.st === 'menu') return { dot: 'on', a: 'In the menus' };
  return { dot: 'off', a: 'Offline', b: agoText(f.ago || 0) };
}
const ORDER = { climb: 0, lobby: 1, watch: 2, menu: 2, off: 3 };
const canJoin = (f) => !!f.room && f.n < 4;
const moreButtons = (f) => (f.canWatch ? `<button class="btn primary sm" data-a="watch" data-n="${f.num}">Watch</button>` : '') + (canJoin(f) ? `<button class="btn sm" data-a="join" data-n="${f.num}">Join</button>` : '');
const bar = (s) => (s.pct === undefined ? '' : `<span class="fbar"><i style="width:${s.pct.toFixed(1)}%"></i></span>`);
const textOf = (f, s) => `<b>${nameOf(f)}<em class="fnum">#${f.num}</em></b><small>${s.a}</small>${s.b ? `<small>${s.b}</small>` : ''}${bar(s)}`;

function friendRow(f) {
  const s = status(f);
  return `<div class="frow"><button class="item fritem" data-a="open" data-n="${f.num}"><i class="fdot ${s.dot}" data-u></i><span class="ftext" data-u>${textOf(f, s)}</span></button>${moreButtons(f)}</div>`;
}
const stat = (v, k) => `<div><b>${v}</b><small>${k}</small></div>`;
function friendCard(f) {
  const s = status(f);
  return `<div class="fcard">
    <div class="fchead"><i class="fdot ${s.dot}" data-u></i><span class="ftext" data-u>${textOf(f, s)}</span></div>
    <div class="fstats" data-u>${f.st === 'climb' ? stat(`${f.h} m`, 'Height') + stat(fmtTime(f.T), 'Time') + stat(f.f, 'Falls') + stat(f.n, 'Climbers') : ''}${stat(f.climbs, 'Climbs')}${stat(f.wins, 'Reached the top')}</div>
    <div class="fbtns">${moreButtons(f)}<button class="btn sm" data-a="closecard">All friends</button><button class="btn sm" data-a="remove" data-n="${f.num}">Remove friend</button></div>
  </div>`;
}

// New text for a part of the screen. While the same buttons stay, only the words change, so a controller keeps its place.
function setHtml(el, html) {
  const t = document.createElement('div');
  t.innerHTML = html;
  const keyOf = (r) => [...r.querySelectorAll('[data-a]')].map((b) => b.dataset.a + (b.dataset.n || '')).join();
  const from = el.querySelectorAll('[data-u]'), to = t.querySelectorAll('[data-u]');
  if (!el.children.length || keyOf(t) !== keyOf(el) || from.length !== to.length) { el.innerHTML = html; return; }
  from.forEach((n, i) => {
    if (n.className !== to[i].className) n.className = to[i].className;
    if (n.dataset.src !== to[i].innerHTML) { n.dataset.src = to[i].innerHTML; n.innerHTML = to[i].innerHTML; }
  });
}

// ---------- the screen ----------
function paint(v) {
  if (view !== v) return;
  const d = v.data, main = $('#fmain');
  if (!main) return;
  const me = d && d.me;
  if (me) {
    const idEl = $('#frId'), nm = $('#frMe'), pv = $('#frWatch');
    if (idEl) idEl.textContent = `#${me.num}`;
    if (nm) nm.textContent = me.name || '';
    if (pv && !v.touchedPrivacy) pv.checked = me.watch;
  }
  const friends = d ? d.friends : [], asks = d ? d.asks : [], asked = d ? d.asked : [];
  const on = friends.filter((f) => f.st !== 'off').length;
  const a = $('#ftList'), b = $('#ftAsks');
  if (a) a.textContent = friends.length ? `${on}/${friends.length}` : '';
  if (b) { b.textContent = asks.length || ''; b.classList.toggle('hot', asks.length > 0); }
  for (const t of document.querySelectorAll('.ftabs button')) t.classList.toggle('on', t.dataset.t === v.tab);
  if (v.tab === 'find') return;
  if (!d) {
    setHtml(main, v.failed ? '<div class="empty">Could not reach the game server.</div>' : '<div class="empty"><span class="spin"></span></div>');
    return;
  }
  if (v.tab === 'asks') {
    const rows = asks.map((f) => `<div class="frow"><div class="item fritem"><i class="fdot lobby"></i><span class="ftext"><b>${nameOf(f)}<em class="fnum">#${f.num}</em></b><small>Wants to be your friend</small></span></div><button class="btn primary sm" data-a="accept" data-n="${f.num}">Accept</button><button class="btn sm" data-a="decline" data-n="${f.num}">Decline</button></div>`)
      .concat(asked.map((f) => `<div class="frow"><div class="item fritem"><i class="fdot off"></i><span class="ftext"><b>${nameOf(f)}<em class="fnum">#${f.num}</em></b><small>Waiting for an answer</small></span></div><button class="btn sm" data-a="cancel" data-n="${f.num}">Cancel</button></div>`));
    setHtml(main, rows.length ? `<div class="list">${rows.join('')}</div>` : '<div class="empty">No requests right now.</div>');
    return;
  }
  const open = v.card !== null ? friends.find((f) => f.num === v.card) : null;
  if (open) { setHtml(main, friendCard(open)); return; }
  v.card = null;
  const sorted = [...friends].sort((x, y) => ORDER[x.st] - ORDER[y.st] || (y.h || 0) - (x.h || 0) || String(x.name).localeCompare(String(y.name)));
  setHtml(main, sorted.length ? `<div class="list">${sorted.map(friendRow).join('')}</div>` : '<div class="empty">No friends yet. Tap Find players, or share your ID so friends can add you.</div>');
}

async function refresh(v) {
  const d = await cloud.friendList();
  if (view !== v) return;
  if (d.err) v.failed = true;
  else { v.data = known = d; v.failed = false; }
  paint(v);
}

function findTab(v) {
  v.tab = 'find';
  $('#fmain').innerHTML = `<p class="sub">Search by name or player ID.</p>
    <div class="field"><input id="fq" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Name or #1042"><button class="btn primary sm" data-a="search">Search</button></div>
    <div class="list" id="ffound"></div>`;
  const q = $('#fq');
  q.value = v.query || '';
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(v); } });
  if (v.found) showFound(v);
  paint(v);
}

function showFound(v) {
  const el = $('#ffound');
  if (!el) return;
  if (!v.found.length) { el.innerHTML = '<div class="empty">Nobody found. Check the spelling or ask for their player ID.</div>'; return; }
  const right = (f) => (f.rel === 'me' ? '<span class="ftag">You</span>' : f.rel === 'friend' ? '<span class="ftag good">Friend</span>' : f.rel === 'asked' ? '<span class="ftag">Asked</span>'
    : f.rel === 'asks' ? `<button class="btn primary sm" data-a="accept" data-n="${f.num}">Accept</button>` : `<button class="btn primary sm" data-a="add" data-n="${f.num}">Add</button>`);
  el.innerHTML = v.found.map((f) => `<div class="frow"><div class="item fritem"><span class="ftext"><b>${nameOf(f)}<em class="fnum">#${f.num}</em></b></span></div>${right(f)}</div>`).join('');
}

async function search(v) {
  const q = $('#fq');
  if (!q) return;
  const text = q.value.trim();
  v.query = text;
  if (text.length < 2 && !/\d/.test(text)) return ctx.ui.toast('Type at least 2 letters, or a player ID', 'bad');
  const el = $('#ffound');
  if (el) el.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  const r = await cloud.friendSearch(text);
  if (view !== v || v.tab !== 'find') return;
  if (r.err) { if (el) el.innerHTML = ''; return ctx.ui.toast(r.err, 'bad'); }
  v.found = Array.isArray(r.found) ? r.found : [];
  showFound(v);
}

async function act(v, what, num, said) {
  const r = await cloud.friendAct(what, num);
  if (r.err) ctx.ui.toast(r.err, 'bad');
  else if (said) ctx.ui.toast(said, 'good');
  if (view !== v) return;
  if (v.tab === 'find' && v.query) search(v);
  refresh(v);
}

export function openFriends(back, tab = 'list') {
  const { app, show, header, ui } = ctx;
  if (cloud.banned()) return back();
  app.screen = 'friends';
  if (!cloud.account()) {
    view = null;
    show(`<div class="panel" style="width:min(460px,100%)">${header('Friends')}
      <p class="sub">Friends live on the game server, so you need an account first. A guest account is fine.</p>
      <button class="btn primary sm" data-a="acct">Account</button></div>`, { back, acct: () => ctx.account(() => openFriends(back)) });
    return;
  }
  const v = view = { tab, card: null, data: known, failed: false, back, query: '', found: null };
  const me = known && known.me;
  show(`<div class="panel frpanel">${header('Friends')}
    <div class="friends">
      <div class="fside">
        <div class="fid"><small>Your player ID</small><b id="frId">${me ? `#${me.num}` : '#...'}</b><span id="frMe" class="frname"></span>${ctx.canShare() ? '<button class="btn sm" data-a="share">Share my ID</button>' : ''}</div>
        <div class="ftabs">
          <button data-a="tab" data-t="list"><span>Friends</span><i id="ftList"></i></button>
          <button data-a="tab" data-t="asks"><span>Requests</span><i id="ftAsks"></i></button>
          <button data-a="tab" data-t="find"><span>Find players</span></button>
        </div>
        <label class="toggle"><input type="checkbox" id="frWatch" data-a="privacy" checked> Let friends watch my climbs</label>
      </div>
      <div class="fmain" id="fmain"></div>
    </div></div>`, {
    back: () => { view = null; back(); },
    share: () => { if (v.data && v.data.me) ctx.share(`Add me on StickManUp! My player ID is #${v.data.me.num}`); },
    tab: (b) => {
      v.card = null;
      if (b.dataset.t === 'find') return findTab(v);
      v.tab = b.dataset.t;
      $('#fmain').innerHTML = '';
      paint(v);
    },
    open: (b) => { v.card = +b.dataset.n; $('#fmain').innerHTML = ''; paint(v); },
    closecard: () => { v.card = null; $('#fmain').innerHTML = ''; paint(v); },
    watch: (b) => watchFriend(+b.dataset.n, back),
    join: (b) => joinFriend(+b.dataset.n, back),
    search: () => search(v),
    add: (b) => act(v, 'add', +b.dataset.n, 'Friend request sent'),
    accept: (b) => act(v, 'accept', +b.dataset.n, 'You are friends now'),
    decline: (b) => act(v, 'decline', +b.dataset.n),
    cancel: (b) => act(v, 'cancel', +b.dataset.n),
    remove: (b) => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to remove'; b.classList.add('danger'); return; }
      v.card = null;
      $('#fmain').innerHTML = '';
      act(v, 'remove', +b.dataset.n, 'Friend removed');
    },
    privacy: async (b) => {
      v.touchedPrivacy = true;
      const r = await cloud.friendWatch(b.checked);
      if (r.err) { ui.toast(r.err, 'bad'); b.checked = !b.checked; }
      v.touchedPrivacy = false;
      if (view === v) refresh(v);
    },
  });
  if (tab === 'find') findTab(v);
  else paint(v);
  refresh(v);
  const t = setInterval(() => { if (view !== v || app.screen !== 'friends') clearInterval(t); else refresh(v); }, 5000);
}

// ---------- joining a friend's room ----------
function joinRoom(room, back, after) {
  const { app, joinWith, roomPassword } = ctx, here = after || (() => openFriends(back));
  app.joinBack = here;
  if (room.kind === 'online') joinWith('online', room.code);
  else if (room.locked) roomPassword(room.code, here);
  else joinWith('server', { code: room.code, pass: '' });
}
function joinFriend(num, back) {
  const f = known && known.friends.find((x) => x.num === num);
  if (f && f.room) joinRoom(f.room, back);
}

// ---------- watching ----------
const setText = (el, text) => { if (el && el.dataset.v !== text) { el.dataset.v = text; el.textContent = text; } };

function specScreen(spec, f, leave, back) {
  const { app, show, esc } = ctx, L = app.level, top = L.top;
  const track = L.zones.map((z) => `<i style="bottom:${(z.y0 / top) * 100}%;height:${((z.y1 - z.y0) / top) * 100}%;background:#${z.color.toString(16).padStart(6, '0')}"></i>`).join('');
  show(`<div class="specui">
    <div class="sptop">
      <div class="spwho"><small><i class="spdot"></i><span>Watching</span></small><b id="spName" class="frname">${esc(f ? f.name : '')}</b><span id="spMap"></span></div>
      <div class="sptime" id="spTime">0:00</div>
      <button class="btn sm spleave" data-a="back">Leave</button>
    </div>
    <div class="spalt"><div class="track">${track}</div><div class="marks" id="spMarks"></div></div>
    <div class="spnote" id="spNote"></div>
    <div class="spbot">
      <div class="spstats"><div><b id="spH">0 m</b><small>Height</small></div><div><b id="spTop">0 m</b><small>Top</small></div><div><b id="spF">0</b><small>Falls</small></div></div>
      <div class="spteam" id="spTeam"></div>
      ${f && canJoin(f) ? '<button class="btn primary sm spjoin" data-a="join">Join</button>' : ''}
      ${ctx.team && ctx.team() ? '<button class="btn sm spterm" data-a="term">Terminal</button>' : ''}
    </div>
  </div>`, {
    back: () => leave(),
    follow: (b) => spec.follow(+b.dataset.s),
    term: () => ctx.openTerminal && ctx.openTerminal(),
    join: () => leave(null, () => joinRoom(f.room, back)),
  }, false);
  $('#menu').classList.add('specm');
  app.screen = 'spec';
  showTeam(spec);
}

function showTeam(s) {
  const el = $('#spTeam'), m = $('#spMarks');
  if (!el || !m) return;
  const list = [...s.players.values()];
  const key = list.map((p) => [p.slot, p.name, p.color].join()).join('|') + '/' + s.focus;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = list.length > 1 ? list.map((p) => `<button class="spchip${p.slot === s.focus ? ' on' : ''}" data-a="follow" data-s="${p.slot}" style="color:${css(p.color ?? COLORS[p.slot])}"><i></i><span class="frname">${ctx.esc(p.name)}</span></button>`).join('') : '';
  m.innerHTML = list.map((p) => `<i data-s="${p.slot}" style="color:${css(p.color ?? COLORS[p.slot])}"></i>`).join('');
}

function showInfo(i) {
  setText($('#spName'), i.name);
  setText($('#spMap'), `${i.map} · ${i.diff}`);
  setText($('#spTime'), fmtTime(i.T));
  setText($('#spH'), `${i.h} m`);
  setText($('#spTop'), `${i.top} m`);
  setText($('#spF'), String(i.falls));
  setText($('#spNote'), i.won ? 'Reached the top!' : i.held ? 'Paused' : '');
  for (const [s, pct] of i.marks) {
    const e = document.querySelector(`#spMarks i[data-s="${s}"]`);
    if (e) e.style.bottom = pct.toFixed(1) + '%';
  }
}

// The team can watch anyone (the server decides who may): f is what is known about them, and back where to go after.
export function watchPlayer(num, f, back) { watchFriend(num, back, f || { num, name: `#${num}` }, back); }
export function joinPlayerRoom(code, back) { joinRoom({ kind: 'server', code, locked: false }, back, back); }

function watchFriend(num, back, who, after) {
  const { app, ui, busy, settings, N } = ctx, f = who || (known && known.friends.find((x) => x.num === num));
  const toList = after || (() => openFriends(back));
  let spec = null, done = false;
  // Everything that ends watching comes through here, once.
  const leave = (said, then) => {
    if (done) return;
    done = true;
    leaveNow = null;
    clearTimeout(timer);
    live.unwatch();
    if (spec) {
      spec.destroy();
      app.spec = null;
      if (N && N.keepAwake) N.keepAwake(false);
      ctx.loadMap(settings.map);
    }
    if (said) ui.toast(said, 'bad');
    (then || toList)();
  };
  view = null;
  app.screen = 'specwait';
  busy('Connecting...', () => leave());
  const timer = setTimeout(() => { if (!spec) leave('This friend needs the newest version of the game to be watched.'); }, 12000);
  leaveNow = leave;
  const sent = live.watch(num, {
    ok: () => {},
    game: (g) => {
      if (done) return;
      clearTimeout(timer);
      const first = !spec;
      if (first) {
        spec = new Spectator(app, { loadMap: ctx.loadMap, team: showTeam, info: showInfo });
        if (N && N.keepAwake) N.keepAwake(true);
      }
      spec.setGame(g);
      // Nobody in it: nothing to show yet.
      if (!spec.ready) return;
      if (first || !app.spec) {
        app.spec = spec;
        specScreen(spec, f, leave, back);
      } else if (spec.shownMap !== spec.map) specScreen(spec, f, leave, back);
      spec.shownMap = spec.map;
    },
    state: (m) => { if (spec && !done) spec.state(m); },
    over: (why) => leave(why === 'closed' ? 'This friend no longer allows watching.' : why === 'lost' ? 'Lost the connection to the game server.' : 'The climb you were watching has ended.'),
    err: (why) => leave(why || 'Could not reach the game server.'),
  });
  if (!sent) leave('Could not reach the game server.');
}

// Out of watching without going anywhere: the caller decides what comes next (being banned, for one).
export function endSpectate() {
  if (leaveNow) leaveNow(null, () => {});
}
