// The terminal, for the team. Commands typed here run on the game server, the same ones the Discord bot takes, and the server
// decides what each player may use (server/lib/staff.js). The second tab lists everyone in the game right now, with what
// they are doing, and buttons to watch them, join their room or see more. Nobody else ever sees any of this.
import * as live from './live.js';
import { roleInfo, roleKeys } from './skins.js';
import { MAPS, DIFFS } from './level.js';
import { tr } from './i18n.js';

let o = null, el = null, open = false, tab = 'cmd', hist = [], hi = -1, list = [], listErr = '', listT = null, sugs = [];
const MAX_LINES = 300;
const isText = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const q = (s) => el.querySelector(s);

export const isOpen = () => open;
// What the list last said about a player, by number.
export const seen = (num) => list.find((p) => p.num === num) || null;

export function initTerminal(opts) {
  o = opts;
  live.on('out', (m) => say(m.text, m.color));
  live.on('act', (m) => o.act(m));
  live.on('list', (m) => {
    list = Array.isArray(m.players) ? m.players : [];
    listErr = m.err ? String(m.err) : '';
    if (open && tab === 'players') paintList();
  });
  live.on('staff', (s) => {
    if (!s && open) close();
    if (el) badge();
    if (o.staffChanged) o.staffChanged(s);
  });
  // ` on a keyboard opens and closes it, anywhere. Esc closes it before anything else hears it.
  window.addEventListener('keydown', (e) => {
    if ((e.code === 'Backquote' || e.code === 'F2') && live.staff() && !(isText(e.target) && e.target !== inputEl())) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    } else if (open && e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }, true);
}

const inputEl = () => (el ? q('.termin input') : null);

function build() {
  el = document.createElement('div');
  el.id = 'term';
  el.innerHTML = `<div class="termbox">
    <div class="termhead">
      <b>Terminal</b><em class="termvan">VANISHED</em>
      <div class="termtabs"><button data-t="cmd" class="on">Commands</button><button data-t="players">Players online</button></div>
      <button class="btn sm termx" data-x>Close</button>
    </div>
    <div class="termout"></div>
    <div class="termlist"></div>
    <div class="termsug"></div>
    <form class="termin"><span>/</span><input type="text" enterkeyhint="send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type a command, like help"><button class="btn sm primary" type="submit">Send</button></form>
  </div>`;
  document.body.appendChild(el);
  const input = inputEl();
  q('.termin').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  q('[data-x]').addEventListener('click', close);
  for (const b of el.querySelectorAll('.termtabs button')) b.addEventListener('click', () => setTab(b.dataset.t));
  input.addEventListener('input', suggest);
  input.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (!hist.length) return;
      e.preventDefault();
      hi = e.code === 'ArrowUp' ? Math.max(0, (hi < 0 ? hist.length : hi) - 1) : hi < 0 ? -1 : hi + 1;
      if (hi >= hist.length) hi = -1;
      input.value = hi < 0 ? '' : hist[hi];
      suggest();
    } else if (e.code === 'Tab') {
      e.preventDefault();
      if (sugs.length) pick(0);
    }
  });
  q('.termsug').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  q('.termlist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    if (b.dataset.sure === '0') { b.dataset.sure = '1'; b.textContent = tr('Tap again'); return; }
    send(b.dataset.c);
    if (b.dataset.stay !== '1') setTab('cmd');
  });
  // Taps on it are its own: never the game's, nor a menu's under it.
  for (const k of ['pointerdown', 'touchstart']) el.addEventListener(k, (e) => e.stopPropagation(), { passive: true });
  say(tr('Commands run on the game server. /help lists the ones you may use. A player is a name, a #number or an ID.'), 'dim');
}

function badge() {
  const s = live.staff();
  q('.termvan').style.display = s && s.vanished ? '' : 'none';
}

export function toggle() { if (open) close(); else openTerminal(); }
export function openTerminal() {
  if (!live.staff()) return;
  if (!el) build();
  open = true;
  el.classList.add('on');
  badge();
  if (document.pointerLockElement) document.exitPointerLock();
  setTab(tab);
  if (o.opened) o.opened();
  setTimeout(() => { const i = inputEl(); if (i && tab === 'cmd') i.focus(); }, 60);
}
export function close() {
  if (!open) return;
  open = false;
  el.classList.remove('on');
  clearInterval(listT);
  listT = null;
  const i = inputEl();
  if (i) i.blur();
  if (o.closed) o.closed();
}

