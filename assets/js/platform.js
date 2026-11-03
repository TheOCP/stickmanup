// Where the game is running: the Android app, the PC app or a web page. It is the same game in all three.
const N = window.Native;

// Goes up with each release, together with AndroidManifest.xml and MainActivity.java.
export const APP_VERSION = '4.10.0';

export const DESK = window.Desktop || null;
export const IS_WEB = !N && !DESK;

// A mouse is the main way to point: mouse look and key labels, instead of touch controls. ?touch and ?native keep the touch
// controls in a desktop browser, for trying them out.
const q = new URLSearchParams(location.search);
export const ON_PC = !N && !q.has('touch') && !q.has('native') && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export const canFullscreen = () => !!DESK || !!document.documentElement.requestFullscreen;
export function toggleFullscreen() {
  if (DESK) return DESK.fullscreen();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// Keeps a phone's screen on during a climb, in a browser too. The browser drops this whenever the page is hidden.
let wake = null, wantWake = false;
async function askWake() {
  if (!navigator.wakeLock || wake || !wantWake || document.hidden) return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch (e) { wake = null; }
}
export function keepAwake(on) {
  if (N) { if (N.keepAwake) N.keepAwake(on); return; }
  wantWake = on;
  if (on) askWake();
  else if (wake) wake.release().catch(() => {});
}
if (!N) document.addEventListener('visibilitychange', askWake);
