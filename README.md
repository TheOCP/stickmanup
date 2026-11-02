# StickManUp

<img src="docs/icon.png" width="128" alt="StickManUp icon">

A co op climbing game for Android. Up to four stickmen are tied together by a glowing cord and climb one of five
giant maps. If one falls, everyone feels it.

**[Download the latest APK](../../releases/latest)** · Android 8.0 or newer · no root needed · about 500 KB

![Title screen](docs/title.png)

![Pick a map](docs/maps.png)
![Storm Tower](docs/storm.png)
![Sunny Isles](docs/sunny.png)
![Wild Forest](docs/forest.png)
![Magma Chimney](docs/volcano.png)
![Neon Skyline](docs/city.png)

## Five maps

Each map is a 1000 m climb in nine zones, and each one climbs its own way. The higher you get, the harder it gets:
smaller platforms, more obstacles, and everything moves faster.

* **Storm Tower**: round and round a neon tower in a lightning storm at night. Lightning hunts you: when a ring in
  your colour appears under you, tap **SHIELD**. Lightning rods, spinning laser bars, laser gates, fans and ice.
* **Sunny Isles**: back and forth across a white lighthouse in two lanes, hopping over at each turn. Arrow traps
  and swinging platforms.
* **Wild Forest**: round a giant tree, with branch walks out to smaller trees that you climb around before coming
  back. Monsters, bats and arrow traps.
* **Magma Chimney**: up the inside of a hollow volcano above a lava lake. Stand on a vent when it erupts and it
  launches you to the ledge above; stand next to it and it shoves you off. Shadows show where boulders will land.
* **Neon Skyline**: a ring of skyscrapers round a central spire at sunset. Climb round one tower, cross to the next
  over a sky bridge or by zipline, and work your way round the ring to the top. Conveyor belts, drones and laser
  gates.

Every map also has grapple hooks over wide gaps and doors that open when you shoot their target. The route
does not just circle: it now and then rides a lift up and turns back the other way, or detours out to floating
platforms away from the tower before heading back in.

**Obstacles**

Each map has 26 obstacles of its own, built to fit it. The higher zones bring in the harder ones, and from about
650 m up come six endgame obstacles: twin pendulums over a long bridge, spike grids that pop up two squares at a
time, things rolling along narrow bridges, rows of presses slamming in turn, crossfire jets with one safe spot,
and turntables with bars spinning over them.

* **Storm Tower**: turbine sweeps, Tesla pendulums, piston rams, hydraulic presses, arc spikes, plasma jets, phase
  platforms, a saw track, a wrecking ball, grease pits and more
* **Sunny Isles**: coconut drops, rolling beach balls, anchor pendulums, cannon shots, wave walls, a carousel deck,
  wet sand, sinking planks, blowholes, buoy bumpers and more
* **Wild Forest**: rolling logs, spiked log swings, thorn patches, spore bursts, mushroom bumpers, mud pits, root
  trapdoors, a charging boar, beehive swings, bee swarms and more
* **Magma Chimney**: fire bars, flame jets, obsidian spikes, molten pendulums, stone presses, tar pits, vent
  trapdoors, lava surges, a meteor shower, fire bats and more
* **Neon Skyline**: security sweeps, a crane wrecking ball, runaway carts, trash compactors, steam pipes, hologram
  platforms, a spinning helipad, airbag bumpers, saw drones and more

Most of them shake, flicker or glow just before they strike.

**Difficulties**

* **Easy**: a checkpoint in every zone, a long cord, a calmer storm and only the gentler obstacles, running slower
* **Normal**: four checkpoints on the whole climb and most obstacles
* **Hardcore**: no checkpoints and a shorter cord. Every obstacle is on and faster. Fall all the way down and the
  team starts over.

**Rules**: when starting a climb (solo, or the host in the lobby) you can also set the checkpoints (every zone, a
few, none), the obstacles (calm, normal, wild) and the cord length yourself. Auto follows the difficulty. Climbs
with custom rules keep their own best times.

The climb saves itself. Solo players can continue from the title screen, and a multiplayer host can continue the
saved climb from the lobby.

## Moves

