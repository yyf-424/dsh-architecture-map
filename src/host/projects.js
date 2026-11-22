/**
 * Architecture map — project index (node 9).
 *
 * `.archmap/index.json` lists the local project and any remote projects. The
 * local project keeps the legacy layout (`.archmap/graph.json`); remote
 * projects own `.archmap/projects/<id>/`, so one `.archmap` can hold several
 * projects without migrating existing data.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const INDEX_SCHEMA = 1
export const LOCAL_PROJECT_ID = 'local'
export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

const INDEX_FIELDS = new Set(['schema', 'projects'])
const PROJECT_FIELDS = new Set([
  'id', 'kind', 'title', 'dir', 'transport', 'host', 'root', 'vcs',
  'autoRefresh', 'consent', 'createdAt', 'lastUsedAt',
])
const CONSENT_FIELDS = new Set(['scope', 'grantedAt', 'grantedBy'])
const PROJECT_KINDS = new Set(['local', 'remote'])
const VCS_KINDS = new Set(['git', 'none'])

/** Throw a coded error the tool layer can surface verbatim to the model. */
function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  throw error
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertKnownKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('INVALID_PROJECT', `${where}.${key} is not a recognized field (expected: ${[...allowed].join(', ')})`)
    }
  }
}

function assertText(value, where, max = 200) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_PROJECT', `${where} must be a non-empty string`)
  }
  if (value.length > max) {
    fail('LIMIT_EXCEEDED', `${where} is ${value.length} characters; the limit is ${max}`)
  }
  return value.trim()
}

function assertRelativeDir(value, where) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_PROJECT', `${where} must be a non-empty string`)
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('\n')) {
    fail('PATH_ESCAPE', `${where} must be a workspace-relative POSIX directory`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('PATH_ESCAPE', `${where} must not contain empty, "." or ".." segments`)
  }
  return segments.join('/')
}

function assertRemoteRoot(value, where) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_PROJECT', `${where} must be a non-empty absolute path`)
  }
  if (!value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('\n')) {
    fail('PATH_ESCAPE', `${where} must be an absolute POSIX path`)
  }
  if (value.split('/').some(segment => segment === '..')) {
    fail('PATH_ESCAPE', `${where} must not contain ".."`)
  }
  return value
}

function normalizeConsent(raw, where) {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) fail('INVALID_PROJECT', `${where} must be an object`)
  assertKnownKeys(raw, CONSENT_FIELDS, where)
  if (raw.scope !== 'workspace') {
    fail('INVALID_PROJECT', `${where}.scope must be "workspace"`)
  }
  if (typeof raw.grantedAt !== 'string' || raw.grantedAt.trim() === '') {
    fail('INVALID_PROJECT', `${where}.grantedAt must be an ISO-8601 string`)
  }
  if (raw.grantedBy !== undefined && typeof raw.grantedBy !== 'string') {
    fail('INVALID_PROJECT', `${where}.grantedBy must be a string when present`)
  }
  return {
    scope: 'workspace',
    grantedAt: raw.grantedAt,
    ...(raw.grantedBy === undefined ? {} : { grantedBy: raw.grantedBy }),
  }
}

function assertOptionalTimestamp(raw, where) {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('INVALID_PROJECT', `${where} must be an ISO-8601 string when present`)
  }
  return raw
}

/** The legacy local project: `.archmap/graph.json`. */
export function localProject() {
  return { id: LOCAL_PROJECT_ID, kind: 'local', title: 'This project', dir: '.' }
}

