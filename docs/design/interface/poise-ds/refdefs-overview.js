// Overview's vocabulary: the command center. Same rules as refdefs.js: one
// entry per element, read by the tooltip, the full reference and the review.
Object.assign(window.POISE_REF, {
  /* ---------- Answer here ---------- */
  'ov.answer': {
    name: 'Answer here', kind: 'Panel', what: 'Everything that wants you, with its answers on it: questions, permissions, reviews, sign-ins, merges and faults.',
    does: 'Answer in place. J and K move between notices; 1 to 9 answer; Enter opens the detail; O opens it where it lives.',
    source: 'Chats, the Manager, GitHub, Accounts and the behaviors: the same notices the bell counts.'
  },
  'ov.count-open': {
    name: 'Open', kind: 'Display', what: 'How many notices are open at the level you chose. The bell shows the same number, in the same colour.',
    now: (el) => `${el.textContent.trim()} open.`,
    values: [['Red', 'A Poise fault is open.'], ['Amber', 'Something needs you.'], ['Green', 'All that is open has finished, for you to see.']]
  },
  'ov.level': {
    name: 'Show', kind: 'Control', what: 'How much of the notices you see. Each level includes the ones before it.',
    now: (el) => { const b = el.querySelector('[aria-checked="true"]'); return b ? `${b.textContent.trim()}: ${b.title}.` : ''; },
    values: [['Only you', 'Only what needs you.'], ['+ Faults', 'Also what Poise itself needs repaired.'], ['+ Done', 'Also what has finished, for you to see. The default, and what the bell counts.'], ['Everything', 'Also what Poise is handling on its own.']],
    scope: 'This panel, and the bell in every view.', when: 'Applies now; remembered in this browser.', unchanged: 'The notices themselves: a hidden one is still there, and shows again when you show more.'
  },
  'ov.held': { name: 'New, waiting', kind: 'Display', what: 'Notices that arrived while your pointer or focus was in the list. They wait so nothing moves under you.', does: 'Show now brings them in; leaving the list does too.' },
  'ov.idle': { name: 'Idle worker slots', kind: 'Notice', what: 'The Manager’s slots sit idle and its enhancement backlog is empty, so nothing is left for it to start. It names up to five issues to label, perf and P0–P1 first.', when: 'After slots sit idle for 15 minutes; it reminds at most hourly. It clears when a slot fills or an issue is labelled.', shows: 'Dismiss hides it until its next reminder; Silence until a slot fills or an issue is labelled.', source: 'Poise, from the Manager’s slots and the open issues (#782).' },
  'ov.notice': {
    name: 'Notice', kind: 'Notice', what: 'Something that wants you: who it is from, where it is, its state, and its answers.',
    now: (el) => { const n = el.closest('[data-notice]'); return n ? `${n.querySelector('.nc-h .t-micro')?.textContent}: ${n.querySelector('.nc-t')?.textContent}.` : ''; },
    does: 'Its answers are on it. More shows the detail; the link opens it where it lives.'
  },
  'ov.option': { name: 'Answer', kind: 'Action', what: 'Answers this notice, here.', shows: 'Accepted, then Executing while it acts, then Completed with what happened.', unchanged: 'Everything else. An answer is final: whoever asked is waiting on it.', unavailable: (el) => el.dataset.why || 'Not available right now.' },
  'ov.gone': { name: 'No longer answerable', kind: 'Display', what: 'Why this request’s answers are unavailable: it was answered elsewhere, cancelled or reset by its chat, or the connection to Poise dropped.', when: 'At once, even while new arrivals are held.', unchanged: 'The request itself, which Open still shows in its chat.', values: [['Answered elsewhere', 'In Chat, the Switchboard or another tab; the answer that counted is named.'], ['Cancelled or reset', 'Its chat ended the turn that asked; nothing was run.'], ['Connection dropped', 'Answers wait until Poise is back; nothing is sent meanwhile.']] },
  'ov.reply': { name: 'Reply', kind: 'Action', what: 'Writes a reply on GitHub, as mikkokotila, without leaving the Overview.', shows: 'Posting, then Replied.' },
  'ov.open': { name: 'Open', kind: 'Action', what: 'Opens the full context: the chat, the worker, the pull request or the setting, with a route back here.' },
  'ov.dismiss': { name: 'Dismiss', kind: 'Action', what: 'Puts this notice away.', when: 'At once, with Undo for eight seconds. It comes back if its condition changes.' },
  'ov.silence': { name: 'Silence reminders', kind: 'Action', what: 'Stops the 15-minute reminders for this ready pull request while it stays open.', unchanged: 'The pull request, and whether it can merge.' },
  'ov.undo': { name: 'Undo', kind: 'Action', what: 'Takes back a Dismiss or Silence in its first eight seconds. Until then it waits in this tab; leaving the page sends it at once.' },

  /* ---------- In motion and the Manager ---------- */
  'ov.motion': { name: 'In motion', kind: 'Display', what: 'The work in the seven state words: chats and workers, then issues and pull requests.', does: 'Choose a state to list it. Each item opens where it lives, with a route back.' },
  'ov.counts': { name: 'States', kind: 'Display', what: 'How many are in each of the seven states.' },
  'ov.count': {
    name: 'State count', kind: 'Filter', what: 'How many are in this state.',
    now: (el) => { const s = el.querySelector('.sc')?.dataset.state; const n = el.querySelector('b')?.textContent; return s ? `${n} ${window.poiseTerm('state.' + s)}${el.getAttribute('aria-pressed') === 'true' ? '; listed below' : ''}. ${window.POISE_REF['state.' + s].what}` : ''; },
    does: 'Lists them below.'
  },

  /* ---------- The day's numbers ---------- */
  'ov.tiles': { name: 'The day', kind: 'Display', what: 'The eight productivity numbers for the chosen day and organization.', source: 'Poise’s datastore: what Board shows, plus what the agent account opened. These reads make no GitHub requests.' },
  'ov.tile': {
    name: 'Number', kind: 'Display', what: 'One of the day’s numbers: its value, its pace against the 7 days before, and its year.',
    now: (el) => (el.closest('[data-tile], [data-small], .ofric')?.getAttribute('aria-label') || el.textContent.replace(/\s+/g, ' ').trim()),
    does: 'Choose it to open its year, with the readout and the distribution. Drag a tile, or press Alt with an arrow key, to reorder; the order is remembered.'
  },
  'ov.pace': {
    name: 'Pace', kind: 'Display', what: 'Today against typical by now: the 7-day median, scaled to the time of day.',
    values: [['Ahead of pace', 'More than 10% above typical; green.'], ['On pace', 'Within 10%, either way.'], ['Behind pace', 'More than 10% below; amber, not red, because red means Failed.'], ['Closed without merging', 'Reads the other way: fewer is better.'], ['Durations', 'Faster or slower than the 7-day median, with how many were measured.']],
    when: 'Completed days compare with the full 7-day median; no scaling.'
  },
  'ov.year': { name: 'The past year', kind: 'Chart', what: '52 weekly points ending yesterday. The latest is blue and the highest is marked.', does: 'The pointer, or the arrow keys with Home and End, read each week. Below, how the 52 weeks are distributed.' },
  'ov.day': { name: 'Day', kind: 'Control', what: 'Which day the numbers are for.', does: 'Previous and next move a day. It opens on Today; days begin at midnight in your time zone (General).', unchanged: 'The notices, the work in motion and the API quota, which are always live.' },
  'ov.org': { name: 'Organization', kind: 'Filter', what: 'All orgs, or one. The same choice as Board and Observe.', unchanged: 'The API quota, which belongs to the accounts.' },
  'ov.worktype': { name: 'Work type', kind: 'Display', what: 'The day’s merged pull requests by Conventional Commit prefix. Unclassified titles count too.', unchanged: 'Neutral bars: a type says nothing about quality.' },
  'ov.friction': { name: 'Review', kind: 'Display', what: 'What it took to merge: review rounds, and the share of merged pull requests with a change request.', when: 'Against the 7 days before; fewer is better.' },

  /* ---------- Behaviors and the API ---------- */
  'ov.behaviors': { name: 'Behaviors', kind: 'Display', what: 'Each behavior with its switch, its last run, and its runs, minutes and success for the chosen range.', source: 'Poise’s own record of the runs it launched.' },
  'ov.behavior': { name: 'Behavior', kind: 'Behavior', what: 'One behavior, how it last ran, and how much it ran.', now: (el) => el.closest('[data-beh]')?.innerText.replace(/\s+/g, ' ').trim() || '' },
  'ov.behavior.switch': { name: 'On', kind: 'Setting', what: 'Turns this behavior on or off: the same switch as Settings → Behaviors.', when: 'From its next run.', unchanged: 'What it already did on GitHub.' },
  'ov.range': { name: 'Range', kind: 'Filter', what: 'Any time, Today, Yesterday or This week, for the behaviors’ numbers.' },
  'ov.quota': { name: 'GitHub API', kind: 'Display', what: 'Your account and the automation account, for REST and GraphQL: used, left, the reset, the rate, the risk, and the last 24 hours.', source: 'GitHub’s rate-limit answer, every 15 seconds. Reading it costs no quota.', values: [['Needs configured accounts', 'No account is set: set your GitHub user and the automation account in Settings → General.'], ['Could not be read', 'Says so, with when it last read. Never a guessed number.']] },
  'ov.bucket': { name: 'Budget', kind: 'Display', what: 'One account’s REST or GraphQL budget until its reset.', now: (el) => el.closest('.qb')?.innerText.replace(/\s+/g, ' ').trim() || '' },
  'ov.risk': {
    name: 'Risk', kind: 'Display', what: 'An estimate that this budget runs out before its reset, if the current rate continues.',
    values: [['0%', 'Nothing to watch.'], ['1–66%', 'Amber: watch it. From 50%, held for 30 seconds, it becomes a Poise fault with a lever.'], ['Above 66%', 'Red: it will likely run out.']]
  },

  /* ---------- Briefing ---------- */
  'ov.briefing': {
    name: 'Briefing', kind: 'Display', what: 'The state of the day in a few sentences, written from the same notices and numbers below.',
    does: 'Each underlined part opens what it names: Answer now, a number and its year, the work in motion, or the API quota.',
    values: [['Capsule', 'The state, in its colour: needs you, a fault, ready, failed or blocked.'], ['Arrow', 'Ahead or behind against typical; green when that is good, amber when it is not.']],
    when: 'It rewrites itself as things change, but never while your pointer or focus is in Answer now.', unchanged: 'The notices follow the level you chose; the work and the numbers do not.'
  },
  'ov.focus': { name: 'First', kind: 'Notice', what: 'The most pressing notice, open, with its context and answers. The next one opens when you answer it, and the focus moves with it, so 1 to 9 keep answering.' },
  'ov.compact': { name: 'Notice', kind: 'Notice', what: 'A notice on one line: what it is, from whom, and its first answer. More answers opens it in place.', shows: 'It stays one line while its answer runs, and after, so nothing below it moves.' },
  'ov.toc': { name: 'On this page', kind: 'Navigation', what: 'The Briefing’s sections, in the order they matter. The one you are reading is marked; Answer now carries the bell’s count.' },
  'ov.next': {
    name: 'Next step', kind: 'Action', what: 'The next step for work that failed or is blocked, beside it.',
    does: 'Where the step answers a notice, it is the same answer as in Answer now, and shows there too. Otherwise it says where to look.',
    shows: 'Accepted, Executing, then what happened.'
  },
  'ov.quotaline': {
    name: 'GitHub API', kind: 'Display', what: 'Each account’s REST and GraphQL budget on one line: how much is used, and the risk where there is one.',
    does: 'Details shows the full budgets: reset, rate and the last 24 hours.',
    values: [['Quiet', 'Nothing to watch.'], ['Amber', 'A budget may run out before its reset. It is also in Answer now as a Poise fault, with the lever that saves it.']],
    source: 'GitHub’s rate-limit answer, every 15 seconds. Reading it costs no quota.'
  },
  'ov.pacerow': {
    name: 'Number', kind: 'Display', what: 'One of the day’s numbers, its typical by now, and the difference in words.',
    now: (el) => el.closest('[data-prow]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    does: 'Choose it to draw its year in the chart below.'
  },

  /* ---------- Reviewing ---------- */
  'ov.direction': { name: 'Direction', kind: 'Mock', what: 'Switches between the two Overview directions being compared. Not part of the design.' },
  'ov.outcomes': { name: 'Pull request outcomes', kind: 'Display', what: 'Three lines on one scale: pull requests merged, workflows that needed outside help, and errors that recovered on their own.', does: 'Each point is the mean of the last twelve two-hour buckets, in pull requests per bucket. Rest on it to read the counts and the pull requests behind them.', values: [['Merged', 'Distinct pull requests with a verified merge.'], ['Needed outside help', 'Workflows where Poise ran out of automatic progress, counted once, when it first needed help, even if they merged later.'], ['Errored, recovered on its own', 'An execution error followed by proven automatic completion, with no one stepping in.']], unchanged: 'A stretch with missing coverage, which is a gap, never a zero.', source: 'Poise’s measurement of outcomes (#817), once it exists.' },
  'ov.health': { name: 'System health', kind: 'Display', what: 'Five live cards over the last 24 hours of v2 chain work: errors per completed item, work blocked, recovered by itself, time since the last work error, and evidence coverage. Each opens the evidence behind its value.', source: 'PRD autonomio/poise#1101, being built: the chain journal, Caller receipts, GitHub and Logging’s coverage.' },
  'ov.planned-health': { name: 'Planned', kind: 'Display', what: 'This strip is decided in autonomio/poise#1101 and being built. The design shows where it goes and how it reads.' },
  'ov.h.errors': { name: 'Errors per completed work item', kind: 'Display', what: 'For work completed in the last 24 hours, its distinct work errors over its whole life, per item, with both counts.', unavailable: 'Unavailable when nothing completed, or when the evidence cannot cover both counts.', does: 'Opens Logging.' },
  'ov.h.blocked': { name: 'Work blocked', kind: 'Display', what: 'Work held, not confirmed or overdue now, issues without a pull request included, with the oldest time since verified progress and the stages it sits at. A healthy wait is not counted, however long.', does: 'Opens Observe → Tasks, Needs attention.' },
  'ov.h.recovery': { name: 'Recovered by itself', kind: 'Display', what: 'Work that recovered by itself after a failed run in the last 24 hours, with how many needed outside help. A retry, Resume or later merge alone proves neither.', does: 'Opens Observe → Tasks.' },
  'ov.h.lasterror': { name: 'Since the last work error', kind: 'Display', what: 'How long since the latest verified work error, and when. Where coverage since then is incomplete, it is the last observed one.', does: 'Opens that diagnostic in Logging.' },
  'ov.h.coverage': { name: 'Evidence coverage', kind: 'Display', what: 'One row for each source these cards read: covered time, gaps in amber, unknown time hollow; a source with no measured interval shows its state.', does: 'Opens Logging’s Data and collection.' },
  'ov.dist': { name: 'The last 30 days', kind: 'Chart', what: 'The 30 completed days before the chosen day, one value a day, in five equal bins. Unknown days are left out; real zeros stay.' },
  'ov.advance': { name: 'No verified advance', kind: 'Display', what: 'How long since the chain last verified progress on this work. Held work shows at once; other work after a day.' },
  'ov.impact': { name: 'Work impact', kind: 'Display', what: 'What this notice’s failure did to managed work, as the chain verifies it: its impact, target and stage, last verified progress and the next retry.' },
  'ov.partial': { name: 'Partial', kind: 'Display', what: 'Some run records could not be read, so the marked counts cover the readable runs only. A value nothing proves stays —.' },
  'ov.planned': { name: 'Planned', kind: 'Display', what: 'This card is decided in autonomio/poise#819 and not built yet. The design shows where it goes and how it reads.' },
  'ov.phases': { name: 'Tasks, by phase', kind: 'Display', what: 'How many tasks are at each phase of the chain: issue review, implementation, PR review, repair, approval, merge, and merged.', does: 'A phase lists its tasks below, each opening its timeline in Observe.' },
  'ov.phase': { name: 'Phase', kind: 'Control', what: 'Lists the tasks at this phase.' },
  'ov.fold': { name: 'Show or Fold', kind: 'Action', what: 'Shows or folds what Poise handled on its own. Folded, the group keeps its count.' },
  'ov.handled': { name: 'Handled today', kind: 'Action', what: 'Shows or folds what you and Poise settled today, newest first, with Undo while it lasts.' },
  'ov.closeyear': { name: 'Close the year', kind: 'Action', what: 'Closes this tile’s year and returns focus to the tile.' }
});
