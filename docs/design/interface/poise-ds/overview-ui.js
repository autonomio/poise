// What both Overview directions draw with: notices you answer in place, the
// level control, the year chart with its readout, pace bullets, the behaviors
// table and quota. Each direction arranges them its own way.
(() => {
  const { $, $$, params, esc, clock, toast, lifeHTML } = window.PoiseShell;
  const OV = window.PoiseOV;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const chip = (s, note = '') => `<span class="st" data-state="${s}"><span data-term="state.${s}">${term(`state.${s}`)}</span></span>${note ? `<span class="onote">${esc(note)}</span>` : ''}`;
  const groupName = (g) => OV.GROUPS.find((x) => x[0] === g)[1];

  // ---------- A notice: what it is, and its answers right on it ----------
  const external = (href) => /^https?:/.test(href);
  function noticeHTML(n, { open = false, compact = false, first = false } = {}) {
    const a = n.answered, busy = n.answering;
    // One line: what it is, from whom, and its first answer. It stays one line
    // while the answer runs and after, so nothing below it moves.
    if (compact) {
      const o = n.options.find((x) => x.primary) || n.options[0];
      const end = busy
        ? `<span class="life" data-ref="life" data-life="${busy.stage}">${lifeHTML(busy.stage, busy.words, true)}</span>`
        : a
          ? `<span class="nc-done"><span class="sdot is-saved"></span><b>${esc(a.how)}</b> · ${esc(a.words)}${a.undoable ? ' · <button class="lnk" data-act="undo" data-ref="ov.undo">Undo</button>' : ''}</span>`
          : `${o ? `<button class="btn-ghost${o.primary ? ' is-primary' : ''}" data-act="answer" data-key="${o.key}" data-ref="ov.option"${n.gone ? ` aria-disabled="true" data-why="${esc(n.gone)}"` : ''}><span class="k">1</span>${esc(o.label)}</button>` : ''}<button class="lnk" data-act="more" aria-expanded="false">${n.options.length > 1 || n.reply ? 'More answers' : 'Details'}</button>`;
      return `<article class="nc is-compact is-${n.group}${a ? ' is-answered' : ''}${n.fresh ? ' is-fresh' : ''}" data-notice="${n.id}" data-ref="ov.compact" tabindex="0" aria-labelledby="nt-${n.id}"><span class="t-micro">${esc(n.kind)}</span><span class="nc-t" id="nt-${n.id}">${esc(n.title)}</span>${a || busy ? '' : `${n.state !== 'needs-you' ? chip(n.state) : ''}<span class="nc-who">${esc(n.who)}</span>`}<span class="nc-end">${end}</span><span class="nc-when">${a ? a.at : n.since || clock()}</span></article>`;
    }
    const opts = n.options.map((o, i) => `<button class="btn-ghost${o.primary ? ' is-primary' : ''}" data-act="answer" data-key="${o.key}" data-ref="ov.option"${n.gone ? ` aria-disabled="true" data-why="${esc(n.gone)}"` : ''}><span class="k">${i + 1}</span>${esc(o.label)}</button>`).join('');
    const reply = n.reply ? (n.replying ? `<div class="nc-reply"><textarea rows="2" placeholder="${esc(n.replyPlaceholder || 'Reply on GitHub, as mikkokotila')}" aria-label="Your reply" data-reply-text>${esc(n.draft || '')}</textarea><div class="nc-acts"><button class="btn-ghost is-primary" data-act="reply-send" data-ref="ov.reply">${esc(n.replySend || 'Send reply')}</button><button class="btn-ghost" data-act="reply-cancel">Cancel</button></div></div>` : `<button class="btn-ghost" data-act="reply-open" data-ref="ov.reply">${esc(n.replyLabel || 'Reply…')}</button>`) : '';
    const status = busy
      ? `<div class="life" data-ref="life" data-life="${busy.stage}">${lifeHTML(busy.stage, busy.words, true)}</div>`
      : a
        ? `<p class="nc-done"><span class="sdot is-saved"></span><b>${esc(a.how)}</b> · ${esc(a.words)} · ${a.at}${a.undoable ? ' · <button class="lnk" data-act="undo" data-ref="ov.undo">Undo</button>' : ''}</p>`
        : `${opts || reply ? `<div class="nc-acts">${opts}${reply}</div>` : ''}`;
    const tools = a || busy ? '' : [
      n.open ? `<a class="lnk" href="${n.open[0]}"${external(n.open[0]) ? ' target="_blank" rel="noopener"' : ''} data-ref="ov.open">${esc(n.open[1])}${external(n.open[0]) ? ' ↗' : ''}</a>` : '',
      n.silenceable ? '<button class="lnk" data-act="silence" data-ref="ov.silence">Silence reminders</button>' : '',
      n.dismissable ? '<button class="lnk" data-act="dismiss" data-ref="ov.dismiss">Dismiss</button>' : '',
      n.body || n.code || n.why ? `<button class="lnk" data-act="more" aria-expanded="${open}">${open ? 'Less' : 'More'}</button>` : ''
    ].filter(Boolean).join('');
    return `<article class="nc is-${n.group}${a ? ' is-answered' : ''}${n.fresh ? ' is-fresh' : ''}" data-notice="${n.id}" data-ref="${n.ref || (first ? 'ov.focus' : 'ov.notice')}" tabindex="0" aria-labelledby="nt-${n.id}">
      <header class="nc-h"><span class="t-micro">${esc(n.kind)}</span>${n.fresh ? '<span class="chip is-agent">New</span>' : ''}${n.meta ? `<span class="nc-meta" data-ref="ov.advance">${esc(n.meta)}</span>` : ''}<span class="nc-when">${n.since || clock()}</span></header>
      <h3 class="nc-t" id="nt-${n.id}">${esc(n.title)}</h3>
      <p class="nc-m">${n.state !== 'needs-you' ? chip(n.state) : ''}<span>${esc(n.who)}</span><span class="dim">· ${esc(n.where)}</span></p>
      ${n.gone && !a ? `<p class="nc-gone" data-ref="ov.gone">${esc(n.gone)}</p>` : ''}
      ${open && !a ? `<div class="nc-b">${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}${n.impact ? `<p class="nc-impact" data-ref="ov.impact">Work impact: ${esc(n.impact)}</p>` : ''}${n.code ? `<pre class="t-mono">${esc(n.code)}</pre>` : ''}${n.why ? `<p class="nc-why" data-ref="mgr.why">${esc(n.why)}</p>` : ''}</div>` : ''}
      ${status}
      ${tools ? `<footer class="nc-f">${tools}</footer>` : ''}
    </article>`;
  }

  // ---------- The level control ----------
  function levelHTML(style = 'seg') {
    if (style === 'stops') {
      return `<div class="stops olevel" role="radiogroup" aria-label="How much to show" data-ref="ov.level">${OV.LEVELS.map(([, name, gloss], i) => `<button role="radio" aria-checked="${i === OV.level}" tabindex="${i === OV.level ? 0 : -1}" data-level="${i}" title="${esc(gloss)}"><i></i>${name}</button>`).join('')}</div>`;
    }
    return `<div class="seg olevel" role="radiogroup" aria-label="How much to show" data-ref="ov.level">${OV.LEVELS.map(([, name, gloss], i) => `<button role="radio" aria-checked="${i === OV.level}" aria-pressed="${i === OV.level}" tabindex="${i === OV.level ? 0 : -1}" data-level="${i}" title="${esc(gloss)}">${name}</button>`).join('')}</div>`;
  }

  // ---------- The answer list: groups by who acts; nothing moves while you are in it ----------
  // Answered notices stay where they were until you leave the list, then fold into Handled today.
  function mountAnswers(root, { style = 'seg', focusFirst = false, compact = false, render } = {}) {
    let inside = false, autoOpen = false, handledOpen = false, firstId = null, handoff = null;
    const openIds = new Set(), stay = new Set(), shut = new Set();
    // A link to a notice's work impact opens the notice that carries it.
    if (new URLSearchParams(location.search).get('ref') === 'ov.impact') openIds.add('nchain');
    // With focusFirst, the most pressing unanswered notice is open until you open
    // or close another; answering it opens the next.
    const isOpen = (id) => openIds.has(id) || id === firstId;
    const toggle = (id) => { if (isOpen(id)) { openIds.delete(id); shut.add(id); } else { openIds.add(id); shut.delete(id); } };
    function listHTML() {
      // The first in the list's own order: by group, then as listed.
      const first = focusFirst && !openIds.size ? OV.GROUPS.slice(0, Math.min(OV.level, 2) + 1).map(([g]) => OV.N.find((n) => n.group === g && !n.answered && !n.answering && !shut.has(n.id))).find(Boolean) : null;
      firstId = first ? first.id : null;
      const groups = OV.GROUPS.slice(0, OV.level + 1).map(([g, name, gloss]) => {
        const items = OV.N.filter((n) => n.group === g && (!n.answered || stay.has(n.id)));
        if (!items.length) return '';
        const folded = g === 'auto' && !autoOpen && OV.shown().some((n) => n.group !== 'auto');
        return `<section class="ng is-${g}" aria-label="${name}"><h2 class="ng-h"><span class="t-micro">${name}</span><span class="n">${items.filter((n) => !n.answered).length}</span>${g === 'auto' ? `<button class="lnk" data-act="auto" aria-expanded="${!folded}" data-ref="ov.fold">${folded ? 'Show' : 'Fold'}</button>` : `<span class="t-gloss">${gloss}</span>`}</h2>${folded ? '' : items.map((n) => noticeHTML(n, { open: isOpen(n.id), compact: compact && !isOpen(n.id), first: n.id === firstId })).join('')}</section>`;
      }).join('');
      const done = [...OV.N.filter((n) => n.answered && !stay.has(n.id)).map((n) => ({ title: n.title, note: n.answered.how, at: n.answered.at, id: n.id, undoable: n.answered.undoable })), ...OV.HANDLED];
      const handled = `<section class="ng is-handled"><h2 class="ng-h"><span class="t-micro">Handled today</span><span class="n">${done.length}</span><button class="lnk" data-act="handled" aria-expanded="${handledOpen}" data-ref="ov.handled">${handledOpen ? 'Fold' : 'Show'}</button></h2>${handledOpen ? `<ul class="hl">${done.map((d) => `<li><span class="sdot is-saved"></span><span class="hl-t">${esc(d.title)}</span><span class="hl-n">${esc(d.note)} · ${d.at}</span>${d.undoable ? `<button class="lnk" data-act="undo" data-undo="${d.id}" data-ref="ov.undo">Undo</button>` : ''}</li>`).join('')}</ul>` : ''}</section>`;
      const empty = OV.shown().length ? '' : `<p class="nempty">Nothing ${OV.level === 0 ? 'needs you' : 'is open at this level'}. ${OV.level < 3 ? 'Show more with the control above, or rest.' : 'Rest.'}</p>`;
      const off = OV.NOTICES_OFF ? '<p class="nempty">Notifications are off in <a class="lnk" href="settings.html?back=overview#general">Settings, General</a>. Behaviors’ activity and your chats’ requests still show here.</p>' : '';
      return off + groups + empty + handled;
    }
    function paint() {
      const list = $('[data-nlist]', root);
      const had = document.activeElement?.closest?.('[data-notice]')?.dataset.notice;
      list.innerHTML = listHTML();
      hydrateIcons(list);
      window.poisePaintTerms?.(list);
      const lv = $('[data-levelbox]', root);
      if (lv) lv.innerHTML = levelHTML(style);
      const b = OV.bell(), count = $('[data-ncount]', root);
      if (count) { count.textContent = b.count; count.dataset.tone = b.tone; }
      const heldEl = $('[data-held]', root);
      if (heldEl) { heldEl.hidden = !OV.heldCount; heldEl.innerHTML = `${OV.heldCount} new · <button class="lnk" data-act="release">Show now</button>`; }
      paintBell();
      // Answering the open notice hands the focus to the next one, so the keys keep going.
      const to = focusFirst && handoff && handoff === had && firstId ? firstId : had;
      if (handoff && to !== had) handoff = null;
      if (to) $(`[data-notice="${to}"]`, list)?.focus({ preventScroll: true });
      render?.();
    }
    // Pointer or focus in the list holds arrivals and keeps answered notices in place.
    const list = $('[data-nlist]', root);
    const settle = () => { if (inside) return; stay.clear(); OV.hold(false); paint(); };
    root.addEventListener('pointerenter', () => { inside = true; OV.hold(true); });
    root.addEventListener('pointerleave', () => { inside = root.contains(document.activeElement) && document.activeElement !== document.body; if (!inside) setTimeout(settle, 400); });
    root.addEventListener('focusin', () => { inside = true; OV.hold(true); });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget) && !root.matches(':hover')) { inside = false; setTimeout(settle, 400); } });
    OV.on(() => paint());
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button, a');
      if (!b || b.matches('[aria-disabled="true"]')) return;
      if (b.dataset.level) { OV.level = +b.dataset.level; return; }
      const card = b.closest('[data-notice]'), id = card?.dataset.notice, n = OV.N.find((x) => x.id === id);
      switch (b.dataset.act) {
        case 'answer': stay.add(id); handoff = id; OV.answer(id, b.dataset.key); break;
        case 'undo': OV.undo(b.dataset.undo || id); break;
        case 'dismiss': stay.add(id); handoff = id; OV.dismiss(id); break;
        case 'silence': stay.add(id); handoff = id; OV.dismiss(id, 'Silenced'); break;
        case 'more': toggle(id); paint(); $(`[data-notice="${id}"]`, root)?.focus({ preventScroll: true }); break;
        case 'reply-open': n.replying = true; paint(); $(`[data-notice="${id}"] [data-reply-text]`, root)?.focus(); break;
        case 'reply-cancel': n.replying = false; paint(); break;
        case 'reply-send': { const t = $(`[data-notice="${id}"] [data-reply-text]`, root).value.trim(); if (!t) return; n.replying = false; stay.add(id); handoff = id; OV.answer(id, 'reply', t); break; }
        case 'auto': autoOpen = !autoOpen; paint(); break;
        case 'handled': handledOpen = !handledOpen; paint(); break;
        case 'release': OV.hold(false); break;
        default:
      }
    });
    root.addEventListener('input', (e) => { const t = e.target.closest('[data-reply-text]'); if (t) OV.N.find((x) => x.id === t.closest('[data-notice]').dataset.notice).draft = t.value; });
    // Keys: J and K move between notices; 1–9 answer; Enter or E opens the detail; O opens it in its place.
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('textarea, input')) return;
      const lv = e.target.closest('[data-level]');
      if (lv && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); OV.level = Math.max(0, Math.min(3, OV.level + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1))); $(`[data-level="${OV.level}"]`, root)?.focus(); return; }
      const card = e.target.closest('[data-notice]');
      if (!card) return;
      const cards = $$('[data-notice]', root), i = cards.indexOf(card), n = OV.N.find((x) => x.id === card.dataset.notice);
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); cards[Math.min(cards.length - 1, i + 1)]?.focus(); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); cards[Math.max(0, i - 1)]?.focus(); }
      if (/^[1-9]$/.test(e.key) && !n.answered && !n.answering && !n.gone && n.options[+e.key - 1]) { e.preventDefault(); stay.add(n.id); handoff = n.id; OV.answer(n.id, n.options[+e.key - 1].key); }
      if ((e.key === 'Enter' || e.key === 'e') && e.target === card) { e.preventDefault(); toggle(n.id); paint(); }
      if (e.key === 'o' && n.open) { e.preventDefault(); if (external(n.open[0])) window.open(n.open[0], '_blank', 'noopener'); else location.href = n.open[0]; }
    });
    paint();
    return { paint };
  }

  // The bell in the top bar counts what the level shows, in its colour.
  function paintBell() {
    const b = OV.bell(), badge = $('[data-bell]'), btn = $('[data-ref="bell"]');
    if (!badge) return;
    badge.textContent = b.count;
    badge.hidden = !b.count;
    badge.dataset.tone = b.tone;
    btn?.setAttribute('aria-label', `Notifications, ${b.count} open`);
  }

  // ---------- Charts ----------
  const xy = (vals, w, h, pad = 2) => { const max = Math.max(...vals, 0.0001); return vals.map((v, i) => [pad + (i * (w - 2 * pad)) / (vals.length - 1), h - pad - (v / max) * (h - 2 * pad)]); };
  const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  function spark(vals) {
    const pts = xy(vals, 100, 24);
    const [lx, ly] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path class="spark-a" d="${pathOf(pts)}L98 24L2 24Z"/><path class="spark-l" d="${pathOf(pts)}"/><circle class="spark-last" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.8"/></svg>`;
  }
  // Week i of the year: the seven days ending 7 × (51 − i) days before yesterday.
  const weekOf = (i) => { const end = new Date(2026, 9, 22 - 7 * (51 - i)), start = new Date(end); start.setDate(end.getDate() - 6); const f = (d, m) => d.toLocaleDateString('en-GB', m ? { day: 'numeric', month: 'short' } : { day: 'numeric' }); const yr = end.getFullYear() === 2026 ? '' : ` ${end.getFullYear()}`; return (start.getMonth() === end.getMonth() ? `${f(start)}–${f(end, true)}` : `${f(start, true)} – ${f(end, true)}`) + yr; };
  function yearHTML(m) {
    const vals = OV.HIST[m.id], pts = xy(vals, 600, 120, 6), max = Math.max(...vals), mi = vals.indexOf(max);
    const [lx, ly] = pts[51], [mx, my] = pts[mi];
    // As main does since #995: the 30 completed days before the chosen day, in five bins.
    const days = Array.from({ length: 30 }, (_, i) => vals[51 - Math.floor(i / 7)] * (0.75 + 0.5 * (((i * 37) % 11) / 10)));
    const dlo = Math.min(...days), dhi = Math.max(...days), dspan = (dhi - dlo) || 1;
    const bins = Array(5).fill(0);
    days.forEach((v) => { bins[Math.min(4, Math.floor(((v - dlo) / dspan) * 5))]++; });
    const bmax = Math.max(...bins);
    return `<div class="year" data-year="${m.id}" data-ref="ov.year">
      <svg class="ychart" viewBox="0 0 600 132" preserveAspectRatio="none" tabindex="0" role="img" aria-label="${esc(m.label)} over the past year, one point per week. Arrow keys move through the weeks." data-ychart>
        <path class="y-a" d="${pathOf(pts)}L594 126L6 126Z"/><path class="y-l" d="${pathOf(pts)}"/>
        <circle class="y-max" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3"/><circle class="y-last" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4"/>
        <line class="y-cur" x1="0" x2="0" y1="0" y2="126" data-cur/>
      </svg>
      <p class="yread" aria-live="polite" data-yread>Highest: ${OV.fmt(m, max)} in the week of ${weekOf(mi)}. The latest week, ${weekOf(51)}, is in blue.</p>
      <svg class="yhist" viewBox="0 0 600 36" preserveAspectRatio="none" aria-hidden="true" data-ref="ov.dist">${bins.map((c, i) => `<rect class="y-bin" x="${i * 120 + 2}" y="${36 - (c / bmax) * 34}" width="116" height="${(c / bmax) * 34}"><title>${c} of 30 days</title></rect>`).join('')}</svg>
      <p class="t-gloss">The 30 days before ${OV.day === 0 ? 'today' : 'the chosen day'}, one value a day, in five bins from ${OV.fmt(m, dlo)} to ${OV.fmt(m, dhi)}.</p>
    </div>`;
  }
  // The readout follows the pointer, or the arrow keys, week by week.
  function bindYear(root) {
    root.addEventListener('pointermove', (e) => { const svg = e.target.closest('[data-ychart]'); if (svg) showWeek(svg, Math.round(((e.clientX - svg.getBoundingClientRect().left) / svg.getBoundingClientRect().width) * 51)); });
    root.addEventListener('keydown', (e) => {
      const svg = e.target.closest('[data-ychart]');
      if (!svg) return;
      const cur = +(svg.dataset.week ?? 51), step = { ArrowLeft: -1, ArrowRight: 1, Home: -99, End: 99 }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      showWeek(svg, Math.max(0, Math.min(51, cur + step)));
    });
  }
  function showWeek(svg, i) {
    i = Math.max(0, Math.min(51, i));
    const box = svg.closest('[data-year]'), m = [...OV.PROD, ...OV.PER_PR, ...OV.FRICTION].find((x) => x.id === box.dataset.year), v = OV.HIST[m.id][i];
    svg.dataset.week = i;
    const x = 6 + (i * 588) / 51, cur = $('[data-cur]', svg);
    cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.classList.add('is-on');
    $('[data-yread]', box).textContent = `Week of ${weekOf(i)}: ${OV.fmt(m, v)}${m.kind === 'count' ? ' a day, on average' : m.kind === 'time' ? ', the median' : ''}.`;
  }
  // Today against typical by now: the bar is today, the tick is typical.
  function bullet(m) {
    const p = OV.pace(m), top = Math.max(p.v, p.typical) * 1.15 || 1;
    return `<svg class="bullet is-${p.tone}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="b-track" x="0" y="0" width="100" height="6"/><rect class="b-val" x="0" y="0" width="${((p.v / top) * 100).toFixed(1)}" height="6"/><rect class="b-typ" x="${((p.typical / top) * 100).toFixed(1)}" y="0" width="1.2" height="6"/></svg>`;
  }
  const arrow = (dir) => (dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→');
  function paceHTML(m) {
    const p = OV.pace(m);
    return `<span class="pace is-${p.tone}" data-ref="ov.pace"><b>${arrow(p.dir)}</b>${esc(p.words)}</span>`;
  }
  // Typical by now is a fraction of a day's count: whole numbers from 100, one decimal below.
  const typicalValue = (m) => { const p = OV.pace(m); return m.kind === 'count' ? (p.typical >= 100 ? Math.round(p.typical) : Math.round(p.typical * 10) / 10).toLocaleString('en-US') : OV.fmt(m, p.typical); };
  const typicalWords = (m) => (OV.day === 0 && m.kind === 'count' ? `Typical by now ${typicalValue(m)}` : `7-day ${m.kind === 'share' ? 'share' : 'median'} ${typicalValue(m)}`);

  // ---------- Behaviors: runs, minutes and success for a range ----------
  let range = 'today';
  // ?behaviors=partial (#1133): unreadable run records leave the counts of worker behaviors partial.
  const PARTIAL_BEH = new URLSearchParams(location.search).get('behaviors') === 'partial';
  // System health (#1101, planned): five live cards, each opening the evidence behind it.
  function healthHTML() {
    const H = OV.HEALTH, card = (ref, href, label, value, note) => `<a class="osmall ohealth" href="${href}" data-ref="${ref}"><span class="otile-l">${label}</span><span class="osmall-v">${value}</span><span class="t-gloss">${note}</span></a>`;
    const bar = (parts) => `<svg class="hbar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">${parts.reduce((acc, [kind, w]) => { acc.svg += `<rect class="hb-${kind}" x="${acc.x}" width="${w}" height="6"/>`; acc.x += w; return acc; }, { svg: '', x: 0 }).svg}</svg>`;
    const rows = H.coverage.map(([source, parts, status]) => `<li><span>${source}</span>${parts ? bar(parts) : `<span class="onote is-warn">${status}</span>`}</li>`).join('');
    return `<div class="ohealths" data-ref="ov.health">
      ${card('ov.h.errors', H.errors.href, 'Errors per completed work item', `${H.errors.rate}<span class="t-gloss"> per item</span>`, `${H.errors.errors} errors across ${H.errors.completed} items completed`)}
      ${card('ov.h.blocked', H.blocked.href, 'Work blocked', H.blocked.count, `oldest ${H.blocked.oldest} without verified progress · ${H.blocked.stage}`)}
      ${card('ov.h.recovery', H.recovery.href, 'Recovered by itself', H.recovery.auto, `${H.recovery.helped} needed outside help`)}
      ${card('ov.h.lasterror', H.lastError.href, 'Since the last work error', H.lastError.ago, `at ${H.lastError.at} · ${H.lastError.what}`)}
      <a class="osmall ohealth" href="${H.coverageHref}" data-ref="ov.h.coverage"><span class="otile-l">Evidence coverage</span><ul class="hcov">${rows}</ul><span class="t-gloss">gaps in amber, unknown hollow</span></a>
    </div>`;
  }
  function behaviorsHTML() {
    const rows = OV.BEHAVIORS.map((b) => {
      const [runs, mins, ok] = b.m[range], chips = Object.entries(b.chips).filter(([, c]) => c).map(([g, c]) => `<span class="chip is-outline" title="${groupName(g === 'you' ? 'needs-you' : g)}">${c} ${g === 'auto' ? 'automatic' : g === 'fault' ? 'fault' : 'needs you'}</span>`).join('');
      return `<tr data-beh="${b.id}" data-ref="ov.behavior"><td><button class="oswitch" aria-pressed="${b.on === 'on'}" data-act="beh-toggle" aria-label="${esc(b.label)}: ${b.on === 'on' ? 'on' : 'off'}" data-ref="ov.behavior.switch"><span class="switch"></span></button></td>
        <th scope="row">${esc(b.label)}${b.paused ? `<span class="onote">paused until ${b.paused}</span>` : ''}</th>
        <td>${b.on !== 'on' ? '<span class="onote">Off</span>' : b.last ? `${chip(b.last[0])}<span class="onote">${b.see ? `<a class="lnk" href="${b.see}&amp;back=overview" title="See it in Observe">${b.last[1]} · ${esc(b.last[2])}</a>` : `${b.last[1]} · ${esc(b.last[2])}`}</span>` : '<span class="onote">Never run</span>'}</td>
        <td class="num">${runs.toLocaleString('en-US')}${PARTIAL_BEH && b.worker ? '<span class="onote" data-ref="ov.partial"> partial</span>' : ''}</td><td class="num">${mins.toLocaleString('en-US')}</td>
        <td class="num">${ok == null ? '—' : `<span class="okbar"><svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="ok-t" width="100" height="4"/><rect class="ok-v${ok < 90 ? ' is-low' : ''}" width="${ok}" height="4"/></svg>${ok}%</span>`}</td>
        <td class="chips">${chips}</td></tr>`;
    }).join('');
    return `<div class="obeh" data-ref="ov.behaviors"><div class="obeh-h"><div class="seg" role="group" aria-label="Range" data-ref="ov.range">${OV.RANGES.map(([k, l]) => `<button aria-pressed="${k === range}" data-range="${k}">${l}</button>`).join('')}</div><a class="lnk" href="settings.html?back=overview#behaviors">Settings for each behavior</a></div>
      ${PARTIAL_BEH ? '<p class="onote is-warn" role="status" data-ref="ov.partial">Partial: 2 run records could not be read, so the marked counts cover the readable runs only.</p>' : ''}
      <table class="otable"><thead><tr><th scope="col"><span class="sr">On</span></th><th scope="col">Behavior</th><th scope="col">Last run</th><th scope="col" class="num">Runs</th><th scope="col" class="num">Minutes</th><th scope="col" class="num">Success</th><th scope="col"><span class="sr">Notices</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function bindBehaviors(root, repaint) {
    root.addEventListener('click', (e) => {
      const r = e.target.closest('[data-range]');
      if (r) { range = r.dataset.range; repaint(); return; }
      const t = e.target.closest('[data-act="beh-toggle"]');
      if (t) { const b = OV.BEHAVIORS.find((x) => x.id === t.closest('[data-beh]').dataset.beh); OV.setBehavior(b.id, b.on === 'on' ? 'off' : 'on'); toast(`${b.label} is ${b.on === 'on' ? 'on: it acts from its next run' : 'off: it stops before its next run'}. The same switch is in Settings.`); }
    });
  }

  // ---------- GitHub API: one card per account ----------
  function quotaHTML() {
    // ?quota=unset or failed: nothing to read, or a read that failed. Never a guessed number.
    if (params.get('quota') === 'unset') return '<div class="oquota" data-ref="ov.quota"><p class="onote">GitHub quota needs configured accounts. Set your GitHub user and automation accounts in <a class="lnk" href="settings.html?back=overview#general">Settings → General</a>.</p></div>';
    if (params.get('quota') === 'failed') return '<div class="oquota" data-ref="ov.quota"><p class="onote">GitHub API quota could not be read. Last read at 19:36; it tries again every 15 seconds.</p></div>';
    return `<div class="oquota" data-ref="ov.quota">${OV.QUOTA.map((a) => `<div class="qa"><p class="qa-h"><span class="t-mono">${esc(a.login)}</span><span class="t-gloss">${a.role}</span></p>${a.buckets.map((q) => {
      const left = q.limit - q.used, mins = OV.minsTo(q.reset), sus = mins ? Math.floor(left / mins) : left, tone = OV.riskTone(q.risk);
      return `<div class="qb is-${tone}" data-ref="ov.bucket"><p class="qb-h"><b>${q.res}</b><span class="qrisk is-${tone}" data-ref="ov.risk">${q.risk == null ? 'collecting samples' : `${q.risk}% risk`}</span></p>
        <svg class="qbar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="q-t" width="100" height="6"/><rect class="q-u" width="${((q.used / q.limit) * 100).toFixed(1)}" height="6"/></svg>
        <p class="qb-n">${q.used.toLocaleString('en-US')} of ${q.limit.toLocaleString('en-US')} used · ${left.toLocaleString('en-US')} left · resets ${q.reset}, in ${mins} min</p>
        <p class="qb-n">${q.perMin} a minute now · ${sus} a minute would last</p>
        <svg class="qhours" viewBox="0 0 96 20" preserveAspectRatio="none" aria-label="Use in each of the last 24 hours">${q.h.map((v, i) => `<rect class="q-hr" x="${i * 4 + 0.5}" y="${(20 - v * 20).toFixed(1)}" width="3" height="${(v * 20).toFixed(1)}"/>`).join('')}</svg></div>`;
    }).join('')}</div>`).join('')}</div>`;
  }

  // ---------- In motion: the seven states ----------
  const ORDER = ['needs-you', 'failed', 'blocked', 'running', 'waiting', 'idle', 'done'];
  function countsHTML(kinds, picked) {
    const items = OV.WORK.filter((w) => kinds.includes(w.kind));
    return `<div class="ocounts" role="group" data-ref="ov.counts">${ORDER.map((s) => { const n = items.filter((w) => w.state === s).length; return `<button class="oc${picked === s ? ' is-on' : ''}" data-state-pick="${s}" aria-pressed="${picked === s}"${n ? '' : ' disabled'} data-ref="ov.count"><span class="sc" data-state="${s}"></span><b>${n}</b><span>${term(`state.${s}`)}</span></button>`; }).join('')}</div>`;
  }
  const workList = (state, kinds) => OV.WORK.filter((w) => w.state === state && kinds.includes(w.kind)).map((w) => `<li><span class="sc" data-state="${w.state}"></span><a href="${w.href}">${esc(w.title)}</a>${w.note ? `<span class="onote">${esc(w.note)}</span>` : ''}</li>`).join('');

  // ---------- The Manager, on the same settings as its controls ----------
  function managerHTML() {
    const M = OV.manager;
    return `<div class="omgr" data-ref="mgr.effective"><p class="sentence">${esc(M.sentence())}</p><div class="omgr-r"><div class="rhythm" data-rhythm data-limit="${M.rhythm}"><button class="ib" data-act="rh-less" aria-label="One slot fewer" data-ref="mgr.rhythm"${M.rhythm <= 1 ? ' aria-disabled="true"' : ''}><i data-i="minus"></i></button><output class="rh-n" data-ref="mgr.rhythm">${M.rhythm}</output><button class="ib" data-act="rh-more" aria-label="One slot more" data-ref="mgr.rhythm"${M.rhythm >= 10 ? ' aria-disabled="true"' : ''}><i data-i="plus"></i></button><div class="slots" aria-hidden="true">${[...Array(10)].map((_, k) => `<span class="slot ${k < Math.min(M.used, M.rhythm) ? (k < M.running ? 'run' : k < M.running + M.pausedForYou ? 'paused' : k < M.running + M.pausedForYou + M.blocked ? 'blocked' : 'held') : k < M.used ? 'over' : k < M.rhythm ? 'free' : 'off'}"></span>`).join('')}</div></div><button class="sbtn" data-act="mgr-paused" aria-pressed="${M.paused}" data-ref="mgr.paused"><span class="switch"></span>Pause new work</button><a class="lnk" href="manager.html?pane=controls&amp;back=overview">Open the Manager</a></div></div>`;
  }
  function bindManager(root, repaint) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.matches('[aria-disabled="true"]')) return;
      const M = OV.manager;
      if (b.dataset.act === 'rh-less' || b.dataset.act === 'rh-more') {
        const to = Math.min(10, Math.max(1, M.rhythm + (b.dataset.act === 'rh-more' ? 1 : -1)));
        // Rhythm is policy the Manager reads on its next turn: a slot it adds is filled then.
        M.rhythm = to; // stores it, recounts idle slots and repaints
        const free = M.rhythm - M.used, next = (window.POISE_MANAGER?.next || []).slice(0, Math.max(0, free)).map((x) => `#${x.issue}`);
        toast(`Rhythm ${M.rhythm}. ${free > 0 && next.length ? `On its next turn, at ${window.POISE_POLICY.wake.next(window.POISE_POLICY.wake.get())} or when something wakes it, the Manager gives ${next.join(' and ')} to a new worker.` : free > 0 ? `${free} slot${free === 1 ? '' : 's'} free: nothing waits for one.` : M.rhythm < M.used ? 'Workers over the limit finish their tasks; nothing new starts until use is below it.' : 'Every slot is in use.'}`, 'waiting');
        repaint();
      }
      if (b.dataset.act === 'mgr-paused') { M.paused = !M.paused; toast(M.paused ? 'New work paused. The Manager still wakes and watches; workers finish their tasks.' : 'New work resumed. From the Manager’s next turn, free slots go to the next ticket.', M.paused ? 'waiting' : 'running'); repaint(); }
    });
  }

  // ---------- Day and organization ----------
  function dayHTML() {
    return `<div class="oday" role="group" aria-label="Day" data-ref="ov.day"><button class="ib" data-act="day-prev" aria-label="Previous day"><i data-i="chev" class="sm flip-x"></i></button><span class="oday-t" data-day-label>${OV.dayLabel()}</span><button class="ib" data-act="day-next" aria-label="Next day"${OV.day === 0 ? ' aria-disabled="true"' : ''}><i data-i="chev" class="sm"></i></button></div>
      <label class="oorg" data-ref="ov.org"><span class="sr">Organization</span><select data-org>${OV.ORGS.map(([k, l]) => `<option value="${k}"${k === OV.org ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  }
  function bindDay(root) {
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-act^="day-"]'); if (!b || b.matches('[aria-disabled="true"]')) return; OV.day = OV.day + (b.dataset.act === 'day-prev' ? 1 : -1); });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-org]')) OV.org = e.target.value; });
  }

  window.PoiseOVUI = { healthHTML, chip, noticeHTML, levelHTML, mountAnswers, paintBell, spark, yearHTML, bindYear, bullet, paceHTML, typicalValue, typicalWords, behaviorsHTML, bindBehaviors, quotaHTML, countsHTML, workList, managerHTML, bindManager, dayHTML, bindDay, arrow };
})();
