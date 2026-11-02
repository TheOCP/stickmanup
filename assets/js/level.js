// Procedural but deterministic climbs, built zone by zone from hand-tuned templates. Every phone
// generates the identical level from the map's seed. Each map has its own route:
//   storm  - 'spiral': round and round the tower, counter-clockwise
//   sunny  - 'switchback': back and forth across the lighthouse in two lanes, turning at the ends
//   forest - 'trees': clockwise round the giant trunk, with branch walks out to side trees and up around them
import { makeBox, makeCyl } from './physics.js';
import { TAU, rng, clamp, angDiff } from './util.js';
import { zoneObstacles, obstacle } from './obstacles.js';

export const LEVEL_VERSION = 11;
export const CORE_R = 6;
export const HEAD = 4.2; // minimum vertical spacing between layers of the route

export const DIFFS = [
  { id: 0, name: 'Easy', rope: 7.5, storm: 0.7, grip: 0.7, desc: 'Checkpoints in every zone, a long cord, a calmer storm and fewer, slower obstacles.' },
  { id: 1, name: 'Normal', rope: 6.2, storm: 1.0, grip: 1.0, desc: 'Four checkpoints on the whole climb. The full storm and most obstacles.' },
  { id: 2, name: 'Hardcore', rope: 5.2, storm: 1.15, grip: 1.3, desc: 'No checkpoints and a short cord. Every obstacle, and faster. A fall is a fall.' },
];

// Six maps, nine zones each, up to 1000 m. tpl = template weights; pattern = surface look (1 metal panels, 2 stone, 3 wood).
const Z = (name, sub, y1, color, tint, fog, sx, sz, gap, tpl, extra) => Object.assign({ name, sub, y1, color, tint, fog, sx, sz, gap, tpl }, extra);
export const MAPS = [
  {
    id: 0, key: 'storm', name: 'Storm Tower', desc: 'A neon tower in a lightning storm at night. When lightning marks you, SHIELD up. Lasers, rods, fans and ice.',
    seed: 77031, core: 'tower', pattern: 1, accent: '#3ff0d0', route: 'spiral',
    zones: [
      Z('Flooded Docks', 'SHIELD when lightning marks you', 100, 0x3ff0d0, 0x3d4652, 0x0b1820, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, crates: 2, laser: 1 }),
      Z('Turbine Halls', 'Cross between the gusts', 208, 0xff8a3d, 0x4a3d37, 0x1a1210, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, mover: 3, spinner: 2, fan: 3, stairs: 1, grapple: 1, laser: 2, swing: 1 }),
      Z('Lightning Rods', 'GRAB when the rods glow', 316, 0x9b7bff, 0x3b3858, 0x100d22, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { gap: 3, rods: 4, beam: 2, pad: 2, pillars: 1, door: 1, gate: 2, laser: 1 }),
      Z('Broken Elevator Shaft', 'Ride it up', 424, 0xffc23d, 0x4a4433, 0x18140a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { gap: 3, lift: 3, mover: 2, crumble: 3, stairs: 1, grapple: 1, gate: 2, swing: 1 }),
      Z('Floating Wreckage', 'Nothing here stands still', 532, 0xff4fb4, 0x4a3446, 0x1a0c18, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { gap: 2, tilt: 3, bob: 3, crumble: 2, pad: 1, beam: 1, door: 1, laser: 2, arrows: 1 }),
      Z('Ice Crown', 'Slippery when frozen', 640, 0x8fe9ff, 0x6a8292, 0x0e1a24, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { gap: 4, pillars: 2, beam: 2, iceslope: 2, bob: 1, grapple: 1, gate: 2, laser: 1 }, { ice: true }),
      Z('Thunderhead', 'The clouds fight back', 760, 0x5ad1ff, 0x3a4250, 0x0a1422, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { gap: 2, rods: 3, laser: 2, gate: 2, fan: 1, crumble: 2, bob: 1, grapple: 1 }),
      Z('Supercell', 'Hold on tight', 880, 0xff5a8a, 0x4a3442, 0x1a0a14, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { gap: 2, rods: 2, spinner: 1, laser: 2, gate: 2, crumble: 2, tilt: 2, lift: 1, door: 1 }),
      Z('Eye of the Storm', 'Everything at once', 992, 0xffd76a, 0x5a4f40, 0x1c160c, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { gap: 2, lift: 1, spinner: 1, rods: 2, crumble: 2, mover: 1, pillars: 1, beam: 1, tilt: 1, grapple: 1, door: 1, laser: 2, gate: 2 }),
    ],
  },
  {
    id: 1, key: 'sunny', name: 'Sunny Isles', desc: 'A white lighthouse over a turquoise sea. Zigzag up past arrow traps, swinging anchors and falling coconuts.',
    seed: 51207, core: 'lighthouse', pattern: 2, accent: '#ffb703', route: 'switchback',
    zones: [
      Z('Sandy Pier', 'Back and forth, up and up', 100, 0x2ec4b6, 0xd9c49c, 0x9fd3ef, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, crates: 2, swing: 1, arrows: 1 }),
      Z('Coral Cliffs', 'Bounce and crumble', 208, 0xff6b6b, 0xe3a47e, 0x9fd3ef, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, mover: 3, pad: 2, crumble: 2, grapple: 1, arrows: 2, swing: 2 }),
      Z('Lighthouse Steps', 'Round and round', 316, 0xe63946, 0xeeeeee, 0xa6d8f2, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { stairs: 2, gap: 3, spinner: 2, beam: 2, door: 1, arrows: 2, mover: 2 }),
      Z('Cloud Gardens', 'Floating in the breeze', 424, 0x5fa8d3, 0xf4f8fb, 0xb3defa, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { bob: 3, pad: 2, gap: 2, grapple: 1, tilt: 1, swing: 2, mover: 2 }),
      Z('Sky Bridges', 'Mind the gaps', 532, 0xffb703, 0xd6c7a1, 0xb9e0f7, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { beam: 3, mover: 2, tilt: 2, door: 1, gap: 2, arrows: 2, gate: 1 }),
      Z('Sun Spire', 'Hot and high', 640, 0xfb8500, 0xf3dfa2, 0xc4e6fa, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { lift: 2, crumble: 2, gap: 2, grapple: 1, spinner: 1, swing: 2, arrows: 2 }),
      Z('Lantern Gallery', 'Round the great lamp', 760, 0xffe45c, 0xf2ead8, 0xc8e8fb, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { gap: 2, arrows: 3, swing: 2, crumble: 2, mover: 2, tilt: 1, gate: 1, grapple: 1 }),
      Z('Rainbow Heights', 'Higher than the gulls', 880, 0xc77dff, 0xe8dcf0, 0xd4e2fb, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { gap: 2, bob: 2, arrows: 2, swing: 2, crumble: 2, spinner: 1, lift: 1, door: 1 }),
      Z('Golden Summit', 'Almost in the sun', 992, 0xffd60a, 0xf0d58d, 0xd0ecfb, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { gap: 2, lift: 1, spinner: 1, crumble: 2, mover: 1, pillars: 1, beam: 1, tilt: 1, grapple: 1, door: 1, arrows: 2, swing: 2, gate: 1 }),
    ],
  },
  {
    id: 2, key: 'forest', name: 'Wild Forest', desc: 'Climb a giant tree in a misty forest. Monsters and bats try to knock you off.',
    seed: 90913, core: 'tree', pattern: 3, accent: '#9be564', route: 'trees',
    zones: [
      Z('Mossy Roots', 'Watch out for monsters', 100, 0x9be564, 0x6b5338, 0x6f8f86, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 4, stairs: 2, pillars: 2, beam: 2, monster: 1, crates: 1, arrows: 1 }),
      Z('Mushroom Grove', 'Bouncy and dangerous', 208, 0xff7eb6, 0x6d4c41, 0x7a7f8f, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { pad: 3, gap: 3, monster: 2, pillars: 1, grapple: 1, arrows: 2, swing: 1 }),
      Z('Hollow Trunk', 'Up through the tree', 316, 0xffc857, 0x5a4330, 0x8a7a5e, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { lift: 2, stairs: 2, door: 1, gap: 2, monster: 1, arrows: 2, mover: 2 }),
      Z('Vine Tangle', 'Swing from the hooks', 424, 0x7cfc00, 0x4a5a3a, 0x5f8a6a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { grapple: 3, beam: 2, bob: 1, monster: 1, gap: 1, swing: 3 }),
      Z('Firefly Canopy', 'Bats in the dark', 532, 0xf9f871, 0x3e5244, 0x34504a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { bats: 3, gap: 2, crumble: 2, mover: 2, monster: 1, arrows: 2 }),
      Z('Thorn Crown', 'Everything bites', 640, 0xff5d5d, 0x574436, 0x7a5a50, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { monster: 3, tilt: 2, gap: 2, door: 1, bats: 1, arrows: 2, swing: 1 }),
      Z('Storm Branches', 'The whole tree sways', 760, 0x8ad4ff, 0x4a4a3a, 0x5a6a70, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { gap: 2, tilt: 3, bob: 2, bats: 2, monster: 1, arrows: 2, swing: 1 }),
      Z('Hornet Heights', 'Do not wake them', 880, 0xffb000, 0x5a4a2a, 0x7a6a48, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { gap: 2, bats: 3, monster: 2, crumble: 2, arrows: 2, grapple: 1, door: 1 }),
      Z('Treetop Sanctum', 'The top of the world', 992, 0xc6ff8f, 0x6a5a44, 0x9ec4a8, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { gap: 2, monster: 2, bats: 1, grapple: 1, crumble: 1, pillars: 1, beam: 1, door: 1, arrows: 2, swing: 2 }),
    ],
  },
  {
    id: 3, key: 'volcano', name: 'Magma Chimney', desc: 'Climb the inside of a giant volcano. Ride lava geysers up and dodge falling rocks.',
    seed: 30517, core: 'crater', pattern: 2, accent: '#ff6a2a', route: 'crater',
    zones: [
      Z('Lava Lake', 'Stand on a vent and ride the eruption', 100, 0xff6a2a, 0x3a2a26, 0x2a0e08, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, pillars: 2, beam: 2, geyser: 2, crumble: 1 }),
      Z('Ash Vents', 'Watch for shadows from above', 208, 0xff9a3d, 0x3d2e28, 0x2a120a, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { gap: 4, geyser: 3, rocks: 2, mover: 2, bob: 1, grapple: 1 }),
      Z('Obsidian Spires', 'Glassy and sharp', 316, 0xb06bff, 0x2a2430, 0x1a0c18, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { pillars: 3, gap: 3, rocks: 2, lift: 2, crumble: 2, door: 1 }),
      Z('Magma Falls', 'Rocks raining down', 424, 0xff4a2a, 0x40261e, 0x2e0c06, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { rocks: 3, gap: 3, swing: 2, geyser: 2, tilt: 1, grapple: 1 }),
      Z('Cinder Bridges', 'Mind the drop', 532, 0xffc23d, 0x3a3026, 0x26140a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { beam: 3, gap: 2, crumble: 3, bob: 2, geyser: 1, door: 1 }),
      Z('Fire Throat', 'Hot, hot, hot', 640, 0xff3a1a, 0x3a1e18, 0x300a04, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { geyser: 3, rocks: 3, mover: 2, gap: 2, lift: 1, grapple: 1 }),
      Z('Pressure Chamber', 'It is about to blow', 760, 0xff2a5a, 0x3a1e22, 0x2a0610, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { geyser: 3, rocks: 2, crumble: 2, gap: 2, bob: 1, lift: 1 }),
      Z('Smoke Stack', 'Climb through the smoke', 880, 0x9a8aa0, 0x34302e, 0x1e1614, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { rocks: 3, geyser: 2, swing: 2, gap: 2, tilt: 1, grapple: 1, door: 1 }),
      Z('Crater Rim', 'Out into the sky', 992, 0xffd76a, 0x4a3a30, 0x1c120c, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { gap: 2, geyser: 2, rocks: 2, crumble: 2, pillars: 1, beam: 1, swing: 1, door: 1 }),
    ],
  },
  {
    id: 4, key: 'city', name: 'Neon Skyline', desc: 'Hop around a ring of skyscrapers on sky bridges and ziplines. Conveyors, drones and laser gates.',
    seed: 64229, core: 'spire', pattern: 1, accent: '#ff4fd8', route: 'towers',
    zones: [
      Z('Harbor Roofs', 'Climb a tower, cross to the next', 100, 0x3fd0ff, 0x2a3040, 0x3a2a4a, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { gap: 5, stairs: 2, beam: 2, conveyor: 2, crates: 1 }),
      Z('Neon Alley', 'Conveyors everywhere', 208, 0xff4fd8, 0x2e2a3e, 0x40284a, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { conveyor: 3, gap: 3, gate: 2, mover: 2, grapple: 1 }),
      Z('Drone Patrol', 'Shoot them down', 316, 0x7cff6a, 0x283440, 0x2a3048, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { bats: 3, gap: 3, conveyor: 2, lift: 2, door: 1 }),
      Z('Billboard Heights', 'Ride the lifts', 424, 0xffb43d, 0x34303a, 0x4a2e3a, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { lift: 3, mover: 3, gap: 2, swing: 1, gate: 1, conveyor: 1 }),
      Z('Sky Gardens', 'Green on the roofs', 532, 0x6aff9e, 0x2c3a34, 0x36344a, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { gap: 3, bob: 2, tilt: 2, crumble: 2, bats: 2, grapple: 1 }),
      Z('Antenna Forest', 'Lasers and wind', 640, 0xa080ff, 0x2a2840, 0x241c3a, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { gate: 3, laser: 2, conveyor: 2, gap: 2, bats: 1, door: 1 }),
      Z('Helipad Deck', 'Choppers overhead', 760, 0x3dffd0, 0x263a3a, 0x1e3040, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { bats: 3, conveyor: 2, gate: 2, gap: 2, lift: 1, grapple: 1 }),
      Z('Glass Canopy', 'Do not look down', 880, 0x9ad8ff, 0x2a3446, 0x22284a, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { gap: 3, gate: 2, laser: 2, crumble: 2, conveyor: 1, bats: 1, door: 1 }),
      Z('Spire Crown', 'The tallest roof in town', 977, 0xffe066, 0x3a3440, 0x2a1e3a, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { gap: 2, conveyor: 2, gate: 2, bats: 2, lift: 1, mover: 1, grapple: 1 }),
    ],
  },
  {
    id: 5, key: 'waterfall', name: 'Waterfall', desc: 'A water paradise round a giant waterfall. Run up water slides, dodge leaping fish and ride the fountains.',
    seed: 41269, core: 'falls', pattern: 2, accent: '#3fe0ff', route: 'spiral',
    zones: [
      Z('Lagoon Beach', 'Splash your way up', 100, 0x3fe0ff, 0xe6dcc0, 0xa6e4f0, [3.0, 4.4], [2.6, 3.6], [1.0, 2.2], { leapingFish: 2, fountainLift: 2, gap: 5, stairs: 2, pillars: 2, beam: 2, crates: 1, bob: 1 }),
      Z('Lily Lagoon', 'Floating pads and jumping fish', 208, 0x7cf0a0, 0xd8eedc, 0xa8e8e0, [2.4, 3.6], [2.2, 3.2], [1.4, 2.6], { leapingFish: 3, lilyPads: 1, fountainLift: 2, gap: 4, bob: 3, pad: 2, mover: 2, grapple: 1, swing: 1 }),
      Z('Bamboo Falls', 'Climb beside the spray', 316, 0x9be564, 0xc8b080, 0x9ed8d8, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { waterSlide: 3, launchSlide: 2, leapingFish: 1, fountainLift: 2, stairs: 2, gap: 3, beam: 2, pillars: 2, door: 1, mover: 2, swing: 1 }),
      Z('Rainbow Mist', 'Lost in the spray', 424, 0xff9ad8, 0xf0e0f0, 0xc8e0f4, [2.0, 3.0], [2.0, 2.8], [1.6, 2.8], { leapingFish: 2, waterSlide: 2, launchSlide: 2, sprinkler: 1, fountainLift: 1, bob: 2, pad: 2, gap: 2, grapple: 1, tilt: 2, spinner: 1, mover: 1 }),
      Z('Slide Park', 'Run up the water slides', 532, 0x3fd0ff, 0xe8f0f4, 0xa8dcf0, [1.8, 3.0], [1.8, 2.8], [1.8, 2.9], { waterSlide: 4, launchSlide: 4, lazyRiver: 2, fountainLift: 1, beam: 2, mover: 2, gap: 2, lift: 2, door: 1, pad: 1 }),
      Z('Coral Grotto', 'Behind the falling water', 640, 0xff7a6a, 0xf0c8b8, 0x90c8d8, [1.7, 2.6], [1.7, 2.4], [1.7, 2.7], { leapingFish: 3, waterSlide: 1, fountainLift: 1, gap: 3, crumble: 2, tilt: 2, grapple: 1, swing: 2, bob: 1 }),
      Z('Fountain Terraces', 'Ride the fountains', 760, 0x6ae0ff, 0xe0e8e8, 0xb0e4f4, [1.6, 2.5], [1.6, 2.4], [1.8, 2.9], { fountainLift: 6, waterSlide: 2, launchSlide: 2, leapingFish: 1, gap: 2, lift: 1, pad: 2, crumble: 2, mover: 2, spinner: 1, door: 1 }),
      Z('Sky Springs', 'Where the water begins', 880, 0xb48cff, 0xe0dcf0, 0xc0d8f8, [1.6, 2.4], [1.5, 2.3], [1.9, 3.0], { leapingFish: 2, waterSlide: 2, fountainLift: 2, gap: 2, bob: 2, tilt: 2, crumble: 2, grapple: 1, swing: 1, lift: 1 }),
      Z('Source of the Falls', 'The top of the waterfall', 992, 0xffe066, 0xf0ecd8, 0xd0ecfa, [1.5, 2.3], [1.5, 2.2], [2.0, 3.0], { waterSlide: 2, launchSlide: 2, leapingFish: 2, fountainLift: 2, gap: 2, lift: 1, spinner: 1, crumble: 2, mover: 1, pillars: 1, beam: 1, tilt: 1, grapple: 1, door: 1 }),
    ],
  },
];
export const ZONES = MAPS[0].zones;

