"""The anticheat, end to end: real climbs played by the real game in a real browser, sent to a real server, which reruns them
with the same physics. Honest climbs have to match exactly, on every map. Then the same climbs with cheats in them, each of
which has to be caught with the right reason. Run as: dev/replaytest.py [how many seconds per climb]"""
import atexit, urllib.error, functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SECS = int(sys.argv[1]) if len(sys.argv) > 1 else 60
fails = []
def check(name, ok, info=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f'  [{info}]' if info != '' else ''))
    if not ok: fails.append(name)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(ROOT / 'assets')))
threading.Thread(target=web.serve_forever, daemon=True).start()

data = tempfile.mkdtemp(prefix='smu-replay')
PORT = 47977
env = dict(os.environ, HOST='127.0.0.1', PORT=str(PORT), DATA_DIR=data, NODE_NO_WARNINGS='1', ANTICHEAT_SPEED_SLACK='100000', GUEST_LIMIT_BURST='1000', GUEST_LIMIT_PER_HOUR='100000', WALLET_MIN_WIN_SECONDS='1')
log = open(data + '/server.log', 'w')
srv = subprocess.Popen(['node', str(ROOT / 'server/server.js')], env=env, stdout=log, stderr=log)
URL = f'http://127.0.0.1:{PORT}'
# Whatever happens below, no server is left behind holding the port.
atexit.register(lambda: srv.kill())
for _ in range(50):
    try:
        urllib.request.urlopen(URL + '/api/health', timeout=1).read(); break
    except Exception: time.sleep(0.2)

def restart(**extra):
    global srv
    srv.terminate()
    try: srv.wait(8)
    except Exception: srv.kill()
    srv = subprocess.Popen(['node', str(ROOT / 'server/server.js')], env=dict(env, **extra), stdout=log, stderr=log)
    for _ in range(50):
        try:
            urllib.request.urlopen(URL + '/api/health', timeout=1).read(); return
        except Exception: time.sleep(0.2)

def sql(q):
    r = subprocess.run(['node', '-e', f"const {{DatabaseSync}}=require('node:sqlite');const d=new DatabaseSync({json.dumps(data + '/stickmanup.db')});console.log(JSON.stringify(d.prepare({json.dumps(q)}).all()))"], capture_output=True, text=True, env=dict(os.environ, NODE_NO_WARNINGS='1'))
    return json.loads(r.stdout or '[]')

