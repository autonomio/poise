import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TERMINAL_WS_PATH } from '../server/terminal/protocol'

// The client-interface proof (#556): every HTTP method and path the browser
// calls, every WebSocket path and command name with its payload shape, pinned
// against a checked-in list. A new endpoint, command or field fails here until
// the fixture is regenerated and the change reviewed. The collection is static
// and syntactic; what it cannot resolve (a path built by a helper, a socket
// address assembled from parts) is pinned as a `dynamic` marker instead of
// being silently skipped. Regenerate with UPDATE_FIXTURES=1.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const FIXTURE = join(ROOT, 'tests/fixtures/client-interface.json')

interface CommandShape { type: string, fields: string[] }
interface ClientInterface {
  http: string[]
  dynamic: string[]
  ws: string[]
  commands: CommandShape[]
  intersections: Record<string, string[]>
  terminalFrames: CommandShape[]
}

const API_PREFIX = /^\/(?:api|_poise\/api|ws)\//

/** Source with every comment blanked (positions kept), so only real code pins. */
function stripComments(text: string): string {
  const out = [...text]
  const blank = (from: number, to: number): void => { for (let k = from; k < to; k++) out[k] = text[k] === '\n' ? '\n' : ' ' }
  skipCode(text, 0, text.length, {
    onLineComment: (from, to) => blank(from, to),
    onBlockComment: (from, to) => blank(from, to),
  })
  return out.join('')
}

interface CodeCallbacks {
  onLineComment?: (from: number, to: number) => void
  onBlockComment?: (from: number, to: number) => void
}

/** Walk code, skipping strings (templates with `${}` nesting) and reporting comments. */
function skipCode(text: string, from: number, to: number, cb: CodeCallbacks): number {
  let i = from
  while (i < to) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i)
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      let j = i
      while (j < to && text[j] !== '\n') j++
      cb.onLineComment?.(i, j)
      i = j
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2)
      const end = j === -1 || j + 2 > to ? to : j + 2
      cb.onBlockComment?.(i, end)
      i = end
      continue
    }
    i++
  }
  return i
}

/** Index just past the string literal starting at `start` (its quote). */
function skipString(text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < text.length && depth > 0) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === '"' || text[i] === "'" || text[i] === '`') { i = skipString(text, i); continue }
        if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
        i++
      }
      continue
    }
    i++
    if (text[i - 1] === quote) break
  }
  return i
}

/** Text of the parenthesized argument list starting at `open` (the `(`), with its end index. */
function parenthesized(text: string, open: number): { args: string, end: number } | null {
  let depth = 0
  let i = open
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return { args: text.slice(open + 1, i), end: i + 1 }
    }
    i++
  }
  return null
}

