'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')

// The dsh web server prints exactly one readiness line:
//   dsh web: http://127.0.0.1:<port>
const READY_LINE_RE = /dsh web:\s+(https?:\/\/[^\s]+)/

function resolveDshBin() {
  try {
    const pkg = require.resolve('@deepseek-ai/dsh/package.json')
    return path.join(path.dirname(pkg), 'lib', 'bin.js')
  } catch {
    return null
  }
}

// Common absolute locations for a user-installed Node. Finder-launched apps get
// a minimal PATH that omits these, so `which`/`where` alone is not enough.
const NODE_CANDIDATES = process.platform === 'win32'
  ? [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe'
    ]
  : [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/opt/local/bin/node',
      '/usr/bin/node'
    ]

// Ask a login shell for `node`'s path. This covers nvm/volta/asdf-style setups
// where node only appears after the user's profile is sourced.
function resolveNodeViaShell() {
  if (process.platform === 'win32') return null
  for (const shell of ['bash', 'zsh', 'sh']) {
    try {
      const result = spawnSync(shell, ['-lc', 'command -v node 2>/dev/null'], { encoding: 'utf8' })
      if (result.status === 0 && result.stdout) {
        const line = result.stdout.trim().split('\n')[0].trim()
        if (line && fs.existsSync(line)) return line
      }
    } catch {
      /* try the next shell */
    }
  }
  return null
}

// Resolve a Node runtime. Order of preference:
//   1. DSH_DESKTOP_NODE (explicit override)
//   2. `node` on PATH
//   3. common absolute install paths
//   4. the login shell's `node` (nvm/volta/etc.)
//   5. Electron itself, run as Node via ELECTRON_RUN_AS_NODE, with
//      --expose-internals so dsh's HMR loader can reach Node internals without
//      the node-addon-require-builtin native addon (ABI-mismatched under Electron).
function resolveNodeCommand(scriptPath, args) {
  const override = process.env.DSH_DESKTOP_NODE
  if (override) {
    return { cmd: override, args: [scriptPath, ...args], env: {} }
  }

  const isWin = process.platform === 'win32'
  const lookup = isWin
    ? spawnSync('where.exe', ['node'], { encoding: 'utf8' })
    : spawnSync('which', ['node'], { encoding: 'utf8' })
  if (lookup.status === 0 && lookup.stdout && lookup.stdout.trim()) {
    const line = lookup.stdout.trim().split(/\r?\n/)[0].trim()
    if (line && fs.existsSync(line)) {
      return { cmd: line, args: [scriptPath, ...args], env: {} }
    }
  }

  for (const candidate of NODE_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return { cmd: candidate, args: [scriptPath, ...args], env: {} }
    }
  }

  const viaShell = resolveNodeViaShell()
  if (viaShell) {
    return { cmd: viaShell, args: [scriptPath, ...args], env: {} }
  }

  return {
    cmd: process.execPath,
    args: ['--expose-internals', scriptPath, ...args],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

class DshBackend extends EventEmitter {
  constructor({ settings, logPath }) {
    super()
    this.settings = settings
    this.logPath = logPath
    this.child = null
    this.url = null
    this._stopping = false
    this._logStream = null
  }

  get running() {
    return this.child !== null && this.child.exitCode === null
  }

  start() {
    if (this.running) return

    const bin = resolveDshBin()
    if (!bin) {
      this.emit('error', new Error('Could not locate @deepseek-ai/dsh. Run `npm install` in the project directory.'))
      return
    }

    const port = this.settings.get('port', 0)
    const host = this.settings.get('host', '127.0.0.1')
    const dshArgs = ['web', '--port', String(port)]
    if (host && host !== '127.0.0.1') dshArgs.push('--host', host)

    const { cmd, args, env } = resolveNodeCommand(bin, dshArgs)
    const childEnv = { ...process.env, ...env }
    const dshHome = this.settings.get('dshHome', '')
    if (dshHome) childEnv.DSH_HOME = dshHome

    this._stopping = false
    this.url = null
    this._openLog()

    this.child = spawn(cmd, args, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(bin)
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
      const match = line.match(READY_LINE_RE)
      if (match && !this.url) {
        this.url = match[1]
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
    if (!this._stopping) {
      this.emit('exit', { code, signal, wasReady })
    }
  }

  async stop() {
    this._stopping = true
    const child = this.child
    if (!child) return

    child.kill('SIGINT')
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

module.exports = { DshBackend, resolveDshBin, resolveNodeCommand, READY_LINE_RE }
