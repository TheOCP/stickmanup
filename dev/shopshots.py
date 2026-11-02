"""Screenshots of the shop, the records, skins worn in the world and the difficulty cards.

Usage: python dev/shopshots.py OUTDIR [name to play under]
"""
import functools
import http.server
import json
import os
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
NAME = sys.argv[2] if len(sys.argv) > 2 else "Ana"

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/index.html"
errors = []

PROFILE = {"coins": 4321, "earned": 9000, "own": ["ninja", "f_de", "cap"], "eq": {"s": "c0", "f": "smile", "h": "none"}, "relics": ["storm:0"], "ach": [],
           "runs": {"0": [
               {"id": "a", "map": 0, "diff": 2, "custom": False, "h": 512, "falls": 7, "t": 1834.2, "coins": 402, "won": False, "when": 1793000000000, "players": 1},
               {"id": "b", "map": 0, "diff": 1, "custom": False, "h": 1000, "falls": 3, "t": 2410, "coins": 610, "won": True, "when": 1793100000000, "players": 2},
               {"id": "c", "map": 0, "diff": 0, "custom": True, "h": 240, "falls": 0, "t": 402, "coins": 81, "won": False, "when": 1793200000000, "players": 1}]},
           "totals": {"falls": 44, "climbs": 12}}


def shot(pg, name, wait=700):
    pg.wait_for_timeout(wait)
    pg.screenshot(path=str(OUT / f"{name}.png"))


def click(pg, sel):
    pg.click(sel)
    pg.wait_for_timeout(350)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface",
                                "--ignore-gpu-blocklist", "--disable-gpu-compositing", "--autoplay-policy=no-user-gesture-required"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    ctx = b.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=1, has_touch=True)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', name:%s})); if (!localStorage.getItem('smu.profile')) localStorage.setItem('smu.profile', %s)" % (json.dumps(NAME), json.dumps(json.dumps(PROFILE))))
    pg.goto(URL)
    pg.wait_for_function("window.SMU && window.SMU.level", timeout=60000)
    pg.wait_for_timeout(1500)
    shot(pg, "s00-title", 800)
    click(pg, "[data-a=solo]")
    shot(pg, "s01-solo-cards", 300)
    pg.evaluate("document.querySelector('#menu .panel').scrollTop = 99999")
    shot(pg, "s02-solo-cards-low", 300)
    click(pg, "[data-a=back]")
    click(pg, "[data-a=records]")
    shot(pg, "s10-records", 300)
    pg.evaluate("document.querySelector('#menu .panel').scrollTop = 99999")
    shot(pg, "s11-records-low", 200)
    click(pg, "[data-a=back]")
    click(pg, "[data-a=shop]")
    shot(pg, "s20-shop-suits", 2500)
    pg.evaluate("document.querySelector('.shopgrid').scrollTop = 620")
    shot(pg, "s21-shop-suits-low", 400)
    for tab, ids in (("flags", ["f_de", "f_us", "f_kr"]), ("faces", ["angry", "ninja"]), ("hats", ["viking", "crown"]), ("legend", ["l_storm0", "l_waterfall1"])):
        click(pg, f"[data-a=tab][data-t={tab}]")
        shot(pg, f"s3-{tab}", 1800)
        for i in ids:
            click(pg, f"[data-a=pick][data-id={i}]")
            shot(pg, f"s4-{tab}-{i}", 1400)
    # The personal suits, when playing under that name.
    if NAME.lower() in ("theocp", "shortgg"):
        sid = "o_" + NAME.lower()
        pg.evaluate("document.querySelector('.shopgrid').scrollTop = 0")
        click(pg, f"[data-a=pick][data-id={sid}]")
        for i in range(6):
            shot(pg, f"o-{NAME}-{i}", 900)
        pg.evaluate("SMU.preview = null")
    print("errors:", json.dumps(errors, indent=1))
    b.close()
