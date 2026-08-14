'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
  active: 'local',
  connections: []
}

class ConnectionStore {
  constructor(file) {
    this.file = file
    this.data = { active: DEFAULTS.active, connections: [] }
    this._load()
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = {
        // Always start on the local machine; never auto-connect to a remote
        // server just because it was the last one used.
        active: 'local',
        connections: Array.isArray(parsed.connections) ? parsed.connections : []
      }
    } catch {
      /* first run */
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch (err) {
      console.error('[dsh-desktop] failed to save connections:', err)
    }
  }

  list() {
    return [...this.data.connections]
  }

  get(name) {
    return this.data.connections.find((c) => c.name === name) || null
  }

  add(profile) {
    if (!profile || !profile.name) throw new Error('A connection name is required')
    if (this.get(profile.name)) throw new Error(`A connection named "${profile.name}" already exists`)
    this.data.connections.push({ ...profile })
    this._save()
    return this.get(profile.name)
  }

  update(name, patch) {
    const index = this.data.connections.findIndex((c) => c.name === name)
    if (index === -1) throw new Error(`Connection "${name}" not found`)
    const merged = { ...this.data.connections[index], ...patch }
    if (patch.name && patch.name !== name) {
      if (this.get(patch.name)) throw new Error(`A connection named "${patch.name}" already exists`)
      if (this.data.active === name) this.data.active = patch.name
    }
    this.data.connections[index] = merged
    this._save()
    return merged
  }

  remove(name) {
    const before = this.data.connections.length
    this.data.connections = this.data.connections.filter((c) => c.name !== name)
    if (this.data.connections.length === before) throw new Error(`Connection "${name}" not found`)
    if (this.data.active === name) this.data.active = 'local'
    this._save()
  }

  active() {
    if (this.data.active === 'local') return 'local'
    return this.get(this.data.active) ? this.data.active : 'local'
  }

  setActive(name) {
    if (name !== 'local' && !this.get(name)) throw new Error(`Connection "${name}" not found`)
    this.data.active = name
    this._save()
  }
}

module.exports = { ConnectionStore }
