// When a newer release is out the game says so and brings it in, so nobody has to go and reinstall. The PC app has already
// downloaded it by itself and only needs a restart. The Android app downloads the release's APK, and Android shows its own
// Update screen for it (Android always asks, the first time at least). The web page only needs a reload.
import { APP_VERSION, DESK, IS_WEB } from './platform.js';

const N = window.Native;
const LATEST = 'https://api.github.com/repos/TheOCP/stickmanup/releases/latest';
const PAGE = 'https://github.com/TheOCP/stickmanup/releases/latest';
const WHY = {
  net: 'Could not download it. Check your connection and try again.',
  old: 'The new version is not up yet. Try again in a few minutes.',
  install: 'Android did not install it. You can get it from the download page.',
};
// Looked for every so often while the game is open, and on coming back to the title screen when the last look is a while ago.
const AGAIN_EVERY = 15 * 60 * 1000, ON_TITLE_AFTER = 4 * 60 * 1000;

let app = null, el = null, state = '', tag = '', pct = 0, why = '', shown = '', lastCheck = 0, looks = false;

const parts = (v) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
export function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// Never in the middle of a climb: it waits until they are out of it. The offer itself only on the title screen, so it turns
// up when they come back there from a climb; the download, once started, shows anywhere outside a climb.
const busy = () => !!(app.game || app.spec);
const atTitle = () => !busy() && app.screen === 'title';
const ONLY_TITLE = new Set(['offer', 'allow', 'restart']);
const showNow = () => (ONLY_TITLE.has(state) ? atTitle() : !busy());
const canInstall = () => !!(N && N.updateGet);

function card() {
  const v = tag ? `<span>Version ${tag}</span>` : '';
  switch (state) {
    case 'offer':
      return { text: `<b>A new update is out</b>${v}<small>Your coins, items and saves stay.</small>`, btns: IS_WEB ? [['reload', 'Reload', 1], ['later', 'Later']] : [['get', 'Update now', 1], ['later', 'Later']] };
    case 'allow':
      return { text: '<b>Allow updates</b><small>Android asks once. Allow StickManUp to install apps, then come back.</small>', btns: [['settings', 'Open settings', 1], ['later', 'Later']] };
    case 'down':
      return { text: `<b>Downloading the update</b><span>${pct}%</span><i class="ubar"><i style="width:${pct}%"></i></i>`, btns: [] };
    case 'confirm':
      return { text: '<b>Almost there</b><small>Tap Update on the next screen. Then open the game again.</small>', btns: [] };
    case 'failed':
      return { text: `<b>The update did not work</b><small>${why}</small>`, btns: [['get', 'Try again', 1], ['page', 'Download page'], ['later', 'Later']] };
    case 'restart':
      return { text: `<b>Update ready</b>${v}<small>Or it installs when you close the game.</small>`, btns: [['restart', 'Restart to update', 1], ['later', 'Later']] };
    default:
      return null;
  }
}

function draw() {
  const c = showNow() ? card() : null;
  if (!el) {
    if (!c) return;
    el = document.createElement('div');
    el.id = 'update';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-u]');
      if (!b) return;
      if (app.sound) app.sound.ui();
      act(b.dataset.u);
    });
  }
  if (c) {
    const html = `<div class="itext">${c.text}</div><div class="ibtns">${c.btns.map((b) => `<button class="btn sm${b[2] ? ' primary' : ''}" data-u="${b[0]}">${b[1]}</button>`).join('')}</div>`;
    if (html !== shown) { shown = html; el.innerHTML = html; }
  }
  el.classList.toggle('on', !!c);
}

function fetchIt() {
  if (!N.updateAllowed()) { state = 'allow'; draw(); return; }
  state = 'down';
  pct = 0;
  draw();
  N.updateGet();
}

function act(a) {
  switch (a) {
    case 'get': fetchIt(); break;
    case 'settings': N.updateAllow(); break;
    case 'reload': location.reload(); break;
    case 'page': if (N && N.openUrl) N.openUrl(PAGE); else window.open(PAGE, '_blank'); break;
    case 'restart': if (DESK && DESK.installUpdate) DESK.installUpdate(); break;
    // Until the game is opened the next time. On a PC it still installs when the game closes.
    case 'later': state = ''; draw(); break;
    default: break;
  }
}

async function check() {
  if (state || document.hidden) return;
  lastCheck = Date.now();
  try {
    const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const j = await r.json(), t = j && typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/i, '') : '';
    if (!/^\d+(\.\d+)*$/.test(t) || !newer(t, APP_VERSION) || state || tag === t) return;
    tag = t;
    state = 'offer';
    draw();
  } catch (e) {
    // No connection, or GitHub said no: the next time then.
  }
}

export function initUpdater(a) {
  app = a;
  // From the Android app (Updater.java).
  window.SMU_update = (what, v) => {
    if (what === 'progress') { state = 'down'; pct = Math.min(100, Math.max(0, v | 0)); }
    else if (what === 'ready') state = 'ready';
    else if (what === 'confirm') state = 'confirm';
    else if (what === 'cancel') state = 'offer';
    else if (what === 'done') state = '';
    else if (what === 'failed') { state = 'failed'; why = WHY[v] || WHY.install; }
    draw();
  };
  setInterval(() => {
    // Downloaded while they started climbing: Android's screen waits until they are out of it.
    if (state === 'ready' && !busy()) { state = 'confirm'; N.updateInstall(); }
    // Back on the title screen and the last look is a while ago: look again.
    if (!state && looks && atTitle() && Date.now() - lastCheck > ON_TITLE_AFTER) check();
    draw();
  }, 1500);
  if (DESK) {
    // The PC app downloads it by itself and says when it is there.
    if (DESK.onUpdate) DESK.onUpdate(() => { if (state !== 'restart') { state = 'restart'; draw(); } });
    return;
  }
  if (!canInstall() && !IS_WEB) return;
  looks = true;
  // Back from Android's settings, with the switch on: on with it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state === 'allow' && N.updateAllowed()) fetchIt();
  });
  setTimeout(check, 4000);
  setInterval(check, AGAIN_EVERY);
}
