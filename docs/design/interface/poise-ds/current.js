// Board: your cards and live GitHub work on one line, in Poise's one vocabulary.
// Presentational only: a scripted workspace that behaves the way Poise would.
(() => {
  const { $, $$, store, params, esc, motion, clock, lifeTo, toast, openMenu, closeMenus } = window.PoiseShell;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);

  // ---------- The board ----------
  const LANES = [
    { key: 'idea', label: 'Idea', kind: 'mine', gloss: 'a thought worth keeping' },
    { key: 'concept', label: 'Concept', kind: 'mine', gloss: 'shaped enough to talk about' },
    { key: 'plan', label: 'Plan', kind: 'mine', gloss: 'ready to be written down' },
    { key: 'issue', label: 'Issue', kind: 'live', gloss: 'a task, live from GitHub' },
    { key: 'pr', label: 'PR', kind: 'live', gloss: 'a change, live from GitHub' }
  ];
  const MO = 43200, D = 1440;
  const CARDS_KEY = 'poise-current-cards-v1';
  const CARDS = store.get(CARDS_KEY, null) || [
    ['m1', 'idea', 'Definition of insight', null, 2 * MO],
    ['m2', 'idea', 'How can we make memory diodic?', null, 2 * MO],
    ['m3', 'idea', 'What are the most informative bars?', null, 2 * MO],
    ['m4', 'concept', 'Study market makers and volume trends on Binance', null, 2 * MO],
    ['m5', 'concept', 'Add a custom maker signal', 'Acme/Limen', 2 * MO],
    ['m6', 'concept', 'A triple-barrier label that is truly ours: instead of binary barriers, a gradient. The closer we come to the level, the more likely it reverts or explodes, and we want to avoid both.', null, 2 * MO],
    ['m7', 'plan', 'Explore multi-threshold approaches', 'Acme/Limen', 17 * D],
    ['m8', 'plan', 'Prepare data once, keep arrays resident, generate params once; take manifest prep and round orchestration out of the hot path.', 'Acme/Limen', 17 * D],
    ['m9', 'plan', 'In our backtesting, do we have anything that gives us volume of trades, or number of trades?', 'Acme/Limen', 17 * D],
    ['m10', 'plan', 'Blog: patterns of mechanized activity in the Binance spot market', 'Acme/design-system', 2 * MO],
    ['m11', 'plan', 'Add a non-BTC market data feed', null, 2 * MO],
    ['m12', 'plan', 'Understand triple-barrier clearly', null, 2 * MO],
    ['m13', 'plan', 'Factorize rule-based models', null, 2 * MO]
  ].map(([id, lane, text, repo, ago]) => ({ id, lane, text, repo, ago }));
  const saveCards = () => store.set(CARDS_KEY, CARDS);

  // Who is on an item: a worker the Manager runs, a chat you run, or a run.
  const W = (n) => ({ tag: `W${n}`, kind: 'worker', go: `manager.html?peek=w${n}&back=board` });
  const CHAT = { tag: 'Chat', kind: 'chat', go: 'chat.html?back=board' };
  const RUN = (tag) => ({ tag, kind: 'run', go: 'observe.html?tab=behaviors&back=board' });
  // A ticket the Manager has filed but not yet given to a worker.
  const MANAGER = { tag: 'Manager', kind: 'worker', go: 'manager.html?back=board' };
  const POISE = { tag: 'Poise', kind: 'poise', go: 'observe.html?tab=tasks&back=board' };
  // The chain's intake, as main reads it (#853): which open issues carry its label, and which
  // open pull requests close them. An issue with one is not taken by the chain.
  const CLOSING = { 'Acme/Limen#1158': [1162] };
  // ?intake=failed: unread is not "not assigned", so no label, Assign or pull request shows.
  const INTAKE_FAILED = params.get('intake') === 'failed';
  // The issues and pull requests come from workspace-data.js, which Overview reads too.
  const WHO = (k) => (!k ? null : k === 'Chat' ? CHAT : k === 'Manager' ? MANAGER : k.startsWith('Run:') ? RUN(k.slice(4)) : W(Number(k.slice(1))));
  const ITEMS = (window.POISE_BOARD?.ITEMS || []).map(([lane, repo, num, title, state, detail, who, ago, opened, stuck]) => ({ id: `${repo}#${num}`, lane, repo, num, title, state, detail, who: WHO(who), ago, opened, stuck }));
  // Tasks: a chained issue and its pull request are one card, carried by the
  // behaviors, with its phase rail. It sits where it has got to: Issue, then PR.
  const TK = window.POISE_TASKS;
  (TK?.TASKS || []).forEach((t, i) => ITEMS.push({ id: `${t.repo}#${t.pr || t.issue}`, lane: t.pr ? 'pr' : 'issue', repo: t.repo, num: t.pr || t.issue, title: t.title, state: t.state, detail: t.now, who: { tag: 'Poise', kind: 'poise', go: `observe.html?tab=tasks&task=${t.id}&back=board` }, ago: 3 + i * 4, opened: 40 + i * 30, task: t }));
  const TRUNCATED = { pr: true };   // more pull requests exist than are loaded
  // Numbers continue from the workspace's newest: #509 is its latest issue.
  let nextIssue = 510, nextCard = 14;
  const LABELS = {
    'autonomio/poise': [['bug', 'failed', 'Something does not work'], ['enhancement', 'running', 'New feature or request'], ['perf', 'waiting', 'Faster or lighter'], ['poise', 'special', 'Enters the issue-to-merge chain'], ['prd', 'other', 'A product requirements document'], ['design', 'attention', 'Interface and experience'], ['P1', 'blocked', 'High priority']],
    'Acme/Limen': [['bug', 'failed', 'Something does not work'], ['research', 'other', 'An open question'], ['poise', 'special', 'Enters the issue-to-merge chain']],
    'Acme/design-system': [['tokens', 'other', 'Design tokens']],
    'mikkokotila/control-plane': [],
    'agent-tooling': [['infra', 'other', 'Tooling and CI']]
  };
  const byId = (id) => ITEMS.find((i) => i.id === id) || CARDS.find((c) => c.id === id);

  // ---------- What shows, and in what order ----------
  const RANK = { 'needs-you': 0, blocked: 1, failed: 2, running: 3, waiting: 4, idle: 5, done: 6 };
  const STATES = Object.keys(RANK);
  const ORDERS = { attention: 'Attention', recent: 'Recent activity', repo: 'Repository' };
  const F = Object.assign({ status: 'any', time: 'all', org: '', layout: 'lanes', by: 'updated', who: 'any' }, store.get('poise-current-filters', {}));
  // A link can ask for one view (?layout=list&time=today&by=opened). That is the link's choice,
  // not yours, so what you left stays remembered until you choose something yourself.
  const LINKED = {};
  const linkTo = (k, v) => { if (!(k in LINKED)) LINKED[k] = F[k]; F[k] = v; };
  ['layout', 'by', 'who', 'time', 'status'].forEach((k) => { if (params.get(k)) linkTo(k, params.get(k)); });
  // Your own cards live in Lanes, so a link to one of them opens there, whichever view you left.
  if (/^(lane\.(idea|concept|plan|add|drop)|card\.(manual|edit|to-issue|delete))$/.test(params.get('ref') || '')) linkTo('layout', 'lanes');
  const saveFilters = () => store.set('poise-current-filters', { ...F, ...LINKED });
  const choose = (patch) => { Object.entries(patch).forEach(([k, v]) => { F[k] = v; delete LINKED[k]; }); saveFilters(); };
  let order = ORDERS[store.get('poise-current-order', 'attention')] ? store.get('poise-current-order', 'attention') : 'attention';
  if (ORDERS[params.get('order')]) order = params.get('order');
  let search = '', only = STATES.includes(params.get('state')) ? params.get('state') : null;
  const folds = store.get('poise-current-folds', {});
  const TODAY = 19 * 60 + 41;
  const stamp = (it) => (F.by === 'opened' ? it.opened : it.ago);
  const inTime = (it) => (F.time === 'today' ? stamp(it) < TODAY : F.time === 'yesterday' ? stamp(it) >= TODAY && stamp(it) < TODAY + D : F.time === 'week' ? stamp(it) < 7 * D : true);
  const inOrg = (repo) => !F.org || !repo || repo.split('/')[0].toLowerCase() === F.org.toLowerCase();
  const matches = (...hay) => !search || hay.some((h) => (h || '').toLowerCase().includes(search.toLowerCase()));
  const filtersOn = () => F.status !== 'any' || F.time !== 'all' || !!search || !!only || F.who !== 'any';
  // The live items the board shows, before the state filter: that is what In motion counts.
  // A read that fails: what came back stays, and the board says what did not. ?board=partial
  const PARTIAL = params.get('board') === 'partial' || params.get('ref') === 'cur.partial';
  if (PARTIAL) $('.cur-head')?.insertAdjacentHTML('beforeend', '<p class="cur-partial" role="status" data-ref="cur.partial">Board is not updating. Could not load GitHub issues and pull requests. Showing what is available.</p>');
  else if (INTAKE_FAILED) $('.cur-head')?.insertAdjacentHTML('beforeend', '<p class="cur-partial" role="status" data-ref="cur.partial">Board is not updating. Could not read which issues are assigned to Poise: GitHub returned 502. Showing what is available.</p>');
  const shown = () => ITEMS.filter((it) => !PARTIAL && inOrg(it.repo) && inTime(it) && (F.status === 'any' || it.state !== 'done') && matches(it.title, it.repo, `#${it.num} ${it.task ? `#${it.task.issue}` : ''}`) && (F.who === 'any' || (F.who === 'poise') === (it.who?.kind === 'poise')));
  const ago = (m) => (m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < D ? `${Math.floor(m / 60)}h` : m < MO ? `${Math.floor(m / D)}d` : `${Math.floor(m / MO)}mo`);
  const isNew = (it) => it.lane === 'pr' && it.state !== 'done' && it.opened < 360;
  const recent = (a, b) => a.ago - b.ago;
  const attention = (a, b) => RANK[a.state] - RANK[b.state] || recent(a, b);

  // ---------- Phase, how long, and who has it ----------
  // A chain's phase comes from its journal; other work's from its current blocker.
  function phaseOf(it) {
    if (it.task) return { rail: it.task, word: TK.phaseWord(it.task) };
    const P = TK.PHASES, at = (phase) => ({ rail: { phase, state: it.state, round: 1 }, word: P[phase] }), d = it.detail || '';
    if (it.state === 'done') return it.lane === 'pr' ? { rail: { phase: P.length, state: 'done', round: 1 }, word: 'Merged' } : { rail: null, word: 'Closed' };
    if (it.who?.kind === 'poise') return at(it.state === 'running' ? 1 : 0);
    if (it.lane === 'issue') return at(it.who && it.who !== MANAGER ? 2 : 0);
    if (/draft/.test(d)) return at(2);
    if (/failing|conflict|stalled/.test(d)) return at(4);
    if (/approved|merge/.test(d)) return at(6);
    return at(3);
  }
  const railFor = (it) => { const p = phaseOf(it); return `${p.rail ? TK.railHTML(p.rail, { label: false }) : ''}<span class="rail-w">${esc(p.word)}</span>`; };
  const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  // How long it has been like this: a run's start, the blocker's since, or the last change.
  function dwell(it) {
    if (it.state === 'done') return '';
    const m = it.task && it.ago ? (it.task.advanceMin ?? Math.max(0, TODAY - minutesOf(it.task.since))) : it.stuck || it.ago;
    if (m < 1) return it.state === 'running' ? 'just started' : 'just now';
    if (it.state === 'running') return `for ${ago(m)}`;
    if (it.state === 'idle') return `no change for ${ago(m)}`;
    return m >= 15 ? `<span class="stuck" data-ref="card.stuck">the same for ${ago(m)}</span>` : `for ${ago(m)}`;
  }
  const chainOff = () => params.get('engine') === 'v1' || (store.get('poise-settings-v1', {}).engine || {}).mode === 'v1';
  const everyIssueEnters = () => params.get('seed') === 'all' || store.get('poise-settings-v1', {}).values?.['beh.chain.seed'] === 'all';
  const canAssign = (it) => !INTAKE_FAILED && it.lane === 'issue' && !it.who && !it.task && it.state !== 'done' && !it.assigning && !everyIssueEnters();
  // An open issue's pull requests: one that closes it keeps the chain from taking it.
  const intakeHTML = (it) => {
    if (INTAKE_FAILED || it.lane !== 'issue' || it.task || it.state === 'done') return '';
    const prs = CLOSING[it.id] || [];
    return prs.length
      ? prs.map((n) => `<a class="intake" href="https://github.com/${esc(it.repo)}/pull/${n}" target="_blank" rel="noopener" data-act="link" data-ref="card.intake" title="An open pull request that closes this issue. The chain does not take an issue that has one.">PR #${n}</a>`).join('')
      : '<span class="intake dim" data-ref="card.intake" title="No open pull request closes this issue.">no open PR</span>';
  };
  const ASSIGN_WHAT = 'Adds the label poise on GitHub, as you. The chain takes the issue at its next check.';
  const assignHTML = (it, cls = 'btn-ghost card-assign') => (canAssign(it) ? `<button class="${cls}" data-act="assign" data-id="${esc(it.id)}" data-ref="card.assign" title="${chainOff() ? 'Adds the label poise on GitHub, as you. The chain is off, so it takes the issue once it is on.' : ASSIGN_WHAT}">Assign to Poise</button>` : '');
  const runsOf = (it) => { const ids = it.task ? [it.task.issue, it.task.pr] : [it.num]; return (window.PoiseObserve?.RUNS || []).filter((r) => r.repo && `${r.org}/${r.repo}` === it.repo && ids.includes(r.pr)); };
  // Every place links to Board, and this strip links from Board to the others.
  function sameWork(it) {
    const runs = runsOf(it), path = it.lane === 'pr' ? 'pull' : 'issues';
    return `<p class="bside-same" data-ref="side.same"><span class="t-micro">The same work, elsewhere</span>${it.task ? `<a class="lnk" href="observe.html?tab=tasks&amp;task=${esc(it.task.id)}&amp;back=board">Task</a>` : ''}${runs.length ? `<a class="lnk" href="observe.html?tab=behaviors&amp;pr=${encodeURIComponent(`${runs[0].org}/${runs[0].repo}#${runs[0].pr}`)}&amp;back=board">${runs.length} ${runs.length === 1 ? 'run' : 'runs'} in Behaviors</a>` : '<span class="t-gloss">No runs yet</span>'}<a class="lnk" href="observe.html?tab=github&amp;item=${encodeURIComponent(`${it.repo}#${it.num}`)}&amp;back=board">GitHub history</a><a class="lnk" href="https://github.com/${esc(it.repo)}/${path}/${it.num}" target="_blank" rel="noopener">On GitHub ↗</a></p>`;
  }
  function aboutHTML(it) {
    const runs = runsOf(it), O = window.PoiseObserve;
    const owner = it.who
      ? `<span class="t-gloss">${it.who.kind === 'poise' ? 'With Poise: the chain carries it.' : 'Carried by'}</span>${it.who.kind === 'poise' ? '' : `<button class="wk${it.who.kind === 'worker' ? '' : ' is-own'}" data-act="who" data-id="${esc(it.id)}">${esc(it.who.tag)}</button>`}`
      : it.lane === 'issue' && it.state !== 'done'
        ? `<span class="t-gloss">Not with Poise.</span>${assignHTML(it, 'btn btn-primary')}<span class="t-gloss">${it.assigning ? 'The label is added. The chain takes it at its next check.' : everyIssueEnters() ? 'Every open issue enters the chain, so it takes this one by itself.' : chainOff() ? 'The chain is off: assigning adds the label, and the chain takes the issue once it is on.' : ASSIGN_WHAT}</span>${(CLOSING[it.id] || []).length ? `<span class="t-gloss">An open pull request closes it, so the chain does not take it while that is open.</span>` : ''}`
        : `<span class="t-gloss">Not with Poise.${it.lane === 'pr' && it.state !== 'done' ? ' The chain starts from an issue, so a pull request opened elsewhere stays outside it.' : ''}</span>`;
    return `<div class="bside-h"><span class="t-micro" data-ref="side.about">${it.lane === 'pr' ? 'Pull request' : 'Issue'}</span><button class="ib" data-act="side-close" aria-label="Close" data-ref="side.close"><i data-i="cross" class="sm"></i></button></div><h3>${esc(it.title)}</h3><p class="t-mono t-gloss">${esc(it.repo)}#${it.num} · opened ${ago(it.opened)} · changed ${ago(it.ago)}</p><div class="bside-rail">${railFor(it)}</div><div class="card-state"><span class="sc" data-state="${it.state}"></span><b>${term('state.' + it.state)}</b><span class="detail">${esc(it.detail || '')}</span><span class="dwell" data-ref="card.dwell">${dwell(it)}</span></div>${it.assignError ? `<p class="bside-hold" role="alert">${esc(it.assignError)}</p>` : ''}<div class="bside-acts">${owner}</div>${sameWork(it)}${runs.length ? `<p class="t-micro">Runs · newest first</p><ol class="bside-tl">${runs.map((r) => `<li><span class="t-mono">${r.started == null ? '—' : esc(O.clockOf(r.started))}</span><span><b>${esc(r.behaviorLabel)}</b> ${term('state.' + r.state)}${r.outcome ? ` · ${esc(r.outcome)}` : ''} · <a class="lnk" href="observe.html?tab=behaviors&amp;call=${esc(r.id.slice(0, 12))}&amp;back=board">Open</a></span></li>`).join('')}</ol>` : ''}`;
  }

  // ---------- Feedback on the card itself ----------
  const LIFE = {};   // id → [stage, label, skipQueued]
  function life(id, stage, label, skip, clearAfter) {
    LIFE[id] = [stage, label, skip];
    const el = $(`.card[data-id="${CSS.escape(id)}"] .life`, lanesEl);
    if (el) { el.hidden = false; lifeTo(el, stage, label, skip); }
    if (clearAfter) setTimeout(() => { if (LIFE[id]?.[0] === stage) { delete LIFE[id]; const e = $(`.card[data-id="${CSS.escape(id)}"] .life`, lanesEl); if (e) e.hidden = true; } }, clearAfter);
  }
  const lifeEl = (id) => `<div class="life" data-ref="life"${LIFE[id] ? '' : ' hidden'}></div>`;

  // ---------- Rendering ----------
  const lanesEl = $('[data-lanes]'), sumEl = $('[data-sum]');
  const W_ = {};   // open writers: add.<lane>, issue, edit.<id>
  const actsMine = `<div class="card-acts"><button class="ib" data-act="copy" aria-label="Copy" data-ref="card.copy"><i data-i="copy" class="sm"></i></button><button class="ib" data-act="chat" aria-label="Chat about this" data-ref="card.chat"><i data-i="chat" class="sm"></i></button><button class="ib" data-act="to-issue" aria-label="Open as issue…" data-ref="card.to-issue"><i data-i="issue" class="sm"></i></button><button class="ib" data-act="del" aria-label="Delete card" data-ref="card.delete"><i data-i="cross" class="sm"></i></button></div>`;
  const repoOptions = (sel, none = true) => `${none ? `<option value=""${sel ? '' : ' selected'}>No repository</option>` : ''}${['autonomio/poise', 'Acme/Limen', 'Acme/design-system', 'mikkokotila/control-plane', 'agent-tooling'].map((r) => `<option${r === sel ? ' selected' : ''}>${r}</option>`).join('')}`;

  function mineHTML(c) {
    if (W_[`edit.${c.id}`]) {
      return `<article class="card is-editing" data-id="${c.id}" data-kind="mine" data-ref="card.edit"><div class="writer" data-writer="edit.${c.id}"><textarea data-w="edit-text" aria-label="Card text" rows="3">${esc(c.text)}</textarea><div class="row"><select data-w="edit-repo" aria-label="Linked repository" data-ref="composer.repo">${repoOptions(c.repo)}</select><span class="spacer"></span><button class="btn btn-line" data-act="w-cancel" data-w-key="edit.${c.id}">Cancel</button><button class="btn btn-primary" data-act="w-save" data-id="${c.id}">Save</button></div><span class="hint">⌘Enter saves · Esc cancels</span></div></article>`;
    }
    return `<article class="card" data-id="${c.id}" data-kind="mine" tabindex="0" draggable="true" data-ref="card.manual" aria-label="Card: ${esc(c.text.slice(0, 60))}"><div class="card-text">${esc(c.text)}</div><div class="card-meta">${c.repo ? `<span class="repo">${esc(c.repo)}</span>` : ''}<time>${ago(c.ago)}</time></div>${lifeEl(c.id)}${actsMine}</article>`;
  }
  function liveHTML(it) {
    const settled = it.state === 'done', list = F.layout === 'list';
    const said = list ? esc(it.detail || '') : it.detail ? `${esc(it.detail)}${it.stuck ? ` · <span class="stuck" data-ref="card.stuck">the same for ${it.stuck} min</span>` : ''}` : '';
    const stateRow = list || canAssign(it) || it.state !== 'idle' || it.detail || it.who
      ? `<div class="card-state" data-ref="card.state"><span class="sc" data-state="${it.state}"></span><b>${term('state.' + it.state)}</b>${said ? `<span class="detail"${it.lane === 'pr' && it.state !== 'done' ? ' data-ref="card.blocker"' : ''}>${said}</span>` : ''}${list ? `<span class="dwell" data-ref="card.dwell">${dwell(it)}</span>` : ''}${it.who ? `<button class="wk${it.who.kind === 'poise' ? ' is-mgr' : it.who.kind === 'worker' ? '' : ' is-own'}" data-act="who" data-ref="${it.who.kind === 'poise' ? 'card.chain' : 'card.worker'}">${it.who.tag}</button>` : ''}${assignHTML(it)}</div>${it.assignError ? `<p class="note is-warn" role="alert">${esc(it.assignError)}</p>` : ''}` : '';
    const rail = list ? `<div class="card-rail">${railFor(it)}</div>` : it.task ? `<div class="card-rail">${TK.railHTML(it.task)}</div>` : '';
    const primary = it.lane === 'pr'
      ? `<button class="ib" data-act="review" aria-label="Run PR review" data-ref="card.review"${settled ? ' aria-disabled="true"' : ''}><i data-i="play" class="sm"></i></button>`
      : `<button class="ib" data-act="manager" aria-label="Hand to the Manager" data-ref="card.manager"${it.who || settled ? ' aria-disabled="true"' : ''}><i data-i="handoff" class="sm"></i></button>`;
    return `<article class="card" data-id="${it.id}" data-kind="live" data-state="${it.state}" tabindex="0" data-ref="card.live" aria-label="${it.lane === 'pr' ? 'Pull request' : 'Issue'} #${it.num}: ${esc(it.title)}">`
      + `<a class="card-title" href="https://github.com/${it.repo}/${it.lane === 'pr' ? 'pull' : 'issues'}/${it.num}" target="_blank" rel="noopener" data-act="link" data-ref="card.link">${esc(it.title)}</a>`
      + `<div class="card-meta"><span class="repo">${it.repo}</span><span class="num">${it.task && it.task.pr ? `#${it.task.issue} → #${it.num}` : `#${it.num}`}</span>${isNew(it) ? '<span class="new" data-ref="card.new">New</span>' : ''}${intakeHTML(it)}<time>${list ? `opened ${ago(it.opened)} · changed ${ago(it.ago)}` : ago(it.ago)}</time></div>`
      + `${rail}${stateRow}${lifeEl(it.id)}<div class="card-acts"><button class="ib" data-act="copy" aria-label="Copy" data-ref="card.copy"><i data-i="copy" class="sm"></i></button><button class="ib" data-act="chat" aria-label="Chat about this, beside the board" data-ref="card.chat"><i data-i="chat" class="sm"></i></button>${it.task ? `<button class="ib" data-act="task" aria-label="Open its timeline" data-ref="card.timeline"><i data-i="chev" class="sm"></i></button>` : `<button class="ib" data-act="open-chat" aria-label="Open in Chat" data-ref="card.open-chat"${settled ? ' aria-disabled="true"' : ''}><i data-i="session" class="sm"></i></button>${it.lane === 'issue' && !settled ? '<button class="ib" data-act="edit-issue" aria-label="Edit issue" data-ref="card.edit-issue"><i data-i="edit" class="sm"></i></button>' : ''}${primary}`}</div></article>`;
  }
  function writerHTML(lane) {
    if (lane.key === 'issue' && W_.issue) {
      const w = W_.issue, repo = w.repo || 'autonomio/poise', n = (w.labels || []).length;
      const labelsFailed = params.get('labels') === 'error';
      const pop = w.labelsOpen ? `<div class="labels-pop" role="dialog" aria-label="Issue labels" data-ref="composer.labels"><input class="search" type="search" placeholder="Filter labels…" aria-label="Filter labels" data-labels-filter value="${esc(w.lq || '')}"><div class="labels-list" role="group" aria-label="Labels">${labelsFailed ? `<p class="t-gloss">Could not load ${esc(repo)}’s labels: GitHub answered 502. The issue still opens without them.</p>` : ''}${(labelsFailed ? [] : LABELS[repo] || []).filter(([name]) => !w.lq || name.includes(w.lq.toLowerCase())).map(([name, tone, what]) => `<label class="label-row" title="${esc(what)}"><input type="checkbox" value="${esc(name)}" data-label${(w.labels || []).includes(name) ? ' checked' : ''}><span class="ldot" data-tone="${tone}"></span><span class="t-mono">${esc(name)}</span><span class="t-gloss">${esc(what)}</span></label>`).join('') || (labelsFailed ? '' : (LABELS[repo] || []).length ? '<p class="t-gloss">No labels match.</p>' : '<p class="t-gloss">This repository has no labels.</p>')}</div><div class="labels-foot">${[n ? `${n} selected` : '', w.cleared ? `Cleared ${w.cleared} from the previous repository` : '', (w.labels || []).includes('poise') ? 'poise: it enters the chain' : ''].filter(Boolean).join(' · ')}</div></div>` : '';
      return `<div class="writer" data-writer="issue">${w.edit ? `<span class="t-micro" data-ref="composer.editing">Edit ${esc(w.edit)}</span>` : ''}<input data-w="issue-title" placeholder="Issue title" aria-label="Issue title" data-ref="composer.title" value="${esc(w.title || '')}"><textarea data-w="issue-body" rows="3" placeholder="What should happen, in plain words (optional)" aria-label="Issue body" data-ref="composer.body">${esc(w.body || '')}</textarea><div class="row"><select data-w="issue-repo" aria-label="${w.edit ? 'Repository' : 'Repository for the new issue'}" data-ref="composer.repo"${w.edit ? ' disabled' : ''}>${repoOptions(repo, false)}</select>${w.edit ? '' : `<button class="ib labels-btn" data-act="labels" aria-expanded="${!!w.labelsOpen}" aria-haspopup="dialog" aria-label="${n ? `Labels, ${n} selected` : 'Labels'}" data-ref="composer.labels"><i data-i="tag" class="sm"></i>${n ? `<span class="n">${n}</span>` : ''}</button>`}<span class="spacer"></span><button class="btn btn-line" data-act="w-cancel" data-w-key="issue" data-ref="composer.cancel">Cancel</button><button class="btn btn-primary" data-act="w-open-issue" data-ref="composer.open">${w.edit ? 'Save issue' : 'Open issue'}</button></div>${pop}${w.err ? `<span class="err" role="alert">${w.err}</span>` : ''}${w.conflict ? `<div class="conflict" role="alert" data-ref="composer.conflict"><span>The issue changed on GitHub. Keep your draft and reopen the editor to load the latest version.</span><button class="btn btn-line" data-act="w-theirs">Load the latest</button></div>` : ''}<span class="hint">${w.edit ? 'Saves on GitHub as you, once it checks nobody changed it meanwhile. ⌘Enter saves · Esc cancels' : `Opens on GitHub as you. ⌘Enter opens · Esc cancels${w.source ? ' · the card is removed once the issue exists' : ''}`}</span></div>`;
    }
    if (lane.kind === 'mine' && W_[`add.${lane.key}`]) {
      return `<div class="writer" data-writer="add.${lane.key}"><textarea data-w="add-text" rows="3" placeholder="Write a card…" aria-label="Card text" data-ref="composer.text"></textarea><div class="row"><select data-w="add-repo" aria-label="Link a repository" data-ref="composer.repo">${repoOptions(null)}</select><span class="spacer"></span><button class="btn btn-line" data-act="w-cancel" data-w-key="add.${lane.key}" data-ref="composer.cancel">Cancel</button><button class="btn btn-primary" data-act="w-add" data-lane="${lane.key}" data-ref="composer.add">Add</button></div><span class="hint">⌘Enter adds · Esc cancels</span></div>`;
    }
    return '';
  }
  function laneHTML(lane) {
    const live = lane.kind === 'live';
    let open = [], done = [];
    if (live) {
      const all = shown().filter((it) => it.lane === lane.key && (!only || it.state === only));
      // What you just opened sits first, where you composed it; the rest keep their order.
      open = all.filter((it) => it.state !== 'done').sort((a, b) => (b.top || 0) - (a.top || 0) || (order === 'recent' ? recent : attention)(a, b));
      done = all.filter((it) => it.state === 'done').sort(recent);
      if (order === 'repo') open.sort((a, b) => a.repo.localeCompare(b.repo) || attention(a, b));
    } else {
      open = CARDS.filter((c) => c.lane === lane.key && inOrg(c.repo) && matches(c.text, c.repo));
    }
    let lastRepo = null;
    const body = open.map((x) => {
      const head = live && order === 'repo' && x.repo !== lastRepo ? `<div class="repo-h">${(lastRepo = x.repo)}</div>` : '';
      return head + (live ? liveHTML(x) : mineHTML(x));
    }).join('');
    const count = open.length + done.length;
    const add = lane.key === 'issue' ? `<button class="lane-add" data-act="add-issue" data-ref="lane.add-issue"><i data-i="plus" class="sm"></i>Add issue</button>`
      : lane.kind === 'mine' ? `<button class="lane-add" data-act="add" data-lane="${lane.key}" data-ref="lane.add"><i data-i="plus" class="sm"></i>Add</button>` : '';
    const empty = count ? '' : `<div class="empty" data-ref="cur.empty">${filtersOn() || F.org ? `Nothing here under your filters.${filtersOn() ? '<button class="clear" data-act="clear" data-ref="cur.clear">Clear filters</button>' : ''}` : live ? 'Nothing here.' : 'No cards yet. Add one, or drag one here.'}</div>`;
    const fold = done.length ? `<div class="done-fold${folds[lane.key] ? ' open' : ''}"><button class="done-h" data-act="fold" data-lane="${lane.key}" aria-expanded="${!!folds[lane.key]}" data-ref="cur.done"><i data-i="chev" class="sm"></i><span class="t-micro">${term('state.done')}</span><span class="n">${done.length}</span><span class="t-gloss">merged and closed</span></button><div class="lane-list done-list">${done.map(liveHTML).join('')}</div></div>` : '';
    const trunc = live && TRUNCATED[lane.key] ? `<p class="trunc" data-ref="cur.trunc">Older pull requests are not loaded: Poise shows the 200 most recently updated issues and pull requests, combined.</p>` : '';
    return `<section class="lane" data-lane="${lane.key}" data-kind="${lane.kind}" aria-label="${lane.label}">`
      + `<header class="lane-h"><span class="station"></span><span class="name"><span class="t-micro" data-ref="lane.${lane.key}">${lane.label}</span><span class="count" data-ref="lane.count">${count}${live && TRUNCATED[lane.key] ? '+' : ''}</span></span>${add}</header>`
      + `<p class="lane-gloss">${lane.gloss}</p>`
      + `<div class="lane-body" data-body="${lane.key}">${lane.key === 'issue' ? '<div class="drop-hint" data-ref="lane.drop">Drop to open this card as an issue</div>' : ''}${writerHTML(lane)}<div class="lane-list" data-list="${lane.key}">${body}</div>${empty}${fold}${trunc}</div></section>`;
  }

  function summary() {
    const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
    shown().forEach((it) => { counts[it.state]++; });
    sumEl.innerHTML = `<span class="t-micro" data-ref="cur.summary">In motion</span>${STATES.map((s) => `<button class="st" data-state="${s}" data-n="${counts[s]}" aria-pressed="${only === s}" data-act="state" data-ref="cur.count"><span data-term="state.${s}">${term('state.' + s)}</span><span class="n">${counts[s]}</span></button>`).join('')}${filtersOn() ? '<button class="clear" data-act="clear" data-ref="cur.clear">Clear filters</button>' : ''}`;
    sumEl.classList.toggle('is-filtered', !!only);
  }

  function render(animate = true) {
    const before = new Map($$('.card[data-id]', lanesEl).map((c) => [c.dataset.id, c.getBoundingClientRect()]));
    const scrolls = Object.fromEntries($$('[data-body]', lanesEl).map((b) => [b.dataset.body, b.scrollTop]));
    const values = Object.fromEntries($$('[data-w]', lanesEl).map((f) => [f.dataset.w, f.value]));
    const a = document.activeElement, focusW = a?.dataset?.w, focusId = !focusW && a?.closest?.('.card')?.dataset.id, caret = focusW ? [a.selectionStart, a.selectionEnd] : null;
    $('.cur').classList.toggle('is-list', F.layout === 'list');
    lanesEl.innerHTML = LANES.map(laneHTML).join('');
    hydrateIcons(lanesEl);
    $$('[data-body]', lanesEl).forEach((b) => { b.scrollTop = scrolls[b.dataset.body] || 0; });
    $$('[data-w]', lanesEl).forEach((f) => { if (values[f.dataset.w] != null) f.value = values[f.dataset.w]; });
    Object.entries(LIFE).forEach(([id, [stage, label, skip]]) => lifeTo($(`.card[data-id="${CSS.escape(id)}"] .life`, lanesEl), stage, label, skip));
    if (focusW) { const f = $(`[data-w="${focusW}"]`, lanesEl); if (f) { f.focus({ preventScroll: true }); if (caret && f.setSelectionRange) try { f.setSelectionRange(...caret); } catch { /* selects have no caret */ } } }
    else if (focusId) $(`.card[data-id="${CSS.escape(focusId)}"]`, lanesEl)?.focus({ preventScroll: true });
    summary();
    $('[data-order-label]').textContent = ORDERS[order];
    $$('#order-menu [data-order]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.order === order)));
    $$('[data-filter="status"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F.status)));
    $$('[data-filter="time"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F.time)));
    ['by', 'who', 'layout'].forEach((k) => $$(`[data-filter="${k}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === F[k]))));
    $('[data-org-label]').textContent = F.org || 'All orgs';
    $$('#org-menu [data-org]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.org === F.org)));
    const m = motion();
    if (!animate || !m.duration) return;
    $$('.card[data-id]', lanesEl).forEach((c) => {
      const b = before.get(c.dataset.id), r = c.getBoundingClientRect();
      if (!r.width) return;
      if (!b || !b.width) { c.animate([{ opacity: 0 }, { opacity: 1 }], m); return; }
      const dx = b.left - r.left, dy = b.top - r.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], m);
    });
  }

  // ---------- Stability: live changes wait while you are on the board ----------
  let onBoard = false, held = 0;
  const busy = () => onBoard || lanesEl.contains(document.activeElement) || Object.keys(W_).length > 0 || !!$('.ref-layer');
  function showHeld() { const h = $('[data-ref="cur.held"]'); h.hidden = !held; h.textContent = `${held} update${held > 1 ? 's' : ''} held`; }
  function flush() { if (!held || busy()) return; held = 0; showHeld(); render(); }
  function refreshCard(id) {
    const el = $(`.card[data-id="${CSS.escape(id)}"]`, lanesEl), it = byId(id);
    if (!el || !it || !it.lane || el.classList.contains('is-editing')) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = it.title ? liveHTML(it) : mineHTML(it);
    const fresh = tmp.firstElementChild;
    if (fresh.dataset.state) el.dataset.state = fresh.dataset.state;
    el.innerHTML = fresh.innerHTML;
    hydrateIcons(el);
    if (LIFE[id]) lifeTo($('.life', el), ...LIFE[id]);
  }
  function change(id, patch, quiet) {
    const it = byId(id);
    if (!it) return;
    // A new blocker starts its own clock: "the same for N min" belongs to the old one.
    const moved = ('state' in patch && patch.state !== it.state) || ('detail' in patch && patch.detail !== it.detail);
    Object.assign(it, patch, { ago: 0 }, moved ? { stuck: null } : {});
    summary();
    if (busy()) {
      refreshCard(id);
      if (!quiet) { held++; $(`.card[data-id="${CSS.escape(id)}"]`, lanesEl)?.classList.add('is-changed'); showHeld(); }
    } else render();
  }
  lanesEl.addEventListener('pointerenter', () => { onBoard = true; });
  lanesEl.addEventListener('pointerleave', () => { onBoard = false; flush(); });
  lanesEl.addEventListener('focusout', () => setTimeout(flush, 0));
  document.addEventListener('poise:ref', (e) => { if (!e.detail.open) setTimeout(flush, 0); });

  // ---------- Writing: one writer at a time; a draft you leave is kept ----------
  const drafts = {};
  const stash = () => $$('[data-writer]', lanesEl).forEach((w) => { drafts[w.dataset.writer] = Object.fromEntries($$('[data-w]', w).map((f) => [f.dataset.w, f.value])); });
  function openWriter(key, data = {}) {
    stash();
    Object.keys(W_).forEach((k) => delete W_[k]);
    W_[key] = data;
    render(false);
    const w = $(`[data-writer="${CSS.escape(key)}"]`, lanesEl);
    if (!w) return;
    if (drafts[key]) $$('[data-w]', w).forEach((f) => { if (drafts[key][f.dataset.w] != null) f.value = drafts[key][f.dataset.w]; });
    const f = $('[data-w]', w);
    f?.focus({ preventScroll: true });
    if (f?.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length);
    w.scrollIntoView({ block: 'nearest' });
  }
  function closeWriter(key, focusTo) {
    delete drafts[key];
    delete W_[key];
    render(false);
    focusTo?.();
  }
  const done = (id, label) => { LIFE[id] = ['Completed', label, true]; setTimeout(() => { if (LIFE[id]?.[1] === label) { delete LIFE[id]; const e = $(`.card[data-id="${CSS.escape(id)}"] .life`, lanesEl); if (e) e.hidden = true; } }, 4500); };

  function addCard(lane) {
    const w = $(`[data-writer="add.${lane}"]`, lanesEl);
    const text = $('[data-w="add-text"]', w).value.trim(), repo = $('[data-w="add-repo"]', w).value || null;
    if (!text) { closeWriter(`add.${lane}`); return; }
    const c = { id: `m${nextCard++}`, lane, text, repo, ago: 0 };
    const first = CARDS.findIndex((x) => x.lane === lane);
    CARDS.splice(first < 0 ? CARDS.length : first, 0, c);
    saveCards();
    delete W_[`add.${lane}`];
    delete drafts[`add.${lane}`];
    done(c.id, `saved ${clock()}`);
    render();
    $(`.card[data-id="${c.id}"]`, lanesEl)?.focus();
    if (!matches(text, repo) || !inOrg(repo)) toast('Card added. Your filter hides it; clear the filter to see it.');
  }
  function startEdit(id) { delete drafts[`edit.${id}`]; openWriter(`edit.${id}`); }
  function saveEdit(id) {
    const c = byId(id), w = $(`[data-writer="edit.${id}"]`, lanesEl);
    const text = $('[data-w="edit-text"]', w).value.trim(), repo = $('[data-w="edit-repo"]', w).value || null;
    delete W_[`edit.${id}`];
    delete drafts[`edit.${id}`];
    if (text && (text !== c.text || repo !== c.repo)) { Object.assign(c, { text, repo, ago: 0 }); saveCards(); done(id, `saved ${clock()}`); }
    render(false);
    $(`.card[data-id="${id}"]`, lanesEl)?.focus();
  }
  function saveIssue() {
    const w = $('[data-writer="issue"]', lanesEl), it = byId(W_.issue.edit);
    const title = $('[data-w="issue-title"]', w).value.trim(), body = $('[data-w="issue-body"]', w).value;
    if (!title) { Object.assign(W_.issue, { err: 'Add a title: it is required.', title, body }); render(false); $('[data-w="issue-title"]', lanesEl)?.focus(); return; }
    // Someone else changed it meanwhile: GitHub refuses, and the draft stays until the latest is loaded (try ?conflict=1).
    if (params.get('conflict') && !W_.issue.loaded) { Object.assign(W_.issue, { conflict: true, title, body, err: '' }); render(false); $('[data-act="w-theirs"]', lanesEl)?.focus(); return; }
    delete W_.issue;
    delete drafts.issue;
    LIFE[it.id] = ['Accepted', clock(), true];
    render(false);
    setTimeout(() => life(it.id, 'Executing', 'saving on GitHub', true), 400);
    setTimeout(() => { Object.assign(it, { title, ago: 0 }); render(false); done(it.id, `saved ${clock()}`); life(it.id, 'Completed', `saved ${clock()}`, true); toast(`Saved #${it.num}. GitHub confirmed the new title and body.`, 'done'); $(`.card[data-id="${CSS.escape(it.id)}"]`, lanesEl)?.focus(); }, 1500);
  }
  function openIssue() {
    if (W_.issue?.edit) { saveIssue(); return; }
    const w = $('[data-writer="issue"]', lanesEl);
    const title = $('[data-w="issue-title"]', w).value.trim(), body = $('[data-w="issue-body"]', w).value.trim(), repo = $('[data-w="issue-repo"]', w).value;
    if (!title) { Object.assign(W_.issue, { err: 'Add a title: it is required.', body, repo }); render(false); $('[data-w="issue-title"]', lanesEl)?.focus(); return; }
    const source = W_.issue.source, labels = W_.issue.labels || [];
    delete W_.issue;
    delete drafts.issue;
    const num = nextIssue++;
    const it = { id: `${repo}#${num}`, lane: 'issue', repo, num, title, state: 'idle', detail: '', who: null, ago: 0, opened: 0, top: Date.now() };
    ITEMS.push(it);
    LIFE[it.id] = ['Accepted', clock(), true];
    render();
    const card = $(`.card[data-id="${CSS.escape(it.id)}"]`, lanesEl);
    card?.scrollIntoView({ block: 'nearest' });
    card?.focus({ preventScroll: true });
    setTimeout(() => life(it.id, 'Executing', 'opening on GitHub', true), 500);
    setTimeout(() => {
      done(it.id, `opened #${num}`);
      life(it.id, 'Completed', `opened #${num}`, true);
      const hidden = !shown().includes(it) || (only && only !== 'idle');
      if (source) {
        const i = CARDS.findIndex((c) => c.id === source);
        if (i >= 0) { CARDS.splice(i, 1); saveCards(); render(); }
        toast(`Opened #${num} from your card. The card is removed; its text is the issue’s body.${hidden ? ' Your filters hide the issue.' : ''}`, 'done');
      } else toast(`${hidden ? `Opened #${num} in ${repo}. Your filters hide it; clear them to see it.` : `Opened #${num} in ${repo}${labels.length ? `, labelled ${labels.filter((l) => l !== 'design').join(', ') || 'nothing'}` : ''}.`}${labels.includes('design') ? ' GitHub did not apply design: the account may lack permission.' : ''}${labels.includes('poise') ? ' With poise, it enters the chain.' : ''}`, 'done');
    }, 1800);
  }

  // ---------- Beside the board: a task's timeline, or a card's chat ----------
  const sideEl = $('[data-bside]');
  let sideFor = null;
  const KIND_WORD = { invocation: 'Run', event: 'Event', hold: 'Hold', uncertain: 'Not confirmed' };
  function side(mode, it) {
    if (!sideEl) return;
    if (!mode) { sideEl.hidden = true; $('.cur')?.classList.remove('has-side'); const back = sideFor && $(`.card[data-id="${CSS.escape(sideFor)}"]`, lanesEl); sideFor = null; back?.focus(); return; }
    sideFor = it.id;
    $('.cur')?.classList.add('has-side');
    sideEl.hidden = false;
    if (mode === 'about') { sideEl.innerHTML = aboutHTML(it); hydrateIcons(sideEl); window.poisePaintTerms?.(sideEl); return; }
    if (mode === 'task') {
      const t = it.task;
      sideEl.innerHTML = `<div class="bside-h"><span class="t-micro">Task</span><button class="ib" data-act="side-close" aria-label="Close" data-ref="side.close"><i data-i="cross" class="sm"></i></button></div><h3>${esc(t.title)}</h3><p class="t-mono t-gloss">${esc(t.repo)}#${t.issue}${t.pr ? ` → #${t.pr}` : ''}${t.head ? ` · head ${esc(t.head)}` : ''}</p><div class="bside-rail">${TK.railHTML(t)}</div><div class="card-state"><span class="sc" data-state="${t.state}"></span><b>${term('state.' + t.state)}</b><span class="detail">${esc(t.now)}</span></div>${t.hold ? `<p class="bside-hold" data-ref="side.hold">${esc(t.hold)}</p>` : ''}<div class="bside-acts">${t.merged ? '<span class="t-gloss">Merged: its history stays; there is nothing to hold.</span>' : t.state === 'needs-you' && t.hold ? `<button class="btn btn-primary" data-act="side-resume" data-id="${esc(it.id)}" data-ref="task.resume">Resume</button>` : `<button class="btn btn-line" data-act="side-hold" data-id="${esc(it.id)}" data-ref="task.hold">${t.held ? 'Resume' : 'Hold new invocations'}</button>`}<a class="btn btn-line" href="observe.html?tab=tasks&amp;task=${esc(t.id)}&amp;back=board" data-ref="task.open">Open in Observe</a></div><p class="t-micro">Timeline · newest first</p><ol class="bside-tl" data-ref="side.timeline">${t.journal.map(([at, kind, text, ev]) => `<li data-kind="${kind}"><span class="t-mono">${esc(at)}</span><span><b>${KIND_WORD[kind] || 'Event'}</b> ${esc(text)}${ev ? `<span class="t-gloss"> · ${esc(ev)}</span>` : ''}</span></li>`).join('')}</ol><p class="t-gloss">Held still while you read it. Every step is in the chain’s journal, with its time.</p>`;
      $('.bside-acts', sideEl).insertAdjacentHTML('afterend', sameWork(it));
    } else {
      const title = it.title ? `${it.repo}#${it.num} ${it.title}` : it.text;
      sideEl.innerHTML = `<div class="bside-h"><span class="t-micro">Chat about this card</span><button class="ib" data-act="side-close" aria-label="Close" data-ref="side.close"><i data-i="cross" class="sm"></i></button></div><h3>${esc(it.title || it.text)}</h3><p class="t-gloss">${esc(it.title ? `${it.repo}#${it.num}` : it.repo || 'No repository')} · Claude Code · Opus 5 · High · Primary</p><div class="bside-chat" data-side-chat><p class="t-gloss">The chat starts with the card’s title and link. It stays beside the board; nothing leaves Board.</p></div><form class="bside-compose" data-side-form><textarea rows="2" aria-label="Message about this card" placeholder="Ask about this card (Enter)" data-side-in data-ref="side.input"></textarea><button type="button" class="btn btn-primary" data-act="side-send" data-ref="side.send">Send</button></form><a class="lnk" href="chat.html?draft=${encodeURIComponent(title)}&amp;back=board" data-ref="side.open">Open it in Chat instead</a>`;
      $('[data-side-in]', sideEl)?.focus();
    }
    hydrateIcons(sideEl);
    window.poisePaintTerms?.(sideEl);
  }
  function sideSend() {
    const input = $('[data-side-in]', sideEl), text = input?.value.trim();
    if (!text) { input?.focus(); return; }
    input.value = '';
    const log = $('[data-side-chat]', sideEl);
    log.insertAdjacentHTML('beforeend', `<div class="bmsg is-you">${esc(text)}<span class="life-w" data-life-w>Accepted ${clock()}</span></div>`);
    const lw = $$('[data-life-w]', log).pop();
    setTimeout(() => { lw.textContent = 'Executing · reading the card and its links'; }, 500);
    setTimeout(() => { lw.textContent = `Completed ${clock()}`; log.insertAdjacentHTML('beforeend', `<div class="bmsg">Here is what I see on this card: it is ${term('state.' + (byId(sideFor)?.state || 'idle')).toLowerCase()}, and its last change was ${ago(byId(sideFor)?.ago || 0)} ago. Ask me to draft the next step and I will put it here first.</div>`); }, 1800);
  }
  // Labels in the issue writer: filter, tick, and a repository change clears them.
  document.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-labels-filter]') || !W_.issue) return;
    stash();
    W_.issue.lq = e.target.value.trim();
    const pos = e.target.selectionStart;
    render(false);
    const f = $('[data-labels-filter]', lanesEl);
    f?.focus();
    f?.setSelectionRange(pos, pos);
  });
  document.addEventListener('change', (e) => {
    if (!W_.issue) return;
    if (e.target.matches?.('[data-label]')) {
      const set = new Set(W_.issue.labels || []);
      if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      W_.issue.labels = [...set];
      stash();
      render(false);
      $(`[data-label][value="${CSS.escape(e.target.value)}"]`, lanesEl)?.focus();
    }
    if (e.target.matches?.('[data-w="issue-repo"]')) {
      const n = (W_.issue.labels || []).length;
      stash();
      Object.assign(W_.issue, { repo: e.target.value, labels: [], cleared: n || 0, lq: '' });
      render(false);
      $('[data-w="issue-repo"]', lanesEl)?.focus();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('[data-side-in]')) { e.preventDefault(); sideSend(); } if (e.key === 'Escape' && sideEl && !sideEl.hidden && sideEl.contains(e.target)) side(null); });

  // ---------- Card actions, each with its progress on the card ----------
  const MINE = ['idea', 'concept', 'plan'];
  function go(url, id) {
    try { sessionStorage.setItem('poise-current-back', JSON.stringify({ id, scrolls: Object.fromEntries($$('[data-body]', lanesEl).map((b) => [b.dataset.body, b.scrollTop])) })); } catch { /* the route back still works, from the top */ }
    location.href = url;
  }
  function copy(b, text) {
    navigator.clipboard?.writeText(text).catch(() => {});
    const use = $('use', b), old = use.getAttribute('href');
    use.setAttribute('href', '#i-check');
    b.classList.add('is-done');
    setTimeout(() => { use.setAttribute('href', old); b.classList.remove('is-done'); }, 1200);
  }
  function del(b, id) {
    if (!b.classList.contains('is-armed')) {
      b.classList.add('is-armed');
      b.textContent = 'Sure?';
      setTimeout(() => { if (b.isConnected && b.classList.contains('is-armed')) { b.classList.remove('is-armed'); b.innerHTML = '<i data-i="cross" class="sm"></i>'; hydrateIcons(b); } }, 3000);
      return;
    }
    const c = byId(id), lane = c.lane, before = CARDS.filter((x) => x.lane === lane), pos = before.indexOf(c);
    CARDS.splice(CARDS.indexOf(c), 1);
    saveCards();
    render();
    const after = CARDS.filter((x) => x.lane === lane), next = after[Math.min(pos, after.length - 1)];
    (next ? $(`.card[data-id="${next.id}"]`, lanesEl) : $(`[data-lane="${lane}"] .lane-add`, lanesEl))?.focus();
    toast(`Deleted “${c.text.length > 48 ? `${c.text.slice(0, 48)}…` : c.text}”. Nothing on GitHub changed.`);
  }
  function review(it) {
    const prev = { state: it.state, detail: it.detail, who: it.who };
    LIFE[it.id] = ['Accepted', clock(), true];
    change(it.id, { state: 'running', detail: 'review running', who: RUN('Review') }, true);
    setTimeout(() => life(it.id, 'Executing', 'reading the diff and checks', true), 600);
    setTimeout(() => { change(it.id, prev, true); done(it.id, `review posted ${clock()}`); life(it.id, 'Completed', `review posted ${clock()}`, true); toast(`Review posted on #${it.num}.`, 'done'); }, 5200);
  }
  // The Manager takes the issue as a ticket. With a slot free it gives it to a new
  // worker at once; otherwise it queues it behind the tickets already next.
  function hand(it) {
    const chats = window.POISE_CHATS || [], queue = window.POISE_MANAGER?.next || [];
    const used = chats.filter((c) => c.worker && !c.closed && c.state !== 'done').length, limit = +store.get('poise-mgr-rhythm', 7) || 7;
    const free = limit - used - queue.length, ahead = queue.map((x) => `#${x.issue}`);
    LIFE[it.id] = ['Accepted', clock(), false];
    if (free > 0) {
      const n = Math.max(0, ...chats.map((c) => Number(String(c.worker || '').slice(1)) || 0)) + queue.length + 1;
      change(it.id, { state: 'running', detail: 'started in a free slot', who: W(n) }, true);
      setTimeout(() => life(it.id, 'Executing', `W${n} took it: ${used + queue.length + 1} of ${limit} slots in use`), 700);
      toast(`The Manager took #${it.num} and gave it to W${n} in a free slot.`, 'running');
      return;
    }
    queue.push({ issue: it.num, title: `#${it.num} ${it.title}`, project: it.repo });
    change(it.id, { state: 'waiting', detail: `next for a worker${ahead.length ? `, after ${ahead.join(' and ')}` : ''}: the Manager gives it one when a slot frees`, who: MANAGER }, true);
    setTimeout(() => life(it.id, 'Queued', `${used} of ${limit} slots in use${ahead.length ? `; ${ahead.join(' and ')} ahead` : ''}`), 700);
    toast(`The Manager took #${it.num}. All ${limit} slots are in use, so it waits${ahead.length ? ` behind ${ahead.join(' and ')}` : ''} and gets a worker when one frees.`, 'waiting');
  }
  // Assign to Poise adds the chain's label on GitHub, as you. It starts real work, so it asks first, as Stop does.
  let armedAssign = null;
  function assign(b, it) {
    if (armedAssign !== it.id) {
      armedAssign = it.id;
      b.textContent = 'Sure?';
      b.classList.add('is-armed');
      setTimeout(() => { if (armedAssign === it.id) { armedAssign = null; if (b.isConnected) { b.textContent = 'Assign to Poise'; b.classList.remove('is-armed'); } } }, 4000);
      return;
    }
    armedAssign = null;
    const sideAgain = () => { if (sideFor === it.id) side('about', it); };
    // ?assign=refused: the reason stays where you asked, and you can ask again.
    if (params.get('assign') === 'refused') {
      it.assignError = `GitHub refused the label: your account cannot triage ${it.repo}. Nothing changed.`;
      render(false); sideAgain();
      return;
    }
    delete it.assignError;
    // As main does: the label shows at once and stays until GitHub's copy has it.
    LIFE[it.id] = ['Accepted', clock(), false];
    const off = chainOff(), blocked = (CLOSING[it.id] || []).length > 0;
    change(it.id, { who: POISE, state: 'waiting', detail: off ? 'label poise added: the chain takes it once it is on' : blocked ? 'label poise added: an open pull request closes it, so the chain does not take it' : 'label poise added: the chain takes it at its next check' }, true);
    toast(`Label poise added to #${it.num} as you.${off ? ' The chain is off, so it takes the issue once it is on.' : blocked ? ' An open pull request closes it, so the chain does not take it while that is open.' : ' The chain takes it at its next check.'}`, 'waiting');
    sideAgain();
    if (off || blocked) { setTimeout(() => life(it.id, 'Completed', 'label added', false, 4000), 900); return; }
    setTimeout(() => life(it.id, 'Queued', 'waiting for the chain’s next check'), 1500);
    setTimeout(() => {
      change(it.id, { state: 'running', detail: 'Issue review · 2 reviewers · Opus 5' }, true);
      life(it.id, 'Completed', 'it entered the chain', false, 4000);
      sideAgain();
    }, 6000);
  }
  const confirmEl = $('[data-confirm]');
  function confirmChat(b, it) {
    const branch = it.lane === 'pr' ? 'the pull request’s own branch' : `chat/issue-${it.num}`;
    confirmEl.innerHTML = `<h4>Open #${it.num} in Chat</h4><p>A chat that works on this ${it.lane === 'pr' ? 'pull request' : 'issue'}. Nothing runs until you start it.</p><dl><dt>Agent</dt><dd><select data-confirm-agent aria-label="Agent and model" data-ref="confirm.agent"><option>Claude Code · Opus 5 · High</option><option>Muse · spark 1.3 contributor · max</option><option>Codex · GPT-5 Codex · High</option></select></dd><dt>Branch</dt><dd><span class="t-mono">${branch}</span></dd><dt>Repository</dt><dd>${it.repo}</dd></dl><div class="row"><button class="btn btn-line" data-act="chat-cancel" data-ref="composer.cancel">Cancel</button><button class="btn btn-primary" data-act="chat-start" data-id="${it.id}" data-ref="confirm.start">Start chat</button></div>`;
    openMenu(confirmEl, b, 'right');
    $('[data-act="chat-start"]', confirmEl).focus();
  }
  function startChat(id) {
    const it = byId(id), who = $('[data-confirm-agent]', confirmEl).value.split(' · ')[0];
    closeMenus();
    LIFE[id] = ['Accepted', clock(), true];
    change(id, { state: 'running', detail: '', who: { tag: 'Chat', kind: 'chat', go: 'chat.html?back=board' } }, true);
    setTimeout(() => { done(id, `${who} started`); life(id, 'Executing', `${who} started`, true); }, 600);
    toast(`Chat started with ${who} on #${it.num}. It is in Chat under Running.`, 'running');
    $(`.card[data-id="${CSS.escape(id)}"]`, lanesEl)?.focus();
  }
  function move(id, key) {
    const c = byId(id), list = CARDS.filter((x) => x.lane === c.lane), pos = list.indexOf(c);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const other = list[pos + (key === 'ArrowUp' ? -1 : 1)];
      if (!other) return;
      const i = CARDS.indexOf(c), j = CARDS.indexOf(other);
      [CARDS[i], CARDS[j]] = [CARDS[j], CARDS[i]];
    } else {
      const to = MINE[MINE.indexOf(c.lane) + (key === 'ArrowLeft' ? -1 : 1)];
      if (!to) return;
      CARDS.splice(CARDS.indexOf(c), 1);
      const target = CARDS.filter((x) => x.lane === to), anchor = target[Math.min(pos, target.length)];
      c.lane = to;
      CARDS.splice(anchor ? CARDS.indexOf(anchor) : CARDS.length, 0, c);
    }
    saveCards();
    render();
    const now = CARDS.filter((x) => x.lane === c.lane);
    toast(`Moved to ${LANES.find((l) => l.key === c.lane).label}, ${now.indexOf(c) + 1} of ${now.length}.`);
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    const seg = t.closest('[data-filter] button');
    if (seg) { choose({ [seg.closest('[data-filter]').dataset.filter]: seg.dataset.v }); render(); return; }
    const org = t.closest('#org-menu [data-org]');
    if (org) { choose({ org: org.dataset.org }); closeMenus(); render(); return; }
    const ord = t.closest('#order-menu [data-order]');
    if (ord) { order = ord.dataset.order; store.set('poise-current-order', order); closeMenus(); render(); return; }
    const b = t.closest('[data-act]');
    if (b?.matches('[aria-disabled="true"]')) { e.preventDefault(); return; }
    if (!b) {
      const card = t.closest('.card:not(.is-editing)');
      if (!card || t.closest('.card-acts, .writer')) return;
      if (card.dataset.kind === 'mine') startEdit(card.dataset.id);
      else if (byId(card.dataset.id)?.task) side('task', byId(card.dataset.id));
      else side('about', byId(card.dataset.id));
      return;
    }
    const id = b.dataset.id || b.closest('.card')?.dataset.id, it = id && byId(id);
    switch (b.dataset.act) {
      case 'state': only = only === b.dataset.state ? null : b.dataset.state; render(); break;
      case 'clear': choose({ status: 'any', time: 'all', who: 'any' }); search = ''; only = null; $('[data-search]').value = ''; render(); break;
      case 'add': openWriter(`add.${b.dataset.lane}`); break;
      case 'add-issue': openWriter('issue', {}); break;
      case 'w-cancel': { const key = b.dataset.wKey; closeWriter(key, () => (key.startsWith('edit.') ? $(`.card[data-id="${key.slice(5)}"]`, lanesEl) : $(`[data-lane="${key === 'issue' ? 'issue' : key.slice(4)}"] .lane-add`, lanesEl))?.focus()); break; }
      case 'w-add': addCard(b.dataset.lane); break;
      case 'w-save': saveEdit(b.dataset.id); break;
      case 'w-open-issue': openIssue(); break;
      case 'link': e.preventDefault(); toast(`In Poise this opens #${it.num} on GitHub, in a new tab.`); break;
      case 'copy': copy(b, it.title ? `${it.title}\nhttps://github.com/${it.repo}/${it.lane === 'pr' ? 'pull' : 'issues'}/${it.num}` : it.text); break;
      case 'chat': side('chat', it); break;
      case 'task': side('task', it); break;
      case 'side-close': side(null); break;
      case 'side-send': sideSend(); break;
      case 'side-resume': { const t = it?.task || byId(b.dataset.id)?.task; if (t) { Object.assign(t, { state: 'waiting', now: 'Resumed by you: back in the merge queue', hold: null }); t.journal.unshift([clock(), 'event', 'Resumed by you', '']); change(b.dataset.id, { state: 'waiting', detail: t.now }, true); side('task', byId(b.dataset.id)); toast('Resumed. It goes back into the merge queue; the journal records it.', 'waiting'); } break; }
      case 'side-hold': { const t = byId(b.dataset.id)?.task; if (t) { t.held = !t.held; t.journal.unshift([clock(), t.held ? 'hold' : 'event', t.held ? 'Held by you: no new invocations' : 'Resumed by you', '']); side('task', byId(b.dataset.id)); toast(t.held ? 'Held. No new step starts; a run already going carries on.' : 'Resumed. Its next step starts when it is due.', t.held ? 'waiting' : 'running'); } break; }
      case 'labels': { stash(); const d = drafts.issue || {}; Object.assign(W_.issue, { title: d['issue-title'] ?? W_.issue.title, body: d['issue-body'] ?? W_.issue.body, repo: d['issue-repo'] ?? W_.issue.repo, labelsOpen: !W_.issue.labelsOpen }); render(false); $(W_.issue.labelsOpen ? '[data-labels-filter]' : '[data-act="labels"]', lanesEl)?.focus(); break; }
      // One issue writer at a time: an open draft is never discarded to edit another issue.
      case 'edit-issue': if (W_.issue || drafts.issue?.['issue-title'] || drafts.issue?.['issue-body']) { toast('Close the current issue writer before editing another issue. Your draft stays in it.', 'waiting'); if (!W_.issue) openWriter('issue', {}); $('[data-w="issue-title"]', lanesEl)?.focus(); break; } delete drafts.issue; openWriter('issue', { edit: it.id, title: it.title, body: `${it.title}.\n\nOpened from Board.`, repo: it.repo }); break;
      // render() keeps what is typed in the fields, so the latest text replaces them after it.
      case 'w-theirs': { const title = `${byId(W_.issue.edit).title} (edited on GitHub)`, body = 'Their body, as GitHub has it now.'; Object.assign(W_.issue, { conflict: false, loaded: true, title, body }); delete drafts.issue; render(false); $('[data-w="issue-body"]', lanesEl).value = body; const t = $('[data-w="issue-title"]', lanesEl); t.value = title; t.focus(); break; }
      case 'open-chat': if (it.who) go(it.who.go, id); else confirmChat(b, it); break;
      case 'who': go(it.who.go, id); break;
      case 'chat-start': startChat(b.dataset.id); break;
      case 'chat-cancel': closeMenus(); break;
      case 'review': review(it); break;
      case 'manager': hand(it); break;
      case 'assign': assign(b, it); break;
      case 'to-issue': delete drafts.issue; openWriter('issue', { body: it.text, repo: it.repo, source: it.id }); break;
      case 'del': del(b, id); break;
      case 'fold': folds[b.dataset.lane] = !folds[b.dataset.lane]; store.set('poise-current-folds', folds); render(false); $(`[data-act="fold"][data-lane="${b.dataset.lane}"]`, lanesEl)?.focus(); break;
      default: break;
    }
  });

  let searchTimer = 0;
  $('[data-search]').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { search = e.target.value.trim(); render(); }, 90); });

  document.addEventListener('keydown', (e) => {
    const w = e.target.closest?.('[data-writer]');
    // Escape in the label list closes the list only; the draft stays.
    if (w && e.key === 'Escape' && e.target.closest('.labels-pop') && W_.issue?.labelsOpen) { e.preventDefault(); stash(); W_.issue.labelsOpen = false; render(false); $('[data-act="labels"]', lanesEl)?.focus(); return; }
    if (w) {
      const key = w.dataset.writer;
      if (e.key === 'Escape') { e.preventDefault(); closeWriter(key, () => (key.startsWith('edit.') ? $(`.card[data-id="${key.slice(5)}"]`, lanesEl) : $(`[data-lane="${key === 'issue' ? 'issue' : key.slice(4)}"] .lane-add`, lanesEl))?.focus()); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (key === 'issue') openIssue(); else if (key.startsWith('edit.')) saveEdit(key.slice(5)); else addCard(key.slice(4)); }
      return;
    }
    const card = e.target.closest?.('.card');
    if (!card || e.target !== card) return;
    if (card.dataset.kind === 'mine') {
      if (e.key === 'Enter') { e.preventDefault(); startEdit(card.dataset.id); }
      else if (e.altKey && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) { e.preventDefault(); move(card.dataset.id, e.key); }
    } else if (e.key === 'Enter') { e.preventDefault(); toast(`In Poise this opens #${byId(card.dataset.id).num} on GitHub, in a new tab.`); }
  });

  // ---------- Drag your cards; drop one on Issue to open it ----------
  let dragId = null;
  const line = Object.assign(document.createElement('div'), { className: 'drop-line' });
  const endDrag = () => { $$('.is-dragging', lanesEl).forEach((c) => c.classList.remove('is-dragging')); $$('.lane.is-drop, .lane.is-drop-issue', lanesEl).forEach((l) => l.classList.remove('is-drop', 'is-drop-issue')); line.remove(); dragId = null; };
  lanesEl.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.card[data-kind="mine"]:not(.is-editing)');
    if (!c) { e.preventDefault(); return; }
    dragId = c.dataset.id;
    c.classList.add('is-dragging');
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  lanesEl.addEventListener('dragover', (e) => {
    const lane = e.target.closest('.lane');
    if (!dragId || !lane) return;
    $$('.lane.is-drop, .lane.is-drop-issue', lanesEl).forEach((l) => l !== lane && l.classList.remove('is-drop', 'is-drop-issue'));
    if (lane.dataset.lane === 'issue') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; lane.classList.add('is-drop-issue'); line.remove(); return; }
    if (lane.dataset.kind !== 'mine') { line.remove(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    lane.classList.add('is-drop');
    const list = $('[data-list]', lane), cards = $$('.card:not(.is-dragging)', list);
    const idx = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    line.dataset.index = idx < 0 ? cards.length : idx;
    list.insertBefore(line, idx < 0 ? null : cards[idx]);
  });
  lanesEl.addEventListener('dragleave', (e) => { const lane = e.target.closest('.lane'); if (lane && !lane.contains(e.relatedTarget)) { lane.classList.remove('is-drop', 'is-drop-issue'); if (lane.contains(line)) line.remove(); } });
  lanesEl.addEventListener('drop', (e) => {
    const lane = e.target.closest('.lane'), id = dragId, idx = +(line.dataset.index || 0);
    if (!lane || !id) return;
    e.preventDefault();
    endDrag();
    const c = byId(id);
    if (lane.dataset.lane === 'issue') { delete drafts.issue; openWriter('issue', { body: c.text, repo: c.repo, source: c.id }); return; }
    if (lane.dataset.kind !== 'mine') return;
    CARDS.splice(CARDS.indexOf(c), 1);
    const target = CARDS.filter((x) => x.lane === lane.dataset.lane), anchor = target[idx];
    c.lane = lane.dataset.lane;
    CARDS.splice(anchor ? CARDS.indexOf(anchor) : (target.length ? CARDS.indexOf(target[target.length - 1]) + 1 : CARDS.length), 0, c);
    saveCards();
    render();
  });
  lanesEl.addEventListener('dragend', endDrag);

  // ---------- The same evening as Chat and the Manager ----------
  let asked478 = false;
  const asks478 = () => { if (asked478) return; asked478 = true; change('autonomio/poise#478', { state: 'needs-you', detail: 'asks which filter wins' }); };
  setTimeout(asks478, +(params.get('t1') || 7000));
  // #471 merges, as in Chat and the Manager. W2's task has ended, but W2 keeps its
  // slot until you close its chat, so #483 keeps waiting for one.
  setTimeout(() => {
    change('autonomio/poise#471', { state: 'done', detail: 'merged', who: null });
    const w2 = (window.POISE_CHATS || []).find((c) => c.id === 'w2');
    if (w2) Object.assign(w2, { state: 'idle', note: 'merged #471 · keeps its slot until you close it', finished: 'merged #471' });
  }, +(params.get('t2') || 16000));
  setTimeout(() => change('autonomio/poise#487', { state: 'needs-you', detail: 'approved and green: the merge is yours', who: null }), +(params.get('t3') || 24000));

  // ---------- Start, and the route back from Chat or the Manager ----------
  // A link from another place names its route back, and the card it is about.
  const FROM = { overview: ['overview.html', 'Overview'], chat: ['chat.html', 'Chat'], manager: ['manager.html', 'the Manager'], editor: ['editor.html', 'Editor'], observe: ['observe.html', 'Observe'], settings: ['settings.html', 'Settings'] }[params.get('back')];
  if (FROM) { const b = $('[data-back]'); b.hidden = false; b.href = FROM[0]; b.innerHTML = `<i data-i="chev" class="sm"></i>Back to ${FROM[1]}`; hydrateIcons(b); }
  render(false);
  try {
    const back = JSON.parse(sessionStorage.getItem('poise-current-back') || 'null');
    if (back) {
      sessionStorage.removeItem('poise-current-back');
      Object.entries(back.scrolls || {}).forEach(([k, v]) => { const b = $(`[data-body="${k}"]`, lanesEl); if (b) b.scrollTop = v; });
      if (back.id) $(`.card[data-id="${CSS.escape(back.id)}"]`, lanesEl)?.focus({ preventScroll: true });
    }
  } catch { /* no session storage: start at the top */ }
  // A link opens what it names, clearing a filter that hides it.
  const named = params.get('item') && byId(params.get('item'));
  const namedCard = () => named && $(`.card[data-id="${CSS.escape(named.id)}"]`, lanesEl);
  if (named && (!namedCard() || named.state === 'done')) {
    if (!namedCard()) { Object.entries({ status: 'any', time: 'all', org: '', who: 'any' }).forEach(([k, v]) => linkTo(k, v)); search = ''; only = null; }
    if (named.state === 'done') folds[named.lane] = true;
    render(false);
  }
  const asked = namedCard();
  if (asked) { asked.scrollIntoView({ block: 'center' }); asked.focus({ preventScroll: true }); asked.classList.add('is-flash'); setTimeout(() => asked.classList.remove('is-flash'), 1600); }
  // A link from the review opens an element that shows only while you use the board.
  const want = params.get('ref');
  if (want === 'card.edit') { const c = CARDS.find((x) => MINE.includes(x.lane)); if (c) startEdit(c.id); }
  if (want === 'composer.labels') openWriter('issue', { labelsOpen: true });
  if (want === 'cur.clear') { only = 'failed'; render(false); }
  if (want === 'side.about' || want === 'side.same') side('about', byId('Acme/Limen#1158'));
  if (want === 'lane.drop') $('.lane[data-lane="issue"]', lanesEl)?.classList.add('is-drop-issue');
  // Held updates: W3's question arrives while you are on the board, so it waits, counted.
  if (want === 'cur.held') { onBoard = true; asks478(); }
  if (want) setTimeout(() => window.poiseOpenRef?.($(`[data-ref="${want}"]`)), 700);
  if (params.get('tip')) setTimeout(() => window.poiseShowTip?.($(`[data-ref="${params.get('tip')}"]`)), 700);
})();
