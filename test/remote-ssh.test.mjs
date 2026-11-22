import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertHost,
  assertRemotePath,
  createSshClient,
  shQuote,
} from '../src/host/remote/ssh.js'

const FAKE_SSH = fileURLToPath(new URL('./fixtures/fake-ssh/ssh', import.meta.url))
const SKIP = process.platform === 'win32'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-ssh-test-'))
  await writeFile(path.join(root, 'hello.txt'), 'hello\n')
  await chmod(FAKE_SSH, 0o755)
  return { root, log: path.join(root, '.fake-ssh.log') }
}

function makeClient(root, log, overrides = {}) {
  const { env, ...rest } = overrides
  return createSshClient({
    host: 'build-01',
    binary: FAKE_SSH,
    controlMaster: false,
    requestTimeoutMs: 3_000,
    env: { FAKE_SSH_ROOT: root, FAKE_SSH_LOG: log, ...(env ?? {}) },
    ...rest,
  })
}

test('POSIX quoting and input validation', () => {
  assert.equal(shQuote(''), "''")
  assert.equal(shQuote('a b'), "'a b'")
  assert.equal(shQuote("a'b"), "'a'\\''b'")
  assert.equal(shQuote('$HOME; rm -rf /'), "'$HOME; rm -rf /'")
  assert.throws(() => shQuote('a\0b'), /INVALID_ARGUMENT/)

  assert.equal(assertHost('user@build-01'), 'user@build-01')
  assert.equal(assertHost('build-01'), 'build-01')
  assert.throws(() => assertHost('-oProxyCommand=x'), /INVALID_HOST/)
  assert.throws(() => assertHost('a b'), /INVALID_HOST/)
  assert.throws(() => assertHost(''), /INVALID_HOST/)

  assert.equal(assertRemotePath('/srv/app/'), '/srv/app')
  assert.equal(assertRemotePath('/'), '/')
  assert.equal(assertRemotePath('/srv//app'), '/srv/app')
  assert.throws(() => assertRemotePath('srv/app'), /PATH_ESCAPE/)
  assert.throws(() => assertRemotePath('/srv/../etc'), /PATH_ESCAPE/)
  assert.throws(() => assertRemotePath('/srv/a\nb'), /PATH_ESCAPE/)
  assert.throws(() => assertRemotePath('/srv/a\\b'), /PATH_ESCAPE/)
})

test('exec quotes argv and returns stdout', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const client = makeClient(root, log)
    const result = await client.exec(['printf', '%s', 'hello world'])
    assert.equal(result.code, 0)
    assert.equal(result.stdout, 'hello world')
    assert.ok((await readFile(log, 'utf8')).includes("'hello world'"))

    const quoted = await client.exec(['printf', '%s', "a'b c"])
    assert.equal(quoted.stdout, "a'b c")
    assert.ok((await readFile(log, 'utf8')).includes("'a'\\''b c'"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('execShell and probe report remote capabilities', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const client = makeClient(root, log)
    const shell = await client.execShell('printf "shell-ok"')
    assert.equal(shell.stdout, 'shell-ok')

    const capabilities = await client.probe()
    assert.match(capabilities.os, /Darwin|Linux/)
    assert.equal(capabilities.find, true)
    assert.equal(typeof capabilities.git, 'boolean')
    assert.equal(typeof capabilities.sha256sum, 'boolean')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('non-zero exits report the remote stderr', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const client = makeClient(root, log)
    await assert.rejects(() => client.execShell('echo "bad thing" >&2; exit 3'), /SSH_COMMAND_FAILED: build-01: bad thing/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('authentication failures are classified', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const client = makeClient(root, log, { env: { FAKE_SSH_FAIL: '1' } })
    await assert.rejects(() => client.exec(['true']), /SSH_CONNECTION_FAILED: build-01: Permission denied/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('timeouts and aborts terminate the connection', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const slow = makeClient(root, log, { requestTimeoutMs: 100, env: { FAKE_SSH_SLEEP: '2' } })
    await assert.rejects(() => slow.exec(['true']), /SSH_TIMEOUT/)

    const controller = new AbortController()
    const pending = slow.exec(['true'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 30)
    await assert.rejects(() => pending, /SSH_ABORTED/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('output over the cap is rejected', { skip: SKIP }, async () => {
  const { root, log } = await fixture()
  try {
    const client = makeClient(root, log, { maxOutputBytes: 32 })
    await assert.rejects(() => client.execShell('printf "%0200d" 0'), /SSH_OUTPUT_LIMIT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
