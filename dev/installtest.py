#!/usr/bin/env python3
"""Runs server/install.sh the way a person does: piped into bash like curl | bash, answering its questions by typing on a
real terminal. On a pretend server: certbot, systemctl, journalctl and apt-get are stand ins, and apt-get eats its input,
which is what stops a careless curl | bash halfway. Node, the server files, the server itself and HTTPS are all real.
Not covered: real certbot, real systemd. Needs internet. Usage: python3 dev/installtest.py"""
import fcntl, json, os, pty, re, select, shutil, signal, stat, subprocess, sys, tempfile, termios, threading, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / "server/install.sh").read_bytes()
X = Path(tempfile.mkdtemp(prefix="smu-inst-"))
STUBS = X / "stubs"; STUBS.mkdir()
fails, good = [], 0
def check(name, ok, info=""):
    global good
    if ok: good += 1
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(info)[-900:]}]" if not ok else ""), flush=True)
    if not ok: fails.append(name)

def stub(name, text):
    p = STUBS / name; p.write_text("#!/bin/bash\n" + text); p.chmod(0o755)
stub("apt-get", 'echo "apt-get $*" >> "$T/calls.log"\ncat > /dev/null\n')
stub("journalctl", 'echo "(journal)"\n')
# Who holds port 80 on the pretend server. Everything else is free, except the game ports the test says are taken.
stub("ss", r'''p=$(printf '%s' "$*" | sed -n 's/.*sport = :\([0-9]*\).*/\1/p')
if [ "$p" = 80 ] && [ -n "$HOLDS_80" ]; then echo "LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:((\"$HOLDS_80\",pid=1,fd=6))"; fi
case " $TAKEN_PORTS " in *" $p "*) echo "LISTEN 0 511 0.0.0.0:$p 0.0.0.0:* users:((\"other\",pid=2,fd=6))" ;; esac
exit 0
''')
stub("certbot", r'''echo "certbot $*" >> "$T/calls.log"
d=""; while [ $# -gt 0 ]; do [ "$1" = -d ] && d=$2; shift; done
case " $CERTBOT_FAIL " in *" $d "*) echo "certbot: pretend failure for $d" >&2; exit 1 ;; esac
L="$STICKMANUP_LE/live/$d"; mkdir -p "$L"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$d" -addext "subjectAltName=DNS:$d" -keyout "$L/privkey.pem" -out "$L/fullchain.pem" 2>/dev/null
cat "$L/fullchain.pem" >> "$CURL_CA_BUNDLE"
''')
stub("systemctl", r'''echo "systemctl $*" >> "$T/calls.log"
stop() { [ -f "$T/pid" ] || return 0; p=$(cat "$T/pid"); kill "$p" 2>/dev/null; while kill -0 "$p" 2>/dev/null; do sleep 0.1; done; rm -f "$T/pid"; }
case "$1" in
  restart)
    stop
    # setsid: a real service doesn't die with the terminal that started it.
    ( set -a; . "$STICKMANUP_ETC/server.env"; set +a; exec setsid "$STICKMANUP_PREFIX/node/bin/node" "$STICKMANUP_PREFIX/app/server.js" >> "$T/server.log" 2>&1 < /dev/null ) &
    echo $! > "$T/pid" ;;
  is-active) [ -f "$T/pid" ] && kill -0 "$(cat "$T/pid")" ;;
  disable) stop ;;
  reload) [ -f "$T/pid" ] && kill -HUP "$(cat "$T/pid")" ;;
  status) echo "(status)" ;;
esac
exit 0
''')

