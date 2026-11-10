// The game is written in English. In another language this swaps the text as it reaches the screen, so the game's own code is
// the same for everyone, and anything missing from the tables simply stays in English. On an English phone nothing here runs.
//
// The tables are in lang/: one row per text, as [English, Spanish, Portuguese, French, German, Russian, Turkish].
// {} stands for something that changes, like a number or a name, and {1} {2} put them in another order.
import MENUS from './lang/menus.js';
import PLAY from './lang/play.js';
import WORLD from './lang/world.js';
import ITEMS from './lang/items.js';
import TRAPS from './lang/traps.js';
import CLIMBS from './lang/climbs.js';

const COLUMNS = ['es', 'pt', 'fr', 'de', 'ru', 'tr'];
export const LANG_NAMES = [['auto', 'Auto'], ['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'], ['ru', 'Русский'], ['tr', 'Türkçe']];

// Everything the game writes starts out in English, so anything without two English letters in a row needs no look.
const LATIN = /[A-Za-z]{2}/;
// Not ours to change, or changing many times a second with nothing to translate.
const SKIP = '#tags, #hFps, #hTime, .terms, .notice, .svmsg span, .frname, .termout, .termsug, .termin span, .chname, .chtx, .pname, script, style, textarea';
const exact = new Map(), patterns = [], done = new Set(), memory = new Map();
let on = false;

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function look(s) {
  if (!LATIN.test(s) || done.has(s)) return s;
  let r = memory.get(s);
  if (r !== undefined) return r;
  r = work(s);
  if (memory.size > 3000) memory.clear();
  memory.set(s, r);
  // A finished translation is never translated again.
  memory.set(r, r);
  return r;
}

function work(s) {
  const e = exact.get(s);
  if (e !== undefined) return e;
  // "Storm Tower · Easy · 120 m": each part on its own.
  if (s.includes(' · ')) return s.split(' · ').map(look).join(' · ');
  // A name with a "!" on it.
  const end = s[s.length - 1];
  if (end === '!' || end === '.' || end === ':') {
    const base = exact.get(s.slice(0, -1));
    if (base !== undefined) return base + end;
  }
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    let i = 0;
    return p.to.replace(/\{(\d?)\}/g, (x, n) => look(m[n ? +n : ++i] || ''));
  }
  return s;
}

// Text in the game's English, as the person's language. Whatever isn't known comes back as it was.
export function tr(text) {
  if (!on || typeof text !== 'string' || !LATIN.test(text)) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text), body = tidy(m[2]), out = look(body);
  return out === body ? text : m[1] + out + m[3];
}

function swapText(node) {
  const v = node.nodeValue;
  if (!v || !LATIN.test(v)) return;
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const t = tr(v);
  if (t !== v) node.nodeValue = t;
}
function swapAttrs(el) {
  for (const a of ['placeholder', 'title']) {
    const v = el.getAttribute(a);
    if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
  }
}
function swapTree(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) swapText(n);
  swapAttrs(el);
  for (const x of el.querySelectorAll('[placeholder], [title]')) swapAttrs(x);
}

// `pick` is the choice in Settings: a language, or 'auto' for the phone's own.
export function startLang(pick) {
  const want = pick && pick !== 'auto' ? pick : String(navigator.language || 'en').slice(0, 2).toLowerCase();
  const col = COLUMNS.indexOf(want) + 1;
  document.documentElement.lang = col ? want : 'en';
  if (!col) return;
  for (const rows of [MENUS, PLAY, WORLD, ITEMS, TRAPS, CLIMBS]) {
    for (const r of rows) {
      const key = tidy(r[0]), to = r[col];
      if (!to) continue;
      done.add(to);
      if (key.includes('{}')) patterns.push({ re: new RegExp('^' + key.split('{}').map(escapeRe).join('(.+?)') + '$'), to, size: key.replace(/\{\}/g, '').length });
      else exact.set(key, to);
    }
  }
  // The most exact pattern first: "{} coins" must not catch what "First win on {}: {} coins" is for.
  patterns.sort((a, b) => b.size - a.size);
  on = true;
  swapTree(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') swapText(r.target);
      else for (const n of r.addedNodes) {
        if (n.nodeType === 3) swapText(n);
        else if (n.nodeType === 1) swapTree(n);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}
