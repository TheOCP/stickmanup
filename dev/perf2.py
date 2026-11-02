"""What the page really spends per frame: script, style, layout, paint, plus what is inside the message to native.

Usage: python dev/perf2.py [map] [seconds]
"""
import functools, http.server, json, os, sys, threading, collections
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
M = int(sys.argv[1]) if len(sys.argv) > 1 else 0
SECS = float(sys.argv[2]) if len(sys.argv) > 2 else 6
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing", "--enable-precise-memory-info"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    ctx = b.new_context(bypass_csp=True, viewport={"width": 915, "height": 412})
    pg = ctx.new_page()
    pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d, name:'Ana', cap:60, fps:true}))" % M)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html?native=rec")
    pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
    pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']"); pg.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(pg); cdp.send("Performance.enable")
    def metrics(): return {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
    pg.evaluate("""() => { window.PM = { n: 0, sec: { h: 0, c: 0, o: 0, u: 0, a: 0 }, aKinds: {}, oIds: 0, uMats: 0, tot: 0, gc0: performance.memory.usedJSHeapSize, drops: 0, peak: 0, t: 0, gaps: [] };
      const R = SMU.renderer.mirror, s = R.send, P = window.PM; R.send = function (k, d) { if (k === 'frame') { P.n++; P.tot += d.length; for (const l of d.split('\\n')) { const c = l[0]; if (P.sec[c] !== undefined) P.sec[c] += l.length; if (c === 'a' && l.length > 2) for (const e of l.slice(2).split(';')) { const kk = e.slice(0, e.indexOf(',')) + ':' + e.split(',')[1]; P.aKinds[kk] = (P.aKinds[kk] || 0) + e.length; } } } return s.call(this, k, d); };
      const tick = (now) => { if (P.t) P.gaps.push(now - P.t); P.t = now; const h = performance.memory.usedJSHeapSize; if (h < P.peak - 200000) P.drops++; P.peak = h; requestAnimationFrame(tick); }; requestAnimationFrame(tick); P.h0 = performance.memory.usedJSHeapSize; }""")
    m0 = metrics(); f0 = pg.evaluate("window.PM.n")
    pg.wait_for_timeout(int(SECS * 1000))
    m1 = metrics()
    r = pg.evaluate("""() => { const P = window.PM, top = Object.entries(P.aKinds).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v / P.n)]); const g = P.gaps.slice().sort((a,b)=>a-b);
      return { frames: P.n, bytesPerFrame: Math.round(P.tot / P.n), sections: Object.fromEntries(Object.entries(P.sec).map(([k, v]) => [k, Math.round(v / P.n)])), topA: top, gcEvents: P.drops, gap99: g[Math.floor(g.length*.99)], gapMax: g[g.length-1] }; }""")
    n = max(1, r["frames"] - f0)
    print(json.dumps(r))
    for k in ("TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration", "V8CompileLazy"):
        if k in m1: print(f"  {k:22s} {(m1[k] - m0[k]) * 1000 / n:6.2f} ms per frame")
    print("  layouts per frame", round((m1["LayoutCount"] - m0["LayoutCount"]) / n, 2), " style recalcs per frame", round((m1["RecalcStyleCount"] - m0["RecalcStyleCount"]) / n, 2))
    print("  allocated while running, MB per second:", pg.evaluate("window.PM.drops"), "gc drops seen in", SECS, "s")
    print("  DOM writes per frame:", pg.evaluate("""() => new Promise((res) => { let n = 0, kinds = {}; const mo = new MutationObserver((l) => { for (const x of l) { n++; const t = (x.target.id || x.target.className || x.target.parentNode && (x.target.parentNode.id || x.target.parentNode.className) || x.target.nodeName); kinds[t + ' ' + x.type] = (kinds[t + ' ' + x.type] || 0) + 1; } }); mo.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true }); setTimeout(() => { mo.disconnect(); res({ total: n, top: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8) }); }, 2000); })"""))
    b.close()
