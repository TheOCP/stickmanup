// What this phone remembers about you: coins, what you own and wear, relics found and the record of your climbs.
import { store } from './util.js';
import { SUIT, FACE, HAT, LEGENDS, FREE_SUIT, ownerKey } from './skins.js';

const P = Object.assign({ coins: 0, earned: 0, own: [], eq: null, relics: [], ach: [], runs: {}, totals: {} }, store.get('profile', {}));
let timer = 0;
const saveNow = () => { clearTimeout(timer); timer = 0; store.set('profile', P); };
const saveSoon = () => { if (!timer) timer = setTimeout(saveNow, 900); };
export const flushProfile = saveNow;

export const RELIC_COUNT = LEGENDS.filter((l) => l.relic).length;

// First run on this version: what you had picked in Settings becomes your suit.
export function initProfile(oldColor) {
  if (!P.eq) { P.eq = { s: oldColor > 0 ? 'c' + oldColor : FREE_SUIT, f: 'smile', h: 'none' }; saveNow(); }
}

export const coins = () => P.coins;
export function addCoins(n) { P.coins += n; P.earned += n; saveSoon(); return P.coins; }

// Does this person have this thing? Free things yes; legendaries by finding or earning them; the two personal
// suits by name; everything else by buying.
export function owned(item, name) {
  if (item.owner) return item.owner === ownerKey(name);
  if (item.price === 0) return true;
  if (item.relic) return P.relics.includes(item.relic);
  if (item.ach) return P.ach.includes(item.ach);
  return P.own.includes(item.id);
}

export function buy(item) {
  if (item.price <= 0 || P.coins < item.price || P.own.includes(item.id)) return false;
  P.coins -= item.price;
  P.own.push(item.id);
  saveNow();
  return true;
}

const SLOT = { suit: 's', face: 'f', hat: 'h' };
export function equip(item) { P.eq[SLOT[item.kind]] = item.id; saveNow(); }
export const worn = (item) => P.eq[SLOT[item.kind]] === item.id;

// What to send out and show: your picks, with the personal suits only under the right name.
export function myLook(name) {
  const e = P.eq || { s: FREE_SUIT, f: 'smile', h: 'none' }, s = SUIT[e.s];
  const suit = s && (!s.owner || s.owner === ownerKey(name)) ? e.s : FREE_SUIT;
  return { s: suit, f: FACE[e.f] ? e.f : 'smile', h: HAT[e.h] ? e.h : 'none' };
}

// Called when the name changes. Calling yourself TheOCP or ShortGG puts your suit on the first time.
export function nameChanged(name) {
  const k = ownerKey(name), cur = SUIT[P.eq.s];
  if (cur && cur.owner && cur.owner !== k) { P.eq.s = FREE_SUIT; saveNow(); }
  if (!k) return null;
  const s = Object.values(SUIT).find((x) => x.owner === k);
  const flag = 'name:' + k;
  if (P.ach.includes(flag)) return null;
  P.ach.push(flag);
  P.eq.s = s.id;
  saveNow();
  return s;
}

export const hasRelic = (id) => P.relics.includes(id);
export const relicsFound = () => P.relics.length;
// Returns the legendary it unlocks, plus another if that was the last relic.
export function foundRelic(id) {
  if (P.relics.includes(id)) return [];
  P.relics.push(id);
  const out = [LEGENDS.find((l) => l.relic === id)];
  if (P.relics.length >= RELIC_COUNT) { const h = award('hunter'); if (h) out.push(h); }
  saveNow();
  return out.filter(Boolean);
}
export function award(ach) {
  if (P.ach.includes(ach)) return null;
  P.ach.push(ach);
  saveNow();
  return LEGENDS.find((l) => l.ach === ach) || null;
}

// ---------------------------------------------------------------- records
// One row per climb, per map. A climb updates its own row as it goes, so a saved climb you pick up again stays
// one row. Best first: higher, then a harder difficulty, then fewer falls, then faster.
const KEEP = 12;
const better = (a, b) => b.h - a.h || b.diff - a.diff || a.falls - b.falls || a.t - b.t;
export function recordRun(run) {
  const list = P.runs[run.map] || (P.runs[run.map] = []), i = list.findIndex((r) => r.id === run.id);
  if (i >= 0) list[i] = Object.assign({}, run); else list.push(Object.assign({}, run));
  list.sort(better);
  list.length = Math.min(list.length, KEEP);
  saveSoon();
}
export const runsOf = (map) => P.runs[map] || [];
export function addTotals(falls, climbs) { P.totals.falls = (P.totals.falls || 0) + falls; P.totals.climbs = (P.totals.climbs || 0) + climbs; saveSoon(); }
export const totals = () => ({ falls: P.totals.falls || 0, climbs: P.totals.climbs || 0, earned: P.earned, relics: P.relics.length });
