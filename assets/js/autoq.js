// Automatic graphics: holds the frame rate by giving up picture detail, one step at a time, and takes it back
// when there is clearly room. It watches how long the GPU really needs for a frame (NRender.measureGpu), so it
// reacts before frames actually drop, and it stays well below the limit: a GPU that needs all of its time has
// nothing left for the moment something big comes into view.
//
// Each step is roughly a fifth to a third cheaper than the one before. 'res' is a share of the player's
// resolution setting, the others multiply or switch the player's own settings. Step 4 changes to per corner
// lighting, which is so much cheaper that the resolution can go back up.
export const STEPS = [
  { res: 1, aa: 1, sharp: 1, glow: 1, lite: 0 },
  { res: 0.9, aa: 1, sharp: 1, glow: 1, lite: 0 },
  { res: 0.8, aa: 0, sharp: 1, glow: 1, lite: 0 },
  { res: 0.7, aa: 0, sharp: 1, glow: 1, lite: 0 },
  { res: 0.85, aa: 0, sharp: 0.7, glow: 1, lite: 1 },
  { res: 0.7, aa: 0, sharp: 0.7, glow: 1, lite: 1 },
  { res: 0.6, aa: 0, sharp: 0.5, glow: 0, lite: 1 },
  { res: 0.5, aa: 0, sharp: 0.5, glow: 0, lite: 1 },
];

const HOT = 0.8, COOL = 0.5, FITS = 0.72;

export class AutoQ {
  // budget: ms per frame at the chosen frame rate. start: the step remembered from last time. last: the lowest
  // step allowed (above 60 fps it never trades the look away just for the extra frames).
  constructor({ budget = 1000 / 60, start = 0, last = STEPS.length - 1 } = {}) {
    this.budget = budget;
    this.last = last;
    this.level = Math.min(Math.max(0, start), last);
    this.t = 0; // seconds running
    this.hot = 0; // hot seconds in a row
    this.calm = 0; // seconds in a row with plenty of room
    this.wait = 0; // seconds to let a change settle
    this.since = 0; // when the step last changed
    this.lastUp = -999;
    this.seen = STEPS.map(() => null); // what each step really cost: { load, t }
    this.ban = STEPS.map(() => 0); // no going back to this step until then
    this.fails = STEPS.map(() => 0);
  }

  get step() { return STEPS[this.level]; }

  // Settled for a while: worth remembering for the next launch.
  stable() { return this.t - this.since >= 20; }

  // Something big just happened (a map loading): what the next few seconds look like doesn't count.
  settle(secs = 3) {
    this.wait = Math.max(this.wait, secs);
    this.hot = 0;
    this.calm = 0;
  }

  move(to) {
    this.level = to;
    this.since = this.t;
    this.hot = 0;
    this.calm = 0;
    this.wait = 2;
  }

  // Once a second. gpu, gpuMax: ms for a frame (0 when nothing was measured), slow: frames that came late.
  tick(gpu, gpuMax, slow, frames) {
    this.t++;
    if (!(gpu > 0)) return this.level;
    // gpu is the middle frame of the second. The worst one counts a little too, but never for much on its own.
    const B = this.budget, load = Math.max(gpu, Math.min(gpuMax, gpu * 1.4) * 0.85);
    if (this.wait > 0) { this.wait--; return this.level; }
    this.seen[this.level] = { load, t: this.t };
    if (load > B * HOT || (slow >= 3 && load > B * 0.6)) this.hot++;
    else this.hot = 0;
    // Two seconds running. The further over, the bigger the step: a phone far too slow gets there in seconds
    // (on a first launch that is usually still in the menu).
    const down = this.hot < 2 ? 0 : load > B * 1.8 ? 3 : load > B * 1.25 ? 2 : 1;
    if (down && this.level < this.last) {
      // Went up a moment ago and it didn't hold: leave that step alone for a while, longer each time.
      if (this.t - this.lastUp < 20) {
        this.ban[this.level - 1] = this.t + Math.min(900, 60 * 2 ** this.fails[this.level - 1]);
        this.fails[this.level - 1]++;
      }
      this.move(Math.min(this.last, this.level + down));
      return this.level;
    }
    // Clear room for ten seconds running, and the better step is expected to fit: take it back.
    this.calm = load < B * COOL ? this.calm + 1 : 0;
    if (this.calm >= 10 && this.level > 0) {
      const up = this.level - 1, s = this.seen[up];
      const fresh = s && this.t - s.t < 300;
      if (this.t >= this.ban[up] && (!fresh || s.load < B * FITS)) {
        this.lastUp = this.t;
        this.move(up);
      } else this.calm = 5;
    }
    return this.level;
  }
}
