/**
 * Read-only content contract shared by the local filesystem and the SSH source.
 *
 * The graph store asks for anchor hashes; the memory store asks for a scan and
 * per-file commit info. Remote model tools (W7) add on-demand reads through the
 * same object.
 */
export class ContentError extends Error {
  constructor(message, code = 'CONTENT_ERROR') {
    super(`${code}: ${message}`)
    this.name = 'ContentError'
    this.code = code
  }
}

export function contentFail(code, message) {
  throw new ContentError(message, code)
}

export { createLocalContent } from './local.js'
