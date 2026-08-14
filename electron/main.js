'use strict'

const { app, BrowserWindow, Menu, shell, dialog, globalShortcut, Notification, ipcMain } = require('electron')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const { Settings } = require('./settings')
const { DshBackend } = require('./backend')
const { RemoteBackend, testRemoteConnection, listRemoteDirectory, ensureWorkspace } = require('./remoteBackend')
const { ConnectionStore } = require('./connections')
const { buildMenu } = require('./menu')
const { createTray } = require('./tray')
const { listSshConfigHosts } = require('./sshconfig')
const { bootstrapWebUi, bootstrapBilling } = require('./bootstrap')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  main()
}

function main() {
  let mainWindow = null
  let prefsWindow = null
  let tray = null
  let backend = null
  let settings = null
  let connections = null
  let quitting = false
  let backendStopped = false

  const userData = app.getPath('userData')
  const settingsFile = path.join(userData, 'settings.json')
  const connectionsFile = path.join(userData, 'connections.json')
  const logPath = path.join(userData, 'logs', 'backend.log')
  const loadingFile = path.join(__dirname, '..', 'renderer', 'loading.html')
  const prefsFile = path.join(__dirname, '..', 'renderer', 'preferences.html')
  const trayIconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png')

  function sendStatus(status) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('backend:status', status)
    }
  }

  function loadAll(urlOrFile, isFile) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (isFile) win.loadFile(urlOrFile)
      else win.loadURL(urlOrFile)
    }
  }

  function showWindow() {
    if (!mainWindow) {
      createMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  function createMainWindow() {
    const bounds = settings.get('windowBounds', null)
    const win = new BrowserWindow({
      width: bounds && bounds.width ? bounds.width : 1280,
      height: bounds && bounds.height ? bounds.height : 860,
      x: bounds && typeof bounds.x === 'number' ? bounds.x : undefined,
      y: bounds && typeof bounds.y === 'number' ? bounds.y : undefined,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: 'DeepSeek Harness',
      backgroundColor: '#0b0f14',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    win.once('ready-to-show', () => win.show())
    win.on('close', () => {
      if (!win.isDestroyed()) {
        try { settings.set('windowBounds', win.getBounds()) } catch {}
      }
    })
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL()
      if (url && url.startsWith('http://127.0.0.1:')) {
        injectConnectionsUI(win)
      }
    })

    if (backend && backend.url) win.loadURL(backend.url)
    else win.loadFile(loadingFile)

    if (mainWindow === null) mainWindow = win
    return win
  }

  function createPrefsWindow() {
    if (prefsWindow && !prefsWindow.isDestroyed()) {
      prefsWindow.show()
      prefsWindow.focus()
      return prefsWindow
    }
    const win = new BrowserWindow({
      width: 760,
      height: 680,
      minWidth: 620,
      minHeight: 520,
      show: false,
      title: 'Connections — DeepSeek Harness',
      backgroundColor: '#0b0f14',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => { prefsWindow = null })
    win.loadFile(prefsFile)
    prefsWindow = win
    return win
  }

  function injectConnectionsUI(win) {
    if (!win || win.isDestroyed()) return
    try {
      const code = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'inject.js'), 'utf8')
      win.webContents.executeJavaScript(code).catch(() => {})
    } catch (err) {
      console.warn('[dsh-desktop] failed to inject connections UI:', err)
    }
  }

  function openSettings() {
    try {
      fs.mkdirSync(userData, { recursive: true })
      if (!fs.existsSync(settingsFile)) {
        fs.writeFileSync(settingsFile, JSON.stringify(settings.all, null, 2))
      }
      shell.openPath(settingsFile)
    } catch (err) {
      dialog.showErrorBox('Settings', String(err))
    }
  }

  function notify(title, body) {
    if (!settings.get('notifications', true)) return
    if (!Notification.isSupported()) return
    try {
      new Notification({ title, body }).show()
    } catch {}
  }

  function onBackendReady(url) {
    console.log('[dsh-desktop] backend ready:', backend && backend.label, url)
    loadAll(url, false)
    sendStatus({ state: 'ready', url, mode: backend && backend.label })
    notify('DeepSeek Harness is ready', (backend && backend.label ? backend.label + ' · ' : '') + url)

  }

  function onBackendExit(info) {
    console.warn('[dsh-desktop] backend exited:', backend && backend.label, info)
    sendStatus({ state: 'exited', mode: backend && backend.label, ...info })
    if (!quitting && settings.get('autoRestart', true) && info.wasReady) {
      notify('DeepSeek Harness stopped unexpectedly', 'Restarting the backend…')
      setTimeout(() => {
        backend = null
        startBackend()
      }, 800)
    }
  }

  function onBackendError(err) {
    const message = (err && err.message) || String(err)
    console.error('[dsh-desktop] backend error:', err)
    sendStatus({ state: 'error', mode: backend && backend.label, message })
    dialog.showErrorBox('DeepSeek Harness backend error', message)
  }

  function startBackend() {
    if (backend) return
    const active = connections.active()
    let instance
    if (active === 'local') {
      instance = new DshBackend({ settings, logPath })
      instance.label = 'Local'
    } else {
      const profile = connections.get(active)
      if (!profile) {
        instance = new DshBackend({ settings, logPath })
        instance.label = 'Local'
      } else {
        instance = new RemoteBackend({ profile, logPath })
        instance.label = profile.name
      }
    }

    backend = instance
    backend.on('ready', onBackendReady)
    backend.on('exit', onBackendExit)
    backend.on('error', onBackendError)
    sendStatus({ state: 'starting', mode: backend.label })

    const started = backend.start()
    if (started && typeof started.then === 'function') started.catch((err) => onBackendError(err))
  }

  function restartBackend() {
    const current = backend
    if (current) {
      current.stop().finally(() => {
        backend = null
        startBackend()
      })
    } else {
      startBackend()
    }
  }

  function switchConnection(name) {
    connections.setActive(name)
    loadAll(loadingFile, true)
    restartBackend()
  }

  function buildAppMenu() {
    Menu.setApplicationMenu(buildMenu({
      onNewWindow: () => createMainWindow(),
      onShow: showWindow,
      onOpenSettings: openSettings,
      onOpenConnections: () => createPrefsWindow(),
      onOpenLogs: () => {
        try {
          fs.mkdirSync(path.dirname(logPath), { recursive: true })
          shell.openPath(logPath)
        } catch {}
      },
      onOpenDataDir: () => shell.openPath(userData),
      onOpenInBrowser: () => {
        if (backend && backend.url) shell.openExternal(backend.url)
      }
    }))
  }

  function registerShortcut() {
    const accelerator = settings.get('shortcut', 'CommandOrControl+Shift+D')
    try {
      const ok = globalShortcut.register(accelerator, showWindow)
      if (!ok) console.warn('[dsh-desktop] shortcut registration failed:', accelerator)
    } catch (err) {
      console.warn('[dsh-desktop] shortcut registration failed:', err)
    }
  }

  function onQuit() {
    quitting = true
    globalShortcut.unregisterAll()
    app.quit()
  }

  // ---- IPC: desktop ----
  ipcMain.handle('desktop:info', () => ({
    version: app.getVersion(),
    url: backend ? backend.url : null,
    mode: backend ? backend.label : null,
    dshHome: settings.get('dshHome', '') || path.join(os.homedir(), '.dsh'),
    settingsFile,
    connectionsFile
  }))
  ipcMain.handle('desktop:restart', async () => {
    restartBackend()
    return true
  })
  ipcMain.handle('desktop:open-connections', () => {
    createPrefsWindow()
  })
  ipcMain.handle('desktop:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  // ---- IPC: connections ----
  ipcMain.handle('connections:list', () => ({
    active: connections.active(),
    connections: connections.list()
  }))
  ipcMain.handle('connections:add', (_event, profile) => {
    try {
      connections.add(profile)
      return { ok: true, active: connections.active(), connections: connections.list() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('connections:update', (_event, name, patch) => {
    try {
      connections.update(name, patch)
      return { ok: true, active: connections.active(), connections: connections.list() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('connections:remove', (_event, name) => {
    try {
      connections.remove(name)
      return { ok: true, active: connections.active(), connections: connections.list() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('connections:activate', (_event, name) => {
    try {
      switchConnection(name)
      return { ok: true, active: name }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('connections:test', async (_event, profile) => {
    try {
      return await testRemoteConnection(profile)
    } catch (err) {
      return { ok: false, output: String(err.message || err) }
    }
  })
  ipcMain.handle('connections:browse', async (_event, profile, dir) => {
    try {
      return await listRemoteDirectory(profile, dir)
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('connections:setWorkspace', async (_event, path) => {
    if (!backend || !backend.url) return { ok: false, error: '尚未连接' }
    try {
      return await ensureWorkspace(backend.url, path)
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('ssh:hosts', () => {
    return listSshConfigHosts()
  })

  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    settings = new Settings(settingsFile)
    connections = new ConnectionStore(connectionsFile)

    buildAppMenu()
    tray = createTray({
      iconPath: trayIconPath,
      onShow: showWindow,
      onNewWindow: () => createMainWindow(),
      onQuit
    })
    registerShortcut()
    createMainWindow()

    const log = (msg) => console.log('[dsh-desktop][bootstrap]', msg)
    const dshHome = settings.get('dshHome') || path.join(os.homedir(), '.dsh')
    const webUiBootstrap = settings.get('integrateWebUi', true)
      ? bootstrapWebUi({ dshHome, log }).catch((err) => { log('web-ui failed: ' + (err.message || err)); return {} })
      : Promise.resolve({})
    const billingBootstrap = bootstrapBilling({ dshHome, log }).catch((err) => { log('billing failed: ' + (err.message || err)); return {} })
    const bootstrap = Promise.all([webUiBootstrap, billingBootstrap])
    bootstrap.finally(() => startBackend())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') onQuit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showWindow()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', (event) => {
    globalShortcut.unregisterAll()
    if (backendStopped || !backend) return
    event.preventDefault()
    backend.stop().then(() => {
      backendStopped = true
      app.quit()
    }).catch(() => {
      backendStopped = true
      app.quit()
    })
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!quitting) {
        quitting = true
        app.quit()
      }
    })
  }
}
