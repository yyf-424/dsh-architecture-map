/**
 * Shared content signatures.
 *
 * `sha256` is the exact file hash used by the manifest. `signature` normalizes
 * comments and whitespace for common code files so a format/comment-only edit
 * does not look like an implementation change; anchors store this signature.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.kt', '.kts', '.cs', '.rb', '.php', '.swift', '.c', '.h', '.cc', '.cpp',
  '.hpp', '.m', '.mm', '.sh', '.bash', '.zsh',
])

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Normalized code signature for cosmetic-change detection: comments and
 * whitespace are removed, so a comment/format-only edit keeps the same
 * signature while an implementation edit changes it. This is a heuristic:
 * comment markers inside string literals can be stripped too.
 */
export function signatureOf(relativePath, buffer) {
  const ext = path.extname(relativePath).toLowerCase()
  const text = buffer.toString('utf8')
  if (!CODE_EXTS.has(ext)) {
    return hashBuffer(Buffer.from(text.replace(/\s+/g, ' ').trim()))
  }
  let normalized = text.replace(/\r\n?/g, '\n')
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, ' ')
  normalized = normalized.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  if (['.py', '.sh', '.bash', '.zsh', '.rb'].includes(ext)) {
    normalized = normalized.replace(/(^|\s)#[^\n]*/g, '$1 ')
  }
  normalized = normalized.replace(/<!--[\s\S]*?-->/g, ' ')
  normalized = normalized.replace(/\s+/g, ' ').trim()
  return hashBuffer(Buffer.from(normalized))
}
