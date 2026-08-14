# DSH Desktop

A native macOS desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

DeepSeek Harness ships a web UI that you normally start from a terminal and open in
a browser. **DSH Desktop** turns that into a double-click desktop app, and layers on
the native conveniences you would expect from a desktop coding agent such as
Codex Desktop:

- **Managed backend** — starts/stops/restarts the `dsh web` server automatically,
  no terminal or `npx` required.
- **Native window + menus** — a real app window, standard macOS menu bar, and
  working Copy/Paste/Select-All shortcuts (which plain browsers handle for you).
- **Menu-bar / tray presence** — the backend keeps running in the background;
  show/hide the window from the tray, open new windows, or quit.
- **Multi-window** — open several windows against the same running backend.
- **Notifications** — "backend ready" and "backend stopped unexpectedly".
- **Global shortcut** — `Cmd+Shift+D` toggles the window (configurable).
- **Settings persistence** — window bounds, port, shortcut and more are saved to
  disk and editable as JSON.
- **Logging** — the backend's stdout/stderr is captured to a log file for
  debugging.
- **Remote connections (SSH)** — run the agent on a remote server and tunnel the
  UI back, so file reads/writes and commands all happen against the remote
  project (the equivalent of Codex's remote-devbox feature).
- **dsh-web-ui integration** — on first local launch the app installs the
  `dsh-web-ui` plugin suite (task board, Git graph, SSH panel, skin center,
  Blue Fantasy whale-girl skin, and related plugins) and enables the
  Blue Fantasy skin automatically.
- **DeepSeek billing badge** — the bundled
  `DeepSeek-Harness-billing-plugin` shows your real DeepSeek account balance
  and a per-model remaining-task estimate in the session header.

## Why DSH Desktop

- **A real macOS desktop app** — double-click to start, dock icon, native
  menus, tray, notifications and global shortcuts. No terminal session is left
  running just to keep the harness alive.
- **Remote project development, the Codex way** — connect to a server over SSH,
  browse and select a remote project directory with parent/root navigation,
  then keep coding exactly as if the project were local. Workspace entries show
  whether they are local or remote, together with a connection indicator.
- **Whale-girl desktop identity** — the bundled Blue Fantasy skin and the
  custom app icon turn the standard web UI into a distinctive macOS desktop
  experience.
- **Plugin suite included automatically** — task board, SSH panel, Git graph,
  skin center and related `dsh-web-ui` plugins are installed and loaded for you
  on first local launch.
- **Account balance at a glance** — once your DeepSeek API key is configured,
  each session header shows your live balance and an estimate of how many more
  tasks the current model can run.
- **Safe defaults for daily use** — the backend is managed and restartable,
  logs are captured, and remote ports are chosen automatically so separate dsh
  instances do not collide.

Everything inside the window is the **real DeepSeek Harness web UI**, so its full
feature set — sessions, plans, goals, sub-agents, terminal, file editing,
skills, workspaces and the append-only Trajectory view — works unchanged. The
native "Choose workspace" folder picker also works because the backend runs on
your Mac (via the `directory-picker-native` `osascript` backend).

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js ≥ 20 (used to run the `dsh` backend; the app falls back to Electron's
  own Node if `node` is not on `PATH`)

The backend is started with a real Node runtime. The app looks for `node` on
`PATH`, then in `/usr/local/bin`, `/opt/homebrew/bin`, `/opt/local/bin` and
`/usr/bin`, then through the login shell, before finally falling back to
Electron's bundled Node. This matters because Finder launches apps with a
minimal `PATH` that omits common Node install locations.

## Run from source

```sh
cd dsh-desktop
npm install
npm start
```

## Build a distributable app

```sh
npm run pack     # unpacked .app in dist/
npm run dist     # .dmg + .zip in dist/
```

To build without a code-signing identity:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

## First run

1. Launch the app. It starts the backend and opens the DeepSeek Harness UI.
2. Add a model API key at **Settings → Models** inside the UI (DeepSeek or any
   OpenAI-compatible endpoint).
3. Choose a workspace folder, then start a session.

The billing badge reads the same DeepSeek key. It appears in a session header
after a session is opened; if the key or endpoint is unavailable, the badge
shows an unavailable state instead of a balance.

## Remote connections (SSH)

This mirrors how Codex connects to a remote devbox: instead of running the agent
locally, DSH Desktop starts `dsh web` **on the remote machine inside the remote
project directory**, then opens an SSH tunnel and loads the remote UI locally.
Reads, writes, tests and shell commands therefore execute on the server.

To add one, open **远程连接** in the left sidebar (or
**DSH Desktop → Connections…**) and fill in:

- **Name** — a display label.
- **SSH host alias** — an entry from your local `~/.ssh/config` (recommended;
  it handles user, key and jump hosts for you), **or** Host / User / Port /
  Identity file directly.
- **Remote project directory** — the absolute path on the server (optional; if
  left empty the connection starts in the remote home directory).
- **Remote dsh command** — defaults to
  `npx -y @deepseek-ai/dsh@0.1.0-rc.6`; change to `dsh` if it is already
  installed on the remote PATH.
- **Remote port** — defaults to `0` (automatic). The app chooses a high
  ephemeral port and tunnels it to a free local port, so it does not collide
  with other dsh instances.

Requirements on the remote host:

- SSH access via a key or your local `ssh-agent` (password prompts are
  intentionally disabled for a non-interactive connection).
- Node.js ≥ 20, plus either `npx` (the default) or a pre-installed `dsh`.
- No fixed remote port is required when using the default `0`.

Click **Test connection** to verify SSH, Node, and the project directory before
connecting, then **Use** to activate it. The app tunnels
`127.0.0.1:<local-port>` → `127.0.0.1:<remote-port>` over SSH; the dsh `/api`
trust fence already accepts the loopback host, so no extra authentication is
needed for the tunnel.

> The same non-interactive-shell caveat as Codex applies: if your remote Node
> lives in a non-standard location (nvm, etc.), make sure it is on the PATH that
> the remote login shell loads (e.g. `.profile`/`.bash_profile`). The connection
> is started through the configured **Remote shell** (default `bash`) as a login
> shell for this reason.

## Configuration

Settings live in the app's data folder (macOS:
`~/Library/Application Support/DSH Desktop/settings.json`). Use
**DSH Desktop → Settings…** to reveal and edit the file. Relaunch after editing.

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `0` | Backend port; `0` lets the OS choose a free one. |
| `host` | `127.0.0.1` | Bind host. |
| `dshHome` | `""` | Empty = share `~/.dsh` with the CLI; set a path to isolate. |
| `shortcut` | `CommandOrControl+Shift+D` | Global show/hide shortcut. |
| `notifications` | `true` | Show desktop notifications. |
| `autoRestart` | `true` | Restart the backend if it exits unexpectedly. |

