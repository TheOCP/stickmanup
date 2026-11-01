// Touch (floating stick + buttons + camera drag), keyboard and gamepad, merged into one state.
export class Input {
  constructor(layer) {
    this.sx = 0; this.sy = 0;
    this.btn = { jump: false, grab: false, reel: false, act: false, shield: false, aim: false };
    this.jumpEdge = false;
    this.edge = { act: false, shield: false, fire: false };
    this.aimP = null;
    this.lefty = false;
    this.editing = null; // layout editor: (id, cx, cy) => void while dragging buttons around
    this.camDX = 0; this.camDY = 0;
    this.keys = new Set();
    this.sens = 1;
    this.aimSens = 1;
    this.invert = false;
    this.enabled = false;
    this.stick = null;
    this.cam = null;
    this.onPause = null;
    this.layer = layer;
    this.stickEl = layer.querySelector('#stick');
    this.knobEl = layer.querySelector('#knob');
    this.bindTouch();
    this.bindKeys();
  }

  bindTouch() {
    const L = this.layer, R = 58;
    L.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.target.closest('.tb, .hb')) return;
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
    for (const [id, key] of [['bJump', 'jump'], ['bGrab', 'grab'], ['bReel', 'reel'], ['bAct', 'act'], ['bShield', 'shield']]) {
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
      if (e.code === 'Space' && !this.keys.has('Space')) this.jumpEdge = true;
      if (e.code === 'KeyF' && !this.keys.has('KeyF')) this.edge.act = true;
      if (e.code === 'KeyQ' && !this.keys.has('KeyQ')) this.edge.shield = true;
      if (e.code === 'KeyR' && !this.keys.has('KeyR')) this.btn.aim = true;
      if (e.code === 'Escape' && this.onPause) this.onPause();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyR' && this.keys.has('KeyR')) { this.btn.aim = false; this.edge.fire = true; }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (this.enabled && e.buttons === 1 && e.target === this.layer) { this.camDX += e.movementX; this.camDY += e.movementY; }
    });
  }

  reset() {
    this.sx = this.sy = 0;
    this.btn.jump = this.btn.grab = this.btn.reel = this.btn.act = this.btn.shield = this.btn.aim = false;
    this.jumpEdge = false;
    this.edge.act = this.edge.shield = this.edge.fire = false;
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
    for (const p of pads) {
      if (!p) continue;
      const ax = (i) => (Math.abs(p.axes[i] || 0) > 0.15 ? p.axes[i] : 0);
      sx += ax(0); sy -= ax(1);
      this.camDX += ax(2) * 14; this.camDY += ax(3) * 10;
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      if (b(0) && !this.padJump) jumpPressed = true;
      this.padJump = b(0);
      jump = jump || b(0);
      grab = grab || b(1) || b(6);
      reel = reel || b(3) || b(7);
      if (b(2) && !this.padAct) this.edge.act = true;
      this.padAct = b(2);
      // Right bumper: hold to aim, release to fire.
      if (b(5)) this.btn.aim = this.padAim = true;
      else if (this.padAim) { this.padAim = false; this.btn.aim = false; this.edge.fire = true; }
      if (b(4) && !this.padShield) this.edge.shield = true;
      this.padShield = b(4);
      if (b(9) && !this.padStart && this.onPause) this.onPause();
      this.padStart = b(9);
    }
    const l = Math.hypot(sx, sy);
    if (l > 1) { sx /= l; sy /= l; }
    this.jumpEdge = false;
    const act = this.edge.act, shield = this.edge.shield, fire = this.edge.fire, aim = this.btn.aim;
    this.edge.act = this.edge.shield = this.edge.fire = false;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return { mx: fx * sy + rx * sx, mz: fz * sy + rz * sx, jump, jumpPressed, grab, reel, act, shield, aim, fire };
  }

  // Camera turn since last frame; while aiming the aim sensitivity applies instead of the camera speed.
  takeCam(aiming) {
    const k = aiming ? this.aimSens * 0.7 : this.sens;
    const d = [this.camDX * 0.0055 * k, this.camDY * 0.0045 * k * (this.invert ? -1 : 1)];
    this.camDX = this.camDY = 0;
    return d;
  }
}
