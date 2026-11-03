// Writes down a climb as it is played, so the server can run it again and see the same thing happen.
//
// What goes down is only what the physics can't work out by itself: the stick and buttons of every physics step, the odd
// action that happens between steps, and, when climbing with others, where they were. Once a second it also notes where
// the climber is. The server plays the same steps with the same physics, and a phone that moved its climber any other way
// no longer matches. Stick values are rounded before the step uses them, so what is written is exactly what was played.
//
// A chunk is one packed block: a length, a JSON part (actions, positions, how the climb started) and then the columns.
export const CHUNK_TICKS = 1200;
export const SAMPLE_EVERY = 60;
const Q = 32767, PQ = 1024;
const NO_PARTNER = -2147483648;

export const qv = (v) => Math.round(Math.max(-1, Math.min(1, v || 0)) * Q);

export class Recorder {
  constructor(head, onChunk) {
    this.head = head;
    this.onChunk = onChunk;
    this.tickNo = 0;
    this.start = 0;
    this.saves = 0;
    this.q = { mx: 0, mz: 0, fx: 0, fz: 0, jump: false, jumpPressed: false, dash: false, grab: false, reel: false };
    this.mp = head.mode !== 'solo';
    this.reset();
  }

  reset() {
    this.cols = new Int16Array(CHUNK_TICKS * 4);
    this.bits = new Uint8Array(CHUNK_TICKS);
    this.partners = this.mp ? [] : null;
    this.acts = [];
    this.samples = [];
    this.n = 0;
  }

  // One physics step about to be played. Answers the rounded input to play it with.
  tick(inp) {
    const i = this.n * 4, c = this.cols, q = this.q;
    c[i] = qv(inp.mx); c[i + 1] = qv(inp.mz); c[i + 2] = qv(inp.fx); c[i + 3] = qv(inp.fz);
    q.mx = c[i] / Q; q.mz = c[i + 1] / Q; q.fx = c[i + 2] / Q; q.fz = c[i + 3] / Q;
    q.jump = !!inp.jump; q.jumpPressed = !!inp.jumpPressed; q.dash = !!inp.dash; q.grab = !!inp.grab; q.reel = !!inp.reel;
    this.bits[this.n] = (q.jump ? 1 : 0) | (q.jumpPressed ? 2 : 0) | (q.dash ? 4 : 0) | (q.grab ? 8 : 0) | (q.reel ? 16 : 0);
    return q;
  }

  // The step has been played.
  done(me) {
    this.n++;
    this.tickNo++;
    if (this.tickNo % SAMPLE_EVERY === 0) this.samples.push([this.tickNo, me.x, me.y, me.z, me.vx, me.vy, me.vz]);
    if (this.n >= CHUNK_TICKS || this.sealAfter) this.seal();
  }

  // An action, applied before the step it is numbered with. In the middle of a step it counts for the next one.
  act(code, ...args) {
    this.acts.push([this.tickNo + (this.stepping ? 1 : 0), code, ...args]);
  }

  save() {
    this.act('v');
    return ++this.saves;
  }

  // What a partner's position was for this step, for the cord or for bumping into them.
  partner(kind, slot, o) {
    if (!this.partners) return;
    const p = this.partners;
    p.push(this.n, kind, slot, Math.round(o.x * PQ), Math.round(o.y * PQ), Math.round(o.z * PQ), Math.round((o.vy || 0) * PQ), Math.round((o.reel || 0) * PQ), o.flags | 0);
  }

  // Everything so far as a block, or nothing if nothing happened.
  pack() {
    const n = this.n;
    if (!n && !this.acts.length) return null;
    const meta = { acts: this.acts, samples: this.samples };
    if (this.head && !this.headSent) meta.head = this.head;
    const text = new TextEncoder().encode(JSON.stringify(meta));
    const pn = this.partners ? this.partners.length : 0;
    const buf = new ArrayBuffer(12 + text.length + n * 8 + n + pn * 4);
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint32(0, text.length, true);
    dv.setUint32(4, n, true);
    dv.setUint32(8, pn, true);
    u8.set(text, 12);
    let o = 12 + text.length;
    // A column at a time, each value as its change from the last one: that packs several times smaller.
    for (let k = 0; k < 4; k++) {
      let last = 0;
      for (let i = 0; i < n; i++) { const v = this.cols[i * 4 + k]; dv.setInt16(o, v - last, true); last = v; o += 2; }
    }
    u8.set(this.bits.subarray(0, n), o);
    o += n;
    if (pn) for (let i = 0; i < pn; i++) { dv.setInt32(o, this.partners[i], true); o += 4; }
    return { start: this.start, n, bytes: u8 };
  }

  // A finished chunk goes off to be compressed and sent.
  seal() {
    // A win or a relic happens in the middle of a step. The chunk closes when that step is done, and not before.
    if (this.stepping) { this.sealAfter = true; return; }
    this.sealAfter = false;
    const b = this.pack();
    if (!b) return;
    this.headSent = true;
    this.start = this.tickNo;
    this.reset();
    this.onChunk(b);
  }
}

// ---------------------------------------------------------------- packing for the trip
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function fromBase64(t) {
  const s = atob(t), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
export async function deflate(u8) {
  const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
  w.write(u8);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

export { B64, NO_PARTNER, PQ, Q };
