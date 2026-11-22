import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  INDEX_SCHEMA,
  LOCAL_PROJECT_ID,
  loadIndex,
  projectById,
  validateIndex,
  writeIndex,
} from '../src/host/projects.js'
import { resolveWorkspace } from '../src/host/workspace.js'
import { createGraphStore } from '../src/host/graph.js'
import { createMemoryStore } from '../src/host/memory.js'
import { createExporter } from '../src/host/export.js'

const REMOTE = {
  id: 'staging',
  kind: 'remote',
  title: 'staging',
  dir: 'projects/staging',
  transport: 'ssh',
  host: 'build-01',
  root: '/srv/app',
  vcs: 'git',
  autoRefresh: true,
}

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'archmap-projects-test-'))
  await mkdir(path.join(dir, '.archmap'), { recursive: true })
  await writeFile(path.join(dir, 'src.js'), 'export const value = 1\n')
  return dir
}

function contextFor(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('missing index keeps the legacy local project', async () => {
  const dir = await fixture()
  try {
    const index = await loadIndex(dir)
    assert.equal(index.schema, INDEX_SCHEMA)
    assert.equal(index.projects.length, 1)
    assert.equal(index.projects[0].id, LOCAL_PROJECT_ID)
    assert.equal(index.projects[0].dir, '.')

    const local = await resolveWorkspace(dir)
    const real = await realpath(dir)
    assert.equal(local.kind, 'local')
    assert.equal(local.display, real)
    assert.equal(local.workspaceRoot, real)
    assert.equal(local.stateDir, path.join(real, '.archmap'))
    assert.equal(local.pathBase, real)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('one .archmap holds local and remote projects with separate state dirs', async () => {
  const dir = await fixture()
  try {
    const written = await writeIndex(dir, {
      schema: INDEX_SCHEMA,
      projects: [
        { id: LOCAL_PROJECT_ID, kind: 'local', title: 'Local', dir: '.' },
        REMOTE,
      ],
    })
    assert.equal(written.projects.length, 2)
    const persisted = JSON.parse(await readFile(path.join(dir, '.archmap', 'index.json'), 'utf8'))
    assert.equal(persisted.projects[1].host, 'build-01')
    assert.equal(persisted.projects[1].root, '/srv/app')

    const index = await loadIndex(dir)
    assert.equal(projectById(index, 'staging').dir, 'projects/staging')

    const real = await realpath(dir)
    const remote = await resolveWorkspace('remote:staging', contextFor(dir))
    assert.equal(remote.kind, 'remote')
    assert.equal(remote.display, 'remote:staging')
    assert.equal(remote.workspaceRoot, '/srv/app')
    assert.equal(remote.stateDir, path.join(real, '.archmap', 'projects', 'staging'))
    assert.equal(remote.pathBase, real)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('validateIndex adds the local project and rejects unsafe projects', async () => {
  const added = validateIndex({ schema: INDEX_SCHEMA, projects: [REMOTE] })
  assert.equal(added.projects[0].id, LOCAL_PROJECT_ID)

  const cases = [
    { name: 'bad id', project: { ...REMOTE, id: 'Bad' }, pattern: /INVALID_PROJECT/ },
    { name: 'local id as remote', project: { ...REMOTE, id: 'local' }, pattern: /INVALID_PROJECT/ },
    { name: 'dir escape', project: { ...REMOTE, dir: '../x' }, pattern: /PATH_ESCAPE/ },
    { name: 'absolute dir', project: { ...REMOTE, dir: '/tmp/x' }, pattern: /PATH_ESCAPE/ },
    { name: 'missing host', project: { ...REMOTE, host: undefined }, pattern: /INVALID_PROJECT/ },
    { name: 'relative root', project: { ...REMOTE, root: 'srv/app' }, pattern: /PATH_ESCAPE/ },
    { name: 'bad vcs', project: { ...REMOTE, vcs: 'svn' }, pattern: /INVALID_PROJECT/ },
    { name: 'unknown field', project: { ...REMOTE, extra: true }, pattern: /INVALID_PROJECT/ },
    { name: 'local with dir', project: { id: 'local', kind: 'local', dir: 'projects/local' }, pattern: /INVALID_PROJECT/ },
    { name: 'local with remote field', project: { id: 'local', kind: 'local', dir: '.', host: 'x' }, pattern: /INVALID_PROJECT/ },
  ]
  for (const item of cases) {
    assert.throws(() => validateIndex({ schema: INDEX_SCHEMA, projects: [item.project] }), item.pattern, item.name)
  }

  assert.throws(
    () => validateIndex({
      schema: INDEX_SCHEMA,
      projects: [REMOTE, { ...REMOTE, id: 'other', dir: 'projects/staging' }],
    }),
    /reuses directory/,
  )
  assert.throws(() => validateIndex({ schema: INDEX_SCHEMA, projects: [REMOTE, REMOTE] }), /duplicate project id/)
  assert.throws(() => projectById({ projects: [] }, 'Bad'), /INVALID_PROJECT/)
})

test('remote workspaces fail closed without a hub or a registered project', async () => {
  const dir = await fixture()
  try {
    await writeIndex(dir, { schema: INDEX_SCHEMA, projects: [REMOTE] })
    await assert.rejects(() => resolveWorkspace('remote:staging'), /WORKSPACE_REQUIRED/)
    await assert.rejects(() => resolveWorkspace('remote:missing', contextFor(dir)), /PROJECT_NOT_FOUND/)
    await assert.rejects(() => resolveWorkspace('remote:local', contextFor(dir)), /INVALID_PROJECT/)
    await assert.rejects(() => resolveWorkspace('remote:bad/id', contextFor(dir)), /INVALID_PROJECT/)
    await assert.rejects(() => resolveWorkspace('relative/path'), /INVALID_WORKSPACE/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('stores keep the legacy local layout while an index exists', async () => {
  const dir = await fixture()
  try {
    await writeIndex(dir, { schema: INDEX_SCHEMA, projects: [REMOTE] })
    const store = createGraphStore({ dir: '.archmap' })
    const memory = createMemoryStore({ dir: '.archmap' }, { readGraph: store.readGraph })
    const exporter = createExporter({ readGraph: store.readGraph })

    await store.patch(dir, {
      baseRev: 0,
      ops: [
        { op: 'add_node', node: { id: 'n1', title: 'Local', anchors: [{ path: 'src.js' }] } },
      ],
    })
    const local = await store.readGraph(dir)
    assert.equal(local.rev, 1)
    assert.equal(local.nodes.length, 1)
    assert.match(local.nodes[0].anchors[0].hash, /^[0-9a-f]{64}$/)
    const legacy = JSON.parse(await readFile(path.join(dir, '.archmap', 'graph.json'), 'utf8'))
    assert.equal(legacy.rev, 1)

    const remoteContext = contextFor(dir)
    await store.patch('remote:staging', {
      baseRev: 0,
      ops: [
        { op: 'add_node', node: { id: 'r1', title: 'Remote' } },
      ],
    }, remoteContext)
    const remote = await store.readGraph('remote:staging', remoteContext)
    assert.equal(remote.rev, 1)
    const remoteFile = path.join(dir, '.archmap', 'projects', 'staging', 'graph.json')
    assert.equal(JSON.parse(await readFile(remoteFile, 'utf8')).nodes[0].id, 'r1')
    assert.deepEqual(remote.nodes[0].anchors, [])

    const doc = await memory.putDoc('remote:staging', { id: 'overview', content: '# Remote\n' }, remoteContext)
    assert.ok(doc.bytes > 0)
    assert.equal(await readFile(path.join(dir, '.archmap', 'projects', 'staging', 'overview.md'), 'utf8'), '# Remote\n')
    assert.equal((await memory.getDoc('remote:staging', 'overview', remoteContext)).found, true)


    const exported = await exporter.export('remote:staging', { format: 'mermaid' }, remoteContext)
    assert.equal(exported.path, '.archmap/projects/staging/export/architecture.mmd')
    assert.match(await readFile(path.join(dir, exported.path), 'utf8'), /^flowchart LR/)

    const localExport = await exporter.export(dir, { format: 'markdown' })
    assert.equal(localExport.path, '.archmap/export/architecture.md')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
