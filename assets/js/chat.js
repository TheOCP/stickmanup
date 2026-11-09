// The chat in a room, in the lobby and on the climb. What is said goes through the host like everything else (net.js say),
// and every phone keeps the last ones, so whoever joins later can read back and a new host still has them all.
// Mute it all (no pop ups, no sound, no bubbles), or mute someone: that holds in every room, because it goes by their
// phone's own key (net.js who), not by a name anyone could take.
const EMOJI = ['😀', '😂', '🥰', '😎', '🥳', '😭', '😱', '😴', '👍', '👋', '🙏', '💪', '❤️', '🔥', '⭐', '🎉', '💀', '🐢'];
const QUICK = ['Hi! 👋', 'Wait for me!', 'Go go go!', 'Nice one!', 'Help!', 'Sorry!', 'GG 🎉'];
const FEED_MS = 8000, FEED_MAX = 4, BLOCK_MAX = 100;
const isText = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

let o = null, el = null, feed = null, open = false, room = null, unread = 0;

const q = (s) => el.querySelector(s);
const inputEl = () => (el ? q('.chin input') : null);
export const chatIsOpen = () => open;
export const chatUnread = () => unread;

// o: app, settings, save (settings), esc, roleTag (player), color (colour, slot), sound, bubble (slot, text), toast, canSay,
// opened, closed, pc.
export function initChat(opts) {
  o = opts;
  window.addEventListener('keydown', (e) => {
    if (open && e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeChat();
    } else if (!open && (e.code === 'Enter' || e.code === 'NumpadEnter') && room && o.app.screen === 'game' && !isText(e.target)) {
      // Enter on a keyboard opens it, like in most games.
      e.preventDefault();
      openChat();
    }
  }, true);
}

// Which room the chat is for right now: the lobby's or the climb's session, or none (alone, menus).
export function chatRoom(s) {
  if (room === s) return;
  room = s || null;
  unread = 0;
  if (!room) closeChat();
  else if (open) paint();
  badge();
}

const blocked = (w) => !!w && (o.settings.chatBlock || []).some((b) => b.w === w);
const mine = (m) => (m.w && room && room.who ? m.w === room.who : !!room && m.s === room.slot);
const shown = (m) => mine(m) || !blocked(m.w);

// A new message in the room (main.js, from the session).
export function chatGot(s, m) {
  if (s !== room || !shown(m)) return;
  const me = mine(m);
  if (open) {
    const list = q('.chlist'), near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const empty = list.querySelector('.chempty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('beforeend', line(m));
    if (near || me) list.scrollTop = list.scrollHeight;
  } else if (!me) {
    unread++;
    badge();
  }
  if (o.settings.chatMute) return;
  if (!me) { if (!open) pop(m); o.sound(); }
  o.bubble(m.s, m.t);
}

function badge() {
  const t = unread ? (unread > 9 ? '9+' : String(unread)) : '';
  for (const b of document.querySelectorAll('[data-chatn]')) if (b.textContent !== t) b.textContent = t;
}

function time(at) {
  const d = new Date(at);
  return isFinite(d) ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';
}

function line(m) {
  const p = room && room.players.get(m.s), same = p && p.name === m.n, me = mine(m);
  return `<div class="chm${me ? ' me' : ''}" style="--pc:${o.color(m.c, m.s)}"><div class="chb"><b class="chname">${o.esc(m.n)}</b>${same && !me ? o.roleTag(p) : ''}<span class="chtx">${o.esc(m.t)}</span></div><small>${time(m.at)}</small></div>`;
}

function build() {
  el = document.createElement('div');
  el.id = 'chat';
  el.innerHTML = `<div class="chbox">
    <div class="chhead"><b>💬 Chat</b><button class="chico" data-c="mute" aria-label="Mute chat"></button><button class="chico" data-c="people" aria-label="Players">👥</button><button class="chico" data-c="x" aria-label="Close">✕</button></div>
    <div class="chlist"></div>
    <div class="chpeople"></div>
    <div class="chquick">${QUICK.map((t) => `<button type="button" data-q>${o.esc(t)}</button>`).join('')}</div>
    <div class="chemo">${EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    <form class="chin"><input type="text" maxlength="140" enterkeyhint="send" autocomplete="off" spellcheck="true" placeholder="Write a message"><button class="btn sm primary" type="submit">Send</button></form>
  </div>`;
  document.body.appendChild(el);
  const input = inputEl();
  q('.chin').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.c === 'x') closeChat();
    else if (b.dataset.c === 'mute') { o.settings.chatMute = !o.settings.chatMute; o.save(); head(); o.toast(o.settings.chatMute ? 'Chat muted' : 'Chat on', ''); }
    else if (b.dataset.c === 'people') { el.classList.toggle('people'); if (el.classList.contains('people')) people(); else paint(); head(); }
    else if (b.dataset.q !== undefined) send(b.textContent);
    else if (b.dataset.e) { input.value = (input.value + b.dataset.e).slice(0, 140); if (o.pc) input.focus(); }
    else if (b.dataset.m) mute(b.dataset.m, b.dataset.n);
    else if (b.dataset.all !== undefined) { o.settings.chatBlock = []; o.save(); people(); }
  });
  // Taps on it are its own: never the climb's, nor a menu's under it.
  for (const k of ['pointerdown', 'touchstart']) el.addEventListener(k, (e) => e.stopPropagation(), { passive: true });
}

