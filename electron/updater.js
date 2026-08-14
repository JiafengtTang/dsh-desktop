'use strict'

const { app, Notification, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const REPO = 'JiafengtTang/dsh-desktop'
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'dsh-desktop-updater',
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub API HTTP ${res.statusCode}`))
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API timeout')))
  })
}

function numericVersion(version) {
  return String(version).replace(/^v/i, '').split('.').map((part) => {
    const match = /^(\d+)/.exec(part)
    return match ? Number(match[1]) : 0
  })
}

function isNewer(a, b) {
  const av = numericVersion(a)
  const bv = numericVersion(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i++) {
    const x = av[i] || 0
    const y = bv[i] || 0
    if (x !== y) return x > y
  }
  return false
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['-L', '--fail', '--silent', '--show-error', url, '-o', dest], {
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`curl exited with ${code}`))
    })
  })
}

function readState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(stateFile, state) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  } catch {}
}

// Check GitHub for a newer macOS DMG and, when one is available, download it
// and open it so the user can replace the app. Unsigned apps cannot silently
// replace themselves on macOS (Squirrel.Mac requires a Developer ID signature).
async function checkForUpdates({ currentVersion, silent = true, log = () => {} }) {
  let latest
  try {
    latest = await getJson(RELEASES_URL)
  } catch (err) {
    log('updater: release check failed: ' + (err.message || err))
    return { ok: false, error: String(err.message || err) }
  }

  const tag = String(latest.tag_name || '')
  const latestVersion = tag.replace(/^v/i, '')
  if (!latestVersion || !isNewer(latestVersion, currentVersion)) {
    if (!silent) {
      Notification.isSupported() && new Notification({
        title: 'DSH Desktop',
        body: '已经是最新版本。',
      }).show()
    }
    return { ok: true, upToDate: true, latest: latestVersion }
  }

  const asset = latest.assets && latest.assets.find((item) => /\.dmg$/i.test(item.name))
    || latest.assets && latest.assets.find((item) => /arm64.*\.zip$/i.test(item.name))
  if (!asset || !asset.browser_download_url) {
    log('updater: no downloadable asset in latest release')
    return { ok: false, error: 'No downloadable asset in latest release' }
  }

  const stateFile = path.join(app.getPath('userData'), 'update.json')
  const state = readState(stateFile)
  if (silent && state.lastSeen === tag) {
    return { ok: true, upToDate: false, latest: latestVersion, skipped: true }
  }

  const dest = path.join(app.getPath('downloads'), asset.name)
  try {
    await download(asset.browser_download_url, dest)
  } catch (err) {
    log('updater: download failed: ' + (err.message || err))
    return { ok: false, error: String(err.message || err) }
  }

  writeState(stateFile, { lastSeen: tag, downloadedAt: new Date().toISOString() })
  if (Notification.isSupported()) {
    new Notification({
      title: 'DSH Desktop 更新',
      body: `已下载 ${latestVersion}，正在打开安装包。`,
    }).show()
  }
  shell.openPath(dest)
  return { ok: true, upToDate: false, latest: latestVersion, file: dest }
}

module.exports = { checkForUpdates }
