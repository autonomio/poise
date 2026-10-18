import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DockerClient } from '../src/docker.js'
import { dockerLines } from '../src/diagnostics/collectors.js'
import { normalize } from '../src/diagnostics/contract.js'
import { workspaceEnvelope } from '../src/diagnostics/sources.js'
import { DiagnosticStore } from '../src/diagnostics/store.js'

const enabled = process.env.POISE_GATEWAY_DOCKER_TESTS === '1'
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim()

describe.skipIf(!enabled)('durable diagnostics from real Docker sources', () => {
  it('retains multiline evidence after source deletion, replacement and central store restart', async () => {
    const name = 'poise-logging-proof-' + process.pid
    const directory = mkdtempSync(join(tmpdir(), 'poise-docker-history-'))
    const path = join(directory, 'history.db')
    const endpoint = process.env.DOCKER_HOST ?? JSON.parse(docker('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}')) as string
    if (!endpoint.startsWith('unix://')) throw new Error('Docker diagnostic proof requires the selected local Unix socket')
    const socket = endpoint.slice('unix://'.length)
    const client = new DockerClient(socket)
    let store = new DiagnosticStore(path)
    const ids: string[] = []
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const event = normalize({ id: 'attempt-' + attempt, source: 'poise', operation: 'review.fetch', level: 'error', workspace: 'logproof',
          message: 'Git fetch failed', stderr: 'fatal: exact cause\nstack one\nstack two' })!
        const code = `process.stderr.write(${JSON.stringify(JSON.stringify({ poiseDiagnostic: event }) + '\n')});setInterval(()=>{},1000)`
        const container = docker('run', '--detach', '--name', name, '--label', 'poise.managed=true', '--label', 'poise.workspace=logproof', 'node:22-bookworm-slim', 'node', '-e', code)
        for (let poll = 0; poll < 100; poll++) {
          const bytes = await client.diagnosticRead(`/containers/${container}/logs?stdout=1&stderr=1&timestamps=1`)
          const lines = dockerLines(bytes)
          if (lines.length) {
            const envelope = JSON.parse(lines[0].slice(lines[0].indexOf(' ') + 1)) as { poiseDiagnostic: unknown }
            store.append([workspaceEnvelope(envelope.poiseDiagnostic, 'logproof', Date.now(), [])]); break
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        ids.push(event.id)
        docker('rm', '--force', name)
        expect(await client.inspectContainer(name)).toBeNull()
        expect(store.lookup({ workspace: 'logproof', operator: false }, event.id)).toMatchObject({ status: 'found', event: { stderr: event.stderr } })
        store.close(); store = new DiagnosticStore(path)
      }
      const page = store.query({ workspace: 'logproof', operator: false })
      expect(page.total).toBe(2); expect(page.events.map((event) => event.id).sort()).toEqual(ids.sort())
      expect(store.query({ workspace: 'other', operator: true }).total).toBe(0)
    } finally { store.close(); spawnSync('docker', ['rm', '--force', name]); rmSync(directory, { recursive: true, force: true }) }
  }, 30_000)
})
