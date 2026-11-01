// Renderer, post-processing and the storm itself: sky, ocean, rain, lightning and lights.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/EffectComposer.js';
import { RenderPass } from 'three/addons/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/OutputPass.js';
import { Mirror } from './mirror.js';

export const QUALITY = {
  low: { dpr: 1.0, bloom: false, shadow: 0, rain: 1200, ocean: 72, samples: 0 },
  high: { dpr: 1.5, bloom: true, shadow: 1024, rain: 2600, ocean: 128, samples: 4 },
  ultra: { dpr: 2.0, bloom: true, shadow: 2048, rain: 4200, ocean: 192, samples: 4 },
};

const BOLT_PTS = 15;

// Look of each map: sky, sun, sea, lights, rain and glow. Fog colours come from the level's zones.
const THEMES = {
  storm: { key: 'storm', top: 0x0d1426, glow: 0xffd890, day: 0, sun: 0, sunCol: 0xffe2b0, cloud: 1, horK: 1.6, seaK: 1.8, hemiSky: 0x8a98c8, hemiGround: 0x141824,
    hemi: 0.6, light: 0xb8c4ff, lightI: 1.15, dir: [0.45, 1, 0.3], deep: 0x03080c, shallow: 0x03080c, shallowR: 0, rain: 1, fog: 0.0085, exposure: 1.1, bloom: [0.9, 0.5, 0.62] },
  sunny: { key: 'sunny', top: 0x2f7fd0, glow: 0xfff2c0, day: 1, sun: 1, sunCol: 0xfff0d2, cloud: 0.55, horK: 1.0, seaK: 0.75, hemiSky: 0xcfe8ff, hemiGround: 0xd8c39a,
    hemi: 1.15, light: 0xfff2de, lightI: 2.7, dir: [0.55, 0.75, 0.38], deep: 0x0b4f78, shallow: 0x37d6c6, shallowR: 70, rain: 0, fog: 0.0036, exposure: 1.0, bloom: [0.32, 0.4, 0.95] },
  forest: { key: 'forest', top: 0x4a7f9a, glow: 0xffe8b0, day: 0.8, sun: 0.75, sunCol: 0xffd49a, cloud: 0.7, horK: 1.05, seaK: 0.8, hemiSky: 0xb9d9c4, hemiGround: 0x3c4a2a,
    hemi: 1.05, light: 0xffe2b4, lightI: 2.1, dir: [-0.5, 0.62, 0.45], deep: 0x082624, shallow: 0x1f5a48, shallowR: 110, rain: 0, fog: 0.0072, exposure: 1.05, bloom: [0.6, 0.45, 0.78] },
  // Inside a volcano: light from the opening above, glow from the lava lake below (the "sea" is lava).
  volcano: { key: 'volcano', top: 0x1c0806, glow: 0xff8a3a, day: 0.25, sun: 0, sunCol: 0xff8040, cloud: 0.85, horK: 1.3, seaK: 0.35, hemiSky: 0xffb08a, hemiGround: 0xff5a20,
    hemi: 1.0, light: 0xffb88a, lightI: 1.3, dir: [0.2, 1, 0.1], deep: 0xff4a10, deepK: 2.4, shallow: 0xff4a10, shallowR: 0, rain: 0, fog: 0.008, exposure: 1.05, bloom: [1.0, 0.55, 0.7] },
  // A city at sunset: low orange sun, purple sky, a dark bay.
  city: { key: 'city', top: 0x221a4a, glow: 0xff9a6a, day: 0.55, sun: 0.65, sunCol: 0xff8a5a, cloud: 0.5, horK: 1.15, seaK: 0.9, hemiSky: 0xb0a0e0, hemiGround: 0x302040,
    hemi: 0.95, light: 0xffa070, lightI: 1.7, dir: [0.7, 0.2, 0.4], deep: 0x0a1630, shallow: 0x0a1630, shallowR: 0, rain: 0, fog: 0.0045, exposure: 1.05, bloom: [0.8, 0.5, 0.72] },
};

