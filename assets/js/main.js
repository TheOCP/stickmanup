// App shell: boot, menus, lobby flows, HUD and the main loop.
import './detmath.js';
import * as THREE from 'three';
import { Renderer } from './render.js';
import { generateLevel, DIFFS, MAPS, LEVEL_VERSION, cpEnabled, MAZE_RELICS, hideSpots, mapDef, mapName, dailyMap, genList, GRADES, MUTATORS } from './level.js';
import { NavPath } from './navpath.js';
import { EMOTES, EMOTE } from './emotes.js';
import { SPRAYS, sprayUrl } from './sprays.js';
import { Graffiti } from './graffiti.js';
import { Ghosts, GhostRec, decode as ghostDecode, better as ghostBetter } from './ghost.js';
import { Traitor, traitorLine } from './traitor.js';
import { World } from './physics.js';
import { WorldView, setSimple, setThin } from './worldview.js';
import { setDetail } from './scenery.js';
import { AutoQ, STEPS } from './autoq.js';
import { PadNav, padNames } from './padnav.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Storm } from './storm.js';
import * as cloud from './cloud.js';
import { Session, PROTO, makeLink, MAX_PLAYERS } from './net.js';
import { APP_VERSION, DESK, IS_WEB, ON_PC, canFullscreen, toggleFullscreen, keepAwake } from './platform.js';
import * as live from './live.js';
import { initUpdater } from './updater.js';
import { initFriends, openFriends, friendBadge, endSpectate, watchPlayer, joinPlayerRoom } from './friends.js';
import { initTerminal, openTerminal, termSay, close as closeTerminal, seen as termSeen } from './terminal.js';
import { Game, SHIELD_MAPS } from './game.js';
import { COLORS, makePool } from './robot.js';
import { css } from './colors.js';
import { SUIT, resolveLook, plainLook, ROLE_TAGS, roleInfo, tagColor } from './skins.js';
import { initProfile, myLook, myRole, owned, wonOnce, hasRelic, coins as myCoins } from './profile.js';
import { openShop, openRecords } from './shop.js';
import { TitleShow } from './titleshow.js';
import { startLang, tr, LANG_NAMES } from './i18n.js';
import { Fx } from './fx.js';
import { ViewGun } from './viewgun.js';
import { EventFx } from './evfx.js';
import { PR, PC, F } from './player.js';
import { store, fmtTime, clamp } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const N = window.Native;
const VERSION = N && N.version ? N.version() : APP_VERSION;
// Without the phone's own share menu: the browser's, or else the clipboard.
const canShare = () => !!((N && N.share) || navigator.share || navigator.clipboard);
function shareText(t) {
  const text = tr(t);
  if (N && N.share) N.share(text);
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => ui.toast('Copied', 'good'), () => {});
}
// A web page can only be sent back from a sign in by a server that knows how.
const signInWith = (info) => (IS_WEB && !info.webReturn ? [] : info.providers);

// Picture: res = render resolution (share of the screen), autoRes lets it drop when the phone struggles,
// sharp 0..1, aa = edge anti-aliasing, glow 0..1.5, cap = frame rate. Controls: btnSize, btnAlpha, lefty, btnPos.
const settings = Object.assign({ quality: !N && !ON_PC ? 'low' : 'high', sens: 1, invert: false, music: 0.5, sfx: 0.8, haptics: true, fps: false, name: '', gfxSafe: 0, map: 0,
  res: 0.75, autoRes: true, autoLvl: 0, deadL: 0.16, deadR: 0.16, sharp: 0.35, aa: true, glow: 1, cap: 60, btnSize: 1, btnAlpha: 0.9, lefty: false, fpsPos: null, btnPos: null, aimSens: 1,
  camFollow: 1, aimHelp: 0.5, tips: true, nav: true, relicMark: true, graffiti: true, cpEmote: '', ghosts: true, ghostMe: true, ghostHide: [], color: 0, vsync: true, lang: 'auto', rules: { cps: -1, haz: -1, rope: -1 } }, store.get('settings', {}));
// On a PC it goes from 60 to 144, and starts at the top: the screen is the real limit anyway.
if (ON_PC && !settings.pcFps) { settings.pcFps = true; settings.cap = 144; }
if (!(ON_PC ? [60, 90, 120, 144] : [30, 60, 90, 120]).includes(settings.cap)) settings.cap = ON_PC ? 144 : 60;
// The colour you picked before there were suits becomes your first suit.
startLang(settings.lang);
initProfile(settings.color);
const myColor = () => tagColor(SUIT[myLook().s].c);
let myResolved = null;
const myOutfit = () => myResolved || (myResolved = resolveLook(myLook(), myRole()));
// Something you wear changed: everyone in the game should see it.
function lookChanged() {
  myResolved = null;
  if (app.game) { app.game.s.setMe(settings.name, myColor(), myLook(), myRole()); app.game.refreshPlayers(); }
}
// Custom rules for a new climb. -1 means Auto (follow the difficulty).
const RULES = [
  ['cps', 'Checkpoints', ['Every zone', 'A few', 'None']],
  ['haz', 'Obstacles', ['Calm', 'Normal', 'Wild']],
  ['rope', 'Cord', ['Long', 'Normal', 'Short']],
];
const friendlyFireHtml = (r, editable) => `<div class="rules" style="margin-top:6px"><label>Friendly fire<div class="seg ${editable ? '' : 'ro'}"><button data-a="rule" data-k="ff" data-v="0" class="${r.ff === 1 ? '' : 'on'}">Off</button><button data-a="rule" data-k="ff" data-v="1" class="${r.ff === 1 ? 'on' : ''}">On</button></div></label></div>`;
// Traitor mode (traitor.js): only for a game with others, started from the lobby.
const traitorHtml = (r, editable) => `<div class="rules" style="margin-top:6px"><label>Traitor mode<div class="seg ${editable ? '' : 'ro'}"><button data-a="rule" data-k="tr" data-v="0" class="${r.tr === 1 ? '' : 'on'}">Off</button><button data-a="rule" data-k="tr" data-v="1" class="${r.tr === 1 ? 'on' : ''}">On</button></div></label></div>`;
// Friendly fire is kept only for a game started from the lobby, and only when the host switched it on there.
const cleanRules = (r = {}, ff = false) => { const o = {}; for (const [k] of RULES) if (r[k] >= 0) o[k] = r[k]; if (ff && r.ff === 1) o.ff = 1; if (ff && r.tr === 1) o.tr = 1; return o; };
// How many of a map's relics have been found: three at the end of its long courses, the ones in its maze gardens and its
// hidden spots (on every difficulty different ones). A generated map has its world's, somewhere else.
function relicLine(mapId) {
  const key = (mapDef(mapId) || MAPS[0]).key, ids = ['0', '1', 'w'];
  for (let i = 0; i < (MAZE_RELICS[key] || 0); i++) ids.push('m' + i);
  for (const q of hideSpots(key)) ids.push('h' + q.j);
  return `<p class="sub" id="relicLine" style="margin:12px 0 0">Relics found on this map: ${ids.filter((k) => hasRelic(key + ':' + k)).length} of ${ids.length}</p>`;
}
function rulesHtml(r, editable, solo) {
  return `<div class="rules">${RULES.filter(([k]) => !(solo && k === 'rope')).map(([k, name, opts]) => `<label>${name}<div class="seg ${editable ? '' : 'ro'}">${[['-1', 'Auto'], ...opts.map((o, i) => [String(i), o])]
    .map(([v, l]) => `<button data-a="rule" data-k="${k}" data-v="${v}" class="${String(r[k] ?? -1) === v ? 'on' : ''}">${l}</button>`).join('')}</div></label>`).join('')}</div>`;
}
const roleChip = (r) => { const i = roleInfo(r); return i ? `<em class="role${ROLE_TAGS[r] ? ' ' + r : ''}" style="background:${i.color}">${esc(i.tag)}</em>` : ''; };
const roleTag = (p) => roleChip(p.role);
// A player's colour in the session (their pick, or their slot's default).
const pcol = (s, slot) => { const p = s.players.get(slot); return css((p && p.color) ?? COLORS[slot % 4]); };
// Earlier versions had on/off switches for the two assists; carry them over to the sliders.
if (settings.camAssist === false) settings.camFollow = 0;
if (settings.aimAssist === false) settings.aimHelp = 0;
delete settings.camAssist;
delete settings.aimAssist;
if (!settings.name || /^Robot \d+$/.test(settings.name)) settings.name = 'Climber ' + (100 + ((Math.random() * 900) | 0));
if (!mapDef(settings.map)) settings.map = 0;
const saveSettings = () => store.set('settings', settings);
// v2 keeps best times per map; earlier best times were all on the storm tower.
if (!store.get('best2') && store.get('best')) { const b = {}; for (const [d, t] of Object.entries(store.get('best'))) b['0:' + d] = t; store.set('best2', b); }
const validSave = (k) => { const s = store.get(k); return s && s.v === LEVEL_VERSION ? s : null; };

const app = { settings, game: null, paused: false, screen: '', back: null, room: null };

