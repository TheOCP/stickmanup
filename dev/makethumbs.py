"""The shop's pictures, rendered from the real 3D climber and weapons, so they look exactly like what you wear.

Every suit, hat, hair, face and weapon is put on (or in front of) the game's own Stickman with the game's materials,
rendered with three.js in a headless browser, cropped to what was drawn and saved as assets/thumbs/<kind>-<id>.webp.
assets/js/thumbs.js lists them for shop.js (anything not listed is still drawn the old way). Rerun after adding or
changing a look:  /root/.pwvenv/bin/python dev/makethumbs.py   (needs Vulkan: lavapipe on this machine)
"""
import base64, functools, hashlib, http.server, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = ROOT / "thumbs"
W, H = 144, 180  # shown at 60 x 75 on the card, so sharp up to a screen scale of 2.4

PAGE = r"""
async ({ W, H }) => {
  const THREE = await import('three');
  const { Stickman } = await import('./js/stickman.js');
  const K = await import('./js/skins.js');
  const Gr = await import('./js/gear.js');
  const { WEAPONS } = await import('./js/weapons.js');
  const { F } = await import('./js/player.js');
  const SS = 4, cw = W * SS, ch = H * SS;
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(cw, ch, false);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(20, cw / ch, 0.05, 60);
  scene.add(cam, new THREE.HemisphereLight(0xeef4ff, 0x404a5a, 1.35));
  // Lights that move with the camera: a key light from up and to the right, a cool rim from behind on the left.
  const key = new THREE.DirectionalLight(0xffffff, 2.5), rim = new THREE.DirectionalLight(0xa8dcff, 1.3);
  key.position.set(2.2, 2.6, 1.2); rim.position.set(-2.4, 1.4, -4.5);
  cam.add(key, rim);
  const man = new Stickman(scene, 0);
  if (!man.g.parent) scene.add(man.g);
  const props = new THREE.Group();
  scene.add(props);
  const full = document.createElement('canvas'); full.width = cw; full.height = ch;
  const fg = full.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const og = out.getContext('2d');
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // Visible meshes only (the climber keeps hidden hats and guns around).
  const boxOf = (root) => {
    const b = new THREE.Box3(), t = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); t.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); b.union(t); } });
    return b;
  };
  // A view from azimuth az (0 is in front) and elevation el, far enough that everything fits; the crop does the rest.
  const shoot = (b, az, el, bottom) => {
    const c = b.getCenter(V()), s = b.getSize(V()), rad = s.length() / 2;
    const d = (rad * 1.25) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.position.set(c.x + Math.sin(az) * Math.cos(el) * d, c.y + Math.sin(el) * d, c.z + Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(c);
    cam.updateMatrixWorld(true);
    r.render(scene, cam);
    fg.clearRect(0, 0, cw, ch);
    fg.drawImage(canvas, 0, 0);
    const px = fg.getImageData(0, 0, cw, ch).data;
    let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (px[(y * cw + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    og.clearRect(0, 0, W, H);
    if (x1 < 0) return null;
    // Fit what was drawn with a small margin, centred; a whole climber stands on the bottom margin.
    const m = 0.05, bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((W * (1 - 2 * m)) / bw, (H * (1 - 2 * m)) / bh);
    const dw = bw * k, dh = bh * k, dx = (W - dw) / 2, dy = bottom ? H * (1 - m) - dh : (H - dh) / 2;
    og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
    // Down in two steps so thin lines stay smooth.
    const mid = document.createElement('canvas'); mid.width = Math.max(1, Math.round(dw * 2)); mid.height = Math.max(1, Math.round(dh * 2));
    const mg = mid.getContext('2d'); mg.imageSmoothingQuality = 'high';
    mg.drawImage(full, x0, y0, bw, bh, 0, 0, mid.width, mid.height);
    og.drawImage(mid, 0, 0, mid.width, mid.height, dx, dy, dw, dh);
    return out.toDataURL('image/webp', 0.86);
  };
  const pose = (L) => {
    L.weapon = null; L.key += '|shop';
    man.lookKey = null;
    man.setLook(L);
    // Standing still: no blink and none of the idle moods (a wave, a stretch).
    man.blinkT = 99; man.t = 0; man.idleAct = null; man.idleT = 0; man.idleNext = 1e9;
    for (let i = 0; i < 45; i++) man.update(1 / 60, 0, 0, 0, 0, 0, 0, F.GROUND, 0, -0.9, undefined);
    man.blinkT = 99;
    if (man.trail) man.trailVis(man.trail, false);
    if (man.blob) man.blob.visible = false;
  };
  const res = {};
  man.g.visible = true;
  for (const S of K.ALL_SUITS) {
    pose(K.resolveLook({ s: S.id }, S.team ? S.team[0] : undefined));
    res['suit:' + S.id] = shoot(boxOf(man.g), 0.5, 0.1, true);
  }
  // Hats, hair and faces: the head alone, with what it wears, as big as the card allows.
  const headShot = (az, el) => {
    const keep = new Set(), was = new Map();
    man.head.traverse((o) => keep.add(o));
    man.g.traverse((o) => { if (o.isMesh && !keep.has(o)) { was.set(o, o.visible); o.visible = false; } });
    const u = shoot(boxOf(man.head), az, el, false);
    for (const [o, v] of was) o.visible = v;
    return u;
  };
  for (const h of K.HATS) { pose(K.resolveLook({ s: K.FREE_SUIT, h: h.id })); res['hat:' + h.id] = headShot(0.55, 0.28); }
  for (const h of K.HAIRS) { pose(K.resolveLook({ s: K.FREE_SUIT, r: h.id })); res['hair:' + h.id] = headShot(0.75, 0.22); }
  for (const f of K.FACES) { pose(K.resolveLook({ s: K.FREE_SUIT, f: f.id })); res['face:' + f.id] = headShot(0.22, 0.06); }
  // Weapons on their own, barrel to the right, seen a little from above and in front.
  man.hide ? man.hide() : (man.g.visible = false);
  man.g.visible = false;
  for (const w of WEAPONS) {
    props.clear();
    const m = new THREE.Mesh(Gr.gearGeo(w.id), Gr.gearMat()), info = Gr.gunInfo(w.id);
    if (info.spin) { const sp = new THREE.Mesh(Gr.gearGeo(info.spin), Gr.gearMat()); sp.position.set(info.spinAt[0], info.spinAt[1], info.spinAt[2]); m.add(sp); }
    props.add(m);
    res['weapon:' + w.id] = shoot(boxOf(props), -1.2, 0.3, false);
  }
  return res;
}
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist"],
                              env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
        pg = b.new_page(bypass_csp=True, viewport={"width": 640, "height": 400})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', name:'Ana', tips:false}))")
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
        res = pg.evaluate(PAGE, {"W": W, "H": H})
        b.close()
    if errors:
        print("page errors:", errors[:5])
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    have, h = [], hashlib.sha1()
    for k in sorted(res):
        if not res[k]:
            print("nothing drawn for", k)
            continue
        data = base64.b64decode(res[k].split(",", 1)[1])
        kind, i = k.split(":", 1)
        (OUT / f"{kind}-{i}.webp").write_bytes(data)
        h.update(k.encode() + data)
        have.append(k)
    keys = ", ".join(f"'{k}'" for k in have)
    (ROOT / "js" / "thumbs.js").write_text(
        "// Written by dev/makethumbs.py: the shop pictures rendered from the 3D climber and weapons (assets/thumbs).\n"
        f"export const THUMB_V = '{h.hexdigest()[:10]}';\nexport const THUMB_HAVE = new Set([{keys}]);\n")
    size = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"{len(have)} pictures, {size // 1024} KB")


main()
