// App shell: boot, menus, lobby flows, HUD and the main loop.
import * as THREE from 'three';
import { Renderer } from './render.js';
import { generateLevel, DIFFS, MAPS, LEVEL_VERSION, cpEnabled } from './level.js';
import { World } from './physics.js';
import { WorldView, setSimple } from './worldview.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Storm } from './storm.js';
import { Session, makeLink, lanDiscover, btPrepare, btDevices, lanAddresses, hasNative, MAX_PLAYERS, exposeHost, addrToCode, parseAddr } from './net.js';
import { Game } from './game.js';
import { COLORS, makePool } from './robot.js';
import { PALETTE, css } from './colors.js';
import { Chain } from './chain.js';
import { Fx } from './fx.js';
import { PR } from './player.js';
import { store, fmtTime, clamp } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const N = window.Native;
const VERSION = N && N.version ? N.version() : 'dev';

// Picture: res = render resolution (share of the screen), autoRes lets it drop when the phone struggles,
// sharp 0..1, aa = edge anti-aliasing, glow 0..1.5, cap = frame rate. Controls: btnSize, btnAlpha, lefty, btnPos.
const settings = Object.assign({ quality: 'high', sens: 1, invert: false, music: 0.5, sfx: 0.8, haptics: true, fps: false, name: '', gfxSafe: 0, map: 0,
  res: 0.75, autoRes: true, sharp: 0.35, aa: true, glow: 1, cap: 60, btnSize: 1, btnAlpha: 0.9, lefty: false, btnPos: null, aimSens: 1,
  camFollow: 1, aimHelp: 0.5, tips: true, color: 0, vsync: true }, store.get('settings', {}));
if (![30, 60, 90, 120].includes(settings.cap)) settings.cap = 60;
if (!(settings.color >= 0 && settings.color < PALETTE.length)) settings.color = 0;
const myColor = () => PALETTE[settings.color];
// A player's colour in the session (their pick, or their slot's default).
const pcol = (s, slot) => { const p = s.players.get(slot); return css((p && p.color) ?? COLORS[slot % 4]); };
// Earlier versions had on/off switches for the two assists; carry them over to the sliders.
if (settings.camAssist === false) settings.camFollow = 0;
if (settings.aimAssist === false) settings.aimHelp = 0;
delete settings.camAssist;
delete settings.aimAssist;
if (!settings.name || /^Robot \d+$/.test(settings.name)) settings.name = 'Climber ' + (100 + ((Math.random() * 900) | 0));
if (!MAPS[settings.map]) settings.map = 0;
const saveSettings = () => store.set('settings', settings);
// v2 keeps best times per map; earlier best times were all on the storm tower.
if (!store.get('best2') && store.get('best')) { const b = {}; for (const [d, t] of Object.entries(store.get('best'))) b['0:' + d] = t; store.set('best2', b); }
const validSave = (k) => { const s = store.get(k); return s && s.v === LEVEL_VERSION ? s : null; };

const app = { settings, game: null, paused: false, screen: '', back: null, room: null };

// Diagnostics: JS errors and boot stages go to the Android side (and on to a developer receiver if one runs).
const errs = [];
function report(k, o = {}) {
  if (N && N.report) N.report(JSON.stringify(Object.assign({ k, t: Math.round(performance.now()) }, o)));
}
function noteErr(msg) {
  const m = String(msg).slice(0, 400);
  errs.push(m);
  if (errs.length > 12) errs.shift();
  report('jserr', { msg: m });
}
window.addEventListener('error', (e) => noteErr(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => noteErr('promise: ' + (e.reason && (e.reason.stack || e.reason))));
for (const lvl of ['error', 'warn']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { noteErr(lvl + ': ' + a.map(String).join(' ')); orig(...a); };
}
window.SMU = app;

// ---------- small UI helpers ----------
const ui = (app.ui = {
  toast(msg, kind = '') {
    const box = $('#toasts');
    while (box.children.length > 2) box.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  },
  flash(color) {
    const f = $('#fx');
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = 0.5;
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity 0.7s'; f.style.opacity = 0; }));
  },
  haptic(kind) {
    if (settings.haptics && N && N.haptic) N.haptic(kind);
  },
  zoneTitle(z) {
    const Z = app.level.zones[z], el = $('#zoneTitle');
    el.querySelector('small').textContent = `Zone ${z + 1} of ${app.level.zones.length}`;
    el.querySelector('h2').textContent = Z.name;
    el.querySelector('p').textContent = Z.sub;
    el.style.setProperty('--zc', '#' + Z.color.toString(16).padStart(6, '0'));
    el.classList.add('show');
    clearTimeout(this.zt);
    this.zt = setTimeout(() => el.classList.remove('show'), 3400);
  },
  players(g) {
    const L = app.level, top = L.top;
    $('#hAlt .track').innerHTML = L.zones.map((z) => `<i style="bottom:${(z.y0 / top) * 100}%;height:${((z.y1 - z.y0) / top) * 100}%;background:#${z.color.toString(16).padStart(6, '0')}"></i>`).join('');
    const cps = L.cps.filter((c) => cpEnabled(c, g.diff) && !c.start).map((c) => `<i class="cp" style="bottom:${(c.y / top) * 100}%"></i>`).join('');
    $('#hAlt .marks').innerHTML = cps + [...g.s.players.keys()].map((s) => `<i data-s="${s}" style="color:${pcol(g.s, s)}"></i>`).join('');
    $('#hPlayers').innerHTML = g.solo ? '' : [...g.s.players.values()].map((p) => `<div data-s="${p.slot}" style="color:${pcol(g.s, p.slot)}"><i></i><span>${esc(p.name)}${p.slot === g.slot ? ' (you)' : ''}</span><small></small></div>`).join('');
    $('#tags').innerHTML = '';
  },
  hud(g, { T, zone, gust, thunder }) {
    const me = g.me, L = app.level, Z = L.zones[zone];
    $('#hZone b').textContent = Z.name;
    $('#hZone span').textContent = `${Math.max(0, Math.round(me.y - PR - 2))} m of ${Math.round(L.top - 2)} m · ${DIFFS[g.diff].name}`;
    $('#hTime').innerHTML = fmtTime(T) + (g.falls ? `<small>${g.falls} fall${g.falls > 1 ? 's' : ''}</small>` : '');
    let warn = '', cls = '';
    if (thunder && thunder.warn > 0 && !(me.flags & 128)) { warn = 'LIGHTNING! SHIELD!'; cls = 'g'; }
    else if (gust && gust.on) { warn = 'GUST! GRAB ON'; cls = 'g'; }
    else if (gust && gust.warn > 0) { warn = 'GUST INCOMING'; cls = 'w'; }
    else {
      for (const r of L.rods) {
        if (Math.abs(r.y - me.y) > 4 || Math.hypot(r.x - me.x, r.z - me.z) > r.rad + 1.5) continue;
        if (g.storm.rodWarn(r, T) > 0) { warn = 'LIGHTNING: GRAB!'; cls = 'w'; break; }
      }
    }
    const w = $('#hWarn');
    w.textContent = warn;
    w.className = warn ? 'on ' + cls : '';
    const gb = $('#bGrab');
    gb.style.setProperty('--v', me.grip.toFixed(3));
    gb.classList.toggle('low', me.grip < 0.3);
    $('#bAct').classList.toggle('off', !g.action);
    // Without the cord there's nothing to reel.
    const rb0 = $('#bReel');
    if (rb0.classList.contains('nocord') !== g.noCord) rb0.classList.toggle('nocord', g.noCord);
    const rl = $('#bReel span'), mode = g.reelMode || 'REEL';
    if (rl.textContent !== mode) rl.textContent = mode;
    $('#bReel').classList.toggle('help', mode !== 'REEL');
    const sb = $('#bShield'), stormy = L.mapKey === 'storm';
    sb.classList.toggle('on', stormy);
    if (stormy) {
      sb.style.setProperty('--v', (1 - me.shieldCd / 2.2).toFixed(3));
      sb.classList.toggle('ready', me.shieldCd <= 0);
      sb.classList.toggle('alert', !!thunder && thunder.warn > 0 && me.shieldCd <= 0);
    }
    const rb = $('#bReel');
    rb.style.setProperty('--v', me.charge.toFixed(3));
    rb.style.setProperty('--o', me.charge > 0 ? 1 : 0);
    for (const el of document.querySelectorAll('#hAlt .marks i[data-s]')) {
      const s = +el.dataset.s, p = s === g.slot ? me : g.vis && g.vis.get(s);
      if (p) el.style.bottom = clamp(p.y / L.top, 0, 1) * 100 + '%';
    }
    for (const el of document.querySelectorAll('#hPlayers div')) {
      const s = +el.dataset.s, p = s === g.slot ? me : g.vis && g.vis.get(s), pl = g.s.players.get(s);
      el.querySelector('small').textContent = (p ? Math.round(p.y - 2) + ' m' : '...') + (s !== g.slot && !g.s.isHost ? '' : pl && pl.ping ? ` · ${pl.ping} ms` : '') + (s === g.slot && !g.s.isHost ? ` · ${g.s.ping} ms` : '');
    }
  },
  // Tips: a small "!" floats over each tip spot; tap it to read the tip. Each tip also pops up by
  // itself the first time you come near it. The card is see-through and fades out on its own.
  tips(g) {
    if (!settings.tips) { if (this.tipLevel) this.clearTips(); return; }
    const L = app.level, me = g.me, box = $('#tipMarks'), cam = app.renderer.camera, v = this.tv || (this.tv = new THREE.Vector3());
    if (this.tipLevel !== L) { box.innerHTML = ''; this.tipEls = new Map(); this.tipLevel = L; }
    const seen = this.seen || (this.seen = new Set(store.get('tipsSeen', []))), W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < L.signs.length; i++) {
      const s = L.signs[i], key = L.map + ':' + i, d = Math.hypot(s.x - me.x, s.y - me.y, s.z - me.z);
      let el = this.tipEls.get(i);
      if (d < 7 && !seen.has(key)) { seen.add(key); store.set('tipsSeen', [...seen]); this.tip(s.text); }
      v.set(s.x, s.y - 0.7, s.z).project(cam);
      const show = d < 24 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!show) { if (el) el.style.display = 'none'; continue; }
      if (!el) {
        el = document.createElement('button');
        el.textContent = '!';
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); ui.tip(s.text); });
        box.appendChild(el);
        this.tipEls.set(i, el);
      }
      el.style.display = '';
      el.classList.toggle('seen', seen.has(key));
      el.style.left = ((v.x + 1) / 2) * W + 'px';
      el.style.top = ((1 - v.y) / 2) * H + 'px';
    }
  },
  tip(text) {
    const c = $('#tipCard');
    c.querySelector('p').textContent = text;
    c.classList.add('on');
    clearTimeout(this.tipT);
    this.tipT = setTimeout(() => c.classList.remove('on'), 6500);
  },
  clearTips() {
    $('#tipMarks').innerHTML = '';
    $('#tipCard').classList.remove('on');
    this.tipLevel = null;
  },
  cross(on, hot) {
    const c = $('#cross');
    c.classList.toggle('on', !!on);
    c.classList.toggle('hot', !!on && !!hot);
  },
  tags(g) {
    const box = $('#tags'), cam = app.renderer.camera, W = window.innerWidth, H = window.innerHeight, v = this.v || (this.v = new THREE.Vector3());
    for (const [slot, o] of g.vis || []) {
      let el = box.querySelector(`[data-s="${slot}"]`);
      const p = g.s.players.get(slot);
      if (!p) { if (el) el.remove(); continue; }
      if (!el) {
        el = document.createElement('div');
        el.dataset.s = slot;
        el.style.color = pcol(g.s, slot);
        el.textContent = p.name;
        box.appendChild(el);
      }
      v.set(o.x, o.y + 0.85, o.z).project(cam);
      let x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
      const behind = v.z > 1;
      if (behind) { x = W - x; y = H - 40; }
      const cx = clamp(x, 50, W - 50), cy = clamp(y, 80, H - 30);
      el.classList.toggle('edge', behind || cx !== x || cy !== y);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
    }
  },
});

