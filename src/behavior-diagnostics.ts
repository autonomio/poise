import type { BehaviorDiagnostics } from './behaviors'
import { classifyBehaviorDiagnostic, failureCause, type DiagnosticClassification } from './behavior-failure-cause'

export interface BehaviorDiagnosticGroup extends DiagnosticClassification {
  scope: string
  message: string
  details: string[]
}

function targetRef(target: string): string {
  return target.match(/^[^#]+#\d+/)?.[0] ?? target
}

export function behaviorDiagnosticGroups(diagnostics: BehaviorDiagnostics): BehaviorDiagnosticGroup[] {
  const groups = new Map<string, BehaviorDiagnosticGroup>()
  const add = (classification: DiagnosticClassification, scope: string, message: string, detail: string) => {
    const key = JSON.stringify([classification.severity, classification.code, scope, message])
    const existing = groups.get(key)
    if (existing) {
      if (!existing.details.includes(detail)) existing.details.push(detail)
    } else groups.set(key, { ...classification, scope, message, details: [detail] })
  }
  if (diagnostics.apiError) {
    const error = diagnostics.apiError
    add(error, 'Behaviors', `Status could not be refreshed (${error.message}).`, error.message)
  }
  for (const [scope, error] of [
    ['Agent log', diagnostics.agentLogsError], ['Datastore', diagnostics.datastore.error], ['Identity', diagnostics.identity.error],
  ]) {
    if (error) add(classifyBehaviorDiagnostic(error), scope!, failureCause(error), error)
  }
  const failureCauses = new Set<string>()
  for (const failure of diagnostics.failures) {
    const error = failure.error ?? 'Failure cause unavailable'
    const classification = failure.diagnostic ?? classifyBehaviorDiagnostic(error, { held: failure.kind === 'worker' })
    const ref = targetRef(failure.target ?? '')
    const scope = (classification.code === 'github_access' ? ref.split('#')[0] : ref)
      || `${failure.org ?? ''} ${failure.behavior}`.trim()
    const cause = failureCause(error)
    const message = classification.code === 'github_access'
      ? `GitHub target is unavailable to ${diagnostics.identity.actor || 'the reviewer'}; check repository access.`
      : classification.code === 'head_changed' ? 'PR changed during review preparation; the current head will be reconsidered.'
        : classification.code === 'held_result' ? `Review outcome needs verification before retry. ${cause}` : cause
    const detail = `${failure.org ? `${failure.org}: ` : ''}${failure.behavior}${failure.target ? ` ${failure.target}` : ''}: ${failure.consecutiveFailures} consecutive ${failure.kind} failure(s) — ${cause}${failure.nextRetryAt ? `; next check ${failure.nextRetryAt}` : ''}`
    add(classification, scope, message, detail)
    if (failure.callId) failureCauses.add(JSON.stringify([failure.behavior, failure.callId, classification.code, cause]))
  }
  for (const letter of diagnostics.deadLetters) {
    const ref = targetRef(letter.target)
    const cause = failureCause(letter.error)
    // A retryable no-action attempt can also have an audit incident. Its
    // classified failure already shows it; genuinely held incidents stay errors.
    const rawClassification = classifyBehaviorDiagnostic(letter.error)
    if (letter.callId && failureCauses.has(JSON.stringify([letter.behavior, letter.callId, rawClassification.code, cause]))) continue
    add(classifyBehaviorDiagnostic(letter.error, { held: true }), ref, `Review outcome needs verification before retry. ${cause}`,
      `${letter.behavior} ${letter.target}: ${cause} (${letter.attemptCount ?? 1} attempts)`)
  }
  if (groups.size === 0 && diagnostics.status === 'degraded') {
    add({ severity: 'error', code: 'runtime_unhealthy' }, 'Behaviors', 'Behavior runtime is degraded.', 'Runtime health check failed.')
  }
  return [...groups.values()]
}
