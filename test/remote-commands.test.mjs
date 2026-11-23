import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEX_SCHEMA, loadIndex, writeIndex } from '../src/host/projects.js'
import { createRemoteCommands, splitArgs } from '../src/host/remote/commands.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'

async function fixture() {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-commands-'))
  const remote = await mkdtemp(path.join(tmpdir(), 'archmap-commands-root-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-commands-log-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await mkdir(path.join(remote, 'src'), { recursive: true })
  await writeFile(path.join(remote, 'src', 'app.ts'), 'export const app = 1\n')
  await writeIndex(hub, { schema: INDEX_SCHEMA, projects: [] })
  const log = path.join(logDir, 'ssh.log')
  const ssh = {
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 5_000,
    env: { FAKE_SSH_ROOT: remote, FAKE_SSH_LOG: log },
  }
  const agent = { session: { id: 's1', header: { cwd: hub } } }
  const tracked = []
  const untracked = []
  const maintain = []
  const grants = []
  const sessionGrants = []
  const revokes = []
  const indexer = {
    intervalMs: 60_000,
    track(ws) { tracked.push(ws.id) },
    untrack(ws) { untracked.push(ws.id) },
    async check() {
      return {
        changed: true,
        counts: { added: 1, changed: 2, deleted: 3, scanned: 6, cosmetic: 0, affected: 1, marked: 1 },
        state: { pending: { added: 1, changed: 2, deleted: 3, count: 6 } },
      }
    },
  }
  const maintainer = {
    async maybeRun(ws, context, counts) {
      maintain.push({ id: ws.id, counts })
      return { started: true, childId: 'child-1', name: 'remote-demo-maint' }
    },
  }
  const consent = {
    async grantWorkspace(ws) { grants.push(ws.id) },
    allowSession(ws, context) { sessionGrants.push({ id: ws.id, sessionId: context?.agent?.session?.id }) },
    async revoke(ws) { revokes.push(ws.id); return { revoked: 'workspace' } },
  }
  const commands = createRemoteCommands({ config: { dir: '.archmap', ssh }, consent, indexer, maintainer })
  return { hub, remote, logDir, log, ssh, agent, commands, tracked, untracked, maintain, grants, sessionGrants, revokes }
}

async function cleanup(item) {
  await rm(item.hub, { recursive: true, force: true })
  await rm(item.remote, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('splitArgs honors quotes', () => {
  assert.deepEqual(splitArgs('add demo build-01 /srv/app'), ['add', 'demo', 'build-01', '/srv/app'])
  assert.deepEqual(splitArgs('add demo build-01 "/srv/my app"'), ['add', 'demo', 'build-01', '/srv/my app'])
  assert.deepEqual(splitArgs("add demo build-01 '/srv/app'"), ['add', 'demo', 'build-01', '/srv/app'])
})

test('add, list, select, sync, update, grant, revoke and remove', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const added = await item.commands.handle(`add demo build-01 ${item.remote}`, item.agent)
    assert.equal(added.kind, 'success')
    assert.match(added.text, /vcs none/)
    const index = await loadIndex(item.hub)
    const project = index.projects.find(entry => entry.id === 'demo')
    assert.equal(project.kind, 'remote')
    assert.equal(project.host, 'build-01')
    assert.equal(project.root, item.remote)
    assert.equal(project.vcs, 'none')

    const duplicate = await item.commands.handle(`add demo build-01 ${item.remote}`, item.agent)
    assert.equal(duplicate.kind, 'error')

    const listed = await item.commands.handle('list', item.agent)
    assert.match(listed.text, /demo · ssh build-01:/)

    const selected = await item.commands.handle('select demo', item.agent)
    assert.equal(selected.kind, 'success')
    assert.deepEqual(item.tracked, ['demo'])

    const synced = await item.commands.handle('sync demo', item.agent)
    assert.equal(synced.kind, 'success')
    assert.match(synced.text, /\+1 added · ~2 changed · -3 deleted/)

    const updated = await item.commands.handle('update demo', item.agent)
    assert.equal(updated.kind, 'success')
    assert.match(updated.text, /remote-demo-maint/)
    assert.equal(item.maintain.length, 1)

    const granted = await item.commands.handle('grant demo', item.agent)
    assert.equal(granted.kind, 'success')
    assert.match(granted.text, /workspace 级/)
    assert.deepEqual(item.grants, ['demo'])

    const sessionGranted = await item.commands.handle('grant demo session', item.agent)
    assert.equal(sessionGranted.kind, 'success')
    assert.match(sessionGranted.text, /本次会话/)
    assert.deepEqual(item.sessionGrants, [{ id: 'demo', sessionId: 's1' }])
    assert.deepEqual(item.grants, ['demo'])

    const badScope = await item.commands.handle('grant demo once', item.agent)
    assert.equal(badScope.kind, 'error')
    assert.match(badScope.text, /未知授权范围/)

    const revoked = await item.commands.handle('revoke demo', item.agent)
    assert.equal(revoked.kind, 'success')
    assert.deepEqual(item.revokes, ['demo'])

    const removed = await item.commands.handle('remove demo', item.agent)
    assert.equal(removed.kind, 'success')
    const after = await loadIndex(item.hub)
    assert.equal(after.projects.some(entry => entry.id === 'demo'), false)
    assert.deepEqual(item.untracked, ['demo'])
  } finally {
    await cleanup(item)
  }
})

test('invalid commands and ids are errors', async () => {
  const item = await fixture()
  try {
    assert.equal((await item.commands.handle('', item.agent)).kind, 'error')
    assert.equal((await item.commands.handle('bogus', item.agent)).kind, 'error')
    assert.equal((await item.commands.handle('add Bad build-01 /srv/app', item.agent)).kind, 'error')
    assert.equal((await item.commands.handle('select local', item.agent)).kind, 'error')
    assert.equal((await item.commands.handle('sync missing', item.agent)).kind, 'error')
  } finally {
    await cleanup(item)
  }
})
