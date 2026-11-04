// What the hidden places open in the shop. Finding a relic only opens the door: the thing itself still costs coins.
// The paths are made in level.js (buildSecrets); the server gets this table through dev/makecatalog.mjs and sells nothing
// before its relic is found.
//
//   map:0, map:1  the two hidden paths: a legendary suit each (LEGENDS, relic)
//   map:m0, m1    in the maze gardens: the legendary suits that are for sale
//   map:w         the hardest path: the map's legendary weapon. All six open the Void Cannon too.
//   map:e         the epic vault, on every difficulty: the epic things below.
import { LEGENDS } from './skins.js';

export const MAP_KEYS = ['storm', 'sunny', 'forest', 'volcano', 'city', 'waterfall'];
export const VAULT_WEAPON = { storm: 'w_stormb', sunny: 'w_solar', forest: 'w_dragon', volcano: 'w_hellfire', city: 'w_titan', waterfall: 'w_frost' };
export const VOID_WEAPON = 'w_void';
export const WEAPON_RELICS = MAP_KEYS.map((k) => k + ':w');
// The relics on the hidden paths (what Relic Hunter asks for), and the ones in the maze gardens (map:m0, map:m1).
export const SUIT_RELICS = LEGENDS.filter((l) => l.relic && !l.relic.includes(':m')).map((l) => l.relic);
export const MAZE_RELIC_IDS = LEGENDS.filter((l) => l.relic && l.relic.includes(':m')).map((l) => l.relic);

// Each map's epic vault, as [kind, id].
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
const EPIC_AT = new Map();
for (const [map, list] of Object.entries(EPIC_VAULT)) for (const [kind, id] of list) EPIC_AT.set(kind + ':' + id, map);
const WEAPON_AT = new Map(Object.entries(VAULT_WEAPON).map(([map, id]) => [id, map]));

// The relics an item needs before it can be bought, or null for none.
export function needOf(item) {
  if (!item) return null;
  if (item.relic) return [item.relic];
  if (item.kind === 'weapon') {
    if (item.id === VOID_WEAPON) return WEAPON_RELICS;
    if (WEAPON_AT.has(item.id)) return [WEAPON_AT.get(item.id) + ':w'];
  }
  const map = EPIC_AT.get(item.kind + ':' + item.id);
  return map ? [map + ':e'] : null;
}
// Where to look, for the shop: the map's key, and which path.
export function whereOf(item) {
  const need = needOf(item);
  if (!need) return null;
  if (item.id === VOID_WEAPON) return { kind: 'void' };
  const [map, k] = need[0].split(':');
  return { map, kind: k === 'e' ? 'epic' : k === 'w' ? 'weapon' : 'suit' };
}
// What a relic opens: the items, so a find can say so.
export function opensOf(relic, all) {
  return all.filter((it) => { const n = needOf(it); return n && n.includes(relic); });
}