// ---------- menu system ----------
let handlers = {};
function show(html, h = {}, dim = true) {
  const m = $('#menu');
  m.innerHTML = html;
  m.className = 'on' + (dim ? ' dim' : '');
  handlers = h;
  app.back = h.back || null;
}
function hideMenu() {
  $('#menu').className = '';
  $('#menu').innerHTML = '';
  handlers = {};
  app.back = null;
}
$('#menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  app.sound.init();
  app.sound.ui();
  const f = handlers[b.dataset.a];
  if (f) f(b);
});
const header = (title) => `<div class="ph"><button class="back" data-a="back">‹</button><h2>${title}</h2></div>`;

// Best times per map and difficulty, keyed "map:diff".
const bestOf = (map) => { const b = store.get('best2', {}), out = {}; for (const d of DIFFS) if (b[map + ':' + d.id]) out[d.id] = b[map + ':' + d.id]; return out; };

// Builds (once) and shows a map. Each map keeps its level, physics and meshes after the first visit,
// so switching back is instant and nothing on the GPU is ever rebuilt.
const worlds = new Map();
function loadMap(id) {
  if (!MAPS[id]) id = 0;
  if (app.level && app.level.map === id) return;
  const R = app.renderer;
  if (app.view) R.scene.remove(app.view.root);
  let w = worlds.get(id);
  if (!w) {
    const level = generateLevel(id);
    w = { level, world: new World(level.cols), view: null };
    w.view = new WorldView(R.scene, level);
    worlds.set(id, w);
  } else R.scene.add(w.view.root);
  app.level = w.level;
  app.world = w.world;
  app.view = w.view;
  app.view.setCheckpoints(1, 0);
  app.titleStorm = new Storm(app.level, 1);
  R.setTheme(app.level.mapKey);
  report('stage', { s: 'map', map: id });
}

function mapCards(sel) {
  return `<div class="maps">${MAPS.map((m) => `<button class="map m${m.id} ${sel === m.id ? 'sel' : ''}" data-a="map" data-m="${m.id}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}</div>`;
}

function pickMap(id, redraw) {
  settings.map = id;
  saveSettings();
  loadMap(id);
  redraw();
}

function title() {
  app.screen = 'title';
  const save = validSave('save.solo'), best = bestOf(settings.map), M = MAPS[settings.map];
  loadMap(settings.map);
  show(`<div class="title">
    <div class="brand">
      <div class="logo">STICKMAN<span>UP</span></div>
      <p class="tag">Up to four stickmen, tied together by a glowing cord. Five giant climbs: a storm tower, a sunny lighthouse, a monster forest, a volcano and a neon city. If one falls, everyone feels it.</p>
      <p class="ver">v${esc(VERSION)} · ${M.name} · ${Object.keys(best).length ? 'Best ' + Object.entries(best).map(([d, t]) => `${DIFFS[d].name} ${fmtTime(t)}`).join(' · ') : 'Not climbed yet'}</p>
    </div>
    <div class="mainbtns">
      ${save ? `<button class="btn primary" data-a="cont"><b>Continue climb</b><small>${MAPS[save.map || 0].name} · ${DIFFS[save.diff].name} · ${Math.round(save.pos[1] - 2)} m · ${fmtTime(save.t)}</small></button>` : ''}
      <button class="btn ${save ? '' : 'primary'}" data-a="solo"><b>Solo climb</b><small>Pick a map and practise on your own</small></button>
      <button class="btn" data-a="host"><b>Host a game</b><small>Online, WiFi or Bluetooth</small></button>
      <button class="btn" data-a="join"><b>Join a game</b><small>Room code or a game nearby</small></button>
      <div class="row"><button class="btn sm" data-a="settings">Settings</button><button class="btn sm" data-a="how">How to play</button></div>
    </div></div>`, {
    cont: () => startSolo(save.map || 0, save.diff, save),
    solo: soloPick,
    host: hostPick,
    join: () => joinScreen('online'),
    settings: () => settingsScreen(title),
    how: () => howTo(title),
    back: () => { if (N && N.exit) N.exit(); },
  }, false);
}

