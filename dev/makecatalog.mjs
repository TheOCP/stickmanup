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
const { SUITS, FACES, HATS, LEGENDS, OWNERS, itemKey } = await import('../assets/js/skins.js');
const { EMOTES } = await import('../assets/js/emotes.js');
const { WEAPONS } = await import('../assets/js/weapons.js');

const items = {}, names = {};
for (const it of [...SUITS, ...LEGENDS, ...FACES, ...HATS, ...EMOTES, ...WEAPONS]) {
  // Free things everybody has already. All the rest can be given by the bot, except the team suits: those go with a flag.
  if (it.price === 0) continue;
  const key = itemKey(it);
  if (names[key] !== undefined) throw new Error(`${key} is in the game twice`);
  names[key] = it.name;
  // Only what the shop sells has a price: legendaries can't be bought.
  if (it.price > 0 && !it.relic && !it.ach) items[key] = it.price;
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const maps = MAPS.map((M) => {
  const L = generateLevel(M.id);
  L.coins.forEach((c, i) => { if (c.i !== i) throw new Error(`coin numbers on ${M.key} have holes`); });
  return { key: M.key, coins: L.coins.length, relics: L.relics.map((r) => r.id) };
});
const relicCount = LEGENDS.filter((l) => l.relic).length;
// Which flags may wear the team suits.
const team = Object.fromEntries(OWNERS.map((o) => [o.id, o.team]));
const catalog = { team, items: sorted(items), names: sorted(names), maps, diffs: DIFFS.map((d) => ({ coin: d.coin, summit: d.summit, first: d.first })), relicCount };

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/lib/catalog.json');
const text = JSON.stringify(catalog) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
    console.error('server/lib/catalog.json is out of date. Run: node dev/makecatalog.mjs');
    process.exit(1);
  }
  console.log('catalog is up to date');
} else {
  fs.writeFileSync(file, text);
  console.log(`catalog: ${Object.keys(items).length} things for sale, ${maps.length} maps, ${maps.reduce((n, m) => n + m.coins, 0)} coins`);
}
