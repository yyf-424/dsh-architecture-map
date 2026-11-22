import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSshClient } from '../src/host/remote/ssh.js'
import { createRemoteContent } from '../src/host/remote/content.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'
const HAS_GIT = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
const A_TS = 'export const a = 1\n'

function hashOf(value) {
  return createHash('sha256').update(value).digest('hex')
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, stdio: 'ignore' })
  assert.equal(result.status, 0, `git ${args.join(' ')}`)
}

async function fixture({ gitRepo = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-remote-content-'))
  const logDir = await mkdtemp(path.join(tmpdir(), 'archmap-remote-content-log-'))
  const log = path.join(logDir, 'ssh.log')
  await mkdir(path.join(root, 'sub'), { recursive: true })
  await mkdir(path.join(root, 'node_modules'), { recursive: true })
  await mkdir(path.join(root, '.archmap'), { recursive: true })
  await writeFile(path.join(root, 'a.ts'), A_TS)
  await writeFile(path.join(root, 'b.md'), '# B\n')
  await writeFile(path.join(root, 'sub', 'c.js'), 'export const c = 3\n')
  await writeFile(path.join(root, 'raw.dat'), Buffer.from('a\0b'))
  await writeFile(path.join(root, 'big.txt'), 'x'.repeat(2048))
  await writeFile(path.join(root, 'node_modules', 'x.js'), 'ignored\n')
  await writeFile(path.join(root, '.archmap', 'graph.json'), '{}\n')
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\nnode_modules/\n.archmap/\n')
  await writeFile(path.join(root, 'ignored.txt'), 'ignored\n')

  if (gitRepo) {
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'commit.gpgsign', 'false')
    git(root, 'add', 'a.ts', 'b.md', 'sub/c.js', 'raw.dat', 'big.txt', '.gitignore')
    git(root, 'commit', '-q', '-m', 'fixture')
  }

  await chmod(FAKE_SSH, 0o755)
  const client = createSshClient({
    host: 'build-01',
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 5_000,
    env: { FAKE_SSH_ROOT: root, FAKE_SSH_LOG: log },
  })
  const content = createRemoteContent({ client, root })
  return { root, logDir, log, client, content }
}

async function cleanup(item) {
  await rm(item.root, { recursive: true, force: true })
  await rm(item.logDir, { recursive: true, force: true })
}

test('remote listTree returns git paths and skips ignored directories', { skip: SKIP || !HAS_GIT }, async () => {
  const item = await fixture()
  try {
    await writeFile(path.join(item.root, 'new.ts'), 'export const n = 4\n')
    const tree = await item.content.listTree()
    assert.equal(tree.vcs, 'git')
    assert.equal(tree.truncated, false)
    const paths = tree.entries.map(entry => entry.path)
    for (const expected of ['.gitignore', 'a.ts', 'b.md', 'big.txt', 'new.ts', 'raw.dat', 'sub/c.js']) {
      assert.ok(paths.includes(expected), expected)
    }
    assert.equal(paths.includes('ignored.txt'), false)
    assert.equal(paths.some(value => value.startsWith('node_modules/')), false)
    assert.equal(paths.some(value => value.startsWith('.archmap/')), false)
    assert.equal(paths.some(value => value.startsWith('.git/')), false)

    const limited = createRemoteContent({ client: item.client, root: item.root, maxFiles: 1 })
    const capped = await limited.listTree()
    assert.equal(capped.entries.length, 1)
    assert.equal(capped.truncated, true)
  } finally {
    await cleanup(item)
  }
})

test('remote hashMany and describe return remote sha256 without content', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const hashes = await item.content.hashMany(['a.ts', 'missing.ts'])
    assert.equal(hashes.get('a.ts'), hashOf(A_TS))
    assert.equal(hashes.has('missing.ts'), false)

    const text = await item.content.describe('a.ts')
    assert.equal(text.kind, 'text')
    assert.equal(text.size, A_TS.length)
    assert.equal(text.sha256, hashOf(A_TS))
    assert.equal((await item.content.describe('raw.dat')).kind, 'binary')
    assert.equal((await item.content.describe('big.txt', { maxFileBytes: 100 })).kind, 'oversized')
    assert.equal((await item.content.describe('missing.ts')).kind, 'missing')
    assert.equal((await item.content.describe('sub')).kind, 'not-file')
    assert.equal((await item.content.describe('a.ts', { maxFileBytes: 5 })).kind, 'oversized')
  } finally {
    await cleanup(item)
  }
})

