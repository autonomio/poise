import { diagnosticConfig } from './diagnostics/config.js'
import { environmentSecrets, redact } from './diagnostics/contract.js'
import { DiagnosticRuntime } from './diagnostics/runtime.js'
import { EnvironmentCollectors, gatewayDiagnostic, diagnosticOwner, dockerLines } from './diagnostics/collectors.js'
import { HostJournal } from './diagnostics/host.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, loadConfig, type Config } from './config.js'
import { DiskWatch } from './disk.js'
import { DockerClient } from './docker.js'
import { createGateway } from './gateway.js'
import { GitHubClient } from './github.js'
import { loadOrCreateKeys } from './keys.js'
import { createLogger, errorMessage } from './log.js'
import { Orchestrator, workspaceUpstream } from './orchestrator.js'
import { startPurgeLoop, Store } from './store.js'
import { prepareWorkspaceDns } from './workspace-dns.js'

const PURGE_INTERVAL_MS = 10 * 60_000

let diagnostics: DiagnosticRuntime | null = null
const log = createLogger((line) => process.stdout.write(`${line}\n`), (level, event, fields) => diagnostics?.emit(gatewayDiagnostic(level, event, fields)))

let config: Config
try {
  config = loadConfig(process.env)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}

if (config.insecureHttp) {
  log.warn('config.insecure_http', {
    domain: config.domain,
    message: 'POISE_INSECURE_HTTP=1: session cookies travel over plain http without Secure. Use this only for local and CI end-to-end runs.',
  })
}

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
diagnostics = new DiagnosticRuntime({ path: join(config.dataDir, 'logging.db'), ...diagnosticConfig(process.env) })
diagnostics.start()
diagnostics.observe('gateway', 'gateway', null)
process.once('uncaughtException', (error) => {
  diagnostics?.emit({ source: 'gateway', operation: 'process.uncaught', level: 'critical', message: error.message, stack: error.stack })
  diagnostics?.stop()
  process.stderr.write(redact(error.stack ?? error.message, environmentSecrets()) + '\n')
  process.exit(1)
})
const hostJournal = new HostJournal(diagnostics)
hostJournal.start()
const now = () => Date.now()
const store = new Store(join(config.dataDir, 'gateway.db'), now)
store.syncEnvAllowList(config.allowedUsers)
const keys = loadOrCreateKeys(config.dataDir, log)
const docker = new DockerClient(config.dockerSocket, (evidence) => {
  const workspace = diagnosticOwner(evidence.labels)
  if (!workspace || evidence.labels['poise.task'] !== 'install-release') return
  let stderr: string | null = null; let stderrError = evidence.stderrError
  try { if (evidence.stderr) stderr = dockerLines(evidence.stderr).map((line) => line.slice(line.indexOf(' ') + 1)).join('\n') }
  catch (error) { stderrError = error instanceof Error ? error.message : String(error) }
  diagnostics?.emit({ id: 'release-task:' + evidence.id, time: null, source: 'docker', component: 'release-installer', operation: 'release.install', phase: 'installer_exit',
    level: evidence.exitCode < 0 ? 'warning' : 'error', workspace, visibility: 'infrastructure', container: evidence.container,
    message: `Release installation task exited ${evidence.exitCode}`, exitCode: evidence.exitCode < 0 ? null : evidence.exitCode,
    stderr: stderr?.replace(/\/(?:home|Users)\/[^\s:'"<>]+/g, '[private path]') ?? null, context: { taskName: evidence.name, stderrEvidenceUnavailable: stderrError, observedAt: new Date().toISOString() },
    resources: { configuredMemoryLimitBytes: evidence.limits.memoryBytes, configuredNanoCpus: evidence.limits.nanoCpus, configuredPidsLimit: evidence.limits.pids,
      measurement: 'configuration submitted to Docker; incident usage not observed' } })
})
const workspaceResolvConf = await prepareWorkspaceDns(config, docker)
if (workspaceResolvConf) log.info('workspace.dns.configured', { resolvers: config.workspaceDns, file: workspaceResolvConf })
const orchestrator = new Orchestrator({ config, docker, store, keys, log, now, upstream: workspaceUpstream, workspaceResolvConf })
const disk = new DiskWatch({ config, docker, log, now })
const gateway = createGateway({
  config,
  store,
  keys,
  github: new GitHubClient(config),
  docker,
  orchestrator,
  disk,
  log,
  now,
  upstream: workspaceUpstream,
})

const collectors = new EnvironmentCollectors(diagnostics, docker, gateway.context)

// Before anything can call a workspace: this container may be new, and on none of their networks.
await orchestrator.joinWorkspaceNetworks()

gateway.server.listen(config.port, () => {
  log.info('gateway.listening', { port: config.port, domain: config.domain, image: config.runtimeImage })
})
collectors.start()
const stopUpgrades = orchestrator.startUpgradeLoop()
const stopDiskWatch = disk.start()
const stopPurging = startPurgeLoop(store, log, PURGE_INTERVAL_MS)

function shutdown(signal: string): void {
  log.info('gateway.stopping', { signal })
  stopUpgrades()
  stopDiskWatch()
  stopPurging()
  hostJournal.stop()
  Promise.all([gateway.close(), collectors.stop()]).then(
    () => {
      diagnostics?.stop()
      store.close()
      process.exit(0)
    },
    (error: unknown) => {
      log.error('gateway.stop.failed', { error: errorMessage(error) })
      process.exit(1)
    },
  )
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
