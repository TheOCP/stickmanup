// What this phone remembers about you: coins, what you own and wear, relics found and the record of your climbs.
import { store } from './util.js';
import { SUIT, FACE, HAT, LEGENDS, FREE_SUIT, cleanLook, cleanRole, itemKey } from './skins.js';
import { WEAPON, FREE_WEAPON, WEAPONS } from './weapons.js';
import { needOf, SUIT_RELICS, MAZE_RELIC_IDS, WEAPON_RELICS, VOID_WEAPON, opensOf, MAP_KEYS } from './relics.js';
import { DIFFS } from './level.js';

const P = Object.assign({ coins: 0, earned: 0, own: [], eq: null, relics: [], ach: [], runs: {}, totals: {} }, store.get('profile', {}));
// Coins and what you own are the server's to say now, for guests too. What an older version kept on this phone is gone.
// Someone signed in keeps what they wear, if the server says it is theirs. See setWallet.
if ((P.ownV || 0) < 3) {
  P.coins = 0; P.earned = 0; P.own = []; P.relics = []; P.ach = [];
  if (P.eq && !store.get('account', null)) P.eq = { s: FREE_SUIT, f: 'smile', h: 'none' };
  P.ownV = 3;
}
let timer = 0;
const saveNow = () => { clearTimeout(timer); timer = 0; store.set('profile', P); };
const saveSoon = () => { if (!timer) timer = setTimeout(saveNow, 900); };
export const flushProfile = saveNow;

// Every relic there is: the hidden suits (paths and maze gardens), the epic vaults and the legendary weapons.
const ALL_SUITS = [...SUIT_RELICS, ...MAZE_RELIC_IDS];
export const RELIC_COUNT = ALL_SUITS.length + MAP_KEYS.length + WEAPON_RELICS.length;

// First run on this version: what you had picked in Settings becomes your suit.
export function initProfile(oldColor) {
  if (!P.eq) { P.eq = { s: oldColor > 0 ? 'c' + oldColor : FREE_SUIT, f: 'smile', h: 'none' }; saveNow(); }
}

// ---------------------------------------------------------------- signed in
// On an account the coins and what you own live on the server (server/lib/wallet.js), and this is only a copy to show.
// Records stay the phone's own to report: they are not worth anything, so two phones simply put theirs together.
const list = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string') : []);
const count = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
// One climb in the records, keeping only what a climb can be.
export function cleanRun(r) {
  if (!r || typeof r !== 'object' || !Number.isInteger(r.diff) || !DIFFS[r.diff]) return null;
  return { id: String(r.id).slice(0, 32), map: count(r.map), diff: r.diff, custom: !!r.custom, h: count(r.h), falls: count(r.falls), t: Number.isFinite(r.t) && r.t > 0 ? r.t : 0, coins: count(r.coins), won: !!r.won, when: count(r.when), players: count(r.players) || 1 };
}
export function mergeRecords(a, b) {
  const runs = {};
  for (const src of [a.runs, b.runs]) {
    for (const [map, rows] of Object.entries(src && typeof src === 'object' ? src : {})) {
      if (!Array.isArray(rows)) continue;
      const out = runs[map] || (runs[map] = []);
      for (const row of rows) {
        const r = cleanRun(row);
        if (!r) continue;
        const i = out.findIndex((x) => x.id === r.id);
        if (i < 0) out.push(r);
        else if (better(r, out[i]) < 0) out[i] = r;
      }
    }
  }
  for (const m of Object.keys(runs)) { runs[m].sort(better); runs[m].length = Math.min(runs[m].length, KEEP); }
  const totals = {};
  for (const k of ['falls', 'climbs']) totals[k] = Math.max(count(a.totals && a.totals[k]), count(b.totals && b.totals[k]));
  // What you wear: whichever was picked last, on any phone. When neither says when (picked before this was kept), the
  // second one: the account's copy, as cloud.js puts it.
  const ea = cleanLook(a.eq), eb = cleanLook(b.eq), ta = count(a.eqT), tb = count(b.eqT), useA = !!ea && (!eb || ta > tb);
  return { eq: useA ? ea : eb, eqT: useA ? ta : eb ? tb : 0, runs, totals };
}
export const recordsOf = (o) => ({ eq: o.eq || null, eqT: count(o.eqT), runs: o.runs || {}, totals: o.totals || {} });
export function setRecords(o) {
  if (!o || typeof o !== 'object') return;
  const m = mergeRecords(o, o);
  P.runs = m.runs;
  P.totals = m.totals;
  // What the account has is checked against what is yours by setWallet, which only goes by the server's word.
  if (m.eq) { P.eq = m.eq; P.eqT = m.eqT; }
  saveNow();
}
// Signing in: the look the account has comes on, not what was worn here before.
export function lookFromAccount() { P.eqT = 0; saveNow(); }
// When you last picked something to wear, so cloud.js can send it off soon.
export const lookStamp = () => count(P.eqT);
// The server's word on the money and on your flag. `extra` is what was earned here and hasn't reached it yet.
export function setWallet(w, extra = 0) {
  P.coins = count(w.coins) + extra;
  P.earned = count(w.earned) + extra;
  P.own = list(w.own);
  P.relics = list(w.relics);
  P.ach = list(w.ach);
  if (w.role !== undefined) P.role = cleanRole(w.role);
  // Anything worn that isn't yours (taken back by an admin, say) comes off.
  if (P.eq) {
    const mine = (it) => !it || owned(it);
    if (!mine(SUIT[P.eq.s])) P.eq.s = FREE_SUIT;
    if (!mine(FACE[P.eq.f])) P.eq.f = 'smile';
    if (!mine(HAT[P.eq.h])) P.eq.h = 'none';
  }
  saveNow();
}
// Everything, for going back to being the guest you were.
export const snapshot = () => JSON.parse(JSON.stringify(P));
export function restore(o) {
  const src = o && typeof o === 'object' ? o : {};
  P.coins = count(src.coins);
  P.earned = count(src.earned);
  P.own = list(src.own);
  P.relics = list(src.relics);
  P.ach = list(src.ach);
  const m = mergeRecords(src, src);
  P.runs = m.runs;
  P.totals = m.totals;
  P.eq = m.eq || { s: FREE_SUIT, f: 'smile', h: 'none' };
  P.eqT = m.eqT;
  saveNow();
}

