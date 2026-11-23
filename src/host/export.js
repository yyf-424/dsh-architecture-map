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
import { resolveWorkspace } from './workspace.js'

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
    lines.push('  classDef proposed fill:#fdecec,stroke:#d9534f,color:#6b1f1f;')
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
  let width = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X
  let height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y
  // A pinned position is a top-left corner in graph coordinates; the grid is
  // only the fallback for nodes that do not carry one.
  for (const node of nodes) {
    const position = node.position
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue
    const box = positions.get(node.id)
    box.x = position.x
    box.y = position.y
    width = Math.max(width, box.x + box.w + PAD)
    height = Math.max(height, box.y + box.h + PAD)
  }
  return { positions, width: Math.ceil(width), height: Math.ceil(height) }
}

function edgeRoute(from, to, boxes = []) {
  const fx = from.x + from.w / 2
  const fy = from.y + from.h / 2
  const tx = to.x + to.w / 2
  const ty = to.y + to.h / 2
  const dx = tx - fx
  const dy = ty - fy
  const horizontal = Math.abs(dx) >= (from.w + to.w) / 2 - 8
  if (horizontal && dx >= 0) {
    const start = { x: from.x + from.w, y: fy }
    const end = { x: to.x, y: ty }
    const blockers = Math.abs(dy) > 4 ? [] : boxes.filter(box => {
      if (box === from || box === to) return false
      return box.x < end.x
        && box.x + box.w > start.x
        && box.y < fy
        && box.y + box.h > fy
    })
    if (blockers.length > 0) {
      const top = Math.min(fy, ...blockers.map(box => box.y)) - 26
      const bottom = Math.max(fy, ...blockers.map(box => box.y + box.h)) + 18
      const lane = top >= 12 && fy - top <= bottom - fy ? top : bottom
      const inner = 10
      return {
        d: [
          `M ${start.x} ${start.y}`,
          `L ${start.x + inner} ${start.y}`,
          `L ${start.x + inner} ${lane}`,
          `L ${end.x - inner} ${lane}`,
          `L ${end.x - inner} ${end.y}`,
          `L ${end.x} ${end.y}`,
        ].join(' '),
        label: { x: (start.x + end.x) / 2, y: lane - 6 },
      }
    }
    return {
      d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6 },
      gap: to.x - (from.x + from.w),
      above: Math.max(12, Math.min(from.y, to.y) - 12),
    }
  }
  if (horizontal) {
    const start = { x: from.x, y: fy }
    const end = { x: to.x + to.w, y: ty }
    const bow = 70 + Math.min(60, Math.abs(dx) * 0.08)
    const controlY = Math.abs(dy) < 24
      ? Math.max(start.y, end.y) + bow
      : (start.y + end.y) / 2
    const control = { x: (start.x + end.x) / 2, y: controlY }
    return {
      d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      label: {
        x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
        y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
      },
    }
  }
  const start = { x: fx, y: dy >= 0 ? from.y + from.h : from.y }
  const end = { x: tx, y: dy >= 0 ? to.y : to.y + to.h }
  return {
    d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6 },
  }
}

function svgSource(graph) {
  const { positions, width, height } = gridLayout(graph)
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const palette = {
    fresh: ['#eef4ff', '#6f93c9', '#22344f'],
    stale: ['#f6e7c1', '#c58a1a', '#5d4300'],
    proposed: ['#fdecec', '#d9534f', '#6b1f1f'],
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
  const boxes = [...positions.values()]
  for (const edge of edges) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const route = edgeRoute(from, to, boxes)
    lines.push(`  <path d="${route.d}" fill="none" stroke="#7b8794" stroke-width="1.4" stroke-opacity="0.7" stroke-linecap="round" marker-end="url(#arrow)"/>`)
    if (edge.label) {
      const label = String(edge.label)
      const labelWidth = [...label].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10 : 6), 0) + 8
      const tight = route.gap !== undefined && labelWidth + 6 > route.gap
      const labelY = tight ? route.above : route.label.y
      lines.push(`  <rect x="${(route.label.x - labelWidth / 2).toFixed(1)}" y="${(labelY - 9).toFixed(1)}" width="${labelWidth}" height="14" rx="3" fill="#ffffff" opacity="0.92"/>`)
      lines.push(`  <text x="${route.label.x.toFixed(1)}" y="${(labelY + 2).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#52606d">${xml(label)}</text>`)
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
  const resolve = typeof deps.resolve === 'function'
    ? deps.resolve
    : (rawWorkspace, context) => resolveWorkspace(rawWorkspace, context, { dir: deps.dir ?? '.archmap', ssh: deps.ssh })

  async function run(rawWorkspace, input = {}, context) {
    if (typeof deps.readGraph !== 'function') fail('UNAVAILABLE', 'graph reader is not available')
    const format = String(input.format ?? '')
    const spec = FORMATS[format]
    if (!spec) fail('INVALID_FORMAT', 'format must be mermaid, svg or markdown')
    const ws = await resolve(rawWorkspace, context)
    const graph = await deps.readGraph(ws, context)
    let content
    if (format === 'mermaid') content = mermaidSource(graph)
    else if (format === 'svg') content = svgSource(graph)
    else content = markdownSource(graph)
    const dir = path.join(ws.stateDir, 'export')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, spec.file)
    const temp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
    const relative = path.relative(ws.pathBase, file).split(path.sep).join('/')
    return {
      text: `exported ${spec.label} to ${relative} (${Buffer.byteLength(content, 'utf8')} bytes)`,
      path: relative,
      bytes: Buffer.byteLength(content, 'utf8'),
      format,
    }
  }
  return { export: run, formats: Object.keys(FORMATS) }
}
