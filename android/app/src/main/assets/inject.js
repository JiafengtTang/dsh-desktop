;(function () {
  if (window.__dshAndroidUi__) return
  window.__dshAndroidUi__ = true

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  var css =
    '#dshd-android-host, #dshd-android-host * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif; }' +
    '#dshd-android-host { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }' +
    '#dshd-android-status { pointer-events: auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: rgba(18,24,35,0.92); border: 1px solid rgba(255,255,255,0.12); color: #e8eefb; box-shadow: 0 8px 28px rgba(0,0,0,0.45); cursor: pointer; user-select: none; }' +
    '#dshd-android-dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7a94; flex: none; }' +
    '#dshd-android-dot.ready { background: #34c98e; } #dshd-android-dot.starting { background: #e5b93b; } #dshd-android-dot.error { background: #ff6b6b; }' +
    '#dshd-android-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }' +
    '#dshd-android-arrow { color: #8b98b3; font-size: 15px; }' +
    '#dshd-android-ws { pointer-events: auto; display: none; max-height: 45vh; overflow: auto; border-radius: 12px; background: rgba(18,24,35,0.94); border: 1px solid rgba(255,255,255,0.12); color: #e8eefb; box-shadow: 0 8px 28px rgba(0,0,0,0.45); }' +
    '#dshd-android-ws.open { display: block; }' +
    '#dshd-android-ws-title { padding: 10px 14px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; color: #8b98b3; text-transform: uppercase; }' +
    '#dshd-android-ws-list { padding: 0 8px 10px; }' +
    '.dshd-android-ws-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px; border-radius: 8px; }' +
    '.dshd-android-ws-item:hover { background: rgba(128,140,170,0.14); }' +
    '.dshd-android-ws-item .t { font-size: 12.5px; font-weight: 600; }' +
    '.dshd-android-ws-item .p { font-size: 10.5px; color: #8b98b3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '#dshd-android-ws-empty { padding: 8px; font-size: 12px; color: #8b98b3; }'

  var style = document.createElement('style')
  style.textContent = css
  ;(document.head || document.documentElement).appendChild(style)

  var host = document.createElement('div')
  host.id = 'dshd-android-host'
  host.innerHTML =
    '<div id="dshd-android-status">' +
      '<span id="dshd-android-dot"></span>' +
      '<span id="dshd-android-name">未连接</span>' +
      '<span id="dshd-android-arrow">☰</span>' +
    '</div>' +
    '<div id="dshd-android-ws">' +
      '<div id="dshd-android-ws-title">工作区</div>' +
      '<div id="dshd-android-ws-list"></div>' +
    '</div>'
  document.body.appendChild(host)

  var dot = document.getElementById('dshd-android-dot')
  var nameEl = document.getElementById('dshd-android-name')
  var wsPanel = document.getElementById('dshd-android-ws')
  var wsList = document.getElementById('dshd-android-ws-list')

  window.__dshBackendStatus = function (s) {
    if (!s) return
    dot.className = s.state === 'ready' ? 'ready' : s.state === 'error' ? 'error' : s.state === 'starting' ? 'starting' : ''
    var label = { ready: '运行中', starting: '连接中', error: '出错' }[s.state] || s.state || '未连接'
    nameEl.textContent = (s.mode || '未连接') + ' · ' + label
  }

  try {
    var info = window.dshDesktop && window.dshDesktop.info ? JSON.parse(window.dshDesktop.info()) : null
    if (info) {
      window.__dshBackendStatus({ state: info.url ? 'ready' : 'starting', mode: info.mode })
    }
  } catch (e) {}

  document.getElementById('dshd-android-status').addEventListener('click', function () {
    wsPanel.classList.toggle('open')
    if (wsPanel.classList.contains('open')) loadWorkspaces()
  })

  function loadWorkspaces() {
    wsList.innerHTML = '<div id="dshd-android-ws-empty">加载中…</div>'
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
          wsList.innerHTML = '<div id="dshd-android-ws-empty">暂无工作区</div>'
          return
        }
        wsList.innerHTML = items.map(function (it) {
          return '<div class="dshd-android-ws-item">' +
            '<div class="t">📁 ' + esc(it.title || it.path) + '</div>' +
            '<div class="p">' + esc(it.path || '') + '</div>' +
          '</div>'
        }).join('')
      })
      .catch(function () {
        wsList.innerHTML = '<div id="dshd-android-ws-empty">无法读取工作区</div>'
      })
  }

  setTimeout(loadWorkspaces, 1500)
})()
