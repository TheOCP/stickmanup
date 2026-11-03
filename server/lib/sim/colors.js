// Copied from assets/js by dev/makesim.mjs. Do not edit here.
// Player colours. Each player picks one (Settings); the slot colours are the defaults.
export const COLORS = [0x3ff0d0, 0xff4fb4, 0xb6ff4a, 0xffb43d];
export const COLOR_CSS = ['#3ff0d0', '#ff4fb4', '#b6ff4a', '#ffb43d'];
export const PALETTE = [0x3ff0d0, 0xff4fb4, 0xb6ff4a, 0xffb43d, 0x4f8bff, 0xa66bff, 0xff5050, 0xffe14a, 0xf0f4ff, 0x8a96aa];
export const css = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0');
// A colour that came over the network: a plain 24-bit number, or nothing.
export const validColor = (c) => (Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : null);