function diffCards(sel) {
  const best = bestOf(settings.map), icons = ['◆', '◆◆', '◆◆◆'];
  return `<div class="cards">${DIFFS.map((d) => `<button class="card d${d.id} ${sel === d.id ? 'sel' : ''}" data-a="pick" data-d="${d.id}">
    <span class="ic">${icons[d.id]}</span><b>${d.name}</b><small>${d.desc}</small><span class="best">${best[d.id] ? 'Best ' + fmtTime(best[d.id]) : 'Not climbed yet'}</span></button>`).join('')}</div>`;
}

function soloPick() {
  app.screen = 'solo';
  const save = validSave('save.solo');
  show(`<div class="panel">${header('Solo climb')}
    ${mapCards(settings.map)}
    <p class="sub">Pick a difficulty to start. Solo has no cord partner, so the teamwork tricks aren't needed${save ? '. Starting a new climb replaces your saved one.' : '.'}</p>
    ${diffCards(-1)}</div>`, {
    back: title,
    map: (b) => pickMap(+b.dataset.m, soloPick),
    pick: (b) => startSolo(settings.map, +b.dataset.d, null),
  });
}

function startSolo(map, diff, save) {
  const s = new Session('solo', settings.name, null, myColor());
  beginGame(s, { map, diff, t0: 0, base: save ? save.t : 0, cp: save ? save.cp : 0, falls: save ? save.falls : 0, doors: save ? save.doors : null, pos: save ? { 0: save.pos } : null });
}

// ---------- hosting ----------
function hostPick() {
  app.screen = 'host';
  show(`<div class="panel">${header('Host a game')}
    <p class="sub">Up to 4 climbers. Everyone needs StickManUp, and the same version.</p>
    <div class="cards">
      <button class="card" data-a="go" data-k="online"><span class="ic">🌐</span><b>Online</b><small>A 5 letter room code. Easiest, but some networks (often mobile data) block it.</small></button>
      <button class="card" data-a="go" data-k="direct"><span class="ic">⇄</span><b>Internet (direct)</b><small>No server at all: friends connect straight to your phone. Host from a home WiFi.</small></button>
      <button class="card" data-a="go" data-k="lan"><span class="ic">📶</span><b>WiFi / hotspot</b><small>Same WiFi, or friends join your phone's hotspot. No internet needed, lowest lag.</small></button>
      <button class="card" data-a="go" data-k="bt"><span class="ic">ᛒ</span><b>Bluetooth</b><small>No WiFi at all. Pair the phones in Android settings first. Slower link.</small></button>
    </div></div>`, {
    back: title,
    go: (b) => hostWith(b.dataset.k),
  });
}

function busy(text, cancel) {
  show(`<div class="panel" style="width:min(420px,100%);text-align:center"><p style="margin:18px 0"><span class="spin"></span>&nbsp; ${esc(text)}</p>
    <button class="btn sm" data-a="back">Cancel</button></div>`, { back: cancel });
}

async function bluetoothReady() {
  const st = await new Promise((res) => btPrepare(res));
  const msg = { off: 'Turn on Bluetooth first.', denied: 'StickManUp needs the Nearby devices permission for Bluetooth play.', none: 'Bluetooth play needs the Android app.' };
  if (st !== 'ok') { ui.toast(msg[st] || 'Bluetooth is not available.', 'bad'); return false; }
  return true;
}

async function hostWith(kind) {
  if (kind === 'bt' && !(await bluetoothReady())) return;
  const s = new Session('host', settings.name, makeLink(kind), myColor());
  let cancelled = false;
  busy(kind === 'online' ? 'Opening an online room...' : kind === 'direct' ? 'Opening your router for friends...' : 'Starting...', () => { cancelled = true; s.close(); hostPick(); });
  wireLobby(s);
  const r = await s.host();
  if (cancelled) return;
  if (!r.ok) { s.close(); ui.toast(r.err || 'Could not start the game', 'bad'); return hostPick(); }
  const mp = validSave('save.mp');
  s.lobby.map = settings.map;
  if (mp) s.lobby.diff = mp.diff;
  app.room = { kind, code: r.code, ips: kind === 'lan' ? (r.ips || lanAddresses()) : [], name: r.name };
  if (kind === 'direct') {
    const x = await exposeHost(r.port || 47800);
    if (cancelled) return;
    app.room.direct = x;
    if (x.ok) app.room.code = addrToCode(x.ip, x.port);
  }
  lobby(s);
}

function wireLobby(s) {
  s.on('lobby', () => { if (app.screen === 'lobby') lobby(s); });
  s.on('roster', (slot, joined) => {
    if (app.screen === 'lobby') lobby(s);
    if (app.game) { const p = s.players.get(slot); ui.toast(joined ? `${p ? p.name : 'A climber'} joined` : 'A climber left the game', joined ? 'good' : ''); }
  });
  s.on('error', (e) => { ui.toast(e, 'bad'); if (!s.isHost && !app.game) { s.close(); joinScreen(app.joinTab || 'online'); } });
  s.on('start', (g) => beginGame(s, g));
  s.on('closed', (why) => { if (app.game && app.game.s === s) { endGame(); message('Disconnected', why); } else if (app.screen === 'lobby') { message('Disconnected', why); } });
}

