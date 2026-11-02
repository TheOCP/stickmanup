// A controller in every menu. The direction pad or left stick moves a highlight between whatever can be pressed on
// screen, A presses it, B goes back, LB and RB switch tabs, the right stick scrolls (and turns the climber in the
// shop). Text boxes open a letter board, so a whole game can be set up without touching the phone.
// Works from the layout on screen, not from lists per menu, so a new button anywhere just works.
const OFF = 0, UP = 1, DOWN = 2, LEFT = 3, RIGHT = 4;
const DIRS = [null, [0, -1], [0, 1], [-1, 0], [1, 0]];
const B_A = 1 << 0, B_B = 1 << 1, B_X = 1 << 2, B_Y = 1 << 3, B_LB = 1 << 4, B_RB = 1 << 5, B_SELECT = 1 << 8, B_START = 1 << 9, B_UP = 1 << 12, B_DOWN = 1 << 13, B_LEFT = 1 << 14, B_RIGHT = 1 << 15;
const FIRST = 340, REPEAT = 120; // ms before a held direction repeats, then between repeats

// The rectangle to go to from cur in direction (dx, dy), as an index into rects, or -1. Things overlapping in the
// other direction (same row or column) always win over things off to the side.
export function pickNext(cur, rects, dx, dy) {
  const cx = (cur.left + cur.right) / 2, cy = (cur.top + cur.bottom) / 2;
  let best = -1, score = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i], rx = (r.left + r.right) / 2, ry = (r.top + r.bottom) / 2;
    let along, gap, off;
    if (dx) {
      if ((rx - cx) * dx <= 1) continue;
      along = dx > 0 ? r.left - cur.right : cur.left - r.right;
      gap = Math.max(0, Math.max(r.top, cur.top) - Math.min(r.bottom, cur.bottom));
      off = Math.abs(ry - cy);
    } else {
      if ((ry - cy) * dy <= 1) continue;
      along = dy > 0 ? r.top - cur.bottom : cur.top - r.bottom;
      gap = Math.max(0, Math.max(r.left, cur.left) - Math.min(r.right, cur.right));
      off = Math.abs(rx - cx);
    }
    // Nested or overlapping things (a button inside a row) count as right next to it.
    const s = Math.max(along, 0) + gap * 4 + off * 0.2;
    if (s < score) { score = s; best = i; }
  }
  return best;
}

const keyOf = (e) => {
  const d = e.dataset || {};
  return e.id || [d.a, d.k, d.v, d.id, d.m, d.t, d.d, d.c, d.e, d.ch].filter((x) => x !== undefined).join('|') || (e.textContent || '').trim().slice(0, 16);
};
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const ringOf = (e) => (e.type === 'checkbox' && e.closest('label')) || e;
const isText = (e) => e.matches('input:not([type=range]):not([type=checkbox]), textarea');
const TABS = '.tabs, .mapchips, .dsel.mrow:not(.ro)';
const LETTERS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM.:'];

export class PadNav {
  // o: input (for the dead zones), root() what is on screen or null, screen() its name, back(), start(select),
  // turn(amount) for the right stick, sound(), closed() when the last menu went away, gameUp() direction pad in play
  constructor(o) {
    this.o = o;
    this.prev = 0;
    this.using = false;
    this.el = null;
    this.ring = null;
    this.key = '';
    this.memo = {};
    this.screen = '';
    this.dir = OFF;
    this.stick = OFF;
    this.next = 0;
    this.t = 0;
    this.had = false;
    this.raw = [0, 0, 0, 0];
    this.name = '';
    this.keysEl = null;
    this.hintEl = document.getElementById('padHint');
    this.lastHint = '';
    window.addEventListener('pointerdown', (e) => { if (!(this.keysEl && this.keysEl.contains(e.target))) this.setUsing(false); }, { capture: true });
    window.addEventListener('keydown', (e) => this.key_(e));
  }

  // Keyboards and remotes get the same menus (some controllers send their direction pad as keys too).
  key_(e) {
    const d = { ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT }[e.code];
    if (!d && e.code !== 'Enter') return;
    const root = this.keysEl || this.o.root();
    if (!root || (e.target && e.target.matches && isText(e.target))) return;
    e.preventDefault();
    const woke = !this.using;
    this.setUsing(true);
    this.sync(root);
    if (woke || !this.el) return;
    if (d) this.move(root, d);
    else this.activate(root);
  }

  setUsing(on) {
    if (this.using === on) return;
    this.using = on;
    document.body.classList.toggle('pad', on);
    if (!on) this.set(null);
    this.hint();
  }

