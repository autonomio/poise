// Observe's data: every agent run (Swarm), the GitHub history (Archive) and
// Poise's own diagnostics (Logging). It agrees with the other views: the same
// pull requests, chats, behaviors, accounts and failures.
(() => {
  const { secs } = window.PoiseShell;
  // Seconds since midnight today; a negative day reaches back.
  const at = (hhmm, s = 0, day = 0) => { const [h, m] = hhmm.split(':').map(Number); return day * 86400 + h * 3600 + m * 60 + s; };
  const OPUS = 'Claude Code · Opus 5 · High', ASTRA = 'Codex · GPT-6 Astra · Max', GPT5 = 'Codex · GPT-5 Codex · High';
  const MUSE = 'Muse · spark 1.3 contributor · max', GROK = 'Grok Build · Grok 5 · High', GEMINI = 'Antigravity · Gemini 3.8 Flash · High';

  // ---------- Swarm: agent runs ----------
  // The behavior names are the ones Settings and Overview use.
  const BEHAVIOR = {
    pr_review: 'Review New Pull Requests', pr_approve: 'Approve Pull Requests', issue_review: 'Review New Issues',
    resolve: 'Resolve Unblocking Conversations', fix_issue: 'Fix issue', chat: 'Chat', editor_chat: 'Editor chat',
    implement_issue: 'Implement Issues', repair_pr: 'Repair Pull Requests',
    // A chain's own GitHub action: one fixed command, and no model.
    merge_if_ready: 'Merge if ready'
  };
  const REVIEW_TEXT = 'Two suggestions, no blockers.\n\n1. src/datastore/schedule.ts:88 — the retry backoff is reset on every repository change; keep the attempt count when only the repository list changes.\n2. src/datastore/schedule.test.ts — add a case for a repository removed while its sync is running.\n\nChecks pass. Approve once (1) is addressed or answered.';
  const run = (o) => ({ events: [], ...o, behaviorLabel: BEHAVIOR[o.behavior] });
  const RUNS = [
    run({ id: 'c0f1a2b3c4d5e6f708192a3b4c5d6e70', model: OPUS, behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 487, state: 'running', started: at('19:38', 5), est: { median: 540, p90: 840, samples: 23 },
      progress: { phase: 'Reasoning reported', since: at('19:39', 40), heartbeat: 'live', provider: 'live', deadline: at('19:58', 5), reasoning: 'The change skips binary files whose content hash is unchanged after a Chat turn. Checking whether the hash is read before or after the working tree is restored…' },
      events: [[at('19:38', 5), 'Started for autonomio/poise#487 at 9c1e4a7'], [at('19:38', 9), 'Checked out the pull request'], [at('19:38', 31), 'Read 6 changed files, +94 −21'], [at('19:39', 40), 'The provider reported reasoning']] }),
    run({ id: 'a7d2c9e1f03b4a5c8d6e7f8091a2b3c4', model: MUSE, behavior: 'chat', session: { label: 'W2 · #471 Make Chat’s left pane a live work log', href: 'manager.html?peek=w2&back=observe', chat: true }, state: 'running', started: at('19:36', 50),
      progress: { phase: 'Tool execution reported', since: at('19:40', 58), heartbeat: 'live', provider: 'live' },
      events: [[at('19:36', 50), 'Turn started by the Manager'], [at('19:37', 12), 'Edited src/chat/work-log.ts'], [at('19:40', 58), 'Running pnpm test chat-work-log']] }),
    run({ id: 'b3e4f5a6b7c8d9e0f1a2b3c4d5e6f708', model: GPT5, behavior: 'fix_issue', org: 'autonomio', repo: 'poise', pr: 485, kind: 'issues', state: 'running', started: at('19:33', 10),
      progress: { phase: 'Waiting for provider', since: at('19:39', 55), heartbeat: 'live', provider: at('19:39', 55), deadline: at('19:53', 10) },
      events: [[at('19:33', 10), 'Started for autonomio/poise#485'], [at('19:34', 2), 'Planned three steps'], [at('19:39', 55), 'Asked the provider for the second step']] }),
    run({ id: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f809', model: OPUS, behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 486, state: 'done', outcome: 'Changes requested', note: '2 comments', started: at('19:09', 2), elapsed: 192, response: REVIEW_TEXT,
      events: [[at('19:09', 2), 'Started for autonomio/poise#486'], [at('19:11', 40), 'Review written'], [at('19:12', 14), 'Posted the review with 2 comments']] }),
    run({ id: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a', model: ASTRA, behavior: 'pr_approve', org: 'autonomio', repo: 'poise', pr: 484, state: 'done', outcome: 'Approved', started: at('18:55', 10), elapsed: 41, response: 'Approved as bit-mis. Checks pass and no conversation is open.' }),
    run({ id: 'f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b', model: ASTRA, behavior: 'pr_approve', org: 'autonomio', repo: 'poise', pr: 484, state: 'failed', note: 'GitHub returned 502 Bad Gateway', started: at('18:53', 40), elapsed: 12,
      error: 'GitHub returned 502 Bad Gateway while posting the approval.\nPOST /repos/autonomio/poise/pulls/484/reviews\nApprove Pull Requests retried at 18:55 and succeeded.' }),
    run({ id: 'a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3', model: OPUS, behavior: 'resolve', org: 'autonomio', repo: 'poise', pr: 471, state: 'done', outcome: 'Done', note: 'Resolved 2 conversations', started: at('17:20', 4), elapsed: 66 }),
    run({ id: 'b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4', model: OPUS, behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 471, state: 'idle', outcome: 'Superseded', note: 'New commits arrived while it ran', started: at('17:02', 30), elapsed: 205 }),
    run({ id: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6', model: GEMINI, behavior: 'issue_review', org: 'autonomio', repo: 'poise', pr: 483, kind: 'issues', revision: '5e0d1c2', state: 'done', outcome: 'Commented', note: '2 comments posted, on revision 5e0d1c2', started: at('16:03', 8), elapsed: 118,
      response: 'Posted two comments on autonomio/poise#483: a repro for the cache miss on fresh runners, and a pointer to the Playwright cache key in ci.yml.' }),
    run({ id: 'd2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7', model: GROK, behavior: 'chat', session: { label: 'Task: fix autonomio/poise#446', href: 'chat.html?back=observe', chat: true }, state: 'failed', note: 'Provider error: xAI returned 503', started: at('13:16', 0), elapsed: 242,
      error: 'Provider error: xAI returned 503 Service Unavailable.\nThe turn stopped at 13:20. Nothing was pushed.\nRetry it from the chat, or answer its notice in Overview.' }),
    run({ id: 'e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8', model: OPUS, behavior: 'editor_chat', session: { label: 'HELIOS', href: 'editor.html?back=observe', chat: false }, state: 'done', outcome: 'Done', started: at('12:48', 20), elapsed: 74,
      response: 'Suggested a tighter opening paragraph and two edits; you applied one.' }),
    run({ id: 'f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9', model: ASTRA, behavior: 'pr_review', org: 'Acme', repo: 'Limen', pr: 1141, state: 'idle', outcome: 'Stopped', note: 'Stopped by you', started: at('11:30', 0), elapsed: 460 }),
    run({ id: 'a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0', model: OPUS, behavior: 'pr_review', org: 'northwind', repo: 'assay-pipeline', pr: 57, state: 'failed', outcome: 'Preflight failed', note: 'The repository could not be cloned', started: at('10:12', 0), elapsed: 9,
      error: 'Preflight failed: git clone https://github.com/northwind/assay-pipeline returned 128.\nremote: Internal Server Error (GitHub returned 502).\nNo review was posted.' }),
    run({ id: 'b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1', model: OPUS, behavior: 'pr_review', org: 'Acme', repo: 'Limen', pr: 1138, state: 'done', outcome: 'Done', note: 'No comments', started: at('09:40', 0), elapsed: 151,
      identical: [{ id: 'b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e2', started: at('09:12', 0), elapsed: 148 }, { id: 'b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e3', started: at('08:55', 0), elapsed: 156 }] }),
    run({ id: 'c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2', model: GPT5, behavior: 'chat', session: { label: '#479 Raise the Codex retry budget', href: 'chat.html?back=observe', chat: true }, state: 'done', outcome: 'Done', started: at('19:12', 0), elapsed: 372 }),
    run({ id: 'd8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3', model: OPUS, behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 472, state: 'done', outcome: 'Done', note: 'No comments', started: at('22:10', 0, -1), elapsed: 133 }),
    run({ id: 'e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4', model: ASTRA, behavior: 'pr_approve', org: 'autonomio', repo: 'poise', pr: 472, state: 'done', outcome: 'Approved', started: at('22:14', 0, -1), elapsed: 38 })
  ].sort((a, b) => b.started - a.started);
  // A record the log could not read: kept apart from the runs, with what could be read.
  RUNS.splice(1, 0,
    run({ id: '2214cc0b1c2d3e4f5a6b7c8d9e0f1a2b', model: 'Claude Code · Opus 5 · Max', behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 492, state: 'running', started: at('19:38', 20), task: 't488', est: { median: 300, p90: 420, samples: 9 },
      progress: { phase: 'Receiving response', since: at('19:38', 30), heartbeat: 'live', provider: 'live', deadline: at('20:38', 20) },
      events: [[at('19:38', 20), 'PR review round 1 for autonomio/poise#492 at 7c1e9a2 · Primary']] }),
    run({ id: '2215aa0b1c2d3e4f5a6b7c8d9e0f1a2b', model: ASTRA, behavior: 'repair_pr', org: 'autonomio', repo: 'poise', pr: 499, state: 'running', started: at('19:38', 2), task: 't498', est: { median: 0, p90: 0, samples: 3 },
      progress: { phase: 'Reading repair evidence', since: at('19:39', 10), heartbeat: 'live', provider: 'live', deadline: at('20:38', 2) },
      events: [[at('19:38', 2), 'Repair round 2 for autonomio/poise#499 at 9e02a77 · Secondary'], [at('19:38', 40), 'Read the finding on review 5712']] }),
    run({ id: '2203bb1c2d3e4f5a6b7c8d9e0f1a2b3c', model: 'Claude Code · Opus 5 · Max', behavior: 'implement_issue', org: 'autonomio', repo: 'poise', pr: 488, kind: 'issues', task: 't488', state: 'done', outcome: 'Published', note: 'opened #492 · settled, its resources released', started: at('19:09', 4), elapsed: 662,
      response: 'Implemented autonomio/poise#488 on poise/488-crlf, published the branch and opened #492 at 7c1e9a2.' }),
    run({ id: '30c1dd2e3f4a5b6c7d8e9f0a1b2c3d4e', model: '—', behavior: 'merge_if_ready', org: 'Acme', repo: 'Limen', pr: 1152, task: 't1150', state: 'done', outcome: 'Enqueued', note: 'accepted · queue entry 88', started: at('19:30', 0), elapsed: 4,
      response: 'Merge if ready: e40c9b3 is approved and green, so it was added to the merge queue as entry 88.' })
  );
  RUNS.push(run({ id: '17a0cc2d3e4f5a6b7c8d9e0f1a2b3c4d', model: OPUS, behavior: 'pr_review', org: 'northwind', repo: 'forecast-model', pr: 21, state: 'blocked', outcome: 'Held', note: 'bit-mis cannot read this repository · held once, rechecked hourly', started: at('17:40', 0), elapsed: null, noaccess: true }));
  const QUARANTINED = [{ index: 2291, target: 'autonomio/poise#480', behavior: 'pr_review', call: 'unknown', error: 'Its started time could not be read.' }];
  // What arrives while you watch: Muse's pull request, opened after you allowed it, gets its review.
  const LATER_RUN = run({ id: '0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d', model: OPUS, behavior: 'pr_review', org: 'autonomio', repo: 'poise', pr: 488, state: 'running', started: null,
    progress: { phase: 'Preparing a fresh checkout', since: null, heartbeat: 'live', provider: 'live' }, events: [] });

  // ---------- Archive: GitHub history ----------
  // type: pr, issue or action (CI). Updated is seconds since midnight today.
  const row = (type, org, repo, n, title, state, updated, o = {}) => ({ type, org, repo, n, title, state, updated, author: 'mikkokotila', owner: null, ...o });
  const ARCHIVE = [
    row('action', 'autonomio', 'poise', 9121, 'CI · browser shard 3', 'failure', at('18:52'), { branch: 'fix/rerun-cancelled', event: 'pull_request', pr: 480, author: 'mikkokotila' }),
    row('action', 'autonomio', 'poise', 9118, 'CI · browser shard 2', 'cancelled', at('18:40'), { branch: 'fix/browser-shard-timeout', event: 'pull_request', pr: 475 }),
    row('action', 'mikkokotila', 'example.com', 412, 'deploy', 'in_progress', at('19:30'), { branch: 'helios', event: 'push' }),
    row('action', 'northwind', 'assay-pipeline', 288, 'build', 'timed_out', at('10:12'), { branch: 'main', event: 'push', author: 'northwind-bot' }),
    row('action', 'autonomio', 'poise', 9110, 'CI', 'success', at('18:10'), { branch: 'main', event: 'push' }),
    row('action', 'Acme', 'Limen', 3301, 'tests', 'success', at('17:44'), { branch: 'schema-meta', event: 'pull_request', pr: 1141 }),
    row('action', 'autonomio', 'poise', 9104, 'CI · unit', 'failure', at('15:21', 0), { branch: 'fix/codex-retry', event: 'pull_request', pr: 479 }),
    row('pr', 'autonomio', 'poise', 487, 'Don’t report untouched binary files as unrevertable changes after Chat turns', 'open', at('19:37')),
    row('pr', 'autonomio', 'poise', 486, 'Rerun only the failed shard', 'open', at('19:12'), { author: 'bit-mis' }),
    row('pr', 'autonomio', 'poise', 484, 'Keep datastore scheduling fresh during repository changes', 'open', at('18:55')),
    row('pr', 'autonomio', 'poise', 480, 'Rerun cancelled CI again', 'open', at('18:52')),
    row('pr', 'autonomio', 'poise', 479, 'Raise the Codex retry budget', 'open', at('19:18')),
    row('pr', 'autonomio', 'poise', 473, 'Let a pending Poise update land within a bounded pause, then resume interrupted chats', 'open', at('18:54'), { owner: 'mikkokotila' }),
    row('pr', 'autonomio', 'poise', 471, 'Make Chat’s left pane a live work log', 'open', at('19:37'), { author: 'bit-mis' }),
    row('pr', 'autonomio', 'poise', 460, 'Keep Chat agent turns running through a Poise update', 'open', at('19:18')),
    row('pr', 'Acme', 'Limen', 1141, 'Size existing primary entries with causal meta models', 'open', at('17:44'), { author: 'acme-dev', owner: 'mikkokotila' }),
    row('pr', 'mikkokotila', 'example.com', 14, 'HELIOS', 'open', at('19:31')),
    row('pr', 'autonomio', 'poise', 472, 'Keep approve-prs sweeps from timing out', 'merged', at('18:10')),
    row('pr', 'autonomio', 'poise', 470, 'Bound agent-interface --logs output', 'merged', at('16:40')),
    row('pr', 'Acme', 'Limen', 1138, 'Read gate thresholds from the schema', 'merged', at('09:58'), { author: 'acme-dev' }),
    row('pr', 'northwind', 'assay-pipeline', 57, 'Pin the aligner image', 'closed', at('10:20'), { author: 'northwind-bot' }),
    row('issue', 'autonomio', 'poise', 489, 'Retry approve-prs checks at the quota reset', 'open', at('19:05')),
    row('issue', 'autonomio', 'poise', 485, 'Keep the behavior ledger available', 'open', at('19:33'), { owner: 'bit-mis' }),
    row('issue', 'autonomio', 'poise', 483, 'Cache Playwright browsers', 'open', at('16:03')),
    row('issue', 'autonomio', 'poise', 478, 'One filter bar for Archive and Analytics', 'open', at('19:22')),
    row('issue', 'autonomio', 'poise', 477, 'Keep one note per issue, left untouched', 'open', at('19:22')),
    row('issue', 'autonomio', 'poise', 446, 'Chat turns fail on Grok Build provider errors', 'open', at('13:20')),
    row('issue', 'Acme', 'Limen', 1102, 'Gate thresholds drift between runs', 'closed', at('09:58'), { author: 'acme-dev' })
  ];
  // Older history, read page by page as you scroll: the same repositories, further back.
  const ARCHIVE_TOTAL = { pr: 236, issue: 168, action: 1180 };
  function olderRows(type, from, count) {
    const repos = [['autonomio', 'poise'], ['Acme', 'Limen'], ['mikkokotila', 'example.com'], ['autonomio', 'poise'], ['northwind', 'assay-pipeline']];
    const titles = { pr: ['Tighten the sync backoff', 'Keep reviews from double-posting', 'Read models from the catalog', 'Show the release line', 'Fix the editor scroll anchor', 'Retry Google exports'], issue: ['Logging export stops at 10k events', 'Swarm row flickers on refresh', 'Snippets lose order after import', 'Time zone ignored in Archive', 'Typography reset keeps the old size'], action: ['CI', 'CI · unit', 'CI · browser shard 1', 'deploy', 'tests'] };
    return [...Array(count)].map((_, k) => {
      const i = from + k, [org, repo] = repos[i % repos.length], t = titles[type][i % titles[type].length];
      const day = 1 + Math.floor(i / 4), state = type === 'pr' ? (i % 5 === 3 ? 'closed' : 'merged') : type === 'issue' ? 'closed' : (i % 6 === 2 ? 'failure' : 'success');
      return row(type, org, repo, type === 'action' ? 9100 - i * 3 : type === 'pr' ? 469 - i : 476 - i, t, state, at('12:00', 0, -day) - i * 1700, type === 'action' ? { branch: i % 3 ? 'main' : 'fix/older', event: 'push' } : {});
    });
  }

  // ---------- Logging: diagnostics ----------
  const hex = (seed, n) => { let x = seed * 2654435761 % 4294967296, s = ''; while (s.length < n) { x = (x * 1103515245 + 12345) % 2147483648; s += x.toString(16).padStart(8, '0'); } return s.slice(0, n); };
  const ev = (k, o) => ({
    id: `evt_${hex(k, 16)}_${hex(k + 991, 64)}`, incidentId: o.incident || `inc_${hex(k + 77, 16)}_${hex(k + 1771, 64)}`,
    severity: 'warning', source: 'poise', component: '', operation: '', phase: '', target: '', repository: '', workspace: 'mikkokotila', account: '', instance: 'poise-gw-1', container: 'ws-mikkokotila',
    release: 'autonomio/poise@3f9c2ab', callId: '', correlationId: '', requestId: `req_${hex(k + 5, 12)}`, occurrences: 1, eventTime: null, ingested: null,
    message: '', cause: [], stderr: null, stack: null, context: {}, resources: {}, exitCode: null, signal: null, errno: null, timeoutMs: null, truncated: false, settings: null, pr: null, ...o
  });
  const CALL_446 = 'd2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7', CALL_APPROVE = 'f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b', CALL_PREFLIGHT = 'a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0';
  const INC_SYNC = `inc_${hex(4242, 16)}_${hex(4243, 64)}`, INC_GREY = `inc_${hex(5151, 16)}_${hex(5152, 64)}`, CORR_484 = 'corr_484_approve';
  const EVENTS = [
    ev(1, { severity: 'warning', source: 'caller', component: 'github-quota', operation: 'forecast', phase: 'sustained', target: 'bit-mis REST', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('19:39', 2), occurrences: 4,
      message: 'bit-mis may run out of REST requests before 19:58: 58% risk at 71 a minute.', context: { used: 3950, limit: 5000, reset: '19:58', perMinute: 71, sustainablePerMinute: 62 }, settings: 'behaviors' }),
    ev(2, { severity: 'error', source: 'caller', component: 'behaviors', operation: 'rerun-grey-ci', phase: 'launch', target: 'autonomio/poise#475', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('18:40', 11), incident: INC_GREY, occurrences: 3,
      message: 'Rerun Grey CI held: GitHub’s REST limit was reached on bit-mis.', cause: ['GitHub returned 403: API rate limit exceeded for installation'], context: { behavior: 'rerun-grey-ci', retryAt: '19:50' }, pr: 'https://github.com/autonomio/poise/pull/475', settings: 'behaviors' }),
    ev(3, { severity: 'error', source: 'poise', component: 'datastore', operation: 'sync', phase: 'fetch', target: 'northwind', account: 'mikkokotila', eventTime: at('19:24', 0), incident: INC_SYNC, occurrences: 9,
      message: 'northwind has not synced since 19:24: GitHub returned 502.', cause: ['GET /orgs/northwind/issues returned 502 Bad Gateway'], context: { organization: 'northwind', lastSuccess: '19:07' }, settings: 'general' }),
    ev(4, { severity: 'error', source: 'caller', component: 'chat', operation: 'turn', phase: 'provider', target: 'Task: fix autonomio/poise#446', account: 'mikkokotila', repository: 'autonomio/poise', callId: CALL_446, eventTime: at('13:20', 2),
      message: 'Grok Build provider error: xAI returned 503 Service Unavailable.', stderr: 'grok: request failed after 3 attempts\nstatus: 503 Service Unavailable\nretry-after: 30', cause: ['xAI returned 503 Service Unavailable'], context: { provider: 'xai', model: 'grok-5', attempts: 3 } }),
    ev(5, { severity: 'error', source: 'caller', component: 'behaviors', operation: 'approve-prs', phase: 'post', target: 'autonomio/poise#484', account: 'bit-mis', repository: 'autonomio/poise', callId: CALL_APPROVE, correlationId: CORR_484, eventTime: at('18:53', 52),
      message: 'Approving autonomio/poise#484 failed: GitHub returned 502. Approve Pull Requests retries it.', cause: ['POST /repos/autonomio/poise/pulls/484/reviews returned 502'], pr: 'https://github.com/autonomio/poise/pull/484' }),
    ev(6, { severity: 'warning', source: 'caller', component: 'behaviors', operation: 'approve-prs', phase: 'retry', target: 'autonomio/poise#484', account: 'bit-mis', repository: 'autonomio/poise', correlationId: CORR_484, eventTime: at('18:55', 10),
      message: 'Approve Pull Requests retried autonomio/poise#484; the second attempt approved it.', pr: 'https://github.com/autonomio/poise/pull/484' }),
    ev(7, { severity: 'error', source: 'caller', component: 'accounts', operation: 'sign-in-check', phase: 'check', target: 'Grok Build', account: 'mikkokotila', eventTime: at('09:12', 0),
      message: 'Grok Build is not signed in: grok login --device-auth is needed.', context: { provider: 'xai', cli: 'grok' }, settings: 'accounts' }),
    ev(8, { severity: 'error', source: 'poise', component: 'google', operation: 'token-refresh', phase: 'refresh', target: 'research@example.com', account: 'research@example.com', eventTime: at('08:40', 0),
      message: 'research@example.com needs Google sign-in: its token was revoked.', cause: ['invalid_grant: Token has been expired or revoked.'], settings: 'publishing' }),
    ev(9, { severity: 'warning', source: 'docker', component: 'workspace-disk', operation: 'measure', phase: 'threshold', target: '/workspace', eventTime: at('17:55', 0),
      message: 'The workspace disk has 4.6 GiB free: less than 5 GiB.', resources: { measuredAt: '2026-10-23T17:55:00+03:00', measurement: 'statfs', freeBytes: 4939212390, totalBytes: 107374182400 }, settings: 'admin' }),
    ev(10, { severity: 'critical', source: 'gateway', component: 'workspace', operation: 'supervise', phase: 'restart', target: 'ws-mikkokotila', eventTime: at('23:12', 30, -1), exitCode: 137, signal: 'SIGKILL',
      message: 'The workspace container was restarted after it ran out of memory.', cause: ['OOM killer: memory limit 8 GiB reached'], resources: { measuredAt: '2026-10-22T23:12:28+03:00', measurement: 'cgroup', memoryBytes: 8589934592 } }),
    ev(11, { severity: 'warning', source: 'ingress', component: 'proxy', operation: 'upstream', phase: 'response', target: '/api/gh', eventTime: at('19:31', 0), occurrences: 12, timeoutMs: 4000,
      message: 'Slow upstream responses on /api/gh: 4.2 s, 12 times in the last hour.' }),
    ev(12, { severity: 'error', source: 'caller', component: 'behaviors', operation: 'review-prs', phase: 'preflight', target: 'northwind/assay-pipeline#57', account: 'bit-mis', repository: 'northwind/assay-pipeline', callId: CALL_PREFLIGHT, eventTime: at('10:12', 9), exitCode: 128,
      message: 'Preflight failed: northwind/assay-pipeline could not be cloned.', stderr: 'fatal: unable to access \'https://github.com/northwind/assay-pipeline/\': The requested URL returned error: 502', pr: 'https://github.com/northwind/assay-pipeline/pull/57' }),
    ev(13, { severity: 'warning', source: 'collection', component: 'diagnostics', operation: 'collect', phase: 'kernel', target: 'kernel', eventTime: at('14:02', 0),
      message: 'The kernel source dropped 12 events while the collector restarted.', context: { dropped: 12 } }),
    ev(14, { severity: 'warning', source: 'kernel', component: 'memory', operation: 'pressure', phase: 'sustained', target: 'ws-mikkokotila', eventTime: at('19:02', 0), occurrences: 2,
      message: 'Memory pressure stayed at 92% for 30 seconds.', resources: { measuredAt: '2026-10-23T19:02:00+03:00', measurement: 'psi', some10: 0.92 } }),
    ev(15, { severity: 'error', source: 'poise', component: 'publishing', operation: 'google-export', phase: 'upload', target: 'HELIOS', account: 'research@example.com', eventTime: at('08:41', 0),
      message: 'HELIOS could not be published to Google Docs: the account needs sign-in.', settings: 'publishing' }),
    ev(16, { severity: 'warning', source: 'caller', component: 'behaviors', operation: 'review-prs', phase: 'supersede', target: 'autonomio/poise#471', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('17:06', 0),
      message: 'A review of autonomio/poise#471 was superseded: new commits arrived while it ran.', pr: 'https://github.com/autonomio/poise/pull/471' })
  ];
  // The incidents repeat: earlier occurrences of the sync failure and the held behavior.
  // Chain work: each carries what the chain's journal verifies about the work it touched.
  // Added after the list so the copies below still repeat the sync and Grey CI failures.
  EVENTS.push(
    ev(901, { severity: 'error', source: 'caller', component: 'behaviors', operation: 'repair-pr', phase: 'publish', target: 'autonomio/poise#496', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('19:26', 4), callId: '2209ab1c2d3e4f5a6b7c8d9e0f1a2b3c', correlationId: 'corr_496_repair',
      message: 'Repair could not prove its reply: the provider stopped mid-post.', cause: ['The provider stream ended before the reply was confirmed'],
      impact: { impact: 'blocked', stage: 'Repair', target: 'autonomio/poise#496', progress: '19:01', retry: null, next: 'Reconcile the original reply; nothing new starts until it is confirmed', invocation: 'inv 2209', recovered: false, task: 't495', after: 1 } }),
    ev(902, { severity: 'warning', source: 'caller', component: 'behaviors', operation: 'implement-issue', phase: 'ci-read', target: 'autonomio/poise#493', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('19:20', 3), callId: '2208ab1c2d3e4f5a6b7c8d9e0f1a2b3c', correlationId: 'corr_493_implement',
      message: 'Implementation waits: GitHub returned 502 reading the checks on main.', cause: ['GitHub returned 502 Bad Gateway'],
      impact: { impact: 'retrying', stage: 'Implementation', target: 'autonomio/poise#493', progress: 'Thu 17:05', retry: '19:50', next: 'Read the checks again', invocation: 'inv 2208', recovered: false, task: 't493', after: 2 } }),
    ev(903, { severity: 'error', source: 'caller', component: 'behaviors', operation: 'review-pr', phase: 'provider', target: 'autonomio/poise#492', account: 'bit-mis', repository: 'autonomio/poise', eventTime: at('19:31', 8), callId: '2211ab1c2d3e4f5a6b7c8d9e0f1a2b3c', correlationId: 'corr_492_review',
      message: 'PR review of 7c1e9a2 timed out waiting for the provider.', cause: ['No provider event for 300 s'],
      impact: { impact: 'recovered', stage: 'PR review', target: 'autonomio/poise#492', progress: '19:38', retry: null, next: null, invocation: 'inv 2211', recovered: true, task: 't488', after: 4 } })
  );
  for (let k = 1; k <= 8; k++) EVENTS.push(ev(100 + k, { ...EVENTS[2], id: `evt_${hex(100 + k, 16)}_${hex(200 + k, 64)}`, eventTime: at('19:24', 0) - k * 120, occurrences: 1 }));
  for (let k = 1; k <= 2; k++) EVENTS.push(ev(300 + k, { ...EVENTS[1], id: `evt_${hex(300 + k, 16)}_${hex(400 + k, 64)}`, eventTime: at('18:40', 11) - k * 900, occurrences: 1 }));
  // And the long tail: routine warnings over the past week.
  const TAIL = [['ingress', 'proxy', 'Slow upstream response on /api/gh'], ['caller', 'behaviors', 'A review was superseded by new commits'], ['poise', 'datastore', 'A sync took longer than its interval'], ['docker', 'workspace-disk', 'Checkout cache trimmed'], ['collection', 'diagnostics', 'A source reconnected after a gap']];
  for (let k = 0; k < 120; k++) { const [source, component, message] = TAIL[k % TAIL.length]; EVENTS.push(ev(500 + k, { severity: k % 11 === 0 ? 'error' : 'warning', source, component, operation: 'routine', target: k % 2 ? 'autonomio/poise' : '', repository: k % 2 ? 'autonomio/poise' : '', eventTime: at('19:00', 0, -1) - k * 4300, message: `${message}.` })); }
  EVENTS.forEach((e) => { e.ingested = e.eventTime + 2; });
  EVENTS.sort((a, b) => b.eventTime - a.eventTime);
  const LATER_EVENTS = [
    ev(901, { severity: 'error', source: 'poise', component: 'datastore', operation: 'sync', phase: 'fetch', target: 'northwind', account: 'mikkokotila', eventTime: null, incident: INC_SYNC, message: 'northwind has not synced since 19:24: GitHub returned 502.' }),
    ev(902, { severity: 'warning', source: 'ingress', component: 'proxy', operation: 'upstream', phase: 'response', target: '/api/gh', eventTime: null, message: 'Slow upstream response on /api/gh.' })
  ];
  const SOURCES = [
    ['poise', 'Poise', 'connected', at('19:41'), []], ['caller', 'Caller', 'connected', at('19:41'), []], ['gateway', 'Gateway', 'connected', at('19:40'), []],
    ['docker', 'Docker', 'connected', at('19:40'), []], ['kernel', 'Kernel', 'partial', at('19:39'), [[at('13:58'), at('14:02'), 'The collector restarted; 12 events dropped.']]],
    ['ingress', 'Ingress', 'connected', at('19:41'), []], ['collection', 'Collection', 'connected', at('19:41'), []]
  ];
  const HEALTH = { collection: 'partial', query: 'connected', retention: at('00:00', 0, -14), earliest: at('19:02', 0, -14), latest: at('19:41'), lossActive: false, lossObserved: true };

  // ---------- Time ----------
  const rel = (t) => { if (t == null) return '—'; const s = Math.max(0, secs() - t); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; const d = Math.floor(s / 86400); return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`; };
  const dur = (s) => (s == null || Number.isNaN(s) ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)}m` : ''}`);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // A full time, as Logging shows it, in the time zone from General.
  const stamp = (t) => { if (t == null) return 'Not recorded'; const d = new Date(2026, 9, 23, 0, 0, t); return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const clockOf = (t) => { const d = new Date(2026, 9, 23, 0, 0, t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const ORGS = ['autonomio', 'Acme', 'mikkokotila', 'harbor-research', 'northwind'];

  window.PoiseObserve = { at, RUNS, QUARANTINED, LATER_RUN, BEHAVIOR, ARCHIVE, ARCHIVE_TOTAL, olderRows, EVENTS, LATER_EVENTS, SOURCES, HEALTH, rel, dur, stamp, clockOf, ORGS };
})();
