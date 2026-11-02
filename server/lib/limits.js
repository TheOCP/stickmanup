'use strict';
// Token buckets: a burst is allowed, then a steady rate. Used to keep any one address from overloading the server.

class Limiter {
  // burst tokens at most, refilled at perSecond.
  constructor(burst, perSecond) {
    this.burst = burst;
    this.rate = perSecond;
    this.keys = new Map();
  }

  // Is one more of these allowed for this key?
  take(key, n = 1) {
    const now = Date.now();
    let b = this.keys.get(key);
    if (!b) {
      b = { t: now, left: this.burst };
      this.keys.set(key, b);
    }
    b.left = Math.min(this.burst, b.left + ((now - b.t) / 1000) * this.rate);
    b.t = now;
    if (b.left < n) return false;
    b.left -= n;
    return true;
  }

  // Full buckets hold no information, so they can go.
  sweep() {
    const now = Date.now();
    for (const [k, b] of this.keys) if (b.left + ((now - b.t) / 1000) * this.rate >= this.burst) this.keys.delete(k);
  }
}

// One socket: how many messages and bytes it may send.
class SocketRate {
  constructor(msgBurst, msgPerSecond, byteBurst, bytePerSecond) {
    this.mb = msgBurst; this.mr = msgPerSecond; this.bb = byteBurst; this.br = bytePerSecond;
    this.m = msgBurst; this.b = byteBurst; this.t = Date.now();
  }

  take(bytes) {
    const now = Date.now(), dt = (now - this.t) / 1000;
    this.t = now;
    this.m = Math.min(this.mb, this.m + dt * this.mr);
    this.b = Math.min(this.bb, this.b + dt * this.br);
    if (this.m < 1 || this.b < bytes) return false;
    this.m -= 1;
    this.b -= bytes;
    return true;
  }
}

module.exports = { Limiter, SocketRate };
