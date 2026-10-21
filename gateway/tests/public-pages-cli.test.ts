import { buildSync } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

let dir: string, cli: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'public-pages-cli-')); cli = join(dir, 'cli.mjs')
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/public-pages-cli.ts', import.meta.url))], outfile: cli, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

it('validates without publishing, installs only explicit content, and does not require source changes for another deployment', () => {
  const input = JSON.stringify({ version: 1, appName: 'Other deployment', contactEmail: 'admin@example.org', description: 'Writing at {{domain}}', privacy: ['Our reviewed notice.'], terms: ['Our reviewed terms.'] })
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('POISE_') && key !== 'PORT'))
  const env = { ...inherited, POISE_DOMAIN: 'notes.example.org', POISE_GITHUB_CLIENT_ID: 'dummy', POISE_GITHUB_CLIENT_SECRET: 'dummy', POISE_ADMINS: 'root', POISE_RUNTIME_IMAGE: 'runtime:current', POISE_GATEWAY_CONTAINER: 'gateway', POISE_GATEWAY_DATA: dir }
  const validate = spawnSync(process.execPath, [cli, 'validate'], { input, encoding: 'utf8', env })
  expect(validate.status).toBe(0)
  expect(validate.stdout).toContain('Public pages are valid.')
  expect(() => readFileSync(join(dir, 'public-pages.json'))).toThrow()
  const install = spawnSync(process.execPath, [cli, 'install'], { input, encoding: 'utf8', env })
  expect(install.status).toBe(0)
  expect(install.stdout).toContain('https://notes.example.org/privacy')
  expect(JSON.parse(readFileSync(join(dir, 'public-pages.json'), 'utf8'))).toEqual(JSON.parse(input))
  const refused = spawnSync(process.execPath, [cli, 'install'], { input: '{"secret":"do-not-disclose"}', encoding: 'utf8', env })
  expect(refused.status).toBe(1)
  expect(refused.stderr).not.toContain('do-not-disclose')
  expect(JSON.parse(readFileSync(join(dir, 'public-pages.json'), 'utf8'))).toEqual(JSON.parse(input))
})