* **Left side of the screen**: a floating stick to move
* **Right side of the screen**: drag to look around
* **JUMP**: tap for a hop, hold for full height
* **GRAB** (hold): clamp onto anything you touch, even walls. Grip drains faster on walls.
* **REEL** (hold): pull the cord in. It turns into **PULL** when your partner hangs below you (it hauls them up and
  over the edge) and **CLIMB** when you're the one hanging.
* **GRAB, then REEL, then let go of REEL**: sling your partner upward
* **GRAPPLE**: shows up near a hook. You zip up and get thrown across.
* **SHOOT**: hold to aim over your shoulder, drag the crosshair, let go to fire. No auto aim.
* **SHIELD** (Storm Tower): blocks lightning and hits for a second

Keyboard and game controllers work too: WASD, Space, Shift, E, F grapple, R hold to aim, Q shield.

Settings let you resize the buttons, change their opacity, put them on the left, or drag each one wherever you
like. Tips show up once as see through cards; after that, tap the small **!** markers to read them again.

## Multiplayer

Up to 4 climbers. Everyone needs the same StickManUp version. The host picks the map. Tied together, the team
shares its checkpoints and falls back together. With the cord turned off in the lobby, nobody is tied together and
everyone keeps their own checkpoint: a fall only sends you back to yours.

* **Online**: the host gets a 5 letter room code and friends type it in. The phones connect directly over
  WebRTC; the free [PeerJS](https://peerjs.com) server only introduces them. Some networks (often mobile data)
  don't allow that direct connection, so use Internet (direct) then.
* **Internet (direct)**: no server at all. The host's phone asks its router to open the game port (UPnP), finds
  its public address with a STUN lookup and shows a 10 character code; friends anywhere type it in and connect
  straight to the host. Host from a home WiFi.
* **WiFi or hotspot**: games on the same network show up by themselves. No internet needed.
* **Bluetooth**: for when there is no WiFi at all. Pair the phones once in Android settings, then join from the list.

Friends can join a climb that is already running.

## Smooth on any phone

On Android the 3D world is drawn by the app's own OpenGL ES 3.0 renderer, not by WebGL in the WebView. The game
sends only what changed each frame. When a phone can't keep up, the scene is drawn a little smaller and scaled up
in the last step, so the screen never resizes during play and the frame rate stays steady.

Graphics settings: resolution, sharpness, smooth edges (anti aliasing), glow, 30, 60 or 120 fps, and automatic
resolution on or off.

The soundtrack is generated live: an original electro and techno track with its own style for every map, building
in sections and getting busier the higher you climb.

## Build from source

No Gradle or Android Studio needed. On Debian or Ubuntu (arm64 works, also inside Termux proot) install a JDK,
aapt, apksigner, zipalign, the Android platform 23 jar and dalvik exchange, then run:

```sh
./build.sh
```

That makes `build/StickManUp.apk`. On first run `build.sh` creates a local signing key (`stickmanup.jks`). The key
is not in this repo. Keep your own copy, because Android only installs updates signed with the same key.

To play or debug in a desktop browser, serve the `assets` folder with any static web server. Two tabs in the same
browser can play WiFi multiplayer against each other.

## How it works

* `assets/js/`: the whole game in plain JavaScript modules on top of [three.js](https://threejs.org)
  * `level.js` generates the identical maps on every phone from fixed seeds, checking clearance as it builds
  * `physics.js`, `player.js`, `chain.js`: collision, movement, abilities and the cord
  * `storm.js`: lightning, fans, gusts, lasers, arrows, geysers, boulders, monsters, bats and drones, all timed
    from shared game time so every phone agrees
  * `net.js`, `game.js`: host relayed multiplayer; each phone simulates its own climber and applies its share of
    the cord pull, so the game stays responsive over a laggy connection
  * `render.js`, `worldview.js`, `stickman.js`: sky, sun, sea, weather, the maps and the animated stickmen
  * `mirror.js` streams the scene to the native renderer
* `src/`: a small Java activity that runs the game in a full screen WebView, the native OpenGL ES renderer
  (`src/io/stickmanup/gl/`), and WiFi, internet direct (UPnP and STUN) and Bluetooth sockets for the game
* `dev/`: node tests for the levels, physics and networked cord, Playwright scripts that drive the game in
  headless Chromium, a desktop harness that replays a recorded frame through the native renderer, and the icon
  generator

Uses three.js and PeerJS, both MIT licensed.
