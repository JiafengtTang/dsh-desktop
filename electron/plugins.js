'use strict'

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { resolveDshBin, pnpmShimDir } = require('./backend')

const PROFILE = 'web'

function resolveTool(name, candidates) {
  const isWin = process.platform === 'win32'
  const lookup = isWin
    ? spawnSync('where.exe', [name], { encoding: 'utf8' })
    : spawnSync('which', [name], { encoding: 'utf8' })
  if (lookup.status === 0 && lookup.stdout) {
    const lines = String(lookup.stdout).trim().split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && fs.existsSync(trimmed)) return trimmed
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  if (isWin) return null
  for (const shell of ['zsh', 'bash', 'sh']) {
    const result = spawnSync(shell, ['-lc', 'command -v ' + name + ' 2>/dev/null'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout && result.stdout.trim()) {
      const line = result.stdout.trim().split('\n')[0].trim()
      if (line && fs.existsSync(line)) return line
    }
  }
  return null
}

function toolPath() {
  const isWin = process.platform === 'win32'
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const node = resolveTool('node', isWin
    ? [path.join(programFiles, 'nodejs', 'node.exe'), path.join(programFilesX86, 'nodejs', 'node.exe')]
    : ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/opt/local/bin/node', '/usr/bin/node'])
  const pnpm = resolveTool('pnpm', isWin
    ? [path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd')]
    : ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm'])
  const npm = resolveTool('npm', isWin
    ? [path.join(programFiles, 'nodejs', 'npm.cmd'), path.join(programFilesX86, 'nodejs', 'npm.cmd')]
    : ['/usr/local/bin/npm', '/opt/homebrew/bin/npm', '/usr/bin/npm'])
  const git = resolveTool('git', isWin
    ? [path.join(programFiles, 'Git', 'cmd', 'git.exe')]
    : ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'])
  const extra = [node, pnpm, npm, git].filter(Boolean).map((p) => path.dirname(p))
  const PATH = extra.length
    ? [...new Set([...extra, ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)])].join(path.delimiter)
    : process.env.PATH
  return { node, pnpm, npm, git, PATH }
}

function profileDir(dshHome) {
  return path.join(dshHome, 'profiles', PROFILE)
}

function readProfileManifest(dshHome) {
  const manifest = path.join(profileDir(dshHome), 'package.json')
  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8'))
  } catch {
    return null
  }
}

function listPlugins(dshHome) {
  const pkg = readProfileManifest(dshHome) || {}
  const deps = (pkg.dependencies && typeof pkg.dependencies === 'object') ? pkg.dependencies : {}
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  const installed = Object.entries(deps).map(([name, spec]) => ({
    name,
    spec,
    bundle: bundles.includes(name)
  }))
  return { installed, bundles }
}

function normalizeSpec(input) {
  let s = String(input || '').trim()
  if (!s) return { kind: 'invalid' }
  s = s.replace(/^npm:/i, '')

  const github = /^(?:https?:\/\/github\.com\/|git@github\.com:|git\+https?:\/\/github\.com\/|github:)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/].*)?$/i.exec(s)
  if (github) return { kind: 'github', owner: github[1], repo: github[2] }

  if (!s.startsWith('@') && /^[\w.-]+\/[\w.-]+$/.test(s)) {
    const [owner, repo] = s.split('/')
    return { kind: 'github', owner, repo }
  }

  if (/^[a-zA-Z0-9@][a-zA-Z0-9._/@-]*$/.test(s)) return { kind: 'npm', name: s }
  return { kind: 'invalid' }
}

function npmPackageExists(name) {
  const url = 'https://registry.npmjs.org/' + encodeURIComponent(name)
  return fetch(url, { headers: { Accept: 'application/vnd.npm.install-v1+json' } })
    .then((res) => res.ok)
    .catch(() => false)
}

function searchGitHub(name) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(name) + '&per_page=8'
  return fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-desktop' }
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && Array.isArray(data.items) ? data.items : []))
    .then((items) => items.map((it) => ({
      name: it.name,
      fullName: it.full_name,
      description: it.description,
      htmlUrl: it.html_url
    })))
    .catch(() => [])
}

