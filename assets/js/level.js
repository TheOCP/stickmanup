// Procedural but deterministic climbs, built zone by zone from hand-tuned templates. Every phone
// generates the identical level from the map's seed. Each map has its own route:
//   storm  - 'spiral': round and round the tower, counter-clockwise
//   sunny  - 'switchback': back and forth across the lighthouse in two lanes, turning at the ends
//   forest - 'trees': clockwise round the giant trunk, with branch walks out to side trees and up around them
import { makeBox, makeCyl, BOX, aabb, toLocal } from './physics.js';
import { RIDE_HANG } from './player.js';
import { TAU, rng, clamp, angDiff } from './util.js';
import { zoneObstacles, obstacle, topObstacles, TOP_FROM } from './obstacles.js';

export const LEVEL_VERSION = 23;
// How far a cloud reaches from its centre, as a share of its size (the puffs are placed in worldview.js), and how far
// the camera can get from the climber (6.2 m normally, up to 8 m in a long fall).
export const CLOUD_W = 2.3, CLOUD_H = 0.9, CAM_ROOM = 10;
export const CORE_R = 6, CORE_SKIN = 0.22;
// The central column is drawn wider at its foot than at its top, by this much on each map (1 = straight).
export const coreFlare = (key) => ({ sunny: 1.08, forest: 1.25, waterfall: 1.18 })[key] || 1;
export const coreRadius = (key, y) => CORE_R * (1 + (coreFlare(key) - 1) * clamp((1002 - y) / 1042, 0, 1));
export const HEAD = 4.2; // minimum vertical spacing between layers of the route

export const DIFFS = [
  { id: 0, name: 'Easy', rope: 7.5, storm: 0.7, grip: 0.7, first: 2000, coin: 1, summit: 100, desc: 'Checkpoints in every zone, a long cord, a calmer storm and fewer, slower obstacles.' },
  { id: 1, name: 'Normal', rope: 6.2, storm: 1.0, grip: 1.0, first: 4000, coin: 2, summit: 250, desc: 'Four checkpoints on the whole climb. The full storm and most obstacles.' },
  { id: 2, name: 'Hardcore', rope: 5.2, storm: 1.15, grip: 1.3, first: 10000, coin: 3, summit: 500, desc: 'No checkpoints and a short cord. Every obstacle, and faster. A fall is a fall.' },
  { id: 3, name: 'Insane', rope: 4.6, storm: 1.3, grip: 2.2, coyote: 0.04, first: 20000, coin: 4, summit: 800, desc: 'Everything Hardcore has, faster still. A very short cord, barely any grip and no late jumps.' },
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
      Z('Lightning Rods', 'Move or SHIELD when the rods glow', 316, 0x9b7bff, 0x3b3858, 0x100d22, [2.2, 3.2], [2.0, 3.0], [1.6, 2.8], { gap: 3, rods: 4, beam: 2, pad: 2, pillars: 1, door: 1, gate: 2, laser: 1 }),
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
    seed: 41269, core: 'falls', pattern: 2, accent: '#3fe0ff', route: 'zigzag',
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
// The order the six are shown in the menus (their ids never change: saves, records and the server go by id).
export const MAP_ORDER = [1, 2, 3, 4, 5, 0];
// ---------------------------------------------------------------- generated maps
// Maps 100 to 199: a hundred more climbs. Each is built on one of the six worlds above (its looks, its way up, its creatures)
// with a seed of its own, its own colours (hue), a name, the zones in another order, a grade (how hard it is on any
// difficulty) and up to two twists (mutators). Maps 200 and up are the holiday maps, there on the days round their holiday.
// The daily climb is one of them, by date (dailyMap), unless the server says another (the team's /daily). Generated maps have
// no relics: they are climbs, and their coins pay like everywhere else.
export const GEN0 = 100, GEN_N = 100, HOLI0 = 200;
export const GRADES = ['Gentle', 'Steep', 'Brutal', 'Extreme'];
const GEN_WORDS = {
  storm: [['Static', 'Voltage', 'Thunder', 'Cloudburst', 'Surge', 'Ion', 'Arc', 'Tempest'], ['Spire', 'Mast', 'Beacon', 'Needle', 'Antenna', 'Relay', 'Tower', 'Pylon']],
  sunny: [['Coral', 'Sunlit', 'Golden', 'Breezy', 'Salty', 'Lagoon', 'Driftwood', 'Tidal'], ['Lighthouse', 'Cliffs', 'Cove', 'Bluff', 'Reef', 'Beacon', 'Point', 'Watch']],
  forest: [['Mossy', 'Ancient', 'Whispering', 'Elder', 'Fern', 'Hollow', 'Wild', 'Misty'], ['Oak', 'Canopy', 'Grove', 'Treetops', 'Thicket', 'Redwood', 'Bough', 'Glade']],
  volcano: [['Molten', 'Ashen', 'Cinder', 'Obsidian', 'Scorched', 'Ember', 'Sulfur', 'Blazing'], ['Crater', 'Caldera', 'Peak', 'Forge', 'Vent', 'Summit', 'Furnace', 'Rift']],
  city: [['Chrome', 'Neon', 'Midnight', 'Glass', 'Cyber', 'Rooftop', 'Hyper', 'Electric'], ['Spire', 'Heights', 'Skyline', 'District', 'Tower', 'Arcology', 'Plaza', 'Block']],
  waterfall: [['Roaring', 'Crystal', 'Frozen', 'Silver', 'Thunder', 'Azure', 'Glacier', 'Hidden'], ['Falls', 'Cascade', 'Gorge', 'Torrent', 'Rapids', 'Basin', 'Canyon', 'Springs']],
};
// The twists: more of some obstacles, ice, or another time of day (only the looks).
export const MUTATORS = {
  frozen: { name: 'Frozen', ice: 2 },
  gauntlet: { name: 'Gauntlet', tpl: { laser: 2, arrows: 2, swing: 1.6 } },
  moving: { name: 'Restless', tpl: { mover: 2, bob: 2, lift: 1.8, tilt: 1.8, spinner: 1.8 } },
  crumbling: { name: 'Crumbling', tpl: { crumble: 2.4 } },
  hooks: { name: 'Hooks', tpl: { grapple: 2.4 } },
  windy: { name: 'Windy', tpl: { fan: 2.4 } },
  night: { name: 'Night', look: 'night' },
  dusk: { name: 'Dusk', look: 'dusk' },
};
const MUT_KEYS = Object.keys(MUTATORS);
// Maps whose first seed put a relic course where it fails dev/courseshortcuttest.js (or left one out) take the next seed that
// passes. Checked for all of them: see the generated maps in that test.
const SEED_FIX = { 107: 1, 143: 1, 149: 1, 202: 1 };
const fixSeed = (id, seed) => (seed + (SEED_FIX[id] || 0) * 104729) >>> 0;
// Holidays: from and to are [month, day] in UTC, both days included. Easter moves: its days are worked out each year.
export const HOLIDAYS = [
  { id: 200, hol: 'halloween', key: 'forest', name: 'Haunted Hollow', from: [10, 24], to: [11, 1], hue: 250, grade: 2, muts: ['night', 'crumbling'],
    look: { top: 0x12061e, glow: 0xff7a1a, hemiSky: 0x6a4a9a, hemiGround: 0x1a0e14, light: 0xffa060 },
    zones: ['Pumpkin Patch', 'Graveyard Gate', 'Witch Woods', 'Bone Bridges', 'Bat Belfry', 'Cauldron Rise', 'Spider Hollow', 'Ghost Lights', 'Midnight Moon'] },
  { id: 201, hol: 'christmas', key: 'waterfall', name: 'Frosty Peaks', from: [12, 18], to: [12, 27], hue: 0, grade: 1, muts: ['frozen', 'dusk'],
    look: { top: 0x1a2a50, glow: 0xffd8a0, hemiSky: 0xd0e4ff, light: 0xfff0e0 }, tint: [0xe8f4ff, 0xff4a5a, 0x4ad07a],
    zones: ['Candy Cane Shore', 'Gingerbread Steps', 'Elf Workshop', 'Sleigh Bells', 'Snowman Ridge', 'Frozen Falls', 'Reindeer Run', 'Starlight Ice', 'Top of the Tree'] },
  { id: 202, hol: 'newyear', key: 'city', name: 'Countdown Tower', from: [12, 30], to: [1, 2], hue: 40, grade: 2, muts: ['night', 'gauntlet'],
    look: { top: 0x0a0a1e, glow: 0xffd040, light: 0xfff0c0 },
    zones: ['Party Docks', 'Confetti Alley', 'Sparkler Roofs', 'Balloon Heights', 'Glitter Gardens', 'Firework Forest', 'Champagne Deck', 'Golden Glass', 'Midnight Crown'] },
  { id: 203, hol: 'valentine', key: 'sunny', name: 'Sweetheart Cliffs', from: [2, 12], to: [2, 15], hue: 320, grade: 0, muts: ['dusk'],
    look: { top: 0xd06aa0, glow: 0xffd0e0, hemiSky: 0xffd0e8, light: 0xffe0f0 },
    zones: ['Rose Pier', 'Love Letters', 'Candy Hearts', 'Cupid Clouds', 'Chocolate Bridges', 'Kiss Spire', 'Lantern Lovers', 'Ribbon Heights', 'Heart of Gold'] },
  { id: 204, hol: 'easter', key: 'forest', name: 'Egg Hunt Grove', easter: true, hue: 60, grade: 0, muts: ['hooks'],
    look: { top: 0x8ac8ff, glow: 0xfff6c0, hemiSky: 0xf0e8ff },
    zones: ['Bunny Burrows', 'Pastel Meadow', 'Basket Trunk', 'Egg Vines', 'Chick Canopy', 'Tulip Crown', 'Spring Showers', 'Bumblebee Heights', 'Golden Egg'] },
  { id: 205, hol: 'midsummer', key: 'sunny', name: 'Midsummer Light', from: [6, 20], to: [6, 24], hue: 15, grade: 1, muts: ['windy'],
    look: { top: 0x3a8ae0, glow: 0xfff0a0, light: 0xfff4d0 },
    zones: ['Bonfire Beach', 'Flower Crowns', 'Maypole Steps', 'Long Day Gardens', 'Sun Bridges', 'Solstice Spire', 'Firefly Gallery', 'Golden Hour', 'Midnight Sun'] },
];

// Colours turned round the colour wheel by deg.
export function hueShift(hex, deg) {
  if (!deg) return hex;
  let r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return hex;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h / 6) * 360 + deg) % 360 + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  r = ch(h + 1 / 3); g = ch(h); b = ch(h - 1 / 3);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');

// The zones of a generated map: the world's own, all but the first and the last in another order. Each keeps its height,
// size of platforms and width of jumps by place (higher is harder), and takes its name, hint, obstacles and colours along.
function genZones(base, R, o) {
  const Zs = base.zones, mid = Zs.slice(1, -1).map((z, i) => i + 1);
  for (let i = mid.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0, t = mid[i]; mid[i] = mid[j]; mid[j] = t; }
  const order = [0, ...mid, Zs.length - 1], gapK = [0.93, 1, 1.05, 1.1][o.grade], sizeK = [1.1, 1, 0.94, 0.88][o.grade];
  const ice = new Set();
  if (o.ice) while (ice.size < o.ice) ice.add(2 + ((R() * (Zs.length - 3)) | 0));
  return order.map((src, at) => {
    const place = Zs[at], from = Zs[src], tpl = Object.assign({}, from.tpl);
    for (const m of o.muts) for (const [k, v] of Object.entries(MUTATORS[m].tpl || {})) if (tpl[k] !== undefined || v > 2) tpl[k] = (tpl[k] || 0.6) * v;
    // The grade: harder ones a little more of what is hardest, easier ones more plain jumps.
    if (o.grade >= 2) for (const k of ['laser', 'arrows', 'crumble', 'tilt', 'swing']) if (tpl[k]) tpl[k] *= 1 + 0.25 * (o.grade - 1);
    if (o.grade === 0) tpl.gap = (tpl.gap || 2) + 1.5;
    const z = Object.assign({}, from, {
      y1: place.y1, tpl,
      name: o.names ? o.names[at] : from.name,
      color: hueShift(o.tints ? o.tints[at % o.tints.length] : from.color, o.tints ? 0 : o.hue), tint: hueShift(from.tint, o.hue), fog: hueShift(from.fog, o.hue),
      sx: place.sx.map((v) => Math.max(1.3, v * sizeK)), sz: place.sz.map((v) => Math.max(1.3, v * sizeK)),
      // Never wider than the widest the worlds have: past that a jump may not make it.
      gap: place.gap.map((v) => Math.min(3.0, v * gapK)),
    });
    if (ice.has(at)) z.ice = true;
    return z;
  });
}

function genMap(id) {
  const n = id - GEN0, R = rng((Math.imul(id + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0), base = MAPS[(n * 5 + 1) % MAPS.length];
  const k = Math.floor(n / MAPS.length), [A, B] = GEN_WORDS[base.key];
  const grade = [0, 1, 1, 1, 2, 2, 3][(R() * 7) | 0], hue = R() < 0.2 ? 0 : Math.round(25 + R() * 310);
  const muts = [];
  for (let t = 0, want = (R() * 3) | 0; t < 20 && muts.length < want; t++) {
    const m = MUT_KEYS[(R() * MUT_KEYS.length) | 0];
    // One time of day at most, and no night where it is night already.
    if (muts.includes(m) || (MUTATORS[m].look && (muts.some((x) => MUTATORS[x].look) || base.key === 'storm' || base.key === 'city'))) continue;
    muts.push(m);
  }
  const ice = muts.includes('frozen') ? 2 : 0;
  const name = `${A[k % A.length]} ${B[(k + Math.floor(k / B.length) + n) % B.length]}`;
  const zones = genZones(base, R, { grade, hue, muts, ice });
  return {
    id, key: base.key, base: base.id, gen: true, num: n + 1, name, grade, muts, hue,
    desc: `${base.name} world, ${GRADES[grade]}${muts.length ? ', ' + muts.map((m) => MUTATORS[m].name).join(', ') : ''}.`,
    seed: fixSeed(id, (Math.floor(R() * 1e9) ^ id) >>> 0), core: base.core, pattern: base.pattern, accent: hexStr(hueShift(parseInt(base.accent.slice(1), 16), hue)), route: base.route,
    look: Object.assign({ hue }, ...muts.filter((m) => MUTATORS[m].look).map((m) => ({ time: MUTATORS[m].look }))), zones,
  };
}

function holidayMap(h) {
  const base = MAPS.find((m) => m.key === h.key), R = rng((Math.imul(h.id, 0x2c1b3c6d) ^ 0x297a2d39) >>> 0);
  const zones = genZones(base, R, { grade: h.grade, hue: h.hue, muts: h.muts, ice: h.muts.includes('frozen') ? 3 : 0, names: h.zones, tints: h.tint });
  return {
    id: h.id, key: h.key, base: base.id, gen: true, holiday: h.hol, name: h.name, grade: h.grade, muts: h.muts, hue: h.hue,
    desc: `A holiday climb on ${base.name}'s world, ${GRADES[h.grade]}.`,
    seed: fixSeed(h.id, (h.id * 7919 + 4243) >>> 0), core: base.core, pattern: base.pattern, accent: hexStr(hueShift(parseInt(base.accent.slice(1), 16), h.hue)), route: base.route,
    look: Object.assign({ hue: h.hue }, ...h.muts.filter((m) => MUTATORS[m].look).map((m) => ({ time: MUTATORS[m].look })), { over: h.look }), zones,
  };
}

const defs = new Map();
// Any map by its number: the six worlds, the generated ones and the holiday ones. Null for none.
export function mapDef(id) {
  if (!Number.isInteger(id) || id < 0) return null;
  if (id < MAPS.length) return MAPS[id];
  if (defs.has(id)) return defs.get(id);
  let d = null;
  if (id >= GEN0 && id < GEN0 + GEN_N) d = genMap(id);
  else { const h = HOLIDAYS.find((x) => x.id === id); if (h) d = holidayMap(h); }
  defs.set(id, d);
  return d;
}
// Every map number there is.
export const ALL_MAP_IDS = [...MAPS.map((m) => m.id), ...Array.from({ length: GEN_N }, (_, i) => GEN0 + i), ...HOLIDAYS.map((h) => h.id)];

// Easter Sunday of a year (the Gregorian rule), as [month, day].
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}
// The holiday on a day (a Date, read in UTC), or null.
export function holidayOn(date) {
  const y = date.getUTCFullYear(), md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  for (const h of HOLIDAYS) {
    let from, to;
    if (h.easter) {
      const [em, ed] = easter(y), t = Date.UTC(y, em - 1, ed), at = (k) => { const x = new Date(t + k * 86400000); return (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
      from = at(-3); to = at(1);
    } else { from = h.from[0] * 100 + h.from[1]; to = h.to[0] * 100 + h.to[1]; }
    if (from <= to ? md >= from && md <= to : md >= from || md <= to) return h;
  }
  return null;
}
// The day's climb: the holiday's on a holiday, otherwise one of the hundred by date. The same everywhere on the same day (UTC).
export function dailyMap(date = new Date()) {
  const h = holidayOn(date);
  if (h) return h.id;
  const day = Math.floor(date.getTime() / 86400000), R = rng((Math.imul(day, 0x27d4eb2d) ^ 0x165667b1) >>> 0);
  R();
  return GEN0 + ((R() * GEN_N) | 0);
}
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
export const mapName = (id) => { const d = mapDef(id); return d ? d.name : ''; };
// The maps to pick from with the arrows: the hundred, and a holiday's while it is on (or when it is the day's climb).
export function genList(date = new Date(), daily = -1) {
  const out = Array.from({ length: GEN_N }, (_, i) => GEN0 + i), h = holidayOn(date);
  for (const x of HOLIDAYS) if ((h && h.id === x.id) || x.id === daily) out.unshift(x.id);
  return out;
}
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

// The hard jumps each map likes (template weights, added to every zone from the second one up, doubled from the fifth):
// long leaps, stepping stones and ledges as high as a jump goes, in a different mix on every map.
const HARD_JUMPS = {
  storm: { highstep: 1.5, tiny: 0.8 },
  sunny: { tiny: 1.5, leap: 1 },
  forest: { leap: 1.5, highstep: 1 },
  volcano: { tiny: 1.2, highstep: 1.2 },
  city: { leap: 1.8, highstep: 0.6 },
  waterfall: { tiny: 1.6, leap: 0.8 },
};

// No shortcuts: how far (edge to edge) a jump with a dash at the end reaches onto something dy higher (movetest.js measures
// the jumps; a dash adds about 1.6 m). From SHORT_UP up nothing is reached. Nothing on the route may be within this of a
// piece more than SHORT_SKIP metres of route earlier, so nobody skips a stretch (dev/shortcuttest.js).
export const SHORT_SKIP = 30, SHORT_UP = 2.4;
const JUMP_REACH = [[-1.5, 6.15], [-1, 5.9], [-0.5, 5.65], [0, 5.4], [0.5, 5.05], [1, 4.65], [1.5, 4.15], [2, 3.45], [SHORT_UP, 0]];
export const shortcutReach = (dy) => {
  if (dy >= SHORT_UP) return 0;
  if (dy <= JUMP_REACH[0][0]) return JUMP_REACH[0][1] + 1.6;
  for (let i = 1; i < JUMP_REACH.length; i++) if (dy <= JUMP_REACH[i][0]) { const [a, ga] = JUMP_REACH[i - 1], [b, gb] = JUMP_REACH[i]; return ga + ((gb - ga) * (dy - a)) / (b - a) + 1.6; }
  return 0;
};
// Footprints you stand on, for the shortcut check: not the space kept round mazes, a whole maze garden (closed, with a roof
// too high to get onto), the hidden ways to relics, or hooks and frames up in the air. Long beams and wide obstacle decks
// count like any platform.
export const standsOn = (q) => !q.guard && !(q.tag === 'maze' && q.rad > 6) && q.h >= 3 && q.tag !== 'secret';

// Height (world y, the floor is at 2) where jumpers start on every difficulty.
const JUMP_ALL = 502;

const PR_TOP = 0.6;
const SIGNS = [
  'Climb to the very top. You are tied together: if one falls, everyone feels it.',
  'Jump across the gaps. Stay close: the cord only reaches so far.',
  'Partner slipping? Hold GRAB to clamp on and hold them up.',
  'Hold REEL to pull the cord in and haul a hanging partner up.',
  'While clamped, hold REEL, then let go: you fling your partner upward.',
  'Fall into the ocean and the team restarts from the last checkpoint.',
];

const PIERS = [0.9, 2.47, 4.04, 5.61], PIER_R0 = 19, PIER_LEN = 13, PIER_W = 1.6;
// Is this spot on a pier (or within m of one)? Each climb turns a pier that would run into something (placePiers).
function onPier(x, z, m = 0, piers = PIERS) {
  return piers.some((a) => {
    const u = x * Math.cos(a) + z * Math.sin(a), v = -x * Math.sin(a) + z * Math.cos(a);
    return u > PIER_R0 - m && u < PIER_R0 + PIER_LEN + m && Math.abs(v) < PIER_W + m;
  });
}

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

// The higher the zone, the smaller the platforms (down to about 1.2 m) and the wider the jumps. Still well inside what
// a jump can do: about 5.4 m on the flat, 4.65 m going up 1 m (measured with the real physics, see dev/movetest.js).
function hardened(z, t) {
  const small = 1 - 0.3 * t, wide = 1 + 0.35 * t, f = (a) => Math.max(1.2, a * small);
  return Object.assign({}, z, { wide, sx: [f(z.sx[0]), f(z.sx[1])], sz: [f(z.sz[0]), f(z.sz[1])], gap: [z.gap[0] * wide, z.gap[1] * wide] });
}

// ---------------------------------------------------------------- maze gardens
// Every checkpoint that is a platform of its own (the one halfway up each zone, and the rooftop pads in the city) is a
// walled garden with a maze in it: N x N cells, the checkpoint in the first cell, the way on out of the far side. It is
// closed: solid all round the outside up to a roof, with a raised edge round the roof, and open only in a doorway at each
// end, so nobody walks round it, jumps or gets thrown over it (a sling reaches about 4.7 m), or sees the way from above;
// inside, the camera goes to the climber's eyes (game.js). The inner walls change every time the team goes back to a
// checkpoint (applyMaze, from game.js), so the way through has to be found again. Every wall is slick: no wall jumps,
// nothing to grab. The pond, trees and animals live on the roof.
export const MAZE_CELL = 2.4, MAZE_WALL_H = 4.4, MAZE_WALL_T = 0.3, MAZE_RIM = 1.6, MAZE_ROOF = 0.5, MAZE_EDGE = 1.1;
// How many legendary relics hide in each map's mazes (relic ids map:m0, map:m1; skins.js says what each one opens).
export const MAZE_RELICS = { storm: 2, sunny: 2, forest: 1, volcano: 2, city: 2, waterfall: 2 };
// The hidden spots: one for every epic thing (relics.js says which), and one for every epic and legendary graffiti. Each map has
// [epic spots, legendary spots]. A spot is only there on one difficulty, so every difficulty hides different ones: some at the
// end of a hidden course (the harder the difficulty, the longer), some in a corner of a maze garden, and the legendary ones at
// the end of a long course of their own.
export const HIDE = { storm: [17, 2], sunny: [17, 2], forest: [17, 2], volcano: [16, 2], city: [19, 2], waterfall: [14, 2] };
const HIDE_MAPS = ['storm', 'sunny', 'forest', 'volcano', 'city', 'waterfall'];
// Every hidden spot of a map: j its number, id its relic (map:h0, map:h1 ...), dv the one difficulty it is there on, maze if it is
// in a maze garden, legend if it is a legendary one.
export function hideSpots(key) {
  const [E, G] = HIDE[key] || [0, 0], m = Math.max(0, HIDE_MAPS.indexOf(key)), out = [];
  for (let j = 0; j < E + G; j++) {
    const legend = j >= E;
    out.push({ j, id: key + ':h' + j, dv: legend ? (m + 2 + 2 * (j - E)) % 4 : j % 4, maze: !legend && Math.floor(j / 4) % 2 === 1, legend });
  }
  return out;
}

// Edges of an N x N maze: first the N - 1 walls inside each row (between cell i and i + 1), row by row, then the N walls
// between each row and the next. Cells are numbered j * N + i.
const edgeV = (N, i, j) => j * (N - 1) + i, edgeH = (N, i, j) => N * (N - 1) + j * N + i;
function carveMaze(N, R, start) {
  const walls = new Uint8Array(2 * N * (N - 1)).fill(1), seen = new Uint8Array(N * N), stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1], i = c % N, j = (c - i) / N, opts = [];
    if (i > 0 && !seen[c - 1]) opts.push(c - 1, edgeV(N, i - 1, j));
    if (i < N - 1 && !seen[c + 1]) opts.push(c + 1, edgeV(N, i, j));
    if (j > 0 && !seen[c - N]) opts.push(c - N, edgeH(N, i, j - 1));
    if (j < N - 1 && !seen[c + N]) opts.push(c + N, edgeH(N, i, j));
    if (!opts.length) { stack.pop(); continue; }
    const k = ((R() * (opts.length / 2)) | 0) * 2;
    walls[opts[k + 1]] = 0;
    seen[opts[k]] = 1;
    stack.push(opts[k]);
  }
  return walls;
}
// Steps from cell a to every cell (walking through open edges).
function mazeDist(N, walls, a) {
  const d = new Int16Array(N * N).fill(-1), q = [a];
  d[a] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], i = c % N, j = (c - i) / N;
    const go = (n, e) => { if (!walls[e] && d[n] < 0) { d[n] = d[c] + 1; q.push(n); } };
    if (i > 0) go(c - 1, edgeV(N, i - 1, j));
    if (i < N - 1) go(c + 1, edgeV(N, i, j));
    if (j > 0) go(c - N, edgeH(N, i, j - 1));
    if (j < N - 1) go(c + N, edgeH(N, i, j));
  }
  return d;
}
// Which inner walls stand in variant v of a maze (1 = a wall), by edge. Of many mazes made from the variant, the one
// with the longest way from the checkpoint to the way out: a long winding way, never a quick run along one side.
export function mazeLayout(m, v) {
  if (m.lv === v) return m.lw;
  const N = m.N, R = rng((m.seed ^ Math.imul(v + 1, 0x9e3779b1)) >>> 0), a = m.ej * N + m.ei, b = m.xj * N + m.xi;
  let best = null, bestD = -1;
  for (let k = 0; k < 48; k++) {
    const w = carveMaze(N, R, a), d = mazeDist(N, w, a)[b];
    if (d > bestD) { best = w; bestD = d; }
  }
  m.lv = v; m.lw = best;
  return best;
}
// The way through variant v, as cells [i, j] from the checkpoint's cell to the one by the way out.
export function mazePath(m, v) {
  const N = m.N, w = mazeLayout(m, v), d = mazeDist(N, w, m.ej * N + m.ei), out = [];
  let c = m.xj * N + m.xi;
  while (c >= 0) {
    const i = c % N, j = (c - i) / N;
    out.unshift([i, j]);
    if (d[c] === 0) break;
    let next = -1;
    const step = (n, e) => { if (next < 0 && !w[e] && d[n] === d[c] - 1) next = n; };
    if (i > 0) step(c - 1, edgeV(N, i - 1, j));
    if (i < N - 1) step(c + 1, edgeV(N, i, j));
    if (j > 0) step(c - N, edgeH(N, i, j - 1));
    if (j < N - 1) step(c + N, edgeH(N, i, j));
    c = next;
  }
  return out;
}
// The cell (j * N + i) a point is in.
export function mazeCellAt(m, x, z) {
  const ex = x - m.x, ez = z - m.z, top = m.N - 1;
  const i = clamp(Math.round((ex * m.fx + ez * m.fz) / MAZE_CELL + top / 2), 0, top), j = clamp(Math.round(top / 2 - (ex * m.nx + ez * m.nz) / MAZE_CELL), 0, top);
  return j * m.N + i;
}
// For something in cell c on its way to cell target in variant v: how many steps that is, and the next cell to go to.
export function mazeWay(m, v, c, target, out) {
  if (m.hv !== v || m.ht !== target) { m.hd = mazeDist(m.N, mazeLayout(m, v), target); m.hv = v; m.ht = target; }
  const N = m.N, w = mazeLayout(m, v), d = m.hd, i = c % N, j = (c - i) / N;
  out.steps = d[c];
  out.next = c;
  const step = (n, e) => { if (out.next === c && !w[e] && d[n] === d[c] - 1) out.next = n; };
  if (d[c] > 0) {
    if (i > 0) step(c - 1, edgeV(N, i - 1, j));
    if (i < N - 1) step(c + 1, edgeV(N, i, j));
    if (j > 0) step(c - N, edgeH(N, i, j - 1));
    if (j < N - 1) step(c + N, edgeH(N, i, j));
  }
  return out;
}
// Where a cell's middle is (x, z).
export function mazeCell(m, i, j) {
  const u = (i - (m.N - 1) / 2) * MAZE_CELL, w = ((m.N - 1) / 2 - j) * MAZE_CELL;
  return [m.x + m.fx * u + m.nx * w, m.z + m.fz * u + m.nz * w];
}
// Straight corridors two cells long or more, as [i0, j0, i1, j1], longest first.
function mazeRuns(m, walls) {
  const N = m.N, out = [];
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let i = 1; i <= N; i++) if (i === N || walls[edgeV(N, i - 1, j)]) { if (i - 1 > s) out.push([s, j, i - 1, j]); s = i; }
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = 1; j <= N; j++) if (j === N || walls[edgeH(N, i, j - 1)]) { if (j - 1 > s) out.push([i, s, i, j - 1]); s = j; }
  }
  return out.map((r, k) => [r, k]).sort((a, b) => (b[0][2] - b[0][0] + b[0][3] - b[0][1]) - (a[0][2] - a[0][0] + a[0][3] - a[0][1]) || a[1] - b[1]).map((x) => x[0]);
}
// Puts every maze of a level into variant v: its inner walls, and the creatures onto corridors of the new maze (never the
// one with the checkpoint in it).
export function applyMaze(L, v) {
  for (const m of L.mazes || []) {
    const w = mazeLayout(m, v);
    for (let e = 0; e < m.walls.length; e++) m.walls[e].on = !!w[e];
    if (!m.mons.length) continue;
    const runs = mazeRuns(m, w).filter((r) => !(m.ei >= r[0] && m.ei <= r[2] && m.ej >= r[1] && m.ej <= r[3]));
    const R = rng((m.seed ^ Math.imul(v + 7, 0x85ebca6b)) >>> 0), pickFrom = Math.min(runs.length, 4);
    m.mons.forEach((mi, k) => {
      const mon = L.monsters[mi];
      if (!runs.length) { mon.ax = mon.bx = m.rx; mon.az = mon.bz = m.rz; return; }
      const r = runs[(((R() * pickFrom) | 0) + k * 2) % runs.length], a = mazeCell(m, r[0], r[1]), b = mazeCell(m, r[2], r[3]);
      mon.ax = a[0]; mon.az = a[1]; mon.bx = b[0]; mon.bz = b[1];
      mon.per = 2.2 + (r[2] - r[0] + r[3] - r[1]) * MAZE_CELL * 0.55;
    });
  }
}

