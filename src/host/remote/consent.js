/**
 * Architecture map — remote content consent gate (node 13).
 *
 * Remote content only enters the model context after the user answers a
 * blocking approval question. Grants are either session-scoped (including the
 * children that session starts) or workspace-scoped and stored in
 * `.archmap/index.json`; without the user-questions service the gate fails
 * closed.
 */
import path from 'node:path'
import { writeIndex } from '../projects.js'

export const CONSENT = Object.freeze({
  session: '允许，本次会话',
  always: '始终允许这个远程',
  reject: '拒绝',
})

const DETAIL = '只读：不会修改远程文件，也不会在本地保存源码副本。'

function consentError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function agentOf(context) {
  return context?.agent ?? context
}

function sessionIdOf(context) {
  const id = agentOf(context)?.session?.id
  return typeof id === 'string' && id !== '' ? id : null
}

function projectKey(ws) {
  return `${ws.pathBase}\0${ws.id}`
}

function projectDirRelative(ws) {
  if (typeof ws.dataDir !== 'string') {
    throw consentError('CONSENT_UNAVAILABLE', 'the workspace descriptor has no data directory')
  }
  const relative = path.relative(ws.pathBase, ws.dataDir)
  return relative === '' ? '.' : relative.split(path.sep).join('/')
}

function withoutConsent(project) {
  const next = { ...project }
  delete next.consent
  return next
}

/**
 * @param {object} config - `{ getUserQuestions?: () => service, now?: () => Date }`.
 */
export function createConsentGate(config = {}) {
  const getUserQuestions = typeof config.getUserQuestions === 'function'
    ? config.getUserQuestions
    : () => undefined
  const now = typeof config.now === 'function' ? config.now : () => new Date()
  const sessions = new Set()

  function workspaceConsent(ws) {
    return ws?.project?.consent?.scope === 'workspace'
  }

  function sessionGrant(ws, sessionId) {
    return typeof sessionId === 'string' && sessions.has(`${projectKey(ws)}\0${sessionId}`)
  }

  function isAllowed(ws, context) {
    if (workspaceConsent(ws)) return { allowed: true, scope: 'workspace' }
    if (sessionGrant(ws, sessionIdOf(context))) return { allowed: true, scope: 'session' }
    return { allowed: false, scope: null }
  }

  function allowSession(ws, context) {
    const sessionId = sessionIdOf(context)
    if (!sessionId) throw consentError('CONSENT_CONTEXT_REQUIRED', 'a session consent needs a live session id')
    sessions.add(`${projectKey(ws)}\0${sessionId}`)
    return { allowed: true, scope: 'session' }
  }

  /** Let a child started by a consented parent reuse the parent's session grant. */
  function inherit(ws, childSessionId, parentSessionId) {
    if (typeof childSessionId !== 'string' || childSessionId === '') return false
    if (typeof parentSessionId !== 'string' || parentSessionId === '') return false
    const key = projectKey(ws)
    if (!sessions.has(`${key}\0${parentSessionId}`)) return false
    sessions.add(`${key}\0${childSessionId}`)
    return true
  }

  async function writeConsent(ws, consent) {
    if (ws?.kind !== 'remote' || !ws.index || !ws.project) {
      throw consentError('CONSENT_UNAVAILABLE', 'workspace consent is only available for a registered remote project')
    }
    const projects = ws.index.projects.map(project => {
      if (project.id !== ws.id) return project
      return consent === undefined ? withoutConsent(project) : { ...project, consent }
    })
    const next = await writeIndex(ws.pathBase, { schema: 1, projects }, projectDirRelative(ws))
    ws.index = next
    ws.project = next.projects.find(project => project.id === ws.id)
    return next
  }

  async function grantWorkspace(ws) {
    const consent = {
      scope: 'workspace',
      grantedAt: now().toISOString(),
      grantedBy: 'user',
    }
    await writeConsent(ws, consent)
    return consent
  }

  /**
   * Resolve consent for a remote content read. Never returns content itself.
   * @returns `{ allowed, scope, reason?, error? }`
   */
  async function ensure(ws, context, options = {}) {
    const current = isAllowed(ws, context)
    if (current.allowed) return current

    const service = getUserQuestions()
    if (!service || typeof service.ask !== 'function') {
      return { allowed: false, reason: 'no-answerer' }
    }
    const agent = agentOf(context)
    if (!agent) return { allowed: false, reason: 'no-agent' }

    const host = ws?.project?.host ?? 'remote'
    const root = ws?.project?.root ?? ''
    const question = {
      id: `archmap-consent-${ws.id}`,
      header: '远程内容授权',
      question: `允许读取远程仓库 ${host}:${root} 的内容并发送给模型分析吗？`,
      detail: DETAIL,
      options: [
        { label: CONSENT.session, description: '本次会话有效，包括本会话启动的子会话。' },
        { label: CONSENT.always, description: '写入 .archmap/index.json；后续会话和自动维护可用。' },
        { label: CONSENT.reject, description: '不读取内容。' },
      ],
      intent: {
        kind: 'approval',
        approve: CONSENT.session,
        reject: CONSENT.reject,
        always: CONSENT.always,
        detail: DETAIL,
        subject: { name: `${host}:${root}` },
      },
    }

    let answer
    try {
      answer = await service.ask({ agent, signal: options.signal, questions: [question] })
    } catch (error) {
      return { allowed: false, reason: 'ask-failed', error }
    }

    const item = Array.isArray(answer?.answers) ? answer.answers[0] : undefined
    const selected = Array.isArray(item?.selected) ? item.selected : []
    const choice = typeof item?.custom === 'string' && item.custom.trim() !== ''
      ? item.custom.trim()
      : selected[0]

    if (choice === CONSENT.always) {
      const consent = await grantWorkspace(ws)
      return { allowed: true, scope: 'workspace', consent }
    }
    if (choice === CONSENT.session) {
      allowSession(ws, context)
      return { allowed: true, scope: 'session' }
    }
    return { allowed: false, reason: 'rejected' }
  }

  /**
   * Revoke one session grant, or all session grants plus the workspace record.
   * @returns `{ revoked: 'session' | 'workspace' }`
   */
  async function revoke(ws, options = {}) {
    const key = projectKey(ws)
    if (typeof options.sessionId === 'string') {
      sessions.delete(`${key}\0${options.sessionId}`)
      return { revoked: 'session' }
    }
    for (const entry of [...sessions]) {
      if (entry.startsWith(`${key}\0`)) sessions.delete(entry)
    }
    if (workspaceConsent(ws)) {
      await writeConsent(ws, undefined)
      return { revoked: 'workspace' }
    }
    return { revoked: 'session' }
  }

  /** Auto maintenance is allowed only on a durable workspace grant. */
  function autoMaintenanceAllowed(ws) {
    return workspaceConsent(ws)
  }

  return {
    isAllowed,
    ensure,
    allowSession,
    inherit,
    revoke,
    grantWorkspace,
    autoMaintenanceAllowed,
    workspaceConsent,
    sessionGrant,
  }
}
