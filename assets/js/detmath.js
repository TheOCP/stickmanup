// The math functions the climb depends on, giving the same answer to the last bit on every phone and server. The built in
// ones are written in C++, and how a compiler rounds them differs between processors and browser builds by a tiny amount.
// The server reruns a climb exactly as the phone played it, so that tiny amount matters. These are the classic fdlibm
// methods written out in plain JavaScript, where the language itself fixes every result. Load this before anything else.
const nativeSin = Math.sin, nativeCos = Math.cos;

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const INV_PIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO4 = 7.85398163397448278999e-01, BIG = 1e6;

function ksin(x, y) {
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kcos(x, y) {
  const z = x * x, hz = 0.5 * z, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))), w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

function sin(x) {
  x = +x;
  const a = x < 0 ? -x : x;
  if (a <= PIO4) return a === 0 ? x : ksin(x, 0);
  if (!(a < BIG)) return nativeSin(x);
  const n = Math.round(x * INV_PIO2), r = x - n * PIO2_1, w = n * PIO2_1T, y0 = r - w, y1 = (r - y0) - w;
  switch (((n % 4) + 4) % 4) {
    case 0: return ksin(y0, y1);
    case 1: return kcos(y0, y1);
    case 2: return -ksin(y0, y1);
    default: return -kcos(y0, y1);
  }
}
function cos(x) {
  x = +x;
  const a = x < 0 ? -x : x;
  if (a <= PIO4) return kcos(x, 0);
  if (!(a < BIG)) return nativeCos(x);
  const n = Math.round(x * INV_PIO2), r = x - n * PIO2_1, w = n * PIO2_1T, y0 = r - w, y1 = (r - y0) - w;
  switch (((n % 4) + 4) % 4) {
    case 0: return kcos(y0, y1);
    case 1: return -ksin(y0, y1);
    case 2: return -kcos(y0, y1);
    default: return ksin(y0, y1);
  }
}

const AHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ALO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const T0 = 3.33333333333329318027e-01, T1 = -1.99999999998764832476e-01, T2 = 1.42857142725034663711e-01, T3 = -1.11111104054623557880e-01,
  T4 = 9.09088713343650656196e-02, T5 = -7.69187620504482999495e-02, T6 = 6.66107313738753120669e-02, T7 = -5.83357013379057348645e-02,
  T8 = 4.97687799461593236017e-02, T9 = -3.65315727442169155270e-02, T10 = 1.62858201153657823623e-02;
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PIO2 = 1.5707963267948966;

function atan(v) {
  if (v !== v) return v;
  const neg = v < 0;
  let x = neg ? -v : v, id = -1;
  if (x >= 7.378697629483821e+19) return neg ? -(AHI[3] + ALO[3]) : AHI[3] + ALO[3];
  if (x < 0.4375) {
    if (x < 1.862645149230957e-09) return v;
    x = v;
  } else if (x < 1.1875) {
    if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
  } else if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  const z = x * x, w = z * z;
  const s1 = z * (T0 + w * (T2 + w * (T4 + w * (T6 + w * (T8 + w * T10))))), s2 = w * (T1 + w * (T3 + w * (T5 + w * (T7 + w * T9))));
  if (id < 0) return x - x * (s1 + s2);
  const r = AHI[id] - ((x * (s1 + s2) - ALO[id]) - x);
  return neg ? -r : r;
}

function atan2(y, x) {
  y = +y; x = +x;
  if (x !== x || y !== y) return NaN;
  if (x === 1) return atan(y);
  const yn = y < 0 || (y === 0 && 1 / y < 0), xn = x < 0 || (x === 0 && 1 / x < 0);
  if (y === 0) return xn ? (yn ? -PI : PI) : y;
  if (x === 0) return yn ? -PIO2 : PIO2;
  const ax = xn ? -x : x, ay = yn ? -y : y;
  if (ax === Infinity) {
    if (ay === Infinity) { const q = xn ? 3 * PI / 4 : PI / 4; return yn ? -q : q; }
    return xn ? (yn ? -PI : PI) : (yn ? -0 : 0);
  }
  if (ay === Infinity) return yn ? -PIO2 : PIO2;
  const k = ay / ax;
  let z;
  if (k > 1.152921504606847e+18) { z = PIO2 + 0.5 * PI_LO; return yn ? -z : z; }
  if (xn && k < 8.673617379884035e-19) z = 0;
  else z = atan(k);
  if (!xn) return yn ? -z : z;
  return yn ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

const asin = (x) => atan2(x, Math.sqrt((1 - x) * (1 + x)));
const acos = (x) => atan2(Math.sqrt((1 - x) * (1 + x)), x);
// Square root is exact on every processor. Written this way it is also a good deal quicker than the built in one.
function hypot(a, b, c) {
  a = +a; b = +b;
  if (c === undefined) return Math.sqrt(a * a + b * b);
  c = +c;
  return Math.sqrt(a * a + b * b + c * c);
}

Math.sin = sin;
Math.cos = cos;
Math.atan2 = atan2;
Math.asin = asin;
Math.acos = acos;
Math.hypot = hypot;
export { sin, cos, atan2, asin, acos, hypot };
