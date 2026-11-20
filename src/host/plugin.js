/**
 * Architecture map — Host half.
 *
 * Node 1: `arch_hello` + `/arch` command (skeleton verification).
 * Node 2: `arch_graph_get` / `arch_graph_patch` over a workspace-owned
 * `.archmap/graph.json` with a revision, validation, and atomic writes.
 */
import { createGraphStore, workspaceOf } from './graph.js'
import { createMemoryStore } from './memory.js'

export const name = 'architecture-map'

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

const DISCUSS_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      name: { type: 'string' },
      mode: { type: 'string' },
      target: { type: 'string' },
    },
    required: ['text', 'name', 'mode', 'target'],
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
      + 'Use apply:false to validate and preview without writing. Add nodes before edges that reference them.',
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

  // Per-node side conversations are optional: a minimal profile may not
  // compose the subagent service. When it is present, register the tool.
  ctx.inject(['subagents'], scope => {
    const discuss = async (args, exec) => {
      if (!exec.agent) throw new Error('arch_discuss requires an owning agent session')
      const workspace = workspaceOf(args, exec)
      const graph = await store.readGraph(workspace)
      const target = String(args.target ?? '')
      const match = /^(node|edge):(.+)$/.exec(target)
      if (!match) throw new Error('target must be node:<id> or edge:<id>')
      const [, kind, id] = match
      const node = kind === 'node' ? graph.nodes.find(item => item.id === id) : undefined
      const edge = kind === 'edge' ? graph.edges.find(item => item.id === id) : undefined
      if (!node && !edge) throw new Error(`${kind} "${id}" does not exist in ${workspace}`)
      const mode = args.mode === 'lite' ? 'lite' : 'fork'
      const name = `${kind === 'node' ? 'node' : 'edge'}-${id}`
      const label = `Discuss ${kind} ${id}`
      const title = node ? node.title : edge.label ?? `${edge.from} -> ${edge.to}`
      const prompt = [
        `You are the discussion agent for architecture ${kind} ${id}${title ? ` ("${title}")` : ''} in workspace ${workspace}.`,
        '',
        `Start by calling arch_graph_get({ workspace: ${JSON.stringify(workspace)}, target: ${JSON.stringify(target)}, include: ["summary", "anchors", "edges"] }) and arch_doc_get({ workspace: ${JSON.stringify(workspace)}, id: "modules/${id}" }) if it exists.`,
        '',
        'Rules:',
        `- Discuss ${id} and its edges only; ask before touching other nodes.`,
        '- Do not edit source code. Graph edits go through arch_graph_patch with the latest rev; prefer apply:false until the user says apply.',
        '- Do not message the parent agent. Write conclusions to notes/' + id + ' via arch_doc_put with mode "append".',
        '- If an anchor looks stale, call arch_sync and say so before concluding.',
        mode === 'lite' ? '- You do not inherit the parent conversation; rely on the graph and the dossier.' : '',
        typeof args.question === 'string' && args.question.trim() !== '' ? `\nThe user's initial question: ${args.question.trim()}` : '',
      ].filter(Boolean).join('\n')
      const activation = await scope.subagents.startActivation({
        provider: mode === 'fork' ? 'fork' : 'spawn',
        label,
        name,
        prompt: [{ type: 'text', text: prompt }],
        parent: exec.agent,
        signal: exec.signal,
        delivery: 'caller',
      })
      // The child runs in the background; the caller does not await its result.
      void activation.result.catch(() => {})
      return {
        text: `started ${activation.name} (${mode}) — open it from the subagent catalog in the session header.`,
        name: activation.name,
        mode,
        target,
      }
    }

    scope.tools.register({
      name: 'arch_discuss',
      description:
        'Start a side conversation about one architecture node or edge. mode:fork inherits the main conversation\'s '
        + 'completed turns; mode:lite starts fresh with the graph and dossier. The child gets arch_* tools and runs in '
        + 'its own session; open it from the subagent catalog.',
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
        return discuss(args, exec)
      },
    })
  })

  // The host command supplies the catalog row and the composer's command chip.
  // The client half listens for command/executed and opens the right-sidebar panel.
  ctx.commands.register({
    name: 'arch',
    description: 'Open the Architecture map panel',
    input: { hint: '[open]' },
    handler: ({ rawInput }) => {
      const extra = rawInput.trim()
      if (extra !== '' && extra !== 'open') {
        return {
          kind: 'error',
          text: '用法：/arch 或 /arch open（打开面板）。要调用工具，请直接发送“调用 arch_graph_get”。',
        }
      }
      return { kind: 'success', text: 'Architecture map opened in the right sidebar.' }
    },
  })
}