function setTab(t) {
  tab = t;
  for (const b of el.querySelectorAll('.termtabs button')) b.classList.toggle('on', b.dataset.t === t);
  el.classList.toggle('players', t === 'players');
  clearInterval(listT);
  listT = null;
  if (t === 'players') {
    live.askList();
    listT = setInterval(() => live.askList(), 3000);
    paintList();
  } else {
    const out = q('.termout');
    out.scrollTop = out.scrollHeight;
  }
}

// ---------------------------------------------------------------- lines
function say(text, color = 'info') {
  if (!el) build();
  const out = q('.termout'), d = document.createElement('div'), end = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  d.className = 'tl ' + (['good', 'warn', 'bad', 'me', 'dim'].includes(color) ? color : 'info');
  d.textContent = String(text);
  out.appendChild(d);
  while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
  if (end || color === 'me') out.scrollTop = out.scrollHeight;
}
export { say as termSay };

function send(text) {
  const line = String(text || '').trim().replace(/^[/!]+/, '');
  const input = inputEl();
  if (!line) return;
  input.value = '';
  sugs = [];
  paintSug();
  if (hist[hist.length - 1] !== line) hist.push(line);
  if (hist.length > 50) hist.shift();
  hi = -1;
  say('/' + line, 'me');
  if (line === 'clear') { q('.termout').innerHTML = ''; return; }
  if (!live.command(line)) say(tr('Not connected to the game server right now. Try again in a moment.'), 'bad');
}

