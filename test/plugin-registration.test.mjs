import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/host/plugin.js'

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
