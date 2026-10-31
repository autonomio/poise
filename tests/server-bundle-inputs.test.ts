import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SERVER_BUILDS } from '../scripts/build-server.mjs'

// The service-untouched proof (#556): the server bundles' inputs under `src/`
// are pinned. Moving shared code that the server executes changes this set,
// so a refactor that touches it fails here until the fixture is regenerated
// and the change reviewed. Regenerate with UPDATE_FIXTURES=1.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = resolve(ROOT, 'tests/fixtures/server-bundle-inputs.json')

async function serverSrcInputs(): Promise<string[]> {
  const inputs = new Set<string>()
  for (const { entryPoints } of SERVER_BUILDS) {
    const result = await build({
      entryPoints,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      write: false,
      metafile: true,
      // The define only changes bundle contents, never the input set.
      define: { __POISE_BUILD_SHA__: '"test"' },
      logLevel: 'silent',
      absWorkingDir: ROOT,
    })
    for (const input of Object.keys(result.metafile?.inputs ?? {})) {
      const rel = relative(ROOT, resolve(ROOT, input)).split(sep).join('/')
      if (rel.startsWith('src/')) inputs.add(rel)
    }
  }
  return [...inputs].sort()
}

describe('server bundle src inputs', () => {
  it('matches the pinned input set', { timeout: 120_000 }, async () => {
    const actual = await serverSrcInputs()
    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
      return
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')) as string[])
  })
})
