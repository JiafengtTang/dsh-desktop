'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
  // 0 lets the OS pick a free port; pin a number if you want a stable URL.
  port: 0,
  host: '127.0.0.1',
  // Empty means "use dsh's default home" (~/.dsh), which shares sessions,
  // settings and workspaces with the CLI. Set a path to isolate the desktop app.
  dshHome: '',
  // Global shortcut to show/hide the window.
  shortcut: 'CommandOrControl+Shift+D',
  notifications: true,
  autoRestart: true,
  integrateWebUi: true,
  windowBounds: null
}

class Settings {
  constructor(file) {
    this.file = file
    this.data = { ...DEFAULTS }
    this._load()
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = { ...DEFAULTS, ...parsed }
    } catch {
      /* first run or unreadable file: keep defaults */
    }
  }

  get(key, fallback = undefined) {
    const value = this.data[key]
    return value === undefined || value === null ? fallback : value
  }

  set(key, value) {
    this.data[key] = value
    this._save()
  }

  merge(patch) {
    this.data = { ...this.data, ...patch }
    this._save()
  }

  get all() {
    return { ...this.data }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch (err) {
      console.error('[dsh-desktop] failed to save settings:', err)
    }
  }
}

module.exports = { Settings, DEFAULTS }
