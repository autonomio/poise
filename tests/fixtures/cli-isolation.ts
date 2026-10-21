// What keeps every test away from the developer's own agent CLIs and their
// logins: a home folder and agent-CLI configuration of its own, and stand-ins
// first on PATH for the six agent CLIs.
//
// HOME alone is not enough. On macOS Claude Code keeps its login in the login
// Keychain under a name derived from CLAUDE_CONFIG_DIR, not from HOME, so a
// test that reached the real `claude auth login` with only HOME replaced
// signed the developer's own Claude out. With every variable below pointing
// into a temporary folder, even a real CLI reached by mistake could touch only
// that folder; and on PATH it is a stand-in that answers, refusing to run.
//
// Nor does a test inherit the developer's secret-named variables. Poise's
// diagnostics redact the value of every such variable wherever it appears,
// and a Claude Code session exports CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH=1:
// inherited, it turned every "1" in a test's log text into "[redacted]" on
// the developer's machine and nowhere else.
//
// tests/home-isolation.ts applies this to every vitest process, and
// playwright.config.ts to the end-to-end server.

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { environmentSecrets } from '../../gateway/src/diagnostics/redaction.mjs'

/** Where the agent CLIs keep their logins and settings. */
export const CLI_HOME_VARIABLES = [
  'HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GH_CONFIG_DIR', 'GROK_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'AGENT_INTERFACE_DATA_DIR',
] as const

/** The agent CLIs' executables, as Poise runs them by name. */
export const AGENT_CLI_NAMES = ['claude', 'codex', 'gh', 'grok', 'muse', 'agy'] as const

/** A new folder under `root` for each of CLI_HOME_VARIABLES. */
export function cliHomes(root: string): Record<typeof CLI_HOME_VARIABLES[number], string> {
  const homes = Object.fromEntries(CLI_HOME_VARIABLES.map((name) => [name, join(root, name.toLowerCase())])) as Record<typeof CLI_HOME_VARIABLES[number], string>
  for (const dir of Object.values(homes)) mkdirSync(dir, { recursive: true })
  return homes
}

/** Stand-ins for the agent CLIs in `dir`, each refusing to run and saying why. */
export function agentCliStandIns(dir: string): string {
  mkdirSync(dir, { recursive: true })
  for (const name of AGENT_CLI_NAMES) {
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\necho "${0##*/} is a stand-in: tests run the fakes in tests/fixtures/accounts/fake-clis.ts, never a real CLI." >&2\nexit 127\n')
    chmodSync(path, 0o755)
  }
  return dir
}

/** The variables in `env` a test process does not inherit: each one whose
 *  value diagnostics redact as a secret (environmentSecrets), and
 *  GIT_CONFIG_COUNT, since its GIT_CONFIG_KEY_<n> are among them and git
 *  refuses a count whose keys are missing. */
export function secretVariables(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((name) => name === 'GIT_CONFIG_COUNT' || environmentSecrets({ [name]: env[name] }).length > 0)
}

/** The environment of a process isolated under `root`: its own homes, and
 *  the stand-ins ahead of `path`. */
export function isolatedEnvironment(root: string, path: string): Record<string, string> {
  return { ...cliHomes(join(root, 'homes')), PATH: [agentCliStandIns(join(root, 'stand-ins')), path].filter(Boolean).join(delimiter) }
}
