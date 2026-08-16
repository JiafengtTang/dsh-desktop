'use strict'

const { spawn } = require('node:child_process')
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

// Resolve a Node runtime. Order of preference:
//   1. DSH_DESKTOP_NODE (explicit override)
//   2. Electron itself, run as Node via ELECTRON_RUN_AS_NODE, with
//      --expose-internals so dsh's HMR loader can reach Node internals without
//      the node-addon-require-builtin native addon (ABI-mismatched under Electron).
function resolveNodeCommand(scriptPath, args) {
  const override = process.env.DSH_DESKTOP_NODE
  if (override) {
    return { cmd: override, args: [scriptPath, ...args], env: {} }
  }
  // Electron's bundled Node is always present and version-matched to the
  // packaged dependencies and rebuilt native modules, so it is the reliable
  // default on both macOS and Windows (no separate Node install required).
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
