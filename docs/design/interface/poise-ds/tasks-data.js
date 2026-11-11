// Tasks: one issue on its way to a merged pull request, driven by the
// behaviors as a chain or by a worker chat. The Manager's work table, Board,
// Observe → Tasks and Overview all read this one list, so a task says the same
// thing everywhere. A chain's timeline is its journal; a worker's is thinner.
(() => {
  const PHASES = ['Intake', 'Issue review', 'Implementation', 'PR review', 'Repair', 'Approval', 'Merge'];
  // Flags, as the work table reads them: problem, clear, or unknown.
  const F = (conflicts, review, behind, ci) => ({ conflicts, review, behind, ci });
  const TASKS = [
    {
      id: 't488', repo: 'autonomio/poise', issue: 488, title: 'Editor: keep CRLF out of imported files', pr: 492, head: '7c1e9a2', driver: 'Behaviors',
      phase: 3, round: 1, state: 'running', now: 'PR review · round 1 · Opus 5 · Max on 7c1e9a2', since: '19:38',
      flags: F('clear', 'clear', 'clear', 'unknown'),
      journal: [
        ['19:38', 'invocation', 'PR review started on 7c1e9a2 · Primary · Opus 5 · Max', 'run 2214'],
        ['19:20', 'event', 'Published branch poise/488-crlf and opened #492', 'head 7c1e9a2'],
        ['19:20', 'invocation', 'Implementation settled · Primary · Opus 5 · Max · 11m 02s', 'run 2203'],
        ['19:12', 'invocation', 'Issue review posted by 2 of 2 reviewers', 'comments 3412, 3413'],
        ['19:02', 'event', 'Entered the chain: label poise', '']
      ]
    },
    {
      id: 't498', repo: 'autonomio/poise', issue: 498, title: 'Board: offer the repository’s labels on a new issue', pr: 499, head: 'b51d0e4', driver: 'Behaviors',
      phase: 4, round: 2, state: 'running', now: 'Repair · round 2 · answering 1 review finding', since: '19:38',
      flags: F('clear', 'problem', 'clear', 'clear'),
      journal: [
        ['19:38', 'invocation', 'Repair started · Secondary · GPT-6 Astra · Max', 'run 2215'],
        ['19:33', 'invocation', 'PR review on 9e02a77: changes requested, 1 finding', 'review 5712'],
        ['19:10', 'invocation', 'Repair settled: new head 9e02a77', 'run 2196'],
        ['18:58', 'invocation', 'PR review on 4c7d1f0: changes requested, 3 findings', 'review 5698'],
        ['18:31', 'event', 'Opened #499', 'head 4c7d1f0'],
        ['18:02', 'event', 'Entered the chain: label poise', '']
      ]
    },
    {
      id: 't1150', repo: 'Acme/Limen', issue: 1150, title: 'Limen: retire the v1 gate config', pr: 1152, head: 'e40c9b3', driver: 'Behaviors',
      phase: 6, round: 1, state: 'waiting', now: 'In the merge queue', since: '19:30',
      flags: F('clear', 'clear', 'clear', 'clear'),
      journal: [
        ['19:30', 'event', 'Enqueued in the native merge queue · accepted', 'queue entry 88'],
        ['19:29', 'invocation', 'Approval of e40c9b3 · conversations resolved', 'review 5706'],
        ['19:14', 'invocation', 'PR review on e40c9b3: approved', 'review 5701']
      ]
    },
    {
      id: 't501', repo: 'autonomio/poise', issue: 501, title: 'Overview: a tile that fails shows the error, never zero', pr: 502, head: '2aa6f19', driver: 'Behaviors',
      phase: 6, round: 1, state: 'needs-you', now: 'Held: removed from the merge queue by hand', hold: 'Someone removed #502 from the merge queue by hand, so the chain waits for your decision. Resume puts it back in the queue.', since: '19:05',
      advanceMin: 36, gates: ['CI passed on 2aa6f19', 'approved on 2aa6f19'], next: 'Resume puts it back in the merge queue',
      flags: F('clear', 'clear', 'clear', 'unknown'),
      journal: [
        ['19:05', 'hold', 'Held: a queue removal by hand needs a decision', ''],
        ['19:04', 'event', 'Removed from the merge queue by hand', 'queue entry 86'],
        ['18:49', 'event', 'Enqueued in the native merge queue · accepted', 'queue entry 86']
      ]
    },
    {
      id: 't495', repo: 'autonomio/poise', issue: 495, title: 'Settings: say which slot a place runs', pr: 496, head: '5c3be12', driver: 'Behaviors',
      phase: 4, round: 1, state: 'blocked', now: 'Not confirmed: a reply may have posted; reconciling', since: '19:26',
      advanceMin: 15, gates: ['CI passed on 5c3be12', 'review: changes requested, 1 finding'], next: 'Reconcile the original reply; nothing new starts until it is confirmed', recheck: '19:56',
      flags: F('unknown', 'unknown', 'clear', 'clear'),
      journal: [
        ['19:26', 'uncertain', 'Repair could not prove its reply: the provider stopped mid-post', 'run 2209'],
        ['19:01', 'invocation', 'PR review on 5c3be12: changes requested, 1 finding', 'review 5694']
      ]
    },
    {
      id: 't494', repo: 'autonomio/poise', issue: 494, title: 'Docs: describe Switch to v2', pr: null, head: null, driver: 'Behaviors',
      phase: 1, round: 1, state: 'waiting', now: 'For memory: 3.1 of 8 GB reserved; it starts when a run lets go', since: '19:39',
      flags: F('none', 'none', 'none', 'none'),
      journal: [['19:39', 'event', 'Admitted to issue review; waiting for memory', ''], ['19:39', 'event', 'Entered the chain: label poise', '']]
    },
    {
      id: 't476', repo: 'autonomio/poise', issue: 476, title: 'Behaviors history: 200 runs a page', pr: 503, head: '4d34831', driver: 'Behaviors',
      phase: 7, round: 1, state: 'done', now: 'Merged as 4d34831 · deployed 19:20', since: '19:12', merged: '4d34831',
      flags: F('clear', 'clear', 'clear', 'clear'),
      journal: [['19:20', 'event', 'Deployed to production', 'release 4d34831'], ['19:12', 'event', 'Merged as 4d34831', 'merge 4d34831'], ['18:55', 'invocation', 'Approval of 4d34831', 'review 5689']]
    },
    {
      id: 't504', repo: 'autonomio/poise', issue: 504, title: 'Ledger: keep restart gaps apart', pr: 505, head: 'a17e5d0', driver: 'Behaviors',
      phase: 7, round: 1, state: 'waiting', now: 'Merged as a17e5d0 · review evidence pending', since: '18:40', merged: 'a17e5d0', pending: true,
      advanceMin: 61, gates: ['merged outside the chain as a17e5d0'], next: 'Read the original review evidence', recheck: '21:40',
      flags: F('clear', 'unknown', 'clear', 'clear'),
      journal: [['18:40', 'event', 'Merged as a17e5d0, outside the chain; the pre-merge review is still owed', 'merge a17e5d0'], ['18:12', 'invocation', 'PR review on a17e5d0 started · Tertiary', 'run 2170']]
    },
    // Work that has not advanced for a day, though nothing holds it.
    {
      id: 't493', repo: 'autonomio/poise', issue: 493, title: 'Overview: say why a tile is empty', pr: null, head: null, driver: 'Behaviors',
      phase: 2, round: 1, state: 'waiting', now: 'Implementation waits for CI on main: GitHub returned 502 reading the checks', since: '19:20',
      advanceMin: 1596, gates: ['no pull request yet', 'CI on main: not read since 18:12'], next: 'Read the checks again', retryAt: '19:50',
      flags: F('none', 'none', 'none', 'unknown'),
      journal: [
        ['19:20', 'invocation', 'Implementation waited: GitHub returned 502 reading the checks; it tries again at 19:50', 'run 2208'],
        ['Thu 17:05', 'invocation', 'Issue review posted by 2 of 2 reviewers', 'comments 3388, 3389'],
        ['Thu 16:40', 'event', 'Entered the chain: label poise', '']
      ]
    },
    // A duplicate the chain closed itself, because another merged pull request covered it.
    {
      id: 't490', repo: 'autonomio/poise', issue: 490, title: 'Tests: freeze the notice clock in the handling fixture', pr: 491, head: '3c9d1f4', driver: 'Behaviors',
      phase: 7, round: 1, state: 'done', now: 'Superseded: #500 covered it, so the duplicate pull request was closed', since: '18:20',
      superseded: { by: 500, merge: '9a1c2e7', failing: 9201, recovery: 9214 },
      flags: F('clear', 'clear', 'clear', 'clear'),
      journal: [
        ['18:20', 'event', 'Superseded: #500 covers the reported tests, so #491 was closed', 'merge 9a1c2e7'],
        ['18:02', 'event', 'The full suite recovered on main', 'run 9214'],
        ['17:40', 'event', 'Opened #491', 'head 3c9d1f4'],
        ['17:12', 'event', 'Entered the chain: label poise', '']
      ]
    }
  ];
  // Worker tasks: driven by a chat, with the work table's own observations.
  const WORK = {
    w1: { issue: 474, pr: 486, flags: F('clear', 'problem', 'clear', 'clear'), latest: ['19:12', 'Review found 2 issues on #486'] },
    w2: { issue: null, pr: 471, flags: F('clear', 'clear', 'clear', 'unknown'), latest: ['19:36', 'Pushed a fix for the failing lint'] },
    w3: { issue: 478, pr: null, flags: F('none', 'none', 'none', 'none'), latest: ['19:33', 'Editing the shared filter bar'] },
    w4: { issue: 477, pr: null, flags: F('none', 'none', 'none', 'none'), latest: ['19:22', 'Asked which note to keep'] },
    w5: { repo: 'Acme/Limen', issue: 1160, pr: null, flags: F('none', 'none', 'none', 'none'), latest: ['18:51', 'Stopped before touching the gate'] },
    w6: { issue: 482, pr: null, flags: F('none', 'none', 'none', 'none'), latest: ['19:26', 'Started in the seventh slot, on the Manager’s turn after Rhythm rose to 7'] },
    w7: { issue: 506, pr: 507, flags: F('clear', 'clear', 'problem', 'unknown'), latest: ['19:25', 'Ended its turn with 2 commits unpushed; Poise woke it once'] }
  };
  // The phase rail: one line high everywhere. Past phases are a quiet fill, the
  // current one takes its state's colour, and the ones ahead are hollow.
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const phaseWord = (t) => (t.superseded ? 'Superseded' : t.phase >= PHASES.length ? 'Merged' : `${PHASES[t.phase]}${t.phase === 3 || t.phase === 4 ? ` · round ${t.round}` : ''}`);
  const railHTML = (t, { label = true } = {}) => `<span class="rail" data-ref="task.rail" data-phase="${esc(phaseWord(t))}" role="img" aria-label="${esc(`Phase: ${phaseWord(t)}`)}">${PHASES.map((p, i) => `<i class="${i < t.phase ? 'p' : i === t.phase ? 'c' : ''}"${i === t.phase ? ` data-state="${t.state}"` : ''} title="${esc(p)}"></i>`).join('')}</span>${label ? `<span class="rail-w">${esc(phaseWord(t))}</span>` : ''}`;
  // Needs attention: what is held, unconfirmed or owes review evidence at once, and any other
  // work after a day without a verified advance. Oldest progress first.
  const attention = (t) => !t.superseded && (!!t.hold || t.state === 'blocked' || !!t.pending || (t.advanceMin || 0) >= 1440);
  const age = (m) => (m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  window.POISE_TASKS = { PHASES, TASKS, WORK, byId: (id) => TASKS.find((t) => t.id === id), railHTML, phaseWord, attention, age };
})();
