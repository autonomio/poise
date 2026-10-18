import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DiagnosticStore } from './store.js'
import { environmentSecrets, normalize } from './contract.js'
import { nativeDiagnostic } from './sources.js'

/** Operator access is Docker/host ownership, never a workspace browser assertion. */
export async function runOperator(args: string[], write: (line: string) => void = (line) => process.stdout.write(line + '\n')): Promise<void> {
  const [command = 'health', ...options] = args
  const db = new DiagnosticStore(join(process.env.POISE_GATEWAY_DATA ?? '/data', 'logging.db'))
  const access = { workspace: 'operator', operator: true }
  try {
    if (command === 'health') write(JSON.stringify({ version: 1, sources: db.readCoverage(access), bounds: db.bounds(access), policy: db.policy }))
    else if (command === 'event') {
      if (options.length !== 1) throw new Error('event requires one event ID')
      write(JSON.stringify(db.lookup(access, options[0])))
    } else if (command === 'query' || command === 'export') {
      if (options.length > 1) throw new Error('query/export accept one JSON filter object')
      const filter = options[0] ? JSON.parse(options[0]) as Parameters<DiagnosticStore['query']>[1] : {}
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Filter must be an object')
      const allowed = ['severities', 'from', 'to', 'source', 'component', 'workspace', 'account', 'repository', 'callId', 'correlationId', 'incidentId', 'search', 'cursor', 'after', 'limit']
      if (Object.keys(filter).some((key) => !allowed.includes(key))) throw new Error('Unknown Logging filter')
      const page = db.query(access, filter)
      if (command === 'query') write(JSON.stringify(page))
      else { write(JSON.stringify({ type: 'metadata', ...page, events: undefined })); for (const event of page.events) write(JSON.stringify({ type: 'event', event })) }
    } else if (command === 'ingress') {
      if (options.length) throw new Error('ingress reads one bounded JSON record from stdin')
      let text = ''
      for await (const chunk of process.stdin) {
        text += String(chunk)
        if (Buffer.byteLength(text) > 64 * 1024) throw new Error('Ingress record exceeds 64 KiB')
      }
      const row = JSON.parse(text) as { request?: { host?: string }; request_id?: string }
      const domain = process.env.POISE_DOMAIN
      const host = row.request?.host?.split(':')[0].toLowerCase()
      if (!domain || !host || (host !== domain && !host.endsWith('.' + domain))) throw new Error('Ingress record is outside the configured Poise domain')
      const input = nativeDiagnostic(row, 'ingress', row.request_id ?? text, null)
      input.context = { host, integration: 'operator-stdin' }
      const event = normalize(input, Date.now(), environmentSecrets())
      if (event) db.append([event])
      write(JSON.stringify({ accepted: true, eventId: event?.id ?? null }))
    } else throw new Error('Use health, query, event, export or ingress')
  } finally { db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperator(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write((error instanceof Error ? error.message : 'Operator diagnostic command failed') + '\n'); process.exitCode = 1 })
}
