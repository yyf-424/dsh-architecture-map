import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalContent } from '../src/host/content/local.js'
import { hashBuffer, signatureOf } from '../src/host/signature.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-content-test-'))
  await mkdir(path.join(root, 'sub'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(root, '.archmap'), { recursive: true })
  await writeFile(path.join(root, 'a.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, 'b.md'), '# B\n')
  await writeFile(path.join(root, 'sub', 'c.js'), 'export const c = 3\n')
  await writeFile(path.join(root, 'big.txt'), 'x'.repeat(200))
  await writeFile(path.join(root, 'raw.dat'), 'a\0b')
  await writeFile(path.join(root, 'bin.png'), 'not really a png')
  await writeFile(path.join(root, '.git', 'ignored.js'), 'ignored\n')
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored\n')
  await writeFile(path.join(root, '.archmap', 'graph.json'), '{}\n')
  return root
}

test('local content scan matches the previous memory scan', async () => {
  const root = await fixture()
  try {
    const content = createLocalContent(root)
    const scanned = await content.scan({ maxFiles: 100, maxFileBytes: 100 })
    assert.deepEqual([...scanned.files.keys()].sort(), ['a.ts', 'b.md', 'sub/c.js'])
    assert.equal(scanned.truncated, false)
    // big.txt is oversized; raw.dat has a NUL byte; bin.png is a binary extension.
    assert.equal(scanned.skipped, 2)

    const a = scanned.files.get('a.ts')
    assert.equal(a.size, 19)
    assert.equal(a.sha256, hashBuffer(Buffer.from('export const a = 1\n')))
    assert.equal(a.signature, signatureOf('a.ts', Buffer.from('export const a = 1\n')))

    const capped = await content.scan({ maxFiles: 2, maxFileBytes: 100 })
    assert.equal(capped.files.size, 2)
    assert.equal(capped.truncated, true)

    const tree = await content.listTree(100)
    assert.deepEqual(tree.entries.map(entry => entry.path).sort(), [
      'a.ts', 'b.md', 'big.txt', 'bin.png', 'raw.dat', 'sub/c.js',
    ])
    const limited = await content.listTree(1)
    assert.equal(limited.entries.length, 1)
    assert.equal(limited.truncated, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local content hashes, describes and reads workspace files', async () => {
  const root = await fixture()
  try {
    const content = createLocalContent(root)
    const hashes = await content.hashMany(['a.ts', 'missing.ts'])
    assert.equal(hashes.get('a.ts'), signatureOf('a.ts', Buffer.from('export const a = 1\n')))
    assert.equal(hashes.has('missing.ts'), false)

    const text = await content.describe('a.ts')
    assert.equal(text.kind, 'text')
    assert.equal(text.size, 19)
    assert.equal(text.signature, hashes.get('a.ts'))
    assert.equal((await content.describe('big.txt', { maxFileBytes: 100 })).kind, 'oversized')
    assert.equal((await content.describe('raw.dat')).kind, 'binary')
    assert.equal((await content.describe('missing.ts')).kind, 'missing')
    assert.equal((await content.describe('sub')).kind, 'not-file')

    assert.equal(await content.readText('b.md'), '# B\n')
    assert.equal(await content.readText('missing.ts'), null)
    assert.equal(await content.readText('raw.dat'), null)
    const range = await content.readRange('a.ts', { offset: 0, length: 6 })
    assert.equal(range.text, 'export')
    assert.equal(range.eof, false)

    assert.deepEqual(await content.stat('a.ts'), { type: 'file', size: 19 })
    assert.equal((await content.stat('sub')).type, 'directory')
    assert.equal(await content.stat('missing.ts'), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local content rejects paths outside the workspace', async () => {
  const root = await fixture()
  try {
    const content = createLocalContent(root)
    for (const bad of ['../x', '/tmp/x', 'a/../../x', '']) {
      await assert.rejects(() => content.describe(bad), /PATH_ESCAPE|INVALID_PATH/, bad)
    }
    await assert.rejects(() => content.readText('../x'), /PATH_ESCAPE/)
    assert.equal((await content.hashMany(['../x'])).size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local content skips symlinks in scan and listTree', async () => {  const root = await fixture()
  try {
    await symlink(path.join(root, 'a.ts'), path.join(root, 'link.ts'))
    const content = createLocalContent(root)
    assert.equal((await content.scan({ maxFileBytes: 100 })).files.has('link.ts'), false)
    assert.equal((await content.listTree(100)).entries.some(entry => entry.path === 'link.ts'), false)
    // Reading through a workspace symlink is still allowed; the scan skips it.
    assert.equal(await content.readText('link.ts'), 'export const a = 1\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local content ignores a .git worktree file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-content-worktree-'))
  try {
    await writeFile(path.join(root, 'a.ts'), 'export const a = 1\n')
    await writeFile(path.join(root, '.git'), 'gitdir: /tmp/elsewhere\n')
    const content = createLocalContent(root)
    const scanned = await content.scan({ maxFileBytes: 1000 })
    assert.deepEqual([...scanned.files.keys()], ['a.ts'])
    assert.equal((await content.listTree(100)).entries.some(entry => entry.path === '.git'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
