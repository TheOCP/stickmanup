// Renderer, post-processing and the storm itself: sky, ocean, rain, lightning and lights.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/EffectComposer.js';
import { RenderPass } from 'three/addons/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/OutputPass.js';
import { Mirror } from './mirror.js';
import { useBakedNoise } from './pattern.js';
import { hueShift } from './level.js';
import { ON_PC } from './platform.js';

export const QUALITY = {
  low: { dpr: 1.0, bloom: false, shadow: 0, rain: 1200, ocean: 48, samples: 0 },
  high: { dpr: 1.5, bloom: true, shadow: 1024, rain: 2600, ocean: 96, samples: 4 },
  ultra: { dpr: 2.0, bloom: true, shadow: 2048, rain: 4200, ocean: 128, samples: 4 },
};

const BOLT_PTS = 15;

// Look of each map: sky, sun, sea, lights, rain and glow. Fog colours come from the level's zones.
const THEMES = {
  storm: { key: 'storm', top: 0x0d1426, glow: 0xffd890, day: 0, sun: 0, sunCol: 0xffe2b0, cloud: 1, horK: 1.6, seaK: 1.8, hemiSky: 0x8a98c8, hemiGround: 0x141824,
    hemi: 0.6, light: 0xb8c4ff, lightI: 1.15, dir: [0.45, 1, 0.3], deep: 0x03080c, shallow: 0x03080c, shallowR: 0, amp: 1.0, foam: 0.55, scatter: 0x0b2a30, clear: 0, shore: 0, rain: 1, fog: 0.0085, exposure: 1.1, bloom: [0.9, 0.5, 0.62] },
  sunny: { key: 'sunny', top: 0x2f7fd0, glow: 0xfff2c0, day: 1, sun: 1, sunCol: 0xfff0d2, cloud: 0.55, horK: 1.0, seaK: 0.75, hemiSky: 0xcfe8ff, hemiGround: 0xd8c39a,
    hemi: 1.15, light: 0xfff2de, lightI: 2.7, dir: [0.55, 0.75, 0.38], deep: 0x0a4a72, shallow: 0x3fd8c8, shallowR: 70, amp: 0.5, foam: 0.22, scatter: 0x2ad0c0, clear: 1, shore: 41.2, rain: 0, fog: 0.0036, exposure: 1.0, bloom: [0.32, 0.4, 0.95] },
  forest: { key: 'forest', top: 0x4a7f9a, glow: 0xffe8b0, day: 0.8, sun: 0.75, sunCol: 0xffd49a, cloud: 0.7, horK: 1.05, seaK: 0.8, hemiSky: 0xb9d9c4, hemiGround: 0x3c4a2a,
    hemi: 1.05, light: 0xffe2b4, lightI: 2.1, dir: [-0.5, 0.62, 0.45], deep: 0x082624, shallow: 0x1f5a48, shallowR: 110, amp: 0.42, foam: 0.18, scatter: 0x1f7a5a, clear: 0.45, shore: 89.2, rain: 0, fog: 0.0072, exposure: 1.05, bloom: [0.6, 0.45, 0.78] },
  // Inside a volcano: light from the opening above, glow from the lava lake below (the "sea" is lava).
  volcano: { key: 'volcano', top: 0x1c0806, glow: 0xff8a3a, day: 0.25, sun: 0, sunCol: 0xff8040, cloud: 0.85, horK: 1.3, seaK: 0.35, hemiSky: 0xffb08a, hemiGround: 0xff5a20,
    hemi: 1.0, light: 0xffb88a, lightI: 1.3, dir: [0.2, 1, 0.1], deep: 0xff4a10, deepK: 2.4, shallow: 0xff4a10, shallowR: 0, amp: 0.22, foam: 0, scatter: 0x000000, clear: 0, shore: 0, lava: 1, rain: 0, fog: 0.008, exposure: 1.05, bloom: [1.0, 0.55, 0.7] },
  // A city at sunset: low orange sun, purple sky, a dark bay.
  city: { key: 'city', top: 0x221a4a, glow: 0xff9a6a, day: 0.55, sun: 0.65, sunCol: 0xff8a5a, cloud: 0.5, horK: 1.15, seaK: 0.9, hemiSky: 0xb0a0e0, hemiGround: 0x302040,
    hemi: 0.95, light: 0xffa070, lightI: 1.7, dir: [0.7, 0.2, 0.4], deep: 0x0a1630, shallow: 0x0a1630, shallowR: 0, amp: 0.6, foam: 0.3, scatter: 0x1a3a6a, clear: 0, shore: 0, rain: 0, fog: 0.0045, exposure: 1.05, bloom: [0.8, 0.5, 0.72] },
};

