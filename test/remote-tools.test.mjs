import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEX_SCHEMA, LOCAL_PROJECT_ID, writeIndex } from '../src/host/projects.js'
import { createConsentGate, CONSENT } from '../src/host/remote/consent.js'
import { createRemoteTools } from '../src/host/remote/tools.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'
const APP_TS = 'export const app = 1\n'

async function fixture() {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-remote-tools-'))
  const remote = await mkdtemp(path.join(tmpdir(), 'archmap-remote-tools-root-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-remote-tools-log-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await mkdir(path.join(remote, 'src'), { recursive: true })
  await writeFile(path.join(remote, 'src', 'app.ts'), APP_TS)
  await writeFile(path.join(remote, 'raw.dat'), Buffer.from('a\0b'))
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
  return { hub, remote, logDir, log, ssh, context }
}

function makeTools(item, choice) {
  const calls = []
  const service = choice === null
    ? undefined
    : {
        calls,
        async ask(request) {
          calls.push(request)
          return { answers: [{ id: request.questions[0].id, selected: [choice] }] }
        },
      }
  const consent = createConsentGate({ getUserQuestions: () => service })
  const tools = createRemoteTools({ config: { dir: '.archmap', ssh: item.ssh }, consent })
  return { tools, calls, service, consent }
}

async function cleanup(item) {
  await rm(item.hub, { recursive: true, force: true })
  await rm(item.remote, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('list and status expose metadata without asking for consent', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const { tools, calls } = makeTools(item, CONSENT.session)
    const listed = await tools.list({}, item.context)
    assert.match(listed.text, /local · local project/)
    assert.match(listed.text, /staging · ssh build-01:/)
    assert.match(listed.text, /vcs none/)
    assert.equal(calls.length, 0)

    const status = await tools.status({ id: 'staging' }, item.context)
    assert.match(status.text, /remote:staging · none · non-git · consent none/)
    assert.match(status.text, /digest: [0-9a-f]{64}/)
    assert.equal(calls.length, 0)
  } finally {
    await cleanup(item)
  }
})

test('tree, read and grep share one session consent', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const { tools, calls } = makeTools(item, CONSENT.session)
    const tree = await tools.tree({ id: 'staging' }, item.context)
    assert.match(tree.text, /remote:staging/)
    assert.match(tree.text, /src\/app\.ts/)
    assert.equal(calls.length, 1)

    const read = await tools.read({ id: 'staging', path: 'src/app.ts' }, item.context)
    assert.match(read.text, /remote:staging:src\/app\.ts · lines 1-1 of 1/)
    assert.match(read.text, /1\| export const app = 1/)
    assert.equal(calls.length, 1)

    const grep = await tools.grep({ id: 'staging', pattern: 'export' }, item.context)
    assert.match(grep.text, /1 match/)
    assert.match(grep.text, /src\/app\.ts:1: export const app = 1/)
    assert.equal(calls.length, 1)
  } finally {
    await cleanup(item)
  }
})

test('rejecting consent blocks all content tools', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const { tools, calls } = makeTools(item, CONSENT.reject)
    for (const call of [
      () => tools.tree({ id: 'staging' }, item.context),
      () => tools.read({ id: 'staging', path: 'src/app.ts' }, item.context),
      () => tools.grep({ id: 'staging', pattern: 'export' }, item.context),
    ]) {
      await assert.rejects(call, /REMOTE_CONSENT_REQUIRED/)
    }
    assert.equal(calls.length, 3)
  } finally {
    await cleanup(item)
  }
})

test('missing answerer fails closed before any content read', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const { tools } = makeTools(item, null)
    await assert.rejects(() => tools.tree({ id: 'staging' }, item.context), /REMOTE_CONSENT_UNAVAILABLE/)
  } finally {
    await cleanup(item)
  }
})

test('read reports missing, binary and unsafe paths after consent', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const { tools } = makeTools(item, CONSENT.session)
    await tools.tree({ id: 'staging' }, item.context)
    await assert.rejects(() => tools.read({ id: 'staging', path: 'missing.ts' }, item.context), /REMOTE_NOT_FOUND/)
    await assert.rejects(() => tools.read({ id: 'staging', path: 'raw.dat' }, item.context), /REMOTE_BINARY/)
    await assert.rejects(() => tools.read({ id: 'staging', path: '../x' }, item.context), /PATH_ESCAPE/)
  } finally {
    await cleanup(item)
  }
})
