import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSshClient } from '../src/host/remote/ssh.js'
import { createRemoteContent } from '../src/host/remote/content.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), 'archmap-security-'))
  const root = path.join(parent, 'repo')
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-security-log-'))
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'a.ts'), 'export const a = 1\n')
  await writeFile(path.join(parent, 'secret.txt'), 'outside secret\n')
  await symlink(path.join(parent, 'secret.txt'), path.join(root, 'link.ts'))
  await symlink(path.join(root, 'a.ts'), path.join(root, 'inside.ts'))
  const log = path.join(logDir, 'ssh.log')
  const client = createSshClient({
    host: 'build-01',
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 5_000,
    env: { FAKE_SSH_ROOT: root, FAKE_SSH_LOG: log },
  })
  const content = createRemoteContent({ client, root, vcs: 'none' })
  return { parent, root, logDir, log, content }
}

async function cleanup(item) {
  await rm(item.parent, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('reads refuse symlinks that escape the remote root', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    await assert.rejects(() => item.content.describe('link.ts'), /PATH_ESCAPE/)
    await assert.rejects(() => item.content.readText('link.ts'), /PATH_ESCAPE/)
    await assert.rejects(() => item.content.readRange('link.ts', { offset: 0, length: 3 }), /PATH_ESCAPE/)
    await assert.rejects(() => item.content.stat('link.ts'), /PATH_ESCAPE/)

    const hashes = await item.content.hashMany(['link.ts', 'a.ts'])
    assert.equal(hashes.has('link.ts'), false)
    assert.equal(hashes.has('a.ts'), true)

    const tree = await item.content.listTree()
    assert.equal(tree.entries.some(entry => entry.path === 'link.ts'), false)
    assert.equal(tree.entries.some(entry => entry.path === 'inside.ts'), false)
    assert.equal(tree.entries.some(entry => entry.path === 'a.ts'), true)

    // A symlink that stays inside the root is still readable by explicit path.
    const inside = await item.content.describe('inside.ts')
    assert.equal(inside.kind, 'text')
    assert.equal(await item.content.readText('inside.ts'), 'export const a = 1\n')
  } finally {
    await cleanup(item)
  }
})

test('path traversal and unsafe roots fail closed', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    for (const bad of ['../secret.txt', '/etc/passwd', 'a/../../x']) {
      await assert.rejects(() => item.content.describe(bad), /PATH_ESCAPE/, bad)
    }
    assert.throws(() => createRemoteContent({ client: { exec() {}, execShell() {}, probe() {} }, root: 'relative' }), /PATH_ESCAPE/)
    assert.throws(() => createRemoteContent({ root: '/tmp' }), /INVALID_CONTENT/)
  } finally {
    await cleanup(item)
  }
})
