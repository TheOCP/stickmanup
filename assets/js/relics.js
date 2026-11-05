// What the hidden places open in the shop. Finding a relic only opens the door: the thing itself still costs coins.
// The paths are made in level.js (buildSecrets); the server gets this table through dev/makecatalog.mjs and sells nothing
// before its relic is found.
//
//   map:0, map:1  the two hidden paths: a legendary suit each (LEGENDS, relic)
//   map:m0, m1    in the maze gardens: the legendary suits that are for sale
//   map:w         the hardest path: the map's legendary weapon. All six open the Void Cannon too.
//   map:h0, h1... the hidden spots (level.js hideSpots): one thing each, every epic thing below and every epic and legendary
//                 graffiti. Each spot is on one difficulty only.
//   map:e         the old epic vault, which opened all of a map's epic things at once. Whoever found it keeps them (LEGACY).
import { LEGENDS, SUIT, FACE, HAT } from './skins.js';
import { WEAPON } from './weapons.js';
import { SPRAYS, SPRAY } from './sprays.js';
import { HIDE, hideSpots } from './level.js';

export const MAP_KEYS = ['storm', 'sunny', 'forest', 'volcano', 'city', 'waterfall'];
export const VAULT_WEAPON = { storm: 'w_stormb', sunny: 'w_solar', forest: 'w_dragon', volcano: 'w_hellfire', city: 'w_titan', waterfall: 'w_frost' };
export const VOID_WEAPON = 'w_void';
export const WEAPON_RELICS = MAP_KEYS.map((k) => k + ':w');
// The relics on the hidden paths (what Relic Hunter asks for), and the ones in the maze gardens (map:m0, map:m1).
export const SUIT_RELICS = LEGENDS.filter((l) => l.relic && !l.relic.includes(':m')).map((l) => l.relic);
export const MAZE_RELIC_IDS = LEGENDS.filter((l) => l.relic && l.relic.includes(':m')).map((l) => l.relic);

// Each map's epic things, as [kind, id]. Only add to the end of a list: the hidden spots go by place in it.
export const EPIC_VAULT = {
  storm: [['suit', 'robot'], ['suit', 'astro'], ['suit', 'chrome'], ['suit', 'grid'], ['suit', 'galaxy'], ['face', 'visor'], ['face', 'alien'], ['hat', 'antenna'], ['hat', 'astro'], ['weapon', 'w_railspike'],
    ['suit', 'circuit'], ['suit', 'mech'], ['suit', 'thunder'], ['weapon', 'w_tesla'], ['weapon', 'w_lancer']],
  sunny: [['suit', 'pirate'], ['suit', 'cowboy'], ['suit', 'clown'], ['suit', 'hero'], ['suit', 'gold'], ['face', 'patch'], ['face', 'clown'], ['hat', 'crown'], ['hat', 'flowers'], ['weapon', 'w_nova'],
    ['suit', 'pharaoh'], ['suit', 'shark'], ['suit', 'pilot'], ['suit', 'cactus'], ['weapon', 'w_harpoon']],
  forest: [['suit', 'ninja'], ['suit', 'tiger'], ['suit', 'zebra'], ['suit', 'camo'], ['suit', 'toxic'], ['suit', 'pumpkin'], ['face', 'ninja'], ['face', 'monster'], ['face', 'pumpkin'], ['hat', 'shroom'], ['weapon', 'w_ghost'],
    ['suit', 'panda'], ['suit', 'fox'], ['suit', 'dino'], ['weapon', 'w_venom']],
  volcano: [['suit', 'lava'], ['suit', 'fire'], ['suit', 'vampire'], ['suit', 'skeleton'], ['face', 'skull'], ['face', 'vampire'], ['face', 'hollow'], ['hat', 'devil'], ['weapon', 'w_dragonb'], ['weapon', 'w_thumper'],
    ['suit', 'steampunk'], ['suit', 'viking'], ['suit', 'amethyst'], ['weapon', 'w_quake']],
  city: [['suit', 'samurai'], ['suit', 'knight'], ['suit', 'doctor'], ['suit', 'tux'], ['suit', 'zombie'], ['suit', 'mummy'], ['face', 'stitched'], ['hat', 'samurai'], ['hat', 'knight'], ['weapon', 'w_ironbelt'], ['weapon', 'w_ripper'],
    ['suit', 'synth'], ['suit', 'disco'], ['suit', 'chef'], ['suit', 'jester'], ['weapon', 'w_plasma'], ['weapon', 'w_starfall']],
  waterfall: [['suit', 'frost'], ['suit', 'snowcamo'], ['suit', 'rainbow'], ['suit', 'santa'], ['suit', 'wizard'], ['hat', 'wizard'], ['hat', 'halo'], ['weapon', 'w_phantom'],
    ['suit', 'diver'], ['suit', 'koi'], ['suit', 'sakura'], ['weapon', 'w_cryo']],
};
const WEAPON_AT = new Map(Object.entries(VAULT_WEAPON).map(([map, id]) => [id, map]));

