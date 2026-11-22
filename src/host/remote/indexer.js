/**
 * Architecture map — remote change indexer (node 15).
 *
 * Polls tracked remote projects with a cheap fingerprint, runs the existing
 * manifest-only sync when it changes, writes `remote-state.json` and hands the
 * change counts to the auto-maintainer. Polling never reads file content for
 * the model and never writes remotely.
 */
import { emptyRemoteState, readRemoteState, writeRemoteState } from './state.js'

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000
const DEFAULT_MAX_FAILURES = 6

function projectKey(ws) {
  return `${ws.pathBase}\0${ws.id}`
}

function countTotal(counts) {
  return (counts?.added ?? 0) + (counts?.changed ?? 0) + (counts?.deleted ?? 0)
}

function iso(ms) {
  return new Date(ms).toISOString()
}

/**
 * @param {object} options - `{ memory, maintainer?, now?, intervalMs? }`.
 */
export function createRemoteIndexer(options = {}) {
  const memory = options.memory
  const maintainer = options.maintainer ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS
  const scheduleFn = options.setTimeout ?? setTimeout
  const cancelFn = options.clearTimeout ?? clearTimeout
  const entries = new Map()
  let disposed = false

  function contextOf(context) {
    return context ?? undefined
  }

  async function check(ws, context, settings = {}) {
    if (!ws || ws.kind !== 'remote' || !ws.content) {
      throw new Error('REMOTE_INDEXER: a remote workspace with content is required')
    }
    const checkedAt = iso(now())
    const fingerprint = await ws.content.fingerprint()
    const previous = await readRemoteState(ws)
    const base = previous ?? emptyRemoteState(ws)
    if (!previous?.fingerprint?.digest) {
      const state = await writeRemoteState(ws, {
        ...base,
        fingerprint,
        lastCheckedAt: checkedAt,
        lastError: null,
      })
      return { changed: false, first: true, state }
    }
    if (previous.fingerprint.digest === fingerprint.digest) {
      const state = await writeRemoteState(ws, {
        ...base,
        fingerprint,
        lastCheckedAt: checkedAt,
        lastError: null,
      })
      return { changed: false, first: false, state }
    }

    const sync = await memory.sync(ws, { markStale: true }, contextOf(context))
    const counts = sync.counts
    const total = countTotal(counts)
    const pendingSince = total > 0 ? (previous.pending?.since ?? checkedAt) : null
    let state = await writeRemoteState(ws, {
      ...base,
      fingerprint,
      lastCheckedAt: checkedAt,
      lastIndexedAt: checkedAt,
      pending: { added: counts.added, changed: counts.changed, deleted: counts.deleted, count: total, since: pendingSince },
      syncState: 'idle',
      lastError: null,
    })

    let maintenance = null
    if (maintainer && total > 0 && settings.maintainer !== false) {
      maintenance = await maintainer.maybeRun(ws, contextOf(context), counts, state)
      if (maintenance?.started) {
        state = await writeRemoteState(ws, {
          ...state,
          syncState: 'maintaining',
          lastMaintainerAt: checkedAt,
        })
      }
    }
    return { changed: true, first: false, counts, state, maintenance }
  }

  async function run(entry) {
    if (entry.running) return entry.current
    entry.running = true
    entry.current = (async () => {
      try {
        const result = await check(entry.ws, entry.context)
        entry.failures = 0
        return result
      } catch (error) {
        entry.failures = Math.min(entry.failures + 1, DEFAULT_MAX_FAILURES)
        const previous = await readRemoteState(entry.ws).catch(() => null)
        await writeRemoteState(entry.ws, {
          ...(previous ?? emptyRemoteState(entry.ws)),
          lastCheckedAt: iso(now()),
          lastError: String(error?.message ?? error),
        }).catch(() => {})
        return { error }
      } finally {
        entry.running = false
        if (!disposed && intervalMs > 0) schedule(entry)
      }
    })()
    return entry.current
  }

  function schedule(entry) {
    if (disposed || intervalMs <= 0) return
    if (entry.timer) cancelFn(entry.timer)
    const backoff = entry.failures > 0
      ? Math.min(intervalMs * 2 ** entry.failures, DEFAULT_MAX_BACKOFF_MS)
      : intervalMs
    entry.timer = scheduleFn(() => {
      entry.timer = null
      void run(entry)
    }, backoff)
    entry.timer?.unref?.()
  }

  /** Start (or refresh) polling for one remote project. */
  function track(ws, context, settings = {}) {
    if (disposed) throw new Error('REMOTE_INDEXER: the indexer is disposed')
    if (!ws || ws.kind !== 'remote') throw new Error('REMOTE_INDEXER: a remote workspace is required')
    const key = projectKey(ws)
    let entry = entries.get(key)
    if (!entry) {
      entry = { ws, context, timer: null, running: false, current: null, failures: 0 }
      entries.set(key, entry)
    }
    entry.ws = ws
    entry.context = context
    if (settings.immediate !== false) void run(entry)
    else if (!entry.timer) schedule(entry)
    return entry
  }

  function untrack(ws) {
    const key = projectKey(ws)
    const entry = entries.get(key)
    if (!entry) return false
    if (entry.timer) cancelFn(entry.timer)
    entries.delete(key)
    return true
  }

  async function status(ws) {
    return readRemoteState(ws)
  }

  function dispose() {
    disposed = true
    for (const entry of entries.values()) {
      if (entry.timer) cancelFn(entry.timer)
    }
    entries.clear()
  }

  function tracked() {
    return [...entries.keys()]
  }

  return { track, untrack, check, status, dispose, tracked, intervalMs }
}