ca = X / "ca.pem"
sys_ca = next((p for p in ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"] if os.path.exists(p)), None)
ca.write_bytes(Path(sys_ca).read_bytes() if sys_ca else b"")
# Node is big, so it is fetched once and every install finds it already there.
NODE_KEEP = Path(tempfile.gettempdir()) / "smu-node-cache"
subprocess.run(["tar", "-czf", str(X/"repo.tar.gz"), "--transform", "s,^,stickmanup-main/,", "server"], cwd=ROOT, check=True)
env0 = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}
env0.update(PATH=f"{STUBS}:{os.environ['PATH']}", T=str(X), CURL_CA_BUNDLE=str(ca), STICKMANUP_PREFIX=str(X/"opt"), STICKMANUP_DATA=str(X/"data"), STICKMANUP_ETC=str(X/"etc"), STICKMANUP_LE=str(X/"le"), STICKMANUP_UNITS=str(X/"units"), STICKMANUP_TARBALL=f"file://{X}/repo.tar.gz")
(X/"units").mkdir()
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

def run(args, answers=(), env=None, script=SCRIPT, limit=240):
    """Feeds the script on standard input and types each answer once its question shows. An unexpected question times out."""
    master, slave = pty.openpty()
    def tty():
        os.setsid(); fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    p = subprocess.Popen(["bash", "-s", "--", *args], stdin=subprocess.PIPE, stdout=slave, stderr=slave, env={**env0, **(env or {})}, preexec_fn=tty, close_fds=True)
    os.close(slave)
    def feed():
        try: p.stdin.write(script); p.stdin.close()
        except BrokenPipeError: pass
    threading.Thread(target=feed, daemon=True).start()
    out, seen, todo, end = "", 0, list(answers), time.time() + limit
    while True:
        r, _, _ = select.select([master], [], [], 0.2)
        if r:
            try: chunk = os.read(master, 65536)
            except OSError: chunk = b""
            if not chunk:
                if p.poll() is not None: break
            out += ANSI.sub("", chunk.decode("utf-8", "replace"))
        if todo and re.search(todo[0][0], out[seen:]):
            seen = len(out)
            time.sleep(0.3)  # Nobody types in the instant the question appears, before the script has hidden the typing.
            os.write(master, (todo.pop(0)[1] + "\n").encode())
        if p.poll() is not None and not r: break
        if time.time() > end:
            p.kill(); out += "\n[TIMED OUT]"; break
    p.wait(); os.close(master)
    return p.returncode, out, todo

def env_file():
    f = X/"etc/server.env"
    return dict(l.split("=", 1) for l in f.read_text().splitlines() if "=" in l and not l.startswith("#")) if f.exists() else {}
def calls(): return (X/"calls.log").read_text() if (X/"calls.log").exists() else ""
def running():
    p = X/"pid"
    if not p.exists(): return False
    try: os.kill(int(p.read_text()), 0); return True
    except OSError: return False
def reset():
    """Back to a server that has never seen this, keeping Node to save the download."""
    if running(): os.kill(int((X/"pid").read_text()), signal.SIGTERM); time.sleep(0.5)
    if (X/"opt/node").exists() and not (X/"opt/node").is_symlink() and not NODE_KEEP.exists(): shutil.move(str(X/"opt/node"), str(NODE_KEEP))
    for d in ["opt", "data", "etc", "le"]: shutil.rmtree(X/d, ignore_errors=True)
    for f in ["pid", "calls.log"]: (X/f).unlink(missing_ok=True)
    if NODE_KEEP.exists():
        (X/"opt").mkdir(); (X/"opt/node").symlink_to(NODE_KEEP)
Q_DOMAIN, Q_ANYWAY, Q_MAIL, Q_GO = r"Domain[^\n]*: $", r"Try anyway\? \(y/n\) \[n\]: $", r"Email for expiry[^\n]*: $", r"Go on\? \(y/n\) \[y\]: $"
Q_DID, Q_DSEC, Q_GID, Q_GSEC, Q_STEAM, Q_SKEY = r"Discord Client ID[^\n]*: $", r"Discord Client Secret[^\n]*: $", r"Google Client ID[^\n]*: $", r"Google Client Secret[^\n]*: $", r"through Steam\? \(y/n\) \[y\]: $", r"Steam Web API key[^\n]*: $"
Q_BOT, Q_GUILD, Q_LOGC, Q_WARNC, Q_ADMINS, Q_LEAVE = r"Bot token[^\n]*: $", r"Your Discord server's ID[^\n]*: $", r"channel for the logs[^\n]*: $", r"cheater warnings[^\n]*: $", r"User IDs, separated by commas[^\n]*: $", r"Leave it empty for now\? \(y/n\) \[n\]: $"
SKIP_LOGINS = [(Q_DID, ""), (Q_GID, ""), (Q_STEAM, ""), (Q_SKEY, ""), (Q_BOT, "")]

try:
    reset()
    # ---- the bug that was reported: a typed domain got lost
    rc, out, left = run([], [(Q_DOMAIN, "not a domain")])
    check("a wrong domain is refused, quoting what was typed", rc == 1 and '"not a domain" doesn\'t look' in out, out)
    check("stopped there, nothing started", not running())
    reset()
    rc, out, left = run([], [(Q_DOMAIN, "pointdesk.test"), (Q_ANYWAY, "n")])
    check("the typed domain arrives", '"" doesn' not in out and "pointdesk.test does not point at this server" in out, out)
    check("it explains how to point it, and warns about Cloudflare", "A record" in out and "Cloudflare" in out and "game.pointdesk.test" in out, out)
    check("no to Try anyway stops, without touching certbot", rc == 1 and "certbot" not in calls(), out)
    reset()
    rc, out, left = run([], [(Q_DOMAIN, "pointdesk.test"), (Q_ANYWAY, "y"), (Q_MAIL, ""), (Q_GO, "n")])
    check("no to Go on stops", rc == 1 and "Stopped" in out and "certbot" not in calls(), out)
    reset()

    # ---- a full install with everything typed
    rc, out, left = run([], [(Q_DOMAIN, "  HTTPS://PointDesk.Test/  "), (Q_ANYWAY, "y"), (Q_MAIL, "me@pointdesk.test"), (Q_GO, ""), (Q_DID, "123456789"), (Q_DSEC, "dis_cord-Secret9"), (Q_GID, ""), (Q_STEAM, ""), (Q_SKEY, ""), (Q_BOT, "")])
    check("a full install finishes", rc == 0 and not left and "StickManUp server is ready" in out, out)
    e = env_file(); port = e.get("PORT", "")
    check("the address is what was typed, cleaned up", f"Server address:  https://pointdesk.test:{port}" in out and e.get("PUBLIC_URL") == f"https://pointdesk.test:{port}", out)
    check("it picks a port from its own range", port.isdigit() and 47810 <= int(port) <= 47899, port)
    check("apt-get ate its input and the install still went on", "apt-get" in calls(), calls())
    check("certbot gets the domain and the email", "-d pointdesk.test" in calls() and "-m me@pointdesk.test" in calls() and "--agree-tos" in calls() and "--non-interactive" in calls(), calls())
    check("the keys are saved", e.get("DISCORD_CLIENT_ID") == "123456789" and e.get("DISCORD_CLIENT_SECRET") == "dis_cord-Secret9" and e.get("STEAM_LOGIN") == "1", e)
    check("the secret never shows on screen", "dis_cord-Secret9" not in out)
    check("the yes defaults count as yes", e.get("STEAM_LOGIN") == "1" and "Stopped" not in out)
    check("settings are private", stat.S_IMODE((X/"etc/server.env").stat().st_mode) & 0o007 == 0, oct((X/"etc/server.env").stat().st_mode))
    check("the certificate is handed to the server", (X/"data/tls/fullchain.pem").exists() and e.get("TLS_CERT") == str(X/"data/tls/fullchain.pem"), e)
    unit = (X/"units/stickmanup.service").read_text()
    check("the service runs its own Node, as its own user", f"ExecStart={X}/opt/node/bin/node {X}/opt/app/server.js" in unit and "User=stickmanup" in unit and f"ReadWritePaths={X}/data" in unit, unit)
    hook = X/"le/renewal-hooks/deploy/stickmanup.sh"
    check("renewed certificates reach the server", hook.exists() and os.access(hook, os.X_OK) and f"{X}/le/live/pointdesk.test" in hook.read_text(), "")
    check("it says it is running", running() and "does not start" not in out)
    def api(path):
        r = subprocess.run(["curl", "-fsS", "--max-time", "5", "--resolve", f"pointdesk.test:{port}:127.0.0.1", f"https://pointdesk.test:{port}{path}"], env=env0, capture_output=True, text=True)
        return json.loads(r.stdout) if r.returncode == 0 else {"curlerr": r.stderr}
    info = api("/api/info")
    check("it answers over real HTTPS with its sign ins", info.get("providers") == ["discord", "steam"] and info.get("credits") == ["TheOCProductions", "ShortGG"], info)

    # ---- running it again
    (X/"data/keepme").write_text("players")
    rc, out, left = run([], [(Q_DID, ""), (Q_DSEC, ""), (Q_GID, ""), (Q_STEAM, ""), (Q_SKEY, ""), (Q_BOT, "")])
    e2 = env_file()
    check("running it again asks no domain and keeps everything", rc == 0 and not left and "The address of your server" not in out and e2 == e and (X/"data/keepme").exists(), out)
    check("and doesn't get a new certificate", calls().count("certbot certonly") == 1, calls())
    # ---- the bot, added later, and who may use it
    TOKEN = "MTIz.fake_Bot-Token9"
    rc, out, left = run(["--bot"], [(Q_BOT, TOKEN), (Q_GUILD, "not a number"), (Q_GUILD, "111111111111111111"), (Q_LOGC, "222222222222222222"), (Q_WARNC, ""), (Q_ADMINS, "12, abc"), (Q_ADMINS, ""), (Q_LEAVE, "n"), (Q_ADMINS, " 123456789012345678, 234567890123456789 ,345678901234567890")])
    e3 = env_file()
    check("the bot's questions are all asked, and wrong answers asked again", rc == 0 and not left, out)
    check("the bot's settings are saved", e3.get("DISCORD_BOT_TOKEN") == TOKEN and e3.get("DISCORD_BOT_GUILD") == "111111111111111111" and e3.get("DISCORD_BOT_LOG_CHANNEL") == "222222222222222222" and "DISCORD_BOT_WARN_CHANNEL" not in e3, e3)
    check("several people may be allowed, with spaces forgiven", e3.get("DISCORD_BOT_ADMINS") == "123456789012345678,234567890123456789,345678901234567890", e3)
    check("the token never shows on screen", TOKEN not in out)
    check("the summary says the bot is on, and for how many", "Discord bot:    on, 3 may use the commands" in out, out)
    check("the bot's channels are explained", "PRIVATE channel" in out and "Developer Mode" in out, out)
    check("nothing else changed", all(e3.get(k) == v for k, v in e2.items()), e3)
    check("a server with a bot token that doesn't work still runs", running() and "does not start" not in out, out)
    rc, out, left = run(["--bot"], [(Q_BOT, ""), (Q_GUILD, ""), (Q_LOGC, ""), (Q_WARNC, ""), (Q_ADMINS, "")])
    check("Enter keeps everything about the bot", rc == 0 and not left and env_file() == e3, out)
    rc, out, left = run(["--update"], [])
    check("an update keeps the bot's settings", rc == 0 and not left and env_file() == e3, out)
    h = subprocess.run(["bash", str(ROOT/"server/install.sh"), "--help"], capture_output=True, text=True).stdout
    check("the help mentions the bot", "--bot" in h and "--yes" in h, h)
    e = e2
    # Back to no bot for what follows.
    lines = [l for l in (X/"etc/server.env").read_text().splitlines() if not l.startswith("DISCORD_BOT")]
    (X/"etc/server.env").write_text("\n".join(lines) + "\n")
    rc, out, left = run(["--logins"], [(Q_DID, "555"), (Q_DSEC, ""), (Q_GID, "abc.apps.googleusercontent.com"), (Q_GSEC, "GOCSPX-x_y"), (Q_STEAM, "n")])
    e3 = env_file()
    check("--logins changes the keys", rc == 0 and e3.get("DISCORD_CLIENT_ID") == "555" and e3.get("DISCORD_CLIENT_SECRET") == "dis_cord-Secret9" and e3.get("GOOGLE_CLIENT_SECRET") == "GOCSPX-x_y" and e3.get("STEAM_LOGIN") == "0", (out, e3))
    for _ in range(40):
        if api("/api/info").get("providers"): break
        time.sleep(0.25)
    check("and the server picks them up", api("/api/info").get("providers") == ["discord", "google"], api("/api/info"))
    rc, out, left = run(["--update"])
    check("--update asks nothing and keeps the settings", rc == 0 and "Updated." in out and env_file() == e3 and running(), out)
    rc, out, left = run(["--status"])
    check("--status shows the address", rc == 0 and f"https://pointdesk.test:{port}" in out, out)
    rc, out, left = run(["--uninstall"], [(r"Remove the StickManUp server\? \(y/n\) \[n\]: $", "")])
    check("--uninstall defaults to no", rc == 0 and (X/"opt/app/server.js").exists() and running(), out)
    rc, out, left = run(["--uninstall"], [(r"Remove the StickManUp server\? \(y/n\) \[n\]: $", "y")])
    check("--uninstall removes the server, keeps the players' data", rc == 0 and not (X/"opt").exists() and (X/"data/keepme").exists() and not running() and not (X/"units/stickmanup.service").exists(), out)
    rc, out, left = run(["--uninstall", "--purge"], [(r"Remove the StickManUp server\? \(y/n\) \[n\]: $", "y"), (r"Really delete[^\n]*\(y/n\) \[n\]: $", "y")])
    check("--purge deletes the data too", rc == 0 and not (X/"data").exists() and not (X/"etc").exists(), out)
    shutil.rmtree(X/"le", ignore_errors=True)
    reset()

    # ---- no domain: the free name, and the second one if the first is used up
    ip = urllib.request.urlopen("https://api.ipify.org", timeout=10).read().decode().strip()
    free1, free2 = ip.replace(".", "-") + ".sslip.io", ip.replace(".", "-") + ".nip.io"
    rc, out, left = run([], [(Q_DOMAIN, ""), (Q_MAIL, ""), (Q_GO, "")] + SKIP_LOGINS)
    check("pressing Enter gives the free name, which points here by itself", rc == 0 and f"Server address:  https://{free1}:" in out and "does not point" not in out, out)
    reset()
    rc, out, left = run([], [(Q_DOMAIN, ""), (Q_MAIL, ""), (Q_GO, "")] + SKIP_LOGINS, env={"CERTBOT_FAIL": free1})
    check("if that free name is used up it tries the other", rc == 0 and f"Server address:  https://{free2}:" in out, out)
    reset()
    rc, out, left = run([], [(Q_DOMAIN, ""), (Q_MAIL, ""), (Q_GO, "")], env={"CERTBOT_FAIL": f"{free1} {free2}"})
    check("if the certificate fails it says what to do and starts nothing", rc == 1 and "Open TCP port 80" in out and "points at this server" in out and not running(), out)
    reset()
    rc, out, left = run(["--yes"])
    check("--yes needs no answers at all", rc == 0 and "StickManUp server is ready" in out and f"https://{free1}:" in out, out)
    reset()
    rc, out, left = run(["--yes", "--proxy", "--domain", "game.pointdesk.test"])
    e = env_file()
    check("--proxy skips the certificate", rc == 0 and "certbot" not in calls() and e.get("PUBLIC_URL") == "https://game.pointdesk.test" and e.get("HOST") == "127.0.0.1" and e.get("TRUST_PROXY") == "1", out)
    reset()

    # ---- a server that already has a website on it
    rc, out, left = run([], [(Q_DOMAIN, "site.test"), (Q_ANYWAY, "y"), (Q_MAIL, ""), (Q_GO, "")] + SKIP_LOGINS, env={"HOLDS_80": "nginx"})
    check("nginx on port 80: certbot goes through nginx and the install finishes", rc == 0 and "--nginx" in calls() and "--standalone" not in calls() and "Server address:  https://site.test:" in out, (out, calls()))
    check("it installs certbot's nginx helper", "python3-certbot-nginx" in calls(), calls())
    reset()
    rc, out, left = run([], [(Q_DOMAIN, "site.test"), (Q_ANYWAY, "y"), (Q_MAIL, ""), (Q_GO, "")] + SKIP_LOGINS, env={"HOLDS_80": "apache2"})
    check("Apache on port 80 goes through Apache", rc == 0 and "--apache" in calls(), (out, calls()))
    reset()
    rc, out, left = run([], [(Q_DOMAIN, "site.test"), (Q_ANYWAY, "y"), (Q_MAIL, ""), (Q_GO, "")], env={"HOLDS_80": "caddy"})
    check("anything else on port 80 is named, and it says what to do", rc == 1 and "Port 80 is in use by caddy" in out and "--proxy" in out and not running(), out)
    reset()
    live = X/"le/live/site.test"; live.mkdir(parents=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=site.test", "-addext", "subjectAltName=DNS:site.test", "-keyout", str(live/"privkey.pem"), "-out", str(live/"fullchain.pem")], capture_output=True, check=True)
    with open(ca, "ab") as f: f.write((live/"fullchain.pem").read_bytes())
    rc, out, left = run([], [(Q_DOMAIN, "site.test")] + SKIP_LOGINS, env={"HOLDS_80": "nginx"})
    check("a certificate that is already there gets used, with no new one", rc == 0 and "certbot" not in calls() and "does not point" not in out and "Server address:  https://site.test:" in out, (out, calls()))
    check("and it reaches the server", (X/"data/tls/fullchain.pem").read_bytes() == (live/"fullchain.pem").read_bytes() and running())
    reset()
    rc, out, left = run(["--yes", "--proxy", "--domain", "a.test"], env={"TAKEN_PORTS": "47810 47811"})
    check("game ports in use are skipped", rc == 0 and env_file().get("PORT") == "47812", out)
    reset()

    # ---- a download cut short runs nothing
    rc, out, left = run([], script=SCRIPT[: len(SCRIPT) // 2])
    check("half a download starts nothing", not (X/"etc").exists() and not (X/"data").exists() and "calls.log" not in os.listdir(X), out)
finally:
    if running(): os.kill(int((X/"pid").read_text()), signal.SIGTERM)
    subprocess.run(["userdel", "stickmanup"], capture_output=True)
    shutil.rmtree(X, ignore_errors=True)
print(f"{len(fails)} FAILED: " + "; ".join(fails) if fails else f"all {good} passed")
sys.exit(1 if fails else 0)