function lobby(s) {
  app.screen = 'lobby';
  const host = s.isHost, room = app.room || {}, mp = host ? validSave('save.mp') : null;
  let info;
  if (!host) info = `<div class="kind">Connected</div><p>You're in. The host picks the map and difficulty and starts the climb.</p><p>Ping: ${s.ping || '...'} ms</p>`;
  else if (room.kind === 'online') info = `<div class="kind">Online room</div><div class="code">${esc(room.code)}</div><p>Friends tap <b>Join a game</b>, then <b>Online</b>, and type this code.</p>${N && N.share ? '<button class="btn sm" data-a="share" style="margin-top:8px">Share code</button>' : ''}`;
  else if (room.kind === 'direct') {
    const x = room.direct || {};
    info = !x.ok ? `<div class="kind">Internet (direct)</div><p>Could not find this phone's internet address (${esc(x.err || 'no internet?')}). Try Online instead.</p>`
      : `<div class="kind">Internet (direct)</div><div class="code">${esc(room.code)}</div><p>Friends tap <b>Join a game</b>, then <b>Direct</b>, and type this code (or <b>${esc(x.ip)}:${x.port}</b>).</p>`
        + (x.cgnat ? `<p class="warn">Your internet provider shares one address between many customers (carrier NAT), so friends probably can't reach you. Use Online, or host from a home WiFi.</p>`
          : x.upnp ? `<p class="good">Router opened automatically. Friends anywhere can join.</p>`
            : `<p class="warn">The router didn't open the port by itself (UPnP off). In your router settings, forward TCP port ${x.port} to this phone, or use Online.</p>`)
        + (N && N.share ? '<button class="btn sm" data-a="share" style="margin-top:8px">Share code</button>' : '');
  } else if (room.kind === 'lan') info = `<div class="kind">WiFi / hotspot</div><p class="ip">${(room.ips || []).map(esc).join('<br>') || 'No WiFi found'}</p><p>Friends on the same WiFi (or connected to your hotspot) tap <b>Join a game</b>, then <b>WiFi</b>. Your game shows up automatically.</p>`;
  else info = `<div class="kind">Bluetooth</div><p>Waiting for climbers. Friends pair with this phone once in <b>Android Settings</b> under Bluetooth, then tap <b>Join a game</b>, then <b>Bluetooth</b>, and pick this phone.</p>`;
  const slots = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = s.players.get(i);
    slots.push(p ? `<div class="slot" style="color:${pcol(s, i)}"><span class="dot"></span><span style="color:var(--tx)">${esc(p.name)}${i === s.slot ? ' (you)' : ''}${i === 0 ? ' · host' : ''}</span><small>${p.ping ? p.ping + ' ms' : ''}</small></div>` : `<div class="slot empty">Open slot</div>`);
  }
  const resume = s.lobby.resume && mp;
  loadMap(resume ? mp.map || 0 : s.lobby.map || 0);
  show(`<div class="panel">${header(host ? 'Your game' : 'Joined game')}
    <div class="lobby">
      <div><div class="room">${info}</div><div class="slots">${slots.join('')}</div></div>
      <div>
        <div class="kind" style="margin-bottom:6px">Map</div>
        <div class="dsel mrow ${host && !resume ? '' : 'ro'}" style="margin-bottom:10px">${MAPS.map((m) => `<button data-a="lmap" data-m="${m.id}" class="${(resume ? mp.map || 0 : s.lobby.map || 0) === m.id ? 'sel' : ''}"><b>${m.name}</b></button>`).join('')}</div>
        <div class="kind" style="margin-bottom:6px">Difficulty</div>
        <div class="dsel ${host && !resume ? '' : 'ro'}">${DIFFS.map((d) => `<button data-a="diff" data-d="${d.id}" class="${(resume ? mp.diff : s.lobby.diff) === d.id ? 'sel' : ''}"><b>${d.name}</b><small>${d.desc}</small></button>`).join('')}</div>
        <label class="toggle"><input type="checkbox" data-a="nocord" ${(resume ? mp.noCord : s.lobby.noCord) ? 'checked' : ''} ${host && !resume ? '' : 'disabled'}> Play without the cord (nobody is tied together)</label>
        ${mp ? `<label class="toggle"><input type="checkbox" data-a="resume" ${resume ? 'checked' : ''}> Continue the saved climb (${MAPS[mp.map || 0].name}, ${DIFFS[mp.diff].name}, ${Math.round(mp.pos[1] - 2)} m, ${fmtTime(mp.t)})</label>` : ''}
        ${host ? `<button class="btn primary" data-a="start" style="margin-top:12px"><b>Start the climb</b><small>${s.players.size} climber${s.players.size > 1 ? 's' : ''} ready${s.players.size === 1 ? ' (you can start alone and friends can join while you climb)' : ''}</small></button>`
    : `<p class="sub" style="margin-top:14px"><span class="spin"></span>&nbsp; Waiting for the host to start...</p>`}
      </div>
    </div></div>`, {
    back: () => { s.close(); title(); },
    share: () => N.share(room.kind === 'direct' ? `Join my StickManUp climb! Open StickManUp, tap Join a game, then Direct, and type the code ${room.code}` : `Join my StickManUp climb! Open StickManUp, tap Join a game, then Online, and type the code ${room.code}`),
    diff: (b) => { if (host) s.setLobby({ diff: +b.dataset.d }); },
    lmap: (b) => { if (host) { settings.map = +b.dataset.m; saveSettings(); loadMap(settings.map); s.setLobby({ map: settings.map }); } },
    resume: (b) => s.setLobby({ resume: b.checked }),
    nocord: (b) => { if (host) s.setLobby({ noCord: b.checked }); },
    start: () => {
      const save = s.lobby.resume && mp;
      const pos = {};
      if (save) for (const k of s.players.keys()) pos[k] = [save.pos[0] + k * 0.3, save.pos[1] + k * 1.0, save.pos[2]];
      s.startGame({ map: save ? save.map || 0 : s.lobby.map || 0, diff: save ? save.diff : s.lobby.diff, noCord: save ? !!save.noCord : !!s.lobby.noCord, t0: performance.now(), base: save ? save.t : 0, cp: save ? save.cp : 0, falls: save ? save.falls : 0,
        doors: save ? save.doors : null, pos: save ? pos : null });
    },
  });
}

// ---------- joining ----------
let stopDisc = null;
function joinScreen(tab) {
  app.screen = 'join';
  app.joinTab = tab;
  if (stopDisc) { stopDisc(); stopDisc = null; }
  let body = '';
  if (tab === 'online') {
    body = `<p class="sub">Type the 5 letter code from the host's screen.</p>
      <div class="field"><input class="code" id="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE"><button class="btn primary sm" data-a="online">Join</button></div>`;
  } else if (tab === 'direct') {
    body = `<p class="sub">Type the code from the host's screen (or their address, like 84.12.3.9:47800).</p>
      <div class="field"><input class="code" id="daddr" maxlength="21" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX XXXXX"><button class="btn primary sm" data-a="direct">Join</button></div>`;
  } else if (tab === 'lan') {
    body = `<p class="sub">Games on your WiFi or hotspot appear here by themselves.</p><div class="list" id="found"><div class="empty"><span class="spin"></span>&nbsp; Looking for games...</div></div>
      <div class="field"><input id="ip" placeholder="Or type the host's IP, e.g. 192.168.1.20" inputmode="decimal"><button class="btn sm" data-a="ip">Join</button></div>`;
  } else {
    body = `<p class="sub">Pick the host's phone. It must be paired with yours in Android Settings under Bluetooth.</p><div class="list" id="bt"><div class="empty"><span class="spin"></span></div></div>`;
  }
  show(`<div class="panel">${header('Join a game')}
    <div class="tabs"><button data-a="tab" data-t="online" class="${tab === 'online' ? 'on' : ''}">Online</button><button data-a="tab" data-t="direct" class="${tab === 'direct' ? 'on' : ''}">Direct</button><button data-a="tab" data-t="lan" class="${tab === 'lan' ? 'on' : ''}">WiFi</button><button data-a="tab" data-t="bt" class="${tab === 'bt' ? 'on' : ''}">Bluetooth</button></div>
    ${body}</div>`, {
    back: () => { if (stopDisc) stopDisc(); stopDisc = null; title(); },
    tab: (b) => joinScreen(b.dataset.t),
    online: () => {
      const c = $('#code').value.trim().toUpperCase();
      if (c.length !== 5) return ui.toast('Room codes have 5 letters', 'bad');
      joinWith('online', c);
    },
    direct: () => {
      const t = parseAddr($('#daddr').value);
      if (!t) return ui.toast('That code doesn\'t look right', 'bad');
      joinWith('direct', t);
    },
    ip: () => {
      const v = $('#ip').value.trim();
      if (!v) return;
      const [ip, port] = v.split(':');
      joinWith('lan', { ip, port: +port || 0 });
    },
    host: (b) => joinWith(tab, tab === 'bt' ? { addr: b.dataset.addr } : { ip: b.dataset.ip, port: +b.dataset.port }),
  });
  if (tab === 'online') {
    const inp = $('#code');
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  } else if (tab === 'lan') {
    let shown = '';
    stopDisc = lanDiscover((list) => {
      const el = $('#found'), key = list.map((h) => `${h.name}|${h.ip}|${h.port}|${h.n}`).join(',');
      if (!el || key === shown) return;
      shown = key;
      el.innerHTML = list.length ? list.map((h) => `<button class="item" data-a="host" data-ip="${esc(h.ip)}" data-port="${h.port}"><div><b>${esc(h.name)}'s game</b><small>${h.n}/4 climbers · ${esc(h.ip)}</small></div><span class="go">JOIN ›</span></button>`).join('')
        : '<div class="empty"><span class="spin"></span>&nbsp; Looking for games...</div>';
    });
  } else {
    bluetoothReady().then((ok) => {
      const el = $('#bt');
      if (!el) return;
      const list = ok ? btDevices() : [];
      el.innerHTML = list.length ? list.map((d) => `<button class="item" data-a="host" data-addr="${esc(d.addr)}"><div><b>${esc(d.name || d.addr)}</b><small>${esc(d.addr)}</small></div><span class="go">JOIN ›</span></button>`).join('')
        : `<div class="empty">${ok ? 'No paired phones. Pair with the host in Android Settings under Bluetooth.' : 'Bluetooth is not ready.'}</div>`;
    });
  }
}

function joinWith(kind, target) {
  if (stopDisc) { stopDisc(); stopDisc = null; }
  const s = new Session('client', settings.name, makeLink(kind), myColor());
  busy('Connecting...', () => { s.close(); joinScreen(kind); });
  wireLobby(s);
  s.on('welcome', (m) => { if (m.game) beginGame(s, m.game); else lobby(s); });
  s.join(target);
}

// ---------- settings & help ----------
const PRESETS = {
  low: { res: 0.55, glow: 0, aa: false, sharp: 0.45, autoRes: true },
  high: { res: 0.75, glow: 1, aa: true, sharp: 0.35, autoRes: true },
  ultra: { res: 1, glow: 1, aa: true, sharp: 0.2, autoRes: true },
};

