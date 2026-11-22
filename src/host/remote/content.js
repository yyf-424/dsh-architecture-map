/**
 * Architecture map — remote content source (node 12).
 *
 * Implements the read-only content contract over an SSH client: list paths,
 * batch-hash analyzed files, describe commit candidates, serve bounded reads,
 * grep and compute a change fingerprint. File contents never become local
 * files; only hashes and metadata leave the remote for sync.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { assertRemotePath, shQuote } from './ssh.js'

const IGNORED_DIRS = new Set([
  '.git', '.archmap', '.codegraph', 'node_modules', 'dist', 'build', 'out',
  'vendor', 'coverage', '.next', '.turbo', '.cache',
])

const DEFAULTS = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 256 * 1024,
  maxGrepResults: 200,
  hashChunk: 100,
})

function contentError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function assertRelative(value, where = 'path') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contentError('INVALID_PATH', `${where} must be a non-empty string`)
  }
  if (path.posix.isAbsolute(value) || value.includes('\\') || /[\0\n\r]/.test(value)) {
    throw contentError('PATH_ESCAPE', `${where} must be a workspace-relative POSIX path`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw contentError('PATH_ESCAPE', `${where} must not contain empty, "." or ".." segments`)
  }
  return segments.join('/')
}

function ignored(rel) {
  return rel.split('/').some(segment => IGNORED_DIRS.has(segment))
}

function stripDotSlash(value) {
  return value.startsWith('./') ? value.slice(2) : value
}

function parseNulPairs(output) {
  const parts = output.split('\0')
  const pairs = []
  for (let index = 0; index + 1 < parts.length; index += 2) {
    if (parts[index] !== '') pairs.push([parts[index], parts[index + 1]])
  }
  return pairs
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Create the read-only remote content source.
 * @param {object} config - `{ client, root, vcs?: 'auto'|'git'|'none', maxFiles?, maxFileBytes? }`.
 */
