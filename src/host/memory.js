/**
 * Architecture map — architecture memory (node 7).
 *
 * `.archmap/manifest.json` records content hashes of files that have been
 * analyzed. `arch_sync` compares the workspace against it and reports only
 * added/changed/deleted files plus affected graph nodes; `arch_manifest_commit`
 * is the explicit commit step after analysis. The dossier documents
 * (`overview.md`, `modules/<id>.md`, `notes/<id>.md`) are plain Markdown.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { hashBuffer, signatureOf } from './signature.js'
import { normalizeDataDir, resolveWorkspace } from './workspace.js'

const MANIFEST_SCHEMA = 1

const DEFAULT_LIMITS = Object.freeze({
  dir: '.archmap',
  maxFiles: 20000,
  maxFileBytes: 256 * 1024,
  maxDocBytes: 32 * 1024,
})

const IGNORED_DIRS = new Set([
  '.git', '.archmap', '.codegraph', 'node_modules', 'dist', 'build', 'out',
  'vendor', 'coverage', '.next', '.turbo', '.cache',
])

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.tar', '.wasm', '.node', '.mp4', '.mov', '.mp3', '.wav', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.class', '.so', '.dylib', '.dll', '.exe',
])

function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  throw error
}

function normalizeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_PATH', 'path must be a non-empty string')
  }
  if (path.isAbsolute(value) || value.includes('\\')) {
    fail('PATH_ESCAPE', `"${value}" must be a workspace-relative POSIX path`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('PATH_ESCAPE', `"${value}" must not contain empty, "." or ".." segments`)
  }
  return segments.join('/')
}

function docRelative(id) {
  if (typeof id !== 'string' || id.trim() === '') fail('INVALID_DOC', 'id must be a non-empty string')
  if (id === 'overview') return 'overview.md'
  const match = /^(modules|notes)\/([a-z0-9][a-z0-9._-]{0,63})$/.exec(id)
  if (!match) {
    fail('INVALID_DOC', 'id must be overview, modules/<id> or notes/<id> (lowercase id)')
  }
  return `${match[1]}/${match[2]}.md`
}

function looksTextual(buffer) {
  return !buffer.includes(0)
}

export function createMemoryStore(config = {}, deps = {}) {
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (config[key] !== undefined) limits[key] = config[key]
  }
  limits.dir = normalizeDataDir(limits.dir)
  for (const key of ['maxFiles', 'maxFileBytes', 'maxDocBytes']) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0) limits[key] = DEFAULT_LIMITS[key]
  }

  async function scan(rawWorkspace, context) {
    const ws = await resolveWorkspace(rawWorkspace, context, { dir: limits.dir })
    if (ws.kind === 'remote') {
      fail('REMOTE_SYNC_UNAVAILABLE', 'remote sync is not wired yet; the local project still works')
    }
    const root = ws.workspaceRoot
    const files = new Map()
    let truncated = false
    let skipped = 0

    const visit = async directory => {
      if (files.size >= limits.maxFiles) {
        truncated = true
        return
      }
      let entries
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.size >= limits.maxFiles) {
          truncated = true
          return
        }
        if (entry.isSymbolicLink()) continue
        const abs = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          await visit(abs)
          continue
        }
        if (!entry.isFile()) continue
        if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue
        let stat
        try {
          stat = await fs.stat(abs)
        } catch {
          continue
        }
        if (stat.size > limits.maxFileBytes) {
          skipped += 1
          continue
        }
        let buffer
        try {
          buffer = await fs.readFile(abs)
        } catch {
          continue
        }
        if (!looksTextual(buffer)) {
          skipped += 1
          continue
        }
        const rel = path.relative(root, abs).split(path.sep).join('/')
        files.set(rel, { sha256: hashBuffer(buffer), size: stat.size, signature: signatureOf(rel, buffer) })
      }
    }

    await visit(root)
    return { ws, root, files, truncated, skipped }
  }

  async function readManifest(ws) {
    const file = path.join(ws.stateDir, 'manifest.json')
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      fail('IO_ERROR', `cannot read manifest: ${error.message}`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      fail('MANIFEST_CORRUPT', `manifest.json is not valid JSON (${error.message})`)
    }
    if (!parsed || parsed.schema !== MANIFEST_SCHEMA || typeof parsed.files !== 'object' || parsed.files === null) {
      fail('MANIFEST_CORRUPT', 'manifest.json has an unsupported shape')
    }
    return parsed
  }

  async function writeManifest(ws, manifest) {
    await fs.mkdir(ws.stateDir, { recursive: true })
    const file = path.join(ws.stateDir, 'manifest.json')
    const temp = path.join(ws.stateDir, `manifest.tmp-${process.pid}-${randomBytes(6).toString('hex')}.json`)
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    await fs.rename(temp, file)
  }

  async function affectedNodes(ws, changedPaths, scannedFiles, context) {
    if (typeof deps.readGraph !== 'function') return []
    let graph
    try {
      graph = await deps.readGraph(ws, context)
    } catch {
      return []
    }
    const hashMismatch = anchor => {
      if (typeof anchor.hash !== 'string' || anchor.hash === '') return false
      const file = scannedFiles.get(anchor.path)
      // Missing/skipped files are handled by the path delta; do not flag a
      // binary or oversized anchor as stale just because it was not scanned.
      return file !== undefined && file.signature !== anchor.hash
    }
    const hits = []
    for (const node of graph.nodes) {
      const anchor = (node.anchors ?? []).find(item => changedPaths.has(item.path) || hashMismatch(item))
      if (anchor) hits.push({ id: node.id, title: node.title, path: anchor.path })
    }
    return hits
  }

  async function sync(rawWorkspace, input = {}, context) {
    const scanned = await scan(rawWorkspace, context)
    const ws = scanned.ws
    const manifest = await readManifest(ws)
    let scannedFiles = scanned.files
    let baseFiles = manifest?.files ?? {}

    if (Array.isArray(input.paths) && input.paths.length > 0) {
      const wanted = new Set(input.paths.map(item => normalizeRelative(item)))
      scannedFiles = new Map([...scannedFiles].filter(([key]) => wanted.has(key)))
      baseFiles = Object.fromEntries(Object.entries(baseFiles).filter(([key]) => wanted.has(key)))
    }

    const mode = !manifest || input.full === true ? 'full' : 'incremental'
    const added = []
    const changed = []
    const cosmetic = []
    const deleted = []
    if (mode === 'full') {
      added.push(...scannedFiles.keys())
    } else {
      for (const [file, info] of scannedFiles) {
        const previous = baseFiles[file]
        if (!previous) {
          added.push(file)
        } else if (previous.sha256 !== info.sha256 || previous.size !== info.size) {
          changed.push(file)
          if (previous.signature !== undefined && previous.signature === info.signature) {
            cosmetic.push(file)
          }
        }
      }
      for (const file of Object.keys(baseFiles)) {
        if (!scannedFiles.has(file)) deleted.push(file)
      }
    }

    added.sort()
    changed.sort()
    cosmetic.sort()
    deleted.sort()
    const cosmeticSet = new Set(cosmetic)
    const changedCode = changed.filter(file => !cosmeticSet.has(file))
    const affected = await affectedNodes(ws, new Set([...added, ...changedCode, ...deleted]), scanned.files, context)

    let marked = []
    let graphRev = null
    const lines = [
      `workspace: ${ws.display}`,
      `mode: ${mode}${manifest ? '' : ' (no manifest yet)'}`,
      `${scanned.files.size} scanned · ${added.length} added · ${changed.length} changed (${changedCode.length} code, ${cosmetic.length} cosmetic) · ${deleted.length} deleted`,
    ]
    if (mode === 'full' && manifest) lines.push('full:true ignores the manifest and lists every scannable file.')
    const section = (title, values) => {
      if (values.length === 0) return
      lines.push(`${title}:`)
      for (const value of values.slice(0, 100)) lines.push(`  ${value}`)
      if (values.length > 100) lines.push(`  … ${values.length - 100} more ${title}`)
    }
    section('added', added)
    section('changed (code)', changedCode)
    section('changed (format/comment-only)', cosmetic)
    section('deleted', deleted)
    if (affected.length > 0) {
      lines.push('affected nodes:')
      for (const node of affected.slice(0, 100)) lines.push(`  ${node.id} "${node.title}" — ${node.path}`)
      if (affected.length > 100) lines.push(`  … ${affected.length - 100} more nodes`)
    }
    if (scanned.truncated) lines.push(`truncated: stopped at ${limits.maxFiles} files`)
    if (scanned.skipped > 0) lines.push(`skipped ${scanned.skipped} binary/oversized file(s)`)
    if (added.length + changed.length + deleted.length === 0) lines.push('no changes against the manifest')
    if (mode === 'full' || !manifest) {
      lines.push('after analysis, call arch_manifest_commit with the files you actually read.')
    }
    if (input.markStale === true) {
      if (mode === 'full') {
        lines.push('markStale is ignored in full mode; use an incremental sync first.')
      } else if (affected.length === 0) {
        lines.push('markStale: no affected nodes to mark.')
      } else if (typeof deps.markStale !== 'function') {
        lines.push('markStale: graph writer unavailable; nodes were not marked.')
      } else {
        const result = await deps.markStale(ws, affected.map(node => node.id), context)
        marked = Array.isArray(result?.marked) ? result.marked : []
        graphRev = Number.isInteger(result?.rev) ? result.rev : null
        lines.push(`marked ${marked.length} node(s) stale${graphRev === null ? '' : ` (graph rev ${graphRev})`}`)
      }
    }
    return {
      text: lines.join('\n'),
      counts: {
        scanned: scanned.files.size,
        added: added.length,
        changed: changed.length,
        cosmetic: cosmetic.length,
        deleted: deleted.length,
        affected: affected.length,
        marked: marked.length,
      },
    }
  }

  async function commit(rawWorkspace, input = {}, context) {
    if (!Array.isArray(input.paths) || input.paths.length === 0) {
      fail('INVALID_PATH', 'paths must be a non-empty array of workspace-relative files')
    }
    const ws = await resolveWorkspace(rawWorkspace, context, { dir: limits.dir })
    if (ws.kind === 'remote') {
      fail('REMOTE_SYNC_UNAVAILABLE', 'remote commit is not wired yet; the local project still works')
    }
    const root = ws.workspaceRoot
    const manifest = await readManifest(ws) ?? {
      schema: MANIFEST_SCHEMA,
      generatedAt: null,
      root: '.',
      files: {},
    }
    const files = { ...manifest.files }
    let committed = 0
    let removed = 0
    for (const rawPath of input.paths) {
      const rel = normalizeRelative(rawPath)
      const abs = path.join(root, rel)
      try {
        const stat = await fs.stat(abs)
        if (!stat.isFile() || stat.size > limits.maxFileBytes) {
          delete files[rel]
          removed += 1
          continue
        }
        const buffer = await fs.readFile(abs)
        if (!looksTextual(buffer)) {
          delete files[rel]
          removed += 1
          continue
        }
        files[rel] = { sha256: hashBuffer(buffer), size: stat.size, signature: signatureOf(rel, buffer) }
        committed += 1
      } catch {
        if (rel in files) {
          delete files[rel]
          removed += 1
        }
      }
    }
    const next = {
      schema: MANIFEST_SCHEMA,
      generatedAt: new Date().toISOString(),
      root: '.',
      files,
    }
    await writeManifest(ws, next)
    return {
      text: `manifest updated: ${committed} committed · ${removed} removed · ${Object.keys(files).length} tracked`,
      committed,
      removed,
    }
  }

  async function getDoc(rawWorkspace, id, context) {
    const ws = await resolveWorkspace(rawWorkspace, context, { dir: limits.dir })
    const rel = docRelative(id)
    const file = path.join(ws.stateDir, rel)
    try {
      const text = await fs.readFile(file, 'utf8')
      return { text, found: true }
    } catch (error) {
      if (error && error.code === 'ENOENT') return { text: `Document "${id}" does not exist yet.`, found: false }
      fail('IO_ERROR', `cannot read ${id}: ${error.message}`)
    }
  }

  async function putDoc(rawWorkspace, input = {}, context) {
    if (typeof input.content !== 'string') fail('INVALID_DOC', 'content must be a string')
    if (input.content.length > limits.maxDocBytes) {
      fail('LIMIT_EXCEEDED', `content is ${input.content.length} characters; the limit is ${limits.maxDocBytes}`)
    }
    const mode = input.mode === 'append' ? 'append' : 'overwrite'
    const ws = await resolveWorkspace(rawWorkspace, context, { dir: limits.dir })
    const rel = docRelative(input.id)
    const file = path.join(ws.stateDir, rel)
    await fs.mkdir(path.dirname(file), { recursive: true })
    let content = input.content
    if (mode === 'append') {
      try {
        const existing = await fs.readFile(file, 'utf8')
        content = existing.trimEnd() + '\n\n' + content
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    if (!content.endsWith('\n')) content += '\n'
    if (content.length > limits.maxDocBytes) {
      fail('LIMIT_EXCEEDED', `the resulting document would be ${content.length} characters; the limit is ${limits.maxDocBytes}`)
    }
    const temp = file + `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
    return {
      text: `Wrote ${input.id} (${content.length} chars, ${mode}).`,
      bytes: Buffer.byteLength(content, 'utf8'),
    }
  }

  return { scan, sync, commit, getDoc, putDoc, limits }
}
