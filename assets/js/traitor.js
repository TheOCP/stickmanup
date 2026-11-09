// Traitor mode (a rule the host switches on in the lobby, rules.tr): when the climb starts, the host's game picks one climber
// in secret to be the traitor and tells only them. The traitor sabotages the climb (snaps the cord, jams the checkpoints,
// puts the lights out, fills the compass with static); every sabotage leaves a clue. Anyone can call a vote: if more than
// half of the team picks the traitor, they are caught and the team wins. Two innocent climbers voted out, or the top reached
// with the traitor still hidden, and the traitor wins.
//
// The host decides everything (hostEv, tick); the others only hear about it (ev). Only for the team's game: nothing here
// changes how anyone climbs, except the cord snapping, which goes through the game's own 'loose' (and so into the rerun).
import { zoneAt } from './level.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The sabotages: how long each lasts and how long until it can be used again (seconds).
export const SABOTAGES = {
  snap: { name: 'Snap the cord', sub: 'Everyone climbs alone until they reach the others again', t: 8, cd: 75 },
  jam: { name: 'Jam the checkpoints', sub: 'Nobody gets a checkpoint for 30 seconds', t: 30, cd: 60 },
  dark: { name: 'Lights out', sub: 'The others see almost nothing for 7 seconds', t: 7, cd: 45 },
  static: { name: 'Compass static', sub: 'No way up arrow, height or names for the others for 25 seconds', t: 25, cd: 45 },
};
const FIRST = 40, BETWEEN = 15, VOTE_T = 25, VOTE_CD = 60, WRONG = 2, MIN_PLAYERS = 3;

export class Traitor {
  constructor(app) {
    this.app = app;
    this.reset();
  }
  reset() {
    this.on = false; // traitor mode in this climb
    this.me = false; // I am the traitor
    this.over = false;
    this.clues = [];
    this.vote = null; // { end (performance.now), list, mine }
    this.cool = {};
    this.wrong = 0;
    this.host = null;
    this.g = null;
    this.result = null;
    clearTimeout(this.darkT);
    clearTimeout(this.staticT);
    this.effects(false);
  }

  // A climb starts (main.js beginGame).
  begin(g) {
    this.reset();
    this.g = g;
    this.on = !!(g.rules && g.rules.tr) && !g.solo;
    if (this.on && g.s.isHost) this.host = { slot: -1, at: g.time + 4, picked: false, told: new Set(), wrong: 0, caught: false, win: '', vote: null, voteCd: 0, cd: {}, last: -1e9, start: g.time, jam: 0 };
    this.draw();
  }
  end() { this.reset(); this.draw(); }
  // The host left and this phone runs the climb now (game.js takeOver). Who the traitor was left with the old host, so a new one
  // is picked once the others are back with this phone. Already decided, it stays decided.
  takeOver(g) {
    if (!this.on || g !== this.g || this.host) return;
    const T = g.time;
    this.host = { slot: -1, at: T + 8, picked: this.over, again: !this.over, told: new Set(), wrong: this.wrong | 0, caught: false, win: this.over ? 'over' : '', vote: null, voteCd: 0, cd: {}, last: -1e9, start: T, jam: 0 };
  }
  name(g, s) { const p = g.s.players.get(s); return p ? p.name : 'Someone'; }
  // Is the checkpoint jammed right now (the host's game.js asks before giving one).
  jammed(T) { return !!this.host && !this.host.win && T < this.host.jam; }
  // Who it was, for the end of the climb (game.js sends it with 'win').
  winInfo(g) {
    const h = this.host;
    if (!h || !h.picked || h.slot < 0) return undefined;
    return { s: h.slot, name: this.name(g, h.slot), win: h.win || 'traitor', caught: h.caught };
  }

  posOf(g, s) {
    if (s === g.slot) return g.me;
    const o = {};
    return g.latest(s, o) ? o : null;
  }
  live(g) { return [...g.s.players.keys()].filter((s) => !g.hidden.has(s)).sort((a, b) => a - b); }

