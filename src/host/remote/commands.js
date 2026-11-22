/**
 * Architecture map — `/arch remote ...` commands (node 15/16 wiring).
 *
 * Commands are user-driven: the model cannot add a host or grant consent on its
 * own. They use the same index, workspace resolver, indexer and consent gate as
 * the tools.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { LOCAL_PROJECT_ID, loadIndex, writeIndex } from '../projects.js'
import { normalizeDataDir, resolveWorkspace } from '../workspace.js'
import { assertHost, assertRemotePath, createSshClient } from './ssh.js'
import { createRemoteContent } from './content.js'

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

function commandError(message) {
  return { kind: 'error', text: message }
}

/** Split a command line into words, honoring simple single/double quotes. */
export function splitArgs(input) {
  const text = String(input ?? '')
  const args = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of text.matchAll(pattern)) {
    args.push(match[1] ?? match[2] ?? match[3])
  }
  return args
}

function countText(counts) {
  return `+${counts?.added ?? 0} added · ~${counts?.changed ?? 0} changed · -${counts?.deleted ?? 0} deleted`
}

/**
 * @param {object} options - `{ config, consent, indexer, maintainer }`.
 */
export function createRemoteCommands(options = {}) {
  const config = options.config ?? {}
  const consent = options.consent
  const indexer = options.indexer
  const maintainer = options.maintainer
  const dataDir = normalizeDataDir(config.dir)

  async function hubOf(agent) {
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') {
      throw new Error('REMOTE_WORKSPACE_REQUIRED: the session has no working directory')
    }
    const ws = await resolveWorkspace(cwd, { agent }, config)
    const relative = path.relative(ws.pathBase, ws.dataDir)
    return { hub: ws.pathBase, dir: relative === '' ? '.' : relative.split(path.sep).join('/') }
  }

  async function remoteWorkspace(id, agent) {
    if (!ID_PATTERN.test(id ?? '') || id === LOCAL_PROJECT_ID) {
      throw new Error(`INVALID_PROJECT: "${id}" is not a remote project id`)
    }
    const ws = await resolveWorkspace(`remote:${id}`, { agent }, config)
    if (ws.kind !== 'remote') throw new Error(`INVALID_PROJECT: "${id}" is not remote`)
    return ws
  }

  async function add(args, agent) {
    const [id, host, root] = args
    if (!id || !host || !root) return commandError('用法：/arch remote add <id> <host> <远程绝对路径>')
    if (!ID_PATTERN.test(id) || id === LOCAL_PROJECT_ID) {
      return commandError(`id 必须匹配 ${ID_PATTERN}，且不能是 local`)
    }
    let safeHost
    let safeRoot
    try {
      safeHost = assertHost(host)
      safeRoot = assertRemotePath(root, '远程路径')
    } catch (error) {
      return commandError(error.message)
    }
    const { hub, dir } = await hubOf(agent)
    const index = await loadIndex(hub, dir)
    if (index.projects.some(project => project.id === id)) {
      return commandError(`项目 "${id}" 已存在`)
    }
    let vcs = 'none'
    try {
      const client = createSshClient({ ...(config.ssh ?? {}), host: safeHost })
      const content = createRemoteContent({ client, root: safeRoot, vcs: 'auto' })
      vcs = await content.detectVcs()
    } catch (error) {
      return commandError(`无法连接 ${safeHost}:${safeRoot}：${error?.message ?? error}`)
    }
    const project = {
      id,
      kind: 'remote',
      title: `${safeHost}:${safeRoot}`,
      dir: `projects/${id}`,
      transport: 'ssh',
      host: safeHost,
      root: safeRoot,
      vcs,
      autoRefresh: true,
    }
    await writeIndex(hub, { schema: 1, projects: [...index.projects, project] }, dir)
    return {
      kind: 'success',
      text: `已添加远程项目 ${id} · ${safeHost}:${safeRoot} · vcs ${vcs}\n状态在 ${path.join(dir, project.dir, 'remote-state.json')}；面板来源选择器或 /arch remote select ${id} 启动轮询。`,
    }
  }

  async function list(agent) {
    const { hub, dir } = await hubOf(agent)
    const index = await loadIndex(hub, dir)
    const lines = [`remote projects (${index.projects.length}):`]
    for (const project of index.projects) {
      if (project.kind === 'local') {
        lines.push('  local · 本地项目')
        continue
      }
      lines.push(`  ${project.id} · ssh ${project.host}:${project.root} · vcs ${project.vcs} · consent ${project.consent?.scope ?? 'none'}`)
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  async function select(args, agent) {
    const [id] = args
    if (!id) return commandError('用法：/arch remote select <id>')
    const ws = await remoteWorkspace(id, agent)
    indexer.track(ws, { agent }, { immediate: true })
    return { kind: 'success', text: `已开始跟踪 ${id}：每 ${Math.round((indexer.intervalMs ?? 60_000) / 1000)} 秒检查一次指纹。` }
  }

  async function sync(args, agent) {
    const [id] = args
    if (!id) return commandError('用法：/arch remote sync <id>')
    const ws = await remoteWorkspace(id, agent)
    indexer.track(ws, { agent }, { immediate: false })
    const result = await indexer.check(ws, { agent }, { maintainer: false })
    if (result.first) return { kind: 'success', text: `${id}: 已记录初始指纹；下次变化时会做增量同步。` }
    if (!result.changed) return { kind: 'success', text: `${id}: 没有变化。` }
    return {
      kind: 'success',
      text: `${id}: 检测到变化 ${countText(result.counts)}\n已标记受影响节点 stale；用 /arch remote update ${id} 或面板 Update 启维护子会话。`,
    }
  }

  async function update(args, agent) {
    const [id] = args
    if (!id) return commandError('用法：/arch remote update <id>')
    const ws = await remoteWorkspace(id, agent)
    const checked = await indexer.check(ws, { agent }, { maintainer: false })
    const counts = checked.counts ?? checked.state?.pending ?? { added: 0, changed: 0, deleted: 0 }
    if ((counts.added ?? 0) + (counts.changed ?? 0) + (counts.deleted ?? 0) === 0) {
      return { kind: 'success', text: `${id}: 没有待处理的变更。` }
    }
    const started = await maintainer.maybeRun(ws, { agent }, counts, checked.state ?? {}, { force: true })
    if (started.started) {
      return { kind: 'success', text: `${id}: 已启动维护子会话 ${started.name ?? started.childId}。` }
    }
    const reasons = {
      'no-workspace-consent': '需要先“始终允许”这个远程，才能自动维护。',
      'too-many-files': `变更文件 ${started.total} 个，超过上限 ${started.maxFiles}；请手动同步或分批处理。`,
      'already-running': '已经有维护子会话在跑。',
      'cooldown': '刚维护过，稍后再试。',
      'no-agent': '没有活跃会话。',
      'no-child-runner': '当前 profile 不支持子会话。',
    }
    return commandError(`${id}: 未启动维护 — ${reasons[started.reason] ?? started.reason}`)
  }

  async function grant(args, agent) {
    const [id] = args
    if (!id) return commandError('用法：/arch remote grant <id>')
    const ws = await remoteWorkspace(id, agent)
    await consent.grantWorkspace(ws)
    indexer.track(ws, { agent }, { immediate: false })
    return { kind: 'success', text: `${id}: 已写入 workspace 级内容授权。` }
  }

  async function revoke(args, agent) {
    const [id] = args
    if (!id) return commandError('用法：/arch remote revoke <id>')
    const ws = await remoteWorkspace(id, agent)
    const result = await consent.revoke(ws)
    return { kind: 'success', text: `${id}: 已撤销 ${result.revoked === 'workspace' ? 'workspace 与全部会话' : '会话'}授权。` }
  }

  async function remove(args, agent) {
    const id = args.find(value => !value.startsWith('--'))
    if (!id) return commandError('用法：/arch remote remove <id> [--purge]')
    const purge = args.includes('--purge')
    const ws = await remoteWorkspace(id, agent)
    const { hub, dir } = await hubOf(agent)
    const index = await loadIndex(hub, dir)
    if (!index.projects.some(project => project.id === id)) return commandError(`项目 "${id}" 不存在`)
    const projects = index.projects.filter(project => project.id !== id)
    await writeIndex(hub, { schema: 1, projects }, dir)
    indexer.untrack(ws)
    if (purge) await fs.rm(ws.stateDir, { recursive: true, force: true })
    return { kind: 'success', text: `${id}: 已移除${purge ? '并删除本地状态' : '（保留本地状态）'}。` }
  }

  async function handle(input, agent) {
    const args = splitArgs(input)
    const sub = args.shift()
    try {
      switch (sub) {
        case 'add': return await add(args, agent)
        case 'list': return await list(agent)
        case 'select': return await select(args, agent)
        case 'sync': return await sync(args, agent)
        case 'update': return await update(args, agent)
        case 'grant': return await grant(args, agent)
        case 'revoke': return await revoke(args, agent)
        case 'remove': return await remove(args, agent)
        case undefined:
        case '':
          return commandError('用法：/arch remote add|list|select|sync|update|grant|revoke|remove ...')
        default:
          return commandError(`未知子命令 "${sub}"`)
      }
    } catch (error) {
      return commandError(error?.message ?? String(error))
    }
  }

  return { handle, add, list, select, sync, update, grant, revoke, remove }
}
