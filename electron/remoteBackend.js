'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { READY_LINE_RE } = require('./backend')

const WEB_UI_ALL = '@linxin666/dsh-web-ui-all@0.1.10'
const BILLING_LLM_TGZ = 'https://raw.githubusercontent.com/JiafengtTang/dsh-desktop/main/vendor/dsh-billing-plugin/deepseek-ai-dsh-llm-billing-0.1.0-rc.5.tgz'
const BILLING_UI_TGZ = 'https://raw.githubusercontent.com/JiafengtTang/dsh-desktop/main/vendor/dsh-billing-plugin/deepseek-ai-dsh-client-ui-billing-0.1.0-rc.5.tgz'

const SSH_OPTIONS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
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
    dshCommand: (p && p.dshCommand) || 'npx -y @deepseek-ai/dsh@latest',
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
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const candidates = [
      path.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe'),
      'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    const where = spawnSync('where.exe', ['ssh'], { encoding: 'utf8' })
    if (where.status === 0 && where.stdout && where.stdout.trim()) {
      const line = where.stdout.trim().split(/\r?\n/)[0].trim()
      if (line && fs.existsSync(line)) return line
    }
    return 'ssh'
  }
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

// Stable remote port derived from the profile name (43000-43999), so the phone
// and the desktop resolve to the SAME remote dsh instance even when the profile
// does not pin remotePort explicitly.
function stableRemotePort(p) {
  const name = String((p && p.name) || '').trim()
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return 43000 + (h % 900)
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

function remoteDshCommand(p, localDshHome) {
  const env = p.dshHome ? 'DSH_HOME=' + shellQuote(p.dshHome) + ' ' : ''
  const projectDir = p.projectDir && String(p.projectDir).trim() ? p.projectDir : '~'
  const port = p.remotePort
  const log = '"$HOME/.dsh/remote-web-' + port + '.log"'
  // Reuse an already-running instance on the fixed port; otherwise start one
  // detached (setsid + nohup) so it survives SSH disconnects. This makes the
  // phone and the desktop share the SAME dsh process, so live session events
  // (streamed replies, queue state, progress) propagate between devices.
  // After the remote is ready, KEEP THE SSH SESSION OPEN (idle loop) so the
  // local -L forward stays alive for the desktop window. The detached dsh
  // process itself is independent and survives even if this SSH later closes.
  const keepAlive = 'while true; do sleep 3600; done'
  const probe = 'if curl -s -o /dev/null --max-time 2 http://127.0.0.1:' + port + '/; then echo "dsh web: ready"; ' + keepAlive + '; fi'
  const start = 'cd ' + cdArg(projectDir) + ' && ' +
    '(setsid nohup ' + env + p.dshCommand + ' web --port ' + port +
    ' > ' + log + ' 2>&1 </dev/null &)'
  // First launch with @latest can take minutes while npx downloads the newest
  // package, so allow up to 300s and report progress every 15s. The desktop
  // surfaces these lines in the connection log / update progress UI.
  const wait = 'for i in $(seq 1 300); do ' +
    'if curl -s -o /dev/null http://127.0.0.1:' + port + '/; then ' +
    'echo "dsh web: ready"; ' + keepAlive + '; fi; ' +
    'if [ $((i % 15)) -eq 0 ]; then echo "dsh web: progress ' + port + ' ' + '$i/300"; fi; ' +
    'sleep 1; done; ' +
    'echo "dsh web: timeout after 300s"; exit 1'
  const inner = probe + '; ' + start + '; ' + wait
  return p.remoteShell + ' -lc ' + shellQuote(inner)
}

// Resolve the local web-profile plugins that should also exist on the remote.
function remotePluginSync(p, localDshHome) {
  const manifest = path.join(localDshHome, 'profiles', 'web', 'package.json')
  let pkg = null
  try { pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) } catch { /* fall through */ }

  const specs = []
  let hasBilling = false
  if (pkg && pkg.dependencies && typeof pkg.dependencies === 'object') {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      if (name === '@deepseek-ai/dsh-llm-billing') {
        specs.push(shellQuote(BILLING_LLM_TGZ))
        hasBilling = true
        continue
      }
      if (name === '@deepseek-ai/dsh-client-ui-billing') {
        specs.push(shellQuote(BILLING_UI_TGZ))
        hasBilling = true
        continue
      }
      if (typeof spec !== 'string') continue
      const value = spec.trim()
      if (!value || /^(file|link):/.test(value)) continue
      if (/^https?:\/\//.test(value)) {
        specs.push(shellQuote(value))
      } else {
        specs.push(shellQuote(name + '@' + value))
      }
    }
  }

  if (specs.length === 0) {
    specs.push(shellQuote(WEB_UI_ALL), shellQuote(BILLING_LLM_TGZ), shellQuote(BILLING_UI_TGZ))
    hasBilling = true
  }
  return { specs, hasBilling }
}

// Write the billing cordis layer on the remote server (idempotent).
function remoteBillingPatch() {
  const patch = '"$HOME/.dsh/profiles/web/cordis.patch.yml"'
  return [
    'mkdir -p "$HOME/.dsh/profiles/web"',
    'touch ' + patch,
    'sed -i "/# --- dsh-billing managed/,/# --- end dsh-billing managed ---/d" ' + patch,
    '  sed -i "s/^[[:space:]]*\\[\\][[:space:]]*$//" ' + patch,
    "    echo '# --- dsh-billing managed (auto-generated; do not edit) ---' >> " + patch,
    "    echo '- insert:' >> " + patch,
    "    echo '    - id: llm-billing' >> " + patch,
    "    echo '      name: \"@deepseek-ai/dsh-llm-billing\"' >> " + patch,
    "    echo '    - id: ui-billing' >> " + patch,
    "    echo '      name: \"@deepseek-ai/dsh-client-ui-billing\"' >> " + patch,
    "    echo '# --- end dsh-billing managed ---' >> " + patch,
  ].join('\n')
}

