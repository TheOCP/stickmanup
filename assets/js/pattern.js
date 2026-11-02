// Procedural surface detail shared by the three.js materials (worldview.js) and, as a copy, the native
// renderer (NRender.java, regenerated from this file by dev/sync_pattern.py). Returns a colour factor that
// multiplies the material colour. pat: 1 metal panels, 2 stone blocks, 3 wood planks, 4 hex tiles,
// 5 grass on rock, 6 sand on rock, 7 basalt, 8 tread plate, 9 bamboo, 10 marble, 11 coral, 12 concrete,
// 13 moss on wet stone, 14 snow on rock, 15 cloud, 16 bark.
export const PATTERN_GLSL = `
float smuHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float smuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(smuHash(i), smuHash(i + vec2(1.0, 0.0)), f.x), mix(smuHash(i + vec2(0.0, 1.0)), smuHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float smuFbm(vec2 p){ return smuNoise(p) * 0.65 + smuNoise(p * 2.3 + 7.1) * 0.35; }
float smuHex(vec2 p){
  vec2 r = vec2(1.0, 1.732), h = r * 0.5, a = mod(p, r) - h, b = mod(p - h, r) - h, g = dot(a, a) < dot(b, b) ? a : b;
  return max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));
}
vec3 smuPattern(int pat, vec3 w, vec3 n){
  vec3 an = abs(n);
  vec2 uv = an.y > 0.6 ? w.xz : (an.x > an.z ? w.zy : w.xy);
  if (pat == 1) {
    vec2 g = uv * 0.5, d = abs(fract(g - 0.5) - 0.5);
    vec2 ln = 1.0 - smoothstep(vec2(0.0), fwidth(g) * 1.5 + 0.012, d);
    return vec3((0.84 + 0.24 * smuHash(floor(g))) * (1.0 - 0.5 * max(ln.x, ln.y)) * (0.9 + 0.2 * smuNoise(uv * 3.0)));
  }
  if (pat == 2) {
    vec2 g = uv * vec2(0.8, 1.5); g.x += floor(g.y) * 0.5;
    vec2 d = abs(fract(g) - 0.5), fw = fwidth(g) * 1.5;
    float m = max(smoothstep(0.46 - fw.x, 0.46, d.x), smoothstep(0.44 - fw.y, 0.44, d.y));
    float nz = smuNoise(uv * 3.0) * 0.6 + smuNoise(uv * 9.0) * 0.4;
    return vec3((0.82 + 0.22 * smuHash(floor(g))) * (0.82 + 0.3 * nz) * (1.0 - 0.45 * m));
  }
  if (pat == 3) {
    vec2 g = vec2(uv.x * 0.7, uv.y * 3.0);
    float pl = floor(g.y), pn = smuHash(vec2(pl, 7.0));
    float grain = smuNoise(vec2(g.x * 3.0 + pn * 17.0, fract(g.y) * 6.0)) * 0.5 + smuNoise(vec2(g.x * 14.0, g.y * 2.0 + pn)) * 0.5;
    float gap = smoothstep(0.43, 0.5, abs(fract(g.y) - 0.5));
    return vec3((0.72 + 0.36 * pn) * (0.78 + 0.4 * grain) * (1.0 - 0.6 * gap));
  }
  if (pat == 4) {
    vec2 p = uv * 1.4;
    float e = smuHex(p), line = smoothstep(0.4, 0.47, e);
    return vec3((0.84 + 0.16 * smuNoise(uv * 5.0)) * (1.0 - 0.45 * line));
  }
  if (pat == 5 || pat == 6 || pat == 13 || pat == 14) {
    // Only work out the part this pixel shows: the rock on the sides, the coat on top (both near the edge).
    float k = smoothstep(0.35, 0.75, n.y);
    vec3 rock = vec3(0.0), coat = vec3(0.0);
    if (k < 0.999) {
      float nz = smuFbm(uv * 1.3);
      rock = (pat == 14 ? vec3(0.6, 0.66, 0.76) : pat == 6 ? vec3(0.88, 0.72, 0.52) : vec3(0.58, 0.54, 0.48)) * (0.72 + 0.42 * nz) * (0.86 + 0.14 * sin(w.y * 3.0 + nz * 4.0));
      if (pat == 13) rock = mix(rock, vec3(0.28, 0.52, 0.24), smoothstep(0.5, 0.72, smuNoise(uv * 0.9 + 5.0)) * 0.75);
    }
    if (k > 0.001) {
      float cn = smuNoise(uv * (pat == 6 ? 6.0 : 3.0));
      coat = pat == 5 ? vec3(0.36, 0.68, 0.24) * (0.78 + 0.42 * cn)
           : pat == 6 ? vec3(0.96, 0.87, 0.62) * (0.88 + 0.2 * cn)
           : pat == 13 ? vec3(0.3, 0.6, 0.28) * (0.72 + 0.48 * cn)
           : vec3(0.95, 0.97, 1.0) * (0.92 + 0.1 * cn);
    }
    return mix(rock, coat, k);
  }
  if (pat == 7) {
    float nz = smuNoise(uv * 4.0);
    vec3 c = vec3(0.5, 0.45, 0.44) * (0.78 + 0.38 * nz);
    if (an.y > 0.6) c *= 1.0 - 0.5 * smoothstep(0.38, 0.46, smuHex(uv * 2.2));
    else c *= 1.0 - 0.35 * smoothstep(0.44, 0.5, abs(fract(uv.x * 2.3) - 0.5));
    return c;
  }
  if (pat == 8) {
    vec2 g = uv * 3.5, f = fract(g) - 0.5;
    vec2 d = mod(floor(g.x) + floor(g.y), 2.0) > 0.5 ? f : f.yx;
    float dash = (1.0 - smoothstep(0.06, 0.12, abs(d.x))) * (1.0 - smoothstep(0.26, 0.32, abs(d.y)));
    vec2 seam = abs(fract(uv * 0.5 - 0.5) - 0.5);
    float s = 1.0 - smoothstep(0.0, 0.02, min(seam.x, seam.y));
    return vec3((0.76 + 0.14 * smuNoise(uv * 6.0)) * (1.0 + 0.35 * dash) * (1.0 - 0.4 * s));
  }
  if (pat == 9) {
    float g = uv.x * 4.0, s = abs(fract(g) - 0.5) * 2.0;
    float node = smoothstep(0.92, 0.98, abs(fract(uv.y * 0.9 + smuHash(vec2(floor(g), 2.0))) - 0.5) * 2.0);
    return vec3(0.9, 0.82, 0.55) * (1.0 - 0.35 * s * s) * (1.0 - 0.35 * node) * (0.9 + 0.15 * smuNoise(vec2(g * 2.0, uv.y * 6.0)));
  }
  if (pat == 10) {
    float v = abs(sin(uv.x * 1.1 + uv.y * 0.6 + smuFbm(uv * 1.4) * 5.0));
    float vein = 1.0 - smoothstep(0.0, 0.07, v);
    vec2 t = abs(fract(uv * 0.45) - 0.5);
    float seam = 1.0 - smoothstep(0.0, 0.015, 0.5 - max(t.x, t.y));
    return mix(vec3(0.96, 0.95, 0.93) * (0.94 + 0.08 * smuNoise(uv * 3.0)), vec3(0.62, 0.66, 0.72), vein * 0.7) * (1.0 - 0.35 * seam);
  }
  if (pat == 11) {
    vec2 g = uv * 4.5, f = fract(g) - 0.5;
    float pore = (1.0 - smoothstep(0.12, 0.2, length(f))) * step(0.45, smuHash(floor(g)));
    return vec3(1.0, 0.64, 0.56) * (0.78 + 0.32 * smuFbm(uv * 2.0)) * (1.0 - 0.45 * pore);
  }
  if (pat == 12) {
    vec2 t = abs(fract(uv * 0.5) - 0.5);
    float seam = 1.0 - smoothstep(0.0, 0.012, 0.5 - max(t.x, t.y));
    float stain = smoothstep(0.55, 0.8, smuFbm(uv * 0.7 + 3.0));
    return vec3((0.82 + 0.16 * smuNoise(uv * 5.0)) * (1.0 - 0.25 * stain) * (1.0 - 0.4 * seam));
  }
  if (pat == 15) return mix(vec3(0.86, 0.9, 1.0), vec3(1.0), smoothstep(-0.3, 0.6, n.y)) * (0.93 + 0.08 * smuNoise(uv * 2.0));
  if (pat == 16) {
    vec2 g = vec2(uv.x * 7.0, uv.y * 0.7);
    float fib = smuNoise(g) * 0.6 + smuNoise(g * vec2(1.0, 3.0) + 5.0) * 0.4;
    float crack = smoothstep(0.62, 0.7, smuNoise(vec2(uv.x * 3.0, uv.y * 0.3)));
    return vec3(1.0, 0.88, 0.74) * (0.66 + 0.42 * fib) * (1.0 - 0.4 * crack);
  }
  return vec3(1.0);
}
`;