  // ---------------------------------------------------------------- the host
  tick(g) {
    const h = this.host;
    if (!h || g !== this.g) return;
    const T = g.time;
    if (!h.picked) {
      if (T < h.at) return;
      const list = this.live(g);
      h.picked = true;
      if (list.length < MIN_PLAYERS) { h.win = 'none'; g.s.toAll({ k: 'tr', a: 'few' }); return; }
      const r = crypto.getRandomValues(new Uint32Array(1))[0];
      h.slot = list[r % list.length];
      for (const s of g.s.players.keys()) h.told.add(s);
      if (h.again) g.s.toAll({ k: 'tr', a: 'again' });
      g.s.toAll({ k: 'tr', a: 'on', n: list.length });
      g.s.toSlot(h.slot, { k: 'tr', a: 'you' });
      return;
    }
    if (h.win) return;
    // Those who came in later hear what is going on (they are never the traitor).
    // A few seconds after they show up, so their climb is running by then.
    h.seen = h.seen || new Map();
    for (const s of g.s.players.keys()) {
      if (h.told.has(s)) continue;
      if (!h.seen.has(s)) h.seen.set(s, T);
      else if (T - h.seen.get(s) > 5) { h.told.add(s); g.s.toSlot(s, { k: 'tr', a: 'on', late: true, clues: this.clues.slice(-12), wrong: h.wrong }); }
    }
    if (!g.s.players.has(h.slot)) { h.win = 'left'; g.s.toAll({ k: 'tr', a: 'left', name: this.lastName || 'The traitor' }); return; }
    this.lastName = this.name(g, h.slot);
    const v = h.vote;
    if (v && (T >= v.end || v.list.every((s) => v.ballots.has(s) || !g.s.players.has(s)))) this.count(g);
  }

  count(g) {
    const h = this.host, v = h.vote, n = v.list.filter((s) => g.s.players.has(s)).length, votes = new Map();
    h.vote = null;
    h.voteCd = g.time + VOTE_CD;
    for (const c of v.ballots.values()) if (c >= 0) votes.set(c, (votes.get(c) || 0) + 1);
    let top = -1, most = 0;
    for (const [s, k] of votes) if (k > most) { most = k; top = s; }
    if (top < 0 || most * 2 <= n) return g.s.toAll({ k: 'tr', a: 'result', none: true, most, n });
    const ok = top === h.slot;
    if (ok) { h.caught = true; h.win = 'team'; }
    else if (++h.wrong >= WRONG) h.win = 'traitor';
    g.s.toAll({ k: 'tr', a: 'result', s: top, name: this.name(g, top), ok, wrong: h.wrong, most, n, ...(h.win === 'traitor' ? { t: h.slot, tname: this.name(g, h.slot) } : {}) });
  }

  hostEv(g, e, from) {
    const h = this.host;
    if (!h || !h.picked || h.win || g !== this.g) return;
    const T = g.time;
    // The host's own requests come in with the host's slot.
    const who = from === undefined ? g.slot : from;
    if (e.a === 'sab') {
      const S = SABOTAGES[e.w];
      if (who !== h.slot || !S) return;
      const wait = Math.max(FIRST - (T - h.start), (h.cd[e.w] || 0) - T, BETWEEN - (T - h.last));
      if (wait > 0) return g.s.toSlot(who, { k: 'tr', a: 'wait', w: e.w, s: Math.ceil(wait) });
      if (e.w === 'snap' && (g.noCord || this.live(g).length < 2)) return g.s.toSlot(who, { k: 'tr', a: 'wait', w: e.w, why: 'nocord' });
      h.cd[e.w] = T + S.cd;
      h.last = T;
      const me = this.posOf(g, h.slot), clue = this.clue(g, e.w, me);
      if (e.w === 'snap') {
        g.snapT = T + S.t;
        g.setLoose([...g.loose, ...this.live(g)]);
      } else if (e.w === 'jam') h.jam = T + S.t;
      g.s.toAll({ k: 'tr', a: 'sab', w: e.w, t: S.t, clue });
      return;
    }
    if (e.a === 'call') {
      if (h.vote) return;
      if (T < h.voteCd) return g.s.toSlot(who, { k: 'tr', a: 'no', s: Math.ceil(h.voteCd - T) });
      const list = this.live(g);
      h.vote = { end: T + VOTE_T, list, ballots: new Map(), by: who };
      g.s.toAll({ k: 'tr', a: 'vote', by: this.name(g, who), list: list.map((s) => [s, this.name(g, s)]), t: VOTE_T });
      return;
    }
    if (e.a === 'ballot') {
      const v = h.vote;
      if (!v || !v.list.includes(who) || v.ballots.has(who)) return;
      const c = Number.isInteger(e.s) && v.list.includes(e.s) ? e.s : -1;
      v.ballots.set(who, c);
      g.s.toAll({ k: 'tr', a: 'voted', n: v.ballots.size, of: v.list.length });
    }
  }

