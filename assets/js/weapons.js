// The weapons: only numbers, so the server's rerun can check a shot against the same table. The models are in gear.js and
// the way each is held in stickman.js.
//   rate  seconds between shots          auto  keeps firing while the trigger is held
//   stun  seconds an enemy stays paralysed (a minute more than the old 5 at the very least)
//   range metres the shot reaches        hit   how much bigger targets count
//   knock how hard it throws a friend, with friendly fire on
//   zoom  how narrow the view is when aiming (48 is no zoom); scope draws a real sight over the screen
//   blast metres round the hit it also reaches
//   n     streaks of light per shot      beam  how the shot looks (see BEAMS)
//   hold  how the climber holds it       snd   how it sounds
export const STUN_MIN = 65;

const w = (id, name, r, price, hold, snd, o) => Object.assign({ id, name, r, price, kind: 'weapon', tab: 'weapons', hold, snd, rate: 0.3, auto: false, stun: STUN_MIN, range: 70, hit: 1, knock: 8, zoom: 48, scope: false, blast: 0, n: 1, beam: '' }, o);

export const WEAPONS = [
  // Sidearms
  w('w_blaster', 'Blaster', 0, 0, 'pistol', 'pistol', { rate: 0.3, range: 70 }),
  w('w_scout', 'Scout Pistol', 0, 150, 'pistol', 'pistol', { rate: 0.24, stun: 66, range: 72 }),
  w('w_revolver', 'Iron Revolver', 0, 300, 'pistol', 'magnum', { rate: 0.5, stun: 75, range: 85, hit: 1.05, knock: 11 }),
  w('w_handcannon', 'Hand Cannon', 1, 900, 'pistol', 'magnum', { rate: 0.62, stun: 90, range: 90, hit: 1.15, knock: 14 }),
  w('w_viper', 'Viper Machine Pistol', 1, 1100, 'pistol', 'smg', { rate: 0.11, auto: true, stun: 68, range: 62, knock: 5 }),
  w('w_zapper', 'Pocket Zapper', 0, 120, 'pistol', 'pistol', { rate: 0.26, range: 66, knock: 7 }),
  w('w_duelist', 'Duelist', 0, 260, 'pistol', 'magnum', { rate: 0.45, stun: 72, range: 82, hit: 1.02, knock: 10 }),
  w('w_flaregun', 'Flare Gun', 1, 950, 'pistol', 'boom', { rate: 0.9, stun: 85, range: 70, hit: 1.2, knock: 12, blast: 2, beam: 'fire' }),
  w('w_twinfang', 'Twin Fang', 1, 1000, 'pistol', 'smg', { rate: 0.12, auto: true, stun: 69, range: 64, knock: 6 }),
  // Submachine guns
  w('w_buzz', 'Buzz SMG', 0, 400, 'smg', 'smg', { rate: 0.1, auto: true, range: 58, knock: 5 }),
  w('w_stinger', 'Stinger', 1, 1200, 'smg', 'smg', { rate: 0.08, auto: true, stun: 70, range: 62, knock: 5 }),
  w('w_ghost', 'Ghost PDW', 2, 2400, 'smg', 'silent', { rate: 0.065, auto: true, stun: 80, range: 72, hit: 1.05, knock: 6, beam: 'plasma' }),
  w('w_compact', 'Compact SMG', 0, 350, 'smg', 'smg', { rate: 0.09, auto: true, range: 55, knock: 4 }),
  w('w_hornet', 'Hornet', 1, 1150, 'smg', 'smg', { rate: 0.075, auto: true, stun: 70, range: 60, knock: 5 }),
  w('w_plasma', 'Plasma Caster', 2, 2600, 'smg', 'energy', { rate: 0.08, auto: true, stun: 82, range: 74, hit: 1.05, knock: 6, beam: 'plasma' }),
  w('w_venom', 'Venom Spitter', 2, 2700, 'smg', 'silent', { rate: 0.07, auto: true, stun: 84, range: 70, knock: 6, beam: 'acid' }),
  // Shotguns
  w('w_pump', 'Pump Breaker', 0, 450, 'shotgun', 'shotgun', { rate: 0.85, stun: 75, range: 36, hit: 1.7, knock: 16, n: 5 }),
  w('w_sweeper', 'Street Sweeper', 1, 1300, 'shotgun', 'shotgun', { rate: 0.36, auto: true, stun: 70, range: 34, hit: 1.7, knock: 12, n: 5 }),
  w('w_dragonb', 'Dragon Breath', 2, 2800, 'shotgun', 'shotgun', { rate: 0.68, stun: 95, range: 42, hit: 2, knock: 20, n: 5, beam: 'fire' }),
  w('w_double', 'Double Barrel', 0, 380, 'shotgun', 'shotgun', { rate: 0.95, stun: 78, range: 32, hit: 1.8, knock: 18, n: 6 }),
  w('w_slug', 'Slug Thrower', 1, 1250, 'shotgun', 'shotgun', { rate: 0.7, stun: 85, range: 55, hit: 1.3, knock: 18 }),
  w('w_cryo', 'Cryo Blaster', 2, 2900, 'shotgun', 'energy', { rate: 0.6, stun: 100, range: 44, hit: 1.9, knock: 18, n: 5, beam: 'ice' }),
  // Rifles
  w('w_carbine', 'Ranger Carbine', 0, 500, 'rifle', 'rifle', { rate: 0.17, auto: true, stun: 68, range: 88, knock: 8 }),
  w('w_stormar', 'Storm Rifle', 1, 1400, 'rifle', 'rifle', { rate: 0.11, auto: true, stun: 72, range: 92, knock: 8 }),
  w('w_razor', 'Razor Bullpup', 1, 1600, 'rifle', 'rifle', { rate: 0.09, auto: true, stun: 70, range: 88, knock: 7 }),
  w('w_nova', 'Nova Battle Rifle', 2, 3000, 'rifle', 'energy', { rate: 0.28, stun: 105, range: 115, hit: 1.1, knock: 12, zoom: 38, beam: 'plasma' }),
  w('w_lever', 'Lever Action', 0, 420, 'rifle', 'rifle', { rate: 0.45, stun: 72, range: 95, knock: 10 }),
  w('w_tactical', 'Tactical Rifle', 1, 1450, 'rifle', 'rifle', { rate: 0.12, auto: true, stun: 72, range: 95, knock: 8 }),
  w('w_tesla', 'Tesla Coil', 2, 3100, 'rifle', 'thunder', { rate: 0.3, stun: 110, range: 80, hit: 1.2, knock: 12, blast: 2.5, beam: 'bolt' }),
  w('w_starfall', 'Starfall Repeater', 2, 3300, 'rifle', 'energy', { rate: 0.1, auto: true, stun: 85, range: 100, knock: 9, beam: 'star' }),
  // Snipers
  w('w_hunter', 'Hunter Bolt', 1, 1500, 'sniper', 'sniper', { rate: 1.2, stun: 110, range: 140, knock: 22, zoom: 20, scope: true }),
  w('w_longshot', 'Longshot', 1, 1900, 'sniper', 'sniper', { rate: 1.05, stun: 100, range: 170, knock: 20, zoom: 15, scope: true }),
  w('w_phantom', 'Phantom DMR', 2, 3200, 'sniper', 'silent', { rate: 0.5, stun: 95, range: 150, knock: 16, zoom: 22, scope: true }),
  w('w_railspike', 'Rail Spike', 2, 3800, 'sniper', 'rail', { rate: 1.1, stun: 135, range: 200, knock: 28, zoom: 13, scope: true, beam: 'rail' }),
  w('w_dmr', 'Marksman DMR', 1, 1700, 'sniper', 'sniper', { rate: 0.6, stun: 92, range: 135, knock: 15, zoom: 24, scope: true }),
  w('w_lancer', 'Neon Lancer', 2, 3600, 'sniper', 'energy', { rate: 0.9, stun: 125, range: 180, knock: 24, zoom: 14, scope: true, beam: 'neon' }),
  // Machine guns
  w('w_bulldog', 'Bulldog LMG', 1, 1800, 'heavy', 'heavy', { rate: 0.1, auto: true, stun: 72, range: 82, knock: 9 }),
  w('w_ironbelt', 'Iron Belt', 2, 3000, 'heavy', 'heavy', { rate: 0.085, auto: true, stun: 80, range: 92, knock: 10 }),
  w('w_ripper', 'Ripper Minigun', 2, 3600, 'heavy', 'heavy', { rate: 0.05, auto: true, stun: 72, range: 76, knock: 8 }),
  w('w_hacksaw', 'Hacksaw LMG', 1, 1900, 'heavy', 'heavy', { rate: 0.09, auto: true, stun: 74, range: 84, knock: 9 }),
  // Launchers
  w('w_thumper', 'Thumper', 2, 3400, 'launcher', 'boom', { rate: 1.15, stun: 110, range: 76, hit: 1.3, knock: 22, blast: 4, beam: 'fire' }),
  w('w_harpoon', 'Harpoon Gun', 2, 3500, 'launcher', 'rail', { rate: 1.3, stun: 130, range: 120, hit: 1.25, knock: 30, beam: 'rail' }),
  w('w_quake', 'Quake Mortar', 2, 3700, 'launcher', 'boom', { rate: 1.3, stun: 115, range: 80, hit: 1.35, knock: 26, blast: 5, beam: 'fire' }),
  // The seven legendaries: far stronger than anything else.
  w('w_solar', 'Solar Flare', 3, 8000, 'pistol', 'energy', { rate: 0.34, stun: 150, range: 115, hit: 1.45, knock: 22, blast: 3, beam: 'gold' }),
  w('w_frost', 'Absolute Zero', 3, 10000, 'rifle', 'energy', { rate: 0.12, auto: true, stun: 180, range: 125, hit: 1.25, knock: 14, zoom: 38, beam: 'ice' }),
  w('w_stormb', 'Stormbreaker', 3, 12000, 'shotgun', 'thunder', { rate: 0.56, stun: 170, range: 62, hit: 2.2, knock: 30, blast: 6, n: 4, beam: 'bolt' }),
  w('w_hellfire', 'Hellfire', 3, 14000, 'heavy', 'heavy', { rate: 0.04, auto: true, stun: 150, range: 105, hit: 1.3, knock: 14, beam: 'fire' }),
  w('w_titan', 'Titan Railgun', 3, 15000, 'sniper', 'rail', { rate: 1, stun: 240, range: 320, hit: 1.2, knock: 42, zoom: 9, scope: true, blast: 2, beam: 'rail' }),
  w('w_void', 'Void Cannon', 3, 18000, 'launcher', 'void', { rate: 1.25, stun: 300, range: 125, hit: 1.5, knock: 42, blast: 9, beam: 'void' }),
  w('w_dragon', 'Dragon Roar', 3, 20000, 'launcher', 'boom', { rate: 0.9, stun: 240, range: 115, hit: 1.5, knock: 36, blast: 7, beam: 'fire' }),
];
export const WEAPON = Object.fromEntries(WEAPONS.map((x) => [x.id, x]));
export const FREE_WEAPON = 'w_blaster';
export const weaponOf = (id) => (typeof id === 'string' && Object.hasOwn(WEAPON, id) ? WEAPON[id] : WEAPON[FREE_WEAPON]);

// How a shot looks: colour, how bright, how thick and how long it stays. No beam is the player's own colour.
export const BEAMS = {
  plasma: { c: 0x60e0ff, k: 3.4, r: 0.05, life: 0.18 },
  fire: { c: 0xff7a1a, k: 3.6, r: 0.07, life: 0.22 },
  gold: { c: 0xffd24a, k: 4.2, r: 0.075, life: 0.26 },
  ice: { c: 0x9ff0ff, k: 3.6, r: 0.055, life: 0.22 },
  bolt: { c: 0xb8a0ff, k: 4.4, r: 0.04, life: 0.24 },
  rail: { c: 0x50c8ff, k: 5, r: 0.11, life: 0.55 },
  void: { c: 0xa040ff, k: 4.4, r: 0.14, life: 0.5 },
  acid: { c: 0x8aff3a, k: 3.4, r: 0.055, life: 0.2 },
  neon: { c: 0xff40d0, k: 4, r: 0.06, life: 0.4 },
  star: { c: 0xffb0f0, k: 3.8, r: 0.05, life: 0.2 },
};
