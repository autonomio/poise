import { diagnostic } from './logging'
import { releaseBackgroundPaused, trackReleaseBackground } from './release-background'
// The scheduled job and manual check share CLI updates, discovery and receipts.
import { dirname, join } from 'node:path'
import { HttpError } from './http'
import { agentInterfaceCwd, catalogReportPath, invalidateCatalog } from './models'
import { CLAUDE_SUBSCRIPTION_CLI, claudeSubscriptionEnvironment, runFile, scrubbedChildEnvironment } from './process'

let pending: Promise<Record<string, unknown>> | null = null
export function refreshModelCatalog(): Promise<Record<string, unknown>> {
  if (pending) return pending
  // A drain admits no new background work: CLI updates cut by the restart
  // that follows could leave a provider CLI half installed.
  if (releaseBackgroundPaused()) return Promise.reject(new HttpError(503, 'Poise is installing an update; the model check has not started.'))
  const finished = trackReleaseBackground()
  pending = (async () => {
    let stdout: string
    try { ({ stdout } = await runFile(process.execPath, [join(dirname(CLAUDE_SUBSCRIPTION_CLI), 'refresh-models.mjs'), '--json'], {
      cwd: agentInterfaceCwd(),
      env: { ...scrubbedChildEnvironment('agent-interface', claudeSubscriptionEnvironment()), POISE_MODEL_CATALOG_REPORT: catalogReportPath() },
      timeoutMs: 15 * 60_000, killSignal: 'SIGTERM',
    })) } catch (error) {
      // The script emits a durable structured failure even on a nonzero exit.
      // Return that diagnostic, not just the Node process's exit code.
      const output = (error as { stdout?: unknown }).stdout
      if (typeof output !== 'string' || !output.trim()) throw error
      stdout = output
    }
    let report: unknown
    try { report = JSON.parse(stdout) } catch { throw new Error('The model check returned an unreadable report') }
    if (!report || typeof report !== 'object' || !('families' in report) || !report.families || typeof report.families !== 'object' || Array.isArray(report.families)) throw new Error('The model check returned an invalid report')
    const updates = 'cli_updates' in report && report.cli_updates && typeof report.cli_updates === 'object' ? report.cli_updates as Record<string, Record<string, unknown>> : {}
    for (const [family, value] of Object.entries(report.families)) {
      if (value && typeof value === 'object' && 'status' in value && value.status !== 'ok') diagnostic({
        level: 'warning', operation: 'models.discovery', component: family,
        message: 'error' in value && typeof value.error === 'string' ? value.error : 'Model discovery did not return a healthy result',
        context: { family, status: value.status, reportPath: catalogReportPath(), configuredExecutable: process.env[family.toUpperCase() + '_CLI'] ?? null,
          resolvedExecutable: updates[family]?.path ?? null, launchExecutable: updates[family]?.launchPath ?? null, phase: 'catalog_discovery' },
      })
    }
    return report as Record<string, unknown>
  })().finally(() => { invalidateCatalog(); pending = null; finished() })
  return pending
}
