/**
 * Architecture map — graph store (node 2).
 *
 * A workspace owns one `graph.json` with a monotonically increasing `rev`.
 * Reads are bounded; writes are validated, serialized per workspace, backed up
 * before replacement, and committed with a temporary file + rename.
 *
 * Plain ESM; uses Node built-ins only so the Host half needs no runtime
 * dependency beyond DSH itself.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { normalizeDataDir, resolveWorkspace } from './workspace.js'

export const GRAPH_SCHEMA = 1

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const NODE_KINDS = new Set(['entry', 'module', 'service', 'store', 'external', 'concept'])
const EDGE_KINDS = new Set(['call', 'data', 'dependency', 'containment'])
const STATUSES = new Set(['fresh', 'stale', 'proposed'])

const NODE_FIELDS = new Set(['id', 'title', 'kind', 'group', 'summary', 'anchors', 'status', 'style', 'notes', 'position'])
const NODE_PATCH_FIELDS = new Set(['title', 'kind', 'group', 'summary', 'anchors', 'status', 'style', 'notes', 'position'])
const POSITION_FIELDS = new Set(['x', 'y'])
const EDGE_FIELDS = new Set(['id', 'from', 'to', 'label', 'kind', 'status'])
const EDGE_PATCH_FIELDS = new Set(['from', 'to', 'label', 'kind', 'status'])
const GROUP_FIELDS = new Set(['id', 'title', 'kind'])

const OP_FIELDS = {
  add_node: new Set(['op', 'node']),
  update_node: new Set(['op', 'id', 'patch']),
  remove_node: new Set(['op', 'id', 'cascade']),
  add_edge: new Set(['op', 'edge']),
  update_edge: new Set(['op', 'id', 'patch']),
  remove_edge: new Set(['op', 'id']),
  set_group: new Set(['op', 'group']),
  remove_group: new Set(['op', 'id']),
}

const DEFAULTS = Object.freeze({
  dir: '.archmap',
  maxNodes: 400,
  maxEdges: 1200,
  maxGroups: 100,
  maxSummary: 500,
  maxAnchors: 20,
})

const locks = new Map()

/** Throw a coded error the tool layer can surface verbatim to the model. */
function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  throw error
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertId(value, where) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail('INVALID_GRAPH', `${where} must match ${ID_PATTERN}`)
  }
}

function assertText(value, where, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_GRAPH', `${where} must be a non-empty string`)
  }
  if (value.length > max) {
    fail('LIMIT_EXCEEDED', `${where} is ${value.length} characters; the limit is ${max}`)
  }
}

function assertKnownKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('INVALID_GRAPH', `${where}.${key} is not a recognized field (expected: ${[...allowed].join(', ')})`)
    }
  }
}

function assertPosition(position, where) {
  if (!isPlainObject(position)) {
    fail('INVALID_GRAPH', `${where} must be an object { x, y } with finite numbers`)
  }
  assertKnownKeys(position, POSITION_FIELDS, where)
  for (const axis of ['x', 'y']) {
    if (!Number.isFinite(position[axis])) {
      fail('INVALID_GRAPH', `${where}.${axis} must be a finite number`)
    }
    if (Math.abs(position[axis]) > 1000000) {
      fail('LIMIT_EXCEEDED', `${where}.${axis} must be within ±1000000`)
    }
  }
}

function assertRelativeAnchor(anchor, where) {
  if (!isPlainObject(anchor)) fail('INVALID_GRAPH', `${where} must be an object { path, symbol?, hash? }`)
  if (typeof anchor.path !== 'string' || anchor.path.trim() === '') {
    fail('INVALID_GRAPH', `${where}.path must be a non-empty string`)
  }
  if (path.isAbsolute(anchor.path) || anchor.path.includes('\\')) {
    fail('PATH_ESCAPE', `${where}.path must be a workspace-relative POSIX path`)
  }
  const segments = anchor.path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('PATH_ESCAPE', `${where}.path must not contain empty, "." or ".." segments`)
  }
  if (anchor.symbol !== undefined && typeof anchor.symbol !== 'string') {
    fail('INVALID_GRAPH', `${where}.symbol must be a string when present`)
  }
  if (anchor.hash !== undefined && typeof anchor.hash !== 'string') {
    fail('INVALID_GRAPH', `${where}.hash must be a string when present`)
  }
}