function settingsScreen(back) {
  app.screen = 'settings';
  const nat = app.renderer.native;
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="seg" data-k="${k}" data-v="${v}" class="${String(settings[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const range = (k, min, max, step, fmt) => `<input type="range" data-k="${k}" data-f="${fmt || ''}" min="${min}" max="${max}" step="${step}" value="${settings[k]}" style="--p:${((settings[k] - min) / (max - min)) * 100}%">`;
  const val = (k, fmt) => `<span class="val" data-v="${k}">${fmtVal(k, fmt)}</span>`;
  const chk = (k, text) => `<label class="chk"><input type="checkbox" data-c="${k}" ${settings[k] ? 'checked' : ''}> ${text}</label>`;
  show(`<div class="panel">${header('Settings')}<div class="set">
    <h3>Graphics</h3>
    <label class="full">Preset${seg('quality', [['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']])}</label>
    ${nat ? `<label>Resolution ${val('res', '%')}${range('res', 0.5, 1, 0.05, '%')}</label>
    <label>Sharpness ${val('sharp', '%')}${range('sharp', 0, 1, 0.05, '%')}</label>
    <label>Glow ${val('glow', '%')}${range('glow', 0, 1.5, 0.05, '%')}</label>
    <label>Frame rate (fps)${seg('cap', [[30, '30'], [60, '60'], [90, '90'], [120, '120']])}</label>
    ${chk('aa', 'Smooth edges (anti aliasing)')}
    ${chk('vsync', 'VSync (frames wait for the screen: smooth, no tearing; off can lower input lag)')}
    ${chk('autoRes', 'Auto resolution (drops a little if the phone struggles)')}
    <p class="sub full" style="margin:0">Pixelated? Turn up Resolution and Sharpness and switch on Smooth edges. If the game stutters, lower Resolution or use 30 fps.</p>` : ''}
    <h3>Controls</h3>
    <label>Button size ${val('btnSize', '%')}${range('btnSize', 0.7, 1.5, 0.05, '%')}</label>
    <label>Button opacity ${val('btnAlpha', '%')}${range('btnAlpha', 0.3, 1, 0.05, '%')}</label>
    <label>Camera speed ${val('sens', '%')}${range('sens', 0.4, 4, 0.05, '%')}</label>
    <label>Aim sensitivity ${val('aimSens', '%')}${range('aimSens', 0.3, 4, 0.05, '%')}</label>
    <label>Buttons on the${seg('lefty', [[false, 'Right'], [true, 'Left']])}</label>
    <button class="btn sm" data-a="layout">Move buttons...</button>
    ${chk('invert', 'Invert camera up and down')}
    <label>Camera follow ${val('camFollow', '%')}${range('camFollow', 0, 2, 0.05, '%')}</label>
    <label>Aim assist ${val('aimHelp', '%')}${range('aimHelp', 0, 1, 0.05, '%')}</label>
    <p class="sub full" style="margin:0">Camera follow swings the camera behind you while you run (0% is off, higher is faster and further). Aim assist pulls the crosshair onto targets (0% is off).</p>
    <h3>Sound and other</h3>
    <label>Music${range('music', 0, 1, 0.05)}</label>
    <label>Sound effects${range('sfx', 0, 1, 0.05)}</label>
    <label>Your name<input id="nm" maxlength="14" value="${esc(settings.name)}" style="background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;padding:9px 12px;outline:none"></label>
    <label>Your stickman colour<div class="swatches">${PALETTE.map((c, i) => `<button data-a="color" data-i="${i}" class="sw ${settings.color === i ? 'on' : ''}" style="background:${css(c)}" aria-label="Colour ${i + 1}"></button>`).join('')}</div></label>
    <div>${chk('haptics', 'Vibration')}${chk('fps', 'Show FPS')}${chk('tips', 'Show tips and ! markers')}</div>
    <button class="btn sm" data-a="tips">Show all tips again</button>
    <p class="sub full" style="margin:0">Graphics chip: ${esc(app.renderer.gpu)}${getSafe() ? ` · safe mode ${getSafe()} of ${MAX_SAFE}` : ''}</p>
    ${getSafe() ? '<button class="btn sm full" data-a="unsafe">Try full graphics again</button>' : ''}
  </div></div>`, {
    unsafe: () => { setSafe(0); restartApp('Restarting with full graphics...'); },
    back: () => { saveSettings(); back(); },
    layout: () => layoutEditor(() => settingsScreen(back)),
    tips: () => { store.set('tipsSeen', []); ui.seen = null; ui.toast('Tips will show again', 'good'); },
    color: (b) => {
      settings.color = +b.dataset.i;
      saveSettings();
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
    },
    seg: (b) => {
      const k = b.dataset.k, v = b.dataset.v;
      settings[k] = k === 'cap' ? +v : k === 'lefty' ? v === 'true' : v;
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
      if (k === 'quality') {
        if (!nat) { saveSettings(); return restartApp('Restarting to apply graphics...'); }
        Object.assign(settings, PRESETS[v]);
        saveSettings();
        applyGraphics();
        return settingsScreen(back);
      }
      saveSettings();
      applyGraphics();
      applyLayout();
    },
  });
  for (const r of document.querySelectorAll('#menu input[type=range]')) {
    r.addEventListener('input', () => {
      settings[r.dataset.k] = +r.value;
      r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
      const v = document.querySelector(`#menu [data-v="${r.dataset.k}"]`);
      if (v) v.textContent = fmtVal(r.dataset.k, r.dataset.f);
      applySettings();
    });
  }
  for (const c of document.querySelectorAll('#menu input[data-c]')) c.addEventListener('change', () => { settings[c.dataset.c] = c.checked; applySettings(); });
  $('#nm').addEventListener('change', (e) => { settings.name = e.target.value.trim().slice(0, 14) || settings.name; saveSettings(); });
}

const fmtVal = (k, fmt) => (fmt === '%' ? Math.round(settings[k] * 100) + '%' : String(settings[k]));

// Native picture settings, applied live.
function applyGraphics() {
  const R = app.renderer;
  if (!R || !R.native) return;
  if (N && N.glQuality) N.glQuality(settings.res);
  if (N && N.glAuto) N.glAuto(!!settings.autoRes);
  // Ask the screen for a refresh rate that matches the cap (phones that can't, keep theirs; the
  // frame limiter below still holds the cap exactly).
  if (N && N.setRefresh) N.setRefresh(settings.cap >= 120 ? 120 : settings.cap >= 90 ? 90 : 60);
  if (N && N.glVsync) N.glVsync(!!settings.vsync);
  R.look.sharp = settings.sharp;
  R.look.aa = !!settings.aa;
  R.look.glow = settings.glow;
  R.q.bloom = settings.glow > 0.01;
}

// Touch buttons: centres measured from the bottom-right corner (bottom-left for left-handed), scaled by size.
const BTN = { bJump: [66, 64, 96], bGrab: [163, 59, 74], bReel: [77, 165, 74], bAct: [167, 149, 74], bShoot: [252, 160, 74], bShield: [252, 72, 74] };
function applyLayout() {
  const k = settings.btnSize, pos = settings.btnPos || {}, side = settings.lefty ? 'left' : 'right', other = settings.lefty ? 'right' : 'left';
  for (const id in BTN) {
    const el = document.getElementById(id);
    if (!el) continue;
    const [dx, dy, size] = BTN[id], c = pos[id] || [dx * k, dy * k], sz = size * k;
    el.style.width = el.style.height = sz + 'px';
    el.style.fontSize = (id === 'bJump' ? 14 : id === 'bAct' ? 10 : 11) * Math.min(1.25, k) + 'px';
    el.style[side] = `calc(${c[0] - sz / 2}px + var(--i${side[0]}))`;
    el.style[other] = 'auto';
    el.style.bottom = `calc(${c[1] - sz / 2}px + var(--ib))`;
  }
  $('#btns').style.setProperty('--ba', settings.btnAlpha);
  if (app.input) app.input.lefty = !!settings.lefty;
}

