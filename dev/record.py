"""Record the native-renderer stream (?native=rec) for a scene, so dev/desk can replay it through NRender.
Usage: python dev/record.py OUTDIR [title|zoneN] [map id]  (also saves a three.js reference screenshot)"""
import functools, http.server, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for f in out.glob("*.json"): f.unlink()
scene = sys.argv[2] if len(sys.argv) > 2 else "title"
MAP = int(sys.argv[3]) if len(sys.argv) > 3 else 0
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
SETUP = """(z) => { const g = SMU.game, c = SMU.level.cols.filter(c => c.zone === z && c.kind === 'plat')[6];
  g.me.spawn(c.x, c.y + c.hy + 0.6, c.z); g.cam.yaw = Math.PI - Math.atan2(c.z, c.x) + 0.4; g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for mode in ("rec", "ref"):
        pg = b.new_page(viewport={"width": 915, "height": 412})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:300]))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d}))" % MAP)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html" + ("?native=rec" if mode == "rec" else ""))
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
        if scene.startswith("zone"):
            pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']")
            pg.evaluate(SETUP, int(scene[4:]) - 1)
        pg.wait_for_timeout(2500)
        if mode == "rec":
            pg.evaluate("document.getElementById('menu').style.display = 'none'")
            # Reset and render in one go so the saved frame holds the complete state, not a delta.
            delta = pg.evaluate("SMU.renderer.mirror.bytes")
            rec = pg.evaluate("(() => { SMU.renderer.mirror.reset(); SMU.renderer.render(); return window.REC; })()")
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