  // One frame. Polls even during play, so a button held since then doesn't count as new in the next menu.
  tick(now) {
    const dt = Math.min(0.05, (now - this.t) / 1000);
    this.t = now;
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    let bits = 0, lx = 0, ly = 0, rx = 0, ry = 0, name = '';
    if (pads) for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      if (!name) name = p.id || 'Controller';
      const b = p.buttons, a = p.axes;
      for (let k = 0; k < 16 && k < b.length; k++) if (b[k] && b[k].pressed) bits |= 1 << k;
      const a0 = a[0] || 0, a1 = a[1] || 0, a2 = a[2] || 0, a3 = a[3] || 0;
      if (hyp(a0, a1) > hyp(lx, ly)) { lx = a0; ly = a1; }
      if (hyp(a2, a3) > hyp(rx, ry)) { rx = a2; ry = a3; }
    }
    this.raw[0] = lx; this.raw[1] = ly; this.raw[2] = rx; this.raw[3] = ry;
    this.name = name;
    const rise = bits & ~this.prev;
    this.prev = bits;
    const input = this.o.input, deadL = input.deadL, deadR = input.deadR;
    // Past the dead zone and well over: a drifting stick never walks around the menu by itself.
    const m = hyp(lx, ly), on = Math.max(0.55, deadL + 0.12), off = Math.max(0.35, deadL + 0.02);
    if (m > on) this.stick = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? RIGHT : LEFT) : (ly > 0 ? DOWN : UP);
    else if (m < off) this.stick = OFF;
    const dir = bits & B_UP ? UP : bits & B_DOWN ? DOWN : bits & B_LEFT ? LEFT : bits & B_RIGHT ? RIGHT : this.stick;
    const woke = !this.using && (rise !== 0 || dir !== OFF);
    if (woke) this.setUsing(true);

    if (rise & B_START) this.o.start(false);
    else if (rise & B_SELECT) this.o.start(true);

    const root = this.keysEl || this.o.root();
    if (!root) {
      if (this.had) { this.had = false; this.o.closed(); }
      if (this.ring) this.set(null);
      if (this.lastHint) this.hint();
      this.dir = dir;
      if (rise & B_UP) this.o.gameUp();
      return;
    }
    this.had = true;
    if (!this.using) return;
    this.sync(root);
    if (woke) { this.dir = dir; this.next = now + FIRST; return; }
    if (dir !== this.dir) {
      this.dir = dir;
      this.next = now + FIRST;
      if (dir) this.move(root, dir);
    } else if (dir && now >= this.next) {
      this.next = now + REPEAT;
      this.move(root, dir);
    }
    if (rise & B_A) this.activate(root);
    else if (rise & B_B) { if (this.keysEl) this.closeKeys(false); else this.o.back(); }
    else if (this.keysEl) {
      if (rise & B_X) this.keyPress('del');
      else if (rise & B_Y) this.keyPress('shift');
    } else if (rise & (B_LB | B_RB)) this.tab(root, rise & B_RB ? 1 : -1);
    const dr = Math.max(0.3, deadR + 0.05);
    if (Math.abs(rx) > dr) this.o.turn(rx * dt);
    if (Math.abs(ry) > dr) { const s = this.scroller(root); if (s) s.scrollTop += ry * dt * 900; }
  }

  items(root) {
    const all = root.querySelectorAll('button, input, select, textarea, [data-a]'), out = [];
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.disabled || e.type === 'hidden' || e.closest('.ro') || !e.getClientRects().length) continue;
      out.push(e);
    }
    return out;
  }

  // Keeps the highlight on something real: after a screen changed, or the same screen drew itself again.
  sync(root) {
    if (!this.keysEl) {
      const scr = this.o.screen();
      if (scr !== this.screen) {
        if (this.screen) this.memo[this.screen] = this.key;
        this.screen = scr;
        this.key = this.memo[scr] || '';
        this.set(null);
      }
    }
    if (this.el && this.el.isConnected && root.contains(this.el) && !this.el.disabled && this.el.getClientRects().length) return;
    const list = this.items(root), key = this.key;
    let to = key ? list.find((e) => keyOf(e) === key) : null;
    if (!to) {
      const q = (s) => list.find((e) => e.matches(s));
      to = q('.skin.sel') || q('.skin') || q('.map.sel') || q('.card.sel') || q('input.code') || q('.btn.primary') || q('.item') || q('.on') || list.find((e) => !e.matches('.back')) || list[0] || null;
    }
    this.set(to);
    this.hint();
  }

  // Put the highlight on this one next (the pause menu opens on Back to checkpoint from Select).
  aim(key) {
    this.memo[this.o.screen()] = key;
    this.key = key;
    this.set(null);
  }

  set(e) {
    if (this.ring) this.ring.classList.remove('pf');
    this.el = e;
    this.ring = e ? ringOf(e) : null;
    if (!e) return;
    this.ring.classList.add('pf');
    this.key = keyOf(e);
    this.ring.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  move(root, dir) {
    const [dx, dy] = DIRS[dir], e = this.el;
    if (!e) return;
    if (dx && e.type === 'range') {
      const step = +e.step || 0.05, v = Math.min(+e.max, Math.max(+e.min, +e.value + dx * step));
      if (v !== +e.value) {
        e.value = v;
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
        this.o.sound();
      }
      return;
    }
    const list = this.items(root).filter((x) => x !== e);
    const i = pickNext(ringOf(e).getBoundingClientRect(), list.map((x) => ringOf(x).getBoundingClientRect()), dx, dy);
    if (i >= 0) {
      this.set(list[i]);
      this.o.sound();
      this.hint();
    } else if (dy) {
      // Nothing further that way: the rest is text, so scroll it.
      const s = this.scroller(root);
      if (s) s.scrollTop += dy * 140;
    }
  }

  // What the right stick and running out of buttons scroll: the nearest thing around the highlight that can.
  scroller(root) {
    const can = (n) => n.scrollHeight > n.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(n).overflowY);
    for (let n = this.el; n && n !== document.body; n = n.parentElement) {
      if (can(n)) return n;
      if (n === root) break;
    }
    for (const n of root.querySelectorAll('.panel, .shopgrid')) if (can(n)) return n;
    return can(root) ? root : null;
  }

  activate(root) {
    const e = this.el;
    if (!e || e.type === 'range') return;
    if (isText(e)) return this.openKeys(e);
    // In the shop: A tries it on, A again wears it (or goes to the buy button, so coins are never spent by accident).
    if (e.matches('.skin.sel')) {
      const act = root.querySelector('.shopinfo [data-a]:not([disabled])');
      if (act) {
        if (act.dataset.a === 'equip') act.click();
        else { this.set(act); this.o.sound(); this.hint(); }
        return;
      }
    }
    if (!e.closest('[data-a]')) this.o.sound();
    e.click();
  }

  tab(root, d) {
    const g = root.querySelector(TABS);
    if (!g) return;
    const list = [...g.querySelectorAll('button:not([disabled])')];
    if (list.length < 2) return;
    const at = list.findIndex((b) => b.matches('.on, .sel'));
    list[(at + d + list.length) % list.length].click();
  }

  // ---------------------------------------------------------------- letter board
  openKeys(input) {
    this.keyInput = input;
    this.caps = input.classList.contains('code') || !input.value;
    const el = document.createElement('div');
    el.id = 'padKeys';
    el.innerHTML = `<div class="pkbox"><div class="pkv"></div>${LETTERS.map((r) => `<div class="pkr">${[...r].map((c) => `<button data-ch="${c}">${c}</button>`).join('')}</div>`).join('')}
      <div class="pkr"><button data-e="shift">Aa</button><button data-e="space" class="w">Space</button><button data-e="del">Delete</button><button data-e="done" class="pri">Done</button></div></div>`;
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b) { this.o.sound(); this.keyPress(b.dataset.ch || b.dataset.e); }
    });
    document.body.appendChild(el);
    this.keysEl = el;
    this.set(null);
    this.key = '';
    this.sync(el);
    this.drawKeys();
    this.hint();
  }

  drawKeys() {
    const el = this.keysEl, up = this.caps;
    el.querySelector('.pkv').textContent = this.keyInput.value || ' ';
    for (const b of el.querySelectorAll('[data-ch]')) b.textContent = up ? b.dataset.ch : b.dataset.ch.toLowerCase();
  }

  keyPress(what) {
    const inp = this.keyInput;
    if (what === 'done') return this.closeKeys(true);
    if (what === 'shift') this.caps = !this.caps;
    else {
      let v = inp.value;
      if (what === 'del') v = v.slice(0, -1);
      else if (!(inp.maxLength > 0 && v.length >= inp.maxLength)) {
        const c = what === 'space' ? ' ' : this.caps ? what : what.toLowerCase();
        v += c;
        if (!inp.classList.contains('code')) this.caps = false;
      }
      inp.value = v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.drawKeys();
  }

  closeKeys(next) {
    const inp = this.keyInput;
    this.keysEl.remove();
    this.keysEl = null;
    this.keyInput = null;
    this.set(null);
    const root = this.o.root();
    if (inp && inp.isConnected && root) {
      this.set(inp);
      // Done: on to what comes next (usually the Join button beside the box).
      if (next) this.move(root, RIGHT);
    }
    this.hint();
  }

  // ---------------------------------------------------------------- what the buttons do right now
  hint() {
    const h = this.hintEl;
    if (!h) return;
    const root = this.keysEl || this.o.root(), parts = [];
    if (this.using && root) {
      if (this.keysEl) parts.push(['A', 'Type'], ['X', 'Delete'], ['Y', 'Capitals'], ['B', 'Close']);
      else {
        const e = this.el, scr = this.o.screen();
        if (e && e.type === 'range') parts.push(['Left Right', 'Change']);
        else if (e && e.matches('.skin.sel')) { const a = root.querySelector('.shopinfo [data-a]:not([disabled])'); parts.push(['A', a ? (a.dataset.a === 'equip' ? 'Wear it' : 'To the buy button') : 'Select']); }
        else if (e && e.matches('.skin')) parts.push(['A', 'Try on']);
        else parts.push(['A', 'Select']);
        if (scr !== 'title') parts.push(['B', scr === 'pause' ? 'Resume' : 'Back']);
        if (root.querySelector(TABS)) parts.push(['LB RB', 'Switch']);
        if (scr === 'shop') parts.push(['Right stick', 'Turn']);
      }
    }
    const html = parts.map(([k, t]) => `<span><b>${k}</b> ${t}</span>`).join('');
    if (html === this.lastHint) return;
    this.lastHint = html;
    h.innerHTML = html;
    h.classList.toggle('on', !!html);
  }
}
