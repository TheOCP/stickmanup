"""Finds things the game shows but the native renderer has been told to hide (or the other way round).

Climbs up and back down each map by teleporting, and after each stop compares every object near the camera:
what the game has set against what was last sent to the native side.

Usage: python dev/vistest.py [maps, e.g. 0,5] [assets dir]
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "assets"
MAPS = [int(x) for x in sys.argv[1].split(",")] if len(sys.argv) > 1 else list(range(6))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
CHECK = """() => { const M = SMU.renderer.mirror, cam = SMU.renderer.camera.position, bad = []; let checked = 0;
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const v = new (cam.constructor)();
  for (const e of M.objs.values()) { const o = e.obj; if (o.isInstancedMesh || !o.geometry || !o.parent) continue;
    let root = o; while (root.parent) root = root.parent; if (!root.isScene) continue;
    o.updateWorldMatrix(true, false);
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const d = v.distanceTo(cam); if (d > 40) continue;
    checked++;
    const truth = shown(o) ? 1 : 0;
    if (truth !== e.vis) bad.push({ want: truth, sent: e.vis, at: [v.x, v.y, v.z].map(Math.round), d: Math.round(d), geo: o.geometry.type, mat: o.material.type, water: !!(o.material.uniforms && o.material.uniforms.uS), off: Math.round(o.geometry.boundingSphere.center.length()) });
  }
  return { checked, bad }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    total = 0
    for m in MAPS:
        pg = b.new_page(viewport={"width": 640, "height": 300})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high', map:%d, name:'Ana', cap:60, tips:false}))" % m)
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html?native=rec")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
        pg.click("[data-a=solo]"); pg.wait_for_timeout(300); pg.click("[data-a=pick][data-d='1']"); pg.wait_for_timeout(1200)
        tops = pg.evaluate("SMU.level.top")
        seen = {}; checked = 0
        # Up the map, back down, and up again: things hidden on the way must come back.
        ys = [i / 12 for i in range(1, 12)]
        for pas, fracs in (("up", ys), ("down", ys[::-1]), ("up2", ys)):
            for f in fracs:
                pg.evaluate("""(f) => { const g = SMU.game, L = SMU.level, y = 2 + (L.top - 2) * f; let best = null, bd = 1e9;
                    for (const c of L.cols) { if (c.kind !== 'plat') continue; const d = Math.abs(c.y - y); if (d < bd) { bd = d; best = c; } }
                    if (best) { g.me.spawn(best.x, best.y + best.hy + 0.7, best.z); g.me.vx = g.me.vy = g.me.vz = 0; g.cam.x = best.x; g.cam.y = best.y + 1.4; g.cam.z = best.z; } }""", f)
                pg.wait_for_timeout(350)
                r = pg.evaluate(CHECK)
                checked += r["checked"]
                for x in r["bad"]:
                    k = (x["geo"], x["mat"], x["water"], x["want"])
                    if k not in seen: seen[k] = dict(x, n=0, where=pas)
                    seen[k]["n"] += 1
        print(f"map {m}: checked {checked} objects near the camera, {sum(v['n'] for v in seen.values())} wrong")
        for k, v in sorted(seen.items(), key=lambda kv: -kv[1]["n"])[:10]:
            print("   ", "should show but hidden" if v["want"] else "should hide but shown", json.dumps({x: v[x] for x in ("n", "geo", "mat", "water", "off", "where", "at", "d")}))
        total += sum(v["n"] for v in seen.values())
        if errs: print("  errors", errs[:2])
        pg.close()
    print("TOTAL WRONG", total)
    b.close()
