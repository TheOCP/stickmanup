// The rules of the relic courses and the mazes, played in the same copy of the game the server reruns climbs with (no pictures).
// Run `node dev/makesim.mjs` first. On every course: landing on a stone further on than you have come sends you back, a relic you
// haven't walked to doesn't count, a course isn't a way up the route, a course walked from end to end gets its relic with nobody
// sent back on the way, and on the volcano the gate takes you round the outside. In a maze: creatures come after you and bite, a bite
// takes a heart, with none left you go back to the checkpoint with the hearts full.
// Usage: node dev/courserulestest.mjs [map key]
import '../server/lib/sim/env.js';
import { generateLevel, MAPS, secretOn, mazeCell } from '../server/lib/sim/level.js';
import { World } from '../server/lib/sim/physics.js';
import { Game, MAZE_HEARTS } from '../server/lib/sim/game.js';
import { PR } from '../server/lib/sim/player.js';

const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), set: () => true, apply: () => nothing });
const STEP = 1 / 60, none = { mx: 0, mz: 0, fx: 0, fz: -1, jump: false, jumpPressed: false, dash: false, grab: false, reel: false, shoot: false, shootPressed: false, shield: false };
class Session {
  constructor() { this.mode = 'solo'; this.slot = 0; this.isHost = true; this.name = ''; this.link = null; this.h = {}; this.players = new Map([[0, { slot: 0, name: '', color: null, look: null, samples: [] }]]); }
  on(k, f) { this.h[k] = f; return this; }
  emit(k, ...a) { return this.h[k] ? this.h[k](...a) : undefined; }
  now() { return 0; }
  toHost(e) { this.emit('hostEvent', e, 0); }
  toAll(e) { this.emit('event', e); }
  toSlot(s, e) { this.emit('event', e); }
  hostState() {}
  sendState() {}
}
function play(map) {
  const L = generateLevel(map), W = new World(L.cols), secrets = L.cols.filter((c) => c.kind === 'secret');
  const app = { level: L, world: W, renderer: nothing, ui: nothing, sound: nothing, fx: nothing, input: nothing, settings: {}, finish: () => {},
    pool: { robots: [nothing, nothing, nothing, nothing], ropes: [nothing, nothing, nothing], jumpers: [] },
    view: new Proxy({ setSecrets(sec) { for (const c of secrets) c.on = secretOn(c, sec); } }, { get: (t, k) => t[k] || nothing }) };
  const s = new Session(), g = new Game(app, s, { map, diff: 1, rules: null, t0: 0, base: 0, cp: 0, falls: 0, mz: 0, doors: [], stuns: [], pos: null, noCord: false, pcp: {}, loose: [], rest: null });
  g.simT = 0;
  Object.defineProperty(g, 'time', { get() { return this.simT; } });
  g.save = () => {}; g.noteRun = () => {};
  g.taken = [];
  g.takeRelic = (r) => g.taken.push(r.id);
  g.whys = [];
  const on = g.onEvent.bind(g);
  g.onEvent = (e, ...a) => { if (e.k === 'respawn') g.whys.push(e.why); return on(e, ...a); };
  return { L, g, s };
}
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(none); };
const put = (g, x, y, z) => { g.me.spawn(x, y + PR + 0.05, z); g.me.vx = g.me.vy = g.me.vz = 0; g.me.grounded = false; g.me.ground = null; };
// Something plain to stand on from this far along a course on: no moving stones, no pads (they throw you on before you stand on
// them, and the next stone sends you back), and not the top of a tall wall.
const plainFrom = (r, n) => { for (let i = n; i < r.way.length; i++) { const c = r.way[i].find((q) => !q.dyn && !q.blink && !q.crumble && !q.ghost && q.surf !== 'pad' && q.hy < 1 && q.hx > 0.4 && q.hz > 0.4); if (c) return c; } return null; };
// Until it sends you back, or you stood there for a good while. (A pad throws you up first.)
const until = (g, n = 300) => { for (let k = 0; k < n && !g.whys.length; k++) g.step(none); };
const clearOut = (g) => { g.locks = {}; g.splashed = false; g.bees = null; g.onCourse = -1; g.wayAt = -1; g.rest = null; g.gateOff = -1; g.whys.length = 0; };
const only = process.argv[2];
let failed = 0;
const report = (key, what, ok, more = '') => { if (!ok) failed++; if (!ok || more) console.log(`  ${ok ? 'ok ' : 'BAD'} ${key} ${what}${more ? ': ' + more : ''}`); };
for (const M of MAPS) {
  if (only && only !== M.key) continue;
  console.log(M.key);
  const { L, g } = play(M.id);
  if (!g.step) throw new Error('no step');
  for (const r of L.relics) {
    if (!r.way) continue;
    const top = r.start.y + r.start.hy, id = r.id;
    // Onto a stone from nowhere.
    clearOut(g);
    const far = plainFrom(r, r.entry + 6);
    put(g, far.x, far.y + far.hy, far.z); until(g);
    report(id, 'a stone from nowhere sends you back', g.whys.includes('courseskip') && Math.hypot(g.me.x - r.start.x, g.me.z - r.start.z) < 4, g.whys.includes('courseskip') ? '' : 'whys ' + g.whys + ' on ' + g.onCourse);
    // Onto the relic.
    clearOut(g); g.taken.length = 0;
    put(g, r.x, r.y - 0.6, r.z); steps(g, 6);
    report(id, "a relic you didn't walk to doesn't count", !g.taken.includes(id));
    // Off the course and onto the route above where it starts.
    clearOut(g);
    const highs = L.cols.filter((c) => c.kind === 'plat' && c.t === 0 && !c.dyn && !c.crumble && !c.blink && !c.trap && c.hx > 1 && c.hz > 1 && c.y > top + 30 && c.y < top + 120);
    let tried = 0, sent = 0;
    for (const high of highs.slice(0, 8)) {
      clearOut(g);
      g.onCourse = r.i; g.wayAt = r.entry + 2;
      put(g, high.x, high.y + high.hy, high.z);
      for (let k = 0; k < 40 && !g.whys.length && !g.me.grounded; k++) g.step(none);
      // Some route stones carry another course's gate, and that gate just takes you in.
      if ((!g.me.grounded && !g.whys.length) || g.whys.includes('coursein')) continue;
      tried++;
      if (g.whys.includes('courseskip')) sent++;
      else console.log(`    not sent back at y ${high.y.toFixed(1)} on ${g.me.ground && g.me.ground.kind}, whys ${g.whys}, on ${g.onCourse}, me y ${g.me.y.toFixed(1)}, splashed ${g.splashed}, grounded ${g.me.grounded}`);
    }
    if (tried) report(id, "a course isn't a way up the route", sent === tried, sent === tried ? '' : `sent back from ${sent} of ${tried}`);
    // Far ahead on the same course.
    clearOut(g);
    g.onCourse = r.i; g.wayAt = Math.max(0, r.entry);
    const ahead = plainFrom(r, r.entry + 12);
    if (ahead) {
      put(g, ahead.x, ahead.y + ahead.hy, ahead.z); until(g);
      report(id, 'far ahead on the same course sends you back', g.whys.includes('courseskip'), g.whys.includes('courseskip') ? '' : `wi ${ahead.wi} y ${ahead.y.toFixed(1)}, ${g.me.grounded ? 'on ' + (g.me.ground && g.me.ground.kind) + ' wi ' + (g.me.ground && g.me.ground.wi) : 'in the air'}, me y ${g.me.y.toFixed(1)}, on ${g.onCourse} way ${g.wayAt}`);
    }
    // End to end, standing on each thing in turn. Nobody gets sent back, and the relic counts.
    clearOut(g); g.taken.length = 0;
    if (r.portal) {
      put(g, r.gate.x, r.gate.y, r.gate.z); steps(g, 6);
      report(id, 'the gate is a portal', g.whys.includes('coursein') && g.onCourse === r.i && g.wayAt === 0, 'whys ' + g.whys);
    }
    let forced = 0;
    sent = 0;
    r.way.forEach((w, n) => {
      if (r.portal && n === 0) return;
      const c = w.find((q) => q.on !== false) || w[0];
      g.locks = {}; g.splashed = false; g.bees = null; g.stuns = [];
      put(g, c.x, c.y + c.hy, c.z);
      let k = 0;
      for (; k < 20 && !(g.me.grounded && g.me.ground && g.me.ground.ri === r.i); k++) g.step(none);
      if (g.whys.some((y) => y === 'courseskip')) { sent++; g.whys.length = 0; g.onCourse = r.i; g.wayAt = n; }
      if (!(g.me.grounded && g.me.ground && g.me.ground.ri === r.i)) { forced++; g.onCourse = r.i; g.wayAt = Math.max(g.wayAt, n); }
    });
    report(id, 'walked end to end nobody is sent back', sent === 0, sent ? sent + ' times' : '');
    steps(g, 3);
    // In the middle of the end stone the relic is just above you.
    report(id, 'walked end to end the relic counts', g.taken.includes(id), `${r.way.length} steps, ${forced} moving ones placed by hand`);
    // And the ring at its end takes you back to where it started.
    clearOut(g);
    g.onCourse = r.i; g.wayAt = r.way.length - 1;
    g.me.spawn(r.exit.x, r.exit.y + PR + 0.05, r.exit.z); g.me.vx = g.me.vy = g.me.vz = 0; steps(g, 8);
    steps(g, 40);
    report(id, 'the ring at the end goes back to the start, and it stays there', g.whys.includes('courseout') && !g.whys.includes('coursein') && g.onCourse !== r.i && Math.hypot(g.me.x - r.start.x, g.me.z - r.start.z) < 4, g.whys.includes('courseout') && !g.whys.includes('coursein') ? '' : 'whys ' + g.whys);
    if (r.portal) {
      // Off the stone and back: the gate works again. And the ring where you arrive takes you straight back.
      clearOut(g);
      g.gateOff = r.i;
      put(g, r.gate.x + 3, r.gate.y + 5, r.gate.z); steps(g, 2);
      clearOut(g);
      put(g, r.gate.x, r.gate.y, r.gate.z); steps(g, 6);
      report(id, 'stepped away and back, the gate works again', g.whys.includes('coursein') && g.onCourse === r.i, 'whys ' + g.whys);
      clearOut(g);
      g.onCourse = r.i; g.wayAt = 0;
      put(g, r.back.x, r.back.y, r.back.z); steps(g, 6);
      report(id, 'the ring where you arrive goes back', g.whys.includes('courseout'), g.whys.includes('courseout') ? '' : 'whys ' + g.whys);
      clearOut(g);
      const m = r.rests[0];
      let hits = 0;
      for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if (Math.hypot(m.x + dx - r.back.x, m.z + dz - r.back.z) < 0.75) hits++;
      report(id, 'arriving does not land you on that ring', hits === 0);
    }
  }
  // A maze: stand still and see what happens.
  const seen = [];
  for (const m of (L.mazes || []).slice(0, 3)) {
    clearOut(g);
    // Where one of its creatures walks: from far off in a winding maze they don't know you are there yet.
    const mon = L.monsters[m.mons[0]], c = mon ? [mon.ax, mon.az] : mazeCell(m, m.xi, m.xj), lost = [];
    put(g, c[0], m.y, c[1]);
    let last = MAZE_HEARTS, hunted = 0, back = 0;
    for (let k = 0; k < 60 * 60 && !back; k++) {
      g.me.vx = g.me.vz = 0;
      if (!g.mazeAround(g.me) && !g.whys.length) { put(g, c[0], m.y, c[1]); }
      g.step(none);
      hunted = Math.max(hunted, g.storm.hunt.size);
      if (g.hearts < last) lost.push(Math.round(k / 60));
      if (g.mazeAround(g.me) || g.whys.includes('hearts')) last = g.hearts;
      if (g.whys.includes('hearts')) back = k;
    }
    const fine = back && g.hearts === MAZE_HEARTS && lost.length === MAZE_HEARTS;
    seen.push(`${m.mons && m.mons.length ? m.mons.length : 0} creatures, at most ${hunted} hunting, bitten at ${lost.join(' ') || 'never'} s${back ? ', back to the checkpoint, hearts ' + g.hearts : ', never sent back'}`);
    if (!fine) failed++;
    report('maze ' + m.i, 'hearts run out', fine, seen[seen.length - 1]);
  }
}
if (failed) { console.log('FAILED: ' + failed); process.exitCode = 1; } else console.log('all as it should be');
