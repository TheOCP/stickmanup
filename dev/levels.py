"""Render the title and a gameplay frame at every graphics safety level (0 full .. 4 bare minimum)."""
import functools, http.server, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = Path(__file__).resolve().parent / "out"
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for lvl in range(5):
        pg = b.new_page(bypass_csp=True, viewport={"width": 915, "height": 412})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:200]))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', gfxSafe:%d}))" % lvl)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
        pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']")
        pg.evaluate("""(() => { const g = SMU.game, c = SMU.level.cols.filter(c => c.zone === 2 && c.kind === 'plat')[6];
          g.me.spawn(c.x, c.y + c.hy + 0.6, c.z); g.cam.yaw = Math.PI - Math.atan2(c.z, c.x) + 0.4; g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z; })()""")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=str(OUT / f"level{lvl}.png"))
        info = pg.evaluate("[SMU.renderer.safe, !!SMU.renderer.composer, SMU.renderer.q.shadow, SMU.renderer.r.getPixelRatio().toFixed(2), SMU.renderer.rain.visible, SMU.renderer.sky.visible]")
        print(f"level {lvl}: [safe, bloom, shadow, dpr, rain, sky] = {info}", "errors:", errs[:2] or "none", flush=True)
        pg.close()
    b.close()
srv.shutdown()
