// Copies the game's physics to the server, so the server reruns climbs with exactly the code the phones play them with.
// It also writes a fingerprint of that code into the game and the server: a phone on a different version can't be compared,
// and gets told to update instead of being called a cheat.
// Usage: node dev/makesim.mjs            write the copies
//        node dev/makesim.mjs --check    fail if they are out of date
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets/js'), out = path.join(root, 'server/lib/sim');
const FILES = ['detmath.js', 'util.js', 'physics.js', 'level.js', 'obstacles.js', 'player.js', 'storm.js', 'chain.js', 'colors.js', 'emotes.js', 'weapons.js', 'skins.js', 'game.js'];

const want = new Map();
const hash = crypto.createHash('sha256');
for (const f of FILES) {
  const text = fs.readFileSync(path.join(src, f), 'utf8');
  hash.update(f + '\0' + text + '\0');
  // The server has no pictures to draw.
  want.set(f, '// Copied from assets/js by dev/makesim.mjs. Do not edit here.\n' + text.replace("from 'three'", "from './stub-three.js'"));
}
const build = hash.digest('hex').slice(0, 16);

want.set('package.json', '{ "type": "module", "private": true }\n');
want.set('build.json', JSON.stringify({ build }) + '\n');
want.set('stub-three.js', `// The one thing from three.js the climb itself touches is a vector for aiming, which the rerun never uses.
export class Vector3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
`);
want.set('env.js', `// What the game expects to find around it. Loaded before anything else.
import './detmath.js';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
`);
want.set('profile.js', `// In a rerun nothing is kept on any phone. The server pays what the rerun finds (see verify-worker.mjs).
export const sink = { relics: new Set() };
export const addCoins = () => {};
export const firstWin = () => 0;
export const foundRelic = (id) => { sink.relics.add(id); return null; };
export const hasRelic = (id) => sink.relics.has(id);
export const award = () => null;
export const recordRun = () => {};
export const addTotals = () => {};
export const flushProfile = () => {};
// The weapon a shot came from is in the recording, so the one carried here doesn't matter.
export const myLook = () => ({ s: 'c0', f: 'smile', h: 'none', w: 'w_blaster' });
`);
want.set('cloud.js', `// What the climb tells the account. In a rerun that goes to the code doing the rerun.
export const sink = { coin: () => {}, relic: () => {}, win: () => {} };
export const runStart = () => {};
export const recorder = () => null;
export const runId = () => null;
export const counting = () => true;
export const climbSaved = () => {};
export const runCoin = (i) => sink.coin(i);
export const runRelic = (id) => sink.relic(id);
export const runWin = (falls) => sink.win(falls);
`);

const buildFile = path.join(src, 'simbuild.js'), buildText = `// Written by dev/makesim.mjs: a fingerprint of the physics code, the same one the server has.\nexport const SIM_BUILD = '${build}';\n`;

if (process.argv.includes('--check')) {
  let bad = fs.existsSync(buildFile) && fs.readFileSync(buildFile, 'utf8') === buildText ? '' : 'assets/js/simbuild.js';
  for (const [f, text] of want) {
    const p = path.join(out, f);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) bad = 'server/lib/sim/' + f;
  }
  if (bad) {
    console.error(`${bad} is out of date. Run: node dev/makesim.mjs`);
    process.exit(1);
  }
  console.log('server physics are up to date');
} else {
  fs.mkdirSync(out, { recursive: true });
  for (const [f, text] of want) fs.writeFileSync(path.join(out, f), text);
  fs.writeFileSync(buildFile, buildText);
  console.log(`server physics written, build ${build}`);
}
