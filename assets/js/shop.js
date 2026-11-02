// The shop (and wardrobe) and the records screen. A real climber stands in the world on the left, wearing what you
// tap, while the cards are on the right.
import { RARITY, SUITS, LEGENDS, OWNERS, FACES, HATS, COL_W, COL_ARMS, ARM_W, TEX, FACE_W, FACE_H, paintSuit, drawFace, suitIsDark, ownerKey } from './skins.js';
import { gearTris } from './gear.js';
import { coins, owned, equip, worn, myLook, relicsFound, RELIC_COUNT, runsOf, totals } from './profile.js';
import { buyItem } from './cloud.js';
import { DIFFS, MAPS } from './level.js';
import { EMOTES } from './emotes.js';
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
function drawHat(g, id, X, Y, s) {
  g.lineWidth = 0.6;
  for (const t of gearTris(id)) {
    const c = `rgb(${t[7] | 0},${t[8] | 0},${t[9] | 0})`;
    g.fillStyle = c; g.strokeStyle = c;
    g.beginPath();
    g.moveTo(X + t[0] * s, Y(1.02 + t[1]));
    g.lineTo(X + t[2] * s, Y(1.02 + t[3]));
    g.lineTo(X + t[4] * s, Y(1.02 + t[5]));
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

function thumbFor(item) {
  // A hat and a suit can share a name (cowboy, santa), so the key has both.
  const key = item.kind + ':' + item.id;
  if (THUMBS.has(key)) return THUMBS.get(key);
  const W = 120, H = 150, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (item.kind === 'emote') {
    g.font = '76px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(item.icon, W / 2, H / 2);
  } else if (item.kind === 'suit') {
    const s = H / 2.05, X = W / 2, Y = (fy) => H - 6 - (fy + 0.44) * s, k = 128 / TEX, tex = paintSuit(item, 128);
    g.save(); armPath(g, X, Y, s); g.clip();
    g.drawImage(tex, COL_ARMS * k, 0, ARM_W * k, TEX * k, X - 0.24 * s, Y(1.24), 0.48 * s, 1.68 * s);
    g.restore();
    g.save(); figurePath(g, X, Y, s); g.clip();
    g.drawImage(tex, 0, 0, COL_W * k, TEX * k, X - 0.21 * s, Y(1.24), 0.42 * s, 1.68 * s);
    g.restore();
    const light = suitIsDark(item), face = FACES.find((f) => f.id === (item.face || 'smile'));
    drawFaceOn(g, face, light, X, Y, s);
    for (const id of [...(item.gear || []), ...(item.hat ? [item.hat] : [])]) drawHat(g, id, X, Y, s);
  } else {
    // A face or hat on a big plain head.
    const s = H / 0.78, X = W / 2, Y = (fy) => H * (item.kind === 'hat' ? 0.72 : 0.5) - (fy - 1.02) * s;
    const gr = g.createRadialGradient(X - 8, Y(1.08), 6, X, Y(1.02), 0.2 * s);
    gr.addColorStop(0, '#9af4e2'); gr.addColorStop(1, '#3fcdb4');
    g.fillStyle = gr;
    g.beginPath(); g.arc(X, Y(1.02), 0.2 * s, 0, 7); g.fill();
    drawFaceOn(g, item.kind === 'face' ? item : FACES[0], false, X, Y, s);
    if (item.kind === 'hat' && item.id !== 'none') drawHat(g, item.id, X, Y, s);
  }
  const u = c.toDataURL('image/png');
  THUMBS.set(key, u);
  return u;
}

// ---------------------------------------------------------------- the shop
const TABS = [['suits', 'Suits'], ['flags', 'Flags'], ['faces', 'Faces'], ['hats', 'Hats'], ['emotes', 'Emotes'], ['legend', 'Legendary']];
const listFor = (tab, name) => {
  if (tab === 'faces') return FACES.filter((f) => !f.hidden);
  if (tab === 'hats') return HATS.filter((f) => !f.hidden);
  if (tab === 'emotes') return EMOTES.filter((e) => !e.hidden);
  if (tab === 'legend') return [...OWNERS.filter((o) => o.owner === ownerKey(name)), ...LEGENDS];
  return SUITS.filter((s) => s.tab === tab);
};

export function openShop(ctx, goBack, startTab = 'suits') {
  const { app, show, esc, ui, name, lookChanged } = ctx;
  let tab = startTab, sel = null, gridScroll = 0, drawTok = 0;

  const sameSlot = (item, look) => (item.kind === 'emote' ? look : item.kind === 'suit' ? { ...look, s: item.id } : item.kind === 'face' ? { ...look, f: item.id } : { ...look, h: item.id });
  const preview = () => {
    app.preview = { look: sel ? sameSlot(sel, myLook(name())) : myLook(name()), yaw: app.preview ? app.preview.yaw : 0, emote: sel && sel.kind === 'emote' ? sel.id : null };
  };

  function card(it) {
    const have = owned(it, name()), on = have && worn(it);
    const tag = it.kind === 'emote' && have ? '<em class="have">Owned</em>' : on ? '<em class="wearing">Wearing</em>' : have ? '<em class="have">Owned</em>' : it.price > 0 ? `<em class="price">${COIN}${it.price}</em>` : '<em class="lock">Locked</em>';
    return `<button class="skin r${it.r} ${sel === it ? 'sel' : ''} ${have ? '' : 'no'}" data-a="pick" data-id="${it.id}"><img data-th="${it.id}" alt=""><b>${esc(it.name)}</b>${tag}</button>`;
  }

  function sections(list) {
    return RARITY.map((r) => {
      const items = list.filter((x) => x.r === r.id);
      if (!items.length) return '';
      return `<h3 class="rar" style="--rc:${r.css}"><span></span>${r.name}<small>${items.filter((x) => owned(x, name())).length} of ${items.length}</small></h3><div class="skins">${items.map(card).join('')}</div>`;
    }).join('');
  }

  function sideHtml() {
    const it = sel;
    if (!it) return tab === 'emotes' ? `<p class="sub" style="margin:0">Tap one to watch it. During a climb the smiley at the top of the screen opens your emotes. Flips work in the air too.</p>`
      : `<p class="sub" style="margin:0">Tap anything to try it on. Coins come from the climb: the higher the difficulty, the more each one is worth.</p>`;
    const r = RARITY[it.r], have = owned(it, name()), on = have && worn(it);
    let act;
    if (it.kind === 'emote' && have) act = '<button class="btn sm primary" data-a="watch">Watch again</button>';
    else if (on) act = '<button class="btn sm" disabled>Wearing it</button>';
    else if (have) act = '<button class="btn sm primary" data-a="equip">Wear it</button>';
    else if (it.price > 0) act = `<button class="btn sm ${coins() >= it.price ? 'primary' : ''}" data-a="buy" ${coins() >= it.price ? '' : 'disabled'}>Buy for ${it.price} coins</button>`;
    else act = '';
    const need = !have && it.price > 0 && coins() < it.price ? `<p class="need">${it.price - coins()} more coins needed</p>` : '';
    const hint = it.hint && !(have && !it.owner) ? `<p class="hint">${esc(it.hint)}</p>` : it.hint && have ? `<p class="hint">Found it. Well done.</p>` : '';
    return `<b class="sname">${esc(it.name)}</b><span class="srar" style="color:${r.css}">${it.role || r.name}</span>${hint}${need}${act}`;
  }

  function loadThumbs() {
    const tok = ++drawTok, imgs = [...document.querySelectorAll('#menu img[data-th]')];
    const list = listFor(tab, name()), find = (id) => list.find((x) => x.id === id);
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
    const list = listFor(tab, name());
    show(`<div class="shop">
      <div class="shopside">
        <div class="ph"><button class="back" data-a="back">‹</button><div class="wallet">${COIN}<b>${coins()}</b></div></div>
        <div class="shopinfo">${sideHtml()}</div>
      </div>
      <div class="shopmain">
        <div class="tabs">${TABS.map(([k, n]) => `<button data-a="tab" data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        ${tab === 'legend' ? `<p class="sub lg">Coins can't buy these. They only come from Hardcore or Insane: find the hidden places (${relicsFound()} of ${RELIC_COUNT} relics found) or do something nobody else would.</p>` : ''}
        <div class="shopgrid">${sections(list)}</div>
      </div></div>`, {
      back: () => { app.preview = null; goBack(); },
      tab: (b) => { tab = b.dataset.t; sel = null; gridScroll = 0; preview(); render(); },
      pick: (b) => { sel = listFor(tab, name()).find((x) => x.id === b.dataset.id); preview(); if (app.preview) app.preview.yaw = sel.flag || sel.cape ? 2.6 : -0.4; render(); },
      buy: async () => {
        if (!sel || buying) return;
        const item = sel;
        buying = true;
        const err = await buyItem(item);
        buying = false;
        if (err) { ui.toast(err, 'bad'); render(); return; }
        app.sound.checkpoint();
        if (item.kind !== 'emote') equip(item);
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
  let map = startMap;
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(); } catch (e) { return ''; } };
  function render() {
    const runs = runsOf(map), T = totals();
    const best = DIFFS.map((d) => {
      const list = runs.filter((r) => r.diff === d.id), top = list[0], won = list.filter((r) => r.won).sort((a, b) => a.t - b.t)[0];
      return `<div class="rcard d${d.id}"><b>${d.name}</b>${top ? `<strong>${top.h} m</strong><small>${won ? 'Fastest to the top ' + fmtTime(won.t) : `${top.falls} fall${top.falls === 1 ? '' : 's'} on that climb`}</small>` : '<strong class="none">No climb yet</strong><small>Go and set one</small>'}</div>`;
    }).join('');
    const rows = runs.map((r, i) => `<div class="rrow ${r.won ? 'won' : ''}"><span class="rn">${i + 1}</span><b>${r.h} m</b><span class="rd d${r.diff}">${DIFFS[r.diff].name}${r.custom ? ' (custom)' : ''}</span><span>${r.falls} fall${r.falls === 1 ? '' : 's'}</span><span>${fmtTime(r.t)}</span><span class="rc">${COIN}${r.coins}</span><small>${r.won ? 'Summit · ' : ''}${r.players > 1 ? r.players + ' climbers · ' : ''}${esc(fmtDate(r.when))}</small></div>`).join('');
    show(`<div class="panel">${header('Records')}
      <div class="mapchips">${MAPS.map((m) => `<button data-a="m" data-m="${m.id}" class="${map === m.id ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
      <div class="rcards">${best}</div>
      <div class="kind" style="margin:14px 0 6px">Best climbs on ${esc(MAPS[map].name)}</div>
      ${rows ? `<div class="rrows">${rows}</div>` : '<div class="empty">Nothing here yet. Your height, falls, time and difficulty show up as soon as you climb.</div>'}
      <div class="rtot"><div><b>${T.climbs}</b><small>Climbs started</small></div><div><b>${T.falls}</b><small>Falls in total</small></div><div><b>${T.earned}</b><small>Coins earned</small></div><div><b>${T.relics} of ${RELIC_COUNT}</b><small>Relics found</small></div></div>
    </div>`, {
      back: goBack,
      m: (b) => { map = +b.dataset.m; render(); },
    });
  }
  render();
}
