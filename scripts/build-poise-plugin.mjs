import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Build a private, installation-bound Codex compatibility package. */
export async function buildPoisePlugin(origin, directory) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Poise plugin requires the installation HTTPS apex origin, without a path or trailing slash')
  const output = resolve(directory)
  await mkdir(output)
  await cp(new URL('../plugins/poise/', import.meta.url), output, { recursive: true })
  await writeFile(resolve(output, '.mcp.json'), JSON.stringify({ mcpServers: { poise: { type: 'http', url: `${origin}/mcp` } } }, null, 2) + '\n')
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/build-poise-plugin.mjs HTTPS_APEX NEW_OUTPUT_DIRECTORY')
  await buildPoisePlugin(process.argv[2], process.argv[3])
}
