"""Plays through coins, relics, records, jumpers, buying and skins in a real game, and prints PASS or FAIL for each.

Usage: python dev/playtest.py OUTDIR
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/index.html"
errors = []
fails = []


def check(what, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + what + (f"  ({detail})" if detail != "" else ""))
    if not ok:
        fails.append(what)


from testserver import TestServer
TS = TestServer()

def page(ctx, name, profile=None):
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type == "error" and errors.append(f"[{name}] {m.text}"))
    pg.on("pageerror", lambda e: errors.append(f"[{name}] pageerror: {e}"))
    # Each player needs their own storage, so the name and profile are per context.
    pg.add_init_script("localStorage.setItem('smu.welcomed2', '1'); localStorage.setItem('smu.settings', JSON.stringify({quality:'high', name:%s, server:%s}));" % (json.dumps(name), json.dumps(TS.url)))
    pg.goto(URL)
    pg.wait_for_function("window.SMU && window.SMU.level", timeout=60000)
    pg.wait_for_timeout(1000)
    p = profile or {}
    TS.enter(pg, coins=p.get("coins", 0), own=p.get("own", ()), relics=p.get("relics", ()), ach=p.get("ach", ()))
    pg.evaluate("SMU.title && SMU.title()")
    pg.wait_for_timeout(200)
    return pg


def click(pg, sel):
    pg.click(sel)
    pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface",
                                "--ignore-gpu-blocklist", "--disable-gpu-compositing", "--autoplay-policy=no-user-gesture-required"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    ctx = b.new_context(bypass_csp=True, viewport={"width": 915, "height": 412}, device_scale_factor=1, has_touch=True)
    pg = page(ctx, "Ana")

    # ----- Normal: coins, no secrets, no dummies low down
    click(pg, "[data-a=solo]")
    click(pg, "[data-a=pick][data-d='1']")
    pg.wait_for_timeout(1200)
    st = pg.evaluate("""(() => { const g = SMU.game, L = SMU.level; return { hc: g.hardcore, coins: L.coins.length, sec: L.cols.filter(c => c.kind === 'secret' && c.on).length, low: L.jumpers.filter(j => j.y < 400 && g.storm.on(j)).length, first: Math.min(...L.jumpers.filter(j => g.storm.on(j)).map(j => j.y)) }; })()""")
    check("Normal is not treated as Hardcore", st["hc"] is False)
    check("Normal has no hidden stones", st["sec"] == 0)
    check("Normal has no dummies below 400 m", st["low"] == 0, f"first at {st['first']:.0f} m")
    check("the map has plenty of coins", st["coins"] > 100, st["coins"])
    got = pg.evaluate("""(async () => { const g = SMU.game, c = SMU.level.coins[0], y0 = g.run.coins; g.me.spawn(c.x, c.y, c.z); await new Promise(r => setTimeout(r, 300)); return [y0, g.run.coins, g.coinTaken.has(c.i), document.querySelector('#hCoins').textContent]; })()""")
    check("walking into a coin takes it (2 on Normal)", got[1] - got[0] >= 2 and got[2], got)
    check("the coin counter shows it", got[3].strip() == str(got[1]), got[3])
    cc = pg.evaluate("""(() => { const cam = SMU.renderer.camera, P = SMU.pool.coins; return { vis: P.mesh.visible, n: P.near.length }; })()""")
    check("coins near you are drawn", cc["vis"] and cc["n"] > 0, cc)
    pg.screenshot(path=str(OUT / "p01-coins.png"))
    # A fall must not bring a taken coin back.
    fall = pg.evaluate("""(async () => { const g = SMU.game, n = g.coinTaken.size, f = g.falls; g.me.spawn(g.me.x + 200, 0.1, g.me.z); await new Promise(r => setTimeout(r, 900)); return [n, g.coinTaken.size, f, g.falls]; })()""")
    check("a fall counts and leaves coins taken", fall[3] == fall[2] + 1 and fall[1] >= fall[0], fall)
    sp = pg.evaluate("(() => { const g = SMU.game, c = SMU.level.cps[g.cp]; return Math.hypot(g.me.x - c.x, g.me.z - c.z); })()")
    check("respawn lands beside the pole, not in it", 0.3 < sp < 1.1, f"{sp:.2f} m from it")
    # Height for the records.
    pg.evaluate("""(() => { const g = SMU.game, c = SMU.level.cols.find(c => c.kind === 'plat' && c.y > 60); g.me.spawn(c.x, c.y + c.hy + 0.6, c.z); })()""")
    pg.wait_for_timeout(600)
    h = pg.evaluate("SMU.game.run.h")
    check("the climb's height is tracked", h > 55, h)
    # Quit and come back: a saved climb keeps its coins and stays one row.
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    click(pg, "[data-a=quit]")
    pg.wait_for_timeout(400)
    pf = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")
    check("quitting writes the climb into the records", len(pf["runs"].get("0", [])) == 1 and pf["runs"]["0"][0]["h"] == h, pf["runs"])
    check("coins went into the wallet", pf["coins"] == got[1] and pf["earned"] == got[1], pf["coins"])
    click(pg, "[data-a=cont]")
    pg.wait_for_timeout(700)
    re = pg.evaluate("(() => { const g = SMU.game; return { c: g.run.coins, n: g.coinTaken.size, h: g.run.h, id: g.run.id }; })()")
    check("continuing keeps coins and height", re["c"] == got[1] and re["n"] >= 1 and re["h"] == h, re)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    click(pg, "[data-a=quit]")
    pg.wait_for_timeout(300)
    pf = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")
    check("a continued climb stays one row", len(pf["runs"]["0"]) == 1, len(pf["runs"]["0"]))

    # ----- Hardcore: dummies from 50 m, hidden stones, relic unlocks a legendary
    click(pg, "[data-a=solo]")
    click(pg, "[data-a=pick][data-d='2']")
    pg.wait_for_timeout(1200)
    st = pg.evaluate("""(() => { const g = SMU.game, L = SMU.level, on = L.jumpers.filter(j => g.storm.on(j)).map(j => j.y - 2).sort((a, b) => a - b); return { hc: g.hardcore, sec: L.cols.filter(c => c.kind === 'secret' && c.on).length, vis: SMU.view.secretMesh.visible, first: on[0], n: on.length }; })()""")
    check("Hardcore is treated as Hardcore", st["hc"] is True)
    check("Hardcore has the hidden stones", st["sec"] > 0 and st["vis"], st["sec"])
    check("Hardcore dummies start around 50 m", 40 < st["first"] < 70, f"{st['first']:.0f} m, {st['n']} in all")
    # Stand next to the first dummy and see that it wakes up and gets a body.
    jm = pg.evaluate("""(async () => { const g = SMU.game, L = SMU.level, j = L.jumpers.filter(j => g.storm.on(j)).sort((a, b) => a.y - b.y)[0]; g.me.spawn(j.x + 3.5, j.y + 1, j.z); g.cam.x = g.me.x; g.cam.y = g.me.y; g.cam.z = g.me.z; await new Promise(r => setTimeout(r, 1200)); const J = g.jumpers.find(q => q.j === j), r = g.jrigs.get(J); return { active: J.active, rig: !!r, vis: !!(r && r.g.visible), name: j.name }; })()""")
    check("a dummy wakes up and is drawn", jm["active"] and jm["rig"] and jm["vis"], jm)
    pg.screenshot(path=str(OUT / "p02-dummy.png"))
    # The hint, then the relic.
    rel = pg.evaluate("""(async () => { const g = SMU.game, r = SMU.level.relics[0]; g.me.spawn(r.x + 12, r.y + 1, r.z); await new Promise(res => setTimeout(res, 400)); await new Promise(res => setTimeout(res, 1100)); const hint = g.relicNear.has(r.id); const toast = document.querySelector('#toasts').textContent; const near = !!g.nearRelic; g.me.spawn(r.x + 0.4, r.y, r.z); await new Promise(res => setTimeout(res, 400)); return { id: r.id, hint, toast, near, banner: document.querySelector('#zoneTitle h2').textContent, relics: JSON.parse(localStorage.getItem('smu.profile')).relics }; })()""")
    check("a hum tells you a relic is near", rel["hint"] and "humming" in rel["toast"], rel["toast"])
    check("the gem is shown near it", rel["near"])
    check("taking the relic unlocks its legendary", rel["id"] in rel["relics"] and rel["banner"] == "Stormcaller", rel)
    pg.screenshot(path=str(OUT / "p03-relic.png"))
    # Reach the top with no falls: both achievements, bonus.
    wn = pg.evaluate("""(async () => { const g = SMU.game, L = SMU.level, c0 = g.run.coins; g.falls = 0; g.me.spawn(L.summit.x || 0, L.top + 0.6, L.summit.z || 0); await new Promise(res => setTimeout(res, 3200)); const p = JSON.parse(localStorage.getItem('smu.profile')); return { won: g.won, gained: g.run.coins - c0, ach: p.ach, top: p.runs[0][0], results: document.querySelector('#menu').textContent.slice(0, 300) }; })()""")
    check("reaching the top wins", wn["won"], wn["results"])
    check("the top pays 500 on Hardcore", wn["gained"] >= 500, wn["gained"])
    check("Summit King and Flawless are earned", "summit" in wn["ach"] and "flawless" in wn["ach"], wn["ach"])
    check("results name the legendaries", "Summit King" in wn["results"] and "Flawless" in wn["results"], wn["results"][:140])
    check("the record says it reached the top", wn["top"]["won"] and wn["top"]["h"] >= 900, wn["top"])
    pg.screenshot(path=str(OUT / "p04-results.png"))
    click(pg, "[data-a=back]")
    pg.wait_for_timeout(400)

    # ----- Hardcore with an easier rule has no legendaries
    pg.evaluate("SMU.settings.rules.cps = 0")
    click(pg, "[data-a=solo]")
    click(pg, "[data-a=pick][data-d='2']")
    pg.wait_for_timeout(1000)
    st = pg.evaluate("(() => { const g = SMU.game; return { hc: g.hardcore, custom: g.custom, sec: SMU.level.cols.filter(c => c.kind === 'secret' && c.on).length }; })()")
    check("easier custom rules switch the hidden places off", not st["hc"] and st["custom"] and st["sec"] == 0, st)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    click(pg, "[data-a=quit]")
    pg.evaluate("SMU.settings.rules.cps = -1")

    # ----- Shop: buy, wear, can't afford, can't buy a legendary
    click(pg, "[data-a=shop]")
    pg.wait_for_timeout(500)
    wallet0 = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile')).coins")
    click(pg, "[data-a=pick][data-id=k0]")
    click(pg, "[data-a=buy]")
    pf = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")
    check("buying takes coins, gives the suit and puts it on", pf["coins"] == wallet0 - 60 and "k0" in pf["own"] and pf["eq"]["s"] == "k0", [wallet0, pf["coins"], pf["eq"]])
    click(pg, "[data-a=tab][data-t=legend]")
    click(pg, "[data-a=pick][data-id=l_forest0]")
    check("a locked legendary has no buy button", pg.locator("[data-a=buy]").count() == 0)
    click(pg, "[data-a=pick][data-id=l_storm0]")
    click(pg, "[data-a=equip]")
    pf = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")
    check("a found legendary can be worn", pf["eq"]["s"] == "l_storm0", pf["eq"])
    click(pg, "[data-a=back]")
    pg.wait_for_timeout(500)
    # Name gate.
    gate = pg.evaluate("""(async () => { const { resolveLook } = await import('./js/skins.js'); const k = (s, n) => resolveLook({ s, f: 'smile', h: 'none' }, n).suit.id; return [k('o_theocp', 'Bob'), k('o_theocp', 'TheOCP'), k('o_theocp', 'theocp'), k('o_shortgg', 'ShortGG'), k('o_shortgg', 'TheOCP')]; })()""")
    check("personal suits only work under the right name", gate == ["c0", "o_theocp", "o_theocp", "o_shortgg", "c0"], gate)

    # ----- Two players see each other's looks
    # BroadcastChannel only links tabs of one context, so both players share storage here: the name decides.
    pg.close()
    host = page(ctx, "TheOCP")
    click(host, "[data-a=host]")
    click(host, "[data-a=go][data-k=lan]")
    host.wait_for_timeout(600)
    guest = page(ctx, "ShortGG")
    click(guest, "[data-a=join]")
    click(guest, "[data-a=tab][data-t=lan]")
    guest.wait_for_selector("#found [data-a=host]", timeout=9000)
    click(guest, "#found [data-a=host]")
    host.wait_for_timeout(1200)
    # Wear the personal suits (each tab keeps its own session look).
    click(host, "[data-a=start]")
    host.wait_for_timeout(2000)
    host.evaluate("""(async () => { const P = await import('./js/profile.js'), { SUIT } = await import('./js/skins.js'); P.equip(SUIT.o_theocp); const g = SMU.game; g.s.setMe('TheOCP', SUIT.o_theocp.c, P.myLook('TheOCP')); g.refreshPlayers(); })()""")
    guest.evaluate("""(async () => { const P = await import('./js/profile.js'), { SUIT } = await import('./js/skins.js'); P.equip(SUIT.o_shortgg); const g = SMU.game; g.s.setMe('ShortGG', SUIT.o_shortgg.c, P.myLook('ShortGG')); g.refreshPlayers(); })()""")
    host.wait_for_timeout(1800)
    keys = "(() => { const g = SMU.game; return Object.fromEntries([...g.robots].map(([s, r]) => [g.s.players.get(s).name, r.lookKey.split('|')[0]])); })()"
    hk, gk = host.evaluate(keys), guest.evaluate(keys)
    check("the host sees both personal suits", hk.get("TheOCP") == "o_theocp" and hk.get("ShortGG") == "o_shortgg", hk)
    check("the guest sees both personal suits", gk.get("TheOCP") == "o_theocp" and gk.get("ShortGG") == "o_shortgg", gk)
    tags = host.evaluate("document.querySelector('#hPlayers').textContent")
    check("the player list shows the roles", "OWNER" in tags and "ADMIN" in tags, tags)
    host.screenshot(path=str(OUT / "p05-two-players.png"))

    print("js errors:", json.dumps(errors, indent=1))
    print("FAILED:" if fails else "ALL PASSED", fails if fails else "")
    b.close()
