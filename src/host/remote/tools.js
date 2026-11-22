/**
 * Architecture map — remote read tools (node 14).
 *
 * These handlers are the only model-facing way to inspect a remote project.
 * Every content/structure read passes the consent gate first; status and the
 * project list expose metadata only. Handlers return `{ text }` so the plugin
 * can wrap them in ordinary tool definitions.
 */
import { loadIndex } from '../projects.js'
import { normalizeDataDir, resolveWorkspace } from '../workspace.js'

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const DEFAULT_READ_BYTES = 512 * 1024

function remoteError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function clamp(value, min, max, fallback) {
  const number = Number.isInteger(value) ? value : fallback
  return Math.min(Math.max(number, min), max)
}

/**
 * @param {object} options - `{ config: {dir, ssh}, consent }`.
 */
export function createRemoteTools(options = {}) {
  const config = options.config ?? {}
  const consent = options.consent
  const onUse = options.onUse
  const dir = normalizeDataDir(config.dir)

  async function hubRoot(args, exec) {
    const explicit = typeof args?.workspace === 'string' ? args.workspace.trim() : ''
    const raw = explicit !== '' ? explicit : exec?.agent?.session?.header?.cwd
    if (typeof raw !== 'string' || raw === '') {
      throw remoteError('REMOTE_WORKSPACE_REQUIRED', 'pass workspace or open a session with a working directory')
    }
    const ws = await resolveWorkspace(raw, exec, config)
    return ws.pathBase
  }

  async function remoteWorkspace(args, exec) {
    const id = typeof args?.id === 'string' ? args.id.trim() : ''
    if (!ID_PATTERN.test(id) || id === 'local') {
      throw remoteError('INVALID_PROJECT', 'id must be a registered remote project id')
    }
    const ws = await resolveWorkspace(`remote:${id}`, exec, config)
    if (ws.kind !== 'remote') throw remoteError('INVALID_PROJECT', `project "${id}" is not remote`)
    if (typeof onUse === 'function') onUse(ws, exec)
    return ws
  }

  async function ensureConsent(ws, exec) {
    if (!consent || typeof consent.ensure !== 'function') {
      throw remoteError('REMOTE_CONSENT_UNAVAILABLE', 'the consent gate is not available')
    }
    const decision = await consent.ensure(ws, exec, { signal: exec?.signal })
    if (decision.allowed) return decision
    if (decision.reason === 'no-answerer') {
      throw remoteError('REMOTE_CONSENT_UNAVAILABLE', 'no user-questions answerer; remote content stays unavailable')
    }
    if (decision.reason === 'no-agent') {
      throw remoteError('REMOTE_CONSENT_CONTEXT', 'the tool call has no owning session')
    }
    if (decision.reason === 'ask-failed') {
      throw remoteError('REMOTE_CONSENT_FAILED', decision.error?.message ?? 'the consent question failed')
    }
    if (decision.reason === 'rejected') {
      throw remoteError('REMOTE_CONSENT_REQUIRED', 'the user did not allow remote content')
    }
    throw remoteError('REMOTE_CONSENT_REQUIRED', 'remote content is not allowed')
  }

  async function list(args = {}, exec) {
    const hub = await hubRoot(args, exec)
    const index = await loadIndex(hub, dir)
    const lines = [`projects (${index.projects.length}):`]
    for (const project of index.projects) {
      if (project.kind === 'local') {
        lines.push(`  local · local project · .`)
        continue
      }
      const consentScope = project.consent?.scope ?? 'none'
      lines.push(`  ${project.id} · ssh ${project.host}:${project.root} · vcs ${project.vcs} · consent ${consentScope}${project.autoRefresh ? ' · auto' : ''}`)
    }
    return { text: lines.join('\n') }
  }

  async function status(args = {}, exec) {
    const ws = await remoteWorkspace(args, exec)
    const fingerprint = await ws.content.fingerprint()
    const allowed = consent?.isAllowed ? consent.isAllowed(ws, exec).scope ?? 'none' : 'none'
    const head = fingerprint.head ? `@${fingerprint.head.slice(0, 12)}` : ''
    const dirty = fingerprint.vcs === 'git' ? (fingerprint.dirty ? 'dirty' : 'clean') : 'non-git'
    return {
      text: [
        `remote:${ws.id} · ${fingerprint.vcs}${head} · ${dirty} · consent ${allowed}`,
        `digest: ${fingerprint.digest}`,
      ].join('\n'),
    }
  }

  async function tree(args = {}, exec) {
    const ws = await remoteWorkspace(args, exec)
    await ensureConsent(ws, exec)
    const maxEntries = clamp(args.maxEntries, 1, 2_000, 500)
    const tree = await ws.content.listTree({ maxFiles: Math.max(maxEntries, 1_000) })
    const shown = tree.entries.slice(0, maxEntries)
    const lines = [`remote:${ws.id} · ${shown.length}/${tree.entries.length} paths${tree.truncated ? ' · listing truncated' : ''}`]
    for (const entry of shown) lines.push(`  ${entry.path}`)
    if (tree.entries.length > shown.length) lines.push(`  … ${tree.entries.length - shown.length} more`)
    return { text: lines.join('\n') }
  }

  async function read(args = {}, exec) {
    const ws = await remoteWorkspace(args, exec)
    await ensureConsent(ws, exec)
    const target = typeof args.path === 'string' ? args.path.trim() : ''
    if (target === '') throw remoteError('INVALID_PATH', 'path is required')
    const info = await ws.content.describe(target)
    if (info.kind === 'missing') throw remoteError('REMOTE_NOT_FOUND', `remote file "${target}" does not exist`)
    if (info.kind === 'not-file') throw remoteError('REMOTE_NOT_FILE', `remote path "${target}" is not a regular file`)
    if (info.kind === 'binary') throw remoteError('REMOTE_BINARY', `remote file "${target}" is binary`)
    if (info.kind === 'oversized') {
      throw remoteError('REMOTE_TOO_LARGE', `remote file "${target}" is ${info.size} bytes; use arch_remote_grep`)
    }
    const text = await ws.content.readText(target, { maxBytes: DEFAULT_READ_BYTES })
    if (text === null) throw remoteError('REMOTE_READ_FAILED', `cannot read remote file "${target}"`)
    const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
    const offset = clamp(args.offset, 1, Math.max(lines.length, 1), 1)
    const limit = clamp(args.limit, 1, 400, 200)
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const end = slice.length === 0 ? offset - 1 : offset + slice.length - 1
    const header = `remote:${ws.id}:${target} · lines ${offset}-${end} of ${lines.length}${offset - 1 + slice.length >= lines.length ? ' · eof' : ''}`
    const body = slice.map((line, index) => `${String(offset + index).padStart(4, ' ')}| ${line}`).join('\n')
    return { text: body === '' ? header : `${header}\n${body}` }
  }

  async function grep(args = {}, exec) {
    const ws = await remoteWorkspace(args, exec)
    await ensureConsent(ws, exec)
    const pattern = typeof args.pattern === 'string' ? args.pattern : ''
    if (pattern === '') throw remoteError('INVALID_PATTERN', 'pattern is required')
    const pathValue = typeof args.path === 'string' && args.path.trim() !== '' && args.path.trim() !== '.'
      ? args.path.trim()
      : undefined
    const result = await ws.content.grep(pattern, {
      include: typeof args.include === 'string' ? args.include : undefined,
      path: pathValue,
      context: clamp(args.context, 0, 5, 0),
      maxResults: clamp(args.maxResults, 1, 200, 100),
    })
    const lines = [`remote:${ws.id} · ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} (${result.engine})${result.truncated ? ' · truncated' : ''}`]
    for (const match of result.matches) lines.push(`  ${match.path}:${match.line}: ${match.text}`)
    return { text: lines.join('\n') }
  }

  return { list, status, tree, read, grep }
}