// What each hidden spot holds, in the order of level.js hideSpots: the map's epic things, its epic graffiti, its legendary ones.
export const SPOT_ITEMS = {};
const SPOT_OF = new Map(), SPOT_THING = new Map();
// The old vault still counts for the things it opened.
export const LEGACY = {};
for (const k of MAP_KEYS) {
  const mine = (r) => SPRAYS.filter((s) => s.map === k && s.r === r).map((s) => ['spray', s.id]);
  const list = SPOT_ITEMS[k] = [...EPIC_VAULT[k], ...mine(2), ...mine(3)];
  list.forEach(([kind, id], j) => {
    SPOT_OF.set(kind + ':' + id, k + ':h' + j);
    SPOT_THING.set(k + ':h' + j, [kind, id]);
    if (j < EPIC_VAULT[k].length) LEGACY[k + ':h' + j] = k + ':e';
  });
}
// Every hidden spot there is.
export const SPOT_RELICS = MAP_KEYS.flatMap((k) => hideSpots(k).map((q) => q.id));
// Does this list of relics have this one (or the old vault that stood for it)?
export const relicIn = (list, id) => list.includes(id) || (LEGACY[id] !== undefined && list.includes(LEGACY[id]));
// The thing a hidden spot opens.
export function spotThing(id) {
  const t = SPOT_THING.get(id);
  if (!t) return null;
  const [kind, x] = t;
  return (kind === 'suit' ? SUIT : kind === 'face' ? FACE : kind === 'hat' ? HAT : kind === 'weapon' ? WEAPON : SPRAY)[x] || null;
}
// For dev/makecatalog.mjs: is every spot in level.js HIDE given exactly one thing, legendary ones the legendary graffiti?
export function checkSpots() {
  for (const k of MAP_KEYS) {
    const [E, G] = HIDE[k], list = SPOT_ITEMS[k], legend = list.filter(([kind, id]) => kind === 'spray' && SPRAY[id].r === 3).length;
    if (list.length !== E + G || legend !== G) throw new Error(`${k}: ${list.length} things (${legend} legendary) for ${E} epic and ${G} legendary hidden spots. Change HIDE in level.js.`);
    for (const [kind, id] of list) if (!spotThing(SPOT_OF.get(kind + ':' + id))) throw new Error(`${kind} ${id} on ${k} does not exist`);
  }
}

// The relics an item needs before it can be bought, or null for none.
export function needOf(item) {
  if (!item) return null;
  if (item.relic) return [item.relic];
  if (item.kind === 'weapon') {
    if (item.id === VOID_WEAPON) return WEAPON_RELICS;
    if (WEAPON_AT.has(item.id)) return [WEAPON_AT.get(item.id) + ':w'];
  }
  const spot = SPOT_OF.get(item.kind + ':' + item.id);
  return spot ? [spot] : null;
}
// Where to look, for the shop: the map's key, and which path.
export function whereOf(item) {
  const need = needOf(item);
  if (!need) return null;
  if (item.id === VOID_WEAPON) return { kind: 'void' };
  const [map, k] = need[0].split(':');
  if (k[0] === 'h') {
    const q = hideSpots(map)[+k.slice(1)];
    if (q) return { map, kind: q.legend ? 'legend' : 'epic', spot: true, maze: q.maze, dv: q.dv };
  }
  return { map, kind: k === 'w' ? 'weapon' : 'suit' };
}
// What a relic opens: the items, so a find can say so.
export function opensOf(relic, all) {
  return all.filter((it) => { const n = needOf(it); return n && n.includes(relic); });
}
