import { Buffer } from 'node:buffer'
export const SECRET_KEY = /authorization|cookie|password|secret|credential|(?:^|[_-])token$|^(?:access|refresh|id|auth|api|session)Token$|^auth$|^bearer$|api.?key|private.?key/i

/** @param {string} value @param {readonly string[]} secrets @returns {string} */
export function redact(value, secrets = []) {
  for (const secret of [...secrets].filter((item) => item.length >= 8).sort((a, b) => b.length - a.length)) {
    for (const encoded of [secret, Buffer.from(secret).toString('base64'), Buffer.from(`x-access-token:${secret}`).toString('base64')]) value = value.split(encoded).join('[redacted]')
  }
  return value.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie|(?:x[-_])?api[-_]?key|x-goog-api-key|x-auth-token|x-amz-security-token)\s*[:=][^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, '[redacted header]')
    .replace(/\b(?:Basic|Bearer|token)\s+[^\s,;"']+/gi, '[redacted credential]')
    .replace(/(https?:\/\/)[^\s/]+@/g, '$1[redacted]@')
    .replace(/([?&](?:token|access_token|refresh_token|id_token|api_key|key|secret|password|auth|signature)=)[^\s&#]+/gi, '$1[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

/** @param {Readonly<Record<string, string | undefined>>} env @returns {string[]} */
export function environmentSecrets(env = process.env) {
  const secrets = []
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8 || !(SECRET_KEY.test(key) || /TOKEN|KEY|AUTH|GIT_CONFIG_VALUE/i.test(key))) continue
    secrets.push(value)
    const basic = /authorization:\s*basic\s+([A-Za-z0-9+/=]+)/i.exec(value)
    if (basic) {
      secrets.push(basic[1])
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
      const colon = decoded.indexOf(':')
      if (colon >= 0) secrets.push(decoded.slice(colon + 1))
    }
  }
  return secrets
}