// Drag-to-place editor for the touch buttons.
function layoutEditor(done) {
  app.screen = 'layout';
  hideMenu();
  const T = $('#touch'), pos = Object.assign({}, settings.btnPos || {});
  T.classList.add('on', 'edit');
  app.input.reset();
  app.input.enabled = false;
  app.input.editing = (id, x, y) => {
    const W = window.innerWidth, H = window.innerHeight;
    pos[id] = [Math.round(clamp(settings.lefty ? x : W - x, 30, W - 30)), Math.round(clamp(H - y, 30, H - 30))];
    settings.btnPos = pos;
    applyLayout();
  };
  const finish = () => {
    app.input.editing = null;
    T.classList.remove('edit');
    if (!app.game) T.classList.remove('on');
    else app.input.enabled = !app.paused;
    saveSettings();
    $('#editBar').onclick = null;
    app.back = null;
    done();
  };
  $('#editBar').onclick = (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    if (b.dataset.e === 'reset') { settings.btnPos = null; for (const k in pos) delete pos[k]; applyLayout(); }
    else finish();
  };
  app.back = finish;
}

function applySettings() {
  app.input.sens = settings.sens;
  app.input.aimSens = settings.aimSens;
  app.input.invert = settings.invert;
  applyGraphics();
  applyLayout();
  app.sound.setVolumes(settings.music, settings.sfx);
  $('#hFps').style.display = settings.fps ? '' : 'none';
  saveSettings();
}

function howTo(back) {
  app.screen = 'how';
  show(`<div class="panel">${header('How to play')}<div class="how">
    <div><b>Move and look</b>Touch the left side to get a stick under your thumb. Drag the right side to turn the camera.</div>
    <div><b>JUMP</b>Tap for a hop, hold for full height. You can still jump for a split second after running off an edge.</div>
    <div><b>GRAB (hold)</b>Clamps you to whatever you're touching, even walls. The ring shows your grip, which drains faster on walls.</div>
    <div><b>REEL (hold)</b>Pulls the cord in to haul a dangling partner up. Let go and it slowly lets out again.</div>
    <div><b>Sling</b>While holding GRAB, hold REEL, then let go of REEL. A partner on a tight cord gets flung upward.</div>
    <div><b>A partner falls</b>Their weight drags you toward the edge. Hold GRAB to stop, or walk away from the edge to haul them up.</div>
    <div><b>GRAPPLE</b>Near a glowing hook the action button says GRAPPLE. Tap it to zip up to the hook and get thrown across the gap.</div>
    <div><b>SHOOT</b>Doors block some bridges. Look at the round target and tap SHOOT to open the door for the whole team. In the forest, SHOOT stuns monsters and bats for a few seconds.</div>
    <div><b>Storm Tower</b>When a yellow ring appears under you, lightning is coming for you: tap SHIELD right away. Rods glow before they strike, so GRAB. Laser bars spin low (jump them) and laser gates switch on and off. Fans and gusts blow you around: GRAB or wait for them to stop. Ice is slippery, cracked floors fall away, pads launch you up.</div>
    <div><b>Sunny Isles</b>The route zig-zags across the lighthouse. Arrow traps fire across the bridges and some platforms swing like pendulums: ride them over.</div>
    <div><b>Magma Chimney</b>You climb up the inside of a volcano. Stand on a vent when it erupts and it launches you up to the ledge above, but standing next to it gets you shoved off. Shadows show where boulders are about to land.</div>
    <div><b>Neon Skyline</b>Climb round a skyscraper, then cross to the next one over a sky bridge or with a GRAPPLE zipline. Conveyor belts carry you along, drones patrol (SHOOT stuns them) and laser gates switch on and off.</div>
    <div><b>Wild Forest</b>Monsters patrol wide ledges and bats circle the gaps. Time your run, hold GRAB, or SHOOT them first.</div>
    <div><b>Falling</b>A fall drops you to whatever is below. Hit the ground and the team restarts at the last checkpoint (Hardcore: back at the start).</div>
    <div><b>Keyboard and gamepad</b><kbd>WASD</kbd> move, <kbd>Space</kbd> jump, <kbd>Shift</kbd> grab, <kbd>E</kbd> reel, <kbd>F</kbd> grapple/shoot, <kbd>Q</kbd> shield, mouse drag to look. Controllers work too.</div>
    <div><b>Saving</b>Your climb saves itself. Solo: Continue on the title screen. Multiplayer: the host can continue the saved climb from the lobby.</div>
  </div></div>`, { back });
}

function message(t, text, then = title) {
  app.screen = 'msg';
  show(`<div class="panel" style="width:min(440px,100%)">${header(esc(t))}<p class="sub">${esc(text)}</p><button class="btn primary sm" data-a="back">OK</button></div>`, { back: then });
}

// ---------- in game ----------
function beginGame(s, g) {
  if (app.game) app.game.destroy();
  if (stopDisc) { stopDisc(); stopDisc = null; }
  hideMenu();
  app.screen = 'game';
  app.paused = false;
  app.input.reset();
  app.input.enabled = true;
  $('#touch').classList.add('on');
  $('#hud').classList.add('on');
  loadMap(g.map || 0);
  for (const r of app.pool.robots) { r.hide(); r.flip = 0; }
  for (const l of app.pool.ropes) l.mesh.visible = false;
  app.game = new Game(app, s, g);
  if (N && N.keepAwake) N.keepAwake(true);
}

function endGame() {
  if (app.game) { app.game.destroy(); app.game = null; }
  app.paused = false;
  app.input.enabled = false;
  app.input.reset();
  $('#touch').classList.remove('on');
  $('#hud').classList.remove('on');
  $('#tags').innerHTML = '';
  ui.clearTips();
  ui.cross(false);
  if (N && N.keepAwake) N.keepAwake(false);
}

function pause() {
  const g = app.game;
  if (!g || g.won) return;
  app.paused = true;
  app.input.reset();
  app.input.enabled = false;
  app.screen = 'pause';
  const mp = !g.solo;
  show(`<div class="pause"><h2>Paused</h2>
    <button class="btn primary" data-a="back"><b>Resume</b></button>
    ${g.diff < 2 ? `<button class="btn" data-a="respawn"><b>Back to checkpoint</b><small>${mp ? 'Moves the whole team' : 'If you are stuck'}</small></button>`
    : `<button class="btn danger" data-a="respawn"><b>Restart the climb</b><small>Hardcore: everyone back to the start</small></button>`}
    <div class="row"><button class="btn sm" data-a="settings">Settings</button><button class="btn sm" data-a="how">How to play</button></div>
    <button class="btn danger" data-a="quit"><b>${mp ? (g.s.isHost ? 'Save and end the game' : 'Leave the game') : 'Save and quit'}</b></button>
    ${mp ? '<p class="note">The climb keeps going for everyone while this menu is open.</p>' : ''}</div>`, {
    back: resume,
    respawn: () => { g.s.toHost({ k: 'restart' }); resume(); },
    settings: () => settingsScreen(pause),
    how: () => howTo(pause),
    quit: () => { if (g.s.isHost) g.save(); endGame(); title(); },
  });
}

function resume() {
  hideMenu();
  app.paused = false;
  app.input.enabled = true;
  app.screen = 'game';
}

app.finish = (r) => {
  app.input.enabled = false;
  app.input.reset();
  setTimeout(() => {
    show(`<div class="results">${r.record ? '<div class="rec">New best time</div>' : ''}<h1>SUMMIT REACHED</h1>
      <p class="sub">${r.players > 1 ? `${r.players} climbers` : 'You'} reached the top of ${MAPS[r.map || 0].name} on ${DIFFS[r.diff].name}.</p>
      <div class="stats"><div><b>${fmtTime(r.time)}</b><small>Time</small></div><div><b>${r.falls}</b><small>Falls</small></div><div><b>${fmtTime(r.best)}</b><small>Best on ${DIFFS[r.diff].name}</small></div></div>
      <button class="btn primary" data-a="back" style="max-width:320px;margin:auto;align-items:center"><b>Back to title</b></button></div>`, {
      back: () => { endGame(); title(); },
    });
  }, 1800);
};