function normalizeNode(raw, where = 'node') {
  if (!isPlainObject(raw)) fail('INVALID_GRAPH', `${where} must be an object; add_node expects { op: "add_node", node: { id, title, ... } }`)
  assertKnownKeys(raw, NODE_FIELDS, where)
  return {
    id: raw.id,
    title: raw.title,
    kind: raw.kind ?? 'module',
    ...(raw.group === undefined ? {} : { group: raw.group }),
    ...(raw.summary === undefined ? {} : { summary: raw.summary }),
    anchors: raw.anchors ?? [],
    status: raw.status ?? 'fresh',
    ...(raw.style === undefined ? {} : { style: raw.style }),
    ...(raw.notes === undefined ? {} : { notes: raw.notes }),
    ...(raw.position === undefined ? {} : { position: raw.position }),
  }
}

function normalizeEdge(raw, where = 'edge') {
  if (!isPlainObject(raw)) fail('INVALID_GRAPH', `${where} must be an object; add_edge expects { op: "add_edge", edge: { id, from, to, ... } }`)
  assertKnownKeys(raw, EDGE_FIELDS, where)
  return {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    ...(raw.label === undefined ? {} : { label: raw.label }),
    kind: raw.kind ?? 'dependency',
    status: raw.status ?? 'fresh',
  }
}

function normalizeGroup(raw, where = 'group') {
  if (!isPlainObject(raw)) fail('INVALID_GRAPH', `${where} must be an object; set_group expects { op: "set_group", group: { id, title } }`)
  assertKnownKeys(raw, GROUP_FIELDS, where)
  return {
    id: raw.id,
    title: raw.title,
    ...(raw.kind === undefined ? {} : { kind: raw.kind }),
  }
}

function emptyGraph() {
  return {
    schema: GRAPH_SCHEMA,
    rev: 0,
    updatedAt: null,
    layout: { mode: 'layered', direction: 'LR' },
    groups: [],
    nodes: [],
    edges: [],
  }
}

