// Universal reference. One registry (refdefs.js → window.POISE_REF), two depths:
//  · a tooltip after --dur-tip on pointer rest, keyboard focus or a touch long-press,
//    naming the element, explaining it, and linking to the full reference;
//  · the full reference: the page dims, the element stays lit and wired to a
//    central card that answers the brief's questions, without covering it.
// Opening or closing never activates the element; closing restores focus and scroll.
(() => {
  const REF = window.POISE_REF || {};
  const root = document.documentElement;
  const token = (name, fallback) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || fallback;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const defFor = (el) => REF[el?.dataset?.ref];
  // A value read from a live element; an element out of its usual place reads as unknown, not as an error.
  const call = (v, el) => { try { return typeof v === 'function' ? v(el) : v; } catch { return ''; } };
  const short = (d) => d.short || (d.what || '').split(/(?<=\.)\s/)[0];
  let tip = null, tipFor = null, showTimer = 0, hideTimer = 0, touchTimer = 0, suppressClick = false;
  let layer = null, lastFocus = null, savedScroll = [];

  // Words on screen come from the same registry: <span data-term="state.running">.
  window.poiseTerm = (key) => REF[key]?.name || key;
  const paintTerms = (scope = document) => scope.querySelectorAll('[data-term]').forEach((n) => { n.textContent = window.poiseTerm(n.dataset.term); });
  window.poisePaintTerms = paintTerms;

  // ---------- Tooltip ----------
  function placeNear(box, el) {
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), gap = token('--sp-2', 8);
    let top = r.bottom + gap;
    if (top + b.height > innerHeight - gap) top = r.top - b.height - gap;
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(gap, Math.min(left, innerWidth - b.width - gap));
    box.style.top = `${Math.max(gap, top)}px`;
    box.style.left = `${left}px`;
  }
  function showTip(el) {
    const d = defFor(el);
    if (!d || layer) return;
    hideTip(true);
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = `<div class="tip-name">${esc(d.name)}${d.kind ? ` <span class="t-micro">${esc(d.kind)}</span>` : ''}</div>
      <p class="tip-text">${esc(call(d.tip, el) || short(d))}</p>
      <div class="tip-foot"><button class="tip-link" data-ref-open>Full reference →</button><span class="kbd">?</span></div>`;
    document.body.appendChild(tip);
    placeNear(tip, el);
    tipFor = el;
    el.setAttribute('aria-describedby', 'poise-tip');
    tip.id = 'poise-tip';
    tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    tip.addEventListener('pointerleave', () => scheduleHide());
    tip.querySelector('[data-ref-open]').addEventListener('click', (e) => { e.stopPropagation(); openRef(tipFor); });
  }
  function hideTip(now) {
    clearTimeout(hideTimer);
    if (!tip) return;
    tipFor?.removeAttribute('aria-describedby');
    if (now) { tip.remove(); tip = null; tipFor = null; return; }
    tip.remove(); tip = null; tipFor = null;
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => hideTip(true), token('--dur-tip-hide', 160)); }
  function scheduleShow(el) { clearTimeout(showTimer); showTimer = setTimeout(() => showTip(el), token('--dur-tip', 500)); }

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || layer) return;
    if (e.target.closest('.tip')) { clearTimeout(hideTimer); return; }
    const el = e.target.closest('[data-ref]');
    if (!el) return;
    if (el === tipFor) { clearTimeout(hideTimer); return; }
    scheduleShow(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-ref]');
    if (!el) return;
    if (e.relatedTarget && (el.contains(e.relatedTarget) || e.relatedTarget.closest?.('.tip'))) return;
    clearTimeout(showTimer);
    if (tip) scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    if (layer || e.target.closest('.tip')) return;
    const el = e.target.closest('[data-ref]');
    // Keyboard focus only: focus moved by a script after a click is not a request for help.
    if (el && el !== tipFor && e.target.matches(':focus-visible')) scheduleShow(el);
  });
  document.addEventListener('focusout', (e) => {
    if (e.relatedTarget?.closest?.('.tip')) return;
    clearTimeout(showTimer);
    if (tip && !layer) scheduleHide();
  });
  // Touch: a long press shows the tooltip and does not activate the element.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const el = e.target.closest('[data-ref]');
    if (!el) return;
    touchTimer = setTimeout(() => { suppressClick = true; showTip(el); }, token('--dur-tip', 500));
  });
  ['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => clearTimeout(touchTimer)));
  document.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);
  document.addEventListener('keydown', (e) => {
    if (layer) { if (e.key === 'Escape') { e.preventDefault(); closeRef(); } return; }
    if (e.key === 'Escape' && tip) { hideTip(true); return; }
    // Outside text fields only: a field, a select or an editable page (the Editor's) takes the key as typing.
    const typing = document.activeElement && (/input|textarea|select/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable);
    if (e.key === '?' && !typing) {
      const el = tipFor || document.activeElement?.closest?.('[data-ref]');
      if (el && defFor(el)) { e.preventDefault(); openRef(el); }
    }
  });
  addEventListener('scroll', () => tip && !layer && hideTip(true), true);
  // Typing is not resting: it cancels a pending tooltip and hides a shown one.
  document.addEventListener('keydown', (e) => { if (e.key !== '?' && !layer) clearTimeout(showTimer); }, true);
  document.addEventListener('input', () => { clearTimeout(showTimer); if (tip && !layer) hideTip(true); });

  // ---------- Full reference ----------
  const QUESTIONS = [
    ['what', 'What is this?'], ['does', 'What it does or shows'], ['now', 'What the current value means'],
    ['values', 'Other possible values'], ['scope', 'What it affects'], ['when', 'When a change takes effect'],
    ['unchanged', 'What stays unchanged'], ['shows', 'How the result shows'], ['source', 'Where the information comes from'],
    ['unavailable', 'Why it is unavailable']
  ];
  const disabled = (el) => el.matches('[disabled], [aria-disabled="true"]') || !!el.closest('[aria-disabled="true"]');

  function answer(key, d, el) {
    if (key === 'now') {
      const v = call(d.now, el);
      return v ? `<span class="now">${esc(v)}</span>` : '';
    }
    if (key === 'unavailable') return disabled(el) ? esc(call(d.unavailable, el) || 'Not available right now.') : '';
    const v = call(d[key], el);
    if (!v) return '';
    if (Array.isArray(v)) return `<ul>${v.map(([k, m]) => `<li><b>${esc(k)}</b><span>${esc(m)}</span></li>`).join('')}</ul>`;
    return esc(v);
  }

  function openRef(el) {
    const d = defFor(el);
    if (!d || !el) return;
    hideTip(true);
    lastFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : el;
    savedScroll = [[document.scrollingElement, document.scrollingElement.scrollTop], ...[...document.querySelectorAll('.scroll, .list-scroll, .pane-scroll')].map((s) => [s, s.scrollTop])];
    layer = document.createElement('div');
    layer.className = 'ref-layer';
    const rows = QUESTIONS.map(([k, q]) => { const a = answer(k, d, el); return a ? `<dt>${q}</dt><dd>${a}</dd>` : ''; }).join('');
    layer.innerHTML = `<svg class="ref-wire" aria-hidden="true"><path class="ref-dim" fill-rule="evenodd"/><line/><circle r="4"/><circle r="4"/></svg><div class="ref-spot"></div>
      <section class="ref-card" role="dialog" aria-modal="true" aria-labelledby="ref-title" tabindex="-1">
        <div class="ref-head"><div><span class="t-micro">${esc(d.kind || 'Reference')}</span><h3 id="ref-title">${esc(d.name)}</h3></div><button class="ib" data-ref-close aria-label="Close reference"><svg class="i"><use href="#i-cross"/></svg></button></div>
        ${d.tip && typeof d.tip === 'string' && d.tip !== d.what ? `<p class="ref-lede">${esc(d.tip)}</p>` : ''}
        <dl class="ref-qa">${rows}</dl>
        <p class="ref-foot"><span class="kbd">Esc</span> closes and returns you to ${esc(d.name)} <span class="t-mono">· ${esc(el.dataset.ref)}</span></p>
      </section>`;
    document.body.appendChild(layer);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    layout(el);
    layer.addEventListener('click', (e) => { if (e.target.closest('[data-ref-close]') || !e.target.closest('.ref-card')) closeRef(); });
    layer.querySelector('.ref-card').focus();
    layer.dataset.for = el.dataset.ref;
    layer._el = el;
    // Live views re-render: when the element is replaced, the spotlight follows its
    // successor, the one with the same key and words, or else the first with the key.
    const sig = el.textContent;
    layer._mo = new MutationObserver(() => {
      if (!layer || layer._el.isConnected) return;
      const all = [...document.querySelectorAll(`[data-ref="${CSS.escape(layer.dataset.for)}"]`)].filter((x) => !layer.contains(x));
      const again = all.find((x) => x.textContent === sig) || all[0];
      if (again) { layer._el = again; layout(again); }
    });
    layer._mo.observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', relayout);
    document.dispatchEvent(new CustomEvent('poise:ref', { detail: { open: true } }));
  }
  function relayout() { if (layer?._el) layout(layer._el); }

  function layout(el) {
    const r = el.getBoundingClientRect();
    const pad = token('--sp-1', 4);
    const spot = layer.querySelector('.ref-spot');
    Object.assign(spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // The page dims everywhere except a rounded hole around the element.
    const hx = r.left - pad, hy = r.top - pad, hw = r.width + pad * 2, hh = r.height + pad * 2, rr = Math.min(token('--r-panel', 8), hw / 2, hh / 2);
    layer.querySelector('.ref-dim').setAttribute('d', `M0 0H${innerWidth}V${innerHeight}H0Z M${hx + rr} ${hy}H${hx + hw - rr}A${rr} ${rr} 0 0 1 ${hx + hw} ${hy + rr}V${hy + hh - rr}A${rr} ${rr} 0 0 1 ${hx + hw - rr} ${hy + hh}H${hx + rr}A${rr} ${rr} 0 0 1 ${hx} ${hy + hh - rr}V${hy + rr}A${rr} ${rr} 0 0 1 ${hx + rr} ${hy}Z`);
    const card = layer.querySelector('.ref-card');
    card.style.maxHeight = '';
    const m = token('--sp-6', 24), cw = card.offsetWidth;
    let ch = card.offsetHeight;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    // Centre first. If that would cover the element, use a side where the card
    // fits, the one that keeps it closest to the centre; shrink it only if none does.
    let x = (innerWidth - cw) / 2, y = (innerHeight - ch) / 2;
    const covers = (cx, cy, h) => !(cx + cw < r.left - m || cx > r.right + m || cy + h < r.top - m || cy > r.bottom + m);
    if (covers(x, y, ch)) {
      const place = (side, h) => {
        const midY = clamp(r.top + r.height / 2 - h / 2, m, innerHeight - h - m), midX = clamp(r.left + r.width / 2 - cw / 2, m, innerWidth - cw - m);
        return { right: [r.right + m, midY], left: [r.left - m - cw, midY], below: [midX, r.bottom + m], above: [midX, r.top - m - h] }[side];
      };
      const rooms = [
        { side: 'right', w: innerWidth - r.right - m * 2, h: innerHeight - m * 2 },
        { side: 'left', w: r.left - m * 2, h: innerHeight - m * 2 },
        { side: 'below', w: innerWidth - m * 2, h: innerHeight - r.bottom - m * 2 },
        { side: 'above', w: innerWidth - m * 2, h: r.top - m * 2 }
      ];
      const dist = ([px, py], h) => Math.hypot(px + cw / 2 - innerWidth / 2, py + h / 2 - innerHeight / 2);
      const fits = rooms.filter((o) => o.w >= cw && o.h >= ch).sort((a, b) => dist(place(a.side, ch), ch) - dist(place(b.side, ch), ch));
      let pick = fits[0];
      if (!pick) {
        pick = rooms.filter((o) => o.w >= cw).sort((a, b) => b.h - a.h)[0];
        if (pick && pick.h >= token('--sp-unit', 4) * 40) { ch = pick.h; card.style.maxHeight = `${ch}px`; } else pick = null;
      }
      if (pick) [x, y] = place(pick.side, ch);
    }
    card.style.left = `${clamp(x, m, innerWidth - cw - m)}px`;
    card.style.top = `${clamp(y, m, innerHeight - ch - m)}px`;
    // Wire from the element to the nearest point of the card.
    const c = card.getBoundingClientRect();
    const ex = Math.min(Math.max(c.left + c.width / 2, r.left), r.right), ey = Math.min(Math.max(c.top + c.height / 2, r.top), r.bottom);
    const cx = Math.min(Math.max(ex, c.left), c.right), cy = Math.min(Math.max(ey, c.top), c.bottom);
    const [line, a, b] = layer.querySelectorAll('.ref-wire line, .ref-wire circle');
    line.setAttribute('x1', ex); line.setAttribute('y1', ey); line.setAttribute('x2', cx); line.setAttribute('y2', cy);
    a.setAttribute('cx', ex); a.setAttribute('cy', ey); b.setAttribute('cx', cx); b.setAttribute('cy', cy);
  }

  function closeRef() {
    if (!layer) return;
    removeEventListener('resize', relayout);
    layer._mo?.disconnect();
    layer.remove();
    layer = null;
    savedScroll.forEach(([s, t]) => { if (s) s.scrollTop = t; });
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('poise:ref', { detail: { open: false } }));
  }

  window.poiseOpenRef = openRef;
  window.poiseShowTip = (el) => el && showTip(el);
  document.addEventListener('DOMContentLoaded', () => paintTerms());
})();
