/**
 * Architecture map — Host half.
 *
 * Node 1: `arch_hello` + `/arch` command (skeleton verification).
 * Node 2: `arch_graph_get` / `arch_graph_patch` over a workspace-owned
 * `.archmap/graph.json` with a revision, validation, and atomic writes.
 */
import { createReadStream, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGraphStore, workspaceOf } from './graph.js'
import { createMemoryStore } from './memory.js'
import { createExporter } from './export.js'

export const name = 'architecture-map'

/** Local asset route for the vendored Mermaid runtime; the Host serves it, never a CDN. */
const RUNTIME_PATH = '/x-dsh-architecture-map'
const VENDOR_PREFIX = `${RUNTIME_PATH}/vendor`
const VENDOR_DIR = fileURLToPath(new URL('../../vendor/', import.meta.url))
const SKILL_DIR = fileURLToPath(new URL('../../skills/architecture-map/', import.meta.url))

const VENDOR_MIME = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.license': 'text/plain; charset=utf-8',
}

/**
 * Serve one allow-listed file from the vendored Mermaid directory.
 * Mirrors the static-asset approach used by dsh-mermaid-plus (MIT).
 */
async function serveVendorFile(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
    response.end('Method Not Allowed')
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://dsh.invalid').pathname)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad Request')
    return
  }
  const prefix = `${VENDOR_PREFIX}/`
  const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('/')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end('Not Found')
    return
  }
  const file = path.join(VENDOR_DIR, name)
  let info
  try {
    info = await stat(file)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end('Not Found')
    return
  }
  if (!info.isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end('Not Found')
    return
  }
  const headers = {
    'content-type': VENDOR_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  if (request.method === 'HEAD') {
    response.writeHead(200, headers)
    response.end()
    return
  }
  response.writeHead(200, headers)
  createReadStream(file).pipe(response)
}

/**
 * Read the bundled skill body (frontmatter stripped). The skill file is the
 * single source of truth; the Host registers it as an embedded runtime skill so
 * a new session sees `architecture-map` in its skill catalog.
 */
function readSkillContent() {
  try {
    const raw = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\n+/, '')
  } catch {
    return undefined
  }
}

/** Known third-party Mermaid fence providers that would collide on the `mermaid` key. */
const OTHER_MERMAID_PLUGINS = new Set(['dsh-mermaid-plus'])

/** Detect a known Mermaid fence provider through the loader, when inspectable. */
function hasOtherMermaidPlugin(ctx) {
  try {
    const loader = ctx?.loader ?? (typeof ctx.get === 'function' ? ctx.get('loader') : undefined)
    const entries = loader?.entries?.() ?? []
    return entries.some(entry => {
      const name = entry?.options?.name ?? entry?.name
      return OTHER_MERMAID_PLUGINS.has(name)
    })
  } catch {
    return false
  }
}

/** Report whether the browser half may render Mermaid fences. */
function serveMermaidConfig(renderMermaid, mode) {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      response.end('Method Not Allowed')
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify({ mermaid: renderMermaid, mode }))
  }
}


/** Services this plugin needs before it activates. */
export const inject = ['tools', 'commands']

