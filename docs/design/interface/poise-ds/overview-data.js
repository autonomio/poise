// The Overview's data and actions, shared by both directions. It agrees with the
// other views' mock data: the same chats, workers, pull requests, behaviors and
// accounts. Notices are answered here; what an answer does shows on the notice.
(() => {
  const { store, clock, params } = window.PoiseShell;
  const KEY = 'poise-overview-v1';
  const kept = store.get(KEY, {});
  const listeners = new Set();
  const emit = (what) => listeners.forEach((fn) => fn(what));

  // ---------- Levels: how much of the notices you see ----------
  // The live groups, by who acts; each level includes the ones before it.
  const GROUPS = [
    ['needs-you', 'Needs you', 'What only you can do.'],
    ['fault', 'Poise faults', 'Poise itself needs repair.'],
    ['ready', 'Done', 'Finished, for you to see.'],
    ['auto', 'Handled automatically', 'Poise is retrying; there is nothing to do.']
  ];
  const LEVELS = [
    ['needs-you', 'Only you', 'Only what needs you'],
    ['fault', '+ Faults', 'What needs you, and Poise faults'],
    ['ready', '+ Done', 'Also what has finished. The bell counts this'],
    ['auto', 'Everything', 'Also what Poise handles on its own']
  ];
  let level = Math.min(3, Math.max(0, Number(store.get('poise-overview-level', 2))));

  // ---------- Notices: everything that wants you, with its answers ----------
  // An option's `then` is what happens, in the instruction lifecycle's words.
  const N = [
    {
      id: 'n475', group: 'needs-you', kind: 'Permission', title: 'Run gh pr create', since: '19:41',
      who: 'Muse · spark 1.3 contributor', where: '#475 Stop Browser Chromium shards being cancelled at 15 minutes', state: 'needs-you',
      body: 'Open a pull request for fix/browser-shard-timeout on autonomio/poise.', code: 'gh pr create --fill --base main',
      options: [
        { key: 'allow', label: 'Allow once', primary: true, then: ['Muse opens the pull request', 'Allowed once · it opened autonomio/poise#488'] },
        { key: 'always', label: 'Always allow in this session', then: ['Muse opens the pull request', 'Always allowed in this session · #488 opened'] },
        { key: 'deny', label: 'Deny', then: ['Muse ends the turn', 'Denied · the branch stays pushed for later'] }
      ],
      open: ['chat.html?back=overview', 'Open the chat']
    },
    {
      id: 'nw4', group: 'needs-you', kind: 'Question', title: 'Which note stays untouched?', since: '19:22',
      who: 'W4 · Muse · spark 1.3 contributor', where: 'autonomio/poise#477 Keep one note per issue, left untouched', state: 'needs-you',
      body: 'Issue #477 has two notes marked “left untouched”. Keep the first one from the original report, or the newer one with the repro steps?',
      why: 'Why this came to you: Autonomy is Balanced, and what stays in an issue is a product choice.',
      options: [
        { key: 'repro', label: 'The note with the repro', primary: true, then: ['W4 removes the other note', 'Answered · W4 closes #477'] },
        { key: 'first', label: 'The first note', then: ['W4 removes the other note', 'Answered · W4 closes #477'] }
      ],
      reply: true, replyLabel: 'Something else…', replyPlaceholder: 'Your own answer, sent to W4', replySend: 'Send answer', replyThen: ['W4 continues with your words', 'Answered in your words · W4 continues'],
      open: ['manager.html?peek=w4&back=overview', 'Open W4 in the Manager']
    },
    {
      id: 'n473', group: 'needs-you', kind: 'Review requested', title: 'autonomio/poise#473 requests your review', since: '18:54',
      who: 'opened by bit-mis', where: 'checks pass · nothing waits on it', state: 'needs-you',
      body: 'Let a pending Poise update land within a bounded pause, then resume interrupted chats',
      options: [
        { key: 'agent', label: 'Ask an agent to review', primary: true, then: ['Claude Code · Opus 5 · Max reviews it', 'Review posted on GitHub · 2 suggestions, no blockers'] },
        { key: 'approve', label: 'Approve', then: ['Approving on GitHub', 'Approved as mikkokotila'] }
      ],
      open: ['https://github.com/autonomio/poise/pull/473', 'Open on GitHub']
    },
    {
      id: 'n1141', group: 'needs-you', kind: 'Review requested', title: 'Acme/Limen#1141 requests your review', since: 'yesterday',
      who: 'W5 waits for it', where: 'W5 reads the gate thresholds from the schema it changes', state: 'blocked',
      body: 'Size existing primary entries with causal meta models',
      options: [
        { key: 'agent', label: 'Ask an agent to review', primary: true, then: ['Codex · GPT-6 Astra · Max reviews it', 'Review posted on GitHub · W5 can continue'] },
        { key: 'approve', label: 'Approve', then: ['Approving on GitHub', 'Approved as mikkokotila · W5 can continue'] }
      ],
      open: ['https://github.com/Acme/Limen/pull/1141', 'Open on GitHub']
    },
    {
      id: 'ngrok', group: 'needs-you', kind: 'Sign-in needed', title: 'Grok needs you to sign in', since: '09:12',
      who: 'grok login --device-auth', where: 'Accounts', state: 'needs-you',
      body: 'Grok is not signed in, so work that runs it cannot start. Connect it in Settings → Accounts.',
      options: [{ key: 'connect', label: 'Connect', primary: true, then: ['Waiting for you to sign in, in the browser it opens', 'Signed in as mikko@example.com'] }],
      open: ['settings.html?back=overview#accounts', 'Open Accounts']
    },
    {
      id: 'n446', group: 'ready', kind: 'Turn ended', title: 'Grok Build stopped early', since: '13:20',
      who: 'Grok Build · Grok 5', where: 'the provider failed · nothing was pushed', state: 'failed',
      body: '“Task: fix autonomio/poise#446” ended (error) after 7 minutes.',
      options: [
        { key: 'muse', label: 'Retry on Muse', primary: true, then: ['Muse picks up from the last good step', 'Running again on Muse · spark 1.3 contributor'] },
        { key: 'codex', label: 'Retry on Codex', then: ['Codex picks up from the last good step', 'Running again on Codex · GPT-5 Codex'] }
      ],
      open: ['chat.html?back=overview&away=c446', 'Open the chat']
    },
    {
      id: 'nchain', group: 'needs-you', kind: 'Chain held', title: 'autonomio/poise#502 needs a decision', since: '19:05', meta: 'no verified advance for 36m',
      who: 'the chain', where: 'Overview: a tile that fails shows the error, never zero', state: 'needs-you',
      impact: 'blocked · autonomio/poise#502 · Merge · last verified progress 19:05',
      body: 'Someone removed #502 from the merge queue by hand, so the chain waits for your decision. Resume puts it back in the queue.',
      options: [{ key: 'resume', label: 'Resume', primary: true, then: ['Putting it back in the merge queue', 'Resumed · back in the merge queue'] }],
      open: ['observe.html?tab=tasks&task=t501&after=2&back=overview', 'Open its timeline']
    },
    {
      // Main lists chain work that has not advanced for a day (#955), with what holds it and what comes next.
      id: 'ndelay', group: 'needs-you', kind: 'Behavior chain', title: 'autonomio/poise#493 · Implementation', since: 'yesterday', meta: 'no verified advance for 1d 2h',
      who: 'the chain', where: 'Overview: say why a tile is empty', state: 'waiting',
      body: 'Implementation waits for CI on main: GitHub returned 502 reading the checks.\nEvidence: no pull request yet · CI on main not read since 18:12.\nNext: read the checks again · 19:50. A recheck never retries held work.',
      impact: 'retrying · autonomio/poise#493 · Implementation · last verified progress Thu 17:05 · next retry 19:50',
      options: [], open: ['observe.html?tab=tasks&task=t493&after=2&back=overview', 'Open its timeline']
    },
    {
      id: 'nidle', ref: 'ov.idle', group: 'needs-you', kind: 'Idle slots', title: '1 of 5 worker slots idle · the enhancement backlog is empty', since: '19:26',
      who: 'the Manager’s workers', where: '4 of 5 worker chats running', state: 'needs-you',
      body: 'No open, unassigned enhancement issue is left for the Manager. Label one of these, perf and P0–P1 first:\n· autonomio/poise#466 Restart a Muse chat on a fresh session\n· autonomio/poise#489 Retry approve-prs checks at the quota reset\n· Acme/Limen#1158 Preserve string categories on serial resume\n· Acme/Limen#1098 Admit valid frozen PBO partitions\n· autonomio/poise#461 Don’t wake a chat for notices about a closed issue',
      options: [], silenceable: true, silenceWords: 'until a slot fills or an issue is labelled', dismissable: true, dismissWords: 'until its next reminder, at most hourly',
      open: ['https://github.com/autonomio/poise/issues?q=is%3Aopen+no%3Alabel', 'Open the candidates on GitHub']
    },
    {
      id: 'naccess', group: 'needs-you', kind: 'Held', title: 'Reviews cannot start in northwind/forecast-model', since: '17:40',
      who: 'Review New Pull Requests', where: 'bit-mis cannot read the repository', state: 'blocked',
      body: 'GitHub answers the same for missing access and for an invitation not yet accepted. Poise checks again every hour, and clears this once it can read the repository.',
      options: [], open: ['https://github.com/northwind/forecast-model/settings/access', 'Invite bit-mis, or resend its invitation']
    },
    {
      id: 'n460', group: 'needs-you', kind: 'Merge conflict', title: 'autonomio/poise#460 has a merge conflict', since: '19:18',
      who: 'opened by you', where: 'conflicts with main', state: 'blocked',
      body: 'Keep Chat agent turns running through a Poise update',
      options: [{ key: 'resolve', label: 'Ask an agent to resolve it', primary: true, then: ['A chat resolves it on the branch', 'Resolved on the branch · checks running'] }],
      open: ['https://github.com/autonomio/poise/pull/460', 'Open on GitHub']
    },
    {
      id: 'nhelios', group: 'needs-you', kind: 'Review comments', title: '2 comments on HELIOS', since: '19:31',
      who: 'Copilot', where: 'example.com · pull request #14', state: 'needs-you',
      body: '“Name two or three of these services; it makes the dispersion concrete.” And: “The document opens with two H1 headings in a row. Consider making the second a subtitle.”',
      reply: true,
      options: [
        { key: 'resolve', label: 'Resolve both', then: ['Resolving on GitHub', 'Resolved · the site’s pull request can merge'] }
      ],
      open: ['editor.html?tab=reviews&back=overview', 'Open in Editor']
    },
    {
      id: 'nquota', group: 'needs-you', kind: 'GitHub API', title: 'GitHub REST quota may run out for bit-mis', since: '19:39',
      who: 'automation account', where: 'used at 71 a minute; Review New Pull Requests spends most of it', state: 'needs-you',
      body: 'automation account · 3,950 of 5,000 used. 58% estimated risk before reset at the observed usage rate. Resets at 19:58.',
      options: [{ key: 'pause', label: 'Pause Review New Pull Requests until 19:58', primary: true, then: ['Pausing the behavior', 'Paused until the reset · it resumes on its own'] }],
      dismissable: true, open: ['settings.html?back=overview#behaviors', 'Open Behaviors']
    },
    {
      id: 'nsync', group: 'needs-you', kind: 'GitHub data', title: 'GitHub data for northwind is not updating', since: '19:24',
      who: 'datastore', where: 'GitHub returned 502 · its cards on Board may be out of date', state: 'waiting',
      body: 'Syncing it has failed for 17 minutes. Poise keeps retrying; Settings → General → GitHub accounts shows the error.',
      options: [{ key: 'sync', label: 'Sync now', primary: true, then: ['Syncing northwind', 'Synced · 3 changes since 19:24'] }],
      dismissable: true
    },
    {
      id: 'nledger', group: 'fault', kind: 'Ledger', title: 'Behavior ledger is not draining', since: '19:35',
      who: 'behavior ledger', where: 'behaviors carry on; their history reads as incomplete, never as zero', state: 'failed',
      body: 'Its oldest queued capture is 6 minutes old; history is delayed until the queue drains.',
      options: [], dismissable: true, open: ['observe.html?tab=logging&back=overview', 'Open its diagnostic']
    },
    {
      id: 'nloss', group: 'fault', kind: 'Ledger', title: 'Behavior ledger lost captures', since: '18:06',
      who: 'behavior ledger', where: '18:02 to 18:05, a restart without a clean stop · nothing was lost on GitHub', state: 'failed',
      body: '12 captures were lost; 12 total in this store. The gaps stay in history.',
      options: [], dismissable: true, open: ['observe.html?tab=logging&back=overview', 'Open its diagnostic']
    },
    {
      id: 'ndisk', group: 'needs-you', kind: 'Storage', title: 'Workspace disk is 95% full', since: '17:55',
      who: 'workspace', where: '/workspace · chats and checkouts fill most of it', state: 'needs-you',
      body: '4.6 GB free. Maintenance ran, shedding caches first',
      options: [], dismissable: true, open: ['settings.html?back=overview#admin', 'Open Admin']
    },
    {
      id: 'n484', group: 'needs-you', kind: 'Ready to merge', title: 'autonomio/poise#484 is ready to merge', since: '19:15',
      who: 'approved by bit-mis', where: 'checks pass · no open conversations · waited 26 minutes, reminds you every 15', state: 'needs-you',
      body: 'Keep datastore scheduling fresh during repository changes',
      options: [{ key: 'merge', label: 'Merge', primary: true, then: ['Merging into main', 'Merged into main · the branch is deleted'] }],
      silenceable: true, dismissable: true, open: ['https://github.com/autonomio/poise/pull/484', 'Open on GitHub']
    },
    {
      id: 'n479', group: 'ready', kind: 'Turn finished', title: 'Codex finished', since: '19:18',
      who: 'Codex · GPT-5 Codex', where: 'it pushed two commits; CI is running on the pull request', state: 'waiting',
      body: '“#479 Raise the Codex retry budget” is done after 6 minutes.',
      options: [], dismissable: true, open: ['chat.html?back=overview&away=c479', 'Open the chat']
    },
    {
      id: 'ngrey', group: 'auto', kind: 'Behavior held', title: 'Rerun Grey CI failed at 18:40', since: '18:40',
      who: 'Rerun Grey CI', where: 'GitHub’s API limit on bit-mis', state: 'failed',
      body: 'It tries again at 19:50, after the automation account’s REST reset.',
      options: [], open: ['observe.html?tab=logging&event=grey&back=overview', 'Open its diagnostic in Observe']
    },
    {
      id: 'nwaitconv', group: 'needs-you', kind: 'Waiting', title: 'Approve Pull Requests waits on #487', since: '19:30',
      who: 'Approve Pull Requests', where: 'other reviewers’ conversations are open', state: 'waiting',
      body: 'Nothing was approved. Poise tries again while the head is unchanged, once those conversations are resolved.', options: []
    },
    {
      id: 'napprove', group: 'auto', kind: 'Retried', title: 'Approve Pull Requests retried #484', since: '18:55',
      who: 'Approve Pull Requests', where: 'after a 502 from GitHub', state: 'done',
      body: 'The second attempt approved it. Nothing to do.', options: []
    }
  ];
  // What arrives while you are here.
  const LATER = [
    [+(new URLSearchParams(location.search).get('t1')) || 7000, {
      id: 'nw3', group: 'needs-you', kind: 'Question', title: 'Which filter wins?', since: null,
      who: 'W3 · Claude Code · Opus 5 · High', where: 'autonomio/poise#478 One filter bar for Archive and Analytics', state: 'needs-you',
      body: 'Archive and Analytics disagree on the date range when both are open. Which one should the shared filter bar keep?',
      why: 'Why this came to you: Autonomy is Balanced, and this is a design choice.',
      options: [
        { key: 'archive', label: 'Archive’s absolute dates', then: ['W3 applies it', 'Answered · W3 continues on #478'] },
        { key: 'analytics', label: 'Analytics’ relative range', then: ['W3 applies it', 'Answered · W3 continues on #478'] },
        { key: 'both', label: 'Keep both, with a note', then: ['W3 applies it', 'Answered · W3 continues on #478'] }
      ],
      open: ['manager.html?peek=w3&back=overview', 'Open W3 in the Manager']
    }],
    [+(new URLSearchParams(location.search).get('t3')) || 24000, {
      id: 'n487', group: 'needs-you', kind: 'Ready to merge', title: 'autonomio/poise#487 is ready to merge', since: null,
      who: 'checks just passed', where: 'no open conversations · reminds you every 15 minutes until merged or silenced', state: 'needs-you',
      body: 'Don’t report untouched binary files as unrevertable changes after Chat turns',
      options: [{ key: 'merge', label: 'Merge', primary: true, then: ['Merging into main', 'Merged into main · the branch is deleted'] }],
      silenceable: true, dismissable: true, open: ['https://github.com/autonomio/poise/pull/487', 'Open on GitHub']
    }]
  ];
  // Already handled today, for continuity.
  const HANDLED = [
    { id: 'h1', title: 'Merged autonomio/poise#472', note: 'by you', at: '18:10' },
    { id: 'h2', title: 'W2 may run the migration on #471', note: 'Allowed once', at: '17:02' },
    { id: 'h3', title: 'Google’s edits to HELIOS', note: 'Imported', at: '16:45' }
  ];
  (kept.done || []).forEach((d) => { const n = N.find((x) => x.id === d.id); if (n) { n.answered = d; } });
  // Idle slots (#782) are said only while the Manager's slots really sit idle and nothing waits for one.
  const IDLE = N.splice(N.findIndex((n) => n.id === 'nidle'), 1)[0];

  const save = () => store.set(KEY, { done: N.filter((n) => n.answered && !n.answered.undoable).map((n) => ({ id: n.id, key: n.answered.key, label: n.answered.label, words: n.answered.words, at: n.answered.at, how: n.answered.how })) });
  // Off in Settings → General, the server stops its notices and the check of pull requests at once. A chat's own
  // requests and a document's threads are read from them, and Behaviors' diagnostics stay. ?notifications=off
  const NOTICES_OFF = params.get('notifications') === 'off' || store.get('poise-settings-v1', {}).values?.notifications === 'off';
  const FROM_FEED = new Set(['Review requested', 'Sign-in needed', 'Turn ended', 'Idle slots', 'Merge conflict', 'GitHub API', 'GitHub data', 'Ledger', 'Storage', 'Ready to merge', 'Turn finished']);
  if (NOTICES_OFF) for (let i = N.length - 1; i >= 0; i -= 1) if (FROM_FEED.has(N[i].kind)) N.splice(i, 1);
  const open = () => N.filter((n) => !n.answered);
  const shown = () => open().filter((n) => GROUPS.findIndex((g) => g[0] === n.group) <= level);
  // The bell counts what the level shows, never what Poise handles on its own.
  function bell() {
    const s = shown().filter((n) => n.group !== 'auto');
    const tone = s.some((n) => n.group === 'fault') ? 'failed' : s.some((n) => n.group === 'needs-you') ? 'needs-you' : s.length ? 'done' : '';
    return { count: s.length, tone };
  }

  // Arrivals wait while you are in the list, so nothing moves under you.
  let holding = false;
  const held = [];
  // An arrival is news about the work it comes from, as Chat and Board show it at the same moment.
  const ARRIVES = {
    nw3: [{ id: 'w3', state: 'needs-you', note: 'asks which filter wins' }, { id: 'autonomio/poise#478', state: 'needs-you', note: 'asks which filter wins' }],
    n487: [{ id: 'autonomio/poise#487', state: 'needs-you', note: 'approved and green: the merge is yours' }]
  };
  const changeWork = (list) => {
    list.forEach((a) => {
      const w = workRef?.find((x) => x.id === a.id), c = (window.POISE_CHATS || []).find((x) => x.id === a.id);
      if (w) Object.assign(w, { state: a.state, note: a.note });
      if (c) Object.assign(c, { state: a.state, note: a.note }, a.finished ? { finished: a.finished } : {});
    });
    emit('work');
  };
  // #471 merges at t2, as on Board and in Chat: W2's task ends, and W2 keeps its slot until you close it.
  setTimeout(() => changeWork([{ id: 'autonomio/poise#471', state: 'done', note: 'merged' }, { id: 'w2', state: 'idle', note: 'merged #471 · keeps its slot until you close it', finished: 'merged #471' }]), +(new URLSearchParams(location.search).get('t2')) || 16000);
  function arrive(n) {
    n.since = clock();
    n.fresh = true;
    if (ARRIVES[n.id]) changeWork(ARRIVES[n.id]);
    if (NOTICES_OFF && FROM_FEED.has(n.kind)) return;
    if (holding) { held.push(n); emit('held'); return; }
    N.unshift(n);
    emit('arrive');
  }
  LATER.forEach(([ms, n]) => { if (!N.some((x) => x.id === n.id)) setTimeout(() => arrive(n), ms); });

  // ---------- Answering ----------
  // Accepted at once, Executing while it acts, then Completed with what happened.
  function answer(id, key, text) {
    const n = N.find((x) => x.id === id);
    if (!n || n.answering) return;
    const o = n.options.find((x) => x.key === key) || (key === 'reply' ? { key: 'reply', label: 'Reply', then: n.replyThen || ['Posting your reply on GitHub', 'Replied on GitHub'] } : null);
    if (!o) return;
    n.answering = { key, label: o.label, stage: 'Accepted', words: clock(), text };
    emit('answer');
    setTimeout(() => { Object.assign(n.answering, { stage: 'Executing', words: o.then[0] }); emit('answer'); }, 500);
    setTimeout(() => {
      n.answered = { id, key, label: o.label, words: o.then[1], at: clock(), how: key === 'reply' ? `“${(text || '').slice(0, 60)}”` : o.label, undoable: false };
      delete n.answering;
      save();
      EFFECTS[key]?.(true);
      emit('answered');
      if (n.answered.undoable) setTimeout(() => { if (n.answered) { n.answered.undoable = false; save(); emit('settled'); } }, 8000);
    }, 1700);
  }
  function undo(id) {
    const n = N.find((x) => x.id === id);
    if (!n?.answered?.undoable) return;
    EFFECTS[n.answered.key]?.(false);
    delete n.answered;
    save();
    emit('undo');
  }
  function dismiss(id, how = 'Dismissed') {
    const n = N.find((x) => x.id === id);
    if (!n) return;
    n.answered = { id, key: how.toLowerCase(), label: how, words: how === 'Silenced' ? 'No more reminders while it stays open' : 'Put away', at: clock(), how, undoable: true };
    save();
    emit('answered');
    setTimeout(() => { if (n.answered) { n.answered.undoable = false; save(); emit('settled'); } }, 8000);
  }

  // ---------- The day's numbers, from Analytics ----------
  // Today is partial: typical by now is the seven-day median scaled to the time of day.
  const dayFraction = () => { const [h, m] = clock().split(':').map(Number); return (h * 60 + m) / 1440; };
  const ORGS = [['all', 'All orgs', 1], ['autonomio', 'autonomio', 0.62], ['Acme', 'Acme', 0.24], ['mikkokotila', 'mikkokotila', 0.09], ['northwind', 'northwind', 0.03], ['harbor-research', 'harbor-research', 0.02]];
  const PROD = [
    { id: 'prs-opened', label: 'Pull requests opened', short: 'PRs opened', today: 9, yesterday: 12, median: 10, kind: 'count' },
    { id: 'prs-merged', label: 'Pull requests merged', short: 'PRs merged', today: 15, yesterday: 13, median: 14, kind: 'count' },
    { id: 'closed', label: 'Closed without merging', short: 'Closed unmerged', today: 2, yesterday: 1, median: 3, kind: 'count', fewer: true },
    { id: 'lines', label: 'Lines changed', short: 'Lines changed', today: 4820, yesterday: 7310, median: 6100, kind: 'count' },
    { id: 'first-review', label: 'Time to first review', short: 'First review', today: 1120, yesterday: 1610, median: 1450, kind: 'time', n: 11 },
    { id: 'time-merge', label: 'Time to merge', short: 'Time to merge', today: 11520, yesterday: 8820, median: 9660, kind: 'time', n: 15 },
    { id: 'issues-opened', label: 'Issues opened', short: 'Issues opened', today: 6, yesterday: 4, median: 5, kind: 'count' },
    { id: 'issues-closed', label: 'Issues closed', short: 'Issues closed', today: 4, yesterday: 7, median: 6, kind: 'count' }
  ];
  const PER_PR = [
    { id: 'comments', label: 'Comments', today: 4, yesterday: 6, median: 5, kind: 'num' },
    { id: 'median-lines', label: 'Median lines', today: 186, yesterday: 262, median: 240, kind: 'num', fewer: true },
    { id: 'behaviors', label: 'Behaviors', today: 2, yesterday: 2, median: 2, kind: 'num', note: '14 reviews and 9 approvals today' },
    { id: 'median-time', label: 'Median time', today: 11100, yesterday: 8400, median: 9480, kind: 'time' },
    { id: 'agent-merges', label: 'Merged by agent', today: 0.6, yesterday: 0.46, median: 0.52, kind: 'share', of: [9, 15], note: '7-day share' }
  ];
  const WORK_TYPE = [['fix', 6], ['feat', 4], ['ci', 2], ['test', 1], ['refactor', 1], ['unclassified', 1]];
  const FRICTION = [
    { id: 'rounds', label: 'Review rounds', today: 2, yesterday: 2, median: 2, kind: 'num', note: '13 of 15 merged PRs had a review' },
    { id: 'change-share', label: 'Change-request share', today: 0.27, yesterday: 0.38, median: 0.31, kind: 'share', of: [4, 15], fewer: true }
  ];
  // A year of weekly values per metric: seeded, so every visit draws the same year.
  function year(seed, base, spread, trend = 0) {
    let x = seed;
    const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    return [...Array(52)].map((_, i) => Math.max(0, base * (1 + trend * (i - 26) / 52) + (rnd() - 0.5) * spread));
  }
  const HIST = Object.fromEntries([...PROD, ...PER_PR, ...FRICTION].map((m, i) => [m.id, year(i * 97 + 13, m.median, m.median * (m.kind === 'share' ? 0.5 : 0.6), i % 3 === 0 ? 0.35 : i % 3 === 1 ? -0.15 : 0.1)]));
  let day = 0, org = 'all';
  const dayLabel = () => (day === 0 ? 'Today' : day === 1 ? 'Yesterday' : (() => { const d = new Date(2026, 9, 23 - day); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); })());
  const scale = () => ORGS.find((o) => o[0] === org)[2];
  function valueOf(m) {
    const f = m.kind === 'count' ? scale() : 1;
    if (day === 0) return m.today * f;
    if (day === 1) return m.yesterday * f;
    return HIST[m.id][51 - Math.min(51, day)] * f * (m.kind === 'count' ? 1 : 1);
  }
  // Pace: ahead or behind outside ±10%, on pace inside; fewer-is-better reads the other way.
  function pace(m) {
    const v = valueOf(m), f = m.kind === 'count' ? scale() : 1;
    const typical = m.median * f * (day === 0 && m.kind === 'count' ? dayFraction() : 1);
    if (!typical) return { v, typical, ratio: null, tone: 'neutral', words: '—' };
    const ratio = v / typical;
    const pct = Math.abs(ratio - 1) * 100;
    // An outside-band change that rounds to 10% says “>10%”.
    const pctText = Math.round(pct * 10) / 10 === 10 && pct > 10 ? '>10' : (Math.round(pct * 10) / 10).toString();
    if (m.kind === 'time') {
      const faster = v < typical;
      return { v, typical, ratio, tone: Math.abs(ratio - 1) < 0.001 ? 'neutral' : faster ? 'good' : 'bad', dir: faster ? 'down' : 'up', words: `${pctText}% ${faster ? 'faster' : 'slower'} than the 7-day median${m.n ? ` · ${m.n} ${m.id === 'first-review' ? 'first reviews' : 'merges'}` : ''}` };
    }
    if (m.kind !== 'count') {
      const better = m.fewer ? v < typical : null;
      return { v, typical, ratio, tone: Math.abs(ratio - 1) < 0.001 ? 'neutral' : better === null ? 'neutral' : better ? 'good' : 'bad', dir: v > typical ? 'up' : v < typical ? 'down' : 'flat', words: `${v > typical ? '+' : v < typical ? '−' : ''}${pctText}% against the 7-day ${m.kind === 'share' ? 'share' : 'median'}` };
    }
    const within = ratio >= 0.9 && ratio <= 1.1;
    if (within) return { v, typical, ratio, tone: 'neutral', dir: 'flat', words: day === 0 ? 'On pace' : 'About typical' };
    const ahead = ratio > 1;
    const good = m.fewer ? !ahead : ahead;
    const words = day === 0
      ? (m.fewer ? `${pctText}% ${ahead ? 'above' : 'below'} typical` : `${pctText}% ${ahead ? 'ahead of' : 'behind'} pace`)
      : `${pctText}% ${ahead ? 'above' : 'below'} the 7-day median`;
    return { v, typical, ratio, tone: good ? 'good' : 'bad', dir: ahead ? 'up' : 'down', words };
  }
  const fmt = (m, v) => {
    if (v == null || Number.isNaN(v)) return '—';
    if (m.kind === 'time') { const s = Math.round(v); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`; const h = Math.floor(s / 3600); return h < 48 ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`; }
    if (m.kind === 'share') return `${Math.round(v * 100)}%`;
    if (m.kind === 'num') return (Math.round(v * 10) / 10).toLocaleString('en-US');
    return Math.round(v).toLocaleString('en-US');
  };

  // ---------- Behaviors: runs, minutes and success, by range ----------
  const RANGES = [['all', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week']];
  const settingsOn = (id, def) => store.get('poise-settings-v1', {}).values?.[`beh.${id}`]?.on ?? def;
  // System health (#1101, planned): five live cards over the last 24 hours of v2 chain work.
  // Each opens the evidence behind its value.
  const HEALTH = {
    errors: { rate: '0.5', errors: 3, completed: 6, href: 'observe.html?tab=logging&back=overview' },
    blocked: { count: 3, oldest: '1d 2h', stage: 'Implementation, Repair and Merge, one each', href: 'observe.html?tab=tasks&which=attention&back=overview' },
    recovery: { auto: 2, helped: 1, href: 'observe.html?tab=tasks&back=overview' },
    lastError: { ago: '15m', at: '19:26', what: 'Repair on autonomio/poise#496', href: 'observe.html?tab=logging&back=overview' },
    coverage: [['Chain journal', [['covered', 100]]], ['Caller receipts', [['covered', 88], ['gap', 2], ['covered', 10]]], ['Logging', [['covered', 96], ['unknown', 4]]], ['GitHub mirror', null, 'northwind stale since 19:24']],
    coverageHref: 'observe.html?tab=logging&data=1&back=overview'
  };
  const BEHAVIORS = [
    { worker: true, id: 'review-new-prs', see: 'observe.html?pr=autonomio/poise%23486', label: 'Review New Pull Requests', def: 'on', last: ['done', '19:12', 'reviewed #486'], m: { all: [412, 2890, 94], today: [14, 96, 93], yesterday: [17, 121, 94], week: [88, 612, 95] }, chips: {} },
    { worker: true, id: 'approve-prs', see: 'observe.html?pr=autonomio/poise%23484', label: 'Approve Pull Requests', def: 'on', last: ['done', '18:55', 'approved #484'], m: { all: [301, 640, 99], today: [9, 22, 100], yesterday: [11, 27, 100], week: [61, 140, 98] }, chips: { auto: 1 } },
    { worker: true, id: 'resolve-unblocking', see: 'observe.html?pr=autonomio/poise%23471', label: 'Resolve Unblocking Conversations', def: 'on', last: ['done', '17:20', 'resolved 2 on #471'], m: { all: [188, 12, 100], today: [5, 1, 100], yesterday: [6, 1, 100], week: [34, 3, 100] }, chips: {} },
    { id: 'rerun-grey-ci', see: 'observe.html?tab=logging&amp;event=grey', label: 'Rerun Grey CI', def: 'on', last: ['failed', '18:40', 'GitHub’s API limit'], m: { all: [233, 140, 88], today: [7, 4, 71], yesterday: [9, 6, 89], week: [49, 31, 84] }, chips: { auto: 1 } },
    { id: 'merge-prs', label: 'Merge Pull Requests', def: 'off', last: null, m: { all: [0, 0, null], today: [0, 0, null], yesterday: [0, 0, null], week: [0, 0, null] }, chips: {} },
    { id: 'review-new-issues', see: 'observe.html?pr=autonomio/poise%23483', label: 'Review New Issues', def: 'on', last: ['done', '16:03', 'reviewed #483'], m: { all: [96, 702, 97], today: [3, 18, 100], yesterday: [4, 25, 100], week: [19, 140, 95] }, chips: {} }
  ].map((b) => ({ ...b, on: settingsOn(b.id, b.def), paused: null }));
  function setBehavior(id, on) {
    const b = BEHAVIORS.find((x) => x.id === id);
    b.on = on;
    const all = store.get('poise-settings-v1', {});
    all.values = all.values || {};
    all.values[`beh.${id}`] = { ...(all.values[`beh.${id}`] || {}), on };
    store.set('poise-settings-v1', all);
    emit('behaviors');
  }

  // ---------- GitHub API: both accounts, live ----------
  const hours = (seed, peak) => year(seed, peak * 0.5, peak * 0.9).slice(0, 24).map((v) => Math.min(1, v / (peak * 1.2)));
  const QUOTA = [
    { login: 'mikkokotila', role: 'your account', buckets: [
      { res: 'REST', limit: 5000, used: 1240, reset: '20:12', perMin: 18, risk: 0, h: hours(5, 0.4) },
      { res: 'GraphQL', limit: 5000, used: 2980, reset: '20:05', perMin: 64, risk: 3, h: hours(11, 0.7) }] },
    { login: 'bit-mis', role: 'automation account', buckets: [
      { res: 'REST', limit: 5000, used: 3950, reset: '19:58', perMin: 71, risk: 58, h: hours(17, 0.9) },
      { res: 'GraphQL', limit: 5000, used: 1100, reset: '20:21', perMin: 12, risk: 0, h: hours(23, 0.3) }] }
  ];
  // What an answer changes elsewhere on the page: pausing the behavior that spends
  // the automation account's REST budget shows on the behavior and on the quota.
  let workRef = null; // In motion's list, once it is built below.
  const EFFECTS = {
    // Resuming the chain's hold moves the task itself, as Observe → Tasks and the work table do.
    resume(on) {
      const task = window.POISE_TASKS?.byId('t501');
      if (!task) return;
      if (on) { Object.assign(task, { state: 'waiting', now: 'Resumed by you: back in the merge queue', hold: null }); if (task.journal[0]?.[2] !== 'Resumed by you') task.journal.unshift([clock(), 'event', 'Resumed by you', '']); }
      const w = workRef?.find((x) => x.id === task.id);
      if (w) Object.assign(w, { state: task.state, note: task.now });
      emit('manager');
    },
    pause(on) {
      const b = BEHAVIORS.find((x) => x.id === 'review-new-prs'), q = QUOTA[1].buckets[0];
      b.paused = on ? '19:58' : null;
      Object.assign(q, on ? { perMin: 22, risk: 2 } : { perMin: 71, risk: 58 });
      emit('behaviors');
      emit('quota');
    }
  };
  N.forEach((n) => { if (n.answered) EFFECTS[n.answered.key]?.(true); });
  const minsTo = (hhmm) => { const [h, m] = hhmm.split(':').map(Number), [ch, cm] = clock().split(':').map(Number); return Math.max(0, h * 60 + m - (ch * 60 + cm)); };
  const riskTone = (r) => (r == null ? '' : r === 0 ? 'ok' : r <= 33 ? 'low' : r <= 66 ? 'mid' : 'high');

  // ---------- In motion: the work, in the seven states ----------
  const STATES = ['needs-you', 'failed', 'blocked', 'running', 'waiting', 'idle', 'done'];
  // The same chats as Chat and the same issues and pull requests as Board,
  // read from workspace-data.js, so the counts here agree with theirs.
  const WORK = [
    ...(window.POISE_CHATS || []).filter((c) => !c.manager).map((c) => ({ kind: c.worker && c.worker !== 'Worker' ? 'worker' : 'chat', id: c.id, title: c.worker ? `${c.worker} · ${c.title}` : c.title, state: c.state, note: c.note || '', href: c.worker ? `manager.html?peek=${c.id}&back=overview` : `chat.html?back=overview${c.id === 'c475' ? '' : `&away=${c.id}`}` })),
    ...(window.POISE_BOARD?.ITEMS || []).map(([lane, repo, num, title, state, detail, who]) => ({ kind: lane, id: `${repo}#${num}`, title: `${repo}#${num} ${title}`, state, note: detail || '', who, href: `board.html?item=${encodeURIComponent(`${repo}#${num}`)}&back=overview` }))
  ];
  (window.POISE_TASKS?.TASKS || []).filter((t) => !t.superseded).forEach((t) => WORK.push({ kind: 'task', id: t.id, title: `${t.repo}#${t.pr || t.issue} ${t.title}`, state: t.state, note: t.now, phase: window.POISE_TASKS.phaseWord(t).replace(/ · round \d+$/, ''), href: `observe.html?tab=tasks&task=${t.id}&back=overview` }));
  workRef = WORK;

  // ---------- The Manager, on the same settings as its controls ----------
  const POLICY = window.POISE_POLICY;
  // The review opens the idle-slots notice at a moment when it is true: #483 has its
  // worker and one slot more than is in use sits idle, for this visit only; nothing is stored.
  let rhythmNow = null;
  const chats = () => window.POISE_CHATS || [], queue = () => window.POISE_MANAGER?.next || [];
  const manager = {
    get rhythm() { return rhythmNow ?? Math.min(10, Math.max(1, +store.get('poise-mgr-rhythm', 7) || 7)); },
    set rhythm(n) { rhythmNow = null; store.set('poise-mgr-rhythm', Math.min(10, Math.max(1, n))); idleSlots(); emit('manager'); },
    get stability() { return +store.get('poise-mgr-stability', 2); },
    get autonomy() { return +store.get('poise-mgr-autonomy', 2); },
    // Pause new work: the same setting as the Manager's controls and Settings → Manager.
    get paused() { return POLICY.paused.get(); },
    set paused(on) { POLICY.paused.set(on); emit('manager'); },
    // Read from the same chats as Chat, as main counts them: each worker holds a slot until its chat is closed.
    get used() { return chats().filter((c) => c.worker && !c.closed && c.state !== 'done').length; },
    get running() { return chats().filter((c) => c.worker && c.state === 'running').length; },
    get pausedForYou() { return chats().filter((c) => c.worker && c.state === 'needs-you').length; },
    get blocked() { return chats().filter((c) => c.worker && (c.state === 'blocked' || c.state === 'failed')).length; },
    // Tickets the Manager will give to a worker when a slot frees.
    get waitingSlot() { return queue().length; },
    // On the Manager's turn, a free slot goes to the next ticket: a new worker, running.
    startNext() {
      const t = queue().shift();
      if (!t) return null;
      const n = Math.max(0, ...chats().map((c) => Number(String(c.worker || '').slice(1)) || 0)) + 1;
      const c = { id: `w${n}`, worker: `W${n}`, title: t.title, state: 'running', who: 'Muse · spark 1.3 contributor', at: 1941, t: clock(), project: t.project };
      chats().push(c);
      if (workRef) workRef.push({ kind: 'worker', id: c.id, title: `${c.worker} · ${c.title}`, state: 'running', note: '', href: `manager.html?peek=${c.id}&back=overview` });
      return c;
    },
    sentence() { return POLICY.effect(this.rhythm, this.stability, this.autonomy, this.paused); }
  };
  function idleSlots() {
    // Only from a reading of the slots: with no chat list there is none, and nothing is claimed.
    const idle = manager.rhythm - manager.used, on = !!window.POISE_CHATS && idle > 0 && !manager.waitingSlot && !IDLE.answered;
    if (on) Object.assign(IDLE, { title: `${idle} of ${manager.rhythm} worker slots idle · the enhancement backlog is empty`, where: `${manager.used} of ${manager.rhythm} slots held by worker chats` });
    const at = N.indexOf(IDLE);
    if (on && at < 0 && !held.includes(IDLE)) arrive(IDLE);
    if (!on && at >= 0) N.splice(at, 1);
  }
  // A request that can no longer be answered here says why at once, even while arrivals are held:
  // answered elsewhere, cancelled by its chat, or the connection to Poise dropped (?request=…).
  const GONE = {
    elsewhere: [['nw4'], 'Answered in the Switchboard at 19:40: W4 already has its answer, so these choices no longer apply.'],
    cancelled: [['n475'], 'Muse cancelled this request when its turn ended. Nothing was run.'],
    offline: [['n475', 'nw4'], 'The connection to Poise dropped. Answers wait until it is back; nothing is sent meanwhile.']
  };
  const gone = new URLSearchParams(location.search).get('ref') === 'ov.gone' ? 'elsewhere' : new URLSearchParams(location.search).get('request');
  if (GONE[gone]) GONE[gone][0].forEach((id) => { const n = N.find((x) => x.id === id); if (n) n.gone = GONE[gone][1]; });
  if (new URLSearchParams(location.search).get('ref') === 'ov.idle') {
    while (manager.waitingSlot) manager.startNext();
    rhythmNow = Math.min(10, manager.used + 1);
  }
  idleSlots();

  window.PoiseOV = { HEALTH,
    GROUPS, LEVELS, N, HANDLED, NOTICES_OFF, open, shown, bell, answer, undo, dismiss,
    get level() { return level; },
    set level(i) { level = i; store.set('poise-overview-level', i); emit('level'); },
    hold(on) { holding = on; if (!on && held.length) { held.splice(0).forEach((n) => N.unshift(n)); emit('arrive'); } },
    get heldCount() { return held.length; },
    on: (fn) => listeners.add(fn),
    PROD, PER_PR, FRICTION, WORK_TYPE, HIST, ORGS, valueOf, pace, fmt, dayLabel,
    get day() { return day; }, set day(d) { day = Math.max(0, d); emit('day'); },
    get org() { return org; }, set org(o) { org = o; emit('day'); },
    BEHAVIORS, RANGES, setBehavior, QUOTA, minsTo, riskTone, STATES, WORK, manager, dayFraction
  };
})();
