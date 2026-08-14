'use strict'

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { resolveDshBin } = require('./backend')

const WEB_UI_ALL = '@linxin666/dsh-web-ui-all@0.1.10'
const MANAGED_START = '# --- dsh-skin managed (auto-generated; do not edit) ---'
const MANAGED_END = '# --- end dsh-skin managed ---'

// Skin ids shipped by dsh-web-ui (blue-fantasy is the one we enable).
const SKIN_IDS = ['dragon-heir', 'miku', 'minecraft', 'qq98', 'ths', 'trading', 'whale-song', 'xp']
const ACTIVE_SKIN = 'blue-fantasy'

function resolveOnPath(name) {
  const which = spawnSync('which', [name], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout && which.stdout.trim()) return which.stdout.trim()
  return null
}

// Write the Blue Fantasy skin into ~/.dsh/cordis.patch.yml (idempotent).
function applyBlueFantasySkin(dshHome) {
  const patchPath = path.join(dshHome, 'cordis.patch.yml')
  const lines = [MANAGED_START]
  for (const id of SKIN_IDS) {
    lines.push('- id: ui-skin-' + id, '  disabled: true')
  }
  lines.push(
    '- insert:',
    '    - id: ui-skin-' + ACTIVE_SKIN,
    "      name: '@linxin666/dsh-client-ui-skin-" + ACTIVE_SKIN + "'",
    MANAGED_END,
  )
  const managed = lines.join('\n')

  let text = ''
  try { text = fs.readFileSync(patchPath, 'utf8') } catch { /* first run */ }
  const start = text.indexOf(MANAGED_START)
  const end = text.indexOf(MANAGED_END)
  if (start !== -1 && end !== -1) {
    text = text.slice(0, start) + text.slice(end + MANAGED_END.length)
  }
  text = text.replace(/\s+$/, '')
  fs.mkdirSync(path.dirname(patchPath), { recursive: true })
  fs.writeFileSync(patchPath, text ? text + '\n\n' + managed + '\n' : managed + '\n')
  return patchPath
}

// Whether the dsh-web-ui aggregate is already resolvable from the web profile.
function isWebUiInstalled(dshHome) {
  const manifest = path.join(dshHome, 'profiles', 'web', 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    return bundles.includes('@linxin666/dsh-web-ui-all')
  } catch {
    return false
  }
}

// Run `dsh plugin --profile web add <pkg>` with pnpm + node on PATH.
function runPluginAdd(dshBin, dshHome, log) {
  return new Promise((resolve) => {
    const node = resolveOnPath('node')
    const pnpm = resolveOnPath('pnpm')
    const env = { ...process.env, DSH_HOME: dshHome }
    if (pnpm) env.PATH = path.dirname(pnpm) + path.delimiter + (env.PATH || '')
    if (node) env.PATH = path.dirname(node) + path.delimiter + env.PATH

    const cmd = node || process.execPath
    const args = node ? [dshBin] : ['--expose-internals', dshBin]
    args.push('plugin', '--profile', 'web', 'add', WEB_UI_ALL)

    const child = spawn(cmd, args, { env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 180000)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { err += c.toString() })
    child.on('error', (e) => {
      clearTimeout(timer)
      log('dsh plugin add error: ' + (e.message || e))
      resolve(-1)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (out) log('dsh plugin add: ' + out.trim().split('\n').slice(-2).join(' '))
      if (err && code !== 0) log('dsh plugin add stderr: ' + err.trim().slice(-200))
      resolve(code || 0)
    })
  })
}

// Approve pnpm build scripts for the native deps dsh-web-ui needs. pnpm 10+
// otherwise blocks them and makes `dsh plugin add` exit non-zero.
function ensureAllowBuilds(dshHome) {
  const wsPath = path.join(dshHome, 'profiles', 'web', 'pnpm-workspace.yaml')
  let text = ''
  try { text = fs.readFileSync(wsPath, 'utf8') } catch { return }
  text = text.replace(/:\s*set this to true or false/g, ': true')
  if (!/^allowBuilds:/m.test(text)) {
    text = text.replace(/\s+$/, '')
    text += '\nallowBuilds:\n  cloudflared: true\n  cpu-features: true\n  ssh2: true\n'
  }
  fs.writeFileSync(wsPath, text)
}

// Install the aggregate plugin, approving native build scripts as needed.
async function installWebUiAll(dshBin, dshHome, log) {
  await runPluginAdd(dshBin, dshHome, log)
  ensureAllowBuilds(dshHome)
  if (!isWebUiInstalled(dshHome)) {
    log('bootstrap: approving build scripts and retrying …')
    await runPluginAdd(dshBin, dshHome, log)
  }
  return isWebUiInstalled(dshHome)
}

// Integrate dsh-web-ui into the desktop experience: apply the Blue Fantasy
// skin, then install the aggregate plugin if it is not present yet.
async function bootstrapWebUi({ dshHome, log }) {
  const dshBin = resolveDshBin()
  if (!dshBin) {
    log('bootstrap: dsh bin not found; skipping plugin install')
    return { skinApplied: false, pluginInstalled: false }
  }
  let skinApplied = false
  try {
    applyBlueFantasySkin(dshHome)
    skinApplied = true
  } catch (err) {
    log('bootstrap: skin apply failed: ' + (err.message || err))
  }

  let pluginInstalled = true
  if (isWebUiInstalled(dshHome)) {
    log('bootstrap: dsh-web-ui already installed')
  } else {
    log('bootstrap: installing ' + WEB_UI_ALL + ' …')
    pluginInstalled = await installWebUiAll(dshBin, dshHome, log)
  }
  return { skinApplied, pluginInstalled }
}

module.exports = { bootstrapWebUi, applyBlueFantasySkin, isWebUiInstalled }