// Waterfall: a bright tropical day over a crystal clear lagoon.
THEMES.waterfall = { key: 'waterfall', top: 0x3a9ae0, glow: 0xfff6d0, day: 1, sun: 1, sunCol: 0xfff4dc, cloud: 0.45, horK: 1.0, seaK: 0.8, hemiSky: 0xd0f0ff, hemiGround: 0x8ac890,
  hemi: 1.15, light: 0xfff4e4, lightI: 2.6, dir: [0.4, 0.8, -0.45], deep: 0x0a5a80, shallow: 0x30d8c8, shallowR: 48, amp: 0.28, foam: 0.15, scatter: 0x3ff0d8, clear: 0.6, shore: 37.2,
  rain: 0, fog: 0.0034, exposure: 1.0, bloom: [0.35, 0.4, 0.95] };

// A generated map's look (level.js mapDef): its world's sky with the colours turned round (hue), maybe another time of day,
// and for a holiday its own few colours on top.
const TIMES = {
  night: { day: 0, sun: 0, cloud: 0.8, top: 0x070b1c, glow: 0x9ab0ff, sunCol: 0xd8e0ff, light: 0xa8b8ff, dir: [0.4, 1, 0.3], k: 0.5, fogK: 0.32, exposure: 1.1 },
  dusk: { day: 0.5, sun: 0.7, cloud: 0.5, top: 0x2a2050, glow: 0xff9a6a, sunCol: 0xff8a5a, light: 0xffa070, dir: [0.7, 0.2, 0.4], k: 0.8, fogK: 0.72 },
};
function lookOf(key, look) {
  const B = THEMES[key] || THEMES.storm;
  if (!look) return B;
  const T = Object.assign({}, B), h = look.hue || 0;
  for (const k of ['top', 'glow', 'hemiSky', 'hemiGround', 'scatter']) if (T[k] !== undefined) T[k] = hueShift(T[k], h);
  // Lava stays lava.
  if (!T.lava) { T.deep = hueShift(T.deep, h); T.shallow = hueShift(T.shallow, h); }
  const tm = TIMES[look.time];
  if (tm) {
    Object.assign(T, { day: tm.day, sun: tm.sun, cloud: tm.cloud, top: tm.top, glow: tm.glow, sunCol: tm.sunCol, light: tm.light, dir: tm.dir, fogK: tm.fogK });
    T.hemi *= tm.k; T.lightI *= tm.k;
    if (tm.exposure) T.exposure = tm.exposure;
  }
  if (look.over) Object.assign(T, look.over);
  return T;
}

