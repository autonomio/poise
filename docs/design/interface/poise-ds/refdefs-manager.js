// Manager vocabulary: the three independent controls and what they govern.
// The policy text here is also what the controls show on screen (manager.js
// reads POLICY), so the control, its tooltip and its reference say the same thing.
window.POISE_POLICY = {
  // The five positions and their words are main's (server/chat/manager-policy.ts):
  // every Manager turn, and every turn of a worker it created, carries the words
  // you chose, so the control shows exactly those words.
  stability: [
    ['Stability', 'Keep this Poise on the version it has. Track releases; never ask to install.'],
    ['Lean to stability', 'Keep this Poise on the version it has. Track releases and ask to install them.'],
    ['Balanced', 'Tell me first, and install minor releases automatically.'],
    ['Lean to expansion', 'Install releases automatically, and tell me first.'],
    ['Full expansion', 'Install releases automatically.']
  ],
  autonomy: [
    ['Ask first', 'Nothing on my behalf.', 'Everything: review and approve all of it.'],
    ['Ask on judgement calls', 'The no-brainers; my charter defines them.', 'Everything else.'],
    ['Balanced', 'The routine work.', 'Anything irreversible, and anything you’re unsure about.'],
    ['Ask on the irreversible', 'Everything but the irreversible.', 'The irreversible.'],
    ['Standing instructions', 'Everything my charter allows.', 'Only what the charter says to bring.']
  ],
  // The three controls read together, one sentence per position.
  sentence: {
    stability: [
      'It keeps this Poise on its version and never asks to install a release.',
      'It keeps this Poise on its version and asks you before installing a release.',
      'It tells you first, and installs minor releases by itself.',
      'It installs releases by itself, and tells you first.',
      'It installs releases by itself.'
    ],
    autonomy: [
      'It decides nothing on your behalf and brings you everything.',
      'It decides the no-brainers your charter defines and brings you everything else.',
      'It decides the routine work and brings you anything irreversible, and anything it is unsure about.',
      'It decides everything but the irreversible, which it brings to you.',
      'It decides everything your charter allows and brings you only what the charter says to bring.'
    ]
  },
  effect: (n, s, a, paused) => `Up to ${n} worker${n > 1 ? 's' : ''} at once. ${window.POISE_POLICY.sentence.stability[s]} ${window.POISE_POLICY.sentence.autonomy[a]}${paused ? ' New work waits until you resume.' : ''}`,
  // Pause new work: the controls' paused flag. Every Manager turn carries it; the Manager still wakes.
  paused: { get: () => !!window.PoiseShell?.store.get('poise-mgr-paused', false), set: (on) => window.PoiseShell?.store.set('poise-mgr-paused', !!on) },
  // Where the Manager may bind work: null is every followed repository, as on main; a list narrows it.
  scope: null,
  scopeWords: (v) => (v == null ? 'every followed repository' : v.length ? v.join(', ') : 'no repositories'),
  // The shipped /manager charter, word for word (server/chat/manager-default.ts).
  instructions: [
    'The Manager controls in Settings govern how you work: Rhythm, Stability, Autonomy, scope and pause ride on every turn as the effective policy, with a version. They take precedence over this charter; follow them where they differ.',
    'You are the manager. You do no source work and summon no subagents. You file tickets, give each to its own worker chat, and watch it until its PR is merged.',
    'Every task has exactly one open issue. A feat uses a standalone PRD labelled prd; other work uses an ordinary ticket.',
    'Priorities: durable fixes for failing Poise behaviors (reviews, approvals, merges, branch updates, CI reruns, work monitor, deploys) come first every time. Then Chat and agent bugs. Then agreed tickets and PRDs in dependency order. Then cleanup and stabilization, not expansion. Finish the open PRs before dispatching new work.',
    'When Poise or a worker fails, prove it from Poise’s own state and logs. Verify before you assert. File the evidence as a ticket, give it to a worker, and keep going.',
    'Don’t ask the owner operational questions. Alert the owner only about a material issue a PR can’t fix, with exact steps. Use the live work table in Chat’s Switchboard view for your workers’ status; Poise refreshes it. Do not repeatedly rebuild that table in chat messages.',
    'Keep your own token use lean.'
  ],
  // Both charters end with the same paragraph.
  closing: 'Minimal, clinical interventions all the way. Get in, get out, do the thing that actually has to be done, never expand it beyond that.',
  // Wake-ups: every 60, 30, 15, 10 or 5 minutes, set in the Manager's header and
  // in Settings → Manager on one key. There is no off; a hold stops them.
  wake: {
    options: [60, 30, 15, 10, 5],
    get: () => { const v = Number(window.PoiseShell?.store.get('poise-mgr-wake', 60)); return [60, 30, 15, 10, 5].includes(v) ? v : 60; },
    set: (m) => window.PoiseShell?.store.set('poise-mgr-wake', m),
    next: (m) => { const t = Math.floor((window.PoiseShell?.secs() || 0) / 60), n = (Math.floor(t / m) + 1) * m; return `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; },
    // ?wake=failed, nocharter or due shows the wake-up's other states.
    status: (m, held) => {
      const cost = `Up to ${1440 / m} turns a day`, next = window.POISE_POLICY.wake.next(m), st = new URLSearchParams(location.search).get('wake');
      if (held) return 'On hold: you put the Manager on hold';
      if (new URLSearchParams(location.search).get('manager') === 'none') return `${cost}, once you start the Manager`;
      if (st === 'failed') return `${cost} · last wake-up failed at 19:00: the context is full; run /compact in the Manager · next ${next}`;
      if (st === 'nocharter') return `${cost} · wake-ups start when the /manager snippet has text`;
      if (st === 'due') return `${cost} · due now · waiting: the Manager is running a turn`;
      return `${cost} · next ${next}`;
    }
  },
  // The shipped /worker charter, word for word (server/chat/worker-default.ts), carried by every worker turn.
  worker: [
    'Work only on the task you were given. Report your result and the PR link in this chat.',
    'Open the PR early. Run lint, typecheck and the tests for what you changed, including npm run test:e2e -- <spec> for the browser specs you touched (Chromium is preinstalled; local runs go one at a time per workspace); CI runs the full suite.',
    'Done means: CI green; up to date with main; no conflicts; every review finding fixed or justified, with a reply on its thread, and every handled thread resolved. If a finding repeats one you already justified, reply with the evidence instead of changing code.',
    'Once you have pushed and your checks pass, end your turn. Poise wakes you on CI failures, conflicts, behind-main and review changes.',
    'If something outside your PR blocks you, say so here with the evidence and end your turn.'
  ]
};

Object.assign(window.POISE_REF, {
  mgr: { name: 'The Manager', kind: 'Agent', what: window.POISE_REF['term.manager'].what, does: 'Its chat is where you instruct it. Its place has three panes: its chat, the work table of every task in motion, and the Switchboard. Its workers appear under it in the chat list. Its controls open from its header over the work table, and live in Settings → Manager, on the same settings.' },
  'mgr.pause': { name: 'Hold the Manager', kind: 'Action', what: 'Holds the Manager’s chat: its timers, the wake-up included, skip their firings, and turns other chats would start in it wait. Holding it, it starts nothing new.', scope: 'The Manager’s chat and its timers.', when: 'Immediately. It ends only on Resume.', unchanged: 'Workers already on tasks, which carry on; open questions; your controls, Pause new work included.', shows: 'Waiting · on hold, and the wake-up reads On hold.', source: 'The hold on the Manager’s chat, as Timers’ Hold sets it.' },
  'mgr.paused': { name: 'Pause new work', kind: 'Manager control', what: 'Tells the Manager that new work waits until you resume. It still wakes, watches and answers; it gives out no new ticket.', now: () => (window.POISE_POLICY.paused.get() ? 'Paused: new work waits until you resume.' : 'Not paused.'), when: 'From the Manager’s next turn, which carries “Paused: yes — new work waits until the person resumes.”', unchanged: 'Workers already on tasks, which finish them; wake-ups; Hold, which is separate.', source: 'The paused flag in the Manager controls, the same setting as Settings → Manager and Overview’s Manager card.' },
  'mgr.panes': { name: 'Manager or Work table', kind: 'Display control', what: 'On a narrow window the Manager’s chat and the work table take turns; the Switchboard floats over them from its tab.' },
  'mgr.table': { name: 'The work table', kind: 'Display', what: 'Every task in motion, one row each, whether a worker or the behaviors drive it.', does: 'A row opens to its latest changes, with a way to its chat or its timeline. Rows keep their place while you read; a change updates its row where it stands.', source: 'Poise’s own observations, refreshed every minute: the chain’s journal for Behaviors, and each worker’s pull request on GitHub.' },
  'mgr.table.asof': { name: 'Observed', kind: 'Display', what: 'When the table was last observed, and the revision Poise is serving. Merged and deployed are kept apart.', unavailable: () => 'If a refresh fails, the last snapshot stays, with its age and the error.' },
  'mgr.slotline': { name: 'Slots', kind: 'Display', what: 'How many of Rhythm’s slots are in use, how many are free, and how many workers wait for one.', shows: 'When slots sit idle for 15 minutes with an empty enhancement backlog, Poise tells you, with issues to label.' },
  'mgr.col.task': { name: 'Task', kind: 'Column', what: 'The issue, its pull request, and for a chain its phase rail.' },
  'mgr.col.driver': { name: 'Driven by', kind: 'Column', what: 'Who carries the task: a worker of the Manager’s, or the behaviors as a chain.' },
  'mgr.col.now': { name: 'Now', kind: 'Column', what: 'Its state in the seven words, and what it is doing or waiting for: its current step or its reason.' },
  'mgr.col.flags': { name: 'Flags', kind: 'Column', what: 'Conflicts, an open review, behind main, and CI failing, as Poise observed them on the pull request.', values: [['☑', 'Observed: a problem.'], ['☐', 'Observed: clear.'], ['?', 'Not observed yet, or stale.'], ['—', 'No pull request yet.']] },
  'mgr.flag': { name: 'Flag', kind: 'Display', what: 'One observation on the task’s pull request.', now: (el) => el.getAttribute('title') || '' },
  'mgr.row': { name: 'Task', kind: 'List item', what: 'One task: what it is, who drives it, where it stands, and the four flags.', does: 'Enter or a click opens its latest changes.' },
  sb: { name: 'Switchboard', kind: 'Agent', what: 'An observer that reads every chat and reports what is blocked, what finished, and what needs your decision. It never works on chats, messages them or answers for you.', source: 'One Muse chat per workspace, which Poise runs outside the slot limit.' },
  'sb.state': { name: 'Switchboard state', kind: 'Display', what: 'Whether it is checking, paused, stopped or off, how many chats it watches, when it last checked, what that cost, and when it checks next.', values: [['Running', 'Live, or checking.'], ['Waiting', 'Checks paused by you.'], ['Failed', 'Stopped: its turn failed, or three checks in a row ended without confirming. Restart resumes it.'], ['Idle', 'Off: its chat is deleted; its updates stay.']] },
  'sb.check': { name: 'Check now', kind: 'Action', what: 'Runs a check at once, when any chat has news.', unchanged: 'A check never runs while another, or an explanation, is unfinished.', unavailable: () => 'While a check runs, or once the Switchboard stopped: restart it first.' },
  'sb.pause': { name: 'Pause checks', kind: 'Action', what: 'Stops new checks; one not yet started is withdrawn. Pressed again, Resume checks.', unchanged: 'Explain and your answers still go through.', unavailable: () => 'Once the Switchboard stopped: restart it first.' },
  'sb.relay': { name: 'Your answer, relayed', kind: 'Display', what: 'The answer you gave in the Switchboard, the chat it went to, and where it stands.', values: [['Delivered', 'The chat was waiting on the question and has it.'], ['Queued', 'The chat is running a turn; your answer is delivered when it is free.'], ['Held', 'The chat is stopped; open it to resume it, and the answer goes with it.']], unchanged: 'The Switchboard acts on nothing: it only relays. Your answer is delivered once, as yours.', source: 'The Switchboard’s answer, as main records its relay.' },
  'sb.restart': { name: 'Restart the Switchboard', kind: 'Action', what: 'Resumes a Switchboard that stopped, in the same chat.', when: 'At once; its next check follows.', unchanged: 'Its updates and your answers.', shows: 'Running, then its next check.' },
  'sb.model': { name: 'What it runs', kind: 'Display', what: 'The model the Switchboard runs and what it reads, said before you start it.', source: 'The model catalogue. If that model was retired, the catalogue’s Muse model at max effort takes its place.' },
  'sb.cover': { name: 'What it covers', kind: 'Display', what: 'The Poise chats in this workspace. Sessions outside Poise and GPT browser chats are not observed.' },
  'sb.chat': { name: 'Open its chat', kind: 'Action', what: 'Shows the Switchboard’s own chat. It takes no messages; you can stop its turn and answer what it asks.' },
  'sb.off': { name: 'Turn off', kind: 'Action', what: 'Pressed twice, deletes the Switchboard’s chat.', unchanged: 'Its updates, which stay here. Start the Switchboard makes a new one.' },
  'sb.hide': { name: 'Hide', kind: 'Action', what: 'Folds the Switchboard away; it keeps checking.', shows: 'A tab with an amber count of decisions waiting, or a red ! if it stopped.' },
  'sb.count': { name: 'Count', kind: 'Control', what: 'How many chats need you, are blocked, are in progress or are done. A chat waiting on your permission or answer counts as Needs you, as it does in Chat, whether or not the Switchboard relays a decision for it. Each count filters the list below.' },
  'sb.explain': { name: 'Explain', kind: 'Action', what: 'Asks the Switchboard once what changed, why it matters and what is still uncertain. The answer is kept; the same button hides and shows it.', shows: 'Asking the Switchboard…, then the answer under the update, with when it was given. If the Switchboard is busy it finishes its current work first. If asking fails, the reason and Try again.', unavailable: () => 'The Switchboard is not running. An explanation already asked for can still be shown.' },
  'sb.dismiss': { name: 'Dismiss', kind: 'Action', what: 'Hides this item from the Switchboard.', unchanged: 'The chat, which is told nothing: a dismissed question still waits there. If the chat asks again, the new question shows.', when: 'At once. There is no undo.' },
  'sb.chatrow': { name: 'Chat', kind: 'List item', what: 'One chat, with a lamp for its state, its latest update and when. A chat whose last completion is more than 45 minutes old is quiet.', does: 'Opens to its updates, with Explain, Dismiss and Open chat.' },
  'mgr.rhythm': {
    name: 'Rhythm', kind: 'Manager control', what: 'How many workers the Manager keeps on tasks at once: 1 to 10 slots.',
    does: 'Each worker holds a slot from the moment it takes a task until its chat is closed: while it runs, waits for your answer, is blocked, or sits between turns waiting for CI or a review. Only you close a chat, as on main: a worker whose task has ended keeps its slot until you do. A free slot gets the Manager’s next ticket, as a new worker, on its next turn. Its own chat, chats you run yourself and tickets it has not yet given out never hold one.',
    now: (el) => { const r = el.closest('[data-rhythm]') || el.closest('[data-setting]')?.querySelector('[data-rhythm]'); if (!r) return ''; const { limit, used, waitingSlot } = r.dataset; if (used === undefined) return `${limit} slots. How many are in use shows in the Manager place, in the work table’s header.`; const over = Math.max(0, used - limit); return `${limit} slots; ${used} held by workers${over ? `; ${over} over the limit, finishing their tasks` : ''}${+waitingSlot ? `; ${waitingSlot} ticket${+waitingSlot > 1 ? 's' : ''} next for a slot` : ''}.`; },
    values: [['1', 'One task at a time: slow and easy to follow.'], ['5', 'Default.'], ['10', 'The most parallel work Poise allows; more to watch.']],
    scope: 'Workers the Manager runs in this workspace.',
    when: 'From the Manager’s next turn, which carries it: a wake-up, your message, or a wake from Poise. Raising it lets that turn give the next ticket to a new worker. Lowering it below current use lets each worker finish its task, and starts nothing new until use is below the limit. Poise’s count of idle slots uses it at once. Stopping work is a separate action.',
    unchanged: 'Running at once, which caps turns running together, chats you run yourself, Stability ↔ Expansion and Autonomy.',
    source: 'The same setting as Settings → Manager → Rhythm. Poise counts the Manager’s open worker chats against it, as the idle-slot notice does.'
  },
  'mgr.close': { name: 'Close the worker’s chat', kind: 'Action', what: 'Closes a worker chat whose task has ended, so its slot is free. Only you can close a chat; the Manager cannot.', when: 'At once. The Manager gives the free slot its next ticket on its next turn.', unchanged: 'The transcript, which stays readable; its pull requests and commits on GitHub. Resume reopens the chat.', shows: 'The row reads Done with how its task ended, and the chat reads Idle · closed.', source: 'The chat’s close, the person’s own action on main.' },
  'mgr.slots': {
    name: 'Slots', kind: 'Display', what: 'One capsule per slot, so the limit and what holds each slot read at a glance.',
    values: [['Teal', 'A worker is running.'], ['Amber', 'A worker waits for your answer.'], ['Rose', 'A worker is blocked; it keeps its slot.'], ['Grey', 'A worker is between turns, waiting for CI or a review, or done with its task and not yet closed; it keeps its slot.'], ['Dashed', 'Over a lowered limit; its worker finishes the task and the slot closes.'], ['Outlined', 'Free: the Manager gives it its next ticket on its next turn.'], ['Dotted', 'Beyond your current limit.']],
    source: 'Live, from the Manager’s open worker chats.'
  },
  'mgr.stability': {
    name: 'Stability ↔ Expansion', kind: 'Manager control', what: 'How the Manager handles a new Poise release: keep this Poise on its version, ask you, or install releases by itself.',
    now: (el) => { const i = +((el.closest('[data-stability]') || el.closest('[data-setting]')?.querySelector('[data-stability]'))?.dataset.stability ?? 2); const [n, p] = window.POISE_POLICY.stability[i]; return `${n}: “${p}”`; },
    values: window.POISE_POLICY.stability.map(([n, p]) => [n, `“${p}”`]),
    scope: 'This Poise’s own version, and what the Manager does when a release appears.',
    when: 'From the Manager’s next turn, which carries the words you chose, with the policy version.',
    unchanged: 'Rhythm and Autonomy, and Production updates in General, which are separate.',
    source: 'The same setting as Settings → Manager. Every Manager turn, and every turn of a worker it created, carries these words above its charter.'
  },
  'mgr.autonomy': {
    name: 'Autonomy', kind: 'Manager control', what: 'What the Manager decides on its own, and what it brings to you.',
    now: (el) => { const i = +((el.closest('[data-autonomy]') || el.closest('[data-setting]')?.querySelector('[data-autonomy]'))?.dataset.autonomy ?? 2); const [n, d, b] = window.POISE_POLICY.autonomy[i]; return `${n}. Decides “${d}” Brings “${b}”`; },
    values: window.POISE_POLICY.autonomy.map(([n, d, b]) => [n, `Decides “${d}” Brings “${b}”`]),
    scope: 'Decisions in work the Manager runs, and in its workers’ turns.',
    when: 'From the Manager’s next turn. Questions already brought to you stay open.',
    unchanged: 'Access permissions (Safe mode), Rhythm and Stability ↔ Expansion, which are separate.',
    source: 'The same setting as Settings → Manager. Every Manager turn carries these words above its charter.'
  },
  'mgr.wake': {
    name: 'Wake every', kind: 'Manager control', what: 'How often Poise wakes the Manager to review the workspace: every 60, 30, 15, 10 or 5 minutes.',
    now: () => { const m = window.POISE_POLICY.wake.get(); return `Every ${m} minutes. ${window.POISE_POLICY.wake.status(m)}.`; },
    values: [['60 min', 'Default: up to 24 turns a day.'], ['30 min', 'Up to 48 turns a day.'], ['15 min', 'Up to 96.'], ['10 min', 'Up to 144.'], ['5 min', 'Up to 288.']],
    does: 'Each wake-up is one Manager turn with its controls and /manager text. A wake-up due while the Manager is busy waits, and says for what.',
    when: 'At once, keeping a wake-up already due.', scope: 'The current Manager. A new Manager starts at the interval set here.',
    unchanged: 'Your timers, which it never uses a slot of, and Rhythm.',
    shows: 'Beside it, the day’s cost and the next wake-up; On hold when you hold or stop the Manager; a failed wake-up with its error, until one succeeds.',
    unavailable: () => 'There is no off: hold the Manager, or Hold all timers, to stop wake-ups. Without /manager text there are none.',
    source: 'The same setting as Settings → Manager → Wake the Manager every.'
  },
  'set.mgr.charter.edit': { name: 'Edit in Snippets', kind: 'Action', what: 'Opens the /manager snippet in Settings → Snippets, ready to edit, with a route back.' },
  'mgr.effective': { name: 'In effect', kind: 'Display', what: 'Your three Manager controls read together, with what they govern.', now: (el) => (el.querySelector('.sentence') || el).textContent.replace(/\s+/g, ' ').trim(), scope: 'Work the Manager runs in this workspace.', source: 'The same three settings, live.' },
  'mgr.controls': { name: 'Manager controls', kind: 'Display control', what: 'Opens or closes the Manager’s controls, over the work table.', now: (el) => (pressed(el) ? 'Showing.' : 'Hidden.'), unchanged: 'The settings themselves: hiding the controls changes nothing.', source: 'The same settings as Settings → Manager.' },
  'mgr.scope': { name: 'Scope', kind: 'Display', what: 'The repositories the Manager may bind work in: every followed repository, or the ones you chose.', now: (el) => el.textContent.replace(/\s+/g, ' ').trim(), source: 'The same setting as Settings → Manager → Repositories.' },
  'mgr.why': { name: 'Why this came to you', kind: 'Display', what: 'The reason the Manager brought this decision to you, from your Autonomy setting.', now: (el) => el.textContent.trim() },
  'mgr.none': { name: 'No Manager yet', kind: 'Display', what: 'This workspace has no Manager. The place opens all the same: the work table shows what the behaviors carry, and the Switchboard watches every chat.', unchanged: 'Opening the place never creates a chat or starts work.' },
  'mgr.start': { name: 'Start the Manager', kind: 'Action', what: 'Opens a new chat of type Manager. It carries /manager on every turn and wakes at the interval beside it.', when: 'When its first message sends, the moment the chat is ready.', unchanged: 'Your other chats, the behaviors, and the Switchboard.', shows: 'Waiting while it starts, then the Manager, with its chat, workers and work table.' },
  'mgr.instructions': { name: 'Standing instructions', kind: 'Display', what: 'What you have told the Manager to always or never do: the built-in /manager snippet. Every Manager turn carries it.', source: 'Settings → Snippets, where you edit it.' },
});
