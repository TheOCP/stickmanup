// The server's check of Android key attestation, with a pretend Google and pretend phones made here with openssl. The format of
// the certificates is as the real thing documents it. Not covered: certificates from a real phone. Usage: node dev/attesttest.js
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Attest } = require('../server/lib/attest');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'smu-att-'));
let failed = 0, passed = 0;
const check = (name, ok, info = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info !== '' ? '  [' + JSON.stringify(info) + ']' : ''}`);
};
const f = (n) => path.join(T, n);
const ssl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'ignore'] });

// ---------------------------------------------------------------- writing the record
const len = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
const tlv = (tag, body) => Buffer.concat([Buffer.from(tag), Buffer.from(len(body.length)), body]);
const seq = (...x) => tlv([0x30], Buffer.concat(x));
const set = (...x) => tlv([0x31], Buffer.concat(x));
const oct = (b) => tlv([0x04], Buffer.from(b));
const int = (n) => tlv([0x02], Buffer.from([n]));
const en = (n) => tlv([0x0a], Buffer.from([n]));
const bool = (b) => tlv([0x01], Buffer.from([b ? 0xff : 0]));
// Context tags over 30 take two bytes: 709 and 704.
const ctx = (hi, lo, body) => tlv([0xbf, hi, lo], body);
const SIG = crypto.createHash('sha256').update('our key').digest();

function record({ challenge, pkg = 'io.stickmanup', sig = SIG, level = 1, locked = true, state = 0, noApp = false }) {
  const app = oct(seq(set(seq(oct(pkg), int(31))), set(oct(sig))));
  const soft = seq(...(noApp ? [] : [ctx(0x85, 0x45, app)]));
  const hard = seq(ctx(0x85, 0x40, seq(oct(Buffer.alloc(32)), bool(locked), en(state), oct(Buffer.alloc(32)))));
  return seq(int(3), en(level), int(3), en(level), oct(challenge), oct(Buffer.alloc(0)), soft, hard);
}

// ---------------------------------------------------------------- pretend certificates
function ca(name) {
  ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', f(`${name}.key`));
  ssl('req', '-x509', '-new', '-key', f(`${name}.key`), '-subj', `/CN=${name}`, '-days', '30', '-out', f(`${name}.crt`));
  return name;
}
let serial = 1000;
function leaf(rootName, der) {
  const n = `leaf${serial++}`;
  ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', f(`${n}.key`));
  ssl('req', '-new', '-key', f(`${n}.key`), '-subj', `/CN=${n}`, '-out', f(`${n}.csr`));
  fs.writeFileSync(f(`${n}.cnf`), der ? `[v3]\n1.3.6.1.4.1.11129.2.1.17=DER:${der.toString('hex')}\n` : '[v3]\nbasicConstraints=CA:FALSE\n');
  ssl('x509', '-req', '-in', f(`${n}.csr`), '-CA', f(`${rootName}.crt`), '-CAkey', f(`${rootName}.key`), '-set_serial', String(serial), '-days', '5', '-extfile', f(`${n}.cnf`), '-extensions', 'v3', '-out', f(`${n}.crt`));
  return n;
}
const b64 = (name) => ssl('x509', '-in', f(`${name}.crt`), '-outform', 'DER').toString('base64');

ca('google');
ca('fake');
fs.writeFileSync(f('roots.json'), JSON.stringify([fs.readFileSync(f('google.crt'), 'utf8')]));
const A = new Attest({ ATTEST_ROOTS_FILE: f('roots.json'), ATTEST_SIGNATURE: SIG.toString('hex') });
const USER = 'user1';
const ask = (opt = {}, root = 'google', topRoot = root) => {
  const challenge = A.newChallenge(USER);
  const n = leaf(root, record(Object.assign({ challenge }, opt)));
  return { challenge, chain: [b64(n), b64(topRoot)] };
};

let r = A.check(USER, ask());
check('a real looking phone passes', /^Passed/.test(r.text) && !r.flag, r);
check('it says what kind of hardware and that the phone is unmodified', /secure hardware/.test(r.text) && /unmodified/.test(r.text), r);
r = A.check(USER, ask({ level: 2 }));
check('StrongBox is named', /StrongBox/.test(r.text), r);
r = A.check(USER, ask({ locked: false, state: 2 }));
check('a rooted phone with an unlocked bootloader passes, and is only described', /^Passed/.test(r.text) && /unlocked/.test(r.text) && !r.flag, r);

r = A.check(USER, ask({ pkg: 'com.evil.copy' }));
check('another app is caught', r.notOfficial && /different app/.test(r.flag) && r.score >= 60, r);
r = A.check(USER, ask({ sig: crypto.randomBytes(32) }));
check('our app re-signed by someone else is caught', r.notOfficial && /not signed with the official key/.test(r.flag), r);

r = A.check(USER, ask({}, 'fake'));
check('a chain from anyone but Google fails', /not from Google|broken chain/.test(r.flag || ''), r);
const a2 = ask();
a2.chain = [a2.chain[0], b64(ca('other'))];
r = A.check(USER, a2);
check('a chain that does not link up fails', !!r.flag, r);

// The question.
const a3 = ask();
check('a good answer passes once', /^Passed/.test(A.check(USER, a3).text));
r = A.check(USER, a3);
check('the same answer again is refused', !!r.flag && /never asked/.test(r.flag), r);
r = A.check(USER, { challenge: 'made-up', chain: a3.chain });
check('an answer to a made up question is refused', !!r.flag, r);
const a4 = ask();
r = A.check('someone else', a4);
check("someone else's question is refused", !!r.flag, r);
const asked = A.newChallenge(USER);
const n5 = leaf('google', record({ challenge: 'a different question' }));
r = A.check(USER, { challenge: asked, chain: [b64(n5), b64('google')] });
check('a certificate for a different question is refused', /different question/.test(r.flag || ''), r);

// Rubbish.
for (const [name, a] of [['no chain', {}], ['a short chain', { chain: ['AAAA'] }], ['not a certificate', { chain: ['AAAA', 'BBBB'] }], ['numbers', { chain: [1, 2] }], ['a huge chain', { chain: Array(50).fill('AAAA') }]]) {
  r = A.check(USER, Object.assign({ challenge: A.newChallenge(USER) }, a));
  check(`${name} is handled`, !!r.flag && !/^Passed/.test(r.text), r);
}
const noExt = leaf('google', null);
r = A.check(USER, { challenge: A.newChallenge(USER), chain: [b64(noExt), b64('google')] });
check('a certificate with no record proves nothing and passes nothing', !/^Passed/.test(r.text), r);
const c6 = A.newChallenge(USER);
const n6 = leaf('google', seq(int(1), oct(Buffer.from('short'))));
r = A.check(USER, { challenge: c6, chain: [b64(n6), b64('google')] });
check('a broken record does not crash it', !/^Passed/.test(r.text), r);
r = A.check(USER, { err: 'NoSuchMethodException' });
check('a phone that can not do it is not held against anyone', !r.flag && /Not available/.test(r.text), r);

// Revoked keys.
const a7 = ask();
const leafSerial = new crypto.X509Certificate(Buffer.from(a7.chain[0], 'base64')).serialNumber;
A.revoked.add(leafSerial.toLowerCase().replace(/^0+/, ''));
r = A.check(USER, a7);
check('a key Google has revoked fails', /revoked/.test(r.flag || ''), r);
A.revoked.clear();

// The real roots shipped with the server load.
const real = new Attest({});
check('the real Google roots are there', real.roots.length >= 1 && real.roots.every((c) => /[A-F0-9:]+/.test(c.fingerprint256)), real.roots.length);
check('and the real app signature', /^[0-9a-f]{64}$/.test(real.sig), real.sig);
A.stop();
real.stop();
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