const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }`;
// On Android: the same noise read from one texture baked at startup. That one sum (ten layers per pixel for the
// clouds, ten more for the sea) used to be the most expensive thing in the picture.
const NOISE_BAKED = `uniform sampler2D uNoise;
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoise, (i + f + 0.5) / 512.0, 0.0).r; }
float fbm(vec2 p){ return textureLod(uNoise, p / 16.0, 0.0).b; }`;

// GPU names that need care. Pixel 10 (PowerVR D-Series) drivers crash when WebGL programs are deleted
// at runtime and fail at large render sizes, so on these GPUs the canvas stays under ~0.7 megapixels.
const POWERVR = /powervr|imagination|img-?tec/i;

// three.js works out where every object is, every frame, hidden or not, and most of a map is hidden at any moment
// (other heights, far creatures, stickmen not in the game, the gun). Hidden ones now wait until they show again: a
// change from above while they were hidden is kept in mind, so they come back in the right place.
let hiddenSkipped = false;
function skipHidden() {
  if (hiddenSkipped) return;
  hiddenSkipped = true;
  const update = THREE.Object3D.prototype.updateMatrixWorld;
  THREE.Object3D.prototype.updateMatrixWorld = function (force) {
    if (!this.visible) {
      if (force) this.matrixWorldNeedsUpdate = true;
      return;
    }
    update.call(this, force);
  };
}

// Draw order as three.js has it, except that a material's plain, instanced and coloured instanced uses are drawn
// together. Each switch between them looks the shader up again and sends all its settings again, and in distance
// order they took turns many times a frame.
const kindOf = (o) => (o.isInstancedMesh ? (o.instanceColor ? 2 : 1) : 0);
function opaqueSort(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  const k = kindOf(a.object) - kindOf(b.object);
  if (k) return k;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
// The shadow pass draws every caster with one shared material, so it switched shader at every instanced mesh too.
// Instanced ones get their own (one for each kind), the same as three.js would use otherwise.
const DEPTH = [null, new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })];
function ownDepth(scene) {
  scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.castShadow || (o.customDepthMaterial && !o.userData.ownDepth)) return;
    const m = o.material;
    if (!m || Array.isArray(m) || m.alphaTest > 0 || (m.displacementMap && m.displacementScale !== 0) || (m.clippingPlanes && m.clippingPlanes.length)) {
      if (o.userData.ownDepth) { o.customDepthMaterial = undefined; o.userData.ownDepth = false; }
      return;
    }
    o.customDepthMaterial = DEPTH[kindOf(o)];
    o.userData.ownDepth = true;
  });
}

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
      useBakedNoise(true);
      this.gpu = 'native';
      this.powervr = false;
      canvas.style.display = 'none';
      document.body.classList.add('native');
      document.documentElement.classList.add('native');
    } else {
      // An alpha canvas with a hair of CSS transparency is composited normally instead of being promoted
      // to a hardware overlay plane, which some phones show as a blank white layer.
      if (safe >= 1) canvas.style.opacity = '0.995';
      // With bloom the scene is drawn into an offscreen buffer, so canvas antialiasing would be wasted memory.
      this.r = new THREE.WebGLRenderer({ canvas, antialias: !bloom && safe < 2, alpha: safe >= 1, powerPreference: safe >= 2 ? 'default' : 'high-performance' });
      skipHidden();
      this.r.setOpaqueSort(opaqueSort);
      this.frameN = 0;
      this.r.outputColorSpace = THREE.SRGBColorSpace;
      this.r.toneMapping = THREE.ACESFilmicToneMapping;
      this.exp = 1.1;
      this.bright = 1;
      this.fixH = 0;
      this.r.toneMappingExposure = this.exp;
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
    // For things that turn to face whoever is looking (the hearts and Zs of emotes).
    this.scene.userData.view = this.camera;
    this.fogCol = new THREE.Color(0x0b1820);
    this.scene.fog = new THREE.FogExp2(this.fogCol.getHex(), 0.0085);
    this.scene.background = this.fogCol.clone();
    this.flashV = 0;
    this.t = 0;
    this.eye = 0;
    this.theme = THEMES.storm;
    // Player picture settings: sharpening 0..1, edge anti-aliasing on/off, glow strength multiplier.
    this.look = { sharp: 0.35, aa: true, glow: 1, scale: 1, lite: 0, far: 0 };

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
    // A PC draws every pixel of a 1440p screen: below that the picture is scaled up and looks soft, most of all in motion.
    this.maxPx = (this.powervr ? [0.6, 0.5, 0.35, 0.25, 0.2] : ON_PC ? [3.7, 2.4, 1.5, 0.8, 0.5] : [2.4, 1.5, 0.8, 0.5, 0.3])[Math.min(L, 4)] * 1e6;
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

  // PC brightness: 0.5 is the picture as made, 0 half as bright, 1 twice as bright.
  setBright(v) {
    this.bright = 2 ** ((v - 0.5) * 2);
    if (this.r) this.r.toneMappingExposure = this.exp * this.bright;
  }

  // PC resolution: the height in pixels to draw the picture at on the whole screen, 0 for automatic.
  setRes(h) {
    if (this.native || (h || 0) === this.fixH) return;
    this.fixH = h || 0;
    this.w = -1;
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
    // A resolution picked on the PC: drawn that many lines high (fewer only in a window smaller than that), whatever it
    // costs. Otherwise as sharp as the preset and the graphics chip allow.
    const dpr = this.fixH ? Math.max(0.25, Math.min(this.fixH, h * (window.devicePixelRatio || 1)) / h) : Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.q.dpr, Math.sqrt(this.maxPx / (w * h))));
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
      uSunDir: { value: new THREE.Vector3(0.45, 1, 0.3).normalize() }, uSunCol: { value: new THREE.Color(0xffe2b0) }, uSun: { value: 0 }, uCloud: { value: 1 }, uDay: { value: 0 }, uLite: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime, uFlash, uEye, uSun, uCloud, uDay, uLite; uniform vec3 uTop, uHor, uGlow, uSunDir, uSunCol; varying vec3 vDir; ${this.native ? NOISE_BAKED : NOISE}
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = mix(uHor, uTop, smoothstep(-0.05, 0.55, h));
          float sd = max(dot(d, uSunDir), 0.0);
          float sd2 = sd * sd, sd4 = sd2 * sd2;
          col += uSunCol * sd4 * sd4 * 0.25 * uSun;
          vec2 uv = d.xz / (abs(h) + 0.22) * 1.3;
          float c = fbm(uv + vec2(uTime * 0.012, uTime * 0.007));
          float c2 = uLite > 0.5 ? c : fbm(uv * 2.4 - vec2(uTime * 0.025, 0.0));
          float cloud = smoothstep(0.32 + (1.0 - uCloud) * 0.32, 0.86, c * 0.75 + c2 * 0.4);
          vec3 cc = mix(uHor * 0.55, uTop * 1.9 + vec3(0.035, 0.04, 0.06), c2);
          // Daylight clouds: bright tops, soft grey bellies, a silver lining toward the sun.
          vec3 dc = mix(vec3(0.62, 0.68, 0.78), vec3(1.05, 1.04, 1.02), c2) + uSunCol * sd4 * sd2 * 0.6;
          cc = mix(cc, dc, uDay);
          if (uSun > 0.0 && sd > 0.8) col += uSunCol * (pow(sd, 1400.0) * 40.0 + pow(sd, 90.0) * 1.2) * uSun * (1.0 - cloud * 0.85);
          col = mix(col, cc, cloud * smoothstep(-0.25, 0.12, h));
          col += uFlash * (0.15 + cloud * 0.7) * vec3(0.55, 0.62, 1.0) * smoothstep(-0.15, 0.3, h);
          float eye = uEye > 0.001 ? smoothstep(1.0 - 0.32 * uEye, 1.0 - 0.06 * uEye, h) * uEye : 0.0;
          col = mix(col, uGlow * 1.4, eye * (1.0 - cloud * 0.5));
          if (uEye > 0.001) col += uGlow * pow(max(h, 0.0), 6.0) * uEye * 0.45;
          col = mix(col, uHor * 0.75, 1.0 - smoothstep(-0.35, 0.0, h));
          gl_FragColor = vec4(clamp(col, 0.0, 20.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), m);
    this.sky.frustumCulled = false;
    // Drawn after everything solid, so it only colours the pixels nothing else covers.
    this.sky.renderOrder = 1000;
    this.scene.add(this.sky);
  }

  makeOcean(q) {
    // A round grid whose rings bunch up in the middle (the ocean follows the camera), so the waves nearby
    // get fine detail and the far water stays cheap.
    const segs = QUALITY[q] ? QUALITY[q].ocean : 128, rings = segs >> 1, pos = [0, 0, 0], idx = [];
    for (let i = 1; i <= rings; i++) {
      const r = 1000 * Math.pow(i / rings, 2.2);
      for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + ((j + 1) % segs);
      idx.push(a, b, a + segs, b, b + segs, a + segs);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.oceanU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlash: { value: 0 }, uDeep: { value: new THREE.Color(0x03080c) }, uSky: { value: new THREE.Color(0x1d3040) },
      uTop: { value: new THREE.Color(0x0d1426) }, uShallow: { value: new THREE.Color(0x03080c) }, uShallowR: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.45, 1, 0.3).normalize() }, uSunCol: { value: new THREE.Color(0xffe2b0) }, uSun: { value: 0 },
      uAmp: { value: 1 }, uFoam: { value: 0.5 }, uScatter: { value: new THREE.Color(0x0b2a30) }, uClear: { value: 0 }, uShore: { value: 0 }, uLava: { value: 0 }, uLite: { value: 0 },
    }]);
    // Gerstner waves (peaked crests, flat troughs). The vertex shader moves the grid with the long ones; the
    // fragment shader works out the exact slope of all of them per pixel. Shorter waves fade out with distance
    // (sooner on the grid than per pixel) so nothing shimmers, and they calm down near a beach.
    const WAVES = `uniform float uTime, uAmp, uShore;
      void gw(vec2 p, vec2 d, float L, float A, float Q, float fade, inout vec3 disp, inout vec3 tn){
        float k = 6.2832 / L, f = k * (dot(d, p) - sqrt(9.8 / k) * uTime), a = A * fade, s = sin(f), c = cos(f);
        disp += vec3(Q * a * d.x * c, a * s, Q * a * d.y * c);
        tn += vec3(d.x * k * a * c, Q * k * a * s, d.y * k * a * c);
      }
      float shoreDamp(vec2 p){ return uShore > 0.0 ? mix(0.12, 1.0, smoothstep(uShore, uShore + 35.0, length(p))) : 1.0; }
      void longWaves(vec2 p, float dist, float lod, float amp, inout vec3 disp, inout vec3 tn){
        gw(p, vec2(0.970, 0.243), 64.0, 0.85 * amp, 0.55, 1.0 - smoothstep(500.0 * lod, 900.0 * lod, dist), disp, tn);
        gw(p, vec2(-0.330, 0.944), 33.0, 0.48 * amp, 0.6, 1.0 - smoothstep(260.0 * lod, 520.0 * lod, dist), disp, tn);
        gw(p, vec2(0.824, -0.566), 19.0, 0.27 * amp, 0.7, 1.0 - smoothstep(150.0 * lod, 300.0 * lod, dist), disp, tn);
      }
      void shortWaves(vec2 p, float dist, float lod, float amp, inout vec3 disp, inout vec3 tn){
        gw(p, vec2(0.150, 0.989), 11.0, 0.13 * amp, 0.7, 1.0 - smoothstep(90.0 * lod, 180.0 * lod, dist), disp, tn);
        gw(p, vec2(-0.949, -0.316), 6.5, 0.06 * amp, 0.6, 1.0 - smoothstep(50.0 * lod, 110.0 * lod, dist), disp, tn);
      }
      void waves(vec2 p, float dist, float lod, float amp, inout vec3 disp, inout vec3 tn){
        longWaves(p, dist, lod, amp, disp, tn);
        shortWaves(p, dist, lod, amp, disp, tn);
      }`;
    // On Android the long waves' slope is worked out per corner of the water grid and only the short ones per pixel.
    const NAT = this.native ? '#define SMU_NATIVE\n' : '';
    const m = new THREE.ShaderMaterial({
      uniforms: this.oceanU, fog: true,
      vertexShader: `${NAT}#include <fog_pars_vertex>
        ${WAVES}
        varying vec3 vW; varying float vH; varying float vAmp;
        #ifdef SMU_NATIVE
        varying vec3 vTn;
        #endif
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          float amp = uAmp * shoreDamp(w.xz), dist = length(cameraPosition.xz - w.xz);
          vec3 disp = vec3(0.0), tn = vec3(0.0);
          waves(w.xz, dist, 0.3, amp, disp, tn);
          #ifdef SMU_NATIVE
          vec3 dn = vec3(0.0); vTn = vec3(0.0);
          longWaves(w.xz, dist, 1.0, amp, dn, vTn);
          #endif
          w.xyz += disp;
          vH = disp.y / max(amp * 1.2, 0.05); vW = w.xyz; vAmp = amp;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `${NAT}#include <fog_pars_fragment>
        ${WAVES}
        uniform float uFlash, uShallowR, uSun, uFoam, uClear, uLava, uLite; uniform vec3 uDeep, uSky, uTop, uShallow, uSunDir, uSunCol, uScatter;
        varying vec3 vW; varying float vH; varying float vAmp;
        #ifdef SMU_NATIVE
        varying vec3 vTn;
        #endif
        ${this.native ? NOISE_BAKED : NOISE}
        void main(){
          vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 v = toCam / max(dist, 1e-3);
          vec2 p = vW.xz;
          vec3 col;
          if (uLava > 0.5) {
            // Lava: a slow dark crust drifting over glowing molten rock, brightest along the cracks.
            float k1 = noise(p * 0.08 + vec2(uTime * 0.02, uTime * 0.015)), k2 = noise(p * 0.23 - vec2(uTime * 0.03, -uTime * 0.02));
            float crust = smoothstep(0.45, 0.66, k1 * 0.65 + k2 * 0.35), pulse = 0.5 + 0.5 * sin(uTime * 0.8 + k2 * 6.0);
            col = mix(uDeep * (0.85 + 0.35 * pulse), uDeep * 0.05 + vec3(0.035, 0.018, 0.012), crust);
            col += uDeep * 0.35 * (1.0 - smoothstep(0.0, 0.08, abs(k1 * 0.65 + k2 * 0.35 - 0.47)));
          } else {
            vec3 disp = vec3(0.0);
            #ifdef SMU_NATIVE
            vec3 tn = vTn;
            if (uLite < 0.5) shortWaves(p, dist, 1.0, vAmp, disp, tn);
            #else
            vec3 tn = vec3(0.0);
            waves(p, dist, 1.0, vAmp, disp, tn);
            #endif
            vec3 n = vec3(-tn.x, 1.0 - tn.y, -tn.z);
            // Fine ripples: two layers of drifting noise, as a slope, fading with distance.
            float rk = (1.0 - smoothstep(25.0, 170.0, dist)) * (0.45 + 0.55 * min(uAmp, 1.0));
            vec2 q1 = p * 0.55 + vec2(uTime * 0.31, uTime * 0.17), q2 = p * 1.35 + vec2(-uTime * 0.23, uTime * 0.37);
            #ifdef SMU_NATIVE
            // The two soft noise layers in one read each stand in for a slope in x and z.
            vec2 rg = vec2(0.0);
            if (rk > 0.001 && uLite < 0.5) rg = ((textureLod(uNoise, q1 / 16.0, 0.0).ba - 0.484) * 0.42 + (textureLod(uNoise, q2 / 16.0, 0.0).ba - 0.484) * 0.21) * rk;
            #else
            float a0 = noise(q1), b0 = noise(q2), e = 0.07;
            vec2 g1 = vec2(noise(q1 + vec2(e, 0.0)) - a0, noise(q1 + vec2(0.0, e)) - a0) / e;
            vec2 g2 = vec2(noise(q2 + vec2(e, 0.0)) - b0, noise(q2 + vec2(0.0, e)) - b0) / e;
            vec2 rg = (g1 * 0.07 + g2 * 0.035) * rk;
            #endif
            n = normalize(n - vec3(rg.x, 0.0, rg.y));
            // Reflection: the sky (horizon colour low down, sky colour higher up) weighted by Fresnel.
            float ndv = max(dot(n, v), 0.0), F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
            vec3 r = reflect(-v, n); r.y = abs(r.y);
            vec3 refl = mix(uSky, uTop, smoothstep(0.03, 0.6, r.y));
            float sd = max(dot(r, uSunDir), 0.0);
            vec3 spec = vec3(0.0);
            if (uSun > 0.0 && sd > 0.5) spec = uSunCol * (pow(sd, 1600.0) * 70.0 + pow(sd, 140.0) * 1.6 + pow(sd, 14.0) * 0.07) * uSun;
            // The water itself: deep colour, clear and bright over sand near the shore, lit through the crests.
            float near = uShallowR > 0.0 ? 1.0 - smoothstep(uShallowR * 0.55, uShallowR * 1.6, length(p)) : 0.0;
            vec3 body = mix(uDeep, uShallow, near);
            vec2 sunH = normalize(uSunDir.xz + vec2(1e-4)), look = -v.xz / max(length(v.xz), 1e-3);
            float crest = smoothstep(-0.15, 0.95, vH), toward = 0.35 + 0.65 * max(dot(look, sunH), 0.0);
            body += uScatter * crest * toward * (0.45 + 0.55 * uSun);
            if (near * uClear > 0.001 && dist < 140.0 && uLite < 0.5) {
              float c1 = noise(p * 0.33 + vec2(uTime * 0.21, -uTime * 0.16)), c2 = noise(p * 0.47 - vec2(uTime * 0.17, uTime * 0.12));
              float caus = pow(1.0 - abs(c1 + c2 - 1.0), 9.0);
              body += uShallow * caus * near * uClear * 0.7 * (1.0 - smoothstep(20.0, 140.0, dist));
            }
            col = mix(body, refl, F) + spec * (0.2 + F);
            // Foam: whitecaps on the crests and surf rolling onto the beach, broken up by noise.
            // Only worked out where there can be foam at all.
            float foam = 0.0, d = uShore > 0.0 ? length(p) - uShore : 99.0;
            if (uLite < 0.5 && dist < 450.0 && (d < 5.0 || (uFoam > 0.0 && vH > 0.5))) {
            float fn = noise(p * 1.7 + vec2(uTime * 0.5, 0.0)) * 0.6 + noise(p * 4.3 - vec2(uTime * 0.4)) * 0.4;
            foam = smoothstep(0.5, 0.95, vH) * smoothstep(0.55, 0.8, fn) * uFoam;
            if (uShore > 0.0) {
              // Thin broken lines of surf running up the beach, and a lacy edge where the water meets the sand.
              float band = (1.0 - smoothstep(0.0, 5.0, d)) * smoothstep(-0.6, 0.3, d);
              float lines = smoothstep(0.65, 0.95, 0.5 + 0.5 * sin(d * 1.7 - uTime * 1.5 + fn * 2.5));
              float edge = (1.0 - smoothstep(0.0, 1.1, d)) * smoothstep(-0.6, 0.0, d);
              foam = max(foam, (band * lines * 0.8 + edge * 0.7) * smoothstep(0.3, 0.65, fn));
            }
            }
            vec3 foamCol = mix(uSky * 1.5 + vec3(0.06), vec3(0.93, 0.97, 1.0), clamp(uSun, 0.0, 1.0));
            col = mix(col, foamCol, foam * (1.0 - smoothstep(150.0, 450.0, dist)));
            col += uFlash * vec3(0.5, 0.6, 1.0) * (0.1 + F * 0.6);
          }
          gl_FragColor = vec4(clamp(col, 0.0, 20.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(g, m);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 999;
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
      g.userData.live = true;
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

  // Switches the whole look to a map (its world's key, and a generated map's own look).
  setTheme(key, look) {
    const T = (this.theme = lookOf(key, look)), S = this.skyU, O = this.oceanU;
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
    O.uTop.value.setHex(T.top);
    O.uAmp.value = T.amp ?? 1;
    O.uFoam.value = T.foam ?? 0.4;
    O.uScatter.value.setHex(T.scatter ?? 0x000000);
    O.uClear.value = T.clear ?? 0;
    O.uShore.value = T.shore ?? 0;
    O.uLava.value = T.lava ? 1 : 0;
    this.hemi.color.setHex(T.hemiSky);
    this.hemi.groundColor.setHex(T.hemiGround);
    this.scene.fog.density = T.fog;
    this.rain.visible = T.rain > 0 && this.safe < 3;
    this.exp = T.exposure;
    if (this.r) this.r.toneMappingExposure = this.exp * this.bright;
    // Only what really shines should glow: at full strength these wash out the whole picture.
    if (this.bloom) { this.bloom.strength = T.bloom[0] * 0.45; this.bloom.radius = T.bloom[1] * 0.8; this.bloom.threshold = Math.max(T.bloom[2], 0.9); }
  }

  flash(v) {
    this.flashV = Math.max(this.flashV, v);
  }

  // The cheapest picture for weak phones: lit per corner (native side), plain sky and sea, a third of the rain.
  setLite(on, rain = 0.35) {
    const v = on ? 1 : 0;
    this.look.lite = v;
    this.skyU.uLite.value = v;
    this.oceanU.uLite.value = v;
    this.rain.geometry.setDrawRange(0, Math.round(this.q.rain * (on ? rain : 1)) * 2);
  }

  // Per-frame storm animation. zone carries fog and accent colours, eye opens toward the summit.
  update(dt, cam, zone, eye, wind) {
    this.t += dt;
    const fl = this.flashV * (0.75 + 0.25 * Math.sin(this.t * 60));
    this.flashV *= Math.exp(-dt * 6);
    // Small numbers for the shaders, however long the game has been open (see WorldView.update).
    const wt = this.t % 3600;
    this.skyU.uTime.value = wt;
    this.skyU.uFlash.value = fl;
    this.eye += (eye - this.eye) * Math.min(1, dt * 0.8);
    this.skyU.uEye.value = this.eye;
    this.oceanU.uTime.value = wt;
    this.oceanU.uFlash.value = fl;
    this.rainU.uTime.value = wt;
    this.rainU.uCam.value.copy(cam);
    this.rainU.uWind.value.set(3 + wind.x * 0.6, 1 + wind.z * 0.6);
    // Under a maze garden's roof (indoor, set by the climb and the watch screen) no rain falls.
    this.inK = (this.inK || 0) + ((this.indoor ? 1 : 0) - (this.inK || 0)) * Math.min(1, dt * 6);
    this.rainU.uAmt.value = (1 - this.eye * 0.75) * (1 - this.inK);
    const TH = this.theme, E = TH.key === 'storm' ? this.eye : 0;

    if (zone) {
      const target = new THREE.Color(zone.fog).multiplyScalar(TH.fogK ?? 1);
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
    this.ocean.position.set(Math.round(cam.x / 4) * 4, 0, Math.round(cam.z / 4) * 4);
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

  // Every shader the scene can need, made in the background now instead of the moment something first comes into view
  // on the climb: that is a hitch a frame counter never shows. A moment later, so the map and its lights are all in.
  // Only for WebGL; the phone's own renderer gets its programs ready itself (NRender prewarm).
  warmShaders() {
    if (!this.r || !this.r.compileAsync) return;
    clearTimeout(this.warmT);
    this.warmT = setTimeout(() => {
      try {
        const p = this.r.compileAsync(this.scene, this.camera);
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        // Nothing lost: whatever isn't ready is made when first drawn, as before.
      }
    }, 400);
  }

  render() {
    // New things come and go with the map, so every second or so.
    if (!this.native && this.q.shadow && this.frameN++ % 90 === 0) ownDepth(this.scene);
    if (this.composer) this.composer.render();
    else if (this.native) this.mirror.sync(this.scene, this.camera, this.env());
    else this.r.render(this.scene, this.camera);
  }

  // Lights, fog and post settings for the native renderer (layout matches NRender.env).
  env() {
    const e = this.envA || (this.envA = new Array(28).fill(0));
    const f = this.scene.fog, hs = this.hemi.color, hg = this.hemi.groundColor, mc = this.moon.color, mp = this.moon.position, mt = this.moon.target.position, T = this.theme, L = this.look;
    let dx = mp.x - mt.x, dy = mp.y - mt.y, dz = mp.z - mt.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    e[0] = f.color.r; e[1] = f.color.g; e[2] = f.color.b;
    // A shorter view on weak phones: the fog closes in, so that what is left out melts away instead of popping off.
    e[3] = L.far ? Math.max(f.density, 2.3 / L.far) : f.density;
    e[4] = hs.r; e[5] = hs.g; e[6] = hs.b; e[7] = hg.r; e[8] = hg.g; e[9] = hg.b; e[10] = this.hemi.intensity;
    e[11] = mc.r; e[12] = mc.g; e[13] = mc.b; e[14] = this.moon.intensity; e[15] = dx; e[16] = dy; e[17] = dz;
    e[18] = T.exposure; e[19] = this.q.bloom && L.glow > 0.01 ? 1 : 0;
    e[20] = T.bloom[0] * L.glow; e[21] = T.bloom[1]; e[22] = T.bloom[2]; e[23] = L.sharp; e[24] = L.aa ? 1 : 0;
    e[25] = L.scale; e[26] = L.lite;
    // Where the native side stops drawing. Past this the fog has already swallowed everything.
    e[27] = L.far || (f.density > 0 ? 3 / f.density : 0);
    return e;
  }
}
