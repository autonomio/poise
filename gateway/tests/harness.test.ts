import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { startHarness, workspaceHost, type Harness } from './harness.js'

it('reserves the unavailable upstream until harness cleanup instead of releasing a reusable port', async () => {
  let h: Harness | null = await startHarness()
  const probe = createServer()
  const after = createServer()
  try {
    const alice = await h.openWorkspace('Alice')
    const request = () => h!.request({ host: workspaceHost('alice'), path: '/', headers: { cookie: alice.workspaceCookie } })
    expect((await request()).status).toBe(200)
    h.workspace.reachable = false
    const upstream = h.context.deps.upstream!('alice')
    expect(upstream.host).toBe('unavailable.poise.invalid')
    const result = await new Promise<string>((resolve) => {
      probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
      probe.listen(upstream.port, '127.0.0.1', () => resolve('listening'))
    })
    expect(result).toBe('EADDRINUSE')
    expect((await request()).status).toBe(503)
    await h.close(); h = null
    await new Promise<void>((resolve, reject) => {
      after.once('error', reject)
      after.listen(upstream.port, '127.0.0.1', resolve)
    })
    expect(after.listening).toBe(true)
  } finally {
    if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()))
    if (after.listening) await new Promise<void>((resolve) => after.close(() => resolve()))
    if (h) await h.close()
  }
})
