// Themed obstacles, twenty per map plus six endgame ones and ten of the hardest. Each one is a generic mechanic ("prim") with its own look and tuning:
//   sweep     bars spinning low over a wide platform (jump them)
//   pendulum  a weight swinging across a bridge (time your crossing)
//   slider    something moving back and forth along a platform: shape 'ball' and 'log' roll along it
//             (jump over), 'disc' is a saw, 'ram' shoves across from one side (time it)
//   crusher   a block that slams down on part of a platform (watch it shake first)
//   spikes    spikes that pop up from part of a platform (they glow before)
//   jet       a blast from beside a bridge, on and off (cross while it's off)
//   blink     a row of small platforms that fade out and back in turn
//   trapdoor  a platform that drops open now and then (it rattles first)
//   turntable a platform spinning on the spot (it carries you round)
//   bumpers   bouncy posts on a platform (they throw you away)
//   wind      a bridge with a crosswind blowing now and then
//   mud       platforms that slow you down
//   slick     slippery platforms
//   slide     a water slide up to the next platform, with water rushing down it (waterfall)
//   leap      fish leaping in arcs across a bridge (waterfall)
//   current   a lazy river that carries you sideways across a platform (waterfall)
//   flume     a launch slide: down a fast chute and off a kicker onto a higher ledge (waterfall, sunny)
// and themed takes on the older hazards: drop (falling things), shooter (traps that fire across a
// bridge), flyer (things circling the gaps), vent (eruptions that launch you), gate (barriers that
// switch on and off).
// Six more per map are endgame obstacles (end: true), harder combinations that only show up near the top:
//   gauntlet  a long bridge with two weights swinging opposite ways
//   checker   a platform in four squares whose spikes pop up two at a time (keep hopping)
//   beamroll  something rolling back and forth along a narrow bridge (jump it)
//   crushrow  three presses slamming one after another down a narrow platform
//   crossfire two jets across a bridge taking turns, with one safe spot between them
//   spinsweep a turntable with bars spinning the other way over it
// Ten more per map are the hardest of all (hard: true), from the middle of the climb up:
//   sawrun      two things running opposite ways along a narrow bridge
//   triplegaunt a very long bridge with three weights swinging fast
//   spikewave   a long platform whose spikes pop up in a wave: run with the gap
//   pressgaps   four presses slamming fast in a row
//   jetladder   three jets across a bridge, taking turns
//   blinkrace   six tiny platforms fading out fast, one after another
//   trapchain   four small trapdoors in a row
//   twinsweep   two sets of bars spinning opposite ways on one platform
//   dashswing   a dash gap with a weight swinging through it
//   kickjets    a wall jump shaft with jets firing across it
// lvl: the hazard setting that switches it on (0 calm and up, 1 normal and up, 2 wild only).
// look: c main colour, g glow colour, s shape.

const O = (key, name, prim, lvl, look, extra) => Object.assign({ key, name, prim, lvl, look }, extra || {});