test('remote reads are bounded and ranges report offsets', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    assert.equal(await item.content.readText('b.md'), '# B\n')
    assert.equal(await item.content.readText('missing.ts'), null)
    assert.equal(await item.content.readText('big.txt', { maxBytes: 10 }), null)

    const range = await item.content.readRange('a.ts', { offset: 0, length: 6 })
    assert.equal(range.text, 'export')
    assert.equal(range.bytes, 6)
    assert.equal(range.eof, false)
    const tail = await item.content.readRange('a.ts', { offset: 100, length: 6 })
    assert.equal(tail.text, '')
    assert.equal(tail.bytes, 0)
    assert.equal(tail.eof, true)

    assert.deepEqual(await item.content.stat('a.ts'), { type: 'file', size: A_TS.length })
    assert.equal((await item.content.stat('sub')).type, 'directory')
    assert.equal(await item.content.stat('missing.ts'), null)
  } finally {
    await cleanup(item)
  }
})

test('remote grep returns matches and honors include and caps', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    const byInclude = await item.content.grep('export', { include: '*.ts' })
    assert.ok(byInclude.matches.some(match => match.path === 'a.ts' && match.line === 1))
    assert.equal(byInclude.matches.some(match => match.path === 'sub/c.js'), false)
    assert.ok(['rg', 'grep'].includes(byInclude.engine))

    const byPath = await item.content.grep('export', { path: 'sub' })
    assert.ok(byPath.matches.some(match => match.path === 'sub/c.js'))

    const none = await item.content.grep('definitely-not-present')
    assert.deepEqual(none.matches, [])

    await writeFile(path.join(item.root, 'new.ts'), 'export const n = 4\n')
    const capped = await item.content.grep('export', { include: '*.ts', maxResults: 1 })
    assert.equal(capped.matches.length, 1)
    assert.equal(capped.truncated, true)
  } finally {
    await cleanup(item)
  }
})

test('remote fingerprint tracks git head and dirty state', { skip: SKIP || !HAS_GIT }, async () => {
  const item = await fixture()
  try {
    const clean = await item.content.fingerprint()
    assert.equal(clean.vcs, 'git')
    assert.match(clean.head, /^[0-9a-f]{40}$/)
    assert.equal(clean.dirty, false)
    assert.match(clean.digest, /^[0-9a-f]{64}$/)

    await writeFile(path.join(item.root, 'new.ts'), 'export const n = 4\n')
    const dirty = await item.content.fingerprint()
    assert.equal(dirty.dirty, true)
    assert.equal(dirty.head, clean.head)
    assert.notEqual(dirty.digest, clean.digest)
  } finally {
    await cleanup(item)
  }
})

test('remote non-git fallback lists files and changes its digest', { skip: SKIP }, async () => {
  const item = await fixture({ gitRepo: false })
  try {
    const tree = await item.content.listTree()
    assert.equal(tree.vcs, 'none')
    const paths = tree.entries.map(entry => entry.path)
    assert.ok(paths.includes('a.ts'))
    assert.ok(paths.includes('sub/c.js'))
    assert.equal(paths.some(value => value.startsWith('node_modules/')), false)
    assert.equal(paths.some(value => value.startsWith('.archmap/')), false)

    const before = await item.content.fingerprint()
    assert.equal(before.vcs, 'none')
    assert.equal(before.head, null)
    assert.match(before.digest, /^[0-9a-f]{64}$/)
    await writeFile(path.join(item.root, 'a.ts'), 'export const a = 2\n')
    const after = await item.content.fingerprint()
    assert.notEqual(after.digest, before.digest)
  } finally {
    await cleanup(item)
  }
})

test('remote content rejects unsafe paths and configuration', { skip: SKIP }, async () => {
  const item = await fixture()
  try {
    for (const bad of ['../x', '/tmp/x', 'a/../../x', '']) {
      await assert.rejects(() => item.content.describe(bad), /PATH_ESCAPE|INVALID_PATH/, bad)
    }
    await assert.rejects(() => item.content.readText('../x'), /PATH_ESCAPE/)
    await assert.rejects(() => item.content.hashMany(['../x']), /PATH_ESCAPE/)
    assert.throws(() => createRemoteContent({ root: '/tmp' }), /INVALID_CONTENT/)
    assert.throws(() => createRemoteContent({ client: item.client, root: 'relative' }), /PATH_ESCAPE/)
    assert.throws(() => createRemoteContent({ client: item.client, root: item.root, vcs: 'svn' }), /INVALID_CONTENT/)
  } finally {
    await cleanup(item)
  }
})
