// Mirrors the three.js scene to the native Android renderer (no WebGL in the WebView at all).
// Geometry, materials, textures and objects are sent once ("define"); each frame only sends what changed:
// object matrices and visibility, material parameters and uniforms, rewritten buffers and the camera.
//
// This runs every frame on the same thread as the game, on every phone, so the per-frame path is written to
// allocate almost nothing and to skip everything that didn't change: one walk over the scene updates world
// matrices (only of what moved) and finds what to send, hidden branches cost nothing, and a material is only
// looked at when something near the camera uses it.
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
const FAR = 125, FAR2 = FAR * FAR;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Mirror {
  constructor(send) {
    this.send = send; // (kind 'def' | 'frame', jsonString) => void
    this.ids = new WeakMap();
    this.next = 1;
    this.objs = new Map(); // id -> entry of a drawn object
    this.list = []; // the same entries, for the frame loop
    this.geos = new Map(); // id -> { geo, attrs: [{ name, ver }], ds, dc }
    this.geoList = [];
    this.mats = new Map(); // id -> entry of a material
    this.matList = [];
    this.live = []; // materials that animate (shader uniforms or flagged userData.live)
    this.texs = new Set();
    this.def = null;
    this.seen = 0;
    this.om = [];
    this.ou = [];
    this.au = [];
    this.changed = [];
    this.envLast = [];
    this.camLast = new Float64Array(35).fill(NaN);
    this.camOut = new Array(35);
    this.envOut = [];
  }

  // Forget what the native side has, so the next frame resends every object and material state.
  reset() {
    for (const e of this.list) { e.vis = -1; e.dirty = true; e.mat = null; }
    for (const e of this.matList) e.last.fill(NaN);
    this.envLast.length = 0;
    this.camLast.fill(NaN);
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
    const attrs = {}, watch = [], only = mat && mat.isShaderMaterial ? mat.vertexShader : null;
    for (const name in geo.attributes) {
      if (only && name !== 'position' && !new RegExp('\\b' + name + '\\b').test(only)) continue;
      const a = geo.attributes[name];
      attrs[name] = this.attrDef(a);
      watch.push({ name, ver: a.version });
    }
    const d = { id, attrs };
    if (geo.index) {
      const big = geo.attributes.position.count > 65535;
      d.idx = b64(big ? Uint32Array.from(geo.index.array) : Uint16Array.from(geo.index.array));
      d.it = big ? 32 : 16;
    }
    const s = geo.boundingSphere;
    d.bs = [s.center.x, s.center.y, s.center.z, s.radius];
    const cnt = geo.drawRange.count;
    d.dr = [geo.drawRange.start, isFinite(cnt) ? cnt : -1];
    const e = { id, geo, attrs: watch, ds: geo.drawRange.start, dc: cnt };
    this.geos.set(id, e);
    this.geoList.push(e);
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

  // A material's changing values as a flat list: colour, emissive, intensity, opacity, visible, then the
  // shader uniforms in sorted order. Writes into a reused array and returns how many there are.
  fillMat(e) {
    const m = e.mat, a = e.cur, c = m.color, em = m.emissive;
    if (c) { a[0] = c.r; a[1] = c.g; a[2] = c.b; } else { a[0] = a[1] = a[2] = 1; }
    if (em) { a[3] = em.r; a[4] = em.g; a[5] = em.b; } else { a[3] = a[4] = a[5] = 0; }
    a[6] = m.emissiveIntensity ?? 1;
    a[7] = m.opacity ?? 1;
    a[8] = m.visible === false ? 0 : 1;
    let k = 9;
    const us = e.unis;
    if (us !== null) {
      for (let i = 0; i < us.length; i++) {
        const v = us[i].value;
        if (typeof v === 'number') a[k++] = v;
        else if (!v) continue;
        else if (v.isColor) { a[k++] = v.r; a[k++] = v.g; a[k++] = v.b; }
        else if (v.isVector2) { a[k++] = v.x; a[k++] = v.y; }
        else if (v.isVector3) { a[k++] = v.x; a[k++] = v.y; a[k++] = v.z; }
        else if (v.isVector4) { a[k++] = v.x; a[k++] = v.y; a[k++] = v.z; a[k++] = v.w; }
      }
    }
    return k;
  }

  defineMaterial(m) {
    const id = this.id(m);
    if (this.mats.has(id)) return id;
    const keys = m.isShaderMaterial ? Object.keys(m.uniforms).sort() : null;
    const e = { id, mat: m, unis: keys ? keys.map((k) => m.uniforms[k]) : null, cur: new Array(9 + 4 * (keys ? keys.length : 0)).fill(0), last: null, used: 0, n: 0 };
    e.n = this.fillMat(e);
    e.last = new Float64Array(e.cur.length).fill(NaN);
    for (let i = 0; i < e.n; i++) e.last[i] = Math.round(e.cur[i] * 1e4);
    const d = {
      id, op: m.opacity ?? 1, tr: m.transparent ? 1 : 0, dw: m.depthWrite ? 1 : 0, dt: m.depthTest ? 1 : 0,
      side: m.side, blend: m.blending === THREE.AdditiveBlending ? 1 : 0, fog: m.fog ? 1 : 0, tm: m.toneMapped ? 1 : 0,
      st: e.cur.slice(0, e.n).map(n4),
    };
    if (m.isShaderMaterial) {
      d.type = 'custom';
      d.vs = m.vertexShader;
      d.fs = m.fragmentShader;
      d.un = keys.map((k) => {
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
    this.mats.set(id, e);
    this.matList.push(e);
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
    // Geometry built in world positions (water arcs, mist) sits far from its object's origin, so the origin says
    // nothing about how near it is. Checked by the origin, these could be hidden and then never shown again.
    const geoOff = o.isSprite || o.isInstancedMesh ? 0 : o.geometry.boundingSphere.center.length();
    const e = { id, obj: o, vis: -1, dirty: true, stamp: 0, imv: o.isInstancedMesh ? o.instanceMatrix.version : 0,
      always: !o.frustumCulled || o.isInstancedMesh || geoR > 40 || geoOff > 20, bs: o.isInstancedMesh && o.frustumCulled ? d.bs : null,
      mat: o.material, me: this.mats.get(d.m) };
    this.objs.set(id, e);
    this.list.push(e);
    this.defs().o.push(d);
    return id;
  }

  // What the walk remembers about a scene node between frames: the transform it last composed.
  node(o) {
    const n = {
      px: NaN, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 0, sx: 0, sy: 0, sz: 0,
      par: o.parent, hid: false, fresh: true, e: null,
      rend: !!((o.isMesh || o.isSprite || o.isLineSegments) && o.material && !Array.isArray(o.material)),
    };
    o.__mn = n;
    return n;
  }

  // One node: update its world matrix if it (or a parent) moved, send what changed, then its children.
  walk(o, parentVis, parentMoved) {
    let n = o.__mn;
    if (n === undefined) n = this.node(o);
    const vis = parentVis && o.visible, all = this.all;
    // A branch that was already fully hidden last frame has nothing to do.
    if (!vis && n.hid && !all) return;
    let moved = parentMoved || n.hid || n.fresh;
    n.fresh = false;
    if (o.parent !== n.par) { n.par = o.parent; moved = true; }
    if (o.matrixAutoUpdate) {
      const p = o.position, q = o.quaternion, s = o.scale;
      if (p.x !== n.px || p.y !== n.py || p.z !== n.pz || q._x !== n.qx || q._y !== n.qy || q._z !== n.qz || q._w !== n.qw || s.x !== n.sx || s.y !== n.sy || s.z !== n.sz) {
        n.px = p.x; n.py = p.y; n.pz = p.z; n.qx = q._x; n.qy = q._y; n.qz = q._z; n.qw = q._w; n.sx = s.x; n.sy = s.y; n.sz = s.z;
        o.matrix.compose(p, q, s);
        moved = true;
      }
    }
    if (o.matrixWorldNeedsUpdate) moved = true;
    if (moved) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      o.matrixWorldNeedsUpdate = false;
    }
    if (n.rend) {
      let e = n.e;
      if (e === null) {
        let id = this.ids.get(o);
        if (!id || !this.objs.has(id)) id = this.defineObject(o);
        e = n.e = this.objs.get(id);
      }
      e.stamp = this.seen;
      if (moved) e.dirty = true;
      const m = o.matrixWorld.elements;
      let near = all || e.always;
      if (!near) {
        const dx = m[12] - this.cx, dy = m[13] - this.cy, dz = m[14] - this.cz;
        near = dx * dx + dy * dy + dz * dz <= FAR2;
      }
      if (near || (!vis && e.vis !== 0)) this.report(o, e, vis, all);
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this.walk(ch[i], vis, moved);
    n.hid = !vis;
  }

  // An object near the camera (or one just hidden): material swaps, visibility, transform, instance buffer.
  report(o, e, vis, all) {
    // A climber changing skins swaps materials on existing objects.
    if (o.material !== e.mat) {
      e.mat = o.material;
      const mid = this.defineMaterial(o.material);
      e.me = this.mats.get(mid);
      this.au.push('m,' + e.id + ',' + mid);
    }
    const v = vis ? 1 : 0, shown = v === 1 && e.vis !== 1;
    if (v === 1) e.me.used = this.seen;
    if (v !== e.vis || (v === 1 && e.dirty)) {
      const om = this.om;
      om.push(e.id, v);
      if (v === 1) {
        // Directly under the scene, the world transform is simply the object's own.
        const par = o.parent;
        if (o.matrixAutoUpdate && par !== null && par.parent === null) {
          const p = o.position, q = o.quaternion, s = o.scale;
          om.push(n3(p.x), n3(p.y), n3(p.z), n4(q._x), n4(q._y), n4(q._z), n4(q._w), n3(s.x), n3(s.y), n3(s.z));
        } else {
          o.matrixWorld.decompose(_p, _q, _s);
          om.push(n3(_p.x), n3(_p.y), n3(_p.z), n4(_q.x), n4(_q.y), n4(_q.z), n4(_q.w), n3(_s.x), n3(_s.y), n3(_s.z));
        }
        e.dirty = false;
      }
      e.vis = v;
    }
    // Instance buffers (drifting debris) only need ~15 updates a second.
    // Flagged ones (spinning coins) get every second frame.
    if (o.isInstancedMesh && o.instanceMatrix.version !== e.imv && (all || (v === 1 && (shown || this.seen % (o.userData.fastIM ? 2 : 4) === 0)))) {
      const b = e.bs, far = b && Math.hypot(b[0] - this.cx, b[1] - this.cy, b[2] - this.cz) - b[3] > FAR;
      if (all || !far) { e.imv = o.instanceMatrix.version; this.au.push('o,' + e.id + ',im,' + b64(o.instanceMatrix.array)); }
    }
  }

  // Sends a material's values if any changed, as a list of only those when that is shorter.
  // "id,n,v,v,v..." is all of them, "id,-c,i,v,i,v..." is c single values (mostly a shader's time).
  sendMat(e) {
    const k = this.fillMat(e), cur = e.cur, last = e.last, ch = this.changed;
    let c = 0;
    for (let i = 0; i < k; i++) {
      let r = Math.round(cur[i] * 1e4);
      if (r !== r) r = 0;
      if (r !== last[i]) { last[i] = r; ch[c++] = i; }
    }
    if (c === 0) return;
    const ou = this.ou;
    if (c * 2 < k) {
      ou.push(e.id, -c);
      for (let i = 0; i < c; i++) ou.push(ch[i], last[ch[i]] / 1e4);
    } else {
      ou.push(e.id, k);
      for (let i = 0; i < k; i++) ou.push(last[i] / 1e4);
    }
  }

  // One frame: update what moved, find what changed nearby, send definitions first, then the frame.
  // Frame text (one section per line, parsed in place by NRender without allocating; a section with nothing
  // new is left out and the native side keeps what it has):
  //   h:<env>  c:<view16,proj16,camPos3>  o:<id,vis[,px,py,pz,qx,qy,qz,qw,sx,sy,sz]>...  u:<materials, see sendMat>
  //   a:<g|o|r|m>,id,name-or-start,payload;...
  sync(scene, camera, env) {
    camera.updateMatrixWorld();
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, all = !!this.forceAll;
    this.forceAll = false;
    this.all = all;
    this.cx = cx; this.cy = cy; this.cz = cz;
    const om = this.om, ou = this.ou, au = this.au;
    om.length = 0; ou.length = 0; au.length = 0;
    const stamp = ++this.seen;
    this.walk(scene, true, false);
    // Objects removed from the scene since last frame are hidden on the native side.
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.stamp !== stamp && e.vis !== 0) { om.push(e.id, 0); e.vis = 0; }
    }
    // Animated materials: those in use near the camera every frame, the others a few times a second.
    const mats = all ? this.matList : this.live;
    for (let i = 0; i < mats.length; i++) {
      const e = mats[i];
      if (all || e.used === stamp || ((stamp + i) & 7) === 0) this.sendMat(e);
    }
    const geos = this.geoList;
    for (let i = 0; i < geos.length; i++) {
      const e = geos[i], g = e.geo, as = e.attrs, dr = g.drawRange;
      for (let j = 0; j < as.length; j++) {
        const w = as[j], a = g.attributes[w.name];
        if (a.version !== w.ver) { w.ver = a.version; au.push('g,' + e.id + ',' + w.name + ',' + b64(f32(a.array))); }
      }
      if (dr.start !== e.ds || dr.count !== e.dc) {
        e.ds = dr.start; e.dc = dr.count;
        au.push('r,' + e.id + ',' + dr.start + ',' + (isFinite(dr.count) ? dr.count : -1));
      }
    }
    if (this.def) { this.send('def', JSON.stringify(this.def)); this.def = null; }
    let msg = '';
    // Lights and fog: only when something changed.
    const el = this.envLast, eo = this.envOut;
    let ech = el.length !== env.length;
    for (let i = 0; i < env.length; i++) {
      const r = Math.round(env[i] * 1e4);
      if (r !== el[i]) { el[i] = r; ech = true; }
      eo[i] = r / 1e4;
    }
    if (ech) msg += 'h:' + eo.join() + '\n';
    // The camera: only when it moved.
    const v = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements, cl = this.camLast, co = this.camOut;
    let cch = false;
    for (let i = 0; i < 16; i++) { const a = n4(v[i]), b = n4(p[i]); co[i] = a; co[16 + i] = b; if (a !== cl[i] || b !== cl[16 + i]) { cl[i] = a; cl[16 + i] = b; cch = true; } }
    co[32] = n3(cx); co[33] = n3(cy); co[34] = n3(cz);
    if (co[32] !== cl[32] || co[33] !== cl[33] || co[34] !== cl[34]) { cl[32] = co[32]; cl[33] = co[33]; cl[34] = co[34]; cch = true; }
    if (cch) msg += 'c:' + co.join() + '\n';
    if (om.length) msg += 'o:' + om.join() + '\n';
    if (ou.length) msg += 'u:' + ou.join() + '\n';
    if (au.length) msg += 'a:' + au.join(';') + '\n';
    this.bytes = msg.length;
    this.send('frame', msg);
  }
}
