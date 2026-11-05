// The shop (and wardrobe) and the records screen. A real climber stands in the world on the left, wearing what you
// tap, while the cards are on the right.
import { RARITY, SUITS, LEGENDS, OWNERS, FACES, HATS, HAIRS, COL_W, COL_ARMS, ARM_W, TEX, FACE_W, FACE_H, paintSuit, drawFace, suitIsDark } from './skins.js';
import { gearTris, gunInfo, GEAR_AT, GEAR_TALL, HAIR_TOP } from './gear.js';
import { coins, owned, unlocked, equip, worn, myLook, relicCounts, runsOf, totals } from './profile.js';
import { needOf, whereOf } from './relics.js';
import { RELIC_AT } from './relicspots.js';
import { buyItem } from './cloud.js';
import { DIFFS, MAPS, mapDef, mapName } from './level.js';
import { EMOTES } from './emotes.js';
import { SPRAYS, paintSpray, sprayUrl } from './sprays.js';
import { WEAPONS, STUN_MIN } from './weapons.js';
import { fmtTime } from './util.js';

const COIN = '<i class="coin"></i>';

// ---------------------------------------------------------------- little pictures
const THUMBS = new Map();
function figurePath(g, X, Y, s) {
  g.beginPath();
  g.arc(X, Y(1.02), 0.2 * s, 0, 7);
  g.roundRect(X - 0.105 * s, Y(0.865), 0.21 * s, 0.59 * s, 0.1 * s);
  for (const k of [-1, 1]) g.roundRect(X + k * 0.09 * s - 0.078 * s, Y(0.32), 0.156 * s, 0.76 * s, 0.07 * s);
}
function armPath(g, X, Y, s) {
  g.beginPath();
  for (const k of [-1, 1]) g.roundRect(X + k * 0.15 * s - 0.066 * s, Y(0.8), 0.132 * s, 0.7 * s, 0.06 * s);
}
// Hats sit on the head and are seen from a little to the side; what goes on the back is seen from the front, from where it is
// fixed (the hips, or both shoulder blades for wings).
function drawHat(g, id, X, Y, s) {
  const at = GEAR_AT[id];
  if (at === 'wings') { drawTris(g, gearTris(id, 'front'), X + 0.03 * s, Y, s, 0.7, 1); drawTris(g, gearTris(id, 'front'), X - 0.03 * s, Y, s, 0.7, -1); }
  else if (at === 'back' || at === 'chest' || at === 'hips' || at === 'tail') drawTris(g, gearTris(id, 'front'), X, Y, s, 0.3, 1);
  else drawTris(g, gearTris(id), X, Y, s, 1.02, 1);
}
function drawTris(g, tris, X, Y, s, base, flip) {
  g.lineWidth = 0.6;
  for (const t of tris) {
    const c = `rgb(${t[7] | 0},${t[8] | 0},${t[9] | 0})`;
    g.fillStyle = c; g.strokeStyle = c;
    g.beginPath();
    g.moveTo(X + t[0] * s * flip, Y(base + t[1]));
    g.lineTo(X + t[2] * s * flip, Y(base + t[3]));
    g.lineTo(X + t[4] * s * flip, Y(base + t[5]));
    g.closePath();
    g.fill(); g.stroke();
  }
}
function drawFaceOn(g, face, light, X, Y, s) {
  const c = document.createElement('canvas');
  c.width = FACE_W; c.height = FACE_H;
  const x = c.getContext('2d');
  drawFace(x, face, 'eyes', light);
  g.drawImage(c, X - 0.17 * s, Y(1.16), 0.34 * s, 0.16 * s);
  drawFace(x, face, 'mouth', light);
  g.drawImage(c, X - 0.15 * s, Y(1.01), 0.3 * s, 0.14 * s);
}

// A weapon from the side, as big as the card allows.
function drawGun(g, id, W, H) {
  const tris = gearTris(id, 'gun'), sp = gunInfo(id).spin;
  if (sp) { tris.push(...gearTris(sp, 'gun')); tris.sort((a, b) => a[6] - b[6]); }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const t of tris) for (let i = 0; i < 6; i += 2) { x0 = Math.min(x0, t[i]); x1 = Math.max(x1, t[i]); y0 = Math.min(y0, t[i + 1]); y1 = Math.max(y1, t[i + 1]); }
  const s = Math.min((W - 10) / (x1 - x0), (H - 16) / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  g.lineWidth = 0.6;
  for (const t of tris) {
    const c = `rgb(${t[7] | 0},${t[8] | 0},${t[9] | 0})`;
    g.fillStyle = c; g.strokeStyle = c;
    g.beginPath();
    g.moveTo(W / 2 + (t[0] - cx) * s, H / 2 - (t[1] - cy) * s);
    g.lineTo(W / 2 + (t[2] - cx) * s, H / 2 - (t[3] - cy) * s);
    g.lineTo(W / 2 + (t[4] - cx) * s, H / 2 - (t[5] - cy) * s);
    g.closePath();
    g.fill(); g.stroke();
  }
}