/** Validate a complete graph and return it unchanged. */
export function validateGraph(graph, limits = DEFAULTS) {
  if (!isPlainObject(graph)) fail('INVALID_GRAPH', 'graph must be an object')
  if (graph.schema !== GRAPH_SCHEMA) {
    fail('INVALID_GRAPH', `graph.schema must be ${GRAPH_SCHEMA}`)
  }
  if (!Number.isInteger(graph.rev) || graph.rev < 0) {
    fail('INVALID_GRAPH', 'graph.rev must be a non-negative integer')
  }
  if (!Array.isArray(graph.groups) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    fail('INVALID_GRAPH', 'graph.groups, graph.nodes and graph.edges must be arrays')
  }
  if (graph.nodes.length > limits.maxNodes) {
    fail('LIMIT_EXCEEDED', `graph has ${graph.nodes.length} nodes; the limit is ${limits.maxNodes}`)
  }
  if (graph.edges.length > limits.maxEdges) {
    fail('LIMIT_EXCEEDED', `graph has ${graph.edges.length} edges; the limit is ${limits.maxEdges}`)
  }
  if (graph.groups.length > limits.maxGroups) {
    fail('LIMIT_EXCEEDED', `graph has ${graph.groups.length} groups; the limit is ${limits.maxGroups}`)
  }

  const ids = new Set()
  const groupIds = new Set()
  for (const group of graph.groups) {
    if (!isPlainObject(group)) fail('INVALID_GRAPH', 'group must be an object')
    assertId(group.id, 'group.id')
    if (ids.has(group.id)) fail('INVALID_GRAPH', `duplicate id "${group.id}"`)
    ids.add(group.id)
    groupIds.add(group.id)
    assertText(group.title, `group ${group.id}.title`, 200)
    if (group.kind !== undefined && typeof group.kind !== 'string') {
      fail('INVALID_GRAPH', `group ${group.id}.kind must be a string when present`)
    }
  }

  const nodeIds = new Set()
  for (const node of graph.nodes) {
    if (!isPlainObject(node)) fail('INVALID_GRAPH', 'node must be an object')
    assertId(node.id, 'node.id')
    if (ids.has(node.id)) fail('INVALID_GRAPH', `duplicate id "${node.id}"`)
    ids.add(node.id)
    nodeIds.add(node.id)
    assertText(node.title, `node ${node.id}.title`, 200)
    if (!NODE_KINDS.has(node.kind)) {
      fail('INVALID_GRAPH', `node ${node.id}.kind must be one of ${[...NODE_KINDS].join(', ')}`)
    }
    if (node.group !== undefined && !groupIds.has(node.group)) {
      fail('INVALID_GRAPH', `node ${node.id}.group "${node.group}" does not exist`)
    }
    if (node.summary !== undefined) {
      if (typeof node.summary !== 'string') fail('INVALID_GRAPH', `node ${node.id}.summary must be a string`)
      if (node.summary.length > limits.maxSummary) {
        fail('LIMIT_EXCEEDED', `node ${node.id}.summary is ${node.summary.length} characters; the limit is ${limits.maxSummary}`)
      }
    }
    if (!Array.isArray(node.anchors)) fail('INVALID_GRAPH', `node ${node.id}.anchors must be an array`)
    if (node.anchors.length > limits.maxAnchors) {
      fail('LIMIT_EXCEEDED', `node ${node.id} has ${node.anchors.length} anchors; the limit is ${limits.maxAnchors}`)
    }
    for (const [index, anchor] of node.anchors.entries()) {
      assertRelativeAnchor(anchor, `node ${node.id}.anchors[${index}]`)
    }
    if (!STATUSES.has(node.status)) {
      fail('INVALID_GRAPH', `node ${node.id}.status must be one of ${[...STATUSES].join(', ')}`)
    }
    if (node.style !== undefined && !isPlainObject(node.style)) {
      fail('INVALID_GRAPH', `node ${node.id}.style must be an object when present`)
    }
    if (node.notes !== undefined && typeof node.notes !== 'string') {
      fail('INVALID_GRAPH', `node ${node.id}.notes must be a string when present`)
    }
    if (node.position !== undefined) {
      assertPosition(node.position, `node ${node.id}.position`)
    }
  }

  for (const edge of graph.edges) {
    if (!isPlainObject(edge)) fail('INVALID_GRAPH', 'edge must be an object')
    assertId(edge.id, 'edge.id')
    if (ids.has(edge.id)) fail('INVALID_GRAPH', `duplicate id "${edge.id}"`)
    ids.add(edge.id)
    if (!nodeIds.has(edge.from)) fail('INVALID_GRAPH', `edge ${edge.id}.from "${edge.from}" does not exist`)
    if (!nodeIds.has(edge.to)) fail('INVALID_GRAPH', `edge ${edge.id}.to "${edge.to}" does not exist`)
    if (edge.from === edge.to && edge.kind !== 'containment') {
      fail('INVALID_GRAPH', `edge ${edge.id} is a self-loop; only containment may self-reference`)
    }
    if (!EDGE_KINDS.has(edge.kind)) {
      fail('INVALID_GRAPH', `edge ${edge.id}.kind must be one of ${[...EDGE_KINDS].join(', ')}`)
    }
    if (edge.label !== undefined) {
      if (typeof edge.label !== 'string') fail('INVALID_GRAPH', `edge ${edge.id}.label must be a string`)
      if (edge.label.length > 200) fail('LIMIT_EXCEEDED', `edge ${edge.id}.label is too long`)
    }
    if (!STATUSES.has(edge.status)) {
      fail('INVALID_GRAPH', `edge ${edge.id}.status must be one of ${[...STATUSES].join(', ')}`)
    }
  }

  return graph
}