const SYNC_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      counts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scanned: { type: 'integer' },
          added: { type: 'integer' },
          changed: { type: 'integer' },
          cosmetic: { type: 'integer' },
          deleted: { type: 'integer' },
          affected: { type: 'integer' },
          marked: { type: 'integer' },
        },
        required: ['scanned', 'added', 'changed', 'cosmetic', 'deleted', 'affected', 'marked'],
      },
    },
    required: ['text', 'counts'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const COMMIT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      committed: { type: 'integer' },
      removed: { type: 'integer' },
    },
    required: ['text', 'committed', 'removed'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const DOC_GET_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      found: { type: 'boolean' },
    },
    required: ['text', 'found'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const DOC_PUT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      bytes: { type: 'integer' },
    },
    required: ['text', 'bytes'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const EXPORT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      path: { type: 'string' },
      bytes: { type: 'integer' },
      format: { type: 'string' },
    },
    required: ['text', 'path', 'bytes', 'format'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const DISCUSS_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      name: { type: 'string' },
      mode: { type: 'string' },
      target: { type: 'string' },
      childId: { type: 'string' },
    },
    required: ['text', 'name', 'mode', 'target', 'childId'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const GRAPH_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      rev: { type: 'integer' },
      counts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodes: { type: 'integer' },
          edges: { type: 'integer' },
          groups: { type: 'integer' },
        },
        required: ['nodes', 'edges', 'groups'],
      },
    },
    required: ['text', 'rev', 'counts'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

/**
 * Register the M0/M1 tools and the `/arch` command.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {Record<string, unknown>} [config] - Plugin row configuration.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const mermaidMode = config?.renderMermaid ?? 'auto'
  const renderMermaid = mermaidMode === true || mermaidMode === 'on'
    ? true
    : mermaidMode === false || mermaidMode === 'off'
      ? false
      : mermaidMode === 'auto'
        ? !hasOtherMermaidPlugin(ctx)
        : true
  const store = createGraphStore(config)
  const markStaleNodes = async (workspace, ids) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = await store.readGraph(workspace)
      const wanted = [...new Set(ids)].filter(id => graph.nodes.some(node => node.id === id && node.status !== 'stale'))
      if (wanted.length === 0) return { marked: [], rev: graph.rev }
      try {
        const result = await store.patch(workspace, {
          baseRev: graph.rev,
          ops: wanted.map(id => ({ op: 'update_node', id, patch: { status: 'stale' } })),
        })
        return { marked: wanted, rev: result.rev }
      } catch (error) {
        if (!String(error?.message).includes('STALE_REV') || attempt === 2) throw error
      }
    }
    return { marked: [], rev: 0 }
  }
  const memory = createMemoryStore(config, { readGraph: store.readGraph, markStale: markStaleNodes })
  const exporter = createExporter({ readGraph: store.readGraph })

  ctx.tools.register({
    name: 'arch_hello',
    description:
      'Return a diagnostic hello message. Use this once to confirm the Architecture map plugin is installed and active.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute() {
      return { message: 'hello from architecture map' }
    },
  })

  ctx.tools.register({
    name: 'arch_graph_get',
    description:
      'Read the architecture graph for a workspace. Start with the overview, then read one node before editing it. '
      + 'Returns the current rev and a bounded text summary. Use the rev in the next arch_graph_patch call.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          description: 'overview (default) | node:<id> | edge:<id> | group:<id>',
        },
        depth: {
          type: 'integer',
          minimum: 0,
          maximum: 3,
          description: 'Neighbor hops for node targets; default 1.',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['summary', 'anchors', 'notes', 'edges'] },
          description: 'Fields to include. Overview defaults to none; a node defaults to summary, anchors and edges.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum items per list; default 50.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
    },
    output: GRAPH_OUTPUT,
    async execute(args, exec) {
      return store.get(workspaceOf(args, exec), args)
    },
  })

  ctx.tools.register({
    name: 'arch_graph_patch',
    description:
      'Apply a validated batch edit to the architecture graph. Pass the latest baseRev (0 for a new graph). '
      + 'Use apply:false to validate and preview without writing. Add nodes before edges that reference them. '
      + 'Missing anchor hashes are filled from disk; refreshAnchors:true recomputes all anchor hashes after review.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        baseRev: {
          type: 'integer',
          minimum: 0,
          description: 'Current graph rev; use 0 when the graph does not exist yet.',
        },
        ops: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Ordered operations. Shapes: {op:"add_node", node:{id,title,kind,summary?,anchors?:[{path,symbol?,hash?}]}}; {op:"update_node", id, patch:{...}}; {op:"remove_node", id, cascade?}; {op:"add_edge", edge:{id,from,to,label?,kind?}}; {op:"update_edge", id, patch:{...}}; {op:"remove_edge", id}; {op:"set_group", group:{id,title}}; {op:"remove_group", id}.',
        },
        apply: {
          type: 'boolean',
          description: 'false validates and returns a diff without writing; default true.',
        },
        refreshAnchors: {
          type: 'boolean',
          description: 'Recompute every anchor hash from the current files after applying. Use after reviewing a stale node; default false (only missing hashes are filled).',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
      required: ['baseRev', 'ops'],
    },
    output: GRAPH_OUTPUT,
    async execute(args, exec) {
      return store.patch(workspaceOf(args, exec), args)
    },
  })

  ctx.tools.register({
    name: 'arch_sync',
    description:
      'Compare the workspace against .archmap/manifest.json. Use full:true when no manifest exists. '
      + 'Returns only added/changed/deleted workspace-relative files and the graph nodes whose anchors they affect. '
      + 'Changed files are classified as code or format/comment-only via a normalized signature; only code changes '
      + 'affect nodes. By default this tool writes nothing; markStale:true marks affected nodes stale. '
      + 'It never writes the manifest; call arch_manifest_commit after analysis.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        full: {
          type: 'boolean',
          description: 'Ignore the manifest and list every scannable file; use for the first pass.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional workspace-relative files to limit the comparison to.',
        },
        markStale: {
          type: 'boolean',
          description: 'When true, mark affected nodes stale (writes the graph and bumps its rev). Default false: report only.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
    },
    output: SYNC_OUTPUT,
    async execute(args, exec) {
      return memory.sync(workspaceOf(args, exec), args)
    },
  })

  ctx.tools.register({
    name: 'arch_manifest_commit',
    description:
      'Record workspace-relative files as analyzed in .archmap/manifest.json. Call after reading them and updating '
      + 'their dossier documents. Missing or unreadable files are removed from the manifest.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workspace-relative files that have been analyzed.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
      required: ['paths'],
    },
    output: COMMIT_OUTPUT,
    async execute(args, exec) {
      return memory.commit(workspaceOf(args, exec), args)
    },
  })

  ctx.tools.register({
    name: 'arch_doc_get',
    description:
      'Read one architecture dossier document. Valid ids: overview, modules/<id>, notes/<id>.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
          description: 'overview | modules/<id> | notes/<id>',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
      required: ['id'],
    },
    output: DOC_GET_OUTPUT,
    async execute(args, exec) {
      return memory.getDoc(workspaceOf(args, exec), args.id)
    },
  })

  ctx.tools.register({
    name: 'arch_doc_put',
    description:
      'Write an architecture dossier document. Valid ids: overview, modules/<id>, notes/<id>. '
      + 'Use mode:append for node notes; overwrite is the default.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
          description: 'overview | modules/<id> | notes/<id>',
        },
        content: {
          type: 'string',
          description: 'Markdown content. The document is capped at 32 KiB.',
        },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: 'append adds a blank line plus the content; default overwrite.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
      required: ['id', 'content'],
    },
    output: DOC_PUT_OUTPUT,
    async execute(args, exec) {
      return memory.putDoc(workspaceOf(args, exec), args)
    },
  })

  ctx.tools.register({
    name: 'arch_export',
    description:
      'Export the canonical architecture graph to .archmap/export/. Formats: mermaid (flowchart source), '
      + 'svg (standalone diagram) and markdown (dossier digest). Deterministic; does not modify the graph.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: {
          type: 'string',
          enum: ['mermaid', 'svg', 'markdown'],
          description: 'mermaid: flowchart source; svg: standalone diagram; markdown: dossier digest.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute workspace root; defaults to the session working directory.',
        },
      },
      required: ['format'],
    },
    output: EXPORT_OUTPUT,
    async execute(args, exec) {
      return exporter.export(workspaceOf(args, exec), args)
    },
  })

  // Per-node side conversations are optional: a minimal profile may not
  // compose the subagent service. When it is present, register the tool.
  let agents = null
  let subagents = null

  ctx.inject(['agents'], scope => {
    agents = scope.agents
    return () => { agents = null }
  })

  /** Best-effort child restriction: no shell and no generic source-file writes. */
  const DISCUSSION_DENY = ['bash', 'pwsh', 'terminal', 'write', 'edit', 'str_replace_editor', 'apply_patch']
  const discussionIds = new Set()

  const restrictAgentTools = agent => {
    if (!agent?.ctx?.tools || typeof agent.ctx.tools.restrict !== 'function') return 0
    let applied = 0
    let firstError
    for (const name of DISCUSSION_DENY) {
      try {
        agent.ctx.tools.restrict({ deny: [name] })
        applied += 1
      } catch (error) {
        firstError ??= error
      }
    }
    if (applied === 0) {
      console.warn('[architecture-map] could not restrict discussion child tools:', String(firstError?.message ?? 'no tool matched'))
    }
    return applied
  }

  const restrictDiscussionChild = childId => {
    const id = String(childId)
    discussionIds.add(id)
    if (agents !== null && typeof agents.get === 'function') {
      const child = agents.get(id)
      if (child) return restrictAgentTools(child)
    }
    return 0
  }

  /** A resumed child emits agent/created; restrict it before its queued turn runs. */
  /** Recognize our children from the durable subagent descriptor (label). */
  const isDiscussionAgent = agent => {
    if (discussionIds.has(String(agent.id))) return true
    try {
      const events = agent.session?.snapshotEvents?.() ?? []
      const descriptor = events.find(event => event.type === 'subagent/descriptor')
      return typeof descriptor?.data?.label === 'string' && /^Discuss (node|edge) /.test(descriptor.data.label)
    } catch {
      return false
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.on('agent/created', ({ agent }) => {
      if (!agent || !isDiscussionAgent(agent)) return
      discussionIds.add(String(agent.id))
      restrictAgentTools(agent)
    })
  }

  /** An inactive child has no live Agent yet; retry, then rely on agent/created. */
  const restrictDiscussionChildSoon = childId => {
    if (restrictDiscussionChild(childId) > 0) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      const applied = restrictDiscussionChild(childId)
      if (applied > 0 || attempts >= 10) {
        clearInterval(timer)
        if (applied === 0) console.warn('[architecture-map] discussion child is not live; restriction will apply when it starts')
      }
    }, 100)
    timer.unref?.()
  }

  /**
   * Reapply restrictions to discussion children that outlived a plugin reload.
   * Inactive children still get their id recorded; agent/created catches them
   * when they resume.
   */
  const discoverDiscussionChildren = async () => {
    if (!agents || !subagents || typeof agents.list !== 'function' || typeof subagents.listDescendants !== 'function') return
    const roots = agents.list()
    const seenRoots = new Set()
    for (const root of roots) {
      const rootId = String(root.id)
      if (seenRoots.has(rootId)) continue
      seenRoots.add(rootId)
      let rows
      try {
        rows = await subagents.listDescendants(root.id)
      } catch {
        continue
      }
      for (const row of rows) {
        if (row.kind !== 'child') continue
        const name = typeof row.name === 'string' ? row.name : ''
        if (!/^(node|edge)-/.test(name)) continue
        const id = String(row.id)
        if (discussionIds.has(id)) continue
        discussionIds.add(id)
        const live = typeof agents.get === 'function' ? agents.get(id) : undefined
        if (live) restrictAgentTools(live)
      }
    }
  }

  const startDiscussion = async ({ agent, workspace, target, mode, question, signal }) => {
    if (!agent) throw new Error('arch_discuss requires an owning agent session')
    if (subagents === null) throw new Error('arch_discuss requires the subagents service')
    const graph = await store.readGraph(workspace)
    const match = /^(node|edge):(.+)$/.exec(String(target ?? ''))
    if (!match) throw new Error('target must be node:<id> or edge:<id>')
    const [, kind, id] = match
    const node = kind === 'node' ? graph.nodes.find(item => item.id === id) : undefined
    const edge = kind === 'edge' ? graph.edges.find(item => item.id === id) : undefined
    if (!node && !edge) throw new Error(`${kind} "${id}" does not exist in ${workspace}`)
    const chosenMode = mode === 'lite' ? 'lite' : 'fork'
    const name = `${kind === 'node' ? 'node' : 'edge'}-${id}${chosenMode === 'lite' ? '-lite' : ''}`
    const label = `Discuss ${kind} ${id}`
    const parentId = String(agent.session.id)

    const findExisting = async () => {
      if (typeof subagents.listDescendants !== 'function') return undefined
      try {
        const rows = await subagents.listDescendants(parentId, signal)
        const found = rows.find(row => row.kind === 'child' && row.depth === 1 && 'name' in row && row.name === name)
        if (!found || found.mode === 'external' || found.mode === 'unknown') return undefined
        return found
      } catch {
        return undefined
      }
    }

    const existing = await findExisting()
    if (existing) {
      restrictDiscussionChildSoon(existing.id)
      return {
        text: `existing ${name} — open it from the subagent catalog.`,
        name: existing.name ?? name,
        childId: String(existing.id),
        parentId,
        resourceMode: existing.mode === 'one-shot' ? 'one-shot' : 'continuable',
        mode: chosenMode,
        target: `${kind}:${id}`,
        existing: true,
      }
    }

    const title = node ? node.title : edge.label ?? `${edge.from} -> ${edge.to}`
    const prompt = [
      `You are the discussion agent for architecture ${kind} ${id}${title ? ` ("${title}")` : ''} in workspace ${workspace}.`,
      '',
      `Start by calling arch_graph_get({ workspace: ${JSON.stringify(workspace)}, target: ${JSON.stringify(`${kind}:${id}`)}, include: ["summary", "anchors", "edges"] }) and arch_doc_get({ workspace: ${JSON.stringify(workspace)}, id: "modules/${id}" }) if it exists.`,
      '',
      'Rules:',
      `- Discuss ${id} and its edges only; ask before touching other nodes.`,
      '- Do not edit source code. Graph edits go through arch_graph_patch with the latest rev; prefer apply:false until the user says apply.',
      '- Do not message the parent agent. Write conclusions to notes/' + id + ' via arch_doc_put with mode "append".',
      '- If an anchor looks stale, call arch_sync and say so before concluding.',
      chosenMode === 'lite' ? '- You do not inherit the parent conversation; rely on the graph and the dossier.' : '',
      typeof question === 'string' && question.trim() !== '' ? `\nThe user's initial question: ${question.trim()}` : '',
    ].filter(Boolean).join('\n')

    // Reserve the child id first so agent/created can restrict it before the
    // first model turn runs.
    const childId = randomUUID()
    discussionIds.add(childId)
    const activation = await subagents.startActivation({
      provider: chosenMode === 'fork' ? 'fork' : 'spawn',
      childId,
      label,
      name,
      prompt: [{ type: 'text', text: prompt }],
      parent: agent,
      signal,
      delivery: 'caller',
    })
    // The child runs in the background; the caller does not await its result.
    restrictDiscussionChildSoon(activation.childId)
    void activation.result.catch(() => {})
    return {
      text: `started ${activation.name} (${chosenMode}) — open it from the subagent catalog in the session header.`,
      name: activation.name,
      childId: String(activation.childId),
      parentId,
      resourceMode: 'continuable',
      mode: chosenMode,
      target: `${kind}:${id}`,
      existing: false,
    }
  }

  ctx.inject(['subagents'], scope => {
    subagents = scope.subagents
    scope.tools.register({
      name: 'arch_discuss',
      description:
        'Start a side conversation about one architecture node or edge. mode:fork inherits the main conversation\'s '
        + 'completed turns; mode:lite starts fresh with the graph and dossier. Reuses an existing named child instead '
        + 'of creating a duplicate. The child gets arch_* tools and runs in its own session.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: {
            type: 'string',
            description: 'node:<id> or edge:<id>',
          },
          mode: {
            type: 'string',
            enum: ['fork', 'lite'],
            description: 'fork inherits the main conversation (higher cost); lite starts fresh with the dossier. Default fork.',
          },
          question: {
            type: 'string',
            description: 'Optional opening question or focus for the discussion.',
          },
          workspace: {
            type: 'string',
            description: 'Absolute workspace root; defaults to the session working directory.',
          },
        },
        required: ['target'],
      },
      output: DISCUSS_OUTPUT,
      async execute(args, exec) {
        const started = await startDiscussion({
          agent: exec.agent,
          workspace: workspaceOf(args, exec),
          target: args.target,
          mode: args.mode,
          question: args.question,
          signal: exec.signal,
        })
        return {
          text: started.text,
          name: started.name,
          mode: started.mode,
          target: started.target,
          childId: started.childId,
        }
      },
    })
    return () => {
      subagents = null
    }
  })

  // The bundled architecture-map skill teaches the agent the sync/patch/dossier
  // loop. It is optional: a profile without the skill registry still gets the
  // tools and the panel.
  ctx.inject(['skills'], scope => {
    const content = readSkillContent()
    if (content === undefined) {
      console.warn('[architecture-map] bundled skill content not found')
      return () => {}
    }
    try {
      return scope.skills.register({
        name: 'architecture-map',
        description: 'Maintain a canonical architecture graph and dossier; use arch_sync, arch_graph_get/patch, arch_doc_get/put, arch_manifest_commit, arch_discuss and arch_export.',
        whenToUse: 'When the user asks for a project architecture map, module/dependency overview, or wants to discuss one module.',
        source: 'bundled',
        content,
        resourceBase: { kind: 'directory', path: SKILL_DIR },
      })
    } catch (error) {
      console.warn('[architecture-map] bundled skill registration failed:', error)
      return () => {}
    }
  })

  // Mermaid is served from the plugin's own origin; no CDN and no second plugin.
  // The browser half asks /config first, so renderMermaid:false leaves code fences
  // as plain code blocks without fetching the 5 MB runtime.
  ctx.inject(['webServer'], scope => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: `${RUNTIME_PATH}/config`,
      handler: serveMermaidConfig(renderMermaid, mermaidMode),
    }), 'architecture-map: mermaid config route')
    if (renderMermaid) {
      scope.effect(() => scope.webServer.register({
        kind: 'prefix',
        path: VENDOR_PREFIX,
        handler: serveVendorFile,
      }), 'architecture-map: mermaid runtime route')
    }
    return () => {}
  })

  // The host command supplies the catalog row and the composer's command chip.
  // The client half listens for command/executed and opens the right-sidebar panel.
  // `/arch discuss` is also the UI's entry point for a node conversation.
  ctx.commands.register({
    name: 'arch',
    description: 'Open the Architecture map panel',
    // No `input` descriptor: `/arch` + Enter must execute immediately. The
    // sidebar's Discuss button still calls `/arch discuss ...` through the
    // direct commands RPC, which accepts raw input without a composer claim.
    async handler({ agent, rawInput, signal }) {
      const extra = rawInput.trim()
      if (extra === '' || extra === 'open') {
        return { kind: 'success', text: 'Architecture map opened in the right sidebar.' }
      }
      const discuss = /^discuss\s+((?:node|edge):[a-z][a-z0-9_-]*)(?:\s+(fork|lite))?\s*$/.exec(extra)
      if (discuss) {
        try {
          const workspace = agent.session.header.cwd
          if (typeof workspace !== 'string' || workspace === '') {
            return { kind: 'error', text: 'the session has no working directory; pass an explicit workspace to arch_discuss' }
          }
          const started = await startDiscussion({
            agent,
            workspace,
            target: discuss[1],
            mode: discuss[2],
            signal,
          })
          return {
            kind: 'success',
            text: `${started.text} [child=${started.childId} parent=${started.parentId} mode=${started.resourceMode} target=${started.target}]`,
          }
        } catch (error) {
          return { kind: 'error', text: error?.message ?? String(error) }
        }
      }
      return {
        kind: 'error',
        text: '用法：/arch 或 /arch open（打开面板）；/arch discuss node:<id> [fork|lite]（开节点讨论）。要调用图工具，请直接发送“调用 arch_graph_get”。',
      }
    },
  })
}
