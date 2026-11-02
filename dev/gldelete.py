"""Counts WebGL delete* calls during play. Pixel 10 PowerVR drivers crash when GPU objects are deleted at
runtime, so after startup this must stay at zero (three.js deleting shader *sources* after linking is fine)."""
import functools, http.server, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
HOOK = """(() => {
  window.GLDEL = {};
  const P = WebGL2RenderingContext.prototype;
  for (const k of ['deleteProgram', 'deleteShader', 'deleteBuffer', 'deleteTexture', 'deleteFramebuffer', 'deleteRenderbuffer', 'deleteVertexArray']) {
    const f = P[k];
    P[k] = function (...a) { if (window.GLCOUNT) GLDEL[k] = (GLDEL[k] || 0) + 1; return f.apply(this, a); };
  }
})()"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    pg = b.new_page(bypass_csp=True, viewport={"width": 640, "height": 300})
    pg.add_init_script(HOOK)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
    pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
    pg.evaluate("window.GLCOUNT = true")
    # Force several lightning bolts on the title screen, then play a climb, quit, and start another.
    pg.evaluate("for (let i = 0; i < 8; i++) SMU.renderer.bolt(20 + i, 0, 30, 2)")
    pg.wait_for_timeout(4000)
    pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']")
    pg.wait_for_timeout(4000)
    pg.evaluate("for (let i = 0; i < 8; i++) SMU.renderer.bolt(SMU.game.me.x + 30, 0, SMU.game.me.z, 2)")
    pg.wait_for_timeout(3000)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400); pg.click("[data-a=quit]"); pg.wait_for_timeout(1500)
    pg.click("[data-a=cont]"); pg.wait_for_timeout(4000)
    print("delete calls after startup:", pg.evaluate("GLDEL") or "none", "| still running:", pg.evaluate("!!SMU.game && SMU.game.time > 0"))
    b.close()
srv.shutdown()
