"""Where a frame's CPU time goes on this phone, map by map (the same code path as the Android app, without WebGL).

Usage: python dev/perf.py [maps, e.g. 0,5] [seconds per spot]
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
MAPS = [int(x) for x in sys.argv[1].split(",")] if len(sys.argv) > 1 else [0, 5]
SECS = float(sys.argv[2]) if len(sys.argv) > 2 else 6

INSTRUMENT = """() => {
  const T = window.PT = { s: {}, frames: 0, gaps: [], last: 0, heap0: performance.memory ? performance.memory.usedJSHeapSize : 0 };
  const wrap = (o, name, tag) => { const f = o[name]; if (!f) return; o[name] = function (...a) { const t = performance.now(), r = f.apply(this, a); T.s[tag] = (T.s[tag] || 0) + performance.now() - t; return r; }; };
  const g = SMU.game, R = SMU.renderer;
  wrap(g, 'update', '1 game total');
  wrap(g, 'step', '2 physics step');
  wrap(g, 'draw', '3 game draw');
  wrap(SMU.view, 'update', '4 world update');
  wrap(SMU.pool.coins, 'update', '5 coins');
  wrap(R, 'update', '6 renderer update');
  wrap(R, 'render', '7 render total');
  wrap(R.mirror, 'sync', '8 mirror sync');
  wrap(R.mirror, 'send', '9 send to native');
  wrap(SMU.ui, 'hud', 'a hud');
  wrap(SMU.ui, 'tags', 'b tags');
  wrap(SMU.ui, 'tips', 'c tips');
  const tick = (now) => { T.frames++; if (T.last) T.gaps.push(now - T.last); T.last = now; T.raf = requestAnimationFrame(tick); };
  T.raf = requestAnimationFrame(tick);
  let bytes = 0; const send = R.mirror.send; R.mirror.send = function (k, d) { bytes += d.length; T.bytes = bytes; return send.call(this, k, d); };
}"""
RESULT = """() => { const T = window.PT, n = Math.max(1, T.frames); cancelAnimationFrame(T.raf);
  const out = {}; for (const k of Object.keys(T.s).sort()) out[k] = +(T.s[k] / n).toFixed(2);
  const g = [...T.gaps].sort((a, b) => a - b);
  return { frames: T.frames, perFrame: out, kbPerFrame: +((T.bytes || 0) / n / 1024).toFixed(1), gap50: +g[g.length >> 1].toFixed(1), gap99: +g[Math.floor(g.length * 0.99)].toFixed(1), heapMB: performance.memory ? +((performance.memory.usedJSHeapSize) / 1048576).toFixed(0) : 0 }; }"""
SCENE = """() => { const M = SMU.renderer.mirror; let total = 0, vis = 0, inst = 0, tris = 0, live = M.live.length; const big = [];
  for (const e of M.objs.values()) { total++; const o = e.obj; if (e.vis === 1) { vis++; if (o.isInstancedMesh) inst++; const g = o.geometry; if (g) { const n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); tris += n; big.push([Math.round(n), o.material && o.material.type, o.isInstancedMesh ? o.count : 1]); } } }
  big.sort((a, b) => b[0] - a[0]);
  let nodes = 0; SMU.renderer.scene.traverse(() => nodes++);
  return { sceneNodes: nodes, mirrored: total, sentVisible: vis, instanced: inst, liveMaterials: live, trisIfAllDrawn: Math.round(tris), biggest: big.slice(0, 6) }; }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing", "--enable-precise-memory-info"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for m in MAPS:
        pg = b.new_page(viewport={"width": 915, "height": 412})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d, name:'Ana', cap:60}))" % m)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html?native=rec")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
        pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']"); pg.wait_for_timeout(1000)
        for label, frac in (("low", 0.12), ("mid", 0.5), ("high", 0.85)):
            pg.evaluate("""(f) => { const g = SMU.game, L = SMU.level, y = 2 + (L.top - 2) * f, c = L.cols.filter(c => c.kind === 'plat' && Math.abs(c.y - y) < 40)[0]; if (c) { g.me.spawn(c.x, c.y + c.hy + 0.6, c.z); g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z; g.cam.yaw = Math.PI - Math.atan2(c.z, c.x); } }""", frac)
            pg.wait_for_timeout(1200)
            pg.evaluate(INSTRUMENT)
            pg.wait_for_timeout(int(SECS * 1000))
            r = pg.evaluate(RESULT)
            print(f"map {m} {label}:", json.dumps(r))
        print("  scene:", json.dumps(pg.evaluate(SCENE)))
        if errs: print("  errors:", errs[:3])
        pg.close()
    b.close()
