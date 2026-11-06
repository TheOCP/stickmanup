// Copied from assets/js by dev/makesim.mjs. Do not edit here.
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
    p.armX[0] = -2.6; p.armZ[0] = 0.65 + S(u * 12) * 0.3; p.elbow[0] = -0.45; p.mouthO = 0.9; p.headY += 0.2;
  } }),
  E('e_clap', 'Clap', '👏', 0, 0, { dur: 2, pose(p, u) {
    // The hands meet in front of the chest and part again.
    const x = 0.08 + ((S(u * 15) + 1) / 2) * 0.14;
    p.hand = [[-x, 0.5, 0.36, -1, -0.6, 0], [x, 0.5, 0.36, 1, -0.6, 0]];
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
  E('e_cry', 'Cry', '😭', 0, 60, { dur: 3.2, pose(p, u) {
    // Fists rubbing the eyes from in front, shoulders shaking with the sobs, tears falling from the cheeks.
    const sob = A(S(u * 8)), a = u * 10;
    p.headX = 0.3 + sob * 0.07; p.lean = 0.14; p.crouch = 0.04; p.bounce = sob * 0.015; p.mouthO = 0.8 + sob * 0.5;
    p.hand = [[-0.1 + S(a) * 0.014, 0.05 + Math.cos(a) * 0.014, 0.275, -0.7, -1, 0.3, 1], [0.1 + S(a + 2) * 0.014, 0.05 + Math.cos(a + 2) * 0.014, 0.275, 0.7, -1, 0.3, 1]];
    p.tears = 9;
  } }),
  E('e_facepalm', 'Facepalm', '🤦', 0, 80, { dur: 2.2, pose(p, u) {
    // A hand flat over the eyes, the head shaking slowly under it.
    p.headX = 0.42; p.headY = S(u * 3.4) * 0.16; p.lean = 0.1; p.mouthO = 0.4;
    p.hand = [[-0.01, 0.07, 0.285, -1, -1, 0.4, 1], null];
  } }),
  E('e_salute', 'Salute', '🎖️', 0, 80, { dur: 1.8, pose(p) {
    // Fingers to the brow, elbow out to the side.
    p.hand = [[-0.16, 0.13, 0.205, -1, 0.15, 0.2, 1], null]; p.headX = -0.08; p.mouthO = 0.35;
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
  E('e_spin', 'Spin', '🩰', 1, 280, { dur: 0.9, flip: true, pose(p, u, k) {
    p.ry = 4 * PI * smooth(k); p.armX = [0, 0]; p.armZ = [1.45, 1.45]; p.elbow = [-0.1, -0.1]; p.legX = [0, -0.5]; p.knee = [0, 0.9]; p.mouthO = 1.1;
  } }),
  E('e_frontflip', 'Front flip', '🙃', 1, 300, { dur: 0.62, flip: true, hop: true, pose(p, u, k) { p.rx = 2 * PI * smooth(k); tuck(p, k); } }),
  E('e_cartwheel', 'Cartwheel', '🎡', 1, 320, { dur: 0.95, flip: true, pose(p, u, k) {
    p.rz = 2 * PI * smooth(k); p.armX = [0, 0]; p.armZ = [1.45, 1.45]; p.elbow = [0, 0]; p.legZ = [0.6, 0.6]; p.mouthO = 1; p.lift = S(k * PI) * 0.22;
  } }),
  E('e_robot', 'Robot', '🤖', 1, 350, { loop: true, pose(p, u) {
    // Snaps from one stiff pose to the next on the beat. An arm up goes out a little, clear of the head.
    const b = Math.floor(u * 3.2) % 8, M = [[-1.57, 0, -1.57, -1.57], [-1.57, -1.57, 0, -1.57], [0, -1.57, -1.57, 0], [-2.4, -0.2, 0, -1.57], [-0.2, -2.4, -1.57, 0], [-1.57, -1.57, -1.57, -1.57], [-2.8, -2.8, 0, 0], [0, 0, -1.57, -1.57]][b];
    p.armX = [M[0], M[1]]; p.elbow = [M[2], M[3]]; p.armZ = [M[0] < -2 ? 0.45 : 0.1, M[1] < -2 ? 0.45 : 0.1]; p.headY = [-0.5, 0.5, 0, 0.5, -0.5, 0, 0, 0][b]; p.twist = [0.2, -0.2, 0, 0.2, -0.2, 0, 0, 0][b]; p.mouthO = 0.3;
    p.bounce = b % 2 ? 0.02 : 0;
  } }),
  E('e_floss', 'Floss', '🕺', 1, 380, { loop: true, pose(p, u) {
    const w = S(u * 11), s = Math.sign(S(u * 5.5)) || 1;
    p.armX = [0.95 * s, -0.95 * s]; p.armZ = [0.1 + w * 0.8, 0.1 - w * 0.8]; p.elbow = [-0.1, -0.1];
    p.twist = -s * 0.3; p.rz = w * 0.09; p.legZ = [0.12, 0.12]; p.mouthO = 0.9; p.headY = s * 0.2; p.bounce = A(w) * 0.03;
  } }),
  E('e_disco', 'Disco', '💃', 2, 600, { loop: true, pose(p, u) {
    // One finger to the sky, then down across the body, the other hand on the hip.
    const up = S(u * 5) > 0;
    p.armX = [up ? -2.85 : -0.55, 0]; p.armZ = [up ? 0.35 : -0.3, 0.3]; p.elbow = [-0.1, 0];
    p.hand = [null, [0.22, 0.12, 0.04, 1, 0, -0.4]];
    p.twist = (up ? 0.3 : -0.3); p.rz = up ? -0.1 : 0.1; p.legZ = [0.14, 0.14]; p.knee = [up ? 0 : 0.35, up ? 0.35 : 0]; p.legX = [up ? 0 : -0.2, up ? -0.2 : 0];
    p.headY = up ? 0.35 : -0.35; p.bounce = A(S(u * 10)) * 0.05; p.mouthO = 1;
  } }),
  E('e_runman', 'Running man', '🏃', 2, 650, { loop: true, pose(p, u) {
    const w = S(u * 9), f = w > 0 ? 1 : 0;
    p.legX = [-1.1 * f + 0.45 * (1 - f), -1.1 * (1 - f) + 0.45 * f]; p.knee = [1.3 * f + 0.1, 1.3 * (1 - f) + 0.1];
    p.armX = [-1.5 - w * 0.5, -1.5 + w * 0.5]; p.elbow = [-1.6, -1.6]; p.armZ = [0.3, 0.3]; p.lean = 0.14; p.bounce = A(w) * 0.05; p.mouthO = 0.9;
  } }),
  E('e_worm', 'The Worm', '🐛', 2, 700, { loop: true, pose(p, u) {
    // Face down on the floor, a wave running from the chest to the feet.
    const a = u * 7.5, w = S(a);
    p.floor = true; p.rx = 1.45 + w * 0.2; p.lift = A(w) * 0.05; p.lean = S(a + 1.1) * 0.5;
    p.legX = [S(a + 2.2) * 0.6, S(a + 2.2) * 0.6]; p.knee = [0.5 + S(a + 3) * 0.5, 0.5 + S(a + 3) * 0.5];
    p.armX = [-1.2, -1.2]; p.armZ = [0.5, 0.5]; p.elbow = [-1.3, -1.3]; p.headX = -0.6; p.mouthO = 1;
  } }),
  E('e_windmill', 'Windmill', '🌀', 2, 800, { loop: true, pose(p, u) {
    // Breakdance: down on the shoulders, legs wide and swinging round.
    const a = u * 9, w = S(a);
    p.floor = true; p.ry = a; p.rx = -1.42 + w * 0.22; p.rz = S(a + 1) * 0.2;
    p.legX = [w * 0.65, -w * 0.65]; p.legZ = [0.95, 0.95]; p.knee = [0.08, 0.08]; p.armX = [0, 0]; p.armZ = [1.4, 1.4]; p.elbow = [-0.3, -0.3]; p.mouthO = 1.1;
  } }),
  E('e_headspin', 'Headspin', '🌟', 2, 900, { loop: true, pose(p, u) {
    p.floor = true; p.ry = u * 13; p.rx = PI;
    p.legX = [S(u * 4) * 0.2, -S(u * 4) * 0.2]; p.legZ = [0.75, 0.75]; p.knee = [0.1, 0.1]; p.armX = [-0.2, -0.2]; p.armZ = [1.25, 1.25]; p.elbow = [-0.3, -0.3]; p.mouthO = 1.2;
  } }),
  E('e_double', 'Double backflip', '💫', 2, 1000, { dur: 0.74, flip: true, hop: true, pose(p, u, k) { p.rx = -4 * PI * smooth(k); tuck(p, Math.min(1, k * 1.05)); } }),
  // ------------------------------------------- added in 4.10.33
  E('e_bow', 'Bow', '🙇', 0, 0, { dur: 1.8, pose(p, u, k) {
    const e = S(k * PI); p.lean = 0.95 * e; p.headX = 0.3 * e; p.armX = [0.12 * e, 0.12 * e]; p.armZ = [0.08, 0.08]; p.elbow = [-0.2, -0.2]; p.mouthO = 0.3;
  } }),
  E('e_shrug', 'Shrug', '🤷', 0, 0, { dur: 1.6, pose(p, u, k) {
    const e = Math.min(1, u * 5) * (1 - smooth(Math.max(0, (k - 0.8) * 5)));
    p.armX = [-0.45 * e, -0.45 * e]; p.armZ = [0.25 + 0.4 * e, 0.25 + 0.4 * e]; p.elbow = [-1.9 * e, -1.9 * e]; p.headZ = 0.2 * e; p.headX = -0.06; p.bounce = 0.03 * e; p.mouthO = 0.5;
  } }),
  E('e_think', 'Think', '🤔', 0, 60, { loop: true, pose(p, u) {
    // A fist under the chin, that elbow resting on the other hand.
    p.headX = 0.12; p.headZ = 0.14 + S(u * 1.5) * 0.05; p.legX = [0, -0.12]; p.knee = [0, 0.2]; p.mouthO = 0.3;
    p.hand = [[0, -0.17, 0.235, -1, -1, 0.5, 1], [-0.1, 0.27, 0.22, 1, -0.6, 0]];
  } }),
  E('e_nod', 'Nod', '🙂', 0, 0, { dur: 1.4, pose(p, u) { p.headX = 0.08 + S(u * 12) * 0.3; p.mouthO = 0.7; } }),
  E('e_no', 'No way', '🙅', 0, 0, { dur: 1.8, pose(p, u) {
    // Forearms crossed into a big X in front of the chest, the head shaking. The hands come in one in front of the other.
    const e = smooth(Math.min(1, u / 0.5)), x = -0.24 + e * 0.44;
    p.hand = [[x, 0.64, 0.26, -1, -1, -0.1], [-x, 0.64, 0.5, 1, -1, 0.7]];
    p.headY = S(u * 14) * 0.3; p.lean = -0.05; p.mouthO = 0.35;
  } }),
  E('e_cheer', 'Cheer', '🙌', 0, 0, { dur: 2, pose(p, u) {
    p.armX = [-2.8, -2.8]; p.armZ = [0.45 + S(u * 10) * 0.12, 0.45 - S(u * 10) * 0.12]; p.elbow = [-0.15, -0.15]; p.lift = A(S(u * 7)) * 0.14; p.mouthO = 1.4; p.headX = -0.2;
  } }),
  E('e_jacks', 'Jumping jacks', '🙆', 0, 80, { loop: true, pose(p, u) {
    const w = (1 - Math.cos(u * 7)) / 2;
    p.armX = [0, 0]; p.armZ = [0.25 + 2.5 * w, 0.25 + 2.5 * w]; p.elbow = [-0.1, -0.1]; p.legZ = [0.04 + 0.32 * w, 0.04 + 0.32 * w]; p.lift = A(S(u * 7)) * 0.1; p.mouthO = 1;
  } }),
  E('e_sleep', 'Sleep', '😴', 0, 100, { loop: true, pose(p, u) {
    p.floor = true; p.zz = 0.9; p.rx = -1.5; p.lift = S(u * 1.6) * 0.006; p.armX = [-2.9, -2.9]; p.armZ = [0.6, 0.6]; p.elbow = [-2.2, -2.2]; p.legX = [-0.1, -0.3]; p.knee = [0, 0.4]; p.headX = -0.15; p.mouthO = 0.2;
  } }),
  E('e_heart', 'Heart hands', '❤️', 0, 120, { dur: 2.2, pose(p, u) {
    // A heart made with the arms in front of the chest, elbows up and out, hands meeting at its point. Hearts float up.
    const x = 0.08 + 0.14 * (1 - smooth(Math.min(1, u / 0.35)));
    p.hand = [[-x, 0.4, 0.34, -1, 1.1, 0.3], [x, 0.4, 0.34, 1, 1.1, 0.3]];
    p.headX = 0.05; p.headZ = S(u * 4) * 0.12; p.bounce = A(S(u * 4)) * 0.03; p.mouthO = 0.9; p.hearts = 3;
  } }),
  E('e_moonwalk', 'Moonwalk', '🌙', 1, 300, { loop: true, pose(p, u) {
    const w = S(u * 6);
    p.legX = [w * 0.35, -w * 0.35]; p.knee = [Math.max(0, -w) * 0.9 + 0.05, Math.max(0, w) * 0.9 + 0.05]; p.armX = [-w * 0.3, w * 0.3]; p.armZ = [0.2, 0.2]; p.elbow = [-0.7, -0.7];
    p.lean = -0.06; p.headY = 0.35; p.bounce = A(w) * 0.025; p.mouthO = 0.5;
  } }),
  E('e_chicken', 'Chicken dance', '🐔', 1, 280, { loop: true, pose(p, u) {
    const f = A(S(u * 9));
    p.armX = [0.3, 0.3]; p.armZ = [0.4 + f * 0.7, 0.4 + f * 0.7]; p.elbow = [-2.4, -2.4]; p.crouch = 0.08; p.lean = 0.18; p.headX = S(u * 9) * 0.22; p.knee = [0.35, 0.35]; p.legX = [-0.2, -0.2]; p.bounce = f * 0.04; p.mouthO = 0.8;
  } }),
  E('e_pushups', 'Push ups', '🏋️', 1, 300, { loop: true, pose(p, u) {
    const d = (S(u * 4) + 1) / 2;
    p.floor = true; p.rx = 1.3 + (1 - d) * 0.18; p.armX = [-1.5 + (1 - d) * 0.5, -1.5 + (1 - d) * 0.5]; p.armZ = [0.35, 0.35]; p.elbow = [-(1 - d) * 1.5, -(1 - d) * 1.5];
    p.legX = [0, 0]; p.knee = [0, 0]; p.headX = -0.35; p.mouthO = 0.6 + (1 - d) * 0.6;
  } }),
  E('e_guitar', 'Air guitar', '🎸', 1, 320, { loop: true, pose(p, u) {
    p.armX = [-0.6, -1.3]; p.armZ = [0.1, 0.6]; p.elbow = [-1.5 + S(u * 18) * 0.35, -0.4]; p.lean = -0.15; p.headX = S(u * 9) * 0.28; p.legX = [-0.3, 0.2]; p.knee = [0.45, 0.1]; p.crouch = 0.06; p.twist = 0.25; p.mouthO = 1.2;
  } }),
  E('e_drums', 'Air drums', '🥁', 1, 320, { loop: true, pose(p, u) {
    const a = S(u * 14);
    p.armX = [-1.0 - a * 0.35, -1.0 + a * 0.35]; p.elbow = [-1.4 + a * 0.4, -1.4 - a * 0.4]; p.armZ = [0.28, 0.28]; p.crouch = 0.12; p.knee = [0.6, 0.6]; p.legX = [-0.5, -0.5]; p.headX = A(a) * 0.16; p.mouthO = 1;
  } }),
  E('e_karate', 'Karate', '🥋', 1, 340, { dur: 2.6, pose(p, u) {
    const b = Math.floor(u * 3) % 4;
    p.crouch = 0.1; p.legZ = [0.28, 0.28]; p.knee = [0.35, 0.35]; p.armX = [-1.3, -1.3]; p.armZ = [0.2, 0.2]; p.elbow = [-2.2, -2.2]; p.mouthO = 0.6;
    if (b === 0) { p.armX[0] = -1.57; p.elbow[0] = 0; p.twist = -0.35; }
    else if (b === 1) { p.armX[1] = -1.57; p.elbow[1] = 0; p.twist = 0.35; }
    else if (b === 2) { p.legX[0] = -1.6; p.knee[0] = 0; p.legZ[0] = 0.1; p.lean = -0.25; p.mouthO = 1.4; }
  } }),
  E('e_boxing', 'Shadow box', '🥊', 1, 300, { loop: true, pose(p, u) {
    const j0 = Math.max(0, S(u * 8)), j1 = Math.max(0, -S(u * 8));
    p.armX = [-1.3 - j0 * 0.3, -1.3 - j1 * 0.3]; p.armZ = [0.25, 0.25]; p.elbow = [-2.2 + j0 * 2.1, -2.2 + j1 * 2.1];
    p.headX = 0.15; p.twist = (j1 - j0) * 0.3; p.legX = [-0.25, 0.2]; p.knee = [0.3, 0.3]; p.bounce = A(S(u * 8)) * 0.04; p.mouthO = 0.4;
  } }),
  E('e_dab', 'Dab', '😎', 1, 260, { dur: 1.4, pose(p) {
    // One arm straight up and out, the other bent across in front of the face, the head ducked into its elbow.
    p.hand = [[-0.62, 1.0, 0.18, -1, -1, 0], [0, 0.8, 0.31, 1, 0.1, 1]];
    p.headX = 0.5; p.headY = 0.35; p.lean = 0.1; p.mouthO = 0.3;
  } }),
  E('e_swim', 'Land swim', '🏊', 1, 300, { loop: true, pose(p, u) {
    const a = u * 7;
    p.armX = [-1.6 + S(a) * 1.4, -1.6 - S(a) * 1.4]; p.armZ = [0.45, 0.45]; p.elbow = [-0.25, -0.25]; p.lean = 0.35; p.headY = S(a) * 0.45;
    p.legX = [S(a * 2) * 0.2, -S(a * 2) * 0.2]; p.mouthO = 0.9;
  } }),
  E('e_zombie', 'Zombie walk', '🧟', 1, 280, { loop: true, pose(p, u) {
    p.armX = [-1.5 + S(u * 3) * 0.1, -1.5 - S(u * 3) * 0.1]; p.armZ = [0.05, 0.05]; p.elbow = [-0.1, -0.1]; p.headZ = 0.32; p.headX = 0.22;
    p.legX = [S(u * 3) * 0.22, -S(u * 3) * 0.22]; p.knee = [0.15, 0.15]; p.lean = 0.12; p.rz = S(u * 3) * 0.06; p.mouthO = 1 + S(u * 5) * 0.3;
  } }),
  E('e_propose', 'Propose', '💍', 1, 350, { loop: true, pose(p, u) {
    // Down on one knee, the ring held out.
    p.floor = true; p.legX = [-1.55, 0.15]; p.knee = [1.5, 1.95]; p.armX = [-1.35, -0.2]; p.armZ = [0.05, 0.2]; p.elbow = [-0.35, -0.4]; p.headX = -0.25; p.mouthO = 0.6 + S(u * 2) * 0.1;
  } }),
  E('e_spinkick', 'Spin kick', '🦵', 2, 700, { dur: 0.8, flip: true, pose(p, u, k) {
    const e = S(k * PI); p.ry = 2 * PI * smooth(k); p.legX = [-1.45 * e, 0]; p.legZ = [0.6 * e, 0]; p.knee = [0, 0.3 * e]; p.armX = [0, 0]; p.armZ = [1.3, 1.3]; p.elbow = [-0.3, -0.3]; p.lift = e * 0.25; p.mouthO = 1.2;
  } }),
  E('e_sideflip', 'Side flip', '🔄', 2, 750, { dur: 0.7, flip: true, hop: true, pose(p, u, k) { p.rz = 2 * PI * smooth(k); tuck(p, k); } }),
  E('e_corkscrew', 'Corkscrew', '🧬', 2, 900, { dur: 0.9, flip: true, hop: true, pose(p, u, k) { const s = smooth(k); p.rx = -2 * PI * s; p.ry = 2 * PI * s; tuck(p, k); } }),
  E('e_levitate', 'Levitate', '✨', 2, 800, { loop: true, pose(p, u) {
    p.legX = [-1.5, -1.5]; p.knee = [2.25, 2.25]; p.crouch = 0.1; p.armX = [-0.35, -0.35]; p.armZ = [0.95, 0.95]; p.elbow = [-0.2, -0.2];
    p.lift = 0.8 + S(u * 1.6) * 0.1; p.ry = S(u * 0.8) * 0.45; p.headX = -0.1; p.mouthO = 0.3;
  } }),
  E('e_shuffle', 'Shuffle', '👟', 2, 650, { loop: true, pose(p, u) {
    const w = S(u * 10), a = Math.max(0, w), b = Math.max(0, -w);
    p.legX = [-a * 0.5, -b * 0.5]; p.legZ = [a * 0.45, b * 0.45]; p.knee = [a * 0.5, b * 0.5]; p.armX = [-0.6 - w * 0.5, -0.6 + w * 0.5]; p.elbow = [-1.4, -1.4]; p.armZ = [0.3, 0.3];
    p.twist = w * 0.22; p.bounce = A(S(u * 20)) * 0.04; p.mouthO = 0.8;
  } }),
  E('e_handstand', 'Handstand', '🎪', 2, 750, { loop: true, pose(p, u) {
    p.floor = true; p.rx = PI; p.armX = [-3.0, -3.0]; p.armZ = [0.4, 0.4]; p.elbow = [0, 0]; p.headX = -0.5; p.legX = [S(u * 2) * 0.25, -S(u * 2) * 0.25]; p.legZ = [0.12, 0.12]; p.knee = [0.05, 0.05]; p.rz = S(u * 1.3) * 0.05; p.mouthO = 0.8;
  } }),
  E('e_party', 'Celebrate', '🎉', 2, 700, { dur: 2.5, pose(p, u) {
    const j = A(S(u * 6)), up = S(u * 6) > 0;
    p.lift = j * 0.35; p.armX = [up ? -2.9 : -1.8, up ? -1.8 : -2.9]; p.armZ = [0.4, 0.4]; p.elbow = [up ? -0.1 : -1.8, up ? -1.8 : -0.1]; p.knee = [j * 0.9, j * 0.9]; p.legX = [-j * 0.5, -j * 0.5]; p.mouthO = 1.5; p.headX = -0.2;
  } }),
  E('e_triple', 'Triple backflip', '☄️', 3, 8000, { dur: 0.95, flip: true, hop: true, pose(p, u, k) { p.rx = -6 * PI * smooth(k); tuck(p, Math.min(1, k * 1.05)); p.lift = S(Math.min(1, k) * PI) * 0.55; } }),
  E('e_ascend', 'Ascension', '👼', 3, 9000, { dur: 4.5, pose(p, u, k) {
    const up = smooth(Math.min(1, k * 2.5)) * (1 - smooth(Math.max(0, (k - 0.78) * 4.5)));
    p.lift = up * (1.5 + S(u * 2) * 0.06); p.ry = u * 1.3; p.armX = [-0.3, -0.3]; p.armZ = [0.3 + up, 0.3 + up]; p.elbow = [-0.1, -0.1]; p.legX = [0.1, -0.1]; p.knee = [0.15, 0.45 * up]; p.headX = -0.45 * up; p.mouthO = 0.6 + up * 0.6;
  } }),
  E('e_tornado', 'Tornado', '🌪️', 3, 8000, { dur: 1.6, flip: true, pose(p, u, k) {
    const e = S(k * PI); p.ry = 8 * PI * smooth(k); p.lift = e * 0.9; p.rz = e * 0.12; p.armX = [0, 0]; p.armZ = [1.5, 1.5]; p.elbow = [0, 0]; p.legZ = [0.12, 0.12]; p.mouthO = 1.4;
  } }),
  E('e_herolanding', 'Hero landing', '🦸', 3, 7000, { dur: 2.4, pose(p, u, k) {
    if (k < 0.3) { const e = S((k / 0.3) * PI); p.lift = e * 1.3; p.armX = [-2.8, -2.8]; p.armZ = [0.45, 0.45]; p.elbow = [-0.1, -0.1]; p.knee = [e * 0.6, e * 0.6]; p.mouthO = 1.2; return; }
    // Down on one knee with a fist on the ground.
    p.floor = true; p.lean = 0.85; p.legX = [-1.5, 0.35]; p.knee = [1.75, 1.75]; p.armX = [-0.95, 1.1]; p.armZ = [0.1, 0.7]; p.elbow = [0, -0.2]; p.headX = -0.75; p.mouthO = 0.35;
  } }),
  // Not in the menu: what a wall jump does by itself.
  E('e_wallflip', 'Wall flip', '', 0, 0, { dur: 0.46, flip: true, hidden: true, pose(p, u, k) { p.rx = -2 * PI * smooth(k); tuck(p, k); } }),
];
export const EMOTE = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