Environment overrides:

- `DSH_DESKTOP_NODE` — absolute path to a `node` binary to run the backend.
- `DSH_HOME` — ignored when `dshHome` is set; otherwise the backend's home.

## Architecture

`electron/main.js` boots the app and orchestrates the pieces. `electron/backend.js`
spawns `@deepseek-ai/dsh` locally (`dsh web --port <port>`) and watches its stdout
for the readiness line `dsh web: http://127.0.0.1:<port>`, then loads that URL into
the window. For a remote connection, `electron/remoteBackend.js` instead spawns
`ssh` with a local port forward and a remote command that runs `dsh web` in the
remote project directory, then maps the readiness line to the local tunneled URL.
The dsh UI is served by the backend over loopback HTTP, which the dsh `/api` trust
fence already accepts.

The dsh repository documents a deeper integration ("Electron loads the built
files over `file://` and sends fetch requests through an IPC bridge"). That is a
planned future optimization; the loopback-HTTP approach used here is functionally
equivalent for a local desktop app and much simpler.

## Notes

- DeepSeek Harness is an early developer preview (`0.1.0-rc.6`) with
  compatibility-breaking changes expected. The version is pinned in
  `package.json`; upgrade deliberately.
- The app intentionally keeps running in the menu bar after you close the
  window (like Codex). Quit with `Cmd+Q` or the tray menu.
- Not an official DeepSeek product. All DeepSeek Harness code is MIT-licensed.

## Troubleshooting

- **Window opens to a black screen** — the backend could not start. Check the
  log at `Help → Open Backend Logs` (or
  `~/Library/Application Support/DSH Desktop/logs/backend.log`). The most common
  cause is that no usable `node` was found; install Node.js ≥ 20 or set
  `DSH_DESKTOP_NODE` to an absolute `node` path.
