"""The real game in real browser windows against the real server: the server browser, rooms with and without passwords,
playing through the relay, signing in with the terms, keeping progress on the account, signing out and deleting it. The
sign in sites are fakes (see the mock below). Saves pictures. Prints PASS or FAIL per check.
Usage: python dev/servergame.py OUTDIR"""
import functools, http.server, json, os, re, socket, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "assets"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "dev/out/servergame"); out.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=web.serve_forever, daemon=True).start()

# Fake Discord: says yes to everyone, with the name it is told to use.
mock_user = {"id": "u1", "username": "Ana"}
class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        self.reply({"access_token": "tok"})
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/auth":
            q = urllib.parse.parse_qs(u.query)
            self.send_response(302); self.send_header("Location", q["redirect_uri"][0] + "?code=c&state=" + q["state"][0]); self.end_headers()
        else:
            self.reply(mock_user)
    def reply(self, o):
        b = json.dumps(o).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
mock = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock)
threading.Thread(target=mock.serve_forever, daemon=True).start()
M = f"http://127.0.0.1:{mock.server_port}"

s = socket.socket(); s.bind(("127.0.0.1", 0)); SP = s.getsockname()[1]; s.close()
SERVER = f"http://127.0.0.1:{SP}"
tmp = tempfile.mkdtemp(prefix="smu-sg-")
env = {"PATH": os.environ["PATH"], "PORT": str(SP), "HOST": "127.0.0.1", "DATA_DIR": tmp, "PUBLIC_URL": SERVER, "WALLET_MIN_WIN_SECONDS": "4", "DISCORD_CLIENT_ID": "id", "DISCORD_CLIENT_SECRET": "sec", "STEAM_LOGIN": "1",
       "DEV_PROVIDER_URLS": json.dumps({"discordAuth": M + "/auth", "discordToken": M + "/token", "discordUser": M + "/user"})}
srv = subprocess.Popen(["node", "--disable-warning=ExperimentalWarning", str(HERE.parent / "server/server.js")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
for _ in range(50):
    try: urllib.request.urlopen(SERVER + "/api/health", timeout=1); break
    except Exception: time.sleep(0.1)

fails = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info != "" and not ok else ""), flush=True)
    if not ok: fails.append(name)

