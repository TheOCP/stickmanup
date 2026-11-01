// Procedural surface detail shared by the three.js materials (worldview.js) and, as a copy, the native
// renderer (NRender.java). pat: 1 metal panels, 2 stone blocks, 3 wood planks. Returns an albedo factor.
export const PATTERN_GLSL = `
float smuHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float smuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(smuHash(i), smuHash(i + vec2(1.0, 0.0)), f.x), mix(smuHash(i + vec2(0.0, 1.0)), smuHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float smuPattern(int pat, vec3 w, vec3 n){
  vec3 an = abs(n);
  vec2 uv = an.y > 0.6 ? w.xz : (an.x > an.z ? w.zy : w.xy);
  if (pat == 1) {
    vec2 g = uv * 0.5, d = abs(fract(g - 0.5) - 0.5);
    vec2 ln = 1.0 - smoothstep(vec2(0.0), fwidth(g) * 1.5 + 0.012, d);
    return (0.84 + 0.24 * smuHash(floor(g))) * (1.0 - 0.5 * max(ln.x, ln.y)) * (0.9 + 0.2 * smuNoise(uv * 3.0));
  }
  if (pat == 2) {
    vec2 g = uv * vec2(0.8, 1.5); g.x += floor(g.y) * 0.5;
    vec2 d = abs(fract(g) - 0.5), fw = fwidth(g) * 1.5;
    float m = max(smoothstep(0.46 - fw.x, 0.46, d.x), smoothstep(0.44 - fw.y, 0.44, d.y));
    float nz = smuNoise(uv * 3.0) * 0.6 + smuNoise(uv * 9.0) * 0.4;
    return (0.82 + 0.22 * smuHash(floor(g))) * (0.82 + 0.3 * nz) * (1.0 - 0.45 * m);
  }
  if (pat == 3) {
    vec2 g = vec2(uv.x * 0.7, uv.y * 3.0);
    float pl = floor(g.y), pn = smuHash(vec2(pl, 7.0));
    float grain = smuNoise(vec2(g.x * 3.0 + pn * 17.0, fract(g.y) * 6.0)) * 0.5 + smuNoise(vec2(g.x * 14.0, g.y * 2.0 + pn)) * 0.5;
    float gap = smoothstep(0.43, 0.5, abs(fract(g.y) - 0.5));
    return (0.72 + 0.36 * pn) * (0.78 + 0.4 * grain) * (1.0 - 0.6 * gap);
  }
  return 1.0;
}
`;
