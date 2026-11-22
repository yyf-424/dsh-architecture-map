import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/*
 * The client is a browser module loaded by DSH's client loader, not an
 * importable ESM file. To keep its pure source/path helpers testable without a
 * browser, this test extracts those functions by name and evaluates them with
 * small stubs. It intentionally reads the real client source, so a change in
 * the helper logic is exercised here.
 */
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const marker = `    function ${name}(`
  const start = clientSource.indexOf(marker)
  if (start < 0) throw new Error(`client function ${name} not found`)
  const open = clientSource.indexOf('{', start)
  let depth = 0
  for (let index = open; index < clientSource.length; index += 1) {
    if (clientSource[index] === '{') depth += 1
    if (clientSource[index] === '}') {
      depth -= 1
      if (depth === 0) return clientSource.slice(start, index + 1)
    }
  }
  throw new Error(`client function ${name} is not closed`)
}

const translations = {
  'source.local': 'Local',
  'source.consent': 'consent',
}
const t = key => translations[key] ?? key
const factory = new Function('t', 'GRAPH_PATH', `
${extractFunction('localSource')}
${extractFunction('sourcesFromIndex')}
${extractFunction('isMissingFile')}
${extractFunction('readAll')}
return { localSource, sourcesFromIndex, isMissingFile, readAll }
`)
const helpers = factory(t, '.archmap/graph.json')

test('sourcesFromIndex builds local and remote graph paths', () => {
  const sources = helpers.sourcesFromIndex({
    projects: [
      { id: 'local', kind: 'local', dir: '.' },
      {
        id: 'staging', kind: 'remote', title: 'staging', dir: 'projects/staging',
        host: 'build-01', root: '/srv/app', vcs: 'git', consent: { scope: 'workspace' },
      },
    ],
  })
  assert.equal(sources.length, 2)
  assert.equal(sources[0].kind, 'local')
  assert.equal(sources[0].graphPath, '.archmap/graph.json')
  assert.equal(sources[1].id, 'staging')
  assert.equal(sources[1].graphPath, '.archmap/projects/staging/graph.json')
  assert.match(sources[1].meta, /build-01/)
  assert.match(sources[1].meta, /consent workspace/)
})

test('sourcesFromIndex adds a local fallback and rejects unsafe entries', () => {
  const sources = helpers.sourcesFromIndex({
    projects: [
      { id: 'staging', kind: 'remote', dir: '../outside', host: 'h', root: '/r', vcs: 'none' },
      { id: 'Bad', kind: 'remote' },
      null,
    ],
  })
  assert.equal(sources[0].kind, 'local')
  assert.equal(sources.some(source => source.id === 'staging'), true)
  assert.equal(sources.find(source => source.id === 'staging').graphPath, '.archmap/projects/staging/graph.json')
  assert.equal(sources.some(source => source.id === 'Bad'), false)
})

test('isMissingFile recognizes a missing workspace file', () => {
  assert.equal(helpers.isMissingFile({ code: 'FS_NOT_FOUND', message: 'missing' }), true)
  assert.equal(helpers.isMissingFile({ message: 'ENOENT: no such file' }), true)
  assert.equal(helpers.isMissingFile({ code: 'FS_PERMISSION_DENIED', message: 'denied' }), false)
})

test('readAll reads the requested path, pages lines and preserves error codes', async () => {
  const calls = []
  const pages = [
    { ok: true, value: { text: '{\n  "a": 1', lines: 2, eof: false } },
    { ok: true, value: { text: '}', lines: 1, eof: true } },
  ]
  const ctx = {
    remote: {
      workspaceFiles: {
        async read(sessionId, filePath, options) {
          calls.push({ sessionId, filePath, options })
          return pages.shift()
        },
      },
    },
  }
  const parsed = await helpers.readAll(ctx, 's1', '.archmap/projects/staging/graph.json')
  assert.deepEqual(parsed, { a: 1 })
  assert.equal(calls[0].sessionId, 's1')
  assert.equal(calls[0].filePath, '.archmap/projects/staging/graph.json')
  assert.deepEqual(calls.map(call => call.options.offset), [1, 3])

  const failing = {
    remote: {
      workspaceFiles: {
        async read() {
          return { ok: false, error: { code: 'FS_NOT_FOUND', message: 'missing' } }
        },
      },
    },
  }
  await assert.rejects(
    () => helpers.readAll(failing, 's1', '.archmap/index.json'),
    error => error.code === 'FS_NOT_FOUND' && /missing/.test(error.message),
  )
})
