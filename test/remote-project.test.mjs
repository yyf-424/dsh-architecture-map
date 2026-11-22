import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGraphStore } from '../src/host/graph.js'
import { createMemoryStore } from '../src/host/memory.js'
import { createExporter } from '../src/host/export.js'
import { resolveWorkspace } from '../src/host/workspace.js'
import { INDEX_SCHEMA, LOCAL_PROJECT_ID, writeIndex } from '../src/host/projects.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'
const APP_TS = 'export const app = 1\n'

function hashOf(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function fixture() {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-remote-project-'))
  const remote = await mkdtemp(path.join(tmpdir(), 'archmap-remote-root-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-remote-project-log-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await mkdir(path.join(remote, 'src'), { recursive: true })
  await writeFile(path.join(remote, 'src', 'app.ts'), APP_TS)
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
  const context = { agent: { session: { header: { cwd: hub } } } }
  const store = createGraphStore({ dir: '.archmap', ssh })
  const memory = createMemoryStore({ dir: '.archmap', ssh }, { readGraph: store.readGraph })
  const exporter = createExporter({
    readGraph: store.readGraph,
    resolve: (raw, ctx) => resolveWorkspace(raw, ctx, { dir: '.archmap', ssh }),
  })
  return { hub, remote, logDir, log, ssh, context, store, memory, exporter }
}

async function cleanup(item) {
  await rm(item.hub, { recursive: true, force: true })
  await rm(item.remote, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('remote project patches a graph, hashes anchors remotely and keeps state local', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const added = await item.store.patch('remote:staging', {
      baseRev: 0,
      ops: [
        { op: 'add_node', node: { id: 'n1', title: 'Remote app', anchors: [{ path: 'src/app.ts' }] } },
      ],
    }, item.context)
    assert.equal(added.rev, 1)

    const graph = await item.store.readGraph('remote:staging', item.context)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].anchors[0].hash, hashOf(APP_TS))

    const stateFile = path.join(item.hub, '.archmap', 'projects', 'staging', 'graph.json')
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).nodes[0].id, 'n1')
    assert.equal(await readFile(path.join(item.hub, '.archmap', 'graph.json'), 'utf8').catch(() => null), null)

    const overview = await item.store.get('remote:staging', { target: 'overview' }, item.context)
    assert.match(overview.text, /n1 "Remote app"/)

    const doc = await item.memory.putDoc('remote:staging', { id: 'overview', content: '# Remote\n' }, item.context)
    assert.ok(doc.bytes > 0)
    assert.equal(await readFile(path.join(item.hub, '.archmap', 'projects', 'staging', 'overview.md'), 'utf8'), '# Remote\n')
    assert.equal((await item.memory.getDoc('remote:staging', 'overview', item.context)).found, true)

    const exported = await item.exporter.export('remote:staging', { format: 'markdown' }, item.context)
    assert.equal(exported.path, '.archmap/projects/staging/export/architecture.md')
    assert.match(await readFile(path.join(item.hub, exported.path), 'utf8'), /^# Architecture map/)

    const log = await readFile(item.log, 'utf8')
    assert.match(log, /sha256sum|shasum/)
    for (const verb of [' rm ', ' mv ', ' cp ', ' tee ', ' chmod ', ' mkdir ', ' touch ']) {
      assert.equal(log.includes(verb), false, verb)
    }
  } finally {
    await cleanup(item)
  }
})

test('remote anchors refresh after a remote file change', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    await item.store.patch('remote:staging', {
      baseRev: 0,
      ops: [{ op: 'add_node', node: { id: 'n1', title: 'Remote app', anchors: [{ path: 'src/app.ts' }] } }],
    }, item.context)
    const before = (await item.store.readGraph('remote:staging', item.context)).nodes[0].anchors[0].hash

    await writeFile(path.join(item.remote, 'src', 'app.ts'), 'export const app = 2\n')
    await item.store.patch('remote:staging', {
      baseRev: 1,
      refreshAnchors: true,
      ops: [{ op: 'update_node', id: 'n1', patch: { status: 'fresh' } }],
    }, item.context)
    const after = (await item.store.readGraph('remote:staging', item.context)).nodes[0].anchors[0].hash
    assert.notEqual(after, before)
    assert.equal(after, hashOf('export const app = 2\n'))
  } finally {
    await cleanup(item)
  }
})