const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }`;

// GPU names that need care. Pixel 10 (PowerVR D-Series) drivers crash when WebGL programs are deleted
// at runtime and fail at large render sizes, so on these GPUs the canvas stays under ~0.7 megapixels.
const POWERVR = /powervr|imagination|img-?tec/i;

export class Renderer {
  // Built once per app launch and never torn down: on some phone GPUs, deleting shader programs, render
  // targets or the context crashes the driver. Changing quality restarts the app instead.
  // Graphics levels, each one adding to the previous (the Android watchdog steps up after a failure):
  // 0 full · 1 no glow, canvas kept off hardware overlays · 2 no shadows, smaller · 3 plain materials,
  // no rain · 4 bare minimum (no sky/ocean shaders, no bolts).
  // sendNative: when given, nothing is drawn here; the scene is mirrored to Android's own OpenGL renderer
  // (WebView WebGL is unreliable on some phones, e.g. Pixel 10 / PowerVR). Without it, three.js draws.
  constructor(canvas, q, safe = 0, sendNative = null) {
    this.safe = safe;
    const base = QUALITY[q] || QUALITY.high, bloom = base.bloom && safe < 1;
    this.canvas = canvas;
    this.lost = false;
    this.onLost = null;
    if (sendNative) {
      this.native = true;
      this.r = null;
      this.mirror = new Mirror(sendNative);
      this.gpu = 'native';
      this.powervr = false;
      canvas.style.display = 'none';
      document.body.classList.add('native');
    } else {
      // An alpha canvas with a hair of CSS transparency is composited normally instead of being promoted
      // to a hardware overlay plane, which some phones show as a blank white layer.
      if (safe >= 1) canvas.style.opacity = '0.995';
      // With bloom the scene is drawn into an offscreen buffer, so canvas antialiasing would be wasted memory.
      this.r = new THREE.WebGLRenderer({ canvas, antialias: !bloom && safe < 2, alpha: safe >= 1, powerPreference: safe >= 2 ? 'default' : 'high-performance' });
      this.r.outputColorSpace = THREE.SRGBColorSpace;
      this.r.toneMapping = THREE.ACESFilmicToneMapping;
      this.r.toneMappingExposure = 1.1;
      this.r.shadowMap.type = THREE.PCFSoftShadowMap;
      const gl = this.r.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'unknown');
      this.powervr = POWERVR.test(this.gpu);
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
        if (this.onLost) this.onLost();
      });
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2600);
    this.fogCol = new THREE.Color(0x0b1820);
    this.scene.fog = new THREE.FogExp2(this.fogCol.getHex(), 0.0085);
    this.scene.background = this.fogCol.clone();
    this.flashV = 0;
    this.t = 0;
    this.eye = 0;
    this.theme = THEMES.storm;
    // Player picture settings: sharpening 0..1, edge anti-aliasing on/off, glow strength multiplier.
    this.look = { sharp: 0.35, aa: true, glow: 1 };

    this.hemi = new THREE.HemisphereLight(0x8a98c8, 0x141824, 0.6);
    this.moon = new THREE.DirectionalLight(0xb8c4ff, 1.15);
    this.moonDir = new THREE.Vector3(0.45, 1, 0.3).normalize();
    this.scene.add(this.hemi, this.moon, this.moon.target);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.near = 1; sc.far = 140;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.04;

    this.makeSky();
    this.makeOcean(q);
    this.makeRain(q);
    this.makeBolts();
    if (safe >= 3) this.rain.visible = false;
    if (safe >= 4) {
      this.sky.visible = false;
      this.ocean.material = new THREE.MeshBasicMaterial({ color: 0x06111a });
    }
    this.setup(q);
  }

  // One-time pipeline setup for this launch.
  setup(name) {
    const q = Object.assign({}, QUALITY[name] || QUALITY.high), L = this.safe;
    if (L >= 1 || this.powervr) q.samples = 0;
    if (L >= 1) q.bloom = false;
    if (L >= 2 || this.native) q.shadow = 0;
    this.q = q;
    if (this.native) {
      this.rain.geometry.setDrawRange(0, q.rain * 2);
      this.resize();
      return;
    }
    // Megapixel budget for the drawing buffer; DPR is derived from it and the screen size.
    this.maxPx = (this.powervr ? [0.6, 0.5, 0.35, 0.25, 0.2] : [2.4, 1.5, 0.8, 0.5, 0.3])[Math.min(L, 4)] * 1e6;
    this.r.shadowMap.enabled = q.shadow > 0;
    this.moon.castShadow = q.shadow > 0;
    if (q.shadow) this.moon.shadow.mapSize.set(q.shadow, q.shadow);
    this.rain.geometry.setDrawRange(0, q.rain * 2);
    if (q.bloom) {
      // HDR buffer when the GPU can render to half floats, plain 8-bit otherwise (bloom still works).
      const ext = this.r.extensions, hdr = !this.powervr && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: q.samples });
      this.composer = new EffectComposer(this.r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.42, 0.88);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    if (this.native) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      return;
    }
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.q.dpr, Math.sqrt(this.maxPx / (w * h))));
    this.r.setPixelRatio(dpr);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
      // Bloom at half resolution keeps phones cool.
      this.bloom.resolution.set(w / 2, h / 2);
    }
  }

  makeSky() {
    this.skyU = {
      uTime: { value: 0 }, uFlash: { value: 0 }, uEye: { value: 0 },
      uTop: { value: new THREE.Color(0x0d1426) }, uHor: { value: new THREE.Color(0x1b2a3a) }, uGlow: { value: new THREE.Color(0xffd890) },
      uSunDir: { value: new THREE.Vector3(0.45, 1, 0.3).normalize() }, uSunCol: { value: new THREE.Color(0xffe2b0) }, uSun: { value: 0 }, uCloud: { value: 1 }, uDay: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime, uFlash, uEye, uSun, uCloud, uDay; uniform vec3 uTop, uHor, uGlow, uSunDir, uSunCol; varying vec3 vDir; ${NOISE}
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = mix(uHor, uTop, smoothstep(-0.05, 0.55, h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunCol * pow(sd, 8.0) * 0.25 * uSun;
          vec2 uv = d.xz / (abs(h) + 0.22) * 1.3;
          float c = fbm(uv + vec2(uTime * 0.012, uTime * 0.007));
          float c2 = fbm(uv * 2.4 - vec2(uTime * 0.025, 0.0));
          float cloud = smoothstep(0.32 + (1.0 - uCloud) * 0.32, 0.86, c * 0.75 + c2 * 0.4);
          vec3 cc = mix(uHor * 0.55, uTop * 1.9 + vec3(0.035, 0.04, 0.06), c2);
          // Daylight clouds: bright tops, soft grey bellies, a silver lining toward the sun.
          vec3 dc = mix(vec3(0.62, 0.68, 0.78), vec3(1.05, 1.04, 1.02), c2) + uSunCol * pow(sd, 6.0) * 0.6;
          cc = mix(cc, dc, uDay);
          col += uSunCol * (pow(sd, 1400.0) * 40.0 + pow(sd, 90.0) * 1.2) * uSun * (1.0 - cloud * 0.85);
          col = mix(col, cc, cloud * smoothstep(-0.25, 0.12, h));
          col += uFlash * (0.15 + cloud * 0.7) * vec3(0.55, 0.62, 1.0) * smoothstep(-0.15, 0.3, h);
          float eye = uEye > 0.001 ? smoothstep(1.0 - 0.32 * uEye, 1.0 - 0.06 * uEye, h) * uEye : 0.0;
          col = mix(col, uGlow * 1.4, eye * (1.0 - cloud * 0.5));
          col += uGlow * pow(max(h, 0.0), 6.0) * uEye * 0.45;
          col = mix(col, uHor * 0.75, 1.0 - smoothstep(-0.35, 0.0, h));
          gl_FragColor = vec4(clamp(col, 0.0, 20.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), m);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  makeOcean(q) {
    const n = QUALITY[q] ? QUALITY[q].ocean : 128;
    const g = new THREE.PlaneGeometry(1600, 1600, n, n);
    g.rotateX(-Math.PI / 2);
    this.oceanU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlash: { value: 0 }, uDeep: { value: new THREE.Color(0x03080c) }, uSky: { value: new THREE.Color(0x1d3040) },
      uShallow: { value: new THREE.Color(0x03080c) }, uShallowR: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.45, 1, 0.3).normalize() },
      uSunCol: { value: new THREE.Color(0xffe2b0) }, uSun: { value: 0 },
    }]);
    const m = new THREE.ShaderMaterial({
      uniforms: this.oceanU, fog: true,
      vertexShader: `#include <fog_pars_vertex>
        uniform float uTime; varying vec3 vW; varying vec3 vN; varying float vH;
        // Height plus its x/z slope, so the normal is exact and never degenerate (no screen derivatives).
        vec3 wv(vec2 p, vec2 d, float f, float s, float a){
          d = normalize(d); float ph = dot(p, d) * f + uTime * s;
          return vec3(a * sin(ph), a * f * cos(ph) * d);
        }
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec3 h = wv(w.xz, vec2(1.0, 0.3), 0.07, 1.0, 1.1) + wv(w.xz, vec2(-0.4, 1.0), 0.12, 1.5, 0.6)
                 + wv(w.xz, vec2(0.7, -0.6), 0.26, 2.2, 0.25) + wv(w.xz, vec2(0.2, 0.98), 0.55, 3.1, 0.1);
          w.y += h.x; vH = h.x; vW = w.xyz; vN = vec3(-h.y, 1.0, -h.z);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform float uFlash, uShallowR, uSun; uniform vec3 uDeep, uSky, uShallow, uSunDir, uSunCol; varying vec3 vW; varying vec3 vN; varying float vH;
        void main(){
          vec3 n = normalize(vN);
          vec3 v = normalize(cameraPosition - vW + vec3(0.0, 1e-3, 0.0));
          float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          vec3 deep = uDeep;
          if (uShallowR > 0.0) deep = mix(uShallow, uDeep, smoothstep(uShallowR * 0.55, uShallowR * 1.6, length(vW.xz)));
          vec3 col = mix(deep, uSky, fr * 0.9 + 0.05);
          vec3 hv = normalize(uSunDir + v);
          col += uSunCol * (pow(max(dot(n, hv), 0.0), 260.0) * 7.0 + pow(max(dot(n, hv), 0.0), 24.0) * 0.12) * uSun;
          col += vec3(0.5, 0.7, 0.75) * smoothstep(0.9, 1.6, vH) * 0.25;
          col += uFlash * vec3(0.5, 0.6, 1.0) * (0.1 + fr * 0.6);
          gl_FragColor = vec4(clamp(col, 0.0, 20.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(g, m);
    this.ocean.frustumCulled = false;
    this.scene.add(this.ocean);
  }

  makeRain() {
    const N = QUALITY.ultra.rain;
    const seed = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      seed.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(3, 1) }, uAmt: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; attribute vec3 aSeed; attribute float aEnd; varying float vA;
        void main(){
          vec3 box = vec3(46.0, 36.0, 46.0);
          vec3 vel = vec3(uWind.x, -26.0, uWind.y);
          vec3 p = aSeed * box + vel * uTime;
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          p -= vel * 0.03 * aEnd;
          vA = 1.0 - aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uAmt; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55, 0.65, 0.8) * (0.1 + 0.2 * vA) * uAmt, 1.0); }`,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  // Lightning uses a fixed pool of meshes that are drawn once at startup (so their shader exists early)
  // and then only moved and shown, never created or deleted mid-game.
  makeBolts() {
    const P = BOLT_PTS, RS = 5, idx = [];
    for (let i = 0; i < P - 1; i++) {
      for (let r = 0; r < RS; r++) {
        const a = i * RS + r, b = i * RS + ((r + 1) % RS);
        idx.push(a, a + RS, b, b, a + RS, b + RS);
      }
    }
    this.boltPool = [];
    for (let k = 0; k < 6; k++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * RS * 3), 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.6, 5.0), fog: false, transparent: true, opacity: 0, depthWrite: false }));
      m.material.userData.live = true;
      m.frustumCulled = false;
      this.scene.add(m);
      this.boltPool.push({ mesh: m, life: 0 });
    }
    this.warm = 3;
  }

  // Lightning bolt from the clouds down to a point.
  bolt(x, y, z, big = 1) {
    if (this.safe >= 4) return this.flash(0.4 * big);
    let b = this.boltPool[0];
    for (const c of this.boltPool) if (c.life < b.life) b = c;
    const P = BOLT_PTS, RS = 5, R = 0.14 * big, pts = [];
    const sx = x + (Math.random() - 0.5) * 30, sy = y + 90 + Math.random() * 40, sz = z + (Math.random() - 0.5) * 30;
    for (let i = 0; i < P; i++) {
      const t = i / (P - 1), j = i && i < P - 1 ? 7 : 0;
      pts.push([sx + (x - sx) * t + (Math.random() - 0.5) * j, sy + (y - sy) * t, sz + (z - sz) * t + (Math.random() - 0.5) * j]);
    }
    const pos = b.mesh.geometry.attributes.position.array;
    for (let i = 0; i < P; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(P - 1, i + 1)];
      let tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // Ring frame: n = t x X (bolts are mostly vertical), b = t x n.
      let nx = 0, ny = tz, nz = -ty;
      const nl = Math.hypot(ny, nz) || 1;
      ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let r = 0; r < RS; r++) {
        const an = (r / RS) * Math.PI * 2, co = Math.cos(an) * R, si = Math.sin(an) * R, k = (i * RS + r) * 3;
        pos[k] = pts[i][0] + nx * co + bx * si; pos[k + 1] = pts[i][1] + ny * co + by * si; pos[k + 2] = pts[i][2] + nz * co + bz * si;
      }
    }
    b.mesh.geometry.attributes.position.needsUpdate = true;
    b.mesh.visible = true;
    b.life = 0.28;
    this.flash(0.5 * big);
  }

  // Switches the whole look to a map (storm, sunny or forest).
  setTheme(key) {
    const T = (this.theme = THEMES[key] || THEMES.storm), S = this.skyU, O = this.oceanU;
    S.uTop.value.setHex(T.top);
    S.uGlow.value.setHex(T.glow);
    S.uSunCol.value.setHex(T.sunCol);
    S.uSun.value = T.sun;
    S.uCloud.value = T.cloud;
    S.uDay.value = T.day;
    this.moonDir.set(T.dir[0], T.dir[1], T.dir[2]).normalize();
    S.uSunDir.value.copy(this.moonDir);
    O.uSunDir.value.copy(this.moonDir);
    O.uSunCol.value.setHex(T.sunCol);
    O.uSun.value = T.sun;
    O.uDeep.value.setHex(T.deep).multiplyScalar(T.deepK || 1);
    O.uShallow.value.setHex(T.shallow);
    O.uShallowR.value = T.shallowR;
    this.hemi.color.setHex(T.hemiSky);
    this.hemi.groundColor.setHex(T.hemiGround);
    this.scene.fog.density = T.fog;
    this.rain.visible = T.rain > 0 && this.safe < 3;
    if (this.r) this.r.toneMappingExposure = T.exposure;
    if (this.bloom) { this.bloom.strength = T.bloom[0]; this.bloom.radius = T.bloom[1]; this.bloom.threshold = T.bloom[2]; }
  }

  flash(v) {
    this.flashV = Math.max(this.flashV, v);
  }

  // Per-frame storm animation. zone carries fog and accent colours, eye opens toward the summit.
  update(dt, cam, zone, eye, wind) {
    this.t += dt;
    const fl = this.flashV * (0.75 + 0.25 * Math.sin(this.t * 60));
    this.flashV *= Math.exp(-dt * 6);
    this.skyU.uTime.value = this.t;
    this.skyU.uFlash.value = fl;
    this.eye += (eye - this.eye) * Math.min(1, dt * 0.8);
    this.skyU.uEye.value = this.eye;
    this.oceanU.uTime.value = this.t;
    this.oceanU.uFlash.value = fl;
    this.rainU.uTime.value = this.t;
    this.rainU.uCam.value.copy(cam);
    this.rainU.uWind.value.set(3 + wind.x * 0.6, 1 + wind.z * 0.6);
    this.rainU.uAmt.value = 1 - this.eye * 0.75;
    const TH = this.theme, E = TH.key === 'storm' ? this.eye : 0;

    if (zone) {
      const target = new THREE.Color(zone.fog);
      this.fogCol.lerp(target, Math.min(1, dt * 0.7));
      this.scene.fog.color.copy(this.fogCol);
      this.scene.background.copy(this.fogCol);
      this.skyU.uHor.value.copy(this.fogCol).multiplyScalar(TH.horK);
      this.oceanU.uSky.value.copy(this.fogCol).multiplyScalar(TH.seaK);
    }
    this.skyU.uEye.value = E;
    this.hemi.intensity = TH.hemi + fl * 1.4 + E * 0.6;
    this.moon.intensity = TH.lightI + fl * 1.8 + E * 0.9;
    this.moon.color.setHex(TH.light);
    if (E > 0) this.moon.color.lerp(this.eyeCol || (this.eyeCol = new THREE.Color(0xffe2b0)), E);

    this.sky.position.copy(cam);
    this.ocean.position.set(Math.round(cam.x / 20) * 20, 0, Math.round(cam.z / 20) * 20);
    this.moon.target.position.copy(cam);
    this.moon.position.copy(cam).addScaledVector(this.moonDir, 70);

    if (this.warm > 0) this.warm--;
    for (const b of this.boltPool) {
      if (b.life > 0) b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.28) * (Math.random() < 0.3 ? 0.4 : 1);
      b.mesh.visible = b.life > 0 || this.warm > 0;
    }
  }

  // Shadows only need to cover the area around the local robot.
  shadowFocus(x, y, z) {
    this.moon.target.position.set(x, y, z);
    this.moon.position.set(x, y, z).addScaledVector(this.moonDir, 70);
  }

  render() {
    if (this.composer) this.composer.render();
    else if (this.native) this.mirror.sync(this.scene, this.camera, this.env());
    else this.r.render(this.scene, this.camera);
  }

  // Lights, fog and post settings for the native renderer (layout matches NRender.env).
  env() {
    const f = this.scene.fog, hs = this.hemi.color, hg = this.hemi.groundColor, mc = this.moon.color;
    const d = this.moon.position.clone().sub(this.moon.target.position).normalize();
    return [f.color.r, f.color.g, f.color.b, f.density, hs.r, hs.g, hs.b, hg.r, hg.g, hg.b, this.hemi.intensity,
      mc.r, mc.g, mc.b, this.moon.intensity, d.x, d.y, d.z, this.theme.exposure, this.q.bloom && this.look.glow > 0.01 ? 1 : 0,
      this.theme.bloom[0] * this.look.glow, this.theme.bloom[1], this.theme.bloom[2], this.look.sharp, this.look.aa ? 1 : 0];
  }
}
