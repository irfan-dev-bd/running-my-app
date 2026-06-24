# Reg-Starter

## What This Project Is

A local developer dashboard for managing multiple services from one browser UI. No login, no cloud, no build step. Config is stored as JSON in the user's OS data directory. Real-time updates via WebSocket.

## How to Run

```bash
npm install
npm start          # starts at http://localhost:9999
```

Environment overrides:
- `PORT` — change the dashboard port (default 9999)
- `REG_STARTER_CONFIG` — full path to override config file location
- `REG_STARTER_NO_OPEN=1` — skip auto-opening the browser

Config is stored at:
- Windows: `%APPDATA%\Reg-Starter\apps.json`
- macOS: `~/Library/Application Support/Reg-Starter/apps.json`
- Linux: `~/.config/reg-starter/apps.json`

No tests, no build step. Changes to files in `public/` take effect on refresh.

## Architecture

```
server.js          # Single Express + WebSocket server (~660 lines)
lib/
  config.js        # Config read/write, normalize, validate
  paths.js         # Platform-specific config directory resolution
  templates.js     # Load templates from templates/manifest.json
  fsBrowse.js      # Safe directory listing (restricted roots)
public/
  index.html       # Dashboard SPA
  setup.html       # First-run setup wizard
  settings.html    # Config editor
  app.js           # Dashboard frontend logic (WebSocket client, UI)
  setup.js         # Setup wizard logic
  settings.js      # Settings editor logic
  config-editor.js # JSON editor with validation
  styles.css       # All CSS (no preprocessor)
templates/
  manifest.json    # Template registry
  *.json           # Starter configs (minimal, multi-service, example-stack)
```

## Stack

- **Backend**: Node.js 18+, Express 4, `ws` for WebSocket, optional `node-pty`
- **Frontend**: Vanilla JS, HTML5, CSS3 — no framework, no bundler
- **Process management**: `child_process.spawn`, platform-aware kill (`taskkill` on Windows, `kill -TERM` on Unix)
- **Config**: Plain JSON file, in-memory process state (not persisted across restarts)

## Key Patterns

**Process lifecycle**: Apps are spawned as child processes tracked in a `Map<appId, runtime>` in memory. On server restart, in-memory state is lost — use "Rescan Ports" to detect already-running processes.

**WebSocket broadcast**: All status and log updates are pushed server → all connected clients via `broadcast()`. The frontend never polls; it reacts to WS messages.

**Config flow**: `normalizeConfig()` slugifies IDs and deduplicates, then `validateConfig()` checks required fields and port ranges. Warnings don't block save; errors do.

**Port detection**: Uses `netstat` on Windows, `ss`/`lsof` on Unix to find external processes on monitored ports.

**Frontend terminal output**: ANSI escape sequences are parsed client-side via `ansiToHtml()` in `app.js`. Max 500 log lines per app kept in memory server-side.

**Git branch display**: Cached per-app with a 30-second TTL, read via `git branch --show-current`.

## REST API

```
GET  /api/setup/status
GET  /api/templates              GET /api/templates/:id
GET  /api/config/full            PUT /api/config         DELETE /api/config
POST /api/config/validate
GET  /api/fs/browse
GET  /api/apps
POST /api/apps/:id/start         POST /api/apps/:id/stop    POST /api/apps/:id/restart
POST /api/start-all
POST /api/group/:type/:action    # type = app.type field; action = start|stop
POST /api/rescan-ports
POST /api/refresh-branches
WS   /                           # real-time status + logs
```

## Apps Config Schema

```json
{
  "dashboard": {
    "title": "My Dev Stack",
    "subtitle": "optional subtitle",
    "logPrefix": "optional",
    "configFile": "optional display path"
  },
  "apps": [
    {
      "id": "my-api",
      "name": "My API",
      "path": "C:/projects/my-api",
      "command": "npm run dev",
      "port": 3000,
      "type": "backend"
    }
  ]
}
```

Fields `port` and `type` are optional. `type` enables group start/stop via the `/api/group/:type/:action` endpoint.

## Windows-Specific Notes

- Shell: `cmd.exe` with `chcp 65001` prepended to commands for UTF-8
- Process tree kill: `taskkill /PID <pid> /T /F`
- System PID 4 is blocked from kill operations
- File browsing roots: home directory + all drive letters (C:\, D:\, etc.)

## What to Watch Out For

- `server.js` is monolithic — all HTTP routes and WebSocket handlers live there. `lib/` is purely utility.
- No authentication by design. This is a local-only tool.
- `public/` files are served as static assets — no transpilation. Keep JS ES2020-compatible (the target is modern browsers only, no IE).
- If editing `config.js`, the `normalizeConfig` → `validateConfig` → `writeConfig` pipeline must stay intact; callers depend on this order.
- The frontend reconnects to WebSocket with exponential backoff — don't break the WS upgrade path in `server.js`.