function allowBuildsApprovals(output) {
  const keys = []
  const gitMatch = /allowBuilds:\s*\n\s+(\S+):\s*true/.exec(String(output || ''))
  if (gitMatch) keys.push(gitMatch[1])
  const ignoredMatch = /Ignored build scripts:\s*([^\n]+)/i.exec(String(output || ''))
  if (ignoredMatch) {
    for (const item of ignoredMatch[1].split(',')) {
      const name = item.trim()
      if (name && /^[a-zA-Z0-9@._/-]+$/.test(name)) keys.push(name)
    }
  }
  return keys
}

function appendAllowBuilds(dshHome, key) {
  const wsPath = path.join(profileDir(dshHome), 'pnpm-workspace.yaml')
  let text = ''
  try {
    text = fs.readFileSync(wsPath, 'utf8')
  } catch {
    return false
  }
  if (text.includes(key + ':')) return true
  if (/^allowBuilds:/m.test(text)) {
    text = text.replace(/^allowBuilds:[^\n]*\n/m, (header) => header + '  ' + key + ': true\n')
  } else {
    text = text.replace(/\s+$/, '') + '\nallowBuilds:\n  ' + key + ': true\n'
  }
  try {
    fs.writeFileSync(wsPath, text)
    return true
  } catch {
    return false
  }
}

function run(cmd, args, opts = {}, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, timeoutMs)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { err += c.toString() })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, output: String(e.message || e) })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code || 0, output: (out + '\n' + err).trim() })
    })
  })
}

function runDshPlugin(dshBin, dshHome, verbArgs, log) {
  const env = { ...process.env, DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1' }
  const shimDir = pnpmShimDir()
  if (shimDir) env.PATH = shimDir + path.delimiter + (env.PATH || '')
  const cmd = process.execPath
  const args = ['--expose-internals', dshBin, 'plugin', '--profile', PROFILE, ...verbArgs]
  log('plugins: ' + args.join(' '))
  return run(cmd, args, { env }, 300000)
}

async function installFromNpm(dshBin, dshHome, name, log) {
  let result = await runDshPlugin(dshBin, dshHome, ['add', name], log)
  if (result.code === 0) return { ok: true, method: 'npm', output: result.output }

  const approvals = allowBuildsApprovals(result.output)
  if (approvals.length > 0 && approvals.every((key) => appendAllowBuilds(dshHome, key))) {
    log('plugins: approved pnpm builds (' + approvals.join(', ') + '), retrying …')
    result = await runDshPlugin(dshBin, dshHome, ['add', name], log)
  }
  if (result.code !== 0) return { ok: false, method: 'npm', error: result.output }
  return { ok: true, method: 'npm', output: result.output }
}

function hasBuiltOutput(dir, pkg) {
  const candidates = [pkg.main, pkg.module, pkg.types].filter(Boolean)
  const exp = pkg.exports && pkg.exports['.']
  const expTarget = typeof exp === 'string' ? exp : (exp && (exp.default || exp.import || exp.require))
  if (expTarget) candidates.push(expTarget)
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(dir, c))) return true
  }
  for (const d of ['lib', 'dist', 'build']) {
    const p = path.join(dir, d)
    try {
      if (fs.existsSync(p) && fs.readdirSync(p).length > 0) return true
    } catch {}
  }
  return false
}

