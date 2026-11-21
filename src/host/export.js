/**
 * Architecture map — deterministic graph exports (node 10).
 *
 * Mermaid source, a standalone SVG and a Markdown dossier digest, all generated
 * from `.archmap/graph.json` without a browser or a Mermaid runtime. Files land in
 * `.archmap/export/`; the graph itself is never modified.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const FORMATS = Object.freeze({
  mermaid: { file: 'architecture.mmd', label: 'Mermaid' },
  svg: { file: 'architecture.svg', label: 'SVG' },
  markdown: { file: 'architecture.md', label: 'Markdown' },
})

const NODE_W = 210
const NODE_H = 84
const GAP_X = 28
const GAP_Y = 30
const PAD = 28

function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  throw error
}

async function resolveRoot(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('WORKSPACE_REQUIRED', 'pass a workspace path or open a session with a working directory')
  }
  if (!path.isAbsolute(raw)) fail('INVALID_WORKSPACE', 'workspace must be an absolute path')
  let root
  try {
    root = await fs.realpath(raw)
  } catch {
    fail('INVALID_WORKSPACE', `workspace "${raw}" does not exist`)
  }
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) fail('INVALID_WORKSPACE', `workspace "${raw}" is not a directory`)
  return root
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mermaidLabel(value) {
  return String(value ?? '')
    .replace(/"/g, "'")
    .replace(/\r?\n/g, '<br/>')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function directionOf(graph) {
  const direction = String(graph?.layout?.direction ?? 'LR').toUpperCase()
  return direction === 'TB' || direction === 'TD' ? 'TD' : direction === 'RL' ? 'RL' : direction === 'BT' ? 'BT' : 'LR'
}

function mermaidSource(graph) {
  const lines = [`flowchart ${directionOf(graph)}`]
  const groups = Array.isArray(graph.groups) ? graph.groups : []
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const groupIds = new Set(groups.map(group => group.id))
  const nodeLine = node => {
    const parts = [node.kind ?? 'module']
    if (node.group) parts.push(node.group)
    if (node.status) parts.push(node.status)
    return `  ${node.id}["${mermaidLabel(node.title ?? node.id)}<br/><small>${mermaidLabel(parts.join(' · '))}</small>"]`
  }

  for (const group of groups) {
    lines.push(`  subgraph ${group.id}["${mermaidLabel(group.title ?? group.id)}"]`)
    for (const node of nodes.filter(item => item.group === group.id)) lines.push(nodeLine(node))
    lines.push('  end')
  }
  for (const node of nodes.filter(item => !item.group || !groupIds.has(item.group))) lines.push(nodeLine(node))

  for (const edge of edges) {
    const label = String(edge.label ?? '').trim()
    const kind = String(edge.kind ?? '').trim()
    const text = label || kind
    lines.push(text
      ? `  ${edge.from} -->|"${mermaidLabel(text)}"| ${edge.to}`
      : `  ${edge.from} --> ${edge.to}`)
  }

  const stale = nodes.filter(node => node.status === 'stale').map(node => node.id)
  const proposed = nodes.filter(node => node.status === 'proposed').map(node => node.id)
  if (stale.length > 0) {
    lines.push('  classDef stale fill:#f6e7c1,stroke:#c58a1a,color:#6b4a00;')
    lines.push(`  class ${stale.join(',')} stale;`)
  }
  if (proposed.length > 0) {
    lines.push('  classDef proposed fill:#f3e8ff,stroke:#9a6bd1,color:#4f2b6e;')
    lines.push(`  class ${proposed.join(',')} proposed;`)
  }
  return lines.join('\n') + '\n'
}

function markdownSource(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const groups = Array.isArray(graph.groups) ? graph.groups : []
  const lines = [
    '# Architecture map',
    '',
    `rev ${graph.rev} · ${nodes.length} nodes · ${edges.length} edges · ${groups.length} groups`,
    '',
  ]
  if (groups.length > 0) {
    lines.push('## Groups', '')
    for (const group of groups) lines.push(`- **${group.id}** — ${group.title ?? group.id}`)
    lines.push('')
  }
  lines.push('## Nodes', '')
  for (const node of nodes) {
    lines.push(`### ${node.id} — ${node.title ?? node.id}`, '')
    lines.push(`- kind: \`${node.kind ?? 'module'}\``)
    lines.push(`- status: \`${node.status ?? 'fresh'}\``)
    if (node.group) lines.push(`- group: \`${node.group}\``)
    if (node.summary) lines.push(`- summary: ${node.summary}`)
    if (Array.isArray(node.anchors) && node.anchors.length > 0) {
      lines.push(`- anchors: ${node.anchors.map(anchor => `\`${anchor.path}${anchor.symbol ? `#${anchor.symbol}` : ''}\``).join(', ')}`)
    }
    lines.push('')
  }
  lines.push('## Edges', '')
  if (edges.length === 0) lines.push('(none)')
  for (const edge of edges) {
    const label = edge.label ? ` — ${edge.label}` : ''
    const kind = edge.kind ? ` (${edge.kind})` : ''
    lines.push(`- \`${edge.id}\`: ${edge.from} → ${edge.to}${label}${kind}`)
  }
  return lines.join('\n') + '\n'
}

function gridLayout(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, nodes.length)))))
  const rows = Math.max(1, Math.ceil(nodes.length / cols))
  const positions = new Map()
  nodes.forEach((node, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    positions.set(node.id, {
      x: PAD + col * (NODE_W + GAP_X),
      y: PAD + row * (NODE_H + GAP_Y),
      w: NODE_W,
      h: NODE_H,
    })
  })
  const width = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y
  return { positions, width, height }
}

function svgSource(graph) {
  const { positions, width, height } = gridLayout(graph)
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const palette = {
    fresh: ['#eef4ff', '#6f93c9', '#22344f'],
    stale: ['#f6e7c1', '#c58a1a', '#5d4300'],
    proposed: ['#f3e8ff', '#9a6bd1', '#42205f'],
  }
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Architecture map">`,
    '  <defs>',
    '    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
    '      <path d="M 0 0 L 10 5 L 0 10 z" fill="#7b8794"/>',
    '    </marker>',
    '  </defs>',
    `  <rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ]
  for (const edge of edges) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const x1 = from.x + from.w
    const y1 = from.y + from.h / 2
    const x2 = to.x
    const y2 = to.y + to.h / 2
    lines.push(`  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7b8794" stroke-width="1.4" stroke-opacity="0.7" marker-end="url(#arrow)"/>`)
    if (edge.label) {
      lines.push(`  <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#52606d">${xml(edge.label)}</text>`)
    }
  }
  for (const node of nodes) {
    const box = positions.get(node.id)
    if (!box) continue
    const [fill, stroke, ink] = palette[node.status] ?? palette.fresh
    lines.push(`  <g id="${xml(node.id)}">`)
    lines.push(`    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`)
    lines.push(`    <text x="${box.x + 12}" y="${box.y + 26}" font-family="sans-serif" font-size="13" font-weight="600" fill="${ink}">${xml(node.title ?? node.id)}</text>`)
    lines.push(`    <text x="${box.x + 12}" y="${box.y + 46}" font-family="sans-serif" font-size="10" fill="${ink}" opacity="0.7">${xml(node.kind ?? 'module')}${node.group ? ` · ${xml(node.group)}` : ''}${node.status ? ` · ${xml(node.status)}` : ''}</text>`)
    lines.push(`    <text x="${box.x + 12}" y="${box.y + 64}" font-family="ui-monospace, monospace" font-size="9" fill="${ink}" opacity="0.55">${xml(node.id)}</text>`)
    lines.push('  </g>')
  }
  lines.push('</svg>')
  return lines.join('\n') + '\n'
}

export function createExporter(deps = {}) {
  async function run(rawWorkspace, input = {}) {
    if (typeof deps.readGraph !== 'function') fail('UNAVAILABLE', 'graph reader is not available')
    const format = String(input.format ?? '')
    const spec = FORMATS[format]
    if (!spec) fail('INVALID_FORMAT', 'format must be mermaid, svg or markdown')
    const root = await resolveRoot(rawWorkspace)
    const graph = await deps.readGraph(root)
    let content
    if (format === 'mermaid') content = mermaidSource(graph)
    else if (format === 'svg') content = svgSource(graph)
    else content = markdownSource(graph)
    const dir = path.join(root, '.archmap', 'export')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, spec.file)
    const temp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
    const relative = path.posix.join('.archmap/export', spec.file)
    return {
      text: `exported ${spec.label} to ${relative} (${Buffer.byteLength(content, 'utf8')} bytes)`,
      path: relative,
      bytes: Buffer.byteLength(content, 'utf8'),
      format,
    }
  }
  return { export: run, formats: Object.keys(FORMATS) }
}