  // What a sabotage gives away: never the traitor's name, but enough to narrow it down.
  clue(g, w, me) {
    const list = this.live(g), h = this.host, t = h.slot;
    if (w === 'snap') {
      // Where the cord snapped: next to the traitor, on one side or the other.
      const i = list.indexOf(t), sides = [list[i - 1], list[i + 1]].filter((x) => x !== undefined), o = sides[(Math.random() * sides.length) | 0];
      const pair = Math.random() < 0.5 ? [t, o] : [o, t];
      return `The cord snapped between ${this.name(g, pair[0])} and ${this.name(g, pair[1])}.`;
    }
    if (!me) return 'Nobody saw where it came from.';
    if (w === 'jam') return `The checkpoints were jammed from ${g.L.zones[zoneAt(g.L, me.y)].name}.`;
    if (w === 'dark') return `One light stayed on, somewhere near ${Math.max(0, Math.round((me.y - 2) / 20) * 20)} m.`;
    // The static: loudest next to whoever is closest to the traitor.
    let best = -1, bd = 1e9;
    for (const s of list) {
      if (s === t) continue;
      const p = this.posOf(g, s);
      const d = p ? Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) : 1e9;
      if (d < bd) { bd = d; best = s; }
    }
    return best >= 0 ? `The static was loudest near ${this.name(g, best)}.` : 'The static came from everywhere at once.';
  }

  // ---------------------------------------------------------------- everyone
  ev(g, e) {
    if (g !== this.g || !e || typeof e.a !== 'string') return;
    const ui = this.app.ui, snd = this.app.sound;
    switch (e.a) {
      case 'on':
        this.on = true;
        if (Array.isArray(e.clues)) this.clues = e.clues.filter((c) => typeof c === 'string').slice(-12).map((c) => c.slice(0, 160));
        if (Number.isInteger(e.wrong)) this.wrong = e.wrong;
        this.say(e.late ? 'This team has a traitor' : 'There is a traitor among you', 'Watch what happens, find the clues and vote them out before the top.', 'bad');
        break;
      // A new host, so a new traitor: whoever it was is just a climber again.
      case 'again':
        this.me = false;
        this.vote = null;
        this.cool = {};
        this.coolAll = 0;
        ui.toast('New host, new traitor', 'bad');
        this.draw();
        break;
      case 'you':
        this.me = true;
        this.say('You are the traitor', 'Sabotage the climb with the mask button and don\'t get caught. Your first trick works in 40 seconds.', 'bad');
        break;
      case 'few':
        this.on = false;
        ui.toast('Traitor mode needs at least 3 climbers, so it is off for this climb.', '');
        break;
      case 'wait':
        if (e.why === 'nocord') ui.toast('There is no cord to snap.', 'bad');
        else ui.toast(`${SABOTAGES[e.w] ? SABOTAGES[e.w].name : 'That'}: ready in ${e.s | 0} s`, '');
        break;
      case 'sab': {
        const S = SABOTAGES[e.w];
        if (!S) break;
        const t = Math.min(60, +e.t || S.t);
        if (typeof e.clue === 'string') this.clues.push(e.clue.slice(0, 160));
        if (this.me) { this.cool[e.w] = performance.now() + S.cd * 1000; this.coolAll = performance.now() + BETWEEN * 1000; }
        if (e.w === 'snap') { snd.slip(); ui.toast('The cord snapped! It ties on again when you reach the others.', 'bad'); }
        if (e.w === 'jam') { snd.warn(); ui.toast('The checkpoints are jammed for 30 seconds!', 'bad'); }
        if (e.w === 'dark' && !this.me) { snd.zap(); this.dark(t); }
        if (e.w === 'static' && !this.me) { snd.buzz(2); this.staticFor(t); }
        if (e.w === 'dark' || e.w === 'static') ui.toast(e.w === 'dark' ? 'Someone put the lights out!' : 'Someone filled the compass with static!', 'bad');
        setTimeout(() => ui.toast('Clue: ' + this.clues[this.clues.length - 1], ''), 1600);
        break;
      }
      case 'no':
        ui.toast(`The team voted not long ago. Next vote in ${e.s | 0} s.`, '');
        break;
      case 'vote':
        this.vote = { end: performance.now() + (Math.min(60, +e.t || VOTE_T)) * 1000, list: Array.isArray(e.list) ? e.list.filter((x) => Array.isArray(x) && Number.isInteger(x[0])).slice(0, 8) : [], mine: null, by: String(e.by || '').slice(0, 24), n: 0 };
        snd.warn();
        break;
      case 'voted':
        if (this.vote) { this.vote.n = e.n | 0; this.vote.of = e.of | 0; }
        break;
      case 'result':
        this.vote = null;
        if (e.none) { ui.toast('Not enough votes for anyone. The traitor is still out there.', ''); break; }
        if (e.ok) {
          this.over = true;
          this.result = { win: 'team', name: e.name };
          snd.relic();
          this.say(`${e.name} was the traitor!`, 'Caught. The sabotage is over: climb on together.', 'good');
        } else {
          this.wrong = e.wrong | 0;
          if (e.tname) {
            this.over = true;
            this.result = { win: 'traitor', name: e.tname };
            this.say('The traitor won', `${e.name} was innocent too. The traitor was ${e.tname}.`, 'bad');
          } else this.say(`${e.name} was not the traitor`, `One more wrong vote and the traitor wins.`, 'bad');
        }
        break;
      case 'left':
        this.over = true;
        this.result = { win: 'left', name: String(e.name || '').slice(0, 24) };
        ui.toast(`The traitor (${this.result.name}) left the climb.`, '');
        break;
    }
    this.draw();
  }

  say(big, sub, kind) { this.app.ui.banner('Traitor mode', big, sub, kind === 'good' ? '#4fe06e' : '#ff4a5a'); }

  // ---------------------------------------------------------------- what it looks like
  dark(t) {
    const el = $('#trDark');
    el.classList.add('on');
    clearTimeout(this.darkT);
    this.darkT = setTimeout(() => el.classList.remove('on'), t * 1000);
  }
  staticFor(t) {
    document.body.classList.add('trStatic');
    this.app.trStatic = true;
    clearTimeout(this.staticT);
    this.staticT = setTimeout(() => { document.body.classList.remove('trStatic'); this.app.trStatic = false; }, t * 1000);
  }
  effects(on) {
    if (on) return;
    const d = document.getElementById('trDark');
    if (d) d.classList.remove('on');
    document.body.classList.remove('trStatic');
    this.app.trStatic = false;
  }

  // The HUD: the traitor's mask button, everyone's vote button, and the vote itself when there is one.
  draw() {
    const sab = $('#hSab'), tr = $('#hTr'), vote = $('#trVote');
    if (!sab) return;
    sab.hidden = !(this.on && this.me && !this.over);
    tr.hidden = !(this.on && !this.over);
    if (!this.vote) { vote.hidden = true; vote.innerHTML = ''; }
    if (sab.hidden) this.closeSab();
  }
  // Every frame from main.js: the vote's clock and the traitor's cooldowns.
  frame() {
    const v = this.vote, el = $('#trVote');
    if (v) {
      const left = Math.max(0, Math.ceil((v.end - performance.now()) / 1000));
      const html = `<b>Vote: who is the traitor?</b><small>${esc(v.by)} called it · ${left} s · ${v.n || 0} of ${v.of || v.list.length} voted</small>
        <div class="trv">${v.list.map(([s, n]) => `<button data-s="${s}" class="${v.mine === s ? 'on' : ''}" ${v.mine !== null ? 'disabled' : ''}>${esc(String(n).slice(0, 20))}</button>`).join('')}<button data-s="-1" class="skip ${v.mine === -1 ? 'on' : ''}" ${v.mine !== null ? 'disabled' : ''}>Skip</button></div>`;
      if (el.__h !== html) { el.__h = html; el.innerHTML = html; }
      el.hidden = false;
    } else if (!el.hidden) { el.hidden = true; el.__h = ''; }
    const m = $('#sabMenu');
    if (m && m.classList.contains('on')) this.sabMenu();
  }
  pickVote(s) {
    const v = this.vote, g = this.g;
    if (!v || v.mine !== null || !g) return;
    v.mine = s;
    g.s.toHost({ k: 'tr', a: 'ballot', s });
  }
  openSab() { $('#sabMenu').classList.add('on'); this.sabMenu(); }
  closeSab() { const m = $('#sabMenu'); if (m) { m.classList.remove('on'); m.__h = ''; } }
  sabMenu() {
    const m = $('#sabMenu'), now = performance.now();
    const html = `<b>Sabotage</b>${Object.entries(SABOTAGES).map(([k, S]) => {
      const w = Math.max(0, Math.ceil((Math.max(this.cool[k] || 0, this.coolAll || 0) - now) / 1000));
      return `<button data-w="${k}" ${w ? 'class="wait"' : ''}><b>${S.name}</b><small>${w ? `Ready in ${w} s` : S.sub}</small></button>`;
    }).join('')}<small class="sabnote">Every trick leaves a clue for the others.</small>`;
    if (m.__h !== html) { m.__h = html; m.innerHTML = html; }
  }
  sabotage(w) {
    const g = this.g;
    if (!g || !this.me || this.over || !SABOTAGES[w]) return;
    g.s.toHost({ k: 'tr', a: 'sab', w });
    this.closeSab();
  }
  callVote() {
    const g = this.g;
    if (!g || !this.on || this.over) return;
    if (this.vote) return this.app.ui.toast('A vote is going on already.', '');
    g.s.toHost({ k: 'tr', a: 'call' });
  }
  // Wire the HUD buttons once (main.js).
  mount() {
    $('#hSab').addEventListener('click', () => { const m = $('#sabMenu'); if (m.classList.contains('on')) this.closeSab(); else this.openSab(); });
    $('#sabMenu').addEventListener('click', (e) => { const b = e.target.closest('button[data-w]'); if (b) this.sabotage(b.dataset.w); });
    $('#trVote').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (b && !b.disabled) this.pickVote(+b.dataset.s); });
    document.addEventListener('pointerdown', (e) => { const m = $('#sabMenu'); if (m.classList.contains('on') && !e.target.closest('#sabMenu, #hSab')) this.closeSab(); }, { capture: true });
  }
}

// The line on the summit screen.
export function traitorLine(t) {
  if (!t || typeof t !== 'object') return '';
  const n = esc(String(t.name || '').slice(0, 24));
  if (t.win === 'team') return `<p class="trEnd good">Traitor mode: the team caught ${n}.</p>`;
  if (t.win === 'left') return `<p class="trEnd">Traitor mode: the traitor (${n}) left the climb.</p>`;
  return `<p class="trEnd bad">Traitor mode: ${n} was the traitor, and got away with it.</p>`;
}
