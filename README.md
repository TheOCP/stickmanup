# StickManUp

<img src="docs/icon.png" width="128" alt="StickManUp icon">

A co op climbing game. Up to four stickmen are tied together by a glowing cord and climb one of six giant maps. If one
falls, everyone feels it. Android, PC and browser players can all play together on the game server.

* **Android:** [download the APK](../../releases/latest/download/StickManUp.apk) · Android 8.0 or newer · no root needed · about 850 KB
* **Windows:** [download the installer](../../releases/latest/download/StickManUp-Setup.exe) · 64 bit · updates itself. Windows
  warns about it because it has no paid signature: choose More info, then Run anyway.
* **Browser, iPhone and iPad:** [play at theocp.github.io/stickmanup](https://theocp.github.io/stickmanup/). On an iPhone, open it
  in Safari and choose Add to Home Screen for the full screen version.

![Title screen](docs/title.png)

![Pick a map](docs/maps.png)
![Storm Tower](docs/storm.png)
![Sunny Isles](docs/sunny.png)
![Wild Forest](docs/forest.png)
![Magma Chimney](docs/volcano.png)
![Neon Skyline](docs/city.png)
![Waterfall](docs/waterfall.png)
![A jumper kicking](docs/jumper.png)
![The shop](docs/shop.png)
![Records](docs/records.png)

## Six maps

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
* **Waterfall**: a water paradise. Zigzag up the face of a mossy rock in two lanes, short legs back and forth, with
  waterfalls pouring down it into a clear lagoon, past
  palms, lily pads, fountains and far off cliffs with their own falls. Fight up water slides while inner tubes roll
  down at you, fly off launch slides onto higher ledges, dodge
  fish leaping across the bridges, ride fountains up and keep your footing on lazy rivers.

**Each map's own trouble.** From about 400 m up every map sends its own event now and then, and the HUD warns you first:
gusts on Storm Tower (GRAB on), a wave of water running round the Waterfall rock (jump it or GRAB on), laser strikes in
the Neon Skyline aimed at where you stand (keep moving out of the red rings), cannonballs from a pirate ship on Sunny
Isles (out of the orange rings), a quake in the Magma Chimney that throws you at every shock (jump just before it) and a
bee swarm chasing you through the Wild Forest (outrun it, or raise your SHIELD as it reaches you to drive it off). None of it reaches into a maze garden.

**Each map plays its own way.** Every map has its own hard jumps from the second zone up, more of them higher up: long
running leaps over 4 m onto small landings, rows of stepping stones hardly bigger than your feet, and ledges almost as
high as a jump goes, in a different mix on each map (high steps on Storm Tower, stones on Sunny Isles and by the
Waterfall, leaps in the Wild Forest and between the skyscrapers). Outside the forest each map's own creature patrols wide
ledges too: storm crabs, scorpions, fire imps, robot dogs and crocodiles, while the forest keeps its monsters.

**No shortcuts.** Nothing on the route is within a jump and a dash of a piece of it more than 30 m of route further on,
unless it is too high above it to reach. The level builder lifts anything that would be one, and `dev/shortcuttest.js`
checks every map.

Every map also has grapple hooks over wide gaps and doors that open when you shoot their target. The route
does not just circle: it rides lifts up and turns back the other way, and takes long detours out to floating
platforms far from the tower, sometimes going round the other way before it heads back in. In the volcano it now and
then crosses the crater to the far side. Storm Tower, Wild Forest and Waterfall have side pillars the route climbs
round on its way: lightning pylons with glowing bands, smaller trees, and mossy rock stacks with a little fall of
their own. The wall of the middle tower is solid all the way round, on every map: nothing sinks into it.

Up close the middle column and the side pillars are full of detail. The forest's giant trunk and its side trees have deep
bark with lichen, moss, ivy and shelf fungi, and leafy branches that only grow where nothing of the climb is near, so
they never get in the way of a jump, an obstacle or a maze. The storm and city towers have floors of offices with lit
windows and steel fins, the lighthouse real stonework, and the waterfall's rock ledges moss, ferns and hanging ivy.

**Maze gardens.** Every checkpoint that is a platform of its own (the one halfway up each zone, and the rooftop pads in
the city) is a closed garden with a maze in it, built in the map's style: metal walls with glowing trims in the storm,
sandstone on the beach, clipped hedges in the forest, basalt columns with lava between them in the volcano, neon and
concrete in the city and mossy ruins by the waterfall. It has a roof with lamps under it, so nobody can look over the
walls to find the way, and the only ways in and out are the two doorways. Inside, the camera goes to first person, with
your arms and your weapon in view: it sways as you run, comes up when you aim and kicks when it fires. The
roof is a garden: trees and plants of the zone, a pond (lava in the volcano) with stones round it, and small animals
walking and flying about, behind a raised edge too high to get onto. A creature prowls the corridors: a storm crab, a
scorpion, a wild boar, a fire imp, a robot dog or a crocodile. If it reaches you it throws you, and a shot paralyses it
like any monster (two to four of them, more in bigger mazes). The mazes are up to seven cells across (eight higher
up), each laid out for the longest, most winding way through of 48 tries, the walls are
too high to jump and too slick to grab, and every time the whole team goes back to a checkpoint they change, so the way
through has to be found again. There is no way round: a short run of hops leads to the way in, and the climb goes on from
the far side, out of reach of anything before it: you have to go through. Inside a maze nothing of the map's events,
the storm's lightning or its rain reaches you. Eleven mazes hide a legendary relic in the cell furthest from the way
in.

**The way up.** At the foot of every climb an UP HERE sign in the map's style, with a big glowing arrow over it, points
at the first piece of the route, and the dock has plants and props along both edges. During a climb a small arrow under
the clock points the way on. It knows where on the climb you are from the platform you stand on, so after a fall, back
at a checkpoint or off on a hidden path it points the way on from where you are now. It follows the route in order, so
it never points at a part that is closer but further on, and it turns with the camera: up on the arrow is away from
you or higher, down is back toward the camera. In front of a maze it points at the way in, inside at the way out (it
doesn't solve the maze for you). Settings can turn it off.

Two kinds of section need the new moves. Gaps too wide to jump have glowing arrows in the air: jump, then DASH across.
Shafts between two high walls have orange rungs up the walls: bounce up with wall jumps and out over the lower wall.

**Obstacles**

Each map has more than 70 obstacles of its own, built to fit it. The higher zones bring in the harder ones, and from about
650 m up come six endgame obstacles: twin pendulums over a long bridge, spike grids that pop up two squares at a
time, things rolling along narrow bridges, rows of presses slamming in turn, crossfire jets with one safe spot,
and turntables with bars spinning over them.

From about halfway up come ten more, the hardest of all: twin rollers to run between, three swings in a row, spikes
rising in a wave, rows of presses over gaps, ladders of jets, stones that flicker away under you, chains of
trapdoors, twin sweeps, a dash gap with something swinging through it and a wall jump shaft with jets firing across.
They have their own look on each map, like Twin saw rails and Arc shaft on Storm Tower, or Thorn wave and Spore shaft
in Wild Forest.

On top of those, every map has forty more that only it has, made from its own world: thirty along the climb (six of
them endgame and six of the hardest) and five very hard ones that only come in from 800 m. They mix the old tricks
together: presses over stairs and turntables, saws and spikes on conveyor belts, swings over fading platforms, rams in
a row, things rolling down ramps. And there are ziplines: jump up into the cable to grab it, ride it across a wide gap,
and tap JUMP to let go. In the forest they are vines (with vine swings too), on Sunny Isles ship's rigging, in the city
rooftop cables and cranes, over the waterfall ropes, in the volcano chains over the forge. Some have weights swinging
across the ride.

* **Storm Tower**: cargo belts, assembly lines with presses, Tesla crossings, plasma gaps, shredder belts, Meltdown line
* **Sunny Isles**: rigging ziplines, hammock swings, crab claws, cannon gaps, walk the plank, the Kraken slide
* **Wild Forest**: vine ziplines and swings, boar stampedes, beehive ziplines, log avalanches, the Tarzan run
* **Magma Chimney**: ore belts, forge presses, chain slides, slag belts, lava rams, Pyroclastic stairs
* **Neon Skyline**: baggage belts, rooftop cables, window cleaner swings, compactor lines, Rush hour, Drone swarm
* **Waterfall**: the rope over the falls, bucket swings, water wheels, tube rushes, Floodgate, Tsunami rams

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
* **Waterfall**: water slides, leaping fish, fountain lifts, lazy rivers, tipping buckets, spinning sprinklers,
  swinging buoys, water cannons, sinking lily pads, a whirlpool deck, swim ring bumpers, flying fish and more

Most of them shake, flicker or glow just before they strike.

**Jumpers**

Every map has angry dummies guarding ledges from about 500 m up, and on Hardcore and Insane already from 50 m, in the map's own
style: storm dummies, beach bullies, wild jumpers, ash brutes, street punks and splash bullies. Come close and they run
at you and jump kick you off the ledge. Jump past them, or SHOOT to paralyse them for over a minute.

**Coins, shop and records**

Coins hang all along every route. Each is worth 1 on Easy, 2 on Normal, 3 on Hardcore and 4 on Insane, and the top pays
a bonus of 100, 250, 500 or 800. A coin you took stays gone after a fall.

The first time you win a difficulty you also get a big one time bonus: 2000 on Easy, 4000 on Normal, 10000 on Hardcore
and 20000 on Insane. Climbs with custom rules don't count for it.

Spend them in the shop:

* **Common (green):** colours, simple faces and caps
* **Rare (blue):** 41 country flags with a matching cape, patterns, funny faces and hats
* **Epic (purple):** full costumes like Ninja, Knight, Astronaut, Skeleton, Solid Gold, Viking, Pharaoh, Battle Mech,
  Shark and Thundercloud, with their own face and hat,
  and each with something of its own: a jetpack, a parrot on the shoulder, a samurai banner, a tail, a sack of
  presents, balloons, a rainbow over the shoulders. Neon lines, slime, lava and stars on them really glow. They wait
  in each map's epic vault first (see below).
* **Legendary (orange):** living suits that move and leave a trail: aurora curtains, molten rock, cut crystal, deep
  space, circuits, dragon scales, spirit smoke, a neon grid and holograms, many with wings, horns, crowns, orbs or a
  blade on the back. Eleven wait in the maze gardens and twelve at the end of relic courses, two on each map, on every
  difficulty: find one and it can be bought, from 25000 to 60000 coins for the maze ones. Three are earned by what you
  do up there.
* **Weapons:** 50 of them, common to legendary: sidearms, submachine guns, shotguns, rifles, snipers with a real
  scope, machine guns, launchers, and odd ones like the Tesla Coil, the Harpoon Gun and the Cryo Blaster. Each is held its own way, and the shop shows how long it paralyses, how fast it
  fires, how far it reaches and how hard it throws a friend. The seven legendary weapons are far stronger than the rest.
  Epic weapons wait in the epic vaults; each map's legendary weapon waits at the end of its hardest course, and the Void
  Cannon opens once all six are found.
* **Hair:** a tab of its own: short crop, side swoop, ponytail, spiky, long hair, a purple bob, space buns, curls,
  braids and glowing neon spikes. Hats sit on top of the hair, never through it, and every hat sits on the head at a
  slant without covering the eyes; a helmet that covers the whole head hides the hair under it.
* **Emotes:** a tab of their own with 23 moves, like the wave, the floss, flips, a cartwheel, the running man, the worm,
  the windmill and a headspin. Wave, Clap, Thumbs up and Backflip are free, the rest cost 60 to 1000 coins.

**Relic courses.** Finding something only opens it in the shop: it still costs coins. Every map has four hard parkour
courses out past the route, on every difficulty: two to legendary suits, one to the epic vault and one to the legendary
weapon. Each starts at a gate with a pillar of light that can be seen from far away, and a marker on the screen and gems
on the height bar show where the nearest ones are. The shop says on which map and from what height each thing is found.
A course mixes parts picked by chance from twenty kinds, and six of them are found nowhere else: a big wheel you ride
round, a windmill you cross on its blades, a stone deck with shock rings to jump, a run under falling comets, gaps with
a gravity well that pulls you off line, and stones that blink in pairs. They differ per map and per course, but are the
same for everyone and on every climb, because the server replays each climb to check it. A fall brings you back to the
last green marker on the course, and the ring at the end takes you back to the route. Custom rules have no courses.
`dev/secrettest.js` plays each course with the real physics. Legendary suits found before this update stay yours.

Your other climbers see what you wear. Signed in, what you wear and the weapon you picked are kept on your account, so
they come on by themselves when you sign in on another phone, a PC or the web, and whatever you pick last on any of them
wins. The records keep your best climbs on every map: how high you got, on which
difficulty, how many falls, how long and how many coins.

**Every map looks different**

Platforms change with the map and the zone: tread plate and hex tiles, wooden docks, floating sandstone islands,
clouds, giant mushroom caps, grassy rocks, basalt columns, obsidian, concrete roofs, lily pads, bamboo rafts, coral
and marble. Floating islands (ledges in the volcano, balcony gardens on the skyscrapers) carry trees and props that
suit the zone: palms, pines, oaks, birches, blossom, bamboo, dead trees, glowing trees, cactus, coral, crystals,
antennas and water tanks. Flocks of birds, butterflies, crabs, dolphins, deer, frogs, turtles and lizards live around
the climb. The graphics preset scales all of this: Low drops the small stuff for cheaper phones.

**Difficulties**

* **Easy**: a checkpoint in every zone, a long cord, a calmer storm and only the gentler obstacles, running slower
* **Normal**: four checkpoints on the whole climb and most obstacles
* **Hardcore**: no checkpoints and a shorter cord. Every obstacle is on and faster. Fall all the way down and the
  team starts over.
* **Insane**: everything Hardcore has, faster still. A very short cord, barely any grip, and almost no time left to
  jump once you have run off a ledge.

**Rules**: when starting a climb (solo, or the host in the lobby) you can also set the checkpoints (every zone, a
few, none), the obstacles (calm, normal, wild) and the cord length yourself. Auto follows the difficulty. Climbs
with custom rules keep their own best times.

The climb saves itself. Solo players can continue from the title screen, and a multiplayer host can continue the
saved climb from the lobby.

## Moves

* **Left side of the screen**: a floating stick to move
* **Right side of the screen**: drag to look around
* **JUMP**: tap for a hop, hold for full height
* **Wall jump**: in the air, jump at a wall and press JUMP as you touch it to kick off, up and away. You can't kick off
  the same wall twice in a row, so bounce between two walls.
* **DASH**: a quick burst where the stick points, or where you are looking if you aren't touching it. It works in the
  air too, once until you land.
* **GRAB** (hold): clamp onto anything you touch, even walls. Grip drains faster on walls. It stops you sliding,
  but a hit from an enemy or a trap still tears you off.
* **REEL** (hold): pull the cord in. It turns into **PULL** when your partner hangs below you (it hauls them up and
  over the edge) and **CLIMB** when you're the one hanging.
* **GRAB, then REEL, then let go of REEL**: sling your partner upward
* **GRAPPLE**: shows up near a hook. You zip up and get thrown across.
* **SHOOT**: hold to aim over your shoulder, drag the crosshair, let go to fire. Nothing fires without aiming first,
  and the shot leaves the muzzle of your weapon. Automatic weapons keep firing while you hold, snipers look through
  their scope. A hit paralyses monsters, bats and jumpers for over a minute, longer with better weapons. No auto aim.
* **SHIELD** (Storm Tower): blocks lightning, the rods and hits for a second
* **Emotes**: the smiley at the top right opens the menu during a climb. Everyone climbing with you sees them. Flips
  start with a small jump, and moving ends a pose.

Keyboard and mouse: WASD, Space, C grab (Ctrl too, except in a browser), E, F grapple, Q shield, Left Shift dash, T emotes, H tip. The mouse turns the camera, hold right click (or R) to aim and left click fires, Esc pauses. In the PC app, F11 or Alt+Enter is fullscreen. On a PC the frame rate goes from 60 to 144 in Settings.

Controller: left stick moves, right stick looks, A jump, B grab, X grapple, Y or pressing in the left stick dash, LT hold
to aim, RT fire while aiming, RB reel, LB shield, direction pad down emotes. As soon as a controller is used, the
buttons on screen show which controller button does what (Xbox, PlayStation or Nintendo names), and a card with all
the controls shows at the start of a climb and in the pause menu.

A controller works in every menu as well: move with the direction pad or left stick, A selects, B goes back, LB and RB
switch tabs, and text boxes open a letter board. Select opens the pause menu on Back to checkpoint. Settings has a dead
zone for each stick against stick drift, with a live view of where the sticks really are.

Settings let you resize the buttons, change their opacity, put them on the left, or drag each one wherever you
like. The FPS counter can go anywhere on the screen too. Tips show up once as see through cards; after that, tap the
small **!** markers to read them again.

## Multiplayer

Up to 4 climbers. Everyone needs the same StickManUp version. The host picks the map. Tied together, the team
shares its checkpoints and falls back together. With the cord turned off in the lobby, nobody is tied together and
everyone keeps their own checkpoint: a fall only sends you back to yours. With **friendly fire** on in the lobby,
your shots throw your friends off the climb, and theirs throw you.

* **Game server**: works on every network, because every phone only connects out to the server. Open the **server
  browser** to see public rooms, or create a room: public or private, with or without a password. A private room only
  shows to people who have its code. The host's phone still runs the climb, so the room ends if the host leaves.
  Run your own: see [server/README.md](server/README.md).
* **Online**: the host gets a 5 letter room code and friends type it in. The phones connect directly over
  WebRTC; the free [PeerJS](https://peerjs.com) server only introduces them. Some networks (often mobile data)
  don't allow that direct connection, so use the game server then.

Friends can join a climb that is already running. They start at the start of the map, not next to the host. Without the
cord they climb on their own; on a tied team the cord ties on when they reach the others, and until then a fall only sends
them back to their own checkpoint.

## Friends

Every player has a player ID, shown on the Friends screen with a button to share it. Search by in game name or ID and
send a request. Once it is accepted you can see which friends are online and, while they climb, the map, difficulty,
height, time, falls and who they climb with. Tap Watch to follow their climb live (it works for solo climbs too), or Join
if their room has a free spot. Anyone who would rather not be watched can turn that off on the same screen, and a climber is
told which friends are watching (the team can watch any climb without showing up, see [The team](#the-team)). Watching shows the climb as it is: the shots flying, the coins still hanging, and climbers riding
lifts and ziplines without sinking into the floor. In a maze garden you see through their eyes, looking exactly where they
look, with their arms and weapon in view. Both people need the game server.

Invite friends from the lobby (Invite friends), or during a climb from the pause menu (Friends, then Invite). An invite
shows up as a card with a Join button, in the menus or during a climb (on a PC, press Esc to answer it), and the pause menu
offers it for two minutes. The Friends screen in the pause menu also joins or watches a friend: a climb alone is saved first,
and leaving a game with others asks first.

Friends can join a climb that is already running.

## Accounts

Coins and what you own are kept on the game server, so nobody can lose them or make them up. On first start you can accept the
terms and play as a guest, or sign in with Discord, Steam or Google. A guest's coins are on the server too, but only that
phone can reach them. Signing in moves them to an account that works on any phone. Or play without coins, with nothing
sent anywhere. You can delete your account and everything on the server at any time.

Coins only count alone or in a room on the game server. Offline and in Online games you climb the same
but earn nothing, because nothing can check those.

Every climb that earns coins is played again on the server with the same physics, so a speed hack, a higher jump, flying, teleporting
or an edited save all show up. Coins from older versions that were kept on the phone are gone: only the server counts now.

## The team

The owner and the people they trust run the game from inside it. Staff get a **Terminal** button on the title screen,
in the pause menu and while watching (or press the \` key or F2 on a keyboard). It takes the same commands as the
Discord bot, suggests them as you type, fills in names of players who are online, and says what you probably meant
when something is misspelled. A second tab lists everyone in the game right now with what they are doing, with buttons
to watch them, join their room, see more or kick them. Roles like Friend, VIP and Family show as a coloured tag next to
the name. Who may do what is set with roles and permissions on the server: see
[server/README.md](server/README.md#the-team).

## Smooth on any phone

On Android the 3D world is drawn by the app's own OpenGL ES 3.0 renderer, not by WebGL in the WebView. The game
sends only what changed each frame. Clouds, water and surface detail read from one noise texture baked at startup
instead of being worked out for every pixel, and shaders, models and textures are prepared before they first come
into view. Every picture is handed to the display with the exact screen refresh it belongs to, and the climber is
drawn between physics steps, so movement stays even.

Auto graphics measures how long the GPU really needs for each frame. When a phone gets near its limit it lowers the
resolution, then the edge smoothing, then switches to simple lighting and a shorter view with the fog closing in, and it
takes those back when there is room again. The scene is scaled inside a fixed size picture, so the screen never resizes
during play.

It watches the game's own code too. A smaller picture can't help a slow CPU, so there it turns the extras down instead:
small animations every second frame, fewer music notes, fewer HUD updates. Slow phones are recognised once by a short CPU
check on launch and start on the lighter picture and simple scenery right away. Whatever the fog has fully hidden is never
drawn, on any phone.

Graphics settings: resolution, sharpness, smooth edges (anti aliasing), glow, simple lighting, 30, 60 or 120 fps, and
auto graphics on or off.

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

To play or debug in a desktop browser, serve the `assets` folder with any static web server.

## How it works

* `assets/js/`: the whole game in plain JavaScript modules on top of [three.js](https://threejs.org)
  * `level.js` generates the identical maps on every phone from fixed seeds, checking clearance as it builds
  * `physics.js`, `player.js`, `chain.js`: collision, movement, abilities and the cord
  * `storm.js`: lightning, fans, gusts, lasers, arrows, geysers, boulders, monsters, bats and drones, all timed
    from shared game time so every phone agrees
  * `net.js`, `game.js`: host relayed multiplayer; each phone simulates its own climber and applies its share of
    the cord pull, so the game stays responsive over a laggy connection
  * `cloud.js`: the game server, signing in, coins and keeping progress on your account
  * `replay.js`: writes down each climb as it is played, for the server to play again
  * `detmath.js`: maths that comes out exactly the same on a phone and on a server
  * `render.js`, `worldview.js`, `stickman.js`: sky, sun, sea, weather, the maps and the animated stickmen with their emotes
  * `viewgun.js`: your arms and weapon in front of the camera when the view goes to first person in a maze
  * `evfx.js`: what each map's event looks like: the wave, laser and cannon marks, cannonballs, beams, blasts, the
    quake's shock ring and the bee swarms (storm.js has what they do)
  * `scenery.js`, `pattern.js`: platform shapes and surfaces, islands and plants per zone, GPU animated animals,
    waterfalls and spray
  * `mirror.js` streams the scene to the native renderer
* `src/`: a small Java activity that runs the game in a full screen WebView, the native OpenGL ES renderer
  (`src/io/stickmanup/gl/`), and WiFi, internet direct (UPnP and STUN) and Bluetooth sockets for the game
* `server/`: the game server, accounts and database, with an installer that does everything. See
  [server/README.md](server/README.md)
* `dev/`: node tests for the levels, physics and networked cord, Playwright scripts that drive the game in
  headless Chromium, a desktop harness that replays a recorded frame through the native renderer, the icon
  generator, and `sync_pattern.py`, which copies the surface patterns into the native renderer

Uses three.js and PeerJS, both MIT licensed.
