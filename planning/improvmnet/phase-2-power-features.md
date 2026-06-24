# Phase 2 — Power Features

**Goal**: Fill the most critical gaps in local dev workflows — environment variables, log persistence, health checks, auto-restart, and UI refinements that require config schema changes.  
**Effort**: 1–2 weeks  
**Config schema change**: Yes — additive only (old configs stay valid)  
**New endpoints**: Yes  
**New files**: `lib/logStore.js`, possibly `lib/healthCheck.js`

---

## 2.1 Environment Variable Support

**Problem**: Can't pass env vars to spawned processes from the config. Users must rely on system env, `.env` files, or pre-wrap commands.

### Config schema addition

```json
{
  "dashboard": { "env": { "NODE_ENV": "development" } },
  "apps": [
    {
      "id": "api",
      "env": { "PORT": "3001", "DB_URL": "postgres://localhost/dev" }
    }
  ]
}
```

Dashboard-level `env` is a base; app-level `env` overrides per key.

### Implementation

- `lib/config.js`: Accept `env` object on dashboard and each app; pass through `normalizeConfig` as-is
- `server.js` spawn: Merge `process.env + config.dashboard.env + app.env` into the child process `env` option
- `public/config-editor.js`: Add env var editor — key/value rows with add/remove buttons, same pattern as app rows

### Files
`lib/config.js`, `server.js`, `public/config-editor.js`, `public/settings.js`, `public/styles.css`

### Risk
Medium. Env merging logic must be careful not to leak or override critical vars (PATH, SYSTEMROOT on Windows).

---

## 2.2 Auto-Restart on Crash

