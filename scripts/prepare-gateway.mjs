import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const result = spawnSync('npm', ['ci'], { cwd: fileURLToPath(new URL('../gateway/', import.meta.url)), stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
