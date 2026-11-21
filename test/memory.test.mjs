import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGraphStore } from '../src/host/graph.js'
import { createMemoryStore } from '../src/host/memory.js'

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'archmap-memory-test-'))
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await writeFile(path.join(dir, 'README.md'), '# Fixture\n')
  await writeFile(path.join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(path.join(dir, 'src', 'b.ts'), 'export const b = 2\n')
  const graph = createGraphStore({ dir: '.archmap' })
  const memory = createMemoryStore({ dir: '.archmap' }, {
    readGraph: graph.readGraph,
    markStale: async (workspace, ids) => {
      const current = await graph.readGraph(workspace)
      const wanted = [...new Set(ids)].filter(id => current.nodes.some(node => node.id === id && node.status !== 'stale'))
      if (wanted.length === 0) return { marked: [], rev: current.rev }
      const result = await graph.patch(workspace, {
        baseRev: current.rev,
        ops: wanted.map(id => ({ op: 'update_node', id, patch: { status: 'stale' } })),
      })
      return { marked: wanted, rev: result.rev }
    },
  })
  await graph.patch(dir, { baseRev: 0, ops: [
    { op: 'add_node', node: { id: 'n1', title: 'A', anchors: [{ path: 'src/a.ts' }] } },
    { op: 'add_node', node: { id: 'n2', title: 'B', anchors: [{ path: 'src/b.ts' }] } },
  ] })
  return { dir, graph, memory }
}

test('manifest, incremental sync, cosmetics, stale and dossier', async () => {
  const { dir, graph, memory } = await fixture()
  try {
    const full = await memory.sync(dir, { full: true })
    assert.equal(full.counts.scanned, 3)
    assert.equal(full.counts.added, 3)
    assert.equal(full.counts.affected, 2)

    const commit = await memory.commit(dir, { paths: ['README.md', 'src/a.ts', 'src/b.ts'] })
    assert.equal(commit.committed, 3)
    let sync = await memory.sync(dir, {})
    assert.deepEqual(sync.counts, { scanned: 3, added: 0, changed: 0, cosmetic: 0, deleted: 0, affected: 0, marked: 0 })

    // Cosmetic change: hash changes, normalized signature does not.
    await writeFile(path.join(dir, 'src', 'b.ts'), '// note\nexport const b  =  2\n')
    sync = await memory.sync(dir, { markStale: true })
    assert.equal(sync.counts.cosmetic, 1)
    assert.equal(sync.counts.affected, 0)
    assert.equal(sync.counts.marked, 0)
    assert.equal((await graph.readGraph(dir)).rev, 1)

    // Code change: mark the affected node stale.
    await writeFile(path.join(dir, 'src', 'a.ts'), 'export const a = 42\n')
    sync = await memory.sync(dir, { markStale: true })
    assert.equal(sync.counts.changed, 2)
    assert.equal(sync.counts.cosmetic, 1)
    assert.equal(sync.counts.affected, 1)
    assert.equal(sync.counts.marked, 1)
    assert.match(sync.text, /n1 "A"/)
    const stale = await graph.readGraph(dir)
    assert.equal(stale.nodes.find(node => node.id === 'n1').status, 'stale')

    await memory.commit(dir, { paths: ['src/a.ts', 'src/b.ts'] })
    sync = await memory.sync(dir, {})
    assert.equal(sync.counts.changed, 0)
    // The anchor hash still records a=1; refresh it after review.
    assert.equal(sync.counts.affected, 1)
    await graph.patch(dir, { baseRev: 2, refreshAnchors: true, ops: [
      { op: 'update_node', id: 'n1', patch: { status: 'fresh' } },
    ] })
    sync = await memory.sync(dir, {})
    assert.equal(sync.counts.affected, 0)

    const overview = await memory.putDoc(dir, { id: 'overview', content: '# Overview\n\nFixture.\n' })
    assert.ok(overview.bytes > 0)
    assert.equal((await memory.getDoc(dir, 'overview')).found, true)
    await memory.putDoc(dir, { id: 'notes/n1', content: 'first' })
    await memory.putDoc(dir, { id: 'notes/n1', mode: 'append', content: 'second' })
    assert.match((await memory.getDoc(dir, 'notes/n1')).text, /first[\s\S]*second/)
    await assert.rejects(() => memory.putDoc(dir, { id: 'modules/n1', content: 'x'.repeat(40_000) }), /LIMIT_EXCEEDED/)
    await assert.rejects(() => memory.getDoc(dir, 'modules/../x'), /INVALID_DOC/)
    await assert.rejects(() => memory.commit(dir, { paths: ['../x'] }), /PATH_ESCAPE/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('anchor hash mismatch affects a node even with a clean manifest', async () => {
  const { dir, graph, memory } = await fixture()
  try {
    await memory.commit(dir, { paths: ['README.md', 'src/a.ts', 'src/b.ts'] })
    const current = await graph.readGraph(dir)
    const n1 = current.nodes.find(node => node.id === 'n1')
    assert.match(n1.anchors[0].hash, /^[0-9a-f]{64}$/)
    await graph.patch(dir, { baseRev: current.rev, ops: [
      { op: 'update_node', id: 'n1', patch: { anchors: [{ path: 'src/a.ts', hash: 'deadbeef' }] } },
    ] })
    let sync = await memory.sync(dir, {})
    assert.equal(sync.counts.changed, 0)
    assert.equal(sync.counts.affected, 1)
    assert.match(sync.text, /n1 "A"/)
    const fixed = await graph.patch(dir, { baseRev: 2, refreshAnchors: true, ops: [
      { op: 'update_node', id: 'n1', patch: { status: 'fresh' } },
    ] })
    assert.match(fixed.text, /anchors refreshed: 2/)
    sync = await memory.sync(dir, {})
    assert.equal(sync.counts.affected, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deleted files are reported and removed from the manifest', async () => {
  const { dir, graph, memory } = await fixture()
  try {
    await memory.commit(dir, { paths: ['README.md', 'src/a.ts', 'src/b.ts'] })
    await rm(path.join(dir, 'src', 'b.ts'))
    let sync = await memory.sync(dir, {})
    assert.equal(sync.counts.deleted, 1)
    assert.equal(sync.counts.affected, 1)
    assert.match(sync.text, /src\/b\.ts/)
    const commit = await memory.commit(dir, { paths: ['src/b.ts'] })
    assert.equal(commit.removed, 1)
    sync = await memory.sync(dir, {})
    assert.equal(sync.counts.deleted, 0)
    assert.equal(sync.counts.affected, 0)
    assert.equal((await graph.readGraph(dir)).rev, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
