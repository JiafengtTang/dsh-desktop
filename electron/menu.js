'use strict'

const { Menu, app } = require('electron')

function buildMenu(handlers) {
  const isMac = process.platform === 'darwin'
  const template = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: handlers.onOpenSettings },
        { label: 'Connections…', accelerator: 'Cmd+Shift+C', click: handlers.onOpenConnections },
        { label: 'Plugins…', accelerator: 'Cmd+Shift+P', click: handlers.onOpenPlugins },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      ...(isMac ? [] : [
        { label: 'Settings…', click: handlers.onOpenSettings },
        { label: 'Connections…', click: handlers.onOpenConnections },
        { label: 'Plugins…', click: handlers.onOpenPlugins },
        { type: 'separator' }
      ]),
      { label: 'New Window', accelerator: 'Cmd+N', click: handlers.onNewWindow },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [{ type: 'separator' }, { role: 'front' }]
        : [{ role: 'close' }])
    ]
  })

  template.push({
    label: 'Help',
    submenu: [
      { label: 'Open in Browser', click: handlers.onOpenInBrowser },
      { type: 'separator' },
      { label: 'Open Backend Logs', click: handlers.onOpenLogs },
      { label: 'Reveal Data Folder', click: handlers.onOpenDataDir }
    ]
  })

  return Menu.buildFromTemplate(template)
}

module.exports = { buildMenu }
