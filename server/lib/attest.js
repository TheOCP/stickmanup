'use strict';
// Android key attestation: asking a phone's own secure hardware to vouch for it, with a certificate chain back to Google.
// Unlike anything else a phone reports, a modified app or a rooted phone can't fake this (short of a leaked hardware key,
// which is why Google publishes a revocation list). It says which app asked, signed with which key, and whether the phone
// booted the way its maker intended.
//
// It only ever adds confidence. A phone without working attestation, or one that fails it, isn't a cheat by itself: being
// rooted with an unlocked bootloader is perfectly allowed here. What does count is a certificate saying the app isn't ours.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OID = '1.3.6.1.4.1.11129.2.1.17';
const PACKAGE = 'io.stickmanup';
const ROOTS_URL = 'https://android.googleapis.com/attestation/root';
const STATUS_URL = 'https://android.googleapis.com/attestation/status';
const CHALLENGE_TTL = 5 * 60000;
const REFRESH = 24 * 3600000;

// ---------------------------------------------------------------- reading the certificate's extension (plain DER)
function readTlv(buf, at) {
  let i = at;
  const first = buf[i++];
  const cls = first >> 6, constructed = !!(first & 0x20);
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b;
    do { b = buf[i++]; tag = tag * 128 + (b & 0x7f); } while (b & 0x80);
  }
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 4 || n === 0) throw new Error('bad length');
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[i++];
  }
  if (i + len > buf.length) throw new Error('truncated');
  return { cls, tag, constructed, start: i, end: i + len, next: i + len, value: buf.subarray(i, i + len) };
}
function children(t) {
  const out = [];
  let i = 0;
  while (i < t.value.length) {
    const c = readTlv(t.value, i);
    out.push(c);
    i = c.next;
  }
  return out;
}
// Finds an extension's value by OID in a whole certificate, without a full X.509 parse: its bytes are unique enough.
function encodeOid(oid) {
  const p = oid.split('.').map(Number), out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const b = [];
    let x = v;
    b.unshift(x & 0x7f);
    x = Math.floor(x / 128);
    while (x > 0) { b.unshift((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    out.push(...b);
  }
  return Buffer.from([0x06, out.length, ...out]);
}
function extension(der, oid) {
  const needle = encodeOid(oid), i = der.indexOf(needle);
  if (i < 0) return null;
  let at = i + needle.length, t = readTlv(der, at);
  if (t.cls === 0 && t.tag === 1) { at = t.next; t = readTlv(der, at); } // critical flag
  if (t.cls !== 0 || t.tag !== 4) return null;
  return t.value;
}

// The attestation record: what the hardware says about the key's owner.
function parseAttestation(ext) {
  const seq = readTlv(ext, 0), f = children(seq);
  if (f.length < 8) throw new Error('short record');
  const challenge = Buffer.from(f[4].value);
  const out = { securityLevel: f[1].value[0], challenge, app: null, boot: null };
  const scan = (list) => {
    for (const a of children(list)) {
      if (a.cls !== 2) continue;
      if (a.tag === 709) {
        // attestationApplicationId: an OCTET STRING holding the package names and signing certificate digests.
        const inner = readTlv(a.value, 0), rec = readTlv(inner.value, 0), [pkgs, digests] = children(rec), names = [], sigs = [];
        for (const pi of children(pkgs)) { const [name] = children(pi); names.push(name.value.toString('utf8')); }
        for (const d of children(digests)) sigs.push(d.value.toString('hex'));
        out.app = { names, sigs };
      } else if (a.tag === 704) {
        const r = children(readTlv(a.value, 0));
        out.boot = { locked: r[1] ? r[1].value[0] !== 0 : false, state: r[2] ? r[2].value[0] : 3 };
      }
    }
  };
  scan(f[6]);
  scan(f[7]);
  return out;
}

class Attest {
  constructor(env = {}) {
    this.challenges = new Map();
    this.sig = String(env.ATTEST_SIGNATURE || readSignatureFile()).toLowerCase().replace(/[^0-9a-f]/g, '');
    this.roots = [];
    this.revoked = new Set();
    this.rootsFile = env.ATTEST_ROOTS_FILE || '';
    this.status = 'not checked yet';
    this.loadRoots();
    this.timer = setInterval(() => this.refresh(), REFRESH);
    this.timer.unref();
  }

  loadRoots() {
    try {
      const file = this.rootsFile || path.join(__dirname, 'attest-roots.json');
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.roots = list.map((pem) => new crypto.X509Certificate(pem));
    } catch (e) {
      this.roots = [];
    }
  }

  // Google's lists can change. If they can't be fetched, what is here keeps working.
  async refresh() {
    if (this.rootsFile) return;
    try {
      const r = await fetch(ROOTS_URL, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const list = await r.json();
        const certs = list.map((pem) => new crypto.X509Certificate(pem));
        if (certs.length) this.roots = certs;
      }
    } catch (e) {}
    try {
      const r = await fetch(STATUS_URL, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        this.revoked = new Set(Object.keys(j.entries || {}).map((k) => k.toLowerCase().replace(/^0+/, '')));
      }
    } catch (e) {}
  }

  newChallenge(userId) {
    const c = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.exp < now) this.challenges.delete(k);
    this.challenges.set(c, { userId, exp: now + CHALLENGE_TTL });
    return c;
  }

  // Answers { text: what to show the admins, flag?: why it counts against them, score?, notOfficial? }.
  check(userId, a) {
    if (a.err) return { text: `Not available on this phone (${String(a.err).slice(0, 80)})` };
    const c = typeof a.challenge === 'string' ? this.challenges.get(a.challenge) : null;
    if (!c || c.userId !== userId || c.exp < Date.now()) return { text: 'Answer to an old or unknown question', flag: 'The hardware check was answered with a question the server never asked: replayed or made up.', score: 15 };
    this.challenges.delete(a.challenge);
    let certs;
    try {
      if (!Array.isArray(a.chain) || a.chain.length < 2 || a.chain.length > 8) throw new Error('bad chain');
      certs = a.chain.map((b) => new crypto.X509Certificate(Buffer.from(String(b), 'base64')));
    } catch (e) {
      return { text: 'Unreadable answer', flag: 'The hardware check answer is not a real certificate chain.', score: 15 };
    }
    // Every certificate is signed by the next, and the last by a root Google publishes.
    try {
      const now = Date.now();
      for (let i = 0; i < certs.length; i++) {
        const next = certs[i + 1];
        if (next && !certs[i].verify(next.publicKey)) throw new Error('broken chain');
        if (new Date(certs[i].validTo).getTime() < now && i > 0) throw new Error('expired');
        if (this.revoked.has(certs[i].serialNumber.toLowerCase().replace(/^0+/, ''))) throw new Error('revoked');
      }
      const top = certs[certs.length - 1];
      const known = this.roots.length ? this.roots.some((r) => r.fingerprint256 === top.fingerprint256 || top.verify(r.publicKey)) : null;
      if (known === false) throw new Error('not from Google');
    } catch (e) {
      return { text: `Failed: ${e.message}`, flag: `The hardware check failed: ${e.message}. That is what faked attestation looks like, but also what some rooted phones do, so it counts little.`, score: 10 };
    }
    let rec;
    try {
      const ext = extension(certs[0].raw, OID);
      if (!ext) throw new Error('no record');
      rec = parseAttestation(ext);
    } catch (e) {
      return { text: `Unreadable record: ${e.message}` };
    }
    if (rec.challenge.toString('utf8') !== a.challenge) return { text: 'Wrong question answered', flag: 'The hardware check answered a different question than the one asked.', score: 15 };
    const level = ['software only', 'secure hardware', 'StrongBox'][rec.securityLevel] || 'unknown';
    const boot = rec.boot ? (rec.boot.state === 0 && rec.boot.locked ? 'phone unmodified' : 'bootloader unlocked or custom system') : 'boot state unknown';
    if (rec.app) {
      if (!rec.app.names.includes(PACKAGE)) return { text: `${level}, ${boot}, wrong app: ${rec.app.names.join(', ')}`, flag: `The hardware says this is a different app: ${rec.app.names.join(', ').slice(0, 100)}.`, score: 80, notOfficial: true };
      if (this.sig && !rec.app.sigs.includes(this.sig)) return { text: `${level}, ${boot}, not signed by us`, flag: 'The hardware says this copy of the app is not signed with the official key: a modified app.', score: 80, notOfficial: true };
    }
    return { text: `Passed: ${level}, ${boot}, official app` };
  }

  stop() { clearInterval(this.timer); }
}

function readSignatureFile() {
  try { return fs.readFileSync(path.join(__dirname, 'app-signature.txt'), 'utf8').trim(); } catch (e) { return ''; }
}

module.exports = { Attest, parseAttestation, extension, readTlv, OID };
