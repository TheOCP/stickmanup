// Sanity checks for every map: size, zone heights, special areas and clearance between route layers.
// Clearance: any two footprints that overlap from above, placed more than 14 m of route apart, must be
// at least the lower one's clear height apart (HEAD for floors; the same rule the generator follows).
import { generateLevel, HEAD, MAPS, overlap } from '../assets/js/level.js';

let failed = false;
for (const M of MAPS) {
  const t0 = Date.now();
  const L = generateLevel(M.id);
  const R = L.recs, bad = [];
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    const lo = a.y <= b.y ? a : b, hi = lo === a ? b : a;
    // The lower one needs its clear height above it (HEAD for floors, less for hooks and door frames).
    if (Math.abs(a.pl - b.pl) <= 14 || hi.y - lo.y >= Math.min(lo.h, hi === lo ? HEAD : HEAD) - 0.01 && hi.y - lo.y >= lo.h - 0.01) continue;
    const dx = a.x - b.x, dz = a.z - b.z, rr = a.rad + b.rad;
    if (dx * dx + dz * dz > rr * rr || !overlap(a, b, 0)) continue;
    bad.push(`${a.tag} ${a.y.toFixed(1)} / ${b.tag} ${b.y.toFixed(1)} (${(b.pl - a.pl).toFixed(0)} m apart) at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
  }
  if (bad.length) failed = true;
  console.log(`${M.name} (${M.route}): ${Date.now() - t0} ms, top ${L.top.toFixed(0)} m, ${L.plats} platforms, ${L.cols.length} colliders, clearance issues ${bad.length}`);
  if (bad.length) console.log('   ', bad.slice(0, 30).join(' | '));
  console.log(`   anchors ${L.anchors.length}, doors ${L.doors.length}, monsters ${L.monsters.length}, bats ${L.bats.length}, lasers ${L.lasers.length}, arrows ${L.arrows.length}, swings ${L.swings.length}, side trees ${L.trees.length}, rods ${L.rods.length}, fans ${L.fans.length}, cps ${L.cps.length}, signs ${L.signs.length}`);
  console.log('   zones', L.zones.map((z) => `${z.name} ${z.y0.toFixed(0)}-${z.y1.toFixed(0)}`).join(' | '));
}
if (failed) process.exitCode = 1;
