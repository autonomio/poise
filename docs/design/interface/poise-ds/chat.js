// Chat and Manager: the list, the conversation and the dock, shared by both views.
// Presentational only: a scripted workspace that behaves the way Poise would.
(() => {
  const { $, $$, store, params, esc, motion, secs, clock, nowAt, lifeHTML, lifeTo, toast, closeMenus } = window.PoiseShell;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const VIEW = document.body.dataset.view;
  const FROM = { overview: ['overview.html', 'Overview'], board: ['board.html', 'Board'], editor: ['editor.html', 'Editor'], observe: ['observe.html', 'Observe'], settings: ['settings.html', 'Settings'], manager: ['manager.html', 'the Manager'] }[params.get('back')];

  // Timers that Stop can cancel.
  let timers = [];
  const later = (ms, fn) => { const id = setTimeout(() => { timers = timers.filter((t) => t !== id); fn(); }, ms); timers.push(id); return id; };
  const cancelAll = () => { timers.forEach(clearTimeout); timers = []; };

  // ---------- The workspace ----------
  // The workspace's chats come from workspace-data.js, which Overview reads too.
  // ?manager=none: a workspace with no Manager yet, and so no workers. Its row stays
  // pinned, and opens the Manager place, which still holds the Switchboard.
  const NO_MGR = params.get('manager') === 'none';
  const CHATS = (window.POISE_CHATS || []).filter((x) => !NO_MGR || !x.worker).map((x) => (NO_MGR && x.manager ? { ...x, none: true, state: 'idle', t: '' } : { ...x }));
  const byId = (id) => CHATS.find((c) => c.id === id);
  // “Waiting for CI checks”, “Blocked until …”, but “Needs you · asks …”.
  const stateText = (c) => `${term('state.' + c.state)}${c.note ? (/^(for|until|on|since)\b/.test(c.note) ? ' ' : ' · ') + c.note : ''}`;

  // The Manager's slots, as main counts them (#675, #782): each of its workers
  // holds one from the moment it takes a task until its chat is closed, whether
  // it runs, waits for you, is blocked or sits between turns. The Manager's own
  // chat, chats you run and tickets not yet given to a worker never hold one.
  // This workspace runs Rhythm 7; the default is 5.
  // paused: you held the Manager's chat. Either it, or Pause new work in its controls, keeps the next ticket waiting.
  const MGR = { limit: Math.min(10, Math.max(1, +store.get('poise-mgr-rhythm', 7) || 7)), paused: false, get policyPaused() { return !!store.get('poise-mgr-paused', false); }, next: NO_MGR ? [] : (window.POISE_MANAGER?.next || []).map((x) => ({ ...x })) };
  const workers = () => CHATS.filter((c) => c.worker);
  // A worker holds its slot until its chat is closed; closed, it reads Idle · closed.
  const holds = (c) => c.worker && !c.closed && c.state !== 'done';
  function slotUse() {
    const w = workers().filter(holds);
    const running = w.filter((c) => c.state === 'running').length, paused = w.filter((c) => c.state === 'needs-you').length, blocked = w.filter((c) => c.state === 'blocked' || c.state === 'failed').length, finished = w.filter((c) => c.finished).length;
    return { used: w.length, running, paused, blocked, finished, between: w.length - running - paused - blocked - finished, waiting: MGR.next.length };
  }
  // On the Manager's turns only (a wake-up, a message, or a wake from Poise such
  // as a merge), a free slot goes to the next ticket, as a new worker. Raising
  // Rhythm or closing a worker frees a slot; the next turn fills it.
  function schedule() {
    if (MGR.paused || MGR.policyPaused) return;
    while (slotUse().used < MGR.limit && MGR.next.length) {
      const t = MGR.next.shift(), n = Math.max(0, ...workers().map((c) => Number(String(c.worker).slice(1)) || 0)) + 1;
      CHATS.push({ id: `w${n}`, worker: `W${n}`, title: t.title, issue: t.issue, state: 'waiting', note: 'starting', who: 'Muse · spark 1.3 contributor', at: nowAt(), t: clock(), project: t.project });
      setState(`w${n}`, 'running', undefined, 'started in a free slot');
    }
  }
  function mgrSummary() {
    const u = slotUse(), parts = [];
    if (MGR.paused) parts.push('on hold');
    else if (MGR.policyPaused) parts.push('new work paused');
    if (u.paused) parts.push(`${u.paused} need${u.paused > 1 ? '' : 's'} you`);
    if (u.waiting) parts.push(`${u.waiting} next for a slot`);
    if (u.used > MGR.limit) parts.push(`${u.used - MGR.limit} finishing over the limit`);
    return parts.join(' · ') || 'all slots in use as planned';
  }

  // ---------- The list ----------
  const listEl = $('.list'), list = $('[data-list]');
  const LABELS = { attention: 'Attention', recent: 'Recent activity', project: 'Project', manual: 'Manual' };
  const RANK = { 'needs-you': 0, blocked: 1, failed: 2, running: 3, waiting: 4, idle: 5, done: 5 };
  const GROUPS = [['needs-you', 'paused for your decision'], ['blocked', 'a prerequisite is missing'], ['failed', 'the last turn ended in an error'], ['running', 'working now'], ['waiting', 'on checks, a slot or a provider'], ['rest', 'most recent first']];
  let order = LABELS[store.get('poise-chat-order', 'attention')] ? store.get('poise-chat-order', 'attention') : 'attention';
  if (LABELS[params.get('order')]) order = params.get('order');
  let manual = store.get('poise-chat-manual', null);
  let selected = document.body.dataset.selected;
  let held = 0, inList = false;

  function rowHTML(c) {
    const sel = c.id === selected;
    let meta;
    if (c.manager && c.none) meta = '<span class="who">Not started · the Switchboard is here</span>';
    else if (c.manager) {
      const u = slotUse();
      meta = `<span class="wk is-mgr">${u.used}/${MGR.limit} slots</span><span class="who">${mgrSummary()}</span>`;
    } else {
      const word = term('state.' + c.state);
      meta = `${c.worker ? `<span class="wk" data-ref="row.worker">${c.worker}</span>` : ''}<span class="sw-word">${word}${c.note ? '' : ' ·'}</span>${c.note ? `<span class="note">${c.note}</span>` : `<span class="who">${c.who}</span>`}`;
    }
    // The chat that created this one, when another chat did: by name while it exists, marked once it is gone.
    const maker = c.from && byId(c.from), from = maker ? `from chat “${maker.title}”` : c.fromGone ? `from a deleted chat “${c.fromGone}”` : '';
    return `<div class="row${c.manager ? ' is-manager' : ''}${sel ? ' is-selected' : ''}" role="listitem" tabindex="0" data-id="${c.id}" data-ref="${c.manager ? 'row.manager' : 'row'}"${order === 'manual' && !c.manager ? ' draggable="true"' : ''}${sel ? ' aria-current="true"' : ''}>
      <span class="sc" data-state="${c.state}" data-ref="state"></span>
      <div class="row-main"><div class="row-title">${c.title}</div><div class="row-meta">${meta}</div>${from ? `<div class="row-from" data-ref="row.from">${from}</div>` : ''}</div>
      <div class="row-side"><time>${c.t}</time>${c.manager ? '' : '<button class="ib del" data-act="del" aria-label="Delete chat" data-ref="row.delete"><i data-i="cross" class="sm"></i></button>'}</div></div>`;
  }
  function groups() {
    const rest = CHATS.filter((c) => !c.manager);
    const recent = (a, b) => b.at - a.at;
    const attention = (a, b) => RANK[a.state] - RANK[b.state] || recent(a, b);
    if (order === 'recent') return [['', [...rest].sort(recent)]];
    if (order === 'manual') {
      const ids = (manual || []).filter((id) => byId(id));
      return [['', [...ids.map(byId), ...rest.filter((c) => !ids.includes(c.id)).sort(attention)]]];
    }
    if (order === 'project') return [...new Set(rest.map((c) => c.project))].sort().map((p) => [p, rest.filter((c) => c.project === p).sort(attention), 'by attention']);
    return GROUPS.map(([k, gloss]) => [k, rest.filter((c) => (k === 'rest' ? RANK[c.state] === 5 : c.state === k)).sort(recent), gloss]).filter((g) => g[1].length);
  }
  function headHTML(k, n, gloss) {
    const label = order === 'project' ? k : k === 'rest' ? `${term('state.idle')} · ${term('state.done')}` : term('state.' + k);
    return `<div class="g-head" data-ref="list.group"><span class="t-micro">${label}</span><span class="t-gloss">${gloss}</span><span class="n">${n}</span></div>`;
  }
  function render(animate = true) {
    if (!list) return;
    const before = new Map($$('.row', list).map((r) => [r.dataset.id, r.getBoundingClientRect().top]));
    const focusId = document.activeElement?.closest?.('.row')?.dataset.id;
    listEl.dataset.order = order;
    listEl.dataset.grouped = String(order === 'attention' || order === 'project');
    list.innerHTML = `<div class="pin">${rowHTML(byId('mgr'))}</div>${groups().map(([k, rows, gloss]) => `<section class="g">${k ? headHTML(k, rows.length, gloss) : ''}<div class="g-list">${rows.map(rowHTML).join('')}</div></section>`).join('')}`;
    hydrateIcons(list);
    $('[data-order-label]').textContent = LABELS[order];
    $$('#order-menu [data-order]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.order === order)));
    if (focusId) $(`.row[data-id="${focusId}"]`, list)?.focus({ preventScroll: true });
    const m = motion();
    if (!animate || !m.duration) return;
    $$('.row', list).forEach((r) => {
      const was = before.get(r.dataset.id);
      if (was == null) { r.animate([{ opacity: 0 }, { opacity: 1 }], m); return; }
      const dy = was - r.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], m);
    });
  }

  // Stability: live changes update a row where it stands; positions wait until
  // your pointer and focus have left the list.
  // A reference open on a row also holds the list: the row it explains must not be replaced.
  const busy = () => inList || (listEl && listEl.contains(document.activeElement)) || !!$('.rename', listEl || document) || !!$('.ref-layer');
  function showHeld() {
    const h = $('[data-ref="list.held"]');
    if (!h) return;
    h.hidden = !held;
    h.textContent = `${held} update${held > 1 ? 's' : ''} held`;
  }
  function flush() { if (!held || busy()) return; held = 0; showHeld(); render(); }
  function refreshRow(id) {
    const row = list && $(`.row[data-id="${id}"]`, list), c = byId(id);
    if (!row || !c) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = rowHTML(c);
    row.innerHTML = tmp.firstElementChild.innerHTML;
    hydrateIcons(row);
  }
  // A worker whose task has ended stays open and keeps its slot: only you close a
  // chat, as on main. Closed, it reads Idle · closed and its slot is free.
  function finishWorker(id, ended, why) { const c = byId(id); if (!c) return; c.finished = ended; setState(id, 'idle', `${ended} · keeps its slot until you close it`, why); }
  function closeWorker(id, why, ended) { const c = byId(id); if (!c) return; Object.assign(c, { closed: true, ended }); setState(id, 'idle', 'closed', why); }
  // The Manager takes a turn: it gives free slots their tickets, and the Manager place says why it woke.
  function managerTurn(why) { const before = workers().length; schedule(); document.dispatchEvent(new CustomEvent('poise:mgr-turn', { detail: { why, started: workers().slice(before) } })); }
  function setState(id, state, note, why) {
    const c = byId(id);
    if (!c) return;
    const from = c.state;
    Object.assign(c, { state, note, at: nowAt(), t: clock() });
    if (busy()) {
      held++;
      refreshRow(id);
      refreshRow('mgr');
      $(`.row[data-id="${id}"]`, list)?.classList.add('is-changed');
      showHeld();
    } else render();
    document.dispatchEvent(new CustomEvent('poise:chats', { detail: { id, from, state, why } }));
  }
  if (listEl) {
    listEl.addEventListener('pointerenter', () => { inList = true; });
    listEl.addEventListener('pointerleave', () => { inList = false; flush(); });
    listEl.addEventListener('focusout', () => setTimeout(flush, 0));
    document.addEventListener('poise:ref', (e) => { if (!e.detail.open) setTimeout(flush, 0); });
  }

  // Opening a chat. The Manager and its workers open in the Manager view.
  const API = {};
  function select(id) {
    const c = byId(id);
    if (!c) return;
    if (API.onSelect && API.onSelect(c) === false) return;
    mark(id);
  }

  // Several at once: Shift-click selects a range, ⌘- or Ctrl-click toggles one,
  // and one confirmation names the count. The rows go at once; a failure brings
  // its row back with the reason.
  const picked = new Set();
  let anchor = null;
  const bar = $('[data-bulk]');
  function paintPicked() {
    $$('.row', list).forEach((r) => r.classList.toggle('is-picked', picked.has(r.dataset.id)));
    if (!bar) return;
    bar.hidden = !picked.size;
    $('[data-bulk-n]', bar).textContent = `${picked.size} chat${picked.size === 1 ? '' : 's'} selected`;
    const del = $('[data-act="bulk-del"]', bar);
    del.classList.remove('is-armed');
    del.textContent = `Delete ${picked.size}`;
  }
  function bulkDelete(btn) {
    if (!btn.classList.contains('is-armed')) { btn.classList.add('is-armed'); btn.textContent = `Sure? Delete ${picked.size}`; return; }
    const gone = [...picked].map(byId).filter(Boolean);
    picked.clear();
    gone.forEach((c) => CHATS.splice(CHATS.indexOf(c), 1));
    if (gone.some((c) => c.id === selected)) API.onDeleteSelected?.();
    render();
    paintPicked();
    toast(`Deleting ${gone.length} chats…`, 'running');
    // One cleanup fails: its row comes back, saying why.
    const back = gone.find((c) => c.id === 'c453');
    setTimeout(() => {
      if (back) { CHATS.push(Object.assign(back, { note: 'could not be deleted: its workspace is still in use', at: nowAt() })); render(); }
      toast(back ? `Deleted ${gone.length - 1} of ${gone.length}. “${back.title}” is back in the list: its workspace is still in use.` : `Deleted ${gone.length} chats. Their pull requests and pushed commits are unchanged.`, back ? 'failed' : 'done');
    }, 1600);
  }
  bar?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'bulk-del') bulkDelete(b);
    if (b.dataset.act === 'bulk-clear') { picked.clear(); paintPicked(); }
  });
  list?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-act="del"]');
    const row = e.target.closest('.row');
    if (!row || e.target.closest('.rename')) return;
    if (del) { armDelete(del, row.dataset.id); return; }
    const id = row.dataset.id;
    if ((e.metaKey || e.ctrlKey || e.shiftKey) && id !== 'mgr') {
      e.preventDefault();
      if (e.shiftKey && anchor) {
        const ids = $$('.row', list).map((r) => r.dataset.id).filter((x) => x !== 'mgr'), a = ids.indexOf(anchor), b = ids.indexOf(id);
        ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => picked.add(x));
      } else if (picked.has(id)) picked.delete(id); else picked.add(id);
      anchor = id;
      paintPicked();
      return;
    }
    if (picked.size) { picked.clear(); paintPicked(); }
    anchor = id;
    select(id);
  });
  list?.addEventListener('dblclick', (e) => { const row = e.target.closest('.row'); if (row && !e.target.closest('.del')) rename(row); });
  list?.addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('.rename')) return;
    // From the keyboard too: ⌘- or Ctrl-Space toggles a chat, Shift-Space selects a range.
    if (e.key === ' ' && (e.metaKey || e.ctrlKey || e.shiftKey) && row.dataset.id !== 'mgr') { e.preventDefault(); row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })); row.focus(); return; }
    if (e.key === 'Enter' && e.target === row) { e.preventDefault(); select(row.dataset.id); }
    if (e.key === 'F2') { e.preventDefault(); rename(row); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = $$('.row', list), i = rows.indexOf(row);
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }
  });

  function rename(row) {
    const c = byId(row.dataset.id);
    if (!c || c.manager) return;
    const t = $('.row-title', row);
    t.innerHTML = `<input class="rename" aria-label="Chat title" value="${c.title.replace(/"/g, '&quot;')}">`;
    const input = $('input', t);
    input.focus();
    input.select();
    const done = (save) => { if (save && input.value.trim()) { c.title = input.value.trim(); toast(`Renamed to “${c.title}”`); } input.remove(); render(false); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => input.isConnected && done(true));
  }

  const removesWorkspace = (id) => id === 'c-new';
  function armDelete(btn, id) {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Sure?';
      // It says whether the workspace goes too: only a sole local chat, whose branch never moved and whose tree is clean, takes it along.
      const words = removesWorkspace(id) ? 'also removes its workspace' : 'keeps its workspace';
      btn.title = `Confirm delete (${words})`;
      btn.setAttribute('aria-label', `Confirm deleting chat (${words})`);
      setTimeout(() => { if (btn.isConnected && btn.classList.contains('is-armed')) { btn.classList.remove('is-armed'); btn.removeAttribute('title'); btn.setAttribute('aria-label', 'Delete chat'); btn.innerHTML = '<i data-i="cross" class="sm"></i>'; hydrateIcons(btn); } }, 3000);
      return;
    }
    const c = byId(id);
    CHATS.splice(CHATS.indexOf(c), 1);
    toast(`Deleted “${c.title}”; its workspace was ${removesWorkspace(id) ? 'removed' : 'kept'}. Its pull requests and pushed commits are unchanged.`);
    if (id === selected) API.onDeleteSelected?.();
    render();
  }

  // Manual order: drag rows to arrange them.
  let dragId = null;
  list?.addEventListener('dragstart', (e) => { const row = e.target.closest('.row[draggable="true"]'); if (!row) return; dragId = row.dataset.id; row.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
  list?.addEventListener('dragover', (e) => {
    const row = e.target.closest('.row[draggable="true"]');
    if (!row || !dragId) return;
    e.preventDefault();
    $$('.is-drop-before', list).forEach((r) => r !== row && r.classList.remove('is-drop-before'));
    row.classList.add('is-drop-before');
  });
  list?.addEventListener('drop', (e) => {
    const row = e.target.closest('.row[draggable="true"]');
    if (!row || !dragId) return;
    e.preventDefault();
    const ids = $$('.row[draggable="true"]', list).map((r) => r.dataset.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(row.dataset.id), 0, dragId);
    manual = ids;
    store.set('poise-chat-manual', manual);
    render();
  });
  list?.addEventListener('dragend', () => { dragId = null; $$('.is-dragging, .is-drop-before', list).forEach((r) => r.classList.remove('is-dragging', 'is-drop-before')); });

  // The list's width and visibility belong to this browser.
  const layout = $('.chat-layout');
  const handle = $('.list-resize');
  const setListWidth = (w) => { if (w == null) { layout.style.removeProperty('--w-list'); store.set('poise-list-w', null); return; } w = Math.max(200, Math.min(480, Math.round(w))); layout.style.setProperty('--w-list', `${w}px`); store.set('poise-list-w', w); };
  if (layout && store.get('poise-list-w', null)) setListWidth(store.get('poise-list-w', null));
  handle?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    const x0 = e.clientX, w0 = listEl.getBoundingClientRect().width;
    const move = (ev) => setListWidth(w0 + ev.clientX - x0);
    const up = () => { handle.classList.remove('is-dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle?.addEventListener('dblclick', () => setListWidth(null));
  handle?.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setListWidth(listEl.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16)); } });
  // The toggle lives in the view, so the top bar is the same in every view:
  // hide from the list's own header, show again from the conversation's.
  function showList(on, moveFocus) {
    layout?.classList.toggle('list-hidden', !on);
    $$('[data-act="list"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    store.set('poise-list-hidden', !on);
    if (moveFocus) $(on ? '.list-head [data-act="list"]' : '.show-list')?.focus({ preventScroll: true });
  }
  if (store.get('poise-list-hidden', false)) showList(false);
  // On a very narrow window the list floats over the conversation, folded until you ask for it, and a chosen row folds it again.
  const narrowList = matchMedia('(max-width: 760px)');
  if (narrowList.matches && VIEW === 'chat') { layout?.classList.add('list-hidden'); $$('[data-act="list"]').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
  list?.addEventListener('click', (e) => { if (narrowList.matches && e.target.closest('.row') && !e.target.closest('[data-act="del"], .rename')) layout?.classList.add('list-hidden'); });

  // ---------- Menus: the shell opens them; this view handles its picks ----------
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('#order-menu [data-order]');
    if (pick) { order = pick.dataset.order; store.set('poise-chat-order', order); closeMenus(); render(); return; }
    const hand = e.target.closest('#handoff-menu [data-handoff]');
    if (hand) { closeMenus(); API.onHandoff?.(hand.dataset.handoff); }
  });


  // The scripted workspace moves on its own: a worker asks, another finishes.
  // W3 asks at t1; the bell counts it from Overview's data, which raises the same question at the same moment.
  setTimeout(() => setState('w3', 'needs-you', 'asks which filter wins', 'asked a question'), +(params.get('t1') || 7000));
  // #471 merges: W2's task has ended, but W2 keeps its slot until you close it; Poise wakes the Manager with the merge.
  setTimeout(() => { finishWorker('w2', 'merged #471', 'its pull request #471 merged'); managerTurn('Poise woke it: #471 merged'); }, +(params.get('t2') || 16000));

  // ---------- The conversation ----------
  const ordinal = (n) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
  const durText = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
  const convo = $('.convo'), scroller = $('[data-scroll]'), transcript = $('[data-transcript]');
  const form = $('[data-composer]'), ta = form && $('textarea', form);
  const S = { state: convo?.dataset.chatState || 'idle', last: Date.now() - 8000, stopped: false, turn: $('[data-active-turn]'), turnStart: secs() - 200, agent: 'Muse', model: 'spark 1.3 contributor', effort: 'max', scrollTop: 0 };


  // The situation, in three registers: observed, intended, estimated.
  function tickAsOf() {
    const el = $('[data-asof]');
    if (!el) return;
    const s = Math.floor((Date.now() - S.last) / 1000);
    el.textContent = s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
  }
  function setSit({ now, next, wait, dec, est }) {
    const q = (k) => $(`[data-sit-${k}]`);
    if (!q('now')) return;
    q('now').textContent = now;
    q('next').textContent = next || 'Nothing planned';
    q('next').classList.toggle('int', !!next);
    q('next').classList.toggle('t-muted', !next);
    q('wait').textContent = wait || 'Nothing';
    q('dec').innerHTML = dec ? `<button class="dec-btn" data-act="goto-req">${dec}</button>` : '<span class="t-muted">None needed</span>';
    const e = $('[data-est]');
    e.hidden = !est;
    if (est) e.textContent = est;
    S.last = Date.now();
    tickAsOf();
  }

  function setChat(state, note) {
    S.state = state;
    convo.dataset.chatState = state;
    const chip = $('[data-head-state]');
    chip.dataset.state = state;
    chip.innerHTML = `<span data-term="state.${state}">${term('state.' + state)}</span>`;
    const active = state === 'running' || state === 'needs-you';
    $('[data-act="stop"]').hidden = !active;
    $('[data-act="fork"]').setAttribute('aria-disabled', String(active));
    $$('[data-ref="hdr.model"], [data-ref="hdr.effort"]').forEach((b) => b.setAttribute('aria-disabled', String(active)));
    const dots = S.turn && $('[data-dots]', S.turn);
    if (dots) dots.hidden = state !== 'running';
    $('[data-deploy] .spin')?.toggleAttribute('hidden', state !== 'running');
    form.classList.toggle('is-steering', state === 'running');
    ta.placeholder = placeholder();
    if (byId('c475')) setState('c475', state, note);
  }

  const addStop = (html) => {
    const route = $('[data-route]', S.turn);
    const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const el = tmp.firstElementChild;
    el.classList.add('settle');
    route.insertBefore(el, $('[data-dots]', route));
    hydrateIcons(el);
    window.poisePaintTerms?.(el);
    if (stick) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    S.last = Date.now();
    return el;
  };
  const toolHTML = (icon, title, out, running) => `<div class="stop ${running ? 'is-live' : 'is-ok'} activity"><div class="tool${running ? ' is-running' : ''} open"><button class="tool-h" data-act="tool" aria-expanded="true" data-ref="tool"><i data-i="${icon}" class="sm"></i><span class="ttl">${title}</span><span class="el" data-ref="tool.elapsed"${running ? ' data-elapsed="0"' : ''}>${running ? '0s' : '1.2s'}</span>${running ? '<span class="spin"></span>' : '<i data-i="check" class="sm ok"></i>'}</button><div class="tool-b"><span class="t-micro">Output</span><div class="pre">${out}</div>${running ? '' : '<span class="exit">exit 0</span>'}</div></div></div>`;
  const prose = (html) => `<div class="stop is-prose"><div class="md"><p>${html}</p></div><button class="copy" data-act="copy" data-ref="copy"><i data-i="copy" class="sm"></i><span>Copy</span></button></div>`;
  const diffHTML = (file, del, add) => `<div class="stop is-ok activity"><div class="diff" data-ref="diff"><div class="diff-h"><i data-i="edit" class="sm"></i><span class="t-mono">${file}</span><button class="btn-ghost" data-act="revert" data-ref="diff.revert">Revert</button></div><div class="diff-b"><div class="dl del">− ${del}</div><div class="dl add">+ ${add}</div></div></div></div>`;
  function finishTool(step, el, more) {
    step.className = 'stop is-ok activity';
    $('.tool', step).classList.remove('is-running');
    const e = $('.el', step);
    e.removeAttribute('data-elapsed');
    e.textContent = el;
    const spin = $('.spin', step);
    if (spin) { spin.outerHTML = '<i data-i="check" class="sm ok"></i>'; hydrateIcons(step); }
    if (more) $('.pre', step).textContent += `\n${more}`;
    $('.tool-b', step).insertAdjacentHTML('beforeend', '<span class="exit">exit 0</span>');
  }

  const DEPLOY = ['Implement', 'Checks', 'CI', 'Merge', 'Verify', 'Live'];
  function deploy(stage, pr, text) {
    const i = DEPLOY.indexOf(stage), el = $('[data-stage]');
    if (!el) return;
    el.innerHTML = DEPLOY.map((s, k) => `${k ? `<b${k <= i ? ' class="d"' : ''}></b>` : ''}${k === i ? `<em>${s}</em>` : `<i${k < i ? ' class="d"' : ''}></i>`}`).join('');
    $('[data-stage-gloss]').textContent = i < DEPLOY.length - 1 ? `then ${DEPLOY.slice(i + 1).join(', ')}` : 'done';
    if (pr) $('[data-deploy-pr]').textContent = pr;
    if (text) $('[data-deploy-text]').textContent = text;
  }

  // Answering the permission resumes the turn.
  const PERM = { allow: ['Allowed once', 'is-done'], always: ['Always allowed in this session', 'is-done'], deny: ['Denied', 'is-failed'] };
  function resolveReq(req, opt, label, cls, by) {
    req.classList.remove('is-focused');
    req.classList.add('is-resolved');
    $$('.opt', req).forEach((b) => { b.setAttribute('aria-disabled', 'true'); b.classList.toggle('is-chosen', b.dataset.opt === opt); });
    req.insertAdjacentHTML('beforeend', `<div class="req-acts"><span class="chip ${cls}">${label}</span><span class="why">${by} · ${clock()}</span></div>`);
    req.closest('.stop').className = 'stop is-resolved activity';
  }
  function answer(opt) {
    const req = S.turn && $('[data-req]', S.turn);
    if (!req || req.classList.contains('is-resolved') || !PERM[opt]) return;
    resolveReq(req, opt, PERM[opt][0], PERM[opt][1], 'by you');
    setChat('running');
    $$('[data-steer-life][data-held]', S.turn).forEach((l) => { delete l.dataset.held; lifeTo(l, 'Executing', 'received with your answer'); });
    if (opt === 'deny') {
      setSit({ now: 'Permission denied: not opening the pull request', next: 'End the turn', wait: 'Nothing', est: '' });
      later(900, () => { addStop(prose('Understood: I won’t open the pull request. The branch <code>fix/browser-shard-timeout</code> is pushed and ready when you are.')); later(900, () => completeTurn()); });
      return;
    }
    setSit({ now: 'Running gh pr create', next: 'Post the result on #475', wait: 'Nothing', est: '' });
    const step = addStop(toolHTML('term', 'gh pr create --fill --base main', 'Creating pull request for fix/browser-shard-timeout into main in autonomio/poise', true));
    later(2600, () => {
      finishTool(step, '2.6s', 'https://github.com/autonomio/poise/pull/481');
      deploy('CI', 'autonomio/poise#481 · Raise the PR-run browser shard limit', 'CI running on the exact head');
      setSit({ now: 'Opened autonomio/poise#481', next: 'Post the result on #475', wait: 'Nothing', est: '' });
      later(1500, () => {
        addStop(prose('Opened <code>autonomio/poise#481</code>. CI is running on the exact head; the release controller merges it when it is green. I posted the Firefox result on #475.'));
        later(1200, () => completeTurn());
      });
    });
  }

  function completeTurn(stopped) {
    const t = S.turn;
    if (!t) return;
    const dur = Math.max(1, secs() - S.turnStart);
    lifeTo($('[data-turn-life]', t), 'Completed', stopped ? 'stopped by you' : clock());
    $$('[data-steer-life]', t).forEach((l) => lifeTo(l, 'Completed', stopped ? 'turn stopped' : '', !!$('i.skip', l)));
    const foot = $('[data-turn-foot]', t);
    foot.hidden = false;
    foot.innerHTML = `${stopped ? '<span class="stopped">Stopped</span>' : `<span class="t-mono" title="Finished Friday 23 October 2026 at ${clock()} EEST">${clock()}</span>`}<span class="ft-activity">· ${durText(dur)} · ${(12000 + dur * 230).toLocaleString('en-US')} tokens</span>`;
    $('[data-dots]', t)?.remove();
    t.removeAttribute('data-active-turn');
    S.turn = null;
    setChat('idle', stopped ? 'stopped by you' : undefined);
    setSit(stopped
      ? { now: `Stopped by you at ${clock()}`, next: '', wait: queueCount() ? 'You, to resume the queue' : 'Nothing', est: '' }
      : { now: `Turn ended at ${clock()}`, next: queueCount() ? 'Start the next queued instruction' : '', wait: 'Nothing', est: '' });
    if (stopped) { showResume(queueCount() > 0); return; }
    if (queueCount()) later(1000, startNext);
  }

  function newTurn(html, src, skipQueued) {
    const sec = document.createElement('section');
    sec.className = 'turn settle';
    sec.dataset.activeTurn = '';
    sec.innerHTML = `${src ? `<div class="src" data-ref="msg.src">${src}</div>` : ''}<div class="ticket" data-ref="msg.you">${html}<div class="life" data-ref="life" data-turn-life></div></div><div class="route" data-route><div class="stop is-prose" data-dots><span class="dots"><i></i><i></i><i></i></span></div></div><div class="foot" data-ref="foot" data-turn-foot hidden></div>`;
    transcript.append(sec);
    lifeTo($('[data-turn-life]', sec), skipQueued ? 'Accepted' : 'Executing', skipQueued ? clock() : `since ${clock()}`, skipQueued);
    if (skipQueued) later(500, () => lifeTo($('[data-turn-life]', sec), 'Executing', `since ${clock()}`, true));
    S.turn = sec;
    S.turnStart = secs();
    setChat('running');
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }

  const SCRIPTS = {
    review: [
      [1200, () => addStop(toolHTML('read', 'read .github/workflows/browser.yml', '72 lines', false)), { now: 'Read the workflow change', next: 'Check the condition for merge-queue runs', est: '' }],
      [2600, () => addStop(prose('The condition is right for <code>pull_request</code> runs. Merge-queue runs fall back to 15 minutes, which keeps main strict. Say if merge-queue runs should get 30 minutes too.')), { now: 'Wrote the review', next: 'End the turn', est: '' }],
      [1400, 'complete']
    ],
    docs: [
      [1200, () => addStop(diffHTML('docs/Testing.md', 'Browser shards time out after 15 minutes.', 'Browser shards time out after 30 minutes on pull requests and 15 on main.')), { now: 'Edited docs/Testing.md', next: 'Commit and push to the pull request branch', est: '' }],
      [1800, () => addStop(toolHTML('term', 'git commit -am "Document the PR-run shard limit" &amp;&amp; git push', '[fix/browser-shard-timeout 5c21e9a] Document the PR-run shard limit', false)), { now: 'Pushed 5c21e9a to #481', next: 'End the turn', est: '' }],
      [1500, () => addStop(prose('Documented the new limit in <a class="file" tabindex="0" data-act="file" data-ref="file">docs/Testing.md:57</a> and pushed it to #481.')), null],
      [1200, 'complete']
    ],
    generic: [
      [1600, () => addStop(prose('Noted. In Poise the agent’s reply streams here; this mock answers with a short placeholder.')), { now: 'Replied', next: 'End the turn', est: '' }],
      [1000, 'complete']
    ]
  };
  function runScript(name, i = 0) {
    const step = SCRIPTS[name][i];
    if (!step) return;
    later(step[0], () => {
      if (step[1] === 'complete') { completeTurn(); return; }
      step[1]();
      if (step[2]) setSit({ wait: 'Nothing', ...step[2] });
      runScript(name, i + 1);
    });
  }

  function steer(text, held) {
    const el = addStop(`<div class="stop is-steer"><div class="ticket" data-ref="msg.steer"><span class="steer-tag" data-term="term.steer">Steer</span>${esc(text)}<div class="life" data-ref="life" data-steer-life></div></div></div>`);
    const life = $('[data-steer-life]', el);
    lifeTo(life, 'Accepted', clock());
    if (held) { life.dataset.held = '1'; setTimeout(() => life.dataset.held && lifeTo(life, 'Queued', 'the agent reads it after your answer'), 600); return; }
    setTimeout(() => life.dataset.life === 'Accepted' && lifeTo(life, 'Executing', 'received at the next step', true), 900);
  }

  function stop() {
    if (!(S.state === 'running' || S.state === 'needs-you')) return;
    cancelAll();
    S.stopped = true;
    const req = $('[data-req]:not(.is-resolved)', S.turn);
    if (req) resolveReq(req, '', 'Cancelled', 'is-outline', 'turn stopped');
    $$('.tool.is-running', S.turn).forEach((tool) => { tool.classList.remove('is-running'); const sp = $('.spin', tool); if (sp) { sp.outerHTML = '<i data-i="stopped" class="sm"></i>'; hydrateIcons(tool); } $('[data-elapsed]', tool)?.removeAttribute('data-elapsed'); });
    completeTurn(true);
    toast(queueCount() ? 'Stopped. The queue waits for you; Resume queue starts it.' : 'Stopped. Files already changed stay as they are.', 'idle');
  }

  // ---------- Queue ----------
  const qbox = $('[data-queue]'), qlist = $('[data-qlist]');
  const queueCount = () => (qlist ? $$('.q-item', qlist).length : 0);
  function renumber() {
    if (!qlist) return;
    const items = $$('.q-item', qlist);
    items.forEach((q, i) => { $('.n', q).textContent = i + 1; lifeTo($('.life', q), 'Queued', i === 0 ? 'next' : ordinal(i + 1)); });
    $('[data-qcount]').textContent = items.length;
    qbox.hidden = !items.length;
    if (!items.length) showResume(false);
  }
  const showResume = (on) => { const b = $('[data-act="resume"]'); if (b) b.hidden = !on; };
  function leave(el, then) {
    const m = motion('--dur-feedback');
    const done = () => { el.remove(); then?.(); };
    if (!m.duration) { done(); return; }
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: m.duration * 2, easing: 'ease-out' }).onfinish = done;
  }
  function addQueue(text) {
    qlist.insertAdjacentHTML('beforeend', `<div class="q-item settle" data-script="generic"><span class="n"></span><div class="q-body"><div class="txt">${esc(text)}</div><div class="meta"><button class="pick" data-ref="queue.model">${S.agent} · ${S.model} · ${S.effort}</button><span class="life" data-ref="life" data-life="Accepted"></span></div></div><button class="ib" data-act="q-remove" aria-label="Remove from queue" data-ref="queue.remove"><i data-i="cross" class="sm"></i></button></div>`);
    const item = qlist.lastElementChild;
    hydrateIcons(item);
    qbox.hidden = false;
    lifeTo($('.life', item), 'Accepted', clock());
    setTimeout(renumber, 600);
    qbox.classList.add('open');
    $('[data-act="queue"]').setAttribute('aria-expanded', 'true');
    if (S.state === 'idle' && !S.stopped) { toast('Accepted. Starting it now: nothing else is running.'); later(900, startNext); return; }
    toast(S.stopped ? 'Queued. The queue waits until you resume it.' : 'Queued. It runs after this turn, one at a time.', 'waiting');
  }
  function startNext() {
    const item = qlist && $('.q-item', qlist);
    if (!item) return;
    const txt = $('.txt', item).innerHTML, who = $('.pick', item).textContent, script = item.dataset.script || 'generic';
    item.remove();
    renumber();
    [S.agent, S.model, S.effort] = who.split(' · ');
    $('[data-ref="hdr.agent"] b').textContent = S.agent;
    $('[data-ref="hdr.model"]').textContent = S.model;
    $('[data-ref="hdr.effort"]').textContent = S.effort;
    newTurn(txt, `From queue · ${who}`);
    setSit({ now: 'Starting the queued instruction', next: script === 'review' ? 'Read the workflow change' : 'Make the change', wait: 'Nothing', est: '' });
    runScript(script);
  }

  // ---------- Away, fresh and back: dependable routes ----------
  function mark(id) {
    selected = id;
    document.body.dataset.selected = id;
    $$('.row', list).forEach((r) => { const on = r.dataset.id === id; r.classList.toggle('is-selected', on); on ? r.setAttribute('aria-current', 'true') : r.removeAttribute('aria-current'); });
  }
  function away(c) {
    if (!convo.classList.contains('is-away') && !convo.classList.contains('is-fresh')) S.scrollTop = scroller.scrollTop;
    convo.classList.remove('is-fresh', 'is-jev');
    convo.classList.add('is-away');
    $('[data-away-title]').textContent = c.title;
    const st = $('[data-away-state]');
    st.dataset.state = c.state;
    $('[data-away-word]').textContent = stateText(c);
    // This mock opens one chat in full; a chat that cannot take a turn shows its composer on #475.
    const kind = c.closed ? 'closed' : c.state === 'failed' ? 'failed' : '', see = $('[data-away-shut]');
    see.hidden = !kind;
    if (kind) { see.href = `chat.html?chat=${kind}`; see.textContent = `See how a ${kind} chat reads`; }
  }
  const placeholder = () => (S.shut ? S.shut.text : API.placeholder ? API.placeholder() : { running: 'Steer the active turn (Enter)', 'needs-you': 'Write to the agent; it reads this after your answer above (Enter)' }[S.state] || `Message ${S.agent} (Enter starts a turn)`);
  // A chat a link opened directly goes back to where the link was.
  let arrivedAway = VIEW === 'chat' && !!params.get('away');
  function back() {
    if (FROM && (convo.classList.contains('is-fresh') || (arrivedAway && convo.classList.contains('is-away')))) { location.href = FROM[0]; return; }
    arrivedAway = false;
    convo.classList.remove('is-away', 'is-fresh', 'is-jev');
    mark(API.home);
    scroller.scrollTop = S.scrollTop;
    ta.placeholder = placeholder();
  }
  function fresh() {
    if (!convo.classList.contains('is-away') && !convo.classList.contains('is-fresh')) S.scrollTop = scroller.scrollTop;
    convo.classList.remove('is-away', 'is-jev');
    convo.classList.add('is-fresh');
    mark('');
    // ?fallback=1: the default model cannot start, so the form says why and offers the one that can.
    if ((params.get('fallback') != null || params.get('ref') === 'new.fallback') && !$('[data-fallback]')) $('[data-newtype]')?.insertAdjacentHTML('beforebegin', '<fieldset class="newtype" data-fallback data-ref="new.fallback"><legend class="t-micro">Model provider</legend><p class="t-gloss">Opus 5 needs the Claude.ai sign-in (reauth_required); GPT-6 Astra is available</p><label><input type="radio" name="fallback" checked> Use the default, <code>Opus 5</code></label><label><input type="radio" name="fallback"> Use the fallback, <code>GPT-6 Astra</code></label></fieldset>');
    ta.placeholder = 'What should we work on? (Enter starts the chat)';
    ta.focus();
  }
  function addChat(c) { CHATS.push({ project: 'autonomio/poise', at: nowAt(), t: clock(), ...c }); render(); }

  // ---------- Clicks ----------
  const SWITCH_TOAST = {
    automerge: (on) => (on ? 'Auto-merge on. This chat merges its pull requests once checks pass; from its next decision.' : 'Auto-merge off. Merging waits for you.'),
    safemode: (on) => `Safe mode ${on ? 'on: the agent asks before risky steps' : 'off: native tools run with full access'}. ${/Codex|Grok/.test(S.agent) ? 'From the next turn.' : 'Takes effect now.'}`
  };
  const show = { activity: true, reasoning: false, tools: true, ...store.get('poise-show', {}) };
  function applyShow() {
    document.body.classList.toggle('hide-activity', !show.activity);
    document.body.classList.toggle('hide-reasoning', !show.reasoning);
    document.body.classList.toggle('hide-tools', !show.tools);
    $$('[data-act="activity"]').forEach((b) => b.setAttribute('aria-pressed', String(show.activity)));
    $$('[data-act="reasoning"]').forEach((b) => b.setAttribute('aria-pressed', String(show.reasoning)));
    $$('[data-act="tools"]').forEach((b) => b.setAttribute('aria-pressed', String(show.tools)));
  }
  function pane(on, kind = 'memories') {
    const panels = $$('.side [data-panel]');
    if (panels.length && VIEW === 'chat') {
      const open = on && layout.classList.contains('pane-open') && !$(`.side [data-panel="${kind}"]`)?.hidden ? false : on;
      layout.classList.toggle('pane-open', open);
      panels.forEach((p) => { p.hidden = p.dataset.panel !== kind; });
      $$('.sgrp [data-act="memories"]').forEach((b) => b.setAttribute('aria-pressed', String(open && kind === 'memories')));
      $$('.sgrp [data-act="timers"]').forEach((b) => b.setAttribute('aria-pressed', String(open && kind === 'timers')));
      if (open && kind === 'memories') $('[data-mem]')?.focus({ preventScroll: true });
      if (open && kind === 'timers') $('[data-panel="timers"] h3')?.focus({ preventScroll: true });
      return;
    }
    layout.classList.toggle('pane-open', on);
    $$('.sgrp [data-act="memories"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    if (on) $('[data-mem]')?.focus({ preventScroll: true });
  }
  // Timers, as main keeps them: each chat's own, with its schedule, who set it,
  // the message it sends, when it fires next and its state. The Manager's
  // wake-up is its own chat's timer, set in its header, so it has no Cancel.
  const wakeM = () => window.POISE_POLICY?.wake?.get() || 60;
  const TIMERS = VIEW === 'manager' ? [
    { id: 'wake', label: 'Manager wake-up', every: `every ${wakeM()} min`, next: window.POISE_POLICY?.wake?.next(wakeM()) || '20:00', state: 'active', system: true, by: 'you, in the Manager’s header', preview: 'Wake up and review the workspace from the work table.' },
    { id: 'm1', label: 'Check Acme/Limen#1141 for its review', every: 'every 30 min', next: '20:00', state: 'active', by: 'Manager', preview: 'Is Acme/Limen#1141 reviewed yet? If it is, unblock W5.' }
  ] : [
    { id: 't1', label: 'Check the browser gate', every: 'every 10 min', next: '19:50', state: 'active', by: 'this chat', preview: 'Read the browser gate’s result and post it on #475.' },
    { id: 't2', label: 'Re-run the flaky Safari shard', every: 'once, at 20:30', next: '20:30', state: 'active', by: 'you', preview: 'Re-run the Safari shard and say whether it passes twice in a row.' },
    { id: 't3', label: 'Poll the staging deploy', every: 'every 5 min', state: 'tripped', why: 'stopped after 3 failed turns: the endpoint answered 502. Re-arm it from Timers.', by: 'this chat', preview: 'Check whether staging serves the new build.' }
  ];
  let holdAll = false, holdChat = false, timerKind = 'once', nextTimer = 1;
  const timersDown = params.get('timers') === 'down';
  function paintTimers() {
    const box = $('[data-timers]');
    if (!box) return;
    const live = TIMERS.filter((t) => !t.gone);
    const d = $('[data-timers-d]');
    if (d) d.textContent = VIEW === 'manager' ? 'The Manager’s own timers: its wake-up, which you set in its header, and any it set itself.' : 'This chat’s timers, set by you, by this chat or by the Manager. A timer that fails three turns in a row stops itself and says why.';
    const down = $('[data-timers-down]');
    if (down) { down.hidden = !timersDown; down.innerHTML = timersDown ? `<span class="st" data-state="failed"><span data-term="state.failed">${term('state.failed')}</span></span> <span data-ref="timer.down">Timers are not running: the scheduler stopped at 19:30. Nothing fires until it runs again; Poise restarts it.</span>` : ''; }
    box.innerHTML = live.map((t) => {
      const held = (holdAll || holdChat) && t.state !== 'tripped';
      const st = timersDown && t.state !== 'tripped' ? ['waiting', 'the scheduler is not running'] : held ? ['waiting', holdAll ? 'held: all timers are on hold' : 'held: this chat is on hold'] : t.state === 'tripped' ? ['failed', t.why] : ['waiting', `for ${t.next}`];
      const acts = t.system ? '<span class="t-gloss">Interval set in the Manager’s header</span>' : `${t.state === 'tripped' ? `<button class="btn-ghost" data-act="timer-rearm" data-id="${t.id}" data-ref="timer.rearm">Re-arm</button>` : ''}<button class="btn-ghost" data-act="timer-cancel" data-id="${t.id}" data-ref="timer.cancel">Cancel</button>`;
      return `<li class="timer" data-ref="timer"><div class="timer-h"><b>${esc(t.label)}</b><span class="t-gloss">${esc(t.every)} · set by ${esc(t.by)}</span></div><p class="timer-p">${esc(t.preview)}</p><div class="timer-s"><span class="st" data-state="${st[0]}"><span data-term="state.${st[0]}">${term('state.' + st[0])}</span></span><span class="t-gloss">${esc(st[1])}</span></div><div class="timer-a">${acts}</div></li>`;
    }).join('') || '<li class="t-gloss">No timers on this chat yet.</li>';
    hydrateIcons(box);
    $$('[data-act="timers"] .n').forEach((n) => { n.textContent = live.length; });
    $('[data-act="timer-hold"]')?.setAttribute('aria-pressed', String(holdAll));
    $('[data-act="timer-holdchat"]')?.setAttribute('aria-pressed', String(holdChat));
    const heldNote = $('[data-timer-held]');
    if (heldNote) heldNote.hidden = !(holdAll || holdChat);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act^="timer-"]');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const t = TIMERS.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === 'timer-hold') { holdAll = !holdAll; paintTimers(); toast(holdAll ? 'Every timer is on hold, the Manager’s wake-up included. Nothing fires until you resume them.' : 'Timers resumed. Each fires at its next time.', holdAll ? 'waiting' : 'running'); return; }
    if (b.dataset.act === 'timer-holdchat') { holdChat = !holdChat; paintTimers(); if (VIEW === 'manager') API.onChatHold?.(holdChat); toast(holdChat ? 'This chat is on hold: its timers skip their firings, and turns other chats would start in it wait.' : 'This chat resumed: its timers fire at their next times.', holdChat ? 'waiting' : 'running'); return; }
    if (b.dataset.act === 'timer-kind') { timerKind = b.dataset.v; $$('[data-act="timer-kind"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === timerKind))); return; }
    if (b.dataset.act === 'timer-add') {
      const f = b.closest('[data-timer-add]'), label = $('[data-t="label"]', f).value.trim(), message = $('[data-t="message"]', f).value.trim(), mins = $('[data-t="minutes"]', f).value.trim();
      if (!label || !message) { (label ? $('[data-t="message"]', f) : $('[data-t="label"]', f)).focus(); toast('A timer needs a label and the message it sends.', 'failed'); return; }
      if (!/^\d+$/.test(mins) || +mins < 1) { $('[data-t="minutes"]', f).focus(); toast('The minutes must be a whole number, at least 1.', 'failed'); return; }
      const at = (() => { const [h, m] = clock().split(':').map(Number), x = h * 60 + m + +mins; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; })();
      TIMERS.push({ id: `n${nextTimer++}`, label, every: timerKind === 'once' ? `once in ${mins} min` : `every ${mins} min`, next: at, state: 'active', by: 'you', preview: message });
      ['label', 'message'].forEach((k) => { $(`[data-t="${k}"]`, f).value = ''; });
      paintTimers();
      toast(holdAll || holdChat ? `Timer “${label}” set. It starts when you resume.` : `Timer “${label}” set. It fires at ${at}.`, 'done');
      return;
    }
    if (b.dataset.act === 'timer-rearm' && t) { Object.assign(t, { state: 'active', next: clock() }); paintTimers(); toast(`Re-armed “${t.label}”. It fires next at ${t.next}.`, 'running'); }
    if (b.dataset.act === 'timer-cancel' && t) {
      if (!b.classList.contains('is-armed')) { b.classList.add('is-armed'); b.textContent = 'Sure?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('is-armed'); b.textContent = 'Cancel'; } }, 3000); return; }
      t.gone = true; paintTimers(); toast(`Cancelled “${t.label}”.`);
    }
  });
  // The Manager's Hold is its chat's hold, so Timers and the header say the same.
  API.setChatHold = (on) => { holdChat = !!on; paintTimers(); };
  paintTimers();

  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.req [data-opt]');
    if (opt && !opt.matches('[aria-disabled="true"]') && VIEW === 'chat') { answer(opt.dataset.opt); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.closest('[data-list]') || b.matches('[aria-disabled="true"]')) return;
    const act = b.dataset.act;
    if (act === 'list') showList(b.getAttribute('aria-pressed') !== 'true', true);
    else if (act === 'new') fresh();
    else if (act === 'new-jev') API.newJev?.();
    else if (act === 'stop') stop();
    else if (act === 'fork') { addChat({ id: `fork-${Date.now()}`, title: `Fork of ${$('.chat-head .title').textContent}`, state: 'idle', who: `${S.agent} · ${S.model}` }); toast('Forked into a new chat with this conversation so far. This chat is unchanged.', 'idle'); }
    else if (act === 'automerge' || act === 'safemode') { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); toast(SWITCH_TOAST[act](on)); }
    else if (act === 'activity' || act === 'reasoning' || act === 'tools') { show[act] = b.getAttribute('aria-pressed') !== 'true'; store.set('poise-show', show); applyShow(); }
    else if (act === 'memories') pane(VIEW === 'chat' ? true : !layout.classList.contains('pane-open'), 'memories');
    else if (act === 'timers' && VIEW === 'chat') pane(true, 'timers');
    else if (act === 'tool') { const tool = b.closest('.tool'); tool.classList.toggle('open'); b.setAttribute('aria-expanded', String(tool.classList.contains('open'))); }
    else if (act === 'thought') { const body = b.nextElementSibling; body.hidden = !body.hidden; b.setAttribute('aria-expanded', String(!body.hidden)); }
    else if (act === 'copy') { navigator.clipboard?.writeText(b.closest('.stop').querySelector('.md').textContent.trim()).catch(() => {}); const l = $('span', b); l.textContent = 'Copied'; setTimeout(() => { l.textContent = 'Copy'; }, 1600); }
    else if (act === 'file') preview(b);
    else if (act === 'revert') { b.textContent = 'Reverting…'; b.setAttribute('aria-disabled', 'true'); setTimeout(() => { b.textContent = 'Reverted'; b.closest('.diff').classList.add('is-reverted'); toast(`Reverted ${b.previousElementSibling.textContent} to before this change.`); }, 900); }
    else if (act === 'goto-req') { const r = $('[data-req]:not(.is-resolved)'); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('is-focused'); r.focus({ preventScroll: true }); } }
    else if (act === 'queue') { qbox.classList.toggle('open'); b.setAttribute('aria-expanded', String(qbox.classList.contains('open'))); }
    else if (act === 'q-remove') { const item = b.closest('.q-item'); toast(`Removed from the queue: “${$('.txt', item).textContent.trim()}”`); leave(item, renumber); }
    else if (act === 'resume') { S.stopped = false; showResume(false); startNext(); }
    else if (act === 'chat-resume') { shut(null); newTurn('Resume', '', true); setSit({ now: 'Resuming the turn', next: 'Reply', wait: 'Nothing', est: '' }); runScript('generic'); }
    else if (act === 'send') send(false);
    else if (act === 'back') back();
  });

  // File preview: read-only, at the line.
  const FILES = {
    '.github/workflows/browser.yml:42': [38, ['  browser:', '    name: Browser · ${{ matrix.project }}', '    runs-on: ubuntu-latest', '    if: ${{ !cancelled() }}', "    timeout-minutes: ${{ github.event_name == 'pull_request' && 30 || 15 }}", '    strategy:', '      fail-fast: false', '      matrix:', '        project: [chromium, firefox, webkit]']],
    'docs/Testing.md:57': [55, ['## Browser gate', '', 'Browser shards time out after 30 minutes on pull requests and 15 on main.', 'A hung shard on main still fails fast.']]
  };
  function preview(link) {
    const name = link.textContent.trim(), [start, lines] = FILES[name] || [1, ['(preview)']], at = +name.split(':')[1] || 0;
    const scrim = document.createElement('div');
    scrim.className = 'dialog-scrim';
    scrim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(name)}"><header><h3 class="t-mono">${esc(name)}</h3><span class="t-gloss">Read only · current working copy</span><button class="ib" data-close aria-label="Close preview"><i data-i="cross"></i></button></header><pre>${lines.map((l, i) => { const n = start + i, row = `${String(n).padStart(3, ' ')}  ${esc(l)}`; return n === at ? `<mark>${row}</mark>` : row; }).join('\n')}</pre></div>`;
    document.body.append(scrim);
    hydrateIcons(scrim);
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); link.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey, true);
    $('[data-close]', scrim).focus();
  }

  // ---------- Composer ----------
  const HKEY = 'poise-chat-history', DKEY = `poise-chat-draft:${VIEW}`;
  let hist = store.get(HKEY, []), hi = -1;
  const slashMenu = $('#slash-menu');
  const autosize = () => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.3)}px`; };
  const slashOpen = () => slashMenu && !slashMenu.hidden;
  function slash() {
    if (!slashMenu) return;
    const v = ta.value;
    if (!/^\/\S*$/.test(v)) { slashMenu.hidden = true; return; }
    const rows = $$('.menu-row', slashMenu);
    rows.forEach((r) => { r.hidden = !r.dataset.cmd.startsWith(v); r.classList.remove('is-active'); });
    const first = rows.find((r) => !r.hidden);
    if (!first) { slashMenu.hidden = true; return; }
    first.classList.add('is-active');
    slashMenu.hidden = false;
    const r = form.getBoundingClientRect();
    slashMenu.style.left = `${r.left}px`;
    slashMenu.style.right = '';
    slashMenu.style.top = `${r.top - slashMenu.offsetHeight - 8}px`;
  }
  function pickSlash(row) { ta.value = `${row.dataset.cmd} `; slashMenu.hidden = true; ta.focus(); store.set(DKEY, ta.value); }
  slashMenu?.addEventListener('click', (e) => { const r = e.target.closest('[data-cmd]'); if (r) pickSlash(r); });
  // While a new chat is being created, typing goes on and Send waits for it to exist, as on main.
  let creating = false;
  // A chat that cannot take a turn says why in its composer: ?chat=closed, failed or interrupted, and the Manager's ?manager=retired.
  const SHUT = {
    closed: { state: 'idle', word: 'closed', text: 'This chat is closed' },
    failed: { state: 'failed', word: 'the provider failed mid-turn', text: 'The chat failed: Resume to try again, or /reset to start fresh', resume: true },
    interrupted: { state: 'needs-you', word: 'interrupted', text: 'Interrupted: Resume to continue, or /reset to start fresh', resume: true },
    retired: { state: 'idle', word: 'its model was retired', quiet: true, text: 'Choose another model to continue' },
    switchboard: { state: 'needs-you', word: 'asks you', text: 'Poise runs this chat for the Switchboard pane. It takes no messages; answer here only what it asks you', title: 'Switchboard' }
  };
  function shut(kind) {
    const s = S.shut = SHUT[kind] || null, b = $('[data-act="send"]'), go = $('[data-act="chat-resume"]');
    if (go) go.hidden = !s?.resume;
    ta.disabled = !!s && !s.resume;
    if (b) { if (s && !s.resume) { b.setAttribute('aria-disabled', 'true'); b.dataset.why = s.text; } else { b.removeAttribute('aria-disabled'); delete b.dataset.why; } }
    if (s?.title) {
      // A chat Poise runs for itself: its own transcript, and only what it asks.
      $('.chat-head .title').textContent = s.title;
      mark('');
      S.state = s.state;
      convo.dataset.chatState = s.state;
      $('[data-queue]').hidden = true;
      $$('[data-act="fork"], [data-act="handoff"]').forEach((x) => { x.hidden = true; });
      $('[data-transcript]').innerHTML = '<section class="turn"><div class="stop is-ask"><div class="req is-focused" data-ref="perm"><div class="req-t"><span class="t-micro">Permission</span>Read the news from 6 chats</div><div class="opts"><button class="opt" data-sb-answer="Allow once"><span class="k">1</span>Allow once</button><button class="opt" data-sb-answer="Deny"><span class="k">2</span>Deny</button></div></div></div></section>';
      $('[data-transcript]').addEventListener('click', (e) => {
        const a = e.target.closest('[data-sb-answer]');
        if (!a) return;
        a.closest('.req').innerHTML = `<div class="req-acts"><span class="chip is-done">Answered</span><span class="why">${a.dataset.sbAnswer}. The Switchboard goes on with its next check.</span></div>`;
        const chip = $('[data-head-state]');
        chip.dataset.state = 'running';
        chip.innerHTML = `<span data-term="state.running">${term('state.running')}</span>`;
      });
    } else if (s && VIEW === 'chat') {
      $$('.req', convo).forEach((r) => r.remove());
      setChat(s.state, s.word);
    }
    if (s && VIEW === 'chat') {
      $('[data-act="stop"]').hidden = true;
      setSit({ now: s.word[0].toUpperCase() + s.word.slice(1), next: s.resume ? 'Resume, or /reset' : 'Nothing', wait: 'You', est: '' });
    }
    if (s) {
      const chip = $('[data-head-state]');
      chip.dataset.state = s.state;
      chip.innerHTML = `<span data-term="state.${s.state}">${term(`state.${s.state}`)}</span>${s.quiet ? '' : ` · ${s.word}`}`;
    }
    ta.placeholder = placeholder();
  }
  function creatingChat(on) {
    creating = on;
    const b = $('[data-act="send"]');
    if (!b) return;
    if (on) { b.setAttribute('aria-disabled', 'true'); b.dataset.why = 'The chat is still being created. Keep typing: what you write stays here, and Send returns once it exists.'; } else { b.removeAttribute('aria-disabled'); delete b.dataset.why; }
  }
  // The commands that answer here instead of starting a turn, in main's words.
  function command(text) {
    const [, cmd, rest] = /^\/(\S+)\s*([\s\S]*)$/.exec(text) || [];
    if (cmd === 'poise' && !rest) return { say: 'Type the change after /poise: for example, /poise Add a Stop button to the Behaviors header', state: 'idle', keep: true };
    if (cmd === 'create') {
      const def = /^\/([a-z][a-z0-9_-]{0,63})\s+\S/.exec(rest);
      if (def) addSwitch(def[1], rest.slice(def[0].length - 1).trim());
      return def ? { say: `Saved /${def[1]}. Use it in any chat.`, state: 'done' } : { say: 'Use /create /switch-name followed by the instructions to save.', state: 'failed', keep: true };
    }
    if (cmd === 'reset') return { say: 'Chat reset. Previous conversation context cleared.', state: 'done', reset: true };
    // /content and /consensus run as commands, never as prompts, steers or queued messages, even while a turn runs.
    if (cmd === 'content' || cmd === 'consensus') return rest ? { card: cmd, topic: rest } : { say: `Give /${cmd} a topic.`, state: 'idle', keep: true };
    return null;
  }
  function commandCard(cmd, topic) {
    const box = $('[data-transcript]');
    if (!box) return;
    const card = Object.assign(document.createElement('section'), { className: 'deploy-card' });
    card.dataset.ref = `cmd.${cmd}`;
    const head = `<div class="top"><span class="chip is-special">/${cmd}</span><span>${esc(topic)}</span>`;
    card.innerHTML = `${head}<span class="spin"></span></div><p class="t-gloss">${cmd === 'content' ? 'Authoring…' : 'Debating…'}</p>`;
    box.append(card);
    card.scrollIntoView({ block: 'nearest' });
    later(2400, () => { card.innerHTML = `${head}</div>${cmd === 'content' ? '<a class="lnk" href="editor.html?back=chat">Open in Editor</a>' : '<p>The models agree on the direction and differ on the timing: start with the smallest change that can be undone. Each one’s reasons are in the debate.</p>'}`; });
  }
  // Saved switches join the commands: every snippet is also a /name in Chat.
  const addSwitch = (name, text) => slashMenu?.insertAdjacentHTML('beforeend', `<button class="menu-row" data-cmd="/${esc(name)}"><code>/${esc(name)}</code><span>${esc(text.slice(0, 90))} · Saved switch</span></button>`);
  [['manager', 'The Manager’s standing instructions.'], ['worker', 'A worker’s standing instructions.'], ['guideline', 'Review this against AUTONOMIO_PR_GUIDELINE.md: scope, tests, and the issue it closes.'], ['brief', 'Check this against the Poise Interface and Interaction Brief, section by section.'], ['pr', 'Open a pull request with this change, and link the issue it closes.'], ['ty', 'Thank you, this helps.']].forEach(([n, t]) => addSwitch(n, t));
  function send(queueIt) {
    const text = ta.value.trim();
    if (!text) return;
    if (creating) { toast('The chat is still being created. What you typed stays here; send it when it is ready.', 'waiting'); return; }
    if (S.shut && !/^\/(reset|create)\b/.test(text)) { toast(S.shut.text, 'waiting'); return; }
    const said = command(text);
    if (said?.say) { toast(said.say, said.state); if (said.keep) return; }
    hist = [text, ...hist.filter((h) => h !== text)].slice(0, 10);
    store.set(HKEY, hist);
    hi = -1;
    ta.value = '';
    store.set(DKEY, '');
    autosize();
    if (slashMenu) slashMenu.hidden = true;
    if (said?.card) { commandCard(said.card, said.topic); return; }
    if (said) { if (said.reset && S.shut) { shut(null); setChat('idle'); } return; }
    if (convo.classList.contains('is-fresh')) {
      const id = `new-${Date.now()}`, type = $('[data-newtype] input:checked')?.value || 'chat';
      // A Manager is offered only while there is none; it opens in its own place once it has started.
      if (type === 'manager') { const m = wakeEvery(); toast(`Starting the Manager. It carries /manager on every turn and wakes every ${m} minutes, up to ${1440 / m} turns a day. Your message sends when it is ready.`, 'waiting'); later(2200, () => { location.href = 'manager.html'; }); return; }
      addChat({ id, title: text.slice(0, 64), state: 'waiting', note: 'starting the chat; your message sends when it is ready', who: 'Claude Code · Opus 5 · High', ...(type === 'worker' ? { worker: 'Worker' } : {}) });
      mark(id);
      away(byId(id));
      toast(`Starting a new ${type === 'worker' ? 'worker' : 'chat'}. Your message is queued and sends the moment it is ready.`, 'waiting');
      creatingChat(true);
      setTimeout(() => creatingChat(false), 1000);
      later(2200, () => setState(id, 'running', undefined, 'started'));
      return;
    }
    API.onSend?.(text, queueIt);
  }
  if (ta) {
    ta.value = store.get(DKEY, '');
    ta.addEventListener('input', () => { store.set(DKEY, ta.value); autosize(); slash(); hi = -1; });
    ta.addEventListener('keydown', (e) => {
      if (slashOpen()) {
        const vis = $$('.menu-row:not([hidden])', slashMenu), cur = vis.findIndex((r) => r.classList.contains('is-active'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); vis[cur]?.classList.remove('is-active'); vis[(cur + (e.key === 'ArrowDown' ? 1 : vis.length - 1)) % vis.length].classList.add('is-active'); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(vis[Math.max(0, cur)]); return; }
        if (e.key === 'Escape') { e.preventDefault(); slashMenu.hidden = true; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.altKey); return; }
      if (e.key === 'ArrowUp' && hist.length && (ta.value === '' || hi >= 0) && ta.selectionStart === 0) { e.preventDefault(); hi = Math.min(hist.length - 1, hi + 1); ta.value = hist[hi]; autosize(); return; }
      if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); hi -= 1; ta.value = hi >= 0 ? hist[hi] : ''; autosize(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(false); });
    autosize();
  }

  // Memories save themselves.
  const mem = $('[data-mem]'), saved = $('[data-saved]');
  if (mem) {
    mem.value = store.get('poise-memories', mem.value);
    let memTimer = 0;
    mem.addEventListener('input', () => { saved.textContent = 'Saving…'; clearTimeout(memTimer); memTimer = setTimeout(() => { store.set('poise-memories', mem.value); saved.textContent = `Saved automatically · ${clock()}`; }, 600); });
  }

  // ---------- Keys ----------
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); if (VIEW === 'chat') stop(); return; }
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName);
    if (VIEW === 'chat' && !typing && /^[1-3]$/.test(e.key) && S.turn && $('[data-req]:not(.is-resolved)', S.turn)) { e.preventDefault(); answer(['allow', 'always', 'deny'][+e.key - 1]); }
    if (e.key === 'Escape' && convo?.classList.contains('is-fresh') && !typing) back();
  });

  // ---------- Live tickers ----------
  setInterval(() => {
    $$('[data-elapsed]').forEach((el) => { el.dataset.elapsed = +el.dataset.elapsed + 1; el.textContent = durText(+el.dataset.elapsed); });
    tickAsOf();
  }, 1000);

  // ---------- Start ----------
  // With no Manager, the new-chat screen offers one, with what its wake-ups cost.
  function wakeEvery() { return window.POISE_POLICY?.wake.get() || 60; }
  if (NO_MGR) {
    const f = $('[data-newtype]');
    if (f) {
      const r = $('input[value="manager"]', f);
      r.disabled = false;
      r.closest('label').classList.remove('is-off');
      $('[data-ref="new.manager"]', f).hidden = true;
      $('.t-gloss', f).textContent = `A worker carries the /worker charter on every turn. A Manager carries /manager, files tickets and gives each to a worker; it wakes every ${wakeEvery()} minutes, up to ${1440 / wakeEvery()} turns a day.`;
    }
  }
  Object.assign(API, { NO_MGR, shut, back, $, $$, store, term, params, VIEW, CHATS, MGR, S, byId, slotUse, schedule, managerTurn, mgrSummary, setState, finishWorker, closeWorker, render, refreshRow, select, mark, toast, later, cancelAll, clock, motion, closeMenus, showList, lifeHTML, lifeTo, setSit, tickAsOf, esc, pane, applyShow, addStop, prose, toolHTML, away, back, fresh, stateText, home: 'c475' });
  window.PoiseChat = API;

  if (VIEW === 'chat') {
    API.onSelect = (c) => {
      // Moving on to another chat ends the direct arrival: Back returns to #475 again.
      if (arrivedAway && c.id !== params.get('away')) { arrivedAway = false; $$('.away [data-act="back"]').forEach((b) => { b.lastChild.textContent = 'Back to #475'; }); }
      const keep = () => { try { sessionStorage.setItem('poise-chat-scroll', scroller.scrollTop); } catch { /* the route back still works, from the top */ } };
      if (c.manager) { keep(); location.href = NO_MGR ? 'manager.html?manager=none' : 'manager.html'; return false; }
      if (c.worker) { keep(); location.href = `manager.html?peek=${c.id}&back=chat`; return false; }
      if (c.id === 'c475') { back(); return false; }
      if (c.who?.startsWith('JEV')) { API.openJev?.(c.id); return false; }
      away(c);
    };
    API.onDeleteSelected = () => fresh();
    API.onHandoff = (who) => { addChat({ id: `handoff-${Date.now()}`, title: `${$('.chat-head .title').textContent} · handed off`, state: 'running', who }); toast(`Handed off to ${who}: a new chat starts with a labelled summary. This chat is unchanged.`, 'running'); };
    API.onSend = (text, queueIt) => {
      if (queueIt || /^\/queue\s/.test(text)) { addQueue(text.replace(/^\/queue\s+/, '')); return; }
      if (S.state === 'running') steer(text);
      else if (S.state === 'needs-you') steer(text, true);
      else { S.stopped = false; showResume(false); newTurn(esc(text), '', true); setSit({ now: 'Reading your message', next: 'Reply', wait: 'Nothing', est: '' }); runScript('generic'); }
    };
    $$('.q-item', qlist).forEach((q, i) => { q.dataset.script = i === 0 ? 'review' : 'docs'; });
    if (SHUT[params.get('chat')]) shut(params.get('chat'));
    try { const y = sessionStorage.getItem('poise-chat-scroll'); if (y != null) { scroller.scrollTop = +y; sessionStorage.removeItem('poise-chat-scroll'); } } catch { /* no session storage: start at the top */ }
  }
  render(false);
  applyShow();
  // A route back to where you came from: Overview, Board, Editor, Observe or Settings.
  if (FROM && VIEW === 'chat') {
    const head = $('.chat-head .head-1');
    head?.insertAdjacentHTML('afterbegin', `<a class="back" href="${FROM[0]}" data-ref="back"><i data-i="chev" class="sm"></i>Back to ${FROM[1]}</a>`);
    if (head) hydrateIcons(head);
    $$('.fresh [data-act="back"]').forEach((b) => { b.lastChild.textContent = `Back to ${FROM[1]}`; });
    if (arrivedAway) $$('.away [data-act="back"]').forEach((b) => { b.lastChild.textContent = `Back to ${FROM[1]}`; });
  }
  if (VIEW === 'chat' && params.get('draft') != null) { fresh(); ta.value = params.get('draft'); autosize(); }
  if (params.get('pane') === 'memories') pane(true);
  if (VIEW === 'chat' && params.get('pane') === 'timers') pane(true, 'timers');
  if (VIEW === 'chat' && params.get('answer')) setTimeout(() => answer(params.get('answer')), 400);
  if (VIEW === 'chat' && params.get('away')) setTimeout(() => select(params.get('away')), 300);
  // A link from the review opens the part that holds what it names, even what
  // shows only on use: a chat's Timers, its reasoning, the queue's items, the
  // bar a selection brings, the new-chat screen. Nothing of it is stored.
  const wantRef = params.get('ref') || '';
  if (VIEW === 'chat' && /^timers?\b|^timer\./.test(wantRef)) pane(true, 'timers');
  if (VIEW === 'chat' && wantRef === 'thought') { show.reasoning = true; applyShow(); }
  if (VIEW === 'chat' && /^queue\.(model|remove)$/.test(wantRef)) { qbox.classList.add('open'); $('[data-act="queue"]').setAttribute('aria-expanded', 'true'); }
  if (wantRef === 'list.bulk.delete') { CHATS.filter((c) => !c.manager && !c.closed).slice(1, 3).forEach((c) => picked.add(c.id)); paintPicked(); }
  if (wantRef === 'new.type' || wantRef === 'new.jev' || wantRef === 'new.fallback' || (VIEW === 'chat' && params.get('fallback') != null)) fresh();
  if (params.get('ref')) setTimeout(() => window.poiseOpenRef?.($(`[data-ref="${params.get('ref')}"]:not([hidden] *)`) || $(`[data-ref="${params.get('ref')}"]`)), 700);
  if (params.get('tip')) setTimeout(() => window.poiseShowTip?.($(`[data-ref="${params.get('tip')}"]`)), 700);
})();