// The angry dummies (jumpers) on each map: name and colours (c body, g band and eyes).
export const JUMPER = {
  storm: { name: 'Storm dummy', look: { c: 0x2a2f3a, g: 0x3ff0d0 } },
  sunny: { name: 'Beach bully', look: { c: 0xd8683a, g: 0xffe066 } },
  forest: { name: 'Wild jumper', look: { c: 0x5a3a24, g: 0x9be564 } },
  volcano: { name: 'Ash brute', look: { c: 0x2a1a16, g: 0xff5a2a } },
  city: { name: 'Street punk', look: { c: 0x2a2440, g: 0xff4fd8 } },
  waterfall: { name: 'Splash bully', look: { c: 0x1a5a8a, g: 0x7fe8ff } },
};

const PR_TOP = 0.6;
const SIGNS = [
  'Climb to the very top. You are tied together: if one falls, everyone feels it.',
  'Jump across the gaps. Stay close: the cord only reaches so far.',
  'Partner slipping? Hold GRAB to clamp on and hold them up.',
  'Hold REEL to pull the cord in and haul a hanging partner up.',
  'While clamped, hold REEL, then let go: you fling your partner upward.',
  'Fall into the ocean and the team restarts from the last checkpoint.',
];

export function cpEnabled(cp, diff) {
  if (cp.start) return true;
  if (diff === 0) return true;
  if (diff === 1) return !!cp.normal;
  return false;
}

export function zoneAt(level, y) {
  for (let i = level.zones.length - 1; i >= 0; i--) if (y >= level.zones[i].y0 - 0.5) return i;
  return 0;
}

