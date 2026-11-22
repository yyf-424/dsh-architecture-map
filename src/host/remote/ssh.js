/**
 * Architecture map — read-only SSH transport (node 11).
 *
 * One client owns an OpenSSH connection recipe: fixed options, optional
 * ControlMaster reuse, bounded concurrency, a per-command timeout, abort
 * handling, output caps, POSIX quoting and a small capability probe. It never
 * adds a remote write command; callers pass the exact remote command.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export const SSH_DEFAULTS = Object.freeze({
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 30_000,
  maxOutputBytes: 4 * 1024 * 1024,
  maxPending: 4,
})

function sshError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

/** Quote one argument for the remote POSIX shell. */
export function shQuote(value) {
  if (typeof value !== 'string') throw sshError('INVALID_ARGUMENT', 'ssh arguments must be strings')
  if (value.includes('\0')) throw sshError('INVALID_ARGUMENT', 'ssh arguments must not contain NUL')
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** Validate an OpenSSH destination (`user@host`, host alias, or bracketed IPv6). */
export function assertHost(host) {
  if (typeof host !== 'string' || host.trim() === '') {
    throw sshError('INVALID_HOST', 'ssh host must be a non-empty string')
  }
  if (host !== host.trim() || /[\0\n\r\s]/.test(host) || host.startsWith('-')) {
    throw sshError('INVALID_HOST', `ssh host ${JSON.stringify(host)} is not a plain OpenSSH destination`)
  }
  return host
}

/** Validate and normalize an absolute POSIX path used as a remote root. */
export function assertRemotePath(value, where = 'path') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw sshError('INVALID_PATH', `${where} must be a non-empty string`)
  }
  if (!value.startsWith('/') || value.includes('\\') || /[\0\n\r]/.test(value)) {
    throw sshError('PATH_ESCAPE', `${where} must be an absolute POSIX path without control characters`)
  }
  const normalized = value.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')
  if (normalized.split('/').some(segment => segment === '..')) {
    throw sshError('PATH_ESCAPE', `${where} must not contain ".."`)
  }
  return normalized
}

function controlPathFor(host) {
  const digest = createHash('sha256').update(host).digest('hex').slice(0, 12)
  return path.join(os.tmpdir(), `dsh-archmap-ssh-${digest}.sock`)
}

