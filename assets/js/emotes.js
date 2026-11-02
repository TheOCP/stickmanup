// Emotes and stunts: what the climber can do from the emote menu. Each has a pose function that overrides the
// pose targets for that frame (see Stickman.update): u = seconds since it started, k = 0..1 through it (0 when it
// loops). rx, ry, rz turn the whole body round its middle, lift moves it up and down.
// hop: starts with a real jump when on the ground. Flips keep going while you move; poses stop when you do.
const S = Math.sin, A = Math.abs, PI = Math.PI, smooth = (k) => k * k * (3 - 2 * k);

function tuck(p, k) {
  // Curled up in the middle of a flip, opening out at both ends.
  const f = S(Math.min(1, k) * PI);
  p.legX = [-1.75 * f - 0.1, -1.75 * f - 0.1]; p.knee = [2.2 * f, 2.2 * f];
  p.armX = [-1.2 * f, -1.2 * f]; p.armZ = [0.35, 0.35]; p.elbow = [-1.4 * f - 0.2, -1.4 * f - 0.2];
  p.mouthO = 1.2;
}

const E = (id, name, icon, r, price, o) => Object.assign({ id, name, icon, r, price, kind: 'emote', tab: 'emotes' }, o);

export const EMOTES = [
  E('e_wave', 'Wave', '👋', 0, 0, { dur: 1.8, pose(p, u) {
    p.armX[0] = -2.6; p.armZ[0] = 0.45 + S(u * 12) * 0.35; p.elbow[0] = -0.45; p.mouthO = 0.9; p.headY += 0.2;
  } }),
  E('e_clap', 'Clap', '👏', 0, 0, { dur: 2, pose(p, u) {
    const c = (S(u * 15) + 1) / 2;
    p.armX = [-1.45, -1.45]; p.armZ = [-0.32 + c * 0.6, -0.32 + c * 0.6]; p.elbow = [-0.55, -0.55];
    p.mouthO = 1.2; p.bounce = A(S(u * 7.5)) * 0.05;
  } }),
  E('e_thumbs', 'Thumbs up', '👍', 0, 0, { dur: 1.6, pose(p, u) {
    p.armX[0] = -1.3; p.armZ[0] = 0.15; p.elbow[0] = -1.5; p.headX = S(u * 6) * 0.14; p.mouthO = 0.8;
  } }),
  E('e_backflip', 'Backflip', '🤸', 0, 0, { dur: 0.62, flip: true, hop: true, pose(p, u, k) { p.rx = -2 * PI * smooth(k); tuck(p, k); } }),
  E('e_laugh', 'Laugh', '😂', 0, 60, { dur: 2.2, pose(p, u) {
    p.lean = -0.18 + S(u * 13) * 0.14; p.armX = [-0.35, -0.35]; p.armZ = [0.3, 0.3]; p.elbow = [-1.7, -1.7];
    p.headX = -0.22 + S(u * 13) * 0.08; p.mouthO = 1.6; p.bounce = A(S(u * 13)) * 0.04;
  } }),
  E('e_cry', 'Cry', '😭', 0, 60, { dur: 2.4, pose(p, u) {
    p.armX = [-2.1, -2.1]; p.armZ = [-0.22, -0.22]; p.elbow = [-2.25, -2.25]; p.headX = 0.42 + S(u * 12) * 0.05;
    p.lean = 0.18; p.crouch = 0.05; p.mouthO = 0.9 + S(u * 9) * 0.3;
  } }),
  E('e_facepalm', 'Facepalm', '🤦', 0, 80, { dur: 2.2, pose(p, u) {
    p.armX[0] = -2.05; p.armZ[0] = -0.28; p.elbow[0] = -2.35; p.headX = 0.42; p.headY += S(u * 3.4) * 0.16; p.lean = 0.1; p.mouthO = 0.4;
  } }),
  E('e_salute', 'Salute', '🎖️', 0, 80, { dur: 1.8, pose(p) {
    p.armX[0] = -2.1; p.armZ[0] = 0.85; p.elbow[0] = -2.2; p.headX = -0.08; p.mouthO = 0.35;
  } }),
  E('e_flex', 'Flex', '💪', 0, 120, { dur: 2.2, pose(p, u) {
    const b = S(u * 7) * 0.2;
    p.armX = [-0.15, -0.15]; p.armZ = [1.5, 1.5]; p.elbow = [-2.1 - b, -2.1 + b]; p.lean = -0.1; p.twist = S(u * 3.5) * 0.25; p.mouthO = 0.8;
  } }),
  E('e_point', 'Point and laugh', '👉', 0, 120, { dur: 2.2, pose(p, u) {
    p.armX[0] = -1.57; p.armZ[0] = 0.02; p.elbow[0] = -0.04; p.armX[1] = -0.3; p.armZ[1] = 0.3; p.elbow[1] = -1.7;
    p.lean = S(u * 13) * 0.12; p.mouthO = 1.6; p.headX = -0.15; p.bounce = A(S(u * 13)) * 0.04;
  } }),
  E('e_tpose', 'T pose', '✈️', 1, 250, { loop: true, pose(p) {
    p.armX = [0, 0]; p.armZ = [1.57, 1.57]; p.elbow = [0, 0]; p.mouthO = 0.3; p.headY = 0;
  } }),
  E('e_chill', 'Meditate', '🧘', 1, 280, { loop: true, pose(p, u) {
    p.legX = [-1.5, -1.5]; p.knee = [2.25, 2.25]; p.crouch = 0.1; p.armX = [-0.6, -0.6]; p.armZ = [0.55, 0.55]; p.elbow = [-0.9, -0.9];
    p.lift = 0.35 + S(u * 1.8) * 0.06; p.headX = 0.1; p.mouthO = 0.3;
  } }),
  E('e_spin', 'Spin', '🌪️', 1, 280, { dur: 0.9, flip: true, pose(p, u, k) {
    p.ry = 4 * PI * smooth(k); p.armX = [0, 0]; p.armZ = [1.45, 1.45]; p.elbow = [-0.1, -0.1]; p.legX = [0, -0.5]; p.knee = [0, 0.9]; p.mouthO = 1.1;
  } }),
  E('e_frontflip', 'Front flip', '🙃', 1, 300, { dur: 0.62, flip: true, hop: true, pose(p, u, k) { p.rx = 2 * PI * smooth(k); tuck(p, k); } }),
  E('e_cartwheel', 'Cartwheel', '🎡', 1, 320, { dur: 0.95, flip: true, pose(p, u, k) {
    p.rz = 2 * PI * smooth(k); p.armX = [0, 0]; p.armZ = [1.45, 1.45]; p.elbow = [0, 0]; p.legZ = [0.6, 0.6]; p.mouthO = 1; p.lift = S(k * PI) * 0.22;
  } }),
  E('e_robot', 'Robot', '🤖', 1, 350, { loop: true, pose(p, u) {
    // Snaps from one stiff pose to the next on the beat.
    const b = Math.floor(u * 3.2) % 8, M = [[-1.57, 0, -1.57, -1.57], [-1.57, -1.57, 0, -1.57], [0, -1.57, -1.57, 0], [-2.8, -0.2, -1.57, 0], [-0.2, -2.8, 0, -1.57], [-1.57, -1.57, -1.57, -1.57], [-2.8, -2.8, 0, 0], [0, 0, -1.57, -1.57]][b];
    p.armX = [M[0], M[1]]; p.elbow = [M[2], M[3]]; p.armZ = [0.1, 0.1]; p.headY = [-0.5, 0.5, 0, 0.5, -0.5, 0, 0, 0][b]; p.twist = [0.2, -0.2, 0, 0.2, -0.2, 0, 0, 0][b]; p.mouthO = 0.3;
    p.bounce = b % 2 ? 0.02 : 0;
  } }),
  E('e_floss', 'Floss', '🕺', 1, 380, { loop: true, pose(p, u) {
    const w = S(u * 11), s = Math.sign(S(u * 5.5)) || 1;
    p.armX = [0.55 * s, -0.55 * s]; p.armZ = [0.1 + w * 0.8, 0.1 - w * 0.8]; p.elbow = [-0.1, -0.1];
    p.twist = -s * 0.3; p.rz = w * 0.09; p.legZ = [0.12, 0.12]; p.mouthO = 0.9; p.headY = s * 0.2; p.bounce = A(w) * 0.03;
  } }),
  E('e_disco', 'Disco', '💃', 2, 600, { loop: true, pose(p, u) {
    const up = S(u * 5) > 0;
    p.armX = [up ? -2.85 : 0.5, -0.3]; p.armZ = [up ? 0.35 : -0.35, 0.3]; p.elbow = [-0.1, -1.5];
    p.twist = (up ? 0.3 : -0.3); p.rz = up ? -0.1 : 0.1; p.legZ = [0.14, 0.14]; p.knee = [up ? 0 : 0.35, up ? 0.35 : 0]; p.legX = [up ? 0 : -0.2, up ? -0.2 : 0];
    p.headY = up ? 0.35 : -0.35; p.bounce = A(S(u * 10)) * 0.05; p.mouthO = 1;
  } }),
  E('e_runman', 'Running man', '🏃', 2, 650, { loop: true, pose(p, u) {
    const w = S(u * 9), f = w > 0 ? 1 : 0;
    p.legX = [-1.1 * f + 0.45 * (1 - f), -1.1 * (1 - f) + 0.45 * f]; p.knee = [1.3 * f + 0.1, 1.3 * (1 - f) + 0.1];
    p.armX = [-1.5 - w * 0.5, -1.5 + w * 0.5]; p.elbow = [-1.6, -1.6]; p.armZ = [0.3, 0.3]; p.lean = 0.14; p.bounce = A(w) * 0.05; p.mouthO = 0.9;
  } }),
  E('e_worm', 'The Worm', '🐛', 2, 700, { loop: true, pose(p, u) {
    const a = u * 7.5, w = S(a);
    p.rx = 1.42 + w * 0.26; p.lift = -0.62 + A(w) * 0.16; p.lean = S(a + 1.1) * 0.55;
    p.legX = [S(a + 2.2) * 0.6, S(a + 2.2) * 0.6]; p.knee = [0.5 + S(a + 3) * 0.5, 0.5 + S(a + 3) * 0.5];
    p.armX = [-1.2, -1.2]; p.armZ = [0.5, 0.5]; p.elbow = [-1.3, -1.3]; p.headX = -0.6; p.mouthO = 1;
  } }),
  E('e_windmill', 'Windmill', '🌀', 2, 800, { loop: true, pose(p, u) {
    // Breakdance: down on the shoulders, legs wide and swinging round.
    const a = u * 9, w = S(a);
    p.ry = a; p.rx = -1.42 + w * 0.22; p.rz = S(a + 1) * 0.2; p.lift = -0.56;
    p.legX = [w * 0.65, -w * 0.65]; p.legZ = [0.95, 0.95]; p.knee = [0.08, 0.08]; p.armX = [0, 0]; p.armZ = [1.4, 1.4]; p.elbow = [-0.3, -0.3]; p.mouthO = 1.1;
  } }),
  E('e_headspin', 'Headspin', '🌟', 2, 900, { loop: true, pose(p, u) {
    p.ry = u * 13; p.rx = PI; p.lift = 0.06;
    p.legX = [S(u * 4) * 0.2, -S(u * 4) * 0.2]; p.legZ = [0.75, 0.75]; p.knee = [0.1, 0.1]; p.armX = [-0.2, -0.2]; p.armZ = [1.25, 1.25]; p.elbow = [-0.3, -0.3]; p.mouthO = 1.2;
  } }),
  E('e_double', 'Double backflip', '💫', 2, 1000, { dur: 0.74, flip: true, hop: true, pose(p, u, k) { p.rx = -4 * PI * smooth(k); tuck(p, Math.min(1, k * 1.05)); } }),
  // Not in the menu: what a wall jump does by itself.
  E('e_wallflip', 'Wall flip', '', 0, 0, { dur: 0.46, flip: true, hidden: true, pose(p, u, k) { p.rx = -2 * PI * smooth(k); tuck(p, k); } }),
];
export const EMOTE = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
