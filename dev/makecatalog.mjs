// Writes server/lib/catalog.json: what the server needs to know about the game to keep the coins honest. Prices, how many
// coins each map has, what each difficulty pays and which relics exist, all from the game's own tables.
// Usage: node dev/makecatalog.mjs            write it
//        node dev/makecatalog.mjs --check    fail if the file is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { generateLevel, MAPS, DIFFS } = await import('../assets/js/level.js');
const { SUITS, FACES, HATS, HAIRS, LEGENDS, OWNERS, itemKey } = await import('../assets/js/skins.js');
const { EMOTES } = await import('../assets/js/emotes.js');
const { WEAPONS } = await import('../assets/js/weapons.js');
const { needOf, SUIT_RELICS } = await import('../assets/js/relics.js');

const items = {}, names = {}, need = {}, relicSuits = {}, kinds = {};
// What each thing is, for the bot's /catalog to list by kind: suit, legendary, face, hat, hair, emote or weapon (and epic for
// the epic suits, faces and hats).
const KIND = new Map();
for (const [list, k] of [[SUITS, 'suit'], [LEGENDS, 'legend'], [FACES, 'face'], [HATS, 'hat'], [HAIRS, 'hair'], [EMOTES, 'emote'], [WEAPONS, 'weapon']]) for (const it of list) KIND.set(it, k);
for (const it of [...SUITS, ...LEGENDS, ...FACES, ...HATS, ...HAIRS, ...EMOTES, ...WEAPONS]) {
  // Free things everybody has already. All the rest can be given by the bot, except the team suits: those go with a flag.
  if (it.price === 0) continue;
  const key = itemKey(it);
  if (names[key] !== undefined) throw new Error(`${key} is in the game twice`);
  names[key] = it.name;
  kinds[key] = KIND.get(it) + (it.r === 2 && KIND.get(it) !== 'legend' ? ':epic' : '');
  // Only what the shop sells has a price. Some of it can only be bought once its relic is found (relics.js).
  if (it.price > 0 && !it.ach) items[key] = it.price;
  const n = needOf(it);
  if (n) need[key] = n;
  if (it.relic) relicSuits[it.relic] = key;
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const maps = MAPS.map((M) => {
  const L = generateLevel(M.id);
  L.coins.forEach((c, i) => { if (c.i !== i) throw new Error(`coin numbers on ${M.key} have holes`); });
  // open: the relics that are there on every difficulty (the epic vaults). The others only on real Hardcore and Insane.
  return { key: M.key, coins: L.coins.length, relics: L.relics.map((r) => r.id), open: L.relics.filter((r) => r.kind === 'epic').map((r) => r.id) };
});
const relicCount = SUIT_RELICS.length;
// Which flags may wear the team suits.
const team = Object.fromEntries(OWNERS.map((o) => [o.id, o.team]));
const catalog = { team, items: sorted(items), names: sorted(names), kinds: sorted(kinds), need: sorted(need), maps, diffs: DIFFS.map((d) => ({ coin: d.coin, summit: d.summit, first: d.first })), relicCount, suitRelics: SUIT_RELICS, relicSuits };

// Where each course starts, for the shop to tell (it doesn't build a whole map just to say that).
const spots = {};
for (const M of MAPS) for (const r of generateLevel(M.id).relics) if (r.gate) spots[r.id] = Math.round(r.gate.y - 2);
const spotFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/js/relicspots.js');
const spotText = `// Written by dev/makecatalog.mjs: how high each relic course starts.\nexport const RELIC_AT = ${JSON.stringify(spots)};\n`;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/lib/catalog.json');
const text = JSON.stringify(catalog) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text || !fs.existsSync(spotFile) || fs.readFileSync(spotFile, 'utf8') !== spotText) {
    console.error('server/lib/catalog.json or assets/js/relicspots.js is out of date. Run: node dev/makecatalog.mjs');
    process.exit(1);
  }
  console.log('catalog is up to date');
} else {
  fs.writeFileSync(file, text);
  fs.writeFileSync(spotFile, spotText);
  console.log(`catalog: ${Object.keys(items).length} things for sale, ${maps.length} maps, ${maps.reduce((n, m) => n + m.coins, 0)} coins`);
}
