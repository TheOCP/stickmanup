#!/usr/bin/env python3
"""The game the way a phone gets it: the server address is built in and nothing ever asks for one.

The other tests run the page from 127.0.0.1, where the game uses a test server of their choosing. This one runs it from
localhost, so it uses the real built in address. Calls to that address are passed on to a real server running here.

Usage: python dev/hardserver.py
"""
import functools, http.server, json, os, re, socket, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
m = re.search(r"export const SERVER = '([^']+)'", (ROOT / "assets/js/cloud.js").read_text())
HARD = m.group(1) if m else ""

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "assets")))
threading.Thread(target=web.serve_forever, daemon=True).start()

s = socket.socket(); s.bind(("127.0.0.1", 0)); SP = s.getsockname()[1]; s.close()
LOCAL = f"http://127.0.0.1:{SP}"
tmp = tempfile.mkdtemp(prefix="smu-hard-")
srv = subprocess.Popen(["node", "--disable-warning=ExperimentalWarning", str(ROOT / "server/server.js")],
                       env={"PATH": os.environ["PATH"], "PORT": str(SP), "HOST": "127.0.0.1", "DATA_DIR": tmp, "PUBLIC_URL": LOCAL, "STEAM_LOGIN": "1"},
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(50):
    try: urllib.request.urlopen(LOCAL + "/api/health", timeout=1); break
    except Exception: time.sleep(0.1)

fails = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""), flush=True)
    if not ok: fails.append(name)

check("an encrypted address is built in", HARD.startswith("https://") and ":" in HARD[8:], HARD)
PAGE = f"http://localhost:{web.server_port}/index.html?native=rec"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"}
ARGS = ["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS, env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    errs, calls = [], []
    def page(ctx):
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        return pg
    def ready(pg): pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    def click(pg, sel): pg.locator(sel).first.click(timeout=8000); pg.wait_for_timeout(300)
    scr = lambda pg: pg.evaluate("SMU.screen")
    text = lambda pg: pg.evaluate("document.querySelector('#menu').textContent")
    no_box = lambda pg: not pg.evaluate("!!document.querySelector('#saddr, #srv')")

    def forward(route):
        req = route.request
        calls.append(req.url)
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=CORS)
        r = route.fetch(url=req.url.replace(HARD, LOCAL))
        route.fulfill(status=r.status, headers={**r.headers, **CORS}, body=r.body())

    # ---- a brand new player, with the server up
    ctx = b.new_context(bypass_csp=True, viewport={"width": 915, "height": 412})
    ctx.route(HARD + "/**", forward)
    pg = page(ctx)
    pg.goto(PAGE)
    ready(pg)
    pg.wait_for_function("document.querySelector('#menu').textContent.includes('Play as guest')", timeout=15000)
    check("the first start goes to the built in server by itself", any(u.startswith(HARD) for u in calls), calls[:3])
    check("it shows that server's terms", "These are the simple rules" in text(pg), text(pg)[:160])
    check("and does not ask for an address", no_box(pg) and scr(pg) == "account", scr(pg))
    click(pg, "#menu [data-a=back]")
    check("Play as guest reaches the title", scr(pg) == "title", scr(pg))
    pg.reload(); ready(pg)
    check("and the welcome only shows once", scr(pg) == "title", scr(pg))

    click(pg, "[data-a=settings]")
    check("Settings has no address box", no_box(pg) and "Game server address" not in text(pg), text(pg)[:200])
    click(pg, "#menu [data-a=back]")
    check("Settings still closes", scr(pg) == "title", scr(pg))

    before = len(calls)
    click(pg, "[data-a=browser]")
    pg.wait_for_function("!document.querySelector('#bstat .spin')", timeout=15000)
    check("the server browser opens straight away", scr(pg) == "browser" and no_box(pg), scr(pg))
    check("and asks the built in server for its rooms", any(u.startswith(HARD) for u in calls[before:]), calls[before:])
    check("and finds it", "Could not" not in text(pg), text(pg)[:200])
    click(pg, "#menu [data-a=back]")

    click(pg, "[data-a=join]")
    check("joining starts on the server tab, ready for a code", pg.evaluate("!!document.querySelector('#scode')") and no_box(pg), text(pg)[:200])
    click(pg, "#menu [data-a=back]")

    ws = pg.evaluate("(async () => (await import('./js/cloud.js')).wsUrl())()")
    check("rooms use the same address, encrypted", ws == HARD.replace("https://", "wss://") + "/ws", ws)

    # ---- an address left behind by an older version counts for nothing
    pg.evaluate("""(() => { const s = JSON.parse(localStorage.getItem('smu.settings') || '{}'); s.server = 'https://other.example:1'; localStorage.setItem('smu.settings', JSON.stringify(s)); })()""")
    pg.reload(); ready(pg)
    now = pg.evaluate("(async () => (await import('./js/cloud.js')).serverUrl())()")
    check("an old saved address is ignored", now == HARD, now)
    ctx.close()

    # ---- a brand new player, with the server down
    ctx = b.new_context(bypass_csp=True, viewport={"width": 915, "height": 412})
    ctx.route(HARD + "/**", lambda r: r.abort())
    pg = page(ctx)
    pg.goto(PAGE)
    ready(pg)
    pg.wait_for_function("document.querySelector('#menu').textContent.includes('Play as guest')", timeout=20000)
    check("with the server down it says so", "Could not reach the game server" in text(pg), text(pg)[:200])
    check("still without asking for an address", no_box(pg) and "Change the server" not in text(pg), text(pg)[:200])
    click(pg, "#menu [data-a=back]")
    check("and you can go on as a guest", scr(pg) == "title", scr(pg))
    click(pg, "[data-a=browser]")
    pg.wait_for_function("!document.querySelector('#bstat .spin')", timeout=20000)
    check("the server browser says it can't reach it", scr(pg) == "browser" and no_box(pg), scr(pg))
    click(pg, "#menu [data-a=back]")
    click(pg, "[data-a=solo]")
    click(pg, "[data-a=pick][data-d='1']")
    pg.wait_for_timeout(1200)
    check("and a solo climb still starts", pg.evaluate("!!SMU.game"))
    ctx.close()
    check("no errors", not errs, errs[:3])
    b.close()

srv.terminate()
web.shutdown()
print("FAILED: " + ", ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