**Problem**: If a service crashes (non-zero exit), it stays stopped. For dev workflows, services should restart automatically (like `nodemon` or PM2's watch mode).

### Config schema addition

```json
{
  "id": "api",
  "restart": "on-failure",   // "never" | "on-failure" | "always"
  "restartDelay": 2000,      // ms before restart attempt
  "maxRestarts": 5           // give up after N restarts within a rolling window
}
```

### Implementation

- `server.js`: On process `close` event, check `app.restart` and `restartCount`
- Use exponential backoff: delay doubles each restart (cap at 30s)
- After `maxRestarts` in 60s window, mark as `crashed` and stop retrying; send WS `status` event
- Show restart count as a badge on the app card

### Files
`server.js` (process lifecycle), `public/app.js` (status badge), `public/styles.css`

### Risk
Medium. Must handle the case where the user manually stops an "always-restart" app cleanly (set an intent flag).

---

## 2.3 Log Persistence to Disk

**Problem**: All logs are in-memory — lost on dashboard restart. Can't review what happened to a service that crashed overnight.

### Implementation

- New file: `lib/logStore.js`
  - `writeLog(appId, line)` — appends to `{appDataDir}/logs/{appId}.log`
  - `readLog(appId, tail = 500)` — reads last N lines
  - `clearLog(appId)` — truncates file
  - `archiveLog(appId)` — renames current log to `{appId}-{timestamp}.log`
- `server.js`: Call `writeLog` on every log push; call `readLog` on dashboard connect to pre-populate terminal
- New endpoint: `GET /api/apps/:id/logs?tail=200` — stream log file lines as JSON array
- New endpoint: `DELETE /api/apps/:id/logs` — clear log file

### Files
`lib/logStore.js` (new), `server.js`, `public/app.js` (initial log hydration on panel open)

### Risk
Low-medium. Must handle log file locking on Windows (test with concurrent writes).

---

## 2.4 Health Checks

**Problem**: "Running" means the process started. It doesn't mean the service is actually accepting connections. A service that crashes during init shows as "running" until the process exits.

### Config schema addition

```json
{
  "id": "api",
  "healthCheck": {
    "url": "http://localhost:3001/health",
    "interval": 10000,
    "timeout": 2000
  }
}
```

### Implementation

- `server.js`: After process start, begin polling `healthCheck.url` with `fetch` (or Node's `http.get`)
- Three health states: `starting`, `healthy`, `unhealthy`
- Send WS `health` event on state change; client renders as a colored dot on the card
- Stop polling when process stops

### Files
`server.js`, `public/app.js` (health indicator), `public/styles.css`, `lib/config.js` (schema)

### Risk
Low. Polling is additive; apps without `healthCheck` skip it entirely.

---

## 2.5 Pre-Start and Post-Stop Commands

**Problem**: Many dev workflows need setup before start (run migrations, seed DB) or cleanup after stop (reset state, kill child ports).

### Config schema addition

```json
{
  "id": "api",
  "hooks": {
    "preStart": "npm run migrate",
    "postStop": "npm run clean"
  }
}
```

### Implementation

- `server.js` start handler: Run `preStart` command (same spawn logic) and wait for exit 0 before spawning main process. Send log output tagged as `[hook]`.
- `server.js` stop handler: After process dies, run `postStop` and wait.
- If `preStart` fails (non-zero exit), abort start and surface error.

### Files
`server.js`, `lib/config.js` (schema), `public/app.js` (hook status in logs), `public/config-editor.js`

### Risk
Medium. Hook failure must not leave app in ambiguous state. Need clear status transitions: `pre-start → starting → running`.

---

## 2.6 Config Backup and Undo

**Problem**: Saving a config is destructive — the previous state is gone. One bad import can wipe a working config.

### Implementation

- `lib/config.js` `writeConfig()`: Before overwriting, copy current file to `{appDataDir}/backups/apps-{timestamp}.json` (keep last 10 backups)
- New endpoint: `GET /api/config/backups` — list backups with timestamps
- New endpoint: `POST /api/config/restore/:timestamp` — restore backup to active config
- Settings page: Add "Restore backup" section showing last 10 dated backups with a restore button each

### Files
`lib/config.js`, `server.js`, `public/settings.html`, `public/settings.js`

### Risk
Low. Purely additive. Backup logic runs after successful validate.

---

## 2.7 "Open in Editor" per App

**Problem**: Navigating to an app's directory in VS Code or another editor requires copying the path and opening it manually.

### Config schema addition

None needed — use `app.path`.

### Implementation

- New endpoint: `POST /api/apps/:id/open-editor` — runs `code "{app.path}"` (detect VS Code via `code --version`; fallback: open directory in OS file explorer)
- Dashboard card: Add an "Open in Editor" icon button (small, alongside Start/Stop)
- Settings page: Allow configuring the editor command globally (e.g., `code`, `cursor`, `webstorm`)

### Files
`server.js`, `public/index.html`, `public/app.js`, `public/settings.html`, `public/styles.css`

### Risk
Low. Shell `code` command is common. Graceful fallback if not found.

---

## 2.8 Configurable Log Buffer Size

**Problem**: `MAX_LOG_LINES = 500` is hardcoded. Long-running services with verbose output hit this quickly.

### Implementation

- Add `dashboard.logLines` to config schema (default 500, max 5000)
- `server.js`: Use `config.dashboard.logLines ?? 500` in log trim logic
- Settings form: Add a "Log buffer size" numeric input to dashboard settings

### Files
`server.js`, `lib/config.js`, `public/config-editor.js`

### Risk
None. Fully backward-compatible.

---

## Acceptance Criteria for Phase 2

- [ ] Apps spawn with merged env vars from config; verified via log output showing process env
- [ ] Crashed apps with `restart: "on-failure"` restart automatically with exponential backoff
- [ ] Restart count shown on card; app enters `crashed` state after `maxRestarts` exceeded
- [ ] Logs persist to disk; re-opening terminal panel after server restart shows previous output
- [ ] Health check URL polling changes badge dot from yellow to green/red
- [ ] `preStart` hook runs and logs before main process; failed hook aborts start
- [ ] Every config save creates a timestamped backup; backups visible in settings
- [ ] "Restore backup" swaps active config and reloads dashboard
- [ ] "Open in Editor" button runs `code <path>` from app card
- [ ] `logLines` setting controls buffer size across apps
