import { getMeta } from './db'
import { listOrganizationsRepos, selectOrganizations, type OrganizationReadError } from './gh'
import { HttpError } from './http'
import { runFile } from './process'

export interface ActionRun {
  kind: 'action'
  repo: string
  number: number
  title: string
  url: string
  author: string
  state: string
  updated_at: string
  branch: string
  event: string
}

interface Snapshot {
  records: ActionRun[]
  errors: OrganizationReadError[]
  warnings: string[]
}

const TTL_MS = 5 * 60_000
const cache = new Map<string, { expires: number, read: Promise<Snapshot> }>()
export function invalidateActionRunCache(): void { cache.clear() }
const credentialEnv = {
  GH_HOST: undefined, GH_TOKEN: undefined, GITHUB_TOKEN: undefined,
  GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined,
}

async function readSnapshot(me: string, org: string, failed: boolean): Promise<Snapshot> {
  const discovery = await listOrganizationsRepos(org)
  if (!discovery.repos.length) return { records: [], errors: discovery.errors, warnings: [] }
  const token = (await runFile('gh', ['auth', 'token', '--hostname', 'github.com', '--user', me], {
    env: credentialEnv, timeoutMs: 15_000,
  })).stdout.trim()
  if (!token) throw new Error(`No GitHub credential for ${me}`)
  const records: ActionRun[] = []
  let successfulReads = 0
  const errors = [...discovery.errors]
  const warnings: string[] = []
  // One bounded request per repository; no history crawl, job reads or run polling.
  for (let i = 0; i < discovery.repos.length; i += 4) {
    await Promise.all(discovery.repos.slice(i, i + 4).map(async (repo) => {
      try {
        const { stdout } = await runFile('gh', [
          'api', `repos/${repo}/actions/runs?per_page=100${failed ? '&status=failure' : ''}`,
          '--method', 'GET',
        ], { env: { ...credentialEnv, GH_HOST: 'github.com', GH_TOKEN: token }, timeoutMs: 30_000, maxOutputBytes: 8 * 1024 * 1024 })
        const data = JSON.parse(stdout)
        if (!Array.isArray(data.workflow_runs) || !Number.isSafeInteger(data.total_count) || data.total_count < 0) {
          throw new Error('GitHub returned malformed workflow inventory')
        }
        const runs: ActionRun[] = data.workflow_runs.map((run: Record<string, unknown>) => {
          const actor = run.actor as { login?: string } | null
          if (!Number.isSafeInteger(run.id) || typeof run.html_url !== 'string'
            || typeof run.status !== 'string' || typeof run.updated_at !== 'string'
            || typeof run.name !== 'string' || (failed && run.conclusion !== 'failure')) {
            throw new Error('GitHub returned malformed workflow run')
          }
          return {
            kind: 'action', repo, number: run.id as number,
            title: `${run.name}${typeof run.display_title === 'string' && run.display_title !== run.name ? ` · ${run.display_title}` : ''}`,
            url: run.html_url, author: actor?.login || '',
            state: typeof run.conclusion === 'string' ? run.conclusion : run.status,
            updated_at: run.updated_at, branch: typeof run.head_branch === 'string' ? run.head_branch : '',
            event: typeof run.event === 'string' ? run.event : '',
          }
        })
        records.push(...runs)
        successfulReads++
        if (data.total_count > runs.length) warnings.push(`${repo}: showing the latest ${runs.length} of ${data.total_count} ${failed ? 'failed ' : ''}runs. Open GitHub for older runs.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ org: repo.split('/')[0], error: `${repo}: ${message.split(token).join('***')}` })
      }
    }))
  }
  if (errors.length && successfulReads === 0) throw new HttpError(502, errors.map((entry) => entry.error).join('; '))
  return { records, errors, warnings }
}

export async function listActionRuns(body: Record<string, unknown>): Promise<{ status: number, body: unknown }> {
  const orgs = selectOrganizations(body.org)
  if (!orgs.length) return { status: 200, body: body.count_only ? { count: 0, errors: [], warnings: [] } : { records: [], errors: [], warnings: [] } }
  const me = getMeta('me') || ''
  if (!me) throw new HttpError(400, 'Set your GitHub account in Settings → GitHub to read Actions')
  const failed = body.record_state !== 'all'
  const results = await Promise.allSettled(orgs.map((org) => {
    const key = `${me.toLowerCase()}:${org.login.toLowerCase()}:${failed}`
    const existing = cache.get(key)
    if (existing && existing.expires > Date.now()) return existing.read
    // Store the in-flight read too: the page and its count share every API call.
    const read = readSnapshot(me, org.login, failed)
    cache.set(key, { expires: Date.now() + TTL_MS, read })
    return read
  }))
  const errors: OrganizationReadError[] = []
  const warnings: string[] = []
  let records: ActionRun[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      records.push(...result.value.records)
      errors.push(...result.value.errors)
      warnings.push(...result.value.warnings)
    } else errors.push({ org: orgs[i].login, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })
  if (results.every((result) => result.status === 'rejected')) throw new HttpError(502, errors.map((entry) => `${entry.org}: ${entry.error}`).join('; '))
  const q = typeof body.q === 'string' ? body.q.toLowerCase() : ''
  records = records.filter((run) => (!body.updated_since || run.updated_at >= String(body.updated_since))
    && (!body.updated_until || run.updated_at < String(body.updated_until))
    && (!q || [run.repo, run.title, run.author, run.branch, run.event, String(run.number)].some((value) => value.toLowerCase().includes(q))))
  records.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.number - a.number)
  if (body.count_only) return { status: 200, body: { count: records.length, errors, warnings } }
  const offset = Math.max(0, Number(body.offset) || 0)
  const limit = Math.max(1, Number(body.limit) || 20)
  return { status: 200, body: { records: records.slice(offset, offset + limit), errors, warnings } }
}