// Diagnostics: JS errors and boot stages go to the Android side (and on to a developer receiver if one runs).
const errs = [];
function report(k, o = {}) {
  if (k === 'stage') window.SMU_stage = o.s; // js/compat.js shows it if the game never gets going
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
// The test scripts look inside the game through this. The real app runs from a fixed address and leaves it out, so nothing
// else on the phone gets handed the game's insides.
if (location.hostname !== 'appassets.androidplatform.net') window.SMU = app;

// ---------- small UI helpers ----------
// The HUD gets written ten times a second, mostly with what it already shows. Every real write makes the phone redraw
// that part of the screen, so these remember what they last wrote and leave the page alone when nothing changed.
const hudEls = new Map();
const hudEl = (s) => { let e = hudEls.get(s); if (!e || !e.isConnected) { e = $(s); hudEls.set(s, e); } return e; };
const putText = (el, s) => { if (el.__txt !== s) { el.__txt = s; el.textContent = s; } };
const putHtml = (el, s) => { if (el.__htm !== s) { el.__htm = s; el.innerHTML = s; } };
const putVar = (el, k, s) => { const c = el.__var || (el.__var = {}); if (c[k] !== s) { c[k] = s; el.style.setProperty(k, s); } };
// Moving a marker: half a pixel steps, and no write at all when it stayed put.
const putXY = (el, x, y) => {
  const a = Math.round(x * 2) / 2, b = Math.round(y * 2) / 2;
  if (el.__x !== a) { el.__x = a; el.style.left = a + 'px'; }
  if (el.__y !== b) { el.__y = b; el.style.top = b + 'px'; }
};

// What the HUD shows for each map's event, while it is coming and while it is on.
const EV_WARN = { gust: 'GUST INCOMING', wave: 'WAVE INCOMING', laser: 'LASERS INCOMING', cannon: 'CANNONS INCOMING', quake: 'QUAKE INCOMING', bees: 'BEES INCOMING' };
const EV_ON = { gust: 'GUST! GRAB ON', wave: 'WAVE! JUMP OR GRAB ON', laser: 'LASERS! KEEP MOVING', cannon: 'CANNONS! GET OUT OF THE RINGS', quake: 'QUAKE! JUMP WHEN IT SHAKES', bees: 'BEES! RUN OR SHIELD!' };
const ui = (app.ui = {
  ghostsSaid(off) { ui.toast(off ? 'The host switched the ghosts off for everyone' : 'The host switched the ghosts on again', ''); },
  coins(n, pop) {
    const el = hudEl('#hCoins');
    putHtml(el, `<i class="coin"></i>${n}`);
    if (pop && el.animate) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
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
    // Where the relics still to find are: the height their course starts at.
    const rel = (L.relics || []).filter((r) => !hasRelic(r.id) && (r.dv === undefined || r.dv === g.diff)).map((r) => `<i class="rl ${r.kind}" style="bottom:${(((r.gate || r).y) / top) * 100}%"></i>`).join('');
    $('#hAlt .marks').innerHTML = cps + rel + [...g.s.players.keys()].filter((s) => s === g.slot || !g.hidden.has(s)).map((s) => `<i data-s="${s}" style="color:${pcol(g.s, s)}"></i>`).join('');
    $('#hPlayers').innerHTML = g.solo ? '' : [...g.s.players.values()].filter((p) => p.slot === g.slot || !g.hidden.has(p.slot)).map((p) => `<div data-s="${p.slot}" style="color:${pcol(g.s, p.slot)}"><i></i><span>${esc(p.name)}${p.slot === g.slot ? ' (you)' : ''}</span>${roleTag(p)}<small></small></div>`).join('');
    $('#tags').innerHTML = '';
  },
  hud(g, { T, zone, ev, thunder }) {
    // A phone short of time gets half as many of these.
    if (auto && auto.thin && (this.hudSkip = !this.hudSkip)) return;
    const me = g.me, L = app.level, Z = L.zones[zone];
    putText(hudEl('#hZone b'), Z.name);
    putText(hudEl('#hZone span'), `${Math.max(0, Math.round(me.y - PR - 2))} m of ${Math.round(L.top - 2)} m · ${DIFFS[g.diff].name}`);
    putHtml(hudEl('#hTime'), fmtTime(T) + (g.falls ? `<small>${g.falls} fall${g.falls > 1 ? 's' : ''}</small>` : ''));
    let warn = '', cls = '';
    // The swarm close enough for the shield to drive it off.
    const bees = g.bees, beesNear = !!bees && !bees.gone && Math.hypot(me.x - bees.x, me.y - bees.y, me.z - bees.z) < 7 && me.shieldCd <= 0;
    if (thunder && thunder.warn > 0 && !(me.flags & 128)) { warn = 'LIGHTNING! SHIELD!'; cls = 'g'; }
    else if (beesNear && !(me.flags & 128)) { warn = 'BEES! SHIELD NOW!'; cls = 'g'; }
    else if (ev && ev.on) { warn = EV_ON[ev.kind]; cls = 'g'; }
    else if (ev && ev.warn > 0) { warn = EV_WARN[ev.kind]; cls = 'w'; }
    else if (!g.flying) {
      for (const r of L.rods) {
        if (Math.abs(r.y - me.y) > 4 || Math.hypot(r.x - me.x, r.z - me.z) > r.rad + 1.5) continue;
        if (g.storm.rodWarn(r, T) > 0) { warn = 'LIGHTNING: MOVE OR SHIELD!'; cls = 'w'; break; }
      }
    }
    const w = hudEl('#hWarn'), wc = warn ? 'on ' + cls : '';
    putText(w, warn);
    if (w.className !== wc) w.className = wc;
    const gb = hudEl('#bGrab');
    putVar(gb, '--v', me.grip.toFixed(2));
    gb.classList.toggle('low', me.grip < 0.3);
    hudEl('#bAct').classList.toggle('off', !g.action);
    // Without the cord there's nothing to reel.
    const rb0 = hudEl('#bReel');
    if (rb0.classList.contains('nocord') !== g.noCord) rb0.classList.toggle('nocord', g.noCord);
    const rl = hudEl('#bReel span'), mode = g.reelMode || 'REEL';
    const modeText = tr(mode);
    if (rl.textContent !== modeText) rl.textContent = modeText;
    rb0.classList.toggle('help', mode !== 'REEL');
    const db = hudEl('#bDash');
    putVar(db, '--v', (me.dashReady ? 1 - me.dashCd / PC.DASH_CD : 0).toFixed(2));
    db.classList.toggle('used', !me.dashReady);
    const sb = hudEl('#bShield'), shieldy = SHIELD_MAPS.has(L.mapKey);
    sb.classList.toggle('on', shieldy);
    if (shieldy) {
      putVar(sb, '--v', (1 - me.shieldCd / 2.2).toFixed(2));
      sb.classList.toggle('ready', me.shieldCd <= 0);
      sb.classList.toggle('alert', ((!!thunder && thunder.warn > 0) || beesNear) && me.shieldCd <= 0);
    }
    putVar(rb0, '--v', me.charge.toFixed(2));
    putVar(rb0, '--o', me.charge > 0 ? '1' : '0');
    for (const el of document.querySelectorAll('#hAlt .marks i[data-s]')) {
      const s = +el.dataset.s, p = s === g.slot ? me : g.vis && g.vis.get(s);
      if (p) { const b = (clamp(p.y / L.top, 0, 1) * 100).toFixed(1) + '%'; if (el.__b !== b) { el.__b = b; el.style.bottom = b; } }
    }
    for (const el of document.querySelectorAll('#hPlayers div')) {
      const s = +el.dataset.s, p = s === g.slot ? me : g.vis && g.vis.get(s), pl = g.s.players.get(s);
      putText(el.querySelector('small'), (p ? Math.round(p.y - 2) + ' m' : '...') + (s !== g.slot && !g.s.isHost ? '' : pl && pl.ping ? ` · ${pl.ping} ms` : '') + (s === g.slot && !g.s.isHost ? ` · ${g.s.ping} ms` : ''));
    }
  },
  // Inside a maze: how many hearts are left.
  hearts(g) {
    const el = this.heartsEl || (this.heartsEl = $('#hHearts')), show = !g.flying && !g.won && !!g.mazeAround(g.me);
    if (el.hidden === show) el.hidden = !show;
    if (!show || el.__n === g.hearts) return;
    const lost = el.__n !== undefined && g.hearts < el.__n;
    el.__n = g.hearts;
    el.innerHTML = [0, 1, 2].map((i) => `<svg viewBox="0 0 24 24" class="${i < g.hearts ? '' : 'off'}" aria-hidden="true"><path d="M12 21s-8.5-5.4-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.6 12 21 12 21z"/></svg>`).join('');
    if (lost) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  },
  // The marker on the screen for the nearest relic still to find (game.js relicAim): over its gate, or on the edge of the screen
  // on the side it is on, with how far it is.
  relicMark(g) {
    const el = this.relicEl || (this.relicEl = $('#hRelic')), a = settings.relicMark && !g.won && !g.aiming && g.relicAim;
    if (!a) { if (!el.hidden) el.hidden = true; return; }
    const cam = app.renderer.camera, v = this.relicV || (this.relicV = new THREE.Vector3()), W = window.innerWidth, H = window.innerHeight;
    v.set(a.x, a.y + 2.4, a.z).applyMatrix4(cam.matrixWorldInverse);
    const behind = v.z > -0.2;
    v.applyMatrix4(cam.projectionMatrix);
    let x = behind ? -v.x : v.x, y = behind ? -v.y : v.y;
    // It keeps clear of the edges of the screen and a phone's notch, and stays below the clock and the way up arrow.
    const mx = 1 - 120 / W, my = 1 - 96 / H, over = Math.max(Math.abs(x) / mx, Math.abs(y) / my);
    // Behind the camera it always goes on the edge; in front only if it is off the screen.
    if (behind || over > 1) { const k = 1 / (over || 1); x *= k; y *= k; }
    if (el.hidden) el.hidden = false;
    if (el.__k !== a.kind) { el.__k = a.kind; el.className = a.kind; }
    const tf = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px,${Math.max(116, (0.5 - y * 0.5) * H).toFixed(1)}px)`;
    if (el.__tf !== tf) { el.__tf = tf; el.style.transform = tf; }
    const b = el.__b || (el.__b = el.querySelector('b')), t = Math.round(a.d) + ' m';
    if (el.__t !== t) { el.__t = t; b.textContent = t; }
  },
  // The arrow under the clock that shows the way up (Settings can turn it off). navpath.js works out where on the climb you
  // are and the next place to go; here it turns into a direction on the screen: from where the climber is drawn to where
  // that place is drawn, so up means further away or higher, and down means back toward the camera.
  nav(g) {
    const el = this.navEl || (this.navEl = $('#hNav')), me = g.me;
    if (!settings.nav || g.won || g.aiming || !g.L.route || app.trStatic) { if (!el.hidden) el.hidden = true; return; }
    const N = g.L.navPath || (g.L.navPath = new NavPath(g.L));
    N.update(me);
    const p = N.target(me);
    if (!p) { if (!el.hidden) el.hidden = true; return; }
    const cam = app.renderer.camera, A = this.navP || (this.navP = new THREE.Vector3()), T = this.navQ || (this.navQ = new THREE.Vector3());
    A.set(me.x, me.y + 0.2, me.z).applyMatrix4(cam.matrixWorldInverse);
    T.set(p.x, p.y + 0.9, p.z).applyMatrix4(cam.matrixWorldInverse);
    let a = null;
    const zc = -0.8;
    if (A.z < zc) {
      // Behind the camera: where the way there passes just in front of it, which is drawn on the right side of the screen.
      if (T.z > zc) T.lerpVectors(A, T, (A.z - zc) / (A.z - T.z));
      A.applyMatrix4(cam.projectionMatrix);
      T.applyMatrix4(cam.projectionMatrix);
      const dx = (T.x - A.x) * window.innerWidth, dy = (T.y - A.y) * window.innerHeight;
      if (Math.hypot(dx, dy) > 8) a = Math.atan2(dx, dy);
    }
    // Too close to the line of sight to tell on the screen: which way it is seen from above, turned with the camera.
    if (a === null) {
      const yaw = Math.atan2(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[10]), b = Math.atan2(p.x - me.x, p.z - me.z);
      a = Math.hypot(p.x - me.x, p.z - me.z) < 0.5 ? 0 : -(b - yaw);
    }
    const now = performance.now(), dt = Math.min(0.1, (now - (this.navT || now)) / 1000);
    this.navT = now;
    const was = this.navA ?? a, d = Math.atan2(Math.sin(a - was), Math.cos(a - was));
    this.navA = was + d * (1 - Math.exp(-dt * 14));
    if (el.hidden) el.hidden = false;
    const tf = `translateX(-50%) rotate(${this.navA.toFixed(3)}rad)`;
    if (el.__tf !== tf) { el.__tf = tf; el.style.transform = tf; }
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
      if (d < 7 && !g.flying && !seen.has(key)) { seen.add(key); store.set('tipsSeen', [...seen]); this.tip(s.text); }
      // Out of reach (nearly all of them, nearly always): no need to work out where on the screen it is.
      if (d >= 24) { if (el && !el.__off) { el.__off = true; el.style.display = 'none'; } continue; }
      v.set(s.x, s.y - 0.7, s.z).project(cam);
      if (!(v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05)) { if (el && !el.__off) { el.__off = true; el.style.display = 'none'; } continue; }
      if (d < nearD) { nearD = d; this.nearTip = s.text; } // the direction pad reads this one, there is no finger to tap it
      if (!el) {
        el = document.createElement('button');
        el.textContent = '!';
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); ui.tip(s.text); });
        box.appendChild(el);
        this.tipEls.set(i, el);
      }
      if (el.__off !== false) { el.__off = false; el.style.display = ''; }
      el.classList.toggle('seen', seen.has(key));
      putXY(el, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H);
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
  // Looking through the sight of a scoped weapon, with how far away the point under it is.
  scope(on, hot, dist) {
    const c = $('#scope');
    if (on !== c.classList.contains('on')) c.classList.toggle('on', on);
    if (!on) return;
    c.classList.toggle('hot', !!hot);
    const txt = dist > 0 ? Math.round(dist) + ' m' : '', d = $('#scopeD');
    if (d.textContent !== txt) d.textContent = txt;
  },
  // Pulled the trigger without aiming: nothing fires, and this says why.
  aimFirst() {
    const now = performance.now();
    if (now - (this.aimTold || -1e9) < 15000) return;
    this.aimTold = now;
    if (document.body.classList.contains('pad')) { const L = padNames(nav && nav.name); this.toast(`Hold ${L.aim} to aim, then ${L.fire} to fire`); }
    else if (ON_PC) this.toast('Hold right click to aim, then left click to fire');
    else this.toast('Hold SHOOT to aim, let go to fire');
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
        el.textContent = (roleInfo(p.role) ? roleInfo(p.role).tag + ' · ' : '') + p.name;
        box.appendChild(el);
      }
      v.set(o.x, o.y + 1.45, o.z).project(cam);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
      const cx = clamp(x, 50, W - 50), cy = clamp(y, 70, H - 20);
      el.classList.toggle('edge', cx !== x || cy !== y);
      putXY(el, cx, cy);
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
        putXY(b.el, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H);
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
  app.input.freeMouse(false);
}
// The emote that plays at checkpoints: one of yours, never a flip (game.js cpEmote).
const cpEmotes = () => EMOTES.filter((e) => !e.hidden && !e.hop && owned(e));
function openEmotes(viaPad) {
  if (app.screen !== 'game' || !app.game) return;
  const list = EMOTES.filter((e) => !e.hidden && owned(e));
  const sprays = SPRAYS.filter((s) => owned(s)), cp = cpEmotes().find((e) => e.id === settings.cpEmote);
  $('#emoteMenu').innerHTML = `<div class="emHead"><b>Emotes</b></div>
    <div class="emGrid">${list.map((e) => `<button class="emo r${e.r}" data-em="${e.id}"><i>${e.icon}</i><span>${esc(e.name)}</span></button>`).join('')}</div>
    <button class="emCp" data-cpe="1"><span>At checkpoints</span><b>${cp ? `${cp.icon} ${esc(cp.name)}` : 'Nothing'}</b></button>
    <div class="emHead"><b>Graffiti</b></div>
    <div class="emGrid">${sprays.map((s) => `<button class="emo spr r${s.r}" data-spray="${s.id}"><img src="${sprayUrl(s, 96)}" alt=""><span>${esc(s.name)}</span></button>`).join('')}</div>`;
  $('#emoteMenu').className = 'on';
  app.sound.ui();
  if (viaPad) { app.input.lockPad(true); nav.setUsing(true); }
  else app.input.freeMouse(true);
}
function toggleEmotes(viaPad) {
  if (emoteOpen()) closeEmotes();
  else openEmotes(viaPad);
}

// ---------- graffiti ----------
// Your own: drawn at once, sent to the room and kept on the server for whoever climbs here later (graffiti.js).
function sprayNow(id) {
  const g = app.game, G = app.graffiti, item = SPRAYS.find((s) => s.id === id);
  if (!g || !G || !item || !owned(item)) return;
  const now = performance.now() / 1000, a = G.aim(g, now);
  if (!a.at) { if (a.why) ui.toast(a.why, 'bad'); return; }
  const s = Object.assign({ id }, a.at);
  G.add(s);
  G.last = now;
  app.sound.spray();
  ui.haptic('tick');
  g.s.toHost(Object.assign({ k: 'spray', s: g.slot }, s));
  cloud.postSpray(g.map, LEVEL_VERSION, s);
}
// Someone else's, from the room. Only with Graffiti from other climbers on.
function onSpray(e) {
  if (settings.graffiti && app.graffiti) app.graffiti.add(e);
}
// The ones the server keeps for this map.
async function loadSprays(map) {
  if (!settings.graffiti || !app.graffiti) return;
  const list = await cloud.fetchSprays(map, LEVEL_VERSION);
  if (!app.game || app.game.map !== map) return;
  for (const s of list) app.graffiti.add(s);
}

// ---------- ghost racing (ghost.js) ----------
// Your best climb of this map and difficulty is kept on this phone too, so it races you without an account.
const ghostKey = (map, diff) => `ghost.${map}.${diff}`;
let ghostLine = 0;
async function loadGhosts(g) {
  const map = g.map, diff = g.diff, mine = store.get(ghostKey(map, diff), null);
  const list = [];
  if (mine && mine.data) list.push({ key: 'me', name: '', how: 'me', won: mine.won, t: mine.t, h: mine.h, data: mine.data });
  const show = () => app.ghosts.set(list.map((x) => Object.assign({}, x, { a: ghostDecode(x.data) })));
  show();
  const got = await cloud.fetchGhosts(map, diff, app.room && app.room.kind === 'server' ? app.room.code : '');
  if (app.game !== g) return;
  for (const x of got) {
    if (!x || typeof x.data !== 'string') continue;
    if (x.key === 'me') {
      // The server's own best of yours, if it beats the one on this phone.
      if (ghostBetter(x, list[0] && list[0].key === 'me' ? list[0] : null)) { if (list[0] && list[0].key === 'me') list.shift(); list.unshift(Object.assign({}, x, { how: 'me' })); }
    } else list.push(x);
  }
  show();
}
const ghostShown = (g, key) => settings.ghosts && !(g.rules && g.rules.ng) && (key === 'me' ? settings.ghostMe : !settings.ghostHide.includes(key));
// Every frame: record yours, move the ghosts, and say who is ahead.
function ghostTick(g, dt) {
  const rec = app.ghostRec;
  if (rec && !rec.dead) {
    // Only a climb by the difficulty's own rules, never moved by the team or flown, is one to race.
    if (g.custom || g.tped || g.flying) rec.dead = true;
    else rec.step(g.time, g.me, Math.atan2(-Math.sin(g.cam.yaw), -Math.cos(g.cam.yaw)));
  }
  app.ghosts.update(dt, g.time, app.world, (key) => ghostShown(g, key));
  if ((ghostLine += dt) < 0.25) return;
  ghostLine = 0;
  const el = $('#hGhost');
  let best = null;
  for (const x of app.ghosts.list) if (x.at && ghostShown(g, x.key) && (!best || Math.abs(x.at.y - g.me.y) < Math.abs(best.at.y - g.me.y))) best = x;
  if (!best || g.won) { el.hidden = true; return; }
  const d = Math.round(best.at.y - g.me.y), who = best.key === 'me' ? 'Your best' : best.name;
  el.hidden = false;
  el.className = d > 0 ? 'behind' : '';
  el.textContent = d > 0 ? `${who}: ${d} m ahead` : d < 0 ? `${who}: ${-d} m behind you` : `${who}: level with you`;
}
// The climb is over: if it beat your best, it is the ghost from now on.
function ghostEnd(g, won, t) {
  const rec = app.ghostRec;
  app.ghostRec = null;
  if (!rec || !g) return;
  const r = rec.result(won, won ? t : g.time);
  if (!r) return;
  const key = ghostKey(g.map, g.diff), was = store.get(key, null);
  if (!ghostBetter(r, was)) return;
  store.set(key, r);
  cloud.postGhost(g.map, g.diff, r);
}
// Which ghosts you see, and for the host whether anyone does.
function ghostMenu(back) {
  const g = app.game;
  if (!g) return back();
  const row = (on, label, sub, act, extra = '') => `<button class="btn ${on ? 'primary' : ''}" data-a="${act}" ${extra}><b>${esc(label)}: ${on ? 'On' : 'Off'}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  const fmt = (x) => (x.won ? `Summit in ${fmtTime(x.t)}` : `Up to ${Math.round(x.h)} m`);
  const off = !!(g.rules && g.rules.ng), others = app.ghosts.list.filter((x) => x.key !== 'me'), mine = app.ghosts.list.find((x) => x.key === 'me');
  show(`<div class="pause"><h2>Ghosts</h2>
    ${off ? '<p class="note">The host switched the ghosts off for everyone.</p>' : ''}
    ${row(settings.ghosts, 'Ghosts', 'For you only', 'all')}
    ${row(settings.ghostMe, 'Your best', mine ? fmt(mine) : 'Not yet: finish a climb from the start', 'me')}
    ${others.map((x) => row(!settings.ghostHide.includes(x.key), x.name, `${x.how === 'room' ? 'In this room' : 'Friend'}, ${fmt(x)}`, 'one', `data-k="${esc(x.key)}"`)).join('')}
    ${!g.solo && g.s.isHost ? row(!off, 'For everyone', 'You are the host', 'host') : ''}
    <button class="btn" data-a="back"><b>Back</b></button></div>`, {
    back,
    all: () => { settings.ghosts = !settings.ghosts; saveSettings(); ghostMenu(back); },
    me: () => { settings.ghostMe = !settings.ghostMe; saveSettings(); ghostMenu(back); },
    one: (b) => { const k = b.dataset.k, h = settings.ghostHide; settings.ghostHide = h.includes(k) ? h.filter((x) => x !== k) : [...h, k].slice(-50); saveSettings(); ghostMenu(back); },
    host: () => { g.s.toHost({ k: 'ghosts', off: !off }); setTimeout(() => ghostMenu(back), 150); },
  });
}

// ---------- menu system ----------
let handlers = {};
function show(html, h = {}, dim = true) {
  const m = $('#menu');
  m.innerHTML = html;
  m.scrollTop = 0;
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
// The arrow is drawn, not typed: a font puts its arrow character wherever it likes, which is never quite the middle.
const header = (title) => `<div class="ph"><button class="back" data-a="back" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4 L8 12 L16 20"/></svg></button><h2>${title}</h2></div>`;

// Best times per map and difficulty, keyed "map:diff".
const bestOf = (map) => { const b = store.get('best2', {}), out = {}; for (const d of DIFFS) if (b[map + ':' + d.id]) out[d.id] = b[map + ':' + d.id]; return out; };

// Builds (once) and shows a map. Each map keeps its level, physics and meshes after the first visit,
// so switching back is instant and nothing on the GPU is ever rebuilt.
const worlds = new Map();
function loadMap(id) {
  if (!mapDef(id)) id = 0;
  clearTimeout(soonT);
  if (app.level && app.level.map === id) return;
  const R = app.renderer;
  if (app.view) R.scene.remove(app.view.root);
  let w = worlds.get(id);
  if (!w) {
    // The six worlds stay ready; of the generated maps only the last two, they are big.
    const gens = [...worlds.keys()].filter((k) => k >= MAPS.length);
    while (id >= MAPS.length && gens.length >= 2) {
      const k = gens.shift(), old = worlds.get(k);
      old.view.dispose();
      old.view.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      worlds.delete(k);
    }
    const level = generateLevel(id);
    w = { level, world: new World(level.cols), view: null };
    applyDetail(getSafe());
    w.view = new WorldView(R.scene, level);
    worlds.set(id, w);
  } else R.scene.add(w.view.root);
  app.level = w.level;
  app.world = w.world;
  app.view = w.view;
  if (auto) auto.settle();
  app.view.setCheckpoints(1, 0);
  app.titleStorm = new Storm(app.level, 1);
  R.setTheme(app.level.mapKey, app.level.look);
  report('stage', { s: 'map', map: id });
}
// Paging through the generated maps with the arrows: a map is only built once you stop on it for a moment.
let soonT = 0;
function loadMapSoon(id) {
  if (id < MAPS.length || worlds.has(id)) return loadMap(id);
  clearTimeout(soonT);
  soonT = setTimeout(() => { if (!app.game) loadMap(id); }, 650);
}

// ---------- the generated maps and the day's climb (level.js mapDef) ----------
// The day's climb: the one the team set on the server (/daily), otherwise the date's.
app.dailyPin = -1;
const todayMap = () => (app.dailyPin >= 0 && mapDef(app.dailyPin) ? app.dailyPin : dailyMap());
const genAbout = (d) => (d.holiday ? `Holiday · ${MAPS[d.base].name}` : `#${d.num} · ${MAPS[d.base].name}`);
const genSvg = (next) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${next ? 'M8 4 L16 12 L8 20' : 'M16 4 L8 12 L16 20'}"/></svg>`;
// The one shown between the arrows: the map you play if it is a generated one, otherwise the last one you looked at.
const genShown = (cur) => (cur >= MAPS.length && mapDef(cur) ? cur : mapDef(settings.genAt) ? settings.genAt : todayMap());
function genCard(id, sel, act = 'gpick') {
  const d = mapDef(id), today = id === todayMap();
  return `<button class="map gen ${sel ? 'sel' : ''}${d.holiday ? ' hol' : ''}" data-a="${act}" data-m="${id}" style="--acc:${d.accent}">
    <b>${esc(d.name)}</b><small>${esc(genAbout(d))}</small>
    <span class="gtags"><em class="gr g${d.grade}">${GRADES[d.grade]}</em>${d.muts.map((m) => `<em>${MUTATORS[m].name}</em>`).join('')}${today ? '<em class="today">Today</em>' : ''}</span></button>`;
}
function genRow(cur, ro) {
  const id = genShown(cur), t = todayMap();
  return `<div class="kind" style="margin:14px 0 6px">More climbs</div>
    <div class="genrow ${ro ? 'ro' : ''}"><button class="gnav" data-a="gprev" aria-label="Previous map">${genSvg(false)}</button>${genCard(id, cur === id)}<button class="gnav" data-a="gnext" aria-label="Next map">${genSvg(true)}</button></div>
    ${ro ? '' : `<div class="row genbtns"><button class="btn sm ${cur === t ? 'primary' : ''}" data-a="gday"><b>Today's climb</b><small>${esc(mapName(t))}</small></button><button class="btn sm" data-a="grand"><b>Surprise me</b></button></div>`}`;
}
// The arrows and buttons of genRow. cur: the map now; set(id) picks one.
function genActs(cur, set) {
  const list = genList(new Date(), todayMap());
  const step = (k) => {
    const at = genShown(cur());
    let i = list.indexOf(at);
    if (i < 0) i = 0;
    // From one of the six worlds the first press picks the one shown.
    set(cur() === at ? list[(i + k + list.length) % list.length] : at);
  };
  return { gprev: () => step(-1), gnext: () => step(1), gday: () => set(todayMap()), grand: () => set(list[(Math.random() * list.length) | 0]), gpick: (b) => set(+b.dataset.m) };
}

function mapCards(sel) {
  return `<div class="maps">${MAPS.map((m) => `<button class="map m${m.id} ${sel === m.id ? 'sel' : ''}" data-a="map" data-m="${m.id}"><b>${m.name}</b></button>`).join('')}</div>`;
}

function pickMap(id, redraw) {
  settings.map = id;
  saveSettings();
  loadMap(id);
  redraw();
}

const shopCtx = { app, show, esc, ui, header, name: () => settings.name, lookChanged };

function banCard(ban) {
  const until = ban.until ? `Until ${esc(new Date(ban.until).toLocaleDateString())}` : 'No end date';
  return `<div class="bancard"><b>You are banned</b><p>Reason: ${esc(ban.reason) || 'No reason given'}</p><small>${until}${ban.num ? ` · Player #${ban.num}` : ''}</small></div>`;
}

// Banned: everything still answers when pressed, to say why it won't open. The checks inside those screens stay as well.
function lockedIf(ban, h) {
  if (!ban) return h;
  const no = () => ui.toast(`You can't use this because you are banned. Reason: ${ban.reason || 'No reason given'}`, 'bad');
  for (const k of ['cont', 'solo', 'host', 'join', 'browser', 'friends', 'shop', 'records', 'settings', 'how', 'donate']) h[k] = no;
  return h;
}

function title() {
  app.screen = 'title';
  const save = validSave('save.solo'), best = bestOf(settings.map), M = mapDef(settings.map), acct = cloud.account(), today = mapDef(todayMap());
  loadMap(settings.map);
  // The first time, and whenever the terms have changed, ask before anything else.
  if (!cloud.banned() && ((cloud.termsNeeded() && !app.termsAsked) || (cloud.serverUrl() && !cloud.account() && !store.get('welcomed2')))) {
    store.set('welcomed2', 1);
    app.termsAsked = true;
    return accountScreen(title);
  }
  const ban = cloud.banned();
  // Banned: every way into the game is grayed out. Account stays, because the terms promise everyone can delete their data there.
  const off = ban ? ' aria-disabled="true"' : '';
  const why = ban ? `Banned: ${esc(ban.reason || 'No reason given')}` : '';
  const notice = ban ? '' : app.maintenance ? `<p class="notice warn">${esc(app.maintenance)}</p>` : app.announcement ? `<p class="notice">${esc(app.announcement)}</p>` : '';
  show(`<div class="title${ban ? ' banned' : ''}">
    <div class="brand">
      <div class="logo">STICKMAN<span>UP</span></div>
      ${ban ? banCard(ban) : ''}
      <p class="ver">v${esc(VERSION)} · ${M.name} · ${Object.keys(best).length ? 'Best ' + Object.entries(best).map(([d, t]) => `${DIFFS[d].name} ${fmtTime(t)}`).join(' · ') : 'Not climbed yet'}</p>
      <p class="ver made">Made by TheOCProductions &amp; ShortGG</p>
      ${notice}
      ${ban ? '' : `<button class="btn sm donate" data-a="donate">♥ Donate</button>`}
    </div>
    <div class="mainbtns">
      ${save ? `<button class="btn primary" data-a="cont"${off}><b>Continue climb</b><small>${ban ? why : `${esc(mapName(save.map || 0))} · ${DIFFS[save.diff].name} · ${Math.round(save.pos[1] - 2)} m · ${fmtTime(save.t)}`}</small></button>` : ''}
      <button class="btn ${save ? '' : 'primary'}" data-a="solo"${off}><b>Solo climb</b>${ban ? `<small>${why}</small>` : ''}</button>
      <button class="btn daily${today.holiday ? ' hol' : ''}" data-a="daily"${off} style="--acc:${today.accent}"><b>Today's climb</b><small>${ban ? why : `${esc(today.name)} · ${GRADES[today.grade]}${today.holiday ? ' · Holiday' : ''}`}</small></button>
      <button class="btn" data-a="host"${off}><b>Host a game</b>${ban ? `<small>${why}</small>` : ''}</button>
      <button class="btn" data-a="join"${off}><b>Join a game</b>${ban ? `<small>${why}</small>` : ''}</button>
      <div class="row"><button class="btn sm frbtn" data-a="friends"${off}><span>Friends</span><span id="frCount">${friendBadge()}</span></button><button class="btn sm" data-a="browser"${off}>Server browser</button></div>
      <div class="row"><button class="btn sm acctbtn" data-a="account"><span>${acct ? esc(acct.user.provider === 'guest' ? 'Guest · sign in' : acct.user.name) : 'Sign in'}</span>${roleChip(myRole())}</button><button class="btn sm shopbtn" data-a="shop"${off}><span>Shop</span><span class="wal"><i class="coin"></i>${myCoins()}</span></button></div>
      <div class="row three"><button class="btn sm" data-a="records"${off}>Records</button><button class="btn sm" data-a="settings"${off}>Settings</button><button class="btn sm" data-a="how"${off}>How to play</button></div>
      <div id="termSlot">${termButton()}</div>
      ${DESK ? '<button class="btn sm" data-a="quit">Quit game</button>' : ''}
    </div></div>`, lockedIf(ban, {
    shop: () => { app.screen = 'shop'; openShop(shopCtx, title); },
    records: () => { app.screen = 'records'; openRecords(shopCtx, title, settings.map); },
    cont: () => startSolo(save.map || 0, save.diff, save),
    solo: soloPick,
    daily: () => { settings.map = todayMap(); settings.genAt = settings.map; saveSettings(); loadMap(settings.map); soloPick(); },
    host: hostPick,
    join: () => joinScreen(cloud.serverUrl() ? 'server' : 'online'),
    browser: () => browserScreen(title),
    friends: () => openFriends(title),
    term: openTerminal,
    account: () => accountScreen(title),
    donate: openDonate,
    settings: () => settingsScreen(title),
    how: () => howTo(title),
    back: () => { if (N && N.exit) N.exit(); },
    quit: () => { if (DESK) DESK.quit(); },
  }), false);
}

function diffCards(sel) {
  const best = bestOf(settings.map), icons = ['◆', '◆◆', '◆◆◆', '◆◆◆◆'];
  return `<div class="cards">${DIFFS.map((d) => `<button class="card d${d.id} ${sel === d.id ? 'sel' : ''}" data-a="pick" data-d="${d.id}">
    <span class="ic">${icons[d.id]}</span><b>${d.name}</b><span class="best">${best[d.id] ? 'Best ' + fmtTime(best[d.id]) : 'Not climbed yet'}</span>${wonOnce(d.id) ? '' : `<span class="best first">First win pays ${d.first} coins</span>`}</button>`).join('')}</div>`;
}

function soloPick() {
  if (cloud.banned()) return title();
  app.screen = 'solo';
  const save = validSave('save.solo');
  show(`<div class="panel">${header('Solo climb')}
    ${mapCards(settings.map)}
    ${genRow(settings.map, false)}
    <div class="kind" style="margin:14px 0 0">Rules</div>
    ${rulesHtml(settings.rules, true, true)}
    ${relicLine(settings.map)}
    <div style="margin-top:14px"></div>
    ${diffCards(-1)}</div>`, {
    back: title,
    rule: (b) => {
      settings.rules[b.dataset.k] = +b.dataset.v;
      saveSettings();
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
    },
    map: (b) => pickMap(+b.dataset.m, soloPick),
    ...genActs(() => settings.map, (id) => { settings.map = id; settings.genAt = id; saveSettings(); loadMapSoon(id); soloPick(); }),
    pick: (b) => { loadMap(settings.map); startSolo(settings.map, +b.dataset.d, null); },
  });
}

function startSolo(map, diff, save) {
  const s = new Session('solo', settings.name, null, myColor(), myLook(), myRole());
  beginGame(s, { map, diff, rules: save ? save.rules || {} : cleanRules(Object.assign({}, settings.rules, { rope: -1 })), t0: 0, rest: save ? save.rest : null, base: save ? save.t : 0, cp: save ? save.cp : 0, falls: save ? save.falls : 0, mz: save ? save.mz | 0 : 0, doors: save ? save.doors : null, pos: save ? { 0: save.pos } : null });
}

app.startSolo = startSolo;
app.title = () => title();
app.loadMapForTest = (id) => loadMap(id);
app.beginGameForTest = (s, g) => beginGame(s, g);

// ---------- hosting ----------
function hostPick() {
  if (cloud.banned()) return title();
  app.screen = 'host';
  show(`<div class="panel fitpanel">${header('Host a game')}
    <div class="cards">
      <button class="card" data-a="server"><span class="ic">🖥</span><b>Game server</b></button>
      <button class="card" data-a="go" data-k="online"><span class="ic">🌐</span><b>Online</b></button>
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

async function hostWith(kind, roomOpts) {
  const s = new Session('host', settings.name, makeLink(kind, kind === 'server' ? { url: cloud.wsUrl(), token: cloud.roomToken(), room: Object.assign({ map: settings.map, diff: 1 }, roomOpts) } : undefined), myColor(), myLook(), myRole());
  let cancelled = false;
  busy(kind === 'server' ? 'Opening your room...' : 'Opening an online room...', () => { cancelled = true; s.close(); hostPick(); });
  wireLobby(s);
  const r = await s.host();
  if (cancelled) return;
  if (!r.ok) { s.close(); ui.toast(r.err || 'Could not start the game', 'bad'); return hostPick(); }
  const mp = validSave('save.mp');
  s.lobby.map = settings.map;
  if (mp) s.lobby.diff = mp.diff;
  app.room = { kind, code: r.code, name: r.name, pub: r.pub, locked: r.locked };
  s.roomInfo = { kind, code: r.code, locked: !!r.locked };
  s.roomPass = (roomOpts && roomOpts.pass) || '';
  if (kind === 'server') s.sendLobby();
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
  s.on('closed', (why) => { cloud.checkStanding(); if (app.game && app.game.s === s) { endGame(); message('Disconnected', why); } else if (app.screen === 'lobby') { message('Disconnected', why); } else if (app.screen === 'friends' && app.lobbyFriends === s) { app.lobbyFriends = null; message('Disconnected', why); } });
}

function lobby(s) {
  if (cloud.banned()) { s.close(); return title(); }
  app.lobbyS = s;
  app.screen = 'lobby';
  const host = s.isHost, room = app.room || {}, mp = host ? validSave('save.mp') : null;
  let info;
  if (!host) info = `<div class="kind">Connected</div><p>Ping: ${s.ping || '...'} ms</p>`;
  else if (room.kind === 'server') info = `<div class="kind">${room.pub ? 'Public room' : 'Private room'}${room.locked ? ' · password' : ''}</div><div class="code">${esc(room.code)}</div><p><b>${esc(room.name)}</b></p>${N && N.share ? '<button class="btn sm" data-a="share" style="margin-top:8px">Share code</button>' : ''}`;
  else info = `<div class="kind">Online room</div><div class="code">${esc(room.code)}</div>${canShare() ? '<button class="btn sm" data-a="share" style="margin-top:8px">Share code</button>' : ''}`;
  const slots = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = s.players.get(i);
    slots.push(p ? `<div class="slot" style="color:${pcol(s, i)}"><span class="dot"></span><span style="color:var(--tx)">${esc(p.name)}${i === s.slot ? ' (you)' : ''}${i === 0 ? ' · host' : ''}</span>${roleTag(p)}<small>${p.ping ? p.ping + ' ms' : ''}</small></div>` : `<div class="slot empty">Open slot</div>`);
  }
  const resume = s.lobby.resume && mp;
  const lmapNow = resume ? mp.map || 0 : s.lobby.map || 0;
  loadMapSoon(lmapNow);
  show(`<div class="panel">${header(host ? 'Your game' : 'Joined game')}
    <div class="lobby">
      <div><div class="room">${info}</div><div class="slots">${slots.join('')}</div>${cloud.account() && s.players.size < MAX_PLAYERS ? '<button class="btn sm" data-a="invite" style="margin-top:10px">Invite friends</button>' : ''}</div>
      <div>
        <div class="kind" style="margin-bottom:6px">Map</div>
        <div class="dsel mrow ${host && !resume ? '' : 'ro'}" style="margin-bottom:10px">${MAPS.map((m) => `<button data-a="lmap" data-m="${m.id}" class="${lmapNow === m.id ? 'sel' : ''}"><b>${m.name}</b></button>`).join('')}</div>
        ${host && !resume ? genRow(lmapNow, false) : lmapNow >= MAPS.length ? `<div class="genrow ro">${genCard(lmapNow, true)}</div>` : ''}
        <div class="kind" style="margin-bottom:6px">Difficulty</div>
        <div class="dsel ${host && !resume ? '' : 'ro'}">${DIFFS.map((d) => `<button data-a="diff" data-d="${d.id}" class="${(resume ? mp.diff : s.lobby.diff) === d.id ? 'sel' : ''}"><b>${d.name}</b></button>`).join('')}</div>
        <div class="kind" style="margin:10px 0 6px">Rules</div>
        ${rulesHtml(resume ? mp.rules || {} : s.lobby.rules || {}, host && !resume)}
        ${friendlyFireHtml(resume ? mp.rules || {} : s.lobby.rules || {}, host && !resume)}
        ${traitorHtml(resume ? mp.rules || {} : s.lobby.rules || {}, host && !resume)}
        <label class="toggle"><input type="checkbox" data-a="nocord" ${(resume ? mp.noCord : s.lobby.noCord) ? 'checked' : ''} ${host && !resume ? '' : 'disabled'}> Play without the cord</label>
        ${mp ? `<label class="toggle"><input type="checkbox" data-a="resume" ${resume ? 'checked' : ''}> Continue the saved climb (${esc(mapName(mp.map || 0))}, ${DIFFS[mp.diff].name}, ${Math.round(mp.pos[1] - 2)} m, ${fmtTime(mp.t)})</label>` : ''}
        ${host ? `<button class="btn primary" data-a="start" style="margin-top:12px"><b>Start the climb</b><small>${s.players.size} climber${s.players.size > 1 ? 's' : ''} ready</small></button>`
    : `<p class="sub" style="margin-top:14px"><span class="spin"></span>&nbsp; Waiting for the host to start...</p>`}
      </div>
    </div></div>`, {
    back: () => { s.close(); title(); },
    share: () => shareText(room.kind === 'server' ? `Join my StickManUp climb! Open StickManUp, tap Join a game and type the code ${room.code}` : `Join my StickManUp climb! Open StickManUp, tap Join a game, then Online, and type the code ${room.code}`),
    diff: (b) => { if (host) s.setLobby({ diff: +b.dataset.d }); },
    lmap: (b) => { if (host) { settings.map = +b.dataset.m; saveSettings(); loadMap(settings.map); s.setLobby({ map: settings.map }); } },
    ...genActs(() => lmapNow, (id) => { if (host && !resume) { settings.map = id; settings.genAt = id; saveSettings(); s.setLobby({ map: id }); } }),
    resume: (b) => s.setLobby({ resume: b.checked }),
    nocord: (b) => { if (host) s.setLobby({ noCord: b.checked }); },
    invite: () => { app.lobbyFriends = s; openFriends(() => { app.lobbyFriends = null; lobby(s); }); },
    rule: (b) => { if (host && !resume) s.setLobby({ rules: Object.assign({}, s.lobby.rules, { [b.dataset.k]: +b.dataset.v }) }); },
    start: () => {
      const save = s.lobby.resume && mp;
      const pos = {};
      if (save) for (const k of s.players.keys()) pos[k] = [save.pos[0] + k * 0.3, save.pos[1] + k * 1.0, save.pos[2]];
      s.startGame({ map: save ? save.map || 0 : s.lobby.map || 0, diff: save ? save.diff : s.lobby.diff, noCord: save ? !!save.noCord : !!s.lobby.noCord, rules: save ? save.rules || {} : cleanRules(s.lobby.rules, true), t0: performance.now(), base: save ? save.t : 0, cp: save ? save.cp : 0, pcp: save ? save.pcp : null, falls: save ? save.falls : 0, mz: save ? save.mz | 0 : 0,
        doors: save ? save.doors : null, pos: save ? pos : null });
    },
  });
}

// ---------- joining ----------
function joinScreen(tab) {
  if (cloud.banned()) return title();
  app.screen = 'join';
  app.joinTab = tab;
  app.joinBack = null;
  const body = tab === 'server' ? `<div class="field"><input class="code" id="scode" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE"></div>
      <div class="field" style="margin-top:8px"><input id="spass" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Password, if the room has one"><button class="btn primary sm" data-a="server">Join</button></div>
      <button class="btn sm" data-a="browser" style="margin-top:10px">Open the server browser</button>`
    : `<div class="field"><input class="code" id="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE"><button class="btn primary sm" data-a="online">Join</button></div>`;
  show(`<div class="panel fitpanel">${header('Join a game')}
    <div class="tabs"><button data-a="tab" data-t="server" class="${tab === 'server' ? 'on' : ''}">Server</button><button data-a="tab" data-t="online" class="${tab === 'online' ? 'on' : ''}">Online</button></div>
    ${body}</div>`, {
    back: title,
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
  });
  const inp = $(tab === 'server' ? '#scode' : '#code');
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
}

function joinWith(kind, target) {
  const s = new Session('client', settings.name, makeLink(kind, kind === 'server' ? { url: cloud.wsUrl(), token: cloud.roomToken() } : undefined), myColor(), myLook(), myRole());
  s.roomInfo = kind === 'server' ? { kind, code: target.code, locked: !!target.pass } : { kind, code: target, locked: false };
  s.roomPass = kind === 'server' ? String(target.pass || '') : '';
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
    <label class="toggle" style="margin-top:12px"><input type="checkbox" id="rlock" data-a="lock"> Needs a password to join</label>
    <div class="field" id="rpassf" style="display:none;margin-top:6px"><input id="rpass" maxlength="64" spellcheck="false" autocomplete="off" placeholder="Password"></div>
    <button class="btn primary" data-a="make" style="margin-top:14px"><b>Create the room</b></button></div>`, {
    back,
    vis: (b) => {
      settings.roomPub = b.dataset.v === '1';
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
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
  const map = mapName(r.map) || 'Unknown map', diff = DIFFS[r.diff] ? DIFFS[r.diff].name : '';
  return `<button class="item" data-a="room" data-code="${esc(code)}" data-locked="${r.locked ? 1 : 0}" ${full ? 'disabled' : ''}><div><b>${r.locked ? '🔒 ' : ''}${esc(r.name)}</b><small>${esc(r.host)} · ${esc(map)} · ${esc(diff)} · ${esc(+r.n || 0)}/${esc(+r.max || 4)} climbers · ${r.started ? 'climbing' : 'in the lobby'}</small></div><span class="go">${full ? 'FULL' : 'JOIN ›'}</span></button>`;
}

function browserScreen(back = title) {
  if (cloud.banned()) return title();
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
  if (a && cloud.isGuest()) {
    const names = { discord: 'Discord', steam: 'Steam', google: 'Google' }, prov = info ? signInWith(info).filter((p) => names[p]) : [];
    show(`<div class="panel" style="width:min(520px,100%)">${header('Account')}${made}
      <div class="slot"><span class="dot"></span><span style="color:var(--tx)"><b>${esc(a.user.name)}</b></span><small>Player #${a.user.num}</small></div>
      <p class="sub" style="margin-top:10px">Your coins and items are safe on the server, but only this phone can reach them. Sign in to keep them on an account: they move there, and work on any phone.</p>
      ${prov.length ? `<div class="provs">${prov.map((p) => `<button class="btn sm prov ${p}" data-a="login" data-p="${p}">Sign in with ${names[p]}</button>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:9px"><button class="btn sm" data-a="back">Back</button><button class="btn sm" data-a="out">Sign out</button></div>
      <button class="btn sm danger" data-a="del" style="margin-top:9px">Delete my guest account</button></div>`, {
      back,
      out: () => signOutFlow(back),
      login: async (b) => {
        app.afterLogin = back;
        await cloud.startLogin(b.dataset.p, info.termsVersion);
        app.screen = 'signingin';
        busy('Finish signing in in your browser, then come back here...', () => { cloud.cancelLogin(); accountScreen(back); });
      },
      del: () => {
        app.screen = 'acctdel';
        show(`<div class="panel" style="width:min(460px,100%)">${header('Delete my guest account')}<p class="sub">This deletes your guest account and its coins from the server, for good.</p>
          <div class="row"><button class="btn sm danger" data-a="yes">Delete forever</button><button class="btn primary sm" data-a="back">Keep it</button></div></div>`, {
          back: () => accountScreen(back),
          yes: async () => {
            if (await cloud.deleteAccount()) { ui.toast('Your guest account is deleted', 'good'); back(); }
            else ui.toast('Could not reach the server, so nothing was deleted', 'bad');
          },
        });
      },
    });
    return;
  }
  if (a) {
    const when = cloud.lastSaved();
    show(`<div class="panel" style="width:min(520px,100%)">${header('Account')}${made}
      <div class="slot"><span class="dot"></span><span style="color:var(--tx)"><b>${esc(a.user.name)}</b></span><small>${esc(({ discord: 'Discord', steam: 'Steam', google: 'Google' })[a.user.provider] || '')} · Player #${a.user.num}</small></div>
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
  const names = { discord: 'Discord', steam: 'Steam', google: 'Google' }, prov = signInWith(info).filter((p) => names[p]);
  show(`<div class="panel">${header('Sign in')}<div class="acct"><div class="terms">${esc(info.terms)}</div><div>${made}
    <p class="sub">Coins and items are kept on the server, so nobody can lose or fake them. Sign in to have them on any phone, or play as a guest on this one.</p>
    <label class="toggle"><input type="checkbox" id="tos" data-a="tos"> I accept these terms</label>
    ${prov.length ? `<div class="provs">${prov.map((p) => `<button class="btn sm prov ${p}" data-a="login" data-p="${p}" disabled>Sign in with ${names[p]}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:9px"><button class="btn primary sm prov" data-a="guest" disabled>Play as guest</button><button class="btn sm" data-a="back">Play without coins</button></div></div></div></div>`, {
    back,
    tos: (b) => { for (const x of document.querySelectorAll('#menu .prov')) x.disabled = !b.checked; },
    guest: async () => {
      if (!$('#tos').checked) return;
      busy('Setting up your coins...', back);
      if (await cloud.startGuest(info.termsVersion, settings.name)) { ui.toast('Welcome! Coins you find now count.', 'good'); back(); }
      else if (cloud.banned()) back();
      else { ui.toast(cloud.guestError || 'Could not reach the server', 'bad'); accountScreen(back); }
    },
    login: async (b) => {
      if (!$('#tos').checked) return;
      app.afterLogin = back;
      await cloud.startLogin(b.dataset.p, info.termsVersion);
      app.screen = 'signingin';
      busy('Finish signing in in your browser, then come back here...', () => { cloud.cancelLogin(); accountScreen(back); });
    },
  });
}

async function signOutFlow(back, force) {
  const guest = cloud.isGuest();
  app.screen = 'acctout';
  // Something on screen right away, because the server can take a moment. It ends by itself within seconds, either way.
  show('<div class="panel" style="width:min(420px,100%);text-align:center"><p style="margin:18px 0"><span class="spin"></span>&nbsp; Signing out...</p></div>');
  if (await cloud.signOut(force)) {
    ui.toast(guest ? 'Signed out. Play as guest to get your coins back.' : 'Signed out. Your progress is safe on your account.', 'good');
    return afterAccount(back);
  }
  show(`<div class="panel" style="width:min(460px,100%)">${header('Sign out')}<p class="sub">Could not reach the server to save your latest progress. If you sign out now, coins and records it hasn't got yet are lost.</p>
    <div class="row"><button class="btn primary sm" data-a="back">Stay signed in</button><button class="btn sm danger" data-a="force">Sign out anyway</button></div></div>`, {
    back: () => accountScreen(back),
    force: () => signOutFlow(back, true),
  });
}
function afterAccount(back) { app.afterLogin = null; back(); }

cloud.on('signedIn', (u) => {
  cloud.checkStanding();
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
cloud.on('guestMoved', () => ui.toast('Your guest coins moved to your account', 'good'));
// Why a climb isn't earning. Said once per kind, so it stays out of the way.
const NOT_COUNTING = {
  room: 'Coins only count alone or in a game server room',
  guest: 'Playing without coins. Open Account to change that',
  save: 'This saved climb can not earn more coins. A new climb can!',
  offline: 'No connection: this climb will not earn coins',
  update: 'Update StickManUp to earn coins again',
  tainted: 'This climb has stopped counting for coins',
  dead: 'This climb has stopped counting for coins',
  gap: 'This climb has stopped counting for coins',
  moved: 'The team moved you: this climb no longer earns coins',
};
const toldNot = new Set();
cloud.on('notCounting', (why) => {
  if (!NOT_COUNTING[why] || toldNot.has(why)) return;
  toldNot.add(why);
  ui.toast(NOT_COUNTING[why], 'bad');
});
cloud.on('daily', (id) => {
  const v = mapDef(id) ? id : -1;
  if (v === app.dailyPin) return;
  app.dailyPin = v;
  if (app.screen === 'title') title();
});
cloud.on('announce', (text) => { app.announcement = text; if (app.screen === 'title') title(); else ui.toast(text); });
cloud.on('maintenance', (text) => { app.maintenance = text; });
// Out of whatever they were doing, straight away.
cloud.on('banned', () => {
  const s = (app.game && app.game.s) || (app.screen === 'lobby' ? app.lobbyS : null);
  if (app.game) endGame();
  endSpectate();
  if (s && s.close) s.close();
  title();
});
cloud.on('unbanned', () => {
  ui.toast('You are not banned any more', 'good');
  if (cloud.account()) cloud.refreshWallet();
  title();
});
// How high this player is right now, for Discord. Only for showing: nothing is paid on it.
cloud.setClimbProbe(() => {
  const g = app.game;
  if (!g || !g.me) return null;
  return { map: g.map | 0, diff: g.diff | 0, h: Math.max(0, Math.round(g.me.y - PR - 2)) };
});
// A word from the admins: what they gave or took, and why. It stays out of the way of a climb and goes by itself.
const inboxWaiting = [];
let inboxShowing = false;
function nextInbox() {
  if (inboxShowing || !inboxWaiting.length) return;
  inboxShowing = true;
  const el = document.createElement('button'), head = document.createElement('b'), body = document.createElement('span'), foot = document.createElement('small');
  el.className = 'svmsg';
  head.textContent = 'From the StickManUp team';
  body.textContent = inboxWaiting.shift();
  foot.textContent = 'Tap to close';
  el.append(head, body, foot);
  document.body.appendChild(el);
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    el.remove();
    inboxShowing = false;
    nextInbox();
  };
  el.addEventListener('click', close);
  setTimeout(close, 12000);
}
cloud.on('inbox', (list) => {
  for (const m of list) inboxWaiting.push(m.text);
  nextInbox();
});
cloud.on('cpReset', (at) => {
  const g = app.game;
  // A climb started after the reset has nothing to do with it.
  if (g && !(g.run.when > at)) g.resetCheckpoint();
  if (app.screen === 'title') title();
});
cloud.on('dayLimit', () => ui.toast('Daily coin limit reached. More tomorrow!', 'bad'));
cloud.on('terms', () => { if (app.screen === 'title') accountScreen(title); });
let roleSeen = myRole();
cloud.on('changed', () => {
  // A flag given or taken away by the bot: the suit that goes with it comes or goes right away.
  if (myRole() !== roleSeen) { roleSeen = myRole(); lookChanged(); }
  if (app.screen === 'title') title();
});

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
    ${ON_PC ? `<label>Frame rate (fps)${seg('cap', [[60, '60'], [90, '90'], [120, '120'], [144, '144']])}</label>` : ''}
    ${canFullscreen() ? '<button class="btn sm" data-a="full">Fullscreen</button>' : ''}
    ${ON_PC ? `<p class="sub full" style="margin:0">Your screen sets the real limit: a 60 Hz screen shows 60 frames a second, whatever you pick here.</p>` : ''}
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
    ${ON_PC ? '' : `<label>Button size ${val('btnSize', '%')}${range('btnSize', 0.7, 1.5, 0.05, '%')}</label>
    <label>Button opacity ${val('btnAlpha', '%')}${range('btnAlpha', 0.3, 1, 0.05, '%')}</label>`}
    <label>Camera speed ${val('sens', '%')}${range('sens', 0.4, 4, 0.05, '%')}</label>
    <label>Aim sensitivity ${val('aimSens', '%')}${range('aimSens', 0.3, 4, 0.05, '%')}</label>
    ${ON_PC ? '' : `<label>Buttons on the${seg('lefty', [[false, 'Right'], [true, 'Left']])}</label>
    <button class="btn sm" data-a="layout">Move buttons...</button>`}
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
    <label class="full">Language${seg('lang', LANG_NAMES)}</label>
    <label>Music${range('music', 0, 1, 0.05)}</label>
    <label>Sound effects${range('sfx', 0, 1, 0.05)}</label>
    <label${app.game ? ' class="full"' : ''}>Your name<input id="nm" maxlength="14" value="${esc(settings.name)}" style="background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;padding:9px 12px;outline:none"></label>
    ${app.game ? '' : '<button class="btn sm" data-a="wardrobe">Your look: open the shop</button>'}
    ${app.game ? '' : '<button class="btn sm" data-a="account">Account and sign in</button>'}
    ${app.game ? '' : '<button class="btn sm donate" data-a="donate">♥ Donate to the makers</button>'}
    <div class="chks full">${N ? chk('haptics', 'Vibration') : ''}${chk('fps', 'Show FPS')}${chk('tips', 'Show tips and ! markers')}${chk('nav', 'Arrow that shows the way up')}${chk('relicMark', 'Marker that shows the nearest relic')}${chk('graffiti', 'Graffiti from other climbers')}</div>
    <button class="btn sm" data-a="tips">Show all tips again</button>
    <button class="btn sm" data-a="movefps">Move FPS counter...</button>
    <p class="sub full" style="margin:0">Graphics chip: ${esc(app.renderer.gpu)}${getSafe() ? ` · safe mode ${getSafe()} of ${MAX_SAFE}` : ''}</p>
    ${getSafe() ? '<button class="btn sm full" data-a="unsafe">Try full graphics again</button>' : ''}
  </div></div>`, {
    unsafe: () => { setSafe(0); restartApp('Restarting with full graphics...'); },
    full: toggleFullscreen,
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
      if (k === 'lang') { saveSettings(); return restartApp('Restarting...'); }
      if (k === 'quality') {
        if (!nat) { saveSettings(); return restartApp('Restarting to apply graphics...'); }
        Object.assign(settings, PRESETS[v]);
        // The player chose: whatever automatic graphics learned about detail starts over.
        settings.autoLow = false;
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
  // Short of CPU time: less to keep up to date, a little less to draw, the extras turned down.
  const thin = !!(settings.autoRes && auto && auto.thin), far = s.far || (thin ? 200 : 0);
  setThin(thin);
  if (app.sound) app.sound.thin = thin;
  R.look.far = far;
  R.mirror.setFar(far);
  R.look.scale = s.res;
  R.look.sharp = settings.sharp * s.sharp;
  R.look.aa = !!settings.aa && !!s.aa;
  R.look.glow = settings.glow * s.glow;
  R.q.bloom = R.look.glow > 0.01;
  R.setLite(!!settings.lite || !!s.lite, s.far && s.far <= 130 ? 0.2 : 0.35);
}

// Automatic graphics starts over (settings or frame rate changed) from the best look.
function restartAuto() {
  settings.autoLvl = 0;
  auto = makeAuto();
}

function makeAuto() {
  const cap = settings.cap || 60;
  return new AutoQ({ budget: 1000 / cap, start: settings.autoLvl || 0, last: cap > 60 ? 3 : STEPS.length - 1, thin: settings.weak > 0 });
}

// Automatic graphics may also decide that this phone gets the simple scenery (fewer parts in the world, simpler sea).
const lowNow = () => !!(settings.autoRes && settings.autoLow);
function applyDetail(safe) {
  setDetail(safe >= 3 || lowNow() || settings.quality === 'low' ? 0 : settings.quality === 'ultra' ? 2 : 1);
}

// The check below takes about 2 ms on a current top phone. These are about 2.5 and 4.5 times slower than that.
const CPU_SLOW = 5, CPU_VERY_SLOW = 9;

// How long a slice of the kind of work the game does takes on this phone's CPU, in ms. The best of a few tries, so a
// moment when something else was running doesn't count against it.
function cpuSpeed() {
  const a = new Float32Array(4096);
  const run = () => {
    let s = 0.5;
    for (let i = 0; i < 150000; i++) { const k = i & 4095; s = Math.sqrt(s * s + a[k]) * 0.999 + 0.25; a[k] = s * 0.5; }
    return s;
  };
  let best = 1e9, keep = 0;
  for (let r = 0; r < 8; r++) {
    const t = performance.now();
    keep += run();
    best = Math.min(best, performance.now() - t);
  }
  return keep > 0 ? best : 0;
}

// Once on each phone: is this a slow one? Then it starts on a lighter picture and simple scenery right away, instead of
// stuttering through the first seconds until automatic graphics finds out. If there turns out to be room, it climbs back.
function checkPhone() {
  if (settings.weak !== undefined || !N) return;
  const ms = cpuSpeed(), ram = navigator.deviceMemory || 8;
  settings.weak = ms > CPU_VERY_SLOW || ram <= 1 ? 2 : ms > CPU_SLOW || ram <= 2 ? 1 : 0;
  report('stage', { s: 'phone', ms: +ms.toFixed(2), ram, cores: navigator.hardwareConcurrency, weak: settings.weak });
  if (settings.weak && settings.autoRes) {
    settings.autoLow = true;
    settings.autoLvl = Math.max(settings.autoLvl || 0, settings.weak > 1 ? 6 : 4);
  }
  saveSettings();
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
  const js = autoN ? autoMs / autoN : 0;
  autoMs = 0;
  autoN = 0;
  perf.gpu = gpu;
  if (!settings.autoRes || !auto) return;
  const was = auto.level, wasThin = auto.thin;
  auto.tick(gpu, gpuMax, late + slow, frames, js);
  perf.level = auto.level;
  if (auto.level !== was || auto.thin !== wasThin) applyLook();
  // Remembered for the next launch, so a weak phone starts where it left off instead of finding out again.
  if (auto.level !== settings.autoLvl && auto.stable()) { settings.autoLvl = auto.level; saveSettings(); }
  // Settled low: the next map and the next launch get the simple scenery. Settled with lots of room: the normal one again.
  const low = auto.stable() && (auto.level >= 6 || auto.thin) ? true : auto.roomy() ? false : !!settings.autoLow;
  if (low !== !!settings.autoLow) { settings.autoLow = low; saveSettings(); }
}

// Touch buttons: centres measured from the bottom-right corner (bottom-left for left-handed), scaled by size.
const BTN = { bJump: [66, 64, 96], bGrab: [163, 59, 74], bReel: [77, 165, 74], bAct: [167, 149, 74], bShoot: [252, 160, 74], bDash: [252, 72, 74], bShield: [340, 112, 74] };
function applyLayout() {
  // On a PC nothing presses them: they are small, and show the keys, the grip and what is ready.
  const small = ON_PC || document.body.classList.contains('pad'), k = small ? 0.68 : settings.btnSize, pos = small ? {} : settings.btnPos || {}, lefty = !small && settings.lefty, side = lefty ? 'left' : 'right', other = lefty ? 'right' : 'left';
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
  if (app.input) app.input.lefty = !!lefty;
}

// With a controller in the hands every button on screen says which one it is, the way that controller names them.
function padButtons(on) {
  applyLayout();
  if (!on) { $('#padCard').classList.remove('on'); return; }
  const L = padNames(nav && nav.name), body = document.body.classList;
  body.remove('pstyle-xbox', 'pstyle-ps', 'pstyle-nin');
  body.add('pstyle-' + L.style);
  const put = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    let g = el.querySelector('.gp');
    if (!g) { g = document.createElement('kbd'); el.append(g); }
    g.className = 'gp ' + cls;
    g.textContent = text;
  };
  put('bJump', L.jump, 'c0'); put('bGrab', L.grab, 'c1'); put('bAct', L.act, 'c2'); put('bDash', L.dash, 'c3');
  put('bShield', L.shield, 'wide'); put('bReel', L.reel, 'wide'); put('bShoot', `${L.aim} + ${L.fire}`, 'wide');
  put('hEmote', L.emote, 'wide'); put('hPause', L.pause, 'wide');
  $('#padCard').innerHTML = padKeys();
  if (app.screen === 'game') showPadCard();
}
const padKey = (text, cls, word) => `<span><kbd class="gp ${cls}">${esc(text)}</kbd>${word}</span>`;
function padKeys() {
  const L = padNames(nav && nav.name);
  return `<div class="padkeys">${padKey(L.jump, 'c0', 'Jump')}${padKey(L.grab, 'c1', 'Grab')}${padKey(L.act, 'c2', 'Action')}${padKey(L.dash, 'c3', 'Dash')}${padKey(L.aim, 'wide', 'Aim')}${padKey(L.fire, 'wide', 'Fire')}${padKey(L.reel, 'wide', 'Reel')}${padKey(L.shield, 'wide', 'Shield')}${padKey(L.emote, 'wide', 'Emotes')}${padKey(L.pause, 'wide', 'Pause')}</div>`;
}
// A reminder of the buttons at the start of a climb, or when a controller is first picked up during one.
let padCardT = 0;
function showPadCard() {
  if (!document.body.classList.contains('pad')) return;
  const c = $('#padCard');
  c.innerHTML = padKeys();
  c.classList.add('on');
  clearTimeout(padCardT);
  padCardT = setTimeout(() => c.classList.remove('on'), 9000);
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
    ${ON_PC
    ? '<div><b>Mouse and keyboard</b>W A S D moves and the mouse turns the camera. Space jumps, C grabs (Ctrl too in the PC app), E reels, Left Shift dashes, F is the action button and Q the shield. Hold right click to aim, then left click fires. T opens emotes, H reads a tip and Esc pauses. A controller works too.</div>'
    : '<div><b>Move and look</b>Touch the left side to get a stick under your thumb. Drag the right side to turn the camera.</div>'}
    <div><b>JUMP</b>Tap for a hop, hold for full height. You can still jump for a split second after running off an edge.</div>
    <div><b>GRAB (hold)</b>Clamps you to whatever you're touching, even walls. The ring shows your grip, which drains faster on walls. It stops you sliding, but a hit from an enemy or a trap still tears you off.</div>
    <div><b>REEL (hold)</b>Pulls the cord in to haul a dangling partner up. Let go and it slowly lets out again.</div>
    <div><b>Sling</b>While holding GRAB, hold REEL, then let go of REEL. A partner on a tight cord gets flung upward.</div>
    <div><b>A partner falls</b>Their weight drags you toward the edge. Hold GRAB to stop, or walk away from the edge to haul them up.</div>
    <div><b>Wall jump</b>In the air against a wall, press JUMP to kick off it, up and away. Hold the stick into a wall to slide down it slowly. The same wall won't kick you twice in a row, so bounce between two walls to climb them. Works while clamped with GRAB too.</div>
    <div><b>DASH</b>A fast burst the way the stick points, or the way the camera looks. One in the air, and landing, a wall jump or a grab gives it back. Glowing arrows mean the gap is too wide without it: jump, then dash near the top of the jump.</div>
    <div><b>Emotes and stunts</b>The smiley at the top of the screen opens your emotes: waves, flips, breakdance and more. Flips work in the air as well. The rest are in the shop.</div>
    <div><b>GRAPPLE</b>Near a glowing hook the action button says GRAPPLE. Tap it to zip up to the hook and get thrown across the gap.</div>
    <div><b>Jumpers</b>Angry dummies guard the ledges from about 500 m up (on Hardcore and Insane already from 50 m). Come close and they run at you and jump kick you off. Jump past them, or SHOOT to paralyse them for over a minute.</div>
    <div><b>Coins and the shop</b>Coins hang all along the route. Each is worth 1 on Easy, 2 on Normal, 3 on Hardcore and 4 on Insane, and the top pays a big bonus. A coin you took stays gone after a fall. Spend them in the shop on colours, flags, faces, hats and costumes.</div>
    <div><b>Legendary suits</b>Some can be bought for a lot of coins. Some are earned by what you do on Hardcore. The rest are relics, on the maps on any difficulty: at the end of the relic courses and in the maze gardens.</div>
    <div><b>Mazes</b>Creatures hunt you through the corridors once they notice you. You have 3 hearts in each maze: a bite takes one, and with none left you go back to the checkpoint. SHOOT paralyses a creature for a while.</div>
    <div><b>Relic courses</b>Each map has four hard parkour courses out past the route, each with a relic at the end that opens things in the shop. Look for a gate with a pillar of light: a marker on the screen and gems on the height bar show where the nearest ones are. A fall brings you back to the last green marker on the course, and the ring at the end takes you back to the route.</div>
    <div><b>Records</b>The title screen keeps your best climbs on every map: how high you got, on which difficulty, how many falls, how long and how many coins.</div>
    <div><b>SHOOT</b>Doors block some bridges. Hold SHOOT to aim at the round target and let go to open the door for the whole team. A shot paralyses monsters, bats and jumpers for over a minute, and longer with better weapons. Weapons are in the shop.</div>
    <div><b>Storm Tower</b>When a yellow ring appears under you, lightning is coming for you: tap SHIELD right away. Rods glow before they strike: get away from them or SHIELD. Laser bars spin low (jump them) and laser gates switch on and off. Fans and gusts blow you around: GRAB or wait for them to stop. Ice is slippery, cracked floors fall away, pads launch you up.</div>
    <div><b>Sunny Isles</b>The route zigzags across the lighthouse. Arrow traps fire across the bridges and some platforms swing like pendulums: ride them over.</div>
    <div><b>Magma Chimney</b>You climb up the inside of a volcano. Stand on a vent when it erupts and it launches you up to the ledge above, but standing next to it gets you shoved off. Shadows show where boulders are about to land.</div>
    <div><b>Neon Skyline</b>Climb round a skyscraper, then cross to the next one over a sky bridge or with a GRAPPLE zipline. Conveyor belts carry you along, drones patrol (SHOOT stuns them) and laser gates switch on and off.</div>
    <div><b>Waterfall</b>Climb a mossy rock with waterfalls pouring down it. Water slides shove you back down, so run up them and jump the inner tubes rolling at you. Launch slides whoosh you down a chute and throw you onto a higher ledge. Fish leap across the bridges along the water arcs, fountains launch you up when they spout, and lazy rivers carry you toward the edge.</div>
    <div><b>Wild Forest</b>Monsters patrol wide ledges and bats circle the gaps. Time your run or SHOOT them first.</div>
    <div><b>Map events</b>From about 400 m up, every map sends its own trouble now and then, and the HUD warns you first. Storm Tower: gusts blow you about, so GRAB. Waterfall: a wave runs round the rock, so jump it or GRAB. Neon Skyline: laser strikes aim at you, so keep moving out of the red rings. Sunny Isles: the pirate ship fires cannonballs, so get out of the orange rings. Magma Chimney: a quake throws you up at every shock, so jump just before it. Wild Forest: a bee swarm chases you, so outrun it. Inside a maze garden none of it can reach you.</div>
    <div><b>Bees</b>Can't outrun the swarm? Tap SHIELD just as it reaches you and it drives the bees off. The shield works on Storm Tower against lightning and in the Wild Forest against the bees.</div>
    <div><b>Falling</b>A fall drops you to whatever is below. Hit the ground and the team restarts at the last checkpoint (with checkpoints off: back at the start). Without the cord, only you go back, to your own last checkpoint.</div>
    <div><b>Obstacles</b>Every map has 26 of its own: swinging weights, rolling logs and balls, presses that slam down, spikes that pop up, jets, spinning bars, bumpers that throw you, platforms that blink out or drop open, turntables, mud that slows you and slippery decks. Most of them shake, flicker or glow just before they strike, so watch for the warning. The higher you climb, the more of them there are and the faster they move, and near the top come six harder endgame ones.</div>
    <div><b>Rules</b>Easy only switches on the gentler obstacles and runs them slower; Hardcore switches on all of them and speeds them up, and Insane runs them faster still with less grip and no late jumps. Under Rules you can pick checkpoints, obstacles and the cord length yourself instead (Auto follows the difficulty). Climbs with custom rules keep their own best times.</div>
    <div><b>Keyboard</b><kbd>WASD</kbd> move, <kbd>Space</kbd> jump, <kbd>C</kbd>${IS_WEB ? '' : ' or <kbd>Ctrl</kbd>'} grab, <kbd>E</kbd> reel, <kbd>Left Shift</kbd> dash, <kbd>T</kbd> emotes, <kbd>F</kbd> grapple/shoot, <kbd>Q</kbd> shield, mouse drag to look.</div>
    <div><b>Controller</b>Left stick move, right stick camera, <kbd>A</kbd> jump, <kbd>B</kbd> grab, <kbd>RB</kbd> reel, <kbd>Y</kbd> or <kbd>L3</kbd> dash, <kbd>LT</kbd> hold to aim, <kbd>RT</kbd> fire while aiming, <kbd>Down</kbd> on the direction pad emotes, <kbd>X</kbd> grapple, <kbd>LB</kbd> shield, <kbd>Start</kbd> pause, <kbd>Select</kbd> pause on Back to checkpoint, up on the direction pad reads the nearest tip. All menus work with it too, and Settings has a dead zone for each stick against stick drift.</div>
    <div><b>Saving</b>Your climb saves itself. Solo: Continue on the title screen. Multiplayer: the host can continue the saved climb from the lobby.</div>
  </div></div>`, { back });
}

function message(t, text, then = title) {
  app.screen = 'msg';
  show(`<div class="panel" style="width:min(440px,100%)">${header(esc(t))}<p class="sub">${esc(text)}</p><button class="btn primary sm" data-a="back">OK</button></div>`, { back: then });
}

// ---------- in game ----------
function beginGame(s, g) {
  if (cloud.banned()) { if (s && s.close) s.close(); return title(); }
  if (app.game) app.game.destroy();
  endSpectate();
  hideMenu();
  app.lobbyFriends = null;
  app.screen = 'game';
  app.paused = false;
  app.input.reset();
  $('#touch').classList.add('on');
  $('#hud').classList.add('on');
  app.input.enabled = true;
  loadMap(g.map || 0);
  for (const r of app.pool.robots) { r.hide(); r.flip = 0; }
  for (const r of app.pool.jumpers || []) r.hide();
  for (const l of app.pool.ropes) l.mesh.visible = false;
  app.game = new Game(app, s, g);
  app.graffiti.clear();
  loadSprays(app.game.map);
  app.ghostRec = new GhostRec();
  loadGhosts(app.game);
  app.traitor.begin(app.game);
  applyVanish(live.staff());
  keepAwake(true);
}

function endGame() {
  // Asked now because the game is still here: this is the last height Discord gets to see.
  cloud.checkStanding();
  cloud.runEnd();
  cloud.flush();
  closeEmotes();
  if (app.game && !app.game.won) ghostEnd(app.game, false);
  if (app.game) { app.game.destroy(); app.game = null; }
  app.graffiti.clear();
  app.ghosts.clear();
  $('#hGhost').hidden = true;
  app.traitor.end();
  app.paused = false;
  app.input.enabled = false;
  app.input.reset();
  $('#touch').classList.remove('on');
  $('#hud').classList.remove('on');
  $('#tags').innerHTML = '';
  ui.clearTips();
  ui.cross(false);
  keepAwake(false);
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
    ${inviteNow() ? `<button class="btn primary" data-a="invite"><b>Join ${esc(inviteNow().name)}</b><small>They invited you to their climb</small></button>` : ''}
    ${g.diff < 2 ? `<button class="btn" data-a="respawn"><b>Back to checkpoint</b><small>${mp ? 'Moves the whole team' : 'If you are stuck'}</small></button>`
    : `<button class="btn danger" data-a="respawn"><b>Restart the climb</b><small>${DIFFS[g.diff].name}: everyone back to the start</small></button>`}
    <div class="row"><button class="btn sm" data-a="friends">Friends</button><button class="btn sm" data-a="ghosts">Ghosts</button><button class="btn sm" data-a="settings">Settings</button><button class="btn sm" data-a="how">How to play</button>${live.staff() ? '<button class="btn sm" data-a="term">Terminal</button>' : ''}</div>
    ${app.traitor.on ? `<button class="btn" data-a="traitor"><b>Traitor mode</b><small>${app.traitor.over ? 'It is decided' : 'Clues and calling a vote'}</small></button>` : ''}
    <button class="btn danger" data-a="quit"><b>${mp ? (g.s.isHost ? 'Save and end the game' : 'Leave the game') : 'Save and quit'}</b></button>
    ${mp ? '<p class="note">The climb keeps going for everyone while this menu is open.</p>' : ''}
    ${padKeys()}</div>`, {
    back: resume,
    respawn: () => { g.s.toHost({ k: 'restart' }); resume(); },
    settings: () => settingsScreen(pause),
    ghosts: () => ghostMenu(pause),
    traitor: () => trMenu(pause),
    how: () => howTo(pause),
    friends: () => openFriends(pause),
    invite: () => acceptInvite(pause),
    term: openTerminal,
    quit: () => { if (g.s.isHost) g.save(); endGame(); title(); },
  });
}

// Traitor mode: the clues so far, and calling a vote.
function trMenu(back) {
  const T = app.traitor, g = app.game;
  if (!g || !T.on) return back();
  const res = T.result;
  show(`<div class="pause"><h2>Traitor mode</h2>
    ${T.me ? '<p class="note">You are the traitor</p>' : ''}
    ${res ? `<p class="note">${res.win === 'team' ? `Caught: ${esc(res.name)} was the traitor.` : res.win === 'left' ? 'The traitor left the climb.' : `The traitor won: it was ${esc(res.name)}.`}</p>` : ''}
    <div class="kind">Clues</div>
    ${T.clues.length ? `<ul class="trclues">${T.clues.slice().reverse().map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="sub">No sabotage yet.</p>'}
    <p class="sub">Wrong votes: ${T.wrong} of 2</p>
    ${!T.over ? '<button class="btn primary" data-a="call"><b>Call a vote</b></button>' : ''}
    <button class="btn" data-a="back"><b>Back</b></button></div>`, {
    back,
    call: () => { T.callVote(); resume(); },
  });
}

// ---------- the team's terminal (terminal.js) ----------
const termButton = () => (live.staff() ? `<button class="btn sm termbtn" data-a="term"><span>Terminal</span>${live.staff().vanished ? '<em class="termvan">VANISHED</em>' : ''}</button>` : '');
// What the server said to do after /watch or /join. A solo climb is saved first, to carry on later; a game with others is not
// left without asking.
function teamAct(m) {
  const g = app.game;
  const go = (fn) => {
    if (g && !g.solo) return termSay(tr('You are in a game with others. Leave it first (pause, then leave the game), then try again.'), 'warn');
    if (g) { g.save(); endGame(); }
    closeTerminal();
    if (app.spec || app.screen === 'spec') endSpectate();
    fn();
  };
  if (Number.isInteger(m.watch)) {
    const p = termSeen(m.watch), room = p && p.room && p.room.kind === 'server' ? Object.assign({}, p.room, { locked: false }) : null;
    go(() => watchPlayer(m.watch, { num: m.watch, name: String(m.name || (p && p.name) || `#${m.watch}`).slice(0, 20), room, n: p ? p.n : 1 }, title));
  } else if (typeof m.join === 'string' && /^[A-Z0-9]{5}$/.test(m.join)) go(() => joinPlayerRoom(m.join, title));
}

// ---------- friends: invites, and going over to someone else's climb ----------
// The room this player is in right now, to invite friends to (friends.js): a game with others or a lobby, not a climb alone.
function myRoom() {
  const s = app.game ? (app.game.won ? null : app.game.s) : app.screen === 'lobby' ? app.lobbyS : app.lobbyFriends;
  return s && s.roomInfo ? { room: s.roomInfo, n: s.players.size, pass: s.roomPass || '' } : null;
}

// Off to someone else's climb: an invite, or Join or Watch on the Friends screen. A climb alone is saved to carry on later. A
// game or lobby with others asks first, because when it is mine it ends for everyone in it.
function leaveThen(go, stay) {
  const g = app.game, lob = !g && app.lobbyS && (app.screen === 'lobby' || app.lobbyFriends) ? app.lobbyS : null;
  const away = () => {
    const h = app.game;
    if (h) { if (h.s.isHost && !h.won) h.save(); endGame(); } else if (lob) lob.close();
    app.lobbyFriends = null;
    if (app.spec || app.screen === 'spec') endSpectate();
    go();
  };
  if (!(g && !g.solo && !g.won) && !lob) return away();
  const s = g ? g.s : lob, back = stay || (g ? (app.paused ? pause : resume) : () => lobby(lob));
  app.screen = 'msg';
  if (g) { app.input.enabled = false; app.input.reset(); }
  show(`<div class="panel" style="width:min(440px,100%)">${header(g ? 'Leave this game?' : 'Leave this lobby?')}
    <p class="sub">${s.isHost ? (g ? 'You are the host, so it ends for everyone in it. The climb is saved.' : 'You are the host, so it ends for everyone in it.') : 'The others carry on without you.'}</p>
    <div class="row"><button class="btn sm" data-a="back">Stay</button><button class="btn primary sm" data-a="go">Leave</button></div></div>`, { back, go: away });
}

// A friend asked this player along (live.js). A card shows it for half a minute, in the menus or during a climb, and the pause
// menu offers it for two minutes.
const INVITE_SHOW = 30000, INVITE_KEEP = 120000;
let inviteEl = null, inviteT = 0;
const inviteNow = () => (app.invite && Date.now() - app.invite.at < INVITE_KEEP ? app.invite : null);
const inviter = (m) => (m && m.name ? String(m.name).slice(0, 20) : `Player #${(m && m.num) | 0}`);
function hideInvite() {
  clearTimeout(inviteT);
  if (inviteEl) inviteEl.classList.remove('on');
}
// Vanished on a climb: gone for the others and flying (game.js setFlying).
function applyVanish(s) {
  const g = app.game, on = !!(s && s.vanished);
  if (!g || !s || on === g.flying || g.won) return;
  g.setFlying(on);
  if (on) ui.toast(ON_PC ? 'Flying: WASD moves, Space goes up, C goes down, E goes fast' : 'Flying: JUMP goes up, GRAB goes down, REEL goes fast', 'good');
  else ui.toast('You can be seen again: back on your feet', '');
}

function showInvite(m) {
  const r = m && m.room;
  if (cloud.banned() || !r || (r.kind !== 'server' && r.kind !== 'online') || !/^[A-Z0-9]{5}$/.test(String(r.code))) return;
  const mine = myRoom();
  if (mine && mine.room.code === r.code) return;
  app.invite = { num: m.num | 0, name: inviter(m), room: { kind: r.kind, code: String(r.code), locked: !!r.locked }, pass: typeof m.pass === 'string' ? m.pass.slice(0, 64) : '', at: Date.now() };
  if (!inviteEl) {
    inviteEl = document.createElement('div');
    inviteEl.id = 'invite';
    document.body.appendChild(inviteEl);
    inviteEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      app.sound.ui();
      if (b.dataset.i === 'join') acceptInvite();
      else { hideInvite(); app.invite = null; }
    });
  }
  const where = [mapName(m.map), DIFFS[m.diff] ? DIFFS[m.diff].name : '', `${Math.min(4, Math.max(1, m.n | 0))}/4 climbers`].filter(Boolean).join(' · ');
  inviteEl.innerHTML = `<div class="itext"><b class="frname">${esc(app.invite.name)}</b><span>invites you to their climb</span><small>${esc(where)}</small>${ON_PC && app.game ? '<small>Press Esc to answer</small>' : ''}</div>
    <div class="ibtns"><button class="btn primary sm" data-i="join">Join</button><button class="btn sm" data-i="no">Not now</button></div>`;
  inviteEl.classList.add('on');
  ui.haptic('tick');
  clearTimeout(inviteT);
  inviteT = setTimeout(hideInvite, INVITE_SHOW);
}
function acceptInvite(stay) {
  const v = inviteNow();
  hideInvite();
  app.invite = null;
  if (!v) return ui.toast('That invite has run out. Ask your friend again.', 'bad');
  leaveThen(() => {
    app.joinBack = title;
    if (v.room.kind === 'online') joinWith('online', v.room.code);
    else if (v.room.locked && !v.pass) roomPassword(v.room.code, title);
    else joinWith('server', { code: v.room.code, pass: v.pass });
  }, stay);
}

function resume() {
  hideMenu();
  app.paused = false;
  app.input.enabled = true;
  app.screen = 'game';
}

app.finish = (r) => {
  ghostEnd(app.game, !r.far, r.time);
  app.input.enabled = false;
  app.input.reset();
  setTimeout(() => {
    show(`<div class="results">${r.record ? '<div class="rec">New best time</div>' : ''}<h1>SUMMIT REACHED</h1>
      <p class="sub">${r.players > 1 ? `${r.players} climbers` : 'You'} reached the top of ${esc(mapName(r.map || 0))} on ${DIFFS[r.diff].name}.</p>
      ${traitorLine(r.tr)}
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
  if (!v) cloud.flush(); else cloud.checkNews();
  if (!app.sound) return;
  app.sound.suspend(!v);
  if (!v && app.game && app.game.solo && !app.paused) pause();
};
// The page or window is closing: keep the climb, and send what the server hasn't got yet.
window.SMU_leave = () => {
  try { if (app.game && app.game.s.isHost && !app.game.won) app.game.save(); } catch (e) { /* what was saved before stays */ }
  return cloud.flush();
};
window.SMU_insets = (l, t, r, b) => {
  const s = document.documentElement.style;
  s.setProperty('--il', l + 'px'); s.setProperty('--it', t + 'px'); s.setProperty('--ir', r + 'px'); s.setProperty('--ib', b + 'px');
};

// ---------- boot & loop ----------
// What this phone is doing, for friends to see. Only for showing: nothing is paid on it.
function startLive() {
  // (Still in the lobby while its Friends screen is open, to invite from.)
  const lobbyNow = () => (app.screen === 'lobby' ? app.lobbyS || null : app.lobbyFriends || null);
  live.startLive({
    name: () => settings.name,
    climb: () => app.game,
    paused: () => !!app.paused,
    presence: () => {
      const g = app.game;
      if (g) {
        const P = { st: 'climb', map: g.map, diff: g.diff, n: Math.max(1, g.s.players.size), h: Math.max(0, Math.round(g.me.y - PR - 2)), top: Math.round(g.L.top - 2), T: g.time, f: g.falls, solo: g.solo, paused: !!app.paused, won: g.won };
        if (g.s.roomInfo) P.room = g.s.roomInfo;
        return P;
      }
      const s = lobbyNow();
      if (s) return { st: 'lobby', map: s.lobby.map || 0, diff: s.lobby.diff || 0, n: Math.max(1, s.players.size), room: s.roomInfo };
      return { st: app.spec ? 'watch' : 'menu' };
    },
  });
  // Refused by the server: its own answer says why, and whether that means being banned.
  live.on('off', () => cloud.checkStanding());
  live.on('cpreset', (m) => cloud.checkpointReset(m.at));
  live.on('tp', (m) => { if (app.game) app.game.teleport(m); });
  // Not when the connection drops (s is null then): that must not drop anyone out of the air or show them.
  live.on('staff', (s) => { if (s) applyVanish(s); });
  live.on('where', (m) => { const g = app.game; if (g && !g.won) live.here(m.q, { map: g.map, diff: g.diff, pos: [g.me.x, g.me.y, g.me.z] }); });
  live.on('invite', showInvite);
  live.on('invited', (m) => ui.toast(`Invite sent to ${inviter(m)}`, 'good'));
  live.on('inviteErr', (m) => ui.toast(String((m && m.why) || 'Could not send the invite').slice(0, 140), 'bad'));
  let watchedBy = new Set();
  live.on('watchers', (m) => {
    const names = Array.isArray(m.names) ? m.names.map((x) => String(x).slice(0, 20)) : [], el = $('#hWatch');
    if (el) { el.textContent = m.n > 0 ? `👁 ${m.n}` : ''; el.classList.toggle('on', m.n > 0); }
    if (app.game) for (const x of names) if (!watchedBy.has(x)) ui.toast(`${x} is watching your climb`);
    watchedBy = new Set(names);
  });
}

function boot() {
  const safe = getSafe();
  report('stage', { s: 'boot', safe, quality: settings.quality });
  setSimple(safe >= 3);
  checkPhone();
  applyDetail(safe);
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
  app.renderer = new Renderer($('#c'), lowNow() ? 'low' : settings.quality, safe, send);
  app.renderer.onLost = () => gfxTrouble('webgl context lost');
  if (settings.lite === undefined) settings.lite = settings.quality === 'low';
  auto = makeAuto();
  if (N && N.glInfo) app.renderer.gpu = N.glInfo() || 'native OpenGL';
  report('stage', { s: 'renderer', gpu: app.renderer.gpu, native: !!send, maxPx: app.renderer.maxPx });
  loadMap(settings.map);
  report('stage', { s: 'world' });
  app.pool = makePool(app.renderer.scene);
  app.fx = new Fx(app.renderer.scene);
  app.viewGun = new ViewGun(app.renderer.scene);
  app.evfx = new EventFx(app.renderer.scene);
  app.graffiti = new Graffiti(app.renderer.scene);
  app.ghosts = new Ghosts(app.renderer.scene);
  app.traitor = new Traitor(app);
  app.traitor.mount();
  $('#hTr').addEventListener('click', () => { if (app.game && !app.game.won) { pause(); trMenu(pause); } });
  app.onSpray = onSpray;
  app.input = new Input($('#touch'));
  app.input.onPause = () => { if (app.screen === 'game') pause(); else if (app.screen === 'pause') resume(); else if (ON_PC && app.screen !== 'title') goBack(); };
  app.input.onTip = () => { if (app.screen === 'game' && ui.nearTip) ui.tip(ui.nearTip); };
  if (ON_PC) for (const [id, key] of [['bJump', 'Space'], ['bGrab', 'C'], ['bReel', 'E'], ['bAct', 'F'], ['bShoot', 'Right + Left'], ['bShield', 'Q'], ['bDash', 'Shift']]) {
    const k = document.createElement('kbd');
    k.textContent = key;
    $('#' + id).append(k);
  }
  app.sound = new Sound();
  applySettings();
  $('#hPause').addEventListener('click', () => { app.sound.ui(); pause(); });
  app.input.onEmote = () => toggleEmotes(false);
  $('#hEmote').addEventListener('click', () => toggleEmotes(false));
  $('#emoteMenu').addEventListener('click', (e) => {
    // The checkpoint emote: the next one of yours, then none.
    if (e.target.closest('[data-cpe]')) {
      const opts = ['', ...cpEmotes().map((x) => x.id)], i = opts.indexOf(settings.cpEmote);
      settings.cpEmote = opts[(i + 1) % opts.length];
      saveSettings();
      app.sound.ui();
      openEmotes(!!app.input.padLock);
      return;
    }
    const sp = e.target.closest('[data-spray]');
    if (sp) { sprayNow(sp.dataset.spray); closeEmotes(); return; }
    const b = e.target.closest('[data-em]');
    if (!b) return;
    if (app.game) app.game.emote(b.dataset.em);
    closeEmotes();
  });
  // Touching anywhere else closes it, and still counts as what it touched.
  document.addEventListener('pointerdown', (e) => { if (emoteOpen() && !e.target.closest('#emoteMenu, #hEmote')) closeEmotes(); }, { capture: true });
  nav = new PadNav({
    using: padButtons,
    input: app.input,
    root: () => { if (app.spec && app.spec.fly) return null; const m = $('#menu'); return m.classList.contains('on') ? m : emoteOpen() ? $('#emoteMenu') : app.screen === 'layout' || app.screen === 'fpsmove' ? $('#editBar') : null; },
    screen: () => app.screen,
    // On the title screen B does nothing: closing the whole app is for the phone's own back button.
    back: () => { if (app.screen !== 'title') goBack(); },
    start: (select) => {
      // Select: the highlight starts on Back to checkpoint, so it is two presses away during a climb.
      if (app.screen === 'game') { pause(); nav.aim(select ? 'respawn' : 'back'); }
      else if (app.screen === 'pause') resume();
      else if (app.spec && app.spec.fly) app.spec.setFly(false);
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
  // Which of these lets sound start depends on the browser (an iPhone wants the end of a touch).
  for (const k of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(k, () => app.sound.init(), { capture: true });
  window.addEventListener('resize', () => app.renderer.resize());
  if (N && N.insets) { const i = JSON.parse(N.insets()); window.SMU_insets(i.l, i.t, i.r, i.b); }
  cloud.setTestServer(settings.server);
  cloud.start();
  initFriends({ app, show, esc, ui, header, busy, joinWith, roomPassword, loadMap, settings, N, account: accountScreen, title, leaveThen, myRoom, canShare, share: shareText, team: live.staff, openTerminal });
  initTerminal({
    esc,
    act: teamAct,
    // Opened during a solo climb: the climb waits.
    opened: () => { if (app.screen === 'game' && app.game && app.game.solo) pause(); },
    staffChanged: () => { const s = $('#termSlot'); if (s) s.innerHTML = termButton(); },
  });
  if (!N) {
    // What the Android app tells the game itself.
    document.addEventListener('visibilitychange', () => window.SMU_vis(!document.hidden));
    window.addEventListener('pagehide', () => window.SMU_leave());
  }
  initUpdater(app);
  startLive();
  title();
  requestAnimationFrame(frame);
  window.SMU_booted = true;
  if (N && N.booted) N.booted();
  setTimeout(() => $('#loading').classList.add('gone'), 300);
}

let last = performance.now(), titleT = 0, bolt = 2, fpsN = 0, fpsT = 0, then = 0, auto = null, autoAt = 0, nav = null;
let rafLast = 0, rafN = 0, rafPeriod = 0, rafCount = 0;
const rafGaps = new Float32Array(32);
const perf = { ms: 0, max: 0, n: 0, show: '', gap: 0, gpu: 0, level: 0 };
let autoMs = 0, autoN = 0;
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
  if (app.game) {
    const g = app.game, me = g.me;
    g.update(dt, app.paused);
    ghostTick(g, dt);
    if (app.traitor.on) { app.traitor.tick(g); app.traitor.frame(); }
    // Through your eyes in a maze garden: the gun in your hands (not with a scope up, that has its own view).
    app.viewGun.update(dt, app.renderer.camera, g.flying ? 0 : (g.fpK || 0) * (1 - (g.scopeK || 0)), { weapon: g.gun, aim: g.aiming, speed: Math.hypot(me.vx, me.vz), ground: me.grounded, shot: g.time - (g.lastShot ?? -9), world: g.W, rig: g.robots.get(g.slot) });
  } else if (app.spec) {
    app.spec.update(dt);
    app.viewGun.update(dt, app.renderer.camera, app.spec.view ? app.spec.fpK || 0 : 0, app.spec.view);
  } else { titleScene(dt); app.viewGun.update(dt, app.renderer.camera, 0, null); }
  live.tick(dt);
  if (app.renderer.lost) return;
  app.renderer.render();
  app.pool.tick();
  const work = performance.now() - w0;
  autoMs += work;
  autoN++;
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

const health = { t: performance.now(), beat: 0, white: 0, rb: null, since: performance.now(), healthy: false, frames: 0 };

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

// Read the drawing buffer: catches broken render output (the native probe sees the real screen). The five pixels are
// copied on the GPU into a buffer, and picked up a frame or more later, once the GPU says it is done. Reading them
// straight away made the game wait for the GPU to finish everything it had queued, every 4 seconds: on a fast PC
// that cost a few frames each time (144 fps dropping to the 130s now and then).
const SPOTS = [[0.15, 0.2], [0.85, 0.2], [0.5, 0.5], [0.15, 0.8], [0.85, 0.8]];
const readback = { buf: null, sync: null, at: 0, px: new Uint8Array(SPOTS.length * 4) };

function checkGpu() {
  const R = app.renderer, now = performance.now();
  if (R.lost) { readback.buf = readback.sync = null; return; }
  if (app.restarting || R.native) return;
  if (!health.healthy && now - health.since > 20000 && !health.white) {
    health.healthy = true;
    if (N && N.healthy) N.healthy();
  }
  const gl = R.r.getContext(), rb = readback;
  if (rb.sync) {
    if (gl.getSyncParameter(rb.sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
      // Never came back: forget it and ask again next time.
      if (now - rb.at > 5000) { gl.deleteSync(rb.sync); rb.sync = null; }
      return;
    }
    gl.deleteSync(rb.sync);
    rb.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, rb.px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    judgePixels(rb.px);
    return;
  }
  if (now - health.t < (health.white ? 800 : 4000)) return;
  health.t = now;
  R.r.setRenderTarget(null);
  if (!rb.buf) {
    rb.buf = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, rb.px.length, gl.STREAM_READ);
  } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.buf);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  SPOTS.forEach(([x, y], i) => gl.readPixels((x * w) | 0, (y * h) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, i * 4));
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  rb.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  rb.at = now;
  gl.flush();
}

function judgePixels(px) {
  const cols = [];
  let white = 0, black = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    cols.push(((r << 16) | (g << 8) | b).toString(16));
    if (r > 235 && g > 235 && b > 235) white++;
    if (r < 4 && g < 4 && b < 4) black++;
  }
  health.rb = cols.join(' ');
  const n = px.length / 4;
  health.white = white === n || black === n ? health.white + 1 : 0;
  if (health.white >= 3) gfxTrouble(white === n ? 'render buffer white' : 'render buffer black');
}

// Behind the menus: the team on the dock, see titleshow.js.
let team = null;
function titleTeam(dt) {
  if (!app.pool || app.pool.warm > 0) return null;
  if (!team || team.level !== app.level) team = new TitleShow(app.level, app.world);
  team.update(dt, app.pool, (j) => (j === 0 ? myOutfit() : plainLook(COLORS[j])), (j) => (j === 0 ? myColor() : COLORS[j]), titleT);
  return team;
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
  r0.setLook(resolveLook(P.look, myRole()));
  r0.show();
  r0.flip = 0;
  // An emote picked in the shop plays, and plays again after a short rest.
  if (P.emote) {
    if (P.emote !== P.playing) { r0.playEmote(P.emote); P.playing = P.emote; P.wait = 0; }
    else if (!r0.emote && (P.wait += dt) > 0.7) { r0.playEmote(P.emote); P.wait = 0; }
  } else if (r0.emote) r0.stopEmote();
  r0.yaw = Math.atan2(ox, oz) + P.yaw;
  r0.update(dt, x, y, z, 0, 0, 0, P.aim ? 1 | F.AIM : 1, 0, gy, undefined, 9);
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
  const R = app.renderer, cam = R.camera, g = app.preview ? null : titleTeam(dt);
  if (app.preview) shopScene(dt);
  else if (g) g.camera(dt, cam);
  else {
    const a = titleT * 0.045 + 0.6, y = 16 + Math.sin(titleT * 0.08) * 9;
    cam.position.set(Math.cos(a) * 36, y, Math.sin(a) * 36);
    cam.lookAt(0, y + 6, 0);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }
  app.world.setTime(titleT);
  R.update(dt, cam.position, app.level.zones[0], 0, { x: 0, z: 0 });
  // Crisp shadows where the team is standing.
  if (g) R.shadowFocus(g.center.x, g.center.y, g.center.z);
  else R.shadowFocus(cam.position.x, cam.position.y - 2, cam.position.z);
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
