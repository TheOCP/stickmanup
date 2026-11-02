"""Pictures of every emote halfway through, in the shop, and of a dash gap and a wall jump shaft in a real climb, drawn
with WebGL. For looking at. Usage: python dev/emoteshots.py OUTDIR [map id]"""
import base64, functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "dev/out/emoteshots"); out.mkdir(parents=True, exist_ok=True)
MAP = int(sys.argv[2]) if len(sys.argv) > 2 else 1
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    pg = b.new_page(viewport={"width": 915, "height": 412})
    pg.on("pageerror", lambda e: print("ERROR", e))
    pg.add_init_script("""localStorage.setItem('smu.settings', JSON.stringify({ quality: 'high', map: %d, name: 'Ana', tips: false, cap: 30 }));
      localStorage.setItem('smu.profile', JSON.stringify({ coins: 99999, earned: 0, own: [], eq: null, relics: [], ach: [], runs: {}, totals: {} }));""" % MAP)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
    pg.wait_for_function("window.SMU && SMU.pool", timeout=180000)
    pg.wait_for_timeout(1500)
    pg.locator("[data-a=shop]").first.click(); pg.wait_for_timeout(500)
    pg.locator("[data-a=tab][data-t=emotes]").first.click(); pg.wait_for_timeout(500)
    ids = pg.evaluate("[...document.querySelectorAll('#menu .skin')].map(e => e.dataset.id)")
    shots = []
    for id in ids:
        pg.locator(f"[data-a=pick][data-id={id}]").first.click()
        # Stop the turntable so every picture is taken from the same side, then wait for the middle of it.
        pg.evaluate("(() => { const P = SMU.preview; P.yaw = 0.55; Object.defineProperty(P, 'yaw', { get: () => 0.55, set: () => {} }); })()")
        info = pg.evaluate("""(() => new Promise((res) => { const r = SMU.pool.robots[0]; const e = r.emote; const want = e && !e.loop ? e.dur * 0.45 : 1.1;
          const go = () => { if (r.emote && r.emoteT >= want) res(r.emote.id); else if (performance.now() - t0 > 12000) res('timeout'); else requestAnimationFrame(go); }; const t0 = performance.now(); go(); }))()""")
        shots.append(id)
        pg.screenshot(path=str(out / f"pose-{id}.png"), clip={"x": 0, "y": 20, "width": 360, "height": 300})
    cells = "".join(f'<div style="position:relative;width:216px;height:180px;overflow:hidden"><img src="data:image/png;base64,{base64.b64encode((out / f"pose-{i}.png").read_bytes()).decode()}" style="width:216px"><b style="position:absolute;left:4px;top:2px;color:#ff0;font:12px sans-serif;text-shadow:0 0 3px #000">{i[2:]}</b></div>' for i in shots)
    q = b.new_page(viewport={"width": 1296, "height": 182 * ((len(shots) + 5) // 6)})
    q.set_content(f'<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(6,216px)">{cells}</body>'); q.wait_for_timeout(300)
    q.screenshot(path=str(out / "sheet.png")); q.close()
    pg.locator("[data-a=back]").first.click(); pg.wait_for_timeout(500)
    pg.locator("[data-a=solo]").first.click(); pg.wait_for_timeout(500)
    pg.evaluate("document.querySelector('.card.d3').scrollIntoView({ block: 'center' })"); pg.wait_for_timeout(200)
    pg.screenshot(path=str(out / "diff.png"))
    pg.locator(".card.d1").first.click()
    pg.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    pg.wait_for_timeout(5000)
    pg.add_style_tag(content="#zoneTitle, #touch { display: none !important; }")
    pg.evaluate("SMU.settings.camFollow = 0")
    def go(js, name):
        pg.evaluate(js); pg.wait_for_timeout(3500); pg.screenshot(path=str(out / name))
    Q = "SMU.level.moves.filter(q => q.k === 'chimney')[%d]" % (int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    go("""(() => { const g = SMU.game, m = SMU.level.moves.filter(q => q.k === 'dash')[1]; g.me.spawn(m.ax, m.ay + 0.5, m.az); g.cam.yaw = Math.atan2(-m.ux, -m.uz) + 0.5; g.cam.pitch = 0.3; })()""", "dash-gap.png")
    go("(() => { const g = SMU.game, m = %s; g.me.spawn(m.fx, m.y + 0.5, m.fz); g.cam.yaw = Math.atan2(m.ox, m.oz); g.cam.pitch = 0.1; })()" % Q, "shaft-front.png")
    go("(() => { const g = SMU.game, m = %s; g.me.spawn(m.ax, m.ay + 0.5, m.az); g.cam.yaw = Math.atan2(m.ox - m.nx * 0.5, m.oz - m.nz * 0.5); g.cam.pitch = 0.2; })()" % Q, "shaft-before.png")
    go("(() => { const g = SMU.game, m = %s; g.me.spawn(m.tx, m.ty + 0.5, m.tz); g.cam.yaw = Math.atan2(m.ox + m.nx, m.oz + m.nz); g.cam.pitch = 0.3; })()" % Q, "shaft-top.png")
    b.close()
