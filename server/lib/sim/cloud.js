// What the climb tells the account. In a rerun that goes to the code doing the rerun.
export const sink = { coin: () => {}, relic: () => {}, win: () => {} };
export const runStart = () => {};
export const recorder = () => null;
export const runId = () => null;
export const counting = () => true;
export const climbSaved = () => {};
export const runCoin = (i) => sink.coin(i);
export const runRelic = (id) => sink.relic(id);
export const runWin = (falls) => sink.win(falls);
