import { Buffer } from 'node:buffer'
export const SECRET_KEY = /authorization|cookie|password|passwd|secret|credential|token(?:[-_]?hint)?$|^auth$|^bearer$|api.?key|private.?key/i

const TERMINAL_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const CREDENTIAL_HEADER = /\b(?:authorization|proxy-authorization|cookie|set-cookie|(?:x[-_])?api.?key|x-goog-api-key|[a-z0-9_-]{0,128}token(?:[-_]?(?:secret|hint))?|password|passwd|client[-_]?secret|auth|bearer|credentials?|secret|private.?key)\\*["']?\s*[:=][^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim

/** Normalize before detecting credentials or private field names. @param {string} value @returns {string} */
export function cleanText(value) {
  return value.replace(TERMINAL_CSI, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

/** @param {string} value @param {readonly string[]} secrets @returns {string} */
export function redact(value, secrets = []) {
  value = cleanText(value)
  value = value.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(CREDENTIAL_HEADER, '[redacted header]')
    .replace(/\b(?:Basic|Bearer|token)\s+[^\s,;"']+/gi, '[redacted credential]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|access_token|refresh_token|id_token|api_key|key|secret|password|auth|signature)=)[^\s&#]+/gi, '$1[redacted]')
  const marker = /\[redacted(?: header(?: continuation)?| credential)?\]/g
  const variants = [...new Set(secrets.filter((secret) => secret.length > 0).flatMap((secret) =>
    [cleanText(secret), Buffer.from(secret).toString('base64'), Buffer.from(`x-access-token:${secret}`).toString('base64')]).filter((secret) => secret.length > 0))].sort((a, b) => b.length - a.length)
  if (!variants.length) return value
  const escaped = variants.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // One pass protects existing markers and avoids expanding them with short secrets.
  return value.replace(new RegExp(marker.source + '|' + escaped.join('|'), 'g'), (match) => /^\[redacted(?: header(?: continuation)?| credential)?\]$/.test(match) ? match : '[redacted]')
}

/** @param {Readonly<Record<string, string | undefined>>} env @returns {string[]} */
export function environmentSecrets(env = process.env) {
  const secrets = []
  for (const [key, value] of Object.entries(env)) {
    if (!value || !(SECRET_KEY.test(key) || /TOKEN|KEY|AUTH|GIT_CONFIG_VALUE/i.test(key))) continue
    secrets.push(value)
    const authorization = /(?:proxy-)?authorization:\s*(basic|bearer|token)\s+([^\s]+)/i.exec(cleanText(value))
    if (authorization) secrets.push(authorization[2])
    const basic = authorization?.[1].toLowerCase() === 'basic' ? authorization : null
    if (basic) {
      secrets.push(basic[2])
      const decoded = Buffer.from(basic[2], 'base64').toString('utf8')
      const colon = decoded.indexOf(':')
      if (colon >= 0) secrets.push(decoded.slice(colon + 1))
    }
  }
  return secrets
}


/** Retain folded-header state across bounded source lines, without keeping raw credentials.
 * @param {readonly string[]} secrets
 * @returns {(line: string) => string}
 */
export function lineRedactor(secrets = []) {
  let header = false
  return (line) => {
    line = cleanText(line)
    const continuation = header && /^[ \t]/.test(line)
    header = continuation || line.search(CREDENTIAL_HEADER) >= 0
    return continuation ? '[redacted header continuation]' : redact(line, secrets)
  }
}
