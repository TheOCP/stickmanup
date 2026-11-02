// No decorative cloud may reach the climb or the space the camera needs behind you, on any map, whichever way it has
// circled by then. Worked out from the colliders, not from how level.js places clouds. With a path, checks another
// copy of level.js for comparison. Usage: node dev/cloudtest.js [path to level.js]
const path = process.argv[2] ? (await import('node:url')).pathToFileURL(process.argv[2]).href : '../assets/js/level.js';
const { generateLevel, MAPS } = await import(path);
const W = 2.3, UP = 0.88, DOWN = 0.72, CAM = 9; // how far the puffs of a cloud reach (worldview.js), and the camera
let fails = 0;
for (const M of MAPS) {
  const L = generateLevel(M.id), clouds = L.decor.filter((d) => d.k === 'cloud');
  let bad = 0, least = Infinity;
  for (const d of clouds) {
    const inner = Math.hypot(d.x, d.z) - W * d.s, y0 = d.y - DOWN * d.s - CAM, y1 = d.y + UP * d.s + CAM;
    let clear = Infinity;
    for (const c of L.cols) {
      const box = c.r === undefined, v = box ? (c.rx || c.rz ? Math.hypot(c.hx, c.hy, c.hz) : c.hy) : c.hh;
      if (c.y + v < y0 || c.y - v > y1) continue;
      clear = Math.min(clear, inner - Math.hypot(c.x, c.z) - (box ? Math.hypot(c.hx, c.hz) : c.r));
    }
    least = Math.min(least, clear);
    if (clear < CAM) bad++;
  }
  console.log(`${M.key}: ${clouds.length} clouds, ${bad} in the way` + (clouds.length ? `, closest to the route ${least.toFixed(1)} m` : ''));
  fails += bad;
}
console.log(fails ? `${fails} IN THE WAY` : 'all clear');
process.exit(fails ? 1 : 0);