// ---------- Android hooks ----------
window.SMU_back = () => {
  if (app.back) app.back();
  else if (app.game && !app.paused) pause();
  return true;
};
window.SMU_vis = (v) => {
  if (!app.sound) return;
  app.sound.suspend(!v);
  if (!v && app.game && app.game.solo && !app.paused) pause();
};
window.SMU_insets = (l, t, r, b) => {
  const s = document.documentElement.style;
  s.setProperty('--il', l + 'px'); s.setProperty('--it', t + 'px'); s.setProperty('--ir', r + 'px'); s.setProperty('--ib', b + 'px');
};

// ---------- boot & loop ----------
function boot() {
  const safe = getSafe();
  report('stage', { s: 'boot', safe, quality: settings.quality });
  setSimple(safe >= 3);
  // On Android the 3D world is drawn by the app's own OpenGL renderer (never WebGL in the WebView).
  // ?native=rec in a desktop browser records the same stream for the desktop test of that renderer.
  const rec = new URLSearchParams(location.search).get('native') === 'rec';
  let send = null;
  if (N && N.glFrame) {
    N.glQuality(settings.res);
    send = (k, d) => (k === 'def' ? N.glDef(d) : N.glFrame(d));
  } else if (rec) {
    window.REC = { defs: [], frame: null };
    send = (k, d) => (k === 'def' ? window.REC.defs.push(d) : (window.REC.frame = d));
  }
  app.renderer = new Renderer($('#c'), settings.quality, safe, send);
  app.renderer.onLost = () => gfxTrouble('webgl context lost');
  if (N && N.glInfo) app.renderer.gpu = N.glInfo() || 'native OpenGL';
  report('stage', { s: 'renderer', gpu: app.renderer.gpu, native: !!send, maxPx: app.renderer.maxPx });
  loadMap(settings.map);
  report('stage', { s: 'world' });
  app.pool = makePool(app.renderer.scene);
  app.fx = new Fx(app.renderer.scene);
  app.input = new Input($('#touch'));
  app.input.onPause = () => { if (app.screen === 'game') pause(); else if (app.screen === 'pause') resume(); };
  app.sound = new Sound();
  applySettings();
  $('#hPause').addEventListener('click', () => { app.sound.ui(); pause(); });
  document.addEventListener('pointerdown', () => app.sound.init(), { capture: true });
  window.addEventListener('resize', () => app.renderer.resize());
  if (N && N.insets) { const i = JSON.parse(N.insets()); window.SMU_insets(i.l, i.t, i.r, i.b); }
  title();
  requestAnimationFrame(frame);
  setTimeout(() => $('#loading').classList.add('gone'), 300);
}

let last = performance.now(), titleT = 0, bolt = 2, fpsN = 0, fpsT = 0, then = 0;
const perf = { ms: 0, max: 0, n: 0, show: '' };
function frame(now) {
  requestAnimationFrame(frame);
  // Frame limiter: never more frames than the chosen frame rate, on any screen. A frame is drawn once its
  // slot comes round (1 ms of slack for timer jitter) and the next slot is exactly one interval later, so
  // the average lands on the cap even when the screen's refresh rate isn't a multiple of it. After a
  // stall it starts counting again instead of rushing to catch up.
  const iv = 1000 / (settings.cap || 60);
  if (now - then < iv - 1) return;
  then += iv;
  if (now - then > iv) then = now;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const w0 = performance.now();
  heartbeat(now);
  if (app.game) app.game.update(dt, app.paused);
  else titleScene(dt);
  if (app.renderer.lost) return;
  app.renderer.render();
  app.pool.tick();
  const work = performance.now() - w0;
  perf.ms += work;
  perf.n++;
  if (work > perf.max) perf.max = work;
  if (++health.frames === 1 || health.frames === 60) report('stage', { s: 'frame' + health.frames, ms: Math.round(now - health.since) });
  checkGpu();
  fpsN++;
  if ((fpsT += dt) > 0.5) {
    perf.show = `${Math.round(fpsN / fpsT)} fps · ${(perf.ms / Math.max(1, perf.n)).toFixed(1)}/${perf.max.toFixed(0)} ms`;
    if (settings.fps) $('#hFps').textContent = perf.show;
    fpsN = 0; fpsT = 0; perf.ms = 0; perf.n = 0; perf.max = 0;
  }
}

// ---------- GPU safety ----------
// Graphics level for this launch: 0 full up to 4 (bare minimum). On Android it lives in the app's own storage
// so it survives a crash or forced restart; in a desktop browser it lives in the settings. The Android side
// also runs its own watchdog (white screen on the real display, frozen game) and steps the level up itself.
const MAX_SAFE = 4;
const getSafe = () => (N && N.getSafe ? N.getSafe() : settings.gfxSafe || 0);
function setSafe(v) {
  settings.gfxSafe = v;
  saveSettings();
  if (N && N.setSafe) N.setSafe(v);
}

// Restart the whole app: graphics are never rebuilt in place, because deleting GPU objects is exactly
// what crashes some phone drivers. A fresh process starts clean with the new settings.
function restartApp(msg) {
  if (app.restarting) return;
  app.restarting = true;
  if (app.game && app.game.s.isHost) app.game.save();
  if (msg) ui.toast(msg);
  setTimeout(() => (N && N.restart ? N.restart() : location.reload()), 900);
}

// The picture broke (lost GPU context, broken render output): drop one graphics level and restart.
function gfxTrouble(why) {
  report('trouble', { why });
  const cur = getSafe();
  if (cur >= MAX_SAFE) {
    if (!app.gfxFailShown) {
      app.gfxFailShown = true;
      message('Graphics problem', `This phone's graphics driver (${app.renderer.gpu}) keeps failing, even in the safest mode.`);
    }
    return;
  }
  setSafe(cur + 1);
  restartApp('Fixing graphics for this phone...');
}

const health = { t: performance.now(), beat: 0, white: 0, rb: null, px: new Uint8Array(4), since: performance.now(), healthy: false, frames: 0 };

// Once a second: tell the Android watchdog the game is alive, with a summary for diagnostics.
function heartbeat(now) {
  if (now - health.beat < 1000) return;
  health.beat = now;
  if (!(N && N.beat)) return;
  const R = app.renderer;
  N.beat(JSON.stringify({
    f: health.frames, scr: app.screen, gpu: R && R.gpu, safe: R && R.safe, q: settings.quality, lost: R && R.lost, native: !!(R && R.native),
    buf: R && R.r ? [R.r.getContext().drawingBufferWidth, R.r.getContext().drawingBufferHeight] : null, rb: health.rb,
    errs: errs.slice(-4), perf: perf.show, bytes: R && R.mirror ? R.mirror.bytes : 0,
  }));
}

function checkGpu() {
  const R = app.renderer, now = performance.now();
  if (R.lost || app.restarting || R.native) return;
  if (!health.healthy && now - health.since > 20000 && !health.white) {
    health.healthy = true;
    if (N && N.healthy) N.healthy();
  }
  if (now - health.t < (health.white ? 800 : 4000)) return;
  health.t = now;
  // Read the drawing buffer: catches broken render output (the native probe sees the real screen).
  const gl = R.r.getContext();
  R.r.setRenderTarget(null);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, cols = [];
  let white = 0, black = 0;
  for (const [x, y] of [[0.15, 0.2], [0.85, 0.2], [0.5, 0.5], [0.15, 0.8], [0.85, 0.8]]) {
    gl.readPixels((x * w) | 0, (y * h) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, health.px);
    const p = health.px;
    cols.push(((p[0] << 16) | (p[1] << 8) | p[2]).toString(16));
    if (p[0] > 235 && p[1] > 235 && p[2] > 235) white++;
    if (p[0] < 4 && p[1] < 4 && p[2] < 4) black++;
  }
  health.rb = cols.join(' ');
  health.white = white === 5 || black === 5 ? health.white + 1 : 0;
  if (health.white >= 3) gfxTrouble(white === 5 ? 'render buffer white' : 'render buffer black');
}

