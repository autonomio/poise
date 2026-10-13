import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const commands = [
  { command: 'docker', args: ['build', 'gateway/'], cwd: root },
  { command: 'npx', args: ['vitest', 'run', 'tests/docker.integration.test.ts'], cwd: `${root}gateway` },
]
for (const { command, args, cwd } of commands) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, POISE_GATEWAY_DOCKER_TESTS: '1' } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
