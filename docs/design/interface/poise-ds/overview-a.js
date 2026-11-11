// Overview, direction A: the Cockpit. Everything at once, arranged by function:
// what wants you on the left, answerable in place; the state of the work, the
// Manager, the day's numbers, the behaviors and the API quota on the right.
(() => {
  const { $, $$, store, esc, clock, params } = window.PoiseShell;
  const OV = window.PoiseOV, UI = window.PoiseOVUI;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const main = $('.ova-main');

  // ---------- What wants you ----------
  const answers = UI.mountAnswers($('[data-answers]'), { style: 'seg' });
  $('[data-act="bell"]').addEventListener('click', () => { $('[data-answers] [data-notice]')?.focus(); });
  // The bell on any view opens Answer here, with a route back to where you were.
  const FROM = { board: ['board.html', 'Board'], chat: ['chat.html', 'Chat'], editor: ['editor.html', 'Editor'], manager: ['manager.html', 'the Manager'], settings: ['settings.html', 'Settings'], observe: ['observe.html', 'Observe'] }[params.get('back')];
  if (FROM) { const b = $('[data-back]'); b.hidden = false; b.href = FROM[0]; b.innerHTML = `<i data-i="chev" class="sm"></i>Back to ${FROM[1]}`; hydrateIcons(b); }
  if (location.hash === '#answer') requestAnimationFrame(() => $('[data-answers] [data-notice]')?.focus());

  // ---------- The day and its controls ----------
  function paintDay() {
    $('[data-dayctl]').innerHTML = UI.dayHTML();
    hydrateIcons($('[data-dayctl]'));
    $('[data-dayline]').textContent = `${OV.dayLabel()}${OV.day === 0 ? `, until ${clock()}` : ''} · ${OV.ORGS.find((o) => o[0] === OV.org)[1]} · against the 7 days before`;
  }
  UI.bindDay($('[data-dayctl]'));

  // ---------- In motion ----------
  let pick = { kinds: ['chat', 'worker', 'pr', 'issue'], state: 'running' };
  function paintMotion() {
    const people = ['chat', 'worker'], items = ['pr', 'issue'];
    $('[data-counts="people"]').innerHTML = UI.countsHTML(people, pick.kinds === people ? pick.state : null);
    $('[data-counts="items"]').innerHTML = UI.countsHTML(items, pick.kinds === items ? pick.state : null);
    // Tasks count by where they have got to, not by state.
    // In the rail's order, so the counts read from intake to merge.
    const ORDER = [...(window.POISE_TASKS?.PHASES || []), 'Merged'];
    const tasks = OV.WORK.filter((w) => w.kind === 'task'), phases = [...new Set(tasks.map((w) => w.phase))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    $('[data-phases]').innerHTML = `<div class="ocounts" role="group" data-ref="ov.phases">${phases.map((p) => { const n = tasks.filter((w) => w.phase === p).length; return `<button class="oc${pick.phase === p ? ' is-on' : ''}" data-phase-pick="${esc(p)}" aria-pressed="${pick.phase === p}" data-ref="ov.phase"><b>${n}</b> ${esc(p === 'Merge' ? 'at merge' : p === 'Merged' ? 'merged' : `in ${p.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`)}</button>`; }).join('')}</div>`;
    const list = pick.phase
      ? tasks.filter((w) => w.phase === pick.phase).map((w) => `<li><span class="sc" data-state="${w.state}"></span><a href="${w.href}">${esc(w.title)}</a><span class="onote">${esc(w.note)}</span></li>`).join('')
      : UI.workList(pick.state, pick.kinds);
    $('[data-worklist]').innerHTML = list || `<li class="onote">Nothing ${term(`state.${pick.state}`)} right now.</li>`;
  }
  $('.ova-motion').addEventListener('click', (e) => {
    const ph = e.target.closest('[data-phase-pick]');
    if (ph) { pick = { kinds: [], state: null, phase: pick.phase === ph.dataset.phasePick ? null : ph.dataset.phasePick }; if (!pick.phase) pick = { kinds: ['chat', 'worker', 'pr', 'issue'], state: 'running' }; paintMotion(); return; }
    const b = e.target.closest('[data-state-pick]');
    if (!b) return;
    const people = b.closest('[data-counts="people"]');
    pick = { kinds: people ? ['chat', 'worker'] : ['pr', 'issue'], state: b.dataset.statePick };
    paintMotion();
  });

  // ---------- Pull request outcomes (planned, #819) ----------
  // Three lines on one scale: each point is the mean of the last twelve
  // two-hour buckets. A stretch with missing coverage is a gap, never a zero.
  (function outcomes() {
    const box = $('[data-outcomes]');
    if (!box) return;
    const N = 60, W = 600, H = 120, pad = 6;
    const wave = (seed, base, amp) => Array.from({ length: N }, (_, i) => Math.max(0, base + amp * Math.sin((i + seed) / 5) + amp * 0.4 * Math.sin((i * 7 + seed) / 3)));
    const LINES = [['merged', 'Merged', wave(2, 2.4, 0.7)], ['failed', 'Needed outside help', wave(9, 0.35, 0.18)], ['recovered', 'Errored, recovered on its own', wave(5, 0.8, 0.3)]];
    const GAP = [31, 33];   // 18:00–24:00 on Tuesday: the ledger lost records
    const max = 3.6, x = (i) => pad + (i / (N - 1)) * (W - pad * 2), y = (v) => H - pad - (v / max) * (H - pad * 2);
    const path = (vals) => vals.map((v, i) => (i >= GAP[0] && i <= GAP[1] ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).reduce((acc, p) => { if (p === null) { acc.push([]); return acc; } acc[acc.length - 1].push(p); return acc; }, [[]]).filter((seg) => seg.length > 1).map((seg) => `<polyline points="${seg.join(' ')}"/>`).join('');
    const days = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon'];
    box.innerHTML = `<div class="oout-legend">${LINES.map(([k, l]) => `<span class="oout-key" data-line="${k}"><i></i>${esc(l)}</span>`).join('')}<span class="oout-key is-gap"><i></i>Coverage missing</span></div>
      <svg class="oout" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pull request outcomes over the past five days">
        <rect class="oout-gap" x="${x(GAP[0]).toFixed(1)}" y="0" width="${(x(GAP[1]) - x(GAP[0])).toFixed(1)}" height="${H}"/>
        ${[1, 2, 3].map((v) => `<line class="oout-grid" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join('')}
        ${LINES.map(([k, , vals]) => `<g class="oout-line" data-line="${k}">${path(vals)}</g>`).join('')}
        <line class="oout-cursor" data-cursor x1="0" x2="0" y1="0" y2="${H}" hidden/>
      </svg>
      <div class="oout-axis">${days.map((d) => `<span>${d}</span>`).join('')}</div>
      <p class="oout-read" data-read role="status">Rest on the chart to read a point: each two-hour count, the 24-hour mean, and the pull requests behind it.</p>`;
    const svg = $('svg.oout', box), cur = $('[data-cursor]', box), read = $('[data-read]', box);
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * (N - 1))));
      cur.hidden = false;
      cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i));
      const when = `${days[Math.floor(i / 12)]} ${String((i % 12) * 2).padStart(2, '0')}:00–${String((i % 12) * 2 + 2).padStart(2, '0')}:00 UTC`;
      read.textContent = i >= GAP[0] && i <= GAP[1]
        ? `${when}: coverage missing. The ledger lost records here, so this stretch is left out rather than counted as zero.`
        : `${when} · merged ${LINES[0][2][i].toFixed(1)} a bucket (${Math.round(LINES[0][2][i] + 0.4)} in this one) · needed outside help ${LINES[1][2][i].toFixed(2)} · recovered on its own ${LINES[2][2][i].toFixed(1)} · e.g. autonomio/poise#484, #486`;
    });
    svg.addEventListener('pointerleave', () => { cur.hidden = true; });
  })();

  // ---------- The Manager ----------
  const paintMgr = () => { $('[data-mgrbox]').innerHTML = UI.managerHTML(); hydrateIcons($('[data-mgrbox]')); };
  UI.bindManager($('[data-mgr]'), paintMgr);

  // ---------- The day's numbers: tiles you can reorder ----------
  const ORDER_KEY = 'poise-overview-tiles';
  let order = store.get(ORDER_KEY, OV.PROD.map((m) => m.id)).filter((id) => OV.PROD.some((m) => m.id === id));
  OV.PROD.forEach((m) => { if (!order.includes(m.id)) order.push(m.id); });
  let open = null;
  const metric = (id) => [...OV.PROD, ...OV.PER_PR, ...OV.FRICTION].find((m) => m.id === id);
  function tileHTML(m) {
    return `<article class="otile${open === m.id ? ' is-open' : ''}" data-tile="${m.id}" draggable="true" tabindex="0" role="button" aria-expanded="${open === m.id}" aria-label="${esc(m.label)}: ${OV.fmt(m, OV.valueOf(m))}. ${esc(OV.pace(m).words)}. Enter opens its year; Alt with an arrow key moves it." data-ref="ov.tile">
      <header class="otile-h"><span class="otile-l">${esc(m.label)}</span><span class="grip" aria-hidden="true"></span></header>
      <p class="otile-v">${OV.fmt(m, OV.valueOf(m))}</p>
      ${UI.paceHTML(m)}
      ${m.kind === 'count' ? UI.bullet(m) : ''}
      <p class="otile-t">${UI.typicalWords(m)}</p>
      ${UI.spark(OV.HIST[m.id])}
    </article>`;
  }
  function paintTiles() {
    $('[data-tiles]').innerHTML = order.map((id) => tileHTML(metric(id))).join('');
    paintDetail();
  }
  function paintDetail() {
    const box = $('[data-detail]');
    if (!open) { box.hidden = true; box.innerHTML = ''; return; }
    const m = metric(open);
    box.hidden = false;
    box.innerHTML = `<header class="ova-dh"><h4>${esc(m.label)} <span class="t-gloss">the past year, one point per week</span></h4><button class="ib" data-act="close-detail" aria-label="Close the year" data-ref="ov.closeyear"><i data-i="cross"></i></button></header>${UI.yearHTML(m)}`;
    hydrateIcons(box);
  }
  const tiles = $('[data-tiles]');
  tiles.addEventListener('click', (e) => { const t = e.target.closest('[data-tile]'); if (!t) return; open = open === t.dataset.tile ? null : t.dataset.tile; paintTiles(); $(`[data-tile="${t.dataset.tile}"]`, tiles)?.focus(); });
  tiles.addEventListener('keydown', (e) => {
    const t = e.target.closest('[data-tile]');
    if (!t) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); return; }
    const step = { ArrowLeft: -1, ArrowUp: -4, ArrowRight: 1, ArrowDown: 4 }[e.key];
    if (e.altKey && step) { e.preventDefault(); move(t.dataset.tile, step); }
  });
  function move(id, step) {
    const i = order.indexOf(id), j = Math.max(0, Math.min(order.length - 1, i + step));
    if (i === j) return;
    order.splice(i, 1);
    order.splice(j, 0, id);
    store.set(ORDER_KEY, order);
    paintTiles();
    $(`[data-tile="${id}"]`, tiles)?.focus();
  }
  let dragged = null;
  tiles.addEventListener('dragstart', (e) => { const t = e.target.closest('[data-tile]'); if (!t) return; dragged = t.dataset.tile; t.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
  tiles.addEventListener('dragover', (e) => { if (dragged && e.target.closest('[data-tile]')) e.preventDefault(); });
  tiles.addEventListener('drop', (e) => { const t = e.target.closest('[data-tile]'); if (!t || !dragged) return; e.preventDefault(); move(dragged, order.indexOf(t.dataset.tile) - order.indexOf(dragged)); });
  tiles.addEventListener('dragend', () => { dragged = null; $$('.is-dragging', tiles).forEach((t) => t.classList.remove('is-dragging')); });
  $('[data-detail]').addEventListener('click', (e) => { if (e.target.closest('[data-act="close-detail"]')) { const was = open; open = null; paintTiles(); $(`[data-tile="${was}"]`, tiles)?.focus(); } });
  UI.bindYear($('[data-detail]'));

  // ---------- Per pull request, and work and review ----------
  function smallHTML(m) {
    return `<button class="osmall" data-small="${m.id}" aria-expanded="${open === m.id}" data-ref="ov.tile"><span class="otile-l">${esc(m.label)}</span><span class="osmall-v">${OV.fmt(m, OV.valueOf(m))}${m.of && OV.day === 0 && OV.org === 'all' ? `<span class="t-gloss"> ${m.of[0]} of ${m.of[1]}</span>` : ''}</span>${UI.paceHTML(m)}${m.note ? `<span class="t-gloss">${esc(m.note)}</span>` : ''}</button>`;
  }
  const paintHealth = () => { const el = $('[data-health]'); if (el) el.innerHTML = UI.healthHTML(); };
  paintHealth();
  function paintPerPR() { $('[data-perpr]').innerHTML = OV.PER_PR.map(smallHTML).join(''); }
  function paintWork() {
    const total = OV.WORK_TYPE.reduce((n, [, c]) => n + c, 0), [lead, leadN] = OV.WORK_TYPE[0];
    $('[data-worktype]').innerHTML = `<h3 class="ocard-h"><span class="t-micro" data-ref="ov.worktype">Work type</span><span class="t-gloss">of ${total} merged</span></h3><p class="ova-lead"><b>${lead}</b> leads, ${Math.round((leadN / total) * 100)}%</p><ul class="wtype">${OV.WORK_TYPE.map(([k, c]) => `<li><span class="wt-k t-mono">${k}</span><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="wt-t" width="100" height="6"/><rect class="wt-v" width="${((c / leadN) * 100).toFixed(1)}" height="6"/></svg><span class="wt-n">${c}</span></li>`).join('')}</ul>`;
    $('[data-friction]').innerHTML = `<h3 class="ocard-h"><span class="t-micro" data-ref="ov.friction">Review</span><span class="t-gloss">what it took to merge</span></h3>${OV.FRICTION.map((m) => `<button class="ofric" data-small="${m.id}" aria-expanded="${open === m.id}" data-ref="ov.tile"><span class="otile-l">${esc(m.label)}</span><span class="osmall-v">${OV.fmt(m, OV.valueOf(m))}</span>${UI.paceHTML(m)}<span class="t-gloss">${esc(m.note || (m.of ? `${m.of[0]} of ${m.of[1]} merged PRs` : ''))}</span>${UI.spark(OV.HIST[m.id])}</button>`).join('')}`;
  }
  main.addEventListener('click', (e) => {
    const s = e.target.closest('[data-small]');
    if (!s) return;
    open = open === s.dataset.small ? null : s.dataset.small;
    paintTiles(); paintPerPR(); paintWork();
    $('[data-detail]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // ---------- Behaviors and quota ----------
  const paintBehaviors = () => { $('[data-behaviors]').innerHTML = UI.behaviorsHTML(); window.poisePaintTerms?.($('[data-behaviors]')); };
  UI.bindBehaviors($('[data-behaviors]'), paintBehaviors);
  const paintQuota = () => { $('[data-quota]').innerHTML = UI.quotaHTML(); };

  // ---------- Live ----------
  OV.on((what) => {
    if (what === 'day') { paintDay(); paintTiles(); paintPerPR(); paintWork(); }
    if (what === 'behaviors') paintBehaviors();
    // A Rhythm change can start a waiting worker, so the work in motion repaints with it.
    if (what === 'manager') { paintMgr(); paintMotion(); }
    if (what === 'work') paintMotion();
    if (what === 'quota') paintQuota();
  });
  // Typical by now moves with the clock; the numbers hold their place.
  setInterval(() => { if (OV.day !== 0) return; paintDay(); paintQuota(); if (!tiles.matches(':hover') && !tiles.contains(document.activeElement)) paintTiles(); }, 60000);

  // A link from the review opens an element with its full reference; the year opens on a number first.
  const want = params.get('ref');
  if (want === 'ov.year' || want === 'ov.dist') open = 'prs-merged';
  paintDay(); paintMotion(); paintMgr(); paintTiles(); paintPerPR(); paintWork(); paintBehaviors(); paintQuota();
  window.poisePaintTerms?.(main);
  if (want) setTimeout(() => { const el = $(`[data-ref="${want}"]`); el?.scrollIntoView({ block: 'center' }); window.poiseOpenRef?.(el); }, 700);
})();