// Behind the menus: all four stickmen free-run up the first stretch of the climb in a line, tied
// together by their cords, hopping from platform to platform with flips. The camera stays high and
// cycles through a few shots (high chase, overhead orbit, side track, wide view of the tower).
const RUN = { path: null, level: null, segs: null, total: 0, t: 0, prev: [], chains: null, cam: null, look: null, shot: 0, shotT: 0 };
app.titleRun = RUN; // for the dev screenshot scripts
function runnerPath(L) {
  // The first zone's route platforms in the order the climb goes. It's a show, so the runners take big
  // superhero leaps over bridges and gaps; they only stop where the route jumps somewhere far away.
  const C = L.cols.filter((c) => (c.kind === 'plat' || c.kind === 'branch' || c.kind === 'pad' || c.kind === 'conveyor') && c.zone === 0 && c.y < 90);
  const pts = [];
  for (const c of C) {
    const p = { x: c.x, y: c.y + c.hy, z: c.z }, q = pts[pts.length - 1];
    if (q) {
      const d = Math.hypot(p.x - q.x, p.z - q.z), dy = p.y - q.y;
      if (d < 1.5) continue;
      if (d > 16 || dy > 6 || dy < -5) { if (pts.length >= 8) break; pts.length = 0; }
    }
    pts.push(p);
    if (pts.length >= 36) break;
  }
  return pts;
}

// Where a runner is t seconds into the loop: a short run across each platform, then a hop (every third a flip).
function runnerAt(t, out) {
  const P = RUN.path, S = RUN.segs;
  t = ((t % RUN.total) + RUN.total) % RUN.total;
  let k = 0;
  while (k < S.length - 1 && t >= S[k].end) k++;
  const a = P[k], b = P[k + 1], s = S[k], u = t - s.start, ux = s.ux, uz = s.uz;
  out.flip = 0;
  if (u < s.run) {
    const f = u / s.run;
    out.x = a.x - ux * 0.5 + ux * f; out.y = a.y; out.z = a.z - uz * 0.5 + uz * f; out.ground = true;
  } else {
    const f = Math.min(1, (u - s.run) / s.hop), sx = a.x + ux * 0.5, sz = a.z + uz * 0.5, ex = b.x - ux * 0.5, ez = b.z - uz * 0.5;
    const h = Math.max(0.9, b.y - a.y + 0.9, Math.hypot(ex - sx, ez - sz) * 0.18);
    out.x = sx + (ex - sx) * f; out.y = a.y + (b.y - a.y) * f + 4 * h * f * (1 - f); out.z = sz + (ez - sz) * f; out.ground = false;
    if (k % 3 === 2) out.flip = -Math.PI * 2 * (f * f * (3 - 2 * f));
  }
  out.k = k;
  return out;
}
function titleRunners(dt) {
  const L = app.level;
  if (RUN.level !== L) {
    RUN.level = L; RUN.path = runnerPath(L); RUN.t = 0; RUN.cam = null; RUN.chains = null;
    const P = RUN.path, S = [];
    let t = 0;
    for (let k = 0; k + 1 < P.length; k++) {
      const dx = P[k + 1].x - P[k].x, dz = P[k + 1].z - P[k].z, d = Math.hypot(dx, dz) || 1, run = 0.32, hop = 0.42 + d * 0.045;
      S.push({ start: t, end: t + run + hop, run, hop, ux: dx / d, uz: dz / d });
      t += run + hop;
    }
    RUN.segs = S; RUN.total = t;
  }
  if (!RUN.path || RUN.path.length < 4 || !app.pool || app.pool.warm > 0) return null;
  RUN.t += dt;
  const pool = app.pool, PR = 0.42, pos = [], c = { x: 0, y: 0, z: 0 };
  if (!RUN.chains) RUN.chains = [0, 1, 2].map(() => new Chain(12));
  for (let j = 0; j < 4; j++) {
    const r = pool.robots[j], o = runnerAt(RUN.t - j * 0.45, {}), prev = RUN.prev[j] || o;
    const vx = (o.x - prev.x) / Math.max(dt, 1e-3), vy = (o.y - prev.y) / Math.max(dt, 1e-3), vz = (o.z - prev.z) / Math.max(dt, 1e-3);
    const jumpBack = Math.hypot(o.x - prev.x, o.z - prev.z) > 4; // looped back to the start
    RUN.prev[j] = o;
    r.flip = o.flip;
    r.setColor(j === 0 ? myColor() : COLORS[j]);
    r.show();
    r.update(dt, o.x, o.y + PR, o.z, jumpBack ? 0 : vx, o.ground || jumpBack ? 0 : vy, jumpBack ? 0 : vz, o.ground ? 1 | 64 : 0, 0, o.y);
    if (jumpBack && j < 3) RUN.chains[j].ok = false;
    if (jumpBack && j > 0) RUN.chains[j - 1].ok = false;
    pos.push({ x: o.x, y: o.y + PR, z: o.z, k: o.k });
    c.x += o.x / 4; c.y += o.y / 4; c.z += o.z / 4;
  }
  // Cords between neighbours in the line.
  for (let j = 0; j < 3; j++) {
    const ch = RUN.chains[j], rope = pool.ropes[j], A = pos[j], B = pos[j + 1];
    rope.setColors(j === 0 ? myColor() : COLORS[j], COLORS[j + 1]);
    ch.step(A, B, 6.5, app.world, Math.min(dt, 0.05));
    rope.mesh.visible = true;
    rope.update(ch.p, Math.max(0, Math.min(1, (Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) / 6.5 - 0.85) / 0.15)), titleT);
  }
  return { lead: pos[0], center: c };
}

function titleScene(dt) {
  titleT += dt;
  app.sound.setStyle('menu');
  app.sound.setIntensity(0.6);
  const R = app.renderer, cam = R.camera, g = titleRunners(dt);
  if (g) {
    // Shots, each about 8 s, blended smoothly. All of them look down from well above the route.
    const p = g.center, lead = g.lead, r = Math.hypot(p.x, p.z) || 1, ox = p.x / r, oz = p.z / r;
    RUN.shotT += dt;
    if (RUN.shotT > 8) { RUN.shotT = 0; RUN.shot = (RUN.shot + 1) % 4; }
    const s = RUN.shot, a = titleT * 0.25;
    let want, look;
    if (s === 0) { want = { x: p.x + ox * 7, y: p.y + 7, z: p.z + oz * 7 }; look = { x: lead.x, y: lead.y, z: lead.z }; }
    else if (s === 1) { want = { x: p.x + Math.cos(a) * 7, y: p.y + 12, z: p.z + Math.sin(a) * 7 }; look = { x: p.x, y: p.y, z: p.z }; }
    else if (s === 2) { want = { x: lead.x + ox * 8 - oz * 3, y: lead.y + 5, z: lead.z + oz * 8 + ox * 3 }; look = { x: lead.x, y: lead.y + 0.6, z: lead.z }; }
    else { want = { x: ox * 30 + Math.cos(a * 0.4) * 6, y: p.y + 16, z: oz * 30 + Math.sin(a * 0.4) * 6 }; look = { x: p.x * 0.6, y: p.y + 4, z: p.z * 0.6 }; }
    const C = RUN.cam || (RUN.cam = { ...want }), Lk = RUN.look || (RUN.look = { ...look }), k = Math.min(1, dt * 1.6);
    for (const ax of ['x', 'y', 'z']) { C[ax] += (want[ax] - C[ax]) * k; Lk[ax] += (look[ax] - Lk[ax]) * Math.min(1, dt * 3); }
    cam.position.set(C.x, C.y, C.z);
    cam.lookAt(Lk.x, Lk.y, Lk.z);
  } else {
    const a = titleT * 0.045 + 0.6, y = 16 + Math.sin(titleT * 0.08) * 9;
    cam.position.set(Math.cos(a) * 36, y, Math.sin(a) * 36);
    cam.lookAt(0, y + 6, 0);
  }
  if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  app.world.setTime(titleT);
  R.update(dt, cam.position, app.level.zones[0], 0, { x: 0, z: 0 });
  R.shadowFocus(cam.position.x, cam.position.y - 2, cam.position.z);
  app.view.camPos = cam.position;
  app.view.update(titleT, dt, app.titleStorm);
  if ((bolt -= dt) <= 0 && app.level.mapKey === 'storm') {
    bolt = 3 + Math.random() * 6;
    const b = Math.random() * Math.PI * 2, r = 80 + Math.random() * 160;
    R.bolt(Math.cos(b) * r, 0, Math.sin(b) * r, 2.4);
    app.sound.thunder(r);
  }
}

boot();