/** Split on top-level commas (strings and nesting respected). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
    i++
  }
  parts.push(text.slice(start))
  return parts
}

/** The literal when the whole expression is one string, else null. */
function unquote(expr: string): string | null {
  const trimmed = expr.trim()
  if (!/^['"`]/.test(trimmed)) return null
  const end = skipString(trimmed, 0)
  if (end !== trimmed.length) return null
  return trimmed.slice(1, end - 1)
}

/** A path with its holes normalized and its query cut: `/a/${s}/x?y` → `/a/{}/x`. */
function normalizePath(literal: string): string {
  let out = ''
  let i = 0
  while (i < literal.length) {
    const c = literal[i]
    if (c === '$' && literal[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < literal.length && depth > 0) {
        if (literal[i] === '{') depth++
        else if (literal[i] === '}') depth--
        i++
      }
      out += '{}'
      continue
    }
    if (c === '?' || c === '#') break
    out += c
    i++
  }
  return out
}

/** An unresolvable expression, pinned as written (holes normalized, query kept). */
function normalizeExpr(expr: string): string {
  let out = ''
  let i = 0
  while (i < expr.length) {
    if (expr[i] === '$' && expr[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < expr.length && depth > 0) {
        if (expr[i] === '{') depth++
        else if (expr[i] === '}') depth--
        i++
      }
      out += '{}'
      continue
    }
    out += expr[i]
    i++
  }
  return out.replace(/\s+/g, ' ')
}

/** `const`/`let NAME = <initializer>` initializers in one file. */
function constInits(code: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    let i = m.index + m[0].length
    const start = i
    let depth = 0
    while (i < code.length) {
      const c = code[i]
      if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue }
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if ((c === ';' || c === ',') && depth === 0) break
      else if (c === '\n' && depth === 0) {
        const before = code.slice(start, i).trimEnd()
        const after = /^\s*(\S+)/.exec(code.slice(i))?.[1] ?? ''
        const continues = /[?:+\-*/%&|^<>=!(,]$/.test(before) || /^[?:.]/.test(after) || /^(?:\|\||&&|\?\?)/.test(after)
        if (!continues) break
      }
      i++
    }
    map.set(m[1], code.slice(start, i))
  }
  return map
}

/** A file-local `api`/`call` helper's parameter names, when one is defined. */
function helperSignature(code: string, name: 'api' | 'call'): string[] | null {
  const m = new RegExp(`\\bfunction\\s+${name}\\s*(?:<[^<>]*>)?\\s*\\(([^)]*)\\)`).exec(code)
  if (!m) return null
  return splitTopLevel(m[1]).map((p) => /^\s*([A-Za-z_$][\w$]*)/.exec(p)?.[1] ?? '').filter(Boolean)
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

type MethodRule =
  | { kind: 'options' } // fetch, jsonFetch, fetchWithDeadline: `method:` in args, else GET
  | { kind: 'post' } // sendBeacon, postJson, postPresets
  | { kind: 'body' } // gateway call, googleCall: POST iff a body argument is present
  | { kind: 'secondArg' } // extensions api, publishing call: second argument or GET
  | { kind: 'firstArg' } // current api: method first, path second
  | { kind: 'thirdArgOrPost' } // chat-client post
  | { kind: 'get' } // readLogFeed

const HELPERS: Record<string, MethodRule> = {
  fetch: { kind: 'options' },
  sendBeacon: { kind: 'post' },
  googleCall: { kind: 'body' },
  postJson: { kind: 'post' },
  postPresets: { kind: 'post' },
  jsonFetch: { kind: 'options' },
  post: { kind: 'thirdArgOrPost' },
  fetchWithDeadline: { kind: 'options' },
  readLogFeed: { kind: 'get' },
}

function collectHttp(): { http: string[], dynamic: string[], ws: string[] } {
  const http = new Set<string>()
  const dynamic = new Set<string>()
  const ws = new Set<string>()
  const names = ['fetch', 'sendBeacon', 'api', 'call', 'WebSocket', ...Object.keys(HELPERS).filter((n) => n !== 'fetch' && n !== 'sendBeacon')]
  const callPattern = new RegExp(`(?<![.\\w])(${names.join('|')})\\s*(?:<[^<>]*>)?\\s*\\(`, 'g')
  const files = new Map<string, string>()
  for (const file of tsFiles(SRC)) {
    // `navigator.sendBeacon` is the only method-style call the collector
    // recognizes; every other `.name(` is an unrelated method.
    files.set(file, stripComments(readFileSync(file, 'utf8')).replaceAll('navigator.sendBeacon(', 'sendBeacon('))
  }
  for (const [file, code] of files) {
    const inits = constInits(code)
    const apiSig = helperSignature(code, 'api')
    const callSig = helperSignature(code, 'call')
    const pin = (method: string, literal: string): void => {
      http.add(`${method} ${normalizePath(literal)}`)
    }
    /** Pin every API literal a path expression carries; false when there is none. */
    const pinLiterals = (method: string, expr: string): boolean => {
      let found = false
      // One alternative per quote type, so a `'` inside a template (or the
      // reverse) does not cut the token; negated classes span newlines.
      const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g
      for (const m of expr.matchAll(pattern)) {
        const content = m[1] ?? m[2] ?? m[3] ?? ''
        if (!API_PREFIX.test(content)) continue
        // A literal glued behind `+` (`endpoint + '/export'`) is a suffix, not a path.
        if (expr.slice(0, m.index).trimEnd().endsWith('+')) continue
        const rest = expr.slice(m.index + m[0].length).trim()
        pin(method, rest.startsWith('+') ? `${content}{}` : content)
        found = true
      }
      return found
    }
    /** Bodies of same-file path builders a call delegates to (sitePath, googlePath, historyUrl). */
    const helperBody = (name: string, fromFile: string, files: Map<string, string>): string | null => {
      const ordered = [fromFile, ...[...files.keys()].filter((f) => f !== fromFile).sort()]
      let found: string | null = null
      for (const file of ordered) {
        const code = files.get(file) ?? ''
        const defs: number[] = []
        for (const dm of code.matchAll(new RegExp(`\\bfunction\\s+${name}\\s*(?:<[^<>]*>)?\\s*\\(|\\bconst\\s+${name}\\s*=`, 'g'))) {
          defs.push(dm.index + dm[0].length)
        }
        if (defs.length === 0) continue
        if (file !== fromFile && (defs.length > 1 || found !== null)) return null // ambiguous: pin the call only
        for (const at of defs) {
          let i = at
          if (code[i - 1] === '(' || /\(\s*$/.test(code.slice(Math.max(0, at - 40), at))) {
            const paren = parenthesized(code, code.lastIndexOf('(', at))
            if (paren === null) continue
            i = paren.end
            const ret = /^\s*(?::\s*[^;{]*?)?\{/.exec(code.slice(i))
            if (!ret) continue
            i += ret[0].length - 1
          } else {
            const arrow = /=>/.exec(code.slice(i))
            if (!arrow) continue
            i += arrow.index + 2
            while (/\s/.test(code[i])) i++
            if (code[i] !== '{') {
              const semi = code.indexOf(';', i)
              found = found ?? code.slice(i, semi === -1 ? code.length : semi)
              continue
            }
          }
          let depth = 0
          const open = i
          for (; i < code.length; i++) {
            const c = code[i]
            if (c === '"' || c === "'" || c === '`') { i = skipString(code, i) - 1; continue }
            if (c === '{') depth++
            else if (c === '}') {
              depth--
              if (depth === 0) break
            }
          }
          found = found ?? code.slice(open + 1, i)
        }
        if (file === fromFile && found !== null) return found
      }
      return found
    }
    callPattern.lastIndex = 0
    for (let m = callPattern.exec(code); m; m = callPattern.exec(code)) {
      const callee = m[1]
      const paren = parenthesized(code, m.index + m[0].length - 1)
      if (paren === null) continue
      // A function definition's own parameter list is not a call.
      if (/^\s*(?::\s*[^;{]*?)?\{/.test(code.slice(paren.end))) continue
      const args = splitTopLevel(paren.args)
      let rule: MethodRule | null = HELPERS[callee] ?? null
      let pathIndex = 0
      if (callee === 'api') {
        if (!apiSig) continue
        rule = apiSig[0] === 'method' ? { kind: 'firstArg' } : { kind: 'secondArg' }
        pathIndex = apiSig[0] === 'method' ? 1 : 0
      } else if (callee === 'call') {
        if (!callSig) continue
        rule = callSig[1] === 'method' ? { kind: 'secondArg' } : { kind: 'body' }
      } else if (!rule || callee === 'WebSocket') {
        if (callee === 'WebSocket') {
          const literal = unquote(args[0]?.trim() ?? '')
          const found = literal === null ? [] : normalizePath(literal).match(/\/ws\/[A-Za-z0-9_.-]*/g) ?? []
          if (found.length > 0) for (const path of found) ws.add(path)
          else dynamic.add(`WS ${basename(file)} :: ${normalizeExpr(args[0] ?? '')}`)
        }
        continue
      }
      let method: string | null = null
      if (rule.kind === 'post' || rule.kind === 'get') method = rule.kind === 'post' ? 'POST' : 'GET'
      else if (rule.kind === 'firstArg') method = unquote(args[0]?.trim() ?? '')?.toUpperCase() ?? 'GET'
      else if (rule.kind === 'secondArg') method = unquote(args[1]?.trim() ?? '')?.toUpperCase() ?? 'GET'
      else if (rule.kind === 'thirdArgOrPost') method = unquote(args[2]?.trim() ?? '')?.toUpperCase() ?? 'POST'
      else if (rule.kind === 'body') method = args.length > 1 && args[1].trim() !== '' ? 'POST' : 'GET'
      else method = /method\s*:\s*['"]([A-Za-z]+)['"]/.exec(paren.args)?.[1]?.toUpperCase() ?? 'GET'
      if (callee === 'call' && callSig?.[1] === 'body') {
        // The gateway helper takes paths relative to /_poise/api/.
        const literal = unquote((args[0] ?? '').trim())
        if (literal !== null && !literal.startsWith('/')) {
          http.add(`${method ?? 'GET'} /_poise/api/${normalizePath(literal)}`)
          continue
        }
      }
      const pathExpr = (args[pathIndex] ?? '').trim()
      const literal = unquote(pathExpr)
      if (literal !== null && API_PREFIX.test(literal)) {
        pin(method, literal)
        continue
      }
      if (/^[A-Za-z_$][\w$]*$/.test(pathExpr)) {
        const init = inits.get(pathExpr)
        if (init !== undefined) {
          const initLiteral = unquote(init.trim())
          if (initLiteral !== null && API_PREFIX.test(initLiteral)) {
            pin(method, initLiteral)
            continue
          }
          if (pinLiterals(method, init)) {
            dynamic.add(`${method} ${basename(file)} :: ${normalizeExpr(pathExpr)}`)
            continue
          }
        }
        dynamic.add(`${method} ${basename(file)} :: ${normalizeExpr(pathExpr)}`)
        continue
      }
      if (pinLiterals(method, pathExpr)) continue
      // A path built by a same-workspace helper (googlePath, sitePath,
      // historyUrl): pin what the helper builds, and the call itself.
      for (const hm of pathExpr.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!/path|url/i.test(hm[1])) continue
        const body = helperBody(hm[1], file, files)
        if (body !== null) pinLiterals(method, body)
      }
      dynamic.add(`${method} ${basename(file)} :: ${normalizeExpr(pathExpr)}`)
    }
  }
  return { http: [...http].sort(), dynamic: [...dynamic].sort(), ws: [...ws].sort() }
}

/** Split a type body on top-level `,`, `;` and newlines (unions use commas, interfaces newlines). */
function splitMembers(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(body, i); continue }
    // No angle brackets: a stray `=>` or comparison would unbalance the
    // depth, while a comma inside `Record<K, V>` only yields a part the key
    // pattern skips.
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if ((c === ',' || c === ';' || c === '\n') && depth === 0) { parts.push(body.slice(start, i)); start = i + 1 }
    i++
  }
  parts.push(body.slice(start))
  return parts
}

/** Top-level keys of `{ ... }` (and `& Name` intersections). */
function objectKeys(body: string): { keys: string[], refs: string[] } {
  const keys: string[] = []
  const refs: string[] = []
  for (const part of splitMembers(body)) {
    const key = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(part)?.[1]
    if (key) keys.push(key)
    for (const r of part.matchAll(/&\s*([A-Za-z_$][\w$]*)/g)) refs.push(r[1])
  }
  return { keys, refs }
}

/** Members of `export type Name = ...` up to the next blank line. */
function unionMembers(source: string, name: string): { type: string, fields: string[], refs: string[] }[] {
  const code = stripComments(source)
  const start = code.indexOf(`export type ${name} =`)
  if (start === -1) throw new Error(`type ${name} not found`)
  const rest = code.slice(start)
  const end = rest.indexOf('\n\n')
  const block = end === -1 ? rest : rest.slice(0, end)
  // Split the union on top-level `|`.
  const members: { type: string, fields: string[], refs: string[] }[] = []
  let depth = 0
  let current = ''
  const push = (): void => {
    const text = current.trim().replace(/^\|\s*/, '')
    current = ''
    if (!text || !text.includes('type:')) return
    const type = /type\s*:\s*'([^']+)'/.exec(text)?.[1]
    if (!type) return
    const refs = [...text.matchAll(/&\s*([A-Za-z_$][\w$]*)/g)].map((r) => r[1])
    const open = text.indexOf('{')
    const keys = open === -1 ? [] : objectKeys(text.slice(open + 1, text.lastIndexOf('}'))).keys
    members.push({ type, fields: [...keys, ...refs.map((r) => `&${r}`)].sort(), refs })
  }
  for (let i = 0; i < block.length; i++) {
    const c = block[i]
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(block, i)
      current += block.slice(i, end)
      i = end - 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (c === '|' && depth === 0) { push(); continue }
    current += c
  }
  push()
  return members.sort((a, b) => (a.type < b.type ? -1 : 1))
}

/** Top-level keys of `interface Name { ... }`. */
function interfaceKeys(source: string, name: string): string[] {
  const code = stripComments(source)
  const start = code.indexOf(`interface ${name} {`)
  if (start === -1) throw new Error(`interface ${name} not found`)
  let depth = 0
  let i = code.indexOf('{', start)
  const open = i
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return objectKeys(code.slice(open + 1, i)).keys.sort()
}

function collect(): ClientInterface {
  const { http, dynamic, ws } = collectHttp()
  const protocol = readFileSync(join(ROOT, 'server/chat/protocol.ts'), 'utf8')
  const terminal = readFileSync(join(ROOT, 'server/terminal/protocol.ts'), 'utf8')
  const commands = unionMembers(protocol, 'ChatCommand')
  const intersections: Record<string, string[]> = {}
  for (const ref of [...new Set(commands.flatMap((c) => c.refs))].sort()) {
    intersections[ref] = interfaceKeys(protocol, ref)
  }
  return {
    http,
    dynamic,
    // The terminal path lives in a shared const, so its value is pinned by import.
    ws: [...ws, TERMINAL_WS_PATH].sort(),
    commands: commands.map(({ type, fields }) => ({ type, fields })),
    intersections,
    terminalFrames: unionMembers(terminal, 'TerminalClientFrame').map(({ type, fields }) => ({ type, fields })),
  }
}

describe('client interface', () => {
  it('matches the pinned methods, paths and commands', () => {
    const actual = collect()
    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
      return
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')) as ClientInterface)
  })
})
