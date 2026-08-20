'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  openConnections: () => ipcRenderer.invoke('desktop:open-connections'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  ssh: {
    hosts: () => ipcRenderer.invoke('ssh:hosts')
  },
  dsh: {
    checkUpdate: () => ipcRenderer.invoke('dsh:checkUpdate'),
    applyUpdate: () => ipcRenderer.invoke('dsh:applyUpdate'),
    onUpdateProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('dsh:update-progress', listener)
      return () => ipcRenderer.removeListener('dsh:update-progress', listener)
    }
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    add: (profile) => ipcRenderer.invoke('connections:add', profile),
    update: (name, patch) => ipcRenderer.invoke('connections:update', name, patch),
    remove: (name) => ipcRenderer.invoke('connections:remove', name),
    activate: (name) => ipcRenderer.invoke('connections:activate', name),
    test: (profile) => ipcRenderer.invoke('connections:test', profile),
    syncPlugins: (profile) => ipcRenderer.invoke('connections:syncPlugins', profile),
    browse: (profile, dir) => ipcRenderer.invoke('connections:browse', profile, dir),
    setWorkspace: (path) => ipcRenderer.invoke('connections:setWorkspace', path),
    restartRemote: (name) => ipcRenderer.invoke('connections:restartRemote', name),
    installPluginRemote: (name, spec) => ipcRenderer.invoke('connections:installPluginRemote', name, spec)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    install: (spec) => ipcRenderer.invoke('plugins:install', spec),
    remove: (name) => ipcRenderer.invoke('plugins:remove', name)
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list')
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('backend:status', listener)
    return () => ipcRenderer.removeListener('backend:status', listener)
  }
})
