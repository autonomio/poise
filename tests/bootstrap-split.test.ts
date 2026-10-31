import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

// The bootstrap (src/main.ts) loads one interface on demand. A static import
// of a view from it would load classic's code on every page, including a
// new-interface page; a static stylesheet beyond the shared watcher overlays
// would paint classic's look before an interface loads. The split is pinned
// here as text.
const BOOTSTRAP = new URL('../src/main.ts', import.meta.url).pathname

describe('the bootstrap loads one interface on demand', () => {
  it('has no static view imports and only shared overlay styles', async () => {
    const source = await readFile(BOOTSTRAP, 'utf8')
    const specs = [...source.matchAll(/^import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?(['"])([^'"]+)\1/gm)]
      .map((m) => m[2])
      .filter((spec) => spec.startsWith('.'))
    expect(specs.filter((spec) => spec.startsWith('./views/') && !spec.endsWith('.css'))).toEqual([])
    expect(specs.filter((spec) => spec.endsWith('.css'))).toEqual(['./views/updating.css'])
  })
})
