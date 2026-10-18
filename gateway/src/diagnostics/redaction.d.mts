export const SECRET_KEY: RegExp
export function redact(value: string, secrets?: readonly string[]): string
export function environmentSecrets(env?: Readonly<Record<string, string | undefined>>): string[]
