import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalize } from '../src/diagnostics/contract.js'
import { dockerLifecycle, dockerLines, gatewayDiagnostic } from '../src/diagnostics/collectors.js'
import { DiagnosticStore } from '../src/diagnostics/store.js'
import { createLogger } from '../src/log.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const access = { workspace: 'alice', operator: false }
const input = { id: 'source-test', level: 'error', source: 'poise', operation: 'read', workspace: 'alice', message: 'cause' }

describe('owned source boundaries', () => {
  it('decodes split Docker frame payloads without turning a stack into occurrences', () => {
    const line = '2026-10-18T10:00:00Z ' + JSON.stringify({ poiseDiagnostic: { message: 'cause\nstack one\nstack two' } }) + '\n'
    const payload = Buffer.from(line)
    const frame = (part: Buffer) => { const header = Buffer.alloc(8); header[0] = 2; header.writeUInt32BE(part.length, 4); return Buffer.concat([header, part]) }
    expect(dockerLines(Buffer.concat([frame(payload.subarray(0, 20)), frame(payload.subarray(20))]))).toEqual([line.trimEnd()])
    expect(() => dockerLines(Buffer.from('incomplete'))).toThrow('frame')
    expect(() => dockerLines(frame(Buffer.from('x'.repeat(64 * 1024 + 1))))).toThrow('bound')
  })

  it('uses native OOM/exit/health meaning and excludes unrelated business containers', () => {
    const base = { Type: 'container', time: 1792317600, Actor: { ID: 'container-1', Attributes: { 'poise.managed': 'true', 'poise.workspace': 'alice' } } }
    expect(dockerLifecycle({ ...base, Action: 'oom' })).toMatchObject({ level: 'critical', workspace: 'alice', visibility: 'infrastructure' })
    expect(dockerLifecycle({ ...base, Action: 'die' })).toBeNull()
    expect(dockerLifecycle({ ...base, Action: 'die', Actor: { ...base.Actor, Attributes: { ...base.Actor.Attributes, exitCode: '128' } } })).toMatchObject({ level: 'error', exitCode: 128 })
    expect(dockerLifecycle({ ...base, Action: 'health_status: unhealthy' })).toMatchObject({ level: 'warning' })
    expect(dockerLifecycle({ ...base, Action: 'oom', Actor: { ID: 'other', Attributes: { 'com.docker.compose.project': 'business' } } })).toBeNull()
  })

  it('redacts gateway output before Docker persistence and projects only technical shared facts', () => {
    const lines: string[] = []; const records: unknown[] = []
    const logger = createLogger((line) => lines.push(line), (level, operation, fields) => records.push(normalize(gatewayDiagnostic(level, operation, fields))))
    logger.error('proxy.failed', { handle: 'bob', error: 'ECONNRESET in /home/poise/private/repository', method: 'GET',
      route: '/api/chat', Authorization: 'opaque-secret', prompt: 'private-prompt', repository: 'private/repo', callId: 'private-call' })
    const output = JSON.stringify({ lines, records })
    for (const value of ['opaque-secret', 'private-prompt']) expect(output).not.toContain(value)
    expect(JSON.stringify(records)).not.toContain('private/repo'); expect(JSON.stringify(records)).not.toContain('private-call')
    expect(records[0]).toMatchObject({ workspace: 'bob', visibility: 'infrastructure', context: { method: 'GET', route: '/api/chat' } })
  })

  it('commits delivery checkpoints atomically, preserves stable replay and scopes delivery cursors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poise-delivery-')); directories.push(directory)
    const path = join(directory, 'history.db'); const store = new DiagnosticStore(path)
    try {
      const event = normalize(input)!
      store.commitDelivery([event], 'workspace:alice', 'source-cursor')
      const first = store.delivery(access)
      expect(first.events.map((record) => record.id)).toEqual([event.id])
      expect(store.delivery(access, first.cursor).events).toHaveLength(0)
      expect(() => store.delivery({ workspace: 'bob', operator: false }, first.cursor)).toThrow('authorization')
      expect(() => store.commitDelivery([{ ...event, message: 'contradictory' }], 'workspace:alice', 'bad-cursor')).toThrow('Conflicting')
      expect(store.checkpoint('workspace:alice')).toBe('source-cursor')
    } finally { store.close() }
  })
})
