/**
 * Architecture map — remote project status file.
 *
 * `remote-state.json` lives beside the local project graph and records the last
 * fingerprint, pending change counts, polling state and auto-maintenance time.
 * It never stores remote file content.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const REMOTE_STATE_SCHEMA = 1

export function emptyRemoteState(ws) {
  return {
    schema: REMOTE_STATE_SCHEMA,
    id: ws.id,
    host: ws.project?.host ?? null,
    root: ws.project?.root ?? null,
    fingerprint: null,
    lastCheckedAt: null,
    lastIndexedAt: null,
    pending: { added: 0, changed: 0, deleted: 0, count: 0, since: null },
    syncState: 'idle',
    lastMaintainerAt: null,
    lastError: null,
  }
}

export async function readRemoteState(ws) {
  const file = path.join(ws.stateDir, 'remote-state.json')
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== REMOTE_STATE_SCHEMA) return null
  return parsed
}

export async function writeRemoteState(ws, state) {
  const next = {
    ...emptyRemoteState(ws),
    ...state,
    schema: REMOTE_STATE_SCHEMA,
    id: ws.id,
    host: ws.project?.host ?? state.host ?? null,
    root: ws.project?.root ?? state.root ?? null,
    pending: { ...emptyRemoteState(ws).pending, ...(state.pending ?? {}) },
  }
  await fs.mkdir(ws.stateDir, { recursive: true })
  const file = path.join(ws.stateDir, 'remote-state.json')
  const temp = path.join(ws.stateDir, `remote-state.tmp-${process.pid}-${randomBytes(6).toString('hex')}.json`)
  await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await fs.rename(temp, file)
  return next
}