function thumbFor(item) {
  // A hat and a suit can share a name (cowboy, santa), so the key has both.
  const key = item.kind + ':' + item.id;
  if (THUMBS.has(key)) return THUMBS.get(key);
  const W = 120, H = 150, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (item.kind === 'weapon') {
    drawGun(g, item.id, W, H);
  } else if (item.kind === 'spray') {
    g.drawImage(paintSpray(item, 128), 0, (H - W) / 2, W, W);
  } else if (item.kind === 'emote') {
    g.font = '76px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(item.icon, W / 2, H / 2);
  } else if (item.kind === 'suit') {
    const behind = (item.gear || []).filter((id) => GEAR_AT[id] === 'wings' || GEAR_AT[id] === 'back' || GEAR_AT[id] === 'tail');
    // With wings (or anything tall) the climber is drawn smaller, so they fit on the card.
    const s = H / (behind.some((id) => GEAR_AT[id] === 'wings' || GEAR_TALL.has(id)) ? 2.5 : 2.05), X = W / 2, Y = (fy) => H - 6 - (fy + 0.44) * s, k = 128 / TEX, tex = paintSuit(item, 128);
    for (const id of behind) drawHat(g, id, X, Y, s);
    g.save(); armPath(g, X, Y, s); g.clip();
    g.drawImage(tex, COL_ARMS * k, 0, ARM_W * k, TEX * k, X - 0.24 * s, Y(1.24), 0.48 * s, 1.68 * s);
    g.restore();
    g.save(); figurePath(g, X, Y, s); g.clip();
    g.drawImage(tex, 0, 0, COL_W * k, TEX * k, X - 0.21 * s, Y(1.24), 0.42 * s, 1.68 * s);
    g.restore();
    const light = suitIsDark(item), face = FACES.find((f) => f.id === (item.face || 'smile'));
    drawFaceOn(g, face, light, X, Y, s);
    for (const id of [...(item.gear || []).filter((id) => !behind.includes(id)), ...(item.hat ? [item.hat] : [])]) drawHat(g, id, X, Y, s);
  } else {
    // A face, hat or hair on a big plain head.
    const s = H / 0.78, X = W / 2, Y = (fy) => H * (item.kind === 'face' ? 0.5 : 0.72) - (fy - 1.02) * s;
    const gr = g.createRadialGradient(X - 8, Y(1.08), 6, X, Y(1.02), 0.2 * s);
    gr.addColorStop(0, '#9af4e2'); gr.addColorStop(1, '#3fcdb4');
    g.fillStyle = gr;
    g.beginPath(); g.arc(X, Y(1.02), 0.2 * s, 0, 7); g.fill();
    drawFaceOn(g, item.kind === 'face' ? item : FACES[0], false, X, Y, s);
    if (item.kind === 'hat' && item.id !== 'none') drawHat(g, item.id, X, Y, s);
    if (item.kind === 'hair' && HAIR_TOP[item.id]) { const tris = [...gearTris(item.id), ...gearTris(HAIR_TOP[item.id])].sort((a, b) => a[6] - b[6]); drawTris(g, tris, X, Y, s, 1.02, 1); }
  }
  const u = c.toDataURL('image/png');
  THUMBS.set(key, u);
  return u;
}

