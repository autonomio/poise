import { classifyBehaviorDiagnostic, terminalProviderMessage } from '../src/behavior-failure-cause'
import type { fetchAgentLogSnapshot } from './agent'
import type { BehaviorDeadLetter } from './db'

// Retained audit incidents outlive active failure summaries. Classify their
// exact validated Caller evidence independently; never alter retry ownership.
export function behaviorIncidentDiagnostics(incidents: BehaviorDeadLetter[], snapshot: Awaited<ReturnType<typeof fetchAgentLogSnapshot>> | null) {
  return incidents.map((incident) => {
    const matches = snapshot?.entries.filter((row) => row.id === incident.callId) ?? []
    const call = matches.length === 1 ? matches[0] : undefined
    const expectedBehavior = incident.behavior === 'review-new-prs' ? 'pr_review'
      : incident.behavior === 'approve-prs' ? 'pr_approve' : null
    const exact = call && expectedBehavior && call.behavior === expectedBehavior
      && call.repo === incident.repo && String(call.pr_id) === String(incident.pr)
      && !!incident.actor && call.actor?.toLowerCase() === incident.actor.toLowerCase()
      && incident.source === `poise:${incident.behavior}` && call.source === incident.source
      && !!incident.correlationId && call.correlation_id === incident.correlationId
      && !snapshot?.quarantined.some((row) => row.id === incident.callId || row.correlationId === incident.correlationId)
    const noAction = exact && call.action === 'not_started' && call.outcome === 'preflight_failed'
      && /^[a-f0-9]{32}$/.test(incident.callId ?? '') && /^[a-f0-9]{40}$/.test(call.expected_head ?? '')
      && ['failed', 'error', 'cancelled', 'interrupted'].includes(call.status.toLowerCase())
      && !call.head_sha && call.review_id == null && call.receipts == null && !call.review_comments
    const error = exact ? behaviorErrorMessage(call.error || incident.error) : behaviorErrorMessage(incident.error)
    return { ...incident, error, diagnostic: classifyBehaviorDiagnostic(error, {
      held: !noAction, errorCode: exact ? call.error_code : null,
    }) }
  })
}

// Keep bounded, redacted CLI evidence in health instead of an opaque exit code.
export function behaviorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  const detail = typeof stderr === 'string' ? stderr.trim().split('\n').at(-1)?.trim() : ''
  let result = terminalProviderMessage(typeof stderr === 'string' ? stderr : '')
    ?? terminalProviderMessage(message) ?? (detail ? `${message}: ${detail}` : message)
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(key) && value && value.length >= 8) {
      result = result.split(value).join('[redacted]')
    }
  }
  return result
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/]+@/g, '$1[redacted]@')
    .replace(/\b(Bearer|token)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 300)
}
