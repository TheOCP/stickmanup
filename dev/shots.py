"""Serve assets/ locally, drive the game in headless Chromium (software WebGL) and save screenshots.

Usage: python dev/shots.py OUTDIR [scenario ...]
Scenarios: title, solo, zones, mp
"""
import functools
import os
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
WANT = set(sys.argv[2:]) or {"title", "solo", "zones", "mp"}

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/index.html"

errors = []


CTX = {}


def page(browser, tag):
    # One shared context so tabs can find each other over BroadcastChannel (the desktop stand-in for Wi-Fi).
    if "c" not in CTX:
        CTX["c"] = browser.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=1, has_touch=True)
    pg = CTX["c"].new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"[{tag}] {m.type}: {m.text}"))
    pg.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror: {e}"))
    pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', name:'%s'}))" % tag)
    pg.goto(URL)
    pg.wait_for_function("window.SMU && window.SMU.level", timeout=60000)
    pg.wait_for_timeout(1500)
    return pg


def shot(pg, name, wait=900):
    pg.wait_for_timeout(wait)
    pg.screenshot(path=str(OUT / f"{name}.png"))


def click(pg, sel):
    pg.click(sel)
    pg.wait_for_timeout(400)


with sync_playwright() as p:
    # SwiftShader's JIT crashes inside proot on this phone; Mesa llvmpipe through ANGLE/Vulkan works.
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface",
                                "--ignore-gpu-blocklist", "--disable-gpu-compositing", "--autoplay-policy=no-user-gesture-required"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    if "title" in WANT:
        pg = page(b, "Ana")
        shot(pg, "01-title", 2500)
        click(pg, "[data-a=solo]")
        shot(pg, "02-solo-pick", 300)
        click(pg, "[data-a=back]")
        click(pg, "[data-a=host]")
        shot(pg, "03-host-pick", 300)
        click(pg, "[data-a=back]")
        click(pg, "[data-a=join]")
        shot(pg, "04-join", 300)
        click(pg, "[data-a=back]")
        click(pg, "[data-a=settings]")
        shot(pg, "05-settings", 300)
        click(pg, "[data-a=back]")
        click(pg, "[data-a=how]")
        shot(pg, "06-howto", 300)
        pg.close()
    if "solo" in WANT or "zones" in WANT:
        pg = page(b, "Solo")
        click(pg, "[data-a=solo]")
        click(pg, "[data-a=pick][data-d='1']")
        shot(pg, "10-solo-start", 2500)
        # Walk forward and jump using the keyboard.
        pg.keyboard.down("KeyW")
        pg.wait_for_timeout(600)
        pg.keyboard.press("Space")
        pg.wait_for_timeout(900)
        pg.keyboard.up("KeyW")
        shot(pg, "11-solo-moved", 400)
        print("solo state:", pg.evaluate("(() => { const m = SMU.game.me; return {x:m.x.toFixed(2), y:m.y.toFixed(2), z:m.z.toFixed(2), grounded:m.grounded, t:SMU.game.time.toFixed(1)} })()"))
        if "zones" in WANT:
            # Teleport onto a platform in each zone and look around.
            for z in range(7):
                pg.evaluate(f"""(() => {{
                  const g = SMU.game, L = SMU.level;
                  const c = L.cols.filter(c => c.zone === {z} && (c.kind === 'plat' || c.kind === 'ring') && c.y > L.zones[{z}].y0 + 20)[3];
                  g.me.spawn(c.x, c.y + c.hy + 0.6, c.z);
                  g.cam.yaw = Math.PI - Math.atan2(c.z, c.x) + 0.5; g.cam.pitch = 0.25;
                  g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z;
                }})()""")
                shot(pg, f"2{z}-zone{z + 1}", 1800)
            print("full frame at zone 7 [draw calls, triangles, shader programs]:", pg.evaluate("(() => { const i = SMU.renderer.r.info; i.autoReset = false; i.reset(); SMU.renderer.render(); const r = [i.render.calls, i.render.triangles, i.programs.length]; i.autoReset = true; return r; })()"))
            pg.keyboard.press("Escape")
            shot(pg, "30-pause", 500)
        pg.close()
    if "maps" in WANT:
        pg = page(b, "Maps")
        for m in range(6):
            click(pg, "[data-a=solo]")
            click(pg, f"[data-a=map][data-m='{m}']")
            pg.wait_for_timeout(1500)
            shot(pg, f"6{m}0-map{m}-solo-pick", 300)
            click(pg, "[data-a=pick][data-d='1']")
            shot(pg, f"6{m}1-map{m}-start", 2500)
            for z in (1, 3, 5):
                pg.evaluate(f"""(() => {{
                  const g = SMU.game, L = SMU.level;
                  const c = L.cols.filter(c => c.zone === {z} && c.kind === 'plat' && c.y > L.zones[{z}].y0 + 20)[3];
                  g.me.spawn(c.x, c.y + c.hy + 0.6, c.z);
                  g.cam.yaw = Math.PI - Math.atan2(c.z, c.x) + 0.5; g.cam.pitch = 0.25;
                  g.cam.x = c.x; g.cam.y = c.y + 1.4; g.cam.z = c.z;
                }})()""")
                shot(pg, f"6{m}{z + 1}-map{m}-zone{z + 1}", 1800)
            # Abilities: stand next to the first hook, check the action, grapple; then shoot the first door.
            act = pg.evaluate("""(() => { const g = SMU.game, L = SMU.level, a = L.anchors[0];
              const ang = Math.atan2(a.z, a.x), r = Math.hypot(a.x, a.z);
              g.me.spawn(a.x - (a.tx - a.x) * 0.9, a.y - 4.2, a.z - (a.tz - a.z) * 0.9);
              return [a.x, a.y, a.z, a.tx, a.ty, a.tz]; })()""")
            pg.wait_for_timeout(600)
            info = pg.evaluate("(() => { const g = SMU.game; return { action: g.action && g.action.k, me: [g.me.x, g.me.y, g.me.z].map(v => +v.toFixed(1)), grounded: g.me.grounded }; })()")
            print(f"map {m} near hook", [round(v, 1) for v in act], info)
            pg.keyboard.press("KeyF")
            pg.wait_for_timeout(250)
            shot(pg, f"6{m}7-map{m}-grapple", 50)
            pg.wait_for_timeout(1500)
            print(f"map {m} after grapple", pg.evaluate("(() => { const g = SMU.game, m = g.me; return { me: [m.x, m.y, m.z].map(v => +v.toFixed(1)), grounded: m.grounded, hook: !!m.hook }; })()"))
            pg.evaluate("""(() => { const g = SMU.game, d = SMU.level.doors[0];
              g.me.spawn(d.x + d.fx * 4, d.y + 0.9, d.z + d.fz * 4);
              g.cam.yaw = Math.atan2(d.fx, d.fz); g.cam.pitch = 0.2; g.cam.x = g.me.x; g.cam.y = g.me.y + 0.8; g.cam.z = g.me.z; })()""")
            pg.wait_for_timeout(700)
            # Aim by hand: hold R, turn the camera until the target is under the crosshair, release to fire.
            pg.keyboard.down("KeyR")
            for _ in range(6):
                pg.wait_for_timeout(350)
                pg.evaluate("""(() => { const g = SMU.game, d = SMU.level.doors[0], c = SMU.renderer.camera.position;
                  const dx = d.bx - c.x, dy = d.by - c.y, dz = d.bz - c.z, l = Math.hypot(dx, dy, dz);
                  g.cam.yaw = Math.atan2(-dx, -dz); g.cam.pitch = Math.asin(-dy / l); })()""")
            pg.wait_for_timeout(400)
            print(f"map {m} aiming at the door target:", pg.evaluate("(() => { const h = SMU.game.aimHit(SMU.game.time); return [h.kind, +h.t.toFixed(1)]; })()"))
            shot(pg, f"6{m}8-map{m}-aim", 50)
            pg.keyboard.up("KeyR")
            pg.wait_for_timeout(1600)
            print(f"map {m} door open:", pg.evaluate("[SMU.game.doors.has(0), SMU.level.doors[0].col.on]"))
            # A shot aimed away from the target must miss.
            pg.keyboard.down("KeyR"); pg.wait_for_timeout(300)
            pg.evaluate("SMU.game.cam.yaw += 1.2")
            pg.wait_for_timeout(300)
            print(f"map {m} aiming away:", pg.evaluate("SMU.game.aimHit(SMU.game.time).kind"))
            pg.keyboard.up("KeyR")
            pg.wait_for_timeout(300)
            if m == 0:
                pg.evaluate("SMU.game.soloT = Math.ceil(SMU.game.soloT / 6.5) * 6.5 + 1")
                for _ in range(30):
                    pg.wait_for_timeout(200)
                    th = pg.evaluate("(() => { const t = SMU.game.storm.thunder(SMU.game.time, 0); return t && t.warn; })()")
                    if th and th > 0.2:
                        break
                shot(pg, f"6{m}9-map{m}-thunder-warn", 50)
                pg.keyboard.press("KeyQ")
                pg.wait_for_timeout(1200)
                print("storm shield", pg.evaluate("[SMU.game.me.shield, SMU.game.me.shieldCd, SMU.game.me.stun]"))
            if m == 2:
                pg.evaluate("""(() => { const g = SMU.game, mo = SMU.level.monsters[0];
                  g.me.spawn(mo.ax, mo.y + 0.2, mo.az); g.cam.x = mo.ax; g.cam.y = mo.y + 1; g.cam.z = mo.az; })()""")
                pg.wait_for_timeout(2500)
                shot(pg, f"6{m}9-map{m}-monster", 50)
                print("forest monster: stun", pg.evaluate("SMU.game.me.stun"), "pos", pg.evaluate("[SMU.game.me.x, SMU.game.me.y].map(v => +v.toFixed(1))"))
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
            click(pg, "[data-a=quit]")
            pg.wait_for_timeout(500)
        pg.close()
    if "mp" in WANT:
        host = page(b, "Host")
        click(host, "[data-a=host]")
        click(host, "[data-a=go][data-k=lan]")
        host.wait_for_timeout(800)
        guest = page(b, "Guest")
        click(guest, "[data-a=join]")
        click(guest, "[data-a=tab][data-t=lan]")
        guest.wait_for_selector("#found [data-a=host]", timeout=8000)
        shot(guest, "40-join-found", 200)
        click(guest, "#found [data-a=host]")
        host.wait_for_timeout(1500)
        shot(host, "41-lobby-host", 200)
        shot(guest, "42-lobby-guest", 200)
        click(host, "[data-a=start]")
        st = lambda pg: pg.evaluate("(() => { const g = SMU.game, m = g.me; const o = [...(g.vis||new Map()).values()][0]; return {slot:g.slot, me:[m.x.toFixed(1), m.y.toFixed(1), m.z.toFixed(1)], other: o ? [o.x.toFixed(1), o.y.toFixed(1), o.z.toFixed(1)] : null, links:g.links.length, ten: g.links[0] && g.links[0].ten.toFixed(2), t:g.time.toFixed(1)} })()")
        host.wait_for_timeout(3000)
        fps = "(() => new Promise(r => { let n = 0; const t = performance.now(); (function f(){ if (++n < 10) requestAnimationFrame(f); else r(Math.round(10000 / (performance.now() - t))); })(); }))()"
        print("fps host/guest:", host.evaluate(fps), guest.evaluate(fps))
        # Cord test: host clamps on a zone-2 platform, guest is dropped off its edge. The cord should catch them.
        host.keyboard.down("ShiftLeft")
        setup = """(slot) => { const L = SMU.level, c = L.cols.filter(c => c.zone === 2 && c.kind === 'plat')[10];
          const r = Math.hypot(c.x, c.z), ux = c.x / r, uz = c.z / r, g = SMU.game;
          if (slot === 0) g.me.spawn(c.x, c.y + c.hy + 0.5, c.z); else g.me.spawn(c.x + ux * 3.2, c.y + c.hy + 0.6, c.z + uz * 3.2);
          return [c.x, c.y + c.hy, c.z]; }"""
        top = host.evaluate(setup, 0)
        guest.evaluate(setup, 1)
        print("platform top", [round(v, 2) for v in top])
        for i in range(6):
            host.wait_for_timeout(700)
            print("  t+%.1fs" % (0.7 * (i + 1)), "host", st(host)["me"], "anch", host.evaluate("SMU.game.me.anchored"), "| guest", st(guest)["me"], "ten", st(guest)["ten"])
        shot(host, "43-mp-host", 600)
        shot(guest, "44-mp-guest", 200)
        print("host:", st(host))
        print("guest:", st(guest))
        host.keyboard.up("ShiftLeft")
        host.close()
        guest.close()
    if "online" in WANT:
        host = page(b, "Ona")
        click(host, "[data-a=host]")
        click(host, "[data-a=go][data-k=online]")
        host.wait_for_selector(".room .code", timeout=30000)
        code = host.inner_text(".room .code").strip()
        print("online room code:", code)
        guest = page(b, "Remy")
        click(guest, "[data-a=join]")
        guest.fill("#code", code)
        click(guest, "[data-a=online]")
        guest.wait_for_selector(".lobby", timeout=30000)
        host.wait_for_timeout(1500)
        shot(host, "50-online-lobby-host", 200)
        print("host sees players:", host.evaluate("[...SL.game ? [] : document.querySelectorAll('.slot:not(.empty)')].length"))
        click(host, "[data-a=start]")
        guest.wait_for_function("window.SMU.game", timeout=20000)
        host.wait_for_timeout(4000)
        print("online guest sees host robot:", guest.evaluate("SMU.game.vis && SMU.game.vis.size"), "clock offset ms:", guest.evaluate("Math.round(SMU.game.s.offset)"), "ping:", guest.evaluate("SMU.game.s.ping"))
        host.close()
        guest.close()
    b.close()

srv.shutdown()
print("ERRORS:" if errors else "no console errors")
for e in errors[:40]:
    print(" ", e)
