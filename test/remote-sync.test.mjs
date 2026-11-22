import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEX_SCHEMA, LOCAL_PROJECT_ID, writeIndex } from '../src/host/projects.js'
import { createGraphStore } from '../src/host/graph.js'
import { createMemoryStore } from '../src/host/memory.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'
const A_TS = 'export const a = 1\n'
const C_JS = 'export const c = 3\n'

async function fixture() {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-remote-sync-'))
  const remote = await mkdtemp(path.join(tmpdir(), 'archmap-remote-sync-root-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-remote-sync-log-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await mkdir(path.join(remote, 'sub'), { recursive: true })
  await writeFile(path.join(remote, 'a.ts'), A_TS)
  await writeFile(path.join(remote, 'sub', 'c.js'), C_JS)
  await writeFile(path.join(remote, 'b.md'), '# B\n')
  await writeFile(path.join(remote, 'raw.png'), Buffer.from('a\0b'))
  const log = path.join(logDir, 'ssh.log')

  await writeIndex(hub, {
    schema: INDEX_SCHEMA,
    projects: [
      { id: LOCAL_PROJECT_ID, kind: 'local', title: 'Local', dir: '.' },
      {
        id: 'staging',
        kind: 'remote',
        title: 'staging',
        dir: 'projects/staging',
        transport: 'ssh',
        host: 'build-01',
        root: remote,
        vcs: 'none',
        autoRefresh: true,
      },
    ],
  })

  const ssh = {
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 5_000,
    env: { FAKE_SSH_ROOT: remote, FAKE_SSH_LOG: log },
  }
  const context = { agent: { session: { id: 's1', header: { cwd: hub } } } }
  const store = createGraphStore({ dir: '.archmap', ssh })
  await store.patch('remote:staging', {
    baseRev: 0,
    ops: [
      { op: 'add_node', node: { id: 'n1', title: 'A', anchors: [{ path: 'a.ts' }] } },
      { op: 'add_node', node: { id: 'n2', title: 'C', anchors: [{ path: 'sub/c.js' }] } },
    ],
  }, context)

  const markStale = async (workspace, ids, ctx) => {
    const current = await store.readGraph(workspace, ctx)
    const wanted = [...new Set(ids)].filter(id => current.nodes.some(node => node.id === id && node.status !== 'stale'))
    if (wanted.length === 0) return { marked: [], rev: current.rev }
    const result = await store.patch(workspace, {
      baseRev: current.rev,
      ops: wanted.map(id => ({ op: 'update_node', id, patch: { status: 'stale' } })),
    }, ctx)
    return { marked: wanted, rev: result.rev }
  }

  const memory = createMemoryStore({ dir: '.archmap', ssh }, {
    readGraph: store.readGraph,
    markStale,
  })
  return { hub, remote, logDir, log, ssh, context, store, memory }
}

async function cleanup(item) {
  await rm(item.hub, { recursive: true, force: true })
  await rm(item.remote, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('remote sync lists paths, hashes analyzed files and never pulls content', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const full = await item.memory.sync('remote:staging', { full: true }, item.context)
    assert.equal(full.counts.scanned, 3)
    assert.equal(full.counts.added, 3)
    assert.equal(full.counts.affected, 2)
    assert.match(full.text, /workspace: remote:staging/)

    const commit = await item.memory.commit('remote:staging', { paths: ['a.ts', 'sub/c.js', 'b.md'] }, item.context)
    assert.equal(commit.committed, 3)

    const manifest = JSON.parse(await readFile(path.join(item.hub, '.archmap', 'projects', 'staging', 'manifest.json'), 'utf8'))
    assert.equal(manifest.files['a.ts'].sha256.length, 64)
    assert.equal(manifest.files['a.ts'].signature, undefined)

    const clean = await item.memory.sync('remote:staging', {}, item.context)
    assert.deepEqual(clean.counts, { scanned: 3, added: 0, changed: 0, cosmetic: 0, deleted: 0, affected: 0, marked: 0 })

    await writeFile(path.join(item.remote, 'a.ts'), 'export const a = 42\n')
    const changed = await item.memory.sync('remote:staging', { markStale: true }, item.context)
    assert.equal(changed.counts.changed, 1)
    assert.equal(changed.counts.affected, 1)
    assert.equal(changed.counts.marked, 1)
    assert.match(changed.text, /n1 "A"/)

    const graph = await item.store.readGraph('remote:staging', item.context)
    assert.equal(graph.nodes.find(node => node.id === 'n1').status, 'stale')

    await item.memory.commit('remote:staging', { paths: ['a.ts'] }, item.context)
    const staleAnchor = await item.memory.sync('remote:staging', {}, item.context)
    assert.equal(staleAnchor.counts.changed, 0)
    assert.equal(staleAnchor.counts.affected, 1)
    await item.store.patch('remote:staging', {
      baseRev: graph.rev,
      refreshAnchors: true,
      ops: [{ op: 'update_node', id: 'n1', patch: { status: 'fresh' } }],
    }, item.context)
    const refreshed = await item.memory.sync('remote:staging', {}, item.context)
    assert.equal(refreshed.counts.affected, 0)

    await writeFile(path.join(item.remote, 'new.ts'), 'export const n = 4\n')
    const added = await item.memory.sync('remote:staging', {}, item.context)
    assert.equal(added.counts.added, 1)
    assert.equal(added.counts.scanned, 4)

    await unlink(path.join(item.remote, 'b.md'))
    const deleted = await item.memory.sync('remote:staging', {}, item.context)
    assert.equal(deleted.counts.deleted, 1)

    const log = await readFile(item.log, 'utf8')
    for (const forbidden of [' cat ', ' sed ', ' head ']) {
      assert.equal(log.includes(forbidden), false, forbidden)
    }
  } finally {
    await cleanup(item)
  }
})