ARGS = ["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS, env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    errs = []
    def player(name, profile=None):
        c = b.new_context(bypass_csp=True, viewport={"width": 915, "height": 412})
        pg = c.new_page()
        pg.on("pageerror", lambda e: errs.append(f"[{name}] {e}"))
        init = "if (!localStorage.getItem('smu.settings')) localStorage.setItem('smu.settings', JSON.stringify(%s));" % json.dumps({"quality": "low", "name": name, "tips": False, "cap": 30, "server": SERVER})
        init += "if (!localStorage.getItem('smu.profile')) localStorage.setItem('smu.profile', %s);" % json.dumps(json.dumps(profile or {"coins": 0, "earned": 0, "own": [], "eq": None, "relics": [], "ach": [], "runs": {}, "totals": {}}))
        pg.add_init_script(init)
        pg.goto(f"http://127.0.0.1:{web.server_port}/index.html?native=rec")
        pg.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
        return pg
    def click(pg, sel): pg.locator(sel).first.click(timeout=8000); pg.wait_for_timeout(250)
    scr = lambda pg: pg.evaluate("SMU.screen")
    text = lambda pg: pg.evaluate("document.querySelector('#menu').textContent")
    prof = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('smu.profile'))")

    ana = player("Ana", {"coins": 700, "earned": 1000, "own": ["happy"], "eq": None, "relics": [], "ach": ["win0"], "runs": {}, "totals": {"climbs": 2}})
    # ---- the first start
    check("the first start asks about signing in", scr(ana) == "account", scr(ana))
    ana.wait_for_selector("#menu .terms", timeout=8000)
    t = text(ana)
    check("it says who made the game", "TheOCProductions" in t and "ShortGG" in t, t[:200])
    check("it shows the terms from the server", "These are the simple rules" in t, t[:200])
    check("it offers the sign ins the server has", "Sign in with Discord" in t and "Sign in with Steam" in t and "Sign in with Google" not in t, t[:400])
    check("the sign in buttons wait for the terms", ana.evaluate("[...document.querySelectorAll('.prov')].every(b => b.disabled)"))
    ana.screenshot(path=str(out / "signin.png"))
    click(ana, "#menu [data-a=back]")
    check("Play without coins goes straight to the game", scr(ana) == "title", scr(ana))
    check("and makes no account", ana.evaluate("!JSON.parse(localStorage.getItem('smu.account'))"))
    check("coins an older version kept on the phone are gone", prof(ana)["coins"] == 0 and prof(ana)["own"] == [], prof(ana))
    ana.screenshot(path=str(out / "title.png"))
    check("the title says who made the game", "Made by TheOCProductions & ShortGG" in text(ana))
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    check("and only asks that once", scr(ana) == "title", scr(ana))

    # ---- a public room with a password, by guests
    click(ana, "[data-a=browser]")
    ana.wait_for_selector("#bstat:not(:has(.spin))", timeout=8000)
    check("an empty browser says so", "No open rooms" in text(ana), text(ana)[:200])
    ana.screenshot(path=str(out / "browser-empty.png"))
    click(ana, "[data-a=create]")
    check("Create room opens the form", scr(ana) == "roomform", scr(ana))
    ana.fill("#rname", "Ana <b>rocks</b>")
    click(ana, "#rlock")
    click(ana, "[data-a=make]")
    check("a password can't be left empty", scr(ana) == "roomform", scr(ana))
    ana.fill("#rpass", "sesame")
    ana.screenshot(path=str(out / "roomform.png"))
    click(ana, "[data-a=make]")
    ana.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    code = ana.evaluate("document.querySelector('#menu .code').textContent")
    check("the room opens with a code", re.fullmatch(r"[A-Z2-9]{5}", code) is not None, code)
    ana.screenshot(path=str(out / "lobby.png"))
    t = text(ana)
    check("the lobby says it is public and has a password", "Public room" in t and "password" in t, t[:200])

    ben = player("Ben")
    click(ben, "#menu [data-a=back]")
    click(ben, "[data-a=browser]")
    ben.wait_for_selector("#rooms .item", timeout=8000)
    ben.screenshot(path=str(out / "browser.png"))
    row = ben.evaluate("document.querySelector('#rooms .item').textContent")
    check("the room shows in the other phone's browser", "Ana" in row and "1/4" in row, row)
    check("a nasty room name stays plain text", ben.evaluate("document.querySelector('#rooms .item b b') === null") and "<b>rocks</b>" in row, row)
    check("it shows the lock", "🔒" in row, row)
    click(ben, "#rooms .item")
    check("a locked room asks for the password", scr(ben) == "roompass", scr(ben))
    ben.screenshot(path=str(out / "password.png"))
    ben.fill("#jpass", "wrong")
    click(ben, "[data-a=go]")
    ben.wait_for_function("SMU.screen === 'browser'", timeout=8000)
    check("a wrong password goes back to the browser", scr(ben) == "browser", scr(ben))
    check("and says why", "Wrong password" in ben.evaluate("document.body.textContent"))
    ben.wait_for_selector("#rooms .item", timeout=8000)
    click(ben, "#rooms .item")
    ben.fill("#jpass", "sesame")
    click(ben, "[data-a=go]")
    ben.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    check("the right password gets in", scr(ben) == "lobby", scr(ben))
    ana.wait_for_function("SMU.screen === 'lobby' && document.querySelector('#menu').textContent.includes('Ben')", timeout=8000)
    check("the host sees the new climber", True)
    ana.wait_for_timeout(2500)

    # ---- the climb itself, through the relay
    click(ana, "[data-a=lmap][data-m='2']")
    ana.wait_for_timeout(600)
    click(ana, "[data-a=start]")
    ana.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    ben.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    check("the climb starts on both phones", True)
    check("on the map the host picked", ben.evaluate("SMU.game.map") == 2, ben.evaluate("SMU.game.map"))
    ana.wait_for_timeout(1200)
    ana.evaluate("(() => { const g = SMU.game, m = g.me; m.spawn(m.x + 1.2, m.y + 0.1, m.z); })()")
    ben.wait_for_timeout(1500)
    a0 = ana.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    seen = ben.evaluate("(() => { const p = SMU.game.s.players.get(0); return p && p.last ? [p.last[0], p.last[2]] : null; })()")
    check("the other phone sees the host move", seen and abs(seen[0] - a0[0]) < 1 and abs(seen[1] - a0[1]) < 1, f"{seen} {a0}")
    b0 = ben.evaluate("[SMU.game.me.x, SMU.game.me.z]")
    ana.wait_for_timeout(800)
    seen = ana.evaluate("(() => { const p = SMU.game.s.players.get(1); return p && p.last ? [p.last[0], p.last[2]] : null; })()")
    check("the host sees the other phone", seen and abs(seen[0] - b0[0]) < 1.5, f"{seen} {b0}")
    ping = ben.evaluate("SMU.game.s.ping")
    check("ping through the server is measured", 0 < ping < 2000, ping)
    print(f"     relay round trip here: {ping} ms", flush=True)
    ana.screenshot(path=str(out / "climb.png"))
    # A third joins while they climb, by code and password.
    cid = player("Cid")
    click(cid, "#menu [data-a=back]")
    click(cid, "[data-a=browser]")
    cid.wait_for_selector("#rooms .item", timeout=8000)
    row = cid.evaluate("document.querySelector('#rooms .item').textContent")
    check("the browser shows they are climbing, with 2 of 4", "climbing" in row and "2/4" in row and "Storm" not in row, row)
    click(cid, "[data-a=back]")
    click(cid, "[data-a=join]")
    check("Join starts on the server tab", cid.evaluate("!!document.querySelector('#scode')"))
    cid.screenshot(path=str(out / "join.png"))
    cid.fill("#scode", code.lower())
    cid.fill("#spass", "sesame")
    click(cid, "[data-a=server]")
    cid.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    check("joining a running climb by code and password works", True)
    cid.close()
    ana.wait_for_timeout(600)
    # The host leaves: the others are told, and the room is gone.
    ana.evaluate("SMU.game.s.close()")
    ben.wait_for_function("SMU.screen === 'msg'", timeout=10000)
    check("when the host leaves, the others are told", "host left" in text(ben), text(ben)[:120])
    click(ben, "[data-a=back]")
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)

    # ---- a private room
    click(ana, "[data-a=host]")
    click(ana, "[data-a=server]")
    click(ana, "[data-a=vis][data-v='0']")
    click(ana, "[data-a=make]")
    ana.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    code2 = ana.evaluate("document.querySelector('#menu .code').textContent")
    check("a private room says so", "Private room" in text(ana), text(ana)[:120])
    click(ben, "[data-a=browser]")
    ben.wait_for_selector("#bstat:not(:has(.spin))", timeout=8000)
    check("a private room isn't in the browser", code2 not in ben.evaluate("document.querySelector('#rooms').innerHTML") and "No open rooms" in text(ben), text(ben)[:200])
    ben.fill("#bcode", code2)
    click(ben, "[data-a=bjoin]")
    click(ben, "[data-a=go]")
    ben.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    check("but its code gets you in", True)
    click(ana, "[data-a=back]")
    ben.wait_for_function("SMU.screen === 'msg'", timeout=8000)
    click(ben, "[data-a=back]")

    # ---- signing in
    def sign_in(pg):
        click(pg, "[data-a=account]")
        pg.wait_for_selector("#tos", timeout=8000)
        click(pg, "#tos")
        check("accepting the terms wakes the buttons", pg.evaluate("[...document.querySelectorAll('.prov')].every(b => !b.disabled)"))
        with pg.context.expect_page() as w:
            click(pg, "[data-a=login][data-p=discord]")
        tab = w.value
        tab.wait_for_load_state()
        tab.wait_for_selector("a", timeout=8000)
        return tab
    tab = sign_in(ana)
    check("it waits for the browser", scr(ana) == "signingin", scr(ana))
    ana.screenshot(path=str(out / "waiting.png"))
    tab.screenshot(path=str(out / "browserpage.png"))
    page_text = tab.evaluate("document.body.textContent")
    check("the browser page greets you and names the makers", "Hi Ana" in page_text and "TheOCProductions" in page_text, page_text[:200])
    href = tab.evaluate("document.querySelector('a').getAttribute('href')")
    check("it sends you back to the app", href.startswith("stickmanup://auth?code="), href[:40])
    acode = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)["code"][0]
    tab.close()
    # What the Android app does when the browser comes back.
    ana.evaluate("code => SMU_authCode(code)", acode)
    ana.wait_for_function("!!JSON.parse(localStorage.getItem('smu.account'))", timeout=8000)
    ana.wait_for_function("SMU.screen === 'title'", timeout=8000)
    check("signed in, back at the title", scr(ana) == "title", scr(ana))
    check("the title shows your name", ana.evaluate("document.querySelector('.acctbtn').textContent") == "Ana")
    ana.screenshot(path=str(out / "title-signedin.png"))
    acct = ana.evaluate("JSON.parse(localStorage.getItem('smu.account'))")
    token = acct["token"]
    def server_save(tok):
        req = urllib.request.Request(SERVER + "/api/save", headers={"Authorization": "Bearer " + tok})
        return json.loads(urllib.request.urlopen(req).read())
    ana.wait_for_timeout(500)
    sv = server_save(token)
    def wallet_of(tok):
        return json.loads(urllib.request.urlopen(urllib.request.Request(SERVER + "/api/wallet", headers={"Authorization": "Bearer " + tok})).read())
    wa = wallet_of(token)
    check("nothing the phone claims counts as coins", wa["coins"] == 0 and wa["own"] == [], str(wa)[:200])
    def db(q, *args):
        subprocess.run(["node", "--disable-warning=ExperimentalWarning", "-e", f"const {{DatabaseSync}}=require('node:sqlite');const d=new DatabaseSync({json.dumps(tmp + '/stickmanup.db')});d.prepare({json.dumps(q)}).run(...{json.dumps(list(args))})"], check=True)
    db("UPDATE wallets SET coins = 700, earned = 1000, own = ? WHERE user_id = ?", json.dumps(["happy"]), acct["user"]["id"])
    ana.evaluate("(async () => (await import('./js/cloud.js')).refreshWallet())()")
    check("the save holds no coins at all", sv["data"] and "coins" not in sv["data"]["profile"] and "own" not in sv["data"]["profile"], str(sv)[:200])
    fake = ana.evaluate("""async ([u, c]) => (await fetch(u + '/auth/exchange', { method: 'POST', body: JSON.stringify({ code: c, verifier: 'x'.repeat(43) }) })).status""", [SERVER, acode])
    check("the code from the browser works only once, and nobody else can use it", fake == 400, fake)

    # ---- a link nobody asked for does nothing
    ben.evaluate("SMU_authCode('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')")
    ben.wait_for_timeout(400)
    check("a sign in link you didn't start is ignored", ben.evaluate("!JSON.parse(localStorage.getItem('smu.account'))"))

    # ---- a stranger's room that tries everything
    dee = player("Dee")
    click(dee, "#menu [data-a=back]")
    EVIL = '"><img src=x onerror="window.PWNED=1"><script>window.PWNED=1</script>'
    bad = b.new_context(bypass_csp=True).new_page()
    bad.goto(SERVER + "/api/health")
    proto = dee.evaluate("(async () => (await import('./js/net.js')).PROTO)()")
    bad.evaluate("""([url, proto, EVIL]) => new Promise((done) => {
      const ws = window.ws = new WebSocket(url);
      const send = window.send = (id, o) => ws.send(id + '|' + JSON.stringify(o));
      ws.onopen = () => ws.send('!' + JSON.stringify({ t: 'host', proto, name: EVIL, host: EVIL, pub: true, map: 999, diff: 999 }));
      ws.onmessage = (e) => {
        const d = e.data;
        if (d[0] === '!') { const m = JSON.parse(d.slice(1)); if (m.t === 'hosted') { window.code = m.code; done(); } if (m.t === 'peer+') window.peer = m.id; return; }
        const i = d.indexOf('|'), id = +d.slice(0, i), m = JSON.parse(d.slice(i + 1));
        if (m.k === 'hello') send(id, { k: 'welcome', slot: 1, game: null, lobby: { map: EVIL, diff: EVIL, rules: { cps: EVIL, haz: 99, rope: 99 }, noCord: EVIL, resume: EVIL },
          players: [{ slot: 0, name: EVIL, ping: EVIL, color: EVIL, look: { s: '__proto__', f: 'constructor', h: EVIL } }, { slot: EVIL, name: EVIL, ping: EVIL }, { slot: 1, name: EVIL, ping: EVIL }] });
      };
    })""", [SERVER.replace("http", "ws") + "/ws", proto, EVIL])
    click(dee, "[data-a=browser]")
    dee.wait_for_selector("#rooms .item", timeout=8000)
    def clean(pg, what):
        check(what, pg.evaluate("!window.PWNED && !document.querySelector('img[src=x]')"), pg.evaluate("document.querySelector('#menu').innerHTML.slice(0, 300)"))
    clean(dee, "a stranger's room name can't run anything in the browser")
    click(dee, "#rooms .item")
    dee.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    clean(dee, "nor in the lobby, whatever the roster says")
    bad.evaluate("""(EVIL) => send(window.peer, { k: 'start', map: 999, diff: EVIL, rules: { rope: 999, cps: EVIL }, t0: EVIL, base: EVIL, cp: EVIL, falls: EVIL, doors: EVIL, stuns: EVIL, pos: EVIL, noCord: EVIL, pcp: EVIL })""", EVIL)
    dee.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    check("a poisoned start still gives a normal climb", dee.evaluate("SMU.game.map === 0 && SMU.game.diff === 0 && SMU.game.falls === 0"))
    bad.evaluate("""(EVIL) => {
      send(window.peer, { k: 'S', t: 1, f: EVIL, cp: EVIL, p: { 0: EVIL, 1: EVIL } });
      for (const e of [{ k: 'emote', s: 0, e: 'constructor' }, { k: 'emote', s: 0, e: '__proto__' }, { k: 'respawn', falls: EVIL, only: 0, why: 'splash' }, EVIL, null])
        send(window.peer, { k: 'ev', e });
    }""", EVIL)
    dee.wait_for_timeout(800)
    clean(dee, "nothing it sends during the climb runs")
    check("the fall count on screen stays a number", dee.evaluate("typeof SMU.game.falls === 'number' && !document.querySelector('#hTime img')"))
    bad.evaluate("""(EVIL) => send(window.peer, { k: 'ev', e: { k: 'win', t: EVIL, falls: EVIL } })""", EVIL)
    dee.wait_for_function("SMU.screen === 'msg' || document.querySelector('.results')", timeout=15000)
    clean(dee, "nor can a poisoned win reach the results")
    dee.evaluate("SMU.game && SMU.game.s.close()")
    bad.close()
    dee.reload(); dee.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    click(dee, "[data-a=records]")
    clean(dee, "or the records after a restart")
    click(dee, "[data-a=back]")

    # ---- a stranger joining your room who tries everything
    click(dee, "[data-a=host]")
    click(dee, "[data-a=server]")
    click(dee, "[data-a=make]")
    dee.wait_for_function("SMU.screen === 'lobby'", timeout=8000)
    room3 = dee.evaluate("document.querySelector('#menu .code').textContent")
    bad = b.new_context(bypass_csp=True).new_page()
    bad.goto(SERVER + "/api/health")
    bad.evaluate("""([url, proto, code, EVIL]) => new Promise((done) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send('!' + JSON.stringify({ t: 'join', proto, code, pass: '' }));
      let sent = false;
      ws.onmessage = (e) => {
        if (e.data[0] === '!') {
          ws.send(JSON.stringify({ k: 'hello', v: proto, name: EVIL, color: EVIL, look: { s: EVIL, f: 'constructor', h: '__proto__' } }));
          return;
        }
        if (sent) return;
        sent = true;
        for (const m of [{ k: 'st', r: EVIL, s: EVIL }, { k: 'info', name: EVIL, color: EVIL, look: EVIL }, { k: 'ev', e: EVIL }, { k: 'ev', e: null }, null, 5, EVIL]) ws.send(JSON.stringify(m));
        setTimeout(done, 500);
      };
    })""", [SERVER.replace("http", "ws") + "/ws", proto, room3, EVIL])
    dee.wait_for_timeout(500)
    clean(dee, "a stranger joining can't run anything on the host")
    check("and their ping stays a number", dee.evaluate("[...document.querySelectorAll('#menu .slot small')].every(e => /^(\\d+ ms)?$/.test(e.textContent))"), dee.evaluate("document.querySelector('#menu').textContent")[:200])
    bad.close()
    click(dee, "[data-a=back]")
    dee.wait_for_function("SMU.screen === 'title'", timeout=8000)
    dee.context.close()
    # And if something ever does get through, it still can't run. (The other windows switch this rule off, because the
    # test tool's waiting needs it off. This one keeps it, and the whole game has to work under it.)
    strict_errs = []
    sc = b.new_context(viewport={"width": 915, "height": 412})
    st = sc.new_page()
    st.on("pageerror", lambda e: strict_errs.append(str(e)))
    st.on("console", lambda m: strict_errs.append(m.text) if "Content Security Policy" in m.text and "csp-probe" not in m.text and "onerror" not in m.text and "inline event" not in m.text else None)
    st.add_init_script("localStorage.setItem('smu.settings', JSON.stringify(%s));localStorage.setItem('smu.welcomed2','1');" % json.dumps({"quality": "low", "name": "Strict", "tips": False, "cap": 30, "server": SERVER}))
    st.goto(f"http://127.0.0.1:{web.server_port}/index.html?native=rec")
    for _ in range(600):
        if st.evaluate("!!(window.SMU && SMU.pool && SMU.pool.warm === 0)"): break
        st.wait_for_timeout(200)
    check("the game starts with the script rule on", st.evaluate("!!window.SMU") and st.evaluate("SMU.screen") == "title", st.evaluate("window.SMU ? SMU.screen : 'no game'"))
    st.evaluate("document.body.insertAdjacentHTML('beforeend', '<img id=csp src=x onerror=\"window.CSPFAIL=1\">')")
    st.evaluate("document.body.insertAdjacentHTML('beforeend', '<a id=csp2 href=\"javascript:window.CSPFAIL=1\">x</a>')")
    st.wait_for_timeout(400)
    st.locator("#csp2").click(force=True, timeout=3000)
    st.wait_for_timeout(300)
    check("the page refuses to run anything but the game's own scripts", not st.evaluate("window.CSPFAIL"))
    st.evaluate("document.querySelector('#csp').remove(); document.querySelector('#csp2').remove()")
    click(st, "[data-a=browser]")
    st.wait_for_selector("#bstat:not(:has(.spin))", timeout=8000)
    check("the server browser works with the rule on", "Could not reach" not in st.evaluate("document.querySelector('#bstat').textContent"))
    click(st, "[data-a=back]")
    click(st, "[data-a=solo]")
    click(st, ".card.d0")
    for _ in range(300):
        if st.evaluate("!!(SMU.game && SMU.screen === 'game')"): break
        st.wait_for_timeout(200)
    check("and so does a climb", st.evaluate("!!SMU.game"))
    check("with no script refused", not strict_errs, "; ".join(strict_errs)[:400])
    sc.close()

    # ---- the same account on another phone
    tab = sign_in(ben)
    bcode = urllib.parse.parse_qs(urllib.parse.urlparse(tab.evaluate("document.querySelector('a').getAttribute('href')")).query)["code"][0]
    tab.close()
    ben.evaluate("code => SMU_authCode(code)", bcode)
    ben.wait_for_function("!!JSON.parse(localStorage.getItem('smu.account'))", timeout=8000)
    ben.wait_for_timeout(800)
    pb = prof(ben)
    check("your coins reach the other phone", pb["coins"] == 700 and "happy" in pb["own"], str(pb)[:200])
    # ---- the coins are the server's
    btok0 = ben.evaluate("JSON.parse(localStorage.getItem('smu.account')).token")
    ben.evaluate("""(() => { const p = JSON.parse(localStorage.getItem('smu.profile')); p.coins = 999999; p.earned = 999999; p.own.push('samurai'); localStorage.setItem('smu.profile', JSON.stringify(p)); })()""")
    ben.reload(); ben.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ben.wait_for_function("JSON.parse(localStorage.getItem('smu.profile')).coins === 700", timeout=8000)
    pb = prof(ben)
    check("editing the phone doesn't stick: the server's number comes back", pb["coins"] == 700 and "samurai" not in pb["own"], str(pb)[:200])
    check("and the server never heard of it", wallet_of(btok0)["coins"] == 700 and "samurai" not in wallet_of(btok0)["own"])
    # Buying with coins the phone only imagines
    bought = ben.evaluate("""(async () => {
      const p = await import('./js/profile.js'), c = await import('./js/cloud.js'), s = await import('./js/skins.js');
      p.addCoins(100000);
      const it = s.SUITS.find((x) => x.id === 'samurai');
      return [await c.buyItem(it), p.owned(it, 'x'), p.coins()];
    })()""")
    check("buying with made up coins is refused by the server", bought[0] == "Not enough coins." and bought[1] is False and bought[2] == 700, bought)
    check("and takes nothing", wallet_of(btok0)["coins"] == 700)
    # Earning on one phone and spending on the other add up, because there is only one wallet
    def climb_start(pg, d):
        pg.evaluate("(d) => SMU.startSolo(0, d, null)", d)
        pg.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=60000)
        pg.wait_for_timeout(1500)
    def pick_coins(pg, n):
        return pg.evaluate("""async (n) => { const g = SMU.game, L = SMU.level; for (const c of L.coins.slice(0, n)) { g.me.spawn(c.x, c.y, c.z); await new Promise((r) => setTimeout(r, 250)); } return g.coinTaken.size; }""", n)
    def climb_quit(pg):
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        click(pg, "[data-a=quit]")
    climb_start(ana, 3)
    took0 = pick_coins(ana, 5)
    climb_quit(ana)
    ana.wait_for_function("JSON.parse(localStorage.getItem('smu.profile')).coins === %d" % (700 + took0 * 4), timeout=12000)
    # The phone shows them straight away. The server has them once the climb's last piece has arrived.
    for _ in range(40):
        if wallet_of(token)["coins"] == 700 + took0 * 4: break
        time.sleep(0.25)
    check("coins picked up in a climb reach the server", took0 >= 5 and wallet_of(token)["coins"] == 700 + took0 * 4 and wallet_of(token)["earned"] >= 700 + took0 * 4, wallet_of(token))
    click(ben, "[data-a=shop]")
    ben.wait_for_selector("#menu .shopgrid", timeout=8000)
    # The cheapest thing on the screen that isn't owned yet, picked and bought with the real buttons
    ben.evaluate(r"""() => {
      const cost = (x) => parseInt(x.querySelector('.price').textContent.replace(/\D/g, ''), 10);
      [...document.querySelectorAll('#menu .shopgrid .skin.no')].filter((x) => x.querySelector('.price')).sort((a, b) => cost(a) - cost(b))[0].click();
    }""")
    ben.wait_for_timeout(200)
    before_buy = wallet_of(btok0)
    price = ben.evaluate(r"""(() => { const m = /Buy for (\d+) coins/.exec(document.querySelector('#menu').textContent); return m ? +m[1] : 0; })()""")
    check("the shop offers it at its price", 0 < price <= before_buy["coins"], price)
    click(ben, "[data-a=buy]")
    ben.wait_for_function("document.querySelector('#menu').textContent.indexOf('Buy for') < 0", timeout=8000)
    w2 = wallet_of(btok0)
    check("buying in the shop goes through the server", w2["coins"] == before_buy["coins"] - price and len(w2["own"]) == len(before_buy["own"]) + 1, f"{w2} {before_buy} {price}")
    click(ben, "[data-a=back]")
    ana.evaluate("""(async () => { const c = await import('./js/cloud.js'); await c.refreshWallet(); })()""")
    ana.wait_for_timeout(300)
    check("the other phone sees the same wallet", prof(ana)["coins"] == w2["coins"] == prof(ben)["coins"], f"{prof(ana)['coins']} {w2['coins']} {prof(ben)['coins']}")
    # No connection: climbs wait, and nothing is lost
    climb_start(ana, 1)
    ana.context.set_offline(True)
    took1 = pick_coins(ana, 5)
    climb_quit(ana)
    check("offline, the climb waits on the phone", len(ana.evaluate("JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]')")) >= 1)
    sold = ana.evaluate("""(async () => { const c = await import('./js/cloud.js'), s = await import('./js/skins.js'); return c.buyItem(s.HATS.find((x) => x.price > 0)); })()""")
    check("offline, buying says it needs a connection", sold and "connection" in sold, sold)
    ana.context.set_offline(False)
    ana.evaluate("""(async () => { const c = await import('./js/cloud.js'); await c.report(); })()""")
    ana.wait_for_timeout(500)
    ana.evaluate("""(async () => { const c = await import('./js/cloud.js'); await c.report(); })()""")
    check("back online, its coins arrive", wallet_of(token)["coins"] == w2["coins"] + took1 * 2 and ana.evaluate("JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]').length") == 0, wallet_of(token))
    # The donate button opens PayPal
    ana.context.route("https://paypal.me/**", lambda r: r.fulfill(status=200, content_type="text/plain", body="ok"))
    with ana.context.expect_page() as w:
        click(ana, "[data-a=donate]")
    w.value.wait_for_load_state()
    check("the donate button opens PayPal", w.value.url.rstrip("/") == "https://paypal.me/theocproductions", w.value.url)
    w.value.close()

    # ---- a real climb on an account, with the game doing the reporting
    def wallet_is(tok, test, secs=25):
        end = time.time() + secs
        while time.time() < end:
            w = wallet_of(tok)
            if test(w): return w
            time.sleep(0.3)
        return wallet_of(tok)
    w0 = wallet_of(token)
    click(ana, "[data-a=solo]")
    click(ana, "[data-a=pick][data-d='1']")
    ana.wait_for_timeout(1200)
    took = ana.evaluate("""(async () => {
      const g = SMU.game, L = SMU.level;
      for (const c of L.coins.slice(0, 3)) { g.me.spawn(c.x, c.y, c.z); await new Promise((r) => setTimeout(r, 250)); }
      return g.coinTaken.size;
    })()""")
    check("a real climb picks up coins", took >= 3, took)
    ana.keyboard.press("Escape")
    ana.wait_for_timeout(300)
    click(ana, "[data-a=quit]")
    wa = wallet_is(token, lambda w: w["coins"] == w0["coins"] + took * 2)
    check("leaving the climb pays those coins on the server", wa["coins"] == w0["coins"] + took * 2, f"{wa['coins']} {w0['coins']} {took}")
    check("what the phone shows is what the server says", prof(ana)["coins"] == wa["coins"], f"{prof(ana)['coins']} {wa['coins']}")
    saved_run = ana.evaluate("(JSON.parse(localStorage.getItem('smu.save.solo')) || {}).climbId")
    check("the saved climb remembers its place on the server", isinstance(saved_run, str) and len(saved_run) > 10, saved_run)
    click(ana, "[data-a=cont]")
    ana.wait_for_timeout(900)
    now_run = ana.evaluate("(async () => (await import('./js/cloud.js')).runId())()")
    check("picking it up again carries on the same climb", now_run == saved_run, f"{now_run} {saved_run}")
    ana.wait_for_timeout(2500)
    won = ana.evaluate("""(async () => {
      const g = SMU.game, L = SMU.level;
      g.falls = 0;
      g.me.spawn(L.summit.x || 0, L.top + 0.6, L.summit.z || 0);
      await new Promise((r) => setTimeout(r, 3200));
      return g.won;
    })()""")
    check("the climb reaches the top", won is True, won)
    wb = wallet_is(token, lambda w: "win1" in w["ach"])
    check("the server pays the top and the first win", "win1" in wb["ach"] and wb["coins"] >= wa["coins"] + 250 + 4000, f"{wb['coins']} {wa['coins']} {wb['ach']}")
    ana.wait_for_timeout(500)
    check("and the phone agrees with it", prof(ana)["coins"] == wallet_of(token)["coins"], f"{prof(ana)['coins']} {wallet_of(token)['coins']}")
    click(ana, "[data-a=back]")
    ana.wait_for_timeout(500)
    check("nothing is left waiting to be sent", ana.evaluate("JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]').filter((c) => c.coins.length || c.win).length") == 0)

    # ---- a guest: the coins are on the server, and come along when signing in
    gus = player("Gus")
    gus.wait_for_selector("#tos", timeout=8000)
    check("Play as guest waits for the terms too", gus.evaluate("document.querySelector('[data-a=guest]').disabled"))
    click(gus, "#tos")
    check("and accepting them wakes it", gus.evaluate("!document.querySelector('[data-a=guest]').disabled"))
    gus.screenshot(path=str(out / "first.png"))
    click(gus, "[data-a=guest]")
    gus.wait_for_function("SMU.screen === 'title' && !!JSON.parse(localStorage.getItem('smu.account'))", timeout=8000)
    ga = gus.evaluate("JSON.parse(localStorage.getItem('smu.account'))")
    check("a guest gets an account on the server", ga["user"]["provider"] == "guest" and ga["user"]["num"] > 0 and bool(ga["token"]), ga["user"])
    check("the title says so", "Guest" in gus.evaluate("document.querySelector('.acctbtn').textContent"))
    gus.screenshot(path=str(out / "title-guest.png"))
    gus.reload(); gus.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    check("and is still one after a restart", scr(gus) == "title" and gus.evaluate("JSON.parse(localStorage.getItem('smu.account')).token") == ga["token"], scr(gus))
    climb_start(gus, 1)
    took2 = pick_coins(gus, 3)
    climb_quit(gus)
    wg = wallet_is(ga["token"], lambda w: w["coins"] == took2 * 2)
    check("a guest's coins are on the server", took2 >= 3 and wg["coins"] == took2 * 2, f"{took2} {wg}")
    gus.wait_for_timeout(300)
    check("and the phone shows the server's number", prof(gus)["coins"] == wg["coins"], prof(gus)["coins"])
    click(gus, "[data-a=account]")
    gus.wait_for_function("document.querySelector('#menu').textContent.includes('Player #')", timeout=8000)
    gus.screenshot(path=str(out / "guest-account.png"))
    check("the guest's account screen shows the number and offers signing in", "Sign in with Discord" in text(gus), text(gus)[:300])
    mock_user.update(id="u9", username="Gus")
    with gus.context.expect_page() as w:
        click(gus, "[data-a=login][data-p=discord]")
    tab = w.value
    tab.wait_for_load_state()
    tab.wait_for_selector("a", timeout=8000)
    gcode = urllib.parse.parse_qs(urllib.parse.urlparse(tab.evaluate("document.querySelector('a').getAttribute('href')")).query)["code"][0]
    tab.close()
    gus.evaluate("code => SMU_authCode(code)", gcode)
    gus.wait_for_function("JSON.parse(localStorage.getItem('smu.account')).user.provider === 'discord'", timeout=8000)
    mock_user.update(id="u1", username="Ana")
    gacct = gus.evaluate("JSON.parse(localStorage.getItem('smu.account'))")
    check("signing in takes a guest's coins along", wallet_of(gacct["token"])["coins"] == took2 * 2, wallet_of(gacct["token"]))
    check("and leaves none behind to spend twice", wallet_of(ga["token"])["coins"] == 0, wallet_of(ga["token"]))
    gus.wait_for_timeout(500)
    check("and the phone shows them", prof(gus)["coins"] == took2 * 2, prof(gus)["coins"])
    # What a ban looks like.
    db("INSERT INTO bans (kind, value, user_id, name, reason, by_who, at, until) VALUES ('user', ?, ?, 'Gus', 'Flying around', 'test', ?, NULL)", gacct["user"]["id"], gacct["user"]["id"], int(time.time() * 1000))
    gus.reload(); gus.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    gus.wait_for_function("document.querySelector('#menu').textContent.includes('You are banned')", timeout=8000)
    check("a banned player is told why, with their number", "Flying around" in text(gus) and f"#{gacct['user']['num']}" in text(gus), text(gus)[:300])
    gus.screenshot(path=str(out / "banned.png"))
    check("and every mode is grayed out", gus.evaluate("[...document.querySelectorAll('.mainbtns [data-a=solo], .mainbtns [data-a=host], .mainbtns [data-a=join], .mainbtns [data-a=shop]')].every((b) => b.getAttribute('aria-disabled') === 'true')"))
    gus.close()
    # A message from the admins.
    db("INSERT INTO settings (k, v) VALUES ('announce', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", json.dumps({"id": "a1", "text": "Event tonight!", "until": 0}))
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ana.wait_for_function("document.querySelector('#menu').textContent.includes('Event tonight!')", timeout=8000)
    check("a message from the admins shows on the title", scr(ana) == "title", scr(ana))
    ana.screenshot(path=str(out / "announce.png"))
    db("UPDATE settings SET v = '' WHERE k = 'announce'")

    # ---- the account screen
    click(ben, "[data-a=account]")
    ben.wait_for_selector("[data-a=sync]", timeout=8000)
    t = text(ben)
    check("the account screen shows your name, the service and the makers", "Ana" in t and "Discord" in t and "TheOCProductions" in t, t[:200])
    ben.screenshot(path=str(out / "account.png"))
    click(ben, "[data-a=out]")
    ben.wait_for_function("SMU.screen === 'title'", timeout=8000)
    pb = prof(ben)
    check("signing out gives back the guest you were, with nothing of the account", pb["coins"] == 0 and pb["own"] == [] and ben.evaluate("!JSON.parse(localStorage.getItem('smu.account'))"), str(pb)[:200])
    check("the title offers sign in again", ben.evaluate("document.querySelector('.acctbtn').textContent") == "Sign in")
    # ---- a dead server is no problem
    srv.terminate(); srv.wait(timeout=5)
    click(ben, "[data-a=browser]")
    ben.wait_for_function("document.querySelector('#bstat') && document.querySelector('#bstat').textContent.includes('Could not reach')", timeout=15000)
    check("with the server down the browser says so", True)
    ben.screenshot(path=str(out / "browser-down.png"))
    click(ben, "[data-a=back]")
    click(ben, "[data-a=solo]")
    click(ben, ".card.d0")
    ben.wait_for_function("SMU.game && SMU.screen === 'game'", timeout=120000)
    check("and you can still climb as a guest", True)
    srv = subprocess.Popen(["node", "--disable-warning=ExperimentalWarning", str(HERE.parent / "server/server.js")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(50):
        try: urllib.request.urlopen(SERVER + "/api/health", timeout=1); break
        except Exception: time.sleep(0.1)

    # ---- the terms change
    def serve(text):
        global srv
        srv.terminate(); srv.wait(timeout=5)
        f = Path(tmp) / "terms-new.txt"; f.write_text(text)
        srv = subprocess.Popen(["node", "--disable-warning=ExperimentalWarning", str(HERE.parent / "server/server.js")], env={**env, "TERMS_FILE": str(f)}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(50):
            try: urllib.request.urlopen(SERVER + "/api/health", timeout=1); break
            except Exception: time.sleep(0.1)
    serve("Brand new terms, version two.")
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ana.wait_for_function("document.querySelector('#menu') && document.querySelector('#menu').textContent.includes('Brand new terms')", timeout=8000)
    check("new terms are asked for at the next start", scr(ana) == "account", scr(ana))
    ana.screenshot(path=str(out / "newterms.png"))
    click(ana, "[data-a=ok]")
    ana.wait_for_function("SMU.screen === 'title'", timeout=8000)
    check("accepting them carries on signed in", ana.evaluate("!!JSON.parse(localStorage.getItem('smu.account'))"))
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ana.wait_for_timeout(600)
    check("and doesn't ask again", scr(ana) == "title", scr(ana))
    ben.reload(); ben.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ben.evaluate("(async () => { const m = await import('./js/profile.js'); m.addCoins(42); m.flushProfile(); })()")
    guest_coins = prof(ben)["coins"]
    tab = sign_in(ben)
    bcode = urllib.parse.parse_qs(urllib.parse.urlparse(tab.evaluate("document.querySelector('a').getAttribute('href')")).query)["code"][0]
    tab.close()
    ben.evaluate("code => SMU_authCode(code)", bcode)
    ben.wait_for_function("!!JSON.parse(localStorage.getItem('smu.account'))", timeout=8000)
    ben.wait_for_function("SMU.screen === 'title'", timeout=8000)
    btok = ben.evaluate("JSON.parse(localStorage.getItem('smu.account')).token")
    ben.wait_for_timeout(500)
    serve("Even newer terms, version three.")
    ben.reload(); ben.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ben.wait_for_selector("#menu [data-a=out]", timeout=8000)
    click(ben, "#menu [data-a=out]")
    ben.wait_for_function("SMU.screen === 'title'", timeout=8000)
    check("saying no signs you out", ben.evaluate("!JSON.parse(localStorage.getItem('smu.account'))"))
    check("and gives back the guest you were", prof(ben)["coins"] == guest_coins, f"{prof(ben)['coins']} {guest_coins}")
    code_ = 0
    try: urllib.request.urlopen(urllib.request.Request(SERVER + "/api/me", headers={"Authorization": "Bearer " + btok}))
    except urllib.error.HTTPError as e: code_ = e.code
    check("and really ends the session", code_ == 401, code_)
    # Ana's terms changed too, so she accepts them first.
    ana.reload(); ana.wait_for_function("window.SMU && SMU.pool && SMU.pool.warm === 0", timeout=120000)
    ana.wait_for_selector("#menu [data-a=ok]", timeout=8000)
    click(ana, "#menu [data-a=ok]")
    ana.wait_for_function("SMU.screen === 'title'", timeout=8000)

    # ---- deleting the account
    click(ana, "[data-a=account]")
    ana.wait_for_selector("[data-a=del]", timeout=8000)
    click(ana, "[data-a=del]")
    ana.screenshot(path=str(out / "delete.png"))
    click(ana, "[data-a=yes]")
    ana.wait_for_function("SMU.screen === 'title'", timeout=8000)
    code_ = 0
    try: urllib.request.urlopen(urllib.request.Request(SERVER + "/api/me", headers={"Authorization": "Bearer " + token}))
    except urllib.error.HTTPError as e: code_ = e.code
    check("deleting the account really deletes it", code_ == 401, code_)
    check("and you are the guest you were before signing in", prof(ana)["coins"] == 0 and ana.evaluate("!JSON.parse(localStorage.getItem('smu.account'))"), prof(ana)["coins"])
    check("no errors", not errs, "; ".join(errs)[:500])
    b.close()
srv.terminate()
print("FAILED: " + ", ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
