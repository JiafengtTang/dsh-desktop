'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// A tolerant parser for ~/.ssh/config: one entry per `Host` block, resolved
// with HostName/User/Port/IdentityFile (case-insensitive keywords). Wildcards
// and Include are ignored — this is just for surfacing the user's own hosts.
function parseSshConfig(text) {
  const hosts = []
  let current = null
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z]+)\s+(.+)$/)
    if (!match) continue
    const keyword = match[1].toLowerCase()
    const value = match[2].trim().replace(/^"(.*)"$/, '$1')
    if (keyword === 'host') {
      const names = value.split(/\s+/).filter(Boolean)
      for (const name of names) {
        hosts.push({ name, host: '', user: '', port: 22, identityFile: '' })
      }
      current = hosts[hosts.length - 1]
    } else if (current !== null) {
      if (keyword === 'hostname') current.host = value
      else if (keyword === 'user') current.user = value
      else if (keyword === 'port') current.port = parseInt(value, 10) || 22
      else if (keyword === 'identityfile') current.identityFile = value
    }
  }
  return hosts.filter((h) => h.host)
}

// Read the user's SSH config and return host entries (with ~ expanded).
function listSshConfigHosts() {
  const file = path.join(os.homedir(), '.ssh', 'config')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return parseSshConfig(text).map((h) => ({
    ...h,
    identityFile: h.identityFile ? expandTilde(h.identityFile) : ''
  }))
}

function expandTilde(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

module.exports = { parseSshConfig, listSshConfigHosts }
