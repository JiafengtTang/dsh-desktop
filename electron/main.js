'use strict'

const { app, BrowserWindow, Menu, shell, dialog, globalShortcut, Notification, ipcMain } = require('electron')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const { Settings } = require('./settings')
const { DshBackend } = require('./backend')
const { RemoteBackend, testRemoteConnection, listRemoteDirectory, ensureWorkspace, listWorkspaces, syncRemotePlugins } = require('./remoteBackend')
const { ConnectionStore } = require('./connections')
const { buildMenu } = require('./menu')
const { createTray } = require('./tray')
const { listSshConfigHosts } = require('./sshconfig')
const { bootstrapWebUi, bootstrapBilling, bootstrapFileMount } = require('./bootstrap')
const { checkForUpdates } = require('./updater')
const { listPlugins, installPlugin, removePlugin } = require('./plugins')

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
  const backends = new Map()
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

  function connectionKey() {
    return connections.active()
  }

  function onBackendReady(instance, url) {
    console.log('[dsh-desktop] backend ready:', instance.label, url)
    if (instance !== backend) return
    loadAll(url, false)
    sendStatus({ state: 'ready', url, mode: instance.label })
    notify('DeepSeek Harness is ready', (instance.label ? instance.label + ' · ' : '') + url)
  }

  function onBackendExit(instance, info) {
    const wasActive = instance === backend
    if (wasActive) backend = null
    backends.delete(instance.connectionKey)
    console.warn('[dsh-desktop] backend exited:', instance.label, info)
    if (!wasActive) {
      if (!quitting) notify('后台连接已停止', (instance.label || 'Backend') + ' 已在后台停止。')
      return
    }
    sendStatus({ state: 'exited', mode: instance.label, ...info })
    if (!quitting && settings.get('autoRestart', true) && info.wasReady) {
      notify('DeepSeek Harness stopped unexpectedly', 'Restarting the backend…')
      setTimeout(() => startBackend(connectionKey()), 800)
    }
  }

  function onBackendError(instance, err) {
    const message = (err && err.message) || String(err)
    console.error('[dsh-desktop] backend error:', err)
    if (instance !== backend) return
    sendStatus({ state: 'error', mode: instance.label, message })
    dialog.showErrorBox('DeepSeek Harness backend error', message)
  }

  function createBackend(key) {
    let instance
    if (key === 'local') {
      instance = new DshBackend({ settings, logPath })
      instance.label = 'Local'
    } else {
      const profile = connections.get(key)
      if (!profile) {
        instance = new DshBackend({ settings, logPath })
        instance.label = 'Local'
      } else {
        const localDshHome = settings.get('dshHome') || path.join(os.homedir(), '.dsh')
        instance = new RemoteBackend({ profile, logPath, localDshHome })
        instance.label = profile.name
      }
    }
    return instance
  }

  function attachBackend(instance, key) {
    instance.connectionKey = key
    instance.on('ready', (url) => onBackendReady(instance, url))
    instance.on('exit', (info) => onBackendExit(instance, info))
    instance.on('error', (err) => onBackendError(instance, err))
    backends.set(key, instance)
  }

  function activateBackend(key) {
    const instance = backends.get(key) || null
    backend = instance
    if (instance && instance.url) {
      loadAll(instance.url, false)
      sendStatus({ state: 'ready', url: instance.url, mode: instance.label })
    } else {
      loadAll(loadingFile, true)
    }
  }

  function startBackend(key) {
    const targetKey = key == null ? connectionKey() : key
    let instance = backends.get(targetKey)
    if (!instance) {
      instance = createBackend(targetKey)
      attachBackend(instance, targetKey)
    }
    activateBackend(targetKey)
    if (!instance.running) {
      sendStatus({ state: 'starting', mode: instance.label })
      const started = instance.start()
      if (started && typeof started.then === 'function') started.catch((err) => onBackendError(instance, err))
    }
  }

  function restartBackend() {
    const key = connectionKey()
    const instance = backends.get(key)
    if (!instance) {
      startBackend(key)
      return
    }
    backends.delete(key)
    if (backend === instance) backend = null
    instance.removeAllListeners()
    instance.stop().finally(() => startBackend(key))
  }

  function switchConnection(name) {
    connections.setActive(name)
    loadAll(loadingFile, true)
    startBackend(name)
  }

  function buildAppMenu() {
    Menu.setApplicationMenu(buildMenu({
      onNewWindow: () => createMainWindow(),
      onShow: showWindow,
      onOpenSettings: openSettings,
      onOpenConnections: () => createPrefsWindow(),
      onOpenPlugins: () => createPrefsWindow(),
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
    connectionsFile,
    logPath
  }))
  ipcMain.handle('desktop:open-logs', () => {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      shell.openPath(logPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })
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
  ipcMain.handle('connections:syncPlugins', async (_event, profile) => {
    try {
      const dshHome = settings.get('dshHome', '') || path.join(os.homedir(), '.dsh')
      return await syncRemotePlugins(profile, dshHome)
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

  // ---- IPC: workspaces (merged local + remote) ----
  ipcMain.handle('workspaces:list', async () => {
    const order = ['local', ...connections.list().map((c) => c.name)]
    const groups = await Promise.all(order.map(async (key) => {
      const instance = backends.get(key)
      if (!instance || !instance.running || !instance.url) return null
      const kind = key === 'local' ? 'local' : 'remote'
      const label = key === 'local' ? '本机' : (instance.label || key)
      const group = { key, label, kind, items: [], error: null }
      try {
        const result = await listWorkspaces(instance.url)
        group.items = result.items.map((it) => ({
          workspaceId: it.workspaceId,
          path: it.path,
          title: it.title
        }))
      } catch (err) {
        group.error = String((err && err.message) || err)
      }
      return group
    }))
    return { ok: true, active: connections.active(), groups: groups.filter(Boolean) }
  })

  // ---- IPC: plugins ----
  const pluginLog = (msg) => console.log('[dsh-desktop][plugins]', msg)
  const currentDshHome = () => settings.get('dshHome', '') || path.join(os.homedir(), '.dsh')
  ipcMain.handle('plugins:list', () => listPlugins(currentDshHome()))
  ipcMain.handle('plugins:install', async (_event, spec) => {
    try {
      return await installPlugin(currentDshHome(), spec, pluginLog)
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('plugins:remove', async (_event, name) => {
    try {
      return await removePlugin(currentDshHome(), name, pluginLog)
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
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

    const bootstrapLogPath = path.join(userData, 'logs', 'bootstrap.log')
    const log = (msg) => {
      const line = '[dsh-desktop][bootstrap] ' + msg
      console.log(line)
      try {
        fs.mkdirSync(path.dirname(bootstrapLogPath), { recursive: true })
        fs.appendFileSync(bootstrapLogPath, line + '\n')
      } catch {}
    }
    const dshHome = settings.get('dshHome') || path.join(os.homedir(), '.dsh')
    checkForUpdates({
      currentVersion: app.getVersion(),
      silent: true,
      log: (msg) => console.log('[dsh-desktop][updater]', msg),
    }).catch((err) => console.warn('[dsh-desktop][updater]', err.message || err))
    const bootstrap = (async () => {
      if (settings.get('integrateWebUi', true)) {
        await bootstrapWebUi({ dshHome, log }).catch((err) => { log('web-ui failed: ' + (err.message || err)); return {} })
      }
      await bootstrapBilling({ dshHome, log }).catch((err) => { log('billing failed: ' + (err.message || err)); return {} })
      await bootstrapFileMount({ dshHome, log }).catch((err) => { log('file-mount failed: ' + (err.message || err)); return {} })
    })()
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
    if (backendStopped) return
    const running = [...backends.values()].filter((b) => b && b.running)
    if (running.length === 0) return
    event.preventDefault()
    Promise.allSettled(running.map((b) => b.stop())).then(() => {
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
