import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { INDEX_SCHEMA, LOCAL_PROJECT_ID, writeIndex } from '../src/host/projects.js'
import { resolveWorkspace } from '../src/host/workspace.js'
import { CONSENT, createConsentGate } from '../src/host/remote/consent.js'

const REMOTE = {
  id: 'staging',
  kind: 'remote',
  title: 'staging',
  dir: 'projects/staging',
  transport: 'ssh',
  host: 'build-01',
  root: '/srv/app',
  vcs: 'none',
  autoRefresh: true,
}

async function fixture() {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-consent-test-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await writeIndex(hub, {
    schema: INDEX_SCHEMA,
    projects: [
      { id: LOCAL_PROJECT_ID, kind: 'local', title: 'Local', dir: '.' },
      REMOTE,
    ],
  })
  return hub
}

function context(hub, sessionId = 's1') {
  return { agent: { session: { id: sessionId, header: { cwd: hub } } } }
}

function workspace(hub, sessionId = 's1') {
  return resolveWorkspace('remote:staging', context(hub, sessionId), { dir: '.archmap' })
}

function fake(choice) {
  const calls = []
  return {
    calls,
    async ask(request) {
      calls.push(request)
      return {
        answers: [{
          id: request.questions[0].id,
          selected: choice === undefined ? [] : [choice],
        }],
      }
    },
  }
}

function makeGate(service) {
  return createConsentGate({
    getUserQuestions: () => service,
    now: () => new Date('2026-11-22T00:00:00.000Z'),
  })
}

test('first content access asks once for the session and never asks again', async () => {
  const hub = await fixture()
  try {
    const ws = await workspace(hub)
    const service = fake(CONSENT.session)
    const gate = makeGate(service)

    const first = await gate.ensure(ws, context(hub))
    assert.equal(first.allowed, true)
    assert.equal(first.scope, 'session')
    assert.equal(service.calls.length, 1)

    const request = service.calls[0]
    assert.equal(request.agent.session.id, 's1')
    assert.equal(request.questions.length, 1)
    const question = request.questions[0]
    assert.match(question.question, /build-01:\/srv\/app/)
    assert.match(question.detail, /只读/)
    assert.equal(question.intent.kind, 'approval')
    assert.equal(question.intent.approve, CONSENT.session)
    assert.equal(question.intent.reject, CONSENT.reject)
    assert.equal(question.intent.always, CONSENT.always)
    assert.deepEqual(question.options.map(option => option.label), [CONSENT.session, CONSENT.always, CONSENT.reject])

    const second = await gate.ensure(ws, context(hub))
    assert.equal(second.allowed, true)
    assert.equal(second.scope, 'session')
    assert.equal(service.calls.length, 1)
    assert.equal(gate.autoMaintenanceAllowed(ws), false)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})

test('always-allow persists workspace consent and enables auto maintenance', async () => {
  const hub = await fixture()
  try {
    const ws = await workspace(hub)
    const gate = makeGate(fake(CONSENT.always))
    const allowed = await gate.ensure(ws, context(hub))
    assert.equal(allowed.allowed, true)
    assert.equal(allowed.scope, 'workspace')
    assert.equal(gate.autoMaintenanceAllowed(ws), true)

    const index = JSON.parse(await readFile(path.join(hub, '.archmap', 'index.json'), 'utf8'))
    const remote = index.projects.find(project => project.id === 'staging')
    assert.equal(remote.consent.scope, 'workspace')
    assert.equal(remote.consent.grantedAt, '2026-11-22T00:00:00.000Z')
    assert.equal(remote.consent.grantedBy, 'user')
    assert.equal(index.projects.find(project => project.id === 'local').consent, undefined)

    const fresh = await workspace(hub)
    const noService = createConsentGate({})
    const persisted = await noService.ensure(fresh, context(hub))
    assert.equal(persisted.allowed, true)
    assert.equal(persisted.scope, 'workspace')
    assert.equal(noService.autoMaintenanceAllowed(fresh), true)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})

test('reject and skip leave no grant and ask again next time', async () => {
  for (const choice of [CONSENT.reject, undefined]) {
    const hub = await fixture()
    try {
      const ws = await workspace(hub)
      const service = fake(choice)
      const gate = makeGate(service)
      const first = await gate.ensure(ws, context(hub))
      assert.equal(first.allowed, false)
      assert.equal(first.reason, 'rejected')
      assert.equal(gate.isAllowed(ws, context(hub)).allowed, false)

      const index = JSON.parse(await readFile(path.join(hub, '.archmap', 'index.json'), 'utf8'))
      assert.equal(index.projects.find(project => project.id === 'staging').consent, undefined)

      const second = await gate.ensure(ws, context(hub))
      assert.equal(second.allowed, false)
      assert.equal(service.calls.length, 2)
    } finally {
      await rm(hub, { recursive: true, force: true })
    }
  }
})

test('missing answerer and ask failures fail closed', async () => {
  const hub = await fixture()
  try {
    const ws = await workspace(hub)
    const noService = createConsentGate({})
    const missing = await noService.ensure(ws, context(hub))
    assert.equal(missing.allowed, false)
    assert.equal(missing.reason, 'no-answerer')

    const throwing = createConsentGate({
      getUserQuestions: () => ({ async ask() { throw new Error('boom') } }),
    })
    const failed = await throwing.ensure(ws, context(hub))
    assert.equal(failed.allowed, false)
    assert.equal(failed.reason, 'ask-failed')
    assert.match(failed.error.message, /boom/)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})

test('revoke removes workspace and session grants', async () => {
  const hub = await fixture()
  try {
    const ws = await workspace(hub)
    const gate = makeGate(fake(CONSENT.always))
    await gate.ensure(ws, context(hub))
    assert.equal(gate.autoMaintenanceAllowed(ws), true)

    const revoked = await gate.revoke(ws)
    assert.equal(revoked.revoked, 'workspace')
    assert.equal(gate.autoMaintenanceAllowed(ws), false)
    const index = JSON.parse(await readFile(path.join(hub, '.archmap', 'index.json'), 'utf8'))
    assert.equal(index.projects.find(project => project.id === 'staging').consent, undefined)

    const fresh = await workspace(hub)
    const service = fake(CONSENT.session)
    const nextGate = makeGate(service)
    const after = await nextGate.ensure(fresh, context(hub))
    assert.equal(after.allowed, true)
    assert.equal(after.scope, 'session')
    assert.equal(service.calls.length, 1)

    await nextGate.revoke(fresh, { sessionId: 's1' })
    assert.equal(nextGate.isAllowed(fresh, context(hub)).allowed, false)
    await nextGate.ensure(fresh, context(hub))
    assert.equal(service.calls.length, 2)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})

test('a child can inherit its parent session grant', async () => {
  const hub = await fixture()
  try {
    const ws = await workspace(hub)
    const service = fake(CONSENT.session)
    const gate = makeGate(service)
    await gate.ensure(ws, context(hub, 'parent'))

    assert.equal(gate.inherit(ws, 'child', 'parent'), true)
    assert.equal(gate.inherit(ws, 'other', 'unknown'), false)

    const child = await gate.ensure(ws, context(hub, 'child'))
    assert.equal(child.allowed, true)
    assert.equal(child.scope, 'session')
    assert.equal(service.calls.length, 1)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})
