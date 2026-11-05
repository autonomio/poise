import { describe, expect, it, vi } from 'vitest'
import { mocks, pr, HEAD_SHA, NEXT_HEAD_SHA, loadModules, restartModules, resetLogCache, arrangeCli, agentLog, launchReviewBeforeCrash, launchApprovalBeforeCrash, fixture } from './behaviors-runtime-fixture'

describe('review outcome evidence and registration', () => {

  it.each(['valid', 'head', 'actor', 'source', 'receipt', 'pending', 'unclaimed', 'missing-inventory', 'running', 'quarantine', 'late-quarantine', 'ambiguous', 'claimed-sibling'])('explicit operator retry preserves publication and ownership guards (%s)', async (variant) => {
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior must produce exactly one atomic clean or change-request review',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
    if (variant === 'actor') failed.actor = 'another-account'
    if (variant === 'source') failed.source = 'another-system'
    if (variant === 'receipt') failed.review_id = 91
    if (variant === 'quarantine') modules.database.db.prepare("UPDATE behavior_seen SET launch_quarantine = 'unreadable' WHERE target = ?").run(launched.target)
    if (variant === 'ambiguous') fixture.agentLogs.push({ ...failed, id: 'e'.repeat(32) })
    await resetLogCache()
    if (variant === 'running') fixture.agentLogs.push(agentLog({ id: 'e'.repeat(32), correlation_id: 'running-sibling' }))
    await resetLogCache()
    if (variant === 'claimed-sibling') fixture.agentLogs.push(agentLog({ id: 'e'.repeat(32), correlation_id: 'completed-sibling',
      status: 'completed', action: 'reviewed_clean', outcome: 'clean', head_sha: HEAD_SHA, review_id: 91 }))
    await resetLogCache()
    arrangeCli(false, false, { headSha: variant === 'head' ? NEXT_HEAD_SHA : HEAD_SHA,
      ...(variant === 'missing-inventory' ? {} : { reviewerReviewIdsSince: ['unclaimed', 'claimed-sibling'].includes(variant) ? [91] : [] }),
      reviewerPendingReviews: variant === 'pending' ? 1 : 0 })
    if (variant === 'late-quarantine') {
      const implementation = mocks.runFile.getMockImplementation()!
      mocks.runFile.mockImplementation(async (...args: any[]) => {
        const result = await implementation(...args)
        if (args[1][0] === '--review-activity-since') modules.database.db.prepare("UPDATE behavior_seen SET launch_quarantine = 'unreadable' WHERE target = ?").run(launched.target)
        return result
      })
    }
    if (variant === 'valid' || variant === 'claimed-sibling') {
      await expect(modules.behaviors.retryFailedPrReviews([failed.id])).resolves.toEqual({ ok: true, targets: [launched.target] })
      expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).toBeNull()
      expect(modules.database.getMeta(`behavior_operator_retry:${failed.id}`)).toContain(launched.correlationId)
      expect(modules.database.listBehaviorDeadLetters()).toEqual([])
      await modules.behaviors.runEnabledBehaviorsOnce()
      expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
      await expect(modules.behaviors.retryFailedPrReviews([failed.id])).rejects.toThrow()
    } else {
      await expect(modules.behaviors.retryFailedPrReviews([failed.id])).rejects.toThrow()
      expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
      expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    }
  })

  it.each(['valid', 'head', 'actor', 'source', 'model', 'receipt', 'old', 'ambiguous', 'claimed', 'newest-claimed', 'posted-original'])('reconciles a held review only from a verified explicit replay (%s)', async (variant) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({
      id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', action: 'not_started', outcome: 'preflight_failed', model: 'opus-5-xhigh',
      review_policy: 'bounded-v1', error_code: 'review_provider_blocked', error: 'account blocked',
      expected_head: launched.expectedHead, actor: launched.actor,
      source: launched.source, correlation_id: launched.correlationId,
    })
    if (variant === 'posted-original') Object.assign(failed, { action: null, outcome: null })
    fixture.agentLogs = [failed]
    await resetLogCache()
    let modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
    vi.setSystemTime(Date.now() + 2_000)
    const replay = agentLog({
      id: 'e'.repeat(32), model: 'opus-5-xhigh', status: 'completed',
      action: 'reviewed_clean', outcome: 'clean', head_sha: HEAD_SHA,
      source: 'poise:replay', correlation_id: 'explicit-replay', review_id: 91,
    })
    if (variant === 'head') replay.head_sha = NEXT_HEAD_SHA
    if (variant === 'actor') replay.actor = 'another-account'
    if (variant === 'source') replay.source = 'another-system'
    if (variant === 'model') replay.model = 'gpt-6-astra-ultra'
    if (variant === 'old') Object.assign(replay, { started_at: launched.requestedAt, started_at_precise: launched.requestedAt })
    fixture.agentLogs.push(replay)
    await resetLogCache()
    if (variant === 'newest-claimed') {
      vi.setSystemTime(Date.now() + 1_000)
      fixture.agentLogs.push(agentLog({ ...replay, id: 'd'.repeat(32), correlation_id: 'newer-replay', review_id: 92,
        started_at: new Date().toISOString(), started_at_precise: new Date().toISOString(), completed_at: new Date().toISOString() }))
      await resetLogCache()
    }
    if (variant === 'ambiguous') fixture.agentLogs.push({ ...replay, id: 'd'.repeat(32) })
    await resetLogCache()
    arrangeCli(false, false, { reviewerReviewIdsSince: variant === 'receipt' ? [] : variant === 'newest-claimed' ? [91, 92] : [91] })
    modules = await restartModules()
    if (variant === 'claimed' || variant === 'newest-claimed') {
      modules.database.recordSeen('review-new-prs', 'another-slot')
      modules.database.db.prepare('UPDATE behavior_seen SET launch_call_id = ? WHERE target = ?').run(variant === 'claimed' ? replay.id : 'd'.repeat(32), 'another-slot')
    }
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    if (variant === 'valid' || variant === 'newest-claimed') {
      expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).toBeNull()
      expect(modules.database.latestApprovalBasisLaunch(pr.repo, pr.number)).toEqual({
        callId: replay.id, completedAt: replay.completed_at, headSha: HEAD_SHA,
      })
      expect(modules.database.listBehaviorDeadLetters()).toEqual([])
      modules = await restartModules()
      modules.database.setMeta('behavior_approve_prs_enabled', '1')
      modules.behaviors.startBehaviorsRuntime()
      await modules.behaviors.runEnabledBehaviorsOnce()
      expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
      expect(mocks.spawnDetached.mock.calls[1][1]).toContain('--pr-approve')
    } else {
      expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
      expect(modules.database.latestApprovalBasisLaunch(pr.repo, pr.number)).toBeNull()
    }
  })

  it.each(['model_output_limit', 'review_recovery_failed', 'review_contract_violation', 'review_provider_blocked', 'stopped'])('holds %s across restarts, without blocking another PR or a new head', async (code) => {
    const behavior = 'approve-prs' as 'review-new-prs' | 'approve-prs'
    const launched = behavior === 'review-new-prs'
      ? await launchReviewBeforeCrash() : await launchApprovalBeforeCrash()
    fixture.agentLogs = [agentLog({
      id: 'f'.repeat(32),
      behavior: behavior === 'review-new-prs' ? 'pr_review' : 'pr_approve',
      started_at: new Date(Date.parse(launched.requestedAt) + 1_000).toISOString(),
      status: 'failed', action: null, outcome: null, model: 'opus-5-xhigh', review_policy: 'bounded-v1',
      error_code: code, error: 'Review needs attention',
      expected_head: launched.expectedHead, actor: launched.actor,
      source: launched.source, correlation_id: launched.correlationId,
    })]
    await resetLogCache()
    let modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.hasSeen(behavior, launched.target)).toBe(true)
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)
    expect(modules.behaviors.getBehaviorsRuntimeHealth().failures).toEqual([])
    expect(mocks.observeAuthFailure).not.toHaveBeenCalled()
    modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)
    fixture.listedPrs = [pr, { ...pr, number: 18, url: 'https://github.com/Vaquum/poise-test/pull/18' }]
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
    expect(mocks.spawnDetached.mock.calls[1][1]).toContain('#18')
    arrangeCli(behavior === 'approve-prs', false, { headSha: NEXT_HEAD_SHA })
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(3)
  })

  it('recovers a terminal failed approval only after GitHub proves no reviewer action', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const launched = await launchApprovalBeforeCrash()
    const callId = '1'.repeat(32)
    fixture.agentLogs = [agentLog({
      id: callId,
      behavior: 'pr_approve',
      started_at: new Date(Date.parse(launched.requestedAt) + 1_000).toISOString(),
      started_at_precise: new Date(Date.parse(launched.requestedAt) + 1_001).toISOString(),
      status: 'failed',
      error: 'legacy preflight timeout',
      expected_head: launched.expectedHead,
      actor: launched.actor,
      source: launched.source,
      correlation_id: launched.correlationId,
    })]
    await resetLogCache()

    const { database: db, behaviors: runtime } = await restartModules()
    runtime.startBehaviorsRuntime()
    await runtime.runEnabledBehaviorsOnce()

    expect(db.hasSeen('approve-prs', launched.target)).toBe(true)
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()

    arrangeCli(true, false, { reviewerReviewsSince: 1 })
    vi.setSystemTime(new Date(Date.now() + runtime.BEHAVIOR_RETRY_BASE_MS))
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()

    arrangeCli(true, false, { reviewerReviewsSince: 0, reviewerPendingReviews: 0 })
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
  })

  it('releases a superseded review without degradation and reviews the current head', async () => {
    const launched = await launchReviewBeforeCrash()
    fixture.agentLogs = [agentLog({
      id: 'd'.repeat(32),
      started_at: new Date(Date.parse(launched.requestedAt) + 1_000).toISOString(),
      started_at_precise: new Date(Date.parse(launched.requestedAt) + 1_001).toISOString(),
      status: 'failed',
      error: 'pull-request head changed during behavior execution',
      expected_head: launched.expectedHead,
      actor: launched.actor,
      source: launched.source,
      correlation_id: launched.correlationId,
    })]
    await resetLogCache()

    const { database: db, behaviors: runtime } = await restartModules()
    runtime.startBehaviorsRuntime()
    await runtime.runEnabledBehaviorsOnce()

    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
    expect(runtime.getBehaviorsRuntimeHealth().failures).toEqual([])
    expect(db.listBehaviorDeadLetters()).toEqual([])
    expect(mocks.captureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, state: 'superseded', stateSource: 'native',
    }))
  })

  it.each([null, 91])('settles a closed-target review with retained publication evidence (%s)', async (reviewId) => {
    const launched = await launchReviewBeforeCrash()
    const completedAt = new Date(Date.parse(launched.requestedAt) + 2_000).toISOString()
    fixture.agentLogs = [agentLog({ id: 'd'.repeat(32),
      started_at: new Date(Date.parse(launched.requestedAt) + 1_000).toISOString(),
      started_at_precise: new Date(Date.parse(launched.requestedAt) + 1_001).toISOString(),
      status: 'superseded', outcome: 'superseded', action: null, head_sha: HEAD_SHA,
      completed_at: completedAt, review_id: reviewId,
      error_code: 'review_target_closed', error: 'target MERGED; receipt state remains uncertain',
      expected_head: launched.expectedHead, actor: launched.actor,
      source: launched.source, correlation_id: launched.correlationId })]
    await resetLogCache()
    const { database: db, behaviors: runtime } = await restartModules()
    runtime.startBehaviorsRuntime()
    await runtime.runEnabledBehaviorsOnce()
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(db.hasSeen('review-new-prs', launched.target)).toBe(true)
    expect(db.listBehaviorLaunchClaims('review-new-prs')).toEqual([])
    expect(db.listBehaviorDeadLetters()).toEqual([])
    expect(db.countReviewRounds(pr.repo, pr.number)).toBe(0)
    expect(mocks.captureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, callId: 'd'.repeat(32), state: 'superseded',
      activity: 'settled', outcome: 'review_target_closed', completedAt,
    }))
    expect(db.db.prepare('SELECT launch_call_id, launch_error FROM behavior_seen WHERE target = ?').get(launched.target))
      .toEqual({ launch_call_id: 'd'.repeat(32), launch_error: 'target MERGED; receipt state remains uncertain' })
  })

  it('quarantines a superseded review that posted instead of releasing it', async () => {
    const launched = await launchReviewBeforeCrash()
    fixture.agentLogs = [agentLog({
      id: 'd'.repeat(32),
      started_at: new Date(Date.parse(launched.requestedAt) + 1_000).toISOString(),
      started_at_precise: new Date(Date.parse(launched.requestedAt) + 1_001).toISOString(),
      status: 'superseded',
      outcome: 'superseded',
      head_sha: NEXT_HEAD_SHA,
      completed_at: new Date().toISOString(),
      review_id: 91,
      expected_head: launched.expectedHead,
      actor: launched.actor,
      source: launched.source,
      correlation_id: launched.correlationId,
    })]
    await resetLogCache()

    const { database: db, behaviors: runtime } = await restartModules()
    runtime.startBehaviorsRuntime()
    await runtime.runEnabledBehaviorsOnce()

    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(db.hasSeen('review-new-prs', launched.target)).toBe(true)
    expect(db.listBehaviorLaunchClaims('review-new-prs')).toHaveLength(1)
    expect(db.listBehaviorLaunchClaims('review-new-prs')[0]).toMatchObject({
      launchQuarantine: 'invalid_result',
      launchCallId: 'd'.repeat(32),
    })
    expect(db.listBehaviorDeadLetters()).toHaveLength(1)
    expect(db.countReviewRounds(pr.repo, pr.number)).toBe(0)
    expect(mocks.captureOutcome).not.toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, state: 'superseded',
    }))
  })

  it('waits through bounded registration grace before retrying a missing call', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const launched = await launchReviewBeforeCrash()
    const { database: db, behaviors: runtime } = await restartModules()
    runtime.startBehaviorsRuntime()

    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(db.db.prepare(`
      SELECT claim_id, launch_error FROM behavior_seen
      WHERE key = 'review-new-prs' AND target = ?
    `).get(launched.target)).toMatchObject({
      claim_id: expect.any(String),
      launch_error: 'awaiting agent call registration',
    })

    db.db.prepare(`
      UPDATE behavior_seen SET launch_requested_at = ?, lease_until = ?
      WHERE key = 'review-new-prs' AND target = ?
    `).run(
      new Date(Date.now() - runtime.BEHAVIOR_REGISTRATION_GRACE_MS - 1_000).toISOString(),
      Date.now() - 1,
      launched.target,
    )
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()

    vi.setSystemTime(new Date(Date.now() + runtime.BEHAVIOR_RETRY_BASE_MS))
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
  })

  it.each(['invalid_result', 'unreadable'] as const)('retires a closed PR incident while retaining its %s launch and uncertain firing', async (kind) => {
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
    modules.database.db.prepare('UPDATE behavior_seen SET launch_quarantine = ? WHERE key = ? AND target = ?')
      .run(kind, 'review-new-prs', launched.target)
    if (kind === 'unreadable') {
      const implementation = mocks.runFile.getMockImplementation()!
      mocks.runFile.mockImplementation(async (command, args, ...rest) => {
        if (command === 'agent-interface' && args[0] === '--logs') throw new Error('agent log unavailable')
        return implementation(command, args, ...rest)
      })
      await resetLogCache()
      await modules.behaviors.runEnabledBehaviorsOnce()
    }
    const before = modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)
    const incident = modules.database.listBehaviorDeadLetters()[0]
    const notices = await import('../server/alerts/notices')
    expect(notices.noticesState().notices.some((notice) => notice.kind === 'behavior_held')).toBe(true)
    fixture.listedPrs = [{ ...pr, status: 'closed' }]
    for (let pass = 0; pass < 3; pass++) {
      await modules.behaviors.runEnabledBehaviorsOnce()
      notices.retireClearedBehaviorAlerts()
      expect(modules.database.listBehaviorDeadLetters()).toEqual([])
      expect(modules.behaviors.getBehaviorsRuntimeHealth().deadLetters).toEqual([])
      expect(notices.noticesState().notices.filter((notice) => notice.kind === 'behavior_held')).toEqual([])
      expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).toEqual(before)
    }
    expect(modules.database.db.prepare('SELECT error, retired_at, resolution FROM behavior_dead_letters WHERE id = ?')
      .get(incident.id)).toMatchObject({ error: incident.error, retired_at: expect.any(String), resolution: 'superseded' })
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(mocks.captureOutcome).not.toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, state: 'superseded',
    }))
  })

  it.each(['disabled', 'paused', 'model-unavailable', 'draining', 'v2', 'enabled'] as const)('retires only confirmed-closed issue and PR incidents outside launch admission (%s)', async (gate) => {
    arrangeCli()
    fixture.listedPrs = []
    const { database, behaviors } = await loadModules()
    database.setMeta('me', 'poise-user')
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
    database.setMeta('behavior_review_new_issues_repos', JSON.stringify([{ repo: pr.repo, since: new Date().toISOString() }]))
    const notices = await import('../server/alerts/notices')
    const { behaviorHeld } = await import('../server/alerts/producers')
    const implementation = mocks.runFile.getMockImplementation()!
    const rows = [
      { key: 'review-new-issues', behavior: 'issue_review', number: 101, status: 'closed', quarantine: 'unreadable' },
      { key: 'review-new-issues', behavior: 'issue_review', number: 102, status: 'closed', quarantine: null },
      { key: 'review-new-prs', behavior: 'pr_review', number: 103, status: 'merged', quarantine: 'invalid_result' },
      { key: 'approve-prs', behavior: 'pr_approve', number: 104, status: 'closed', quarantine: null },
      { key: 'review-new-issues', behavior: 'issue_review', number: 105, status: 'open', quarantine: null },
      { key: 'review-new-prs', behavior: 'pr_review', number: 106, status: 'open', quarantine: null },
      { key: 'review-new-issues', behavior: 'issue_review', number: 107, status: 'unknown', quarantine: null },
      { key: 'review-new-prs', behavior: 'pr_review', number: 108, status: 'unknown', quarantine: null },
    ] as const
    for (const row of rows) {
      const target = `${pr.repo}#${row.number}`
      const claimId = database.claimSeenOwned(row.key, target)!
      expect(database.markBehaviorLaunchIntentOwned({ key: row.key, target, claimId, launchBehavior: row.behavior,
        repo: pr.repo, pr: row.number, requestedAt: new Date().toISOString(), expectedHead: row.behavior === 'issue_review' ? '' : HEAD_SHA,
        actor: 'review-bot', source: `poise:${row.key}`, correlationId: claimId })).toBe(true)
      const claim = database.listBehaviorLaunchClaims(row.key).find((entry) => entry.target === target)!
      database.recordBehaviorDeadLetter(claim, 'original uncertain failure')
      if (row.quarantine) database.quarantineBehaviorLaunchOwned(row.key, target, claimId, row.quarantine, 'original uncertain failure', true)
      else database.setBehaviorLaunchErrorOwned(row.key, target, claimId, 'original uncertain failure')
      database.completeSeenOwned(row.key, target, claimId)
      behaviorHeld(row.key, target, false, 'original uncertain failure')
    }
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (gate === 'model-unavailable' && command === 'agent-interface' && args[0] === '--models') throw new Error('model catalog unavailable')
      if (command === 'github-datastore' && args[0] === 'view' && args.includes('--number')) {
        const number = Number(args[args.indexOf('--number') + 1])
        const row = rows.find((entry) => entry.number === number)
        const observed = !row || row.status === 'unknown' ? [] : [{ ...pr, number, status: row.status,
          created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/${args[1] === 'issue' ? 'issues' : 'pull'}/${number}` }]
        return { stdout: JSON.stringify(observed), stderr: '' }
      }
      return implementation(command, args, ...rest)
    })
    if (gate !== 'disabled') {
      for (const key of ['review-new-prs', 'approve-prs', 'review-new-issues'] as const) {
        database.setMeta(`behavior_${key.replaceAll('-', '_')}_enabled`, '1')
        if (gate === 'paused') await behaviors.setPaused(key, new Date(Date.now() + 60_000).toISOString(), 'person')
      }
    }
    if (gate === 'draining' || gate === 'v2') {
      const journal = (await import('../server/behavior-chain-journal')).behaviorChainJournal()
      journal.changeAdmission(0, 'draining')
      if (gate === 'v2') journal.changeAdmission(journal.cutover().sequence, 'v2', [])
    }
    const launches = database.db.prepare('SELECT * FROM behavior_seen ORDER BY key, target').all()
    const active = rows.filter((row) => row.status === 'open' || row.status === 'unknown').map((row) => `${pr.repo}#${row.number}`).sort()
    for (let pass = 0; pass < 2; pass++) {
      await behaviors.runEnabledBehaviorsOnce()
      notices.retireClearedBehaviorAlerts()
      expect(database.listBehaviorDeadLetters().map((row) => row.target).sort()).toEqual(active)
      expect(behaviors.getBehaviorsRuntimeHealth().deadLetters.map((row) => row.target).sort()).toEqual(active)
      expect(notices.noticesState().notices.filter((notice) => notice.kind === 'behavior_held')).toHaveLength(active.length)
      expect(database.db.prepare('SELECT * FROM behavior_seen ORDER BY key, target').all()).toEqual(launches)
    }
    const history = database.db.prepare('SELECT error, resolution, retired_at FROM behavior_dead_letters').all() as
      Array<{ error: string, resolution: string | null, retired_at: string | null }>
    expect(history).toHaveLength(rows.length)
    expect(history.every((row) => row.error === 'original uncertain failure')).toBe(true)
    expect(history.filter((row) => row.retired_at !== null)).toHaveLength(4)
    expect(mocks.spawnDetached).not.toHaveBeenCalled()
  })

  it('retires closed-issue meta-only failures without a dead letter', async () => {
    arrangeCli()
    fixture.listedPrs = []
    const { database, behaviors } = await loadModules()
    database.setMeta('me', 'poise-user')
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
    database.setMeta('behavior_review_new_issues_repos', JSON.stringify([{ repo: pr.repo, since: new Date().toISOString() }]))
    // Prelaunch :check/:sub-issues failures live only in meta, with no dead
    // letter to enumerate. A closed issue must clear them; open, unknown and
    // scan targets must stay.
    const closedCheck = `${pr.repo}#201:check`
    const closedSub = `${pr.repo}#201:sub-issues`
    const openCheck = `${pr.repo}#202:check`
    const unknownCheck = `${pr.repo}#203:check`
    const scan = `${pr.repo}:scan`
    for (const target of [closedCheck, closedSub, openCheck, unknownCheck, scan]) {
      database.setMeta(`behavior_review_new_issues_failure:${target}`, JSON.stringify({
        kind: 'operation', consecutiveFailures: 1, lastFailureAtMs: Date.now(),
        nextRetryAtMs: Date.now() + 3_600_000, error: 'old eligibility error',
      }))
    }
    const implementation = mocks.runFile.getMockImplementation()!
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (command === 'github-datastore' && args[0] === 'view' && args.includes('--number')) {
        if (args[1] !== 'issue') return { stdout: JSON.stringify([]), stderr: '' }
        const number = Number(args[args.indexOf('--number') + 1])
        if (number === 201) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'closed',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/issues/201` }]), stderr: '' }
        }
        if (number === 202) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'open',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/issues/202` }]), stderr: '' }
        }
        return { stdout: JSON.stringify([]), stderr: '' }
      }
      return implementation(command, args, ...rest)
    })
    for (let pass = 0; pass < 2; pass++) {
      await behaviors.runEnabledBehaviorsOnce()
      expect(database.getMeta(`behavior_review_new_issues_failure:${closedCheck}`)).toBe('')
      expect(database.getMeta(`behavior_review_new_issues_failure:${closedSub}`)).toBe('')
      expect(database.getMeta(`behavior_review_new_issues_failure:${openCheck}`)).not.toBe('')
      expect(database.getMeta(`behavior_review_new_issues_failure:${unknownCheck}`)).not.toBe('')
      expect(database.getMeta(`behavior_review_new_issues_failure:${scan}`)).not.toBe('')
      expect(database.listBehaviorDeadLetters()).toEqual([])
      expect(mocks.spawnDetached).not.toHaveBeenCalled()
    }
  })

  it('retires closed-PR meta-only failures without a dead letter', async () => {
    arrangeCli()
    fixture.listedPrs = []
    const { database, behaviors } = await loadModules()
    database.setMeta('me', 'poise-user')
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
    // Prelaunch PR :check failures live only in meta, with no dead letter
    // to enumerate. A closed PR must clear them; open and unknown targets
    // must stay, even though no PR listing runs while disabled.
    const closedReviewCheck = `${pr.repo}#301:check`
    const closedApproveCheck = `${pr.repo}#302:check`
    const openReviewCheck = `${pr.repo}#303:check`
    const unknownApproveCheck = `${pr.repo}#304:check`
    for (const [key, target] of [
      ['review-new-prs', closedReviewCheck],
      ['approve-prs', closedApproveCheck],
      ['review-new-prs', openReviewCheck],
      ['approve-prs', unknownApproveCheck],
    ] as const) {
      database.setMeta(`behavior_${key.replaceAll('-', '_')}_failure:${target}`, JSON.stringify({
        kind: 'operation', consecutiveFailures: 1, lastFailureAtMs: Date.now(),
        nextRetryAtMs: Date.now() + 3_600_000, error: 'old eligibility error',
      }))
    }
    const implementation = mocks.runFile.getMockImplementation()!
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (command === 'github-datastore' && args[0] === 'view' && args.includes('--number')) {
        if (args[1] !== 'pr') return { stdout: JSON.stringify([]), stderr: '' }
        const number = Number(args[args.indexOf('--number') + 1])
        if (number === 301 || number === 302) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'closed',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/pull/${number}` }]), stderr: '' }
        }
        if (number === 303) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'open',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/pull/303` }]), stderr: '' }
        }
        return { stdout: JSON.stringify([]), stderr: '' }
      }
      return implementation(command, args, ...rest)
    })
    for (let pass = 0; pass < 2; pass++) {
      await behaviors.runEnabledBehaviorsOnce()
      expect(database.getMeta(`behavior_review_new_prs_failure:${closedReviewCheck}`)).toBe('')
      expect(database.getMeta(`behavior_approve_prs_failure:${closedApproveCheck}`)).toBe('')
      expect(database.getMeta(`behavior_review_new_prs_failure:${openReviewCheck}`)).not.toBe('')
      expect(database.getMeta(`behavior_approve_prs_failure:${unknownApproveCheck}`)).not.toBe('')
      expect(database.listBehaviorDeadLetters()).toEqual([])
      expect(mocks.spawnDetached).not.toHaveBeenCalled()
    }
  })

  it('retains unknown PR meta-only failures when an enabled scan lists open PRs', async () => {
    arrangeCli()
    fixture.listedPrs = [{ ...pr, number: 303, status: 'open',
      url: `https://github.com/${pr.repo}/pull/303`, created_at: '2026-07-15T10:00:00Z' }]
    const { database, behaviors } = await loadModules()
    database.setMeta('me', 'poise-user')
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
    database.setMeta('behavior_review_new_prs_enabled', '1')
    const closedCheck = `${pr.repo}#301:check`
    const openCheck = `${pr.repo}#303:check`
    const unknownCheck = `${pr.repo}#304:check`
    for (const target of [closedCheck, openCheck, unknownCheck]) {
      database.setMeta(`behavior_review_new_prs_failure:${target}`, JSON.stringify({
        kind: 'operation', consecutiveFailures: 1, lastFailureAtMs: Date.now(),
        nextRetryAtMs: Date.now() + 3_600_000, error: 'old eligibility error',
      }))
    }
    const implementation = mocks.runFile.getMockImplementation()!
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (command === 'github-datastore' && args[0] === 'view' && args.includes('--number')) {
        if (args[1] !== 'pr') return { stdout: JSON.stringify([]), stderr: '' }
        const number = Number(args[args.indexOf('--number') + 1])
        if (number === 301) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'closed',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/pull/301` }]), stderr: '' }
        }
        if (number === 303) {
          return { stdout: JSON.stringify([{ ...pr, number, status: 'open',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/pull/303` }]), stderr: '' }
        }
        return { stdout: JSON.stringify([]), stderr: '' }
      }
      return implementation(command, args, ...rest)
    })
    await behaviors.runEnabledBehaviorsOnce()
    expect(database.getMeta(`behavior_review_new_prs_failure:${closedCheck}`)).toBe('')
    expect(database.getMeta(`behavior_review_new_prs_failure:${openCheck}`)).not.toBe('')
    expect(database.getMeta(`behavior_review_new_prs_failure:${unknownCheck}`)).not.toBe('')
    expect(database.listBehaviorDeadLetters()).toEqual([])
  })

  it('does not recreate a retired closed-target incident when its unreadable launch later reports a failure', async () => {
    const launched = await launchReviewBeforeCrash()
    const target = launched.target
    const implementation = mocks.runFile.getMockImplementation()!
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (command === 'agent-interface' && args[0] === '--logs') throw new Error('agent log unavailable')
      return implementation(command, args, ...rest)
    })
    await resetLogCache()
    let modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)
    fixture.listedPrs = [{ ...pr, status: 'closed' }]
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    // The failed run starts after the launch it reports for.
    const startedAt = new Date(Date.parse(launched.requestedAt) + 1_000).toISOString()
    failed.started_at = startedAt
    failed.started_at_precise = startedAt
    fixture.agentLogs = [failed]
    await resetLogCache()
    mocks.runFile.mockImplementation(implementation)
    modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', target)).not.toBeNull()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
  })

  it('retires closed targets concurrently so one slow read does not stall the tick', async () => {
    arrangeCli()
    fixture.listedPrs = []
    const { database, behaviors } = await loadModules()
    database.setMeta('me', 'poise-user')
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
    for (const number of [301, 302]) {
      const target = `${pr.repo}#${number}`
      const claimId = database.claimSeenOwned('review-new-prs', target)!
      expect(database.markBehaviorLaunchIntentOwned({ key: 'review-new-prs', target, claimId,
        launchBehavior: 'pr_review', repo: pr.repo, pr: number, requestedAt: new Date().toISOString(),
        expectedHead: HEAD_SHA, actor: 'review-bot', source: 'poise:review-new-prs', correlationId: claimId })).toBe(true)
      const claim = database.listBehaviorLaunchClaims('review-new-prs').find((entry) => entry.target === target)!
      database.recordBehaviorDeadLetter(claim, 'original uncertain failure')
      database.setBehaviorLaunchErrorOwned('review-new-prs', target, claimId, 'original uncertain failure')
      database.completeSeenOwned('review-new-prs', target, claimId)
    }
    let active = 0
    let peak = 0
    const implementation = mocks.runFile.getMockImplementation()!
    mocks.runFile.mockImplementation(async (command: string, args: string[], ...rest: unknown[]) => {
      if (command === 'github-datastore' && args[0] === 'view' && args.includes('--number')) {
        active += 1
        peak = Math.max(peak, active)
        try {
          await new Promise((resolve) => setTimeout(resolve, 60))
          const number = Number(args[args.indexOf('--number') + 1])
          return { stdout: JSON.stringify([{ ...pr, number, status: 'closed',
            created_at: '2026-07-15T10:00:00Z', url: `https://github.com/${pr.repo}/pull/${number}` }]), stderr: '' }
        } finally {
          active -= 1
        }
      }
      return implementation(command, args, ...rest)
    })
    await behaviors.runEnabledBehaviorsOnce()
    expect(peak).toBeGreaterThan(1)
    expect(database.listBehaviorDeadLetters()).toEqual([])
  })

  it('retains an ambiguous post-watermark review registration without retrying', async () => {
    const launched = await launchReviewBeforeCrash()
    const after = Date.parse(launched.requestedAt) + 1_000
    fixture.agentLogs = [
      agentLog({
        id: 'd'.repeat(32),
        started_at: new Date(after).toISOString(),
        started_at_precise: new Date(after).toISOString(),
        status: 'running',
        correlation_id: launched.correlationId,
      }),
      agentLog({
        id: 'e'.repeat(32),
        started_at: new Date(after + 1_000).toISOString(),
        started_at_precise: new Date(after + 1_000).toISOString(),
        completed_at: new Date(after + 2_000).toISOString(),
        status: 'completed',
        action: 'reviewed_clean',
        outcome: 'clean',
        head_sha: launched.expectedHead,
        response: 'clean',
        correlation_id: launched.correlationId,
      }),
    ]
    await resetLogCache()

    const { database: db, behaviors: runtime } = await restartModules()
    await runtime.runEnabledBehaviorsOnce()

    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    expect(db.db.prepare(`
      SELECT claim_id, lease_until, launch_call_id, launch_error
      FROM behavior_seen WHERE key = 'review-new-prs' AND target = ?
    `).get(launched.target)).toMatchObject({
      claim_id: '',
      lease_until: null,
      launch_call_id: null,
      launch_error: expect.stringContaining('ambiguous correlation id matched'),
    })
  })
})

