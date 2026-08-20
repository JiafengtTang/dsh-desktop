'use strict'

const { app, BrowserWindow, Menu, shell, dialog, globalShortcut, Notification, ipcMain } = require('electron')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const { Settings } = require('./settings')
const { DshBackend } = require('./backend')
const { RemoteBackend, testRemoteConnection, listRemoteDirectory, ensureWorkspace, listWorkspaces, syncRemotePlugins, restartRemoteDsh, installRemotePlugin } = require('./remoteBackend')
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
  let updateInProgress = false
  let lastPluginWarning = null

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

  function sendUpdateProgress(payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('dsh:update-progress', payload)
    }
  }

  function latestDshVersion() {
    try {
      const result = require('node:child_process').spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['view', '@deepseek-ai/dsh', 'dist-tags', '--json'],
        { encoding: 'utf8', timeout: 20000 }
      )
      if (result.status === 0 && result.stdout) {
        const tags = JSON.parse(result.stdout)
        // dsh publishes new release candidates under the "next" tag; prefer it
        // so the app follows the newest rc (e.g. rc.8) instead of stale latest.
        return (tags && (tags.next || tags.latest)) || null
      }
    } catch {
      /* fall through */
    }
    return null
  }

  function localDshVersion() {
    try {
      return require('@deepseek-ai/dsh/package.json').version
    } catch {
      return null
    }
  }

  // Version of the dsh package that npx actually fetched for this machine.
  function runningDshVersion() {
    try {
      const npxRoot = path.join(os.homedir(), '.npm', '_npx')
      const dirs = fs.readdirSync(npxRoot)
      let best = null
      for (const dir of dirs) {
        try {
          const pkgFile = path.join(npxRoot, dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
          if (pkg.version && (!best || String(pkg.version) > String(best))) best = pkg.version
        } catch {
          /* not this npx cache dir */
        }
      }
      return best
    } catch {
      return null
    }
  }

  function usesLatestCommand(profile) {
    const cmd = String((profile && profile.dshCommand) || '').trim()
    return cmd === '' || /@deepseek-ai\/dsh@next/.test(cmd)
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
    const warning = instance.pluginLoadWarning || null
    sendStatus({ state: 'ready', url, mode: instance.label, warning })
    if (warning && warning !== lastPluginWarning) {
      lastPluginWarning = warning
      notify('部分插件无法加载', '已自动忽略，不影响使用：' + warning + '\n如持续出现，可在设置-连接管理里卸载该插件。')
    }
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
    instance.on('log', ({ line }) => {
      if (!updateInProgress) return
      const s = String(line || '').trim()
      if (s) sendUpdateProgress({ phase: 'restarting', message: s.slice(0, 140) })
    })
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
  ipcMain.handle('connections:restartRemote', async (_event, name) => {
    const profile = connections.get(name)
    if (!profile) return { ok: false, error: '未找到该连接' }
    try {
      const result = await restartRemoteDsh(profile)
      if (!result.ok) return { ok: false, error: result.output || '远程 dsh 未能停止' }
      if (name === connectionKey()) restartBackend()
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('connections:installPluginRemote', async (_event, name, spec) => {
    const profile = connections.get(name)
    if (!profile) return { ok: false, error: '未找到该连接' }
    try {
      const result = await installRemotePlugin(profile, spec)
      if (!result.ok) return { ok: false, error: result.output || '安装失败' }
      return { ok: true, output: result.output }
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })

  // ---- IPC: dsh version / updates ----
  ipcMain.handle('dsh:checkUpdate', () => {
    const latest = latestDshVersion()
    const local = localDshVersion()
    const running = runningDshVersion()
    const localCommand = (settings.get('dshCommand', '') || '').trim()
    // Local is "auto" when it follows @next or runs a pinned runtime install
    // (~/.dsh/runtime) — both are already the newest version we installed.
    const localAuto = localCommand === ''
        || /@deepseek-ai\/dsh@next/.test(localCommand)
        || localCommand.includes('/.dsh/runtime/')
    // Only connections still pinned to the old @latest tag are considered
    // stale; fixed-path installs (npx cache / runtime) are intentionally stable.
    const pinned = connections.list()
        .filter((c) => /@deepseek-ai\/dsh@latest/.test(String((c && c.dshCommand) || '')))
        .map((c) => c.name)
    return {
      ok: true,
      latest,
      running,
      local: localAuto ? null : local,
      localAuto,
      pinned,
      needsUpdate: Boolean(latest) && pinned.length > 0
    }
  })

  ipcMain.handle('dsh:applyUpdate', async () => {
    updateInProgress = true
    sendUpdateProgress({ phase: 'checking', message: '正在获取 dsh 最新版本…', percent: 5 })
    try {
      const latest = latestDshVersion()
      if (!latest) {
        sendUpdateProgress({ phase: 'failed', message: '无法获取最新版本，请检查网络后重试', percent: 0, error: 'npm registry 不可达' })
        return { ok: false, error: '无法获取最新版本，请检查网络后重试' }
      }
      // Pin every remote connection to the newest rc (@next).
      for (const c of connections.list()) {
        if (!usesLatestCommand(c)) {
          connections.update(c.name, { dshCommand: 'npx -y @deepseek-ai/dsh@next' })
        }
      }
      sendUpdateProgress({ phase: 'restarting', message: '已切换到最新版，正在重启远程 dsh…', percent: 30 })

      const key = connectionKey()
      const profile = key !== 'local' ? connections.get(key) : null
      let result = { ok: true }
      if (profile) {
        result = await restartRemoteDsh(profile, (chunk) => {
          const m = String(chunk).match(/dsh web: progress \d+ (\d+)\/300/)
          const pct = m ? 30 + Math.min(55, Math.round((Number(m[1]) / 300) * 55)) : 32
          sendUpdateProgress({ phase: 'restarting', message: '正在启动最新版 dsh（首次下载可能需要几分钟）…', percent: pct })
        })
        if (result.ok) {
          sendUpdateProgress({ phase: 'restarting', message: '远程实例已停止，正在重新连接…', percent: 90 })
          restartBackend()
        } else {
          sendUpdateProgress({
            phase: 'failed',
            message: '更新失败：' + (result.output || '远程 dsh 未能停止'),
            percent: 0,
            error: result.output || '未知错误'
          })
          return { ok: false, error: result.output || '更新失败' }
        }
      } else {
        // Local backend already launches via npx @next by default; restart it.
        sendUpdateProgress({ phase: 'restarting', message: '正在重启本地 dsh（最新版）…', percent: 60 })
        restartBackend()
      }
      sendUpdateProgress({ phase: 'ready', message: '已更新到 dsh v' + latest + '，连接就绪', percent: 100 })
      return { ok: true, latest }
    } catch (err) {
      sendUpdateProgress({ phase: 'failed', message: '更新失败：' + String(err.message || err), percent: 0, error: String(err.message || err) })
      return { ok: false, error: String(err.message || err) }
    } finally {
      updateInProgress = false
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
