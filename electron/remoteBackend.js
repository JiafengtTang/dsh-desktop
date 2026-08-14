'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')

const { READY_LINE_RE } = require('./backend')

const WEB_UI_ALL = '@linxin666/dsh-web-ui-all@0.1.10'

const SSH_OPTIONS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'BatchMode=yes'
]

function normalizeProfile(p) {
  return {
    name: (p && p.name) || '',
    sshAlias: (p && p.sshAlias) || '',
    host: (p && p.host) || '',
    user: (p && p.user) || '',
    port: p && p.port ? Number(p.port) : 22,
    identityFile: (p && p.identityFile) || '',
    projectDir: (p && p.projectDir) || '',
    remotePort: p && p.remotePort ? Number(p.remotePort) : 0,
    dshCommand: (p && p.dshCommand) || 'npx -y @deepseek-ai/dsh@0.1.0-rc.6',
    remoteShell: (p && p.remoteShell) || 'bash',
    dshHome: (p && p.dshHome) || '',
    extraSshArgs: Array.isArray(p && p.extraSshArgs) ? p.extraSshArgs : []
  }
}

function shellQuote(value) {
  const s = String(value).replace(/'/g, "'\\''")
  return "'" + s + "'"
}

// Quote a path for `cd`, expanding a leading `~` to $HOME so the login shell
// resolves it correctly (a single-quoted '~' would otherwise be a literal).
function cdArg(value) {
  const s = String(value || '').trim()
  if (s === '' || s === '~') return '"$HOME"'
  if (s.startsWith('~/')) return '"$HOME"/' + shellQuote(s.slice(2))
  return shellQuote(s)
}

function sshTarget(p) {
  if (p.sshAlias) return p.sshAlias
  if (p.user && p.host) return p.user + '@' + p.host
  if (p.host) return p.host
  return ''
}

function resolveSsh() {
  if (process.env.DSH_DESKTOP_SSH) return process.env.DSH_DESKTOP_SSH
  if (fs.existsSync('/usr/bin/ssh')) return '/usr/bin/ssh'
  const which = spawnSync('which', ['ssh'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout && which.stdout.trim()) return which.stdout.trim()
  return 'ssh'
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

// A high ephemeral port for the remote dsh server. Using a fixed port (3080)
// collides with anything already listening there and crashes the backend.
function randomHighPort() {
  return 40000 + Math.floor(Math.random() * 20000)
}

function baseSshArgs(p, forward) {
  const args = []
  if (p.identityFile) args.push('-i', p.identityFile)
  if (!p.sshAlias && p.port && p.port !== 22) args.push('-p', String(p.port))
  if (forward && forward.local) {
    args.push('-L', '127.0.0.1:' + forward.local + ':127.0.0.1:' + p.remotePort)
  }
  args.push(...SSH_OPTIONS)
  if (p.extraSshArgs.length) args.push(...p.extraSshArgs)
  return args
}

function remoteDshCommand(p) {
  const env = p.dshHome ? 'DSH_HOME=' + shellQuote(p.dshHome) + ' ' : ''
  const projectDir = p.projectDir && String(p.projectDir).trim() ? p.projectDir : '~'
  // Best-effort remote bootstrap: install the dsh-web-ui suite on the remote
  // so the same features (task board / SSH panel / skins) show there too.
  const install = p.dshCommand + ' plugin --profile web add ' + WEB_UI_ALL
  const bootstrap =
    install + ' >/dev/null 2>&1; ' +
    'sed -i "s/set this to true or false/true/g" "$HOME/.dsh/profiles/web/pnpm-workspace.yaml" 2>/dev/null; ' +
    install + ' >/dev/null 2>&1; true'
  const inner = 'cd ' + cdArg(projectDir) + ' && ' + bootstrap + ' && ' + env + p.dshCommand + ' web --port ' + p.remotePort
  return p.remoteShell + ' -lc ' + shellQuote(inner)
}

function buildSshArgs(p, localPort) {
  // -tt forces a pseudo-TTY so the remote dsh process group receives SIGHUP and
  // exits when this SSH connection closes, instead of being orphaned.
  return [...baseSshArgs(p, { local: localPort }), '-tt', sshTarget(p), remoteDshCommand(p)]
}

class RemoteBackend extends EventEmitter {
  constructor({ profile, logPath }) {
    super()
    this.profile = normalizeProfile(profile)
    this.logPath = logPath
    this.child = null
    this.url = null
    this.localPort = null
    this._stopping = false
    this._logStream = null
  }

  get running() {
    return this.child !== null && this.child.exitCode === null
  }

  async start() {
    if (this.running) return

    const p = this.profile
    if (!sshTarget(p)) {
      this.emit('error', new Error('Remote connection is missing a host or SSH alias.'))
      return
    }
    // Resolve the remote port: 0 (auto) picks a random high port so it never
    // collides with a leftover or unrelated process already on the remote.
    if (!p.remotePort) {
      p.remotePort = randomHighPort()
    }

    try {
      this.localPort = await findFreePort()
    } catch (err) {
      this.emit('error', new Error('Could not allocate a free local port: ' + err.message))
      return
    }

    this._stopping = false
    this.url = null
    this._openLog()

    const args = buildSshArgs(p, this.localPort)
    this.child = spawn(resolveSsh(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' }
    })
    this.child.stdout.on('data', (chunk) => this._onOutput(chunk, false))
    this.child.stderr.on('data', (chunk) => this._onOutput(chunk, true))
    this.child.on('error', (err) => this.emit('error', err))
    this.child.on('exit', (code, signal) => this._onExit(code, signal))
    this.emit('starting')
  }

  _openLog() {
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true })
      this._logStream = fs.createWriteStream(this.logPath, { flags: 'a' })
      this._logStream.write('\n[remote: ' + this.profile.name + '] connecting to ' + sshTarget(this.profile) + '\n')
    } catch {
      this._logStream = null
    }
  }

  _onOutput(chunk, isError) {
    const text = chunk.toString()
    if (this._logStream) this._logStream.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.emit('log', { line, error: isError })
      if (READY_LINE_RE.test(line) && !this.url) {
        this.url = 'http://127.0.0.1:' + this.localPort
        this.emit('ready', this.url)
      }
    }
  }

  _onExit(code, signal) {
    this.child = null
    if (this._logStream) {
      this._logStream.end()
      this._logStream = null
    }
    const wasReady = this.url !== null
    this.url = null
    this.emit('stopped', { code, signal })
    if (!this._stopping) this.emit('exit', { code, signal, wasReady })
  }

  async stop() {
    this._stopping = true
    const child = this.child
    if (!child) return
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve()
      }, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = null
  }
}