describe('publication attribution settlement', () => {

  // Held incidents recheck at most hourly; backdate the hold so the next
  // tick revisits the row instead of skipping it.
  function recheckDue(database: { db: { prepare(sql: string): { run(...params: string[]): unknown } } }): void {
    database.db.prepare('UPDATE behavior_dead_letters SET resolved_at = ? WHERE retired_at IS NULL')
      .run(new Date(Date.now() - 61 * 60_000).toISOString())
  }

  it.each(['review-new-prs', 'approve-prs'] as const)('settles a failed %s firing as obsolete once its pull request closes', async (behavior) => {
    const launched = behavior === 'review-new-prs' ? await launchReviewBeforeCrash() : await launchApprovalBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      behavior: behavior === 'review-new-prs' ? 'pr_review' : 'pr_approve',
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch(behavior, launched.target)).not.toBeNull()
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)
    const firings = () => mocks.captureOutcome.mock.calls.map(([outcome]) => outcome)
      .filter((outcome) => outcome.nativeId === launched.correlationId)
    expect(firings().some((firing) => firing.state === 'superseded')).toBe(false)

    // The pull request merges: the incident retires as superseded and the
    // firing follows, without inventing a completion.
    fixture.listedPrs = [{ ...pr, status: 'merged' }]
    recheckDue(modules.database)
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
    const incident = modules.database.db.prepare(
      'SELECT error, resolution, resolution_evidence, retired_at FROM behavior_dead_letters',
    ).get() as { error: string, resolution: string, resolution_evidence: string, retired_at: string }
    expect(incident.error).toBe(failed.error)
    expect(incident.resolution).toBe('superseded')
    expect(JSON.parse(incident.resolution_evidence)).toMatchObject({ open: false })
    expect(incident.retired_at).toEqual(expect.any(String))
    expect(firings().at(-1)).toMatchObject({ state: 'superseded', activity: 'unknown', outcome: 'review_target_closed',
      callId: failed.id, completedAt: expect.any(String), refs: [{ kind: 'caller', identity: failed.id }] })
    const launch = modules.database.db.prepare(
      'SELECT launch_error, launch_outcome, launch_action, launch_completed_at, launch_head_sha FROM behavior_seen WHERE key = ? AND target = ?',
    ).get(behavior, launched.target) as Record<string, string | null>
    expect(launch).toEqual({ launch_error: failed.error, launch_outcome: null, launch_action: null,
      launch_completed_at: null, launch_head_sha: null })
    expect(modules.database.latestApprovalBasisLaunch(pr.repo, pr.number)).toBeNull()

    // A settled firing reopens nothing: the next tick launches nothing new.
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
  })

  it('settles a firing whose closed-PR incident already retired before the upgrade', async () => {
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)

    // The incident retired before this settlement existed: reconcile
    // excludes it, so only the historical path can settle the firing.
    const retiredAt = new Date().toISOString()
    modules.database.db.prepare(`
      UPDATE behavior_dead_letters
      SET retired_at = ?, resolution = 'superseded',
        resolution_evidence = ?, resolved_at = ?
      WHERE retired_at IS NULL
    `).run(retiredAt, JSON.stringify({ open: false, checkedAt: retiredAt }), retiredAt)
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
    mocks.captureOutcome.mockClear()

    fixture.listedPrs = []
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.captureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, callId: failed.id, state: 'superseded',
      activity: 'unknown', outcome: 'review_target_closed', completedAt: retiredAt,
    }))
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
  })

  it('settles a historical firing past a large retired backlog without starvation', async () => {
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch('review-new-prs', launched.target)).not.toBeNull()

    // Retire the incident, then bury it under more retired rows than any
    // fixed LIMIT would read: the failed-launch-driven scan still settles it.
    const retiredAt = new Date().toISOString()
    const evidence = JSON.stringify({ open: false, checkedAt: retiredAt })
    modules.database.db.prepare(`
      UPDATE behavior_dead_letters
      SET retired_at = ?, resolution = 'superseded',
        resolution_evidence = ?, resolved_at = ?
      WHERE retired_at IS NULL
    `).run(retiredAt, evidence, retiredAt)
    const insert = modules.database.db.prepare(`
      INSERT INTO behavior_dead_letters(
        id, behavior, target, repo, pr, actor, source, correlation_id,
        call_id, error, created_at, retired_at, resolution,
        resolution_evidence, resolved_at
      ) VALUES(?, 'review-new-prs', ?, ?, ?, 'review-bot', 'poise:review-new-prs',
        ?, ?, 'old failure', ?, ?, 'superseded', ?, ?)
    `)
    modules.database.db.transaction(() => {
      for (let index = 0; index < 250; index++) {
        const target = `Vaquum/old-repo#${1000 + index}`
        insert.run(`backlog-${index}`, target, 'Vaquum/old-repo', 1000 + index,
          `backlog-native-${index}`, 'a'.repeat(32), retiredAt, retiredAt, evidence, retiredAt)
      }
    })()
    mocks.captureOutcome.mockClear()

    fixture.listedPrs = []
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(mocks.captureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, callId: failed.id, state: 'superseded',
      activity: 'unknown', outcome: 'review_target_closed', completedAt: retiredAt,
    }))
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
  })

  it.each(['review-new-prs', 'approve-prs'] as const)('recovers a held %s launch into its launch record when the same call completes', async (behavior) => {
    const launched = behavior === 'review-new-prs' ? await launchReviewBeforeCrash() : await launchApprovalBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      behavior: behavior === 'review-new-prs' ? 'pr_review' : 'pr_approve',
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch(behavior, launched.target)).not.toBeNull()

    // The same call's completion becomes readable: the launch record, the
    // firing, the incident and the approval basis settle together.
    const completedAt = new Date().toISOString()
    const action = behavior === 'review-new-prs' ? 'reviewed_clean' : 'approved'
    const outcome = behavior === 'review-new-prs' ? 'clean' : 'approved'
    fixture.agentLogs = [{ ...failed, status: 'completed', action, outcome,
      head_sha: launched.expectedHead, completed_at: completedAt, review_id: 91 }]
    await resetLogCache()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.getFailedBehaviorLaunch(behavior, launched.target)).toBeNull()
    expect(modules.database.latestApprovalBasisLaunch(pr.repo, pr.number)).toEqual({
      callId: failed.id, completedAt, headSha: launched.expectedHead,
    })
    const incident = modules.database.db.prepare(
      'SELECT error, retired_at FROM behavior_dead_letters',
    ).get() as { error: string, retired_at: string }
    expect(incident.error).toBe(failed.error)
    expect(incident.retired_at).toEqual(expect.any(String))
    const firings = mocks.captureOutcome.mock.calls.map(([firing]) => firing)
      .filter((firing) => firing.nativeId === launched.correlationId)
    expect(firings.at(-1)).toMatchObject({ state: 'completed', activity: 'settled', outcome, callId: failed.id })
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
  })

  it('closing a panel settles only the failed firing and never invents worker termination', async () => {
    arrangeCli(false)
    mocks.spawnDetached.mockResolvedValue(undefined)
    const { database: db, behaviors: runtime } = await loadModules()
    runtime.startBehaviorsRuntime()
    db.setMeta('me', 'poise-user')
    db.setMeta('behavior_review_new_prs_keyver', '3')
    db.setMeta('behavior_review_new_prs_enabled', '1')
    db.setMeta('behavior_review_new_prs_reviewers', '2')
    db.recordSeen('review-new-prs', '__snapshot_v3__')
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
    const targets = db.listBehaviorLaunchClaims('review-new-prs').map((claim) => claim.target).sort()
    expect(targets).toEqual([`${pr.repo}#${pr.number}`, `${pr.repo}#${pr.number}:secondary`].sort())
    const claims = db.listBehaviorLaunchClaims('review-new-prs')
    const primary = claims.find((claim) => claim.target === `${pr.repo}#${pr.number}`)!
    const secondary = claims.find((claim) => claim.target !== primary.target)!
    fixture.agentLogs = [
      agentLog({ id: 'f'.repeat(32), started_at: primary.launchRequestedAt, started_at_precise: primary.launchRequestedAt,
        status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
        error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
        expected_head: primary.launchExpectedHead, actor: primary.launchActor, source: primary.launchSource,
        correlation_id: primary.launchCorrelationId }),
      agentLog({ id: 'e'.repeat(32), started_at: secondary.launchRequestedAt, started_at_precise: secondary.launchRequestedAt,
        status: 'running', model: 'gpt-6-astra-ultra',
        expected_head: secondary.launchExpectedHead, actor: secondary.launchActor, source: secondary.launchSource,
        correlation_id: secondary.launchCorrelationId }),
    ]
    await resetLogCache()
    await runtime.runEnabledBehaviorsOnce()
    expect(db.getFailedBehaviorLaunch('review-new-prs', primary.target)).not.toBeNull()
    expect(db.listBehaviorDeadLetters()).toHaveLength(1)
    expect(db.listBehaviorLaunchClaims('review-new-prs').map((claim) => claim.target)).toEqual([secondary.target])

    // Closing settles the failed firing; the running sibling stays active.
    fixture.listedPrs = [{ ...pr, status: 'closed' }]
    recheckDue(db)
    await runtime.runEnabledBehaviorsOnce()
    const firings = (nativeId: string) => mocks.captureOutcome.mock.calls.map(([outcome]) => outcome)
      .filter((outcome) => outcome.nativeId === nativeId)
    expect(firings(primary.launchCorrelationId).at(-1)).toMatchObject({ state: 'superseded', activity: 'unknown' })
    expect(firings(secondary.launchCorrelationId).some((firing) => firing.state === 'superseded')).toBe(false)
    expect(db.listBehaviorLaunchClaims('review-new-prs').map((claim) => claim.target)).toEqual([secondary.target])

    // Reopening invents no termination and leaks nothing into later admission.
    fixture.listedPrs = [pr]
    await runtime.runEnabledBehaviorsOnce()
    expect(db.listBehaviorLaunchClaims('review-new-prs').map((claim) => claim.target)).toEqual([secondary.target])
    arrangeCli(false, false, { headSha: NEXT_HEAD_SHA })
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(3)
    expect(mocks.spawnDetached.mock.calls[2][1]).toEqual(expect.arrayContaining(['--expected-head', NEXT_HEAD_SHA]))
  })

  it('keeps reviewing other pull requests while one firing settles as obsolete', async () => {
    const launched = await launchReviewBeforeCrash()
    const failed = agentLog({ id: 'f'.repeat(32), started_at: launched.requestedAt, started_at_precise: launched.requestedAt,
      status: 'failed', error: 'review behavior produced duplicate GitHub reviews; needs attention',
      error_code: 'review_contract_violation', review_policy: 'bounded-v1', model: 'opus-5-xhigh',
      expected_head: launched.expectedHead, actor: launched.actor, source: launched.source, correlation_id: launched.correlationId })
    fixture.agentLogs = [failed]
    await resetLogCache()
    const modules = await restartModules()
    modules.behaviors.startBehaviorsRuntime()
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toHaveLength(1)
    fixture.listedPrs = [{ ...pr, status: 'closed' }, { ...pr, number: 18, url: 'https://github.com/Vaquum/poise-test/pull/18' }]
    recheckDue(modules.database)
    await modules.behaviors.runEnabledBehaviorsOnce()
    expect(modules.database.listBehaviorDeadLetters()).toEqual([])
    expect(mocks.captureOutcome).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: launched.correlationId, state: 'superseded', activity: 'unknown',
    }))
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
    expect(mocks.spawnDetached.mock.calls[1][1]).toContain('#18')
  })
})
