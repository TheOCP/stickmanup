"""A real game server for the browser tests, and a guest on it with coins to spend, since coins only exist on a server now."""
import atexit, json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestServer:
    def __init__(self, **extra):
        self.data = tempfile.mkdtemp(prefix="smu-ts-")
        s = socket.socket(); s.bind(("127.0.0.1", 0)); self.port = s.getsockname()[1]; s.close()
        self.url = f"http://127.0.0.1:{self.port}"
        # These tests play faster than real time and move the climber around by hand. On watch, that gets noted and nothing more.
        env = dict(os.environ, HOST="127.0.0.1", PORT=str(self.port), DATA_DIR=self.data, NODE_NO_WARNINGS="1", ANTICHEAT_SPEED_SLACK="100000", GUEST_LIMIT_BURST="1000", GUEST_LIMIT_PER_HOUR="100000", WALLET_MIN_WIN_SECONDS="1", **extra)
        self.log = open(self.data + "/server.log", "w")
        self.p = subprocess.Popen(["node", str(ROOT / "server/server.js")], env=env, stdout=self.log, stderr=self.log)
        for _ in range(100):
            try:
                self.info = json.loads(urllib.request.urlopen(self.url + "/api/info", timeout=1).read())
                break
            except Exception:
                time.sleep(0.1)
        atexit.register(self.stop)

    def stop(self):
        if self.p.poll() is None:
            self.p.kill()
        shutil.rmtree(self.data, ignore_errors=True)

    def sql(self, q, *args):
        script = f"const {{DatabaseSync}}=require('node:sqlite');const d=new DatabaseSync({json.dumps(self.data + '/stickmanup.db')});d.prepare({json.dumps(q)}).run(...{json.dumps(list(args))})"
        subprocess.run(["node", "-e", script], env=dict(os.environ, NODE_NO_WARNINGS="1"), check=True)

    def init_script(self):
        """Goes before the page's own settings are read: says the first start is over."""
        return "localStorage.setItem('smu.welcomed2', '1');"

    def enter(self, pg, coins=0, own=(), relics=(), ach=()):
        """Makes the page a guest on this server, holding this much."""
        tos = self.info["termsVersion"]
        pg.evaluate("async (v) => (await import('./js/cloud.js')).startGuest(v, 'Tester')", tos)
        acct = pg.evaluate("JSON.parse(localStorage.getItem('smu.account'))")
        # The server makes the wallet the first time someone asks for it.
        urllib.request.urlopen(urllib.request.Request(self.url + "/api/wallet", headers={"Authorization": "Bearer " + acct["token"]}), timeout=5).read()
        self.sql("UPDATE wallets SET coins = ?, earned = ?, own = ?, relics = ?, ach = ? WHERE user_id = ?", coins, coins, json.dumps(list(own)), json.dumps(list(relics)), json.dumps(list(ach)), acct["user"]["id"])
        pg.evaluate("async () => (await import('./js/cloud.js')).refreshWallet()")
        return acct
