// Touch (floating stick + buttons + camera drag), mouse, keyboard and gamepad, merged into one state.
import { ON_PC, IS_WEB } from './platform.js';

// A mouse moves many more pixels than a finger for the same turn.
const MOUSE_LOOK = 0.4, MOUSE_JUMP = 250;
const clampMove = (d) => Math.max(-MOUSE_JUMP, Math.min(MOUSE_JUMP, d));
// Keys light up the button they stand for.
const KEY_BTN = { Space: 'bJump', ShiftLeft: 'bGrab', ShiftRight: 'bGrab', KeyJ: 'bGrab', KeyE: 'bReel', KeyK: 'bReel', KeyF: 'bAct', KeyQ: 'bShield', KeyC: 'bDash', KeyR: 'bShoot' };

export class Input {
  constructor(layer) {
    this.sx = 0; this.sy = 0;
    this.btn = { jump: false, grab: false, reel: false, act: false, shield: false, aim: false, dash: false };
    this.jumpEdge = false;
    this.edge = { act: false, shield: false, fire: false, dash: false };
    this.padLock = false; // a menu that doesn't pause the game is using the controller
    this.aimP = null;
    this.lefty = false;
    this.editing = null; // layout editor: (id, cx, cy) => void while dragging buttons around
    this.camDX = 0; this.camDY = 0;
    this.keys = new Set();
    this.sens = 1;
    this.aimSens = 1;
    this.invert = false;
    this.deadL = 0.16; // how far a controller stick must move before it counts (stick drift stays below this)
    this.deadR = 0.16;
    this.padMask = [];
    this.on_ = false;
    this.menuOpen = false; // a menu that needs the cursor sits over the running game
    this.lockLost = -1000;
    this.stick = null;
    this.cam = null;
    this.onPause = null;
    this.layer = layer;
    this.stickEl = layer.querySelector('#stick');
    this.knobEl = layer.querySelector('#knob');
    this.bindTouch();
    this.bindKeys();
    this.bindMouse();
  }

