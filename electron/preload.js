'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  openConnections: () => ipcRenderer.invoke('desktop:open-connections'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  ssh: {
    hosts: () => ipcRenderer.invoke('ssh:hosts')
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    add: (profile) => ipcRenderer.invoke('connections:add', profile),
    update: (name, patch) => ipcRenderer.invoke('connections:update', name, patch),
    remove: (name) => ipcRenderer.invoke('connections:remove', name),
    activate: (name) => ipcRenderer.invoke('connections:activate', name),
    test: (profile) => ipcRenderer.invoke('connections:test', profile),
    browse: (profile, dir) => ipcRenderer.invoke('connections:browse', profile, dir),
    setWorkspace: (path) => ipcRenderer.invoke('connections:setWorkspace', path)
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('backend:status', listener)
    return () => ipcRenderer.removeListener('backend:status', listener)
  }
})
