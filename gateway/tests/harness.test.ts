import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { startHarness, type Harness } from './harness.js'

it('reserves the unavailable upstream until harness cleanup instead of releasing a reusable port', async () => {
  let h: Harness | null = await startHarness()
  const probe = createServer()
  const after = createServer()
  try {
    h.workspace.reachable = false
    const upstream = h.context.deps.upstream!('alice')
    expect(upstream.host).toBe('127.0.0.1')
    const result = await new Promise<string>((resolve) => {
      probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
      probe.listen(upstream.port, upstream.host, () => resolve('listening'))
    })
    expect(result).toBe('EADDRINUSE')
    await h.close(); h = null
    await new Promise<void>((resolve, reject) => {
      after.once('error', reject)
      after.listen(upstream.port, upstream.host, resolve)
    })
    expect(after.listening).toBe(true)
  } finally {
    if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()))
    if (after.listening) await new Promise<void>((resolve) => after.close(() => resolve()))
    if (h) await h.close()
  }
})
