import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, parseArchDiscuss } from '../src/host/plugin.js'
import { writeIndex } from '../src/host/projects.js'

test('apply registers the remote read tools', () => {
  const names = []
  const ctx = {
    tools: {
      register(tool) {
        names.push(tool.name)
      },
      restrict() {},
    },
    commands: {
      register() {},
    },
    inject() {
      return () => {}
    },
    on() {},
    effect() {},
  }
  apply(ctx, { dir: '.archmap' })
  for (const name of [
    'arch_remote_list',
    'arch_remote_status',
    'arch_remote_tree',
    'arch_remote_read',
    'arch_remote_grep',
  ]) {
    assert.ok(names.includes(name), name)
  }
  for (const name of names) {
    assert.match(name, /^arch_/)
  }
})

test('the /arch command routes remote subcommands', async () => {
  const hub = await mkdtemp(path.join(tmpdir(), 'archmap-command-registration-'))
  await mkdir(path.join(hub, '.archmap'), { recursive: true })
  await writeIndex(hub, { schema: 1, projects: [] })
  try {
    let handler
    const ctx = {
      tools: { register() {}, restrict() {} },
      commands: { register(command) { handler = command.handler } },
      inject() { return () => {} },
      on() {},
      effect() {},
    }
    apply(ctx, { dir: '.archmap' })
    const agent = { session: { id: 's1', header: { cwd: hub } } }
    const listed = await handler({ agent, rawInput: 'remote list', signal: undefined })
    assert.equal(listed.kind, 'success')
    assert.match(listed.text, /local/)
    const unknown = await handler({ agent, rawInput: 'remote nope', signal: undefined })
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /未知子命令/)
  } finally {
    await rm(hub, { recursive: true, force: true })
  }
})


test('parseArchDiscuss accepts an optional workspace for remote sources', () => {
  assert.deepEqual(parseArchDiscuss('discuss node:api fork'), {
    target: 'node:api', mode: 'fork', workspace: undefined,
  })
  assert.deepEqual(parseArchDiscuss('discuss node:api lite remote:acf'), {
    target: 'node:api', mode: 'lite', workspace: 'remote:acf',
  })
  assert.deepEqual(parseArchDiscuss('discuss edge:e1 remote:acf'), {
    target: 'edge:e1', mode: undefined, workspace: 'remote:acf',
  })
  assert.equal(parseArchDiscuss('remote list'), null)
  assert.equal(parseArchDiscuss('discuss node:Bad'), null)
})
