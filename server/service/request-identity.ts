import type { IncomingMessage } from 'node:http'

// The request guard strips the header. Only verified browser delegation survives,
// privately keyed by the admitted request; it cannot be serialized with authority.
const identities = new WeakMap<IncomingMessage, string>()
export function retainRequestIdentity(req: IncomingMessage, token: string | null): void {
  identities.delete(req)
  if (token) identities.set(req, token)
}
export function verifiedRequestIdentity(req: IncomingMessage): string | null { return identities.get(req) ?? null }
