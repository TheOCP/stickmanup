// Climbs saved with others (game.js save). Every phone in the room keeps its own copy, of the last few climbs it was part of,
// so once a room is empty anyone who was in it can open a room again and carry on (main.js roomSave). A climb is known by the
// id it started with (climb), whoever runs it. Each copy has everyone's checkpoint and spot by their key (net.js who), not by
// their place in the room, which is different every time.
import { store } from './util.js';
import { layoutLV, mapDef, DIFFS } from './level.js';

const KEY = 'save.mps', KEEP = 4, WHO = /^[A-Za-z0-9]{8,24}$/;
export const CLIMB_ID = /^[a-z0-9]{6,24}$/;
const isClimb = (v) => typeof v === 'string' && CLIMB_ID.test(v);
export const newClimbId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let cache = null;
function all() {
  if (cache) return cache;
  let list = store.get(KEY, null);
  if (!Array.isArray(list)) {
    // From before there was a list: the one save, without an id.
    const old = store.get('save.mp', null);
    // It only knew where this phone was: that is this phone's part of it.
    const me = store.get('roomKey', ''), pos = old && Array.isArray(old.pos) ? old.pos : null;
    const team = typeof me === 'string' && WHO.test(me) && pos ? { [me]: [old.cp | 0, pos[0], pos[1], pos[2], 0] } : {};
    list = old && typeof old === 'object' ? [Object.assign(old, { climb: isClimb(old.climb) ? old.climb : newClimbId(), when: old.when || (old.run && old.run.when) || 1, team: old.team || team, left: old.left || {} })] : [];
    store.set(KEY, list);
    store.del('save.mp');
  }
  cache = list.filter((s) => s && typeof s === 'object' && isClimb(s.climb));
  return cache;
}
const keep = (list) => { cache = list.slice(0, KEEP); store.set(KEY, cache); };

// The ones this version can still pick up, newest first.
export const teamSaves = () => all().filter((s) => s.v === layoutLV(s.map)).sort((a, b) => (b.when || 0) - (a.when || 0));
export function teamSave(climb) {
  const s = all().find((x) => x.climb === climb);
  return s && s.v === layoutLV(s.map) ? s : null;
}
export const putTeamSave = (s) => keep([s, ...all().filter((x) => x.climb !== s.climb)]);
export const dropTeamSave = (climb) => keep(all().filter((x) => x.climb !== climb));
// The team reset someone's checkpoint (cloud.js checkpointReset): the climbs started before it go.
export const dropTeamSavesBefore = (at) => keep(all().filter((s) => s.run && s.run.when > at));

// What a phone tells the room about one of its saves (net.js 'sv'): the climb, not this phone's own part of it (its coins,
// stats and the anticheat's record stay here).
export function offerOf(s) {
  return { v: s.v, climb: s.climb, when: s.when, map: s.map, diff: s.diff, rules: s.rules, noCord: !!s.noCord, t: s.t, cp: s.cp, falls: s.falls, mz: s.mz, doors: s.doors, pos: s.pos, team: s.team, left: s.left };
}

const fin = (v, m) => Number.isFinite(v) && Math.abs(v) < m;
const int = (v, m) => Number.isInteger(v) && v >= 0 && v <= m;
// A save as one this phone can start from, whoever it came from: anything odd in it and it is no use at all.
export function cleanSave(x) {
  if (!x || typeof x !== 'object' || !isClimb(x.climb) || !int(x.map, 1e6) || !mapDef(x.map) || x.v !== layoutLV(x.map) || !DIFFS[x.diff]) return null;
  if (!fin(x.t, 1e7) || x.t < 0 || !int(x.cp, 999) || !int(x.falls | 0, 1e7) || !int(x.mz | 0, 1e6)) return null;
  if (!Array.isArray(x.pos) || x.pos.length !== 3 || !x.pos.every((v) => fin(v, 1e5))) return null;
  const rules = {};
  if (x.rules && typeof x.rules === 'object') {
    for (const k of ['cps', 'haz', 'rope']) if (Number.isInteger(x.rules[k]) && x.rules[k] >= 0 && x.rules[k] < DIFFS.length) rules[k] = x.rules[k];
    for (const k of ['ff', 'ng', 'tr']) if (x.rules[k] === 1) rules[k] = 1;
  }
  const team = {}, left = {};
  if (x.team && typeof x.team === 'object') {
    for (const w of Object.keys(x.team).slice(0, 12)) {
      const e = x.team[w];
      if (!WHO.test(w) || !Array.isArray(e) || !int(e[0], 999)) continue;
      team[w] = e.length >= 4 && [e[1], e[2], e[3]].every((v) => fin(v, 1e5)) ? [e[0], e[1], e[2], e[3], e[4] ? 1 : 0] : [e[0]];
    }
  }
  // Who left before it was saved: [checkpoint] or [checkpoint, x, y, z] where they last stood (a plain number from 4.10.46).
  if (x.left && typeof x.left === 'object') {
    for (const w of Object.keys(x.left).slice(0, 40)) {
      const v = x.left[w], e = Array.isArray(v) ? v : [v];
      if (!WHO.test(w) || !int(e[0], 999)) continue;
      left[w] = e.length >= 4 && [e[1], e[2], e[3]].every((n) => fin(n, 1e5)) ? [e[0], e[1], e[2], e[3]] : [e[0]];
    }
  }
  const doors = Array.isArray(x.doors) ? x.doors.filter((i) => int(i, 9999)).slice(0, 400) : [];
  return { v: x.v, climb: x.climb, when: fin(x.when, 1e14) ? x.when : 0, map: x.map, diff: x.diff, rules, noCord: !!x.noCord, t: x.t, cp: x.cp, falls: x.falls | 0, mz: x.mz | 0, doors, pos: x.pos.slice(), team, left };
}
