// In a rerun nothing is kept on any phone. The server pays what the rerun finds (see verify-worker.mjs).
export const sink = { relics: new Set() };
export const addCoins = () => {};
export const firstWin = () => 0;
export const foundRelic = (id) => { sink.relics.add(id); return null; };
export const hasRelic = (id) => sink.relics.has(id);
export const award = () => null;
export const recordRun = () => {};
export const addTotals = () => {};
export const flushProfile = () => {};
// The weapon a shot came from is in the recording, so the one carried here doesn't matter.
export const myLook = () => ({ s: 'c0', f: 'smile', h: 'none', w: 'w_blaster' });
