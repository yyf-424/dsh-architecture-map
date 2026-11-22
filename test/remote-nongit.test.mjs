import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSshClient } from '../src/host/remote/ssh.js'
import { createRemoteContent } from '../src/host/remote/content.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-nongit-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-nongit-log-'))
  const log = path.join(logDir, 'ssh.log')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'a.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, 'src', 'b.js'), 'export const b = 2\n')
  const client = createSshClient({
    host: 'build-01',
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 5_000,
    env: { FAKE_SSH_ROOT: root, FAKE_SSH_LOG: log },
  })
  const content = createRemoteContent({ client, root, vcs: 'none' })
  return { root, logDir, log, content }
}

async function cleanup(item) {
  await rm(item.root, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('non-git fingerprints use path/size/mtime only', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const before = await item.content.fingerprint()
    assert.equal(before.vcs, 'none')
    assert.equal(before.entries, 2)
    assert.match(before.digest, /^[0-9a-f]{64}$/)

    const log = await readFile(item.log, 'utf8')
    for (const forbidden of ['sha256sum', 'shasum', ' cat ', ' sed ', ' head ']) {
      assert.equal(log.includes(forbidden), false, forbidden)
    }
    assert.match(log, /find|stat/)

    await writeFile(path.join(item.root, 'a.ts'), 'export const a = 42\n')
    await utimes(path.join(item.root, 'a.ts'), new Date(Date.now() + 5_000), new Date(Date.now() + 5_000))
    const afterEdit = await item.content.fingerprint()
    assert.notEqual(afterEdit.digest, before.digest)

    await writeFile(path.join(item.root, 'new.ts'), 'export const n = 3\n')
    const afterAdd = await item.content.fingerprint()
    assert.equal(afterAdd.entries, 3)
    assert.notEqual(afterAdd.digest, afterEdit.digest)

    await unlink(path.join(item.root, 'new.ts'))
    const afterDelete = await item.content.fingerprint()
    assert.equal(afterDelete.entries, 2)
    assert.equal(afterDelete.digest, afterEdit.digest)
  } finally {
    await cleanup(item)
  }
})
