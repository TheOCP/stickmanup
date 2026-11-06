// Text too wide for its box, in any language: made smaller until it fits, never below 62% of its size. A screen is
// checked whenever it is drawn or its text changes, and again when the window changes size.
const MIN = 0.62;
let queued = false;

function ownText(e) {
  for (const n of e.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}

function fit(e) {
  const cw = e.clientWidth;
  if (!cw) return;
  let sw = e.scrollWidth;
  if (sw <= cw + 1) return;
  const cs = getComputedStyle(e);
  // A box made to scroll sideways is fine as it is.
  if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
  const base = +e.dataset.fs || parseFloat(cs.fontSize);
  e.dataset.fs = base;
  let size = parseFloat(cs.fontSize);
  for (let i = 0; i < 5 && sw > cw + 1 && size > base * MIN; i++) {
    size = Math.max(base * MIN, size * (cw / sw) * 0.97);
    e.style.fontSize = size + 'px';
    const was = sw;
    sw = e.scrollWidth;
    // Something else in the box is too wide (not the words): leave the text as it was.
    if (sw >= was) { e.style.fontSize = ''; return; }
  }
}

function fitAll(root) {
  queued = false;
  for (const e of root.querySelectorAll('*')) if (e.offsetParent && ownText(e)) fit(e);
}

export function fitText(root) {
  const go = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => fitAll(root));
  };
  new MutationObserver(go).observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', () => {
    for (const e of root.querySelectorAll('[data-fs]')) e.style.fontSize = '';
    go();
  });
  go();
}
