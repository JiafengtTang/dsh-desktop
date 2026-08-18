'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
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

function resolveBundledPnpm() {
  try {
    const pkg = require.resolve('pnpm')
    return path.join(path.dirname(pkg), 'bin', 'pnpm.mjs')
  } catch {
    return null
  }
}

// Resolve a real system Node if one is installed (preferred for pnpm, which is a
// normal Node CLI and should not inherit Electron-specific quirks).
function resolveSystemNode() {
  const isWin = process.platform === 'win32'
  if (isWin) {
    const where = spawnSync('where.exe', ['node'], { encoding: 'utf8' })
    if (where.status === 0 && where.stdout) {
      const line = String(where.stdout).trim().split(/\r?\n/)[0].trim()
      if (line && fs.existsSync(line)) return line
    }
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe'
    ]
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate
    }
    return null
  }
  const which = spawnSync('which', ['node'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout && which.stdout.trim()) {
    const line = which.stdout.trim().split('\n')[0].trim()
    if (line && fs.existsSync(line)) return line
  }
  for (const candidate of ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/opt/local/bin/node', '/usr/bin/node']) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

let pnpmShimDirCache = null

function shellQuoteForSh(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

// Provide a `pnpm` executable on PATH that runs the bundled pnpm via Electron's
// Node. `dsh plugin` shells out to a plain `pnpm` command, so this removes the
// requirement that the user has pnpm installed on their machine.
function pnpmShimDir() {
  if (pnpmShimDirCache) return pnpmShimDirCache
  const pnpmMjs = resolveBundledPnpm()
  if (!pnpmMjs) return null

  const dir = path.join(os.tmpdir(), 'dsh-desktop-tools')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }

  const isWin = process.platform === 'win32'
  const systemNode = resolveSystemNode()
  if (isWin) {
    const shim = path.join(dir, 'pnpm.cmd')
    try {
      if (systemNode) {
        fs.writeFileSync(shim, '@echo off\r\n"' + systemNode + '" "' + pnpmMjs + '" %*\r\n')
      } else {
        fs.writeFileSync(shim, '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"' + process.execPath + '" "' + pnpmMjs + '" %*\r\n')
      }
    } catch {
      return null
    }
  } else {
    const shim = path.join(dir, 'pnpm')
    try {
      if (systemNode) {
        fs.writeFileSync(shim, '#!/bin/sh\nexec ' + shellQuoteForSh(systemNode) + ' ' + shellQuoteForSh(pnpmMjs) + ' "$@"\n')
      } else {
        fs.writeFileSync(shim, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + shellQuoteForSh(process.execPath) + ' ' + shellQuoteForSh(pnpmMjs) + ' "$@"\n')
      }
      fs.chmodSync(shim, 0o755)
    } catch {
      return null
    }
  }

  pnpmShimDirCache = dir
  return dir
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
    this.pluginLoadWarning = null
  }

  get running() {
    return this.child !== null && this.child.exitCode === null
  }

  start() {
    if (this.running) return

    const bin = resolveDshBin()
    const port = this.settings.get('port', 0)
    const host = this.settings.get('host', '127.0.0.1')
    const dshCommand = (this.settings.get('dshCommand', '') || '').trim()

    // Default to the newest dsh via npx (local machine behaves the same as
    // remote servers). A configured dshCommand overrides it; bundled dsh is
    // the fallback when npx is unavailable.
    let cmd = null
    let args = []
    let env = {}
    if (dshCommand) {
      const parts = dshCommand.split(/\s+/).filter(Boolean)
      cmd = parts.shift()
      args = parts
      args.push('web', '--port', String(port))
    } else {
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      const probe = spawnSync(npx, ['--version'], { encoding: 'utf8' })
      if (probe.status === 0 && probe.stdout) {
        cmd = npx
        args = ['-y', '@deepseek-ai/dsh@latest', 'web', '--port', String(port)]
      } else if (bin) {
        const resolved = resolveNodeCommand(bin, ['web', '--port', String(port)])
        cmd = resolved.cmd
        args = resolved.args
        env = resolved.env
      }
    }
    if (host && host !== '127.0.0.1') args.push('--host', host)
    if (!cmd) {
      this.emit('error', new Error('无法启动本地 dsh：未找到 npx，且内置 dsh 缺失。请安装 Node.js 或运行 npm install。'))
      return
    }

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
      if (!this.pluginLoadWarning
          && /Failed to load plugins|failed to import loader entry|bundle script .* failed to load/i.test(line)) {
        this.pluginLoadWarning = line.trim().slice(0, 220)
      }
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

module.exports = { DshBackend, resolveDshBin, resolveNodeCommand, pnpmShimDir, READY_LINE_RE }
