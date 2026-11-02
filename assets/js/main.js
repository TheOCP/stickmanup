// App shell: boot, menus, lobby flows, HUD and the main loop.
import * as THREE from 'three';
import { Renderer } from './render.js';
import { generateLevel, DIFFS, MAPS, LEVEL_VERSION, cpEnabled } from './level.js';
import { EMOTES } from './emotes.js';
import { World } from './physics.js';
import { WorldView, setSimple } from './worldview.js';
import { setDetail } from './scenery.js';
import { AutoQ, STEPS } from './autoq.js';
import { PadNav } from './padnav.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Storm } from './storm.js';
import * as cloud from './cloud.js';
import { Session, PROTO, makeLink, lanDiscover, btPrepare, btDevices, lanAddresses, hasNative, MAX_PLAYERS, exposeHost, addrToCode, parseAddr } from './net.js';
import { Game } from './game.js';
import { COLORS, makePool } from './robot.js';
import { css } from './colors.js';
import { SUIT, resolveLook, plainLook, roleOf, tagColor } from './skins.js';
import { initProfile, myLook, nameChanged, owned, wonOnce, coins as myCoins } from './profile.js';
import { openShop, openRecords } from './shop.js';
import { Chain } from './chain.js';
import { Fx } from './fx.js';
import { PR, PC } from './player.js';
import { store, fmtTime, clamp } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const N = window.Native;
const VERSION = N && N.version ? N.version() : 'dev';

// Picture: res = render resolution (share of the screen), autoRes lets it drop when the phone struggles,
// sharp 0..1, aa = edge anti-aliasing, glow 0..1.5, cap = frame rate. Controls: btnSize, btnAlpha, lefty, btnPos.
const settings = Object.assign({ quality: 'high', sens: 1, invert: false, music: 0.5, sfx: 0.8, haptics: true, fps: false, name: '', gfxSafe: 0, map: 0,
  res: 0.75, autoRes: true, autoLvl: 0, deadL: 0.16, deadR: 0.16, sharp: 0.35, aa: true, glow: 1, cap: 60, btnSize: 1, btnAlpha: 0.9, lefty: false, fpsPos: null, btnPos: null, aimSens: 1,
  camFollow: 1, aimHelp: 0.5, tips: true, color: 0, vsync: true, rules: { cps: -1, haz: -1, rope: -1 } }, store.get('settings', {}));
if (![30, 60, 90, 120].includes(settings.cap)) settings.cap = 60;
// The colour you picked before there were suits becomes your first suit.
initProfile(settings.color);
const myColor = () => tagColor(SUIT[myLook(settings.name).s].c);
let myResolved = null;
const myOutfit = () => myResolved || (myResolved = resolveLook(myLook(settings.name), settings.name));
// Something you wear changed: everyone in the game should see it.
function lookChanged() {
  myResolved = null;
  if (app.game) { app.game.s.setMe(settings.name, myColor(), myLook(settings.name)); app.game.refreshPlayers(); }
}
// Custom rules for a new climb. -1 means Auto (follow the difficulty).
const RULES = [
  ['cps', 'Checkpoints', ['Every zone', 'A few', 'None']],
  ['haz', 'Obstacles', ['Calm', 'Normal', 'Wild']],
  ['rope', 'Cord', ['Long', 'Normal', 'Short']],
];
const cleanRules = (r = {}) => { const o = {}; for (const [k] of RULES) if (r[k] >= 0) o[k] = r[k]; return o; };
function rulesHtml(r, editable, solo) {
  return `<div class="rules">${RULES.filter(([k]) => !(solo && k === 'rope')).map(([k, name, opts]) => `<label>${name}<div class="seg ${editable ? '' : 'ro'}">${[['-1', 'Auto'], ...opts.map((o, i) => [String(i), o])]
    .map(([v, l]) => `<button data-a="rule" data-k="${k}" data-v="${v}" class="${String(r[k] ?? -1) === v ? 'on' : ''}">${l}</button>`).join('')}</div></label>`).join('')}</div>
    <p class="sub" style="margin:6px 0 0">Auto follows the difficulty. Harder difficulties switch on more obstacles and make them faster.</p>`;
}
const roleTag = (p) => { const r = roleOf(p.look, p.name); return r ? `<em class="role">${r}</em>` : ''; };
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
  coins(n, pop) {
    const el = $('#hCoins');
    el.innerHTML = `<i class="coin"></i>${n}`;
    if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  },
  // A big message in the middle, like the zone titles.
  banner(small, big, sub, color) {
    const el = $('#zoneTitle');
    el.querySelector('small').textContent = small;
    el.querySelector('h2').textContent = big;
    el.querySelector('p').textContent = sub;
    el.style.setProperty('--zc', color);
    el.classList.add('show');
    clearTimeout(this.zt);
    this.zt = setTimeout(() => el.classList.remove('show'), 5000);
  },
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
    $('#hPlayers').innerHTML = g.solo ? '' : [...g.s.players.values()].map((p) => `<div data-s="${p.slot}" style="color:${pcol(g.s, p.slot)}"><i></i><span>${esc(p.name)}${p.slot === g.slot ? ' (you)' : ''}</span>${roleTag(p)}<small></small></div>`).join('');
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
    const db = $('#bDash');
    db.style.setProperty('--v', (me.dashReady ? 1 - me.dashCd / PC.DASH_CD : 0).toFixed(3));
    db.classList.toggle('used', !me.dashReady);
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
    let nearD = 24;
    this.nearTip = null;
    for (let i = 0; i < L.signs.length; i++) {
      const s = L.signs[i], key = L.map + ':' + i, d = Math.hypot(s.x - me.x, s.y - me.y, s.z - me.z);
      let el = this.tipEls.get(i);
      if (d < 7 && !seen.has(key)) { seen.add(key); store.set('tipsSeen', [...seen]); this.tip(s.text); }
      v.set(s.x, s.y - 0.7, s.z).project(cam);
      const show = d < 24 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!show) { if (el) el.style.display = 'none'; continue; }
      if (d < nearD) { nearD = d; this.nearTip = s.text; } // the direction pad reads this one, there is no finger to tap it
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
  // Name tags just above each other player's head. The camera has moved this frame, so its matrices are
  // brought up to date before projecting (otherwise the tags trail a frame behind and swim around).
  // A player behind you has no tag; one just off screen gets a tag pinned to the edge.
  tags(g) {
    const box = $('#tags'), cam = app.renderer.camera, W = window.innerWidth, H = window.innerHeight, v = this.v || (this.v = new THREE.Vector3());
    cam.updateMatrixWorld();
    for (const [slot, o] of g.vis || []) {
      let el = box.querySelector(`[data-s="${slot}"]`);
      const p = g.s.players.get(slot);
      if (!p) { if (el) el.remove(); continue; }
      if (!el) {
        el = document.createElement('div');
        el.dataset.s = slot;
        el.style.color = pcol(g.s, slot);
        const role = roleOf(p.look, p.name);
        el.textContent = (role ? role + ' · ' : '') + p.name;
        box.appendChild(el);
      }
      v.set(o.x, o.y + 1.45, o.z).project(cam);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
      const cx = clamp(x, 50, W - 50), cy = clamp(y, 70, H - 20);
      el.classList.toggle('edge', cx !== x || cy !== y);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
    }
    // Emoji floating over whoever just did an emote.
    const B = this.bubbles;
    if (B && B.size) {
      const now = performance.now();
      for (const [slot, b] of B) {
        const o = slot === g.slot ? g.me : g.vis && g.vis.get(slot);
        if (now > b.until || !o || !b.el.isConnected) { b.el.remove(); B.delete(slot); continue; }
        v.set(o.x, o.y + 1.6, o.z).project(cam);
        b.el.style.display = v.z > 1 ? 'none' : '';
        b.el.style.left = ((v.x + 1) / 2) * W + 'px';
        b.el.style.top = ((1 - v.y) / 2) * H + 'px';
      }
    }
  },
  bubble(slot, icon) {
    const B = this.bubbles || (this.bubbles = new Map()), old = B.get(slot);
    if (old) old.el.remove();
    const el = document.createElement('span');
    el.className = 'emoB';
    el.textContent = icon;
    $('#tags').appendChild(el);
    B.set(slot, { el, until: performance.now() + 2000 });
  },
});

