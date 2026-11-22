import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMaintainerPrompt, createMaintainer } from '../src/host/remote/maintainer.js'

const WS = { id: 'staging', pathBase: '/tmp/hub', project: { host: 'build-01', root: '/srv/app' } }
const CONTEXT = { agent: { session: { id: 's1', header: { cwd: '/tmp/hub' } } } }
const COUNTS = { added: 1, changed: 2, deleted: 0 }

function allowed(value = true) {
  return { autoMaintenanceAllowed: () => value }
}

test('auto maintenance respects consent, change count and cooldown', async () => {
  const calls = []
  const now = Date.parse('2026-11-22T00:00:00.000Z')
  const maintainer = createMaintainer({
    consent: allowed(true),
    now: () => now,
    startChild: async payload => {
      calls.push(payload)
      return { childId: 'child-1', name: 'remote-staging-maint' }
    },
  })

  assert.equal((await maintainer.maybeRun(WS, CONTEXT, { added: 0, changed: 0, deleted: 0 }, {})).reason, 'no-changes')
  assert.equal((await createMaintainer({ consent: allowed(false), startChild: async () => ({}) }).maybeRun(WS, CONTEXT, COUNTS, {})).reason, 'no-workspace-consent')
  assert.equal((await maintainer.maybeRun(WS, CONTEXT, { added: 40, changed: 20, deleted: 0 }, {})).reason, 'too-many-files')

  const started = await maintainer.maybeRun(WS, CONTEXT, COUNTS, {})
  assert.equal(started.started, true)
  assert.equal(started.childId, 'child-1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ws.id, 'staging')
  assert.equal(calls[0].agent.session.id, 's1')

  const cooldown = await maintainer.maybeRun(WS, CONTEXT, COUNTS, { lastMaintainerAt: new Date(now - 60_000).toISOString() })
  assert.equal(cooldown.started, false)
  assert.equal(cooldown.reason, 'cooldown')
  const forced = await maintainer.maybeRun(WS, CONTEXT, COUNTS, { lastMaintainerAt: new Date(now - 60_000).toISOString() }, { force: true })
  assert.equal(forced.started, true)
})

test('auto maintenance is single-flight per project', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  const maintainer = createMaintainer({
    consent: allowed(true),
    startChild: async () => {
      calls += 1
      await gate
      return { childId: 'child-1', name: 'maint' }
    },
  })
  const first = maintainer.maybeRun(WS, CONTEXT, COUNTS, {})
  const second = await maintainer.maybeRun(WS, CONTEXT, COUNTS, {})
  assert.equal(second.reason, 'already-running')
  release()
  assert.equal((await first).started, true)
  assert.equal(calls, 1)
})

test('auto maintenance reports child start failures', async () => {
  const maintainer = createMaintainer({
    consent: allowed(true),
    startChild: async () => { throw new Error('no subagents') },
  })
  const result = await maintainer.maybeRun(WS, CONTEXT, COUNTS, {})
  assert.equal(result.started, false)
  assert.equal(result.reason, 'start-failed')
  assert.match(result.error.message, /no subagents/)
})

test('maintainer prompt carries the remote identity and remote-only rules', () => {
  const prompt = buildMaintainerPrompt(WS, { added: 1, changed: 2, deleted: 3 })
  assert.match(prompt, /remote:staging/)
  assert.match(prompt, /build-01:\/srv\/app/)
  assert.match(prompt, /\+1 added, ~2 changed, -3 deleted/)
  assert.match(prompt, /arch_sync/)
  assert.match(prompt, /arch_remote_read/)
  assert.match(prompt, /Never use local read, grep, glob or bash/)
  assert.match(prompt, /Do not write remote files/)
})
