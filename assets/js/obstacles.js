// Themed obstacles, twenty per map. Each one is a generic mechanic ("prim") with its own look and tuning:
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
// and themed takes on the older hazards: drop (falling things), shooter (traps that fire across a
// bridge), flyer (things circling the gaps), vent (eruptions that launch you), gate (barriers that
// switch on and off).
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
  ],
  sunny: [
    O('coconutDrop', 'Coconut drop', 'drop', 0, { c: 0x6a4a2a, g: 0xffe08a }),
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
  ],
};

// Spread each map's twenty obstacles over its seven zones: every obstacle appears, and the ones that need a
// higher hazard setting lean toward the upper zones.
export function zoneObstacles(mapKey, zone) {
  const list = OBSTACLES[mapKey] || [], out = {};
  list.forEach((o, i) => {
    const home = (i * 7 + o.lvl * 3) % 7, near = Math.abs(home - zone);
    if (near === 0) out[o.key] = 2;
    else if (near === 1 || (zone >= 4 && o.lvl === 2)) out[o.key] = 1;
  });
  return out;
}

export const obstacle = (mapKey, key) => (OBSTACLES[mapKey] || []).find((o) => o.key === key);
