import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('builds the supported Codex manifest with its declared skill and installation HTTPS endpoint, without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'poise-plugin-'))
  const output = join(root, 'private plugin')
  try {
    const run = promisify(execFile)
    await run(process.execPath, ['scripts/build-poise-plugin.mjs', 'https://poise.test', output])
    const manifest = JSON.parse(await readFile(join(output, '.codex-plugin/plugin.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'poise', version: '1.0.0', skills: './skills/', mcpServers: './.mcp.json' })
    expect(JSON.parse(await readFile(join(output, manifest.mcpServers), 'utf8'))).toEqual({ mcpServers: { poise: { type: 'http', url: 'https://poise.test/mcp' } } })
    const skill = await readFile(join(output, manifest.skills, 'poise-manager/SKILL.md'), 'utf8')
    expect(skill).toContain('name: poise-manager')
    expect(skill).toContain('poise_describe'); expect(skill).toContain('poise_work')
    await expect(run(process.execPath, ['scripts/build-poise-plugin.mjs', 'http://poise.test', join(root, 'insecure')])).rejects.toThrow('HTTPS apex')
    await expect(run(process.execPath, ['scripts/build-poise-plugin.mjs', 'https://poise.test/path', join(root, 'path')])).rejects.toThrow('HTTPS apex')
  } finally { await rm(root, { recursive: true, force: true }) }
})
