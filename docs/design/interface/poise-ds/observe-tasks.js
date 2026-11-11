// Observe → Tasks: every task the chain carries, from its issue to its merge.
// One row per task with its phase rail, state and reason; opening one shows
// its timeline, newest first, read from the chain's journal.
(() => {
  const { $, $$, store, params, esc, clock, toast } = window.PoiseShell;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const T = window.POISE_TASKS;
  const list = $('[data-tk-list]'), detail = $('[data-tk-detail]');
  if (!list || !T) return;
  // The engine is the one Settings → Behaviors switches; with v1 there are no chains.
  const engine = (store.get('poise-settings-v1', {}).engine || {}).mode || 'v2';
  const off = params.get('engine') === 'v1' || engine === 'v1';
  let which = params.get('which') === 'attention' ? 'attention' : 'active', query = '', open = params.get('task') || null, page = 1;
  // A link from a notice or a diagnostic opens the timeline at its recorded event.
  const after = Number.isSafeInteger(+params.get('after')) && params.get('after') !== null ? +params.get('after') : null;
  // ?chains=failed: the read failed, so what was read stays, and nothing can be held or resumed.
  const failed = params.get('chains') === 'failed', draining = params.get('engine') === 'draining';
  const LEGACY = ['autonomio/poise#471', 'Acme/Limen#1141'];
  const KIND = { invocation: 'Run', event: 'Event', hold: 'Hold', uncertain: 'Not confirmed' };
  const scope = () => store.get('poise-current-filters', {}).org || '';
  const inWhich = (t) => (which === 'all' ? true : which === 'merged' ? !!t.merged : which === 'attention' ? T.attention(t) : !t.merged && !t.superseded);
  const shown = () => T.TASKS.filter((t) => (!scope() || t.repo.split('/')[0].toLowerCase() === scope().toLowerCase()) && inWhich(t) && (!query || `${t.repo}#${t.issue} ${t.pr ? `#${t.pr}` : ''} ${t.title} ${t.now}`.toLowerCase().includes(query)))
    .sort((a, b) => (which === 'attention' ? (b.advanceMin || 0) - (a.advanceMin || 0) : 0));
  function rowHTML(t) {
    return `<li><button class="tk-row${open === t.id ? ' is-open' : ''}" data-act="tk-open" data-id="${t.id}" aria-expanded="${open === t.id}" data-ref="tk.row"><span class="tk-t"><span class="t-mono">${esc(t.repo)}#${t.issue}${t.pr ? ` → #${t.pr}` : ''}</span>${esc(t.title)}</span><span class="tk-r">${T.railHTML(t)}</span><span class="tk-s"><span class="sc" data-state="${t.state}"></span><b>${term(`state.${t.state}`)}</b> ${esc(t.now)}${T.attention(t) && t.advanceMin != null ? ` <span class="tk-age" data-ref="tk.age">· no verified advance for ${T.age(t.advanceMin)}</span>` : ''}</span></button></li>`;
  }
  function detailHTML(t) {
    if (!t) return '<p class="t-gloss tk-empty">Choose a task to read its timeline.</p>';
    const control = failed && !t.merged && !t.superseded
      ? '<button class="btn-ghost" aria-disabled="true" data-why="Tasks could not be read, so nothing can be held or resumed until they are." data-ref="task.hold">Hold new invocations</button>'
      : t.superseded
        ? '<span class="t-gloss" data-ref="tk.history">Superseded: only its history remains.</span>'
      : t.merged
      ? '<span class="t-gloss" data-ref="tk.history">Merged: only its history remains; there is nothing to hold or resume.</span>'
      : t.state === 'needs-you' && t.hold
        ? `<button class="btn-ghost is-primary" data-act="tk-resume" data-id="${t.id}" data-ref="task.resume">Resume</button>`
        : `<button class="btn-ghost" data-act="tk-hold" data-id="${t.id}" data-ref="task.hold">${t.held ? 'Resume' : 'Hold new invocations'}</button>`;
    const rows = t.journal.slice(0, page * 20);
    return `<div class="tk-d-h"><h3>${esc(t.title)}</h3><p class="t-mono t-gloss">${esc(t.repo)}#${t.issue}${t.pr ? ` → #${t.pr}` : ''}${t.head ? ` · head ${esc(t.head)}` : ''} · driven by the behaviors</p></div>
      <div class="tk-d-rail">${T.railHTML(t)}</div>
      <p class="tk-d-s"><span class="st" data-state="${t.state}" data-ref="state"><span data-term="state.${t.state}">${term(`state.${t.state}`)}</span></span> ${esc(t.now)}${t.pending ? ' <span class="t-gloss">· the pre-merge review is still owed; nothing new can start after a merge, so it waits for the original evidence · next evidence check 21:40</span>' : ''}</p>
      ${t.hold ? `<p class="tk-hold" data-ref="side.hold">${esc(t.hold)}</p>` : ''}
      ${evidenceHTML(t)}
      <div class="tk-acts">${control}<a class="lnk" href="board.html?item=${encodeURIComponent(`${t.repo}#${t.pr || t.issue}`)}&amp;back=observe" data-ref="tk.board">See it on Board</a></div>
      <p class="t-micro">Timeline · newest first <span class="t-gloss">· observed ${clock()} · held still while you read it</span></p>
      <ol class="tk-tl" data-ref="side.timeline">${rows.map(([at, kind, text, ev], i) => `<li data-kind="${kind}"${after !== null && open === t.id && t.journal.length - i === after + 1 ? ' class="is-from" data-ref="tk.from"' : ''}><span class="t-mono">${esc(at)}</span><span><b>${KIND[kind] || 'Event'}</b> ${esc(text)}${ev ? `${/^run /.test(ev) && (window.PoiseObserve?.RUNS || []).some((r) => r.id.startsWith(ev.slice(4))) ? ` · <a class="lnk" href="observe.html?tab=behaviors&amp;call=${esc(ev.slice(4))}&amp;back=observe" data-ref="tk.run">${esc(ev)}</a>` : `<span class="t-gloss"> · ${esc(ev)}</span>`}` : ''}</span></li>`).join('')}</ol>
      ${t.journal.length > rows.length ? '<button class="btn-ghost" data-act="tk-more">More events</button>' : ''}`;
  }
  // What the chain knows beyond its state: how long since it last advanced, the gates on its
  // current head, what happens next, and how a superseded task was covered.
  function evidenceHTML(t) {
    const rows = [];
    if (t.advanceMin != null && !t.merged) rows.push(['Last verified advance', `${T.age(t.advanceMin)} ago${T.attention(t) ? ' · it needs attention' : ''}`]);
    if (t.gates?.length) rows.push(['Evidence on its head', t.gates.join(' · ')]);
    if (t.next) rows.push(['Next', `${t.next}${t.retryAt ? ` · ${t.retryAt}` : ''}`]);
    if (t.recheck) rows.push(['Evidence recheck', `${t.recheck}. A recheck never retries held work.`]);
    if (t.superseded) {
      const s = t.superseded, gh = (path) => `https://github.com/${esc(t.repo)}/${path}`;
      rows.push(['Covered by', `<a class="lnk" href="${gh(`pull/${s.by}`)}" target="_blank" rel="noopener">#${s.by}</a>, merged as ${esc(s.merge)} · <a class="lnk" href="${gh(`actions/runs/${s.failing}`)}" target="_blank" rel="noopener">the failing run</a> · <a class="lnk" href="${gh(`actions/runs/${s.recovery}`)}" target="_blank" rel="noopener">the recovery run</a>`, true]);
    }
    return rows.length ? `<dl class="tk-ev" data-ref="tk.evidence">${rows.map(([l, v, html]) => `<div><dt>${l}</dt><dd>${html ? v : esc(v)}</dd></div>`).join('')}</dl>` : '';
  }
  function statusHTML() {
    if (failed) return '<span class="tk-st is-warn" role="status" data-ref="tk.status">Tasks could not be refreshed: GitHub returned 502 reading the journal. Showing what was read at 19:39; Hold and Resume wait until a read succeeds.</span>';
    const mode = draining ? 'Draining: v1 finishes its runs before v2 takes new work' : 'v2 owns new work';
    return `<span class="tk-st" role="status" data-ref="tk.status">${mode} · 3 of 8 model runs in use, shared with other heavy work · read ${clock()}</span><details class="tk-legacy" data-ref="tk.legacy"><summary>${LEGACY.length} pull requests kept by v1 at cutover</summary><p class="t-gloss">v1 keeps reviewing these until they close. They are not tasks.</p><ul>${LEGACY.map((x) => `<li class="t-mono">${esc(x)}</li>`).join('')}</ul></details>`;
  }
  function paint() {
    if (off) {
      list.innerHTML = '';
      detail.innerHTML = '<div class="tk-off"><p><b>The chain is off.</b> v1 owns new work, so behaviors act one at a time and no task is carried from issue to merge.</p><a class="btn-ghost" href="settings.html?back=observe#behaviors" data-ref="tk.engine">Behavior engine, in Settings</a></div>';
      $('[data-tk-count]').textContent = '';
      $('[data-tk-note]').textContent = '';
      return;
    }
    const rows = shown();
    list.innerHTML = rows.map(rowHTML).join('') || '<li class="t-gloss tk-empty">No task matches.</li>';
    detail.innerHTML = detailHTML(T.byId(open));
    $('[data-tk-count]').textContent = `${rows.length} of ${T.TASKS.length} tasks`;
    $('[data-tk-note]').innerHTML = statusHTML();
    $$('[data-tk-which] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === which)));
    const needs = T.TASKS.filter(T.attention).length;
    $('[data-tk-which] [data-v="attention"]').textContent = needs ? `Needs attention ${needs}` : 'Needs attention';
    const active = T.TASKS.filter((t) => !t.merged).length;
    $('[data-tabn="tasks"]').textContent = active ? `${active}` : '';
    hydrateIcons(list); hydrateIcons(detail);
    window.poisePaintTerms?.(detail);
  }
  document.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-tk-which] button');
    if (seg) { which = seg.dataset.v; $$('[data-tk-which] button').forEach((b) => b.setAttribute('aria-pressed', String(b === seg))); paint(); return; }
    const b = e.target.closest('[data-act^="tk-"]');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const t = T.byId(b.dataset.id);
    if (b.dataset.act === 'tk-open') { open = open === t.id ? null : t.id; page = 1; paint(); $(`[data-act="tk-open"][data-id="${t.id}"]`)?.focus(); const u = new URL(location.href); if (open) u.searchParams.set('task', open); else u.searchParams.delete('task'); history.replaceState(null, '', u); }
    if (b.dataset.act === 'tk-more') { page += 1; paint(); }
    if (b.dataset.act === 'tk-resume' && t) { const r = t.resumes || { now: 'Resumed by you: back in the merge queue', toast: 'Resumed. It goes back into the merge queue; the journal records it.' }; Object.assign(t, { state: 'waiting', now: r.now, hold: null, resumes: null }); t.journal.unshift([clock(), 'event', 'Resumed by you', '']); paint(); toast(r.toast, 'waiting'); }
    if (b.dataset.act === 'tk-hold' && t) { t.held = !t.held; t.journal.unshift([clock(), t.held ? 'hold' : 'event', t.held ? 'Held by you: no new invocations' : 'Resumed by you', '']); paint(); toast(t.held ? 'Held. No new step starts; a run already going carries on. Stop it in Behaviors.' : 'Resumed. Its next step starts when it is due.', t.held ? 'waiting' : 'running'); }
  });
  document.addEventListener('poise:task', paint);
  $('[data-tk-search]')?.addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); paint(); });
  paint();
  if (open) $(`[data-act="tk-open"][data-id="${open}"]`)?.scrollIntoView({ block: 'nearest' });
  if (after !== null) $('.tk-tl .is-from')?.scrollIntoView({ block: 'center' });
})();