/** Apply ordered patch operations to a clone of the graph. */
export function applyOps(graph, ops, limits = DEFAULTS) {
  if (!Array.isArray(ops) || ops.length === 0) {
    fail('INVALID_OP', 'ops must be a non-empty array')
  }
  const draft = structuredClone(graph)
  const findNode = id => draft.nodes.find(node => node.id === id)
  const findEdge = id => draft.edges.find(edge => edge.id === id)
  const findGroup = id => draft.groups.find(group => group.id === id)

  for (const [index, op] of ops.entries()) {
    const where = `ops[${index}]`
    if (!isPlainObject(op) || typeof op.op !== 'string') {
      fail('INVALID_OP', `${where} must be an object with an "op" string`)
    }
    const allowedKeys = OP_FIELDS[op.op]
    if (allowedKeys === undefined) {
      fail('INVALID_OP', `${where}: unknown op "${op.op}"`)
    }
    assertKnownKeys(op, allowedKeys, where)
    switch (op.op) {
      case 'add_node': {
        const node = normalizeNode(op.node, `${where}.node`)
        if (findNode(node.id) || findEdge(node.id) || findGroup(node.id)) {
          fail('INVALID_OP', `${where}: id "${node.id}" already exists`)
        }
        draft.nodes.push(node)
        break
      }
      case 'update_node': {
        if (op.id === undefined) fail('INVALID_OP', `${where}.id is required for update_node; expected { op: "update_node", id, patch: {...} }`)
        assertId(op.id, `${where}.id`)
        const node = findNode(op.id)
        if (!node) fail('NOT_FOUND', `${where}: node "${op.id}" does not exist`)
        if (!isPlainObject(op.patch)) {
          fail('INVALID_OP', `${where}.patch must be an object; expected { op: "update_node", id: "${op.id}", patch: {...} }`)
        }
        assertKnownKeys(op.patch, NODE_PATCH_FIELDS, `${where}.patch`)
        Object.assign(node, op.patch)
        // position:null clears a pin; other fields keep their normal merge.
        if (op.patch.position === null) delete node.position
        break
      }
      case 'remove_node': {
        assertId(op.id, `${where}.id`)
        const index = draft.nodes.findIndex(node => node.id === op.id)
        if (index < 0) fail('NOT_FOUND', `${where}: node "${op.id}" does not exist`)
        const related = draft.edges.filter(edge => edge.from === op.id || edge.to === op.id)
        if (related.length > 0 && op.cascade !== true) {
          fail('INVALID_OP', `${where}: node "${op.id}" still has ${related.length} edge(s); pass cascade: true`)
        }
        draft.edges = draft.edges.filter(edge => edge.from !== op.id && edge.to !== op.id)
        draft.nodes.splice(index, 1)
        break
      }
      case 'add_edge': {
        const edge = normalizeEdge(op.edge, `${where}.edge`)
        if (findNode(edge.id) || findEdge(edge.id) || findGroup(edge.id)) {
          fail('INVALID_OP', `${where}: id "${edge.id}" already exists`)
        }
        draft.edges.push(edge)
        break
      }
      case 'update_edge': {
        if (op.id === undefined) fail('INVALID_OP', `${where}.id is required for update_edge; expected { op: "update_edge", id, patch: {...} }`)
        assertId(op.id, `${where}.id`)
        const edge = findEdge(op.id)
        if (!edge) fail('NOT_FOUND', `${where}: edge "${op.id}" does not exist`)
        if (!isPlainObject(op.patch)) {
          fail('INVALID_OP', `${where}.patch must be an object; expected { op: "update_edge", id: "${op.id}", patch: {...} }`)
        }
        assertKnownKeys(op.patch, EDGE_PATCH_FIELDS, `${where}.patch`)
        Object.assign(edge, op.patch)
        break
      }
      case 'remove_edge': {
        assertId(op.id, `${where}.id`)
        const index = draft.edges.findIndex(edge => edge.id === op.id)
        if (index < 0) fail('NOT_FOUND', `${where}: edge "${op.id}" does not exist`)
        draft.edges.splice(index, 1)
        break
      }
      case 'set_group': {
        const group = normalizeGroup(op.group, `${where}.group`)
        const existing = findGroup(group.id)
        if (existing) Object.assign(existing, group)
        else draft.groups.push(group)
        break
      }
      case 'remove_group': {
        assertId(op.id, `${where}.id`)
        const index = draft.groups.findIndex(group => group.id === op.id)
        if (index < 0) fail('NOT_FOUND', `${where}: group "${op.id}" does not exist`)
        const members = draft.nodes.filter(node => node.group === op.id)
        if (members.length > 0) {
          fail('INVALID_OP', `${where}: group "${op.id}" still has ${members.length} node(s)`)
        }
        draft.groups.splice(index, 1)
        break
      }
      default:
        fail('INVALID_OP', `${where}: unknown op "${op.op}"`)
    }
  }
  validateGraph(draft, limits)
  return draft
}