// How the relic courses look on each map. The obstacles work the same everywhere: only how they look and what they are called differ.
const COURSE_LOOKS = {
  storm: { c: 0x6a7280, g: 0x3ff0d0, p: 8, e: 0.12, a: { c: 0x4a5260, g: 0x3ff0d0, p: 1, e: 0.3 }, b: { c: 0x4a5260, g: 0xffd040, p: 1, e: 0.3 }, sweep: { c: 0x3a4250, g: 0x7ff8ff, p: 1, s: 'laser' },
    pendulum: { c: 0x3a3e46, g: 0xffd040, p: 1 }, crusher: { c: 0x4a5260, g: 0xffd040, p: 8 }, spikes: { c: 0x7a8290, g: 0x3ff0d0, p: 1 }, ring: { c: 0x3a4250, g: 0x7ff8ff }, comet: { c: 0x3a4250, g: 0xbfe8ff }, well: { c: 0x1a2028, g: 0x3ff0d0 }, windmill: { c: 0x4a5260, g: 0x3ff0d0, p: 1 }, wheel: { c: 0x4a5260, g: 0x3ff0d0, p: 1 } },
  sunny: { c: 0xffffff, g: 0xffb04a, p: 6, e: 0.06, a: { c: 0xd0aa70, g: 0xffc060, p: 3, e: 0.15 }, b: { c: 0xd8c8a0, g: 0xff8a4a, p: 2, e: 0.15 }, sweep: { c: 0xc9a06a, g: 0xffe0a0, p: 3, s: 'laser' },
    pendulum: { c: 0x5a5e66, g: 0xffc060, p: 1, s: 'anchor' }, crusher: { c: 0xe8d8b0, g: 0xff8a4a, p: 2 }, spikes: { c: 0x3a2a4a, g: 0xff5a8a }, ring: { c: 0xd9c49c, g: 0xffd890 }, comet: { c: 0x5a3a20, g: 0xffb060 }, well: { c: 0x0a2a3a, g: 0x3ad0d8 }, windmill: { c: 0xc9a06a, g: 0xffe0a0, p: 3 }, wheel: { c: 0xc9a06a, g: 0xffe0a0, p: 3 } },
  forest: { c: 0xffffff, g: 0x9be564, p: 5, e: 0.05, a: { c: 0x8a6a4a, g: 0x9be564, p: 16, e: 0.15 }, b: { c: 0xffffff, g: 0xd8ff70, p: 13, e: 0.12 }, sweep: { c: 0x6a4a2c, g: 0x9be564, p: 16, s: 'laser' },
    pendulum: { c: 0x8a6a4a, g: 0x9be564, p: 16, s: 'log' }, crusher: { c: 0x8a6a4a, g: 0x9be564, p: 16 }, spikes: { c: 0x4a3a1a, g: 0xb0e050 }, ring: { c: 0x4f7a34, g: 0x9be564 }, comet: { c: 0xc89a3a, g: 0xffc030 }, well: { c: 0x2a3a14, g: 0xb0ff50 }, windmill: { c: 0x8a6a4a, g: 0x9be564, p: 16 }, wheel: { c: 0x8a6a4a, g: 0x9be564, p: 16 } },
  volcano: { c: 0xb09a92, g: 0xff5a2a, p: 7, e: 0.14, a: { c: 0x8a7068, g: 0xff5a2a, p: 7, e: 0.3 }, b: { c: 0x7a6a8e, g: 0xffa040, p: 7, e: 0.3 }, sweep: { c: 0x2a1a16, g: 0xff7a2a, p: 7, s: 'laser' },
    pendulum: { c: 0x4a3a34, g: 0xff5a2a, p: 7, e: 0.5 }, crusher: { c: 0x6a5a54, g: 0xff5a2a, p: 7, e: 0.25 }, spikes: { c: 0x1a1418, g: 0xff7a2a }, ring: { c: 0x2a1a16, g: 0xff7a2a }, comet: { c: 0x2a1410, g: 0xff5a1a }, well: { c: 0x3a1408, g: 0xff4a10 }, windmill: { c: 0x8a7068, g: 0xff5a2a, p: 7, e: 0.25 }, wheel: { c: 0x8a7068, g: 0xff5a2a, p: 7, e: 0.25 } },
  city: { c: 0x8a8e9e, g: 0xff4fd8, p: 12, e: 0.12, a: { c: 0x2a2e38, g: 0xff4fd8, p: 1, e: 0.35 }, b: { c: 0x2a2e38, g: 0x40e0ff, p: 1, e: 0.35 }, sweep: { c: 0x2a2e38, g: 0xff3050, p: 1, s: 'laser' },
    pendulum: { c: 0x2a2e38, g: 0xff4fd8, p: 1 }, crusher: { c: 0x3a3e4a, g: 0xffd040, p: 8 }, spikes: { c: 0x2a2e38, g: 0x40e0ff }, ring: { c: 0x2a2440, g: 0xff4fd8 }, comet: { c: 0x3a3e4a, g: 0x40e0ff }, well: { c: 0x1a1830, g: 0xa060ff }, windmill: { c: 0x2a2440, g: 0xff4fd8, p: 1 }, wheel: { c: 0x2a2440, g: 0xff4fd8, p: 1 } },
  waterfall: { c: 0xffffff, g: 0x7fe8ff, p: 13, e: 0.06, a: { c: 0xb89464, g: 0x7fe8ff, p: 3, e: 0.15 }, b: { c: 0xffffff, g: 0xb0ffe0, p: 13, e: 0.12 }, sweep: { c: 0xb89464, g: 0x7fe8ff, p: 3, s: 'laser' },
    pendulum: { c: 0xffffff, g: 0x7fe8ff, p: 13 }, crusher: { c: 0xffffff, g: 0x7fe8ff, p: 13 }, spikes: { c: 0xe87a6a, g: 0xffa090 }, ring: { c: 0x1a5a8a, g: 0x7fe8ff }, comet: { c: 0x7a7a76, g: 0xbfe0f0 }, well: { c: 0x0a2a3a, g: 0x40c8e0 }, windmill: { c: 0xb89464, g: 0x7fe8ff, p: 3 }, wheel: { c: 0xb89464, g: 0x7fe8ff, p: 3 } },
};
const COURSE_NAMES = {
  storm: { sweep: 'Arc of lightning', pendulum: 'Wrecking ball', crusher: 'Steel press', spikes: 'Live wires', ring: 'Thunder ring', comet: 'Ball lightning', well: 'Eye of the storm', windmill: 'Turbine blade' },
  sunny: { sweep: 'Diving gulls', pendulum: 'Swinging anchor', crusher: 'Stone slab', spikes: 'Sea urchins', ring: 'Sand wave', comet: 'Falling coconut', well: 'Whirlpool', windmill: 'Windmill sail' },
  forest: { sweep: 'Attacking birds', pendulum: 'Swinging log', crusher: 'Falling trunk', spikes: 'Thorns', ring: 'Leaf storm', comet: 'Falling beehive', well: 'Snapping plant', windmill: 'Giant branch' },
  volcano: { sweep: 'Fire bar', pendulum: 'Lava ball', crusher: 'Basalt press', spikes: 'Obsidian spikes', ring: 'Lava wave', comet: 'Lava bomb', well: 'Magma vortex', windmill: 'Burning blade' },
  city: { sweep: 'Security laser', pendulum: 'Wrecking ball', crusher: 'Hydraulic press', spikes: 'Shock spikes', ring: 'Shock pulse', comet: 'Falling drone', well: 'Magnet trap', windmill: 'Neon fan' },
  waterfall: { sweep: 'Water jets', pendulum: 'Swinging boulder', crusher: 'Stone press', spikes: 'Sharp coral', ring: 'Water ring', comet: 'Falling boulder', well: 'Whirlpool', windmill: 'Water wheel blade' },
};

