"""Moving the FPS counter: by finger and by controller, from the title and during a climb, whole on screen everywhere,
saved across restarts. Prints PASS or FAIL per check. Usage: python dev/fpsmovetest.py OUTDIR"""
import functools, http.server, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "dev/out/fpsmove"); out.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
W, H = 915, 412
A, B = 0, 1
STUB = """
window.__pad = { id: 'Test Controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
Object.defineProperty(navigator, 'getGamepads', { value: () => [window.__pad] });
if (!localStorage.getItem('smu.settings')) localStorage.setItem('smu.settings', JSON.stringify({ quality: 'high', map: 5, name: 'Ana', tips: false, cap: 60, fps: false }));
"""
fails = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if not ok else ""), flush=True)
    if not ok: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    pg = b.new_page(viewport={"width": W, "height": H})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script(STUB)
    url = f"http://127.0.0.1:{srv.server_port}/index.html?native=rec"
    def ready():
        pg.goto(url)
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    def frames(n=4): pg.evaluate("n => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })", n)
    def click(sel):
        pg.wait_for_selector(sel, timeout=30000)
        pg.evaluate("s => document.querySelector(s).click()", sel)
        frames(6)
    def box(): return pg.evaluate("(() => { const r = document.querySelector('#hFps').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()")
    def seen(): return pg.evaluate("(() => { const e = document.querySelector('#hFps'); return e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible'; })()")
    def whole(r): return r["l"] >= -0.5 and r["t"] >= -0.5 and r["r"] <= W + 0.5 and r["b"] <= H + 0.5 and r["w"] > 5
    def drag(x, y):
        r = box(); cx, cy = (r["l"] + r["r"]) / 2, (r["t"] + r["b"]) / 2
        pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move((cx + x) / 2, (cy + y) / 2); pg.mouse.move(x, y); pg.mouse.up(); frames(3)
    def pos(): return pg.evaluate("SMU.settings ? SMU.settings.fpsPos : null")
    def axes(*a): pg.evaluate("a => { __pad.axes = a; }", list(a)); frames()
    def press(i):
        pg.evaluate("i => { __pad.buttons[i].pressed = true; }", i); frames()
        pg.evaluate("i => { __pad.buttons[i].pressed = false; }", i); frames()
    def scr(): return pg.evaluate("SMU.screen")
    ready()
    # ----- from the title, with Show FPS off
    check("the counter is hidden on the title", not seen())
    click("[data-a=settings]")
    check("Settings has the button", pg.evaluate("!!document.querySelector('[data-a=movefps]')"))
    pg.screenshot(path=str(out / "settings.png"))
    click("[data-a=movefps]")
    check("the move screen opens", scr() == "fpsmove", scr())
    check("the counter shows there even with Show FPS off", seen())
    check("the bar says what to do", "FPS counter" in pg.inner_text("#editBar"), pg.inner_text("#editBar"))
    check("stale game HUD stays hidden from the title", pg.evaluate("getComputedStyle(document.querySelector('#hPause')).visibility") == "hidden")
    frames(50)
    check("the numbers run while moving it", "fps" in pg.inner_text("#hFps"), pg.inner_text("#hFps"))
    d0 = box()
    check("it starts in the default spot, bottom right", d0["r"] > W - 30 and d0["b"] > H - 30, str(d0))
    pg.screenshot(path=str(out / "move_default.png"))
    # ----- anywhere by finger, always whole
    for name, x, y in [("top left", 2, 2), ("top right", W - 2, 2), ("bottom left", 2, H - 2), ("bottom right", W - 2, H - 2)]:
        drag(x, y); r = box()
        check(f"dragged to the {name} it stays whole on screen", whole(r), str(r))
        near = (r["l"] < 2 if x < W / 2 else r["r"] > W - 2) and (r["t"] < 2 if y < H / 2 else r["b"] > H - 2)
        check(f"and reaches the {name} corner", near, str(r))
    drag(W / 2, H / 2); r = box()
    check("dragged to the middle it follows the finger", abs((r["l"] + r["r"]) / 2 - W / 2) < 3 and abs((r["t"] + r["b"]) / 2 - H / 2) < 3, str(r))
    # ----- never under the bar, and the bar stays usable
    def bar_clear():
        return pg.evaluate("""(() => { const a = document.querySelector('#hFps').getBoundingClientRect(), b = document.querySelector('#editBar').getBoundingClientRect();
          return a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom; })()""")
    for y in (2, 40, 80, 120, 145, 160, 200, 300, 400):
        drag(W / 2, y)
        check(f"counter at height {y} is clear of the bar", bar_clear())
    drag(W / 2, 30)
    pg.screenshot(path=str(out / "move_top.png"))
    # ----- a much longer text still fits
    drag(W - 2, H / 2)
    pg.evaluate("document.querySelector('#hFps').textContent = '120 fps · worst 1000 ms · GPU 100.0 · JS 100.0/1000 · level 8'")
    r = box()
    check("longer numbers stay whole at the right edge", whole(r), str(r))
    drag(2, H / 2); r = box()
    pg.evaluate("document.querySelector('#hFps').textContent = '120 fps · worst 1000 ms · GPU 100.0 · JS 100.0/1000 · level 8'")
    check("and at the left edge", whole(box()), str(box()))
    # ----- Reset and Done
    click("#editBar [data-e=reset]")
    check("Reset goes back to the default spot", pos() is None and box()["r"] > W - 30 and box()["b"] > H - 30, str(pos()))
    drag(300, 200); saved = pos()
    click("#editBar [data-e=done]")
    check("Done goes back to Settings", scr() == "settings", scr())
    check("the counter goes away again with Show FPS off", not seen())
    check("the bar has its own text back", "buttons" in pg.evaluate("document.querySelector('#editBar b').textContent"))
    check("nothing of the move screen stays", pg.evaluate("!document.querySelector('.fpsmove') && !document.querySelector('.barlow')"))
    # ----- the Move buttons screen is untouched
    click("[data-a=layout]")
    check("Move buttons still opens", scr() == "layout" and pg.evaluate("getComputedStyle(document.querySelector('#editBar')).display") == "flex")
    check("and its buttons are live", pg.evaluate("getComputedStyle(document.querySelector('#bJump')).pointerEvents") == "auto")
    click("#editBar [data-e=done]")
    # ----- with a controller
    click("[data-a=movefps]")
    start = pos()
    axes(0, 0, 0.2, 0.2); frames(20)
    check("a drifting stick does not move it", pos() == start, str(pos()))
    check("a drifting stick does not wake the controller view", not pg.evaluate("document.body.classList.contains('pad')"))
    axes(0, 0, 1, 0); frames(15); axes(0, 0, 0, 0); frames()
    p1 = pos()
    check("the right stick moves it right", p1[0] > start[0] + 0.02 and abs(p1[1] - start[1]) < 0.001, f"{start} {p1}")
    axes(0, 0, 0, -1); frames(15); axes(0, 0, 0, 0); frames()
    p2 = pos()
    check("and up", p2[1] < p1[1] - 0.02 and abs(p2[0] - p1[0]) < 0.001, f"{p1} {p2}")
    axes(0, 0, 1, 1); frames(240); axes(0, 0, 0, 0); frames()
    check("held long enough it stops at the corner, whole", pos() == [1, 1] and whole(box()), f"{pos()} {box()}")
    check("the hint names the right stick", "Right stick" in pg.inner_text("#padHint"), pg.inner_text("#padHint"))
    check("the highlight waits on Done, not Reset", pg.evaluate("document.querySelector('.pf') && document.querySelector('.pf').dataset.e") == "done")
    pg.screenshot(path=str(out / "move_pad.png"))
    press(A); frames(6)
    check("A on Done goes back to Settings", scr() == "settings", scr())
    frames(14)
    press(B) ; frames(8)
    check("B leaves Settings", scr() == "title", scr())
    # Back again by B from the move screen
    pg.mouse.click(5, 5); frames()
    click("[data-a=settings]"); click("[data-a=movefps]"); frames(16)
    press(B); frames(20)  # after touch the first press only wakes the highlight, as on every screen
    check("the first press after touch only wakes the highlight", scr() == "fpsmove", scr())
    press(B); frames(8)
    check("B leaves the move screen", scr() == "settings", scr())
    drag_target = (300, 200)
    click("[data-a=movefps]"); drag(*drag_target); saved = pos(); click("#editBar [data-e=done]")
    # ----- saved, and used during a climb
    pg.evaluate("document.querySelector('[data-c=fps]').click()"); frames()
    click("[data-a=back]"); frames(6)
    ready()
    check("the place survives a restart", pos() == saved, f"{pos()} {saved}")
    click("[data-a=solo]"); click("[data-a=pick][data-d='1']"); pg.wait_for_timeout(1500)
    check("the climb is running", scr() == "game", scr())
    r = box()
    check("during a climb it sits where you put it", seen() and abs((r["l"] + r["r"]) / 2 - 300) < 40 and abs((r["t"] + r["b"]) / 2 - 200) < 8, str(r))
    pg.wait_for_timeout(800)
    check("and shows the numbers", "fps" in pg.inner_text("#hFps"), pg.inner_text("#hFps"))
    check("and lets touches through to the game", pg.evaluate("getComputedStyle(document.querySelector('#hFps')).pointerEvents") == "none")
    pg.screenshot(path=str(out / "climb.png"))
    # ----- from the pause menu
    pg.evaluate("document.querySelector('#hPause').click()"); frames(6)
    check("paused", scr() == "pause", scr())
    click("[data-a=settings]"); click("[data-a=movefps]")
    check("move screen opens during a climb", scr() == "fpsmove", scr())
    check("the real HUD shows behind it", pg.evaluate("getComputedStyle(document.querySelector('#hPause')).visibility") == "visible")
    check("the pause button does nothing here", pg.evaluate("getComputedStyle(document.querySelector('#hPause')).pointerEvents") == "none")
    check("the game buttons do nothing here", pg.evaluate("getComputedStyle(document.querySelector('#bJump')).pointerEvents") == "none")
    drag(W - 100, 60)
    pg.screenshot(path=str(out / "move_climb.png"))
    click("#editBar [data-e=done]")
    check("back in Settings", scr() == "settings", scr())
    check("the touch layer stays on for the climb", pg.evaluate("document.querySelector('#touch').classList.contains('on')"))
    click("[data-a=back]"); frames(6)
    check("back on the pause menu", scr() == "pause", scr())
    pg.evaluate("document.querySelector('[data-a=back]').click()"); frames(10)
    check("the climb resumes", scr() == "game" and pg.evaluate("SMU.game && !SMU.paused"), scr())
    check("input works again", pg.evaluate("SMU.input ? SMU.input.enabled : true"))
    r = box()
    check("and it is at the new place", seen() and r["r"] > W - 200 and r["t"] < 90, str(r))
    check("no script errors", not errs, str(errs[:3]))
    b.close()
print("ALL PASSED" if not fails else f"{len(fails)} FAILED: " + "; ".join(fails))
sys.exit(1 if fails else 0)