// ---------------------------------------------------------------- suggestions while typing
// Words as the server will read them: quotes keep a name with spaces together.
function words(text) {
  const out = [], re = /"[^"]*"?|\S+/g;
  for (let m; (m = re.exec(text));) out.push({ w: m[0], at: m.index });
  return out;
}
function suggest() {
  const input = inputEl(), text = input.value.replace(/^[/!]+/, ''), s = live.staff(), menu = (s && s.menu) || [];
  const ws = words(text), endsSpace = /\s$/.test(text);
  sugs = [];
  if (!text.trim()) return paintSug();
  const name = ws.length ? ws[0].w.toLowerCase() : '';
  if (ws.length <= 1 && !endsSpace) {
    // The command itself.
    const hits = menu.filter((c) => c.n.startsWith(name)).concat(menu.filter((c) => !c.n.startsWith(name) && c.n.includes(name)));
    sugs = hits.slice(0, 8).map((c) => ({ label: `/${c.n} ${usage(c)}`, sub: c.d, fill: c.n + ' ' }));
    if (!sugs.length) sugs = near(name, menu).map((c) => ({ label: `/${c.n} ${usage(c)}`, sub: `${tr('Did you mean this?')} ${c.d}`, fill: c.n + ' ' }));
    return paintSug();
  }
  const c = menu.find((x) => x.n === name);
  if (!c) { sugs = [{ label: tr(`No command /${name}`), sub: tr('Type help for the list'), fill: null }]; return paintSug(); }
  // Which part is being typed now. key=value ones are left alone.
  const args = ws.slice(1), cur = endsSpace ? '' : args.length ? args[args.length - 1].w : '';
  const free = c.o.filter((x) => !args.some((a) => a.w.toLowerCase().startsWith(x.n + '=') || a.w.toLowerCase().startsWith(x.n + ':')));
  const idx = endsSpace ? args.length : Math.max(0, args.length - 1), opt = free[Math.min(idx, free.length - 1)];
  sugs.push({ label: `/${c.n} ${usage(c, opt)}`, sub: c.d, fill: null });
  if (opt && !cur.includes('=')) {
    const low = cur.replace(/^"|"$/g, '').toLowerCase(), base = endsSpace ? text : text.slice(0, text.length - cur.length);
    let opts = [];
    if (opt.k === 'player') {
      opts = list.filter((p) => !low || String(p.name).toLowerCase().includes(low.replace(/^#/, '')) || String(p.num).startsWith(low.replace(/^#/, '')))
        .slice(0, 6).map((p) => ({ label: `${p.name} #${p.num}`, sub: tr(doing(p)), fill: base + `#${p.num} ` }));
      if (!list.length) live.askList();
    } else if (opt.c) opts = opt.c.filter((v) => String(v).startsWith(low)).map((v) => ({ label: String(v), sub: opt.n, fill: base + v + ' ' }));
    else if (opt.n === 'role') opts = ['none', ...roleKeys()].filter((k) => k.startsWith(low)).slice(0, 8).map((k) => ({ label: k, sub: k === 'none' ? tr('No role') : roleInfo(k).tag, fill: base + k + ' ' }));
    else if (opt.n === 'perm') opts = ['*', ...menu.map((x) => x.n)].filter((k) => k.startsWith(low)).slice(0, 8).map((k) => ({ label: k, sub: tr(k === '*' ? 'Everything' : 'Command'), fill: base + k + ' ' }));
    else if (opt.k === 'yes/no') opts = ['yes', 'no'].filter((k) => k.startsWith(low)).map((k) => ({ label: k, sub: opt.n, fill: base + k + ' ' }));
    sugs.push(...opts);
  }
  paintSug();
}
// The part being typed now is in capitals.
const usage = (c, now) => c.o.map((x) => { const t = x === now ? x.n.toUpperCase() : x.n; return x.r ? t : `[${t}]`; }).join(' ');
function near(w, menu) {
  const d = (a, b) => {
    const m = [];
    for (let i = 0; i <= a.length; i++) m.push([i]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        // Two letters swapped round is one slip, not two.
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) m[i][j] = Math.min(m[i][j], m[i - 2][j - 2] + 1);
      }
    }
    return m[a.length][b.length];
  };
  return menu.map((c) => [c, d(w, c.n)]).filter(([c, n]) => n <= Math.max(1, Math.floor(c.n.length / 3))).sort((a, b) => a[1] - b[1]).slice(0, 3).map((x) => x[0]);
}
function paintSug() {
  const box = q('.termsug');
  box.innerHTML = sugs.map((s, i) => `<button type="button" class="${s.fill === null ? 'info' : ''}" ${s.fill === null ? '' : `data-i="${i}"`}><b></b><small></small></button>`).join('');
  box.querySelectorAll('button').forEach((b, i) => { b.querySelector('b').textContent = sugs[i].label; b.querySelector('small').textContent = sugs[i].sub || ''; });
}
function pick(i) {
  const s = sugs[i] || sugs.find((x) => x.fill !== null);
  if (!s || s.fill === null) return;
  const input = inputEl();
  input.value = s.fill;
  input.focus();
  suggest();
}

// ---------------------------------------------------------------- everyone in the game
function doing(p) {
  const map = MAPS[p.map] ? MAPS[p.map].name : '', diff = DIFFS[p.diff] ? DIFFS[p.diff].name : '';
  const room = p.room ? `${p.room.kind === 'online' ? 'Online room' : 'room'} ${p.room.code}` : '';
  if (p.st === 'climb') return [p.won ? 'At the top' : p.paused ? 'Paused' : 'Climbing', map, diff, `${p.h} of ${p.top} m`, p.solo ? 'Solo' : `${p.n}/4`, room].filter(Boolean).join(' · ');
  if (p.st === 'lobby') return ['In a lobby', map, diff, `${p.n}/4`, room].filter(Boolean).join(' · ');
  if (p.st === 'watch') return 'Watching a climb';
  if (p.st === 'menu') return 'In the menus';
  return 'Connecting';
}
function paintList() {
  const box = q('.termlist'), esc = o.esc;
  if (listErr) { box.innerHTML = `<p class="termnote">${esc(listErr)}</p>`; return; }
  if (!list.length) { box.innerHTML = '<p class="termnote">Asking the server...</p>'; return; }
  const s = live.staff(), can = new Set((s && s.cmds) || []);
  const climbing = list.filter((p) => p.st === 'climb').length;
  box.innerHTML = `<p class="termnote">${list.length} in the game, ${climbing} climbing</p>` + list.map((p) => {
    const r = roleInfo(p.role), id = '#' + p.num;
    const btns = p.me ? '' : [
      p.st === 'climb' && can.has('watch') ? `<button class="btn sm primary" data-c="watch ${id}">Watch</button>` : '',
      p.room && p.room.kind === 'server' && can.has('join') ? `<button class="btn sm" data-c="join ${id}">Join</button>` : '',
      can.has('player') ? `<button class="btn sm" data-c="player ${id}">Info</button>` : '',
      p.room && p.room.kind === 'server' && can.has('kick') ? `<button class="btn sm danger" data-c="kick ${id}" data-sure="0">Kick</button>` : '',
    ].join('');
    return `<div class="trow"><i class="fdot ${p.st === 'climb' ? 'climb' : p.st === 'lobby' ? 'lobby' : 'on'}"></i><div class="ttext"><b><span class="frname">${esc(p.name)}</span> <em class="fnum">${id}</em>${r ? `<em class="role" style="background:${r.color}">${esc(r.tag)}</em>` : ''}${p.me ? ' <small>(you)</small>' : ''}${p.vanished ? ' <small class="tvan">vanished</small>' : ''}${p.watched ? ` <small>${p.watched} watching</small>` : ''}</b><small>${esc(doing(p))}</small></div><div class="tbtns">${btns}</div></div>`;
  }).join('');
}