  get enabled() { return this.on_; }
  set enabled(v) {
    this.on_ = v;
    if (!ON_PC) return;
    if (v) this.grabMouse();
    else {
      this.menuOpen = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.mouseHint();
  }

  // On a PC the mouse turns the camera. Clicking takes it, Esc or leaving the window gives it back and pauses.
  bindMouse() {
    if (!ON_PC) return;
    const L = this.layer;
    document.body.classList.add('pc');
    L.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (document.pointerLockElement !== L) { this.grabMouse(); return; }
      if (e.button === 0) this.edge.fire = true;
      if (e.button === 2) this.btn.aim = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2 && this.enabled) this.btn.aim = false; });
    window.addEventListener('contextmenu', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.mouseHint();
      if (document.pointerLockElement === L) return;
      this.lockLost = performance.now();
      if (this.enabled && !this.menuOpen && this.onPause) this.onPause();
    });
  }

  grabMouse() {
    if (!ON_PC || !this.on_ || this.menuOpen || document.pointerLockElement === this.layer) return;
    try {
      const p = this.layer.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* the hint stays up, and the next click tries again */ }
  }

  freeMouse(on) {
    if (!ON_PC) return;
    this.menuOpen = on;
    if (!on) this.grabMouse();
    else if (document.pointerLockElement) document.exitPointerLock();
    this.mouseHint();
  }

  mouseHint() {
    document.body.classList.toggle('needclick', this.on_ && !this.menuOpen && document.pointerLockElement !== this.layer);
  }

  bindTouch() {
    const L = this.layer, R = 58;
    L.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.target.closest('.tb, .hb') || (ON_PC && e.pointerType === 'mouse')) return;
      const W = window.innerWidth, left = (this.lefty ? e.clientX > W * 0.58 : e.clientX < W * 0.42) && e.pointerType !== 'mouse';
      if (left && !this.stick) {
        this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.stickEl.classList.add('on');
        this.knobEl.style.transform = 'translate(0px, 0px)';
      } else if (!this.cam) this.cam = { id: e.pointerId, x: e.clientX, y: e.clientY };
      else return;
      L.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    L.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        let dx = e.clientX - this.stick.x, dy = e.clientY - this.stick.y;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          // Drag the stick base along so a long swipe never "runs out".
          this.stick.x += (dx / d) * (d - R); this.stick.y += (dy / d) * (d - R);
          this.stickEl.style.transform = `translate(${this.stick.x}px, ${this.stick.y}px)`;
          dx = (dx / d) * R; dy = (dy / d) * R;
        }
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        // dx/dy are clamped to R here; apply a small dead zone and rescale.
        const m = Math.min(d, R) / R, s = m < 0.12 ? 0 : (m - 0.12) / 0.88 / m;
        this.sx = (dx / R) * s;
        this.sy = (-dy / R) * s;
      } else if (this.cam && e.pointerId === this.cam.id) {
        this.camDX += e.clientX - this.cam.x; this.camDY += e.clientY - this.cam.y;
        this.cam.x = e.clientX; this.cam.y = e.clientY;
      }
    });
    const up = (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick = null; this.sx = this.sy = 0;
        this.stickEl.classList.remove('on');
      }
      if (this.cam && e.pointerId === this.cam.id) this.cam = null;
    };
    L.addEventListener('pointerup', up);
    L.addEventListener('pointercancel', up);

    for (const b of L.querySelectorAll('.tb')) this.bindEditDrag(b);
    // SHOOT: hold to aim (drag the finger to steer the crosshair), let go to fire.
    const sb = L.querySelector('#bShoot');
    sb.addEventListener('pointerdown', (e) => {
      if (this.editing) return;
      e.preventDefault();
      sb.setPointerCapture(e.pointerId);
      this.aimP = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.btn.aim = true;
      sb.classList.add('down');
      if (window.Native) window.Native.haptic('tick');
    });
    sb.addEventListener('pointermove', (e) => {
      const a = this.aimP;
      if (!a || e.pointerId !== a.id) return;
      this.camDX += (e.clientX - a.x) * 0.55; this.camDY += (e.clientY - a.y) * 0.55;
      a.x = e.clientX; a.y = e.clientY;
    });
    const fire = (shoot) => () => {
      if (!this.aimP) return;
      this.aimP = null;
      this.btn.aim = false;
      if (shoot) this.edge.fire = true;
      sb.classList.remove('down');
    };
    sb.addEventListener('pointerup', fire(true));
    sb.addEventListener('pointercancel', fire(false));
    sb.addEventListener('lostpointercapture', fire(true));
    for (const [id, key] of [['bJump', 'jump'], ['bGrab', 'grab'], ['bReel', 'reel'], ['bAct', 'act'], ['bShield', 'shield'], ['bDash', 'dash']]) {
      const b = L.querySelector('#' + id);
      b.addEventListener('pointerdown', (e) => {
        if (this.editing) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        if (key === 'jump' && !this.btn.jump) this.jumpEdge = true;
        if (key in this.edge && !this.btn[key]) this.edge[key] = true;
        this.btn[key] = true;
        b.classList.add('down');
        if (window.Native) window.Native.haptic('tick');
      });
      const rel = () => { this.btn[key] = false; b.classList.remove('down'); };
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointercancel', rel);
      b.addEventListener('lostpointercapture', rel);
    }
  }

  // Layout editor: while editing, dragging any button moves it (reported as its centre on screen).
  bindEditDrag(b) {
    let drag = null;
    b.addEventListener('pointerdown', (e) => {
      if (!this.editing) return;
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      const r = b.getBoundingClientRect();
      drag = { id: e.pointerId, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2) };
      b.classList.add('down');
    });
    b.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || !this.editing) return;
      this.editing(b.id, e.clientX - drag.ox, e.clientY - drag.oy);
    });
    const end = () => { drag = null; b.classList.remove('down'); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (this.enabled && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow'))) e.preventDefault();
      if (this.enabled && KEY_BTN[e.code]) { const b = document.getElementById(KEY_BTN[e.code]); if (b) b.classList.add('down'); }
      if (e.code === 'Space' && !this.keys.has('Space')) this.jumpEdge = true;
      if (e.code === 'KeyF' && !this.keys.has('KeyF')) this.edge.act = true;
      if (e.code === 'KeyQ' && !this.keys.has('KeyQ')) this.edge.shield = true;
      // In a browser Ctrl is out: with W held down, as it always is while running, it would close the tab.
      if ((e.code === 'KeyC' || (e.code === 'ControlLeft' && !IS_WEB)) && !this.keys.has(e.code)) this.edge.dash = true;
      if (e.code === 'KeyH' && !this.keys.has('KeyH') && this.onTip) this.onTip();
      if (e.code === 'KeyT' && !this.keys.has('KeyT') && this.onEmote) this.onEmote();
      if (e.code === 'KeyR' && !this.keys.has('KeyR')) this.btn.aim = true;
      // The same Esc that gave the mouse back already paused.
      if (e.code === 'Escape' && this.onPause && performance.now() - this.lockLost > 300) this.onPause();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyR' && this.keys.has('KeyR')) { this.btn.aim = false; this.edge.fire = true; }
      if (KEY_BTN[e.code]) { const b = document.getElementById(KEY_BTN[e.code]); if (b) b.classList.remove('down'); }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (ON_PC && document.pointerLockElement === this.layer) {
        this.camDX += clampMove(e.movementX) * MOUSE_LOOK;
        this.camDY += clampMove(e.movementY) * MOUSE_LOOK;
      } else if (e.buttons === 1 && e.target === this.layer) { this.camDX += e.movementX; this.camDY += e.movementY; }
    });
  }

  // A menu that doesn't pause the game takes the controller for a moment.
  lockPad(on) {
    this.padLock = on;
    if (on && this.padAim) { this.padAim = false; this.btn.aim = false; }
    if (!on) this.holdPad();
  }

  // A menu just closed with a button still down: it doesn't count in the game until it is let go.
  holdPad() {
    for (let i = 0; i < 20; i++) this.padMask[i] = true;
  }

  reset() {
    this.sx = this.sy = 0;
    this.btn.jump = this.btn.grab = this.btn.reel = this.btn.act = this.btn.shield = this.btn.aim = this.btn.dash = false;
    this.jumpEdge = false;
    this.edge.act = this.edge.shield = this.edge.fire = this.edge.dash = false;
    this.aimP = null;
    this.camDX = this.camDY = 0;
    this.stick = this.cam = null;
    this.stickEl.classList.remove('on');
    for (const b of this.layer.querySelectorAll('.tb')) b.classList.remove('down');
  }

  // Snapshot for one frame, with movement turned into world space from the camera yaw.
  read(yaw) {
    const k = this.keys;
    let sx = this.sx, sy = this.sy;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;
    let jump = this.btn.jump || k.has('Space'), grab = this.btn.grab || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyJ');
    let reel = this.btn.reel || k.has('KeyE') || k.has('KeyK');
    let jumpPressed = this.jumpEdge;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    // The camera turns at the same speed at any frame rate.
    const now = performance.now(), padK = Math.min(3, (now - (this.padT || now - 16.67)) / 16.67), mask = this.padMask;
    this.padT = now;
    // Round dead zones, measured on the whole stick. Past the edge the range starts again from zero, so there is
    // no jump and the full range stays usable however large the dead zone is.
    const live = (x, y, d) => { const m = Math.sqrt(x * x + y * y); return m <= d || m === 0 ? 0 : Math.min(1, (m - d) / (1 - d)) / m; };
    for (const p of pads) {
      if (!p || this.padLock) continue;
      const a0 = p.axes[0] || 0, a1 = p.axes[1] || 0, a2 = p.axes[2] || 0, a3 = p.axes[3] || 0;
      const kl = live(a0, a1, this.deadL), kr = live(a2, a3, this.deadR);
      sx += a0 * kl; sy -= a1 * kl;
      this.camDX += a2 * kr * 14 * padK; this.camDY += a3 * kr * 10 * padK;
      const b = (i) => {
        const on = !!(p.buttons[i] && p.buttons[i].pressed);
        if (!on) mask[i] = false;
        return on && !mask[i];
      };
      if (b(0) && !this.padJump) jumpPressed = true;
      this.padJump = b(0);
      jump = jump || b(0);
      grab = grab || b(1);
      reel = reel || b(5);
      // Y (or pressing in the left stick): dash.
      const pd = b(3) || b(10);
      if (pd && !this.padDash) this.edge.dash = true;
      this.padDash = pd;
      if (b(2) && !this.padAct) this.edge.act = true;
      this.padAct = b(2);
      // Left trigger: hold to aim. Right trigger: fire, aimed or from the hip.
      if (b(6)) this.btn.aim = this.padAim = true;
      else if (this.padAim) { this.padAim = false; this.btn.aim = false; }
      const pf = b(7);
      if (pf && !this.padFire) this.edge.fire = true;
      this.padFire = pf;
      if (b(4) && !this.padShield) this.edge.shield = true;
      this.padShield = b(4);
    }
    const l = Math.hypot(sx, sy);
    if (l > 1) { sx /= l; sy /= l; }
    this.jumpEdge = false;
    const act = this.edge.act, shield = this.edge.shield, fire = this.edge.fire, dash = this.edge.dash, aim = this.btn.aim;
    this.edge.act = this.edge.shield = this.edge.fire = this.edge.dash = false;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return { mx: fx * sy + rx * sx, mz: fz * sy + rz * sx, fx, fz, jump, jumpPressed, dash, grab, reel, act, shield, aim, fire };
  }

  // Camera turn since last frame; while aiming the aim sensitivity applies instead of the camera speed.
  takeCam(aiming) {
    const k = aiming ? this.aimSens * 0.7 : this.sens;
    const d = [this.camDX * 0.0055 * k, this.camDY * 0.0045 * k * (this.invert ? -1 : 1)];
    this.camDX = this.camDY = 0;
    return d;
  }
}