export function generateLevel(mapId = 0) {
  const MAP = MAPS[mapId] || MAPS[0], ZONE_LIST = MAP.zones;
  const R = rng(MAP.seed);
  const rr = (a, b) => a + R() * (b - a);
  const out = {
    map: MAP.id, mapKey: MAP.key, core: MAP.core, pattern: MAP.pattern,
    cols: [], rings: [], decor: [], cps: [], fans: [], rods: [], signs: [], crumbles: [], zones: [],
    anchors: [], doors: [], monsters: [], bats: [], lasers: [], arrows: [], swings: [], trees: [], geysers: [], rocks: [], towers: [],
    obs: [], blinks: [], traps: [], bumpers: [], flows: [], jumpers: [],
    plats: 0, spawn: null, summit: null, top: 0,
  };
  const recs = [], buckets = [], usedObs = [], obsZone = [];
  let TAG = 'start';
  let zone = 0, ZD = ZONE_LIST[0], ZW = ZD.tpl, zonePlats = 0, lastY = 2;
  // Route frame: platforms are placed in polar coordinates around (CX, CZ), going round in direction DIR,
  // with centres between BAND.lo (+ half the platform depth) and BAND.hi.
  const ROUTE = MAP.route || 'spiral', MAIN = ROUTE === 'crater' ? { lo: 10.0, hi: 16.5 } : { lo: 7.5, hi: 14.2 };
  let CX = 0, CZ = 0, DIR = ROUTE === 'trees' || ROUTE === 'crater' ? -1 : 1, BAND = MAIN, pathLen = 0, lastP = null;
  const intro = { grapple: false, door: false, monster: false };

  const add = (c, kind, extra) => {
    c.kind = kind; c.zone = zone;
    if (extra) Object.assign(c, extra);
    out.cols.push(c);
    return c;
  };
  const polar = (th, r) => [CX + Math.cos(th) * r, CZ + Math.sin(th) * r];
  const virt = (th, r, y, sx, sz) => {
    const [x, z] = polar(th, r);
    return { th, r, y, sx, sz, x, z, ry: -(th + Math.PI / 2) };
  };
  // Footprints of everything walkable, as oriented rectangles in world space (x, z, half sizes, yaw)
  // with their height and how far along the route they were placed. Bucketed by height for speed.
  // h = clear height needed above it (HEAD for anything you stand on; less for hooks and door frames).
  function recBox(x, z, hx, hz, ry, y, h = HEAD) {
    const q = { x, z, hx, hz, ry, y, h, pl: pathLen, rad: Math.hypot(hx, hz), c: Math.cos(ry), s: Math.sin(ry), tag: TAG };
    recs.push(q);
    const k = Math.max(0, Math.floor(y / 4));
    (buckets[k] || (buckets[k] = [])).push(q);
    return q;
  }
  function rec(p) {
    if (p.x !== undefined && p.ry !== undefined) return recBox(p.x, p.z, p.sx / 2, p.sz / 2, p.ry, p.y);
    const [x, z] = polar(p.th, p.r);
    return recBox(x, z, p.sx / 2, p.sz / 2, -(p.th + Math.PI / 2), p.y);
  }

  // How much higher than y a new footprint must go to clear everything placed earlier on the route that
  // it overlaps from above: it must sit q.h above anything below it, and HEAD below anything above it.
  // (The last few metres of route are its own neighbours and are skipped.) Negative = no conflict.
  const RECENT = 14;
  function need(x, z, hx, hz, ry, y) {
    let m = -1e9;
    const a = { x, z, hx, hz, c: Math.cos(ry), s: Math.sin(ry), rad: Math.hypot(hx, hz) };
    const k1 = Math.min(buckets.length - 1, Math.floor((y + HEAD) / 4) + 1);
    for (let k = Math.max(0, Math.floor((y - HEAD) / 4)); k <= k1; k++) {
      const B = buckets[k];
      if (!B) continue;
      for (const q of B) {
        if (q.y + q.h <= y || q.y - y >= HEAD || q.y + q.h <= m || q.pl > pathLen - RECENT) continue;
        const dx = q.x - x, dz = q.z - z, rr2 = q.rad + a.rad + 0.3;
        if (dx * dx + dz * dz > rr2 * rr2 || !overlap(a, q, 0.3)) continue;
        m = q.y + q.h;
      }
    }
    return m - y;
  }
  const needAt = (th, r, sx, sz, y) => { const [x, z] = polar(th, r); return need(x, z, sx / 2, sz / 2, -(th + Math.PI / 2), y); };

  function plat(th, r, y, sx, sz, o = {}) {
    const t = o.thick || 0.7;
    const [x, z] = polar(th, r);
    const ry = -(th + Math.PI / 2) + (o.dry || 0);
    // Last-moment fix: lift a platform a little if it would sit too close under or over older route.
    if (!o.norec) { const nd = need(x, z, sx / 2, sz / 2, ry, y); if (nd > 0 && nd <= 0.6) y += nd; }
    const surf = o.surf !== undefined ? o.surf : ZD.ice ? 'ice' : null;
    const c = add(makeBox(x, y - t / 2, z, sx / 2, t / 2, sz / 2, 0, ry, 0), o.kind || 'plat', { surf });
    if (o.look) c.look = o.look;
    const p = { th, r, y, sx, sz, x, z, ry, col: c };
    if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
    lastP = p;
    lastY = y;
    if (!o.norec) rec(p);
    out.plats++;
    zonePlats++;
    if (zone === 0 && !o.nosign) maybeSign(p);
    return p;
  }

  function maybeSign(p) {
    const at = { 2: 1, 6: 2, 11: 3, 16: 4, 22: 5 }[zonePlats];
    if (at === undefined) return;
    sign(p, SIGNS[at]);
  }

  function sign(p, text) {
    const [ox, oz] = polar(p.th, p.r + p.sz / 2 + 0.8);
    out.signs.push({ x: ox, y: p.y + 2.4, z: oz, text });
  }

  function support(p, ux, uz) {
    const ax = Math.cos(p.ry), az = -Math.sin(p.ry), bx = Math.sin(p.ry), bz = Math.cos(p.ry);
    return (Math.abs(ux * ax + uz * az) * p.sx) / 2 + (Math.abs(ux * bx + uz * bz) * p.sz) / 2;
  }
  function gapTo(a, th, r, sx, sz) {
    const b = virt(th, r, 0, sx, sz);
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    return d - support(a, dx / d, dz / d) - support(b, dx / d, dz / d);
  }
  // Angle for the next platform so the edge-to-edge gap along the line between centres is g.
  function thetaFor(a, g, r, sx, sz) {
    let lo = 0.01, hi = 2.2;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (gapTo(a, a.th + DIR * mid, r, sx, sz) < g) lo = mid;
      else hi = mid;
    }
    return a.th + DIR * (lo + hi) / 2;
  }
  // Near the summit everything stays outside the summit disc's footprint.
  const finalStretch = () => zone === ZONE_LIST.length - 1 && lastY > ZD.y1 - 18;
  const rLo = (sz) => (finalStretch() && BAND === MAIN ? 10.4 + sz / 2 : BAND.lo + sz / 2);
  const nextR = (cur, sz) => clamp(cur.r + rr(-1.6, 1.6), rLo(sz), Math.max(rLo(sz), BAND.hi));
  const size = () => [rr(ZD.sx[0], ZD.sx[1]), rr(ZD.sz[0], ZD.sz[1])];
  const between = (a, b, inset) => {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const sa = support(a, ux, uz) - inset, sb = support(b, ux, uz) - inset;
    return { ax: a.x + ux * sa, az: a.z + uz * sa, bx: b.x - ux * sb, bz: b.z - uz * sb, ux, uz, ry: Math.atan2(-uz, ux) };
  };

  // Switchback lanes (sunny) and side trees (forest).
  const LANES = { inner: { lo: 7.6, hi: 10.0 }, outer: { lo: 12.6, hi: 15.6 } };
  const SAT_D = 27, SAT_TR = 2.6;
  // City: five skyscrapers in a ring round the central spire; the route climbs round one, crosses to the next.
  const TOWERS = [], TW = 4.2, TBAND = { lo: TW * Math.SQRT2 + 1.3, hi: TW * Math.SQRT2 + 5.2 };
  let tower = -1, visitStart = 0, visitLaps = 1;
  if (ROUTE === 'towers') {
    for (let k = 0; k < 5; k++) {
      const a = 0.45 + (k / 5) * TAU, x = Math.cos(a) * 28, z = Math.sin(a) * 28;
      TOWERS.push({ x, z, a, half: TW });
    }
    out.towers = TOWERS;
  }
  function newVisit(p) { visitStart = p.th; visitLaps = rr(0.75, 1.05); }
  let legStart = 0, legLen = 0, legN = 0, sinceTurn = 99;
  function newLeg(p) {
    legStart = p.th;
    legLen = (legN % 2 ? 1.9 : 2.7) + rr(-0.2, 0.2);
    legN++;
    sinceTurn = 0;
  }
  // Re-express a placed platform in the current route frame.
  function reframe(p) {
    const th0 = Math.atan2(p.z - CZ, p.x - CX);
    return Object.assign({}, p, { th: th0, r: Math.hypot(p.x - CX, p.z - CZ) });
  }
  // Stepping platforms in a straight line from cur to a landing at (tx, tz), rising to height ty.
  function walkTo(cur, tx, tz, ty) {
    const dx = tx - cur.x, dz = tz - cur.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, ry = Math.atan2(-uz, ux);
    let at = cur, y = cur.y;
    const left = () => Math.hypot(tx - at.x, tz - at.z);
    for (let n = 0; n < 14; n++) {
      // The landing (3 x 3) comes once the gap to it is jumpable and the height has been reached.
      const gapToLanding = left() - support(at, ux, uz) - 1.5, last = gapToLanding < 2.0 && ty - y < 1.1;
      const s = last ? 3.0 : rr(2.0, 2.5), g = rr(1.4, 1.9), off = support(at, ux, uz) + g + s / 2;
      // Out of room but still too low: step sideways-up in place (a little staircase) before going on.
      const climb = !last && left() - off < 3.5;
      const x = last ? tx : climb ? at.x - uz * (s + g) * (n % 2 ? 1 : -1) * 0.5 + ux * 0.2 : at.x + ux * off;
      const z = last ? tz : climb ? at.z + ux * (s + g) * (n % 2 ? 1 : -1) * 0.5 + uz * 0.2 : at.z + uz * off;
      const remain = Math.max(1, Math.ceil(left() / 4.2));
      y = last ? Math.max(y - 0.4, Math.min(y + 1.05, ty)) : Math.min(y + 1.05, y + Math.max(-0.4, climb ? 1.0 : (ty - y) / remain));
      const nd = need(x, z, s / 2, s / 2, ry, y);
      if (nd > 0 && nd <= 0.6) y += nd;
      const t = 0.7, c = add(makeBox(x, y - t / 2, z, s / 2, t / 2, s / 2, 0, ry, 0), 'branch', { surf: null });
      at = { x, z, y, sx: s, sz: s, ry, col: c, th: 0, r: 0 };
      if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
      recBox(x, z, s / 2, s / 2, ry, y);
      lastP = at;
      lastY = y;
      out.plats++;
      zonePlats++;
      if (last) break;
    }
    return at;
  }

  // ---------- obstacle mechanics ----------
  const obPush = (o, e) => { out.obs.push(Object.assign({ i: out.obs.length, key: o.key, name: o.name, prim: o.prim, lvl: o.lvl, look: o.look, zone }, e)); };
  const wide = (cur, a, b) => T.gap(cur, { size: [rr(a[0], a[1]), rr(b[0], b[1])], g: rr(1.3, 1.9), dy: rr(-0.2, 0.5) });
  const axes = (p) => ({ ax: Math.cos(p.ry), az: -Math.sin(p.ry), bx: Math.sin(p.ry), bz: Math.cos(p.ry) });
  const OB = {
    sweep(cur, o) {
      const p = wide(cur, [4.6, 5.4], [3.8, 4.4]);
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.18, 0.3), 'post');
      obPush(o, { x: p.x, y: p.y + 0.5, z: p.z, len: Math.min(p.sx, p.sz) / 2 + 0.2, n: o.n || 1, per: rr(2.6, 3.6) * (R() < 0.5 ? 1 : -1), ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    pendulum(cur, o) {
      const nxt = T.beam(cur, { len: rr(6, 7.5), w: 1.1, rise: rr(0, 0.4) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2, L = o.look.big ? 2.75 : 2.55;
      obPush(o, { x: mx, y: my + 0.6 + L, z: mz, fy: my, nx: -b.uz, nz: b.ux, L, r: o.look.big ? 0.72 : 0.55, amp: 1.05, per: rr(2.4, 3.2), ph: R() });
      return nxt;
    },
    slider(cur, o) {
      const ram = o.look.s === 'ram', p = ram ? wide(cur, [4.2, 5.0], [3.0, 3.4]) : wide(cur, [6.0, 7.0], [2.4, 2.8]), A = axes(p);
      const r = o.look.s === 'ball' ? 0.55 : o.look.s === 'disc' ? 0.6 : 0.38;
      if (ram) obPush(o, { shape: 'ram', x: p.x, y: p.y, z: p.z, ux: A.ax, uz: A.az, vx: A.bx, vz: A.bz, a: -(p.sz / 2 + 0.35), b: p.sz * 0.2, len: 1.3, per: rr(2.8, 3.6), ph: R(), ry: p.ry });
      else obPush(o, { shape: o.look.s, x: p.x, y: p.y, z: p.z, ux: A.ax, uz: A.az, a: -(p.sx / 2 - 0.8), b: p.sx / 2 - 0.8, r, w: p.sz * 0.92, per: rr(3.0, 4.2), ph: R(), ry: p.ry });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    crusher(cur, o) {
      const p = wide(cur, [4.2, 5.0], [3.2, 3.8]), A = axes(p), n = p.sx > 4.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const off = n === 1 ? 0 : (k - 0.5) * 2.1;
        obPush(o, { x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hs: 0.85, per: rr(3.0, 3.8), ph: k * 0.5 + R() * 0.1, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    spikes(cur, o) {
      const p = wide(cur, [4.2, 5.0], [3.2, 3.8]), A = axes(p);
      for (const k of [-1, 1]) {
        const off = k * p.sx / 4;
        obPush(o, { x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hx: p.sx / 4 - 0.15, hz: p.sz / 2 - 0.3, ry: p.ry, per: rr(2.6, 3.4), ph: k < 0 ? 0 : 0.5, duty: 0.45 });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    jet(cur, o) {
      const nxt = T.beam(cur, { len: rr(6, 7.5), w: 1.1, rise: rr(0, 0.5) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2;
      let nx = -b.uz, nz = b.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
      const ex = mx + nx * 2.3, ez = mz + nz * 2.3;
      add(makeCyl(ex, my - 0.3, ez, 0.16, 0.9), 'post');
      obPush(o, { x: ex, y: my + 0.75, z: ez, dx: -nx, dz: -nz, range: 4.6, per: rr(2.6, 3.4), ph: R(), duty: 0.45 });
      return nxt;
    },
    blink(cur, o) {
      for (let k = 0; k < 4; k++) {
        const s2 = rr(1.8, 2.2), r = nextR(cur, s2);
        cur = plat(thetaFor(cur, rr(1.2, 1.7), r, s2, s2), r, cur.y + rr(-0.1, 0.5), s2, s2, { kind: 'blink', look: o.look });
        cur.col.blink = { per: 3.6, ph: k * 0.27, duty: 0.64, lvl: o.lvl, key: o.key };
        out.blinks.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    trapdoor(cur, o) {
      for (let k = 0; k < 2; k++) {
        const [sx, sz] = [rr(2.6, 3.2), rr(2.4, 2.8)], r = nextR(cur, sz);
        cur = plat(thetaFor(cur, rr(1.2, 1.7), r, sx, sz), r, cur.y + rr(-0.1, 0.5), sx, sz, { kind: 'trap', look: o.look });
        cur.col.trap = { per: rr(3.6, 4.4), ph: k * 0.5, open: 1.3, lvl: o.lvl, key: o.key };
        out.traps.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    turntable(cur, o) {
      const s2 = rr(3.4, 3.8), r = Math.max(nextR(cur, s2 * 1.42), BAND.lo + s2 * 0.71);
      const p = plat(thetaFor(cur, rr(1.4, 1.9), r, s2 * 1.42, s2 * 1.42), r, cur.y + rr(-0.1, 0.4), s2, s2, { kind: 'turn', look: o.look, surf: null });
      p.col.dyn = { k: 'turn', a0: p.ry, w: rr(0.6, 1.0) * (R() < 0.5 ? 1 : -1) };
      recBox(p.x, p.z, s2 * 0.72, s2 * 0.72, 0, p.y);
      return T.gap(Object.assign({}, p, { sx: s2 * 1.42, sz: s2 * 1.42 }), { g: rr(1.3, 1.8) });
    },
    bumpers(cur, o) {
      const p = wide(cur, [4.6, 5.4], [3.8, 4.4]), A = axes(p), n = 2 + (R() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const u = (k / (n - 1) - 0.5) * (p.sx - 1.6), v = (k % 2 ? 1 : -1) * (p.sz / 2 - 1.1);
        const x = p.x + A.ax * u + A.bx * v, z = p.z + A.az * u + A.bz * v;
        add(makeCyl(x, p.y + 0.45, z, 0.45, 0.45), 'bumper', { look: o.look });
        out.bumpers.push({ x, y: p.y, z, r: 0.45, lvl: o.lvl, key: o.key, look: o.look });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    wind(cur, o) {
      const nxt = T.beam(cur, { len: rr(6, 7.5), w: 1.0, rise: rr(0, 0.5) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2;
      let nx = -b.uz, nz = b.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) > 0) { nx = -nx; nz = -nz; }
      const fx = mx - nx * 2.6, fz = mz - nz * 2.6;
      add(makeCyl(fx, my - 0.2, fz, 0.2, 0.9), 'post');
      const reg = makeBox(mx, my + 1.4, mz, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 0.4, 2.0, 1.4, 0, b.ry, 0);
      out.fans.push({ x: fx, y: my + 1.4, z: fz, dx: nx, dz: nz, th: Math.atan2(nz, nx), reach: 5, reg, per: rr(4.4, 5.6), ph: R(), str: 30, lvl: o.lvl, key: o.key });
      return nxt;
    },
    mud(cur, o) {
      for (let k = 0; k < 2; k++) cur = T.gap(cur, { size: [rr(3.2, 4.2), rr(2.6, 3.2)], g: rr(1.2, 1.7), dy: rr(-0.2, 0.5), surf: 'mud', look: o.look });
      return cur;
    },
    slick(cur, o) {
      for (let k = 0; k < 2; k++) cur = T.gap(cur, { size: [rr(3.2, 4.2), rr(2.6, 3.2)], g: rr(1.2, 1.7), dy: rr(-0.2, 0.5), surf: 'ice', look: o.look });
      return cur;
    },
    // ---------- endgame: harder combinations near the top ----------
    gauntlet(cur, o) {
      const nxt = T.beam(cur, { len: rr(8.5, 9.5), w: 1.1, rise: rr(0, 0.3) });
      const b = between(cur, nxt, 0.25), L = o.look.big ? 2.75 : 2.55, per = rr(2.2, 2.8);
      [1 / 3, 2 / 3].forEach((f, k) => {
        const fy = cur.y + (nxt.y - cur.y) * f;
        obPush(o, { prim: 'pendulum', x: b.ax + (b.bx - b.ax) * f, y: fy + 0.6 + L, z: b.az + (b.bz - b.az) * f, fy, nx: -b.uz, nz: b.ux, L, r: o.look.big ? 0.7 : 0.58, amp: 1.1, per, ph: k * 0.5 });
      });
      return nxt;
    },
    checker(cur, o) {
      const s2 = rr(4.4, 4.8), p = wide(cur, [s2, s2], [s2, s2]), A = axes(p), per = rr(2.4, 2.8);
      for (const i of [-1, 1]) for (const j of [-1, 1]) {
        const u = (i * p.sx) / 4, v = (j * p.sz) / 4;
        obPush(o, { prim: 'spikes', x: p.x + A.ax * u + A.bx * v, y: p.y, z: p.z + A.az * u + A.bz * v, hx: p.sx / 4 - 0.12, hz: p.sz / 4 - 0.12, ry: p.ry, per, ph: i * j > 0 ? 0 : 0.5, duty: 0.5 });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    beamroll(cur, o) {
      const nxt = T.beam(cur, { len: rr(8, 9), w: 1.1, rise: 0 });
      const b = between(cur, nxt, 0.25), half = Math.hypot(b.bx - b.ax, b.bz - b.az) / 2, sh = o.look.s;
      obPush(o, { prim: 'slider', shape: sh, x: (b.ax + b.bx) / 2, y: cur.y, z: (b.az + b.bz) / 2, ux: b.ux, uz: b.uz, a: -(half - 0.4), b: half - 0.4,
        r: sh === 'ball' ? 0.5 : sh === 'disc' ? 0.6 : 0.36, w: 1.3, per: rr(2.8, 3.4), ph: R(), ry: b.ry });
      return nxt;
    },
    crushrow(cur, o) {
      const p = wide(cur, [6.6, 7.2], [2.5, 2.7]), A = axes(p), per = rr(2.6, 3.0);
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 2.2;
        obPush(o, { prim: 'crusher', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hs: 0.85, per, ph: k / 3, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    crossfire(cur, o) {
      const nxt = T.beam(cur, { len: rr(7.5, 8.5), w: 1.0, rise: rr(0, 0.4) });
      const b = between(cur, nxt, 0.25), per = rr(2.4, 2.8);
      [1 / 3, 2 / 3].forEach((f, k) => {
        const mx = b.ax + (b.bx - b.ax) * f, mz = b.az + (b.bz - b.az) * f, my = cur.y + (nxt.y - cur.y) * f;
        let nx = -b.uz, nz = b.ux;
        if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
        const ex = mx + nx * 2.3, ez = mz + nz * 2.3;
        add(makeCyl(ex, my - 0.3, ez, 0.16, 0.9), 'post');
        obPush(o, { prim: 'jet', x: ex, y: my + 0.75, z: ez, dx: -nx, dz: -nz, range: 4.6, per, ph: k * 0.5, duty: 0.5 });
      });
      return nxt;
    },
    spinsweep(cur, o) {
      const s2 = rr(3.6, 4.0), r = Math.max(nextR(cur, s2 * 1.42), BAND.lo + s2 * 0.71);
      const p = plat(thetaFor(cur, rr(1.4, 1.9), r, s2 * 1.42, s2 * 1.42), r, cur.y + rr(-0.1, 0.4), s2, s2, { kind: 'turn', look: o.look, surf: null });
      const w = rr(0.6, 0.9) * (R() < 0.5 ? 1 : -1);
      p.col.dyn = { k: 'turn', a0: p.ry, w };
      recBox(p.x, p.z, s2 * 0.72, s2 * 0.72, 0, p.y);
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.18, 0.3), 'post');
      obPush(o, { prim: 'sweep', x: p.x, y: p.y + 0.5, z: p.z, len: s2 * 0.62, n: 2, per: rr(2.4, 3.0) * -Math.sign(w), ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      return T.gap(Object.assign({}, p, { sx: s2 * 1.42, sz: s2 * 1.42 }), { g: rr(1.3, 1.8) });
    },
    // ---------- waterfall ----------
    // A water slide up to the next platform, with water rushing down it (it pushes you back).
    slide(cur, o) {
      // Steep, the water shoves you back down hard, and inner tubes come riding the water at you: jump them.
      const nxt = T.beam(cur, { len: rr(6, 7), w: rr(1.3, 1.5), rise: rr(2.0, 2.6), surf: null });
      const c = nxt.bridge;
      c.kind = 'slide'; c.flow = 1; c.look = o.look;
      c.conv = { sp: -rr(3.3, 3.8) };
      out.flows.push(c);
      const b = between(cur, nxt, 0.25), blen = Math.hypot(b.bx - b.ax, b.bz - b.az), half = blen / 2;
      obPush(o, { prim: 'slider', shape: 'tube', one: 1, x: (b.ax + b.bx) / 2, y: (cur.y + nxt.y) / 2, z: (b.az + b.bz) / 2, ux: b.ux, uz: b.uz,
        a: -(half - 0.3), b: half - 0.3, slope: (nxt.y - cur.y) / blen, r: 0.42, w: 1.0, per: rr(2.0, 2.6), ph: R(), ry: b.ry, name: 'Inner tube' });
      return nxt;
    },
    // A launch slide: whoosh down a steep chute and fly off the kicker at the bottom onto a higher ledge.
    flume(cur, o) {
      const nxt = T.beam(cur, { len: rr(7, 8), w: 1.5, rise: -rr(2.0, 2.6), surf: 'ice' });
      const c = nxt.bridge;
      c.kind = 'slide'; c.flow = 1; c.look = o.look;
      c.conv = { sp: rr(6.5, 7.5) };
      out.flows.push(c);
      const kick = nxt.col, s2 = rr(3.5, 3.9), r2 = nextR(nxt, s2);
      const land = plat(thetaFor(nxt, rr(5.5, 6.5), r2, s2, s2), r2, nxt.y + rr(3.0, 3.6), s2, s2);
      const dx = land.x - nxt.x, dz = land.z - nxt.z, dist = Math.hypot(dx, dz);
      // The throw is aimed from wherever you touch the kicker at the middle of the ledge (player.js).
      kick.launch = { x: land.x, y: land.y, z: land.z, vy: 14 };
      kick.kind = 'kicker'; kick.look = o.look;
      // Keep the flight path clear of anything built later.
      recBox((nxt.x + land.x) / 2, (nxt.z + land.z) / 2, dist / 2 + 0.5, 1.4, Math.atan2(-dz / dist, dx / dist), nxt.y, 7.5);
      return land;
    },
    // A jumper: an angry dummy on a wide ledge who runs at you and jump kicks you off.
    jumper(cur, o) {
      const p = wide(cur, [5.0, 5.8], [4.2, 4.8]);
      out.jumpers.push({ i: out.jumpers.length, x: p.x, y: p.y, z: p.z, hx: p.sx / 2 - 0.45, hz: p.sz / 2 - 0.45, ry: p.ry, zone, lvl: o.lvl, name: o.name, look: o.look });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // Fish leaping in an arc across a bridge, two of them taking turns.
    leap(cur, o) {
      const nxt = T.beam(cur, { len: rr(6.5, 7.5), w: 1.0, rise: rr(0, 0.5) });
      const b = between(cur, nxt, 0.25);
      [0.35, 0.68].forEach((f, k) => {
        const fy = cur.y + (nxt.y - cur.y) * f;
        obPush(o, { x: b.ax + (b.bx - b.ax) * f, y: fy, z: b.az + (b.bz - b.az) * f, fy, nx: -b.uz, nz: b.ux, span: 2.6, h: rr(0.8, 1.0), dur: 1.1,
          per: rr(2.4, 3.2), ph: k * 0.5 + R() * 0.1, dir: k % 2 ? -1 : 1 });
      });
      return nxt;
    },
    // A lazy river: a wide platform whose water carries you sideways, usually toward the drop.
    current(cur, o) {
      const p = wide(cur, [4.6, 5.4], [3.4, 4.0]), A = axes(p), c = p.col;
      const outward = A.bx * (p.x - CX) + A.bz * (p.z - CZ) > 0 ? 1 : -1;
      c.kind = 'current'; c.flow = 1; c.look = o.look;
      c.conv = { sp: outward * (R() < 0.75 ? 1 : -1) * rr(1.6, 2.2), side: 1 };
      out.flows.push(c);
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    drop: (cur, o) => T.rocks(cur, o),
    shooter: (cur, o) => T.arrows(cur, o),
    flyer: (cur, o) => T.bats(cur, o),
    vent: (cur, o) => T.geyser(cur, o),
    gate: (cur, o) => T.gate(cur, o),
  };
  // Mechanics that fit round a small side tree (no long bridges).
  const SMALL_OK = new Set(['sweep', 'crusher', 'spikes', 'turntable', 'bumpers', 'mud', 'slick', 'drop', 'trapdoor', 'vent', 'blink', 'checker', 'spinsweep']);

  // ---------- templates ----------
  const T0 = {
    gap(cur, o = {}) {
      const [sx, sz] = o.size || size();
      const g = o.g !== undefined ? o.g : rr(ZD.gap[0], ZD.gap[1]);
      const dy = o.dy !== undefined ? o.dy : g > 2.3 ? rr(-0.5, 0.55) : rr(-0.3, 1.15);
      const r = nextR(cur, sz);
      return plat(thetaFor(cur, g, r, sx, sz), r, cur.y + dy, sx, sz, o);
    },
    stairs(cur, n = 3 + ((R() * 3) | 0)) {
      for (let i = 0; i < n; i++) {
        const sx = rr(1.6, 2.1), sz = rr(1.9, 2.5);
        const r = clamp(cur.r + rr(-0.7, 0.7), Math.max(BAND.lo + 1.9, rLo(sz)), Math.max(BAND.lo + 1.9, BAND.hi - 0.4));
        cur = plat(thetaFor(cur, rr(0.6, 1.1), r, sx, sz), r, cur.y + rr(0.9, 1.1), sx, sz);
      }
      return cur;
    },
    pillars(cur) {
      const n = 3 + ((R() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const rad = rr(0.6, 0.9), r = nextR(cur, rad * 2);
        const th = thetaFor(cur, rr(1.2, 2.1), r, rad * 2, rad * 2), y = cur.y + rr(-0.3, 0.8);
        const [x, z] = polar(th, r);
        const c = add(makeCyl(x, y - 3, z, rad, 3), 'pillar', { surf: ZD.ice ? 'ice' : null });
        cur = { th, r, y, sx: rad * 2, sz: rad * 2, x, z, ry: -(th + Math.PI / 2), col: c };
        if (lastP) pathLen += Math.hypot(x - lastP.x, z - lastP.z);
        lastP = cur;
        lastY = y;
        rec(cur);
        out.plats++;
      }
      return T.gap(cur, { g: rr(1.2, 2.0) });
    },
    beam(cur, o = {}) {
      const len = o.len || rr(5, 7.5), w = o.w || (ZD.ice ? 0.85 : rr(0.55, 0.75)), rise = o.rise !== undefined ? o.rise : rr(0, 1.6);
      const [sx, sz] = size();
      const r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, len, r, sx, sz), r, cur.y + rise, sx, sz);
      const b = between(cur, nxt, 0.25);
      const blen = Math.hypot(b.bx - b.ax, b.bz - b.az), dy = nxt.y - cur.y;
      const slope = Math.atan2(dy, blen), l3 = Math.hypot(blen, dy);
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2;
      // Box centre sits 0.2 below the walking surface along the beam's own up axis.
      const c = makeBox(mx - Math.sin(slope) * 0.2 * -b.ux, my - Math.cos(slope) * 0.2, mz - Math.sin(slope) * 0.2 * -b.uz,
        l3 / 2, 0.2, w / 2, 0, b.ry, slope);
      add(c, 'beam', { surf: o.surf !== undefined ? o.surf : ZD.ice ? 'ice' : null });
      recBox(mx, mz, blen / 2, w / 2 + 0.2, b.ry, Math.max(cur.y, nxt.y));
      nxt.bridge = c;
      return nxt;
    },
    crates(cur) {
      const p = T.gap(cur, { size: [rr(3.8, 4.6), rr(3.0, 3.6)] });
      const n = 1 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const s = rr(0.9, 1.2), ox = rr(-p.sx / 2 + 0.7, p.sx / 2 - 0.7), oz = rr(-p.sz / 2 + 0.7, p.sz / 2 - 0.7);
        const ax = Math.cos(p.ry), az = -Math.sin(p.ry), bx = Math.sin(p.ry), bz = Math.cos(p.ry);
        add(makeBox(p.x + ax * ox + bx * oz, p.y + s / 2, p.z + az * ox + bz * oz, s / 2, s / 2, s / 2, 0, p.ry + rr(-0.4, 0.4), 0), 'crate');
      }
      return p;
    },
    mover(cur) {
      const [sx, sz] = size();
      const r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(6.5, 9.0), r, sx, sz), r, cur.y + rr(-0.4, 0.8), sx, sz);
      const b = between(cur, nxt, -1.3);
      const c = makeBox(b.ax, cur.y - 0.3, b.az, 1.1, 0.3, 1.1, 0, b.ry, 0);
      c.dyn = { k: 'pp', ax: b.ax, ay: cur.y - 0.3, az: b.az, bx: b.bx, by: nxt.y - 0.3, bz: b.bz, per: rr(5.5, 7.5), ph: R() };
      add(c, 'mover', { surf: ZD.ice ? 'ice' : null });
      recBox((b.ax + b.bx) / 2, (b.az + b.bz) / 2, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 1.1, 1.1, b.ry, Math.max(cur.y, nxt.y));
      return nxt;
    },
    spinner(cur) {
      const armL = rr(3.4, 4.0), [sx, sz] = size(), r = Math.max(nextR(cur, sz), CORE_R + armL + 1.6);
      const nxt = plat(thetaFor(cur, 2 * (armL + 0.85), r, sx, sz), r, cur.y + rr(-0.3, 0.5), sx, sz);
      const b = between(cur, nxt, 0);
      const hx = (b.ax + b.bx) / 2, hz = (b.az + b.bz) / 2, hy = (cur.y + nxt.y) / 2;
      add(makeCyl(hx, hy - 0.3, hz, 0.9, 0.3), 'hub');
      const per = rr(8, 11) * (R() < 0.5 ? 1 : -1), arms = 3;
      for (let i = 0; i < arms; i++) {
        const c = makeBox(hx, hy - 0.25, hz, armL / 2, 0.25, 0.5);
        c.dyn = { k: 'orbit', hx, hy: hy - 0.25, hz, off: armL / 2 + 0.5, a0: (i * TAU) / arms, per };
        add(c, 'arm', { surf: ZD.ice ? 'ice' : null });
      }
      recBox(hx, hz, armL + 0.5, armL + 0.5, 0, hy);
      return nxt;
    },
    fan(cur) {
      const nxt = T.beam(cur, { len: rr(6, 8), w: 1.25, rise: rr(0, 0.6) });
      const thm = (cur.th + nxt.th) / 2, ym = (cur.y + nxt.y) / 2;
      const b = between(cur, nxt, 0.25);
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, rm = Math.hypot(mx, mz);
      const [fx, fz] = polar(thm, CORE_R + 0.5);
      const reg = makeBox(mx + (mx / rm) * 1.2, ym + 1.6, mz + (mz / rm) * 1.2, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 0.5, 2.4, 3.2, 0, b.ry, 0);
      out.fans.push({ x: fx, y: ym + 1.5, z: fz, dx: Math.cos(thm), dz: Math.sin(thm), th: thm, reach: rm + 4 - CORE_R, reg, per: rr(4.6, 6), ph: R(), str: 30 });
      return nxt;
    },
    rods(cur) {
      const n = 2 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const sx = rr(2.8, 3.4), sz = rr(2.6, 3.0), r = nextR(cur, sz);
        cur = plat(thetaFor(cur, rr(ZD.gap[0], ZD.gap[1] - 0.3), r, sx, sz), r, cur.y + rr(-0.2, 1.0), sx, sz);
        const [x, z] = polar(cur.th, r + sz / 2 - 0.35);
        add(makeCyl(x, cur.y + 1.6, z, 0.14, 1.6), 'rod');
        out.rods.push({ x, y: cur.y, z, h: 3.2, per: rr(6, 8), ph: R(), rad: 3.4, zone });
      }
      return cur;
    },
    pad(cur) {
      const r = clamp(cur.r + rr(-0.6, 0.6), BAND.lo + 1.9, Math.max(BAND.lo + 1.9, BAND.hi - 0.6));
      const pad = plat(thetaFor(cur, rr(0.8, 1.3), r, 1.7, 1.7), r, cur.y + rr(-0.2, 0.3), 1.7, 1.7, { surf: 'pad', kind: 'pad' });
      return T.gap(pad, { g: rr(1.2, 2.0), dy: rr(4.0, 5.0) });
    },
    lift(cur, h, flip) {
      const H = h ? Math.max(5, h) : rr(5, 8), s = 2.4, r = clamp(cur.r + rr(-0.5, 0.5), BAND.lo + 2.1, Math.max(BAND.lo + 2.1, BAND.hi - 0.8));
      const th = thetaFor(cur, 0.7, r, s, s);
      const [x, z] = polar(th, r), ry = -(th + Math.PI / 2);
      const c = makeBox(x, cur.y - 0.3, z, s / 2, 0.3, s / 2, 0, ry, 0);
      c.dyn = { k: 'pp', ax: x, ay: cur.y - 0.3, az: z, bx: x, by: cur.y + H - 0.3, bz: z, per: rr(6, 8), ph: R() };
      add(c, 'lift', { surf: ZD.ice ? 'ice' : null });
      out.decor.push({ k: 'cage', x, z, y0: cur.y - 1, y1: cur.y + H + 1.5, s: s + 0.5, ry });
      const top = { th, r, y: cur.y + H, sx: s, sz: s, x, z, ry };
      rec(top);
      if (flip) DIR = -DIR;
      return T.gap(top, { g: rr(0.9, 1.5), dy: rr(-0.2, 0.4) });
    },
    crumble(cur) {
      const n = 3 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const s = rr(1.5, 1.9), r = nextR(cur, s);
        cur = plat(thetaFor(cur, rr(1.3, 2.1), r, s, s), r, cur.y + rr(-0.2, 0.7), s, s, { kind: 'crumble' });
        cur.col.crumble = { st: 0, t: 0, i: out.crumbles.length };
        out.crumbles.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 2.0) });
    },
    tilt(cur) {
      for (let i = 0; i < 2; i++) {
        cur = T.gap(cur, { size: [rr(3.0, 3.6), rr(2.2, 2.6)], g: rr(1.5, 2.4), dy: rr(-0.2, 0.7) });
        cur.col.dyn = { k: 'tilt', ax: R() < 0.5 ? 'x' : 'z', amp: rr(0.18, 0.3), per: rr(4.5, 6.5), ph: R() };
        cur.col.kind = 'tilt';
      }
      return cur;
    },
    bob(cur) {
      for (let i = 0; i < 3; i++) {
        const sx = rr(1.7, 2.6), sz = rr(1.7, 2.4), r = nextR(cur, sz), amp = rr(0.7, 1.2);
        cur = plat(thetaFor(cur, rr(1.5, 2.1), r, sx, sz), r, cur.y + rr(-0.1, 0.6), sx, sz,
          { kind: 'bob', thick: rr(0.9, 1.6), dry: rr(-0.4, 0.4), surf: ZD.ice ? 'ice' : null });
        cur.col.dyn = { k: 'bob', y0: cur.col.y, amp, per: rr(4, 6.5), ph: R(), roll: rr(0.04, 0.09) };
        recs[recs.length - 1].y += amp;
      }
      return T.gap(cur, { g: rr(1.5, 2.0), dy: rr(-0.4, 0.4) });
    },
    // A gap too wide to jump, with a hook above it: GRAPPLE zips you up and flings you across.
    grapple(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(8.5, 11), r, sx, sz), r, cur.y + rr(0.5, 3), sx, sz, { nosign: true });
      const b = between(cur, nxt, 0);
      const ax = (b.ax + b.bx) / 2, az = (b.az + b.bz) / 2, ay = Math.max(cur.y, nxt.y) + rr(5, 6.5);
      out.anchors.push({ i: out.anchors.length, x: ax, y: ay, z: az, tx: nxt.x, ty: nxt.y + PR_TOP, tz: nxt.z, zone });
      recBox(ax, az, 1, 1, 0, ay + 1.6, 2.2);
      if (zone === 0 && !intro.grapple) { intro.grapple = true; sign(cur, 'See a glowing hook? Tap GRAPPLE to zip up and fly across.'); }
      return nxt;
    },
    // A narrow bridge blocked by a door. Shoot the round target to open it for the whole team.
    door(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(6.5, 8), r, sx, sz), r, cur.y, sx, sz, { nosign: true });
      const b = between(cur, nxt, 0.25), y = cur.y;
      const blen = Math.hypot(b.bx - b.ax, b.bz - b.az), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
      add(makeBox(mx, y - 0.2, mz, blen / 2, 0.2, 0.75, 0, b.ry, 0), 'beam', { surf: ZD.ice ? 'ice' : null });
      // Wall: the frame and side panels are permanent, the middle panel is the door.
      const nx = -b.uz, nz = b.ux;
      for (const s2 of [-1, 1]) add(makeBox(mx + nx * s2 * 2.15, y + 2.3, mz + nz * s2 * 2.15, 0.25, 2.3, 1.4, 0, b.ry, 0), 'wall');
      add(makeBox(mx, y + 4.15, mz, 0.25, 0.45, 0.8, 0, b.ry, 0), 'wall');
      const door = add(makeBox(mx, y + 1.85, mz, 0.18, 1.85, 0.8, 0, b.ry, 0), 'door');
      // Target on a post off to the side, facing the player's approach.
      const tr = Math.hypot(mx - CX, mz - CZ), ox = (mx - CX) / tr, oz = (mz - CZ) / tr;
      const bx = mx + ox * 3.2 - b.ux * 1.5, bz = mz + oz * 3.2 - b.uz * 1.5, by = y + 3.6;
      add(makeCyl(bx, y + 1.5, bz, 0.12, 2.2), 'post');
      out.doors.push({ i: out.doors.length, col: door, x: mx, y, z: mz, ry: b.ry, bx, by, bz, fx: -b.ux, fz: -b.uz, zone });
      recBox(mx, mz, blen / 2, 2.4, b.ry, y + 4.6, 1.2);
      if (zone === 0 && !intro.door) { intro.door = true; sign(cur, 'Door in the way? SHOOT the round target to open it.'); }
      return nxt;
    },
    // A wide platform patrolled by a monster that knocks robots off. Time it, GRAB, or SHOOT to stun it.
    monster(cur) {
      const p = T.gap(cur, { size: [rr(5, 6), rr(3.2, 3.8)], g: rr(1.4, 2.2), dy: rr(-0.2, 0.6), nosign: true });
      const ax = Math.cos(p.ry), az = -Math.sin(p.ry), half = p.sx / 2 - 0.9;
      out.monsters.push({ i: out.monsters.length, ax: p.x - ax * half, az: p.z - az * half, bx: p.x + ax * half, bz: p.z + az * half,
        y: p.y + 0.65, per: rr(3.2, 4.6), ph: R(), r: 0.65, zone });
      if (zone === 0 && !intro.monster) { intro.monster = true; sign(p, 'Monsters knock you off. Time it, hold GRAB, or SHOOT to stun them.'); }
      return T.gap(p, { g: rr(1.3, 2.0) });
    },
    // Gaps with bats circling through them.
    bats(cur, ob) {
      const n0 = out.bats.length;
      for (let i = 0; i < 3; i++) {
        const prev = cur;
        cur = T.gap(cur, { g: rr(1.8, 2.5), dy: rr(-0.2, 0.7) });
        const b = between(prev, cur, 0);
        out.bats.push({ i: out.bats.length, cx: (b.ax + b.bx) / 2, cy: Math.max(prev.y, cur.y) + 1.1, cz: (b.az + b.bz) / 2,
          rad: rr(2.2, 3), per: rr(3, 4.5) * (R() < 0.5 ? 1 : -1), ph: R(), r: 0.45, zone });
      }
      if (ob) for (let k = n0; k < out.bats.length; k++) Object.assign(out.bats[k], { look: ob.look, lvl: ob.lvl, key: ob.key });
      return cur;
    },
    // A wide platform with a laser bar spinning low across it: jump over it as it comes round.
    laser(cur) {
      const p = T.gap(cur, { size: [rr(4.6, 5.4), rr(3.8, 4.4)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.5) });
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.16, 0.3), 'post');
      out.lasers.push({ i: out.lasers.length, k: 'spin', x: p.x, y: p.y + 0.5, z: p.z, len: Math.min(p.sx, p.sz) / 2 + 0.2,
        per: rr(2.4, 3.4) * (R() < 0.5 ? 1 : -1), ph: R(), n: zone >= 3 ? 2 : 1, zone });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // A bridge with a laser curtain across it that switches on and off: cross while it's off.
    gate(cur, o) {
      const nxt = T.beam(cur, { len: rr(5.5, 7), w: 1.2, rise: rr(0, 0.5) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2, nx = -b.uz, nz = b.ux;
      for (const s2 of [-1, 1]) add(makeCyl(mx + nx * s2 * 1.0, my + 1.25, mz + nz * s2 * 1.0, 0.13, 1.35), 'post');
      out.lasers.push({ i: out.lasers.length, k: 'gate', x: mx, y: my, z: mz, ux: b.ux, uz: b.uz, w: 0.9, h: 2.4, per: rr(2.8, 3.6), ph: R(), duty: 0.5, zone });
      if (o) Object.assign(out.lasers[out.lasers.length - 1], { look: o.look, lvl: o.lvl, key: o.key });
      return nxt;
    },
    // Arrow traps beside a bridge, firing across it one after another.
    arrows(cur, ob) {
      const n0 = out.arrows.length;
      const nxt = T.beam(cur, { len: rr(6, 7.5), w: rr(0.9, 1.1), rise: rr(0, 0.8) });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
      let nx = -b.uz, nz = b.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
      const n = 2 + (R() < 0.5 ? 1 : 0), per = rr(2.2, 2.8), ph0 = R();
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / (n + 1), px = b.ax + (b.bx - b.ax) * f, pz = b.az + (b.bz - b.az) * f, py = cur.y + (nxt.y - cur.y) * f;
        const lx = px + nx * 2.4, lz = pz + nz * 2.4;
        add(makeCyl(lx, py - 0.45, lz, 0.14, 0.7), 'post');
        out.arrows.push({ i: out.arrows.length, x: lx, y: py + 0.6, z: lz, dx: -nx, dz: -nz, range: 4.4, speed: 13, per, ph: ph0 + k / n, zone });
      }
      if (ob) for (let k = n0; k < out.arrows.length; k++) Object.assign(out.arrows[k], { look: ob.look, lvl: ob.lvl, key: ob.key });
      return nxt;
    },
    // A platform swinging like a pendulum across a gap too wide to jump: ride it over.
    swing(cur) {
      const [sx, sz] = size(), r = nextR(cur, sz);
      const nxt = plat(thetaFor(cur, rr(5.2, 6.4), r, sx, sz), r, cur.y + rr(-0.2, 0.5), sx, sz);
      const b = between(cur, nxt, 0), half = Math.hypot(b.bx - b.ax, b.bz - b.az) / 2;
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, L = rr(3.0, 3.5), base = Math.min(cur.y, nxt.y) - 0.25;
      const amp = Math.asin(Math.min(0.85, Math.max(0.3, half - 1.5) / L)), py = base + L;
      const c = makeBox(mx, base, mz, 1.1, 0.25, 1.1, 0, b.ry, 0);
      c.dyn = { k: 'swing', px: mx, py, pz: mz, ux: b.ux, uz: b.uz, L, amp, per: rr(3.4, 4.4), ph: R() };
      add(c, 'swing', { surf: null });
      out.swings.push({ col: c, x: mx, y: py, z: mz, ry: b.ry });
      recBox(mx, mz, half, 1.2, b.ry, Math.max(cur.y, nxt.y) + 0.6);
      return nxt;
    },
    // Sunny: the switchback turn. Hop sideways into the other lane and head back the other way.
    turn(cur) {
      const toInner = BAND === LANES.outer, nb = toInner ? LANES.inner : LANES.outer, [sx, sz] = [rr(2.6, 3.2), rr(2.4, 2.8)];
      const want = toInner ? cur.r - cur.sz / 2 - 1.4 - sz / 2 : cur.r + cur.sz / 2 + 1.4 + sz / 2;
      const th = cur.th + DIR * 0.12, r = clamp(want, nb.lo + sz / 2, Math.max(nb.lo + sz / 2, nb.hi)), y = cur.y + rr(0.5, 1.0);
      // The other lane may have older route close above or below here: climb first, then hop over.
      const nd = needAt(th, r, sx + 1, sz + 1, y);
      if (nd > 0.6) return T.lift(cur, nd + 1.4);
      BAND = nb;
      const p = plat(th, r, y, sx, sz);
      DIR = -DIR;
      newLeg(p);
      return p;
    },
    // Forest: walk out along branches to a side tree, climb round it, then come back to the main trunk.
    excursion(cur) {
      let phi = null;
      for (let k = 0; k < 10 && phi === null; k++) {
        const a = cur.th + DIR * (0.25 + k * 0.4), x = Math.cos(a) * SAT_D, z = Math.sin(a) * SAT_D;
        if (out.trees.every((t) => Math.hypot(t.x - x, t.z - z) > 21 || cur.y > t.top + 10)) phi = a;
      }
      if (phi === null) return T.gap(cur);
      const ux = Math.cos(phi), uz = Math.sin(phi), Sx = ux * SAT_D, Sz = uz * SAT_D;
      const tree = { x: Sx, z: Sz, r: SAT_TR, y0: cur.y, top: 0, zone };
      // Out along the branch to a landing on the near side of the side tree.
      cur = walkTo(cur, Sx - ux * 6.2, Sz - uz * 6.2, cur.y + rr(1.0, 2.0));
      const saved = { CX, CZ, DIR, BAND };
      CX = Sx; CZ = Sz; DIR = -saved.DIR; BAND = { lo: SAT_TR + 1.3, hi: SAT_TR + 4.8 };
      cur = reframe(cur);
      const start = cur.th, startY = cur.y, home = Math.atan2(-Sz, -Sx), turns = rr(1.15, 1.6);
      // Round a small tree only short pieces fit (long bridges would cut across the circle).
      const ok = ['gap', 'gap', 'stairs', 'pillars', 'crumble', 'bob', 'tilt', 'monster', 'bats', 'pad'];
      // Where the branch back to the main trunk will land, and how high it must be to clear the route below.
      const backNeed = () => {
        const [wx, wz] = polar(cur.th, cur.r), b = Math.atan2(wz, wx), hx = Math.cos(b) * 12.5, hz = Math.sin(b) * 12.5;
        return Math.max(0, need(hx, hz, 1.5, 1.5, -(b + Math.PI / 2), cur.y + 0.8));
      };
      for (let n = 0; n < 90; n++) {
        const went = Math.abs(cur.th - start) / TAU;
        if (went > turns && Math.abs(angDiff(cur.th, home)) < 0.55 && backNeed() < 2.5) break;
        const at = cur, g = place(() => guard(at), at);
        if (g) { cur = g; continue; }
        // Round a small tree the laps are short, so keep climbing at least 6.5 m per lap.
        if (cur.y < startY + went * 6.5 - 0.4) { cur = place(() => T.stairs(at, 2), at); continue; }
        const k = pickTpl(), ob = obstacle(MAP.key, k);
        cur = place(() => (ob ? (SMALL_OK.has(ob.prim) ? T.obs(at, k) : T.gap(at)) : T[ok.includes(k) ? k : 'gap'](at)), at);
      }
      tree.top = cur.y + 3;
      out.trees.push(tree);
      add(makeCyl(Sx, tree.top / 2 - 1, Sz, SAT_TR, tree.top / 2 + 1), 'trunk');
      CX = saved.CX; CZ = saved.CZ; DIR = saved.DIR; BAND = saved.BAND;
      // Back along a branch to the main trunk, high enough above the route below.
      const back = Math.atan2(cur.z, cur.x), hx = Math.cos(back) * 12.5, hz = Math.sin(back) * 12.5;
      cur = walkTo(cur, hx, hz, cur.y + 0.8 + Math.max(0, need(hx, hz, 1.5, 1.5, -(back + Math.PI / 2), cur.y + 0.8)));
      return reframe(cur);
    },
    // Volcano: a vent in the middle of a platform erupts every few seconds. Standing on it launches you
    // up to the ledge high above; standing next to it gets you shoved off.
    geyser(cur, o) {
      const p = T.gap(cur, { size: [rr(3.4, 4.2), rr(3.0, 3.6)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.4) });
      out.geysers.push({ i: out.geysers.length, x: p.x, y: p.y, z: p.z, per: rr(3.2, 4.2), ph: R(), dur: 1.2, zone });
      if (o) Object.assign(out.geysers[out.geysers.length - 1], { look: o.look, lvl: o.lvl, key: o.key });
      return T.gap(p, { g: rr(1.0, 1.5), dy: rr(4.4, 5.2) });
    },
    // Volcano: boulders drop onto a wide ledge. A shadow grows where the next one will land.
    rocks(cur, o) {
      const p = T.gap(cur, { size: [rr(5, 6), rr(3.6, 4.2)], g: rr(1.3, 1.9), dy: rr(-0.2, 0.5) });
      const n0 = out.rocks.length;
      const n = 2 + (R() < 0.5 ? 1 : 0), ax = Math.cos(p.ry), az = -Math.sin(p.ry), per = rr(3.4, 4.6);
      for (let k = 0; k < n; k++) {
        const o = (k / (n - 1) - 0.5) * (p.sx - 1.6);
        out.rocks.push({ i: out.rocks.length, x: p.x + ax * o, y: p.y, z: p.z + az * o, per, ph: k / n + R() * 0.15, zone });
      }
      if (o) for (let k = n0; k < out.rocks.length; k++) Object.assign(out.rocks[k], { look: o.look, lvl: o.lvl, key: o.key });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // City: a long conveyor belt that carries you along (with you or against you).
    conveyor(cur) {
      const sx = rr(6, 7.5), sz = rr(2.2, 2.6), r = nextR(cur, sz);
      const p = plat(thetaFor(cur, rr(1.2, 1.8), r, sx, sz), r, cur.y + rr(-0.2, 0.5), sx, sz, { kind: 'conveyor', surf: null });
      p.col.conv = { sp: rr(2.4, 3.6) * (R() < 0.5 ? 1 : -1) };
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // City: leave this tower for the next one, over a sky bridge or by zipline from a hook in the gap.
    cross(cur) {
      const nb = (tower + 1) % TOWERS.length, A = TOWERS[tower], B = TOWERS[nb];
      const dx = A.x - B.x, dz = A.z - B.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, lx = B.x + ux * 9.4, lz = B.z + uz * 9.4;
      let land;
      if (R() < 0.45) {
        CX = B.x; CZ = B.z; BAND = TBAND;
        land = plat(Math.atan2(lz - CZ, lx - CX), 9.4, cur.y + rr(0.4, 1.6), 3.2, 3.0, { nosign: true });
        const hx = (cur.x + land.x) / 2, hz = (cur.z + land.z) / 2, hy = Math.max(cur.y, land.y) + rr(5, 6);
        out.anchors.push({ i: out.anchors.length, x: hx, y: hy, z: hz, tx: land.x, ty: land.y + PR_TOP, tz: land.z, zone });
        recBox(hx, hz, 1, 1, 0, hy + 1.6, 2.2);
      } else {
        land = walkTo(cur, lx, lz, cur.y + rr(1, 2));
        CX = B.x; CZ = B.z; BAND = TBAND;
      }
      tower = nb;
      land = reframe(land);
      newVisit(land);
      return land;
    },
    // ---------- themed obstacles (see obstacles.js) ----------
    obs(cur, key) {
      const o = obstacle(MAP.key, key);
      if (!o) return T.gap(cur);
      usedObs.push(key);
      obsZone.push(zone);
      const f = OB[o.prim];
      return f ? f(cur, o) : T.gap(cur);
    },
    // A route that wanders: ride a lift up and head back the other way.
    reverse(cur) {
      return T.lift(cur, rr(5.5, 7), true);
    },
    // A detour out to floating platforms away from the tower, then back.
    detour(cur) {
      const rOut = ROUTE === 'crater' ? rr(18.5, 20) : rr(19.5, 23), a = cur.th + DIR * 0.35, saved = BAND;
      cur = walkTo(cur, Math.cos(a) * rOut, Math.sin(a) * rOut, cur.y + rr(0.5, 1.5));
      cur = reframe(cur);
      BAND = { lo: rOut - 2.2, hi: rOut + 1.2 };
      for (let k = 0, n = 2 + ((R() * 3) | 0); k < n; k++) cur = T[['gap', 'gap', 'pillars', 'bob', 'crumble', 'tilt'][(R() * 6) | 0]](cur);
      BAND = saved;
      const b = Math.atan2(cur.z, cur.x), r = (BAND.lo + BAND.hi) / 2 + 1;
      cur = walkTo(cur, Math.cos(b) * r, Math.sin(b) * r, cur.y + rr(0.5, 1.2));
      return reframe(cur);
    },
    iceslope(cur) {
      return T.beam(cur, { len: rr(6, 7.5), w: 1.3, rise: rr(1.0, 1.4), surf: 'ice' });
    },
  };

  // Every section is checked right after it is placed. If anything in it sits too close above or below
  // older route, the section is undone and the route climbs straight up with a lift instead, so the
  // finished level always keeps its clearances (dev/leveltest.js checks the same rule).
  const LISTS = ['cols', 'rings', 'decor', 'cps', 'fans', 'rods', 'signs', 'crumbles', 'anchors', 'doors', 'monsters', 'bats', 'lasers', 'arrows', 'swings', 'trees', 'geysers', 'rocks', 'obs', 'blinks', 'traps', 'bumpers', 'flows', 'jumpers'];
  function snapshot() {
    const n = {};
    for (const k of LISTS) n[k] = out[k].length;
    return { n, recs: recs.length, used: usedObs.length, pathLen, lastP, lastY, zonePlats, plats: out.plats, intro: Object.assign({}, intro),
      CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps };
  }
  function restore(q) {
    for (const k of LISTS) out[k].length = q.n[k];
    for (let i = recs.length - 1; i >= q.recs; i--) {
      const r = recs[i], b = buckets[Math.max(0, Math.floor(r.y / 4))];
      b.splice(b.lastIndexOf(r), 1);
    }
    recs.length = q.recs;
    usedObs.length = q.used;
    obsZone.length = q.used;
    ({ pathLen, lastP, lastY, zonePlats, CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps } = q);
    out.plats = q.plats;
    Object.assign(intro, q.intro);
  }
  // How far the new footprints (from index `from`) would have to rise to clear everything older.
  function badness(from) {
    let raise = 0;
    for (let i = from; i < recs.length; i++) {
      const q = recs[i];
      for (let k = Math.max(0, Math.floor((q.y - HEAD) / 4) - 1); k <= Math.floor((q.y + HEAD) / 4) + 1; k++) {
        const B = buckets[k];
        if (!B) continue;
        for (const r of B) {
          if (r === q || r.pl >= q.pl - RECENT) continue;
          const lo = r.y <= q.y ? r : q, hi = lo === r ? q : r;
          if (hi.y - lo.y >= lo.h - 0.01) continue;
          const dx = r.x - q.x, dz = r.z - q.z, rr2 = r.rad + q.rad;
          if (dx * dx + dz * dz > rr2 * rr2 || !overlap(r, q, 0)) continue;
          raise = Math.max(raise, r.y + r.h - q.y + 0.05);
        }
      }
    }
    return raise;
  }
  function place(fn, at) {
    for (let k = 0; k < 4; k++) {
      const snap = snapshot(), res = fn(), raise = badness(snap.recs);
      if (raise <= 0) return res;
      restore(snap);
      fn = () => T.lift(at, Math.min(12, raise + 1.2));
    }
    return fn();
  }

  // Each template call tags the footprints it records (for the clearance test's reports).
  const T = {};
  for (const k in T0) T[k] = (...args) => { const prev = TAG; TAG = k; const r = T0[k](...args); TAG = prev; return r; };

  // The higher the zone, the more often the next section is one of the map's obstacles: about 30% at the
  // bottom, 75% in the top zone.
  function pickTpl() {
    const obsW = {}, baseW = {};
    for (const k in ZW) (T[k] ? baseW : obsW)[k] = ZW[k];
    const pObs = 0.3 + (0.45 * zone) / Math.max(1, ZONE_LIST.length - 1);
    const useObs = Object.keys(obsW).length && R() < pObs, w = useObs ? obsW : baseW;
    // Every one of the map's obstacles shows up: usually pick one of this zone's that hasn't been used yet.
    if (useObs) {
      const fresh = Object.keys(obsW).filter((q) => !usedObs.includes(q));
      if (fresh.length && R() < 0.6) return fresh[(R() * fresh.length) | 0];
    }
    let sum = 0;
    for (const k in w) sum += w[k];
    let x = R() * sum;
    for (const k in w) if ((x -= w[k]) <= 0) return k;
    return 'gap';
  }

  // Look ~1.4 rad ahead; if the layer below would be too close, climb stairs first.
  function guard(cur, span = 2.4, extra = 0.6) {
    let worst = -1e9;
    const sp = Math.min(span, 18 / Math.max(3, cur.r));
    for (let d = 0.1; d <= sp; d += 0.1) {
      for (const dr of [-1, 0, 1]) worst = Math.max(worst, needAt(cur.th + DIR * d, Math.max(BAND.lo + 1, cur.r + dr), 3.6, 3.6, cur.y - extra));
    }
    // A big climb needed soon is done in one go with a lift; small ones with a few stairs.
    if (worst > 2.4) return T.lift(cur, Math.min(9, worst + 1.4));
    return worst > 0 ? T.stairs(cur, Math.ceil(worst / 0.9) + 2) : null;
  }

  function ring(y, rIn, rOut, a0, a1, kind, recIt) {
    const n = Math.ceil((a1 - a0) / 0.2), da = (a1 - a0) / n, rm = (rIn + rOut) / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + 0.5) * da;
      const [x, z] = polar(a, rm);
      add(makeBox(x, y - 0.6, z, (rOut * da) / 2 + 0.06, 0.6, (rOut - rIn) / 2, 0, -(a + Math.PI / 2), 0), kind, { vis: false });
      if (recIt) rec({ th: a, y, r: rm, sx: rm * da, sz: rOut - rIn });
    }
    out.rings.push({ y, rIn, rOut, a0, a1, zone });
  }

  function checkpoint(th, r, y, o) {
    const [x, z] = polar(th, r);
    out.cps.push(Object.assign({ i: out.cps.length, x, y, z, th, zone }, o));
  }

  // ---------- build ----------
  ring(2, CORE_R + 0.3, 19, 0, TAU, 'dock', false);
  for (let i = 0; i < 4; i++) {
    const a = 0.9 + i * 1.57, [x, z] = polar(a, 25);
    add(makeBox(x, 1.4, z, 1.6, 0.6, 6.5, 0, -(a + Math.PI / 2), 0), 'pier');
  }
  for (let i = 0; i < 14; i++) {
    const a = 1.4 + i * 0.37, r = rr(13, 17.5), s = rr(0.8, 1.3), [x, z] = polar(a, r);
    add(makeBox(x, 2 + s / 2, z, s / 2, s / 2, s / 2, 0, rr(0, 3), 0), 'crate');
  }
  if (MAP.key === 'storm') {
    for (let i = 0; i < 12; i++) {
      const [x, z] = polar((i / 12) * TAU + 0.2, 18.3);
      out.decor.push({ k: 'lamp', x, y: 2, z });
    }
  }
  out.spawn = { th: 0.12, r: 12.5, y: 2 };
  checkpoint(0.12, 12.5, 2, { start: true, normal: true });
  out.signs.push({ x: Math.cos(0.12) * 17.5, y: 4.6, z: Math.sin(0.12) * 17.5, text: SIGNS[0] });
  let cur = virt(0.12 + DIR * 0.38, 12.5, 2, 2.4, 6);
  if (ROUTE === 'switchback') { BAND = LANES.outer; newLeg(cur); }
  let nextExc = 0, sinceRev = 0, sinceDet = 0, jumpZone = 0;
  if (ROUTE === 'towers') {
    // Off the dock and over to the nearest skyscraper.
    tower = 0;
    let best = 1e9;
    TOWERS.forEach((t, k) => { const dd = Math.hypot(t.x - cur.x, t.z - cur.z); if (dd < best) { best = dd; tower = k; } });
    const t = TOWERS[tower], d = Math.hypot(t.x, t.z);
    cur = walkTo(cur, t.x - (t.x / d) * 9.4, t.z - (t.z / d) * 9.4, 3.2);
    CX = t.x; CZ = t.z; BAND = TBAND; DIR = 1;
    cur = reframe(cur);
    newVisit(cur);
  }

  for (zone = 0; zone < ZONE_LIST.length; zone++) {
    ZD = ZONE_LIST[zone];
    jumpZone = 0;
    // A zone's own template list can also name obstacles to make them more common there (they add up).
    ZW = Object.assign({}, zoneObstacles(MAP.key, zone, ZONE_LIST.length));
    for (const k in ZD.tpl) ZW[k] = (ZW[k] || 0) + ZD.tpl[k];
    zonePlats = 0;
    const zi = { name: ZD.name, sub: ZD.sub, color: ZD.color, fog: ZD.fog, tint: ZD.tint, y0: cur.y, y1: ZD.y1 };
    if (zone > 0 && ROUTE === 'towers') {
      // No ring round a core here: a wide rooftop pad starts the zone.
      const at0 = cur;
      cur = place(() => T.gap(at0, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at0);
      zi.y0 = cur.y;
      checkpoint(cur.th, cur.r, cur.y, { normal: zone % 2 === 0 });
    } else if (zone > 0) {
      // Zone gate: a wide three-quarter ring that doubles as a safety net and checkpoint.
      const rIn = 7.0, rOut = 16.5, rm = 11.75, span = TAU * 0.72;
      let th0;
      for (let k = 0; k < 40; k++) {
        th0 = cur.th + DIR * (cur.sx / 2 + 1.1) / cur.r;
        let worst = -1e9;
        for (let a = 0; a <= span; a += 0.1) worst = Math.max(worst, needAt(th0 + DIR * a, rm, 2, rOut - rIn, cur.y + 0.9));
        if (worst <= 0) break;
        const at = cur, n = Math.ceil(worst) + 1;
        cur = place(() => T.stairs(at, n), at);
      }
      const y = cur.y + 0.9;
      zi.y0 = y;
      ring(y, rIn, rOut, DIR > 0 ? th0 : th0 - span, DIR > 0 ? th0 + span : th0, 'ring', true);
      checkpoint(th0 + DIR * 0.55, rm, y, { normal: zone % 2 === 0 });
      cur = virt(th0 + DIR * (span - 1.1 / rm), rm, y, 2.2, rOut - rIn);
      lastP = cur;
      pathLen += span * rm;
      if (ROUTE === 'switchback') newLeg(cur);
    }
    out.zones.push(zi);
    nextExc = zi.y0 + 12;
    let midDone = zone === 0;
    const mid = (zi.y0 + ZD.y1) / 2;
    while (cur.y < ZD.y1) {
      const at = cur, g = place(() => guard(at), at);
      if (g) { cur = g; continue; }
      if (!midDone && cur.y > mid) {
        cur = place(() => T.gap(at, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at);
        checkpoint(cur.th, cur.r, cur.y, { mid: true });
        midDone = true;
        continue;
      }
      // Special areas are long and tall; make sure the layer below is far enough away first.
      const g2 = place(() => guard(at, 2.8, 1.5), at);
      if (g2) { cur = g2; continue; }
      sinceTurn++;
      // Sunny: the last stretch below the summit runs in the outer lane, clear of the summit disc.
      if (ROUTE === 'switchback' && finalStretch() && BAND === LANES.inner) { cur = place(() => T.turn(at), at); continue; }
      // Sunny: turn round at the end of each leg. Forest: now and then a trip out to a side tree.
      if (ROUTE === 'switchback' && DIR * (cur.th - legStart) > legLen && !finalStretch()) { cur = place(() => T.turn(at), at); continue; }
      if (ROUTE === 'towers') {
        // Done with this tower once round far enough and facing the next one: cross over.
        const nt = TOWERS[(tower + 1) % TOWERS.length], face = Math.atan2(nt.z - CZ, nt.x - CX);
        if (Math.abs(cur.th - visitStart) / TAU > visitLaps && Math.abs(angDiff(cur.th, face)) < 0.45) { cur = place(() => T.cross(at), at); continue; }
      }
      if (ROUTE === 'trees' && zone < ZONE_LIST.length - 1 && cur.y > nextExc && cur.y < ZD.y1 - 24 && (zone > 0 || zonePlats > 16)) {
        cur = place(() => T.excursion(at), at);
        nextExc = cur.y + 34;
        continue;
      }
      // The first zone teaches each special area early on.
      if (zone === 0 && zonePlats >= 6 && !intro.grapple) cur = place(() => T.grapple(at), at);
      else if (zone === 0 && zonePlats >= 12 && !intro.door) cur = place(() => T.door(at), at);
      else if (zone === 0 && MAP.key === 'forest' && zonePlats >= 3 && !intro.monster) cur = place(() => T.monster(at), at);
      else if (zone >= 1 && jumpZone < (zone >= 5 ? 2 : 1) && zonePlats >= 6 + jumpZone * 9 && !finalStretch()) {
        const J = JUMPER[MAP.key] || JUMPER.storm, o = { name: J.name, look: J.look, lvl: jumpZone };
        cur = place(() => OB.jumper(at, o), at);
        jumpZone++;
      }
      else if (finalStretch()) { const k = ['gap', 'gap', 'stairs', 'pillars', 'beam', 'crumble'][(R() * 6) | 0]; cur = place(() => T[k](at), at); }
      else {
        // Big sweeping things stay away from the switchback turns, where the other lane is close by.
        let k = pickTpl();
        if (ROUTE === 'switchback' && (k === 'spinner' || k === 'fan') && (sinceTurn < 4 || BAND === LANES.inner)) k = 'mover';
        if ((ROUTE === 'towers' || ROUTE === 'crater') && (k === 'spinner' || k === 'fan')) k = 'mover';
        // Wander instead of only circling: now and then turn back after a lift, or detour outward.
        if ((ROUTE === 'spiral' || ROUTE === 'crater' || ROUTE === 'trees') && sinceRev > 9 && R() < 0.14) { k = 'reverse'; sinceRev = 0; }
        else if ((ROUTE === 'spiral' || ROUTE === 'crater' || ROUTE === 'switchback') && sinceDet > 12 && zone > 0 && R() < 0.1) { k = 'detour'; sinceDet = 0; }
        sinceRev++; sinceDet++;
        const kk = k;
        cur = place(() => (T[kk] ? T[kk](at) : T.obs(at, kk)), at);
      }
    }
    zi.y1 = cur.y;
  }

  // Summit: a disc capping the core, reached from one last ledge.
  zone = ZONE_LIST.length - 1;
  if (ROUTE === 'switchback' && BAND === LANES.inner) cur = T.turn(cur);
  if (ROUTE === 'towers') {
    // From the last tower over to the central spire, whose roof is the summit.
    const b = Math.atan2(cur.z, cur.x);
    cur = walkTo(cur, Math.cos(b) * 12.5, Math.sin(b) * 12.5, cur.y + 1);
    CX = 0; CZ = 0; BAND = MAIN; DIR = 1;
    cur = reframe(cur);
  }
  // A few steps so every map tops out at exactly 1000 m on the height counter, which starts from the floor
  // at y 2 (the last zone stops a little short of it).
  const SUMMIT = 1002;
  for (let k = 0; k < 30 && cur.y < SUMMIT - 2.2; k++) {
    const at = cur, dy = Math.min(1.0, SUMMIT - 2.0 - at.y);
    cur = place(() => T.gap(at, { size: [2.6, 2.4], g: rr(1.0, 1.4), dy, surf: null }), at);
  }
  const topLedge = () => Math.max(cur.y + 0.4, SUMMIT - 1.0);
  for (let k = 0; k < 40; k++) {
    if (need(0, 0, 9.8, 9.8, 0, topLedge() + 1.0) <= 0) break;
    cur = T.stairs(cur, 2);
  }
  const last = plat(thetaFor(cur, 1.4, 12.0, 2.4, 2.2), 12.0, topLedge(), 2.4, 2.2);
  const top = last.y + 1.0;
  add(makeCyl(0, top - 0.6, 0, 9.6, 0.6), 'summit');
  out.summit = { x: 0, y: top, z: 0, r: 4.5 };
  out.top = top;
  out.zones[out.zones.length - 1].y1 = top;
  if (ROUTE !== 'crater') add(makeCyl(0, (top - 1.2 - 40) / 2, 0, CORE_R, (top - 1.2 + 40) / 2), 'core');
  for (const t of TOWERS) add(makeBox(t.x, (top - 20) / 2, t.z, TW, (top + 20) / 2, TW, 0, -t.a, 0), 'tower');

  // Zone decorations, all visual only, different for each map.
  const dz = (k, n, f) => { for (let i = 0; i < n; i++) out.decor.push(Object.assign({ k }, f(i))); };
  const zy = (i) => out.zones[i];
  const around = (rMin, rMax) => { const a = rr(0, TAU), r = rr(rMin, rMax); return [Math.cos(a) * r, Math.sin(a) * r, a]; };
  if (MAP.key === 'storm') {
    dz('rotor', 10, () => { const a = rr(0, TAU), y = rr(zy(1).y0 + 4, zy(1).y1); return { x: Math.cos(a) * (CORE_R + 0.2), y, z: Math.sin(a) * (CORE_R + 0.2), th: a, s: rr(2.2, 3.4) }; });
    dz('coil', 10, () => { const [x, z] = around(20, 34); return { x, y: rr(zy(2).y0, zy(2).y1), z, s: rr(1.5, 3) }; });
    dz('rock', 40, () => { const [x, z] = around(19, 38); return { x, y: rr(zy(4).y0 - 10, zy(4).y1 + 10), z, s: rr(1, 4), rx: rr(0, 3), ry: rr(0, 3), sp: rr(0.1, 0.4) }; });
    for (const c of out.cols) {
      if (c.zone === 5 && c.kind === 'plat' && R() < 0.7) {
        for (let i = 0; i < 3; i++) out.decor.push({ k: 'icicle', x: c.x + rr(-c.hx, c.hx) * 0.6, y: c.y - c.hy, z: c.z + rr(-c.hz, c.hz) * 0.6, s: rr(0.5, 1.4) });
      }
    }
    dz('halo', 8, (i) => { const a = (i / 8) * TAU, r = rr(18, 26); return { x: Math.cos(a) * r, y: rr(zy(out.zones.length - 1).y0 + 10, top + 30), z: Math.sin(a) * r, s: rr(3, 6), rx: rr(-0.6, 0.6), ry: a }; });
  } else if (MAP.key === 'waterfall') {
    // A green island in a clear lagoon: palms, lily pads, fountains and fish jumping, clouds and birds above.
    dz('palm', 24, () => { const [x, z] = around(19, 32); return { x, y: 0.4, z, s: rr(0.8, 1.3), ry: rr(0, TAU), lean: rr(-0.35, 0.35) }; });
    dz('lily', 60, () => { const [x, z] = around(39, 52); return { x, y: 0.12, z, s: rr(0.6, 1.5), ry: rr(0, TAU), flower: R() < 0.3 }; });
    dz('fountain', 5, (i) => { const a = (i / 5) * TAU + 0.3, r = rr(22, 28); return { x: Math.cos(a) * r, y: 0.4, z: Math.sin(a) * r, s: rr(0.9, 1.2) }; });
    dz('fish', 14, () => { const [x, z, a] = around(42, 85); return { x, y: 0, z, ry: a + Math.PI / 2, per: rr(3.5, 7), ph: R(), s: rr(0.8, 1.4) }; });
    dz('cloud', 46, () => { const [x, z] = around(22, 60); return { x, y: rr(zy(2).y0, top + 40), z, s: rr(4, 9), sp: rr(0.02, 0.06) }; });
    dz('gull', 12, () => ({ x: 0, y: rr(20, top), z: 0, r: rr(18, 40), sp: rr(0.15, 0.3) * (R() < 0.5 ? 1 : -1), ph: R() * TAU }));
  } else if (MAP.key === 'sunny') {
    // A sandy island with palms, boats out at sea and puffy clouds drifting around the upper tower.
    dz('palm', 22, () => { const [x, z] = around(20, 34); return { x, y: 0.4, z, s: rr(0.8, 1.3), ry: rr(0, TAU), lean: rr(-0.35, 0.35) }; });
    dz('boat', 7, () => { const [x, z, a] = around(70, 180); return { x, y: 0, z, s: rr(1, 2), ry: a + rr(-0.5, 0.5) }; });
    dz('cloud', 46, () => { const [x, z] = around(22, 60); return { x, y: rr(zy(2).y0, top + 40), z, s: rr(4, 9), sp: rr(0.02, 0.06) }; });
    dz('gull', 10, () => ({ x: 0, y: rr(20, top), z: 0, r: rr(18, 40), sp: rr(0.15, 0.3) * (R() < 0.5 ? 1 : -1), ph: R() * TAU }));
  } else {
    // A forest island: trees all around, mushrooms and vines on the climb, fireflies higher up.
    dz('tree', 60, () => { const [x, z] = around(21, 75); return { x, y: 0.4, z, s: rr(0.8, 1.6), ry: rr(0, TAU) }; });
    dz('branch', 18, (i) => { const a = rr(0, TAU); return { x: Math.cos(a) * CORE_R, y: rr(20, top - 10), z: Math.sin(a) * CORE_R, th: a, s: rr(2.5, 5) }; });
    for (const c of out.cols) {
      if (c.kind === 'plat' && c.zone === 1 && R() < 0.5) out.decor.push({ k: 'mushroom', x: c.x + rr(-c.hx, c.hx) * 0.5, y: c.y + c.hy, z: c.z + rr(-c.hz, c.hz) * 0.5, s: rr(0.4, 0.8) });
      if (c.kind === 'plat' && (c.zone === 3 || c.zone === 4) && R() < 0.6) out.decor.push({ k: 'vine', x: c.x + rr(-c.hx, c.hx) * 0.7, y: c.y - c.hy, z: c.z + rr(-c.hz, c.hz) * 0.7, s: rr(1.5, 4) });
    }
    dz('firefly', 95, () => { const [x, z] = around(8, 26); return { x, y: rr(zy(3).y0, top), z, sp: rr(0.4, 1.2), ph: R() * TAU }; });
  }

  // The higher you get, the faster things move: normal speed at 100 m, 30% faster at the summit.
  const spAt = (y) => 1 + 0.3 * clamp((y - 100) / (top - 100), 0, 1);
  for (const k of ['obs', 'lasers', 'arrows', 'geysers', 'rocks', 'fans']) for (const o of out[k]) o.sp = spAt(o.fy ?? o.y ?? 0);
  for (const c of out.blinks) c.blink.sp = spAt(c.y);
  for (const c of out.traps) c.trap.sp = spAt(c.y);

  out.recs = recs;
  out.usedObs = [...new Set(usedObs)];
  out.obsZone = obsZone;
  // Forest: no decorative trees standing inside a side tree's climb.
  if (out.trees.length) out.decor = out.decor.filter((d) => d.k !== 'tree' || out.trees.every((t) => Math.hypot(d.x - t.x, d.z - t.z) > 11));
  return out;
}

// Do two oriented rectangles (x, z, hx, hz, c = cos yaw, s = sin yaw) overlap, with margin m? (2D SAT)
export function overlap(a, b, m) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const ax = [a.c, -a.s, a.s, a.c, b.c, -b.s, b.s, b.c];
  for (let i = 0; i < 8; i += 2) {
    const ux = ax[i], uz = ax[i + 1];
    const ra = a.hx * Math.abs(a.c * ux - a.s * uz) + a.hz * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux - b.s * uz) + b.hz * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb + m) return false;
  }
  return true;
}
