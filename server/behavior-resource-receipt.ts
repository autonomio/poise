/** Caller resource metadata. Publication phases cannot replace this receipt. */
export interface ResourceOwnershipReceipt {
  version: 1
  roots: { path: string, state: 'registered' | 'allocated' | 'reclaimed', device?: string, inode?: string,
    parent_device?: string, parent_inode?: string, reclaimed_at?: number, recovered_at?: number }[]
  errors: { cause: string, path: string | null, at: number }[]
  process_pending?: boolean
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function time(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }

export function parseResourceOwnership(value: unknown): ResourceOwnershipReceipt {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.errors)
    || (value.process_pending !== undefined && typeof value.process_pending !== 'boolean')
    || Object.keys(value).some(key => !['version', 'roots', 'errors', 'process_pending'].includes(key))
    || Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) throw new Error('invalid native resource ownership')
  const paths = new Set<string>()
  for (const root of value.roots) {
    if (!object(root) || typeof root.path !== 'string' || !root.path.startsWith('/') || paths.has(root.path)
      || !['registered', 'allocated', 'reclaimed'].includes(String(root.state))
      || Object.keys(root).some(key => !['path', 'state', 'device', 'inode', 'parent_device', 'parent_inode', 'reclaimed_at', 'recovered_at'].includes(key))
      || (root.state !== 'registered' && ['device', 'inode', 'parent_device', 'parent_inode']
        .some(key => typeof root[key] !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(String(root[key]))))
      || (root.state === 'reclaimed' && !time(root.reclaimed_at))
      || (root.reclaimed_at !== undefined && (root.state !== 'reclaimed' || !time(root.reclaimed_at)))
      || (root.recovered_at !== undefined && (!time(root.recovered_at) || root.recovered_at !== root.reclaimed_at))) {
      throw new Error('invalid native resource directory receipt')
    }
    paths.add(root.path)
  }
  for (const error of value.errors) {
    if (!object(error) || typeof error.cause !== 'string' || !error.cause || error.cause.length > 2000
      || (error.path !== null && (typeof error.path !== 'string' || !paths.has(error.path))) || !time(error.at)
      || Object.keys(error).some(key => !['cause', 'path', 'at'].includes(key))) throw new Error('invalid native resource failure receipt')
  }
  return value as unknown as ResourceOwnershipReceipt
}

export function resourceOwnershipReleased(value: ResourceOwnershipReceipt): boolean {
  if (value.process_pending || value.roots.some(root => root.state !== 'reclaimed')) return false
  return value.errors.every(error => error.cause !== 'resources_unknown' && error.path !== null
    && (value.roots.find(root => root.path === error.path)?.recovered_at ?? 0) >= error.at)
}

export function resourceReleaseContradicted(evidence: Record<string, unknown>): boolean {
  if (!evidence.resources_settled_at) return false
  const artifact = evidence.artifact
  if (object(artifact) && (artifact.resource_error != null || artifact.phase === 'resources_unknown')) return true
  if (evidence.resource_ownership != null) {
    try { return !resourceOwnershipReleased(parseResourceOwnership(evidence.resource_ownership)) }
    catch { return true }
  }
  return false
}

export function resourceReleaseProven(evidence: Record<string, unknown>, requireOwnership = false): boolean {
  return typeof evidence.resources_settled_at === 'string' && Number.isFinite(Date.parse(evidence.resources_settled_at))
    && (!requireOwnership || evidence.resource_ownership != null)
    && !resourceReleaseContradicted(evidence)
}

export function nativeResourcesPending(invocation: Record<string, unknown>): boolean {
  if (invocation.model === null) return false
  const evidence = object(invocation.evidence) ? invocation.evidence : {}
  // Older terminal journal records remain readable. Contradictory release
  // evidence is re-held in derived capacity without rewriting any event/hash.
  return invocation.state === 'settled' ? resourceReleaseContradicted(evidence) : !resourceReleaseProven(evidence, true)
}
