/**
 * Architecture map — workspace resolver (node 9).
 *
 * One descriptor answers both questions a store needs: where the code lives
 * (`workspaceRoot`) and where the graph/dossier state lives (`stateDir`).
 * Local projects keep `.archmap/`; remote projects keep
 * `.archmap/projects/<id>/` in the local hub workspace.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { LOCAL_PROJECT_ID, loadIndex, projectById } from './projects.js'
import { createLocalContent } from './content/local.js'
import { createSshClient } from './remote/ssh.js'
import { createRemoteContent } from './remote/content.js'

const DEFAULT_DIR = '.archmap'
const remoteContents = new Map()

function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  throw error
}

/** Normalize the configured data directory; invalid values fall back to `.archmap`. */
export function normalizeDataDir(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_DIR
  if (path.isAbsolute(raw) || raw.split(/[\\/]/).includes('..')) return DEFAULT_DIR
  return raw
}

async function resolveLocalRoot(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('WORKSPACE_REQUIRED', 'pass a workspace path or open a session with a working directory')
  }
  if (!path.isAbsolute(raw)) fail('INVALID_WORKSPACE', 'workspace must be an absolute path')
  let real
  try {
    real = await fs.realpath(raw)
  } catch {
    fail('INVALID_WORKSPACE', `workspace "${raw}" does not exist`)
  }
  const stat = await fs.stat(real)
  if (!stat.isDirectory()) fail('INVALID_WORKSPACE', `workspace "${raw}" is not a directory`)
  return real
}

function stateDirUnder(root, relative) {
  const stateDir = path.resolve(root, relative)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (stateDir !== root && !stateDir.startsWith(prefix)) {
    fail('PATH_ESCAPE', 'project state directory escapes the workspace')
  }
  return stateDir
}

/** Reuse one client/content pair per remote + transport configuration. */
function remoteContentFor(project, config) {
  const ssh = config.ssh ?? {}
  const key = JSON.stringify([project.host, project.root, project.vcs, ssh.binary ?? 'ssh', ssh.env ?? {}])
  const cached = remoteContents.get(key)
  if (cached) return cached
  const client = createSshClient({ ...ssh, host: project.host })
  const content = createRemoteContent({ client, root: project.root, vcs: project.vcs })
  remoteContents.set(key, content)
  return content
}

/**
 * Resolve a tool workspace into `{ kind, display, workspaceRoot, stateDir }`.
 * `remote:<id>` uses the calling session's working directory as the hub; a
 * local absolute path keeps the legacy single-project layout.
 */
export async function resolveWorkspace(raw, context, config = {}) {
  if (raw !== null && typeof raw === 'object' && typeof raw.stateDir === 'string' && typeof raw.kind === 'string') {
    return raw
  }
  const dir = normalizeDataDir(config.dir)
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') {
    fail('WORKSPACE_REQUIRED', 'pass a workspace path or open a session with a working directory')
  }

  if (value.startsWith('remote:')) {
    const match = /^remote:([a-z][a-z0-9_-]{0,63})$/.exec(value)
    if (!match) fail('INVALID_PROJECT', 'remote workspace must be remote:<id> with a lowercase project id')
    const id = match[1]
    if (id === LOCAL_PROJECT_ID) fail('INVALID_PROJECT', 'remote:local is not a remote project')
    const agent = context?.agent ?? context
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') {
      fail('WORKSPACE_REQUIRED', 'a remote workspace needs a session with a working directory')
    }
    const hub = await resolveLocalRoot(cwd)
    const index = await loadIndex(hub, dir)
    const project = projectById(index, id)
    if (!project) {
      fail('PROJECT_NOT_FOUND', `remote project "${id}" is not registered in ${path.join(hub, dir, 'index.json')}`)
    }
    if (project.kind !== 'remote') fail('INVALID_PROJECT', `project "${id}" is not remote`)
    const stateDir = stateDirUnder(hub, path.posix.join(dir, project.dir))
    return {
      kind: 'remote',
      id,
      display: `remote:${id}`,
      workspaceRoot: project.root,
      stateDir,
      pathBase: hub,
      content: remoteContentFor(project, config),
      project,
      index,
    }
  }

  const root = await resolveLocalRoot(value)
  const stateDir = stateDirUnder(root, dir)
  return {
    kind: 'local',
    id: LOCAL_PROJECT_ID,
    display: root,
    workspaceRoot: root,
    stateDir,
    pathBase: root,
    content: createLocalContent(root),
    project: null,
    index: null,
  }
}
