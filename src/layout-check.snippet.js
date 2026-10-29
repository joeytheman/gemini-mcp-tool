() => {
  const W = innerWidth, H = innerHeight, CAP = 50, LEVELS = 4;
  const DEV_OVERLAYS = '#error-overlay,#error-toast';
  const entries = [], clamped = [];
  let found = 0;
  const cs = (el) => getComputedStyle(el);
  const rect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  const words = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const testID = (el) => el.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
  const add = (list, kind, el, r, text) => {
    if (list === entries) found++;
    if (list.length < CAP) list.push({ kind, text: text ?? words(el), testID: el ? testID(el) : null, rect: rect(r) });
  };
  const shown = (el, r) => r.width > 0 && r.height > 0 && cs(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"],[inert]');
  const onScreen = (r) => r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const capped = (s) => (s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis';
  const blockOf = (el) => { let b = el; while (b.parentElement && ['inline', 'contents'].includes(cs(b).display)) b = b.parentElement; return b; };

  const inOverlay = (el) => el.closest(DEV_OVERLAYS);
  const overlay = [...document.querySelectorAll(DEV_OVERLAYS)].find((o) => shown(o, o.getBoundingClientRect()));
  if (overlay) add(entries, 'dev-overlay', overlay, overlay.getBoundingClientRect());

  const page = document.scrollingElement || document.documentElement;
  if (page.scrollWidth > W) add(entries, 'page-scroll-x', null, { left: 0, top: 0, width: page.scrollWidth, height: H }, 'scrollWidth ' + page.scrollWidth + ' > innerWidth ' + W);

  const range = document.createRange();
  for (const el of document.body.querySelectorAll('*')) {
    if (el.isContentEditable || inOverlay(el)) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    const own = blockOf(el);
    const ownRect = own.getBoundingClientRect();
    if (!shown(el, ownRect) || !onScreen(ownRect)) continue;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of texts) {
      for (const run of n.textContent.matchAll(/\S+/g)) {
        range.setStart(n, run.index);
        range.setEnd(n, run.index + run[0].length);
        const tr = range.getBoundingClientRect();
        if (!tr.width) continue;
        l = Math.min(l, tr.left); t = Math.min(t, tr.top); r = Math.max(r, tr.right); b = Math.max(b, tr.bottom);
      }
    }
    if (l === Infinity) continue;
    const ownStyle = cs(own);
    for (let box = own, level = 0; box && box !== document.body && level < LEVELS; box = box.parentElement) {
      const s = cs(box);
      if (['inline', 'contents'].includes(s.display)) continue;
      level++;
      const br = box.getBoundingClientRect();
      const cl = br.left + box.clientLeft, ct = br.top + box.clientTop, cr = cl + box.clientWidth, cb = ct + box.clientHeight;
      const outX = l < cl - 1 || r > cr + 1, outY = t < ct - 1 || b > cb + 1;
      if ((clips(s.overflowX) && outX) || (clips(s.overflowY) && outY)) {
        const partlyVisible = l < cr && r > cl && t < cb && b > ct;
        if (partlyVisible) add(box === own && capped(ownStyle) ? clamped : entries, box === own && capped(ownStyle) ? 'text-clamped' : 'text-clipped', el, el.getBoundingClientRect());
        break;
      }
      if (scrolls(s.overflowX) || scrolls(s.overflowY)) break;
      if (outX) { add(entries, 'text-spill', el, el.getBoundingClientRect()); break; }
      if (s.position === 'absolute' || s.position === 'fixed') break;
    }
  }

  const modal = [...document.querySelectorAll('[aria-modal="true"]')].find((m) => shown(m, m.getBoundingClientRect()));
  const visibleCentre = (el, r) => {
    let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rr = Math.min(r.right, W), b = Math.min(r.bottom, H), absolute = false;
    for (let c = el, a = el.parentElement; a && a !== document.documentElement; c = a, a = a.parentElement) {
      const position = cs(c).position, s = cs(a);
      if (position === 'fixed') break;
      if (position === 'absolute') absolute = true;
      if (absolute && s.position === 'static') continue;
      absolute = false;
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect(), al = ar.left + a.clientLeft, at = ar.top + a.clientTop;
      l = Math.max(l, al); t = Math.max(t, at); rr = Math.min(rr, al + a.clientWidth); b = Math.min(b, at + a.clientHeight);
    }
    return rr > l && b > t ? [(l + rr) / 2, (t + b) / 2] : null;
  };
  const scrollsX = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (scrolls(cs(a).overflowX) && a.scrollWidth > a.clientWidth) return true; return false; };
  const controls = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=switch],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=slider],[tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(controls)) {
    const r = el.getBoundingClientRect();
    if (!shown(el, r) || inOverlay(el) || cs(el).pointerEvents === 'none' || r.bottom <= 0 || r.top >= H) continue;
    const inScrollerX = scrollsX(el);
    if ((r.left < -0.5 || r.right > W + 0.5) && r.right > 0 && r.left < W && !inScrollerX) add(entries, 'control-offscreen', el, r);
    if (inScrollerX || (modal && !modal.contains(el))) continue;
    const centre = visibleCentre(el, r);
    if (!centre) continue;
    const hit = document.elementsFromPoint(centre[0], centre[1]).find((h) => !inOverlay(h));
    if (hit && !el.contains(hit) && !hit.contains(el)) add(entries, 'control-covered', el, r);
  }

  return { check: 'layout-check/1', viewport: { width: W, height: H }, found, entries, clamped };
}
