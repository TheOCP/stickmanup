"""Record the native-renderer stream (?native=rec) for a scene, so dev/desk can replay it through NRender.
Usage: python dev/record.py OUTDIR [title|zoneN|jump|coins|tree|shop:SUIT:FACE:HAT[:yaw]] [map id] [player name]  (also saves a three.js reference screenshot)"""
import functools, http.server, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for f in out.glob("*.json"): f.unlink()
scene = sys.argv[2] if len(sys.argv) > 2 else "title"
MAP = int(sys.argv[3]) if len(sys.argv) > 3 else 0
NAME = sys.argv[4] if len(sys.argv) > 4 else "Ana"
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
SETUP = """(z) => { const g = SMU.game, c = SMU.level.cols.filter(c => c.zone === z && c.kind === 'plat')[6];
  g.me.spawn(c.x, c.y + c.hy + 0.6, c.z); g.cam.yaw = Math.PI - Math.atan2(c.z, c.x) + 0.4; g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z; }"""
# Next to the lowest dummy on Hardcore, looking at it.
JUMP = """() => { const g = SMU.game, L = SMU.level, j = L.jumpers.filter(j => g.storm.on(j)).sort((a, b) => a.y - b.y)[0], x = j.x + 1.6, z = j.z;
  g.me.spawn(x, j.y + 0.6, z); g.me.vx = g.me.vz = 0; g.cam.yaw = Math.atan2(x - j.x, z - j.z); g.cam.pitch = 0.25; g.cam.x = x; g.cam.y = j.y + 1.2; g.cam.z = z; }"""
# On the sunny side of the first side tree that floats, low on its climb, looking in at the trunk and down at the roots.
TREE = """() => { const g = SMU.game, L = SMU.level, t = L.trees.find(t => t.base > 0);
  const dot = (c) => ((c.x - t.x) * 0.83 + (c.z - t.z) * 0.55) / Math.hypot(c.x - t.x, c.z - t.z);
  const c = L.cols.filter(c => c.kind === 'plat' && Math.hypot(c.x - t.x, c.z - t.z) < 10 && c.y > t.base && c.y < t.y0 + 14).sort((a, b) => dot(b) - dot(a))[0];
  const y = c.y + c.hy + 0.6;
  g.me.spawn(c.x, y, c.z); g.me.vx = g.me.vz = g.me.vy = 0; g.cam.yaw = Math.atan2(c.x - t.x, c.z - t.z); g.cam.pitch = 0.5; g.cam.x = c.x; g.cam.y = y + 0.8; g.cam.z = c.z; }"""
# Near the first line of coins.
COINS = """() => { const g = SMU.game, c = SMU.level.coins[2], a = Math.atan2(c.z, c.x) + 0.3, x = Math.cos(a) * 12.4, z = Math.sin(a) * 12.4;
  g.me.spawn(x, c.y, z); g.cam.yaw = Math.atan2(x - c.x, z - c.z) - 0.25; g.cam.pitch = 0.15; g.cam.x = x; g.cam.y = c.y + 0.6; g.cam.z = z; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for mode in ("rec", "ref"):
        pg = b.new_page(viewport={"width": 915, "height": 412})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:300]))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify(Object.assign({quality:'high', map:%d, name:%r}, %s)))" % (MAP, NAME, os.environ.get('REC_SET', '{}')))
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html" + ("?native=rec" if mode == "rec" else ""))
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
        if scene.startswith("zone"):
            pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']")
            pg.evaluate(SETUP, int(scene[4:]) - 1)
        elif scene in ("jump", "coins", "tree"):
            pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='%d']" % (2 if scene == "jump" else 1))
            pg.wait_for_timeout(600)
            pg.evaluate({"jump": JUMP, "coins": COINS, "tree": TREE}[scene])
        elif scene.startswith("shop:"):
            q = scene.split(":")
            pg.click("[data-a=shop]"); pg.wait_for_timeout(300)
            pg.evaluate("(a) => { SMU.preview = { look: { s: a[0], f: a[1], h: a[2] }, yaw: a[3] }; }", [q[1], q[2], q[3], float(q[4]) if len(q) > 4 else 0])
        pg.wait_for_timeout(700 if scene in ("jump", "tree") else 2500)
        if mode == "rec":
            pg.evaluate("document.getElementById('menu').style.display = 'none'")
            # Reset and render in one go so the saved frame holds the complete state, not a delta.
            delta = pg.evaluate("SMU.renderer.mirror.bytes")
            if scene.startswith("shop:"):
                # Hold the turn so the picture faces the way that was asked for.
                pg.evaluate("(a) => { SMU.preview.yaw = a - 0.02; }", float(scene.split(":")[4]) if len(scene.split(":")) > 4 else 0)
                pg.wait_for_timeout(120)
            look = """(scene) => { const g = SMU.game, R = SMU.renderer, cam = R.camera; let t = null, info = '';
                  if (scene === 'jump') { const e = [...g.jrigs][0]; info = e ? 'dummy rigs ' + g.jrigs.size + ', state ' + e[0].st + ', visible ' + e[1].g.visible : 'NO DUMMY AWAKE'; if (e) { t = e[1].g.position.clone(); t.y += 0.3; } }
                  else if (scene === 'coins') { const c = SMU.level.coins[2]; t = cam.position.clone().set(c.x, c.y, c.z); info = 'coins drawn ' + SMU.pool.coins.near.length; }
                  if (t) { const r = Math.hypot(t.x, t.z) || 1, ox = t.x / r, oz = t.z / r; cam.position.set(t.x + ox * 3 + oz * 0.6, t.y + 0.5, t.z + oz * 3 - ox * 0.6); cam.lookAt(t); cam.updateMatrixWorld(); }
                  R.mirror.reset(); R.render(); window.REC.info = info; return window.REC; }"""
            rec = pg.evaluate(look, scene)
            print("looking at:", rec.get("info"))
            print("normal per-frame message:", delta, "bytes")
            for i, d in enumerate(rec["defs"]):
                (out / f"{i:04d}-def.json").write_text(d)
            (out / "9999-frame.json").write_text(rec["frame"])
            print("recorded", len(rec["defs"]), "def batches,", sum(len(d) for d in rec["defs"]) // 1024, "KB defs,", len(rec["frame"]) // 1024, "KB frame; errors:", errs[:3] or "none")
        else:
            pg.evaluate("document.getElementById('menu').style.display = 'none'")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out.parent / f"ref-{scene}-m{MAP}.png"))
        pg.close()
    b.close()
srv.shutdown()