function ensureRemotePnpm() {
  return 'if ! command -v pnpm >/dev/null; then npm install --prefix "$HOME/.dsh/pnpm-bootstrap" pnpm@11 --no-audit --no-fund >/dev/null 2>&1; export PATH="$HOME/.dsh/pnpm-bootstrap/node_modules/.bin:$PATH"; fi'
}

// Manually sync this Mac's web-profile plugins to a remote server without
// starting the remote dsh web server. This is exposed as an explicit action
// in the connection UI so it never delays a remote connection.
function syncRemotePlugins(profile, localDshHome) {
  return new Promise((resolve) => {
    const p = normalizeProfile(profile)
    const target = sshTarget(p)
    if (!target) return resolve({ ok: false, output: 'Missing host or SSH alias.' })

    const { specs, hasBilling } = remotePluginSync(p, localDshHome)
    const install = p.dshCommand + ' plugin --profile web add ' + specs.join(' ')
    const patch = hasBilling ? remoteBillingPatch() : 'true'
    const inner = [
      'cd ' + cdArg(p.projectDir || '~'),
      ensureRemotePnpm(),
      install + ' >/dev/null 2>&1',
      'sed -i "s/set this to true or false/true/g" "$HOME/.dsh/profiles/web/pnpm-workspace.yaml" 2>/dev/null',
      install + ' >/dev/null 2>&1 && ' + patch,
      'echo __DSH_SYNC_DONE__',
    ].join(' && ')
    const remote = p.remoteShell + ' -lc ' + shellQuote(inner)
    const args = [...baseSshArgs(p, null), target, remote]
    const child = spawn(resolveSsh(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    let output = ''
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      resolve({ ok, output: output.trim() })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(false)
    }, 180000)

    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish(false)
      if (output) output += '\n'
      output += String(err.message || err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      finish(code === 0 && output.includes('__DSH_SYNC_DONE__'))
    })
  })
}

function buildSshArgs(p, localPort, localDshHome) {
  // No pseudo-TTY: the remote dsh is detached with setsid/nohup and must
  // survive the SSH connection closing, otherwise the phone and desktop could
  // never share the same instance.
  return [...baseSshArgs(p, { local: localPort }), sshTarget(p), remoteDshCommand(p, localDshHome)]
}

class RemoteBackend extends EventEmitter {
  constructor({ profile, logPath, localDshHome }) {
    super()
    this.profile = normalizeProfile(profile)
    this.logPath = logPath
    this.localDshHome = localDshHome || path.join(os.homedir(), '.dsh')
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
      p.remotePort = stableRemotePort(p)
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

    const args = buildSshArgs(p, this.localPort, this.localDshHome)
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
      if ((READY_LINE_RE.test(line) || line.includes('dsh web: ready')) && !this.url) {
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

// Stop the resident remote dsh that listens on the profile's fixed port. The
// desktop then restarts its backend, whose probe sees a free port and launches
// a fresh dsh (plugins are reloaded; if the dshCommand version changed, the new
// version is fetched). Kill only the process listening on that port so the SSH
// transport itself is never affected.
function restartRemoteDsh(profile, onProgress) {
  return new Promise((resolve) => {
    const p = normalizeProfile(profile)
    const target = sshTarget(p)
    if (!target) return resolve({ ok: false, output: '缺少主机或 SSH 别名' })
    const port = p.remotePort
    if (!port) return resolve({ ok: false, output: '该连接没有固定远程端口，无法重启' })

    const inner = [
      '(lsof -ti tcp:' + port + ' -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null); ' +
        '(fuser -k ' + port + '/tcp 2>/dev/null); true',
      'for i in $(seq 1 30); do ' +
        'if ! curl -s -o /dev/null --max-time 1 http://127.0.0.1:' + port + '/; then ' +
        'echo __DSH_STOPPED__; exit 0; fi; sleep 1; done',
      'echo __DSH_STILL_UP__; exit 1'
    ].join(' && ')
    const remote = p.remoteShell + ' -lc ' + shellQuote(inner)
    const args = [...baseSshArgs(p, null), target, remote]

    const child = spawn(resolveSsh(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      resolve({ ok, output: output.trim() })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(false)
    }, 45000)
    child.stdout.on('data', (c) => {
      const s = c.toString()
      output += s
      if (typeof onProgress === 'function') onProgress(s)
    })
    child.stderr.on('data', (c) => {
      const s = c.toString()
      output += s
      if (typeof onProgress === 'function') onProgress(s)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish(false)
      output += (output ? '\n' : '') + String(err.message || err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      finish(code === 0 && output.includes('__DSH_STOPPED__'))
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

// List registered workspaces from a running backend's RPC API. Used to merge
// local and remote workspace lists into one sidebar view.
async function listWorkspaces(baseUrl, timeoutMs = 4000) {
  const url = String(baseUrl).replace(/\/+$/, '') + '/api/workspace.list'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: randomUUID(),
        method: 'workspace.list',
        payload: {}
      }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    if (data && data.result && data.result.ok === true && data.result.value) {
      return {
        items: data.result.value.items || [],
        archivedSessionIds: data.result.value.archivedSessionIds || []
      }
    }
    const err = data && data.result && data.result.error
    throw new Error((err && (err.message || err.code)) || 'workspace.list failed')
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { RemoteBackend, testRemoteConnection, listRemoteDirectory, ensureWorkspace, listWorkspaces, syncRemotePlugins, restartRemoteDsh, normalizeProfile, sshTarget, findFreePort, randomHighPort, stableRemotePort }
