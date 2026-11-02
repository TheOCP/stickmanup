"""CPU profile of real play: the functions that use the most time, on this phone's own CPU.

Usage: python dev/perf3.py [map] [seconds] [cpu slowdown, 1 = this phone]
"""
import collections, functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
M = int(sys.argv[1]) if len(sys.argv) > 1 else 0
SECS = float(sys.argv[2]) if len(sys.argv) > 2 else 6
SLOW = float(sys.argv[3]) if len(sys.argv) > 3 else 1
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    ctx = b.new_context(viewport={"width": 915, "height": 412})
    pg = ctx.new_page()
    pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d, name:'Ana', cap:60}))" % M)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html?native=rec")
    pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=90000)
    pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']"); pg.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(pg)
    if SLOW > 1: cdp.send("Emulation.setCPUThrottlingRate", {"rate": SLOW})
    pg.evaluate("""() => { const P = window.PG = { gaps: [], t: 0 }; const f = (now) => { if (P.t) P.gaps.push(now - P.t); P.t = now; requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
    cdp.send("Profiler.enable"); cdp.send("Profiler.setSamplingInterval", {"interval": 500}); cdp.send("Profiler.start")
    pg.wait_for_timeout(int(SECS * 1000))
    prof = cdp.send("Profiler.stop")["profile"]
    g = pg.evaluate("() => { const a = window.PG.gaps.slice().sort((x, y) => x - y), n = a.length; return { frames: n, gap50: +a[n >> 1].toFixed(1), gap95: +a[Math.floor(n * .95)].toFixed(1), gap99: +a[Math.floor(n * .99)].toFixed(1), max: +a[n - 1].toFixed(1), over20: a.filter((x) => x > 20).length }; }")
    print("frame gaps:", json.dumps(g))
    self_t = collections.Counter()
    idx = {n["id"]: n for n in prof["nodes"]}
    for sid, dt in zip(prof["samples"], prof["timeDeltas"]):
        n = idx[sid]; c = n["callFrame"]
        self_t[f'{c["functionName"] or "(anon)"} {c["url"].split("/")[-1]}:{c["lineNumber"] + 1}'] += dt
    tot = sum(v for k, v in self_t.items() if not k.startswith("(idle") and not k.startswith("(program)"))
    fr = max(1, g["frames"])
    print(f"script+gc per frame: {tot / 1000 / fr:.2f} ms")
    for k, v in self_t.most_common(34):
        if k.startswith("(idle") or k.startswith("(program)"): continue
        print(f"  {v / 1000 / fr:6.3f} ms  {k}")
    b.close()
