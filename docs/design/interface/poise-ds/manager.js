// The Manager place, in three panes: the Manager's chat, the work table, and
// the Switchboard. Its controls open over the work table. Runs after chat.js
// and uses its workspace (window.PoiseChat); tasks come from tasks-data.js.
(() => {
  const P = window.PoiseChat;
  const { $, $$, store, term, params, CHATS, MGR, byId, slotUse, schedule, managerTurn, setState, finishWorker, closeWorker, render, toast, clock, lifeTo, setSit, addStop, esc, stateText } = P;
  const POLICY = window.POISE_POLICY, T = window.POISE_TASKS;
  const layout = $('.chat-layout'), convo = $('.convo');
  const settings = { stability: +store.get('poise-mgr-stability', 2), autonomy: +store.get('poise-mgr-autonomy', 2) };
  ['stability', 'autonomy'].forEach((k) => { if (!(settings[k] >= 0 && settings[k] <= 4)) settings[k] = 2; });
  const workers = () => CHATS.filter((c) => c.worker && c.worker !== 'Worker').sort((a, b) => a.worker.localeCompare(b.worker, 'en', { numeric: true }));
  const shortTitle = (c) => c.title.replace(/^(#\d+)\s.*$/, '$1');

  // ---------- The combined effect, in one sentence ----------
  function renderEffect() {
    const n = MGR.limit;
    $('[data-sentence]').textContent = POLICY.effect(n, settings.stability, settings.autonomy, POLICY.paused.get());
    const pz = $('[data-act="mgr-paused"]');
    if (pz) { pz.setAttribute('aria-pressed', String(POLICY.paused.get())); $('[data-paused-now]').textContent = POLICY.paused.get() ? 'Paused: the Manager wakes and watches, and gives out no new ticket until you resume.' : 'Not paused: free slots go to the next ticket.'; }
    const sc = store.get('poise-mgr-scope', POLICY.scope);
    $('[data-mgr-scope]').textContent = `Scope: ${POLICY.scopeWords(sc === null || Array.isArray(sc) ? sc : POLICY.scope).replace(/, /g, ' · ')}`;
    $('[data-eff-r]').textContent = n;
    $('[data-eff-s]').textContent = POLICY.stability[settings.stability][0];
    $('[data-eff-a]').textContent = POLICY.autonomy[settings.autonomy][0];
  }

  // ---------- Rhythm: limit and use, one capsule per slot ----------
  // What the workers holding slots are doing, in a few words.
  const useWords = (u) => [[u.running, 'running'], [u.paused, 'paused for you'], [u.blocked, 'blocked'], [u.between, 'between turns'], [u.finished, 'done and still open']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ') || 'none';
  function renderSlots() {
    const u = slotUse();
    // One capsule per worker that holds a slot, in its state: running, paused for you, blocked, or between turns.
    const ORDER = { running: 0, 'needs-you': 1, blocked: 2, failed: 2 };
    const holding = workers().filter((c) => !c.closed && c.state !== 'done').sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3));
    const kind = (c) => (c.state === 'running' ? 'run' : c.state === 'needs-you' ? 'paused' : c.state === 'blocked' || c.state === 'failed' ? 'blocked' : 'held');
    let html = '';
    for (let k = 0; k < 10; k++) {
      let cls = 'off';
      if (k < holding.length) cls = k < MGR.limit ? kind(holding[k]) : 'over';
      else if (k < MGR.limit) cls = 'free';
      html += `<span class="slot ${cls}" data-k="${k}"></span>`;
    }
    const box = $('[data-slots]');
    box.innerHTML = html;
    box.setAttribute('aria-valuenow', MGR.limit);
    box.setAttribute('aria-valuetext', `${MGR.limit} slots, ${u.used} in use`);
    Object.assign($('[data-rhythm]').dataset, { limit: MGR.limit, used: u.used, paused: u.paused, waitingSlot: u.waiting });
    $('[data-rh-n]').textContent = MGR.limit;
    const over = u.used > MGR.limit ? `; <b>${u.used - MGR.limit} over the limit</b>: those workers finish their tasks, and nothing new starts until use is below ${MGR.limit}` : '';
    const wait = u.waiting ? `; ${MGR.next.map((x) => `#${x.issue}`).join(' and ')} next for a slot` : '';
    $('[data-rh-now]').innerHTML = `<b>${MGR.limit} slot${MGR.limit > 1 ? 's' : ''}</b>; ${u.used} held by workers (${useWords(u)})${over}${wait}.${MGR.paused ? ' The Manager is on hold: nothing new starts.' : ''}`;
    const free = Math.max(0, MGR.limit - u.used);
    $('[data-slotline]').innerHTML = `<b>${u.used} of ${MGR.limit}</b> slots in use${free ? ` · ${free} free${u.waiting ? '' : ' · <span class="is-attn">nothing waits for one</span>'}` : ''}${u.waiting ? ` · ${MGR.next.map((x) => `#${x.issue}`).join(', ')} next` : ''}`;
  }
  function setRhythm(n) {
    n = Math.max(1, Math.min(10, n));
    if (n === MGR.limit) return;
    MGR.limit = n;
    store.set('poise-mgr-rhythm', n);
    // Rhythm is policy the Manager reads on its next turn: a slot it adds is filled then.
    event(`You set <b>Rhythm</b> to ${n}: from the Manager's next turn`);
    const u = slotUse(), at = POLICY.wake.next(POLICY.wake.get()), free = n - u.used;
    refresh();
    render();
    if (u.used > n) toast(`Rhythm ${n}. Workers over the limit finish their tasks; nothing new starts until use is below ${n}. Stopping work is separate.`, 'waiting');
    else if (free > 0 && u.waiting) toast(`Rhythm ${n}. On its next turn, at ${at} or when something wakes it, the Manager gives ${MGR.next.slice(0, free).map((x) => `#${x.issue}`).join(' and ')} to a new worker.`, 'waiting');
    else toast(`Rhythm ${n}. ${free} slot${free === 1 ? '' : 's'} free${u.waiting ? '' : '; nothing is waiting for one'}.`);
  }

  // ---------- Stability ↔ Expansion and Autonomy: five stops each ----------
  function renderStops(kind) {
    const box = $(`[data-stops="${kind}"]`), idx = settings[kind];
    box.innerHTML = POLICY[kind].map(([name], i) => `<button role="radio" aria-checked="${i === idx}" tabindex="${i === idx ? 0 : -1}" data-v="${i}" data-ref="mgr.${kind}"><i></i>${name}</button>`).join('');
    box.closest(`[data-${kind}]`).dataset[kind] = idx;
    const p = $(`[data-policy="${kind}"]`);
    if (kind === 'stability') p.innerHTML = `<b>${POLICY.stability[idx][0]}.</b> “${POLICY.stability[idx][1]}”`;
    else { const [, d, b] = POLICY.autonomy[idx]; p.innerHTML = `<span class="t-micro">Decides</span>${d}<span class="t-micro">Brings to you</span>${b}`; }
  }
  const WHEN = { stability: 'From the Manager’s next planning decision.', autonomy: 'For decisions from now on. Questions already with you stay open.' };
  function setPolicy(kind, i) {
    if (i === settings[kind] || i < 0 || i > 4) return;
    settings[kind] = i;
    store.set(`poise-mgr-${kind}`, i);
    renderStops(kind);
    renderEffect();
    $(`[data-stops="${kind}"] [aria-checked="true"]`).focus();
    const label = kind === 'stability' ? 'Stability ↔ Expansion' : 'Autonomy';
    event(`You set <b>${label}</b> to ${POLICY[kind][i][0]}`);
    toast(`${label}: ${POLICY[kind][i][0]}. ${WHEN[kind]}`);
  }

  // ---------- The work table ----------
  // One row per task, a worker's or the chain's. Rows keep their place while
  // you read; a change updates its row where it stands.
  const FLAG = { problem: ['☑', 'observed: a problem'], clear: ['☐', 'observed: clear'], unknown: ['?', 'not observed yet, or stale'], none: ['—', 'no pull request yet'] };
  const FLAG_STATE = { conflicts: 'blocked', review: 'waiting', behind: 'waiting', ci: 'failed' };
  const FLAG_NAME = { conflicts: 'Conflicts', review: 'Open review', behind: 'Behind main', ci: 'CI failing' };
  let open = params.get('peek') || null;
  const rowsOf = () => [
    ...workers().map((c) => ({ key: c.id, chat: c, w: T.WORK[c.id] || { issue: c.issue, repo: c.project, flags: { conflicts: 'none', review: 'none', behind: 'none', ci: 'none' }, latest: [c.t, stateText(c)] } })),
    ...T.TASKS.map((t) => ({ key: t.id, task: t }))
  ];
  let order = null;
  function rowHTML(r) {
    const isOpen = open === r.key;
    let task, driver, state, now, flags, latest, more = '', acts = '';
    if (r.chat) {
      const c = r.chat, w = r.w, repo = w.repo || 'autonomio/poise';
      const num = w.issue || w.pr;
      task = `<span class="wt-t"><b>${esc(repo === 'autonomio/poise' ? `#${num}` : `${repo}#${num}`)}</b> ${esc(c.title.replace(/^#\d+\s/, ''))}</span><span class="t-mono t-gloss">${w.issue && w.pr ? `PR #${w.pr}` : w.pr ? 'its pull request' : 'no PR yet'}</span>`;
      driver = `<span class="wk">${esc(c.worker)}</span>`;
      // A finished worker keeps its slot until you close its chat; closed, its row is its task's end.
      state = c.closed ? 'done' : c.state; now = c.closed ? `${term('state.done')} · ${c.ended || 'its chat is closed'}` : c.finished ? `${term('state.idle')} · ${c.finished}; it keeps its slot until you close it` : c.note ? stateText(c) : `${term('state.' + c.state)}`;
      flags = w.flags; latest = w.latest;
      acts = `<button class="btn-ghost" data-act="open-worker" data-id="${c.id}" data-ref="row">Open ${esc(c.worker)}’s chat</button>${c.finished && !c.closed ? `<button class="btn-ghost is-primary" data-act="close-worker" data-id="${c.id}" data-ref="mgr.close">Close ${esc(c.worker)}’s chat</button>` : ''}${c.state === 'needs-you' ? `<button class="btn-ghost" data-act="goto-dec" data-id="${c.id}">Answer in the Switchboard</button>` : ''}`;
    } else {
      const t = r.task;
      task = `<span class="wt-t"><b>${esc(t.repo === 'autonomio/poise' ? `#${t.issue}` : `${t.repo}#${t.issue}`)}</b> ${esc(t.title)}</span><span class="wt-rail">${T.railHTML(t)}</span>`;
      driver = '<span class="chip is-outline" data-ref="mgr.col.driver">Behaviors</span>';
      state = t.state; now = `${term('state.' + t.state)} · ${t.now}`;
      flags = t.flags; latest = t.journal[0];
      more = `<ol class="wt-journal">${t.journal.slice(0, 4).map(([at, , text]) => `<li><span class="t-mono">${esc(at)}</span>${esc(text)}</li>`).join('')}</ol>`;
      acts = `<a class="btn-ghost" href="observe.html?tab=tasks&amp;task=${esc(t.id)}&amp;back=manager" data-ref="task.open">Open its timeline</a>${t.state === 'needs-you' && t.hold ? `<button class="btn-ghost" data-act="resume-task" data-id="${t.id}" data-ref="task.resume">Resume</button>` : ''}`;
    }
    const cells = ['conflicts', 'review', 'behind', 'ci'].map((k) => { const v = flags[k] || 'unknown', [g, w] = FLAG[v]; return `<td class="fl"><span class="flag is-${v}"${v === 'problem' ? ` data-state="${FLAG_STATE[k]}"` : ''} title="${esc(`${FLAG_NAME[k]}: ${w}`)}" data-ref="mgr.flag">${g}</span></td>`; }).join('');
    return `<tr class="wt-row${isOpen ? ' is-open' : ''}" data-key="${r.key}" data-act="wt-open" tabindex="0" aria-expanded="${isOpen}" data-ref="mgr.row"><td>${task}</td><td>${driver}</td><td><span class="wt-now"><span class="sc" data-state="${state}" data-ref="state"></span><span>${esc(now)}</span></span></td>${cells}</tr>${isOpen ? `<tr class="wt-more" data-more="${r.key}"><td colspan="7"><div class="wt-more-b"><p class="t-micro">Latest changes</p>${more || `<ol class="wt-journal"><li><span class="t-mono">${esc(latest[0])}</span>${esc(latest[1])}</li></ol>`}<div class="wt-acts">${acts}</div></div></td></tr>` : ''}`;
  }
  function renderTable() {
    const rows = rowsOf();
    if (!order) {
      const RANK = { 'needs-you': 0, blocked: 1, failed: 2, running: 3, waiting: 4, idle: 5, done: 6 };
      order = rows.map((r) => r.key).sort((a, b) => { const sa = rows.find((r) => r.key === a), sb = rows.find((r) => r.key === b); return RANK[(sa.chat || sa.task).state] - RANK[(sb.chat || sb.task).state]; });
    }
    rows.forEach((r) => { if (!order.includes(r.key)) order.push(r.key); });
    const body = $('[data-wt-body]');
    const focusKey = document.activeElement?.closest?.('.wt-row')?.dataset.key;
    body.innerHTML = order.map((k) => rows.find((r) => r.key === k)).filter(Boolean).map(rowHTML).join('');
    hydrateIcons(body);
    window.poisePaintTerms?.(body);
    if (focusKey) $(`.wt-row[data-key="${focusKey}"]`, body)?.focus({ preventScroll: true });
  }
  function staleTable() {
    // A refresh that fails keeps the last snapshot, with its age and the error.
    const el = $('[data-table-stale]');
    el.hidden = false;
    el.textContent = 'Showing the snapshot from 19:41, 2 minutes old: the refresh failed (GitHub answered 502). It tries again in a minute.';
    $('[data-table-asof]').textContent = 'observed 19:41 · 2 min ago · serving autonomio/poise@3f9c2ab';
  }

  // ---------- The Switchboard ----------
  // ?sb=stopped, off or waiting shows the Switchboard's other states.
  const SB = { paused: false, off: params.get('sb') === 'off', stopped: params.get('sb') === 'stopped', waiting: params.get('sb') === 'waiting', fresh: params.get('sb') === 'new', hidden: false, filter: null, checking: false, dismissed: new Set(), explained: {}, shown: new Set(), answered: [], focus: null, openRow: null };
  const DEC = {
    w4: { q: 'Which note stays untouched?', d: 'Issue #477 has two notes marked “left untouched”. Keep the first one from the original report, or the newer one with the repro steps?', opts: ['The note with the repro', 'The first note'], rec: 0, at: '19:22' },
    w3: { q: 'Which filter wins?', d: 'Archive and Analytics disagree on the date range when both are open. Which one should the shared filter bar keep?', opts: ['Analytics’ relative range', 'Archive’s absolute dates', 'Keep both, with a note'], rec: 0, at: '' }
  };
  const UPDATES = {
    'c-charter': 'Settled in the chat: answered there before it reached you',
    c475: 'Waiting for your answer in the chat: it asks to run gh pr create',
    w1: 'Review found 2 issues on #486; fixing them',
    w2: 'Pushed a fix for the failing lint on #471; checks running',
    w5: 'Blocked until Acme/Limen#1141 is reviewed',
    w7: 'Stalled: 2 commits unpushed and tests still running; Poise woke it',
    c446: 'The provider failed mid-turn',
    c479: 'Waiting for CI on #479',
    c509: 'Preparing its checkout'
  };
  // Explain asks the Switchboard once and keeps the answer; the same button hides and shows it. ?explain=fail shows the failed state.
  const EXPLAINS = (id) => (id === 'w4'
    ? { changed: 'W4 found two notes marked “left untouched” in #477.', matters: 'The issue says one survives.', uncertain: 'Whether the newer note’s repro still reproduces on main.' }
    : { changed: `${UPDATES[id] || 'Its latest update'}.`, matters: 'It decides what the chat does next.', uncertain: 'Nothing it could name.' });
  const sbRunning = () => !SB.off && !SB.stopped;
  const askExplain = (id) => {
    const fail = params.get('explain') === 'fail' && !SB.explained[id];
    SB.explained[id] = { state: 'pending' };
    renderSB();
    setTimeout(() => {
      if (SB.explained[id]?.state !== 'pending') return;
      SB.explained[id] = fail ? { state: 'failed', error: 'The Switchboard finished without explaining this update.' } : { state: 'ready', at: clock(), ...EXPLAINS(id) };
      renderSB();
    }, 1400);
  };
  const explainBtn = (id) => {
    const v = SB.explained[id], shown = SB.shown.has(id);
    const off = !sbRunning() && v?.state !== 'ready' && v?.state !== 'pending';
    return `<button class="lnk" data-act="sb-explain" data-id="${id}" data-ref="sb.explain" aria-expanded="${shown}"${off ? ' aria-disabled="true"' : ''}>${shown ? 'Hide explanation' : 'Explain'}</button>`;
  };
  const explainPanel = (id) => {
    if (!SB.shown.has(id)) return '';
    const v = SB.explained[id], no = 41 + CHATS.findIndex((c) => c.id === id);
    const row = (label, text) => `<div class="sb-expl-row"><span class="t-micro">${label}</span><p>${esc(text)}</p></div>`;
    const body = v.state === 'ready'
      ? `${row('What changed', v.changed)}${row('Why it matters', v.matters)}${row('Still uncertain', v.uncertain)}<p class="sb-expl-foot">Explained by the Switchboard at ${esc(v.at)} · update ${no}</p>`
      : v.state === 'failed'
        ? `<p class="sb-expl-error">${esc(v.error)}</p><button class="btn-ghost" data-act="sb-explain-again" data-id="${id}" data-ref="sb.explain"${sbRunning() ? '' : ' aria-disabled="true"'}>Try again</button>`
        : `<div class="sb-thinking"><span class="dots"><i></i><i></i><i></i></span>Asking the Switchboard…${SB.checking ? ' It is finishing its current work first.' : ''}</div>`;
    return `<div class="sb-expl" role="region" aria-live="polite" aria-label="Explanation of update ${no}">${body}</div>`;
  };
  // A chat waiting on your permission or answer is Needs you here too, as in Chat and Overview, whether or not the Switchboard relays a decision for it.
  const KIND = (c) => (c.state === 'needs-you' ? 'needs' : c.state === 'blocked' || c.state === 'failed' ? 'blocked' : c.state === 'running' || c.state === 'waiting' ? 'progress' : c.state === 'done' ? 'done' : 'quiet');
  const KIND_WORD = { needs: 'Needs you', blocked: 'Blocked', progress: 'In progress', done: 'Done', quiet: 'Quiet' };
  const KIND_STATE = { needs: 'needs-you', blocked: 'blocked', progress: 'running', done: 'done', quiet: 'idle' };
  const decisions = () => CHATS.filter((c) => !SB.fresh && c.state === 'needs-you' && DEC[c.id] && !SB.dismissed.has(`dec:${c.id}`));
  function decCard(c) {
    const d = DEC[c.id], stale = c.id === 'w4' && SB.staleQ;
    return `<div class="req sb-card is-focused" id="dec-${c.id}" tabindex="-1" data-ref="question" data-dec="${c.id}" data-req><div class="req-t"><span class="t-micro">Question</span><span class="wk">${esc(c.worker || '')}</span>${esc(d.q)}</div><p class="req-d">${esc(d.d)}</p>${stale ? '<p class="why is-attn">The chat has started turns since it asked; this may be out of date.</p>' : ''}<div class="opts">${d.opts.map((o, i) => `<button class="opt" data-dopt="${esc(o)}"><span class="k">${i + 1}</span>${esc(o)}${i === d.rec ? ' <span class="t-gloss">recommended</span>' : ''}</button>`).join('')}</div><div class="sb-else"><input class="sinput" placeholder="Something else…" aria-label="Your own answer" data-else><button class="btn-ghost" data-act="sb-else">Send</button></div><p class="why" data-ref="mgr.why">Why this came to you: Autonomy is ${esc(POLICY.autonomy[settings.autonomy][0])}, and ${c.id === 'w4' ? 'what stays in an issue is a product choice' : 'it is a design choice'}.</p><div class="sb-item-acts">${explainBtn(c.id)}<button class="lnk" data-act="sb-dismiss" data-id="dec:${c.id}" data-ref="sb.dismiss">Dismiss</button></div>${explainPanel(c.id)}</div>`;
  }
  function renderSB() {
    const chats = SB.fresh ? [] : CHATS.filter((c) => !c.manager);
    const counts = { needs: 0, blocked: 0, progress: 0, done: 0 };
    chats.forEach((c) => { const k = KIND(c); if (k in counts) counts[k] += 1; });
    $('[data-sb-counts]').innerHTML = Object.entries(counts).map(([k, n]) => `<button class="sb-count" data-act="sb-filter" data-k="${k}" aria-pressed="${SB.filter === k}" data-ref="sb.count"><span class="sc" data-state="${KIND_STATE[k]}"></span>${KIND_WORD[k]} <b>${n}</b></button>`).join('');
    const dec = decisions().sort((a, b) => (DEC[a.id].at || '99').localeCompare(DEC[b.id].at || '99'));
    const first = dec.find((c) => c.id === SB.focus) || dec[0];
    $('[data-sb-needs]').innerHTML = (first ? decCard(first) : '<p class="t-gloss">Nothing waits for you.</p>')
      + dec.filter((c) => c !== first).map((c) => `<button class="sb-line" data-act="sb-focus" data-id="${c.id}"><span class="sc" data-state="needs-you"></span><span class="wk">${esc(c.worker || '')}</span>${esc(DEC[c.id].q)}</button>`).join('')
      + SB.answered.map((a) => `<p class="sb-answered${a.relay === 'held' ? ' is-held' : ''}" role="status" data-ref="sb.relay"><span class="chip is-done">Answered</span> You answered “${esc(a.label)}” to ${esc(a.who)}’s “${esc(a.q)}” · ${esc(a.at)}<small>${a.relay === 'delivered' ? `Delivered to “${esc(a.title)}”` : a.relay === 'held' ? `Held: “${esc(a.title)}” is stopped; open it to resume it` : `Queued for “${esc(a.title)}”; it is delivered when the chat is free`}</small><button class="lnk" data-act="open-worker" data-id="${a.id}">Open the chat</button></p>`).join('');
    const rows = chats.filter((c) => !SB.dismissed.has(`up:${c.id}`) && (!SB.filter || KIND(c) === SB.filter || (SB.filter === 'needs' && c.state === 'needs-you')));
    $('[data-sb-chats]').innerHTML = rows.map((c) => {
      const k = KIND(c), up = UPDATES[c.id] || stateText(c), isOpen = SB.openRow === c.id;
      return `<li class="sb-chat${isOpen ? ' is-open' : ''}" data-ref="sb.chatrow"><button class="sb-row" data-act="sb-row" data-id="${c.id}" aria-expanded="${isOpen}"><span class="sc" data-state="${KIND_STATE[k]}" title="${KIND_WORD[k]}"></span><span class="sb-row-t">${c.worker ? `<span class="wk">${esc(c.worker)}</span>` : ''}${esc(c.title)}</span><span class="sb-row-u">${esc(k === 'quiet' && !UPDATES[c.id] ? 'Quiet' : up)}</span><time>${esc(c.t)}</time></button>${isOpen ? `<div class="sb-row-b"><div class="sb-item-acts">${explainBtn(c.id)}<button class="lnk" data-act="sb-dismiss" data-id="up:${c.id}" data-ref="sb.dismiss">Dismiss</button><button class="lnk" data-act="open-worker" data-id="${c.id}">Open chat</button></div>${explainPanel(c.id)}</div>` : ''}</li>`;
    }).join('') || `<li class="t-gloss">${SB.filter ? 'No chat is in this state.' : sbRunning() ? 'Nothing to report yet. Updates appear here as the Switchboard checks your chats.' : 'Nothing reported.'}</li>`;
    const st = SB.stopped ? ['failed', 'stopped · watching 14 chats · last check 19:38, 41k tokens'] : SB.off ? ['idle', 'Off: its updates stay; Start creates a new one'] : SB.checking ? ['running', 'checking 6 chats with news…'] : SB.paused ? ['waiting', 'checks paused by you; Explain and your answers still go through'] : ['running', SB.meta || (SB.fresh ? 'watching 14 chats · no check finished yet · next 19:48' : 'watching 14 chats · last check 19:38, 41k tokens · next 19:48')];
    const chip = $('[data-sb-state]');
    chip.dataset.state = st[0];
    chip.innerHTML = `<span data-term="state.${st[0]}">${term('state.' + st[0])}</span>`;
    $('[data-sb-meta]').textContent = st[1];
    $('[data-act="sb-check"]').textContent = SB.off ? 'Start the Switchboard' : 'Check now';
    // Unavailable stays focusable, so its reason can be read.
    const dis = (el, on) => (on ? el.setAttribute('aria-disabled', 'true') : el.removeAttribute('aria-disabled'));
    dis($('[data-act="sb-check"]'), SB.checking || SB.stopped);
    $('[data-act="sb-pause"]').textContent = SB.paused ? 'Resume checks' : 'Pause checks';
    $('[data-act="sb-pause"]').toggleAttribute('hidden', SB.off);
    dis($('[data-act="sb-pause"]'), SB.stopped);
    $('[data-act="sb-off"]').toggleAttribute('hidden', SB.off);
    // What the header alone cannot say: why it stopped, what it runs before you start it, or that it waits for you.
    const alert = $('[data-sb-alert]');
    alert.hidden = !(SB.stopped || SB.off || SB.waiting);
    alert.className = `sb-alert${SB.stopped ? ' is-failed' : SB.waiting && !SB.off ? ' is-needs' : ''}`;
    alert.setAttribute('role', SB.stopped || SB.waiting ? 'alert' : 'note');
    alert.innerHTML = SB.stopped
      ? '<p>Three checks in a row ended without confirming, so the Switchboard stopped; a failing observer stops costing. Its updates stay here.</p><button class="btn-ghost is-primary" data-act="sb-restart" data-ref="sb.restart">Restart the Switchboard</button>'
      : SB.off
        ? '<p>The Switchboard watches every chat in this workspace and reports here: what is blocked, what finished, and what needs your decision. It only reads and reports.</p><p data-ref="sb.model">It runs the Muse model <span class="t-mono">muse-spark-1.3-contributor-max</span> and reads your chats’ transcripts. In contributor mode, Muse may use that content for product improvement.</p>'
        : SB.waiting ? '<p>The Switchboard is waiting for you in its chat.</p><a class="lnk" href="chat.html?chat=switchboard&amp;back=manager" data-ref="sb.chat">Open its chat</a>' : '';
    // Hidden, the tab counts decisions waiting, or shows a red ! once it stopped.
    $('[data-sb-badge]').textContent = SB.stopped ? '!' : String(decisions().length);
    $('[data-sb-badge]').classList.toggle('is-stopped', SB.stopped);
    hydrateIcons($('[data-sb]'));
    window.poisePaintTerms?.($('[data-sb]'));
  }
  function sbAct(act, b) {
    if (act === 'sb-filter') { SB.filter = SB.filter === b.dataset.k ? null : b.dataset.k; renderSB(); $(`[data-act="sb-filter"][data-k="${b.dataset.k}"]`)?.focus(); return; }
    if (act === 'sb-focus') { SB.focus = b.dataset.id; renderSB(); $(`#dec-${b.dataset.id}`)?.focus(); return; }
    if (act === 'sb-row') { SB.openRow = SB.openRow === b.dataset.id ? null : b.dataset.id; renderSB(); $(`[data-act="sb-row"][data-id="${b.dataset.id}"]`)?.focus(); return; }
    if (act === 'sb-dismiss') {
      SB.dismissed.add(b.dataset.id);
      renderSB();
      toast(b.dataset.id.startsWith('dec:') ? 'Dismissed from the Switchboard. The chat is told nothing; its question still waits there.' : 'Dismissed. The chat is told nothing; its next update shows here.');
      return;
    }
    if (act === 'sb-explain' || act === 'sb-explain-again') {
      if (b.matches('[aria-disabled="true"]')) return;
      const id = b.dataset.id, where = b.closest('.sb-card') ? '.sb-card' : '.sb-chat';
      if (act === 'sb-explain' && SB.shown.has(id)) { SB.shown.delete(id); renderSB(); }
      else {
        SB.shown.add(id);
        if (act === 'sb-explain-again' || !SB.explained[id]) askExplain(id); else renderSB();
      }
      $(`${where} [data-act="sb-explain"][data-id="${id}"]`)?.focus();
      return;
    }
    if (act === 'sb-else') {
      const card = b.closest('[data-dec]'), v = $('[data-else]', card).value.trim();
      if (!v) { $('[data-else]', card).focus(); return; }
      answerDec(card, v);
      return;
    }
    if (act === 'sb-check') {
      if (SB.off) { SB.off = false; SB.meta = 'watching 14 chats · no check finished yet · next 19:48'; renderSB(); toast('Started the Switchboard: it reads each chat from its third most recent turn.', 'running'); return; }
      SB.checking = true;
      renderSB();
      setTimeout(() => { SB.checking = false; SB.meta = `watching 14 chats · last check ${clock()}, 12k tokens · next in 10 min`; UPDATES.w1 = 'Pushed the fix to #486; review requested again'; renderSB(); }, 2600);
      return;
    }
    if (act === 'sb-restart') { SB.stopped = false; renderSB(); toast('Restarted. The Switchboard resumes with its next check.', 'running'); $('[data-act="sb-check"]')?.focus(); return; }
    if (act === 'sb-pause') { if (SB.stopped) return; SB.paused = !SB.paused; renderSB(); toast(SB.paused ? 'Checks paused. Explain and your answers still go through.' : 'Checks resumed: the next runs when a chat has news.'); return; }
    if (act === 'sb-off') {
      if (!b.classList.contains('is-armed')) { b.classList.add('is-armed'); b.textContent = 'Sure? Turn off'; setTimeout(() => { if (b.isConnected) { b.classList.remove('is-armed'); b.textContent = 'Turn off'; } }, 3000); return; }
      b.classList.remove('is-armed');
      SB.off = true; SB.paused = false;
      Object.values(SB.explained).filter((v) => v.state === 'pending').forEach((v) => { v.state = 'failed'; v.error = 'The Switchboard was turned off.'; });
      renderSB();
      toast('The Switchboard is off and its chat deleted. Its updates stay here.', 'idle');
      return;
    }
    if (act === 'sb-hide' || act === 'sb-show') {
      SB.hidden = act === 'sb-hide';
      SB.chosen = true;
      layout.classList.toggle('sb-hidden', SB.hidden);
      $('.sb-tab').hidden = !SB.hidden;
      (SB.hidden ? $('.sb-tab') : $('[data-act="sb-hide"]'))?.focus();
    }
  }

  // ---------- The situation ----------
  function mgrSit() {
    const u = slotUse(), openDec = decisions().length;
    const next = MGR.next[0], done = workers().find((c) => c.finished && !c.closed);
    setSit({
      now: MGR.paused ? `On hold; ${u.used} worker${u.used === 1 ? '' : 's'} keep their tasks` : `${u.used} of ${MGR.limit} slots in use: ${useWords(u)}`,
      next: MGR.paused ? '' : next ? (u.used < MGR.limit ? `Give #${next.issue} to a new worker on its next turn, at ${POLICY.wake.next(POLICY.wake.get())}` : done ? `#${next.issue} waits for a slot: close ${done.worker}, whose task has ended, to free one` : `Give #${next.issue} to a worker when a slot frees`) : `Wake at ${POLICY.wake.next(POLICY.wake.get())} and review the work table`,
      wait: openDec ? `You: ${openDec} decision${openDec > 1 ? 's' : ''}` : 'Nothing',
      dec: openDec ? `Needs you · ${openDec}` : '',
      est: ''
    });
  }
  function refresh() { renderSlots(); renderEffect(); renderTable(); renderSB(); mgrSit(); }

  // Something the Manager did, on its route.
  function event(html) { addStop(`<div class="stop is-special activity"><p class="ev">${html}<span class="t-mono">${clock()}</span></p></div>`); }

  // ---------- Decisions, answered in the Switchboard ----------
  function answerDec(card, label) {
    if (!card || card.classList.contains('is-resolved')) return;
    const id = card.dataset.dec, c = byId(id);
    card.classList.add('is-resolved');
    SB.dismissed.add(`dec:${id}`);
    // The relay, in main's words: delivered at once to a chat waiting on the question, queued while it runs a turn, held if it is stopped.
    const relay = c?.state === 'running' ? 'queued' : c?.state === 'idle' && /stopped/.test(c?.note || '') ? 'held' : 'delivered';
    SB.answered.unshift({ id, who: c?.worker || 'the chat', title: c?.title || 'the chat', q: DEC[id]?.q || '', label, relay, at: clock() });
    SB.answered = SB.answered.slice(0, 3);
    event(`You answered <b>${c?.worker || 'a chat'}</b> in the Switchboard: ${esc(label)}`);
    setTimeout(() => {
      if (!byId(id)) return;
      setState(id, 'running', undefined, 'resumed with your answer');
    }, 600);
    setTimeout(() => {
      if (!byId(id) || byId(id).state !== 'running') return;
      // W4's task ends with #477 closed: it keeps its slot until you close its chat. W3 opens a pull request and keeps its slot while it waits.
      if (id === 'w4') finishWorker(id, 'closed #477', 'it kept the note with the repro and closed #477');
      else {
        if (T.WORK[id]) Object.assign(T.WORK[id], { pr: 497, flags: { conflicts: 'unknown', review: 'unknown', behind: 'unknown', ci: 'unknown' }, latest: [clock(), 'Opened #497'] });
        setState(id, 'waiting', 'for checks on #497', 'opened #497 and waits for its checks');
      }
    }, id === 'w4' ? 6000 : 12000);
    renderSB();
  }

  // ---------- Hold ----------
  P.onChatHold = (on) => { if (MGR.paused !== on) hold(on); };
  function hold(on) {
    MGR.paused = on;
    const head = $('[data-head-state]'), st = on ? 'waiting' : 'running';
    head.dataset.state = st;
    head.innerHTML = `<span data-term="state.${st}">${term('state.' + st)}</span>${on ? ' · on hold' : ''}`;
    convo.dataset.chatState = st;
    $('[data-pause-label]').textContent = on ? 'Resume' : 'Hold';
    $('[data-act="pause-mgr"]').setAttribute('aria-label', on ? 'Resume the Manager' : 'Hold the Manager');
    setState('mgr', st, on ? 'on hold by you' : undefined);
    event(on ? 'You put the Manager <b>on hold</b>: its timers and wake-ups skip; workers carry on with their tasks; nothing new starts' : 'You <b>resumed</b> the Manager');
    P.setChatHold?.(on);
    paintWake();
    refresh();
    render();
    toast(on ? 'On hold. Its timers and wake-ups skip; workers carry on with their tasks; questions stay open; nothing new starts.' : 'Resumed. Its wake-ups carry on, and free slots go to the next ticket.', st);
  }

  // ---------- Wake-ups ----------
  const W = POLICY.wake, wakeSel = $('[data-wake]');
  function paintWake() {
    const m = W.get();
    wakeSel.value = String(m);
    $('[data-wake-status]').textContent = W.status(m, MGR.paused);
  }
  wakeSel.addEventListener('change', () => {
    const m = Number(wakeSel.value);
    W.set(m);
    paintWake();
    event(`You set wake-ups to every <b>${m} minutes</b>: up to ${1440 / m} turns a day`);
    toast(`Wakes every ${m} minutes, up to ${1440 / m} turns a day. Next at ${W.next(m)}. Applies now; a wake-up already due still comes.`, 'running');
  });
  setInterval(paintWake, 30000);

  // ---------- The sheet over the work table: controls, or Memories ----------
  function showSheet(name) {
    const sheet = $('[data-sheet]');
    sheet.hidden = false;
    $$('[data-sheet] [data-panel]').forEach((s) => { s.hidden = s.dataset.panel !== name; });
    $$('[data-act="controls"][aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(name === 'controls')));
    $$('.sgrp [data-act="memories"]').forEach((b) => b.setAttribute('aria-pressed', String(name === 'memories')));
    $$('.sgrp [data-act="timers"]').forEach((b) => b.setAttribute('aria-pressed', String(name === 'timers')));
    if (name === 'timers') $('[data-sheet] [data-panel="timers"] h3').focus({ preventScroll: true });
    if (name === 'controls') $('[data-sheet] [data-panel="controls"] h3').focus({ preventScroll: true });
    if (name === 'memories') $('[data-mem]').focus({ preventScroll: true });
  }
  function hideSheet() {
    $('[data-sheet]').hidden = true;
    $$('[data-act="controls"][aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $$('.sgrp [data-act="memories"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('[data-act="controls"]').focus({ preventScroll: true });
  }
  const sheetOpen = (name) => !$('[data-sheet]').hidden && !$(`[data-sheet] [data-panel="${name}"]`).hidden;

  // ---------- Wiring ----------
  const from = params.get('back');
  const BACK = { chat: ['chat.html', 'Chat · #475'], board: ['board.html', 'Board'], editor: ['editor.html', 'Editor'], settings: ['settings.html#manager', 'Settings'], overview: ['overview.html', 'Overview'], observe: ['observe.html', 'Observe'] }[from];
  P.home = 'mgr';
  P.placeholder = () => 'Instruct the Manager (Enter)';
  P.onSelect = (c) => {
    if (c.manager) { if (convo.classList.contains('is-away') || convo.classList.contains('is-fresh')) P.back(); return false; }
    if (c.worker && c.worker !== 'Worker') { open = c.id; renderTable(); $(`.wt-row[data-key="${c.id}"]`)?.scrollIntoView({ block: 'nearest' }); $(`.wt-row[data-key="${c.id}"]`)?.focus({ preventScroll: true }); return false; }
    if (c.id === 'c475') { location.href = 'chat.html'; return false; }
    P.away(c);
  };
  P.onSend = (text) => {
    const sec = document.createElement('section');
    sec.className = 'turn settle';
    sec.innerHTML = `<div class="ticket" data-ref="msg.you">${esc(text)}<div class="life" data-ref="life"></div></div><div class="route"><div class="stop is-prose" data-reply hidden><div class="md"><p></p></div></div></div>`;
    $('[data-transcript]').append(sec);
    const life = $('.life', sec);
    lifeTo(life, 'Accepted', clock());
    $('[data-scroll]').scrollTo({ top: $('[data-scroll]').scrollHeight, behavior: 'smooth' });
    setTimeout(() => lifeTo(life, 'Executing', 'the Manager is planning with it', true), 600);
    setTimeout(() => {
      const r = $('[data-reply]', sec), before = workers().length;
      managerTurn('your message');
      const started = workers().slice(before);
      r.hidden = false;
      $('p', r).textContent = `Noted. I will apply it from my next decision, within your Rhythm, Stability and Autonomy settings.${started.length ? ` On this turn I gave ${started.map((c) => `#${c.issue} to ${c.worker}`).join(' and ')} in the free slot${started.length > 1 ? 's' : ''}.` : ''}`;
      lifeTo(life, 'Completed', clock(), true);
    }, 2200);
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const act = b.dataset.act;
    if (act === 'memories') { e.stopPropagation(); if (sheetOpen('memories')) hideSheet(); else showSheet('memories'); return; }
    if (act === 'timers') { e.stopPropagation(); if (sheetOpen('timers')) hideSheet(); else showSheet('timers'); return; }
    if (act === 'controls') { e.stopPropagation(); if (sheetOpen('controls')) hideSheet(); else showSheet('controls'); return; }
    if (act === 'controls-open') { e.stopPropagation(); P.closeMenus(); showSheet('controls'); }
  }, true);
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.req [data-dopt]');
    if (opt && !opt.matches('[aria-disabled="true"]')) { answerDec(opt.closest('[data-dec]'), opt.dataset.dopt); return; }
    const stop = e.target.closest('[data-stops] [data-v]');
    if (stop) { setPolicy(stop.closest('[data-stops]').dataset.stops, +stop.dataset.v); return; }
    const slot = e.target.closest('[data-slots] [data-k]');
    if (slot) { setRhythm(+slot.dataset.k + 1); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.matches('[aria-disabled="true"]') || b.closest('[data-list]')) return;
    const act = b.dataset.act;
    if (act.startsWith('sb-')) { sbAct(act, b); return; }
    if (act === 'rhythm') setRhythm(MGR.limit + +b.dataset.step);
    else if (act === 'wt-open') { const k = b.dataset.key; open = open === k ? null : k; renderTable(); $(`.wt-row[data-key="${k}"]`)?.focus({ preventScroll: true }); }
    else if (act === 'pause-mgr') hold(!MGR.paused);
    else if (act === 'goto-req' || act === 'goto-dec') { if (SB.hidden) sbAct('sb-show'); if (b.dataset.id) SB.focus = b.dataset.id; renderSB(); const t = $('[data-sb] [data-dec]'); if (t) { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); t.focus({ preventScroll: true }); } }
    else if (act === 'resume-task') { const t = T.byId(b.dataset.id); Object.assign(t, { state: 'waiting', now: 'Resumed by you: back in the merge queue', hold: null }); t.journal.unshift([clock(), 'event', 'Resumed by you', '']); renderTable(); toast('Resumed. It goes back into the merge queue; the journal records it.', 'waiting'); }
    else if (act === 'open-worker') P.away(byId(b.dataset.id));
    else if (act === 'close-worker') {
      const c = byId(b.dataset.id);
      if (!c || c.closed) return;
      const next = MGR.next[0], at = POLICY.wake.next(POLICY.wake.get());
      closeWorker(c.id, 'you closed it after its task ended', `${c.finished}; its chat is closed`);
      event(`You closed <b>${c.worker}</b> after its task ended: its slot is free${next ? `, and #${next.issue} gets a worker on the Manager's next turn` : ''}`);
      renderTable();
      toast(`${c.worker} closed: its slot is free${next ? `. On its next turn, at ${at} or when something wakes it, the Manager gives #${next.issue} a worker` : ''}. Resume reopens the chat.`, 'done');
      $(`.wt-row[data-key="${c.id}"]`)?.focus({ preventScroll: true });
    }
    else if (act === 'mgr-paused') {
      const on = !POLICY.paused.get();
      POLICY.paused.set(on);
      event(on ? 'You paused <b>new work</b>: the Manager still wakes and watches; no new ticket goes to a worker' : 'You resumed <b>new work</b>: from its next turn, free slots go to the next ticket');
      refresh();
      render();
      toast(on ? 'New work paused. The Manager still wakes and watches; workers finish their tasks.' : 'New work resumed. From the Manager’s next turn, free slots go to the next ticket.', on ? 'waiting' : 'running');
    }
    else if (act === 'mgr-start') { P.fresh(); const r = $('[data-newtype] input[value="manager"]'); if (r) r.checked = true; }
  });
  document.addEventListener('keydown', (e) => {
    const slots = e.target.closest?.('[data-slots]');
    if (slots) {
      const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (k) { e.preventDefault(); setRhythm(MGR.limit + k); }
      if (e.key === 'Home') { e.preventDefault(); setRhythm(1); }
      if (e.key === 'End') { e.preventDefault(); setRhythm(10); }
      return;
    }
    const group = e.target.closest?.('[data-stops]');
    if (group) {
      const k = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (k) { e.preventDefault(); setPolicy(group.dataset.stops, Math.max(0, Math.min(4, settings[group.dataset.stops] + k))); }
      return;
    }
    if (e.key === 'Enter' && e.target.matches?.('.wt-row')) { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'Escape' && !$('[data-sheet]').hidden && e.target.closest?.('[data-sheet]')) { e.preventDefault(); hideSheet(); return; }
    if (e.key === 'Enter' && e.target.matches?.('[data-else]')) { e.preventDefault(); sbAct('sb-else', e.target); return; }
    const card = document.activeElement?.closest?.('[data-dec]:not(.is-resolved)');
    if (card && !e.target.matches('input') && /^[1-9]$/.test(e.key)) { const o = $$('[data-dopt]', card)[+e.key - 1]; if (o) { e.preventDefault(); answerDec(card, o.dataset.dopt); } }
  });

  // Live changes in the workspace arrive here as the Manager's own record.
  // Each turn of the Manager says why it woke, and, when it could start nothing, why the next ticket still waits.
  document.addEventListener('poise:mgr-turn', (e) => {
    const { why, started } = e.detail, next = MGR.next[0], done = workers().find((c) => c.finished && !c.closed);
    if (!started.length) event(`Woken: ${why}. ${next ? (slotUse().used < MGR.limit ? `#${next.issue} waits: new work is paused or the Manager is on hold` : done ? `#${next.issue} still waits: every slot is held, and ${done.worker}’s task has ended; close its chat to free one` : `#${next.issue} waits for a slot`) : 'Nothing waits for a slot'}`);
    refresh();
  });
  document.addEventListener('poise:chats', (e) => {
    const { id, from: was, state, why } = e.detail, c = byId(id);
    if (c?.worker && c.worker !== 'Worker' && was !== state) {
      const u = slotUse();
      if (state === 'needs-you') { if (id === 'w3') { DEC.w3.at = clock(); SB.staleQ = false; } event(`<b>${c.worker}</b> ${c.note || 'asks you something'}: it is in the Switchboard`); }
      else if (state === 'running' && why === 'started in a free slot') event(`Started <b>${c.worker}</b> on ${shortTitle(c)} in a free slot: ${u.used} of ${MGR.limit}`);
      else if (state === 'running') event(`<b>${c.worker}</b> ${why || 'is running again'}`);
      else if (state === 'idle' && c.closed) event(`<b>${c.worker}</b> is closed: ${why || 'its task ended'}; its slot is free${MGR.next[0] ? `, and #${MGR.next[0].issue} gets a worker on the Manager's next turn` : ''}`);
      else if (state === 'idle' && c.finished) event(`<b>${c.worker}</b> finished: ${why || c.finished}. It keeps its slot until you close its chat`);
      else if (state === 'waiting' && why) event(`<b>${c.worker}</b> ${why}; it keeps its slot`);
      else event(`<b>${c.worker}</b> is now ${stateText(c)}`);
    }
    refresh();
  });

  // ---------- Start ----------
  const snips = store.get('poise-settings-v1', {}).snippets || [];
  const charter = snips.find((n) => n.id === 'manager')?.text;
  // Numbered rules are the list; a paragraph after them, like the shipped closing line, follows it.
  const raw = charter ? charter.split('\n').map((l) => l.trim()).filter(Boolean) : [...POLICY.instructions.map((x, i) => `${i + 1}. ${x}`), POLICY.closing];
  const rules = raw.filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '')), after = raw.filter((l) => !/^\d+\.\s/.test(l));
  $('[data-mgr-instr]').innerHTML = rules.map((x) => `<li>${esc(x)}</li>`).join('');
  $('[data-mgr-instr]').insertAdjacentHTML('afterend', after.map((x) => `<p class="sil-after">${esc(x)}</p>`).join(''));
  $('[data-mgr-instr-n]').textContent = rules.length;
  renderStops('stability');
  renderStops('autonomy');
  // No Manager yet: the place still opens. The work table shows what the behaviors
  // carry, the Switchboard watches every chat, and the Manager is one new chat away.
  if (P.NO_MGR) {
    convo.classList.add('is-none');
    const head = $('[data-head-state]');
    head.dataset.state = 'idle';
    head.innerHTML = `<span data-term="state.idle">${term('state.idle')}</span> · not started`;
    $('[data-act="pause-mgr"]').hidden = true;
    $('.chat-head .ident').hidden = true;
    $('.chat-head .sgroups').hidden = true;
    $('[data-transcript]').innerHTML = '<section class="mgr-none" data-ref="mgr.none"><h2>No Manager yet</h2><p>The Manager files tickets, gives each to its own worker chat, and watches it until its pull request merges. Nothing starts until you start it, as a new chat of type Manager.</p><p>Meanwhile the work table shows what the behaviors carry, and the Switchboard watches every chat.</p><button class="btn-ghost is-primary" data-act="mgr-start" data-ref="mgr.start">Start the Manager</button></section>';
  }
  paintWake();
  refresh();
  if (params.get('table') === 'stale') staleTable();
  // Its model retired, the Manager waits until you choose another: ?manager=retired.
  if (params.get('manager') === 'retired') {
    const pick = $('[data-ref="hdr.model"]'), was = pick.textContent;
    P.shut('retired');
    setState('mgr', 'idle', 'its model was retired');
    $('.chat-head').insertAdjacentHTML('beforeend', `<p class="why is-attn sb-retired" role="status">The Manager’s model ${esc(was)} was retired. Choose another model to continue.</p>`);
    pick.removeAttribute('aria-disabled');
    pick.addEventListener('click', () => {
      if (!P.S.shut) return;
      pick.textContent = 'Opus 5.5';
      P.shut(null);
      $('.sb-retired')?.remove();
      setState('mgr', 'idle');
      const chip = $('[data-head-state]');
      chip.dataset.state = 'idle';
      chip.innerHTML = `<span data-term="state.idle">${term('state.idle')}</span>`;
      toast('The Manager now runs Opus 5.5, from its next turn.', 'idle');
    });
  }
  if (BACK && from !== 'chat') {
    const head = $('.chat-head .head-1');
    head.insertAdjacentHTML('afterbegin', `<a class="back" href="${BACK[0]}" data-ref="back"><i data-i="chev" class="sm"></i>Back to ${BACK[1]}</a>`);
    hydrateIcons(head);
  }
  if (params.get('peek')) { const r = $(`.wt-row[data-key="${params.get('peek')}"]`); r?.scrollIntoView({ block: 'center' }); r?.focus({ preventScroll: true }); }
  if (params.get('pane') === 'controls') showSheet('controls');
  if (params.get('pane') === 'memories') showSheet('memories');
  if (params.get('pane') === 'timers') showSheet('timers');
  // A link from the review opens the sheet that holds what it names.
  const wantRef = params.get('ref') || '';
  // Close shows only on a worker whose task has ended: the review shows W2 just after #471 merged.
  if (wantRef === 'mgr.close') { finishWorker('w2', 'merged #471', 'its pull request #471 merged'); open = 'w2'; renderTable(); }
  // The relay shows once you answer: the review answers W4's question with its recommended choice.
  if (wantRef === 'sb.relay') answerDec($('[data-dec="w4"]'), 'The note with the repro');
  if (['mgr.rhythm', 'mgr.slots', 'mgr.stability', 'mgr.autonomy', 'mgr.scope', 'mgr.paused', 'mgr.instructions', 'set.mgr.charter.edit'].includes(wantRef)) showSheet('controls');
  if (/^timers?\b|^timer\./.test(wantRef)) showSheet('timers');
  // On a narrow window the Switchboard floats over the work table instead of
  // taking a column, and it starts folded to its tab.
  const narrow = matchMedia('(max-width: 1199px)');
  const fit = () => {
    layout.classList.toggle('sb-float', narrow.matches);
    if (!SB.chosen) { SB.hidden = narrow.matches; layout.classList.toggle('sb-hidden', SB.hidden); $('.sb-tab').hidden = !SB.hidden; }
  };
  narrow.addEventListener('change', fit);
  fit();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && narrow.matches && !SB.hidden && e.target.closest?.('[data-sb]')) { e.preventDefault(); sbAct('sb-hide'); } });
  // On a very narrow window the Manager's chat and the work table take turns.
  $$('[data-mgr-pane]').forEach((b) => b.addEventListener('click', () => {
    layout.classList.toggle('show-work', b.dataset.mgrPane === 'work');
    $$('[data-mgr-pane]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  // The chat list folds away here unless you show it, so the three panes have room.
  if (!store.get('poise-mgr-list', false)) layout.classList.add('list-hidden');
  $$('[data-act="list"]').forEach((b) => b.addEventListener('click', () => setTimeout(() => store.set('poise-mgr-list', !layout.classList.contains('list-hidden')), 0)));
})();
