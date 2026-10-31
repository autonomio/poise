import { build } from 'esbuild'
import { buildSourceSha } from './build-identity.mjs'

const shared = { bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'info' }

/** Every server bundle's entry and output. Exported so the server-bundle
 *  inputs test pins exactly what ships; adding a bundle updates the fixture. */
export const SERVER_BUILDS = [
  { entryPoints: ['server/production.ts'], outfile: 'dist/server.js', defineSha: true },
  { entryPoints: ['server/runtime-diagnostic.ts'], outfile: 'dist/runtime-diagnostic.js' },
  { entryPoints: ['gateway/src/diagnostics/query-worker.ts'], outfile: 'dist/query-worker.js' },
  { entryPoints: ['server/behavior-ledger-cli.ts'], outfile: 'dist/behavior-ledger.js' },
  { entryPoints: ['server/behavior-ledger-worker.ts'], outfile: 'dist/behavior-ledger-worker.js' },
  { entryPoints: ['server/agent-log-worker.ts'], outfile: 'dist/agent-log-worker.js' },
  { entryPoints: ['server/analytics-worker.ts'], outfile: 'dist/analytics-worker.js' },
]

const invoked = process.argv[1]?.endsWith('build-server.mjs') ?? false
if (invoked) {
  for (const { entryPoints, outfile, defineSha } of SERVER_BUILDS) {
    await build({
      ...shared,
      entryPoints,
      outfile,
      ...(defineSha ? { define: { __POISE_BUILD_SHA__: JSON.stringify(buildSourceSha()) } } : {}),
    })
  }
}
