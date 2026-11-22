/**
 * Architecture map — remote auto-maintainer (node 16).
 *
 * Decides when a changed remote project may start a maintenance child. The
 * child is a normal DSH subagent; the plugin supplies `startChild`. Consent,
 * file-count, cooldown and single-flight limits live here.
 */
export const MAINTAINER_LIMITS = Object.freeze({
  maxFiles: 50,
  minIntervalMs: 10 * 60 * 1000,
})

export function buildMaintainerPrompt(ws, counts) {
  const id = ws.id
  const host = ws.project?.host ?? 'remote'
  const root = ws.project?.root ?? ''
  return [
    `You are the remote architecture maintainer for remote:${id} (${host}:${root}).`,
    `The remote changed: +${counts.added} added, ~${counts.changed} changed, -${counts.deleted} deleted.`,
    '',
    'Steps:',
    `1. Call arch_sync({ workspace: "remote:${id}", markStale: true }) to refresh the pending set.`,
    '2. Read only the changed files with arch_remote_read / arch_remote_grep. Never use local read, grep, glob or bash for this workspace.',
    '3. Update only affected node summaries, anchors, edges and dossier docs; keep stable ids.',
    '4. Call arch_manifest_commit with the files you actually analyzed.',
    '5. Do not write remote files. Do not touch unrelated nodes. Finish with one short summary.',
  ].join('\n')
}

function projectKey(ws) {
  return `${ws.pathBase}\0${ws.id}`
}

function totalOf(counts) {
  return (counts?.added ?? 0) + (counts?.changed ?? 0) + (counts?.deleted ?? 0)
}

/**
 * @param {object} options - `{ consent, startChild, now?, maxFiles?, minIntervalMs? }`.
 */
export function createMaintainer(options = {}) {
  const consent = options.consent
  const startChild = options.startChild
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : MAINTAINER_LIMITS.maxFiles
  const minIntervalMs = Number.isInteger(options.minIntervalMs) ? options.minIntervalMs : MAINTAINER_LIMITS.minIntervalMs
  const running = new Set()

  async function maybeRun(ws, context, counts, state = {}, settings = {}) {
    const total = totalOf(counts)
    if (total === 0) return { started: false, reason: 'no-changes' }
    if (!consent || typeof consent.autoMaintenanceAllowed !== 'function' || !consent.autoMaintenanceAllowed(ws)) {
      return { started: false, reason: 'no-workspace-consent' }
    }
    if (total > maxFiles) return { started: false, reason: 'too-many-files', total, maxFiles }
    const agent = context?.agent ?? context
    if (!agent) return { started: false, reason: 'no-agent' }
    const key = projectKey(ws)
    if (running.has(key)) return { started: false, reason: 'already-running' }
    const last = Date.parse(state.lastMaintainerAt ?? '')
    if (!settings.force && Number.isFinite(last) && now() - last < minIntervalMs) {
      return { started: false, reason: 'cooldown', retryAfterMs: minIntervalMs - (now() - last) }
    }
    if (typeof startChild !== 'function') return { started: false, reason: 'no-child-runner' }
    running.add(key)
    try {
      const child = await startChild({ ws, agent, counts })
      return {
        started: true,
        childId: String(child?.childId ?? child?.id ?? ''),
        name: child?.name,
      }
    } catch (error) {
      return { started: false, reason: 'start-failed', error }
    } finally {
      running.delete(key)
    }
  }

  function isRunning(ws) {
    return running.has(projectKey(ws))
  }

  return { maybeRun, isRunning, limits: { maxFiles, minIntervalMs } }
}
