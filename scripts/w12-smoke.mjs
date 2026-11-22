#!/usr/bin/env node
/**
 * W12 read-only smoke test for a real remote repository.
 *
 * Usage:
 *   node scripts/w12-smoke.mjs <host> <remote-root> [nongit-root]
 *
 * Environment:
 *   W12_SSH_BINARY  optional SSH binary override (tests use the fake fixture)
 *   W12_SSH_LOG     optional fake-ssh command log
 *
 * It never writes to the remote: only probe, tree, hash, describe, read, grep
 * and fingerprint are exercised. Exit code 0 means every check passed.
 */
import { createSshClient } from '../src/host/remote/ssh.js'
import { createRemoteContent } from '../src/host/remote/content.js'

const [host, root, nongitRoot] = process.argv.slice(2)

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`PASS: ${message}`)
}

async function checkRemote(client, label, remoteRoot, expectedVcs) {
  const content = createRemoteContent({ client, root: remoteRoot, vcs: 'auto' })
  const vcs = await content.detectVcs()
  if (expectedVcs && vcs !== expectedVcs) {
    fail(`${label}: expected vcs ${expectedVcs}, got ${vcs}`)
  } else {
    pass(`${label}: vcs ${vcs}`)
  }

  const tree = await content.listTree({ maxFiles: 2_000 })
  pass(`${label}: ${tree.entries.length} paths${tree.truncated ? ' (truncated)' : ''}`)
  if (tree.entries.length === 0) {
    fail(`${label}: no paths returned`)
    return
  }

  const fingerprint = await content.fingerprint()
  if (!/^[0-9a-f]{64}$/.test(fingerprint.digest)) fail(`${label}: bad fingerprint digest`)
  else pass(`${label}: fingerprint ${fingerprint.digest.slice(0, 12)}… entries=${fingerprint.entries ?? '-'}`)

  const target = tree.entries.find(entry => /\.(md|markdown|ts|js|mjs|json|txt|py|go|rs)$/i.test(entry.path)) ?? tree.entries[0]
  const info = await content.describe(target.path)
  if (info.kind === 'text') {
    pass(`${label}: describe ${target.path} (${info.size} B)`)
    const text = await content.readText(target.path, { maxBytes: 64 * 1024 })
    if (typeof text !== 'string') fail(`${label}: readText returned no text`)
    else pass(`${label}: read ${target.path} (${text.length} chars)`)
    const range = await content.readRange(target.path, { offset: 0, length: 120 })
    if (typeof range.text !== 'string') fail(`${label}: readRange failed`)
    else pass(`${label}: readRange ${range.bytes} bytes eof=${range.eof}`)
  } else {
    fail(`${label}: first file ${target.path} is ${info.kind}, expected text`)
  }

  const grep = await content.grep('export|function|class', { include: '*.{ts,js,md}', maxResults: 5 })
  pass(`${label}: grep engine=${grep.engine} matches=${grep.matches.length}${grep.truncated ? ' (truncated)' : ''}`)

  const stat = await content.stat(target.path)
  if (!stat || stat.type !== 'file') fail(`${label}: stat ${target.path} failed`)
  else pass(`${label}: stat ${target.path} (${stat.size} B)`)
}

async function main() {
  if (!host || !root) {
    console.error('usage: node scripts/w12-smoke.mjs <host> <remote-root> [nongit-root]')
    process.exit(2)
  }
  const binary = process.env.W12_SSH_BINARY || undefined
  const env = binary
    ? { FAKE_SSH_ROOT: root, ...(process.env.W12_SSH_LOG ? { FAKE_SSH_LOG: process.env.W12_SSH_LOG } : {}) }
    : undefined
  const client = createSshClient({ host, ...(binary ? { binary } : {}), ...(env ? { env } : {}) })

  const caps = await client.probe()
  pass(`probe os=${caps.os || '?'} git=${caps.git} sha256sum=${caps.sha256sum} shasum=${caps.shasum} rg=${caps.rg}`)
  if (!caps.os) fail('probe returned no os')
  if (!caps.sha256sum && !caps.shasum) fail('remote has no sha256sum/shasum')

  await checkRemote(client, 'git-or-dir', root, undefined)
  if (nongitRoot) await checkRemote(client, 'nongit', nongitRoot, 'none')

  if (process.exitCode && process.exitCode !== 0) {
    console.error('\nW12 smoke failed.')
  } else {
    console.log('\nW12 smoke passed (read-only).')
  }
}

main().catch(error => {
  console.error(`FAIL: ${error?.message ?? error}`)
  process.exit(1)
})