export function createRemoteContent(config = {}) {
  const client = config.client
  if (!client || typeof client.exec !== 'function' || typeof client.execShell !== 'function') {
    throw contentError('INVALID_CONTENT', 'a remote content source needs an SSH client')
  }
  const root = assertRemotePath(config.root, 'remote root')
  const maxFiles = Number.isInteger(config.maxFiles) ? config.maxFiles : DEFAULTS.maxFiles
  const maxFileBytes = Number.isInteger(config.maxFileBytes) ? config.maxFileBytes : DEFAULTS.maxFileBytes
  const configuredVcs = config.vcs ?? 'auto'
  if (!['auto', 'git', 'none'].includes(configuredVcs)) {
    throw contentError('INVALID_CONTENT', 'vcs must be auto, git or none')
  }

  let capabilitiesPromise
  let vcsPromise

  async function capabilities() {
    if (!capabilitiesPromise) capabilitiesPromise = client.probe()
    return capabilitiesPromise
  }

  async function hashCommand() {
    const caps = await capabilities()
    if (caps.sha256sum) return 'sha256sum'
    if (caps.shasum) return 'shasum -a 256'
    throw contentError('HASH_UNAVAILABLE', 'remote needs sha256sum or shasum -a 256')
  }

  let rootRealPromise
  async function canonicalRoot() {
    if (!rootRealPromise) {
      rootRealPromise = (async () => {
        try {
          const { stdout } = await client.exec(['readlink', '-f', '--', root])
          const value = stdout.trim()
          return value === '' ? root : value
        } catch {
          return root
        }
      })()
    }
    return rootRealPromise
  }

  /** Require `$f` to resolve inside the canonical remote root. */
  function containmentSnippet(rootReal, onFail = 'exit') {
    const prefix = `${rootReal === '/' ? '' : rootReal}/`
    const failure = onFail === 'continue' ? 'continue' : 'exit 6'
    const missing = onFail === 'continue' ? 'continue' : 'exit 5'
    return `f_real=$(readlink -f -- "$f" 2>/dev/null) || ${missing}; case "$f_real" in ${shQuote(prefix)}*) ;; *) ${failure} ;; esac;`
  }

  async function detectVcs() {
    if (configuredVcs !== 'auto') return configuredVcs
    if (!vcsPromise) {
      vcsPromise = (async () => {
        const caps = await capabilities()
        if (!caps.git) return 'none'
        try {
          const { stdout } = await client.exec(['git', '-C', root, 'rev-parse', '--is-inside-work-tree'])
          return stdout.trim() === 'true' ? 'git' : 'none'
        } catch {
          return 'none'
        }
      })()
    }
    return vcsPromise
  }

  async function listTree(options = {}) {
    const limit = Number.isInteger(options.maxFiles) ? options.maxFiles : maxFiles
    const kind = await detectVcs()
    let stdout
    if (kind === 'git') {
      const result = await client.exec(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      stdout = result.stdout
    } else {
      const prune = [...IGNORED_DIRS].map(name => `-name ${shQuote(name)}`).join(' -o ')
      const script = `cd ${shQuote(root)} && find . \\( ${prune} \\) -prune -o -type f -print0`
      const result = await client.execShell(script)
      stdout = result.stdout
    }
    const entries = []
    let truncated = false
    for (const raw of stdout.split('\0')) {
      if (raw === '') continue
      const rel = stripDotSlash(raw)
      if (rel === '' || ignored(rel) || /[\0\n\r]/.test(rel)) continue
      if (entries.length >= limit) {
        truncated = true
        break
      }
      entries.push({ path: rel })
    }
    return { entries, truncated, vcs: kind }
  }

  async function hashMany(rels) {
    const wanted = [...new Set((rels ?? []).map(rel => assertRelative(rel)))]
    if (wanted.length === 0) return new Map()
    const command = await hashCommand()
    const check = containmentSnippet(await canonicalRoot(), 'continue')
    const hashes = new Map()
    const chunkSize = DEFAULTS.hashChunk
    for (let offset = 0; offset < wanted.length; offset += chunkSize) {
      const chunk = wanted.slice(offset, offset + chunkSize)
      const words = chunk.map(rel => shQuote(rel)).join(' ')
      const script = `cd ${shQuote(root)} && for f in ${words}; do if [ -f "$f" ]; then ${check} h=$(${command} -- "$f" | cut -d' ' -f1); printf '%s\\0%s\\0' "$f" "$h"; fi; done`
      const { stdout } = await client.execShell(script)
      for (const [rel, hash] of parseNulPairs(stdout)) {
        if (/^[0-9a-f]{64}$/.test(hash)) hashes.set(rel, hash)
      }
    }
    return hashes
  }

  async function describe(rel, options = {}) {
    const target = assertRelative(rel)
    const limit = Number.isInteger(options.maxFileBytes) ? options.maxFileBytes : maxFileBytes
    const command = await hashCommand()
    const check = containmentSnippet(await canonicalRoot())
    const script = `cd ${shQuote(root)} && f=${shQuote(target)}; ${check} if [ ! -e "$f" ]; then printf 'missing\\n'; elif [ ! -f "$f" ]; then printf 'not-file\\n'; else s=$(wc -c < "$f" | tr -d ' '); if [ "$s" -gt ${limit} ]; then printf 'oversized %s\\n' "$s"; else t=$(tr -d '\\0' < "$f" | wc -c | tr -d ' '); if [ "$t" -ne "$s" ]; then printf 'binary %s\\n' "$s"; else h=$(${command} -- "$f" | cut -d' ' -f1); printf 'text %s %s\\n' "$s" "$h"; fi; fi; fi`
    let stdout
    try {
      ({ stdout } = await client.execShell(script))
    } catch (error) {
      if (error?.exitCode === 5) return { kind: 'missing' }
      if (error?.exitCode === 6) throw contentError('PATH_ESCAPE', `"${target}" escapes the remote root`)
      throw error
    }
    const fields = stdout.trim().split(/\s+/)
    const kind = fields[0]
    if (kind === 'text') {
      return { kind, size: Number(fields[1]), sha256: fields[2] }
    }
    if (kind === 'oversized' || kind === 'binary') {
      return { kind, size: Number(fields[1]) }
    }
    return { kind: kind === 'not-file' ? 'not-file' : 'missing' }
  }

  async function readText(rel, options = {}) {
    const target = assertRelative(rel)
    const limit = Number.isInteger(options.maxBytes) ? options.maxBytes : maxFileBytes
    const check = containmentSnippet(await canonicalRoot())
    const script = `cd ${shQuote(root)} && f=${shQuote(target)}; ${check} if [ ! -f "$f" ]; then exit 4; fi; s=$(wc -c < "$f" | tr -d ' '); if [ "$s" -gt ${limit} ]; then exit 3; fi; cat -- "$f"`
    try {
      const { stdout } = await client.execShell(script)
      return stdout
    } catch (error) {
      if (error?.exitCode === 3 || error?.exitCode === 4 || error?.exitCode === 5) return null
      if (error?.exitCode === 6) throw contentError('PATH_ESCAPE', `"${target}" escapes the remote root`)
      throw error
    }
  }

  async function readRange(rel, range = {}) {
    const target = assertRelative(rel)
    const offset = Number.isInteger(range.offset) && range.offset >= 0 ? range.offset : 0
    const length = Number.isInteger(range.length) && range.length > 0 ? range.length : maxFileBytes
    const check = containmentSnippet(await canonicalRoot())
    const script = `cd ${shQuote(root)} && f=${shQuote(target)}; ${check} if [ ! -f "$f" ]; then exit 4; fi; s=$(wc -c < "$f" | tr -d ' '); printf '%s\\n' "$s" >&2; tail -c +$(( ${offset} + 1 )) "$f" | head -c ${length}`
    try {
      const { stdout, stderr } = await client.execShell(script)
      const sizeLines = [...String(stderr).matchAll(/^\s*(\d+)\s*$/gm)]
      const size = sizeLines.length > 0 ? Number(sizeLines[sizeLines.length - 1][1]) : Number.NaN
      const bytes = Math.max(0, Math.min(length, Number.isFinite(size) ? size - offset : length))
      return {
        text: stdout,
        offset,
        bytes,
        eof: Number.isFinite(size) ? offset + bytes >= size : false,
      }
    } catch (error) {
      if (error?.exitCode === 4 || error?.exitCode === 5) return { text: '', offset, bytes: 0, eof: true }
      if (error?.exitCode === 6) throw contentError('PATH_ESCAPE', `"${target}" escapes the remote root`)
      throw error
    }
  }

  async function grep(pattern, options = {}) {
    if (typeof pattern !== 'string' || pattern === '') {
      throw contentError('INVALID_PATTERN', 'grep pattern must be a non-empty string')
    }
    const caps = await capabilities()
    const limit = Number.isInteger(options.maxResults) ? options.maxResults : DEFAULTS.maxGrepResults
    const target = options.path === undefined ? '.' : assertRelative(options.path)
    const context = Number.isInteger(options.context) && options.context > 0 ? options.context : 0
    const include = typeof options.include === 'string' && options.include !== '' ? options.include : undefined
    const argv = caps.rg
      ? ['rg', '--no-config', '--line-number', '--color', 'never', '--no-heading',
          ...(context > 0 ? ['-C', String(context)] : []),
          ...(include ? ['-g', include] : []),
          '-e', pattern, '--', target]
      : ['grep', '-rInI',
          ...(context > 0 ? ['-C', String(context)] : []),
          ...(include ? ['--include', include] : []),
          '-e', pattern, '--', target]
    const script = `cd ${shQuote(root)} && ${argv.map(shQuote).join(' ')}`
    let stdout
    try {
      ({ stdout } = await client.execShell(script))
    } catch (error) {
      if (error?.exitCode === 1) return { matches: [], truncated: false, engine: caps.rg ? 'rg' : 'grep' }
      throw error
    }
    const matches = []
    let truncated = false
    for (const line of stdout.split(/\r?\n/)) {
      if (line === '') continue
      const first = line.indexOf(':')
      const second = first >= 0 ? line.indexOf(':', first + 1) : -1
      if (second < 0) continue
      const file = line.slice(0, first)
      const lineNumber = Number(line.slice(first + 1, second))
      if (!Number.isInteger(lineNumber)) continue
      if (matches.length >= limit) {
        truncated = true
        break
      }
      matches.push({ path: stripDotSlash(file), line: lineNumber, text: line.slice(second + 1) })
    }
    return { matches, truncated, engine: caps.rg ? 'rg' : 'grep' }
  }

  async function stat(rel) {
    const target = assertRelative(rel)
    const check = containmentSnippet(await canonicalRoot())
    const script = `cd ${shQuote(root)} && f=${shQuote(target)}; ${check} if [ -f "$f" ]; then printf 'file %s\\n' "$(wc -c < "$f" | tr -d ' ')"; elif [ -d "$f" ]; then printf 'directory 0\\n'; else printf 'missing\\n'; fi`
    let stdout
    try {
      ({ stdout } = await client.execShell(script))
    } catch (error) {
      if (error?.exitCode === 5) return null
      if (error?.exitCode === 6) throw contentError('PATH_ESCAPE', `"${target}" escapes the remote root`)
      throw error
    }
    const fields = stdout.trim().split(/\s+/)
    if (fields[0] === 'file') return { type: 'file', size: Number(fields[1]) }
    if (fields[0] === 'directory') return { type: 'directory', size: 0 }
    return null
  }

  async function fingerprint() {
    const kind = await detectVcs()
    if (kind === 'git') {
      let head = null
      try {
        const result = await client.exec(['git', '-C', root, 'rev-parse', 'HEAD'])
        head = result.stdout.trim() || null
      } catch {
        head = null
      }
      const status = await client.exec(['git', '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
      return {
        vcs: 'git',
        head,
        dirty: status.stdout !== '',
        digest: sha256(`${head ?? ''}\0${status.stdout}`),
      }
    }
    // Non-git fingerprints use path + size + mtime metadata only. No content is
    // read or hashed for change detection.
    const prune = [...IGNORED_DIRS].map(name => `-name ${shQuote(name)}`).join(' -o ')
    const script = `cd ${shQuote(root)} || exit 1; if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then find . \\( ${prune} \\) -prune -o -type f -printf '%P\\0%s\\0%T@\\0'; elif stat -c '%n' . >/dev/null 2>&1; then find . \\( ${prune} \\) -prune -o -type f -exec stat -c '%n\\0%s\\0%Y\\0' {} +; else find . \\( ${prune} \\) -prune -o -type f -exec stat -f '%N\\0%z\\0%m\\0' {} +; fi`
    const { stdout } = await client.execShell(script)
    const parts = stdout.split('\0')
    const entries = []
    for (let index = 0; index + 2 < parts.length; index += 3) {
      const rel = stripDotSlash(parts[index])
      if (rel === '' || ignored(rel) || /[\0\n\r]/.test(rel)) continue
      entries.push({ path: rel, size: parts[index + 1], mtime: parts[index + 2] })
    }
    return {
      vcs: 'none',
      head: null,
      dirty: null,
      digest: sha256(entries
        .map(entry => `${entry.path}\0${entry.size}\0${entry.mtime}`)
        .sort()
        .join('\0')),
      entries: entries.length,
    }
  }

  return {
    kind: 'remote',
    root,
    hashMode: 'sha256',
    detectVcs,
    listTree,
    hashMany,
    describe,
    readText,
    readRange,
    grep,
    stat,
    fingerprint,
  }
}