// ---------- emote menu ----------
// Sits over the climb without pausing it. Only what you own shows; the shop sells the rest.
const emoteOpen = () => $('#emoteMenu').classList.contains('on');
function closeEmotes() {
  if (!emoteOpen()) return;
  $('#emoteMenu').className = '';
  $('#emoteMenu').innerHTML = '';
  app.input.lockPad(false);
}
function openEmotes(viaPad) {
  if (app.screen !== 'game' || !app.game) return;
  const name = settings.name, list = EMOTES.filter((e) => !e.hidden && owned(e, name)), more = EMOTES.filter((e) => !e.hidden).length - list.length;
  $('#emoteMenu').innerHTML = `<div class="emHead"><b>Emotes</b><small>${more ? `${more} more in the shop` : 'You have them all'}</small></div>
    <div class="emGrid">${list.map((e) => `<button class="emo r${e.r}" data-em="${e.id}"><i>${e.icon}</i><span>${esc(e.name)}</span></button>`).join('')}</div>`;
  $('#emoteMenu').className = 'on';
  app.sound.ui();
  if (viaPad) { app.input.lockPad(true); nav.setUsing(true); }
}
function toggleEmotes(viaPad) {
  if (emoteOpen()) closeEmotes();
  else openEmotes(viaPad);
}

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
  if (auto) auto.settle();
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

const shopCtx = { app, show, esc, ui, header, name: () => settings.name, lookChanged };

function title() {
  app.screen = 'title';
  const save = validSave('save.solo'), best = bestOf(settings.map), M = MAPS[settings.map], acct = cloud.account();
  loadMap(settings.map);
  // The first time, and whenever the terms have changed, ask before anything else.
  if ((cloud.termsNeeded() && !app.termsAsked) || (cloud.serverUrl() && !store.get('welcomed'))) {
    store.set('welcomed', 1);
    app.termsAsked = true;
    return accountScreen(title);
  }
  show(`<div class="title">
    <div class="brand">
      <div class="logo">STICKMAN<span>UP</span></div>
      <p class="tag">Up to four stickmen, tied together by a glowing cord. Six giant climbs: a storm tower, a sunny lighthouse, a monster forest, a volcano, a neon city and a waterfall paradise. If one falls, everyone feels it.</p>
      <p class="ver">v${esc(VERSION)} · ${M.name} · ${Object.keys(best).length ? 'Best ' + Object.entries(best).map(([d, t]) => `${DIFFS[d].name} ${fmtTime(t)}`).join(' · ') : 'Not climbed yet'}</p>
      <p class="ver made">Made by TheOCProductions &amp; ShortGG</p>
      <button class="btn sm donate" data-a="donate">♥ Donate</button>
    </div>
    <div class="mainbtns">
      ${save ? `<button class="btn primary" data-a="cont"><b>Continue climb</b><small>${MAPS[save.map || 0].name} · ${DIFFS[save.diff].name} · ${Math.round(save.pos[1] - 2)} m · ${fmtTime(save.t)}</small></button>` : ''}
      <button class="btn ${save ? '' : 'primary'}" data-a="solo"><b>Solo climb</b><small>Pick a map and practise on your own</small></button>
      <button class="btn" data-a="host"><b>Host a game</b><small>Server, online, WiFi or Bluetooth</small></button>
      <button class="btn" data-a="join"><b>Join a game</b><small>Room code or a game nearby</small></button>
      <div class="row"><button class="btn sm" data-a="browser">Server browser</button><button class="btn sm acctbtn" data-a="account">${acct ? esc(acct.user.name) : 'Sign in'}</button></div>
      <div class="row"><button class="btn sm shopbtn" data-a="shop"><span>Shop</span><span class="wal"><i class="coin"></i>${myCoins()}</span></button><button class="btn sm" data-a="records">Records</button></div>
      <div class="row"><button class="btn sm" data-a="settings">Settings</button><button class="btn sm" data-a="how">How to play</button></div>
    </div></div>`, {
    shop: () => { app.screen = 'shop'; openShop(shopCtx, title); },
    records: () => { app.screen = 'records'; openRecords(shopCtx, title, settings.map); },
    cont: () => startSolo(save.map || 0, save.diff, save),
    solo: soloPick,
    host: hostPick,
    join: () => joinScreen(cloud.serverUrl() ? 'server' : 'online'),
    browser: () => browserScreen(title),
    account: () => accountScreen(title),
    donate: openDonate,
    settings: () => settingsScreen(title),
    how: () => howTo(title),
    back: () => { if (N && N.exit) N.exit(); },
  }, false);
}

function diffCards(sel) {
  const best = bestOf(settings.map), icons = ['◆', '◆◆', '◆◆◆', '◆◆◆◆'];
  return `<div class="cards">${DIFFS.map((d) => `<button class="card d${d.id} ${sel === d.id ? 'sel' : ''}" data-a="pick" data-d="${d.id}">
    <span class="ic">${icons[d.id]}</span><b>${d.name}</b><small>${d.desc}</small><span class="best">${best[d.id] ? 'Best ' + fmtTime(best[d.id]) : 'Not climbed yet'}</span>${wonOnce(d.id) ? '' : `<span class="best first">First win pays ${d.first} coins</span>`}</button>`).join('')}</div>`;
}

function soloPick() {
  app.screen = 'solo';
  const save = validSave('save.solo');
  show(`<div class="panel">${header('Solo climb')}
    ${mapCards(settings.map)}
    <div class="kind" style="margin:14px 0 0">Rules</div>
    ${rulesHtml(settings.rules, true, true)}
    <p class="sub" style="margin-top:14px">Pick a difficulty to start. Solo has no cord partner, so the teamwork tricks aren't needed${save ? '. Starting a new climb replaces your saved one.' : '.'}</p>
    ${diffCards(-1)}</div>`, {
    back: title,
    rule: (b) => {
      settings.rules[b.dataset.k] = +b.dataset.v;
      saveSettings();
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
    },
    map: (b) => pickMap(+b.dataset.m, soloPick),
    pick: (b) => startSolo(settings.map, +b.dataset.d, null),
  });
}

function startSolo(map, diff, save) {
  const s = new Session('solo', settings.name, null, myColor(), myLook(settings.name));
  beginGame(s, { map, diff, rules: save ? save.rules || {} : cleanRules(Object.assign({}, settings.rules, { rope: -1 })), t0: 0, base: save ? save.t : 0, cp: save ? save.cp : 0, falls: save ? save.falls : 0, doors: save ? save.doors : null, pos: save ? { 0: save.pos } : null });
}