// ---------------------------------------------------------------- the shop
const TABS = [['suits', 'Suits'], ['flags', 'Flags'], ['faces', 'Faces'], ['hats', 'Hats'], ['hair', 'Hair'], ['emotes', 'Emotes'], ['sprays', 'Graffiti'], ['weapons', 'Weapons']];
const HOLD_NAME = { pistol: 'Sidearm', smg: 'Submachine gun', shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper rifle', heavy: 'Machine gun', launcher: 'Launcher' };
// Bars that compare weapons at a glance.
// Where something that isn't open yet is found.
function whereText(it) {
  const w = whereOf(it);
  if (!w) return '';
  if (w.kind === 'void') return 'Find all six legendary weapons first: each waits at the end of the hardest path of its map.';
  const m = MAPS.find((x) => x.key === w.map), name = m ? m.name : w.map;
  const at = RELIC_AT[needOf(it)[0]];
  if (w.spot) {
    const dn = DIFFS[w.dv].name;
    if (w.maze) return `On ${name}, only on ${dn}: in a corner of the maze garden at about ${at} m. Look for the little shrine.`;
    if (w.kind === 'legend') return `On ${name}, only on ${dn}: at the end of a long hidden course that starts at about ${at} m. Look for the orange gate and the pillar of light.`;
    return `On ${name}, only on ${dn}: at the end of a hidden course that starts at about ${at} m. Look for the purple gate and the pillar of light.`;
  }
  if (w.kind === 'epic') return `Find the epic vault on ${name} first. Its course starts at about ${at} m, on any difficulty: look for the purple gate and the pillar of light.`;
  if (w.kind === 'weapon') return `Find the legendary vault on ${name} first. Its course starts at about ${at} m, on any difficulty: look for the golden gate and the pillar of light.`;
  // In a maze garden the item's own hint says which one. The others wait at the end of a course.
  if (at !== undefined) return `On ${name}, at the end of a parkour course that starts at about ${at} m. Look for the orange gate and the pillar of light.`;
  return it.hint || '';
}
function weaponStats(w) {
  const bar = (name, k, val, c) => `<div>${name}<i style="--v:${Math.round(Math.max(0.04, Math.min(1, k)) * 100)}%${c ? ';--c:' + c : ''}"></i><b>${val}</b></div>`;
  const rate = 1 / w.rate;
  return `<p class="wtag">${[HOLD_NAME[w.hold], w.auto && 'automatic', w.scope && 'scope', w.blast && 'blast'].filter(Boolean).join(' · ')}</p><div class="wstats">
    ${bar('Paralyse', (w.stun - STUN_MIN + 25) / 260, w.stun + ' s', '#7fd8ff')}
    ${bar('Fire rate', Math.sqrt(rate / 25), rate >= 10 ? Math.round(rate) + '/s' : (Math.round(rate * 10) / 10) + '/s', '#ffb040')}
    ${bar('Range', w.range / 320, w.range + ' m', '#70ff90')}
    ${bar('Target size', (w.hit - 0.7) / 1.6, 'x' + w.hit, '#ff70c0')}
    ${bar('Friend throw', w.knock / 42, w.knock, '#ff6050')}
    ${w.blast ? bar('Blast', w.blast / 9, w.blast + ' m', '#d080ff') : ''}
  </div>`;
}
const listFor = (tab) => {
  // What's hidden from the shop still shows for someone who was given it.
  if (tab === 'faces') return FACES.filter((f) => !f.hidden || owned(f));
  if (tab === 'hats') return HATS.filter((f) => !f.hidden || owned(f));
  if (tab === 'hair') return HAIRS;
  if (tab === 'emotes') return EMOTES.filter((e) => !e.hidden);
  if (tab === 'sprays') return SPRAYS;
  if (tab === 'weapons') return WEAPONS;
  // The legendary suits are suits like any other, at the end of the list with the team's own if you have one.
  if (tab === 'suits') return [...SUITS.filter((s) => s.tab === tab), ...LEGENDS, ...OWNERS.filter((o) => owned(o))];
  return SUITS.filter((s) => s.tab === tab);
};

export function openShop(ctx, goBack, startTab = 'suits') {
  const { app, show, esc, ui, lookChanged } = ctx;
  let tab = startTab, sel = null, gridScroll = 0, drawTok = 0;

  const sameSlot = (item, look) => (item.kind === 'emote' || item.kind === 'spray' ? look : item.kind === 'suit' ? { ...look, s: item.id } : item.kind === 'face' ? { ...look, f: item.id } : item.kind === 'weapon' ? { ...look, w: item.id } : item.kind === 'hair' ? { ...look, r: item.id } : { ...look, h: item.id });
  const preview = () => {
    app.preview = { look: sel ? sameSlot(sel, myLook()) : myLook(), yaw: app.preview ? app.preview.yaw : 0, emote: sel && sel.kind === 'emote' ? sel.id : null, aim: !!sel && sel.kind === 'weapon' };
  };

  function card(it) {
    const have = owned(it), on = have && worn(it);
    const tag = (it.kind === 'emote' || it.kind === 'spray') && have ? '<em class="have">Owned</em>' : on ? '<em class="wearing">Wearing</em>' : have ? '<em class="have">Owned</em>' : !unlocked(it) || !(it.price > 0) ? `<em class="lock">${whereOf(it) ? 'Hidden' : 'Locked'}</em>` : `<em class="price">${COIN}${it.price}</em>`;
    return `<button class="skin r${it.r} ${sel === it ? 'sel' : ''} ${have ? '' : 'no'}" data-a="pick" data-id="${it.id}"><img data-th="${it.id}" alt=""><b>${esc(it.name)}</b>${tag}</button>`;
  }

  function sections(list) {
    return RARITY.map((r) => {
      const items = list.filter((x) => x.r === r.id);
      if (!items.length) return '';
      return `<h3 class="rar" style="--rc:${r.css}"><span></span>${r.name}<small>${items.filter((x) => owned(x)).length} of ${items.length}</small></h3>${r.id === 3 && tab === 'suits' ? `<p class="sub lg">Some are for the richest climbers. The hidden ones are found first, on any difficulty, and then bought (${relicCounts().suit[0]} of ${relicCounts().suit[1]} relics found). A few only come from doing something nobody else would.</p>` : ''}<div class="skins">${items.map(card).join('')}</div>`;
    }).join('');
  }

  function sideHtml() {
    const it = sel;
    if (!it && tab === 'sprays') return `<p class="sub" style="margin:0">Pictures to spray on the towers: during a climb, open your emotes and pick one. It goes on what you stand on, or on the wall you hold, and everyone who climbs there sees it. Every epic and legendary one waits in a hidden spot of its own first.</p>`;
    if (!it) return tab === 'emotes' ? `<p class="sub" style="margin:0">Tap one to watch it. During a climb the smiley at the top of the screen opens your emotes. Flips work in the air too.</p>`
      : tab === 'weapons' ? `<p class="sub" style="margin:0">Tap one to see it in your hands. Better weapons paralyse enemies for longer and reach further. The seven legendary ones are in a class of their own. Every epic weapon waits in a hidden spot of its own, legendary ones at the end of the hardest relic courses, on any difficulty: find them, then buy them.</p>`
      : `<p class="sub" style="margin:0">Tap anything to try it on. Coins come from the climb: the higher the difficulty, the more each one is worth. Every epic thing waits in a hidden spot of its own first: at the end of a course behind a purple gate or in a maze garden, on one map and one difficulty. The shop says where.</p>`;
    const r = RARITY[it.r], have = owned(it), on = have && worn(it), open = unlocked(it), where = whereOf(it);
    let act;
    if (it.kind === 'emote' && have) act = '<button class="btn sm primary" data-a="watch">Watch again</button>';
    else if (it.kind === 'spray' && have) act = '<p class="sub" style="margin:4px 0 0">Yours. Spray it from your emotes during a climb.</p>';
    else if (on) act = `<button class="btn sm" disabled>${it.kind === 'weapon' ? 'Carrying it' : 'Wearing it'}</button>`;
    else if (have) act = `<button class="btn sm primary" data-a="equip">${it.kind === 'weapon' ? 'Carry it' : 'Wear it'}</button>`;
    else if (it.price > 0 && open) act = `<button class="btn sm ${coins() >= it.price ? 'primary' : ''}" data-a="buy" ${coins() >= it.price ? '' : 'disabled'}>Buy for ${it.price} coins</button>`;
    else act = '';
    const need = !have && open && it.price > 0 && coins() < it.price ? `<p class="need">${it.price - coins()} more coins needed</p>` : '';
    let hint = '';
    if (!have && !open) hint = whereText(it);
    else if (!have && where) hint = 'Found. Now it can be bought.';
    else if (it.hint && !have) hint = it.hint;
    else if (it.hint && have && !it.team) hint = 'Found it. Well done.';
    hint = hint ? `<p class="hint">${esc(hint)}</p>` : '';
    const big = it.kind === 'spray' ? `<img class="sprbig" src="${sprayUrl(it, 256)}" alt="">` : '';
    return `<b class="sname">${esc(it.name)}</b><span class="srar" style="color:${r.css}">${r.name}</span>${big}${it.kind === 'weapon' ? weaponStats(it) : ''}${hint}${need}${act}`;
  }

  function loadThumbs() {
    const tok = ++drawTok, imgs = [...document.querySelectorAll('#menu img[data-th]')];
    const list = listFor(tab), find = (id) => list.find((x) => x.id === id);
    let i = 0;
    // A few per frame, so the screen opens at once and the pictures pop in.
    const step = () => {
      if (tok !== drawTok) return;
      for (let n = 0; n < 5 && i < imgs.length; n++, i++) imgs[i].src = thumbFor(find(imgs[i].dataset.th));
      if (i < imgs.length) requestAnimationFrame(step);
    };
    step();
  }

  function render() {
    const scrollEl = document.querySelector('#menu .shopgrid');
    if (scrollEl) gridScroll = scrollEl.scrollTop;
    const list = listFor(tab);
    show(`<div class="shop">
      <div class="shopside">
        <div class="ph"><button class="back big" data-a="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4 L8 12 L16 20"/></svg><span>Back</span></button><div class="wallet">${COIN}<b>${coins()}</b></div></div>
        <div class="shopinfo">${sideHtml()}</div>
      </div>
      <div class="shopmain">
        <div class="tabs">${TABS.map(([k, n]) => `<button data-a="tab" data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="shopgrid">${sections(list)}</div>
      </div></div>`, {
      back: () => { app.preview = null; goBack(); },
      tab: (b) => { tab = b.dataset.t; sel = null; gridScroll = 0; preview(); render(); },
      pick: (b) => { sel = listFor(tab).find((x) => x.id === b.dataset.id); preview(); if (app.preview) app.preview.yaw = sel.flag || sel.cape ? 2.6 : sel.kind === 'weapon' ? -1.1 : -0.4; render(); },
      buy: async () => {
        if (!sel || buying) return;
        const item = sel;
        buying = true;
        const err = await buyItem(item);
        buying = false;
        if (err) { ui.toast(err, 'bad'); render(); return; }
        app.sound.checkpoint();
        if (item.kind !== 'emote' && item.kind !== 'spray') equip(item);
        lookChanged();
        ui.toast(`${item.name} is yours`, 'good');
        preview(); render();
      },
      equip: () => { if (sel) { equip(sel); lookChanged(); preview(); render(); } },
      watch: () => { if (app.preview && sel) app.preview.playing = null; },
    }, false);
    const el = document.querySelector('#menu .shopgrid');
    if (el) el.scrollTop = gridScroll;
    loadThumbs();
  }
  preview();
  render();
}
let buying = false;

// ---------------------------------------------------------------- records
export function openRecords(ctx, goBack, startMap = 0) {
  const { app, show, esc, header } = ctx;
  let map = mapDef(startMap) ? startMap : 0;
  // The six worlds, and the generated map you have picked as well.
  const chips = [...MAPS, ...(map >= MAPS.length ? [mapDef(map)] : [])];
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(); } catch (e) { return ''; } };
  function render() {
    const runs = runsOf(map), T = totals();
    const best = DIFFS.map((d) => {
      const list = runs.filter((r) => r.diff === d.id), top = list[0], won = list.filter((r) => r.won).sort((a, b) => a.t - b.t)[0];
      return `<div class="rcard d${d.id}"><b>${d.name}</b>${top ? `<strong>${top.h} m</strong><small>${won ? 'Fastest to the top ' + fmtTime(won.t) : `${top.falls} fall${top.falls === 1 ? '' : 's'} on that climb`}</small>` : '<strong class="none">No climb yet</strong><small>Go and set one</small>'}</div>`;
    }).join('');
    const rows = runs.map((r, i) => `<div class="rrow ${r.won ? 'won' : ''}"><span class="rn">${i + 1}</span><b>${r.h} m</b><span class="rd d${r.diff}">${DIFFS[r.diff].name}${r.custom ? ' (custom)' : ''}</span><span>${r.falls} fall${r.falls === 1 ? '' : 's'}</span><span>${fmtTime(r.t)}</span><span class="rc">${COIN}${r.coins}</span><small>${r.won ? 'Summit · ' : ''}${r.players > 1 ? r.players + ' climbers · ' : ''}${esc(fmtDate(r.when))}</small></div>`).join('');
    show(`<div class="panel">${header('Records')}
      <div class="mapchips">${chips.map((m) => `<button data-a="m" data-m="${m.id}" class="${map === m.id ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
      <div class="rcards">${best}</div>
      <div class="kind" style="margin:14px 0 6px">Best climbs on ${esc(mapName(map))}</div>
      ${rows ? `<div class="rrows">${rows}</div>` : '<div class="empty">Nothing here yet. Your height, falls, time and difficulty show up as soon as you climb.</div>'}
      <div class="rtot"><div><b>${T.climbs}</b><small>Climbs started</small></div><div><b>${T.falls}</b><small>Falls in total</small></div><div><b>${T.earned}</b><small>Coins earned</small></div><div><b>${T.relics} of ${RELIC_COUNT}</b><small>Relics found</small></div></div>
    </div>`, {
      back: goBack,
      m: (b) => { map = +b.dataset.m; render(); },
    });
  }
  render();
}
