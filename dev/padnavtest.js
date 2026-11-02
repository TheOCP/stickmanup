// Where the highlight goes next, on layouts like the real menus. Usage: node dev/padnavtest.js
import { pickNext } from '../assets/js/padnav.js';
let fails = 0;
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const go = (name, cur, rects, dx, dy, want) => { const got = pickNext(cur, rects, dx, dy), ok = got === want; console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  got ${got}, wanted ${want}`)); if (!ok) fails++; };
// A list with a row of two at the bottom, like the title screen.
const t = [R(0, 0, 200, 40), R(0, 50, 200, 40), R(0, 100, 95, 40), R(105, 100, 95, 40), R(0, 150, 95, 40), R(105, 150, 95, 40)];
go('list: down to the next', t[0], t, 0, 1, 1);
go('list: down into the row picks the closer side', t[1], t, 0, 1, 2);
go('row: right stays in the row', t[2], t, 1, 0, 3);
go('row: right from the end goes nowhere', t[3], t, 1, 0, -1);
go('row: down keeps the column', t[3], t, 0, 1, 5);
go('row: up leaves the row', t[3], t, 0, -1, 1);
go('top: up goes nowhere', t[0], t, 0, -1, -1);
// A shop: back button and a wear button on the left, a grid of cards on the right.
const s = [R(0, 0, 36, 36), R(0, 200, 150, 40)];
for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) s.push(R(200 + c * 90, 60 + r * 110, 80, 100));
const cell = (r, c) => 2 + r * 4 + c;
go('grid: right', s[cell(1, 1)], s, 1, 0, cell(1, 2));
go('grid: down', s[cell(1, 1)], s, 0, 1, cell(2, 1));
go('grid: right from the end does not wrap', s[cell(1, 3)], s, 1, 0, -1);
go('grid: left from the edge reaches the side', s[cell(1, 0)], s, -1, 0, 1);
go('grid: off screen rows are still reachable', s[cell(4, 2)], s, 0, 1, cell(5, 2));
go('side: right goes to the grid', s[1], s, 1, 0, cell(1, 0));
go('side: up reaches the back button', s[1], s, 0, -1, 0);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
