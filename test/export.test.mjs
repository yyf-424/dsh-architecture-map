import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGraphStore } from '../src/host/graph.js'
import { createExporter } from '../src/host/export.js'

test('Mermaid, SVG and Markdown exports are deterministic and do not change the graph', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'archmap-export-test-'))
  const graph = createGraphStore({ dir: '.archmap' })
  const exporter = createExporter({ readGraph: graph.readGraph })
  try {
    await graph.patch(dir, { baseRev: 0, ops: [
      { op: 'set_group', group: { id: 'g-core', title: 'Core' } },
      { op: 'add_node', node: { id: 'n1', title: 'Entry "API"', kind: 'entry', group: 'g-core', summary: 'Requests enter.', anchors: [{ path: 'src/a.ts', symbol: 'apply' }] } },
      { op: 'add_node', node: { id: 'n2', title: 'Store', kind: 'store', group: 'g-core', status: 'stale' } },
      { op: 'add_edge', edge: { id: 'e1', from: 'n1', to: 'n2', label: 'writes', kind: 'call' } },
    ] })
    const before = await graph.readGraph(dir)
    const mermaid = await exporter.export(dir, { format: 'mermaid' })
    assert.equal(mermaid.format, 'mermaid')
    assert.equal(mermaid.path, '.archmap/export/architecture.mmd')
    const mmd = await readFile(path.join(dir, mermaid.path), 'utf8')
    assert.match(mmd, /^flowchart LR/)
    assert.match(mmd, /subgraph g-core\["Core"\]/)
    assert.match(mmd, /n1\["Entry 'API'<br\/>/)
    assert.match(mmd, /n1 -->\|"writes"\| n2/)
    assert.match(mmd, /class n2 stale/)

    const svg = await exporter.export(dir, { format: 'svg' })
    const svgText = await readFile(path.join(dir, svg.path), 'utf8')
    assert.match(svgText, /^<svg /)
    assert.match(svgText, /<marker id="arrow"/)
    assert.match(svgText, /Entry &quot;API&quot;/)
    assert.match(svgText, /<line /)

    const markdown = await exporter.export(dir, { format: 'markdown' })
    const md = await readFile(path.join(dir, markdown.path), 'utf8')
    assert.match(md, /^# Architecture map/)
    assert.match(md, /### n1 — Entry "API"/)
    assert.match(md, /- anchors: `src\/a\.ts#apply`/)
    assert.match(md, /`e1`: n1 → n2 — writes \(call\)/)

    assert.equal((await stat(path.join(dir, mermaid.path))).isFile(), true)
    assert.equal((await graph.readGraph(dir)).rev, before.rev)
    await assert.rejects(() => exporter.export(dir, { format: 'pdf' }), /INVALID_FORMAT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
