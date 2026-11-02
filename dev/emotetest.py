"""Emotes, stunts, dash, wall jump, the new trigger controls, Insane and the first win coins, in the real game with
touch and a simulated controller. Prints PASS or FAIL per check.
Usage: python dev/emotetest.py OUTDIR"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "dev/out/emote"); out.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
A, B, X, Y, LB, RB, LT, RT, SELECT, START, L3, R3, UP, DOWN, LEFT, RIGHT = range(16)
STUB = """
window.__pad = { id: 'Test Controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), index: 0 };
Object.defineProperty(navigator, 'getGamepads', { value: () => [window.__pad] });
localStorage.setItem('smu.settings', JSON.stringify({ quality: 'high', map: 0, name: 'Ana', tips: false, cap: 60 }));
if (!localStorage.getItem('smu.profile')) localStorage.setItem('smu.profile', JSON.stringify({ coins: 5000, earned: 5000, own: [], eq: null, relics: [], ach: [], runs: {}, totals: {} }));
"""
fails = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""), flush=True)
    if not ok: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    pg = b.new_page(bypass_csp=True, viewport={"width": 915, "height": 412})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script(STUB)
    pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html?native=rec")
    pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    def frames(n=4): pg.evaluate("n => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })", n)
    def hold(i, on=True): pg.evaluate("([i, on]) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; }", [i, on])
    def press(i):
        hold(i); frames(); hold(i, False); frames()
    def scr(): return pg.evaluate("SMU.screen")
    def click(sel):
        pg.locator(sel).first.click(timeout=8000); frames(6)

    # ---- the shop
    click("[data-a=shop]")
    click("[data-a=tab][data-t=emotes]")
    n = pg.evaluate("document.querySelectorAll('#menu .skin').length")
    check("the shop has an Emotes tab with emotes in it", n >= 20, str(n))
    pg.screenshot(path=str(out / "shop-emotes.png"))
    coins0 = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile')).coins")
    click("[data-a=pick][data-id=e_windmill]")
    frames(40)
    check("picking an emote plays it on the climber in the shop", pg.evaluate("!!SMU.pool.robots[0].emote && SMU.pool.robots[0].emote.id === 'e_windmill'"))
    pg.screenshot(path=str(out / "shop-windmill.png"))
    click("[data-a=buy]")
    pr = pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")
    check("buying an emote takes the coins and keeps it", pr["coins"] == coins0 - 800 and "e_windmill" in pr["own"], json.dumps(pr)[:160])
    eq = pr.get("eq") or {}
    check("buying an emote changes nothing you wear", "undefined" not in eq and eq.get("h", "none") != "e_windmill", str(eq))
    check("an owned emote can be watched again", pg.locator("[data-a=watch]").count() == 1)
    click("[data-a=back]")
    frames(10)

    # ---- the difficulty cards
    click("[data-a=solo]")
    n = pg.evaluate("document.querySelectorAll('.card').length")
    check("four difficulties", n == 4, str(n))
    t = pg.evaluate("document.querySelector('.card.d3').textContent")
    check("Insane is there and says what its first win pays", "Insane" in t and "20000" in t, t)
    pg.screenshot(path=str(out / "diff.png"))
    click(".card.d1")
    pg.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=60000)
    frames(30)
    pg.screenshot(path=str(out / "hud.png"))

    # ---- emote menu by touch
    check("the emote button shows", pg.locator("#hEmote").is_visible())
    check("the dash button shows", pg.locator("#bDash").is_visible())
    r = pg.evaluate("(() => { const a = document.querySelector('#bDash').getBoundingClientRect(); return [...document.querySelectorAll('.tb')].filter(e => e.id !== 'bDash' && e.getClientRects().length).filter(e => { const b = e.getBoundingClientRect(); return Math.hypot(a.x - b.x, a.y - b.y) < 60; }).map(e => e.id); })()")
    check("the dash button doesn't sit on another button", not r, str(r))
    click("#hEmote")
    check("tapping it opens the menu", pg.evaluate("document.querySelector('#emoteMenu').classList.contains('on')"))
    names = pg.evaluate("[...document.querySelectorAll('#emoteMenu .emo')].map(e => e.dataset.em)")
    check("the menu has the free ones and what was bought", "e_wave" in names and "e_backflip" in names and "e_windmill" in names and "e_headspin" not in names, str(names))
    check("the game keeps running under it", not pg.evaluate("SMU.paused"))
    pg.screenshot(path=str(out / "menu.png"))
    click("[data-em=e_wave]")
    check("picking one closes the menu and plays it", not pg.evaluate("document.querySelector('#emoteMenu').classList.contains('on')") and pg.evaluate("SMU.game.robots.get(SMU.game.slot).emote && SMU.game.robots.get(SMU.game.slot).emote.id === 'e_wave'"))
    check("an emoji floats over the climber", pg.locator("#tags .emoB").count() == 1)
    pg.screenshot(path=str(out / "bubble.png"))
    frames(20)
    # Moving stops a pose.
    pg.evaluate("__pad.axes = [0, -0.95, 0, 0]"); frames(30); pg.evaluate("__pad.axes = [0, 0, 0, 0]"); frames(30)
    check("running stops a pose", not pg.evaluate("SMU.game.robots.get(SMU.game.slot).emote"))
    # A flip jumps first, no higher than a jump.
    pg.evaluate("SMU.game.me.spawn(SMU.game.me.x, SMU.game.me.y + 0.1, SMU.game.me.z)"); frames(30)
    y0 = pg.evaluate("SMU.game.me.y")
    pg.evaluate("window.__peak = -1e9; SMU.game.emote('e_backflip'); window.__w = setInterval(() => { __peak = Math.max(__peak, SMU.game.me.y); }, 10)")
    frames(8)
    check("a flip on the ground starts with a jump", pg.evaluate("SMU.game.me.vy") > 3 or not pg.evaluate("SMU.game.me.grounded"))
    pg.wait_for_timeout(1400)
    pk = pg.evaluate("clearInterval(__w); __peak")
    check("the flip goes no higher than a normal jump", pk - y0 < 1.95, f"{pk - y0:.2f}")
    check("the flip ends upright", abs(pg.evaluate("SMU.game.robots.get(SMU.game.slot).body.rotation.x")) < 0.05)

    # ---- emote menu by controller
    press(DOWN); frames(6)
    check("direction pad down opens the menu", pg.evaluate("document.querySelector('#emoteMenu').classList.contains('on')"))
    check("the highlight is on an emote", pg.evaluate("!!document.querySelector('#emoteMenu .pf')"))
    press(RIGHT); frames(4)
    hl = pg.evaluate("document.querySelector('#emoteMenu .pf') && document.querySelector('#emoteMenu .pf').dataset.em")
    press(A); frames(6)
    check("A plays the highlighted emote and closes", not pg.evaluate("document.querySelector('#emoteMenu').classList.contains('on')") and bool(hl), str(hl))
    check("that A doesn't also jump", pg.evaluate("Math.abs(SMU.game.me.vy)") < 3)
    press(DOWN); frames(6)
    press(B); frames(6)
    check("B closes the menu without pausing", not pg.evaluate("document.querySelector('#emoteMenu').classList.contains('on')") and scr() == "game", scr())
    frames(10)

    # ---- the new buttons
    hold(LT); frames(10)
    check("holding LT aims", pg.evaluate("SMU.game.aiming"))
    pg.screenshot(path=str(out / "aim.png"))
    s0 = pg.evaluate("SMU.game.lastShot || 0")
    press(RT); frames(4)
    s1 = pg.evaluate("SMU.game.lastShot || 0")
    check("RT fires while aiming", s1 > s0, f"{s0} {s1}")
    check("still aiming after the shot", pg.evaluate("SMU.game.aiming"))
    hold(LT, False); frames(8)
    s2 = pg.evaluate("SMU.game.lastShot || 0")
    check("letting go of LT stops aiming and doesn't fire", not pg.evaluate("SMU.game.aiming") and s2 == s1, f"{s1} {s2}")
    pg.wait_for_timeout(400)
    press(RT); frames(4)
    check("RT also fires from the hip", pg.evaluate("SMU.game.lastShot || 0") > s2)
    hold(RB); frames(10)
    check("RB reels", pg.evaluate("SMU.game.me.reelHeld"))
    hold(RB, False); frames(4)
    hold(B); frames(4)
    hold(B, False); frames(4)
    pg.wait_for_timeout(800)
    me0 = pg.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    press(Y); frames(14)
    me1 = pg.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    d = ((me1[0] - me0[0]) ** 2 + (me1[1] - me0[1]) ** 2) ** 0.5
    check("Y dashes where the camera looks", d > 1.2, f"{d:.2f}")
    pg.wait_for_timeout(800)
    me0 = pg.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    press(L3); frames(14)
    me1 = pg.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    d = ((me1[0] - me0[0]) ** 2 + (me1[1] - me0[1]) ** 2) ** 0.5
    check("pressing the left stick dashes too", d > 1.2, f"{d:.2f}")
    pg.wait_for_timeout(800)

    # ---- a real shaft and a real dash gap, drawn
    pg.evaluate("""(() => { const g = SMU.game, m = SMU.level.moves.find(q => q.k === 'dash'); g.me.spawn(m.ax, m.ay + 0.45, m.az); })()""")
    frames(40)
    pg.screenshot(path=str(out / "dash-gap.png"))
    pg.evaluate("""(() => { const g = SMU.game, m = SMU.level.moves.find(q => q.k === 'chimney'); g.me.spawn(m.x, m.y + 0.45, m.z); })()""")
    frames(40)
    pg.screenshot(path=str(out / "shaft.png"))

    # ---- first win pays once
    def win():
        return pg.evaluate("""(async () => { const g = SMU.game, L = SMU.level, p0 = JSON.parse(localStorage.getItem('smu.profile')).coins; g.me.spawn(L.summit.x || 0, L.top + 0.6, L.summit.z || 0);
          await new Promise(res => setTimeout(res, 3200)); const p = JSON.parse(localStorage.getItem('smu.profile')); return { got: p.coins - p0, text: document.querySelector('#menu').textContent, ach: p.ach, scr: SMU.screen }; })()""")
    w = win()
    check("the first Normal win pays 4000 on top of the summit bonus", w["got"] == 4250, str(w["got"]))
    check("the results say so", "First win on Normal: 4000" in w["text"], w["text"][:200])
    pg.screenshot(path=str(out / "results.png"))
    click("[data-a=back]")
    frames(10)
    click("[data-a=solo]")
    t = pg.evaluate("document.querySelector('.card.d1').textContent")
    check("the Normal card stops offering it", "First win" not in t, t)
    click(".card.d1")
    pg.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=60000)
    frames(20)
    w = win()
    check("a second Normal win pays only the summit bonus", w["got"] == 250, str(w["got"]))
    click("[data-a=back]")
    frames(10)
    # Insane really is what it says.
    click("[data-a=solo]")
    click(".card.d3")
    pg.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=60000)
    frames(20)
    ins = pg.evaluate("(() => { const g = SMU.game; return { co: g.env.coyote, gr: g.env.grip, rope: g.rope, hc: g.hardcore, name: g.D.name }; })()")
    check("Insane: short cord, little grip, no late jumps", ins["co"] == 0.04 and ins["gr"] == 2.2 and ins["rope"] == 4.6 and ins["name"] == "Insane", str(ins))
    check("Insane counts for the hidden places", ins["hc"])
    check("no errors", not errs, "; ".join(errs)[:400])
print("FAILED: " + ", ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