export const coins = () => P.coins;
export function addCoins(n) { P.coins += n; P.earned += n; saveSoon(); return P.coins; }

// The flag the server last gave you. Changing it on the phone changes nothing for anyone else: the server writes those itself.
export const myRole = () => cleanRole(P.role);

// Do you have this thing? The team suits only with a flag from the server; whatever you bought or an admin gave you, yes;
// free things yes; the few legendaries that are earned by doing something, once earned. Finding a relic only opens
// something for buying (unlocked).
export function owned(item) {
  if (item.team) return item.team.includes(myRole());
  if (P.own.includes(itemKey(item))) return true;
  if (item.ach) return P.ach.includes(item.ach);
  if (item.relic) return false;
  return item.price === 0;
}
// Can it be bought yet? Epic and legendary things need their relic found first (relics.js).
export const unlocked = (item) => { const n = needOf(item); return !n || n.every((r) => P.relics.includes(r)); };

export function buy(item) {
  if (item.price <= 0 || P.coins < item.price || P.own.includes(itemKey(item))) return false;
  P.coins -= item.price;
  P.own.push(itemKey(item));
  saveNow();
  return true;
}

const SLOT = { suit: 's', face: 'f', hat: 'h', weapon: 'w' };
export function equip(item) { P.eq[SLOT[item.kind]] = item.id; P.eqT = Math.max(Date.now(), count(P.eqT) + 1); saveNow(); }
export const worn = (item) => (item.kind === 'weapon' ? myLook().w === item.id : P.eq[SLOT[item.kind]] === item.id);

// What to send out and show: your picks, with the team suits only with the right flag.
export function myLook() {
  const e = P.eq || { s: FREE_SUIT, f: 'smile', h: 'none', w: FREE_WEAPON }, s = SUIT[e.s], gun = WEAPON[e.w];
  const suit = s && (!s.team || owned(s)) ? e.s : FREE_SUIT;
  // A weapon an admin took away again goes back in the box.
  return { s: suit, f: FACE[e.f] ? e.f : 'smile', h: HAT[e.h] ? e.h : 'none', w: gun && owned(gun) ? e.w : FREE_WEAPON };
}


export const hasRelic = (id) => P.relics.includes(id);
export const relicsFound = () => P.relics.filter((r) => ALL_SUITS.includes(r)).length;
// How many of each kind of hidden place you found: [found, how many there are].
export const relicCounts = () => {
  const n = (sfx) => P.relics.filter((r) => r.endsWith(sfx)).length;
  return { suit: [relicsFound(), ALL_SUITS.length], epic: [n(':e'), MAP_KEYS.length], weapon: [n(':w'), WEAPON_RELICS.length] };
};
// A relic picked up: what to tell the climber, or null if it was found before.
export function foundRelic(id) {
  if (P.relics.includes(id)) return null;
  P.relics.push(id);
  let out = null;
  if (id.endsWith(':e')) {
    const n = opensOf(id, [...Object.values(SUIT), ...Object.values(FACE), ...Object.values(HAT), ...WEAPONS]).length;
    out = { title: 'Epic vault opened', name: `${n} epic things`, sub: 'They can be bought in the shop now' };
  } else if (id.endsWith(':w')) {
    const w = WEAPONS.find((x) => { const need = needOf(x); return x.id !== VOID_WEAPON && need && need[0] === id; });
    out = { title: 'Legendary weapon found', name: w ? w.name : '', sub: 'It can be bought in the shop now' };
    if (WEAPON_RELICS.every((r) => P.relics.includes(r))) out.sub = `All six found: the ${WEAPON[VOID_WEAPON].name} can be bought too`;
  } else {
    const l = LEGENDS.find((x) => x.relic === id);
    out = { title: 'Legendary found', name: l ? l.name : '', sub: 'It can be bought in the shop now' };
    if (SUIT_RELICS.every((r) => P.relics.includes(r))) { const h = award('hunter'); if (h) out.sub = `That was the last one. ${h.name} is yours.`; }
  }
  saveNow();
  return out;
}
export function award(ach) {
  if (P.ach.includes(ach)) return null;
  P.ach.push(ach);
  saveNow();
  return LEGENDS.find((l) => l.ach === ach) || null;
}

// The first win on each difficulty pays a big bonus, one time only.
export const wonOnce = (diff) => P.ach.includes('win' + diff);
export function firstWin(diff, amount) {
  if (wonOnce(diff)) return 0;
  P.ach.push('win' + diff);
  addCoins(amount);
  return amount;
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
