// Putting the same person's progress from two phones together: nothing lost, no coins printed, nothing odd let through.
// Usage: node dev/mergetest.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
const { mergeProfiles, setProfile, resetProfile, coins, cleanRun } = await import('../assets/js/profile.js');
const { mergeData, cleanAddress } = await import('../assets/js/cloud.js');

let bad = 0, good = 0;
const check = (name, ok, info = '') => { if (ok) good++; else { bad++; console.log(`FAIL ${name} ${info}`); } };
const P = (earned, c, extra = {}) => ({ earned, coins: c, own: [], relics: [], ach: [], runs: {}, totals: {}, eq: null, ...extra });

let m = mergeProfiles(P(1000, 700), P(1000, 700));
check('the same progress twice stays the same', m.coins === 700 && m.earned === 1000, JSON.stringify(m));
m = mergeProfiles(P(1500, 1200), P(1000, 500));
check('earning on one and spending on the other add up', m.earned === 1500 && m.coins === 1000, JSON.stringify(m));
m = mergeProfiles(P(100, 0), P(100, 0));
check('nothing left stays nothing', m.coins === 0);
m = mergeProfiles(P(100, 100), P(500, 0));
check('spending more than the other phone earned never goes below zero', m.coins === 0, JSON.stringify(m));
const a = P(900, 300, { own: ['c1'], ach: ['x'], totals: { falls: 3, climbs: 9 } }), b = P(1200, 700, { own: ['c2'], relics: ['r1'], totals: { falls: 8, climbs: 2 } });
const once = mergeProfiles(a, b), twice = mergeProfiles(mergeProfiles(once, a), b);
check('merging again and again prints nothing', once.coins === twice.coins && once.earned === twice.earned, `${once.coins} ${twice.coins}`);
check('both lists are kept', once.own.includes('c1') && once.own.includes('c2') && once.relics.includes('r1') && once.ach.includes('x'));
check('totals take the larger', once.totals.falls === 8 && once.totals.climbs === 9);
m = mergeProfiles(P('999', { x: 1 }, { own: [1, 'ok', null], relics: 'no', ach: {} }), P(-5, NaN));
check('strange numbers count as nothing', m.earned === 0 && m.coins === 0, JSON.stringify(m));
check('strange lists are filtered', m.own.length === 1 && m.own[0] === 'ok' && m.relics.length === 0 && m.ach.length === 0);

const R = (id, h, extra = {}) => ({ id, map: 0, diff: 1, custom: false, h, falls: 1, t: 60, coins: 5, won: false, when: 1, players: 1, ...extra });
m = mergeProfiles(P(0, 0, { runs: { 0: [R('a', 10), R('b', 30)] } }), P(0, 0, { runs: { 0: [R('b', 50), R('c', 20)], 1: [R('d', 5)] } }));
check('climbs are joined, the better one of the same climb wins', m.runs[0].length === 3 && m.runs[0][0].id === 'b' && m.runs[0][0].h === 50 && m.runs[1].length === 1, JSON.stringify(m.runs));
const many = Array.from({ length: 30 }, (_, i) => R('r' + i, i));
m = mergeProfiles(P(0, 0, { runs: { 0: many } }), P(0, 0));
check('only the best climbs are kept', m.runs[0].length === 12 && m.runs[0][0].h === 29);
const evil = '<img src=x onerror=1>';
m = mergeProfiles(P(0, 0, { runs: { 0: [R('e', evil, { falls: evil, t: evil, coins: evil }), R('f', 1, { diff: 999 }), { id: 'g' }, null, evil], x: 'nope' } }), P(0, 0));
check('poisoned climbs lose their poison or go', m.runs[0].length === 1 && JSON.stringify(m.runs).indexOf('<') < 0, JSON.stringify(m.runs));
check('a bad difficulty means no climb at all', cleanRun({ diff: '1' }) === null && cleanRun({ diff: 99 }) === null);

setProfile(P(500, 200, { eq: { s: '__proto__', f: 'constructor', h: evil } }));
check('setting progress works', coins() === 200);
const stored = JSON.parse(localStorage.getItem('smu.profile'));
check('a poisoned outfit falls back to plain', stored.eq.s === 'c0' && stored.eq.f === 'smile' && stored.eq.h === 'none', JSON.stringify(stored.eq));
resetProfile();
check('a reset is a clean guest', coins() === 0 && JSON.parse(localStorage.getItem('smu.profile')).own.length === 0);

const S = (y) => ({ v: 1, map: 0, diff: 1, t: 10, falls: 0, pos: [1, y, 2] });
let d = mergeData({ profile: {}, best: { '0:1': 90, '0:2': 300, bad: evil }, solo: S(10) }, { profile: {}, best: { '0:1': 120, '1:1': 60, worse: -1 }, solo: S(40) });
check('the fastest time on each map is kept', d.best['0:1'] === 90 && d.best['0:2'] === 300 && d.best['1:1'] === 60 && !('bad' in d.best) && !('worse' in d.best), JSON.stringify(d.best));
check('the higher saved climb is kept', d.solo.pos[1] === 40);
d = mergeData({ profile: {}, solo: null }, { profile: {}, solo: S(5) });
check('a saved climb on one phone is kept', d.solo && d.solo.pos[1] === 5);
d = mergeData({ profile: {}, solo: { pos: [evil, 1, 1], t: 1, falls: 0, diff: 0 } }, { profile: {}, solo: { pos: [1, 1, 1], t: evil, falls: evil, diff: 0 } });
check('a poisoned saved climb is dropped', d.solo === null);

for (const [t, want] of [['', ''], ['  ', ''], ['example.com:47810', 'https://example.com:47810'], ['https://example.com/', 'https://example.com'], ['https://a.b/c?d', 'https://a.b'], ['http://example.com', null], ['ftp://x', null], ['https://u:p@x.y', null], ['javascript:alert(1)', null], ['http://localhost:9', 'http://localhost:9'], ['http://127.0.0.1:9', 'http://127.0.0.1:9'], ['not a url', null]])
  check(`the address "${t}"`, cleanAddress(t) === want, String(cleanAddress(t)));

console.log(bad ? `${bad} FAILED, ${good} passed` : `all ${good} passed`);
process.exit(bad ? 1 : 0);
