import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGraphStore } from '../src/host/graph.js'

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'archmap-graph-test-'))
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await writeFile(path.join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  return dir
}

test('graph store validates, backs up, conflicts and refreshes anchor hashes', async () => {
  const dir = await fixture()
  const store = createGraphStore({ dir: '.archmap' })
  try {
    const add = await store.patch(dir, { baseRev: 0, ops: [
      { op: 'set_group', group: { id: 'g-core', title: 'Core' } },
      { op: 'add_node', node: { id: 'n1', title: 'A', group: 'g-core', anchors: [{ path: 'src/a.ts', symbol: 'a' }] } },
      { op: 'add_node', node: { id: 'n2', title: 'B', group: 'g-core' } },
      { op: 'add_edge', edge: { id: 'e1', from: 'n1', to: 'n2', label: 'uses', kind: 'call' } },
    ] })
    assert.equal(add.rev, 1)
    const graph = await store.readGraph(dir)
    assert.equal(graph.rev, 1)
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)
    assert.match(graph.nodes[0].anchors[0].hash, /^[0-9a-f]{64}$/)

    const preview = await store.patch(dir, { baseRev: 1, apply: false, ops: [
      { op: 'update_node', id: 'n1', patch: { summary: 'preview' } },
    ] })
    assert.match(preview.text, /no write/)
    assert.equal((await store.readGraph(dir)).rev, 1)

    const update = await store.patch(dir, { baseRev: 1, ops: [
      { op: 'update_node', id: 'n1', patch: { summary: 'updated', status: 'stale' } },
    ] })
    assert.equal(update.rev, 2)
    assert.equal((await store.readGraph(dir)).nodes.find(node => node.id === 'n1').summary, 'updated')
    const backup = JSON.parse(await readFile(path.join(dir, '.archmap', 'graph.bak.json'), 'utf8'))
    assert.equal(backup.rev, 1)

    await assert.rejects(
      () => store.patch(dir, { baseRev: 1, ops: [{ op: 'update_node', id: 'n1', patch: { status: 'fresh' } }] }),
      /STALE_REV/,
    )
    await assert.rejects(
      () => store.patch(dir, { baseRev: 2, ops: [{ op: 'add_node', node: { id: 'Bad', title: 'bad' } }] }),
      /INVALID_GRAPH/,
    )
    await assert.rejects(
      () => store.patch(dir, { baseRev: 2, ops: [{ op: 'update_node', id: 'n1', patch: { anchors: [{ path: '../x' }] } }] }),
      /PATH_ESCAPE/,
    )

    const refreshed = await store.patch(dir, { baseRev: 2, refreshAnchors: true, ops: [
      { op: 'update_node', id: 'n1', patch: { status: 'fresh' } },
    ] })
    assert.match(refreshed.text, /anchors refreshed: 1/)
    assert.equal((await store.readGraph(dir)).nodes.find(node => node.id === 'n1').status, 'fresh')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cyclic graphs are still valid data', async () => {
  const dir = await fixture()
  const store = createGraphStore({ dir: '.archmap' })
  try {
    await store.patch(dir, { baseRev: 0, ops: [
      { op: 'add_node', node: { id: 'n1', title: 'A' } },
      { op: 'add_node', node: { id: 'n2', title: 'B' } },
      { op: 'add_edge', edge: { id: 'e1', from: 'n1', to: 'n2' } },
      { op: 'add_edge', edge: { id: 'e2', from: 'n2', to: 'n1' } },
    ] })
    const graph = await store.readGraph(dir)
    assert.equal(graph.edges.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('accepts a 12-node / 19-edge graph shape', async () => {
  const dir = await fixture()
  const store = createGraphStore({ dir: '.archmap' })
  try {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      op: 'add_node',
      node: { id: `n${index + 1}`, title: `Node ${index + 1}` },
    }))
    const edges = Array.from({ length: 19 }, (_, index) => {
      const from = (index % 11) + 1
      const to = ((index % 11) + 1) + 1
      return { op: 'add_edge', edge: { id: `e${index + 1}`, from: `n${from}`, to: `n${to}`, kind: 'call' } }
    })
    const result = await store.patch(dir, { baseRev: 0, ops: [...nodes, ...edges] })
    assert.equal(result.rev, 1)
    const graph = await store.readGraph(dir)
    assert.equal(graph.nodes.length, 12)
    assert.equal(graph.edges.length, 19)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
