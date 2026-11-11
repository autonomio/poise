// Observe: what happened, and why. Behaviors for every agent run, GitHub for the
// history of pull requests, issues and CI, Logging for Poise's own evidence. Each part holds still while you use
// it: arrivals wait, rows repaint in place, and every link opens what it names.
(() => {
  const { $, $$, store, params, esc, secs, clock, toast, lifeHTML, closeMenus } = window.PoiseShell;
  const D = window.PoiseObserve;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const cap = (s) => `<span class="sc" data-state="${s}"></span>`;
  const gh = (...p) => `https://github.com/${p.join('/')}`;
  const ext = (href, text, cls = 'lnk', ref = 'gh.link') => `<a class="${cls}" href="${href}" target="_blank" rel="noopener" data-ref="${ref}">${text}</a>`;
  // A chained issue's card is its pull request's, once it has one.
  const onBoard = (org, repo, n) => { const t = window.POISE_TASKS?.TASKS.find((x) => x.repo === `${org}/${repo}` && x.issue === n); return `board.html?item=${encodeURIComponent(`${org}/${repo}#${t?.pr || n}`)}&amp;back=observe`; };

  // ---------- The place: three parts, one address ----------
  const TABS = ['tasks', 'behaviors', 'github', 'logging'];
  // Links made before round 12 still say swarm and archive.
  const ALIAS = { swarm: 'behaviors', archive: 'github' };
  const GLOSS = {
    tasks: 'Every task the chain carries, issue to merge: its phase, what it waits for, and its timeline.',
    behaviors: 'Every agent run, live: what the behaviors run, and chat turns, editor chats and fixes.',
    github: 'Pull requests, issues and CI runs, newest first.',
    logging: 'Poise’s retained diagnostics: what failed or warned, with its evidence.'
  };
  const asked = ALIAS[params.get('tab')] || params.get('tab'), kept = ALIAS[store.get('poise-observe-tab', 'behaviors')] || store.get('poise-observe-tab', 'behaviors');
  let tab = TABS.includes(asked) ? asked : TABS.includes(kept) ? kept : 'behaviors';
  if (params.get('call') || params.get('pr')) tab = 'behaviors';
  if (params.get('event')) tab = 'logging';
  if (params.get('task')) tab = 'tasks';
  function show(next) {
    tab = next;
    store.set('poise-observe-tab', tab);
    $$('[role="tab"]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    $('[data-gloss]').textContent = GLOSS[tab];
    $('[data-scope]').hidden = tab === 'logging';
    const u = new URL(location.href);
    u.searchParams.set('tab', tab);
    if (tab !== 'tasks') u.searchParams.delete('task');
    history.replaceState(null, '', u);
    closePops();
  }
  $('.obv-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  $('.obv-tabs').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    show(next);
    $(`[data-tab="${next}"]`).focus();
  });

  // A route back to where you came from.
  const FROM = { overview: ['overview.html', 'Overview'], board: ['board.html', 'Board'], chat: ['chat.html', 'Chat'], editor: ['editor.html', 'Editor'], manager: ['manager.html', 'the Manager'], settings: ['settings.html#behaviors', 'Settings'] }[params.get('back')];
  if (FROM) { const b = $('[data-back]'); b.hidden = false; b.href = FROM[0]; b.innerHTML = `<i data-i="chev" class="sm"></i>Back to ${FROM[1]}`; hydrateIcons(b); }

  // The organization is the same choice as Board's.
  const orgStore = () => store.get('poise-current-filters', {});
  let org = orgStore().org || '';
  function paintOrg() {
    $('[data-org-label]').textContent = org || 'All orgs';
    $$('#org-menu [data-org]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.org === org)));
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#org-menu [data-org]');
    if (!b) return;
    org = b.dataset.org;
    store.set('poise-current-filters', { ...orgStore(), org });
    closeMenus();
    paintOrg();
    SW.paint(); AR.reset();
    document.dispatchEvent(new Event('poise:task'));
  });

  // ---------- Behaviors: every agent run (Swarm until round 12) ----------
  const SW = (() => {
    const runs = D.RUNS.map((r) => ({ ...r }));
    const expanded = new Set(), openGroups = new Set(), stopping = new Set(), replaying = new Set();
    const refused = new Map(), replayed = new Map();
    let query = '', armed = null, loadedAll = false, inside = false, focusMsg = '';
    const held = [];
    const body = $('[data-sw-rows]'), scroll = $('[data-sw-scroll]');
    const replayable = (r) => ['pr_review', 'pr_approve', 'issue_review'].includes(r.behavior) && r.repo && r.pr;
    const asked = new Set();   // revisions an issue review was already asked for
    const target = (r) => (r.repo ? `${r.org}/${r.repo}#${r.pr}` : r.session?.label || '');
    const visible = () => runs.filter((r) => (!org || r.org === org) && (!query || [r.model, r.behaviorLabel, r.behavior, target(r), r.state, term(`state.${r.state}`), r.outcome, r.note, r.error].some((f) => (f || '').toLowerCase().includes(query))));
    function progress(r) {
      const p = r.progress;
      if (!p) return { text: 'Progress unavailable for this run', warn: false };
      if (typeof p.provider === 'number' && secs() - p.provider > 60) return { text: `No provider update for ${D.rel(p.provider)}; last: ${p.phase.toLowerCase()}`, warn: true };
      return { text: `${p.phase} · ${D.rel(p.since)} in stage`, warn: false };
    }
    // How long a running agent run likely has left, from similar runs: the same
    // behavior and model in the last 30 days, five at least. Past the 90th
    // percentile it says so instead; chat turns and direct runs have none.
    function estimate(r) {
      if (!r.est || r.est.samples < 5 || r.state !== 'running') return null;
      const ran = secs() - r.started;
      if (ran > r.est.p90) return { text: `Longer than usual · similar runs took ${Math.round(r.est.median / 60)} min`, warn: true };
      return { text: `≈ ${Math.max(1, Math.round((r.est.median - ran) / 60))} min left`, warn: false };
    }
    function statusHTML(r) {
      if (r.state === 'running') {
        if (stopping.has(r.id)) return `${cap('running')}<span class="ow">Stopping…</span>`;
        const p = progress(r), e = estimate(r);
        return `${cap('running')}<span class="ow">${term('state.running')}</span><span class="note${p.warn ? ' is-warn' : ''}" data-progress>${esc(p.text)}</span>${e ? `<span class="note${e.warn ? ' is-warn' : ''}" data-est data-ref="bh.est">${esc(e.text)}</span>` : ''}`;
      }
      const word = r.outcome || term(`state.${r.state}`);
      const note = r.note || (r.error || '').split('\n')[0];
      return `${cap(r.state)}<span class="ow">${esc(word)}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}`;
    }
    function rowHTML(r, repeat = false) {
      const open = expanded.has(r.id), n = r.identical?.length || 0, gOpen = openGroups.has(r.id);
      const group = n && !repeat ? `<button class="grp-btn${gOpen ? ' is-open' : ''}" data-act="sw-group" aria-expanded="${gOpen}" aria-label="${gOpen ? 'Hide' : 'Show'} ${n} identical earlier ${n === 1 ? 'run' : 'runs'}, ${n + 1} in all" title="${gOpen ? 'Hide' : 'Show'} ${n} identical earlier ${n === 1 ? 'run' : 'runs'} (${n + 1} in all)" data-ref="bh.group">${n + 1}</button>` : '';
      const where = r.repo
        ? `<td class="c-org">${ext(gh(r.org), esc(r.org), 'sw-link', 'bh.org')}</td><td class="c-repo">${ext(gh(r.org, r.repo), esc(r.repo), 'sw-link', 'bh.repo')}<span class="dim"> </span>${ext(gh(r.org, r.repo, r.kind || 'pull', r.pr), `#${r.pr}`, 'sw-link is-num', 'bh.repo')}</td>`
        : `<td class="c-org" colspan="2"><a class="sw-session" href="${r.session.href}" data-ref="bh.session" title="${r.session.chat ? 'Open this conversation' : 'Open this document in Editor'}"><i data-i="${r.session.chat ? 'chat' : 'edit'}" class="sm"></i>${esc(r.session.label)}</a></td>`;
      const running = r.state === 'running';
      const isArmed = armed && armed.id === r.id && armed.until > Date.now();
      const stop = running ? (stopping.has(r.id) ? '<span class="dim">…</span>' : `<button class="btn-ghost sw-stop${isArmed ? ' is-armed' : ''}" data-act="sw-stop" aria-label="${isArmed ? 'Confirm stopping this run' : 'Stop this run'}" data-ref="bh.stop">${isArmed ? 'Sure?' : '<i data-i="stop" class="sm"></i>'}</button>`) : '<span class="dim">—</span>';
      const replay = replayable(r) && !repeat
        ? (replaying.has(r.id) ? '<span class="life" data-life="Accepted">Accepted</span>' : `<button class="ib" data-act="sw-replay" aria-label="${r.behavior === 'issue_review' ? 'Review this revision again' : 'Replay this run'}" title="${replayed.has(r.id) ? `Replayed at ${replayed.get(r.id)}; the new run is at the top` : r.behavior === 'issue_review' ? `Review revision ${r.revision || 'current'} again` : 'Replay this run'}" data-ref="bh.replay"><i data-i="replay" class="sm"></i></button>`)
        : '<span class="dim">—</span>';
      const more = r.response || r.error || r.progress || r.events?.length ? `<button class="ib chev${open ? ' is-open' : ''}" data-act="sw-detail" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} detail" title="${open ? 'Hide detail' : r.progress ? 'View activity' : r.error ? 'View error' : 'View response'}" data-ref="bh.detail"><i data-i="chev" class="sm"></i></button>` : '';
      const tr = `<tr class="sw-row${repeat ? ' is-repeat' : ''}${r.fresh ? ' is-fresh' : ''}" data-run="${r.id}">
        <td class="c-group">${group}</td>
        <td class="c-model" title="${esc(r.model)}" data-ref="bh.model">${esc(r.model)}</td>
        <td class="c-behavior" data-ref="bh.behavior">${esc(r.behaviorLabel)}</td>
        ${where}
        <td class="c-status" data-ref="bh.status"><span class="sw-st">${statusHTML(r)}${refused.has(r.id) ? `<span class="note is-warn">${esc(refused.get(r.id))}</span>` : ''}</span></td>
        <td class="c-started" data-ref="bh.started" data-started>${D.rel(r.started)}</td>
        <td class="c-elapsed" data-ref="bh.elapsed" data-elapsed>${running ? D.dur(secs() - r.started) : D.dur(r.elapsed)}</td>
        <td class="c-act">${replay}</td><td class="c-act">${stop}</td><td class="c-more">${more}</td></tr>`;
      return tr + (open ? detailHTML(r) : '');
    }
    function detailHTML(r) {
      const p = r.progress, live = r.state === 'running';
      const facts = p ? [live ? 'Worker heartbeat 3s ago' : 'Last worker heartbeat at its end', typeof p.provider === 'number' ? `Last provider event ${D.rel(p.provider)} ago` : live ? 'Last provider event 2s ago' : '', p.deadline ? (p.deadline > secs() ? `Stage deadline in ${Math.ceil((p.deadline - secs()) / 60)}m` : 'Stage deadline passed; waiting for the worker’s outcome') : ''].filter(Boolean).join(' · ') : '';
      const events = r.events?.length ? `<ol class="sw-events">${r.events.map(([t, m]) => `<li><time>${D.clockOf(t)}</time>${esc(m)}</li>`).join('')}</ol>` : '';
      const go = r.repo ? ext(gh(r.org, r.repo, r.kind || 'pull', r.pr), `Open ${r.org}/${r.repo}#${r.pr} ↗`) : `<a class="lnk" href="${r.session.href}">${r.session.chat ? 'Open the conversation' : 'Open the document'}</a>`;
      return `<tr class="sw-detail" data-detail-for="${r.id}"><td colspan="11"><div class="sw-detail-in">
        ${facts || events ? `<section class="sw-activity" data-ref="bh.activity"><h4 class="t-micro">Activity</h4>${facts ? `<p class="sw-facts">${esc(facts)}</p>` : ''}${events}</section>` : ''}
        ${p?.reasoning ? `<details class="sw-reasoning" data-ref="bh.reasoning"><summary>Provider reasoning</summary><pre class="sw-pre">${esc(p.reasoning)}</pre></details>` : ''}
        ${r.response ? `<section><h4 class="t-micro">Response</h4><pre class="sw-pre">${esc(r.response)}</pre></section>` : ''}
        ${r.error ? `<section><h4 class="t-micro">Error</h4><pre class="sw-pre is-error">${esc(r.error)}</pre></section>` : ''}
        <p class="sw-go">${go}${r.repo ? `<a class="lnk" href="${onBoard(r.org, r.repo, r.pr)}" data-ref="bh.board">See it on Board</a>` : ''}<span class="dim">Run ${r.id.slice(0, 12)}…</span></p></div></td></tr>`;
    }
    function paint() {
      const list = visible(), shown = loadedAll ? list : list.slice(0, 12);
      body.innerHTML = shown.map((r) => rowHTML(r) + (openGroups.has(r.id) ? r.identical.map((x) => rowHTML({ ...r, ...x, identical: null }, true)).join('') : '')).join('');
      hydrateIcons(body);
      window.poisePaintTerms?.(body);
      $('[data-sw-empty]').hidden = list.length > 0;
      const total = runs.filter((r) => !org || r.org === org).length;
      $('[data-sw-count]').textContent = list.length === total ? `${total} runs` : `${list.length} of ${total} runs`;
      $('[data-sw-history]').innerHTML = loadedAll
        ? `${focusMsg ? `<span class="is-warn">${esc(focusMsg)}</span>` : `Newest first, 200 a page · page 1 of 25, of 4,812 runs in all · search reads every run · running ones refresh every 15 seconds <span class="pager" data-ref="bh.pager"><button class="btn-ghost" data-act="sw-page" data-dir="-1" aria-disabled="true">Newer</button><button class="btn-ghost" data-act="sw-page" data-dir="1">Older</button></span>`}`
        : `<span class="spin"></span>Showing the 12 newest of ${list.length} runs while the first page loads.`;
      const running = runs.filter((r) => r.state === 'running').length;
      $('[data-tabn="behaviors"]').innerHTML = running ? `${cap('running')}${running} running` : '';
      const q = D.QUARANTINED;
      $('[data-sw-quarantine]').innerHTML = q.length ? `<details class="obv-q"><summary><span class="sdot is-warn"></span>${q.length} unreadable ${q.length === 1 ? 'record' : 'records'} kept apart. Every other run keeps updating.</summary>${q.map((x) => `<p>Reported target: ${esc(x.target)} · Behavior: ${esc(x.behavior)} · Call: ${esc(x.call)} · Log index: ${x.index} · ${esc(x.error)}</p>`).join('')}</details>` : '';
      paintHeld();
    }
    function paintHeld() { const el = $('[data-sw-held]'); el.hidden = !held.length; el.innerHTML = `${held.length} new ${held.length === 1 ? 'run' : 'runs'} · <button class="lnk" data-act="sw-release">Show now</button>`; }
    function release() { if (!held.length) return; held.splice(0).forEach((r) => { r.fresh = true; runs.unshift(r); setTimeout(() => { r.fresh = false; }, 2400); }); paint(); }
    // Arrivals wait while the pointer or the focus is in the table.
    scroll.addEventListener('pointerenter', () => { inside = true; });
    scroll.addEventListener('pointerleave', () => { inside = scroll.contains(document.activeElement); if (!inside) setTimeout(release, 400); });
    scroll.addEventListener('focusin', () => { inside = true; });
    scroll.addEventListener('focusout', (e) => { if (!scroll.contains(e.relatedTarget) && !scroll.matches(':hover')) { inside = false; setTimeout(release, 400); } });
    function arrive(r) { if (inside) { held.push(r); paintHeld(); } else { held.push(r); release(); } }
    const find = (id) => runs.find((r) => r.id === id || (id.length >= 4 && r.id.startsWith(id))) || runs.flatMap((r) => (r.identical || []).map((x) => ({ ...r, ...x, parent: r.id }))).find((r) => r.id === id);
    function repaintRow(id) {
      const tr = $(`[data-run="${id}"]`, body);
      if (!tr) return paint();
      const r = runs.find((x) => x.id === id);
      const t = document.createElement('tbody');
      t.innerHTML = rowHTML(r);
      hydrateIcons(t);
      const det = $(`[data-detail-for="${id}"]`, body);
      det?.remove();
      tr.replaceWith(...t.children);
    }
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-run]')?.dataset.run, r = runs.find((x) => x.id === id);
      if (b.dataset.act === 'sw-group') { if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id); paint(); $(`[data-run="${id}"] [data-act="sw-group"]`, body)?.focus(); }
      if (b.dataset.act === 'sw-detail') {
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        if (r) repaintRow(id); else paint();
        $(`[data-run="${id}"] [data-act="sw-detail"]`, body)?.focus();
        return;
      }
      // Stop asks once more, for four seconds; a second press stops it.
      if (b.dataset.act === 'sw-stop' && r) {
        if (!(armed && armed.id === id && armed.until > Date.now())) {
          armed = { id, until: Date.now() + 4000 };
          repaintRow(id);
          $(`[data-run="${id}"] [data-act="sw-stop"]`, body)?.focus();
          setTimeout(() => { if (armed?.id === id && armed.until <= Date.now()) { armed = null; if (r.state === 'running') repaintRow(id); } }, 4050);
          return;
        }
        armed = null;
        stopping.add(id);
        repaintRow(id);
        setTimeout(() => {
          stopping.delete(id);
          Object.assign(r, { state: 'idle', outcome: 'Stopped', note: 'Stopped by you', elapsed: secs() - r.started });
          r.events = [...(r.events || []), [secs(), 'Stopped by you']];
          repaintRow(id);
          // A person's Stop holds the chain the run belongs to, with no silent resume.
          const t = r.task && window.POISE_TASKS?.byId(r.task);
          if (t) {
            Object.assign(t, { state: 'needs-you', now: 'Held: you stopped its run', since: clock(), hold: `You stopped ${r.behaviorLabel} on ${target(r)}, so the chain waits for your decision. Resume starts that step again.`, resumes: { now: 'Resumed by you: the step starts again', toast: 'Resumed. The step starts again; the journal records it.' } });
            t.journal.unshift([clock(), 'hold', 'Held: you stopped its run', '']);
            document.dispatchEvent(new CustomEvent('poise:task'));
          }
          toast(`Stopped: ${r.behaviorLabel} on ${target(r)}. What it already posted stays.${t ? ' Its chain is held until you resume it.' : ''}`, 'idle');
        }, 900);
      }
      // Replay runs the same behavior again; a refusal says why on the row.
      if (b.dataset.act === 'sw-replay' && r) {
        replaying.add(id);
        refused.delete(id);
        repaintRow(id);
        setTimeout(() => {
          replaying.delete(id);
          const done = runs.some((x) => x.repo === r.repo && x.pr === r.pr && x.behavior === 'pr_approve' && x.outcome === 'Approved');
          if (r.noaccess) { refused.set(id, `Not replayed: bit-mis cannot read ${r.org}/${r.repo}. Invite it, or resend its invitation, then replay.`); repaintRow(id); return; }
          // An issue review is asked for one revision: the same revision twice starts nothing.
          if (r.behavior === 'issue_review') {
            const rev = r.revision || 'current';
            if (asked.has(`${target(r)}@${rev}`)) { refused.set(id, `Already asked for revision ${rev}; nothing new starts. Edit the issue to review a new revision.`); repaintRow(id); return; }
            asked.add(`${target(r)}@${rev}`);
          }
          if (r.behavior === 'pr_approve' && done) {
            refused.set(id, `Refused: ${target(r)} is already approved by bit-mis.`);
            repaintRow(id);
            return;
          }
          const now = secs();
          replayed.set(id, D.clockOf(now).slice(0, 5));
          repaintRow(id);
          const copy = { ...r, id: Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32), state: 'running', outcome: null, note: null, error: null, response: null, elapsed: null, identical: null, started: now,
            progress: { phase: 'Checking out', since: now, heartbeat: 'live', provider: 'live' }, events: [[now, 'Replayed by you from Observe']] };
          arrive(copy);
          toast(r.behavior === 'issue_review' ? `Asked for a fresh review of ${target(r)} at revision ${r.revision || 'current'}. Its comments will name that revision.` : `Replayed: a new run of ${r.behaviorLabel} on ${target(r)} started${inside ? '; it is waiting at the top' : ''}.`, 'running');
        }, 700);
      }
    });
    $('[data-sw-held]').addEventListener('click', (e) => { if (e.target.closest('[data-act="sw-release"]')) release(); });
    $('[data-sw-history]').addEventListener('click', (e) => { const b = e.target.closest('[data-act="sw-page"]'); if (!b || b.matches('[aria-disabled="true"]')) return; toast(`${b.dataset.dir === '1' ? 'Older' : 'Newer'}: in Poise this reads the next 200 runs from the server, and the totals stay exact.`); });
    let deb = 0;
    $('[data-sw-search]').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { query = e.target.value.trim().toLowerCase(); paint(); }, 90); });
    // Times count up every five seconds, in place; nothing else moves.
    setInterval(() => {
      if (tab !== 'behaviors') return;
      $$('[data-run]', body).forEach((tr) => {
        const r = find(tr.dataset.run);
        if (!r) return;
        const s = $('[data-started]', tr), el = $('[data-elapsed]', tr), p = $('[data-progress]', tr);
        if (s) s.textContent = D.rel(r.started);
        if (el && r.state === 'running') el.textContent = D.dur(secs() - r.started);
        if (p && r.state === 'running' && !stopping.has(r.id)) { const x = progress(r); p.textContent = x.text; p.classList.toggle('is-warn', x.warn); }
        const e = $('[data-est]', tr), x = estimate(r);
        if (e && x) { e.textContent = x.text; e.classList.toggle('is-warn', x.warn); }
      });
    }, 5000);
    // A link from a notice, Behaviors or Logging opens the run it names.
    function focus({ call, pr }) {
      let r = call ? find(call) : null;
      if (!r && pr) r = runs.find((x) => target(x) === pr);
      focusMsg = '';
      if (!r) { focusMsg = `No run found for ${call ? `call ${call.slice(0, 12)}…` : pr}.`; paint(); return; }
      query = ''; $('[data-sw-search]').value = '';
      if (r.org && org && r.org !== org) { org = ''; paintOrg(); }
      if (r.parent) openGroups.add(r.parent);
      expanded.add(r.id);
      loadedAll = true;
      paint();
      const tr = $(`[data-run="${r.id}"]`, body);
      tr?.scrollIntoView({ block: 'center' });
      tr?.classList.add('is-focus');
      setTimeout(() => tr?.classList.remove('is-focus'), 1600);
      $('[data-act="sw-detail"]', tr)?.focus({ preventScroll: true });
    }
    // The newest come first; the rest of the history follows.
    setTimeout(() => { if (!loadedAll) { loadedAll = true; paint(); } }, 1400);
    setTimeout(() => { const r = { ...D.LATER_RUN }; r.started = secs(); r.progress = { ...r.progress, since: secs() }; r.events = [[secs(), 'Started for autonomio/poise#488, opened by Muse']]; arrive(r); }, 20000);
    return { paint, focus, expandFirst: () => { expanded.add(runs[0].id); paint(); } };
  })();

  // ---------- GitHub: pull requests, issues and CI (Archive until round 12) ----------
  const AR = (() => {
    const KEY = 'poise-observe-github';
    const F = Object.assign({ types: ['action'], ci: 'failed', status: 'all', time: 'all' }, store.get(KEY, {}));
    let query = '', limit = 25, loading = false;
    const reviewing = new Map(), reviewed = new Set(store.get('poise-observe-reviewed', []));
    // The whole history: what is recent, then the older pages it reads as you scroll.
    const ALL = [...D.ARCHIVE, ...['pr', 'issue', 'action'].flatMap((t) => D.olderRows(t, 0, D.ARCHIVE_TOTAL[t] - D.ARCHIVE.filter((x) => x.type === t).length))];
    // Board's issues and pull requests are here too, under the same titles, so a link from a card always finds its row.
    const byKey = new Map(ALL.map((x) => [`${x.type}:${x.org}/${x.repo}#${x.n}`, x]));
    const add = (type, full, n, title, state, minutes) => {
      const [o, r] = full.split('/'), key = `${type}:${o}/${r}#${n}`, had = byKey.get(key);
      if (had) { had.title = title; return; }
      const x = { type, org: o, repo: r, n, title, state, updated: secs() - minutes * 60, author: 'mikkokotila', owner: null };
      byKey.set(key, x);
      ALL.push(x);
    };
    (window.POISE_BOARD?.ITEMS || []).forEach(([lane, repo, num, title, state, , , ago]) => add(lane, repo, num, title, state !== 'done' ? 'open' : lane === 'pr' ? 'merged' : 'closed', ago));
    (window.POISE_TASKS?.TASKS || []).forEach((t) => { add('issue', t.repo, t.issue, t.title, t.merged ? 'closed' : 'open', 30); if (t.pr) add('pr', t.repo, t.pr, t.title, t.merged ? 'merged' : 'open', 10); });
    const body = $('[data-ar-rows]'), scroll = $('[data-ar-scroll]');
    const today = D.at('00:00'), weekStart = D.at('00:00', 0, -4);
    const failed = (s) => s === 'failure' || s === 'timed_out';
    function matches(x) {
      if (!F.types.includes(x.type)) return false;
      if (org && x.org !== org) return false;
      if (x.type === 'action' ? F.ci === 'failed' && !failed(x.state) : F.status === 'open' && x.state !== 'open') return false;
      if (F.time === 'today' && x.updated < today) return false;
      if (F.time === 'yesterday' && (x.updated < today - 86400 || x.updated >= today)) return false;
      if (F.time === 'week' && x.updated < weekStart) return false;
      return !query || [x.title, x.org, x.repo, `#${x.n}`, String(x.n), x.branch, x.author].some((f) => (f || '').toLowerCase().includes(query));
    }
    const STATE = { open: ['', 'Open'], merged: ['done', 'Merged'], closed: ['idle', 'Closed'], failure: ['failed', 'Failed'], timed_out: ['failed', 'Timed out'], success: ['done', 'Done'], in_progress: ['running', 'Running'], queued: ['waiting', 'Waiting'], cancelled: ['idle', 'Cancelled'] };
    const avatar = (login, title) => (login ? `<span class="av${/bot$|\[bot\]|^bit-mis$/.test(login) ? ' is-bot' : ''}" title="${esc(title || login)}">${esc(login.slice(0, 2))}</span><span class="av-n">${esc(login)}</span>` : '<span class="dim" title="No assignee">—</span>');
    function reviewHTML(x) {
      if (x.type !== 'pr') return '';
      const url = gh(x.org, x.repo, 'pull', x.n);
      if (x.state !== 'open') return `<button class="btn-ghost" disabled title="This pull request is ${x.state}: nothing to review" data-ref="gh.review">Review</button>`;
      const st = reviewing.get(url);
      if (st) return `<span class="life" data-life="${st[0]}">${lifeHTML(st[0], st[1], true)}</span>`;
      return `<button class="btn-ghost" data-act="ar-review" title="${reviewed.has(url) ? 'Reviewed; run it again' : 'Run a consensus review'}" data-ref="gh.review">${reviewed.has(url) ? 'Reviewed · again' : 'Review'}</button>`;
    }
    function rowHTML(x) {
      const [s, w] = STATE[x.state] || ['', x.state];
      const kind = x.type === 'pr' ? 'PR' : x.type === 'issue' ? 'Issue' : 'CI';
      const href = x.type === 'action' ? gh(x.org, x.repo, 'actions', 'runs', x.n) : gh(x.org, x.repo, x.type === 'pr' ? 'pull' : 'issues', x.n);
      return `<tr data-ar="${x.type}:${x.org}/${x.repo}#${x.n}">
        <td class="c-kind"><span class="kind is-${x.type}" data-ref="gh.kind">${kind}</span></td>
        <td class="c-title" data-ref="gh.title">${ext(href, `${esc(x.title)}${x.type === 'action' ? '' : `<span class="dim"> #${x.n}</span>`}`, 'ar-title')}</td>
        <td class="c-author" data-ref="gh.author">${avatar(x.author)}</td>
        <td class="c-org">${ext(gh(x.org), esc(x.org), 'sw-link')}</td>
        <td class="c-repo">${ext(gh(x.org, x.repo), esc(x.repo), 'sw-link')}</td>
        <td class="c-owner" data-ref="gh.owner">${x.type === 'action' ? `<span class="t-mono br" title="${esc(x.event || '')}">${esc(x.branch || '—')}</span>` : avatar(x.owner, x.owner ? `Assigned to ${x.owner}` : '')}</td>
        <td class="c-state" data-ref="gh.state">${s ? cap(s) : '<span class="sc-open"></span>'}<span class="ow">${w}</span></td>
        <td class="c-updated" data-ref="gh.updated">${D.rel(x.updated)}</td>
        <td class="c-act">${reviewHTML(x)}${x.type !== 'action' ? `<a class="ib" href="${onBoard(x.org, x.repo, x.n)}" aria-label="See it on Board" data-ref="gh.board"><i data-i="card" class="sm"></i></a>` : ''}</td></tr>`;
    }
    function paint() {
      const list = ALL.filter(matches).sort((a, b) => b.updated - a.updated);
      const shown = list.slice(0, limit);
      body.innerHTML = shown.map(rowHTML).join('');
      hydrateIcons(body);
      window.poisePaintTerms?.(body);
      $('[data-ar-empty]').hidden = list.length > 0;
      $('[data-ar-count]').textContent = list.length ? `${shown.length} of ${list.length.toLocaleString('en-US')}` : '';
      $('[data-ar-more]').innerHTML = shown.length < list.length ? (loading ? '<span class="spin"></span>Reading the next page…' : `${list.length - shown.length} older · they load as you scroll`) : list.length ? 'The whole history is here.' : '';
      // A read that failed keeps what was read and says so.
      const err = $('[data-ar-error]');
      err.hidden = !!org && org !== 'northwind';
      err.innerHTML = '<span class="sdot is-warn"></span>Some of the history could not be read: GitHub returned 502 for northwind. What was read is shown; Poise tries again on its own.';
      $$('[data-ar-type] button').forEach((b) => b.setAttribute('aria-pressed', String(F.types.includes(b.dataset.v))));
      $$('[data-ar-ci] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F.ci)));
      $$('[data-ar-status] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F.status)));
      $$('[data-ar-time] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F.time)));
      $('[data-ar-ci]').hidden = !F.types.includes('action');
      $('[data-ar-status]').hidden = !F.types.some((t) => t !== 'action');
      $('[data-ar-ownerh]').textContent = F.types.includes('action') ? (F.types.length > 1 ? 'Owner / Branch' : 'Branch') : 'Owner';
      const fails = D.ARCHIVE.filter((x) => x.type === 'action' && failed(x.state) && (!org || x.org === org)).length;
      $('[data-tabn="github"]').innerHTML = fails ? `${cap('failed')}${fails} failed CI` : '';
    }
    function reset() { limit = 25; scroll.scrollTop = 0; paint(); }
    const save = () => store.set(KEY, F);
    $('[data-panel="github"] .obv-bar').addEventListener('click', (e) => {
      const b = e.target.closest('.seg button');
      if (!b) return;
      const g = b.closest('.seg');
      if (g.matches('[data-ar-type]')) {
        const on = F.types.includes(b.dataset.v);
        if (on && F.types.length === 1) { toast('At least one kind stays shown.'); return; }
        F.types = on ? F.types.filter((t) => t !== b.dataset.v) : [...F.types, b.dataset.v];
      }
      if (g.matches('[data-ar-ci]')) F.ci = b.dataset.v;
      if (g.matches('[data-ar-status]')) F.status = b.dataset.v;
      if (g.matches('[data-ar-time]')) F.time = b.dataset.v;
      save();
      reset();
    });
    let deb = 0;
    $('[data-ar-search]').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { query = e.target.value.trim().toLowerCase(); reset(); }, 150); });
    // Older history loads a page at a time as the end comes into view.
    new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || loading || tab !== 'github') return;
      const total = ALL.filter(matches).length;
      if (limit >= total) return;
      loading = true;
      paint();
      setTimeout(() => { loading = false; limit += 25; paint(); }, 450);
    }, { root: scroll, rootMargin: '0px 0px 300px 0px' }).observe($('[data-ar-more]'));
    // A consensus review: Accepted, Executing, then posted on the pull request.
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="ar-review"]');
      if (!b) return;
      const key = b.closest('[data-ar]').dataset.ar, x = ALL.find((y) => `${y.type}:${y.org}/${y.repo}#${y.n}` === key), url = gh(x.org, x.repo, 'pull', x.n);
      reviewing.set(url, ['Accepted', '']);
      paint();
      setTimeout(() => { reviewing.set(url, ['Executing', 'three models review it']); paint(); }, 500);
      setTimeout(() => {
        reviewing.delete(url);
        reviewed.add(url);
        store.set('poise-observe-reviewed', [...reviewed]);
        paint();
        toast(`Review posted on ${x.org}/${x.repo}#${x.n}.`, 'done');
      }, 2600);
    });
    // A link opens the row it names, clearing a filter that hides it.
    function focusItem(item) {
      const x = ALL.find((r) => r.type !== 'action' && `${r.org}/${r.repo}#${r.n}` === item);
      if (!x) { toast(`${item} is not in the history that has been read yet.`, 'waiting'); return; }
      if (!F.types.includes(x.type)) F.types.push(x.type);
      Object.assign(F, { status: 'all', time: 'all' });
      query = ''; $('[data-ar-search]').value = '';
      if (org && x.org !== org) { org = ''; paintOrg(); SW.paint(); }
      limit = Math.max(limit, ALL.filter(matches).sort((a, b) => b.updated - a.updated).indexOf(x) + 1);
      paint();
      const tr = $(`[data-ar="${x.type}:${x.org}/${x.repo}#${x.n}"]`, body);
      tr?.scrollIntoView({ block: 'center' });
      tr?.classList.add('is-focus');
      setTimeout(() => tr?.classList.remove('is-focus'), 1600);
    }
    return { paint, reset, focusItem, showStatus: () => { if (!F.types.includes('pr')) { F.types.push('pr'); paint(); } } };
  })();

  // ---------- Logging: Poise's own diagnostics ----------
  const LG = (() => {
    const KEY = 'poise-observe-logging';
    const EXACT = [['component', 'Component'], ['workspace', 'Workspace'], ['account', 'Account'], ['repository', 'Repository'], ['callId', 'Call ID'], ['correlationId', 'Correlation ID'], ['incidentId', 'Incident ID']];
    const COLUMNS = [['time', 'Time'], ['impact', 'Work impact'], ['severity', 'Severity'], ['source', 'Source'], ...EXACT, ['target', 'Target'], ['message', 'Message'], ['occurrences', 'Count']];
    const OPTIONAL = ['workspace', 'account', 'callId', 'correlationId', 'incidentId'];
    const LEVELS = ['critical', 'error', 'warning'], SOURCES = ['poise', 'caller', 'gateway', 'docker', 'kernel', 'ingress', 'collection'];
    const RANGES = [['all', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['custom', 'Custom interval']];
    const defaults = () => ({ columns: ['time', 'severity', 'source', 'component', 'repository', 'target', 'message', 'occurrences'], severities: [...LEVELS], time: 'all', from: '', to: '', source: '', search: '', scope: 'workspace', ...Object.fromEntries(EXACT.map(([k]) => [k, ''])) });
    let P = { ...defaults(), ...store.get(KEY, {}) };
    const events = D.EVENTS.map((x) => ({ ...x }));
    const expanded = new Set(), related = new Map();
    let page = 0, snap = secs(), pending = [], linked = null, linkFail = null, popFor = null;
    const body = $('[data-lg-rows]'), scroll = $('[data-lg-scroll]');
    const save = () => store.set(KEY, P);
    const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const today = D.at('00:00'), weekStart = D.at('00:00', 0, -4);
    const parse = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v || ''); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); return Math.round((d - new Date(2026, 9, 23)) / 1000); };
    function matches(x) {
      const t = x.eventTime ?? x.ingested;
      if (!P.severities.includes(x.severity)) return false;
      if (P.source && x.source !== P.source) return false;
      if (P.time === 'today' && t < today) return false;
      if (P.time === 'yesterday' && (t < today - 86400 || t >= today)) return false;
      if (P.time === 'week' && t < weekStart) return false;
      if (P.time === 'custom') { const f = parse(P.from), to = parse(P.to); if (f != null && t < f) return false; if (to != null && t >= to) return false; }
      for (const [k] of EXACT) if (P[k] && !String(x[k] || '').toLowerCase().includes(P[k].toLowerCase())) return false;
      return !P.search || [x.message, x.target, x.component, x.repository, x.stderr, ...(x.cause || [])].some((f) => (f || '').toLowerCase().includes(P.search.toLowerCase()));
    }
    const list = () => events.filter(matches);
    // Work impact is a base column, so a saved set from before it still shows it.
    const cols = () => { const c = COLUMNS.filter(([k]) => k === 'impact' || P.columns.includes(k) || (OPTIONAL.includes(k) && P[k])); return c; };
    const filtered = (k) => (k === 'severity' ? P.severities.length !== LEVELS.length : k === 'time' ? P.time !== 'all' : k === 'source' ? !!P.source : EXACT.some(([n]) => n === k) && !!P[k]);
    function head() {
      return `<tr>${cols().map(([k, l]) => {
        const can = ['time', 'severity', 'source', ...EXACT.map(([n]) => n)].includes(k);
        return `<th class="lg-c-${k}">${can ? `<button class="lg-colbtn${filtered(k) ? ' is-on' : ''}" data-filter-col="${k}" aria-label="Filter ${l}${filtered(k) ? ', on' : ''}" aria-expanded="${popFor === k}" data-ref="lg.filter"><span class="t-micro">${l}</span><i data-i="down" class="sm"></i></button>` : `<span class="t-micro">${l}</span>`}</th>`;
      }).join('')}<th class="lg-c-more"><span class="sr">Evidence</span></th></tr>`;
    }
    const sev = (s) => `<span class="sev is-${s}" data-ref="lg.severity">${label(s)}</span>`;
    function cell(x, k) {
      if (k === 'time') return `<td class="lg-c-time" data-ref="lg.time"><time>${D.stamp(x.eventTime ?? x.ingested)}</time>${x.eventTime == null ? '<span class="note">Ingested</span>' : ''}</td>`;
      if (k === 'impact') { const w = x.impact, s = w ? [w.impact, w.target, w.stage].join(' · ') : 'unknown'; return `<td class="lg-c-impact${w ? ` is-${w.impact}` : ' dim'}" title="${esc(s)}" data-ref="lg.impact">${esc(s)}</td>`; }
      if (k === 'severity') return `<td>${sev(x.severity)}</td>`;
      if (k === 'source') return `<td data-ref="lg.source">${esc(x.source)}</td>`;
      if (k === 'occurrences') return `<td class="num" title="Retained occurrences in this incident">${x.occurrences.toLocaleString('en-US')}</td>`;
      const v = x[k] || '—';
      return `<td class="lg-c-${k}${k.endsWith('Id') ? ' t-mono' : ''}" title="${esc(v)}">${esc(k.endsWith('Id') && v.length > 20 ? `${v.slice(0, 18)}…` : v)}</td>`;
    }
    const field = (l, v) => `<div><dt>${l}</dt><dd>${v == null || v === '' ? '<span class="dim">Not recorded</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`;
    const pre = (l, v) => `<section class="lg-ev"><h4 class="t-micro">${l}</h4><pre class="sw-pre${l === 'Message' ? '' : ' is-quiet'}">${v == null || v === '' ? 'Not recorded' : esc(v)}</pre></section>`;
    // What the chain's journal verifies about the work this diagnostic touched, at this snapshot.
    function impactHTML(x) {
      const w = x.impact;
      if (!w) return '<section class="lg-ev" data-ref="lg.workimpact"><h4 class="t-micro">Work impact</h4><p class="note">Unknown: no managed chain step matches this evidence.</p></section>';
      return `<section class="lg-ev" data-ref="lg.workimpact"><h4 class="t-micro">Work impact</h4><dl class="lg-facts">${field('Current impact', w.impact)}${field('Work stage', w.stage)}${field('Work target', w.target)}${field('Last verified progress', w.progress)}${field('Next retry', w.retry)}${field('Next action', w.next)}${field('Matched invocation', w.invocation)}${w.recovered ? field('Matched failure', 'Recovered: verified progress followed it') : ''}</dl><a class="btn-ghost" href="observe.html?tab=tasks&amp;task=${w.task}&amp;after=${w.after}&amp;back=observe">Open its task at this step</a></section>`;
    }
    function detail(x) {
      const links = [x.callId ? `<button class="btn-ghost" data-act="lg-call" data-call="${x.callId}">Open the run in Behaviors</button>` : '', x.pr ? ext(x.pr, 'Open the pull request ↗', 'btn-ghost') : '', x.settings ? `<a class="btn-ghost" href="settings.html?back=observe#${x.settings}">Open Settings</a>` : ''].filter(Boolean).join('');
      const r = related.get(x.id);
      const rel = r ? (() => {
        const all = events.filter((y) => y.id !== x.id && (r.kind === 'correlation' ? y.correlationId === x.correlationId : y.incidentId === x.incidentId));
        const slice = all.slice(r.page * 20, r.page * 20 + 20);
        return `<p class="note">${all.length} matching retained ${all.length === 1 ? 'event' : 'events'} · the same ${r.kind === 'correlation' ? 'correlation' : 'incident'}, within the severities and interval you chose</p>${slice.length ? `<ul class="lg-related">${slice.map((y) => `<li><button class="lnk" data-act="lg-open" data-ev="${y.id}">${D.stamp(y.eventTime ?? y.ingested)} · ${esc(y.message)}</button></li>`).join('')}</ul>` : ''}${all.length > 20 ? `<div class="seg"><button data-act="lg-rel-prev" ${r.page ? '' : 'disabled'}>Previous</button><button data-act="lg-rel-next" ${(r.page + 1) * 20 < all.length ? '' : 'disabled'}>Next 20</button></div>` : ''}`;
      })() : '';
      return `<tr class="sw-detail" data-lg-detail="${x.id}"><td colspan="${cols().length + 1}"><div class="sw-detail-in lg-detail">
        ${x.truncated ? '<p class="note is-warn">Evidence is truncated; what was left out is not kept.</p>' : ''}
        <p class="lg-links" data-ref="lg.links">${links || '<span class="note">Nothing recorded to go to.</span>'}</p>
        <dl class="lg-facts" data-ref="lg.facts">${field('Component', x.component)}${field('Operation', x.operation)}${field('Phase', x.phase)}${field('Target', x.target)}${field('Source severity', x.severity)}${field('Workspace', x.workspace)}${field('Instance', x.instance)}${field('Container', x.container)}${field('Release', x.release)}${field('Source time', x.eventTime == null ? null : D.stamp(x.eventTime))}${field('Ingestion time', D.stamp(x.ingested))}${field('Account', x.account)}${field('Repository', x.repository)}${field('Call ID', x.callId)}${field('Correlation ID', x.correlationId)}${field('Request ID', x.requestId)}${field('Event ID', x.id)}${field('Incident ID', x.incidentId)}${field('Exit code', x.exitCode)}${field('Signal', x.signal)}${field('Errno', x.errno)}${field('Timeout (ms)', x.timeoutMs)}</dl>
        ${impactHTML(x)}
        ${pre('Message', x.message)}${x.cause?.length ? pre('Cause chain', x.cause.join('\nCaused by: ')) : ''}${x.stderr ? pre('Stderr · kept with secrets removed', x.stderr) : ''}${x.stack ? pre('Stack', x.stack) : ''}${Object.keys(x.context || {}).length ? pre('Context · as recorded', JSON.stringify(x.context, null, 2)) : ''}${Object.keys(x.resources || {}).length ? pre('Resource facts · recorded units and measurement time', JSON.stringify(x.resources, null, 2)) : ''}
        <section class="lg-relbox" data-ref="lg.related"><h4 class="t-micro">Related diagnostics</h4><div class="seg"><button data-act="lg-incident" aria-pressed="${r?.kind === 'incident'}">${r?.kind === 'incident' ? 'Refresh incident' : 'Show incident'}</button>${x.correlationId ? `<button data-act="lg-corr" aria-pressed="${r?.kind === 'correlation'}">Show correlation</button>` : ''}</div>${rel}</section>
      </div></td></tr>`;
    }
    function paint() {
      const all = list(), from = page * 50, rows = all.slice(from, from + 50);
      $('[data-lg-head]').innerHTML = head();
      hydrateIcons($('[data-lg-head]'));
      body.innerHTML = rows.map((x) => `<tr class="lg-row${linked === x.id ? ' is-linked' : ''}" data-ev="${x.id}" data-ref="lg.row">${cols().map(([k]) => cell(x, k)).join('')}<td class="lg-c-more"><button class="ib chev${expanded.has(x.id) ? ' is-open' : ''}" data-act="lg-expand" aria-expanded="${expanded.has(x.id)}" aria-label="Show the evidence" data-ref="lg.detail"><i data-i="chev" class="sm"></i></button></td></tr>${expanded.has(x.id) ? detail(x) : ''}`).join('');
      hydrateIcons(body);
      $('[data-lg-empty]').hidden = all.length > 0;
      $('[data-lg-count]').textContent = all.length.toLocaleString('en-US');
      $('[data-lg-page]').textContent = all.length ? `${from + 1}–${from + rows.length} of ${all.length.toLocaleString('en-US')}` : '';
      $('[data-act="lg-prev"]').disabled = page === 0;
      $('[data-act="lg-next"]').disabled = from + 50 >= all.length;
      $('[data-lg-status]').textContent = `${all.length.toLocaleString('en-US')} matching retained events${P.severities.length ? '' : ' · No severities chosen'} · Snapshot read ${D.stamp(snap)}, in Europe/Helsinki`;
      const n = $('[data-lg-new]');
      n.hidden = !pending.length || page !== 0;
      $('button', n).textContent = `${pending.length} new ${pending.length === 1 ? 'diagnostic' : 'diagnostics'} · read them in`;
      // The tab counts today's failing incidents, not each repeat of them.
      const errs = new Set(events.filter((x) => x.severity !== 'warning' && (x.eventTime ?? x.ingested) >= today).map((x) => x.incidentId)).size;
      $('[data-tabn="logging"]').innerHTML = errs ? `${cap('failed')}${errs} ${errs === 1 ? 'error' : 'errors'} today` : '';
      const health = D.HEALTH.collection !== 'connected';
      $('[data-lg-dot]').className = `sdot${health ? ' is-warn' : ' is-saved'}`;
      $('[data-lg-databtn]').title = `Data and collection · ${health ? 'Degraded' : 'Connected'}`;
      paintLinked();
    }
    function paintLinked() {
      const box = $('[data-lg-linked]');
      if (linkFail) { box.innerHTML = `<section class="lg-linked" data-ref="lg.linked"><p><b>${linkFail}</b></p><button class="btn-ghost" data-act="lg-restore">Browse retained diagnostics</button></section>`; return; }
      if (!linked) { box.innerHTML = ''; return; }
      box.innerHTML = `<section class="lg-linked" data-ref="lg.linked"><p><b>Linked diagnostic.</b> The hour around it is applied, with all three severities. Your saved filters are kept.</p><button class="btn-ghost" data-act="lg-restore">Restore saved filters</button></section>`;
    }
    // ---------- Popovers: column filters, columns, data and collection ----------
    function place(pop, anchor) {
      const r = anchor.getBoundingClientRect();
      pop.hidden = false;
      const w = pop.offsetWidth;
      pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
      pop.style.top = `${r.bottom + 6}px`;
    }
    function filterPop(k, anchor) {
      const pop = $('#lg-filter'), l = COLUMNS.find(([n]) => n === k)[1];
      let inner;
      if (k === 'severity') inner = `<div class="seg">${LEVELS.map((v) => `<button data-level="${v}" aria-pressed="${P.severities.includes(v)}">${label(v)}</button>`).join('')}</div>`;
      else if (k === 'time') inner = `<div class="seg lg-ranges">${RANGES.map(([v, t]) => `<button data-range="${v}" aria-pressed="${P.time === v}">${t}</button>`).join('')}</div><div class="lg-custom"${P.time === 'custom' ? '' : ' hidden'}><label>From<input class="search" data-from value="${esc(P.from)}" placeholder="2026-10-23T18:00"></label><label>To<input class="search" data-to value="${esc(P.to)}" placeholder="2026-10-23T20:00"></label><button class="btn-ghost" data-act="lg-apply">Apply interval</button></div>`;
      else if (k === 'source') inner = `<select class="search" data-source aria-label="Filter Source"><option value="">All sources</option>${SOURCES.map((s) => `<option${P.source === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`;
      else inner = `${k === 'workspace' ? `<label class="lg-scope" data-ref="lg.scope">Access scope<select class="search" data-scope-pick><option value="workspace"${P.scope === 'workspace' ? ' selected' : ''}>Your workspace</option><option value="instance"${P.scope === 'instance' ? ' selected' : ''}>Instance diagnostics</option></select></label>` : ''}<input class="search" data-exact="${k}" value="${esc(P[k])}" placeholder="All ${l.toLowerCase()} values" aria-label="Filter ${l}"><button class="lnk" data-act="lg-clear" data-k="${k}">Clear filter</button>`;
      pop.innerHTML = `<p class="t-micro">${l}</p>${inner}`;
      pop.setAttribute('aria-label', `${l} filter`);
      place(pop, anchor);
      popFor = k;
      anchor.setAttribute('aria-expanded', 'true');
      ($('input, select, button', pop))?.focus();
    }
    function columnsPop(anchor) {
      const pop = $('#lg-columns');
      pop.innerHTML = `<p class="t-micro">Columns</p>${OPTIONAL.map((k) => { const l = COLUMNS.find(([n]) => n === k)[1], locked = !!P[k]; return `<label class="lg-check"${locked ? ' title="Clear its filter before hiding this column"' : ''}><input type="checkbox" data-col="${k}"${P.columns.includes(k) || locked ? ' checked' : ''}${locked ? ' disabled' : ''}>${l}</label>`; }).join('')}`;
      place(pop, anchor);
    }
    function dataPop(anchor) {
      const H = D.HEALTH, pop = $('#lg-data');
      const st = (s) => (s === 'connected' ? 'Connected' : s === 'partial' ? 'Degraded' : 'Not configured');
      pop.innerHTML = `<p class="t-micro">Data and collection</p><dl class="lg-facts is-two">${field('Collection now', st(H.collection))}${field('Query service', st(H.query))}${field('Snapshot', D.stamp(snap))}${field('Retention boundary', D.stamp(H.retention))}${field('Earliest retained', D.stamp(H.earliest))}${field('Latest retained', D.stamp(H.latest))}${field('Time zone', 'Europe/Helsinki, from General')}${field('Active loss', H.lossActive ? 'Yes' : 'No')}${field('Historical loss recorded', H.lossObserved ? 'Yes' : 'No')}</dl>
        <table class="lg-sources"><thead><tr><th>Source</th><th>Now</th><th>Last observed</th><th>History</th></tr></thead><tbody>${D.SOURCES.map(([id, name, s, seen, gaps]) => `<tr><td>${name}<span class="dim t-mono"> ${id}</span></td><td>${cap(s === 'connected' ? 'done' : 'waiting')}${st(s)}</td><td>${D.stamp(seen)}</td><td>${gaps.length ? `<details><summary>${gaps.length} ${gaps.length === 1 ? 'gap' : 'gaps'}</summary>${gaps.map(([f, t, why]) => `<p>${D.clockOf(f).slice(0, 5)}–${D.clockOf(t).slice(0, 5)} · ${esc(why)}</p>`).join('')}</details>` : '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table>`;
      place(pop, anchor);
    }
    // ?data=1: a link that names Data and collection opens it, as System health's coverage card does.
    if (params.get('data')) setTimeout(() => { const b = $('[data-lg-databtn]'); if (b) dataPop(b); }, 600);
    function changed() { page = 0; expanded.clear(); related.clear(); save(); paint(); }
    $('[data-lg-head]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter-col]');
      if (!b) return;
      const k = b.dataset.filterCol, again = popFor === k;
      closePops();
      if (!again) filterPop(k, b);
    });
    $('#lg-filter').addEventListener('click', (e) => {
      const lv = e.target.closest('[data-level]'), rg = e.target.closest('[data-range]'), act = e.target.closest('[data-act]')?.dataset.act;
      if (lv) { const v = lv.dataset.level; P.severities = P.severities.includes(v) ? P.severities.filter((x) => x !== v) : LEVELS.filter((x) => x === v || P.severities.includes(x)); lv.setAttribute('aria-pressed', String(P.severities.includes(v))); changed(); }
      if (rg) {
        P.time = rg.dataset.range;
        if (P.time === 'custom' && !P.from) { P.from = '2026-10-23T18:00'; P.to = '2026-10-23T20:00'; }
        $$('[data-range]', e.currentTarget).forEach((x) => x.setAttribute('aria-pressed', String(x === rg)));
        $('.lg-custom', e.currentTarget).hidden = P.time !== 'custom';
        if (P.time === 'custom') { $('[data-from]', e.currentTarget).value = P.from; $('[data-to]', e.currentTarget).value = P.to; }
        changed();
      }
      if (act === 'lg-apply') {
        const f = $('[data-from]', e.currentTarget).value.trim(), t = $('[data-to]', e.currentTarget).value.trim();
        if (!f && !t) { toast('Enter at least one zoned time for a custom interval.'); return; }
        if (f && t && parse(f) >= parse(t)) { toast('From must be before To.'); return; }
        P.from = f; P.to = t; changed();
      }
      if (act === 'lg-clear') { P[e.target.closest('[data-k]').dataset.k] = ''; changed(); closePops(); }
    });
    let deb = 0;
    $('#lg-filter').addEventListener('input', (e) => { const k = e.target.dataset.exact; if (!k) return; clearTimeout(deb); deb = setTimeout(() => { P[k] = e.target.value.trim(); changed(); }, 250); });
    $('#lg-filter').addEventListener('change', (e) => {
      if (e.target.matches('[data-source]')) { P.source = e.target.value; changed(); }
      if (e.target.matches('[data-scope-pick]')) { P.scope = e.target.value; changed(); toast(P.scope === 'instance' ? 'Instance diagnostics: every workspace on this instance.' : 'Your workspace only.'); }
    });
    $('#lg-columns').addEventListener('change', (e) => {
      const k = e.target.dataset.col;
      if (!k) return;
      P.columns = e.target.checked ? [...P.columns.filter((c) => c !== k), k] : P.columns.filter((c) => c !== k);
      save();
      paint();
    });
    $('[data-panel="logging"] .obv-bar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pop) { const again = b.getAttribute('aria-expanded') === 'true'; closePops(); if (!again) { b.setAttribute('aria-expanded', 'true'); (b.dataset.pop === 'lg-columns' ? columnsPop : dataPop)(b); } return; }
      if (b.dataset.act === 'lg-refresh') { readIn(); toast('Read again with the same filters.'); }
      if (b.dataset.act === 'lg-export') {
        const all = list(), blob = new Blob(all.map((x) => JSON.stringify({ id: x.id, incidentId: x.incidentId, severity: x.severity, source: x.source, component: x.component, message: x.message, eventTime: x.eventTime == null ? null : D.stamp(x.eventTime) })).join('\n') + '\n', { type: 'application/x-ndjson' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'poise-diagnostics.ndjson' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(`Exported ${all.length} events as poise-diagnostics.ndjson.`, 'done');
      }
    });
    $('[data-lg-search]').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { P.search = e.target.value.trim(); changed(); }, 250); });
    function readIn() { pending.splice(0).forEach((x) => { x.eventTime = secs() - 5; x.ingested = secs() - 3; events.unshift(x); }); snap = secs(); page = 0; paint(); }
    $('[data-lg-new]').addEventListener('click', readIn);
    $('[data-lg-linked]').addEventListener('click', (e) => { if (e.target.closest('[data-act="lg-restore"]')) { linked = null; linkFail = null; P = { ...defaults(), ...store.get(KEY, {}) }; const u = new URL(location.href); u.searchParams.delete('event'); history.replaceState(null, '', u); changed(); } });
    $('.lg-pages').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      page += b.dataset.act === 'lg-next' ? 1 : -1;
      paint();
      scroll.scrollTop = 0;
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-ev], [data-lg-detail]')?.dataset.ev || b.closest('[data-lg-detail]')?.dataset.lgDetail;
      const act = b.dataset.act;
      if (act === 'lg-expand') { if (expanded.has(id)) { expanded.delete(id); related.delete(id); } else expanded.add(id); paint(); $(`[data-ev="${id}"] [data-act="lg-expand"]`, body)?.focus(); }
      if (act === 'lg-incident' || act === 'lg-corr') { related.set(id, { kind: act === 'lg-corr' ? 'correlation' : 'incident', page: 0 }); paint(); }
      if (act === 'lg-rel-next' || act === 'lg-rel-prev') { const r = related.get(id); r.page += act === 'lg-rel-next' ? 1 : -1; paint(); }
      if (act === 'lg-open') open(b.dataset.ev);
      if (act === 'lg-call') { show('behaviors'); SW.focus({ call: b.dataset.call }); }
    });
    // A link names one diagnostic: the hour around it opens, with it unfolded.
    function open(id) {
      const x = events.find((y) => y.id === id);
      if (!x) { linkFail = id === 'expired' ? 'Linked diagnostic evidence has expired.' : 'Linked diagnostic evidence is unavailable.'; paintLinked(); return; }
      const t = x.eventTime ?? x.ingested, two = (n) => String(n).padStart(2, '0');
      const iso = (s) => { const d = new Date(2026, 9, 23, 0, 0, s); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`; };
      linked = id;
      P = { ...defaults(), columns: P.columns, time: 'custom', from: iso(t - 3600), to: iso(t + 3600) };
      expanded.clear(); expanded.add(id); related.clear(); page = 0;
      const u = new URL(location.href); u.searchParams.set('event', id); history.replaceState(null, '', u);
      paint();
      $(`[data-ev="${id}"]`, body)?.scrollIntoView({ block: 'center' });
    }
    // New diagnostics wait for you; the table never moves by itself.
    setTimeout(() => { pending.push(...D.LATER_EVENTS.map((x) => ({ ...x }))); paint(); }, 30000);
    return { paint, open, closePop: () => { popFor = null; }, expandFirst: () => { expanded.add(list()[0].id); paint(); }, byIncident: (needle) => events.find((x) => x.message.includes(needle))?.id };
  })();

  function closePops() {
    $$('.obv-pop').forEach((p) => { p.hidden = true; });
    $$('[data-pop][aria-expanded="true"], [data-filter-col][aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    LG.closePop();
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.obv-pop, [data-pop], [data-filter-col]')) closePops(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $$('.obv-pop').some((p) => !p.hidden)) closePops(); });
  document.addEventListener('scroll', closePops, true);

  // ---------- Start ----------
  paintOrg();
  show(tab);
  SW.paint(); AR.paint(); LG.paint();
  if (params.get('call') || params.get('pr')) SW.focus({ call: params.get('call'), pr: params.get('pr') });
  if (params.get('item')) AR.focusItem(params.get('item'));
  if (params.get('event')) {
    const want = params.get('event');
    // A notice can name its diagnostic by what it says.
    const id = want.startsWith('evt_') ? want : LG.byIncident(want === 'grey' ? 'Rerun Grey CI held' : want === 'sync' ? 'has not synced' : want);
    LG.open(id || want);
  }
  window.poisePaintTerms?.($('.obv'));
  // A link from the review opens an element with its full reference, in its part.
  const want = params.get('ref');
  if (want) {
    const part = want.startsWith('bh.') ? 'behaviors' : want.startsWith('gh.') ? 'github' : want.startsWith('lg.') ? 'logging' : want.startsWith('tk.') ? 'tasks' : null;
    if (part) show(part);
    if (['bh.activity', 'bh.reasoning', 'bh.board'].includes(want)) SW.expandFirst();
    if (['lg.links', 'lg.facts', 'lg.related', 'lg.workimpact'].includes(want)) LG.expandFirst();
    if (want === 'gh.status' || want === 'gh.review' || want === 'gh.board') AR.showStatus();
    setTimeout(() => { const el = $(`[data-ref="${want}"]:not([hidden])`) || $(`[data-ref="${want}"]`); el?.scrollIntoView({ block: 'center' }); window.poiseOpenRef?.(el); }, 1500);
  }
})();
