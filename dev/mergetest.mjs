// Putting the same person's progress from two phones together: nothing lost, no coins printed, nothing odd let through.
// Usage: node dev/mergetest.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
const { mergeRecords, setRecords, setWallet, snapshot, restore, coins, cleanRun, owned, buy } = await import('../assets/js/profile.js');
const { mergeData } = await import('../assets/js/cloud.js');
const { SUITS, HATS, FACES, itemKey } = await import('../assets/js/skins.js');

let bad = 0, good = 0;
const check = (name, ok, info = '') => { if (ok) good++; else { bad++; console.log(`FAIL ${name} ${info}`); } };
const P = (extra = {}) => ({ runs: {}, totals: {}, eq: null, ...extra });

let m = mergeRecords(P({ totals: { falls: 3, climbs: 9 } }), P({ totals: { falls: 8, climbs: 2 } }));
check('totals take the larger', m.totals.falls === 8 && m.totals.climbs === 9);
m = mergeRecords({ coins: 999, earned: 999, own: ['x'] }, P());
check('the money is not part of records', !('coins' in m) && !('earned' in m) && !('own' in m), JSON.stringify(m));

const R = (id, h, extra = {}) => ({ id, map: 0, diff: 1, custom: false, h, falls: 1, t: 60, coins: 5, won: false, when: 1, players: 1, ...extra });
m = mergeRecords(P({ runs: { 0: [R('a', 10), R('b', 30)] } }), P({ runs: { 0: [R('b', 50), R('c', 20)], 1: [R('d', 5)] } }));
check('climbs are joined, the better one of the same climb wins', m.runs[0].length === 3 && m.runs[0][0].id === 'b' && m.runs[0][0].h === 50 && m.runs[1].length === 1, JSON.stringify(m.runs));
const many = Array.from({ length: 30 }, (_, i) => R('r' + i, i));
m = mergeRecords(P({ runs: { 0: many } }), P());
check('only the best climbs are kept', m.runs[0].length === 12 && m.runs[0][0].h === 29);
const evil = '<img src=x onerror=1>';
m = mergeRecords(P({ runs: { 0: [R('e', evil, { falls: evil, t: evil, coins: evil }), R('f', 1, { diff: 999 }), { id: 'g' }, null, evil], x: 'nope' } }), P());
check('poisoned climbs lose their poison or go', m.runs[0].length === 1 && JSON.stringify(m.runs).indexOf('<') < 0, JSON.stringify(m.runs));
check('a bad difficulty means no climb at all', cleanRun({ diff: '1' }) === null && cleanRun({ diff: 99 }) === null);

setRecords(P({ eq: { s: '__proto__', f: 'constructor', h: evil } }));
const stored = JSON.parse(localStorage.getItem('smu.profile'));
check('a poisoned outfit falls back to plain', stored.eq.s === 'c0' && stored.eq.f === 'smile' && stored.eq.h === 'none', JSON.stringify(stored.eq));

// The server's word on the money
setWallet({ coins: 200, earned: 500, own: ['a', 1, null], relics: ['r'], ach: ['win0'] }, 7);
check('the wallet is what the server said, plus what is on its way', coins() === 207);
const w1 = JSON.parse(localStorage.getItem('smu.profile'));
check('strange things in it are dropped', w1.own.length === 1 && w1.own[0] === 'a' && w1.relics[0] === 'r' && w1.ach[0] === 'win0', JSON.stringify(w1));
setWallet({ coins: '999', earned: { x: 1 } });
check('a wallet that makes no sense counts as nothing', coins() === 0);

// Back to the guest you were
setWallet({ coins: 50, earned: 50, own: ['guestthing'] });
const guest = snapshot();
setWallet({ coins: 9000, earned: 9000, own: ['accountthing'], relics: ['x'], ach: ['win3'] });
restore(guest);
const g = JSON.parse(localStorage.getItem('smu.profile'));
check('signing out gives back the guest', coins() === 50 && g.own.join() === 'guestthing' && g.relics.length === 0 && g.ach.length === 0, JSON.stringify(g));
restore(null);
check('with nothing to go back to, a clean start', coins() === 0 && JSON.parse(localStorage.getItem('smu.profile')).own.length === 0);

// Things that share a name are not the same thing
const suit = SUITS.find((x) => x.id === 'santa'), hat = HATS.find((x) => x.id === 'santa'), face = FACES.find((x) => x.id === 'ninja');
check('a hat named like a suit has its own key', itemKey(hat) === 'hat:santa' && itemKey(suit) === 'santa' && itemKey(face) === 'face:ninja');
restore({ coins: 400, earned: 400 });
check('the cheap hat can be bought', buy(hat) && coins() === 400 - hat.price);
check('and that is all you get: not the suit', owned(hat, 'x') && !owned(suit, 'x'));

// What an older version kept on the phone is gone: the server says what you have now.
localStorage.setItem('smu.profile', JSON.stringify({ coins: 5000, earned: 5000, own: ['santa', 'ninja'], relics: ['storm:0'], ach: ['win0', 'name:x'], eq: { s: 'santa', f: 'ninja', h: 'pirate' } }));
const fresh = await import('../assets/js/profile.js?again');
check('coins and things kept on the phone are wiped', fresh.coins() === 0 && !fresh.owned(hat, 'x') && !fresh.owned(suit, 'x') && !fresh.owned(face, 'x'));

const S = (y) => ({ v: 1, map: 0, diff: 1, t: 10, falls: 0, pos: [1, y, 2] });
let d = mergeData({ profile: {}, best: { '0:1': 90, '0:2': 300, bad: evil }, solo: S(10) }, { profile: {}, best: { '0:1': 120, '1:1': 60, worse: -1 }, solo: S(40) });
check('the fastest time on each map is kept', d.best['0:1'] === 90 && d.best['0:2'] === 300 && d.best['1:1'] === 60 && !('bad' in d.best) && !('worse' in d.best), JSON.stringify(d.best));
check('the higher saved climb is kept', d.solo.pos[1] === 40);
d = mergeData({ profile: {}, solo: null }, { profile: {}, solo: S(5) });
check('a saved climb on one phone is kept', d.solo && d.solo.pos[1] === 5);
d = mergeData({ profile: {}, solo: { pos: [evil, 1, 1], t: 1, falls: 0, diff: 0 } }, { profile: {}, solo: { pos: [1, 1, 1], t: evil, falls: evil, diff: 0 } });
check('a poisoned saved climb is dropped', d.solo === null);

console.log(bad ? `${bad} FAILED, ${good} passed` : `all ${good} passed`);
process.exit(bad ? 1 : 0);