function stderrSummary(text, limit = 400) {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ')
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

function classify(stderr, exitCode) {
  if (/host key verification failed/i.test(stderr)) return 'SSH_HOST_KEY'
  if (/permission denied|publickey|authentication failed/i.test(stderr)) return 'SSH_CONNECTION_FAILED'
  if (/could not resolve hostname|name or service not known|nodename nor servname/i.test(stderr)) return 'SSH_HOST_UNKNOWN'
  return exitCode === 255 ? 'SSH_CONNECTION_FAILED' : 'SSH_COMMAND_FAILED'
}

/**
 * Create a read-only SSH client.
 * @param {object} config - `{ host, binary?, connectTimeoutMs?, requestTimeoutMs?, maxOutputBytes?, maxPending?, controlMaster?, controlPath?, env? }`.
 * @returns `{ host, controlPath, run, exec, execShell, probe }`.
 */
export function createSshClient(config = {}) {
  const host = assertHost(config.host)
  const binary = typeof config.binary === 'string' && config.binary !== '' ? config.binary : 'ssh'
  const connectTimeoutMs = Number.isInteger(config.connectTimeoutMs) ? config.connectTimeoutMs : SSH_DEFAULTS.connectTimeoutMs
  const requestTimeoutMs = Number.isInteger(config.requestTimeoutMs) ? config.requestTimeoutMs : SSH_DEFAULTS.requestTimeoutMs
  const maxOutputBytes = Number.isInteger(config.maxOutputBytes) ? config.maxOutputBytes : SSH_DEFAULTS.maxOutputBytes
  const maxPending = Number.isInteger(config.maxPending) && config.maxPending > 0 ? config.maxPending : SSH_DEFAULTS.maxPending
  const env = { ...process.env, LC_ALL: 'C', ...(config.env ?? {}) }
  const controlPath = config.controlPath ?? controlPathFor(host)

  const baseArgs = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(1, Math.ceil(connectTimeoutMs / 1000))}`,
    '-o', 'ServerAliveInterval=15',
  ]
  if (config.controlMaster !== false) {
    baseArgs.push('-o', 'ControlMaster=auto', '-o', `ControlPath=${controlPath}`, '-o', 'ControlPersist=300')
  }

  let active = 0
  const queue = []

  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(sshError('SSH_ABORTED', `${host}: command aborted`))
    if (active < maxPending) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: undefined }
      waiter.onAbort = () => {
        const index = queue.indexOf(waiter)
        if (index >= 0) queue.splice(index, 1)
        reject(sshError('SSH_ABORTED', `${host}: command aborted`))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      queue.push(waiter)
    })
  }

  function release() {
    active = Math.max(0, active - 1)
    const next = queue.shift()
    if (next) {
      active += 1
      next.signal?.removeEventListener('abort', next.onAbort)
      next.resolve()
    }
  }

  function run(command, options = {}) {
    if (typeof command !== 'string' || command === '' || command.includes('\0')) {
      return Promise.reject(sshError('INVALID_COMMAND', 'remote command must be a non-empty string without NUL'))
    }
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : requestTimeoutMs
    const outputLimit = Number.isInteger(options.maxOutputBytes) ? options.maxOutputBytes : maxOutputBytes
    const signal = options.signal

    return (async () => {
      await acquire(signal)
      let released = false
      const releaseOnce = () => {
        if (released) return
        released = true
        release()
      }
      try {
        return await new Promise((resolve, reject) => {
          let child
          try {
            child = spawn(binary, [...baseArgs, host, command], {
              env,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            })
          } catch (error) {
            reject(sshError('SSH_IO_ERROR', `${host}: cannot start ${binary}: ${error.message}`))
            return
          }

          let stdout = Buffer.alloc(0)
          let stderr = Buffer.alloc(0)
          let settled = false
          let timer
          let killTimer
          let onAbort

          const cleanup = () => {
            if (timer) clearTimeout(timer)
            if (killTimer) clearTimeout(killTimer)
            if (onAbort) signal?.removeEventListener('abort', onAbort)
          }
          const finish = (error, value) => {
            if (settled) return
            settled = true
            cleanup()
            releaseOnce()
            if (error) reject(error)
            else resolve(value)
          }
          const kill = () => {
            try {
              child.kill('SIGTERM')
            } catch {
              // Already gone.
            }
            killTimer = setTimeout(() => {
              try {
                child.kill('SIGKILL')
              } catch {
                // Already gone.
              }
            }, 2_000)
            killTimer.unref?.()
          }

          child.stdout.on('data', chunk => {
            stdout = Buffer.concat([stdout, chunk])
            if (stdout.length > outputLimit) {
              kill()
              finish(sshError('SSH_OUTPUT_LIMIT', `${host}: stdout exceeded ${outputLimit} bytes`))
            }
          })
          child.stderr.on('data', chunk => {
            stderr = Buffer.concat([stderr, chunk])
            if (stderr.length > outputLimit) {
              kill()
              finish(sshError('SSH_OUTPUT_LIMIT', `${host}: stderr exceeded ${outputLimit} bytes`))
            }
          })
          child.on('error', error => {
            if (error && error.code === 'ENOENT') {
              finish(sshError('SSH_UNAVAILABLE', `ssh binary ${JSON.stringify(binary)} was not found`))
            } else {
              finish(sshError('SSH_IO_ERROR', `${host}: ${error?.message ?? String(error)}`))
            }
          })
          child.on('close', code => {
            if (settled) return
            if (code === 0) {
              finish(null, { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), code: 0 })
              return
            }
            const text = stderr.toString('utf8')
            const codeId = classify(text, code)
            const detail = stderrSummary(text) || `ssh exited ${code}`
            finish(sshError(codeId, `${host}: ${detail}`))
          })

          timer = setTimeout(() => {
            kill()
            finish(sshError('SSH_TIMEOUT', `${host}: command timed out after ${timeoutMs}ms`))
          }, timeoutMs)

          if (signal) {
            onAbort = () => {
              kill()
              finish(sshError('SSH_ABORTED', `${host}: command aborted`))
            }
            if (signal.aborted) onAbort()
            else signal.addEventListener('abort', onAbort, { once: true })
          }
        })
      } catch (error) {
        releaseOnce()
        throw error
      }
    })()
  }

  function exec(argv, options = {}) {
    if (!Array.isArray(argv) || argv.length === 0) {
      return Promise.reject(sshError('INVALID_COMMAND', 'exec expects a non-empty argv array'))
    }
    try {
      return run(argv.map(shQuote).join(' '), options)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Trusted internal scripts only; callers must quote every interpolated value. */
  function execShell(script, options = {}) {
    return run(script, options)
  }

  async function probe(options = {}) {
    const script = "printf 'os='; uname -s 2>/dev/null || true; printf '\\n'; for c in git sha256sum shasum rg find stat; do printf '%s=' \"$c\"; command -v \"$c\" 2>/dev/null || true; printf '\\n'; done"
    const { stdout } = await execShell(script, options)
    const capabilities = { os: '', git: false, sha256sum: false, shasum: false, rg: false, find: false, stat: false }
    for (const line of stdout.split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index < 0) continue
      const key = line.slice(0, index)
      const value = line.slice(index + 1).trim()
      if (key === 'os') capabilities.os = value
      else if (key in capabilities) capabilities[key] = value !== ''
    }
    return capabilities
  }

  return { host, controlPath, run, exec, execShell, probe }
}