# Plays the climb faster than real time with made up but lively thumbs: running, jumping, dashing and grabbing around.
PLAY = r"""
async ([map, diff, secs, cheat, o]) => {
  o = o || {};
  const app = window.SMU, cloud = await import('/js/cloud.js'), { Session } = await import('/js/net.js'), { store } = await import('/js/util.js');
  const r = (() => { let s = (map * 7919 + 12345) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  let fakeNow = 0, s = null;
  const extra = {};
  const { EMOTE } = await import('/js/emotes.js');
  if (o.cont) {
    // The same climb carries on.
  } else if (o.mp) {
    // A game in a room, with a partner on the other end of the cord whose moves arrive over a pretend network.
    const link = { isServer: true, send() {}, setInfo() {}, close() {}, stop() {} };
    s = new Session(o.mp, 'Tester', link);
    s.slot = o.mp === 'host' ? 0 : 1;
    s.players.set(0, s.player(0, 'Tester', o.mp === 'host' ? null : 'h', null, null));
    s.players.set(1, s.player(1, 'Partner', o.mp === 'host' ? 'p1' : null, null, null));
    s.hostId = 'h';
    s.now = () => fakeNow;
    const L0 = app.level;
    app.loadMapForTest(map);
    const cp = app.level.cps[o.cp || 0];
    app.beginGameForTest(s, { map, diff, rules: {}, t0: 0, base: 0, cp: o.cp || 0, falls: 0, doors: [], pos: { [s.slot]: [cp.x, cp.y + 1, cp.z] }, noCord: !!o.noCord, pcp: {} });
  } else if (o.resume) {
    app.startSolo(map, diff, store.get('save.solo'));
  } else app.startSolo(map, diff, null);
  const g = app.game;
  // A real climb has seconds on the clock before anything is saved. This one runs flat out, so give the server its turn.
  for (let i = 0; i < 40 && g.rec && !cloud.runId(); i++) await new Promise((f) => setTimeout(f, 100));
  // Keep the real loop out of it, and press the buttons ourselves.
  const keep = g._keep || g.update.bind(g);
  g._keep = keep;
  const inp = { mx: 0, mz: 0, fx: 0, fz: -1, jump: false, jumpPressed: false, dash: false, grab: false, reel: false, act: false, shield: false, aim: false, fire: false };
  g.update = () => {};
  app.input.read = () => inp;
  let a = 0, coins = 0, actions = 0;
  const frames = Math.round(secs * 60);
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    if (o.script) {
      inp.mx = inp.mz = 0; inp.jump = inp.jumpPressed = inp.grab = inp.reel = inp.dash = inp.act = inp.shield = inp.fire = false;
      const shot = (kind, i) => { g.aimHit = () => ({ t: 1, x: g.me.x, y: g.me.y, z: g.me.z, kind, i }); inp.fire = true; };
      if (o.script === 'grapple' && f === 20) { g.action = g.findAction(g.simT); inp.act = !!g.action; }
      if (o.script === 'door' && f === 20) shot('door', o.door);
      if (o.script === 'stun' && f === 20) shot('monster', 0);
      if (o.script === 'stun' && f === 60) shot('bat', 0);
      if (o.script === 'restart' && f === 120) g.s.toHost({ k: 'restart' });
      if (o.script === 'lag' && f === 120) g.soloT += 1;
      if (o.script === 'hop' && f === 20) g.emote(Object.keys(EMOTE).find((k) => EMOTE[k].hop));
      if (o.script === 'walk') { inp.mx = 0.7; inp.mz = -0.3; inp.fx = 0.3; inp.fz = 0.7; inp.jump = inp.jumpPressed = f % 90 === 0; }
    } else if (f % 25 === 0) { a = r() * Math.PI * 2; inp.mx = Math.cos(a); inp.mz = Math.sin(a); inp.fx = -inp.mz; inp.fz = inp.mx; inp.jump = r() < 0.6; inp.jumpPressed = inp.jump; inp.grab = r() < 0.2; inp.reel = r() < 0.05; inp.dash = r() < 0.15; }
    else { inp.jumpPressed = false; inp.dash = false; }
    if (!o.script) {
      inp.shield = f % 700 === 300;
      if (f % 60 === 30 && g.findAction) { const act = g.findAction(g.simT); if (act) { g.action = act; inp.act = true; actions++; } else inp.act = false; } else inp.act = false;
    }
    // The partner wanders about nearby, sometimes hauling on the cord.
    if (s) {
      const me = g.me, other = s.players.get(s.slot === 0 ? 1 : 0), t = g.time, a2 = f * 0.02;
      if (f % 3 === 0) s.push(other, t, [me.x + Math.cos(a2) * 5 + 1, me.y + 1 + Math.sin(a2 * 3) * 3, me.z + Math.sin(a2) * 5, Math.sin(a2) * 2, Math.cos(a2 * 3), Math.cos(a2) * 2, 0, f % 200 < 50 ? 8 : 1, f % 300 < 60 ? 1.5 : 0, 0]);
      fakeNow += 1000 / 60;
      if (f % 600 === 500) g.onEvent({ k: 'sling', to: s.slot, v: [3, 9, 2] });
      if (f % 900 === 800) { const at = o.cp || 0, pos = {}; pos[s.slot] = g.spawnPos(at, s.slot); g.onEvent({ k: 'respawn', cp: at, at, pos, falls: g.falls + 1, why: 'splash', only: null }); }
      if (cheat === 'mpfling' && f === 300) g.onEvent({ k: 'sling', to: s.slot, v: [3, 90, 2] });
      if (cheat === 'mprespawn' && f === 300) { const top = g.L.cps.length - 1, pos = {}; pos[s.slot] = g.spawnPos(top, s.slot); g.onEvent({ k: 'respawn', cp: top, at: top, pos, falls: 0, why: 'restart', only: null }); }
      if (cheat === 'mpwin' && f === 300) g.onEvent({ k: 'win', t: g.time, falls: 0 });
    }
    if (cheat === 'speed' && f >= 300) { g.me.x += inp.mx * 0.05; g.me.z += inp.mz * 0.05; }
    if (cheat === 'tiny' && f >= 300) { g.me.x += inp.mx * 0.004; }
    if (cheat === 'fly' && f >= 300) { g.me.vy = 6; }
    if (cheat === 'teleport' && f === 300) { g.me.y += 80; }
    if (cheat === 'gravity' && f >= 300) { g.me.vy += 0.12; }
    if (cheat === 'door' && f === 300 && g.L.doors.length) { let m = g.L.doors[0], bd = -1; for (const x of g.L.doors) { const d = Math.hypot(x.bx - g.me.x, x.by - g.me.y, x.bz - g.me.z); if (d > bd) { bd = d; m = x; } } g.rec.act('d', m.i); }
    if (cheat === 'grapple' && f === 300 && g.L.anchors.length) { let best = 0, bd = -1; g.L.anchors.forEach((x, i) => { const d = Math.hypot(x.x - g.me.x, x.y - g.me.y, x.z - g.me.z); if (d > bd) { bd = d; best = i; } }); g.rec.act('g', best); g.me.grapple(g.L.anchors[best]); }
    const farCoins = (n) => [...g.L.coins].filter((c) => !g.coinTaken.has(c.i)).sort((x, y) => y.y - x.y).slice(0, n);
    if (cheat === 'coin' && f === 300) for (const c of farCoins(5)) g.takeCoin(c);
    if (cheat === 'coin1' && f % 1200 === 300) for (const c of farCoins(1)) g.takeCoin(c);
    if (cheat === 'relic' && f === 300) g.rec && cloud.runRelic('made-up');
    g.soloT += 1 / 60;
    keep(0, false);
    if (g.me.hook) extra.hook = true;
    if (o.saveAt && f === o.saveAt) { g.save(); }
    if (o.summit && f === 5) { /* placed on the top by the test: see below */ }
  }
  const out = { ...extra, won: g.won, coinsPhone: g.coinTaken.size, h: g.run.h, falls: g.falls, actions, ms: Math.round(performance.now() - t0), run: cloud.runId(), x: g.me.x, y: g.me.y, z: g.me.z, ticks: g.rec ? g.rec.tickNo : -1 };
  // Pulled the plug: the climb is left as it was, the way a crash or a flat battery leaves it. The test reloads the page next.
  if (o.crash) return out;
  // Still climbing: what is finished so far goes to the server, and the climb goes on.
  if (o.keep) { await cloud.report(); return out; }
  // The connection is gone just when the climb ends. Nothing is lost: it all goes when it comes back.
  if (o.dropEnd) {
    const real = window.fetch;
    window.fetch = () => Promise.reject(new Error('offline'));
    await cloud.runEnd();
    await cloud.report();
    extra.queued = out.queued = JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]').reduce((n, c) => n + c.queue.length, 0);
    window.fetch = real;
  }
  await cloud.runEnd();
  await cloud.report();
  for (let i = 0; i < 50 && JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]').some((c) => c.queue.length); i++) { await new Promise((f) => setTimeout(f, 300)); await cloud.report(); }
  out.left = JSON.parse(localStorage.getItem('smu.wallet.climbs') || '[]').length;
  out.wallet = (await (await fetch(cloud.serverUrl() + '/api/wallet', { headers: { Authorization: 'Bearer ' + cloud.account().token } })).json()).coins;
  app.game.destroy();
  app.game = null;
  return out;
}
"""

ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--use-vulkan=native', '--disable-vulkan-surface', '--ignore-gpu-blocklist']
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS, env={**os.environ, 'VK_ICD_FILENAMES': '/usr/share/vulkan/icd.d/lvp_icd.json'})
    pg = b.new_page(bypass_csp=True, viewport={'width': 640, 'height': 300})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('smu.settings') || '{}'), {quality:'low', server:'%s', name:'Tester'}))); localStorage.setItem('smu.welcomed2', '1');" % URL)
    pg.goto(f'http://127.0.0.1:{web.server_port}/index.html')
    pg.wait_for_function('window.SMU && SMU.pool && SMU.pool.warm === 0', timeout=180000)
    pg.evaluate("document.getElementById('menu').style.display='none'")
    tos = json.loads(urllib.request.urlopen(URL + '/api/info').read())['termsVersion']
    ok = pg.evaluate("async (v) => (await import('/js/cloud.js')).startGuest(v, 'Tester')", tos)
    check('a guest gets an account on the server', ok)
    pg.evaluate("window.startSoloExpose = 1")

    def play(map_, diff, cheat='', secs=SECS, **o):
        return pg.evaluate(PLAY, [map_, diff, secs, cheat, o])
    def last_run():
        return sql('SELECT * FROM runs ORDER BY started DESC, rowid DESC LIMIT 1')[0]
    def flags():
        return sql('SELECT * FROM flags ORDER BY id')

    # Honest play first, on every map and at every difficulty it matters for.
    seen = 0
    for m in range(6):
        d = (m % 3) + 1
        o = play(m, d)
        r = last_run()
        coins = len(json.loads(r['coins'] or '[]'))
        seen_list = json.loads(r['seen'] or '[]')
        check(f'map {m} difficulty {d}: {o["ticks"]} steps match to the last bit', r['tainted'] == 0 and r['ticks'] == o['ticks'] and o['ticks'] > 0 and r['next_seq'] > 0, f"verdict {r['verdict']} rerun coins {len(seen_list)} phone coins {o['coinsPhone']} height {r['best_h']} falls {o['falls']}")
        check(f'map {m}: the server found the same coins as the phone', len(seen_list) == o['coinsPhone'], f"{len(seen_list)} and {o['coinsPhone']}")
        seen += o['ticks']
    check('nothing honest got flagged', len(flags()) == 0, json.dumps(flags())[:400])
    check('the game page had no errors', not errors, errors[:2])
    print(f'{seen} steps played and rerun')
    n0 = len(flags())

    # Now the cheats.
    def caught(name, cheat, kinds, map_=0, diff=1, secs=30):
        before = len(flags())
        o = play(map_, diff, cheat, secs)
        new = flags()[before:]
        r = last_run()
        k = [f['kind'] for f in new]
        check(f'{name} is caught', any(x in kinds for x in k) and r['tainted'] == 1, f"{k}: {new[-1]['detail'] if new else 'nothing flagged'}")
    # Each new cheat from a fresh account, so one doesn't hide behind another's warning limit.
    def fresh():
        pg.evaluate("async () => { const c = await import('/js/cloud.js'); localStorage.removeItem('smu.guestAcct'); await c.deleteAccount(); localStorage.removeItem('smu.deviceId'); localStorage.removeItem('smu.save.solo'); }")
        pg.evaluate("async (v) => (await import('/js/cloud.js')).startGuest(v, 'Cheater')", tos)
    for name, cheat, kinds in [
        ('A speed hack', 'speed', ('speed', 'physics')),
        ('A tiny speed hack', 'tiny', ('speed', 'physics')),
        ('A fly hack', 'fly', ('fly', 'physics', 'teleport')),
        ('A teleport', 'teleport', ('teleport', 'fly')),
        ('Low gravity', 'gravity', ('fly', 'physics', 'teleport')),
        ('A forged door', 'door', ('door',)),
        ('A grapple from across the map', 'grapple', ('grapple',)),
        ('Coins from far away', 'coin', ('coins',)),
        ('A relic that was never reached', 'relic', ('coins',)),
    ]:
        fresh()
        caught(name, cheat, kinds)
    fresh()
    caught('One forged coin at a time', 'coin1', ('coins',), secs=70)

    # ---------------- picking a saved climb back up
    fresh()
    o = play(1, 1, secs=16, saveAt=600)
    r1 = last_run()
    check('a saved climb is clean so far', r1['tainted'] == 0, r1['verdict'])
    snaps = json.loads(r1['snaps'] or '[]')
    check('the server saw the save', len(snaps) >= 1, len(snaps))
    pg.evaluate("async () => { const s = JSON.parse(localStorage.getItem('smu.save.solo')); return s; }")
    o2 = play(1, 1, secs=16, resume=True)
    r2 = sql(f"SELECT * FROM runs WHERE id = '{r1['id']}'")[0]
    check('picking it up carries on the same climb', r1['id'] == o2['run'], f"{r1['id']} {o2['run']}")
    check('the climb still matches after picking it up', r2['tainted'] == 0 and r2['ticks'] > r1['ticks'], f"{r2['verdict']} ticks {r1['ticks']} then {r2['ticks']}")
    # An edited save, moved up the tower.
    fresh()
    o = play(1, 1, secs=16, saveAt=600)
    pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('smu.save.solo')); s.pos[1] += 60; localStorage.setItem('smu.save.solo', JSON.stringify(s)); }")
    before = len(flags())
    o2 = play(1, 1, secs=8, resume=True)
    new = flags()[before:]
    check('an edited save is caught', any(f['kind'] == 'teleport' for f in new), [f['detail'] for f in new])
    # A save the server never heard of is simply not counted, and nobody gets called a cheat.
    fresh()
    pg.evaluate("() => { const s = { v: 0, climbId: null, map: 1, diff: 1, rules: {}, t: 5, cp: 0, falls: 0, doors: [], pos: [10, 10, 10], coins: [], run: null }; localStorage.removeItem('smu.save.solo'); }")

    # ---------------- everything an honest player can do has to match as well. Each of these is placed by a save the server
    # and the phone agree on, at the spot where that thing happens, because a random walk doesn't get there.
    def sql_run(q, *args):
        subprocess.run(['node', '-e', f"const {{DatabaseSync}}=require('node:sqlite');const d=new DatabaseSync({json.dumps(data + '/stickmanup.db')});d.prepare({json.dumps(q)}).run(...{json.dumps(list(args))})"], env=dict(os.environ, NODE_NO_WARNINGS='1'), check=True)
    def row(i): return sql(f"SELECT * FROM runs WHERE id = '{i}'")[0]
    def placed(m, d, pos):
        fresh()
        play(m, d, secs=2, saveAt=30)
        r = last_run()
        snaps = json.loads(r['snaps'] or '[]')
        snaps[-1]['pos'] = pos
        sql_run('UPDATE runs SET snaps = ? WHERE id = ?', json.dumps(snaps), r['id'])
        pg.evaluate("(pos) => { const s = JSON.parse(localStorage.getItem('smu.save.solo')); s.pos = pos; localStorage.setItem('smu.save.solo', JSON.stringify(s)); }", pos)
        return r['id']
    maps = pg.evaluate("""async () => { const app = window.SMU, out = []; for (let m = 0; m < 6; m++) { app.loadMapForTest(m); const L = app.level; out.push({ anchors: L.anchors.map((a) => [a.x, a.y, a.z]), doors: L.doors.map((d) => [d.i, d.bx, d.by, d.bz, d.fx, d.fz]), monsters: L.monsters.length, bats: L.bats.length, relics: L.relics.map((r) => [r.id, r.x, r.y, r.z]), top: L.top, key: L.mapKey }); } return out; }""")
    print('maps:', [(x['key'], len(x['anchors']), len(x['doors']), x['monsters'], x['bats'], len(x['relics'])) for x in maps])
    # A grapple.
    gm = next(i for i, x in enumerate(maps) if x['anchors'])
    hooked = False
    for a in maps[gm]['anchors'][:8]:
        rid = placed(gm, 1, [a[0], a[1] - 4, a[2]])
        o = play(gm, 1, secs=8, resume=True, script='grapple')
        if o.get('hook'):
            hooked = True
            r = row(rid)
            check('a real grapple matches', r['tainted'] == 0, r['verdict'])
            break
    check('a grapple was really made', hooked)
    # A door shot open: the server has to know it is open.
    dm = next(i for i, x in enumerate(maps) if x['doors'])
    dd = maps[dm]['doors'][0]
    rid = placed(dm, 1, [dd[1] + dd[4] * 3, dd[2], dd[3] + dd[5] * 3])
    o = play(dm, 1, secs=4, resume=True, script='door', door=dd[0], saveAt=100)
    r = row(rid)
    snaps = json.loads(r['snaps'] or '[]')
    check('shooting a door open matches, and the server knows it is open', r['tainted'] == 0 and snaps and dd[0] in snaps[-1]['doors'], f"{r['verdict']} {snaps[-1] if snaps else None}")
    # Stunning a monster and a bat.
    sm = next(i for i, x in enumerate(maps) if x['monsters'] and x['bats'])
    fresh()
    o = play(sm, 1, secs=4, script='stun', saveAt=100)
    r = last_run()
    snaps = json.loads(r['snaps'] or '[]')
    check('stunning monsters matches, and the server knows', r['tainted'] == 0 and snaps and len(snaps[-1]['stuns']) == 2, f"{r['verdict']} {snaps[-1]['stuns'] if snaps else None}")
    for script, what in (('hop', 'a flip emote'), ('restart', 'starting over'), ('lag', 'a long hiccup in the game'), ('walk', 'plain walking and jumping')):
        fresh()
        o = play(0, 1, secs=8, script=script)
        r = last_run()
        check(f'{what} matches', r['tainted'] == 0 and r['ticks'] == o['ticks'], f"{r['verdict']} {r['ticks']} {o['ticks']}")

    # A crash: the app dies, and what was played up to the last save still gets there. Then picking it up carries on.
    fresh()
    o = play(2, 1, secs=10, saveAt=300, crash=True)
    rid = o['run']
    pg.reload()
    pg.wait_for_function('window.SMU && SMU.pool && SMU.pool.warm === 0', timeout=180000)
    pg.evaluate("document.getElementById('menu').style.display='none'")
    for _ in range(40):
        r = row(rid)
        if r['next_seq'] > 0: break
        time.sleep(0.25)
    check('after a crash, the part up to the save reaches the server', r['next_seq'] == 1 and len(json.loads(r['snaps'] or '[]')) == 1 and r['tainted'] == 0, f"{r['next_seq']} {r['snaps']} {r['verdict']}")
    o = play(2, 1, secs=10, resume=True)
    r2 = row(rid)
    check('and picking it up carries on the same climb', o['run'] == rid and r2['tainted'] == 0 and r2['ticks'] > r['ticks'], f"{r2['verdict']} {o['run']} {rid}")
    check('a crash is nothing to flag', len([f for f in flags() if f['run'] == rid]) == 0, flags()[-1:])

    # The connection dropping when the climb ends: it all goes later.
    fresh()
    o = play(3, 1, secs=25, dropEnd=True)
    r = last_run()
    check('without a connection the climb waits on the phone', o.get('queued', 0) >= 1, o)
    check('and goes when the connection is back, all of it', r['ticks'] == o['ticks'] and r['tainted'] == 0 and o['left'] == 0, f"{r['ticks']} {o['ticks']} {o['left']} {r['verdict']}")

    # The server restarting in the middle of a climb (an update, say): it rebuilds the climb from what it kept.
    fresh()
    o = play(4, 1, secs=45, keep=True)
    rid = o['run']
    r = row(rid)
    check('the first part of a long climb arrives', r['next_seq'] >= 2 and r['tainted'] == 0, f"{r['next_seq']} {r['verdict']}")
    restart()
    o2 = play(4, 1, secs=25, cont=True)
    r2 = row(rid)
    check('the server restarting in the middle of a climb changes nothing', r2['tainted'] == 0 and r2['ticks'] == o['ticks'] + 25 * 60 and o2['run'] == rid, f"{r2['verdict']} {r2['ticks']} {o['ticks']} {o2['run']}")

    # ---------------- climbing with others
    for mode, m in (('host', 2), ('client', 3)):
        fresh()
        before = len(flags())
        o = play(m, 2, secs=SECS, mp=mode, cp=1)
        r = last_run()
        new = flags()[before:]
        check(f'climbing as {mode}, tied to a partner: {o["ticks"]} steps match', r['tainted'] == 0 and r['ticks'] == o['ticks'] and o['ticks'] > 0, f"{r['verdict']} mode {r['mode']}")
        check(f'as {mode}: same coins', len(json.loads(r['seen'] or '[]')) == o['coinsPhone'], f"{len(json.loads(r['seen'] or '[]'))} and {o['coinsPhone']}")
    fresh()
    o = play(4, 2, secs=SECS, mp='host', cp=2, noCord=True)
    r = last_run()
    check('climbing without the cord matches too', r['tainted'] == 0 and r['ticks'] == o['ticks'], r['verdict'])
    for name, cheat, kinds in [('A forged throw from a partner', 'mpfling', ('sling',)), ('A forged respawn up the tower', 'mprespawn', ('respawn',)), ('A forged win far from the top', 'mpwin', ('win',))]:
        fresh()
        before = len(flags())
        o = play(5, 1, cheat, secs=15, mp='client', cp=0)
        new = flags()[before:]
        check(f'{name} is caught', any(f['kind'] in kinds for f in new), [f['detail'] for f in new])

    # ---------------- enforcing: what pays, and what a ban looks like
    sql_set = lambda k, v: subprocess.run(['node', '-e', f"const {{DatabaseSync}}=require('node:sqlite');const d=new DatabaseSync({json.dumps(data + '/stickmanup.db')});d.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run({json.dumps(k)}, {json.dumps(v)})"], env=dict(os.environ, NODE_NO_WARNINGS='1'), check=True)
    sql_set('anticheat', 'enforce')
    fresh()
    pg.evaluate("async () => (await import('/js/cloud.js')).refreshWallet()")
    o = play(0, 2)
    r = last_run()
    value = json.loads((ROOT / 'server/lib/catalog.json').read_text())['diffs'][2]['coin']
    check('enforcing: an honest climb is paid for what the server saw', o['wallet'] == len(json.loads(r['coins'])) * value and o['wallet'] > 0, f"{o['wallet']} coins, {len(json.loads(r['coins']))} worth {value}")
    bal = o['wallet']
    o = play(0, 2, 'fly', secs=30)
    r = last_run()
    check('enforcing: a cheated climb stops paying', r['tainted'] == 1 and o['wallet'] == bal, f"{bal} then {o['wallet']}")
    fresh()
    diffs = json.loads((ROOT / 'server/lib/catalog.json').read_text())['diffs']
    # Reaching the top, for real: placed just above it and let fall onto it.
    tm = 1
    rid = placed(tm, 1, [0, maps[tm]['top'] + 2, 0])
    w0 = pg.evaluate("async () => (await import('/js/cloud.js')).refreshWallet().then(() => JSON.parse(localStorage.getItem('smu.profile')).coins)")
    o2 = play(tm, 1, secs=4, resume=True, script='still')
    r2 = row(rid)
    check('enforcing: reaching the top is seen by the server', o2['won'] and r2['won'] == 1 and r2['tainted'] == 0, f"{o2['won']} {r2['won']} {r2['verdict']}")
    check('enforcing: and pays the top bonus and the first win', o2['wallet'] == w0 + diffs[1]['summit'] + diffs[1]['first'], f"{w0} then {o2['wallet']}, {diffs[1]}")
    # A relic, for real, in Hardcore.
    rm = next(i for i, x in enumerate(maps) if x['relics'])
    rel = maps[rm]['relics'][0]
    rid = placed(rm, 2, [rel[1], rel[2], rel[3]])
    o2 = play(rm, 2, secs=3, resume=True, script='still')
    r2 = row(rid)
    tok = pg.evaluate("async () => (await import('/js/cloud.js')).account().token")
    wal = json.loads(urllib.request.urlopen(urllib.request.Request(URL + '/api/wallet', headers={'Authorization': 'Bearer ' + tok})).read())
    check('enforcing: a relic found is seen by the server and kept', rel[0] in wal['relics'] and r2['tainted'] == 0, f"{wal['relics']} {r2['verdict']}")
    # Buying with what was earned.
    fresh()
    tok = pg.evaluate("async () => (await import('/js/cloud.js')).account().token")
    items = json.loads((ROOT / 'server/lib/catalog.json').read_text())['items']
    item = min(items, key=lambda k: items[k])
    too_poor = pg.evaluate("async (k) => { const c = await import('/js/cloud.js'); return c.buyItem({ id: k, kind: 'suit' }); }", item)
    check('the shop refuses without the coins, whatever the phone thinks it has', bool(too_poor), too_poor)
    # A forged list of coins pays nothing at all, even though the wallet takes the phone's word in watch mode.
    fresh()
    tok = pg.evaluate("async () => (await import('/js/cloud.js')).account().token")
    def api(path, body=None, method=None):
        req = urllib.request.Request(URL + path, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}, method=method or ('POST' if body is not None else 'GET'))
        try:
            return json.loads(urllib.request.urlopen(req).read())
        except urllib.error.HTTPError as e:
            return dict(json.loads(e.read() or b'{}'), _status=e.code)
    run = api('/api/run/start', {'map': 0, 'diff': 1, 'rules': {}, 'mode': 'solo'})['run']
    res = api('/api/run/report', {'run': run, 'coins': list(range(50)), 'win': {'falls': 0}})
    check('enforcing: an old style list of coins pays nothing', res.get('paid') == 0 and api('/api/wallet')['coins'] == 0, res)
    res = api('/api/run/chunk', {'run': run, 'seq': 0, 'build': 'old', 'n': 60, 'data': 'AAAA', 'coins': [1, 2, 3]})
    check('enforcing: another version gets told to update', res.get('stop') == 'update', res)
    res = api('/api/run/chunk', {'run': run, 'seq': 0, 'build': json.loads((ROOT / 'server/lib/sim/build.json').read_text())['build'], 'n': 60, 'fresh': True, 'data': 'AAAA', 'coins': [1, 2, 3]})
    check('enforcing: rubbish in place of a climb is not paid', api('/api/wallet')['coins'] == 0, res)
    # A score high enough bans automatically, and the game hears why.
    fresh()
    tok = pg.evaluate("async () => (await import('/js/cloud.js')).account().token")
    for cheat in ('fly', 'teleport', 'speed'):
        o = play(0, 1, cheat, secs=15)
    banned = pg.evaluate("async () => { const c = await import('/js/cloud.js'); await c.refreshWallet(); return c.banned(); }")
    check('repeated cheating ends in a ban, with the reason', bool(banned) and 'Automatic' in banned['reason'], banned)
    res = api('/api/wallet')
    check('a banned player gets nothing from the server', res.get('_status') == 403 and res.get('banned'), res)
    res = api('/api/me')
    check('but can still ask why', res.get('ban', {}).get('banned') is True, res)
    pg.evaluate("async () => { const c = await import('/js/cloud.js'); await c.runEnd(); }")

    # ---------------- the game's speed turned up: the physics all match, only the clock gives it away. This test plays flat out,
    # which is just what that looks like, so here the real limit is on.
    restart(ANTICHEAT_SPEED_SLACK='3')
    fresh()
    before = len(flags())
    o = play(0, 1, secs=40)
    new = flags()[before:]
    check('a game speed hack is caught by the clock', any(f['kind'] == 'clock' for f in new), [f['detail'] for f in new])
    b.close()

srv.terminate()
try: srv.wait(5)
except Exception: srv.kill()
print('\n'.join(open(data + '/server.log').read().splitlines()[-6:]))
shutil.rmtree(data, ignore_errors=True)
print(f'\n{"ALL PASSED" if not fails else str(len(fails)) + " FAILED: " + "; ".join(fails)}')
sys.exit(1 if fails else 0)