function testRemoteConnection(profile) {
  return new Promise((resolve) => {
    const p = normalizeProfile(profile)
    const target = sshTarget(p)
    if (!target) return resolve({ ok: false, output: 'Missing host or SSH alias.' })

    const inner =
      'command -v node && node --version && ' +
      'cd ' + cdArg(p.projectDir) + ' && pwd && ' +
      'echo __DSH_TEST_OK__; ' +
      'command -v dsh >/dev/null 2>&1 && dsh --version || echo "dsh: not on PATH (will be fetched with npx on first connect)"'

    const remoteCmd = p.remoteShell + ' -lc ' + shellQuote(inner)
    const args = [...baseSshArgs(p, null), target, remoteCmd]

    const child = spawn(resolveSsh(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 25000)
    child.stdout.on('data', (c) => { output += c.toString() })
    child.stderr.on('data', (c) => { output += c.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, output: String(err.message) })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && output.includes('__DSH_TEST_OK__'), output: output.trim() })
    })
  })
}

// List the immediate subdirectories of a remote path over SSH. Returns the
// resolved working directory plus a sorted list of child directory names.
function listRemoteDirectory(profile, dir) {
  return new Promise((resolve) => {
    const p = normalizeProfile(profile)
    const target = sshTarget(p)
    if (!target) return resolve({ ok: false, error: '缺少主机或 SSH 别名' })

    const start = dir && String(dir).trim() ? String(dir).trim() : '~'
    const inner = 'cd ' + cdArg(start) + ' && pwd && (ls -1d */ 2>/dev/null || true)'
    const remoteCmd = p.remoteShell + ' -lc ' + shellQuote(inner)
    const args = [...baseSshArgs(p, null), target, remoteCmd]

    const child = spawn(resolveSsh(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let errOut = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 20000)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { errOut += c.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(err.message) })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        return resolve({ ok: false, error: (errOut || out || '命令执行失败').trim() })
      }
      const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      const cwd = lines[0] || start
      const dirs = lines.slice(1).map((s) => s.replace(/\/+$/, '')).filter(Boolean).sort()
      resolve({ ok: true, cwd, dirs })
    })
  })
}

// Auto-create (or adopt) a workspace at the remote project directory through
// the dsh API, so the user lands in their project without the directory dialog.
async function ensureWorkspace(baseUrl, projectDir) {
  const path = String(projectDir || '').trim()
  if (!path) return { ok: false, error: 'empty project directory' }
  const url = String(baseUrl).replace(/\/+$/, '') + '/api/workspace.create'
  let lastError
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const rpcId = randomUUID()
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace.create', payload: { path } })
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (data && data.result && data.result.ok === true && data.result.value && data.result.value.workspace) {
        const value = data.result.value
        return { ok: true, created: !!value.created, workspaceId: value.workspace.workspaceId }
      }
      if (data && data.result && data.result.ok === false) {
        const err = data.result.error || {}
        throw new Error(err.message || err.code || 'rpc error')
      }
      throw new Error('unexpected response: ' + JSON.stringify(data).slice(0, 160))
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
    }
  }
  return { ok: false, error: String((lastError && lastError.message) || lastError) }
}

module.exports = { RemoteBackend, testRemoteConnection, listRemoteDirectory, ensureWorkspace, normalizeProfile, sshTarget, findFreePort, randomHighPort }
