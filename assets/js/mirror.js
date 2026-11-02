// Mirrors the three.js scene to the native Android renderer (no WebGL in the WebView at all).
// Geometry, materials, textures and objects are sent once ("define"); each frame only sends what changed:
// object matrices and visibility, material parameters and uniforms, rewritten buffers and the camera.
import * as THREE from 'three';

const b64 = (typed) => {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const f32 = (a) => (a instanceof Float32Array ? a : new Float32Array(a));
const n4 = (v) => Math.round(v * 1e4) / 1e4;
const n3 = (v) => Math.round(v * 1e3) / 1e3;
// Objects farther than this from the camera are lost in the storm fog; their updates wait until they're near.
const FAR = 125;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Mirror {
  constructor(send) {
    this.send = send; // (kind 'def' | 'frame', jsonString) => void
    this.ids = new WeakMap();
    this.next = 1;
    this.objs = new Map(); // id -> { obj, m: Float32Array(16), vis }
    this.geos = new Map(); // id -> { geo, ver: Map(name -> version), dr }
    this.mats = new Map(); // id -> { mat, sig }
    this.live = []; // materials that animate (shader uniforms or flagged userData.live)
    this.texs = new Set();
    this.def = null;
  }

  // Forget what the native side has, so the next frame resends every object and material state.
  reset() {
    for (const e of this.objs.values()) { e.vis = -1; e.m.fill(NaN); e.mat = null; }
    for (const e of this.mats.values()) e.sig = '';
    this.forceAll = true;
  }

  id(x) {
    let i = this.ids.get(x);
    if (!i) { i = this.next++; this.ids.set(x, i); }
    return i;
  }

  defs() {
    return this.def || (this.def = { g: [], t: [], m: [], o: [] });
  }

  attrDef(a) {
    return { n: a.itemSize, d: b64(f32(a.array)) };
  }

  // Custom shaders only get the attributes their vertex shader reads (the ocean grid needs no normals or uvs).
  defineGeometry(geo, mat) {
    const id = this.id(geo);
    if (this.geos.has(id)) return id;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const attrs = {}, ver = new Map(), only = mat && mat.isShaderMaterial ? mat.vertexShader : null;
    for (const name in geo.attributes) {
      if (only && name !== 'position' && !new RegExp('\\b' + name + '\\b').test(only)) continue;
      const a = geo.attributes[name];
      attrs[name] = this.attrDef(a);
      ver.set(name, a.version);
    }
    const d = { id, attrs };
    if (geo.index) {
      const big = geo.attributes.position.count > 65535;
      d.idx = b64(big ? Uint32Array.from(geo.index.array) : Uint16Array.from(geo.index.array));
      d.it = big ? 32 : 16;
      ver.set('#index', geo.index.version);
    }
    const s = geo.boundingSphere;
    d.bs = [s.center.x, s.center.y, s.center.z, s.radius];
    const cnt = geo.drawRange.count;
    d.dr = [geo.drawRange.start, isFinite(cnt) ? cnt : -1];
    this.geos.set(id, { geo, ver, dr: d.dr.join() });
    this.defs().g.push(d);
    return id;
  }

  defineTexture(tex) {
    const id = this.id(tex);
    if (this.texs.has(id)) return id;
    this.texs.add(id);
    const img = tex.image, url = img && img.toDataURL ? img.toDataURL('image/png') : '';
    this.defs().t.push({
      id, url, rs: tex.wrapS === THREE.RepeatWrapping ? 1 : 0, rt: tex.wrapT === THREE.RepeatWrapping ? 1 : 0,
      rep: [tex.repeat.x, tex.repeat.y], off: [tex.offset.x, tex.offset.y], flip: tex.flipY ? 1 : 0,
    });
    return id;
  }

  // Mutable material state, as a flat list; also used as a change signature.
  matState(m) {
    const c = m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
    const e = m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : [0, 0, 0];
    const out = [...c, ...e, m.emissiveIntensity ?? 1, m.opacity ?? 1, m.visible === false ? 0 : 1];
    if (m.isShaderMaterial) {
      for (const k of Object.keys(m.uniforms).sort()) {
        const v = m.uniforms[k].value;
        if (typeof v === 'number') out.push(v);
        else if (v && v.isColor) out.push(v.r, v.g, v.b);
        else if (v && (v.isVector2 || v.isVector3 || v.isVector4)) out.push(...v.toArray());
      }
    }
    return out.map(n4);
  }

  defineMaterial(m) {
    const id = this.id(m);
    if (this.mats.has(id)) return id;
    const d = {
      id, op: m.opacity ?? 1, tr: m.transparent ? 1 : 0, dw: m.depthWrite ? 1 : 0, dt: m.depthTest ? 1 : 0,
      side: m.side, blend: m.blending === THREE.AdditiveBlending ? 1 : 0, fog: m.fog ? 1 : 0, tm: m.toneMapped ? 1 : 0,
      st: this.matState(m),
    };
    if (m.isShaderMaterial) {
      d.type = 'custom';
      d.vs = m.vertexShader;
      d.fs = m.fragmentShader;
      d.un = Object.keys(m.uniforms).sort().map((k) => {
        const v = m.uniforms[k].value;
        return [k, typeof v === 'number' ? 'f' : v && v.isColor ? 'c' : v && v.isVector2 ? 'v2' : v && v.isVector3 ? 'v3' : v && v.isVector4 ? 'v4' : 'x'];
      });
    } else if (m.isSpriteMaterial) {
      d.type = 'sprite';
      if (m.map) d.map = this.defineTexture(m.map);
    } else if (m.isMeshBasicMaterial) {
      d.type = 'basic';
      if (m.map) d.map = this.defineTexture(m.map);
    } else {
      d.type = 'lit';
      d.rough = m.roughness ?? 1;
      d.metal = m.metalness ?? 0;
      d.panel = m.userData.panel ? m.userData.pattern ?? 1 : 0;
      if (m.map) d.map = this.defineTexture(m.map);
      if (m.emissiveMap) d.em = this.defineTexture(m.emissiveMap);
    }
    const e = { mat: m, sig: d.st.join() };
    this.mats.set(id, e);
    if (m.isShaderMaterial || m.userData.live) this.live.push(e);
    this.defs().m.push(d);
    return id;
  }

  defineObject(o) {
    const id = this.id(o);
    const d = { id, ro: o.renderOrder, fc: o.frustumCulled ? 1 : 0 };
    d.kind = o.isSprite ? 'sprite' : o.isLineSegments ? 'lines' : 'mesh';
    d.g = o.isSprite ? 0 : this.defineGeometry(o.geometry, o.material);
    d.m = this.defineMaterial(o.material);
    if (o.isInstancedMesh) {
      d.inst = o.count;
      d.im = b64(o.instanceMatrix.array);
      if (o.instanceColor) d.ic = b64(o.instanceColor.array);
      o.computeBoundingSphere();
      const s = o.boundingSphere;
      d.bs = [s.center.x, s.center.y, s.center.z, s.radius];
    }
    // Big or never-culled things (sky, ocean, tower, instanced sets) are always kept up to date.
    const geoR = o.isInstancedMesh ? d.bs[3] : o.isSprite ? 1 : o.geometry.boundingSphere.radius;
    // Float64 so the change check compares exactly what three.js holds (Float32 copies never matched).
    this.objs.set(id, { obj: o, m: new Float64Array(16).fill(NaN), vis: -1, imv: o.isInstancedMesh ? o.instanceMatrix.version : 0,
      always: !o.frustumCulled || o.isInstancedMesh || geoR > 40, bs: o.isInstancedMesh && o.frustumCulled ? d.bs : null, mat: o.material });
    this.defs().o.push(d);
    return id;
  }

  // One frame: update world matrices, find what changed nearby, send definitions first, then the frame.
  // Frame text (one section per line, parsed in place by NRender without allocating):
  //   h:<env>  c:<view16,proj16,camPos3>  o:<id,vis[,px,py,pz,qx,qy,qz,qw,sx,sy,sz]>...  u:<matId,n,values>...
  //   a:<g|o|r|m>,id,name-or-start,payload;...
  sync(scene, camera, env) {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, all = this.forceAll;
    this.forceAll = false;
    const om = [], ou = [], au = [];
    this.seen = (this.seen || 0) + 1;
    const stamp = this.seen;
    const walk = (o, parentVis) => {
      const vis = parentVis && o.visible;
      if ((o.isMesh || o.isSprite || o.isLineSegments) && o.material && !Array.isArray(o.material)) {
        let id = this.ids.get(o);
        if (!id || !this.objs.has(id)) id = this.defineObject(o);
        const e = this.objs.get(id), m = o.matrixWorld.elements, v = vis ? 1 : 0;
        e.stamp = stamp;
        if (!all && !e.always) {
          const dx = m[12] - cx, dy = m[13] - cy, dz = m[14] - cz;
          if (dx * dx + dy * dy + dz * dz > FAR * FAR) { for (const c of o.children) walk(c, vis); return; }
        }
        // A climber changing skins swaps materials on existing objects.
        if (o.material !== e.mat) { e.mat = o.material; au.push('m,' + id + ',' + this.defineMaterial(o.material)); }
        let moved = false;
        if (v) for (let i = 0; i < 16; i++) if (e.m[i] !== m[i]) { moved = true; break; }
        if (moved || v !== e.vis) {
          om.push(id, v);
          if (v) {
            o.matrixWorld.decompose(_p, _q, _s);
            om.push(n3(_p.x), n3(_p.y), n3(_p.z), n4(_q.x), n4(_q.y), n4(_q.z), n4(_q.w), n3(_s.x), n3(_s.y), n3(_s.z));
            e.m.set(m);
          }
          e.vis = v;
        }
        // Instance buffers (drifting debris) only need ~15 updates a second.
        // Flagged ones (spinning coins) get every second frame.
        if (o.isInstancedMesh && o.instanceMatrix.version !== e.imv && (all || stamp % (o.userData.fastIM ? 2 : 4) === 0)) {
          const b = e.bs, far = b && Math.hypot(b[0] - cx, b[1] - cy, b[2] - cz) - b[3] > FAR;
          if (all || !far) { e.imv = o.instanceMatrix.version; au.push('o,' + id + ',im,' + b64(o.instanceMatrix.array)); }
        }
      }
      for (const c of o.children) walk(c, vis);
    };
    walk(scene, true);
    // Objects removed from the scene since last frame are hidden on the native side.
    for (const [id, e] of this.objs) if (e.stamp !== stamp && e.vis !== 0) { om.push(id, 0); e.vis = 0; }
    for (const e of all ? this.mats.values() : this.live) {
      const st = this.matState(e.mat), sig = st.join();
      if (sig !== e.sig) { e.sig = sig; ou.push(this.ids.get(e.mat), st.length, ...st); }
    }
    for (const [id, e] of this.geos) {
      const g = e.geo;
      for (const name in g.attributes) {
        const a = g.attributes[name];
        if (!e.ver.has(name)) continue;
        if (a.version !== e.ver.get(name)) { e.ver.set(name, a.version); au.push('g,' + id + ',' + name + ',' + b64(f32(a.array))); }
      }
      const c = g.drawRange.count, dr = g.drawRange.start + ',' + (isFinite(c) ? c : -1);
      if (dr !== e.dr) { e.dr = dr; au.push('r,' + id + ',' + dr); }
    }
    if (this.def) { this.send('def', JSON.stringify(this.def)); this.def = null; }
    const v = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements, cam = [];
    for (let i = 0; i < 16; i++) cam.push(n4(v[i]));
    for (let i = 0; i < 16; i++) cam.push(n4(p[i]));
    cam.push(n3(cx), n3(cy), n3(cz));
    const msg = 'h:' + env.map(n4).join() + '\nc:' + cam.join() + '\no:' + om.join() + '\nu:' + ou.join() + '\na:' + au.join(';') + '\n';
    this.bytes = msg.length;
    this.send('frame', msg);
  }
}
