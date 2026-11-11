// The workspace's shared state: its chats, and the issues and pull requests
// on Board. Chat, the Manager, Board and Overview all read these lists, so a
// chat or a pull request says the same thing wherever it shows.
(() => {
  const D = 1440;   // minutes in a day
  window.POISE_CHATS = [
    { id: 'mgr', manager: true, title: 'Manager', state: 'running', at: 1942, t: 'live' },
    { id: 'c475', title: '#475 Stop Browser Chromium shards being cancelled at 15 minutes', state: 'needs-you', note: 'asks to run gh pr create', who: 'Muse · spark 1.3 contributor', at: 1941, t: '19:41', project: 'autonomio/poise' },
    { id: 'w4', worker: 'W4', title: 'Can you have a look at “One note, left untouched per issue”', state: 'needs-you', note: 'asks which note to keep', who: 'Muse · spark 1.3 contributor', at: 1922, t: '19:22', project: 'autonomio/poise' },
    { id: 'w5', worker: 'W5', title: 'Limen: read the gate thresholds from the new schema', state: 'blocked', note: 'until #1141 is reviewed', who: 'Codex · GPT-5 Codex', at: 1851, t: '18:51', project: 'Acme/Limen' },
    { id: 'c446', title: 'Task: fix autonomio/poise#446', state: 'failed', note: 'provider error', who: 'Grok Build · Grok 5', at: 1320, t: '13:20', project: 'autonomio/poise' },
    { id: 'w1', worker: 'W1', title: '#474 Make rerun-grey-ci rerun only the failed shard', state: 'running', who: 'Muse · spark 1.3 contributor', at: 1939, t: '19:39', project: 'autonomio/poise' },
    { id: 'w2', worker: 'W2', title: '#471 Make Chat’s left pane a live work log', state: 'running', who: 'Muse · spark 1.3 contributor', at: 1936, t: '19:36', project: 'autonomio/poise' },
    { id: 'w3', worker: 'W3', title: '#478 One filter bar for Archive and Analytics', state: 'running', who: 'Claude Code · Opus 5 · High', at: 1933, t: '19:33', project: 'autonomio/poise' },
    { id: 'w6', worker: 'W6', title: '#482 Retry the flaky Safari shard with a trace', state: 'running', who: 'Muse · spark 1.3 contributor', at: 1926, t: '19:26', project: 'autonomio/poise' },
    { id: 'c479', title: '#479 Raise the Codex retry budget', state: 'waiting', note: 'for CI checks', who: 'Codex · GPT-5 Codex', at: 1918, t: '19:18', project: 'autonomio/poise' },
    { id: 'w7', worker: 'W7', title: '#506 Pin Playwright to 1.58 in the image', state: 'blocked', note: 'stalled: 2 unpushed commits · tests still running', stalled: true, who: 'Codex · GPT-5 Codex', at: 1925, t: '19:25', project: 'autonomio/poise' },
    { id: 'c509', from: 'c-charter', title: '#509 Show the Manager’s wake-up cost in Overview', state: 'waiting', note: 'preparing the checkout', who: 'Claude Code · Opus 5 · High', at: 1940, t: '19:40', project: 'autonomio/poise' },
    { id: 'c-loop', fromGone: 'Watch the deploy on main', title: '#508 Wait for the deploy check to settle', state: 'idle', note: 'ended by Poise: it kept repeating the same check', who: 'Grok Build · Grok 5', at: 1702, t: '17:02', project: 'autonomio/poise' },
    { id: 'c-new', title: 'New chat', state: 'idle', who: 'Muse · spark 1.3 contributor', at: 1822, t: '18:22', project: 'autonomio/poise' },
    { id: 'c-charter', title: 'Update the Manager’s charter', state: 'idle', who: 'Claude Code · Opus 5 · High', at: 1512, t: '15:12', project: 'agent-tooling' },
    { id: 'c453', title: 'Task: fix autonomio/poise#453', state: 'idle', note: 'stopped by you', who: 'Codex · GPT-5 Codex', at: 1444, t: '14:44', project: 'autonomio/poise' },
    { id: 'c-midnight', title: 'Observe Analytics history across midnight', state: 'idle', note: 'closed', closed: true, who: 'Claude Code · Opus 5 · High', at: 21, t: 'Oct 21', project: 'autonomio/poise' },
    { id: 'jev', title: 'JEV · Should the gate block on flaky shards?', state: 'idle', who: 'JEV · Primitive builder', at: 20, t: 'Oct 20', project: 'autonomio/poise' }
  ];
  // The Manager's next tickets, in order: filed, and given to a worker when a
  // slot frees. Chat, the Manager, Board and Overview read this one list.
  window.POISE_MANAGER = { next: [{ issue: 483, title: '#483 Cache Playwright browsers between shards', project: 'autonomio/poise' }] };
  // [lane, repository, number, title, state, detail, who, minutes ago, opened, minutes on the same blocker]
  window.POISE_BOARD = { ITEMS: [
    ['issue', 'autonomio/poise', 475, 'Stop Browser Chromium shards being cancelled at 15 minutes on PR runs', 'needs-you', 'asks to run gh pr create', 'Chat', 1, 180],
    ['issue', 'autonomio/poise', 477, 'Keep one note per issue, left untouched', 'needs-you', 'asks which note to keep', 'W4', 19, 200],
    ['issue', 'autonomio/poise', 478, 'One filter bar for Archive and Analytics', 'running', '', 'W3', 8, 90],
    ['issue', 'autonomio/poise', 482, 'Retry the flaky Safari shard with a trace', 'running', '', 'W6', 11, 60],
    ['issue', 'autonomio/poise', 483, 'Cache Playwright browsers between shards', 'waiting', 'next for a worker: the Manager gives it one when a slot frees', 'Manager', 10, 58],
    ['issue', 'Acme/Limen', 1160, 'Read the gate thresholds from the new schema', 'blocked', 'until #1141 is reviewed', 'W5', 50, 300],
    ['issue', 'autonomio/poise', 485, 'Keep the behavior ledger available and stop it dropping records again', 'running', 'fix-issue run', 'Run:Run', 13, 40],
    ['issue', 'autonomio/poise', 489, 'Retry approve-prs checks at the quota reset instead of backing off for an hour', 'idle', '', null, 62, 62],
    ['issue', 'Acme/Limen', 1158, 'Preserve string categories on serial resume', 'idle', '', null, 121, 400],
    ['issue', 'Acme/Limen', 1098, 'Admit valid frozen PBO partitions', 'idle', '', null, 126, 2000],
    ['issue', 'Acme/Limen', 1031, 'PBO rejects valid even block counts above eight [F11]', 'idle', '', null, 131, 5000],
    ['issue', 'autonomio/poise', 408, 'Bound or compact agent-interface --logs output before the 32 MB cap', 'done', 'closed', null, 1, 3000],
    ['issue', 'mikkokotila/control-plane', 90, 'Install the pipeline service so download and build always resume', 'done', 'closed', null, 37, 900],
    ['issue', 'autonomio/poise', 466, 'Restart a Muse chat on a fresh session when its old reasoning went to another caller', 'done', 'closed', null, 61, 1500],
    ['issue', 'autonomio/poise', 461, 'Don’t wake a chat for behavior notices about a closed issue or PR', 'done', 'closed', null, 122, 1700],
    ['pr', 'autonomio/poise', 486, 'Rerun only the failed shard', 'running', '', 'W1', 2, 30],
    ['pr', 'autonomio/poise', 471, 'Make Chat’s left pane a live work log', 'waiting', 'CI running on 8e1f2c4', 'W2', 5, 110, 22],
    ['pr', 'autonomio/poise', 487, 'Don’t report untouched binary files as unrevertable changes after Chat turns', 'running', 'review running on 9c1e4a7 · round 1 of 5', 'Run:Review', 8, 8],
    ['pr', 'autonomio/poise', 484, 'Keep datastore scheduling fresh during repository changes', 'needs-you', 'approved and green: the merge is yours', null, 26, 26],
    ['pr', 'autonomio/poise', 473, 'Let a pending Poise update land within a bounded pause, then resume interrupted chats', 'needs-you', 'your review requested', null, 47, 47],
    ['pr', 'Acme/Limen', 1141, 'Size existing primary entries with causal meta models', 'needs-you', 'your review requested', null, D, 2900],
    ['pr', 'autonomio/poise', 480, 'Make rerun-grey-ci rerun cancelled CI again, and recover after rate limits', 'failed', 'CI failing: Browser · webkit', null, 42, 42],
    ['pr', 'autonomio/poise', 460, 'Keep Chat agent turns running through a Poise update', 'blocked', 'conflicts with main', null, 23, 400, 64],
    ['pr', 'autonomio/poise', 507, 'Pin Playwright to 1.58 in the image', 'blocked', 'stalled: 2 unpushed commits · tests still running', 'W7', 16, 70],
    ['pr', 'autonomio/poise', 481, 'Queue a steer that Muse doesn’t run mid-turn instead of failing the turn', 'idle', 'draft', null, 63, 63],
    ['pr', 'Acme/Limen', 1128, 'Fit automatic shims within chronological sizing folds', 'idle', '', null, 2 * D, 4000],
    ['pr', 'Acme/Limen', 1162, 'Keep string categories through a serial resume', 'waiting', 'CI running on 51c0e2a', null, 9, 9],
    ['pr', 'autonomio/poise', 470, 'Bound or compact agent-interface --logs output before the 32 MB cap', 'done', 'merged', null, 1, 240],
    ['pr', 'mikkokotila/control-plane', 91, 'Install the pipeline service so download and build always resume', 'done', 'merged', null, 35, 600],
    ['pr', 'autonomio/poise', 472, 'Keep approve-prs sweeps from timing out repeatedly', 'done', 'merged', null, 53, 500],
    ['pr', 'autonomio/poise', 462, 'Attribute the shared agent-log spawn neutrally in diagnostics', 'done', 'merged', null, 61, 700]
  ] };
})();
