import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRemoteIndexer } from '../src/host/remote/indexer.js'
import { readRemoteState } from '../src/host/remote/state.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'archmap-indexer-'))
  const ws = {
    kind: 'remote',
    id: 'staging',
    pathBase: root,
    stateDir: path.join(root, '.archmap', 'projects', 'staging'),
    project: { host: 'build-01', root: '/srv/app' },
    content: {
      async fingerprint() {
        return ws.fingerprint
      },
    },
  }
  ws.fingerprint = { vcs: 'git', head: 'a', dirty: false, digest: 'd1' }
  return { root, ws }
}

async function cleanup(item) {
  await rm(item.root, { recursive: true, force: true })
}

test('indexer records a baseline, detects changes and writes pending counts', async () => {
  const item = await fixture()
  try {
    let clock = Date.parse('2026-11-22T00:00:00.000Z')
    const syncs = []
    const runs = []
    const indexer = createRemoteIndexer({
      memory: {
        async sync(ws, input, context) {
          syncs.push({ input, context })
          return { counts: { added: 1, changed: 2, deleted: 0, scanned: 4, cosmetic: 0, affected: 1, marked: 1 } }
        },
      },
      maintainer: {
        async maybeRun(ws, context, counts, state) {
          runs.push({ ws, context, counts, state })
          return { started: true, childId: 'child-1', name: 'remote-staging-maint' }
        },
      },
      intervalMs: 0,
      now: () => { clock += 1000; return clock },
    })
    const context = { agent: { session: { id: 's1', header: { cwd: item.root } } } }

    const first = await indexer.check(item.ws, context)
    assert.equal(first.first, true)
    assert.equal(first.changed, false)
    assert.equal(syncs.length, 0)
    let state = await readRemoteState(item.ws)
    assert.equal(state.fingerprint.digest, 'd1')
    assert.equal(state.pending.count, 0)

    const same = await indexer.check(item.ws, context)
    assert.equal(same.changed, false)
    assert.equal(syncs.length, 0)

    item.ws.fingerprint = { vcs: 'git', head: 'b', dirty: true, digest: 'd2' }
    const changed = await indexer.check(item.ws, context)
    assert.equal(changed.changed, true)
    assert.deepEqual(changed.counts, { added: 1, changed: 2, deleted: 0, scanned: 4, cosmetic: 0, affected: 1, marked: 1 })
    assert.equal(syncs.length, 1)
    assert.equal(syncs[0].input.markStale, true)
    assert.equal(runs.length, 1)

    state = await readRemoteState(item.ws)
    assert.equal(state.fingerprint.digest, 'd2')
    assert.equal(state.pending.count, 3)
    assert.equal(state.pending.since, '2026-11-22T00:00:03.000Z')
    assert.equal(state.syncState, 'maintaining')
    assert.equal(state.lastMaintainerAt, '2026-11-22T00:00:03.000Z')
    assert.equal(state.lastIndexedAt, '2026-11-22T00:00:03.000Z')

    const raw = JSON.parse(await readFile(path.join(item.ws.stateDir, 'remote-state.json'), 'utf8'))
    assert.equal(raw.id, 'staging')
    assert.equal(raw.host, 'build-01')
  } finally {
    await cleanup(item)
  }
})

test('indexer records errors and schedules a backoff', async () => {
  const item = await fixture()
  try {
    let clock = Date.parse('2026-11-22T00:00:00.000Z')
    const scheduled = []
    const indexer = createRemoteIndexer({
      memory: { async sync() { throw new Error('sync exploded') } },
      intervalMs: 1000,
      setTimeout(fn, delay) { scheduled.push({ fn, delay }); return { unref() {} } },
      clearTimeout() {},
      now: () => { clock += 1000; return clock },
    })
    const context = { agent: { session: { id: 's1', header: { cwd: item.root } } } }
    await indexer.check(item.ws, context)
    item.ws.fingerprint = { vcs: 'git', head: 'b', dirty: true, digest: 'd2' }
    const entry = indexer.track(item.ws, context, { immediate: true })
    await entry.current
    const state = await readRemoteState(item.ws)
    assert.match(state.lastError, /sync exploded/)
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].delay, 2000)
    indexer.dispose()
  } finally {
    await cleanup(item)
  }
})

test('indexer dispose cancels scheduled timers', async () => {
  const item = await fixture()
  try {
    const scheduled = []
    const cleared = []
    const indexer = createRemoteIndexer({
      memory: { async sync() { return { counts: { added: 0, changed: 0, deleted: 0 } } } },
      intervalMs: 1000,
      setTimeout(fn, delay) { const handle = { fn, delay }; scheduled.push(handle); return handle },
      clearTimeout(handle) { cleared.push(handle) },
    })
    indexer.track(item.ws, {}, { immediate: false })
    assert.equal(scheduled.length, 1)
    indexer.dispose()
    assert.equal(cleared.length, 1)
  } finally {
    await cleanup(item)
  }
})
