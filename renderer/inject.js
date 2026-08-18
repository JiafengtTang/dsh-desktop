;(function () {
  if (window.__dshConnectionsUI__) return
  if (!window.dshDesktop) return
  window.__dshConnectionsUI__ = true

  const CSS = `
    #dshd-root { all: initial; }
    #dshd-root, #dshd-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    :root {
      --dshd-bg: rgba(255, 255, 255, 0.82);
      --dshd-surface: rgba(255, 255, 255, 0.55);
      --dshd-border: rgba(20, 30, 55, 0.12);
      --dshd-text: #1d2539;
      --dshd-muted: #5b6478;
    }
    body[data-ds-dark-theme] {
      --dshd-bg: rgba(15, 20, 29, 0.78);
      --dshd-surface: #121823;
      --dshd-border: rgba(255, 255, 255, 0.12);
      --dshd-text: #e8eefb;
      --dshd-muted: #8b98b3;
    }
    .dshd-backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: rgba(0,0,0,0.35); display: none;
    }
    .dshd-backdrop.open { display: block; }
    .dshd-sidebar-entry {
      display: flex; align-items: center; gap: 8px;
      margin: 0 12px 6px; padding: 0 12px; height: 32px; border-radius: 8px; cursor: pointer;
      background: transparent; border: none; color: inherit;
      font-size: 13px; font-weight: 600; font-family: inherit; text-align: left;
      user-select: none; -webkit-user-select: none;
    }
    .dshd-sidebar-entry:hover { background: rgba(128, 140, 170, 0.14); }
    .dshd-project-switcher {
      margin: 2px 12px 10px;
      padding: 8px 0 2px;
      border-top: 1px solid var(--dshd-border);
    }
    .dshd-project-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px 6px; color: var(--dshd-muted);
      font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
      text-transform: uppercase; user-select: none; -webkit-user-select: none;
    }
    .dshd-project-item {
      display: flex; align-items: center; gap: 8px;
      width: 100%; margin: 0 0 4px; padding: 0 8px; height: 32px; border-radius: 8px;
      border: none; background: transparent; color: inherit; cursor: pointer;
      font: inherit; font-size: 12.5px; text-align: left;
      user-select: none; -webkit-user-select: none;
    }
    .dshd-project-item:hover { background: rgba(128, 140, 170, 0.14); }
    .dshd-project-item.active { background: rgba(79, 140, 255, 0.16); }
    .dshd-project-item .dshd-project-icon { flex: 0 0 auto; font-size: 13px; }
    .dshd-ws-group { margin: 0 0 6px; }
    .dshd-ws-group-head { display: flex; align-items: center; gap: 6px; padding: 2px 8px 4px; cursor: pointer; user-select: none; -webkit-user-select: none; }
    .dshd-ws-group-head:hover { opacity: 0.82; }
    .dshd-ws-group-head .dshd-dot { width: 7px; height: 7px; }
    .dshd-ws-group-name { flex: 1; min-width: 0; font-weight: 700; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dshd-ws-group-kind { flex: none; font-size: 10px; color: var(--dshd-muted); }
    .dshd-ws-empty { padding: 0 8px 6px; color: var(--dshd-muted); font-size: 11px; }
    .dshd-ws-connect { display: flex; align-items: center; gap: 7px; margin: 0 8px 5px; padding: 0 8px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--dshd-text); user-select: none; -webkit-user-select: none; }
    .dshd-ws-connect:hover { background: rgba(128, 140, 170, 0.14); }
    .dshd-ws-connect .dshd-dot { width: 7px; height: 7px; }
    .dshd-project-item .dshd-project-body { flex: 1; min-width: 0; }
    .dshd-project-item .dshd-project-name {
      font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dshd-project-item .dshd-project-sub {
      color: var(--dshd-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dshd-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7a94; flex: 0 0 auto; }
    .dshd-dot.ready { background: #34c98e; }
    .dshd-dot.starting { background: #e5b93b; }
    .dshd-dot.error { background: #ff6b6b; }
    .dshd-entry-status { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--dshd-muted); }
    .dshd-panel {
      position: fixed; z-index: 2147483001;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 400px; max-height: min(680px, calc(100vh - 60px)); overflow: auto;
      background: var(--dshd-bg); color: var(--dshd-text); border: 1px solid var(--dshd-border);
      backdrop-filter: blur(24px) saturate(1.2); -webkit-backdrop-filter: blur(24px) saturate(1.2);
      border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,0.55);
      display: none; font-size: 13px;
    }
    .dshd-panel.open { display: block; }
    .dshd-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 14px; border-bottom: 1px solid var(--dshd-border); font-weight: 600; }
    .dshd-x { background: none; border: none; color: var(--dshd-muted); font-size: 18px; cursor: pointer; line-height: 1; padding: 0; }
    .dshd-x:hover { color: var(--dshd-text); }
    .dshd-body { padding: 12px 14px 14px; }
    .dshd-status { font-size: 12px; color: var(--dshd-muted); margin-bottom: 10px; }
    .dshd-status b { color: var(--dshd-text); }
    .dshd-item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid var(--dshd-border); border-radius: 10px; margin-bottom: 7px; background: var(--dshd-surface); }
    .dshd-item.active { border-color: rgba(52,201,142,0.5); }
    .dshd-item .grow { flex: 1; min-width: 0; }
    .dshd-item .name { font-weight: 600; font-size: 12.5px; }
    .dshd-item .sub { color: var(--dshd-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dshd-badge { font-size: 10px; color: #34c98e; }
    .dshd-btn { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 8px; cursor: pointer; background: var(--dshd-surface); color: var(--dshd-text); border: 1px solid var(--dshd-border); }
    .dshd-btn:hover { border-color: rgba(255,255,255,0.3); }
    .dshd-btn.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; }
    .dshd-btn.danger { color: #ff8b8b; }
    .dshd-add { width: 100%; margin-top: 3px; padding: 8px; border-radius: 10px; border: 1px dashed rgba(255,255,255,0.18); background: none; color: #9fb2d6; font: inherit; font-size: 12px; cursor: pointer; }
    .dshd-add:hover { border-color: #4f8cff; color: #fff; }
    .dshd-form { margin-top: 10px; padding: 12px; border: 1px solid var(--dshd-border); border-radius: 12px; background: var(--dshd-surface); }
    .dshd-form h4 { margin: 0 0 10px; font-size: 12.5px; }
    .dshd-form label { display: block; font-size: 11px; color: var(--dshd-muted); margin: 8px 0 3px; }
    .dshd-form input { width: 100%; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--dshd-border); background: var(--dshd-bg); color: var(--dshd-text); font: inherit; font-size: 12px; outline: none; }
    .dshd-form input:focus { border-color: #4f8cff; }
    .dshd-row2 { display: flex; gap: 8px; }
    .dshd-row2 > div { flex: 1; }
    .dshd-form-actions { display: flex; gap: 8px; margin-top: 12px; }
    .dshd-advanced { font-size: 11px; color: #9fb2d6; cursor: pointer; margin-top: 10px; background: none; border: none; padding: 0; }
    .dshd-advanced:hover { color: #fff; }
    .dshd-adv-fields { display: none; }
    .dshd-adv-fields.show { display: block; }
    .dshd-test { margin-top: 10px; padding: 8px 9px; border-radius: 8px; background: #121823; border: 1px solid rgba(255,255,255,0.08); font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; white-space: pre-wrap; color: #8b98b3; display: none; }
    .dshd-test.ok { display: block; color: #34c98e; }
    .dshd-test.fail { display: block; color: #ff8b8b; }
    .dshd-hint { font-size: 11px; color: #6b7a94; margin-top: 12px; line-height: 1.5; }
    .dshd-hint code { color: #9fb2d6; }
    .dshd-dir-row { display: flex; gap: 6px; align-items: center; }
    .dshd-dir-row input { flex: 1; }
    .dshd-browser { margin-top: 8px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; background: #0b0f16; }
    .dshd-browser-bar { display: flex; gap: 6px; margin-bottom: 8px; }
    .dshd-browser-cwd { font-size: 11px; color: #9fb2d6; margin-bottom: 6px; word-break: break-all; }
    .dshd-browser-list { max-height: 180px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
    .dshd-browser-item { padding: 5px 7px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #dbe5f5; }
    .dshd-browser-item:hover { background: rgba(255,255,255,0.08); }
    .dshd-browser-loading, .dshd-browser-empty { font-size: 11.5px; color: #8b98b3; padding: 6px 2px; }
    .dshd-browser-error { font-size: 11.5px; color: #ff8b8b; padding: 6px 2px; }
    .dshd-browser-actions { display: flex; gap: 8px; margin-top: 8px; }
    .dshd-ws-status {
      display: inline-flex; align-items: center; gap: 6px; flex: none;
      margin-left: 2px; padding: 1px 7px; height: 20px; border-radius: 999px;
      color: var(--dshd-muted); background: var(--dshd-surface);
      border: 1px solid var(--dshd-border); font-size: 11px; font-weight: 600;
      white-space: nowrap;
    }
    .dshd-ws-status .dshd-dot { width: 6px; height: 6px; }
    .dshd-ws-status-text { line-height: 1; }
    .dshd-ws-kind {
      display: inline-flex; align-items: center; gap: 4px; flex: none;
      margin-left: 5px; padding: 0 6px; height: 18px; border-radius: 999px;
      font-size: 10.5px; line-height: 1; font-weight: 600; color: var(--dshd-muted);
      background: var(--dshd-surface); border: 1px solid var(--dshd-border);
    }
    .dshd-ws-kind.remote { color: #6aa4ff; border-color: rgba(106, 164, 255, 0.38); }
    .dshd-ws-kind.local { color: #34c98e; border-color: rgba(52, 201, 142, 0.38); }
    .dshd-update {
      position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
      z-index: 2147483002; width: min(520px, calc(100vw - 32px));
      background: rgba(18, 24, 35, 0.96); color: #e8eefb;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5); padding: 12px 14px;
      font-size: 12.5px; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif;
      display: none; box-sizing: border-box;
    }
    .dshd-update.show { display: block; }
    .dshd-update-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 600; }
    .dshd-update-msg { margin-top: 5px; color: #9fb2d6; font-weight: 400; line-height: 1.45; }
    .dshd-update-actions { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
    .dshd-update-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.12); margin-top: 10px; overflow: hidden; display: none; }
    .dshd-update-bar.show { display: block; }
    .dshd-update-bar > div { height: 100%; width: 0%; background: linear-gradient(90deg, #4f8cff, #34c98e); transition: width 0.4s ease; border-radius: 999px; }
    .dshd-update-error { margin-top: 8px; color: #ff8b8b; white-space: pre-wrap; word-break: break-all; font-size: 11.5px; }
    .dshd-update-btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; border: 1px solid rgba(255,255,255,0.18); background: transparent; color: #e8eefb; }
    .dshd-update-btn:hover { border-color: #4f8cff; color: #fff; }
    .dshd-update-btn.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; }
    .dshd-update-btn:disabled { opacity: 0.55; cursor: default; }
  `

  const style = document.createElement('style')
  style.textContent = CSS
  ;(document.head || document.documentElement).appendChild(style)

  let currentMode = '本机'
  let currentState = 'starting'

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function targetText(c) {
    return c.sshAlias || ((c.user ? c.user + '@' : '') + (c.host || ''))
  }

  function setStatus(mode, state) {
    currentMode = mode === 'Local' ? '本机' : mode
    currentState = state
    const stateLabel = { starting: '连接中', ready: '运行中', error: '出错', exited: '已停止' }[state] || state
    const el = document.getElementById('dshd-status')
    if (el) el.innerHTML = '当前：<b>' + esc(currentMode) + '</b> · ' + stateLabel
    const dot = document.getElementById('dshd-dot')
    if (dot) dot.className = 'dshd-dot ' + (state === 'ready' ? 'ready' : state === 'error' ? 'error' : state === 'starting' ? 'starting' : '')
    const entryStatus = document.getElementById('dshd-entry-status')
    if (entryStatus) entryStatus.textContent = currentMode + ' · ' + stateLabel
    updateWorkspaceStatus()
    renderProjectSwitcher()
  }

  function stateLabel(state) {
    return { starting: '连接中', ready: '运行中', error: '出错', exited: '已停止' }[state] || state
  }

  function updateWorkspaceStatus() {
    const dot = document.getElementById('dshd-ws-dot')
    const text = document.getElementById('dshd-ws-status-text')
    if (!dot || !text) return
    const remote = currentMode !== '本机'
    const label = stateLabel(currentState)
    text.textContent = remote ? currentMode + ' · ' + label : '本机'
    dot.className = 'dshd-dot ' + (currentState === 'ready' ? 'ready' : currentState === 'error' ? 'error' : currentState === 'starting' ? 'starting' : '')
  }

  async function markWorkspaceRows() {
    const rows = document.querySelectorAll('[class*="projectRow"]')
    if (!rows.length) return
    let remote = false
    try {
      const data = await window.dshDesktop.connections.list()
      remote = data.active !== 'local'
    } catch {
      remote = currentMode !== '本机'
    }
    const kind = remote ? 'remote' : 'local'
    const icon = remote ? '🖥' : '💻'
    const label = remote ? '远程' : '本地'
    const title = remote ? '远程项目' : '本地项目'
    rows.forEach((row) => {
      const titleEl = row.querySelector('[class*="title"]')
      if (!titleEl) return
      const text = (row.textContent || '').trim()
      if (text === '未分组' || text === 'Ungrouped') return
      let badge = row.querySelector(':scope > .dshd-ws-kind, .dshd-ws-kind')
      if (!badge) {
        badge = document.createElement('span')
        badge.className = 'dshd-ws-kind'
        titleEl.insertAdjacentElement('afterend', badge)
      }
      if (badge.dataset.kind === kind) return
      badge.dataset.kind = kind
      badge.className = 'dshd-ws-kind ' + kind
      badge.textContent = icon + ' ' + label
      badge.title = title
    })
  }

  function injectWorkspaceStatusLight() {
    const region = document.querySelector('.qDHVXG_root')
    const header = region && region.querySelector('[class*="sectionHeader"]')
    if (!header || document.getElementById('dshd-ws-status')) return
    const status = document.createElement('span')
    status.id = 'dshd-ws-status'
    status.className = 'dshd-ws-status'
    status.innerHTML = '<span class="dshd-dot" id="dshd-ws-dot"></span><span class="dshd-ws-status-text" id="dshd-ws-status-text"></span>'
    const label = header.querySelector('[class*="sectionLabel"]')
    if (label) label.insertAdjacentElement('afterend', status)
    else header.appendChild(status)
    updateWorkspaceStatus()
  }

  async function renderList() {
    const box = document.getElementById('dshd-list')
    if (!box) return
    const data = await window.dshDesktop.connections.list()
    let html = ''

    html += itemHtml('local', '本机（当前电脑）', '在本地运行 DeepSeek Harness', data.active === 'local')
    for (const c of data.connections) {
      html += itemHtml(c.name, c.name, targetText(c) + ' · ' + c.projectDir, data.active === c.name)
    }
    box.innerHTML = html

    box.querySelectorAll('[data-activate]').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await window.dshDesktop.connections.activate(b.getAttribute('data-activate'))
        if (!r.ok) alert('连接失败：' + r.error)
        else renderList()
      })
    })
    box.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const name = b.getAttribute('data-edit')
        const c = data.connections.find((x) => x.name === name)
        if (c) openForm(c)
      })
    })
    box.querySelectorAll('[data-delete]').forEach((b) => {
      b.addEventListener('click', async () => {
        const name = b.getAttribute('data-delete')
        if (confirm('删除连接「' + name + '」？')) {
          await window.dshDesktop.connections.remove(name)
          renderList()
        }
      })
    })
  }

  function itemHtml(id, name, sub, active) {
    return '<div class="dshd-item' + (active ? ' active' : '') + '">' +
      '<div class="grow"><div class="name">' + esc(name) + (active ? ' <span class="dshd-badge">●</span>' : '') + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>' +
      (active ? '' : '<button class="dshd-btn primary" data-activate="' + esc(id) + '">连接</button>') +
      (id === 'local' ? '' : '<button class="dshd-btn" data-edit="' + esc(id) + '">编辑</button><button class="dshd-btn danger" data-delete="' + esc(id) + '">删</button>') +
      '</div>'
  }

  function groupHeadHtml(key, name, kind, active, icon) {
    return '<div class="dshd-ws-group-head" data-ws-group="' + esc(key) + '">' +
      '<span class="dshd-dot ' + (active ? 'ready' : '') + '"></span>' +
      '<span class="dshd-ws-group-name">' + icon + ' ' + esc(name) + '</span>' +
      '<span class="dshd-ws-group-kind">' + esc(kind) + '</span>' +
    '</div>'
  }

  function workspaceItemHtml(key, it) {
    return '<button type="button" class="dshd-project-item" data-ws-open="1" data-ws-key="' + esc(key) + '">' +
      '<span class="dshd-project-icon">📁</span>' +
      '<span class="dshd-project-body">' +
        '<div class="dshd-project-name">' + esc(it.title || it.path) + '</div>' +
        '<div class="dshd-project-sub">' + esc(it.path || '') + '</div>' +
      '</span>' +
    '</button>'
  }

  function connectRowHtml(key, name, icon) {
    return '<div class="dshd-ws-connect" data-ws-open="1" data-ws-key="' + esc(key) + '">' +
      '<span class="dshd-dot"></span><span>' + icon + ' ' + esc(name) + '（点击连接）</span>' +
    '</div>'
  }

  async function renderProjectSwitcher() {
    const box = document.getElementById('dshd-project-list')
    if (!box) return
    if (window.__dshRenderWsInFlight__) return
    window.__dshRenderWsInFlight__ = true
    try {
      let wsData
      let connData
      try {
        wsData = await window.dshDesktop.workspaces.list()
        connData = await window.dshDesktop.connections.list()
      } catch {
        return
      }

      const active = wsData.active || connData.active || 'local'
      const byKey = {}
      for (const g of (wsData.groups || [])) byKey[g.key] = g

      const parts = []

      const localGroup = byKey['local']
      parts.push(groupHeadHtml('local', '本机（当前电脑）', '本地', active === 'local', '💻'))
      if (localGroup) {
        parts.push(...(localGroup.items || []).map((it) => workspaceItemHtml('local', it)))
        if (!(localGroup.items && localGroup.items.length)) {
          parts.push('<div class="dshd-ws-empty">' + (localGroup.error ? esc(localGroup.error) : '暂无工作区') + '</div>')
        }
      } else {
        parts.push(connectRowHtml('local', '本机（当前电脑）', '💻'))
      }

      for (const c of (connData.connections || [])) {
        const g = byKey[c.name]
        parts.push(groupHeadHtml(c.name, c.name, g ? '远程' : '未连接', active === c.name, '🖥'))
        if (g) {
          parts.push(...(g.items || []).map((it) => workspaceItemHtml(c.name, it)))
          if (!(g.items && g.items.length)) {
            parts.push('<div class="dshd-ws-empty">' + (g.error ? esc(g.error) : '暂无工作区') + '</div>')
          }
        } else {
          parts.push(connectRowHtml(c.name, c.name, '🖥'))
        }
      }

      box.innerHTML = parts.join('')

      const activate = async (key) => {
        if (key === active) return
        try {
          const r = await window.dshDesktop.connections.activate(key)
          if (!r.ok) alert('切换失败：' + r.error)
        } catch (err) {
          alert('切换失败：' + (err.message || err))
        }
      }
      box.querySelectorAll('[data-ws-group]').forEach((el) => {
        el.addEventListener('click', () => activate(el.getAttribute('data-ws-group')))
      })
      box.querySelectorAll('[data-ws-open]').forEach((el) => {
        el.addEventListener('click', () => activate(el.getAttribute('data-ws-key')))
      })
    } finally {
      window.__dshRenderWsInFlight__ = false
    }
  }

  function injectProjectSwitcher() {
    const sidebar = document.querySelector('.hHd-Xa_root')
    if (!sidebar || document.getElementById('dshd-project-switcher')) return
    const wrap = document.createElement('div')
    wrap.id = 'dshd-project-switcher'
    wrap.className = 'dshd-project-switcher'
    wrap.innerHTML = '<div class="dshd-project-header"><span>工作区</span><span>本地 / 远程</span></div><div id="dshd-project-list"></div>'
    const region = sidebar.querySelector('.hHd-Xa_regionArea')
    if (region) sidebar.insertBefore(wrap, region)
    else sidebar.appendChild(wrap)
    renderProjectSwitcher()
  }

  function openForm(existing) {
    const form = document.getElementById('dshd-form')
    const title = document.getElementById('dshd-form-title')
    const save = document.getElementById('dshd-save')
    form.hidden = false
    form._editing = existing ? existing.name : null
    title.textContent = existing ? '编辑连接' : '添加远程服务器'
    save.textContent = existing ? '保存修改' : '保存'
    document.getElementById('f-name').value = existing ? existing.name || '' : ''
    document.getElementById('f-host').value = existing ? existing.host || '' : ''
    document.getElementById('f-user').value = existing ? existing.user || '' : ''
    document.getElementById('f-port').value = existing ? existing.port || 22 : 22
    document.getElementById('f-identity').value = existing ? existing.identityFile || '' : ''
    document.getElementById('f-dir').value = existing ? existing.projectDir || '' : ''
    document.getElementById('f-alias').value = existing ? existing.sshAlias || '' : ''
    document.getElementById('f-rport').value = existing ? existing.remotePort || 0 : 0
    document.getElementById('f-shell').value = existing ? existing.remoteShell || 'bash' : 'bash'
    document.getElementById('f-cmd').value = existing ? existing.dshCommand || '' : ''
    const test = document.getElementById('dshd-test')
    test.className = 'dshd-test'
    test.textContent = ''
    form.scrollIntoView({ block: 'nearest' })
  }

  function readForm() {
    const val = (id) => document.getElementById(id).value.trim()
    return {
      name: val('f-name'),
      sshAlias: val('f-alias'),
      host: val('f-host'),
      user: val('f-user'),
      port: parseInt(val('f-port'), 10) || 22,
      identityFile: val('f-identity'),
      projectDir: val('f-dir'),
      remotePort: parseInt(val('f-rport'), 10) || 0,
      remoteShell: val('f-shell') || 'bash',
      dshCommand: val('f-cmd') || 'npx -y @deepseek-ai/dsh@0.1.0-rc.6'
    }
  }

  function posixDirname(p) {
    if (!p || p === '/') return '/'
    const parts = p.split('/').filter(Boolean)
    parts.pop()
    return '/' + parts.join('/')
  }

  let browsePath = '~'

  async function loadBrowse(dir) {
    const list = document.getElementById('dshd-b-list')
    const cwdEl = document.getElementById('dshd-b-cwd')
    list.innerHTML = '<div class="dshd-browser-loading">正在读取远程目录…</div>'
    const r = await window.dshDesktop.connections.browse(readForm(), dir)
    if (!r.ok) {
      list.innerHTML = '<div class="dshd-browser-error">' + esc(r.error) + '</div>'
      return
    }
    browsePath = r.cwd
    cwdEl.textContent = r.cwd
    if (!r.dirs || r.dirs.length === 0) {
      list.innerHTML = '<div class="dshd-browser-empty">（没有子目录）</div>'
    } else {
      list.innerHTML = r.dirs.map((d) => '<div class="dshd-browser-item" data-dir="' + esc(d) + '">📁 ' + esc(d) + '</div>').join('')
    }
    list.querySelectorAll('.dshd-browser-item').forEach((el) => {
      el.addEventListener('click', () => loadBrowse(browsePath + '/' + el.getAttribute('data-dir')))
    })
  }

  function openBrowse() {
    document.getElementById('dshd-browser').hidden = false
    const current = document.getElementById('f-dir').value.trim()
    loadBrowse(current || '~')
  }

  let wsPath = '~'

  async function activeProfile() {
    const data = await window.dshDesktop.connections.list()
    if (data.active === 'local') return null
    return data.connections.find((c) => c.name === data.active) || null
  }

  async function loadWsBrowse(dir) {
    const list = document.getElementById('dshd-ws-list')
    const cwdEl = document.getElementById('dshd-ws-cwd')
    const profile = await activeProfile()
    if (!profile) {
      list.innerHTML = '<div class="dshd-browser-error">当前是本机连接，只有远程连接才需要在这里选工作区。</div>'
      return
    }
    list.innerHTML = '<div class="dshd-browser-loading">正在读取远程目录…</div>'
    const r = await window.dshDesktop.connections.browse(profile, dir)
    if (!r.ok) {
      list.innerHTML = '<div class="dshd-browser-error">' + esc(r.error) + '</div>'
      return
    }
    wsPath = r.cwd
    cwdEl.textContent = r.cwd
    if (!r.dirs || r.dirs.length === 0) {
      list.innerHTML = '<div class="dshd-browser-empty">（没有子目录）</div>'
    } else {
      list.innerHTML = r.dirs.map((d) => '<div class="dshd-browser-item" data-dir="' + esc(d) + '">📁 ' + esc(d) + '</div>').join('')
    }
    list.querySelectorAll('.dshd-browser-item').forEach((el) => {
      el.addEventListener('click', () => loadWsBrowse(wsPath + '/' + el.getAttribute('data-dir')))
    })
  }

  function openPanel() {
    const panel = document.getElementById('dshd-panel')
    const backdrop = document.getElementById('dshd-backdrop')
    if (panel) panel.classList.add('open')
    if (backdrop) backdrop.classList.add('open')
    renderList()
  }

  function closePanel() {
    const panel = document.getElementById('dshd-panel')
    const backdrop = document.getElementById('dshd-backdrop')
    if (panel) panel.classList.remove('open')
    if (backdrop) backdrop.classList.remove('open')
  }

  function injectSidebarEntry() {
    const sidebar = document.querySelector('.hHd-Xa_root')
    if (!sidebar || document.getElementById('dshd-sidebar-entry')) return
    const entry = document.createElement('button')
    entry.type = 'button'
    entry.id = 'dshd-sidebar-entry'
    entry.className = 'dshd-sidebar-entry'
    entry.innerHTML = '<span class="dshd-dot" id="dshd-dot"></span><span>管理远程连接…</span><span class="dshd-entry-status" id="dshd-entry-status"></span>'
    const region = sidebar.querySelector('.hHd-Xa_regionArea')
    if (region) sidebar.insertBefore(entry, region)
    else sidebar.appendChild(entry)
    entry.addEventListener('click', openPanel)
  }

  // Inject 上级/根目录 buttons into dsh's own "选择工作区目录" dialog, by
  // driving its path editor (the pencil opens an input; Enter navigates).
  function injectWsDialogNav() {
    const title = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '选择工作区目录')
    if (!title || document.getElementById('dshd-ws-dialog-nav')) return
    let dlg = title
    while (dlg && dlg.parentElement && !(dlg.getAttribute && (dlg.getAttribute('role') === 'dialog' || dlg.getAttribute('aria-modal')))) dlg = dlg.parentElement

    const wrap = document.createElement('div')
    wrap.id = 'dshd-ws-dialog-nav'
    wrap.style.cssText = 'display:flex;gap:6px;margin:4px 0;'
    const mk = (txt) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = txt
      b.style.cssText = 'font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,140,170,0.35);background:transparent;color:inherit;'
      wrap.appendChild(b)
      return b
    }
    const up = mk('上级')
    const root = mk('根目录 /')

    async function goTo(path) {
      const pencil = [...dlg.querySelectorAll('button')].find((b) => /编辑|Edit/.test((b.getAttribute('aria-label') || '') + (b.title || '')))
      if (pencil) pencil.click()
      await new Promise((r) => setTimeout(r, 150))
      const input = dlg.querySelector('input')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, path)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    }

    up.addEventListener('click', async () => {
      const cur = dlg.querySelector('input')
      const value = cur && cur.value ? cur.value : null
      await goTo(value ? posixDirname(value) : '~')
    })
    root.addEventListener('click', () => goTo('/'))

    const cancel = [...dlg.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '取消')
    const anchor = cancel && cancel.parentElement ? cancel.parentElement : dlg
    anchor.parentElement ? anchor.parentElement.insertBefore(wrap, anchor) : dlg.appendChild(wrap)
  }

  function updateBannerProgress(p) {
    const banner = document.getElementById('dshd-update')
    if (!banner) return
    const msg = document.getElementById('dshd-update-msg')
    const bar = document.getElementById('dshd-update-bar')
    const fill = document.getElementById('dshd-update-fill')
    const err = document.getElementById('dshd-update-error')
    const go = document.getElementById('dshd-update-go')
    const later = document.getElementById('dshd-update-later')
    if (!msg || !bar || !fill || !err || !go || !later) return
    if (p && p.phase === 'ready') {
      fill.style.width = '100%'
      err.textContent = ''
      msg.textContent = p.message || '已更新到最新版本，连接就绪'
      go.disabled = true
      later.disabled = true
      setTimeout(() => { banner.classList.remove('show') }, 4000)
      return
    }
    if (p && p.phase === 'failed') {
      bar.classList.remove('show')
      go.disabled = false
      later.disabled = false
      err.textContent = p.error || p.message || '更新失败'
      msg.textContent = p.message || '更新失败，请重试'
      return
    }
    if (p && typeof p.percent === 'number') {
      fill.style.width = Math.max(2, Math.min(100, p.percent)) + '%'
    }
    if (p && p.message) msg.textContent = p.message
    bar.classList.add('show')
    go.disabled = true
    later.disabled = true
  }

  function checkUpdateBanner() {
    if (!window.dshDesktop || !window.dshDesktop.dsh) return
    window.dshDesktop.dsh.checkUpdate().then((info) => {
      if (!info || !info.ok || !info.needsUpdate || !info.latest) return
      if (sessionStorage.getItem('dshd-update-ignored') === info.latest) return
      let banner = document.getElementById('dshd-update')
      if (!banner) {
        banner = document.createElement('div')
        banner.id = 'dshd-update'
        banner.className = 'dshd-update'
        banner.innerHTML =
          '<div class="dshd-update-head"><span>检测到 dsh 新版本</span>' +
          '<span id="dshd-update-close" class="dshd-x" title="稍后再说" style="font-size:16px">×</span></div>' +
          '<div class="dshd-update-msg" id="dshd-update-msg"></div>' +
          '<div class="dshd-update-bar" id="dshd-update-bar"><div id="dshd-update-fill"></div></div>' +
          '<div class="dshd-update-error" id="dshd-update-error"></div>' +
          '<div class="dshd-update-actions">' +
          '<button class="dshd-update-btn primary" id="dshd-update-go">更新到最新版</button>' +
          '<button class="dshd-update-btn" id="dshd-update-later">稍后再说</button></div>'
        document.body.appendChild(banner)
        document.getElementById('dshd-update-close').addEventListener('click', () => {
          banner.classList.remove('show')
          sessionStorage.setItem('dshd-update-ignored', info.latest)
        })
        document.getElementById('dshd-update-later').addEventListener('click', () => {
          banner.classList.remove('show')
          sessionStorage.setItem('dshd-update-ignored', info.latest)
        })
        document.getElementById('dshd-update-go').addEventListener('click', async () => {
          updateBannerProgress({ phase: 'restarting', message: '正在更新 dsh 到最新版…', percent: 5 })
          try {
            const r = await window.dshDesktop.dsh.applyUpdate()
            if (!r || !r.ok) {
              updateBannerProgress({ phase: 'failed', message: '更新失败', error: (r && r.error) || '未知错误' })
            }
          } catch (e) {
            updateBannerProgress({ phase: 'failed', message: '更新失败', error: String(e.message || e) })
          }
        })
        if (window.dshDesktop.dsh.onUpdateProgress) {
          window.dshDesktop.dsh.onUpdateProgress((p) => updateBannerProgress(p))
        }
      }
      document.getElementById('dshd-update-msg').textContent =
        '当前 ' + (info.local ? 'v' + info.local : '固定版本') +
        '，最新版本 v' + info.latest +
        '。更新会重启 dsh（进行中的对话会中断，记录保留）。'
      banner.classList.add('show')
    }).catch(() => {})
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 100)
      return
    }
    if (document.getElementById('dshd-root')) return

    const root = document.createElement('div')
    root.id = 'dshd-root'
    root.innerHTML = `
      <div class="dshd-backdrop" id="dshd-backdrop"></div>
      <div class="dshd-panel" id="dshd-panel">
        <div class="dshd-head"><span>远程连接</span><button class="dshd-x" id="dshd-close">×</button></div>
        <div class="dshd-body">
          <div class="dshd-status" id="dshd-status">…</div>
          <button class="dshd-add" id="dshd-ws-open" style="margin-bottom:8px;">🖥 选择工作区目录…</button>
          <div class="dshd-browser" id="dshd-ws-browser" hidden>
            <div class="dshd-browser-bar">
              <button type="button" class="dshd-btn" id="dshd-ws-up">上级</button>
              <button type="button" class="dshd-btn" id="dshd-ws-home">主目录</button>
              <button type="button" class="dshd-btn" id="dshd-ws-root">根目录 /</button>
            </div>
            <div class="dshd-browser-cwd" id="dshd-ws-cwd">…</div>
            <div class="dshd-browser-list" id="dshd-ws-list"></div>
            <div class="dshd-browser-actions">
              <button type="button" class="dshd-btn primary" id="dshd-ws-select">选择此目录</button>
              <button type="button" class="dshd-btn" id="dshd-ws-cancel">取消</button>
            </div>
          </div>
          <div class="dshd-list" id="dshd-list"></div>
          <button class="dshd-add" id="dshd-add">＋ 添加远程服务器</button>
          <form class="dshd-form" id="dshd-form" hidden>
            <h4 id="dshd-form-title">添加远程服务器</h4>
            <label>名称 *</label><input id="f-name" placeholder="例如：GPU 服务器" />
            <button type="button" class="dshd-btn" id="dshd-ssh-import" style="margin:4px 0 8px;">🖥 从 ~/.ssh/config 导入主机…</button>
            <div class="dshd-browser" id="dshd-ssh-picker" hidden>
              <div class="dshd-browser-list" id="dshd-ssh-list"></div>
              <div class="dshd-browser-actions">
                <button type="button" class="dshd-btn" id="dshd-ssh-cancel">取消</button>
              </div>
            </div>
            <label>主机 / IP *</label><input id="f-host" placeholder="例如：192.168.1.20" />
            <div class="dshd-row2">
              <div><label>用户</label><input id="f-user" placeholder="ubuntu" /></div>
              <div><label>端口</label><input id="f-port" type="number" value="22" /></div>
            </div>
            <label>私钥路径（可选）</label><input id="f-identity" placeholder="~/.ssh/id_ed25519" />
            <label>远程项目目录（可选）</label>
            <div class="dshd-dir-row">
              <input id="f-dir" placeholder="/home/ubuntu/project" />
              <button type="button" class="dshd-btn" id="dshd-browse">浏览…</button>
            </div>
            <div class="dshd-browser" id="dshd-browser" hidden>
              <div class="dshd-browser-bar">
                <button type="button" class="dshd-btn" id="dshd-b-up">上级</button>
                <button type="button" class="dshd-btn" id="dshd-b-home">主目录</button>
                <button type="button" class="dshd-btn" id="dshd-b-root">根目录 /</button>
              </div>
              <div class="dshd-browser-cwd" id="dshd-b-cwd">…</div>
              <div class="dshd-browser-list" id="dshd-b-list"></div>
              <div class="dshd-browser-actions">
                <button type="button" class="dshd-btn primary" id="dshd-b-select">选择此目录</button>
                <button type="button" class="dshd-btn" id="dshd-b-cancel">取消</button>
              </div>
            </div>
            <button type="button" class="dshd-advanced" id="dshd-adv-toggle">▸ 高级设置</button>
            <div class="dshd-adv-fields" id="dshd-adv-fields">
              <label>SSH 主机别名（可选，优先于上面的主机）</label><input id="f-alias" placeholder="devbox（~/.ssh/config）" />
              <label>远程端口（0 = 自动）</label><input id="f-rport" type="number" value="0" />
              <label>远程 shell</label><input id="f-shell" value="bash" />
              <label>远程 dsh 命令</label><input id="f-cmd" placeholder="dsh 或 npx -y @deepseek-ai/dsh" />
            </div>
            <div class="dshd-form-actions">
              <button type="submit" class="dshd-btn primary" id="dshd-save">保存</button>
              <button type="button" class="dshd-btn" id="dshd-test">测试连接</button>
              <button type="button" class="dshd-btn" id="dshd-sync">同步插件</button>
              <button type="button" class="dshd-btn" id="dshd-cancel">取消</button>
            </div>
            <div class="dshd-test" id="dshd-test"></div>
          </form>
          <div class="dshd-hint">
            远程服务器需能通过 SSH 登录（建议用密钥），并已安装 Node.js。<br/>
            连接后，读写文件和执行命令都会发生在远程的「项目目录」里。
          </div>
        </div>
      </div>
    `
    document.body.appendChild(root)

    document.getElementById('dshd-close').addEventListener('click', closePanel)
    document.getElementById('dshd-backdrop').addEventListener('click', closePanel)
    document.getElementById('dshd-add').addEventListener('click', () => openForm(null))
    document.getElementById('dshd-cancel').addEventListener('click', () => { document.getElementById('dshd-form').hidden = true })
    document.getElementById('dshd-adv-toggle').addEventListener('click', () => {
      const el = document.getElementById('dshd-adv-fields')
      el.classList.toggle('show')
      document.getElementById('dshd-adv-toggle').textContent = el.classList.contains('show') ? '▾ 高级设置' : '▸ 高级设置'
    })

    document.getElementById('dshd-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const form = e.target
      const profile = readForm()
      if (!profile.name) { alert('请填写名称'); return }
      if (!profile.sshAlias && !profile.host) { alert('请填写主机或 SSH 别名'); return }
      const r = form._editing
        ? await window.dshDesktop.connections.update(form._editing, profile)
        : await window.dshDesktop.connections.add(profile)
      if (!r.ok) { alert('保存失败：' + r.error); return }
      form.hidden = true
      renderList()
    })

    document.getElementById('dshd-test').addEventListener('click', async () => {
      const test = document.getElementById('dshd-test')
      test.className = 'dshd-test'
      test.textContent = '正在测试…'
      test.style.display = 'block'
      const r = await window.dshDesktop.connections.test(readForm())
      test.textContent = r.output || (r.ok ? '连接正常' : '连接失败')
      test.className = 'dshd-test ' + (r.ok ? 'ok' : 'fail')
    })

    document.getElementById('dshd-sync').addEventListener('click', async () => {
      const test = document.getElementById('dshd-test')
      test.className = 'dshd-test'
      test.textContent = '正在同步插件，请稍候…'
      test.style.display = 'block'
      const r = await window.dshDesktop.connections.syncPlugins(readForm())
      test.textContent = r.ok ? (r.output || '同步完成') : (r.output || '同步失败')
      test.className = 'dshd-test ' + (r.ok ? 'ok' : 'fail')
    })

    document.getElementById('dshd-browse').addEventListener('click', openBrowse)
    document.getElementById('dshd-b-up').addEventListener('click', () => loadBrowse(posixDirname(browsePath)))
    document.getElementById('dshd-b-home').addEventListener('click', () => loadBrowse('~'))
    document.getElementById('dshd-b-root').addEventListener('click', () => loadBrowse('/'))
    document.getElementById('dshd-b-select').addEventListener('click', () => {
      document.getElementById('f-dir').value = browsePath
      document.getElementById('dshd-browser').hidden = true
    })
    document.getElementById('dshd-b-cancel').addEventListener('click', () => {
      document.getElementById('dshd-browser').hidden = true
    })

    document.getElementById('dshd-ws-open').addEventListener('click', () => {
      document.getElementById('dshd-ws-browser').hidden = false
      loadWsBrowse('~')
    })
    document.getElementById('dshd-ws-up').addEventListener('click', () => loadWsBrowse(posixDirname(wsPath)))
    document.getElementById('dshd-ws-home').addEventListener('click', () => loadWsBrowse('~'))
    document.getElementById('dshd-ws-root').addEventListener('click', () => loadWsBrowse('/'))
    document.getElementById('dshd-ws-select').addEventListener('click', async () => {
      const r = await window.dshDesktop.connections.setWorkspace(wsPath)
      if (r.ok) {
        document.getElementById('dshd-ws-browser').hidden = true
        alert('已选择工作区：' + wsPath)
      } else {
        alert('设置工作区失败：' + (r.error || '未知错误'))
      }
    })
    document.getElementById('dshd-ws-cancel').addEventListener('click', () => {
      document.getElementById('dshd-ws-browser').hidden = true
    })

    document.getElementById('dshd-ssh-import').addEventListener('click', async () => {
      const picker = document.getElementById('dshd-ssh-picker')
      const list = document.getElementById('dshd-ssh-list')
      const hosts = await window.dshDesktop.ssh.hosts()
      if (!hosts || hosts.length === 0) {
        list.innerHTML = '<div class="dshd-browser-empty">未在 ~/.ssh/config 中找到主机。</div>'
      } else {
        list.innerHTML = hosts.map((h) => {
          const target = esc(h.user ? h.user + '@' : '') + esc(h.host) + ':' + esc(String(h.port))
          return '<div class="dshd-browser-item" data-name="' + esc(h.name) + '" data-host="' + esc(h.host) + '" data-user="' + esc(h.user) + '" data-port="' + esc(String(h.port)) + '" data-key="' + esc(h.identityFile) + '">🖥 ' + esc(h.name) + ' <span class="dshd-browser-empty">' + target + '</span></div>'
        }).join('')
      }
      picker.hidden = false
      list.querySelectorAll('.dshd-browser-item').forEach((el) => {
        el.addEventListener('click', () => {
          document.getElementById('f-name').value = el.getAttribute('data-name')
          document.getElementById('f-alias').value = el.getAttribute('data-name')
          document.getElementById('f-host').value = el.getAttribute('data-host')
          document.getElementById('f-user').value = el.getAttribute('data-user')
          document.getElementById('f-port').value = el.getAttribute('data-port')
          document.getElementById('f-identity').value = el.getAttribute('data-key')
          picker.hidden = true
        })
      })
    })
    document.getElementById('dshd-ssh-cancel').addEventListener('click', () => {
      document.getElementById('dshd-ssh-picker').hidden = true
    })

    // initial status
    window.dshDesktop.info().then((info) => {
      if (info && info.mode) setStatus(info.mode, info.url ? 'ready' : 'starting')
    }).catch(() => {})

    // live status
    if (window.dshDesktop.onStatus) {
      window.dshDesktop.onStatus((s) => {
        if (!s) return
        setStatus(s.mode || '本机', s.state)
      })
    }

    injectSidebarEntry()
    injectProjectSwitcher()
    injectWsDialogNav()
    injectWorkspaceStatusLight()
    markWorkspaceRows()
    checkUpdateBanner()
    setTimeout(() => { injectSidebarEntry(); injectProjectSwitcher() }, 300)
    setTimeout(() => { injectSidebarEntry(); injectProjectSwitcher() }, 1200)
    new MutationObserver(() => {
      injectSidebarEntry()
      injectProjectSwitcher()
      injectWsDialogNav()
      injectWorkspaceStatusLight()
      markWorkspaceRows()
    }).observe(document.body, { childList: true, subtree: true })

    renderList()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
