"""Pictures from straight above each map's start, to check the walkways and fountains. Usage: python dev/topdown.py OUTDIR"""
import functools, http.server, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"], env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for m in range(6):
        pg = b.new_page(bypass_csp=True, viewport={"width": 700, "height": 700})
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d, name:'Ana'}))" % m)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
        print(m, pg.evaluate("""(async () => { const THREE = await import('three'); const { PIERS, onPier } = await import('./js/level.js').catch(() => ({})); const L = SMU.level, R = SMU.renderer, cam = R.camera, o = R.render.bind(R);
          document.getElementById('menu').style.display = 'none';
          R.render = (...a) => { cam.position.set(0, 62, 0.01); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.fov = 50; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); return o(...a); };
          for (const r of SMU.pool.robots) r.g.visible = false;
          const fx = (L.decor || []).filter((d) => d.k === 'fountain').length; return { key: L.mapKey, fountains: fx, piers: L.cols.filter((c) => c.pier).length }; })()"""))
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT / f"top{m}.png"))
        pg.close()
    b.close()