// ---------- hosting ----------
function hostPick() {
  app.screen = 'host';
  show(`<div class="panel">${header('Host a game')}
    <p class="sub">Up to 4 climbers. Everyone needs StickManUp, and the same version.</p>
    <div class="cards">
      <button class="card" data-a="server"><span class="ic">🖥</span><b>Game server</b><small>Public or private, with a password if you like. Works on every network.</small></button>
      <button class="card" data-a="go" data-k="online"><span class="ic">🌐</span><b>Online</b><small>A 5 letter room code. Easiest, but some networks (often mobile data) block it.</small></button>
      <button class="card" data-a="go" data-k="direct"><span class="ic">⇄</span><b>Internet (direct)</b><small>No server at all: friends connect straight to your phone. Host from a home WiFi.</small></button>
      <button class="card" data-a="go" data-k="lan"><span class="ic">📶</span><b>WiFi / hotspot</b><small>Same WiFi, or friends join your phone's hotspot. No internet needed, lowest lag.</small></button>
      <button class="card" data-a="go" data-k="bt"><span class="ic">ᛒ</span><b>Bluetooth</b><small>No WiFi at all. Pair the phones in Android settings first. Slower link.</small></button>
    </div></div>`, {
    back: title,
    server: () => roomForm(hostPick),
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

async function hostWith(kind, roomOpts) {
  if (kind === 'bt' && !(await bluetoothReady())) return;
  const s = new Session('host', settings.name, makeLink(kind, kind === 'server' ? { url: cloud.wsUrl(), room: Object.assign({ map: settings.map, diff: 1 }, roomOpts) } : undefined), myColor(), myLook(settings.name));
  let cancelled = false;
  busy(kind === 'server' ? 'Opening your room...' : kind === 'online' ? 'Opening an online room...' : kind === 'direct' ? 'Opening your router for friends...' : 'Starting...', () => { cancelled = true; s.close(); hostPick(); });
  wireLobby(s);
  const r = await s.host();
  if (cancelled) return;
  if (!r.ok) { s.close(); ui.toast(r.err || 'Could not start the game', 'bad'); return hostPick(); }
  const mp = validSave('save.mp');
  s.lobby.map = settings.map;
  if (mp) s.lobby.diff = mp.diff;
  app.room = { kind, code: r.code, ips: kind === 'lan' ? (r.ips || lanAddresses()) : [], name: r.name, pub: r.pub, locked: r.locked };
  if (kind === 'server') s.sendLobby();
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
  s.on('error', (e) => {
    ui.toast(e, 'bad');
    if (!s.isHost && !app.game) { s.close(); if (app.joinBack) app.joinBack(); else joinScreen(app.joinTab || 'online'); }
    // The server connection is gone: nobody can reach this room any more.
    else if (s.isHost && app.room && app.room.kind === 'server') { if (app.game && app.game.s === s) { endGame(); message('Disconnected', e); } else if (app.screen === 'lobby') { s.close(); message('Disconnected', e); } }
  });
  s.on('start', (g) => beginGame(s, g));
  s.on('closed', (why) => { if (app.game && app.game.s === s) { endGame(); message('Disconnected', why); } else if (app.screen === 'lobby') { message('Disconnected', why); } });
}

function lobby(s) {
  app.screen = 'lobby';
  const host = s.isHost, room = app.room || {}, mp = host ? validSave('save.mp') : null;
  let info;
  if (!host) info = `<div class="kind">Connected</div><p>You're in. The host picks the map and difficulty and starts the climb.</p><p>Ping: ${s.ping || '...'} ms</p>`;
  else if (room.kind === 'server') info = `<div class="kind">${room.pub ? 'Public room' : 'Private room'}${room.locked ? ' · password' : ''}</div><div class="code">${esc(room.code)}</div><p><b>${esc(room.name)}</b></p><p>${room.pub ? 'It shows in the server browser. Friends can also tap <b>Join a game</b> and type this code.' : 'Not in the server browser. Friends tap <b>Join a game</b> and type this code.'}${room.locked ? ' They also need your password.' : ''}</p>${N && N.share ? '<button class="btn sm" data-a="share" style="margin-top:8px">Share code</button>' : ''}`;
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
    slots.push(p ? `<div class="slot" style="color:${pcol(s, i)}"><span class="dot"></span><span style="color:var(--tx)">${esc(p.name)}${i === s.slot ? ' (you)' : ''}${i === 0 ? ' · host' : ''}</span>${roleTag(p)}<small>${p.ping ? p.ping + ' ms' : ''}</small></div>` : `<div class="slot empty">Open slot</div>`);
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
        <div class="kind" style="margin:10px 0 6px">Rules</div>
        ${rulesHtml(resume ? mp.rules || {} : s.lobby.rules || {}, host && !resume)}
        <label class="toggle"><input type="checkbox" data-a="nocord" ${(resume ? mp.noCord : s.lobby.noCord) ? 'checked' : ''} ${host && !resume ? '' : 'disabled'}> Play without the cord (nobody is tied together, and everyone keeps their own checkpoint)</label>
        ${mp ? `<label class="toggle"><input type="checkbox" data-a="resume" ${resume ? 'checked' : ''}> Continue the saved climb (${MAPS[mp.map || 0].name}, ${DIFFS[mp.diff].name}, ${Math.round(mp.pos[1] - 2)} m, ${fmtTime(mp.t)})</label>` : ''}
        ${host ? `<button class="btn primary" data-a="start" style="margin-top:12px"><b>Start the climb</b><small>${s.players.size} climber${s.players.size > 1 ? 's' : ''} ready${s.players.size === 1 ? ' (you can start alone and friends can join while you climb)' : ''}</small></button>`
    : `<p class="sub" style="margin-top:14px"><span class="spin"></span>&nbsp; Waiting for the host to start...</p>`}
      </div>
    </div></div>`, {
    back: () => { s.close(); title(); },
    share: () => N.share(room.kind === 'server' ? `Join my StickManUp climb! Open StickManUp, tap Join a game and type the code ${room.code}` : room.kind === 'direct' ? `Join my StickManUp climb! Open StickManUp, tap Join a game, then Direct, and type the code ${room.code}` : `Join my StickManUp climb! Open StickManUp, tap Join a game, then Online, and type the code ${room.code}`),
    diff: (b) => { if (host) s.setLobby({ diff: +b.dataset.d }); },
    lmap: (b) => { if (host) { settings.map = +b.dataset.m; saveSettings(); loadMap(settings.map); s.setLobby({ map: settings.map }); } },
    resume: (b) => s.setLobby({ resume: b.checked }),
    nocord: (b) => { if (host) s.setLobby({ noCord: b.checked }); },
    rule: (b) => { if (host && !resume) s.setLobby({ rules: Object.assign({}, s.lobby.rules, { [b.dataset.k]: +b.dataset.v }) }); },
    start: () => {
      const save = s.lobby.resume && mp;
      const pos = {};
      if (save) for (const k of s.players.keys()) pos[k] = [save.pos[0] + k * 0.3, save.pos[1] + k * 1.0, save.pos[2]];
      s.startGame({ map: save ? save.map || 0 : s.lobby.map || 0, diff: save ? save.diff : s.lobby.diff, noCord: save ? !!save.noCord : !!s.lobby.noCord, rules: save ? save.rules || {} : cleanRules(s.lobby.rules), t0: performance.now(), base: save ? save.t : 0, cp: save ? save.cp : 0, pcp: save ? save.pcp : null, falls: save ? save.falls : 0,
        doors: save ? save.doors : null, pos: save ? pos : null });
    },
  });
}

// ---------- joining ----------
let stopDisc = null;
function joinScreen(tab) {
  app.screen = 'join';
  app.joinTab = tab;
  app.joinBack = null;
  if (stopDisc) { stopDisc(); stopDisc = null; }
  let body = '';
  if (tab === 'server') {
    body = `<p class="sub">Type the 5 letter code from the host's screen. Works on every network.</p>
      <div class="field"><input class="code" id="scode" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE"></div>
      <div class="field" style="margin-top:8px"><input id="spass" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Password, if the room has one"><button class="btn primary sm" data-a="server">Join</button></div>
      <button class="btn sm" data-a="browser" style="margin-top:10px">Open the server browser</button>`;
  } else if (tab === 'online') {
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
    <div class="tabs"><button data-a="tab" data-t="server" class="${tab === 'server' ? 'on' : ''}">Server</button><button data-a="tab" data-t="online" class="${tab === 'online' ? 'on' : ''}">Online</button><button data-a="tab" data-t="direct" class="${tab === 'direct' ? 'on' : ''}">Direct</button><button data-a="tab" data-t="lan" class="${tab === 'lan' ? 'on' : ''}">WiFi</button><button data-a="tab" data-t="bt" class="${tab === 'bt' ? 'on' : ''}">Bluetooth</button></div>
    ${body}</div>`, {
    back: () => { if (stopDisc) stopDisc(); stopDisc = null; title(); },
    tab: (b) => joinScreen(b.dataset.t),
    browser: () => browserScreen(() => joinScreen('server')),
    server: () => {
      const c = $('#scode').value.trim().toUpperCase();
      if (c.length !== 5) return ui.toast('Room codes have 5 letters', 'bad');
      joinWith('server', { code: c, pass: $('#spass').value });
    },
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
  if (tab === 'server') {
    const inp = $('#scode');
    if (inp) inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  } else if (tab === 'online') {
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
  const s = new Session('client', settings.name, makeLink(kind, kind === 'server' ? { url: cloud.wsUrl() } : undefined), myColor(), myLook(settings.name));
  const back = app.joinBack;
  busy('Connecting...', () => { s.close(); if (back) back(); else joinScreen(kind); });
  wireLobby(s);
  s.on('welcome', (m) => { if (m.game) beginGame(s, m.game); else lobby(s); });
  s.join(target);
}

// Goes to the makers on PayPal, in the phone's browser.
const DONATE = 'https://paypal.me/theocproductions';
function openDonate() {
  if (N && N.openUrl) N.openUrl(DONATE);
  else window.open(DONATE, '_blank', 'noopener');
}

// ---------- the game server ----------
// A room on the server: its name, who can find it, and whether it needs a password.
function roomForm(back) {
  app.screen = 'roomform';
  const pub = settings.roomPub !== false;
  show(`<div class="panel" style="width:min(560px,100%)">${header('Create a room')}
    <div class="kind" style="margin-bottom:6px">Room name</div>
    <div class="field"><input id="rname" maxlength="28" spellcheck="false" autocomplete="off" value="${esc(settings.roomName || '')}" placeholder="${esc((settings.name || 'Climber') + "'s climb")}"></div>
    <div class="kind" style="margin:12px 0 6px">Who can find it</div>
    <div class="seg vis"><button data-a="vis" data-v="1" class="${pub ? 'on' : ''}">Public</button><button data-a="vis" data-v="0" class="${pub ? '' : 'on'}">Private</button></div>
    <p class="sub" id="rvis" style="margin:8px 0 0">${pub ? 'Shows in the server browser for everyone.' : 'Hidden from the server browser. Only people with the code can join.'}</p>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" id="rlock" data-a="lock"> Needs a password to join</label>
    <div class="field" id="rpassf" style="display:none;margin-top:6px"><input id="rpass" maxlength="64" spellcheck="false" autocomplete="off" placeholder="Password"></div>
    <button class="btn primary" data-a="make" style="margin-top:14px"><b>Create the room</b><small>You pick the map and difficulty next</small></button></div>`, {
    back,
    vis: (b) => {
      settings.roomPub = b.dataset.v === '1';
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
      $('#rvis').textContent = settings.roomPub ? 'Shows in the server browser for everyone.' : 'Hidden from the server browser. Only people with the code can join.';
    },
    lock: (b) => { $('#rpassf').style.display = b.checked ? '' : 'none'; if (b.checked) $('#rpass').focus(); },
    make: () => {
      const pass = $('#rlock').checked ? $('#rpass').value : '';
      if ($('#rlock').checked && !pass) return ui.toast('Type a password, or switch it off', 'bad');
      settings.roomName = $('#rname').value.trim();
      saveSettings();
      hostWith('server', { name: settings.roomName, pub: settings.roomPub !== false, pass });
    },
  });
}

function roomRow(r) {
  const full = +r.n >= +r.max, code = String(r.code);
  const map = MAPS[r.map] ? MAPS[r.map].name : 'Unknown map', diff = DIFFS[r.diff] ? DIFFS[r.diff].name : '';
  return `<button class="item" data-a="room" data-code="${esc(code)}" data-locked="${r.locked ? 1 : 0}" ${full ? 'disabled' : ''}><div><b>${r.locked ? '🔒 ' : ''}${esc(r.name)}</b><small>${esc(r.host)} · ${esc(map)} · ${esc(diff)} · ${esc(+r.n || 0)}/${esc(+r.max || 4)} climbers · ${r.started ? 'climbing' : 'in the lobby'}</small></div><span class="go">${full ? 'FULL' : 'JOIN ›'}</span></button>`;
}

function browserScreen(back = title) {
  app.screen = 'browser';
  app.joinTab = 'server';
  app.joinBack = () => browserScreen(back);
  show(`<div class="panel">${header('Server browser')}
    <div class="bbar"><span class="sub" id="bstat" style="margin:0"><span class="spin"></span>&nbsp; Looking for rooms...</span><span class="bbtns"><button class="btn sm" data-a="refresh">Refresh</button><button class="btn primary sm" data-a="create">Create room</button></span></div>
    <div class="list" id="rooms"></div>
    <div class="field"><input id="bcode" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Private room? Type its code"><button class="btn sm" data-a="bjoin">Join</button></div></div>`, {
    back: () => { app.joinBack = null; back(); },
    refresh: () => look(),
    create: () => roomForm(() => browserScreen(back)),
    room: (b) => {
      if (+b.dataset.locked) roomPassword(b.dataset.code, () => browserScreen(back));
      else joinWith('server', { code: b.dataset.code, pass: '' });
    },
    bjoin: () => {
      const c = $('#bcode').value.trim().toUpperCase();
      if (c.length !== 5) return ui.toast('Room codes have 5 letters', 'bad');
      roomPassword(c, () => browserScreen(back), true);
    },
  });
  const inp = $('#bcode');
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  let shown = null;
  const look = async () => {
    const r = await cloud.getRooms(PROTO), el = $('#rooms'), st = $('#bstat');
    if (app.screen !== 'browser' || !el) return;
    if (!r) {
      st.textContent = 'Could not reach the game server.';
      el.innerHTML = '';
      shown = null;
      return;
    }
    const o = r.online, n = r.rooms.length;
    st.textContent = `${n} open room${n === 1 ? '' : 's'} · ${+o.players || 0} online · ${r.ms} ms to the server`;
    const html = n ? r.rooms.map(roomRow).join('') : '<div class="empty">No open rooms right now. Create the first one!</div>';
    if (html !== shown) { el.innerHTML = html; shown = html; }
  };
  look();
  const t = setInterval(() => { if (app.screen === 'browser') look(); else clearInterval(t); }, 5000);
}

function roomPassword(code, back, maybe) {
  app.screen = 'roompass';
  app.joinBack = back;
  show(`<div class="panel" style="width:min(460px,100%)">${header('Room ' + esc(code))}
    <p class="sub">${maybe ? 'If the room has a password, type it here. If not, leave this empty.' : 'This room needs a password.'}</p>
    <div class="field"><input id="jpass" maxlength="64" spellcheck="false" autocomplete="off" placeholder="Password"><button class="btn primary sm" data-a="go">Join</button></div></div>`, {
    back,
    go: () => joinWith('server', { code, pass: $('#jpass').value }),
  });
  $('#jpass').focus();
}

// Who made the game, the terms, and the sign in buttons. Guests can always just go on.
async function accountScreen(back = title) {
  app.screen = 'account';
  const mine = (app.acctView = {});
  busy('Contacting the server...', back);
  const info = await cloud.getInfo();
  if (app.acctView !== mine || app.screen !== 'account') return;
  const a = cloud.account(), made = '<p class="madeby">StickManUp is made by <b>TheOCProductions</b> &amp; <b>ShortGG</b></p>';
  if (!info && !a) {
    show(`<div class="panel" style="width:min(460px,100%)">${header('Sign in')}${made}<p class="sub">Could not reach the game server, so signing in isn't possible right now. You can still play as a guest.</p>
      <div class="row"><button class="btn primary sm" data-a="back">Play as guest</button><button class="btn sm" data-a="again">Try again</button></div></div>`, {
      back, again: () => accountScreen(back),
    });
    return;
  }
  // Signed in, with terms that have changed: accept them or leave.
  if (a && cloud.termsNeeded() && info) {
    const decline = async () => {
      await cloud.declineTerms();
      ui.toast('Signed out. Your account stays as it was.', 'good');
      afterAccount(back);
    };
    show(`<div class="panel">${header('New terms')}<div class="acct"><div class="terms">${esc(info.terms)}</div><div>${made}
      <p class="sub">The terms have changed. Please accept them to keep using your account here.</p>
      <button class="btn primary sm" data-a="ok">I accept</button><button class="btn sm" data-a="out" style="margin-top:9px">No, sign me out</button></div></div></div>`, {
      back: decline,
      out: decline,
      ok: async () => { if (await cloud.acceptTerms(info.termsVersion)) back(); else ui.toast('Could not reach the server', 'bad'); },
    });
    return;
  }
  if (a) {
    const when = cloud.lastSaved();
    show(`<div class="panel" style="width:min(520px,100%)">${header('Account')}${made}
      <div class="slot"><span class="dot"></span><span style="color:var(--tx)"><b>${esc(a.user.name)}</b></span><small>${esc(({ discord: 'Discord', steam: 'Steam', google: 'Google' })[a.user.provider] || '')}</small></div>
      <p class="sub" id="asave" style="margin-top:10px">Your coins and items are kept on the server. Your records and saved climb go there by themselves${when ? `. Last saved ${Date.now() - when < 60000 ? 'just now' : Math.round((Date.now() - when) / 60000) + ' min ago'}` : ''}.</p>
      <div class="row"><button class="btn primary sm" data-a="sync">Save now</button><button class="btn sm" data-a="out">Sign out</button></div>
      <button class="btn sm danger" data-a="del" style="margin-top:9px">Delete my account</button></div>`, {
      back,
      sync: async () => {
        if (await cloud.syncNow()) ui.toast('Saved', 'good');
        else ui.toast('Could not reach the server', 'bad');
      },
      out: () => signOutFlow(back),
      del: () => {
        app.screen = 'acctdel';
        show(`<div class="panel" style="width:min(460px,100%)">${header('Delete my account')}<p class="sub">This deletes your account, its coins and everything saved on the server, for good. You go back to being the guest you were before you signed in.</p>
          <div class="row"><button class="btn sm danger" data-a="yes">Delete forever</button><button class="btn primary sm" data-a="back">Keep my account</button></div></div>`, {
          back: () => accountScreen(back),
          yes: async () => {
            if (await cloud.deleteAccount()) { ui.toast('Your account is deleted', 'good'); back(); }
            else ui.toast('Could not reach the server, so nothing was deleted', 'bad');
          },
        });
      },
    });
    return;
  }
  const names = { discord: 'Discord', steam: 'Steam', google: 'Google' }, prov = info.providers.filter((p) => names[p]);
  show(`<div class="panel">${header('Sign in')}<div class="acct"><div class="terms">${esc(info.terms)}</div><div>${made}
    <p class="sub">Sign in to keep your coins, items and records on your account, safe on the server. As a guest they stay on this phone.</p>
    ${prov.length ? `<label class="toggle"><input type="checkbox" id="tos" data-a="tos"> I accept these terms</label>
    <div class="provs">${prov.map((p) => `<button class="btn sm prov ${p}" data-a="login" data-p="${p}" disabled>Sign in with ${names[p]}</button>`).join('')}</div>` : '<p class="sub">Signing in is not set up on this server yet.</p>'}
    <button class="btn sm" data-a="back" style="margin-top:9px">Play as guest</button></div></div></div>`, {
    back,
    tos: (b) => { for (const x of document.querySelectorAll('#menu .prov')) x.disabled = !b.checked; },
    login: async (b) => {
      if (!$('#tos').checked) return;
      app.afterLogin = back;
      await cloud.startLogin(b.dataset.p, info.termsVersion);
      app.screen = 'signingin';
      busy('Finish signing in in your browser, then come back here...', () => { cloud.cancelLogin(); accountScreen(back); });
    },
  });
}

async function signOutFlow(back) {
  if (await cloud.signOut()) { ui.toast('Signed out. Your progress is safe on your account.', 'good'); return afterAccount(back); }
  app.screen = 'acctout';
  show(`<div class="panel" style="width:min(460px,100%)">${header('Sign out')}<p class="sub">Could not reach the server to save your latest progress. If you sign out now, coins and records it hasn't got yet are lost.</p>
    <div class="row"><button class="btn primary sm" data-a="back">Stay signed in</button><button class="btn sm danger" data-a="force">Sign out anyway</button></div></div>`, {
    back: () => accountScreen(back),
    force: async () => { await cloud.signOut(true); afterAccount(back); },
  });
}
function afterAccount(back) { app.afterLogin = null; back(); }

cloud.on('signedIn', (u) => {
  ui.toast(`Signed in as ${u.name}`, 'good');
  if (app.game) return;
  const next = app.afterLogin || title;
  app.afterLogin = null;
  if (app.screen === 'signingin' || app.screen === 'account' || app.screen === 'title') {
    if (cloud.termsNeeded()) accountScreen(next); else next();
  }
});
cloud.on('loginFailed', (why) => {
  ui.toast(why, 'bad');
  if (app.screen === 'signingin') accountScreen(app.afterLogin || title);
});
cloud.on('expired', () => ui.toast('Please sign in again to use your account', 'bad'));
cloud.on('winRefused', () => ui.toast('That climb was too short to earn the top bonus on your account', 'bad'));
cloud.on('dayLimit', () => ui.toast('Daily coin limit reached. More tomorrow!', 'bad'));
cloud.on('terms', () => { if (app.screen === 'title') accountScreen(title); });
cloud.on('changed', () => { if (app.screen === 'title') title(); });

// ---------- settings & help ----------
const PRESETS = {
  low: { res: 0.55, glow: 0, aa: false, sharp: 0.45, autoRes: true, lite: true },
  high: { res: 0.75, glow: 1, aa: true, sharp: 0.35, autoRes: true, lite: false },
  ultra: { res: 1, glow: 1, aa: true, sharp: 0.2, autoRes: true, lite: false },
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
    ${chk('autoRes', 'Auto graphics (lowers detail only when needed, to keep the frame rate steady)')}
    ${chk('lite', 'Simple lighting (the fastest look, for older phones)')}
    <p class="sub full" style="margin:0">Pixelated? Turn up Resolution and Sharpness and switch on Smooth edges. If it still looks soft with Auto graphics on, your phone is holding the frame rate that way; a lower frame rate gives it more room.</p>` : ''}
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
    <h3>Controller</h3>
    <div class="padtest full" id="padTest">
      <div class="ps"><div class="pc" id="psL"><u></u><i></i></div><span>Left stick</span></div>
      <div class="ps"><div class="pc" id="psR"><u></u><i></i></div><span>Right stick</span></div>
      <p class="sub"><b id="psN">No controller connected</b><br>Stick drift? Let go of the sticks and raise the dead zone until each dot stays inside its dashed ring and turns grey.</p>
    </div>
    <label>Left stick dead zone ${val('deadL', '%')}${range('deadL', 0, 0.6, 0.02, '%')}</label>
    <label>Right stick dead zone ${val('deadR', '%')}${range('deadR', 0, 0.6, 0.02, '%')}</label>
    <p class="sub full" style="margin:0">In menus: direction pad or left stick to move, A to select, B to go back, LB and RB to switch tabs. In a climb: Start pauses, and Select opens the pause menu on Back to checkpoint.</p>
    <h3>Sound and other</h3>
    <label>Music${range('music', 0, 1, 0.05)}</label>
    <label>Sound effects${range('sfx', 0, 1, 0.05)}</label>
    <label>Your name<input id="nm" maxlength="14" value="${esc(settings.name)}" style="background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;padding:9px 12px;outline:none"></label>
    ${app.game ? '' : '<button class="btn sm" data-a="wardrobe">Your look: open the shop</button>'}
    ${app.game ? '' : '<button class="btn sm" data-a="account">Account and sign in</button>'}
    ${app.game ? '' : '<button class="btn sm donate" data-a="donate">♥ Donate to the makers</button>'}
    <div>${chk('haptics', 'Vibration')}${chk('fps', 'Show FPS')}${chk('tips', 'Show tips and ! markers')}</div>
    <button class="btn sm" data-a="tips">Show all tips again</button>
    <button class="btn sm" data-a="movefps">Move FPS counter...</button>
    <p class="sub full" style="margin:0">Graphics chip: ${esc(app.renderer.gpu)}${getSafe() ? ` · safe mode ${getSafe()} of ${MAX_SAFE}` : ''}</p>
    ${getSafe() ? '<button class="btn sm full" data-a="unsafe">Try full graphics again</button>' : ''}
  </div></div>`, {
    unsafe: () => { setSafe(0); restartApp('Restarting with full graphics...'); },
    back: () => { saveSettings(); back(); },
    account: () => { saveSettings(); accountScreen(() => settingsScreen(back)); },
    donate: openDonate,
    layout: () => layoutEditor(() => settingsScreen(back)),
    movefps: () => fpsEditor(() => settingsScreen(back)),
    tips: () => { store.set('tipsSeen', []); ui.seen = null; ui.toast('Tips will show again', 'good'); },
    wardrobe: () => { saveSettings(); app.screen = 'shop'; openShop(shopCtx, () => settingsScreen(back)); },
    seg: (b) => {
      const k = b.dataset.k, v = b.dataset.v;
      settings[k] = k === 'cap' ? +v : k === 'lefty' ? v === 'true' : v;
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
      if (k === 'quality') {
        if (!nat) { saveSettings(); return restartApp('Restarting to apply graphics...'); }
        Object.assign(settings, PRESETS[v]);
        restartAuto();
        saveSettings();
        applyGraphics();
        return settingsScreen(back);
      }
      if (k === 'cap' || k === 'res' || k === 'autoRes' || k === 'lite') restartAuto();
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
  // Name changes apply while you type (a moment after you stop), in solo and online.
  let nmT = 0;
  $('#nm').addEventListener('input', (e) => {
    clearTimeout(nmT);
    nmT = setTimeout(() => {
      const n = e.target.value.trim().slice(0, 14);
      if (!n) return;
      settings.name = n;
      saveSettings();
      const owner = nameChanged(n);
      if (owner) ui.toast(`Welcome back, ${n}. Your ${owner.name} suit is on.`, 'gold');
      lookChanged();
    }, 450);
  });
}

const fmtVal = (k, fmt) => (fmt === '%' ? Math.round(settings[k] * 100) + '%' : String(settings[k]));

// Native picture settings, applied live.
function applyGraphics() {
  const R = app.renderer;
  if (!R || !R.native) return;
  if (N && N.glQuality) N.glQuality(settings.res);
  if (N && N.glCap) N.glCap(settings.cap);
  // Ask the screen for a refresh rate that matches the cap (phones that can't, keep theirs; the
  // frame limiter below still holds the cap exactly).
  if (N && N.setRefresh) N.setRefresh(settings.cap >= 120 ? 120 : settings.cap >= 90 ? 90 : 60);
  if (N && N.glVsync) N.glVsync(!!settings.vsync);
  applyLook();
}

// The player's picture settings, less whatever automatic graphics has taken off right now.
function applyLook() {
  const R = app.renderer;
  if (!R || !R.native) return;
  const s = settings.autoRes && auto ? auto.step : STEPS[0];
  R.look.scale = s.res;
  R.look.sharp = settings.sharp * s.sharp;
  R.look.aa = !!settings.aa && !!s.aa;
  R.look.glow = settings.glow * s.glow;
  R.q.bloom = R.look.glow > 0.01;
  R.setLite(!!settings.lite || !!s.lite);
}

// Automatic graphics starts over (settings or frame rate changed) from the best look.
function restartAuto() {
  settings.autoLvl = 0;
  auto = makeAuto();
}

function makeAuto() {
  const cap = settings.cap || 60;
  return new AutoQ({ budget: 1000 / cap, start: settings.autoLvl || 0, last: cap > 60 ? 3 : STEPS.length - 1 });
}

// The stick test in Settings: where each stick really is, and its dead zone as a ring.
function padTester() {
  const name = $('#psN');
  if (!name) return;
  const r = nav.raw, side = (id, x, y, d) => {
    const c = $(id), u = c.firstElementChild, s = (d * 100).toFixed(0) + '%';
    if (u.style.width !== s) u.style.width = u.style.height = s;
    c.lastElementChild.style.transform = `translate(${(x * 32).toFixed(1)}px, ${(y * 32).toFixed(1)}px)`;
    c.classList.toggle('in', Math.hypot(x, y) <= d);
  };
  side('#psL', r[0], r[1], settings.deadL);
  side('#psR', r[2], r[3], settings.deadR);
  const n = nav.name ? nav.name.slice(0, 44) : 'No controller connected';
  if (name.textContent !== n) name.textContent = n;
}

// Once a second: how the last second went, and whether the graphics should change.
function autoTick(now) {
  if (now - autoAt < 1000 || !(N && N.glPerf)) return;
  autoAt = now;
  const [frames, late, gpu, gpuMax, slow] = N.glPerf().split(',').map(Number);
  perf.gpu = gpu;
  if (!settings.autoRes || !auto) return;
  const was = auto.level;
  auto.tick(gpu, gpuMax, late + slow, frames);
  perf.level = auto.level;
  if (auto.level !== was) applyLook();
  // Remembered for the next launch, so a weak phone starts where it left off instead of finding out again.
  if (auto.level !== settings.autoLvl && auto.stable()) { settings.autoLvl = auto.level; saveSettings(); }
}

// Touch buttons: centres measured from the bottom-right corner (bottom-left for left-handed), scaled by size.
const BTN = { bJump: [66, 64, 96], bGrab: [163, 59, 74], bReel: [77, 165, 74], bAct: [167, 149, 74], bShoot: [252, 160, 74], bDash: [252, 72, 74], bShield: [340, 112, 74] };
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

// Where the FPS counter sits, as a share of the safe part of the screen. Its anchor moves with it (its left edge at the
// far left, its right edge at the far right), so it stays whole on screen however long the text gets.
function applyFpsPos() {
  const s = $('#hFps').style, p = settings.fpsPos;
  s.left = p ? p[0] * 100 + '%' : '';
  s.top = p ? p[1] * 100 + '%' : '';
  s.right = s.bottom = p ? 'auto' : '';
  s.transform = p ? `translate(${-p[0] * 100}%, ${-p[1] * 100}%)` : '';
  // The bar with Reset and Done gets out of the way when the counter comes near the top.
  $('#touch').classList.toggle('barlow', !!p && p[1] < 0.35);
}
function fpsMoveTo(x, y) {
  settings.fpsPos = [clamp(x, 0, 1), clamp(y, 0, 1)];
  applyFpsPos();
}
// A box corner in pixels to that share, for dragging and for the first push from the default spot.
function fpsShare(left, top) {
  const A = $('#fpsArea').getBoundingClientRect(), r = $('#hFps').getBoundingClientRect();
  return [(left - A.left) / Math.max(1, A.width - r.width), (top - A.top) / Math.max(1, A.height - r.height)];
}
function showFps() {
  $('#hFps').style.display = settings.fps || app.screen === 'fpsmove' ? '' : 'none';
}

// Move the FPS counter with a finger, or with the right stick (PadNav place). Works with Show FPS off too.
function fpsEditor(done) {
  app.screen = 'fpsmove';
  hideMenu();
  const T = $('#touch'), H = $('#hud'), el = $('#hFps'), bar = $('#editBar'), label = bar.querySelector('b'), text = label.textContent;
  T.classList.add('on', 'fpsmove');
  H.classList.add('fpsmove');
  label.textContent = 'Drag the FPS counter where you want it';
  el.textContent = perf.show || 'FPS';
  showFps();
  app.input.reset();
  app.input.enabled = false;
  nav.aim('done');
  let grab = null;
  el.onpointerdown = (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    grab = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  el.onpointermove = (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    const p = fpsShare(e.clientX - grab.x, e.clientY - grab.y);
    fpsMoveTo(p[0], p[1]);
  };
  el.onpointerup = el.onpointercancel = () => { grab = null; };
  const finish = () => {
    el.onpointerdown = el.onpointermove = el.onpointerup = el.onpointercancel = null;
    T.classList.remove('fpsmove');
    H.classList.remove('fpsmove');
    if (!app.game) T.classList.remove('on');
    label.textContent = text;
    bar.onclick = null;
    app.back = null;
    saveSettings();
    done();
    showFps();
  };
  bar.onclick = (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    if (b.dataset.e === 'reset') { settings.fpsPos = null; applyFpsPos(); }
    else finish();
  };
  app.back = finish;
}

function applySettings() {
  app.input.sens = settings.sens;
  app.input.aimSens = settings.aimSens;
  app.input.invert = settings.invert;
  app.input.deadL = settings.deadL;
  app.input.deadR = settings.deadR;
  applyGraphics();
  applyLayout();
  app.sound.setVolumes(settings.music, settings.sfx);
  applyFpsPos();
  showFps();
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
    <div><b>Wall jump</b>In the air against a wall, press JUMP to kick off it, up and away. Hold the stick into a wall to slide down it slowly. The same wall won't kick you twice in a row, so bounce between two walls to climb them. Works while clamped with GRAB too.</div>
    <div><b>DASH</b>A fast burst the way the stick points, or the way the camera looks. One in the air, and landing, a wall jump or a grab gives it back. Glowing arrows mean the gap is too wide without it: jump, then dash near the top of the jump.</div>
    <div><b>Emotes and stunts</b>The smiley at the top of the screen opens your emotes: waves, flips, breakdance and more. Flips work in the air as well. The rest are in the shop.</div>
    <div><b>GRAPPLE</b>Near a glowing hook the action button says GRAPPLE. Tap it to zip up to the hook and get thrown across the gap.</div>
    <div><b>Jumpers</b>Angry dummies guard the ledges from about 500 m up (on Hardcore and Insane already from 50 m). Come close and they run at you and jump kick you off. Jump past them, or SHOOT to stun them for a few seconds.</div>
    <div><b>Coins and the shop</b>Coins hang all along the route. Each is worth 1 on Easy, 2 on Normal, 3 on Hardcore and 4 on Insane, and the top pays a big bonus. A coin you took stays gone after a fall. Spend them in the shop on colours, flags, faces, hats and costumes.</div>
    <div><b>Legendary suits</b>Coins can't buy these. They only come from Hardcore or Insane. Some are earned by what you do up there, the others are hidden. Those who know, know.</div>
    <div><b>Records</b>The title screen keeps your best climbs on every map: how high you got, on which difficulty, how many falls, how long and how many coins.</div>
    <div><b>SHOOT</b>Doors block some bridges. Look at the round target and tap SHOOT to open the door for the whole team. In the forest, SHOOT stuns monsters and bats for a few seconds.</div>
    <div><b>Storm Tower</b>When a yellow ring appears under you, lightning is coming for you: tap SHIELD right away. Rods glow before they strike, so GRAB. Laser bars spin low (jump them) and laser gates switch on and off. Fans and gusts blow you around: GRAB or wait for them to stop. Ice is slippery, cracked floors fall away, pads launch you up.</div>
    <div><b>Sunny Isles</b>The route zigzags across the lighthouse. Arrow traps fire across the bridges and some platforms swing like pendulums: ride them over.</div>
    <div><b>Magma Chimney</b>You climb up the inside of a volcano. Stand on a vent when it erupts and it launches you up to the ledge above, but standing next to it gets you shoved off. Shadows show where boulders are about to land.</div>
    <div><b>Neon Skyline</b>Climb round a skyscraper, then cross to the next one over a sky bridge or with a GRAPPLE zipline. Conveyor belts carry you along, drones patrol (SHOOT stuns them) and laser gates switch on and off.</div>
    <div><b>Waterfall</b>Climb a mossy rock with waterfalls pouring down it. Water slides shove you back down, so run up them and jump the inner tubes rolling at you. Launch slides whoosh you down a chute and throw you onto a higher ledge. Fish leap across the bridges along the water arcs, fountains launch you up when they spout, and lazy rivers carry you toward the edge.</div>
    <div><b>Wild Forest</b>Monsters patrol wide ledges and bats circle the gaps. Time your run, hold GRAB, or SHOOT them first.</div>
    <div><b>Falling</b>A fall drops you to whatever is below. Hit the ground and the team restarts at the last checkpoint (with checkpoints off: back at the start). Without the cord, only you go back, to your own last checkpoint.</div>
    <div><b>Obstacles</b>Every map has 26 of its own: swinging weights, rolling logs and balls, presses that slam down, spikes that pop up, jets, spinning bars, bumpers that throw you, platforms that blink out or drop open, turntables, mud that slows you and slippery decks. Most of them shake, flicker or glow just before they strike, so watch for the warning. The higher you climb, the more of them there are and the faster they move, and near the top come six harder endgame ones.</div>
    <div><b>Rules</b>Easy only switches on the gentler obstacles and runs them slower; Hardcore switches on all of them and speeds them up, and Insane runs them faster still with less grip and no late jumps. Under Rules you can pick checkpoints, obstacles and the cord length yourself instead (Auto follows the difficulty). Climbs with custom rules keep their own best times.</div>
    <div><b>Keyboard</b><kbd>WASD</kbd> move, <kbd>Space</kbd> jump, <kbd>Shift</kbd> grab, <kbd>E</kbd> reel, <kbd>C</kbd> dash, <kbd>T</kbd> emotes, <kbd>F</kbd> grapple/shoot, <kbd>Q</kbd> shield, mouse drag to look.</div>
    <div><b>Controller</b>Left stick move, right stick camera, <kbd>A</kbd> jump, <kbd>B</kbd> grab, <kbd>RB</kbd> reel, <kbd>Y</kbd> or <kbd>L3</kbd> dash, <kbd>LT</kbd> hold to aim, <kbd>RT</kbd> fire, <kbd>Down</kbd> on the direction pad emotes, <kbd>X</kbd> grapple, <kbd>RB</kbd> hold to aim and let go to shoot, <kbd>LB</kbd> shield, <kbd>Start</kbd> pause, <kbd>Select</kbd> pause on Back to checkpoint, up on the direction pad reads the nearest tip. All menus work with it too, and Settings has a dead zone for each stick against stick drift.</div>
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
  for (const r of app.pool.jumpers || []) r.hide();
  for (const l of app.pool.ropes) l.mesh.visible = false;
  app.game = new Game(app, s, g);
  if (N && N.keepAwake) N.keepAwake(true);
}

function endGame() {
  cloud.runEnd();
  cloud.flush();
  closeEmotes();
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
  closeEmotes();
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
    : `<button class="btn danger" data-a="respawn"><b>Restart the climb</b><small>${DIFFS[g.diff].name}: everyone back to the start</small></button>`}
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
      <div class="stats"><div><b>${fmtTime(r.time)}</b><small>Time</small></div><div><b>${r.falls}</b><small>Falls</small></div><div><b>${fmtTime(r.best)}</b><small>Best on ${DIFFS[r.diff].name}</small></div><div><b><i class="coin"></i>${r.coins}</b><small>Coins, ${r.bonus} of them for the top</small></div></div>
      ${r.firstWin ? `<div class="rec gold">First win on ${DIFFS[r.diff].name}: ${r.firstWin} coins</div>` : ''}
      ${(r.unlocked || []).map((n) => `<div class="rec gold">Legendary unlocked: ${esc(n)}</div>`).join('')}
      <button class="btn primary" data-a="back" style="max-width:320px;margin:auto;align-items:center"><b>Back to title</b></button></div>`, {
      back: () => { endGame(); title(); },
    });
  }, 1800);
};

// Going back, however it was asked for. Android may also turn a controller's B into its own back press, and a
// single press must never count twice.
let backAt = 0;
function goBack() {
  const t = performance.now();
  if (t - backAt < 220) return false;
  backAt = t;
  if (emoteOpen()) { closeEmotes(); return true; }
  if (app.back) app.back();
  return true;
}

// ---------- Android hooks ----------
window.SMU_back = () => {
  const had = !!app.back;
  if (!goBack()) return true;
  if (!had && app.game && !app.paused) pause();
  return true;
};
window.SMU_vis = (v) => {
  if (!v) cloud.flush();
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
  setDetail(safe >= 3 || settings.quality === 'low' ? 0 : settings.quality === 'ultra' ? 2 : 1);
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
  if (settings.lite === undefined) settings.lite = settings.quality === 'low';
  auto = makeAuto();
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
  app.input.onEmote = () => toggleEmotes(false);
  $('#hEmote').addEventListener('click', () => toggleEmotes(false));
  $('#emoteMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-em]');
    if (!b) return;
    if (app.game) app.game.emote(b.dataset.em);
    closeEmotes();
  });
  // Touching anywhere else closes it, and still counts as what it touched.
  document.addEventListener('pointerdown', (e) => { if (emoteOpen() && !e.target.closest('#emoteMenu, #hEmote')) closeEmotes(); }, { capture: true });
  nav = new PadNav({
    input: app.input,
    root: () => { const m = $('#menu'); return m.classList.contains('on') ? m : emoteOpen() ? $('#emoteMenu') : app.screen === 'layout' || app.screen === 'fpsmove' ? $('#editBar') : null; },
    screen: () => app.screen,
    // On the title screen B does nothing: closing the whole app is for the phone's own back button.
    back: () => { if (app.screen !== 'title') goBack(); },
    start: (select) => {
      // Select: the highlight starts on Back to checkpoint, so it is two presses away during a climb.
      if (app.screen === 'game') { pause(); nav.aim(select ? 'respawn' : 'back'); }
      else if (app.screen === 'pause') resume();
    },
    turn: (a) => { if (app.preview) app.preview.yaw = (app.preview.yaw || 0) + a * 3.5; },
    place: (dx, dy) => {
      if (app.screen !== 'fpsmove') return false;
      if (dx || dy) {
        const r = $('#hFps').getBoundingClientRect(), p = settings.fpsPos || fpsShare(r.left, r.top);
        fpsMoveTo(p[0] + dx * 0.5, p[1] + dy * 0.5);
      }
      return true;
    },
    sound: () => { app.sound.init(); app.sound.ui(); },
    closed: () => app.input.holdPad(),
    gameUp: () => { if (ui.nearTip) ui.tip(ui.nearTip); },
    gameDown: () => openEmotes(true),
  });
  document.addEventListener('pointerdown', () => app.sound.init(), { capture: true });
  window.addEventListener('resize', () => app.renderer.resize());
  if (N && N.insets) { const i = JSON.parse(N.insets()); window.SMU_insets(i.l, i.t, i.r, i.b); }
  cloud.setTestServer(settings.server);
  cloud.start();
  title();
  requestAnimationFrame(frame);
  setTimeout(() => $('#loading').classList.add('gone'), 300);
}

let last = performance.now(), titleT = 0, bolt = 2, fpsN = 0, fpsT = 0, then = 0, auto = null, autoAt = 0, nav = null;
let rafLast = 0, rafN = 0, rafPeriod = 0, rafCount = 0;
const rafGaps = new Float32Array(32);
const perf = { ms: 0, max: 0, n: 0, show: '', gap: 0, gpu: 0, level: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  // How fast the screen ticks: the middle of the last 32 gaps, so a hiccup doesn't count.
  const rg = now - rafLast;
  rafLast = now;
  if (rg > 2 && rg < 40) {
    rafGaps[rafN++ & 31] = rg;
    if ((rafN & 31) === 0) rafPeriod = rafGaps.slice().sort()[16];
  }
  // Frame limiter: never more frames than the chosen frame rate, on any screen. When the screen is a whole
  // multiple of it (60 on 60, 60 on 120) it simply draws every first, or every second, tick: the steadiest
  // there is. Timers in between would now and then land just short and skip a frame for nothing.
  const iv = 1000 / (settings.cap || 60), ratio = rafPeriod ? iv / rafPeriod : 0, div = Math.round(ratio);
  if (div >= 1 && Math.abs(ratio - div) < 0.1) {
    if (++rafCount < div) return;
    rafCount = 0;
    then = now;
  } else {
    // Otherwise a frame is drawn once its slot comes round (1 ms of slack for timer jitter) and the next slot is
    // exactly one interval later, so the average lands on the cap. After a stall it starts counting again
    // instead of rushing to catch up.
    if (now - then < iv - 1) return;
    then += iv;
    if (now - then > iv) then = now;
  }
  const gap = now - last;
  if (gap > perf.gap) perf.gap = gap;
  const dt = Math.min(gap / 1000, 0.05);
  last = now;
  nav.tick(now);
  if (app.screen === 'settings') padTester();
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
  autoTick(now);
  fpsN++;
  if ((fpsT += dt) > 0.5) {
    perf.show = `${Math.round(fpsN / fpsT)} fps · worst ${perf.gap.toFixed(0)} ms · GPU ${perf.gpu.toFixed(1)} · JS ${(perf.ms / Math.max(1, perf.n)).toFixed(1)}/${perf.max.toFixed(0)} · level ${perf.level}`;
    if (settings.fps || app.screen === 'fpsmove') $('#hFps').textContent = perf.show;
    fpsN = 0; fpsT = 0; perf.ms = 0; perf.n = 0; perf.max = 0; perf.gap = 0;
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
    r.setLook(j === 0 ? myOutfit() : plainLook(COLORS[j]));
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

// The shop: one climber standing on the start circle, on the left of the screen and turning slowly, with the
// camera shifted sideways so the cards on the right don't cover them.
function shopScene(dt) {
  const P = app.preview, pool = app.pool, c = app.level.cps[0], cam = app.renderer.camera, r0 = pool.robots[0];
  for (let j = 1; j < 4; j++) pool.robots[j].hide();
  for (const l of pool.ropes) l.mesh.visible = false;
  P.yaw = (P.yaw || 0) + dt * 0.75;
  // Round the dock from the start circle, clear of its pole. A long lens keeps the climber from stretching
  // out of shape over on the side of the picture.
  const th = Math.atan2(c.z, c.x) - 0.25, rad = 13, x = Math.cos(th) * rad, z = Math.sin(th) * rad, ox = Math.cos(th), oz = Math.sin(th);
  const fl = app.world.floorBelow(x, c.y + 3, z, 12), gy = fl > -50 ? fl : c.y, y = gy + PR;
  r0.setLook(resolveLook(P.look, settings.name));
  r0.show();
  r0.flip = 0;
  // An emote picked in the shop plays, and plays again after a short rest.
  if (P.emote) {
    if (P.emote !== P.playing) { r0.playEmote(P.emote); P.playing = P.emote; P.wait = 0; }
    else if (!r0.emote && (P.wait += dt) > 0.7) { r0.playEmote(P.emote); P.wait = 0; }
  } else if (r0.emote) r0.stopEmote();
  r0.yaw = Math.atan2(ox, oz) + P.yaw;
  r0.update(dt, x, y, z, 0, 0, 0, 1, 0, gy, undefined, 9);
  const fov = 38, D = 4.5, off = 0.62 * D * Math.tan((fov / 2) * (Math.PI / 180)) * (window.innerWidth / window.innerHeight);
  const rx = oz, rz = -ox, x0 = x + rx * off, z0 = z + rz * off;
  cam.position.set(x0 + ox * D, y + 0.5, z0 + oz * D);
  cam.lookAt(x0, y + 0.12, z0);
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

function titleScene(dt) {
  titleT += dt;
  app.sound.setStyle('menu');
  app.sound.setIntensity(0.6);
  const mk = app.level && app.level.mapKey;
  app.sound.ambient(0.2, false, 0, mk === 'storm' ? 0.7 : 0, mk === 'waterfall' ? 0.6 : 0);
  const R = app.renderer, cam = R.camera, g = app.preview ? null : titleRunners(dt);
  if (app.preview) shopScene(dt);
  else if (g) {
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
  if (!app.preview && cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
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