async function installFromGitHub(dshBin, dshHome, owner, repo, log) {
  const tools = toolPath()
  if (!tools.git || !tools.pnpm || !tools.npm) {
    return { ok: false, error: '从 GitHub 安装需要 git、pnpm 和 npm，请先确认它们已安装。' }
  }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-'))
  try {
    const url = 'https://github.com/' + owner + '/' + repo + '.git'
    let result = await run(tools.git, ['clone', '--depth', '1', url, tmp], { env: { ...process.env, PATH: tools.PATH } }, 120000)
    if (result.code !== 0) return { ok: false, method: 'github:' + owner + '/' + repo, error: 'git clone 失败：' + result.output }

    let pkgJson = {}
    try { pkgJson = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')) } catch {}

    // pnpm 11 may still exit non-zero when a transitive devDependency (e.g.
    // koffi) has an unapproved native build script, even after the plugin's own
    // `prepare` build has already completed. Judge success by the presence of
    // built output instead of pnpm's exit code.
    result = await run(tools.pnpm, ['install'], { cwd: tmp, env: { ...process.env, PATH: tools.PATH } }, 300000)
    if (!hasBuiltOutput(tmp, pkgJson)) {
      const buildError = (result.code !== 0 && result.output) ? '安装构建依赖失败：' + result.output : '未生成构建产物。'
      if (!(pkgJson.scripts && pkgJson.scripts.build)) {
        return { ok: false, method: 'github:' + owner + '/' + repo, error: buildError }
      }
      result = await run(tools.pnpm, ['run', 'build'], { cwd: tmp, env: { ...process.env, PATH: tools.PATH } }, 300000)
      if (!hasBuiltOutput(tmp, pkgJson)) {
        return { ok: false, method: 'github:' + owner + '/' + repo, error: '构建失败：' + (result.output || buildError) }
      }
    }

    result = await run(tools.npm, ['pack', '--ignore-scripts', '--pack-destination', tmp], { cwd: tmp, env: { ...process.env, PATH: tools.PATH } }, 120000)
    if (result.code !== 0) return { ok: false, method: 'github:' + owner + '/' + repo, error: '打包失败：' + result.output }

    const tarball = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    if (!tarball) return { ok: false, method: 'github:' + owner + '/' + repo, error: '未找到打包产物。' }

    // Persist the tarball beside the profile so the recorded `file:` dependency
    // remains resolvable on future installs (temp dirs are removed below).
    const vendorDir = path.join(profileDir(dshHome), 'vendor')
    fs.mkdirSync(vendorDir, { recursive: true })
    const persistedTarball = path.join(vendorDir, tarball)
    fs.copyFileSync(path.join(tmp, tarball), persistedTarball)

    result = await runDshPlugin(dshBin, dshHome, ['add', 'file:' + persistedTarball], log)
    if (result.code !== 0) return { ok: false, method: 'github:' + owner + '/' + repo, error: '安装失败：' + result.output }
    return { ok: true, method: 'github:' + owner + '/' + repo, output: result.output }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
}

async function installPlugin(dshHome, spec, log) {
  const normalized = normalizeSpec(spec)
  if (normalized.kind === 'invalid') {
    return { ok: false, error: '请输入有效的插件名、GitHub 地址或 owner/repo。' }
  }

  const dshBin = resolveDshBin()
  if (!dshBin) return { ok: false, error: '未找到 dsh 运行时，请先安装依赖。' }

  if (normalized.kind === 'github') {
    const r = await installFromGitHub(dshBin, dshHome, normalized.owner, normalized.repo, log)
    return r.ok ? { ...r, installed: listPlugins(dshHome).installed } : r
  }

  const onNpm = await npmPackageExists(normalized.name)
  if (onNpm) {
    const r = await installFromNpm(dshBin, dshHome, normalized.name, log)
    return r.ok ? { ...r, installed: listPlugins(dshHome).installed } : r
  }

  const repos = await searchGitHub(normalized.name)
  const exact = repos.find((r) => (
    r.name.toLowerCase() === normalized.name.toLowerCase() ||
    r.fullName.toLowerCase() === normalized.name.toLowerCase()
  ))
  if (exact) {
    const [ghOwner, ghRepo] = exact.fullName.split('/')
    const r = await installFromGitHub(dshBin, dshHome, ghOwner, ghRepo, log)
    return r.ok ? { ...r, installed: listPlugins(dshHome).installed } : r
  }

  if (repos.length > 0) {
    return {
      ok: false,
      error: 'npm 上没有这个包，GitHub 也没有同名仓库。你可以直接粘贴 GitHub 地址，或从下面的候选中选择：',
      suggestions: repos
    }
  }
  return { ok: false, error: 'npm 和 GitHub 都没有找到匹配结果，请检查名称或直接粘贴 GitHub 地址。' }
}

async function removePlugin(dshHome, name, log) {
  const safe = String(name || '').trim()
  if (!safe || /^[a-zA-Z0-9@._/-]+$/.test(safe) === false) return { ok: false, error: '无效的插件名。' }
  const dshBin = resolveDshBin()
  if (!dshBin) return { ok: false, error: '未找到 dsh 运行时。' }
  const result = await runDshPlugin(dshBin, dshHome, ['remove', safe], log)
  if (result.code !== 0) return { ok: false, error: result.output }
  return { ok: true, output: result.output, installed: listPlugins(dshHome).installed }
}

module.exports = {
  listPlugins,
  installPlugin,
  removePlugin,
  normalizeSpec
}