function diffGraphs(before, after) {
  const changed = (beforeItems, afterItems) => {
    const beforeMap = new Map(beforeItems.map(item => [item.id, JSON.stringify(item)]))
    const afterMap = new Map(afterItems.map(item => [item.id, item]))
    const added = []
    const updated = []
    const removed = []
    for (const [id, value] of afterMap) {
      if (!beforeMap.has(id)) added.push(id)
      else if (beforeMap.get(id) !== JSON.stringify(value)) updated.push(id)
    }
    for (const id of beforeMap.keys()) {
      if (!afterMap.has(id)) removed.push(id)
    }
    return { added, updated, removed }
  }
  return {
    nodes: changed(before.nodes, after.nodes),
    edges: changed(before.edges, after.edges),
    groups: changed(before.groups, after.groups),
  }
}

function countChanges(diff) {
  return Object.values(diff).reduce((total, part) => total + part.added.length + part.updated.length + part.removed.length, 0)
}

function formatCounts(counts) {
  return `${counts.nodes} node${counts.nodes === 1 ? '' : 's'} · ${counts.edges} edge${counts.edges === 1 ? '' : 's'} · ${counts.groups} group${counts.groups === 1 ? '' : 's'}`
}

function graphCounts(graph) {
  return { nodes: graph.nodes.length, edges: graph.edges.length, groups: graph.groups.length }
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function findTarget(graph, target) {
  if (target === undefined || target === '' || target === 'overview') return { kind: 'overview' }
  const match = /^(node|edge|group):(.+)$/.exec(target)
  if (!match) {
    fail('INVALID_OP', 'target must be overview, node:<id>, edge:<id> or group:<id>')
  }
  const [, kind, id] = match
  if (kind === 'node') {
    const node = graph.nodes.find(item => item.id === id)
    if (!node) fail('NOT_FOUND', `node "${id}" does not exist`)
    return { kind, value: node }
  }
  if (kind === 'edge') {
    const edge = graph.edges.find(item => item.id === id)
    if (!edge) fail('NOT_FOUND', `edge "${id}" does not exist`)
    return { kind, value: edge }
  }
  const group = graph.groups.find(item => item.id === id)
  if (!group) fail('NOT_FOUND', `group "${id}" does not exist`)
  return { kind, value: group }
}

function titleOf(graph, id) {
  return graph.nodes.find(node => node.id === id)?.title ?? id
}

function renderOverview(graph, limit, include) {
  const lines = [
    `rev ${graph.rev} · ${formatCounts(graphCounts(graph))}`,
  ]
  const groups = graph.groups.slice(0, limit)
  if (groups.length > 0) {
    lines.push('groups:')
    for (const group of groups) lines.push(`  ${group.id} "${group.title}"`)
    if (graph.groups.length > groups.length) lines.push(`  … ${graph.groups.length - groups.length} more groups`)
  }
  if (graph.nodes.length === 0) {
    lines.push('nodes: (none)')
    lines.push('Use arch_graph_patch with baseRev ' + graph.rev + ' and add_node/add_edge operations.')
  } else {
    lines.push('nodes:')
    const nodes = graph.nodes.slice(0, limit)
    for (const node of nodes) {
      const parts = [`  ${node.id} "${node.title}"`, node.kind]
      if (node.group !== undefined) parts.push(`group ${node.group}`)
      parts.push(node.status)
      if (node.position) parts.push(`pin ${node.position.x},${node.position.y}`)
      lines.push(parts.join(' · '))
      if (include.includes('summary') && node.summary) lines.push(`    ${clip(node.summary, 160)}`)
    }
    if (graph.nodes.length > nodes.length) lines.push(`  … ${graph.nodes.length - nodes.length} more nodes`)
  }
  if (graph.edges.length > 0) {
    lines.push('edges:')
    const edges = graph.edges.slice(0, Math.min(limit, 60))
    for (const edge of edges) {
      lines.push(`  ${edge.id} ${edge.from} "${titleOf(graph, edge.from)}" -> ${edge.to} "${titleOf(graph, edge.to)}"${edge.label ? ` · ${edge.label}` : ''} (${edge.kind})`)
    }
    if (graph.edges.length > edges.length) lines.push(`  … ${graph.edges.length - edges.length} more edges`)
  } else {
    lines.push('edges: (none)')
  }
  return lines.join('\n')
}

function renderNode(graph, node, options) {
  const { include, depth, limit } = options
  const lines = [
    `rev ${graph.rev} · node ${node.id} "${node.title}"`,
    `kind: ${node.kind}${node.group ? ` · group: ${node.group}` : ''} · status: ${node.status}`,
  ]
  if (node.position) lines.push(`pinned: ${node.position.x},${node.position.y}`)
  if (include.includes('summary') && node.summary) lines.push(`summary: ${clip(node.summary, 600)}`)
  if (include.includes('anchors') && node.anchors.length > 0) {
    lines.push('anchors:')
    for (const anchor of node.anchors) {
      lines.push(`  ${anchor.path}${anchor.symbol ? `#${anchor.symbol}` : ''}${anchor.hash ? ` @${anchor.hash}` : ''}`)
    }
  }
  if (include.includes('notes') && node.notes) lines.push(`notes: ${node.notes}`)
  if (include.includes('edges')) {
    const edges = graph.edges.filter(edge => edge.from === node.id || edge.to === node.id)
    if (edges.length > 0) {
      lines.push('edges:')
      for (const edge of edges.slice(0, limit)) {
        lines.push(`  ${edge.id} ${edge.from} "${titleOf(graph, edge.from)}" -> ${edge.to} "${titleOf(graph, edge.to)}"${edge.label ? ` · ${edge.label}` : ''} (${edge.kind})`)
      }
      if (edges.length > limit) lines.push(`  … ${edges.length - limit} more edges`)
    } else {
      lines.push('edges: (none)')
    }
  }
  if (depth > 0) {
    const seen = new Set([node.id])
    let frontier = [node.id]
    const neighbors = []
    for (let level = 0; level < depth; level += 1) {
      const next = []
      for (const id of frontier) {
        for (const edge of graph.edges) {
          const other = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined
          if (other === undefined || seen.has(other)) continue
          seen.add(other)
          next.push(other)
          neighbors.push(graph.nodes.find(candidate => candidate.id === other))
        }
      }
      frontier = next
    }
    const shown = neighbors.filter(Boolean).slice(0, limit)
    if (shown.length > 0) {
      lines.push(`neighbors (depth ${depth}):`)
      for (const neighbor of shown) lines.push(`  ${neighbor.id} "${neighbor.title}" (${neighbor.kind})`)
      if (neighbors.length > shown.length) lines.push(`  … ${neighbors.length - shown.length} more neighbors`)
    }
  }
  return lines.join('\n')
}

function renderEdge(graph, edge) {
  return [
    `rev ${graph.rev} · edge ${edge.id}${edge.label ? ` "${edge.label}"` : ''} (${edge.kind}) · ${edge.status}`,
    `${edge.from} "${titleOf(graph, edge.from)}" -> ${edge.to} "${titleOf(graph, edge.to)}"`,
  ].join('\n')
}

function renderGroup(graph, group, limit) {
  const members = graph.nodes.filter(node => node.group === group.id)
  const lines = [
    `rev ${graph.rev} · group ${group.id} "${group.title}" · ${members.length} node${members.length === 1 ? '' : 's'}`,
  ]
  if (members.length > 0) {
    lines.push('nodes:')
    for (const node of members.slice(0, limit)) lines.push(`  ${node.id} "${node.title}" (${node.kind})`)
    if (members.length > limit) lines.push(`  … ${members.length - limit} more nodes`)
  }
  return lines.join('\n')
}

function formatDiff(diff) {
  const parts = []
  for (const [kind, part] of Object.entries(diff)) {
    for (const id of part.added) parts.push(`+ ${kind.slice(0, -1)} ${id}`)
    for (const id of part.updated) parts.push(`~ ${kind.slice(0, -1)} ${id}`)
    for (const id of part.removed) parts.push(`- ${kind.slice(0, -1)} ${id}`)
  }
  return parts.length > 0 ? parts.join('\n') : 'no changes'
}

/** Serialize one workspace's writes; reads do not take the lock. */
async function withLock(key, task) {
  while (locks.has(key)) await locks.get(key)
  let release
  const gate = new Promise(resolve => { release = resolve })
  locks.set(key, gate)
  try {
    return await task()
  } finally {
    locks.delete(key)
    release()
  }
}

export function createGraphStore(config = {}) {
  const limits = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] !== undefined) limits[key] = config[key]
  }
  limits.dir = normalizeDataDir(limits.dir)
  for (const key of ['maxNodes', 'maxEdges', 'maxGroups', 'maxSummary', 'maxAnchors']) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0) limits[key] = DEFAULTS[key]
  }
  const resolveConfig = { dir: limits.dir, ssh: config.ssh }

  async function resolve(rawWorkspace, context) {
    return resolveWorkspace(rawWorkspace, context, resolveConfig)
  }

  async function readGraphAt(ws) {
    const file = path.join(ws.stateDir, 'graph.json')
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyGraph()
      fail('IO_ERROR', `cannot read ${file}: ${error.message}`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      fail('GRAPH_CORRUPT', `graph.json is not valid JSON (${error.message}); a backup may exist at graph.bak.json`)
    }
    return validateGraph(parsed, limits)
  }

  async function readGraph(rawWorkspace, context) {
    return readGraphAt(await resolve(rawWorkspace, context))
  }

  async function writeGraph(ws, graph) {
    await fs.mkdir(ws.stateDir, { recursive: true })
    const file = path.join(ws.stateDir, 'graph.json')
    const backup = path.join(ws.stateDir, 'graph.bak.json')
    try {
      await fs.copyFile(file, backup)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    const temp = path.join(ws.stateDir, `graph.tmp-${process.pid}-${randomBytes(6).toString('hex')}.json`)
    await fs.writeFile(temp, JSON.stringify(graph, null, 2) + '\n', 'utf8')
    await fs.rename(temp, file)
  }

  async function get(rawWorkspace, query = {}, context) {
    const ws = await resolve(rawWorkspace, context)
    const graph = await readGraphAt(ws)
    const limit = Math.min(Math.max(Number.isInteger(query.limit) ? query.limit : 50, 1), 200)
    const include = Array.isArray(query.include) ? query.include : []
    const depth = Math.min(Math.max(Number.isInteger(query.depth) ? query.depth : 1, 0), 3)
    const target = findTarget(graph, query.target)
    const counts = graphCounts(graph)
    let text
    if (target.kind === 'overview') {
      text = renderOverview(graph, limit, include)
    } else if (target.kind === 'node') {
      text = renderNode(graph, target.value, { include: include.length > 0 ? include : ['summary', 'anchors', 'edges'], depth, limit })
    } else if (target.kind === 'edge') {
      text = renderEdge(graph, target.value)
    } else {
      text = renderGroup(graph, target.value, limit)
    }
    return { rev: graph.rev, counts, text }
  }

  /**
   * Fill missing anchor hashes (and optionally refresh all of them) from the
   * current files. Existing hashes are preserved unless refreshAnchors is true,
   * so a status-only patch cannot silently hide a stale anchor. The content
   * source owns the hash algorithm, so a remote project can use the remote
   * digest instead of a local file read.
   */
  async function refreshAnchorHashes(ws, graph, refreshAll) {
    const wanted = new Set()
    for (const node of graph.nodes) {
      for (const anchor of node.anchors ?? []) {
        if (refreshAll || anchor.hash === undefined) wanted.add(anchor.path)
      }
    }
    const hashes = wanted.size > 0 && ws.content && typeof ws.content.hashMany === 'function'
      ? await ws.content.hashMany([...wanted])
      : new Map()
    let updated = 0
    graph.nodes = graph.nodes.map(node => ({
      ...node,
      anchors: (node.anchors ?? []).map(anchor => {
        if (!refreshAll && anchor.hash !== undefined) return anchor
        const hash = hashes.get(anchor.path)
        if (typeof hash !== 'string') return anchor
        updated += 1
        return { ...anchor, hash }
      }),
    }))
    return updated
  }

  async function patch(rawWorkspace, input = {}, context) {
    const ws = await resolve(rawWorkspace, context)
    return withLock(ws.stateDir, async () => {
      const current = await readGraphAt(ws)
      if (!Number.isInteger(input.baseRev) || input.baseRev < 0) {
        fail('INVALID_OP', 'baseRev must be a non-negative integer')
      }
      if (input.baseRev !== current.rev) {
        fail('STALE_REV', `baseRev ${input.baseRev} does not match current rev ${current.rev}; call arch_graph_get again`)
      }
      const next = applyOps(current, input.ops, limits)
      const diff = diffGraphs(current, next)
      const changes = countChanges(diff)
      if (input.apply === false) {
        return {
          rev: current.rev,
          counts: graphCounts(current),
          text: `validated ${input.ops.length} op(s), ${changes} change(s); no write (rev stays ${current.rev})\n${formatDiff(diff)}`,
        }
      }
      const refreshed = await refreshAnchorHashes(ws, next, input.refreshAnchors === true)
      next.rev = current.rev + 1
      next.updatedAt = new Date().toISOString()
      await writeGraph(ws, next)
      const refreshLine = refreshed > 0 ? `\nanchors refreshed: ${refreshed}` : ''
      return {
        rev: next.rev,
        counts: graphCounts(next),
        text: `rev ${current.rev} -> ${next.rev} · applied ${input.ops.length} op(s), ${changes} change(s)\n${formatDiff(diff)}\n${formatCounts(graphCounts(next))}${refreshLine}`,
      }
    })
  }

  return { get, patch, readGraph, validateGraph, limits, dir: limits.dir }
}

/** Resolve the workspace from a tool call, falling back to the session cwd. */
export function workspaceOf(args, exec) {
  const explicit = args && typeof args.workspace === 'string' ? args.workspace.trim() : ''
  if (explicit !== '') return explicit
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') return cwd
  fail('WORKSPACE_REQUIRED', 'pass a workspace path or open a session with a working directory')
}