function head() {
  const m = q('[data-c="mute"]');
  m.textContent = o.settings.chatMute ? '🔕' : '🔔';
  m.classList.toggle('on', !!o.settings.chatMute);
  q('[data-c="people"]').classList.toggle('on', el.classList.contains('people'));
}

function paint() {
  if (!el || !room) return;
  head();
  const list = q('.chlist'), msgs = (room.chat || []).filter(shown);
  list.innerHTML = msgs.length ? msgs.map(line).join('') : '<div class="chempty">No messages yet. Say hi! 👋</div>';
  list.scrollTop = list.scrollHeight;
}

// Who is in the room, each with a mute button. Muted from other rooms can all be let back at once.
function people() {
  const box = q('.chpeople'), list = [...room.players.values()].filter((p) => p.slot !== room.slot);
  const rows = list.map((p) => {
    const off = blocked(p.who);
    return `<div class="chp" style="--pc:${o.color(p.color, p.slot)}"><i></i><span class="chname">${o.esc(p.name)}</span>${p.who ? `<button class="btn sm${off ? ' primary' : ''}" data-m="${o.esc(p.who)}" data-n="${o.esc(p.name)}">${off ? 'Unmute' : 'Mute'}</button>` : ''}</div>`;
  });
  const n = (o.settings.chatBlock || []).length;
  box.innerHTML = (rows.length ? rows.join('') : '<div class="chempty">Nobody else here yet</div>') + (n ? `<button class="btn sm chall" data-all>Unmute everyone (${n})</button>` : '');
}

function mute(w, name) {
  const b = (o.settings.chatBlock || []).filter((x) => x && x.w !== w);
  if (!blocked(w)) b.push({ w, n: String(name || '').slice(0, 14) });
  o.settings.chatBlock = b.slice(-BLOCK_MAX);
  o.save();
  people();
}

function send(text) {
  const t = String(text || '').trim();
  if (!t || !room) return;
  if (o.canSay && !o.canSay()) return;
  room.say(t);
  const input = inputEl();
  input.value = '';
  if (o.pc) input.focus();
}

// Pops up on the left for a few seconds while the chat is closed. Never in the way of a tap.
function pop(m) {
  if (!feed) { feed = document.createElement('div'); feed.id = 'chatFeed'; document.body.appendChild(feed); }
  const d = document.createElement('div');
  d.className = 'chpop';
  d.style.setProperty('--pc', o.color(m.c, m.s));
  d.innerHTML = `<b class="chname">${o.esc(m.n)}</b><span class="chtx">${o.esc(m.t)}</span>`;
  feed.appendChild(d);
  while (feed.children.length > FEED_MAX) feed.firstChild.remove();
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, FEED_MS);
}

export function openChat() {
  if (!room || room.closed) return;
  if (!el) build();
  open = true;
  el.classList.remove('people');
  el.classList.add('on');
  unread = 0;
  badge();
  if (feed) feed.innerHTML = '';
  if (document.pointerLockElement) document.exitPointerLock();
  if (o.opened) o.opened();
  paint();
  // Only with a keyboard: on a phone the keyboard would cover the climb straight away.
  if (o.pc) setTimeout(() => { const i = inputEl(); if (i) i.focus(); }, 60);
}

export function closeChat() {
  if (!open) return;
  open = false;
  el.classList.remove('on');
  const i = inputEl();
  if (i) i.blur();
  if (o.closed) o.closed();
}

export function toggleChat() { if (open) closeChat(); else openChat(); }