export function generateLevel(mapId = 0) {
  const MAP = mapDef(mapId) || MAPS[0], ZONE_LIST = MAP.zones;
  const R = rng(MAP.seed);
  const rr = (a, b) => a + R() * (b - a);
  const out = {
    map: MAP.id, mapKey: MAP.key, core: MAP.core, pattern: MAP.pattern, gen: !!MAP.gen, name: MAP.name, look: MAP.look || null,
    cols: [], rings: [], decor: [], cps: [], fans: [], rods: [], signs: [], crumbles: [], zones: [],
    anchors: [], doors: [], monsters: [], bats: [], lasers: [], arrows: [], swings: [], trees: [], geysers: [], rocks: [], towers: [],
    obs: [], wells: [], blinks: [], traps: [], bumpers: [], flows: [], jumpers: [], moves: [], hops: [], zips: [], mazes: [],
    plats: 0, spawn: null, summit: null, top: 0,
  };
  const recs = [], buckets = [], usedObs = [], obsZone = [];
  // Where each lift waits at the bottom: only checked against the space kept round the way into a maze garden (see badness).
  const lows = [];
  const TOPS = topObstacles(MAP.key);
  let TAG = 'start';
  let zone = 0, ZD = ZONE_LIST[0], ZW = ZD.tpl, zonePlats = 0, lastY = 2;
  // Route frame: platforms are placed in polar coordinates around (CX, CZ), going round in direction DIR,
  // with centres between BAND.lo (+ half the platform depth) and BAND.hi.
  const ROUTE = MAP.route || 'spiral', MAIN = ROUTE === 'crater' ? { lo: 10.0, hi: 16.5 } : { lo: 7.5, hi: 14.2 };
  // Back and forth in two lanes: long legs round the lighthouse (switchback), short ones up the face of the falls (zigzag).
  const SWITCH = ROUTE === 'switchback' || ROUTE === 'zigzag';
  let CX = 0, CZ = 0, DIR = ROUTE === 'trees' || ROUTE === 'crater' ? -1 : 1, BAND = MAIN, pathLen = 0, lastP = null;
  const intro = { grapple: false, door: false, monster: false, dash: false, chimney: false };

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
  let tallest = HEAD;
  function recBox(x, z, hx, hz, ry, y, h = HEAD) {
    if (h > tallest) tallest = h;
    const q = { x, z, hx, hz, ry, y, h, pl: pathLen, rad: Math.hypot(hx, hz), c: Math.cos(ry), s: Math.sin(ry), tag: TAG };
    recs.push(q);
    // Remember the bucket: a bobbing platform moves its record's height afterwards.
    const k = q.bucket = Math.max(0, Math.floor(y / 4));
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
  // The last maze garden laid, and (while guard looks ahead) the one beside us, which it leaves out.
  let mazeRec = null, besideMaze = null;
  function need(x, z, hx, hz, ry, y) {
    let m = -1e9;
    const a = { x, z, hx, hz, c: Math.cos(ry), s: Math.sin(ry), rad: Math.hypot(hx, hz) };
    const k1 = Math.min(buckets.length - 1, Math.floor((y + HEAD) / 4) + 1);
    for (let k = Math.max(0, Math.floor((y - tallest) / 4)); k <= k1; k++) {
      const B = buckets[k];
      if (!B) continue;
      for (const q of B) {
        if (q.y + q.h <= y || q.y - y >= HEAD || q.y + q.h <= m || q.pl > pathLen - RECENT || q === besideMaze) continue;
        const dx = q.x - x, dz = q.z - z, rr2 = q.rad + a.rad + 0.3;
        if (dx * dx + dz * dz > rr2 * rr2 || !overlap(a, q, 0.3)) continue;
        m = q.y + q.h;
      }
    }
    return m - y;
  }
  const needAt = (th, r, sx, sz, y) => { const [x, z] = polar(th, r); return need(x, z, sx / 2, sz / 2, -(th + Math.PI / 2), y); };
  // How far a footprint at height y must rise not to be a shortcut from route laid long before (see badness).
  function shortNeed(th, r, sx, sz, y) {
    const [x, z] = polar(th, r), ry = -(th + Math.PI / 2), a = { x, z, hx: sx / 2, hz: sz / 2, c: Math.cos(ry), s: Math.sin(ry), rad: Math.hypot(sx, sz) / 2 };
    let m = -1e9;
    for (let k = Math.max(0, Math.floor((y - 4) / 4) - 1); k <= Math.floor((y + 4) / 4) + 1; k++) {
      const B = buckets[k];
      if (!B) continue;
      for (const q of B) {
        if (q.pl >= pathLen - SHORT_SKIP || !standsOn(q) || y - q.y >= SHORT_UP || y - q.y <= -3.5) continue;
        const g = shortcutReach(y - q.y), dx = q.x - x, dz = q.z - z, rr2 = q.rad + a.rad + g;
        if (dx * dx + dz * dz > rr2 * rr2 || !overlap(a, q, g)) continue;
        m = Math.max(m, q.y + SHORT_UP + 0.05 - y);
      }
    }
    return m;
  }

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
  const SAT_D = 27, SAT_TR = 2.6, SIDE_SKIN = 0.12;
  // Side pillars to climb round, away from the core and the other way round: trees in the forest, a lightning
  // pylon on the storm tower, rock stacks by the waterfall (how often: metres of climb between trips).
  const SIDE = { forest: 'tree', storm: 'pylon', waterfall: 'stack' }, SIDE_EVERY = { forest: 34, storm: 58, waterfall: 52 };
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
    legLen = ROUTE === 'zigzag' ? (legN % 2 ? 1.2 : 1.55) + rr(-0.12, 0.12) : (legN % 2 ? 1.9 : 2.7) + rr(-0.2, 0.2);
    legN++;
    sinceTurn = 0;
  }
  // Re-express a placed platform in the current route frame.
  function reframe(p) {
    const th0 = Math.atan2(p.z - CZ, p.x - CX);
    return Object.assign({}, p, { th: th0, r: Math.hypot(p.x - CX, p.z - CZ) });
  }
  // Stepping platforms in a straight line from cur to a landing at (tx, tz), rising to height ty.
  // Does a square footprint (half size h) at height y sit over or under one of the last few pieces of route, too close to
  // stand or jump between them? (Beside one at about the same height is fine.)
  function clashRecent(x, z, h, ry, y, skip) {
    const a = { x, z, hx: h, hz: h, c: Math.cos(ry), s: Math.sin(ry), rad: h * Math.SQRT2 };
    for (let i = recs.length - 1; i >= 0; i--) {
      const q = recs[i];
      if (q.pl < pathLen - RECENT - 4) break;
      if (q === skip || (skip && q.x === skip.x && q.z === skip.z) || Math.abs(q.y - y) < 0.35 || Math.abs(q.y - y) > HEAD) continue;
      const dx = q.x - x, dz = q.z - z, r2 = q.rad + a.rad + 0.3;
      if (dx * dx + dz * dz < r2 * r2 && overlap(a, q, 0.3)) return true;
    }
    return false;
  }
  function walkTo(cur, tx, tz, ty) {
    const dx = tx - cur.x, dz = tz - cur.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, ry = Math.atan2(-uz, ux);
    let at = cur, y = cur.y, ci = 0;
    const left = () => Math.hypot(tx - at.x, tz - at.z);
    // Climbing in place goes round a square: to the side, on, the other side, back. The step right above any step is then
    // four steps (4 m) up, never two: it used to zigzag, and you hit your head on the step above the one you stood on.
    const turns = [[-uz, ux], [ux, uz], [uz, -ux], [-ux, -uz]];
    for (let n = 0; n < 18; n++) {
      const L = left(), vx = (tx - at.x) / L, vz = (tz - at.z) / L, sa = support(at, vx, vz), high = ty - y < 1.1;
      // The landing (3 x 3) comes once the gap to it is jumpable and the height has been reached.
      const gapToLanding = L - sa - 1.5;
      let last = gapToLanding < 2.0 && high, s = last ? 3.0 : rr(2.0, 2.5), off = sa + rr(1.4, 1.9) + s / 2, climb = false, far = false;
      // No room for a whole step before the landing. Still too low: a little staircase up in place first. High enough: a
      // smaller step in the middle, or with no room for that either, the landing, not much higher (that used to climb too).
      if (!last && L - off < 3.5) {
        if (!high) climb = true;
        else if (gapToLanding < 3.4) { last = true; s = 3.0; far = true; }
        else { s = Math.min(s, Math.max(1.6, gapToLanding - 2.2)); off = sa + (gapToLanding - s) / 2 + s / 2; }
      }
      const [cx, cz] = turns[ci % 4];
      if (climb) ci++;
      const coff = support(at, cx, cz) + rr(1.0, 1.3) + s / 2;
      let x = last ? tx : climb ? at.x + cx * coff : at.x + vx * off;
      let z = last ? tz : climb ? at.z + cz * coff : at.z + vz * off;
      const remain = Math.max(1, Math.ceil(L / 4.2));
      const y0 = y;
      y = last ? Math.max(y - 0.4, Math.min(y + (far ? 0.4 : 1.05), ty)) : Math.min(y + 1.05, y + Math.max(-0.4, climb ? 1.0 : (ty - y) / remain));
      // Not right over or under the last few pieces either (the clearance test leaves those out): a step out over the hop
      // just made blocked that jump. Turned a little either way until it is clear.
      if (!last && clashRecent(x, z, s / 2, ry, y, at)) {
        const ox = x - at.x, oz = z - at.z;
        for (const a of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
          const c = Math.cos(a), sn = Math.sin(a), nx = at.x + ox * c - oz * sn, nz = at.z + ox * sn + oz * c;
          if (!clashRecent(nx, nz, s / 2, ry, y, at)) { x = nx; z = nz; break; }
        }
      }
      // Clear of older route when that is still an easy step up.
      const nd = need(x, z, s / 2, s / 2, ry, y);
      if (nd > 0 && (nd <= 0.6 || y + nd - y0 <= 1.3)) y += nd + 0.01;
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
  // A period, shorter for the fast versions (o.fast).
  const pf = (o, a, b) => rr(a, b) / (o.fast || 1);
  // A weight over (x, z) whose lowest point passes 0.6 above fy, swinging along (nx, nz).
  const pend = (o, x, z, fy, nx, nz, per, e) => {
    const big = o.look.big, L = big ? 2.75 : 2.55;
    obPush(o, Object.assign({ prim: 'pendulum', x, y: fy + 0.6 + L, z, fy, nx, nz, L, r: big ? 0.7 : 0.58, amp: 1.05, per, ph: R() }, e));
  };
  // A square platform spinning on the spot (s2 wide, w rad/s either way).
  const spinDeck = (cur, o, s2, w) => {
    const r = Math.max(nextR(cur, s2 * 1.42), BAND.lo + s2 * 0.71);
    const p = plat(thetaFor(cur, rr(1.4, 1.9), r, s2 * 1.42, s2 * 1.42), r, cur.y + rr(-0.1, 0.4), s2, s2, { kind: 'turn', look: o.look, surf: null });
    p.col.dyn = { k: 'turn', a0: p.ry, w: w * (R() < 0.5 ? 1 : -1) };
    recBox(p.x, p.z, s2 * 0.72, s2 * 0.72, 0, p.y);
    return p;
  };
  // A conveyor belt platform (sx range long), running against the way you go (dir -1), with it (1), or either.
  const belt = (cur, o, sxr, dir) => {
    const sx = rr(sxr[0], sxr[1]), sz = rr(2.4, 2.8), r = nextR(cur, sz);
    const p = plat(thetaFor(cur, rr(1.2, 1.7), r, sx, sz), r, cur.y + rr(-0.2, 0.4), sx, sz, { kind: 'conveyor', surf: null, look: o.look });
    const d = dir || (R() < 0.5 ? 1 : -1);
    p.col.conv = { sp: rr(2.2, 2.8) * Math.min(1.2, o.fast || 1) * d * DIR };
    return p;
  };
  // A zipline from a ledge after cur down to a landing beyond a wide gap; nw weights swinging across the ride.
  const zipTo = (cur, o, nw) => {
    const s = T.gap(cur, { size: [rr(2.8, 3.2), rr(2.6, 3.0)], g: rr(1.0, 1.4), dy: rr(0.3, 0.7), surf: null });
    const lx = rr(3.4, 3.8), lz = rr(2.8, 3.2), r = nextR(s, lz), G = rr(9, 11.5);
    const t = plat(thetaFor(s, G, r, lx, lz), r, s.y - rr(0.6, 1.4), lx, lz, { surf: null });
    const b = between(s, t, 0), ux = b.ux, uz = b.uz;
    // The cable: from above the start ledge (a jump grabs it) to 1 m inside the landing, low enough to drop off.
    const ax = s.x + ux * 0.4, az = s.z + uz * 0.4, ay = s.y + 2.9;
    const bx = b.bx + ux * 1.0, bz = b.bz + uz * 1.0, by = t.y + PR_TOP + RIDE_HANG + 0.25;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    // Two posts hold the cable up, on the same straight line: 1 m behind where it can be grabbed, 1.6 m past the end.
    const cx = dx / len, cy = dy / len, cz = dz / len;
    const px0 = ax - cx, py0 = ay - cy, pz0 = az - cz, px1 = bx + cx * 1.6, py1 = by + cy * 1.6, pz1 = bz + cz * 1.6;
    add(makeCyl(px0, (s.y + py0 + 0.15) / 2, pz0, 0.13, (py0 + 0.15 - s.y) / 2), 'post', { look: o.look });
    add(makeCyl(px1, (t.y + py1 + 0.15) / 2, pz1, 0.13, (py1 + 0.15 - t.y) / 2), 'post', { look: o.look });
    out.zips.push({ i: out.zips.length, ax, ay, az, bx, by, bz, ux: cx, uy: cy, uz: cz, len, max: 10 + (o.fast ? 1.5 : 0),
      minx: Math.min(ax, bx) - 1.5, maxx: Math.max(ax, bx) + 1.5, minz: Math.min(az, bz) - 1.5, maxz: Math.max(az, bz) + 1.5,
      px0, py0, pz0, px1, py1, pz1, look: o.look, key: o.key, zone });
    // Nothing may cross where a rider hangs.
    const hl = Math.hypot(bx - ax, bz - az) / 2;
    recBox((ax + bx) / 2, (az + bz) / 2, hl, 1.0, b.ry, by - RIDE_HANG - 0.8, ay - by + RIDE_HANG + 1.8);
    // Weights swinging across the ride, at the height a rider hangs there.
    for (let k = 0; k < nw; k++) {
      const f = nw === 1 ? 0.5 : 0.35 + (0.3 * k) / (nw - 1), x = ax + dx * f, z = az + dz * f, hy = ay + dy * f - RIDE_HANG;
      pend(o, x, z, hy - 0.6, -uz, ux, pf(o, 2.4, 2.9), { ph: k * 0.5 + R() * 0.1 });
    }
    if (!intro.zip) { intro.zip = true; sign(s, 'A zipline! Jump up into the cable to grab it. JUMP lets go.'); }
    return t;
  };
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
    // ---------- the hardest ----------
    // Two things running opposite ways along a narrow bridge: jump one, then the other.
    sawrun(cur, o) {
      const nxt = T.beam(cur, { len: rr(9, 10), w: 0.95, rise: 0 });
      const b = between(cur, nxt, 0.25), half = Math.hypot(b.bx - b.ax, b.bz - b.az) / 2, sh = o.look.s, per = rr(2.4, 2.9);
      for (const ph of [0, 0.5]) {
        obPush(o, { prim: 'slider', shape: sh, x: (b.ax + b.bx) / 2, y: cur.y, z: (b.az + b.bz) / 2, ux: b.ux, uz: b.uz, a: -(half - 0.4), b: half - 0.4,
          r: sh === 'ball' ? 0.5 : sh === 'disc' ? 0.6 : 0.36, w: 1.15, per, ph, ry: b.ry });
      }
      return nxt;
    },
    // A very long bridge with three weights swinging fast.
    triplegaunt(cur, o) {
      const nxt = T.beam(cur, { len: rr(11, 12), w: 1.0, rise: rr(0, 0.3) });
      const b = between(cur, nxt, 0.25), L = 2.55, per = rr(1.9, 2.3);
      [1 / 4, 2 / 4, 3 / 4].forEach((f, k) => {
        const fy = cur.y + (nxt.y - cur.y) * f;
        obPush(o, { prim: 'pendulum', x: b.ax + (b.bx - b.ax) * f, y: fy + 0.6 + L, z: b.az + (b.bz - b.az) * f, fy, nx: -b.uz, nz: b.ux, L, r: 0.58, amp: 1.1, per, ph: k * 0.33 });
      });
      return nxt;
    },
    // A long platform whose spikes pop up in a wave along it, the way you're going: run with the gap.
    spikewave(cur, o) {
      const p = wide(cur, [8.0, 8.8], [2.3, 2.6]), A = axes(p), per = rr(2.2, 2.6), n = 5, w = p.sx / n;
      // The strip nearest to where you come from goes first.
      const dir = (cur.x - p.x) * A.ax + (cur.z - p.z) * A.az > 0 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const off = dir * (k - (n - 1) / 2) * w;
        obPush(o, { prim: 'spikes', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hx: w / 2 - 0.05, hz: p.sz / 2 - 0.2, ry: p.ry, per, ph: 1 - k / n, duty: 0.55 });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // Four presses slamming fast in a row down a narrow platform.
    pressgaps(cur, o) {
      const p = wide(cur, [8.8, 9.4], [2.4, 2.6]), A = axes(p), per = rr(2.2, 2.5);
      for (let k = 0; k < 4; k++) {
        const off = (k - 1.5) * 2.2;
        obPush(o, { prim: 'crusher', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hs: 0.85, per, ph: k / 4, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // Three jets across a bridge, taking turns.
    jetladder(cur, o) {
      const nxt = T.beam(cur, { len: rr(10, 11), w: 0.95, rise: rr(0, 0.4) });
      const b = between(cur, nxt, 0.25), per = rr(2.2, 2.6);
      [1 / 4, 2 / 4, 3 / 4].forEach((f, k) => {
        const mx = b.ax + (b.bx - b.ax) * f, mz = b.az + (b.bz - b.az) * f, my = cur.y + (nxt.y - cur.y) * f;
        let nx = -b.uz, nz = b.ux;
        if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
        const ex = mx + nx * 2.3, ez = mz + nz * 2.3;
        add(makeCyl(ex, my - 0.3, ez, 0.16, 0.9), 'post');
        obPush(o, { prim: 'jet', x: ex, y: my + 0.75, z: ez, dx: -nx, dz: -nz, range: 4.6, per, ph: k / 3, duty: 0.5 });
      });
      return nxt;
    },
    // Six tiny platforms fading out fast, one after another.
    blinkrace(cur, o) {
      for (let k = 0; k < 6; k++) {
        const s2 = rr(1.4, 1.7), r = nextR(cur, s2);
        cur = plat(thetaFor(cur, rr(1.4, 2.0), r, s2, s2), r, cur.y + rr(-0.1, 0.4), s2, s2, { kind: 'blink', look: o.look });
        cur.col.blink = { per: 2.8, ph: 1 - k * 0.14, duty: 0.6, lvl: o.lvl, key: o.key };
        out.blinks.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // Four small trapdoors in a row: don't stop on any of them.
    trapchain(cur, o) {
      for (let k = 0; k < 4; k++) {
        const sx = rr(1.8, 2.2), sz = rr(1.8, 2.2), r = nextR(cur, sz);
        cur = plat(thetaFor(cur, rr(1.3, 1.9), r, sx, sz), r, cur.y + rr(-0.1, 0.4), sx, sz, { kind: 'trap', look: o.look });
        cur.col.trap = { per: rr(3.0, 3.4), ph: k * 0.25, open: 1.1, lvl: o.lvl, key: o.key };
        out.traps.push(cur.col);
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // Two sets of bars spinning opposite ways on one long platform.
    twinsweep(cur, o) {
      const p = wide(cur, [8.8, 9.6], [3.8, 4.2]), A = axes(p), sg = R() < 0.5 ? 1 : -1, per = rr(2.2, 2.8);
      [-1, 1].forEach((k) => {
        const off = k * p.sx / 4, x = p.x + A.ax * off, z = p.z + A.az * off;
        add(makeCyl(x, p.y + 0.3, z, 0.18, 0.3), 'post');
        obPush(o, { prim: 'sweep', x, y: p.y + 0.5, z, len: Math.min(p.sx / 4, p.sz / 2) - 0.1, n: 2, per: per * sg * k, ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      });
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // A dash gap with a weight swinging through the middle of the flight.
    dashswing(cur, o) {
      const land = T.dashgap(cur), m = out.moves[out.moves.length - 1], fy = m.ay + 1.0, L = 2.55, h = m.sa + m.g * 0.5;
      obPush(o, { prim: 'pendulum', x: m.ax + m.ux * h, y: fy + 0.6 + L, z: m.az + m.uz * h, fy, nx: -m.uz, nz: m.ux, L, r: 0.58, amp: 1.1, per: rr(2.2, 2.6), ph: R() });
      return land;
    },
    // A wall jump shaft with jets firing across it, one high and one low, taking turns.
    kickjets(cur, o) {
      const top = T.chimney(cur), m = out.moves[out.moves.length - 1], per = rr(2.4, 2.8);
      // They fire out of the back panel, blowing you out of the open front.
      [0.38, 0.68].forEach((f, k) => obPush(o, { prim: 'jet', x: m.x - m.ox * (m.deep / 2), y: m.y + m.H * f, z: m.z - m.oz * (m.deep / 2), dx: m.ox, dz: m.oz, range: m.deep + 0.4, per, ph: k * 0.5, duty: 0.45 }));
      return top;
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
    // ---------- mixes: two kinds of trouble at once (4.10.5) ----------
    // A wide jump with a weight swinging through the gap at jump height.
    swingstep(cur, o) {
      const p = wide(cur, [3.0, 3.6], [2.8, 3.2]);
      const q = T.gap(p, { size: [rr(3.0, 3.6), rr(2.8, 3.2)], g: rr(1.9, 2.3), dy: rr(-0.1, 0.3) });
      const b = between(p, q, 0), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, fy = Math.max(p.y, q.y) + 0.9;
      pend(o, mx, mz, fy, -b.uz, b.ux, pf(o, 2.4, 3.0));
      recBox(mx, mz, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 0.3, 2.6, b.ry, fy - 0.9);
      return T.gap(q, { g: rr(1.3, 1.8) });
    },
    // Small steps up, each with spikes that pop up in turn: hop on as the one ahead goes quiet.
    spikesteps(cur, o) {
      const per = pf(o, 3.0, 3.4), n = o.n || 3;
      for (let k = 0; k < n; k++) {
        const s2 = rr(2.2, 2.5);
        cur = T.gap(cur, { size: [s2, s2], g: rr(1.0, 1.4), dy: rr(0.3, 0.7), surf: null });
        obPush(o, { prim: 'spikes', x: cur.x, y: cur.y, z: cur.z, hx: s2 / 2 - 0.2, hz: s2 / 2 - 0.2, ry: cur.ry, per, ph: 1 - k / n, duty: 0.4 });
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // A long wide platform with two things running along it in two lanes, crossing in the middle.
    sawlanes(cur, o) {
      const p = wide(cur, [6.2, 7.0], [3.4, 3.8]), A = axes(p), sh = o.look.s, per = pf(o, 3.2, 4.0);
      for (const k of [-1, 1]) {
        obPush(o, { prim: 'slider', shape: sh, x: p.x + A.bx * k * 0.85, y: p.y, z: p.z + A.bz * k * 0.85, ux: A.ax, uz: A.az, a: -(p.sx / 2 - 0.8), b: p.sx / 2 - 0.8,
          r: sh === 'ball' ? 0.55 : 0.6, w: 1, per, ph: k < 0 ? 0 : 0.5, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // A long platform with rams shoving across from both sides, taking turns.
    ramrow(cur, o) {
      const n = o.n || 2, p = wide(cur, n > 2 ? [8.4, 9.0] : [6.2, 6.8], [2.8, 3.2]), A = axes(p), per = pf(o, 3.0, 3.6);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 2.6, s = k % 2 ? -1 : 1;
        obPush(o, { prim: 'slider', shape: 'ram', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, ux: A.ax, uz: A.az, vx: A.bx * s, vz: A.bz * s,
          a: -(p.sz / 2 + 0.35), b: p.sz * 0.2, len: 1.3, per, ph: k / n, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // A flat bridge with presses slamming down on it, one after another.
    pressbridge(cur, o) {
      const n = o.n || 2, nxt = T.beam(cur, { len: n > 2 ? rr(9, 10) : rr(7, 8), w: 1.2, rise: 0 }), b = between(cur, nxt, 0.25), per = pf(o, 2.8, 3.4);
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / (n + 1);
        obPush(o, { prim: 'crusher', x: b.ax + (b.bx - b.ax) * f, y: cur.y + (nxt.y - cur.y) * f, z: b.az + (b.bz - b.az) * f, hs: 0.75, per, ph: k / n, ry: b.ry });
      }
      return nxt;
    },
    // A ramp up with things rolling down it at you: jump them on the way up.
    rollramp(cur, o) {
      const nxt = T.beam(cur, { len: rr(6.5, 7.5), w: 1.4, rise: rr(1.4, 1.8) });
      const b = between(cur, nxt, 0.25), blen = Math.hypot(b.bx - b.ax, b.bz - b.az), half = blen / 2, sh = o.look.s, per = pf(o, 2.4, 2.9);
      for (let k = 0; k < (o.n || 1); k++) {
        obPush(o, { prim: 'slider', shape: sh, one: 1, x: (b.ax + b.bx) / 2, y: (cur.y + nxt.y) / 2, z: (b.az + b.bz) / 2, ux: b.ux, uz: b.uz,
          a: -(half - 0.3), b: half - 0.3, slope: (nxt.y - cur.y) / blen, r: sh === 'ball' ? 0.5 : sh === 'tube' ? 0.42 : sh === 'disc' ? 0.55 : 0.36, w: 1.3, per, ph: k / (o.n || 1), ry: b.ry });
      }
      return nxt;
    },
    // A spinning platform with a weight swinging across the middle of it.
    turnpend(cur, o) {
      const p = spinDeck(cur, o, rr(3.6, 4.0), rr(0.5, 0.8)), A = axes(p);
      pend(o, p.x, p.z, p.y, A.bx, A.bz, pf(o, 2.6, 3.2), { amp: 1.0 });
      return T.gap(Object.assign({}, p, { sx: p.sx * 1.42, sz: p.sz * 1.42 }), { g: rr(1.3, 1.8) });
    },
    // A wide platform with one bar sweeping round the middle and bouncy posts in the safe corners.
    bumpsweep(cur, o) {
      const p = wide(cur, [5.0, 5.6], [4.0, 4.4]), A = axes(p);
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.18, 0.3), 'post');
      obPush(o, { prim: 'sweep', x: p.x, y: p.y + 0.5, z: p.z, len: 1.7, n: o.n || 1, per: pf(o, 2.8, 3.4) * (R() < 0.5 ? 1 : -1), ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      const s = R() < 0.5 ? 1 : -1;
      for (const k of [-1, 1]) {
        const u = k * (p.sx / 2 - 0.75), v = k * s * (p.sz / 2 - 0.75), x = p.x + A.ax * u + A.bx * v, z = p.z + A.az * u + A.bz * v;
        add(makeCyl(x, p.y + 0.45, z, 0.45, 0.45), 'bumper', { look: o.look });
        out.bumpers.push({ x, y: p.y, z, r: 0.45, lvl: o.lvl, key: o.key, look: o.look });
      }
      return T.gap(p, { g: rr(1.3, 1.9) });
    },
    // Sticky ground with a slow bar sweeping round it: the jump is lower in the muck.
    mudsweep(cur, o) {
      const p = T.gap(cur, { size: [rr(4.6, 5.2), rr(3.8, 4.2)], g: rr(1.3, 1.8), dy: rr(-0.2, 0.4), surf: 'mud', look: o.look });
      add(makeCyl(p.x, p.y + 0.3, p.z, 0.18, 0.3), 'post');
      obPush(o, { prim: 'sweep', x: p.x, y: p.y + 0.5, z: p.z, len: Math.min(p.sx, p.sz) / 2 + 0.2, n: 1, per: pf(o, 3.8, 4.6) * (R() < 0.5 ? 1 : -1), ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      return T.gap(p, { g: rr(1.2, 1.5) });
    },
    // A slippery platform whose two halves spike up in turn: hard to stop where you want.
    slickspikes(cur, o) {
      const p = T.gap(cur, { size: [rr(5.0, 5.6), rr(3.0, 3.4)], g: rr(1.3, 1.8), dy: rr(-0.2, 0.4), surf: 'ice', look: o.look }), A = axes(p), per = pf(o, 2.8, 3.4);
      for (const k of [-1, 1]) {
        const off = (k * p.sx) / 4;
        obPush(o, { prim: 'spikes', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hx: p.sx / 4 - 0.15, hz: p.sz / 2 - 0.3, ry: p.ry, per, ph: k < 0 ? 0 : 0.5, duty: 0.4 });
      }
      return T.gap(p, { g: rr(1.3, 1.8) });
    },
    // A dash gap with a blast firing across the middle of the flight.
    dashjet(cur, o) {
      const land = T.dashgap(cur), m = out.moves[out.moves.length - 1], h = m.sa + m.g * 0.5, mx = m.ax + m.ux * h, mz = m.az + m.uz * h, my = m.ay + 0.8;
      let nx = -m.uz, nz = m.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
      const ex = mx + nx * 2.3, ez = mz + nz * 2.3;
      add(makeCyl(ex, my - 0.3, ez, 0.16, 0.9), 'post');
      obPush(o, { prim: 'jet', x: ex, y: my + 0.75, z: ez, dx: -nx, dz: -nz, range: 4.6, per: pf(o, 2.6, 3.0), ph: R(), duty: 0.45 });
      return land;
    },
    // Steps up with blasts firing across them, taking turns (the middle step is calm unless there are three).
    jetstairs(cur, o) {
      const per = pf(o, 2.6, 3.0), all = (o.n || 2) > 2;
      for (let k = 0; k < 3; k++) {
        const sx = rr(2.0, 2.4), sz = rr(2.0, 2.4);
        cur = T.gap(cur, { size: [sx, sz], g: rr(0.9, 1.3), dy: rr(0.6, 0.9), surf: null });
        if (k === 1 && !all) continue;
        let nx = Math.sin(cur.ry), nz = Math.cos(cur.ry);
        if (nx * (cur.x - CX) + nz * (cur.z - CZ) < 0) { nx = -nx; nz = -nz; }
        const ex = cur.x + nx * (sz / 2 + 1.2), ez = cur.z + nz * (sz / 2 + 1.2);
        add(makeCyl(ex, cur.y - 0.3, ez, 0.16, 0.9), 'post');
        obPush(o, { prim: 'jet', x: ex, y: cur.y + 0.75, z: ez, dx: -nx, dz: -nz, range: sz + 2.0, per, ph: all ? k / 3 : k ? 0.5 : 0, duty: 0.45 });
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // Fading platforms with a weight swinging through the last gap: wait for it, but not too long.
    blinkswing(cur, o) {
      let prev = cur;
      const per = pf(o, 3.6, 3.6);
      for (let k = 0; k < 3; k++) {
        const s2 = rr(2.0, 2.3), r = nextR(cur, s2);
        prev = cur;
        cur = plat(thetaFor(cur, k === 2 ? rr(1.9, 2.3) : rr(1.2, 1.6), r, s2, s2), r, cur.y + rr(-0.1, 0.4), s2, s2, { kind: 'blink', look: o.look });
        cur.col.blink = { per, ph: k * 0.27, duty: 0.66, lvl: o.lvl, key: o.key };
        out.blinks.push(cur.col);
      }
      const b = between(prev, cur, 0), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, fy = Math.max(prev.y, cur.y) + 0.9;
      pend(o, mx, mz, fy, -b.uz, b.ux, pf(o, 2.4, 2.8));
      recBox(mx, mz, Math.hypot(b.bx - b.ax, b.bz - b.az) / 2 + 0.3, 2.6, b.ry, fy - 0.9);
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // A bridge with long bars spinning round a post beside it, sweeping across: jump them.
    sidesweep(cur, o) {
      const nxt = T.beam(cur, { len: rr(6.5, 7.5), w: 1.1, rise: 0 });
      const b = between(cur, nxt, 0.25), mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2, my = (cur.y + nxt.y) / 2;
      let nx = -b.uz, nz = b.ux;
      if (nx * (mx - CX) + nz * (mz - CZ) < 0) { nx = -nx; nz = -nz; }
      const px = mx + nx * 1.5, pz = mz + nz * 1.5;
      add(makeCyl(px, my - 0.2, pz, 0.2, 0.8), 'post');
      recBox(px, pz, 3.1, 3.1, 0, my);
      obPush(o, { prim: 'sweep', x: px, y: my + 0.5, z: pz, len: 3.0, n: o.n || 1, per: pf(o, 2.8, 3.4) * (R() < 0.5 ? 1 : -1), ph: R(), w: o.look.s === 'bar' ? 0.13 : 0.06 });
      return nxt;
    },
    // A spinning platform with a press slamming its middle: ride round the edge.
    pressturn(cur, o) {
      const p = spinDeck(cur, o, rr(3.6, 4.0), rr(0.6, 0.9));
      obPush(o, { prim: 'crusher', x: p.x, y: p.y, z: p.z, hs: 0.8, per: pf(o, 2.8, 3.4), ph: R(), ry: p.ry });
      return T.gap(Object.assign({}, p, { sx: p.sx * 1.42, sz: p.sz * 1.42 }), { g: rr(1.3, 1.8) });
    },
    // A long bridge with one weight swinging across it and one swinging along it.
    pendcross(cur, o) {
      const nxt = T.beam(cur, { len: rr(8.5, 9.5), w: 1.1, rise: rr(0, 0.3) }), b = between(cur, nxt, 0.25), per = pf(o, 2.6, 3.0);
      const at = (f) => [b.ax + (b.bx - b.ax) * f, b.az + (b.bz - b.az) * f, cur.y + (nxt.y - cur.y) * f];
      const [x1, z1, y1] = at(0.3), [x2, z2, y2] = at(0.68);
      pend(o, x1, z1, y1, -b.uz, b.ux, per, { ph: 0 });
      pend(o, x2, z2, y2, b.ux, b.uz, per, { ph: 0.25 });
      return nxt;
    },
    // A narrow bridge in strips whose spikes pop up every other one: hop from quiet strip to quiet strip.
    spikebridge(cur, o) {
      const n = o.n || 4, nxt = T.beam(cur, { len: n > 4 ? rr(8.5, 9.5) : rr(7, 8), w: 1.2, rise: 0 }), b = between(cur, nxt, 0.25);
      const blen = Math.hypot(b.bx - b.ax, b.bz - b.az), seg = blen / n, per = pf(o, 2.8, 3.2);
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        obPush(o, { prim: 'spikes', x: b.ax + (b.bx - b.ax) * f, y: cur.y + (nxt.y - cur.y) * f, z: b.az + (b.bz - b.az) * f, hx: seg / 2 - 0.08, hz: 0.5, ry: b.ry, per, ph: k % 2 ? 0.5 : 0, duty: 0.4 });
      }
      return nxt;
    },
    // Big steps up, each under a press, slamming one after another.
    pressstairs(cur, o) {
      const per = pf(o, 3.0, 3.4), n = o.n || 3;
      for (let k = 0; k < n; k++) {
        const s2 = rr(2.4, 2.7);
        cur = T.gap(cur, { size: [s2, s2], g: rr(1.0, 1.4), dy: rr(0.4, 0.8), surf: null });
        obPush(o, { prim: 'crusher', x: cur.x, y: cur.y, z: cur.z, hs: s2 / 2 - 0.3, per, ph: k / n, ry: cur.ry });
      }
      return T.gap(cur, { g: rr(1.3, 1.8) });
    },
    // ---------- ziplines (forest vines, city cables, pirate rigging, ropes over the falls) ----------
    // Up two steps to a ledge, then a cable down over a gap far too wide to jump: jump up into it to grab on, ride
    // it down and drop off onto the landing (JUMP lets go early). o.n weights swing across the cable on the way.
    zipline(cur, o) {
      return zipTo(T.stairs(cur, 2), o, o.n || 0);
    },
    // Two in a row: from the first landing, straight up into the next cable.
    zipchain(cur, o) {
      return zipTo(zipTo(T.stairs(cur, 2), o, 0), o, o.n || 0);
    },
    // ---------- conveyor belts ----------
    // A long belt running against you (or with you) with presses slamming down on it.
    beltpress(cur, o) {
      const n = o.n || 2, p = belt(cur, o, n > 2 ? [8.6, 9.2] : [7.0, 7.6]), A = axes(p), per = pf(o, 2.8, 3.2);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 2.4;
        obPush(o, { prim: 'crusher', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hs: 0.8, per, ph: k / n, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.8) });
    },
    // A belt carrying you back toward the start, with saws running along it: walk against it and jump them.
    beltsaw(cur, o) {
      const p = belt(cur, o, [7.0, 7.6], -1), A = axes(p), sh = o.look.s, n = o.n || 1, per = pf(o, 3.0, 3.6);
      for (let k = 0; k < n; k++) {
        obPush(o, { prim: 'slider', shape: sh, x: p.x, y: p.y, z: p.z, ux: A.ax, uz: A.az, a: -(p.sx / 2 - 0.8), b: p.sx / 2 - 0.8,
          r: sh === 'ball' ? 0.5 : 0.55, w: p.sz * 0.9, per, ph: k / n, ry: p.ry });
      }
      return T.gap(p, { g: rr(1.3, 1.8) });
    },
    // A belt with spikes popping up along it in a wave the way the belt runs.
    beltspikes(cur, o) {
      const p = belt(cur, o, [7.2, 7.8], 1), A = axes(p), n = 4, w = p.sx / n, per = pf(o, 2.6, 3.0);
      const dir = (cur.x - p.x) * A.ax + (cur.z - p.z) * A.az > 0 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const off = dir * (k - (n - 1) / 2) * w;
        obPush(o, { prim: 'spikes', x: p.x + A.ax * off, y: p.y, z: p.z + A.az * off, hx: w / 2 - 0.05, hz: p.sz / 2 - 0.2, ry: p.ry, per, ph: 1 - k / n, duty: 0.4 });
      }
      return T.gap(p, { g: rr(1.3, 1.8) });
    },
    // A swinging platform to ride over a gap too wide to jump (vines, hammocks, buckets on a rope).
    swingride(cur, o) {
      const nxt = T.swing(cur), sw = out.swings[out.swings.length - 1];
      if (sw) { sw.look = o.look; sw.col.look = o.look; }
      return nxt;
    },
    drop: (cur, o) => T.rocks(cur, o),
    shooter: (cur, o) => T.arrows(cur, o),
    flyer: (cur, o) => T.bats(cur, o),
    vent: (cur, o) => T.geyser(cur, o),
    gate: (cur, o) => T.gate(cur, o),
  };
  // Mechanics that fit round a small side tree (no long bridges).
  const SMALL_OK = new Set(['sweep', 'crusher', 'spikes', 'turntable', 'bumpers', 'mud', 'slick', 'drop', 'trapdoor', 'vent', 'blink', 'checker', 'spinsweep',
    'spikesteps', 'turnpend', 'bumpsweep', 'mudsweep', 'slickspikes', 'pressturn', 'pressstairs']);

  // ---------- templates ----------
  const T0 = {
    gap(cur, o = {}) {
      const [sx, sz] = o.size || size();
      // The short hops that tie sections together widen with the zone too, but a dash gap is exactly as wide as asked.
      const g = o.g !== undefined ? (o.dash || o.exact ? o.g : o.g * (ZD.wide || 1)) : rr(ZD.gap[0], ZD.gap[1]);
      const dy = o.dy !== undefined ? o.dy : g > 3.2 ? rr(-0.4, 0.45) : g > 2.3 ? rr(-0.3, 0.8) : rr(-0.3, 1.15);
      const r = o.r !== undefined ? o.r : nextR(cur, sz);
      const p = plat(thetaFor(cur, g, r, sx, sz), r, cur.y + dy, sx, sz, o);
      // What the jump really is, for the tests.
      const dx = p.x - cur.x, dz = p.z - cur.z, d = Math.hypot(dx, dz);
      out.hops.push({ g: d - support(cur, dx / d, dz / d) - support(p, dx / d, dz / d), dy: p.y - cur.y, zone, dash: !!o.dash });
      return p;
    },
    // ---------- the hard jumps: each map has its own favourites (HARD_JUMPS) ----------
    // A long running jump: well over 4 m to a small landing, from firm ground. Take off from the very edge.
    leap(cur) {
      const c0 = cur.col;
      if (!c0 || c0.surf || c0.dyn || c0.crumble || c0.blink || c0.trap || c0.conv) cur = T.gap(cur, { surf: null, g: rr(1.2, 1.7), dy: rr(-0.1, 0.3), size: [rr(2.6, 3.0), rr(2.2, 2.6)] });
      // A run up along the route, then the jump.
      cur = T.gap(cur, { surf: null, g: rr(1.2, 1.6), dy: rr(0, 0.3), size: [rr(3.4, 4.0), rr(2.0, 2.4)] });
      const n = zone >= 4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        cur = T.gap(cur, { surf: null, exact: true, g: rr(4.3, 4.7), dy: rr(-0.45, 0.05), size: [rr(1.8, 2.2), rr(1.8, 2.2)] });
        if (i < n - 1) cur = T.gap(cur, { surf: null, g: rr(1.0, 1.4), dy: rr(0, 0.3), size: [rr(3.2, 3.8), rr(2.0, 2.4)] });
      }
      return T.gap(cur, { g: rr(1.2, 1.8) });
    },
    // Stepping stones: a row of pads hardly bigger than your feet, far apart and up and down. Land, steady, jump again.
    tiny(cur) {
      const n = 4 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const s = rr(1.0, 1.25);
        cur = T.gap(cur, { surf: null, exact: true, g: rr(2.4, 3.2), dy: rr(-0.35, 0.65), size: [s, s] });
      }
      return T.gap(cur, { g: rr(1.3, 1.9), size: [rr(2.6, 3.0), rr(2.4, 2.8)] });
    },
    // Ledges almost as high as a jump goes: only a full jump, held all the way up, gets you onto the next one.
    highstep(cur) {
      const n = 3 + ((R() * 2) | 0);
      for (let i = 0; i < n; i++) cur = T.gap(cur, { surf: null, exact: true, g: rr(1.3, 2.1), dy: rr(1.45, 1.65), size: [rr(2.0, 2.4), rr(1.8, 2.2)] });
      return T.gap(cur, { g: rr(1.2, 1.8), dy: rr(-0.2, 0.3) });
    },
    // Too wide for a jump (the furthest one clears about 5.4 m on the flat): jump, then DASH in the air.
    dashgap(cur) {
      // Taken off from firm, still ground: first a plain hop if this is mud, ice, or something that moves or falls.
      const c0 = cur.col;
      if (!c0 || c0.surf || c0.dyn || c0.crumble || c0.blink || c0.trap || c0.conv) cur = T.gap(cur, { surf: null, g: rr(1.2, 1.8), dy: rr(-0.1, 0.3), size: [rr(2.4, 2.8), rr(2.2, 2.6)] });
      const land = T.gap(cur, { g: rr(5.7, 6.3), dy: rr(-0.25, 0.2), size: [rr(2.8, 3.4), rr(2.6, 3.0)], surf: null, dash: true });
      const dx = land.x - cur.x, dz = land.z - cur.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
      // Glowing arrows in the air show the way across.
      const sa = support(cur, ux, uz), sb = support(land, ux, uz), g = d - sa - sb;
      for (const f of [0.28, 0.5, 0.72]) {
        const h = sa + g * f;
        out.decor.push({ k: 'chev', x: cur.x + ux * h, y: cur.y + (land.y - cur.y) * f + 1.5, z: cur.z + uz * h, ux, uz });
      }
      out.moves.push({ k: 'dash', ax: cur.x, ay: cur.y, az: cur.z, bx: land.x, by: land.y, bz: land.z, ux, uz, sa, g, zone });
      if (!intro.dash) { intro.dash = true; sign(cur, 'Too far to jump? Jump, then press DASH in the air.'); }
      return land;
    },
    // Two walls facing each other, too high to jump: bounce up between them with wall jumps. The shaft stands open
    // toward where the camera looks from, so you see both walls with the climber between them: an open floor in
    // front to arrive on, then the walls left and right along the route, a back panel, and the way out over the far wall.
    // The far wall is lower. One bounce gains at most 1.8 m, so whatever rhythm you bounce in, you touch the tall wall
    // low enough to kick off it and clear the low one. With equal walls some rhythms fly over the wrong wall.
    chimney(cur, short) {
      const W = 3.1, t = 0.5, deep = 3.0, front = 2.0, F = short ? 4 : rr(5, 7.4), H = F + 2.4;
      const side = ROUTE === 'crater' ? -1 : 1, sx = W + t * 2, sz = deep + front;
      // Arrive straight onto the open floor: if the route is off to one side of it, first a hop across.
      const want = cur.r - side * (sz / 2 - front / 2), lo = side > 0 ? BAND.lo + deep : BAND.lo + sz / 2, hi = side > 0 ? BAND.hi : BAND.hi - deep;
      const rf = clamp(want, lo, Math.max(lo, hi)), open = rf + side * (sz / 2 - front / 2);
      if (Math.abs(open - cur.r) > 1.0) cur = T.gap(cur, { r: open, g: rr(1.0, 1.4), dy: rr(0, 0.3), size: [2.4, 2.2], surf: null });
      const from = cur, floor = T.gap(cur, { size: [sx, sz], r: rf, g: rr(0.8, 1.1), dy: rr(-0.1, 0.25), surf: null });
      const y = floor.y, ox = Math.cos(floor.th) * side, oz = Math.sin(floor.th) * side, ux = -Math.sin(floor.th) * DIR, uz = Math.cos(floor.th) * DIR;
      // The middle of the shaft, on the back part of the floor.
      const back = sz / 2 - deep / 2, cx = floor.x - ox * back, cz = floor.z - oz * back;
      for (const s of [-1, 1]) {
        const o = s * (W / 2 + t / 2), wh = s > 0 ? F : H;
        add(makeBox(cx + ux * o, y + wh / 2, cz + uz * o, t / 2, wh / 2, deep / 2, 0, floor.ry, 0), 'wall', { surf: null, kick: true });
        // Glowing rungs on the inside of each wall.
        for (let h = 1.4; h < wh - 0.3; h += 1.6) out.decor.push({ k: 'rung', x: cx + ux * s * (W / 2 - 0.02), y: y + h, z: cz + uz * s * (W / 2 - 0.02), ry: floor.ry + Math.PI / 2, s: deep * 0.7 });
      }
      add(makeBox(cx - ox * (deep / 2 + t / 2), y + H / 2 - 0.35, cz - oz * (deep / 2 + t / 2), sx / 2, H / 2 + 0.35, t / 2, 0, floor.ry, 0), 'wall', { surf: null, kick: true });
      // Nothing else may come through the shaft.
      recBox(cx, cz, sx / 2, deep / 2 + t, floor.ry, y, H + 1.6);
      // The way out lies beyond the low wall and a little below its top: clear the wall and you land on it.
      const ex = rr(2.8, 3.2), ez = rr(2.8, 3.2), d = W / 2 + t + ex / 2 + 0.05, tx = cx + ux * d - CX, tz = cz + uz * d - CZ;
      const top = plat(Math.atan2(tz, tx), Math.hypot(tx, tz), y + F - 1, ex, ez, { surf: null });
      floor.col.shaft = top.col.shaft = true;
      out.moves.push({ k: 'chimney', x: cx, y, z: cz, nx: ux, nz: uz, ox, oz, H, F, W, deep, fx: floor.x + ox * (sz / 2 - front / 2), fz: floor.z + oz * (sz / 2 - front / 2), ax: from.x, ay: from.y, az: from.z, tx: top.x, ty: top.y, tz: top.z, zone });
      if (!intro.chimney) { intro.chimney = true; sign(floor, 'Walls too high? Jump at one and press JUMP again as you touch it. Bounce from wall to wall and out over the lower one.'); }
      return top;
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
      // The hub sits on the straight line between two platforms, further in than they are: leave room for the arms there.
      const armL = rr(3.4, 4.0), [sx, sz] = size();
      let r = Math.max(nextR(cur, sz), CORE_R + armL + 1.6);
      r /= Math.cos(Math.min(1, (armL + 0.85 + (cur.sx + sx) / 4) / r));
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
      // Where it waits at the bottom must not come back within reach of the way into a maze garden either.
      lows.push({ x, z, hx: s / 2, hz: s / 2, c: Math.cos(ry), s: Math.sin(ry), rad: s / Math.SQRT2, y: cur.y - 0.3, h: 1.2, pl: pathLen });
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
    // A maze garden for a checkpoint (see MAZE_CELL at the top). It sits like a big square platform with its flat side to the
    // middle the route goes round (on the volcano, inside the crater, it reaches in toward the middle instead): the way in
    // and the way out are both on the side nearest the route. Answers the landing after the way out, or null if it can't
    // be laid out from here. cpo: the checkpoint's options.
    maze(cur, N, cpo, shift = 0) {
      const C = MAZE_CELL, S = N * C, RIM = MAZE_RIM, F = S + 2 * RIM, half = F / 2, H = MAZE_WALL_H, T = MAZE_WALL_T;
      const inward = ROUTE === 'crater', so = inward ? -1 : 1;
      // A landing straight out in front of the way in, one short hop from the porch: the route comes in at an angle, and
      // this keeps the platform before it clear of the garden.
      const sIn = rr(2.3, 2.6), gIn = rr(1.1, 1.4), uIn = S / 2 + RIM + gIn + sIn / 2, wIn = RIM + C / 2;
      // How far the garden's side nearest the route is from the middle the route goes round: so that landing is as far
      // out as we are (shift tries a little further in or out), never into the middle column and, in the crater, never
      // into its wall.
      const wp = Math.sqrt(Math.max(0, cur.r * cur.r - uIn * uIn)) - so * wIn + shift;
      const d0 = inward ? Math.min(MAIN.hi + 1.6, wp)
        : Math.max(ROUTE === 'towers' ? TBAND.lo + 0.2 : Math.max(MAIN.lo, coreRadius(MAP.key, cur.y) + CORE_SKIN + 0.7), wp);
      // A big garden's way in can't be that close to the middle: out to it in short hops first (in, in the crater).
      const rIn = Math.hypot(d0 + so * wIn, uIn), lead = [], pl0 = pathLen;
      for (let q = 0; q < 8 && Math.abs(rIn - cur.r) > 0.9; q++) {
        cur = T0.gap(cur, { r: cur.r + clamp(rIn - cur.r, -2.0, 2.0), g: rr(1.1, 1.5), dy: rr(0, 0.25), size: [rr(2.4, 2.9), rr(2.2, 2.6)], surf: null, nosign: true });
        lead.push(cur);
      }
      // f: the way the route goes; n: toward the route's side of the garden.
      const frame = (thc) => {
        const rx = Math.cos(thc), rz = Math.sin(thc), dc = d0 + so * half, fx = -rz * DIR, fz = rx * DIR;
        return { x: CX + rx * dc, z: CZ + rz * dc, fx, fz, nx: -rx * so, nz: -rz * so, ry: Math.atan2(-fz, fx) };
      };
      const at = (f, u, w) => [f.x + f.fx * u + f.nx * w, f.z + f.fz * u + f.nz * w];
      const rowW = (j) => ((N - 1) / 2 - j) * C;
      const je = 0, jx = N > 4 && R() < 0.5 ? 1 : 0;
      const landIn = (f) => { const [x, z] = at(f, -uIn, rowW(je)); return { x, z, ry: f.ry, sx: sIn, sz: sIn }; };
      // Turn the garden round the middle until that landing is one hop ahead of where we are.
      const g = rr(1.2, 1.7), hx = -Math.sin(cur.th) * DIR, hz = Math.cos(cur.th) * DIR;
      const gapAt = (thc) => {
        const p = landIn(frame(thc)), dx = p.x - cur.x, dz = p.z - cur.z, d = Math.hypot(dx, dz) || 1e-6;
        if (dx * hx + dz * hz < 0) return -1e3;
        return d - support(cur, dx / d, dz / d) - support(p, dx / d, dz / d);
      };
      let lo = cur.th, hi = cur.th + DIR * 2.6;
      if (gapAt(hi) < g) return null;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (gapAt(mid) < g) lo = mid; else hi = mid; }
      const f = frame((lo + hi) / 2), ry = f.ry;
      // Where we jump from, and the hops out to it, must not reach into it.
      const gbox = { x: f.x, z: f.z, hx: half, hz: half, c: Math.cos(ry), s: Math.sin(ry) };
      for (const q of [cur, ...lead]) {
        const cry = q.ry ?? -(q.th + Math.PI / 2);
        if (overlap({ x: q.x, z: q.z, hx: q.sx / 2, hz: q.sz / 2, c: Math.cos(cry), s: Math.sin(cry) }, gbox, 0.3)) return null;
      }
      const li = landIn(f), lth = Math.atan2(li.z - CZ, li.x - CX);
      const pIn = plat(lth, Math.hypot(li.x - CX, li.z - CZ), cur.y + rr(-0.1, 0.3), sIn, sIn, { dry: ry + lth + Math.PI / 2, nosign: true });
      const y = pIn.y + rr(0, 0.3), k = out.mazes.length;
      const mz = { i: k, N, x: f.x, z: f.z, y, ry, landIn: pIn.col, fx: f.fx, fz: f.fz, nx: f.nx, nz: f.nz, half, ei: 0, ej: je, xi: N - 1, xj: jx, ri: N >> 1, rj: N - 1,
        seed: (Math.imul(MAP.seed, 131) + k * 7919 + 17) >>> 0, zone, walls: [], mons: [], key: MAP.key };
      const box = (u, w, hu, hy, hw, yc, kind, extra) => {
        const [x, z] = at(f, u, w);
        return add(makeBox(x, yc, z, hu, hy, hw, 0, ry, 0), kind, Object.assign({ mz: k }, extra));
      };
      const WALL = { slick: true, solidCam: true, solidRope: false, surf: 'ice' };
      mz.floor = box(0, 0, half, 0.35, half, y - 0.35, 'mfloor', { surf: null });
      const yc = y + H / 2, hl = C / 2 + T / 2;
      for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) mz.walls[edgeV(N, i, j)] = box((i + 1 - N / 2) * C, rowW(j), T / 2, H / 2, hl, yc, 'mwall', WALL);
      for (let j = 0; j < N - 1; j++) for (let i = 0; i < N; i++) mz.walls[edgeH(N, i, j)] = box((i - (N - 1) / 2) * C, rowW(j) - C / 2, hl, H / 2, T / 2, yc, 'mwall', WALL);
      // The outside, each side in as few pieces as it takes to leave the ways in and out open.
      const face = (u, skip) => {
        let a = 0;
        for (let j = 0; j <= N; j++) {
          if (j < N && j !== skip) continue;
          if (j > a) box(u, (rowW(a) + rowW(j - 1)) / 2, T / 2, H / 2, ((j - a) * C) / 2 + T / 2, yc, 'mouter', WALL);
          a = j + 1;
        }
      };
      face(-S / 2, je);
      face(S / 2, jx);
      for (const w of [S / 2, -S / 2]) box(0, w, S / 2 + T / 2, H / 2, T / 2, yc, 'mouter', WALL);
      // Round the outside, solid up to the roof, so nobody walks round it: the two long sides (corners and all), then the
      // two ends, open only in the doorway, as wide as a corridor.
      const e0 = S / 2 + T / 2, rw = (half - e0) / 2, mid = (half + e0) / 2;
      for (const s2 of [-1, 1]) box(0, s2 * mid, half, H / 2, rw, yc, 'mrim', WALL);
      for (const [s2, j] of [[-1, je], [1, jx]]) {
        const lo = rowW(j) - C / 2 + T / 2, hi = rowW(j) + C / 2 - T / 2;
        for (const [a, b] of [[-e0, lo], [hi, e0]]) if (b - a > 0.05) box(s2 * mid, (a + b) / 2, rw, H / 2, (b - a) / 2, yc, 'mrim', WALL);
      }
      // The roof over all of it, doorways too, and a raised edge round the roof: nothing gets in from above or over the top.
      box(0, 0, half, MAZE_ROOF / 2, half, y + H + MAZE_ROOF / 2, 'mroof', WALL);
      const ey = y + H + MAZE_ROOF + MAZE_EDGE / 2, et = 0.18;
      for (const s2 of [-1, 1]) {
        box(0, s2 * (half - et), half, MAZE_EDGE / 2, et, ey, 'mrim', WALL);
        box(s2 * (half - et), 0, et, MAZE_EDGE / 2, half - 2 * et, ey, 'mrim', WALL);
      }
      const [cx, cz] = mazeCell(mz, 0, je);
      checkpoint(Math.atan2(cz - CZ, cx - CX), Math.hypot(cx - CX, cz - CZ), y, Object.assign({ maze: k }, cpo));
      [mz.rx, mz.rz] = mazeCell(mz, mz.ri, mz.rj);
      // Creatures prowl its corridors: a new corridor each time the maze changes (applyMaze).
      for (let q = 0; q < (N >= 8 ? 4 : N >= 6 ? 3 : 2); q++) {
        mz.mons.push(out.monsters.length);
        out.monsters.push({ i: out.monsters.length, ax: mz.rx, az: mz.rz, bx: mz.rx, bz: mz.rz, y: y + 0.65, per: 4, ph: R(), r: 0.6, zone, mz: k });
      }
      out.mazes.push(mz);
      // Nothing may pass over it lower than its roof edge and a head's room above that.
      mazeRec = recBox(f.x, f.z, half, half, ry, y, H + MAZE_ROOF + MAZE_EDGE + HEAD);
      // Nothing later may come back within a jump or a dash of the way here at about its height: that would be a way
      // round. Each piece of it keeps a wide space round it that only the route after the garden has to respect
      // (well above it or well below), never what was there before.
      const before = recs.filter((q) => q.pl >= pl0 - 15 && q !== mazeRec && !q.guard);
      for (const q of before) recBox(q.x, q.z, q.hx + 5, q.hz + 5, Math.atan2(q.s, q.c), q.y - 0.6, 3.4).guard = true;
      // The way through counts as a long piece of route: nothing after it may be within a jump of anything before it.
      pathLen += Math.max(S * 1.6, SHORT_SKIP + 2);
      // The way on: a landing straight out from the far porch.
      const [px, pz] = at(f, S / 2 + RIM / 2, rowW(jx));
      lastP = { x: px, z: pz };
      const s = rr(2.3, 2.7), [lx, lz] = at(f, S / 2 + RIM + rr(1.2, 1.6) + s / 2, rowW(jx)), th = Math.atan2(lz - CZ, lx - CX);
      const land = plat(th, Math.hypot(lx - CX, lz - CZ), y + rr(-0.1, 0.3), s, s, { dry: ry + th + Math.PI / 2, nosign: true });
      mz.land = land.col;
      // The landing is further from the middle than the route usually runs. Back to it in short hops, each only as far in
      // as stays clear of the garden: a piece back in its lane right away would be a long jump, and cut in over the
      // garden's corner (it took a lift up over the roof).
      const lane = (r) => clamp(r, rLo(3), Math.max(rLo(3), BAND.hi));
      const hits = (t, r, hx, hz) => { const [x, z] = polar(t, r), a = -(t + Math.PI / 2); return overlap({ x, z, hx, hz, c: Math.cos(a), s: Math.sin(a) }, gbox, 0.6); };
      const clearAhead = (p) => {
        for (const r of [lane(p.r - 1.6), lane(p.r), lane(p.r + 1.6)]) for (let d = 0; d <= 9; d += 0.5) if (hits(p.th + (DIR * (p.sx / 2 + d)) / r, r, 1.9, 1.7)) return false;
        return true;
      };
      let p = land;
      for (let q = 0; q < 9; q++) {
        const dr = lane(p.r) - p.r;
        if (Math.abs(dr) < 0.9 && clearAhead(p)) break;
        const sx = rr(2.4, 2.9), sz = rr(2.2, 2.6), g2 = rr(1.1, 1.5);
        let r = p.r + clamp(dr, -1.3, 1.3);
        if (hits(thetaFor(p, g2, r, sx, sz), r, sx / 2, sz / 2)) r = p.r;
        p = T0.gap(p, { r, g: g2, dy: rr(0, 0.25), size: [sx, sz], surf: null, nosign: true });
      }
      return p;
    },
    // A wide platform patrolled by a monster that knocks robots off. Time it, GRAB, or SHOOT to stun it.
    monster(cur) {
      const p = T.gap(cur, { size: [rr(5, 6), rr(3.2, 3.8)], g: rr(1.4, 2.2), dy: rr(-0.2, 0.6), nosign: true });
      const ax = Math.cos(p.ry), az = -Math.sin(p.ry), half = p.sx / 2 - 0.9;
      out.monsters.push({ i: out.monsters.length, ax: p.x - ax * half, az: p.z - az * half, bx: p.x + ax * half, bz: p.z + az * half,
        y: p.y + 0.65, per: rr(3.2, 4.6), ph: R(), r: 0.65, zone, cx: p.x, cz: p.z, fx: ax, fz: az, hl: half, hw: p.sz / 2 - 0.6 });
      if (zone === 0 && !intro.monster) { intro.monster = true; sign(p, 'Monsters knock you off. Time it, or SHOOT to paralyse them.'); }
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
      // A side tree grows from the ground only if nothing older stands in its way. Otherwise it floats on its roots,
      // just below where you climb it, so its trunk never runs through the route underneath.
      const baseAt = (x, z) => {
        const a = { x, z, hx: SAT_TR + 1, hz: SAT_TR + 1, c: 1, s: 0, rad: (SAT_TR + 1) * Math.SQRT2 };
        let high = -1e9;
        for (const q of recs) if (Math.hypot(q.x - x, q.z - z) < a.rad + q.rad && overlap(a, q, 0)) high = Math.max(high, q.y + q.h);
        for (const t of out.trees) if (Math.hypot(t.x - x, t.z - z) < SAT_TR + 9) high = Math.max(high, t.top + 9);
        if (high === -1e9) return -2;
        return cur.y - 7 >= high ? cur.y - 7 : null;
      };
      let phi = null, base = -2;
      for (let k = 0; k < 10 && phi === null; k++) {
        const a = cur.th + DIR * (0.25 + k * 0.4), x = Math.cos(a) * SAT_D, z = Math.sin(a) * SAT_D;
        if (!out.trees.every((t) => Math.hypot(t.x - x, t.z - z) > 21 || cur.y > t.top + 10)) continue;
        const b = baseAt(x, z);
        if (b !== null) { phi = a; base = b; }
      }
      if (phi === null) return T.gap(cur);
      const ux = Math.cos(phi), uz = Math.sin(phi), Sx = ux * SAT_D, Sz = uz * SAT_D;
      // Listed from the start so the climb round it stays out of its own trunk; its height is known at the end.
      const tree = { x: Sx, z: Sz, r: SAT_TR, y0: cur.y, base, top: Infinity, zone, kind: SIDE[MAP.key] || 'tree' };
      out.trees.push(tree);
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
      // The tip of the roots has nothing to bump into.
      const low = base > 0 ? base + 2 : base;
      add(makeCyl(Sx, (low + tree.top) / 2, Sz, SAT_TR + SIDE_SKIN, (tree.top - low) / 2), 'trunk');
      // Grown from the ground: a wider foot over the lowest 6 m, solid exactly as drawn (worldview.js).
      if (base <= 0) add(makeCyl(Sx, base + 3, Sz, SAT_TR + SIDE_SKIN, 3, { r1: SAT_TR * 1.35 + SIDE_SKIN }), 'trunk');
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
      const rOut = ROUTE === 'crater' ? rr(18.5, 20) : rr(20, 25.5), a = cur.th + DIR * 0.35, saved = BAND, dir0 = DIR;
      cur = walkTo(cur, Math.cos(a) * rOut, Math.sin(a) * rOut, cur.y + rr(0.5, 1.5));
      cur = reframe(cur);
      BAND = { lo: rOut - 2.2, hi: rOut + 1.2 };
      // Out there it now and then runs back the other way for a while.
      if (!SWITCH && R() < 0.4) DIR = -DIR;
      for (let k = 0, n = 3 + ((R() * 4) | 0); k < n; k++) cur = T[['gap', 'gap', 'pillars', 'bob', 'crumble', 'tilt', 'stairs'][(R() * 7) | 0]](cur);
      DIR = dir0;
      BAND = saved;
      const b = Math.atan2(cur.z, cur.x), r = (BAND.lo + BAND.hi) / 2 + 1;
      cur = walkTo(cur, Math.cos(b) * r, Math.sin(b) * r, cur.y + rr(0.5, 1.2));
      return reframe(cur);
    },
    // Volcano: straight across the crater over the lava, past the middle, to the far wall, then on round from there.
    across(cur) {
      const a = Math.atan2(cur.z, cur.x) + Math.PI + rr(-0.5, 0.5), r = (BAND.lo + BAND.hi) / 2;
      cur = walkTo(cur, Math.cos(a) * r, Math.sin(a) * r, cur.y + rr(1.5, 3));
      return reframe(cur);
    },
    iceslope(cur) {
      return T.beam(cur, { len: rr(6, 7.5), w: 1.3, rise: rr(1.0, 1.4), surf: 'ice' });
    },
  };

  // Every section is checked right after it is placed. If anything in it sits too close above or below
  // older route, the section is undone and the route climbs straight up with a lift instead, so the
  // finished level always keeps its clearances (dev/leveltest.js checks the same rule).
  const LISTS = ['cols', 'rings', 'decor', 'cps', 'fans', 'rods', 'signs', 'crumbles', 'anchors', 'doors', 'monsters', 'bats', 'lasers', 'arrows', 'swings', 'trees', 'geysers', 'rocks', 'obs', 'blinks', 'traps', 'bumpers', 'flows', 'jumpers', 'moves', 'hops', 'zips', 'mazes'];
  function snapshot() {
    const n = {};
    for (const k of LISTS) n[k] = out[k].length;
    return { n, recs: recs.length, lows: lows.length, used: usedObs.length, pathLen, lastP, lastY, zonePlats, plats: out.plats, intro: Object.assign({}, intro),
      CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps };
  }
  function restore(q) {
    for (const k of LISTS) out[k].length = q.n[k];
    for (let i = recs.length - 1; i >= q.recs; i--) {
      const r = recs[i], b = buckets[r.bucket];
      b.splice(b.lastIndexOf(r), 1);
    }
    recs.length = q.recs;
    lows.length = q.lows;
    usedObs.length = q.used;
    obsZone.length = q.used;
    ({ pathLen, lastP, lastY, zonePlats, CX, CZ, DIR, BAND, legStart, legLen, legN, sinceTurn, tower, visitStart, visitLaps } = q);
    out.plats = q.plats;
    Object.assign(intro, q.intro);
  }
  // How far the new footprints (from index `from`, and the new lifts' bottom stops from lowFrom) would have to rise to clear
  // everything older.
  function badness(from, lowFrom = lows.length) {
    let raise = 0;
    for (let i = lowFrom; i < lows.length; i++) {
      const q = lows[i];
      for (let k = Math.max(0, Math.floor((q.y - tallest) / 4) - 1); k <= Math.floor((q.y + HEAD) / 4) + 1; k++) {
        const B = buckets[k];
        if (!B) continue;
        for (const r of B) {
          if (!r.guard || r.pl >= q.pl - RECENT) continue;
          const lo = r.y <= q.y ? r : q, hi = lo === r ? q : r;
          if (hi.y - lo.y >= lo.h - 0.01) continue;
          const dx = r.x - q.x, dz = r.z - q.z, rr2 = r.rad + q.rad;
          if (dx * dx + dz * dz > rr2 * rr2 || !overlap(r, q, 0)) continue;
          raise = Math.max(raise, r.y + r.h - q.y + 0.05);
        }
      }
    }
    for (let i = from; i < recs.length; i++) {
      const q = recs[i];
      // Down as far as the tallest footprint reaches (a wall jump shaft keeps 11 m clear above it), up one HEAD.
      for (let k = Math.max(0, Math.floor((q.y - tallest) / 4) - 1); k <= Math.floor((q.y + HEAD) / 4) + 1; k++) {
        const B = buckets[k];
        if (!B) continue;
        for (const r of B) {
          if (r === q || r.pl >= q.pl - RECENT || q.guard) continue;
          // A shortcut: within a jump (and a dash) of route laid long before, and not high enough above it. Up it goes.
          if (r.pl < q.pl - SHORT_SKIP && q.y - r.y < SHORT_UP && q.y - r.y > -3.5 && standsOn(q) && standsOn(r)) {
            const g = shortcutReach(q.y - r.y), dx = r.x - q.x, dz = r.z - q.z, rr2 = r.rad + q.rad + g;
            if (dx * dx + dz * dz <= rr2 * rr2 && overlap(r, q, g)) raise = Math.max(raise, r.y + SHORT_UP - q.y + 0.05);
          }
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
  // Where a collider can ever be, as [x, z, radius]: its whole top if it stays put, its sweep if it moves.
  function reachOf(c) {
    const d = c.dyn, box = c.t === BOX, rad = box ? Math.hypot(c.hx, c.hz) : c.r, pts = [];
    if (d && d.k === 'turn') return [[c.x, c.z, rad]];
    if (d && d.k === 'orbit') return [[d.hx, d.hz, d.off + c.hx]];
    if (d && d.k === 'pp') { for (let i = 0; i <= 8; i++) pts.push([d.ax + (d.bx - d.ax) * i / 8, d.az + (d.bz - d.az) * i / 8, rad]); return pts; }
    if (d && d.k === 'swing') { const w = d.L * Math.sin(d.amp); for (let i = -4; i <= 4; i++) pts.push([d.px + d.ux * w * i / 4, d.pz + d.uz * w * i / 4, rad]); return pts; }
    if (!box) return [[c.x, c.z, c.r]];
    const m = c.m, nx = Math.max(2, Math.ceil(c.hx / 0.5)), nz = Math.max(2, Math.ceil(c.hz / 0.5));
    for (let i = -nx; i <= nx; i++) for (let j = -nz; j <= nz; j++) {
      const lx = c.hx * i / nx, lz = c.hz * j / nz;
      pts.push([c.x + m[0] * lx + m[6] * lz, c.z + m[2] * lx + m[8] * lz, 0]);
    }
    return pts;
  }
  // Does this piece reach into a tall solid: the central column as wide as it is drawn, a side tree or its crown, or a
  // skyscraper? A platform in there can't be reached or even seen.
  function inSolid(c) {
    const d = c.dyn, v = c.t === BOX ? (c.rx || c.rz ? Math.hypot(c.hx, c.hy, c.hz) : c.hy) : c.hh;
    const y0 = (d && d.k === 'pp' ? Math.min(d.ay, d.by) : d && d.k === 'bob' ? c.y - d.amp : c.y) - v;
    const y1 = (d && d.k === 'pp' ? Math.max(d.ay, d.by) : d && d.k === 'bob' ? c.y + d.amp : c.y) + v;
    const core = ROUTE === 'crater' ? 0 : coreRadius(MAP.key, y0) + CORE_SKIN;
    for (const [x, z, rad] of reachOf(c)) {
      if (core && Math.hypot(x, z) < core + rad) return true;
      for (const t of out.trees) {
        const dist = Math.hypot(x - t.x, z - t.z);
        if (y1 >= t.base - 1 && y0 <= t.top + 0.5 && dist < t.r + SIDE_SKIN + (t.base <= 0 && y0 < t.base + 8 ? t.r * 0.35 : 0) + rad) return true;
        if (y1 > t.top + 0.5 && y0 < t.top + 9 && dist < 6 + rad) return true;
      }
      for (const t of TOWERS) {
        const dx = x - t.x, dz = z - t.z, ca = Math.cos(t.a), sa = Math.sin(t.a);
        if (Math.abs(dx * ca + dz * sa) < TW + rad && Math.abs(dz * ca - dx * sa) < TW + rad) return true;
      }
    }
    return false;
  }
  function buried(from) {
    for (let i = from; i < out.cols.length; i++) if (out.cols[i].kind !== 'trunk' && inSolid(out.cols[i])) return true;
    return false;
  }
  // Nothing may reach into the air between a shaft's walls. Footprints only count the top of a piece, so the long body
  // of a pillar could still hang in there, and you would hit your head in the middle of a bounce.
  function blocksShaft(fromCols, fromMoves) {
    for (let i = 0; i < out.moves.length; i++) {
      const m = out.moves[i];
      if (m.k !== 'chimney') continue;
      for (let j = i >= fromMoves ? 0 : fromCols; j < out.cols.length; j++) {
        const c = out.cols[j];
        if (c.kick || c.shaft) continue;
        const d = c.dyn, v = c.t === BOX ? (c.rx || c.rz ? Math.hypot(c.hx, c.hy, c.hz) : c.hy) : c.hh;
        const y0 = (d && d.k === 'pp' ? Math.min(d.ay, d.by) : d && d.k === 'bob' ? c.y - d.amp : c.y) - v;
        const y1 = (d && d.k === 'pp' ? Math.max(d.ay, d.by) : d && d.k === 'bob' ? c.y + d.amp : c.y) + v;
        if (y1 < m.y + 0.1 || y0 > m.y + m.H + 1.2) continue;
        for (const [x, z, rad] of reachOf(c)) {
          const dx = x - m.x, dz = z - m.z;
          if (Math.abs(dx * m.nx + dz * m.nz) < m.W / 2 + rad && Math.abs(dx * m.ox + dz * m.oz) < m.deep / 2 + rad) return true;
        }
      }
    }
    return false;
  }
  function place(fn, at) {
    let lift = 0;
    for (let k = 0; k < 6; k++) {
      const snap = snapshot(), res = fn(), raise = badness(snap.recs, snap.lows), hit = buried(snap.n.cols) || blocksShaft(snap.n.cols, snap.n.moves);
      if (raise <= 0 && !hit) return res;
      restore(snap);
      // Cut into a tall solid: try a plain hop along the way first. A little too close to older route: a few steps up.
      // Anything more, or that failed too: a lift, each try higher by what the last one still lacked.
      if (raise <= 0 && k === 0) fn = () => T.gap(at);
      else if (raise > 0 && raise <= 4.5 && k === 0) fn = () => T.stairs(at, Math.ceil(raise / 0.95) + 1);
      else {
        lift = Math.min(18, lift ? lift + Math.max(raise, 0.5) + 0.3 : Math.max(raise, 1) + 1.2);
        const h = lift;
        fn = () => T.lift(at, h);
      }
    }
    return fn();
  }

  // A maze garden for a checkpoint, as big as fits: up to 7 cells a side low down and 8 from the fourth zone up, then
  // smaller. If older route is too close below, a few steps up first. Answers the landing after it, or null if none fits
  // (the caller makes a plain pad instead).
  function mazeAt(at, cpo) {
    const top = zone >= 3 ? 8 : 7, sizes = [];
    for (let N = top; N >= 4; N--) for (const shift of N > 5 ? [0, 1.5] : [0, 1.5, -1.5]) sizes.push([N, shift]);
    for (let step = 0; step < 5; step++) {
      let raise = 0;
      for (const [N, shift] of sizes) {
        const snap = snapshot(), res = T.maze(at, N, cpo, shift);
        if (res) {
          const r2 = badness(snap.recs, snap.lows), bu = buried(snap.n.cols), bs = blocksShaft(snap.n.cols, snap.n.moves);
          if (r2 <= 0 && !bu && !bs) return res;
          raise = Math.max(raise, r2);
        }
        restore(snap);
      }
      // Older route too close below: a few steps up. Nothing fits from here at all: one more hop along, and try again.
      const a0 = at;
      at = raise > 0 && raise <= 9 ? place(() => T.stairs(a0, Math.ceil(raise / 0.95) + 1), a0) : place(() => T.gap(a0), a0);
    }
    return null;
  }

  // Each template call tags the footprints it records (for the clearance test's reports).
  const T = {};
  for (const k in T0) T[k] = (...args) => { const prev = TAG; TAG = k; const r = T0[k](...args); TAG = prev; return r; };

  // The higher the zone, the more often the next section is one of the map's obstacles: about 34% at the
  // bottom, 80% in the top zone.
  function pickTpl() {
    // From 800 m up the very hardest ones come in as well, each of them at least once if there is room.
    if (lastY >= TOP_FROM && TOPS.length && R() < 0.3) {
      const fresh = TOPS.filter((q) => !usedObs.includes(q)), from = fresh.length ? fresh : TOPS;
      return from[(R() * from.length) | 0];
    }
    const obsW = {}, baseW = {};
    for (const k in ZW) (T[k] ? baseW : obsW)[k] = ZW[k];
    const pObs = 0.34 + (0.46 * zone) / Math.max(1, ZONE_LIST.length - 1);
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

  // Look ~1.4 rad ahead; if the layer below would be too close, climb stairs first. (A maze garden just left is beside
  // the way on, not below it: it used to put a needless lift right after every maze.)
  function guard(cur, span = 2.4, extra = 0.6) {
    let worst = -1e9;
    const sp = Math.min(span, 18 / Math.max(3, cur.r));
    besideMaze = mazeRec && Math.abs(mazeRec.y - cur.y) < 2.5 ? mazeRec : null;
    for (let d = 0.1; d <= sp; d += 0.1) {
      for (const dr of [-1, 0, 1]) worst = Math.max(worst, needAt(cur.th + DIR * d, Math.max(BAND.lo + 1, cur.r + dr), 3.6, 3.6, cur.y - extra));
    }
    besideMaze = null;
    // A big climb needed soon is done in one go with a lift; small ones with a few stairs.
    if (worst > 4.5) return T.lift(cur, Math.min(9, worst + 1.4));
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

  // ---------- coins ----------
  // Lines over platforms and arcs over gaps, every so often along the route. Only on things that stay put.
  function buildCoins() {
    const CR = rng(MAP.seed ^ 0xc0115), list = (out.coins = []);
    // Never inside or touching anything: a wall, a post, a door, a branch, a tree or a mushroom.
    const near = out.cols.map((c) => [c, (c.miny + c.maxy) / 2, (c.maxy - c.miny) / 2 + 1]);
    const solid = (c, x, y, z) => {
      if (c.t !== BOX) { const r = Math.hypot(x - c.x, z - c.z) - (c.r || 0), dy = Math.abs(y - c.y) - c.hh; return Math.max(r, dy) < 0.5; }
      const ex = x - c.x, ey = y - c.y, ez = z - c.z, m = c.m;
      const lx = Math.abs(ex * m[0] + ey * m[1] + ez * m[2]) - c.hx, ly = Math.abs(ex * m[3] + ey * m[4] + ez * m[5]) - c.hy, lz = Math.abs(ex * m[6] + ey * m[7] + ez * m[8]) - c.hz;
      return Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) < 0.5;
    };
    const free = (x, y, z) => {
      for (const [c, cy, ext] of near) if (Math.abs(cy - y) < ext && solid(c, x, y, z)) return false;
      for (const d of out.decor) if ((d.k === 'tree' || d.k === 'mushroom') && y > d.y - 0.5 && y < d.y + 6 && Math.hypot(d.x - x, d.z - z) < 1.1) return false;
      return true;
    };
    const push = (x, y, z) => { const ph = CR() * TAU; if (free(x, y, z)) list.push({ i: list.length, x, y, z, ph }); };
    const ok = (c) => (c.kind === 'plat' || c.kind === 'beam') && c.t === BOX && !c.dyn && !c.blink && !c.trap && !c.crumble;
    const P = out.cols.filter(ok);
    // A little line off the start so nobody misses what these are.
    const s0 = out.cps[0];
    for (let k = 1; k <= 4; k++) push(Math.cos(s0.th + DIR0 * 0.1 * k) * 12.5, s0.y + 1.0, Math.sin(s0.th + DIR0 * 0.1 * k) * 12.5);
    let next = 2 + ((CR() * 4) | 0);
    for (let n = 0; n < P.length - 1; n++) {
      if (n < next) continue;
      const a = P[n], b = P[n + 1], topA = a.y + a.hy, topB = b.y + b.hy, d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 3 && d < 8 && Math.abs(topB - topA) < 2.2 && CR() < 0.55) {
        // An arc along the jump between two platforms.
        for (let k = 0; k < 5; k++) {
          const f = (k + 0.5) / 5;
          push(a.x + (b.x - a.x) * f, topA + (topB - topA) * f + 1.0 + Math.sin(f * Math.PI) * 1.5, a.z + (b.z - a.z) * f);
        }
      } else {
        // A line along the platform's long side.
        const ax = a.hx >= a.hz, len = Math.max(a.hx, a.hz), c = Math.cos(a.ry), s = Math.sin(a.ry), n3 = len > 1.5 ? 3 : 1;
        for (let k = 0; k < n3; k++) {
          const u = n3 === 1 ? 0 : ((k - 1) * len) / 1.8;
          push(a.x + (ax ? c * u : s * u), topA + 1.0, a.z + (ax ? -s * u : c * u));
        }
      }
      next = n + 7 + ((CR() * 8) | 0);
    }
  }

  // ---------- hidden places ----------
  // Every relic but the ones in the maze gardens waits at the end of its own parkour course, out in the open air past the
  // route. The course is put together from COURSE parts in a random order, with random sizes, heights and timing, so no two
  // are alike. Each map's are fixed by its seed: everyone on a team has to see the same stones, and so does the server's rerun.
  //   suit    two per map: a legendary suit each. Long, hard and well above where they start.
  //   epic    one per map: a vault that opens the epic things of this map in the shop. The easiest.
  //   weapon  one per map, the longest, hardest and highest: a vault with the map's legendary weapon.
  // All of them start at a gate on a route platform with a pillar of light (worldview.js) and end at a ring that takes you
  // back to that platform. Markers along the way are where a fall brings you back to (game.js).
  // Nobody gets to a relic any other way. A course first runs straight out from the tower, and from the second marker on it
  // goes round on a ring of its own, past what a jump or a drop from the route can reach, climbing as it goes (offRoute). A
  // crater has no room inside it, so there the gate is a portal to a course round the outside of the mountain (portal). And
  // game.js checks the rest wherever it is played, the server's rerun too: landing on a course past its way in from anywhere
  // else sends you back (way, entry).
  function buildSecrets() {
    const SR = rng(MAP.seed ^ 0x51ec7e7), sr = (a, b) => a + SR() * (b - a), shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (SR() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    out.relics = [];
    out.signs = [];
    const pool = out.cols.filter((c) => c.kind === 'plat' && c.t === BOX && !c.dyn && !c.crumble && !c.blink && !c.trap && !c.surf && !c.look && !c.shaft && Math.min(c.hx, c.hz) > 0.75);
    const hazards = [];
    const noteHazards = () => {
      hazards.length = 0;
      for (const k of ['obs', 'lasers', 'arrows', 'bats', 'swings', 'geysers', 'rocks', 'monsters', 'fans', 'rods', 'jumpers']) {
        for (const o of out[k]) {
          const x = o.x ?? o.cx ?? o.ax, y = o.y ?? o.cy ?? o.fy, z = o.z ?? o.cz ?? o.az;
          if (x !== undefined && y !== undefined && z !== undefined) hazards.push([x, y, z]);
        }
      }
    };
    let routeR = 0;
    for (const q of recs) if (standsOn(q)) routeR = Math.max(routeR, Math.hypot(q.x, q.z) + q.rad);
    const PORTAL = ROUTE === 'crater', MIN_R = PORTAL ? 33 : 0, MAX_R = routeR + 50, TURNS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];
    // How far a jump with a dash carries from a piece of route dy above something, edge to edge, with some to spare.
    const dropReach = (dy) => 6.2 * ((9.4 + Math.sqrt(88.36 + 48 * dy)) / 24) + 3;
    const routeOf = (st) => {
      let best = null, bd = 1e9;
      for (const q of recs) {
        if (q.guard || q.tag === 'secret') continue;
        const d = Math.abs(q.x - st.x) + Math.abs(q.z - st.z) + Math.abs(q.y - (st.y + st.hy));
        if (d < bd) { bd = d; best = q; }
      }
      return best ? best.pl : pathLen;
    };
    // How far you can jump, edge to edge, to a stone dy higher.
    const jumpGap = (dy) => 6.2 * ((9.4 + Math.sqrt(Math.max(0, 88.36 - 48 * dy))) / 24) - 0.2;
    // Everything on a course wears its map's looks (c colour, g glow, p surface pattern, e how much it glows, s shape).
    const CL = COURSE_LOOKS[MAP.key] || COURSE_LOOKS.storm, base = { c: CL.c, g: CL.g, p: CL.p, e: CL.e };
    const LOOKS = {
      suit: base, epic: base, weapon: base,
      rest: { c: 0x143028, g: 0x7ff8d8 }, pad: { c: 0x123018, g: 0x60ff90 }, ice: { c: 0x8fc8e8, g: 0xa0e8ff }, a: CL.a, b: CL.b,
      laser: CL.sweep,
    };
    const NAMES = COURSE_NAMES[MAP.key] || COURSE_NAMES.storm;

    function layCourse(plan, st, ang0, side, wantR) {
      const A = { cols: [], obs: [], own: [], rests: [], recs: [], wells: [], way: [] }, sec = plan.kind === 'epic' ? 'open' : 'hard', look = LOOKS[plan.kind];
      const K = () => sr(plan.k[0], plan.k[1]), hard = plan.k[1] > 0.8, gapOf = (dy, f = 1) => jumpGap(dy) * K() * f;
      // Until the second marker the course is still on its way out: it may be near the route where it starts, but nowhere else.
      let leading = !PORTAL;
      const stPl = routeOf(st);
      const offRoute = (x, y, z, h) => {
        const near = leading || PORTAL, a = { x, z, hx: h, hz: h, c: 1, s: 0 }, k1 = Math.max(0, Math.floor((y + (near ? 3 : 60)) / 4));
        for (let k = Math.max(0, Math.floor((y - 3.5) / 4)); k <= k1; k++) {
          for (const q of buckets[k] || []) {
            if (q.guard || q.tag === 'secret' || (leading && Math.abs(q.pl - stPl) <= SHORT_SKIP)) continue;
            const dy = q.y - y;
            if (dy < -3.5 || dy > (near ? 3 : 60)) continue;
            const g = near || dy <= 0 ? 8 : dropReach(dy);
            if (Math.hypot(q.x - x, q.z - z) <= q.rad + h * 1.5 + g && overlap(a, q, g)) return false;
          }
        }
        return true;
      };
      const support = (a) => {
        const ux = Math.cos(a), uz = Math.sin(a), acx = Math.cos(st.ry), acz = -Math.sin(st.ry), bcx = Math.sin(st.ry), bcz = Math.cos(st.ry);
        return Math.abs(ux * acx + uz * acz) * st.hx + Math.abs(ux * bcx + uz * bcz) * st.hz;
      };
      // Through a portal it starts round the outside of the mountain, level with the gate.
      let cur = PORTAL ? { x: Math.cos(ang0) * wantR, y: st.y + st.hy, z: Math.sin(ang0) * wantR, a: ang0 + side * Math.PI / 2, hl: 0.5, hw: 0.5 } : { x: st.x, y: st.y + st.hy, z: st.z, a: ang0, hl: support(ang0), hw: 0 }, steps = 0;
      const sup = (a) => cur.hl * Math.abs(Math.cos(a - cur.a)) + cur.hw * Math.abs(Math.sin(a - cur.a));
      const steer = () => {
        const rad = Math.hypot(cur.x, cur.z), e = clamp((wantR - rad) / 12, -0.8, 0.8);
        return Math.atan2(cur.z, cur.x) + side * (Math.PI / 2 - e);
      };
      const inBounds = (x, z) => { const r = Math.hypot(x, z); return r <= MAX_R && r >= MIN_R; };
      // Clear of everything: colliders, route footprints, hazards, trees, and the rest of this course.
      const clearAt = (x, y, z, h, up = HEAD + 0.8, down = 1.6, skip = null, last = null) => {
        const m = h + 1.1, y0 = y - down, y1 = y + up;
        for (const c of out.cols) {
          if (c === skip) continue;
          if (c.maxx >= x - m && c.minx <= x + m && c.maxz >= z - m && c.minz <= z + m && c.maxy >= y0 && c.miny <= y1) return false;
        }
        const a = { x, z, hx: h, hz: h, c: 1, s: 0 };
        for (const q of recs) {
          // Another course: out of a jump's reach of this one.
          if (q.tag === 'secret' && q.y > y0 - 4 && q.y < y1 + 4 && Math.hypot(q.x - x, q.z - z) < q.rad + h + 9) return false;
          if (q.y + q.h < y0 + 0.4 || q.y > y1 || Math.hypot(q.x - x, q.z - z) > q.rad + h * 1.5 + 1.2) continue;
          if (overlap(a, q, 1.0)) return false;
        }
        for (const p of hazards) if (p[1] > y0 - 6 && p[1] < y1 + 6 && Math.hypot(p[0] - x, p[2] - z) < 6.5 + h) return false;
        for (const t of out.trees) if (Math.hypot(t.x - x, t.z - z) < 9 + h) return false;
        for (const q of A.own) {
          if (q === last || q.y1 < y0 || q.y0 > y1) continue;
          if (Math.hypot(q.x - x, q.z - z) < q.r + h + 0.9) return false;
        }
        return offRoute(x, y, z, h);
      };
      // Where the next thing goes: a jump on from the last one, bending round whatever is in the way.
      const place = (hl, hw, gap, dy, o = {}) => {
        const base = o.a ?? steer();
        // The small stones are smaller still on the legendary courses.
        if (hl < 1.3 && hw < 1.3) { hl = Math.max(0.46, hl * plan.tiny); hw = Math.max(0.46, hw * plan.tiny); }
        for (const turn of o.turns || TURNS) {
          const a = base + turn, d = sup(a) + gap + hl, x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d, y = cur.y + dy;
          if (!inBounds(x, z) || y < 12 || y > top - 40) continue;
          if (!clearAt(x, y, z, Math.hypot(hl, hw) + (o.pad || 0), o.up, o.down, o.skip, A.own[A.own.length - 1])) continue;
          return { x, y, z, a, hl, hw };
        }
        return null;
      };
      const own = (x, y0, y1, z, r) => { const q = { x, y0, y1, z, r }; A.own.push(q); return q; };
      const col = (c, props) => {
        c.kind = 'secret'; c.rk = plan.kind; c.on = false; c.zone = zoneAt(out, c.y); c.surf = null; c.look = look;
        if (props) Object.assign(c, props);
        A.cols.push(c);
        return c;
      };
      // A stone at p, which becomes the one to go on from.
      const stone = (p, props) => {
        const c = col(makeBox(p.x, p.y - 0.35, p.z, p.hl, 0.35, p.hw, 0, -p.a, 0), props);
        own(p.x, p.y - 1, p.y + HEAD, p.z, Math.hypot(p.hl, p.hw));
        cur = p;
        steps++;
        A.way.push([c]);
        return c;
      };
      const hazard = (prim, name, o) => { const q = Object.assign({ key: 'course' + prim, name: NAMES[prim] || name, prim, lvl: 0, look: CL[prim] || look, zone: zoneAt(out, o.y), sec }, o); A.obs.push(q); return q; };
      const sidev = (a) => [-Math.sin(a), Math.cos(a)];
      // A comet across the gap between two stones, about where a jump is at its highest.
      const cometOver = (a, b) => {
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, span = 13, x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, y = (a.y + b.y) / 2 + 1.15;
        for (const s of [-1, 1]) if (!clearAt(x + nx * span * s, y, z + nz * span * s, 1, 2, 2)) return;
        hazard('comet', 'Comet', { x, y, z, dx: nx, dz: nz, span, speed: sr(15, 19), per: sr(2.6, 3.5), ph: SR(), r: 0.5 });
      };

      const PARTS = {
        // Up: small stones, each one higher than the last.
        stairs() {
          const n = 4 + ((SR() * 3) | 0);
          for (let j = 0; j < n; j++) {
            const h = sr(0.66, 0.85), dy = sr(1, 1.5), p = place(h, h, gapOf(dy, 0.86), dy);
            if (!p) return false;
            stone(p);
          }
          return true;
        },
        // Stones hardly bigger than a foot. Some of them keep fading out of sight, though they are still there.
        needle() {
          const n = 3 + ((SR() * 3) | 0), ghost = SR() < 0.45;
          for (let j = 0; j < n; j++) {
            const h = sr(0.5, 0.66), dy = sr(-0.5, 0.7), p = place(h, h, gapOf(dy, 0.92), dy);
            if (!p) return false;
            const c = stone(p);
            if (ghost) c.ghost = { per: sr(2.2, 3), ph: j * 0.21 };
          }
          return true;
        },
        // Too far to jump: jump, then dash.
        leap() {
          let p = place(0.95, 0.95, gapOf(0, 0.6), sr(-0.1, 0.3));
          if (!p) return false;
          stone(p);
          const a = cur, dy = sr(-0.2, 0.1);
          p = place(1.25, 1.25, sr(5.1, 5.7), dy);
          if (!p) return false;
          stone(p);
          if (SR() < 0.5) cometOver(a, cur);
          return true;
        },
        // They fall away just after you land: no stopping.
        crumbles() {
          const n = 4 + ((SR() * 3) | 0);
          for (let j = 0; j < n; j++) {
            const h = sr(0.68, 0.85), dy = sr(-0.3, 0.35), p = place(h, h, gapOf(dy, 0.72), dy);
            if (!p) return false;
            stone(p, { crumble: { st: 0, t: 0 } });
          }
          return true;
        },
        // Two colours taking turns: be in the air while they swap.
        phase() {
          const n = 5 + ((SR() * 3) | 0), per = sr(2.8, 3.4);
          for (let j = 0; j < n; j++) {
            const h = sr(0.75, 0.95), dy = sr(-0.3, 0.35), p = place(h, h, gapOf(dy, 0.72), dy);
            if (!p) return false;
            stone(p, { blink: { per, ph: j % 2 ? 0.5 : 0, duty: 0.54, sec }, look: j % 2 ? LOOKS.a : LOOKS.b });
          }
          return true;
        },
        // A big wheel on edge. Its stones stay level: get on low on the near side, ride over the top, jump off on the far side.
        wheel() {
          const R = sr(4.6, 5.4), n = SR() < 0.5 ? 4 : 5, per = sr(9, 11.5), h = 0.95, base = steer(), reachX = 0.835 * R;
          for (const turn of TURNS) {
            const a = base + turn, ux = Math.cos(a), uz = Math.sin(a), d = sup(a) + sr(1.8, 2.4) + reachX + h, hx = cur.x + ux * d, hy = cur.y + 0.55 * R, hz = cur.z + uz * d;
            const ed = reachX + h + sr(1.9, 2.5) + 1.2, ex = hx + ux * ed, ey = hy + 0.55 * R - 0.3, ez = hz + uz * ed;
            if (!inBounds(hx, hz) || !inBounds(ex, ez) || ey > top - 40) continue;
            if (!clearAt(hx, hy, hz, R + 1.4, R + 2.5, R + 2, null, A.own[A.own.length - 1]) || !clearAt(ex, ey, ez, 1.7)) continue;
            for (let j = 0; j < n; j++) {
              const a0 = (j * TAU) / n;
              col(makeBox(hx + ux * Math.cos(a0) * R, hy + Math.sin(a0) * R, hz + uz * Math.cos(a0) * R, h, 0.25, h, 0, -a, 0), { dyn: { k: 'wheel', hx, hy, hz, ux, uz, R, a0, per } });
            }
            A.way.push(A.cols.slice(-n));
            hazard('wheel', 'Big wheel', { x: hx, y: hy, z: hz, ux, uz, R, n, per, a0: 0 });
            own(hx, hy - R - 1, hy + R + 3, hz, R + 1.4);
            A.recs.push([hx, hz, R, R, -a, hy - R, 2 * R + HEAD]);
            stone({ x: ex, y: ey, z: ez, a, hl: 1.2, hw: 1.2 });
            return true;
          }
          return false;
        },
        // A roundabout: ride it to the other side. On the harder courses a laser sweeps over it the other way.
        carousel() {
          const R = sr(4, 4.6), arms = 3, per = sr(7, 9), hl = 1.1, base = steer();
          for (const turn of TURNS) {
            const a = base + turn, ux = Math.cos(a), uz = Math.sin(a), d = sup(a) + sr(1.6, 2.2) + R + hl, hx = cur.x + ux * d, y = cur.y, hz = cur.z + uz * d;
            const ed = R + hl + sr(1.7, 2.3) + 1.1, ex = hx + ux * ed, ez = hz + uz * ed;
            if (!inBounds(hx, hz) || !inBounds(ex, ez)) continue;
            if (!clearAt(hx, y, hz, R + 1.8, undefined, undefined, null, A.own[A.own.length - 1]) || !clearAt(ex, y, ez, 1.6)) continue;
            for (let j = 0; j < arms; j++) {
              const a0 = (j * TAU) / arms;
              col(makeBox(hx + Math.cos(a0) * R, y - 0.25, hz + Math.sin(a0) * R, hl, 0.25, 0.85, 0, -a0, 0), { dyn: { k: 'orbit', hx, hy: y - 0.25, hz, off: R, a0, per } });
            }
            A.way.push(A.cols.slice(-arms));
            hazard('wheel', 'Roundabout', { x: hx, y: y - 0.25, z: hz, R, n: arms, per, a0: 0, flat: true });
            if (hard) hazard('sweep', 'Laser sweep', { x: hx, y: y + 0.55, z: hz, n: 2, len: R + 1.5, w: 0.1, per: -sr(3, 3.8), ph: SR(), look: LOOKS.laser });
            own(hx, y - 1, y + HEAD, hz, R + 1.8);
            A.recs.push([hx, hz, R + hl, R + hl, 0, y]);
            stone({ x: ex, y, z: ez, a, hl: 1.1, hw: 1.1 });
            return true;
          }
          return false;
        },
        // Stones shuttling across your way, each the opposite way to the last.
        shuttle() {
          const n = 2 + ((SR() * 2) | 0), s = sr(1.7, 2.3), per = sr(3.4, 4.2), h = 0.85;
          for (let j = 0; j < n; j++) {
            const dy = sr(-0.2, 0.3), p = place(h, h, gapOf(dy, 0.72), dy, { pad: s });
            if (!p) return false;
            const [nx, nz] = sidev(p.a);
            stone(p, { dyn: { k: 'pp', ax: p.x - nx * s, ay: p.y - 0.35, az: p.z - nz * s, bx: p.x + nx * s, by: p.y - 0.35, bz: p.z + nz * s, per, ph: j % 2 ? 0.5 : 0 } });
          }
          const p = place(0.9, 0.9, gapOf(0, 0.72), 0);
          if (!p) return false;
          stone(p);
          return true;
        },
        // A staircase of pistons going up and down in turn.
        pistons() {
          const n = 3 + ((SR() * 2) | 0), amp = sr(1.4, 2), per = sr(3, 3.6), h = 0.85;
          for (let j = 0; j < n; j++) {
            const p = place(h, h, sr(1.7, 2.3), sr(0.9, 1.3), { up: HEAD + amp + 0.8, down: amp + 1.6 });
            if (!p) return false;
            stone(p, { dyn: { k: 'pp', ax: p.x, ay: p.y - 0.35 - amp, az: p.z, bx: p.x, by: p.y - 0.35 + amp, bz: p.z, per, ph: j * 0.25 } });
          }
          const p = place(1, 1, sr(1.9, 2.4), 0.3, { down: amp + 2 });
          if (!p) return false;
          stone(p);
          return true;
        },
        // Two walls facing each other, too high to jump: wall jump up between them and out over the low one.
        shaft() {
          const W = 3.1, t = 0.5, deep = 3, front = 2, F = hard ? sr(7, 10.5) : sr(5, 7), H = F + 2.4, sx = W + t * 2, sz = deep + front, base = steer();
          for (const turn of TURNS) {
            const a = base + turn, ux = Math.cos(a), uz = Math.sin(a), rad = Math.atan2(cur.z, cur.x), [vx, vz] = sidev(a);
            // The open front faces the camera: away from the tower.
            const f = vx * Math.cos(rad) + vz * Math.sin(rad) > 0 ? 1 : -1, ox = vx * f, oz = vz * f;
            const y = cur.y + sr(-0.1, 0.25), d = sup(a) + sr(1, 1.5) + sx / 2, back = sz / 2 - front / 2, fx = cur.x + ux * d - ox * back, fz = cur.z + uz * d - oz * back;
            const in2 = sz / 2 - deep / 2, cx = fx - ox * in2, cz = fz - oz * in2;
            const ex0 = W / 2 + t + 1.5 + 0.05, ex = cx + ux * ex0, ez = cz + uz * ex0, ey = y + F - 1;
            if (!inBounds(fx, fz) || !inBounds(ex, ez)) continue;
            if (!clearAt(cx, y, cz, 4.6, H + 2.2, 1.6, null, A.own[A.own.length - 1]) || !clearAt(ex, ey, ez, 2.1)) continue;
            const floor = col(makeBox(fx, y - 0.35, fz, sx / 2, 0.35, sz / 2, 0, -a, 0));
            A.way.push([floor]);
            floor.shaftOf = { cx, cz, ux, uz, ox, oz, W, F, y, fx: fx + ox * back, fz: fz + oz * back };
            for (const s of [-1, 1]) {
              const o = s * (W / 2 + t / 2), wh = s > 0 ? F : H;
              col(makeBox(cx + ux * o, y + wh / 2, cz + uz * o, t / 2, wh / 2, deep / 2, 0, -a, 0));
            }
            col(makeBox(cx - ox * (deep / 2 + t / 2), y + H / 2 - 0.35, cz - oz * (deep / 2 + t / 2), sx / 2, H / 2 + 0.35, t / 2, 0, -a, 0));
            own(cx, y - 1, y + H + 1.6, cz, 4.6);
            A.recs.push([cx, cz, sx / 2, deep / 2 + t, -a, y, H + 1.6]);
            stone({ x: ex, y: ey, z: ez, a, hl: 1.5, hw: 1.5 });
            return true;
          }
          return false;
        },
        // A narrow bridge with windmill blades coming down across it. Run through between two blades.
        mill() {
          const hl = sr(3.6, 4.6), hw = sr(0.6, 0.75), dy = sr(-0.2, 0.3), p = place(hl, hw, gapOf(dy, 0.72), dy, { pad: 0.6 });
          if (!p) return false;
          stone(p);
          const ux = Math.cos(p.a), uz = Math.sin(p.a), n = hl > 4 ? 2 : 1, blades = hard ? 3 : 2;
          for (let j = 0; j < n; j++) {
            const off = n === 1 ? 0 : (j ? 0.45 : -0.45) * hl;
            hazard('windmill', 'Windmill blade', { x: p.x + ux * off, y: p.y + 3, z: p.z + uz * off, ux, uz, R: 2.9, n: blades, per: sr(2.6, 3.4) * (j ? -1 : 1), ph: SR() });
          }
          return true;
        },
        // A wide deck with shock rings growing from its middle. Jump each ring as it reaches you.
        ringdeck() {
          const h = sr(3.1, 3.6), dy = sr(-0.2, 0.3), p = place(h, h, gapOf(dy, 0.72), dy);
          if (!p) return false;
          stone(p);
          const per = sr(1.6, 2.1), ph = SR();
          hazard('ring', 'Shock ring', { x: p.x, y: p.y, z: p.z, rmax: h * 1.42, per, ph });
          if (hard) hazard('ring', 'Shock ring', { x: p.x, y: p.y, z: p.z, rmax: h * 1.42, per, ph: ph + 0.5 });
          return true;
        },
        // Small stones with comets flying across the gaps.
        cometrun() {
          const n = 3 + ((SR() * 2) | 0);
          for (let j = 0; j < n; j++) {
            const h = sr(0.62, 0.78), dy = sr(-0.3, 0.3), a = cur, p = place(h, h, gapOf(dy, 0.85), dy);
            if (!p) return false;
            stone(p);
            if (j) cometOver(a, cur);
          }
          return true;
        },
        // A gravity well off to one side that pulls you toward it, on and off, as you jump past.
        wellgap() {
          const n = 3 + ((SR() * 2) | 0), from = cur, s = SR() < 0.5 ? 1 : -1;
          for (let j = 0; j < n; j++) {
            const h = sr(0.72, 0.88), dy = sr(-0.25, 0.3), p = place(h, h, gapOf(dy, 0.8), dy);
            if (!p) return false;
            stone(p);
          }
          const [nx, nz] = sidev(cur.a), x = (from.x + cur.x) / 2 + nx * s * 4, y = (from.y + cur.y) / 2 + 1, z = (from.z + cur.z) / 2 + nz * s * 4;
          if (!clearAt(x, y, z, 1.2, 2, 2)) return true;
          A.wells.push(hazard('well', 'Gravity well', { x, y, z, reach: 7, str: sr(9, 12), per: sr(3, 3.8), duty: 0.5, ph: SR(), r: 0.65 }));
          return true;
        },
        // A spinning deck with laser bars turning the other way, low enough to jump.
        spindeck() {
          const h = sr(2.4, 2.8), dy = sr(-0.2, 0.3), p = place(h, h, gapOf(dy, 0.72), dy);
          if (!p) return false;
          const w = sr(0.7, 1.1) * (SR() < 0.5 ? 1 : -1);
          stone(p, { dyn: { k: 'turn', a0: -p.a, w } });
          hazard('sweep', 'Laser sweep', { x: p.x, y: p.y + 0.55, z: p.z, n: 2, len: h * 1.3, w: 0.1, per: sr(2.6, 3.4) * (w > 0 ? 1 : -1), ph: SR(), look: LOOKS.laser });
          return true;
        },
        // A long thin beam rocking from side to side, with a weight swinging across it on the harder courses.
        tiltbeam() {
          const hl = sr(3, 4), hw = sr(0.5, 0.62), dy = sr(-0.2, 0.3), p = place(hl, hw, gapOf(dy, 0.72), dy);
          if (!p) return false;
          stone(p, { dyn: { k: 'tilt', ax: 'x', amp: sr(0.14, 0.22), per: sr(3.6, 4.8), ph: SR() } });
          if (hard) { const [nx, nz] = sidev(p.a), L2 = 2.45; hazard('pendulum', 'Swinging weight', { x: p.x, y: p.y + 0.6 + L2, z: p.z, fy: p.y, nx, nz, L: L2, r: 0.5, amp: 1.05, per: sr(2.3, 3), ph: SR() }); }
          return true;
        },
        // Slippery stones: land, and you keep sliding.
        ice() {
          const n = 3 + ((SR() * 2) | 0);
          for (let j = 0; j < n; j++) {
            const h = sr(0.8, 1), dy = sr(-0.2, 0.4), p = place(h, h, gapOf(dy, 0.72), dy);
            if (!p) return false;
            stone(p, { surf: 'ice', look: LOOKS.ice });
          }
          return true;
        },
        // Bounce pads, each one higher than the last.
        padshot() {
          const n = 2 + ((SR() * 2) | 0);
          let p = place(0.85, 0.85, sr(1.4, 2), sr(-0.1, 0.2), { up: 9 });
          if (!p) return false;
          stone(p, { surf: 'pad', look: LOOKS.pad });
          for (let j = 1; j < n; j++) {
            p = place(0.85, 0.85, sr(2.4, 3.6), sr(3, 3.8), { up: 9 });
            if (!p) return false;
            stone(p, { surf: 'pad', look: LOOKS.pad });
          }
          p = place(1.1, 1.1, sr(2.2, 3.2), sr(3, 3.8));
          if (!p) return false;
          stone(p);
          return true;
        },
        // A bridge whose spikes come up in a wave: jump them, or run with the gap.
        spikerun() {
          const hl = sr(4, 5), hw = sr(0.72, 0.9), dy = sr(-0.2, 0.3), p = place(hl, hw, gapOf(dy, 0.72), dy);
          if (!p) return false;
          stone(p);
          const n = 3, per = sr(2.2, 2.8), ux = Math.cos(p.a), uz = Math.sin(p.a);
          for (let j = 0; j < n; j++) {
            const off = ((j + 0.5) / n * 2 - 1) * hl * 0.85;
            hazard('spikes', 'Spike wave', { x: p.x + ux * off, y: p.y, z: p.z + uz * off, hx: (hl * 0.85) / n - 0.05, hz: hw - 0.06, ry: -p.a, per, ph: j * 0.28, duty: 0.42 });
          }
          return true;
        },
        // Presses slamming down one after another along a bridge.
        crushrun() {
          const hl = sr(3.6, 4.4), hw = sr(0.85, 1), dy = sr(-0.2, 0.3), p = place(hl, hw, gapOf(dy, 0.72), dy, { up: 7 });
          if (!p) return false;
          stone(p);
          const n = 2 + (hard ? 1 : 0), per = sr(2.8, 3.4), ux = Math.cos(p.a), uz = Math.sin(p.a);
          for (let j = 0; j < n; j++) {
            const off = ((j + 0.5) / n * 2 - 1) * hl * 0.8;
            hazard('crusher', 'Press', { x: p.x + ux * off, y: p.y, z: p.z + uz * off, hs: hw + 0.1, per, ph: j * 0.31, ry: -p.a });
          }
          return true;
        },
        // Small stones with a weight swinging through each gap.
        swingrun() {
          const n = 3 + ((SR() * 2) | 0);
          for (let j = 0; j < n; j++) {
            const h = sr(0.68, 0.85), dy = sr(-0.3, 0.3), a = cur, p = place(h, h, gapOf(dy, 0.78), dy);
            if (!p) return false;
            stone(p);
            if (j) {
              const b = cur, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, L2 = 2.45, fy = (a.y + b.y) / 2;
              hazard('pendulum', 'Swinging weight', { x: (a.x + b.x) / 2, y: fy + 0.6 + L2, z: (a.z + b.z) / 2, fy, nx: -dz / l, nz: dx / l, L: L2, r: 0.5, amp: 1.05, per: sr(2.3, 3), ph: SR() });
            }
          }
          return true;
        },
      };

      // Two hops down off the route, out of sight, then the first marker. Through a portal, you arrive on that marker.
      if (!PORTAL) {
        let p = place(0.95, 0.95, sr(1.7, 2.1), sr(-1, -0.7), { a: ang0, turns: [0], skip: st });
        if (!p) return false;
        stone(p);
        p = place(0.95, 0.95, sr(1.9, 2.3), sr(-0.2, 0.3));
        if (!p) return false;
        stone(p);
      }
      const marker = (size = 1.75) => {
        const q = place(size, size, gapOf(0, 0.6), sr(0, 0.4));
        if (!q) return false;
        const c = stone(q, { rest: A.rests.length, look: LOOKS.rest });
        A.rests.push({ c, x: q.x, y: q.y, z: q.z, a: q.a });
        return true;
      };
      // Through a portal you arrive on a wider one, with a ring behind you that takes you back.
      if (!marker(PORTAL ? 2.5 : 1.75)) return false;
      // Straight out from the tower, until the course is past what can be reached from the route.
      if (!PORTAL) {
        for (let k = 0; k < 30 && Math.hypot(cur.x, cur.z) < wantR - 3; k++) {
          const h = sr(0.85, 1.05), dy = sr(-0.2, 0.35);
          const q = place(h, h, gapOf(dy, 0.72), dy, { a: Math.atan2(cur.z, cur.x), turns: [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95] });
          if (!q) return false;
          stone(q);
        }
        if (Math.hypot(cur.x, cur.z) < wantR - 3 || !marker()) return false;
        leading = false;
      }
      // At least three of the kinds found nowhere else on the map, the rest from all of them, in any order.
      const SPECIAL = shuffle(['wheel', 'mill', 'ringdeck', 'cometrun', 'wellgap', 'phase']), OTHER = shuffle(['needle', 'leap', 'crumbles', 'carousel', 'shuttle', 'pistons', 'shaft', 'spindeck', 'tiltbeam', 'ice', 'padshot', 'spikerun', 'crushrun', 'swingrun']);
      const list = shuffle([...SPECIAL.slice(0, 3), ...OTHER.slice(0, plan.parts - 3)]).concat(SPECIAL.slice(3), OTHER.slice(plan.parts - 3), shuffle([...SPECIAL, ...OTHER]));
      const CLIMBS = ['stairs', 'stairs', 'padshot', 'shaft', 'pistons'], y0 = cur.y;
      let done = 0, markY = cur.y, markStep = steps;
      const made = [];
      const tryPart = (name) => {
        const m = { cols: A.cols.length, obs: A.obs.length, own: A.own.length, recs: A.recs.length, wells: A.wells.length, way: A.way.length, rests: A.rests.length, cur, steps };
        if (PARTS[name]()) { made.push(name); return true; }
        A.cols.length = m.cols; A.obs.length = m.obs; A.own.length = m.own; A.recs.length = m.recs; A.wells.length = m.wells; A.way.length = m.way; A.rests.length = m.rests; cur = m.cur; steps = m.steps;
        return false;
      };
      // A marker now and then and not too far below you, so a fall doesn't cost the whole course.
      const markIfDue = () => { if ((steps - markStep >= plan.mark || cur.y > markY + 26) && marker()) { markY = cur.y; markStep = steps; } };
      for (const name of list) {
        if (done >= plan.parts) break;
        if (!tryPart(name)) continue;
        done++;
        // And it keeps climbing: as high by now as it should be by now.
        for (let k = 0; k < 10 && cur.y < y0 + (plan.rise * done) / plan.parts; k++) {
          if (tryPart(CLIMBS[(SR() * CLIMBS.length) | 0])) markIfDue();
        }
        if (done < plan.parts) markIfDue();
      }
      if (done < plan.parts) return false;
      const dyEnd = sr(0.2, 0.5), e = place(plan.end / 2, plan.end / 2, gapOf(dyEnd, 0.7), dyEnd, { up: HEAD + 2 });
      if (!e) return false;
      stone(e);
      return { A, e, made };
    }

    // Commit a course that fits: everything on it, the relic at its end, and the gate where it leaves the route.
    function commit(plan, st, ang0, ph0, got) {
      const { A, e, made } = got, id = MAP.key + ':' + plan.id, sec = plan.kind === 'epic' ? 'open' : 'hard';
      TAG = 'secret';
      pathLen += 2000;
      const i = out.relics.length, ux = Math.cos(e.a), uz = Math.sin(e.a), sx = st.x + Math.cos(ang0) * Math.max(0.3, ph0 - 0.45), sz = st.z + Math.sin(ang0) * Math.max(0.3, ph0 - 0.45);
      // How far along the course each thing is: walls count as the floor they stand on.
      A.way.forEach((w, n) => { for (const c of w) c.wi = n; });
      let wi = 0;
      for (const c of A.cols) {
        if (c.wi === undefined) c.wi = wi; else wi = c.wi;
        c.ri = i;
        if (plan.dv !== undefined) c.dv = plan.dv;
        out.cols.push(c);
        if (c.crumble) { c.crumble.i = out.crumbles.length; out.crumbles.push(c); }
        if (c.blink) out.blinks.push(c);
        recBox(c.x, c.z, c.hx, c.hz, c.ry, c.y + c.hy);
      }
      for (const q of A.recs) recBox(...q);
      for (const o of A.obs) { o.i = out.obs.length; if (plan.dv !== undefined) o.dv = plan.dv; out.obs.push(o); }
      for (const w of A.wells) out.wells.push(w);
      out.relics.push({
        i, id, kind: plan.kind, dv: plan.dv, x: e.x, y: e.y + 1.05, z: e.z, start: st, stones: A.cols, way: A.way, rests: A.rests, made, entry: PORTAL ? 0 : A.rests[1].c.wi, portal: PORTAL,
        vault: { x: e.x, y: e.y, z: e.z, s: plan.end, ry: -e.a }, exit: { x: e.x + ux * (plan.end / 2 - 0.75), y: e.y, z: e.z + uz * (plan.end / 2 - 0.75) },
        gate: { x: sx, y: st.y + st.hy, z: sz, a: ang0 },
        back: PORTAL ? { x: A.rests[0].x - Math.cos(A.rests[0].a) * 1.7, y: A.rests[0].y, z: A.rests[0].z - Math.sin(A.rests[0].a) * 1.7 } : null,
      });
    }

    // parts how many, k how near the limit of a jump its gaps are, tiny how small its small stones are, rise how much higher it
    // ends than it starts, mark how many stones to a marker, out how far past the others its ring is.
    const plans = [
      { kind: 'suit', id: '0', y: [170, 300], parts: 10, k: [0.74, 0.86], tiny: 0.9, end: 4.4, rise: 40, mark: 22, out: 4 },
      { kind: 'suit', id: '1', y: [560, 720], parts: 13, k: [0.78, 0.9], tiny: 0.85, end: 4.4, rise: 60, mark: 24, out: 8 },
      { kind: 'weapon', id: 'w', y: [400, 720], parts: 16, k: [0.8, 0.94], tiny: 0.85, end: 4.8, rise: 90, mark: 26, out: 12 },
    ];
    // The hidden spots at the end of a course (hideSpots): each difficulty's spread over the whole climb, longer and harder the
    // harder the difficulty, and the legendary ones long.
    const NOOK = [
      { parts: 3, k: [0.6, 0.72], tiny: 1, rise: 8, mark: 16, out: 0 },
      { parts: 4, k: [0.64, 0.76], tiny: 1, rise: 12, mark: 18, out: 0 },
      { parts: 5, k: [0.7, 0.82], tiny: 0.95, rise: 16, mark: 20, out: 2 },
      { parts: 6, k: [0.74, 0.86], tiny: 0.9, rise: 22, mark: 22, out: 4 },
    ];
    const spots = hideSpots(MAP.key).filter((q) => !q.maze), byDv = [0, 1, 2, 3].map((d) => spots.filter((q) => q.dv === d));
    for (const q of spots) {
      const list = byDv[q.dv], n = list.length, at = list.indexOf(q), y0 = 70 + (at * 820) / n, y1 = 70 + ((at + 1) * 820) / n;
      const how = q.legend ? { parts: 8, k: [0.76, 0.88], tiny: 0.88, rise: 40, mark: 22, out: 6 } : NOOK[q.dv];
      plans.push(Object.assign({ kind: q.legend ? 'suit' : 'epic', id: 'h' + q.j, dv: q.dv, y: [y0, y1], end: 4.4, wide: true }, how));
    }
    for (const plan of plans) {
      noteHazards();
      let done = false;
      // Where there is little room a course can come out a part or two shorter, and a hidden spot's anywhere up the climb.
      // There always is one.
      for (const ys of plan.wide ? [plan.y, [60, 900]] : [plan.y]) {
      if (done) break;
      const list = shuffle(pool.filter((c) => c.y + c.hy - 2 > ys[0] && c.y + c.hy - 2 < ys[1]));
      for (let parts = plan.parts; parts >= 2 && !done; parts--) for (const st of list) {
        if (done) break;
        const out0 = Math.atan2(st.z, st.x), wantR = PORTAL ? 38 + plan.out : routeR + 24 + plan.out;
        for (const side of SR() < 0.5 ? [1, -1] : [-1, 1]) {
          for (const jit of [0, 0.5, -0.5, 1.0, -1.0]) {
            const ang0 = out0 + jit, ux = Math.cos(ang0), uz = Math.sin(ang0), acx = Math.cos(st.ry), acz = -Math.sin(st.ry), bcx = Math.sin(st.ry), bcz = Math.cos(st.ry);
            const ph0 = Math.abs(ux * acx + uz * acz) * st.hx + Math.abs(ux * bcx + uz * bcz) * st.hz;
            const got = layCourse(Object.assign({}, plan, { parts }), st, ang0, side, wantR);
            if (!got) continue;
            commit(plan, st, ang0, ph0, got);
            done = true;
            break;
          }
          if (done) break;
        }
      }
      }
    }
  }

  // ---------- build ----------
  const DIR0 = DIR;
  let piers = PIERS;
  ring(2, CORE_R + 0.3, 19, 0, TAU, 'dock', false);
  // Four piers from the edge of the dock out over the water. They start where the dock ends: no overlap.
  for (const a of PIERS) {
    const [x, z] = polar(a, PIER_R0 + PIER_LEN / 2);
    add(makeBox(x, 1.4, z, PIER_W, 0.6, PIER_LEN / 2, 0, -(a + Math.PI / 2), 0), 'pier');
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
  if (SWITCH) { BAND = LANES.outer; newLeg(cur); }
  let nextExc = 0, sinceRev = 0, sinceDet = 0, nextJump = 52, jumpN = 0;
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
    ZD = hardened(ZONE_LIST[zone], zone / Math.max(1, ZONE_LIST.length - 1));
    // A zone's own template list can also name obstacles to make them more common there (they add up).
    ZW = Object.assign({}, zoneObstacles(MAP.key, zone, ZONE_LIST.length));
    for (const k in ZD.tpl) ZW[k] = (ZW[k] || 0) + ZD.tpl[k];
    // Each map's own hard jumps and its own creature on the ledges, from the second zone up and more of them higher up.
    if (zone >= 1) {
      const more = zone >= 4 ? 2 : 1;
      for (const k in HARD_JUMPS[MAP.key] || {}) ZW[k] = (ZW[k] || 0) + HARD_JUMPS[MAP.key][k] * more;
      if (MAP.key !== 'forest') ZW.monster = (ZW.monster || 0) + (zone >= 3 ? 1.5 : 1);
    }
    // Fewer free rides the higher you go, and more of the moves that take skill.
    if (ZW.lift) ZW.lift *= 0.4;
    if (zone >= 1) ZW.dashgap = zone >= 4 ? 2 : 1;
    if (zone >= 2) ZW.chimney = zone >= 5 ? 2 : 1;
    zonePlats = 0;
    const zi = { name: ZD.name, sub: ZD.sub, color: ZD.color, fog: ZD.fog, tint: ZD.tint, y0: cur.y, y1: ZD.y1 };
    if (zone > 0 && ROUTE === 'towers') {
      // No ring round a core here: a wide rooftop pad starts the zone.
      const at0 = cur, mz = mazeAt(at0, { normal: zone % 2 === 0 });
      if (mz) { cur = mz; zi.y0 = out.cps[out.cps.length - 1].y; }
      else {
        cur = place(() => T.gap(at0, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at0);
        zi.y0 = cur.y;
        checkpoint(cur.th, cur.r, cur.y, { normal: zone % 2 === 0 });
      }
    } else if (zone > 0) {
      // Zone gate: a wide three-quarter ring that doubles as a safety net and checkpoint.
      const rIn = 7.0, rOut = 16.5, rm = 11.75, span = TAU * 0.72;
      // The ring goes on the way the route is heading. Right after a zigzag turns, the steps just climbed lie that way,
      // and need() leaves the last few pieces out (they are the way up to it): the ring lay right over those steps, too
      // low to jump from or get out from under (0.7 m on the Waterfall). Then it goes the other way, and the route on
      // from it too. Under means part of the top of something built in the last stretch is under the ring with less than
      // 2.2 m between them.
      const startAt = (d) => cur.th + d * (cur.sx / 2 + 1.1) / cur.r;
      const underRing = (d) => {
        const y = cur.y + 0.9, a0 = startAt(d), C = out.cols;
        for (let i = C.length - 1; i >= Math.max(0, C.length - 60); i--) {
          const c = C[i], m = c.m;
          if (c.t !== BOX || c.dyn || c.hy >= 1.5 || c.kind === 'door' || c.maxy > y || c.miny < y - 7) continue;
          for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
            const lx = u * c.hx, lz = v * c.hz;
            const x = c.x + lx * m[0] + c.hy * m[3] + lz * m[6] - CX, wy = c.y + lx * m[1] + c.hy * m[4] + lz * m[7], z = c.z + lx * m[2] + c.hy * m[5] + lz * m[8] - CZ;
            const r = Math.hypot(x, z);
            if (r < rIn || r > rOut || y - 1.2 - wy >= 2.2) continue;
            if (((((Math.atan2(z, x) - a0) * d) % TAU) + TAU) % TAU < span) return true;
          }
        }
        return false;
      };
      if (underRing(DIR) && !underRing(-DIR)) DIR = -DIR;
      let th0;
      for (let k = 0; k < 40; k++) {
        th0 = startAt(DIR);
        let worst = -1e9;
        for (let a = 0; a <= span; a += 0.1) worst = Math.max(worst, needAt(th0 + DIR * a, rm, 2, rOut - rIn, cur.y + 0.9), shortNeed(th0 + DIR * a, rm, 2, rOut - rIn, cur.y + 0.9));
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
      if (SWITCH) newLeg(cur);
    }
    out.zones.push(zi);
    nextExc = zi.y0 + 12;
    let midDone = zone === 0;
    const mid = (zi.y0 + ZD.y1) / 2;
    while (cur.y < ZD.y1) {
      const at = cur, g = place(() => guard(at), at);
      if (g) { cur = g; continue; }
      if (!midDone && cur.y > mid) {
        const mz = mazeAt(at, { mid: true });
        // Sunny: a whole leg on from the garden before turning back, not straight back along its side.
        if (mz) { cur = mz; if (SWITCH) newLeg(cur); }
        else {
          cur = place(() => T.gap(at, { size: [4.6, 4.0], g: 1.4, dy: 0.4, surf: null }), at);
          checkpoint(cur.th, cur.r, cur.y, { mid: true });
        }
        midDone = true;
        continue;
      }
      // Special areas are long and tall; make sure the layer below is far enough away first.
      const g2 = place(() => guard(at, 2.8, 1.5), at);
      if (g2) { cur = g2; continue; }
      sinceTurn++;
      // Sunny: the last stretch below the summit runs in the outer lane, clear of the summit disc.
      if (SWITCH && finalStretch() && BAND === LANES.inner) { cur = place(() => T.turn(at), at); continue; }
      // Sunny: turn round at the end of each leg. Forest: now and then a trip out to a side tree.
      if (SWITCH && DIR * (cur.th - legStart) > legLen && !finalStretch()) { cur = place(() => T.turn(at), at); continue; }
      if (ROUTE === 'towers') {
        // Done with this tower once round far enough and facing the next one: cross over.
        const nt = TOWERS[(tower + 1) % TOWERS.length], face = Math.atan2(nt.z - CZ, nt.x - CX);
        if (Math.abs(cur.th - visitStart) / TAU > visitLaps && Math.abs(angDiff(cur.th, face)) < 0.45) { cur = place(() => T.cross(at), at); continue; }
      }
      if (SIDE[MAP.key] && zone < ZONE_LIST.length - 1 && cur.y > nextExc && cur.y < ZD.y1 - 24 && (zone > 0 || zonePlats > 16)) {
        cur = place(() => T.excursion(at), at);
        nextExc = cur.y + SIDE_EVERY[MAP.key];
        continue;
      }
      // The first zone teaches each special area early on.
      if (zone === 0 && zonePlats >= 6 && !intro.grapple) cur = place(() => T.grapple(at), at);
      else if (zone === 0 && zonePlats >= 12 && !intro.door) cur = place(() => T.door(at), at);
      else if (zone === 0 && MAP.key === 'forest' && zonePlats >= 3 && !intro.monster) cur = place(() => T.monster(at), at);
      else if (zone === 0 && zonePlats >= 18 && !intro.dash) cur = place(() => T.dashgap(at), at);
      else if (zone === 0 && zonePlats >= 24 && !intro.chimney) cur = place(() => T.chimney(at, true), at);
      else if (cur.y >= nextJump && !finalStretch()) {
        // Below 500 m these ledges stand empty unless obstacles are on Wild (Hardcore): lvl 2. From 500 m up
        // every difficulty gets them; Easy only every other one.
        const J = JUMPER[MAP.key] || JUMPER.storm, low = cur.y < JUMP_ALL, o = { name: J.name, look: J.look, lvl: low ? 2 : jumpN++ % 2 };
        cur = place(() => OB.jumper(at, o), at);
        nextJump = low ? (cur.y + 50 > JUMP_ALL ? Math.max(JUMP_ALL, cur.y + 20) : cur.y + 50) : cur.y + 36;
      }
      else if (finalStretch()) { const k = ['gap', 'gap', 'stairs', 'pillars', 'beam', 'crumble'][(R() * 6) | 0]; cur = place(() => T[k](at), at); }
      else {
        // Big sweeping things stay away from the switchback turns, where the other lane is close by.
        let k = pickTpl();
        if (SWITCH && (k === 'spinner' || k === 'fan') && (sinceTurn < 4 || BAND === LANES.inner)) k = 'mover';
        if ((ROUTE === 'towers' || ROUTE === 'crater') && (k === 'spinner' || k === 'fan')) k = 'mover';
        // Wander instead of only circling: now and then turn back after a lift, or detour outward.
        if ((ROUTE === 'spiral' || ROUTE === 'crater' || ROUTE === 'trees') && sinceRev > 8 && R() < 0.16) { k = 'reverse'; sinceRev = 0; }
        else if (ROUTE === 'crater' && sinceDet > 14 && zone > 0 && R() < 0.1) { k = 'across'; sinceDet = 0; }
        else if ((ROUTE === 'spiral' || ROUTE === 'crater' || SWITCH) && sinceDet > 10 && zone > 0 && R() < 0.13) { k = 'detour'; sinceDet = 0; }
        sinceRev++; sinceDet++;
        const kk = k;
        cur = place(() => (T[kk] ? T[kk](at) : T.obs(at, kk)), at);
      }
    }
    zi.y1 = cur.y;
  }

  // Summit: a disc capping the core, reached from one last ledge.
  zone = ZONE_LIST.length - 1;
  if (SWITCH && BAND === LANES.inner) cur = T.turn(cur);
  if (ROUTE === 'towers') {
    // From the last tower over to the central spire, whose roof is the summit.
    // Starts higher if the way over would pass too close above older route. If it would cut through a tower at any
    // height, a few more hops first, round to a better place to leave from.
    let from = cur, over = false;
    for (let n = 0; n < 16 && !over; n++) {
      const b = Math.atan2(from.z, from.x);
      for (let k = 0; k < 8; k++) {
        const snap = snapshot();
        cur = walkTo(from, Math.cos(b) * 12.5, Math.sin(b) * 12.5, from.y + 1 + k * 1.5);
        if (n === 15 && k === 7) { over = true; break; }
        if (badness(snap.recs, snap.lows) <= 0 && !buried(snap.n.cols)) { over = true; break; }
        restore(snap);
      }
      if (!over) { const at = from; from = place(() => T.gap(at, { g: rr(1.0, 1.6), dy: rr(0.1, 0.5), surf: null }), at); }
    }
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
  // The core's solid wall: a little outside what you see (so hands and the glowing rings never sink in), and
  // widening toward the foot exactly as the drawn wall does on the maps where it flares.
  if (ROUTE !== 'crater') add(makeCyl(0, (top - 1.2 - 40) / 2, 0, CORE_R + CORE_SKIN, (top - 1.2 + 40) / 2, coreFlare(MAP.key) > 1 ? { r1: CORE_R * coreFlare(MAP.key) + CORE_SKIN } : undefined), 'core');
  for (const t of TOWERS) add(makeBox(t.x, (top - 20) / 2, t.z, TW, (top + 20) / 2, TW, 0, -t.a, 0), 'tower');
  placePiers();

  // Zone decorations, all visual only, different for each map.
  const dz = (k, n, f) => { for (let i = 0; i < n; i++) out.decor.push(Object.assign({ k }, f(i))); };
  const zy = (i) => out.zones[i];
  const around = (rMin, rMax) => { const a = rr(0, TAU), r = rr(rMin, rMax); return [Math.cos(a) * r, Math.sin(a) * r, a]; };
  const cloud = () => ({ a: rr(0, TAU), extra: rr(22, 60) - 22, y: rr(zy(2).y0, top + 40), s: rr(4, 9), sp: rr(0.02, 0.06) });
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
    dz('fountain', 5, (i) => {
      const r = rr(22, 28);
      let a = (i / 5) * TAU + 0.3;
      while (onPier(Math.cos(a) * r, Math.sin(a) * r, 2.6, piers)) a += 0.08;
      return { x: Math.cos(a) * r, y: 0.4, z: Math.sin(a) * r, s: rr(0.9, 1.2) };
    });
    dz('fish', 14, () => { const [x, z, a] = around(42, 85); return { x, y: 0, z, ry: a + Math.PI / 2, per: rr(3.5, 7), ph: R(), s: rr(0.8, 1.4) }; });
    dz('cloud', 46, cloud);
    dz('gull', 12, () => ({ x: 0, y: rr(20, top), z: 0, r: rr(18, 40), sp: rr(0.15, 0.3) * (R() < 0.5 ? 1 : -1), ph: R() * TAU }));
  } else if (MAP.key === 'sunny') {
    // A sandy island with palms, boats out at sea and puffy clouds drifting around the upper tower.
    dz('palm', 22, () => { const [x, z] = around(20, 34); return { x, y: 0.4, z, s: rr(0.8, 1.3), ry: rr(0, TAU), lean: rr(-0.35, 0.35) }; });
    dz('boat', 7, () => { const [x, z, a] = around(70, 180); return { x, y: 0, z, s: rr(1, 2), ry: a + rr(-0.5, 0.5) }; });
    dz('cloud', 46, cloud);
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

  // Nothing on the island grows through a pier.
  out.decor = out.decor.filter((d) => d.y > 1.5 || d.k === 'fountain' || !onPier(d.x, d.z, 1.0, piers));

  // A pillar is a column hanging 6 m under its top, but only its top was kept a head's height clear of the route below.
  // Over a walkway, a beam, a zone ring or the start dock the column could end just over your head, or lower: you hit it
  // on every jump there, or could not get past at all (the Wild Forest's start, Magma Chimney's dock and first ring). Each
  // column now stops well clear of anything you stand on under it.
  {
    const ROOM = 2.8, MIN = 1.2, o = {};
    const floors = out.cols.filter((s) => !s.dyn && s.kind !== 'door' && (s.t === BOX ? s.hy < 1.5 : s.kind === 'pillar'));
    for (const c of out.cols) {
      if (c.kind !== 'pillar' || c.t === BOX) continue;
      const top = c.y + c.hh;
      let low = c.y - c.hh;
      for (const s of floors) {
        if (s === c || s.maxy + ROOM <= low || s.maxy >= top) continue;
        if (s.t === BOX) {
          toLocal(s, c.x, s.y, c.z, false, o);
          if (Math.abs(o.x) >= s.hx + c.r || Math.abs(o.z) >= s.hz + c.r) continue;
        } else if (Math.hypot(s.x - c.x, s.z - c.z) >= s.r + c.r) continue;
        low = s.maxy + ROOM;
      }
      low = Math.min(low, top - MIN);
      if (low > c.y - c.hh + 1e-6) {
        c.hh = (top - low) / 2;
        c.y = c.py = top - c.hh;
        aabb(c);
      }
    }
  }

  applyMaze(out, 0);
  // The way up, in order, for the arrow that points along it (main.js): where each piece of the route is. Big footprints
  // (the maze gardens) are left out, so in a maze it points at the way out.
  out.route = [];
  for (const q of recs) {
    if (q.tag === 'secret' || q.guard || q.rad > 6) continue;
    const p = out.route[out.route.length - 1];
    if (p && Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]) < 1.5) continue;
    out.route.push([q.x, q.y, q.z]);
  }
  // A beam or a moving platform is recorded after the platform it leads to: back in between, so the way up goes in the
  // order you climb it (the arrow pointed back at a beam for a moment once you were across it).
  {
    const R3 = out.route, d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (let i = 1; i + 1 < R3.length; i++) {
      const a = R3[i - 1], b = R3[i], c = R3[i + 1];
      if (d(a, c) < d(a, b) && d(a, c) + d(c, b) < d(a, b) * 1.25) { R3[i] = c; R3[i + 1] = b; i++; }
    }
  }
  // The UP HERE sign on the dock: a few steps from where everyone starts, toward the first piece of the route and in from
  // it toward the middle, clear of everything. Its post is solid.
  {
    const [sx, sz] = polar(out.spawn.th, out.spawn.r), f = out.route.find((p) => Math.hypot(p[0] - sx, p[2] - sz) > 2) || [sx + 1, 3, sz];
    const dl = Math.hypot(f[0] - sx, f[2] - sz) || 1, ux = (f[0] - sx) / dl, uz = (f[2] - sz) / dl, rl = Math.hypot(sx, sz), ix = -sx / rl, iz = -sz / rl;
    const clear = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < CORE_R * coreFlare(MAP.key) + 1.4 || r > 18.2) return false;
      return !out.cols.some((c) => {
        if (c.kind === 'dock' || c.kind === 'ring' || c.y - (c.hy ?? c.hh) > 6 || c.y + (c.hy ?? c.hh) < 1.5) return false;
        if (c.r !== undefined) return Math.hypot(c.x - x, c.z - z) < c.r + 1.2;
        const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.ry), sn = Math.sin(c.ry);
        return Math.abs(dx * cs - dz * sn) < c.hx + 1.2 && Math.abs(dx * sn + dz * cs) < c.hz + 1.2;
      });
    };
    let at = null;
    for (const a of [2.2, 3, 1.4, 4]) { for (const b of [4.2, 3.4, 5, 2.6, -3.4, -4.2]) { const x = sx + ux * a + ix * b, z = sz + uz * a + iz * b; if (clear(x, z)) { at = [x, z]; break; } } if (at) break; }
    if (at) {
      add(makeCyl(at[0], 2 + 1.5, at[1], 0.14, 1.5), 'signpost');
      // The board faces where everyone starts; the arrow points at the first piece of the route up.
      out.startSign = { x: at[0], y: 2, z: at[1], ry: Math.atan2(sx - at[0], sz - at[1]), tx: f[0], ty: f[1] + 0.6, tz: f[2] };
    }
  }
  buildCoins();
  // The generated maps have them too, under their world's names (storm:0, storm:h3...): each thing can be found on its world
  // and on every map built on it, in another place each time.
  buildSecrets();
  // Legendary relics in the mazes (MAZE_RELICS), in the cell furthest from the way in, spread up the climb. Like the other
  // hidden suits (kind 'suit'), on every difficulty and with any rules.
  const nRel = Math.min(MAZE_RELICS[MAP.key] || 0, out.mazes.length);
  for (let q = 0; q < nRel; q++) {
    const m = out.mazes[Math.floor(((q + 1) * out.mazes.length) / (nRel + 1))];
    m.relic = MAP.key + ':m' + q;
    out.relics.push({ i: out.relics.length, id: m.relic, kind: 'suit', x: m.rx, y: m.y + 1.05, z: m.rz, maze: m.i });
  }
  // The hidden spots in the maze gardens (hideSpots): one to a maze, in a cell well away from both ways in and from the
  // legendary relic. Only on its own difficulty.
  if (out.mazes.length) {
    hideSpots(MAP.key).filter((q) => q.maze).forEach((q, k) => {
      const m = out.mazes[(k * 3 + 1) % out.mazes.length], R = rng((m.seed ^ Math.imul(q.j + 11, 0x9e3779b1)) >>> 0), far = (i, j, a, b) => Math.abs(i - a) + Math.abs(j - b);
      const taken = out.relics.filter((r) => r.maze === m.i).map((r) => r.cell || [m.ri, m.rj]);
      let cell = null;
      for (let t = 0; t < 200 && !cell; t++) {
        const i = (R() * m.N) | 0, j = (R() * m.N) | 0;
        if (far(i, j, m.ei, m.ej) < 3 || far(i, j, m.xi, m.xj) < 3 || far(i, j, m.ri, m.rj) < 2 || taken.some(([a, b]) => far(i, j, a, b) < 2)) continue;
        cell = [i, j];
      }
      if (!cell) cell = [m.N - 1 - m.ri, m.rj];
      const [x, z] = mazeCell(m, cell[0], cell[1]);
      out.relics.push({ i: out.relics.length, id: q.id, kind: q.legend ? 'suit' : 'epic', dv: q.dv, x, y: m.y + 1.05, z, maze: m.i, cell });
    });
  }

  // Clouds never get in the way of the climb. They slowly circle the middle, so only their distance from it counts:
  // each stays outside the widest part of the route at its height (hidden stones included), with room for the camera
  // behind you on top. Out there no cloud can come between you and anything on the route, whichever way you look and
  // however long you play.
  const routeW = [];
  const noteWide = (y0, y1, r) => { for (let b = Math.max(0, Math.floor(y0 / 4)); b <= Math.floor(y1 / 4); b++) routeW[b] = Math.max(routeW[b] || 0, r); };
  for (const c of out.cols) {
    const box = c.r === undefined, r = Math.hypot(c.x, c.z) + (box ? Math.hypot(c.hx, c.hz) : c.r) + (c.dyn ? 4 : 0);
    const v = box ? (c.rx || c.rz ? Math.hypot(c.hx, c.hy, c.hz) : c.hy) : c.hh;
    noteWide(c.y - v, c.y + v, r);
  }
  for (const o of out.obs) noteWide(o.y - 4, o.y + 4, Math.hypot(o.x, o.z) + 6);
  for (const d of out.decor) {
    if (d.k !== 'cloud') continue;
    const room = d.s * CLOUD_H + CAM_ROOM;
    let r = 0;
    for (let b = Math.max(0, Math.floor((d.y - room) / 4)); b <= Math.floor((d.y + room) / 4); b++) r = Math.max(r, routeW[b] || 0);
    r += CAM_ROOM + d.s * CLOUD_W + d.extra;
    d.x = Math.cos(d.a) * r;
    d.z = Math.sin(d.a) * r;
  }

  out.recs = recs;
  out.usedObs = [...new Set(usedObs)];
  out.obsZone = obsZone;
  // Forest: no decorative trees standing inside a side tree's climb.
  if (out.trees.length) out.decor = out.decor.filter((d) => d.k !== 'tree' || out.trees.every((t) => Math.hypot(d.x - t.x, d.z - t.z) > 11));
  settleGround();
  return out;

  // The four piers are laid before the climb, so a side tree's trunk (the Waterfall's stone pillars) or a skyscraper could
  // end up standing on one, or a pier could run into its wall. Once everything is in place, a pier that meets anything
  // solid near the ground turns round the island to the nearest angle where it is clear, staying well apart from the
  // other piers. One that finds no clear angle stays where it was.
  function placePiers() {
    const pierCols = out.cols.filter((c) => c.kind === 'pier');
    const low = out.cols.filter((c) => c.kind !== 'pier' && c.kind !== 'dock' && c.kind !== 'core' && c.miny < 5 && c.maxy > 0.3);
    const M = 0.7;
    const hits = (a) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let u = PIER_R0 + 0.2; u <= PIER_R0 + PIER_LEN; u += 0.4) {
        for (let v = -PIER_W; v <= PIER_W + 0.01; v += 0.4) {
          const x = ca * u - sa * v, z = sa * u + ca * v;
          for (const c of low) {
            if (x < c.minx - M - 1 || x > c.maxx + M + 1 || z < c.minz - M - 1 || z > c.maxz + M + 1) continue;
            if (c.r !== undefined) {
              if (Math.hypot(x - c.x, z - c.z) < Math.max(c.r, c.r1 || 0) + M) return true;
            } else if (c.rx || c.rz) {
              return true;
            } else {
              const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.ry), sn = Math.sin(c.ry);
              if (Math.abs(dx * cs - dz * sn) < c.hx + M && Math.abs(dx * sn + dz * cs) < c.hz + M) return true;
            }
          }
        }
      }
      return false;
    };
    piers = PIERS.slice();
    piers.forEach((a0, k) => {
      if (!hits(a0)) return;
      for (let i = 1; i <= 20; i++) {
        for (const a of [a0 + i * 0.04, a0 - i * 0.04]) {
          if (piers.some((b, j) => j !== k && Math.abs(angDiff(a, b)) < 0.7) || hits(a)) continue;
          piers[k] = a;
          const old = pierCols[k], x = Math.cos(a) * (PIER_R0 + PIER_LEN / 2), z = Math.sin(a) * (PIER_R0 + PIER_LEN / 2);
          const c = makeBox(x, 1.4, z, PIER_W, 0.6, PIER_LEN / 2, 0, -(a + Math.PI / 2), 0);
          c.kind = old.kind; c.zone = old.zone;
          out.cols[out.cols.indexOf(old)] = c;
          return;
        }
      }
    });
  }

  // Things on the island's ground and on the water round it (palms, trees, fountains, lily pads, boats) each need room of
  // their own: never on the dock or a pier, never in a trunk, a tower, a crate or a stone of a hidden course, and never in
  // each other (a palm in a fountain, two crowns in one). One that isn't clear moves to a free spot in its own ring, with
  // random numbers of its own so the climb itself stays exactly the same; one that finds none is left out. Fountains
  // first, the rest keep their order.
  function settleGround() {
    const RG = rng((MAP.seed ^ 0x6a3d5c) >>> 0);
    const BAND = { fountain: [22, 28], palm: [20, 34], tree: [21, 75], lily: [39, 52], boat: [70, 180] };
    const low = out.cols.filter((c) => c.kind !== 'dock' && c.kind !== 'core' && c.kind !== 'pier' && c.miny < 14 && c.maxy > -1);
    // b: what stands on the ground (radius), t: the crown or spray up top (radius, centre tx tz, from height ty), h: how tall.
    const shape = (d, x, z) => {
      const s = d.s || 1;
      if (d.k === 'palm') {
        // The trunk bends out and the crown sits off to one side (worldview.js palms): where the crown really is.
        const k = (1.35 - 6.8 * Math.sin((d.lean || 0) * 0.3)) * s;
        return { b: 0.55 * s, t: 2.6 * s, tx: x + Math.cos(d.ry || 0) * k, tz: z - Math.sin(d.ry || 0) * k, ty: 5.5 * s, h: 9 * s };
      }
      if (d.k === 'tree') return { b: 0.7 * s, t: 3.2 * s, tx: x, tz: z, ty: 1.9 * s, h: 11 * s };
      if (d.k === 'fountain') return { b: 1.85 * s, t: 1.5 * s, tx: x, tz: z, ty: 0.6, h: 4 * s };
      if (d.k === 'lily') return { b: 1.0 * s, t: 0, tx: x, tz: z, ty: 0, h: 0.5 };
      return { b: 3.8 * s, t: 0, tx: x, tz: z, ty: 0, h: 7 * s };
    };
    const inBox = (c, x, z, r) => x + r > c.minx && x - r < c.maxx && z + r > c.minz && z - r < c.maxz;
    const placed = [];
    const clear = (d, x, z, f) => {
      if (Math.hypot(x, z) - f.b < 19.6 || onPier(x, z, f.b + 0.3, piers)) return false;
      if (f.t && onPier(f.tx, f.tz, f.t * 0.8, piers)) return false;
      for (const c of low) {
        if (c.miny > f.h || c.maxy < -0.5) continue;
        if (inBox(c, x, z, f.b)) return false;
        if (f.t && c.maxy > f.ty && inBox(c, f.tx, f.tz, f.t * 0.8)) return false;
      }
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < f.b + p.f.b + 0.3) return false;
        if (f.t && p.f.t && Math.hypot(f.tx - p.f.tx, f.tz - p.f.tz) < (f.t + p.f.t) * 0.6) return false;
        if (f.t && p.d.k === 'fountain' && Math.hypot(f.tx - p.x, f.tz - p.z) < f.t * 0.7 + p.f.b) return false;
      }
      return true;
    };
    const items = out.decor.filter((d) => BAND[d.k] && (d.y ?? 0) < 1.5);
    items.sort((a, b) => (a.k === 'fountain' ? 0 : 1) - (b.k === 'fountain' ? 0 : 1));
    const gone = new Set();
    for (const d of items) {
      let x = d.x, z = d.z, f = shape(d, x, z), ok = clear(d, x, z, f);
      const [r0, r1] = BAND[d.k];
      for (let t = 0; t < 80 && !ok; t++) {
        const a = RG() * TAU, r = r0 + RG() * (r1 - r0);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        f = shape(d, x, z);
        ok = clear(d, x, z, f);
      }
      if (!ok) { gone.add(d); continue; }
      d.x = x;
      d.z = z;
      placed.push({ d, x, z, f });
    }
    if (gone.size) out.decor = out.decor.filter((d) => !gone.has(d));
  }
}

// Which hidden paths a climb has: all of them, on every difficulty and with any rules (the hard ones used to be Hardcore and
// Insane only until 4.10.6, and custom rules had none until 4.10.21).
// Both kinds at once, as storm.sec and worldview.setSecrets take them: 'open' are the epic paths, 'hard' all the others.
export const ALL_SECRETS = { hard: true, open: true };
// What a climb on difficulty d has: all of them, but of the hidden spots (hideSpots) only that difficulty's.
export const secretsFor = (d) => ({ hard: true, open: true, dv: d });
// Is this here on that difficulty? (c.dv: the one difficulty a hidden spot's course or relic is there on.)
export const dvOn = (c, sec) => c.dv === undefined || !sec || sec.dv === undefined || c.dv === sec.dv;
export const secretOn = (c, sec) => !!sec && (c.rk === 'epic' ? !!sec.open : !!sec.hard) && dvOn(c, sec);

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