function normalizeProject(raw, where) {
  if (!isPlainObject(raw)) fail('INVALID_PROJECT', `${where} must be an object`)
  assertKnownKeys(raw, PROJECT_FIELDS, where)
  if (typeof raw.id !== 'string' || !PROJECT_ID_PATTERN.test(raw.id)) {
    fail('INVALID_PROJECT', `${where}.id must match ${PROJECT_ID_PATTERN}`)
  }
  if (!PROJECT_KINDS.has(raw.kind)) {
    fail('INVALID_PROJECT', `${where}.kind must be local or remote`)
  }
  if (raw.kind === 'local' && raw.id !== LOCAL_PROJECT_ID) {
    fail('INVALID_PROJECT', `${where}.id must be "local" for the local project`)
  }
  if (raw.kind === 'remote' && raw.id === LOCAL_PROJECT_ID) {
    fail('INVALID_PROJECT', `${where}.id "local" is reserved for the local project`)
  }
  const dir = raw.dir === undefined
    ? (raw.kind === 'local' ? '.' : `projects/${raw.id}`)
    : (raw.kind === 'local' && raw.dir === '.' ? '.' : assertRelativeDir(raw.dir, `${where}.dir`))
  const createdAt = assertOptionalTimestamp(raw.createdAt, `${where}.createdAt`)
  const lastUsedAt = assertOptionalTimestamp(raw.lastUsedAt, `${where}.lastUsedAt`)

  if (raw.kind === 'local') {
    if (dir !== '.') fail('INVALID_PROJECT', `${where}.dir must be "." for the local project`)
    if (raw.host !== undefined || raw.root !== undefined || raw.transport !== undefined || raw.vcs !== undefined) {
      fail('INVALID_PROJECT', `${where}: the local project has no remote fields`)
    }
    if (raw.consent !== undefined || raw.autoRefresh !== undefined) {
      fail('INVALID_PROJECT', `${where}: the local project has no remote policy fields`)
    }
    return {
      id: raw.id,
      kind: 'local',
      title: raw.title === undefined ? 'This project' : assertText(raw.title, `${where}.title`),
      dir,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    }
  }

  const transport = raw.transport ?? 'ssh'
  if (transport !== 'ssh') fail('INVALID_PROJECT', `${where}.transport must be "ssh"`)
  const host = assertText(raw.host, `${where}.host`, 255)
  const root = assertRemoteRoot(raw.root, `${where}.root`)
  const vcs = raw.vcs ?? 'git'
  if (!VCS_KINDS.has(vcs)) fail('INVALID_PROJECT', `${where}.vcs must be git or none`)
  const autoRefresh = raw.autoRefresh === undefined ? true : raw.autoRefresh
  if (typeof autoRefresh !== 'boolean') {
    fail('INVALID_PROJECT', `${where}.autoRefresh must be a boolean when present`)
  }
  const consent = normalizeConsent(raw.consent, `${where}.consent`)
  return {
    id: raw.id,
    kind: 'remote',
    title: raw.title === undefined ? `${host}:${root}` : assertText(raw.title, `${where}.title`),
    dir,
    transport,
    host,
    root,
    vcs,
    autoRefresh,
    ...(consent === undefined ? {} : { consent }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  }
}

/** Validate and normalize one index; a missing local entry is added in memory. */
export function validateIndex(raw) {
  if (!isPlainObject(raw)) fail('INDEX_CORRUPT', 'index.json must be an object')
  assertKnownKeys(raw, INDEX_FIELDS, 'index')
  if (raw.schema !== INDEX_SCHEMA) {
    fail('INDEX_CORRUPT', `index.schema must be ${INDEX_SCHEMA}`)
  }
  if (!Array.isArray(raw.projects)) fail('INDEX_CORRUPT', 'index.projects must be an array')
  const projects = raw.projects.map((project, index) => normalizeProject(project, `projects[${index}]`))
  if (!projects.some(project => project.id === LOCAL_PROJECT_ID)) projects.unshift(localProject())

  const ids = new Set()
  const dirs = new Set()
  for (const project of projects) {
    if (ids.has(project.id)) fail('INVALID_PROJECT', `duplicate project id "${project.id}"`)
    ids.add(project.id)
    const dirKey = project.dir.toLowerCase()
    if (dirs.has(dirKey)) fail('INVALID_PROJECT', `project "${project.id}" reuses directory "${project.dir}"`)
    dirs.add(dirKey)
  }
  return { schema: INDEX_SCHEMA, projects }
}

/** Read the project index; a missing file is the legacy local-only index. */
export async function loadIndex(root, dir = '.archmap') {
  const file = path.join(root, dir, 'index.json')
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { schema: INDEX_SCHEMA, projects: [localProject()] }
    fail('IO_ERROR', `cannot read ${file}: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    fail('INDEX_CORRUPT', `index.json is not valid JSON (${error.message})`)
  }
  return validateIndex(parsed)
}

/** Write the project index atomically; returns the normalized value. */
export async function writeIndex(root, index, dir = '.archmap') {
  const normalized = validateIndex(index)
  const dataDir = path.join(root, dir)
  await fs.mkdir(dataDir, { recursive: true })
  const file = path.join(dataDir, 'index.json')
  const temp = path.join(dataDir, `index.tmp-${process.pid}-${randomBytes(6).toString('hex')}.json`)
  await fs.writeFile(temp, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  await fs.rename(temp, file)
  return normalized
}

/** Return one project by id, or undefined when it is not registered. */
export function projectById(index, id) {
  if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
    fail('INVALID_PROJECT', `invalid project id "${id}"`)
  }
  return index.projects.find(project => project.id === id)
}