export const OBSTACLES = {
  storm: [
    O('turbineSweep', 'Turbine sweep', 'sweep', 0, { c: 0x5a6070, g: 0x3ff0d0, s: 'bar' }, { n: 2 }),
    O('teslaBall', 'Tesla pendulum', 'pendulum', 0, { c: 0x2a2e3a, g: 0x9b7bff, s: 'ball' }),
    O('pistonRam', 'Piston ram', 'slider', 1, { c: 0x4a4f5c, g: 0xff8a3d, s: 'ram' }),
    O('pressCrusher', 'Hydraulic press', 'crusher', 1, { c: 0x3a3f4c, g: 0xff4040, s: 'block' }),
    O('arcSpikes', 'Arc spikes', 'spikes', 1, { c: 0x8a9ab0, g: 0x7fd8ff }),
    O('plasmaJet', 'Plasma jet', 'jet', 1, { c: 0x2a2e3a, g: 0x6ab8ff }),
    O('cargoDrum', 'Rolling cargo drum', 'slider', 0, { c: 0x6a5040, g: 0xffc23d, s: 'log' }),
    O('phasePads', 'Phase platforms', 'blink', 0, { c: 0x2a3a4a, g: 0x3ff0d0 }),
    O('rotorDeck', 'Rotor deck', 'turntable', 0, { c: 0x3a3f4c, g: 0xff8a3d }),
    O('coilBumpers', 'Coil bumpers', 'bumpers', 0, { c: 0x30304a, g: 0x9b7bff }),
    O('ventGale', 'Vent gale', 'wind', 1, { c: 0x4a4450, g: 0xffb070 }),
    O('sawTrack', 'Saw track', 'slider', 2, { c: 0xb0b8c8, g: 0xff4040, s: 'disc' }),
    O('hatchDrop', 'Floor hatches', 'trapdoor', 1, { c: 0x3a3f4c, g: 0xffc23d }),
    O('oilSlick', 'Oil slick', 'slick', 0, { c: 0x1a1c22, g: 0x9b7bff }),
    O('laserCross', 'Laser cross', 'sweep', 2, { c: 0x2a2e3a, g: 0xff2448, s: 'laser' }, { n: 3 }),
    O('wreckBall', 'Wrecking ball', 'pendulum', 2, { c: 0x2a2e3a, g: 0xff4040, s: 'ball', big: true }),
    O('steamVent', 'Steam vents', 'vent', 0, { c: 0x2a2e3a, g: 0xcfefff }),
    O('scrapFall', 'Falling scrap', 'drop', 1, { c: 0x5a6070, g: 0xff8a3d }),
    O('sparkGate', 'Spark gate', 'gate', 1, { c: 0x2a2e3a, g: 0x7fd8ff }),
    O('greaseMud', 'Grease pit', 'mud', 0, { c: 0x2a2620, g: 0xff8a3d }),
    // Endgame: harder ones near the top.
    O('teslaGauntlet', 'Tesla gauntlet', 'gauntlet', 0, { c: 0x2a2e3a, g: 0xb48cff, s: 'ball' }, { end: true }),
    O('liveGrid', 'Live wire grid', 'checker', 0, { c: 0x8a9ab0, g: 0x3ff0d0 }, { end: true }),
    O('generatorRoll', 'Runaway generator', 'beamroll', 0, { c: 0x4a4f5c, g: 0xffc23d, s: 'log' }, { end: true }),
    O('pistonRow', 'Piston row', 'crushrow', 1, { c: 0x3a3f4c, g: 0xff4040 }, { end: true }),
    O('plasmaCross', 'Plasma crossfire', 'crossfire', 1, { c: 0x2a2e3a, g: 0xff4fb4 }, { end: true }),
    O('stormRotor', 'Storm rotor', 'spinsweep', 2, { c: 0x5a6070, g: 0x8fe9ff, s: 'laser' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('stormSawRails', 'Twin saw rails', 'sawrun', 1, { c: 0xb0b8c8, g: 0xff4040, s: 'disc' }, { hard: true }),
    O('teslaTriple', 'Triple Tesla swing', 'triplegaunt', 1, { c: 0x2a2e3a, g: 0xb48cff, s: 'ball' }, { hard: true }),
    O('surgeWave', 'Surge wave', 'spikewave', 1, { c: 0x8a9ab0, g: 0x7fd8ff }, { hard: true }),
    O('pistonRow', 'Piston row', 'pressgaps', 1, { c: 0x3a3f4c, g: 0xff4040 }, { hard: true }),
    O('plasmaLadder', 'Plasma ladder', 'jetladder', 1, { c: 0x2a2e3a, g: 0x6ab8ff }, { hard: true }),
    O('flickerRun', 'Flicker run', 'blinkrace', 1, { c: 0x2a3a4a, g: 0x3ff0d0 }, { hard: true }),
    O('hatchChain', 'Hatch chain', 'trapchain', 1, { c: 0x3a3f4c, g: 0xffc23d }, { hard: true }),
    O('twinTurbines', 'Twin turbines', 'twinsweep', 2, { c: 0x5a6070, g: 0x3ff0d0, s: 'bar' }, { hard: true }),
    O('wreckGap', 'Wrecking gap', 'dashswing', 2, { c: 0x2a2e3a, g: 0xff4040, s: 'ball' }, { hard: true }),
    O('arcShaft', 'Arc shaft', 'kickjets', 2, { c: 0x2a2e3a, g: 0x7fd8ff }, { hard: true }),
  ],
  sunny: [
    O('coconutDrop', 'Coconut drop', 'drop', 0, { c: 0x6a4a2a, g: 0xffe08a }),
    O('waveChute', 'Wave chute', 'flume', 0, { c: 0x2ec4b6, g: 0xffffff }),
    O('beachBall', 'Rolling beach ball', 'slider', 0, { c: 0xff5a5a, g: 0xffffff, s: 'ball' }),
    O('anchorSwing', 'Anchor pendulum', 'pendulum', 1, { c: 0x3a4250, g: 0xffd76a, s: 'anchor' }),
    O('cannonShots', 'Cannon shots', 'shooter', 1, { c: 0x2a2e3a, g: 0xffb040 }),
    O('waveRam', 'Wave wall', 'slider', 1, { c: 0x4fc8e8, g: 0xffffff, s: 'ram' }),
    O('carouselDeck', 'Carousel deck', 'turntable', 0, { c: 0xd9c49c, g: 0xff6b6b }),
    O('sprinklerJet', 'Sprinkler blast', 'jet', 0, { c: 0x3a6a8a, g: 0x9fe8ff }),
    O('wetSand', 'Wet sand', 'mud', 0, { c: 0xb89a6a, g: 0xffe08a }),
    O('hatchPlanks', 'Hatch planks', 'trapdoor', 1, { c: 0xa07850, g: 0xffd76a }),
    O('sinkingPlanks', 'Sinking planks', 'blink', 0, { c: 0xb08a5a, g: 0x2ec4b6 }),
    O('buoyBumpers', 'Buoy bumpers', 'bumpers', 0, { c: 0xff6b3d, g: 0xffffff }),
    O('seaBreeze', 'Sea breeze', 'wind', 0, { c: 0xe8e2d4, g: 0x9fe8ff }),
    O('lightSweep', 'Lighthouse beam', 'sweep', 1, { c: 0xf0f4ff, g: 0xffe08a, s: 'laser' }, { n: 1 }),
    O('urchinSpikes', 'Sea urchins', 'spikes', 1, { c: 0x4a2a5a, g: 0xff6bd8 }),
    O('crateCrusher', 'Crate press', 'crusher', 2, { c: 0xc9a36b, g: 0xff6b3d, s: 'block' }),
    O('surfSlick', 'Surfboard deck', 'slick', 0, { c: 0x4fc8e8, g: 0xffffff }),
    O('skimSaw', 'Skimming board', 'slider', 2, { c: 0xffb703, g: 0xff6b6b, s: 'disc' }),
    O('gullFlock', 'Diving gulls', 'flyer', 1, { c: 0xf2f2f2, g: 0xffb040 }),
    O('blowhole', 'Blowholes', 'vent', 0, { c: 0x3a4a5a, g: 0x9fe8ff }),
    O('ropeGate', 'Rope barrier', 'gate', 2, { c: 0x8a6a44, g: 0xffd76a }),
    // Endgame: harder ones near the top.
    O('twinAnchors', 'Twin anchors', 'gauntlet', 0, { c: 0x3a4250, g: 0xffd76a, s: 'anchor' }, { end: true }),
    O('urchinReef', 'Urchin reef', 'checker', 0, { c: 0x4a2a5a, g: 0xff7ab8 }, { end: true }),
    O('barrelRoll', 'Barrel roll', 'beamroll', 0, { c: 0x8a5a2a, g: 0xffd08a, s: 'log' }, { end: true }),
    O('crateStampers', 'Crate stampers', 'crushrow', 1, { c: 0xb08850, g: 0xff8a3d }, { end: true }),
    O('waterCannons', 'Water cannons', 'crossfire', 1, { c: 0x2a4a6a, g: 0x5ad1ff }, { end: true }),
    O('beamCarousel', 'Lighthouse carousel', 'spinsweep', 2, { c: 0xe8e2d4, g: 0xffe45c, s: 'bar' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('barrelPair', 'Twin barrels', 'sawrun', 1, { c: 0x8a5a2a, g: 0xffd08a, s: 'log' }, { hard: true }),
    O('tripleAnchors', 'Triple anchors', 'triplegaunt', 1, { c: 0x3a4250, g: 0xffd76a, s: 'anchor' }, { hard: true }),
    O('urchinWave', 'Urchin wave', 'spikewave', 1, { c: 0x4a2a5a, g: 0xff7ab8 }, { hard: true }),
    O('stamperRow', 'Crate stamper row', 'pressgaps', 1, { c: 0xb08850, g: 0xff8a3d }, { hard: true }),
    O('blowholeLadder', 'Blowhole ladder', 'jetladder', 1, { c: 0x2a4a6a, g: 0x5ad1ff }, { hard: true }),
    O('foamRun', 'Foam stepping stones', 'blinkrace', 1, { c: 0xdff4f4, g: 0x7fe8ff }, { hard: true }),
    O('rottenPlanks', 'Rotten plank chain', 'trapchain', 1, { c: 0xb08850, g: 0xffc23d }, { hard: true }),
    O('twinCarousels', 'Twin carousels', 'twinsweep', 2, { c: 0xe8e2d4, g: 0xffe45c, s: 'bar' }, { hard: true }),
    O('anchorGap', 'Anchor gap', 'dashswing', 2, { c: 0x3a4250, g: 0xffd76a, s: 'anchor' }, { hard: true }),
    O('geyserShaft', 'Geyser shaft', 'kickjets', 2, { c: 0x2a4a6a, g: 0xcfefff }, { hard: true }),
  ],
  forest: [
    O('logRoll', 'Rolling log', 'slider', 0, { c: 0x6a4a2c, g: 0x9be564, s: 'log' }),
    O('spikedLog', 'Spiked log swing', 'pendulum', 1, { c: 0x5a4028, g: 0xff5d5d, s: 'log' }),
    O('branchSweep', 'Branch sweep', 'sweep', 0, { c: 0x5a4028, g: 0x9be564, s: 'bar' }, { n: 1 }),
    O('acornDrop', 'Acorn drop', 'drop', 0, { c: 0x8a5a2a, g: 0xffc857 }),
    O('thornSpikes', 'Thorn patch', 'spikes', 1, { c: 0x3a5a2a, g: 0xff5d5d }),
    O('sporeJet', 'Spore burst', 'jet', 1, { c: 0x6a3a6a, g: 0xd88aff }),
    O('shroomBumpers', 'Mushroom bumpers', 'bumpers', 0, { c: 0xd8322a, g: 0xffffff }),
    O('mudPit', 'Mud pit', 'mud', 0, { c: 0x4a3420, g: 0x9be564 }),
    O('leafPads', 'Wilting leaves', 'blink', 0, { c: 0x3c6e2a, g: 0xc6ff8f }),
    O('stumpSpin', 'Spinning stump', 'turntable', 0, { c: 0x6a4a2c, g: 0x9be564 }),
    O('boarCharge', 'Charging boar', 'slider', 1, { c: 0x5a3a2a, g: 0xff9a3d, s: 'ram' }),
    O('logCrusher', 'Log trap', 'crusher', 1, { c: 0x5a4028, g: 0xffc857, s: 'log' }),
    O('gustHollow', 'Gusty hollow', 'wind', 1, { c: 0x4a5a3a, g: 0xc6ff8f }),
    O('rootHatch', 'Root trapdoor', 'trapdoor', 1, { c: 0x5a4330, g: 0x9be564 }),
    O('hiveSwing', 'Beehive swing', 'pendulum', 2, { c: 0xd8a83a, g: 0xffe066, s: 'ball' }),
    O('sapSlick', 'Sticky sap', 'slick', 0, { c: 0xc88a2a, g: 0xffc857 }),
    O('stoneRoll', 'Rolling stone', 'slider', 2, { c: 0x6a6a64, g: 0xc6ff8f, s: 'ball' }),
    O('beeSwarm', 'Bee swarm', 'flyer', 1, { c: 0xffd23f, g: 0xff5d5d }),
    O('dartFrogs', 'Dart traps', 'shooter', 2, { c: 0x3a5a2a, g: 0x7cfc00 }),
    O('fireflyGate', 'Firefly curtain', 'gate', 1, { c: 0x3e5244, g: 0xf9f871 }),
    // Endgame: harder ones near the top.
    O('twinLogs', 'Twin log swings', 'gauntlet', 0, { c: 0x6a4a2a, g: 0xc6ff8f, s: 'log' }, { end: true }),
    O('brambleField', 'Bramble field', 'checker', 0, { c: 0x3a5a2a, g: 0xff5d5d }, { end: true }),
    O('acornAvalanche', 'Acorn avalanche', 'beamroll', 0, { c: 0x8a5a2a, g: 0xffc857, s: 'ball' }, { end: true }),
    O('stompRoots', 'Stomping roots', 'crushrow', 1, { c: 0x4a3a2a, g: 0x9be564 }, { end: true }),
    O('sporeCross', 'Spore crossfire', 'crossfire', 1, { c: 0x5a3a5a, g: 0xff7eb6 }, { end: true }),
    O('whirlStump', 'Whirling stump', 'spinsweep', 2, { c: 0x6a4a2a, g: 0xc6ff8f, s: 'bar' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('logPair', 'Twin rolling logs', 'sawrun', 1, { c: 0x6a4a2a, g: 0xc6ff8f, s: 'log' }, { hard: true }),
    O('tripleHives', 'Triple beehive swing', 'triplegaunt', 1, { c: 0x8a5a2a, g: 0xffc857, s: 'ball' }, { hard: true }),
    O('thornWave', 'Thorn wave', 'spikewave', 1, { c: 0x3a5a2a, g: 0xff5d5d }, { hard: true }),
    O('stumpRow', 'Stump stampers', 'pressgaps', 1, { c: 0x4a3a2a, g: 0x9be564 }, { hard: true }),
    O('sporeLadder', 'Spore ladder', 'jetladder', 1, { c: 0x5a3a5a, g: 0xff7eb6 }, { hard: true }),
    O('fireflyRun', 'Firefly stones', 'blinkrace', 1, { c: 0x3a4a2a, g: 0xe6ff8f }, { hard: true }),
    O('rootChain', 'Root trapdoor chain', 'trapchain', 1, { c: 0x4a3a2a, g: 0xc6ff8f }, { hard: true }),
    O('twinBranches', 'Twin branch sweeps', 'twinsweep', 2, { c: 0x6a4a2a, g: 0xc6ff8f, s: 'bar' }, { hard: true }),
    O('spikedGap', 'Spiked log gap', 'dashswing', 2, { c: 0x6a4a2a, g: 0xff5d5d, s: 'ball' }, { hard: true }),
    O('sporeShaft', 'Spore shaft', 'kickjets', 2, { c: 0x5a3a5a, g: 0xff7eb6 }, { hard: true }),
  ],
  volcano: [
    O('lavaBall', 'Rolling lava ball', 'slider', 0, { c: 0x3a1a10, g: 0xff6a1a, s: 'ball' }),
    O('fireBar', 'Fire bar', 'sweep', 0, { c: 0x3a2a26, g: 0xff8a2a, s: 'laser' }, { n: 1 }),
    O('flameJet', 'Flame jet', 'jet', 0, { c: 0x2a1e1a, g: 0xff7a1a }),
    O('obsidianSpikes', 'Obsidian spikes', 'spikes', 1, { c: 0x1a1420, g: 0xb06bff }),
    O('moltenSwing', 'Molten pendulum', 'pendulum', 1, { c: 0x3a1a10, g: 0xff4a10, s: 'ball' }),
    O('stonePress', 'Stone press', 'crusher', 1, { c: 0x3a2a24, g: 0xff4a10, s: 'block' }),
    O('sinkingRocks', 'Sinking rocks', 'blink', 0, { c: 0x3a2a24, g: 0xff6a2a }),
    O('magmaWheel', 'Magma wheel', 'turntable', 0, { c: 0x2e2420, g: 0xff6a2a }),
    O('emberBumpers', 'Ember bumpers', 'bumpers', 1, { c: 0x3a1a10, g: 0xffb040 }),
    O('heatGust', 'Heat gust', 'wind', 1, { c: 0x3a2a24, g: 0xff9a3d }),
    O('tarPit', 'Tar pit', 'mud', 0, { c: 0x141010, g: 0xff4a10 }),
    O('ventHatch', 'Vent trapdoor', 'trapdoor', 1, { c: 0x2e2420, g: 0xff6a2a }),
    O('fireballs', 'Fireball traps', 'shooter', 1, { c: 0x2a1e1a, g: 0xff6a1a }),
    O('lavaSurge', 'Lava surge', 'slider', 2, { c: 0xff4a10, g: 0xffc23d, s: 'ram' }),
    O('obsidianSaw', 'Obsidian saw', 'slider', 2, { c: 0x1a1420, g: 0xff4a10, s: 'disc' }),
    O('twinFireBar', 'Twin fire bars', 'sweep', 2, { c: 0x3a2a26, g: 0xff4a10, s: 'laser' }, { n: 2 }),
    O('glassSlick', 'Volcanic glass', 'slick', 0, { c: 0x1a1420, g: 0xb06bff }),
    O('meteorDrop', 'Meteor shower', 'drop', 2, { c: 0x3a2a24, g: 0xff8a2a }),
    O('fireBats', 'Fire bats', 'flyer', 1, { c: 0x2a1410, g: 0xff6a1a }),
    O('magmaGate', 'Magma curtain', 'gate', 1, { c: 0x3a1a10, g: 0xff4a10 }),
    // Endgame: harder ones near the top.
    O('magmaBells', 'Twin magma bells', 'gauntlet', 0, { c: 0x3a2420, g: 0xff6a2a, s: 'ball' }, { end: true }),
    O('eruptGrid', 'Eruption grid', 'checker', 0, { c: 0x2a2024, g: 0xff3a1a }, { end: true }),
    O('boulderRun', 'Lava boulder run', 'beamroll', 0, { c: 0x3a2a24, g: 0xff8a2a, s: 'ball' }, { end: true }),
    O('obsidianStamp', 'Obsidian stampers', 'crushrow', 1, { c: 0x1e1a24, g: 0xb06bff }, { end: true }),
    O('flameCross', 'Flame crossfire', 'crossfire', 1, { c: 0x2a1e1a, g: 0xff9a3d }, { end: true }),
    O('magmaWhirl', 'Magma whirl', 'spinsweep', 2, { c: 0x3a2420, g: 0xff4a2a, s: 'laser' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('lavaWheels', 'Twin lava wheels', 'sawrun', 1, { c: 0x3a2a24, g: 0xff8a2a, s: 'disc' }, { hard: true }),
    O('tripleBells', 'Triple magma bells', 'triplegaunt', 1, { c: 0x3a2420, g: 0xff6a2a, s: 'ball' }, { hard: true }),
    O('obsidianWave', 'Obsidian wave', 'spikewave', 1, { c: 0x2a2024, g: 0xff3a1a }, { hard: true }),
    O('basaltRow', 'Basalt hammer row', 'pressgaps', 1, { c: 0x1e1a24, g: 0xb06bff }, { hard: true }),
    O('flameLadder', 'Flame ladder', 'jetladder', 1, { c: 0x2a1e1a, g: 0xff9a3d }, { hard: true }),
    O('ashRun', 'Ash stepping stones', 'blinkrace', 1, { c: 0x3a3030, g: 0xff6a2a }, { hard: true }),
    O('ventChain', 'Vent trapdoor chain', 'trapchain', 1, { c: 0x2a2024, g: 0xffc23d }, { hard: true }),
    O('twinFireBars', 'Twin fire bars', 'twinsweep', 2, { c: 0x3a2420, g: 0xff6a2a, s: 'bar' }, { hard: true }),
    O('moltenGap', 'Molten gap', 'dashswing', 2, { c: 0x3a2420, g: 0xff3a1a, s: 'ball' }, { hard: true }),
    O('flameShaft', 'Flame shaft', 'kickjets', 2, { c: 0x2a1e1a, g: 0xff9a3d }, { hard: true }),
  ],
  city: [
    O('securitySweep', 'Security sweep', 'sweep', 0, { c: 0x2a3040, g: 0xff2a8a, s: 'laser' }, { n: 2 }),
    O('craneBall', 'Crane wrecking ball', 'pendulum', 1, { c: 0x2a2e3a, g: 0xffb43d, s: 'ball', big: true }),
    O('cartRam', 'Runaway cart', 'slider', 1, { c: 0x3fd0ff, g: 0xffffff, s: 'ram' }),
    O('compactor', 'Trash compactor', 'crusher', 1, { c: 0x4a4f5c, g: 0xffb43d, s: 'block' }),
    O('spikeStrip', 'Spike strip', 'spikes', 1, { c: 0x8a96aa, g: 0xff2a8a }),
    O('steamPipe', 'Steam pipe', 'jet', 0, { c: 0x4a4f5c, g: 0xe0f0ff }),
    O('barrelRoll', 'Rolling barrel', 'slider', 0, { c: 0x3a6a3a, g: 0x7cff6a, s: 'log' }),
    O('holoPads', 'Hologram platforms', 'blink', 0, { c: 0x2a3a5a, g: 0x3fd0ff }),
    O('helipad', 'Spinning helipad', 'turntable', 0, { c: 0x2a2e3a, g: 0xffe066 }),
    O('airbags', 'Airbag bumpers', 'bumpers', 0, { c: 0xffe066, g: 0xff4fd8 }),
    O('acGust', 'Air conditioner gust', 'wind', 1, { c: 0x8a96aa, g: 0x9fe8ff }),
    O('manhole', 'Roof hatches', 'trapdoor', 1, { c: 0x3a3f4c, g: 0xffb43d }),
    O('oilSpill', 'Oil spill', 'slick', 0, { c: 0x141820, g: 0xa080ff }),
    O('paintball', 'Paintball turrets', 'shooter', 1, { c: 0x2a2e3a, g: 0xff4fd8 }),
    O('billboardSweep', 'Billboard spinner', 'sweep', 2, { c: 0x2a2e3a, g: 0x7cff6a, s: 'bar' }, { n: 3 }),
    O('neonGate', 'Neon gate', 'gate', 1, { c: 0x2a2e3a, g: 0xff4fd8 }),
    O('signFall', 'Falling signs', 'drop', 1, { c: 0x3a3f4c, g: 0xffe066 }),
    O('gumPatch', 'Chewing gum patch', 'mud', 0, { c: 0xff7ab8, g: 0xffffff }),
    O('sawDrone', 'Saw drone', 'slider', 2, { c: 0x8a96aa, g: 0xff2a2a, s: 'disc' }),
    O('pigeonFlock', 'Pigeon flock', 'flyer', 2, { c: 0x8a8a96, g: 0xffb43d }),
    // Endgame: harder ones near the top.
    O('twinWrecking', 'Twin wrecking balls', 'gauntlet', 0, { c: 0x3a3f4c, g: 0xffb43d, s: 'ball', big: true }, { end: true }),
    O('laserFloor', 'Laser floor', 'checker', 0, { c: 0x2a2e3a, g: 0xff4fd8 }, { end: true }),
    O('sawRun', 'Rolling saw blade', 'beamroll', 0, { c: 0x8a96aa, g: 0xff2a2a, s: 'disc' }, { end: true }),
    O('stampPresses', 'Stamping presses', 'crushrow', 1, { c: 0x3a3f4c, g: 0xffe066 }, { end: true }),
    O('steamCross', 'Steam crossfire', 'crossfire', 1, { c: 0x4a4f5c, g: 0xd8f0ff }, { end: true }),
    O('roofFan', 'Rooftop fan', 'spinsweep', 2, { c: 0x2a2e3a, g: 0x7cff6a, s: 'bar' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('sawDronePair', 'Twin saw drones', 'sawrun', 1, { c: 0xa8acb8, g: 0xff3d6a, s: 'disc' }, { hard: true }),
    O('tripleCranes', 'Triple crane swing', 'triplegaunt', 1, { c: 0x3a3440, g: 0xffb43d, s: 'ball' }, { hard: true }),
    O('spikeFloor', 'Spike floor wave', 'spikewave', 1, { c: 0x5a5a68, g: 0x3dffd0 }, { hard: true }),
    O('compactorRow', 'Compactor row', 'pressgaps', 1, { c: 0x34303a, g: 0xff3d6a }, { hard: true }),
    O('steamLadder', 'Steam ladder', 'jetladder', 1, { c: 0x34303a, g: 0xcfefff }, { hard: true }),
    O('glitchRun', 'Glitch hologram run', 'blinkrace', 1, { c: 0x283440, g: 0x7cff6a }, { hard: true }),
    O('serviceHatches', 'Service hatch chain', 'trapchain', 1, { c: 0x4a4a58, g: 0xffb43d }, { hard: true }),
    O('twinSecurity', 'Twin security sweeps', 'twinsweep', 2, { c: 0x34303a, g: 0xff3d6a, s: 'laser' }, { hard: true }),
    O('craneGap', 'Crane gap', 'dashswing', 2, { c: 0x3a3440, g: 0xffb43d, s: 'ball' }, { hard: true }),
    O('steamShaft', 'Steam shaft', 'kickjets', 2, { c: 0x34303a, g: 0xcfefff }, { hard: true }),
  ],
  waterfall: [
    O('waterSlide', 'Water slide', 'slide', 0, { c: 0x2a9ae8, g: 0xbff4ff }),
    O('launchSlide', 'Launch slide', 'flume', 0, { c: 0xffb43d, g: 0xfff2a8 }),
    O('leapingFish', 'Leaping fish', 'leap', 0, { c: 0xff8a3d, g: 0xffd08a }),
    O('fountainLift', 'Fountain lift', 'vent', 0, { c: 0xe8f4f8, g: 0x7fe8ff }),
    O('lazyRiver', 'Lazy river', 'current', 0, { c: 0x2a9ad8, g: 0xbff4ff }),
    O('tippingBucket', 'Tipping bucket', 'drop', 0, { c: 0x5ad0ff, g: 0xbff4ff, s: 'water' }),
    O('sprinkler', 'Spinning sprinkler', 'sweep', 0, { c: 0xe8eef0, g: 0x7fe8ff, s: 'bar' }, { n: 2 }),
    O('buoySwing', 'Swinging buoy', 'pendulum', 1, { c: 0xff5a4a, g: 0xffffff, s: 'ball' }),
    O('waterCannon', 'Water cannon', 'jet', 1, { c: 0x2a6a9a, g: 0x9ae8ff }),
    O('splashPress', 'Splash press', 'crusher', 1, { c: 0x3a8ac8, g: 0xbff4ff }),
    O('coralSpikes', 'Coral spikes', 'spikes', 1, { c: 0xff7a6a, g: 0xffd0c0 }),
    O('lilyPads', 'Sinking lily pads', 'blink', 0, { c: 0x4ab84a, g: 0xff9ad8 }),
    O('splashHatch', 'Splash hatches', 'trapdoor', 1, { c: 0x3a8ac8, g: 0xffe066 }),
    O('whirlpool', 'Whirlpool deck', 'turntable', 0, { c: 0x2a8ac8, g: 0xbff4ff }),
    O('swimRings', 'Swim ring bumpers', 'bumpers', 0, { c: 0xff5a8a, g: 0xffffff }),
    O('spray', 'Waterfall spray', 'wind', 1, { c: 0xd8f0f8, g: 0xbff4ff }),
    O('seaweed', 'Seaweed patch', 'mud', 0, { c: 0x2a7a4a, g: 0x9be564 }),
    O('wetTiles', 'Wet tiles', 'slick', 0, { c: 0xbfe8f0, g: 0xffffff }),
    O('squirtGuns', 'Squirt guns', 'shooter', 2, { c: 0xff8a3d, g: 0x7fe8ff }),
    O('waterCurtain', 'Water curtain', 'gate', 1, { c: 0x9ad8ff, g: 0x7fe8ff }),
    O('flyingFish', 'Flying fish', 'flyer', 2, { c: 0x5ab8ff, g: 0xffd08a }),
    // Endgame: harder ones near the top.
    O('twinBuoys', 'Twin buoy swings', 'gauntlet', 0, { c: 0xff5a4a, g: 0xffffff, s: 'ball' }, { end: true }),
    O('fountainGrid', 'Fountain grid', 'checker', 0, { c: 0x3a8ac8, g: 0x7fe8ff, s: 'water' }, { end: true }),
    O('tubeRun', 'Rolling tubes', 'beamroll', 0, { c: 0xffd23d, g: 0xff8a3d, s: 'log' }, { end: true }),
    O('splashRow', 'Splash hammers', 'crushrow', 1, { c: 0x3a8ac8, g: 0xbff4ff }, { end: true }),
    O('cannonCross', 'Water cannon crossfire', 'crossfire', 1, { c: 0x2a6a9a, g: 0x9ae8ff }, { end: true }),
    O('whirlSprinkler', 'Whirlpool sprinkler', 'spinsweep', 2, { c: 0x2a8ac8, g: 0x7fe8ff, s: 'bar' }, { end: true }),
    // The hardest: new ways to get hurt, from the middle of the climb up.
    O('driftwoodPair', 'Twin driftwood', 'sawrun', 1, { c: 0x8a6a46, g: 0xffd08a, s: 'log' }, { hard: true }),
    O('tripleBuoys', 'Triple buoy swing', 'triplegaunt', 1, { c: 0xff5a4a, g: 0xffffff, s: 'ball' }, { hard: true }),
    O('fountainWave', 'Fountain wave', 'spikewave', 1, { c: 0x3a8ac8, g: 0x7fe8ff, s: 'water' }, { hard: true }),
    O('splashRow2', 'Splash hammer row', 'pressgaps', 1, { c: 0x3a8ac8, g: 0xbff4ff }, { hard: true }),
    O('cannonLadder', 'Water cannon ladder', 'jetladder', 1, { c: 0x2a6a9a, g: 0x9ae8ff }, { hard: true }),
    O('bubbleRun', 'Bubble stones', 'blinkrace', 1, { c: 0x9ad8ff, g: 0xffffff }, { hard: true }),
    O('lilyChain', 'Sinking lily chain', 'trapchain', 1, { c: 0x3a8a4a, g: 0xbff4ff }, { hard: true }),
    O('twinSprinklers', 'Twin sprinklers', 'twinsweep', 2, { c: 0x2a8ac8, g: 0x7fe8ff, s: 'bar' }, { hard: true }),
    O('buoyGap', 'Buoy gap', 'dashswing', 2, { c: 0xff5a4a, g: 0xffffff, s: 'ball' }, { hard: true }),
    O('sprayShaft', 'Spray shaft', 'kickjets', 2, { c: 0x2a6a9a, g: 0x9ae8ff }, { hard: true }),
  ],
};

// Spread each map's twenty obstacles over the first seven zones: every obstacle appears, and the ones that need a
// higher hazard setting lean toward the upper zones. The endgame ones come in near the top, the top zones mix
// in everything, and the higher the zone the more often obstacles are picked at all.
export function zoneObstacles(mapKey, zone, nz = 9) {
  const list = OBSTACLES[mapKey] || [], out = {}, ramp = 1, nReg = list.filter((o) => !o.end && !o.hard).length;
  list.forEach((o, i) => {
    let w = 0;
    if (o.end) w = zone >= nz - 2 ? 2.5 : zone === nz - 3 ? 1 : 0;
    else if (o.hard) w = zone >= nz - 3 ? 2 : zone >= nz - 5 ? 1 : 0;
    else {
      // Spread in catalogue order over zones 0 to 6, nudged up one zone per hazard level.
      const home = Math.min(6, Math.floor((i * 7) / nReg) + o.lvl), near = Math.abs(home - zone);
      if (near === 0) w = 2;
      else if (near === 1 || (zone >= 4 && o.lvl === 2)) w = 1;
      else if (zone >= nz - 2) w = 0.5;
    }
    if (w) out[o.key] = w * ramp;
  });
  return out;
}

export const obstacle = (mapKey, key) => (OBSTACLES[mapKey] || []).find((o) => o.key === key);
