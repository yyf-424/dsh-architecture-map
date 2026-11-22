/**
 * Local filesystem implementation of the read-only content contract.
 *
 * This is the previous memory scan moved behind one object, so the graph store
 * and the memory store no longer read workspace files directly. The behavior
 * (ignored directories, binary/oversized rejection, sha256 and normalized
 * signature) is intentionally identical to the pre-refactor code.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hashBuffer, signatureOf } from '../signature.js'
import { contentFail } from './index.js'

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 256 * 1024,
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

function looksTextual(buffer) {
  return !buffer.includes(0)
}

/** True when a workspace-relative path has a known binary extension. */
export function isBinaryPath(relative) {
  return BINARY_EXTS.has(path.posix.extname(relative).toLowerCase())
}

function relativeOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/')
}

export function createLocalContent(root, options = {}) {
  const defaults = { ...DEFAULT_LIMITS, ...options }

  function absolute(rel) {
    if (typeof rel !== 'string' || rel.trim() === '') {
      contentFail('INVALID_PATH', 'path must be a non-empty string')
    }
    if (path.isAbsolute(rel) || rel.includes('\\')) {
      contentFail('PATH_ESCAPE', `"${rel}" must be a workspace-relative POSIX path`)
    }
    const segments = rel.split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      contentFail('PATH_ESCAPE', `"${rel}" must not contain empty, "." or ".." segments`)
    }
    const abs = path.resolve(root, rel)
    const prefix = root.endsWith(path.sep) ? root : root + path.sep
    if (!abs.startsWith(prefix)) {
      contentFail('PATH_ESCAPE', `"${rel}" escapes the workspace`)
    }
    return abs
  }

  async function listTree(limit = defaults.maxFiles) {
    const entries = []
    let truncated = false
    const visit = async directory => {
      if (entries.length >= limit) {
        truncated = true
        return
      }
      let children
      try {
        children = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= limit) {
          truncated = true
          return
        }
        if (entry.isSymbolicLink()) continue
        if (IGNORED_DIRS.has(entry.name)) continue
        const abs = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(abs)
          continue
        }
        if (!entry.isFile()) continue
        let size
        try {
          size = (await fs.stat(abs)).size
        } catch {
          continue
        }
        entries.push({ path: relativeOf(root, abs), size })
      }
    }
    await visit(root)
    return { entries, truncated }
  }

  async function scan(limits = {}) {
    const maxFiles = limits.maxFiles ?? defaults.maxFiles
    const maxFileBytes = limits.maxFileBytes ?? defaults.maxFileBytes
    const files = new Map()
    let truncated = false
    let skipped = 0

    const visit = async directory => {
      if (files.size >= maxFiles) {
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
        if (files.size >= maxFiles) {
          truncated = true
          return
        }
        if (entry.isSymbolicLink()) continue
        if (IGNORED_DIRS.has(entry.name)) continue
        const abs = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(abs)
          continue
        }
        if (!entry.isFile()) continue
        if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue
        let size
        try {
          size = (await fs.stat(abs)).size
        } catch {
          continue
        }
        if (size > maxFileBytes) {
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
        const rel = relativeOf(root, abs)
        files.set(rel, { sha256: hashBuffer(buffer), size, signature: signatureOf(rel, buffer) })
      }
    }

    await visit(root)
    return { files, truncated, skipped }
  }

  /** Anchor hashes: the normalized content signature, exactly as before. */
  async function hashMany(rels) {
    const hashes = new Map()
    for (const rel of rels ?? []) {
      try {
        const buffer = await fs.readFile(absolute(rel))
        hashes.set(rel, signatureOf(rel, buffer))
      } catch {
        // Missing or unreadable anchors keep no hash; callers leave them untouched.
      }
    }
    return hashes
  }

  async function describe(rel, limits = {}) {
    const maxFileBytes = limits.maxFileBytes ?? defaults.maxFileBytes
    const abs = absolute(rel)
    let stat
    try {
      stat = await fs.stat(abs)
    } catch (error) {
      if (error && error.code === 'ENOENT') return { kind: 'missing' }
      contentFail('IO_ERROR', `cannot stat "${rel}": ${error.message}`)
    }
    if (!stat.isFile()) return { kind: 'not-file', size: stat.size }
    if (stat.size > maxFileBytes) return { kind: 'oversized', size: stat.size }
    const buffer = await fs.readFile(abs)
    if (!looksTextual(buffer)) return { kind: 'binary', size: stat.size }
    return {
      kind: 'text',
      size: stat.size,
      sha256: hashBuffer(buffer),
      signature: signatureOf(rel, buffer),
    }
  }

  async function readText(rel, limits = {}) {
    const maxBytes = limits.maxBytes ?? defaults.maxFileBytes
    const abs = absolute(rel)
    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      return null
    }
    if (!stat.isFile() || stat.size > maxBytes) return null
    const buffer = await fs.readFile(abs)
    if (!looksTextual(buffer)) return null
    return buffer.toString('utf8')
  }

  async function readRange(rel, range = {}) {
    const offset = Number.isInteger(range.offset) && range.offset >= 0 ? range.offset : 0
    const length = Number.isInteger(range.length) && range.length > 0 ? range.length : defaults.maxFileBytes
    const buffer = await fs.readFile(absolute(rel))
    const slice = buffer.subarray(offset, offset + length)
    return { text: slice.toString('utf8'), offset, bytes: slice.length, eof: offset + slice.length >= buffer.length }
  }

  async function stat(rel) {
    try {
      const info = await fs.stat(absolute(rel))
      return {
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      contentFail('IO_ERROR', `cannot stat "${rel}": ${error.message}`)
    }
  }

  return {
    kind: 'local',
    root,
    hashMode: 'signature',
    listTree,
    scan,
    hashMany,
    describe,
    readText,
    readRange,
    stat,
  }
}
