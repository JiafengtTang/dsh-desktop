;(function () {
  if (window.__dshMobileUi__) return
  window.__dshMobileUi__ = true

  // Polyfill crypto.randomUUID for older WebView versions used by the dsh UI.
  if (window.crypto && !window.crypto.randomUUID) {
    window.crypto.randomUUID = function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0
        var v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
      })
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  var css =
    '#dshd-host, #dshd-host * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif; }' +
    '#dshd-host { position: fixed; left: 0; right: 0; top: 0; z-index: 2147483000; display: flex; align-items: center; gap: 8px; padding: 12px 14px; padding-top: calc(12px + env(safe-area-inset-top)); background: rgba(245,247,250,0.96); border-bottom: 1px solid rgba(0,0,0,0.08); color: #111827; box-shadow: 0 1px 8px rgba(0,0,0,0.06); }' +
    '#dshd-dot { width: 9px; height: 9px; border-radius: 50%; background: #9ca3af; flex: none; }' +
    '#dshd-dot.ready { background: #34c98e; } #dshd-dot.starting { background: #e5b93b; } #dshd-dot.error { background: #ef4444; }' +
    '#dshd-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '#dshd-ws-btn { flex: none; font-size: 13px; font-weight: 600; color: #2563eb; background: none; border: none; padding: 4px 2px; }' +
    '#dshd-ws { position: fixed; left: 10px; right: 10px; top: calc(60px + env(safe-area-inset-top)); bottom: 10px; z-index: 2147483001; display: none; flex-direction: column; background: #ffffff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.25); overflow: hidden; }' +
    '#dshd-ws.open { display: flex; }' +
    '#dshd-ws-head { padding: 16px 16px 8px; font-size: 15px; font-weight: 700; color: #111827; }' +
    '#dshd-ws-list { flex: 1; overflow: auto; padding: 4px 10px 12px; }' +
    '.dshd-ws-item { display: flex; flex-direction: column; gap: 2px; padding: 12px 12px; border-radius: 12px; background: #f3f4f6; margin: 6px 0; }' +
    '.dshd-ws-item .t { font-size: 14px; font-weight: 600; color: #111827; }' +
    '.dshd-ws-item .p { font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '#dshd-ws-empty { padding: 14px; font-size: 13px; color: #6b7280; text-align: center; }' +
    '[class*="sidebarCol"], [class*="detailsCol"], [class*="overlayLayer"], [class*="aionui-"] { display: none !important; }' +
    '[class*="centerCol"] { width: 100% !important; max-width: 100% !important; flex: 1 1 auto !important; }' +
    '[class*="frame"] { display: flex !important; flex-direction: column !important; }' +
    '[class*="composerStack"] { width: 100% !important; border-radius: 18px 18px 0 0 !important; box-shadow: 0 -4px 24px rgba(0,0,0,0.08) !important; }' +
    '[class*="scrollBody"] { flex: 1 1 auto !important; }' +
    '@media (prefers-color-scheme: dark) {' +
      '#dshd-host { background: rgba(17,24,39,0.96); border-bottom-color: rgba(255,255,255,0.1); color: #f3f4f6; }' +
      '#dshd-ws { background: #111827; } #dshd-ws-head { color: #f3f4f6; }' +
      '.dshd-ws-item { background: #1f2937; } .dshd-ws-item .t { color: #f3f4f6; }' +
      '[class*="composerStack"] { box-shadow: 0 -4px 24px rgba(0,0,0,0.35) !important; }' +
    '}'

  var dot, title, wsPanel, wsList

  function onReady(fn) {
    if (document.body) fn()
    else document.addEventListener('DOMContentLoaded', fn)
  }

  onReady(function () {
    try {
      var style = document.createElement('style')
      style.textContent = css
      ;(document.head || document.documentElement).appendChild(style)

      var meta = document.querySelector('meta[name="viewport"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'viewport'
        meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
        document.head.appendChild(meta)
      } else {
        meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      }

      var host = document.createElement('div')
      host.id = 'dshd-host'
      host.innerHTML =
        '<span id="dshd-dot"></span>' +
        '<span id="dshd-title">未连接</span>' +
        '<button id="dshd-ws-btn">工作区</button>'
      document.body.appendChild(host)

      wsPanel = document.createElement('div')
      wsPanel.id = 'dshd-ws'
      wsPanel.innerHTML = '<div id="dshd-ws-head">工作区</div><div id="dshd-ws-list"></div>'
      document.body.appendChild(wsPanel)

      dot = document.getElementById('dshd-dot')
      title = document.getElementById('dshd-title')
      wsList = document.getElementById('dshd-ws-list')

      document.getElementById('dshd-ws-btn').addEventListener('click', function () {
        wsPanel.classList.toggle('open')
        if (wsPanel.classList.contains('open')) loadWorkspaces()
      })
      wsPanel.addEventListener('click', function (e) {
        if (e.target === wsPanel || e.target.id === 'dshd-ws-head') wsPanel.classList.remove('open')
      })

      try {
        var info = window.dshDesktop && window.dshDesktop.info ? JSON.parse(window.dshDesktop.info()) : null
        if (info) {
          window.__dshBackendStatus({ state: info.url ? 'ready' : 'starting', mode: info.mode })
        }
      } catch (e) {}
    } catch (e) {
      console.log('inject init error: ' + e.message)
    }
  })

  window.__dshBackendStatus = function (s) {
    if (!s || !dot) return
    dot.className = s.state === 'ready' ? 'ready' : s.state === 'error' ? 'error' : s.state === 'starting' ? 'starting' : ''
    var label = { ready: '运行中', starting: '连接中', error: '出错' }[s.state] || s.state || '未连接'
    if (title) title.textContent = (s.mode || '未连接') + ' · ' + label
  }

  function loadWorkspaces() {
    if (!wsList) return
    wsList.innerHTML = '<div id="dshd-ws-empty">加载中…</div>'
    var rpcId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random())
    fetch('/api/workspace.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: rpcId, method: 'workspace.list', payload: {} })
    })
      .then(function (r) { return r.json() })
      .then(function (data) {
        var items = data && data.result && data.result.value && data.result.value.items
        if (!Array.isArray(items) || items.length === 0) {
          wsList.innerHTML = '<div id="dshd-ws-empty">暂无工作区</div>'
          return
        }
        wsList.innerHTML = items.map(function (it) {
          return '<div class="dshd-ws-item"><div class="t">📁 ' + esc(it.title || it.path) + '</div><div class="p">' + esc(it.path || '') + '</div></div>'
        }).join('')
      })
      .catch(function () {
        wsList.innerHTML = '<div id="dshd-ws-empty">无法读取工作区</div>'
      })
  }

  // Mobile-ify the chat layout once the app has rendered.
  function mobileify() {
    try {
      var frame = document.body.children[1] && document.body.children[1].querySelector('[class*="frame"]')
      if (!frame) return
      var sidebar = frame.querySelector('[class*="sidebarCol"]')
      var details = frame.querySelector('[class*="detailsCol"]')
      var overlay = frame.querySelector('[class*="overlayLayer"]')
      var aionui = frame.querySelectorAll('[class*="aionui-"]')
      var center = frame.querySelector('[class*="centerCol"]')
      if (sidebar) sidebar.style.display = 'none'
      if (details) details.style.display = 'none'
      if (overlay) overlay.style.display = 'none'
      for (var i = 0; i < aionui.length; i++) aionui[i].style.display = 'none'
      if (center) {
        center.style.width = '100%'
        center.style.maxWidth = '100%'
      }
      var composer = frame.querySelector('[class*="composerStack"]')
      if (composer) {
        composer.style.position = 'sticky'
        composer.style.bottom = '0'
        composer.style.zIndex = '5'
      }
      var scroll = frame.querySelector('[class*="scrollBody"]')
      if (scroll) {
        scroll.style.overflowY = 'auto'
        scroll.style.height = '100%'
      }
    } catch (e) {}
    loadWorkspaces()
  }

  var mobileifyTimer = null
  function scheduleMobileify() {
    if (mobileifyTimer) clearTimeout(mobileifyTimer)
    mobileifyTimer = setTimeout(mobileify, 400)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mobileify)
  } else {
    mobileify()
  }
  setTimeout(mobileify, 1200)
  setTimeout(mobileify, 3000)
  new MutationObserver(scheduleMobileify).observe(document.body, { childList: true, subtree: true })
})()
