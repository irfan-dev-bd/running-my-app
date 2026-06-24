# Phase 4 — Polish and Scale

**Goal**: Improve long-term maintainability, code quality, extensibility, and developer experience for contributors. These are investments in the codebase itself, not user features.  
**Effort**: Ongoing / 2–4 weeks  
**Architecture impact**: High for server refactor; Low for frontend improvements  
**Approach**: Can be done incrementally — each section is independent

---

## 4.1 Split server.js into Focused Modules

**Problem**: `server.js` is 776 lines handling HTTP routing, WebSocket, process management, git operations, port scanning, and file serving all in one file. Hard to navigate and test.

### Target structure

```
lib/
  processManager.js    # spawn, kill, restart, runtime state Map
  portScanner.js       # netstat/ss/lsof detection, external sync
  gitHelper.js         # branch, dirty, behind — all git ops
  wsServer.js          # WebSocket upgrade, broadcast, client registry
  api/
    appsRouter.js      # /api/apps routes
    configRouter.js    # /api/config routes
    fsRouter.js        # /api/fs routes
    setupRouter.js     # /api/setup routes
server.js              # wire up Express + ws, mount routers (~100 lines)
```

### Migration plan

1. Extract `processManager.js` first (most isolated, highest value)
2. Extract `portScanner.js` next
3. Then `gitHelper.js`
4. Then route files
5. Keep `server.js` as the entry point wiring everything together

### Risk
Medium-high if done all at once. Low if done module-by-module with the app running between each extraction.

---

## 4.2 Configurable Constants (No More Hardcodes)

**Problem**: Several important values are hardcoded in `server.js`:
- `MAX_LOG_LINES = 500`
- `PORT_CHECK_TIMEOUT_MS = 500`
- `EXTERNAL_SYNC_INTERVAL_MS = 10000`
- `BRANCH_REFRESH_INTERVAL_MS = 30000`

**Fix**: Move all tunables into a `lib/constants.js` that reads from:
1. `dashboard.settings` config block (user-visible)
2. Environment variables (override for power users)
3. Hardcoded defaults (fallback)

```js
// lib/constants.js
export const MAX_LOG_LINES = parseInt(process.env.RS_MAX_LOG_LINES) || config?.dashboard?.logLines || 500
```

### Files
`lib/constants.js` (new), `server.js`, `lib/config.js`

---

## 4.3 Frontend JS Module System

**Problem**: All frontend JS runs in global scope (`app.js`, `settings.js`, `config-editor.js`). No imports/exports. Functions from one file can accidentally collide with another. Hard to maintain as files grow.

**Fix**: Convert `public/*.js` to use native ES modules (`<script type="module">`). No bundler needed — modern browsers support it natively.

### Migration plan

1. Add `type="module"` to script tags in HTML files
2. Add `export` to functions used across files
3. Add `import` to consuming files
4. Remove any remaining global state (window.xxx) from JS files

### Risk
Medium. Must test in Chrome/Firefox/Edge. IE is not supported per CLAUDE.md.

---

## 4.4 Dark Mode / Theme Support

**Problem**: Dashboard has hardcoded light theme colors in `styles.css`. No respect for OS dark mode preference.

**Fix**:
- Refactor `styles.css` to use CSS custom properties (`--bg`, `--text`, `--border`, `--accent`)
- Add `@media (prefers-color-scheme: dark)` block that overrides variables
- Add a manual toggle button in dashboard header (persisted in localStorage)

### Files
`public/styles.css`, `public/index.html`, `public/app.js` (theme toggle logic)

### Risk
Low. CSS variable refactor is mechanical.

---

## 4.5 Structured Error Handling

**Problem**: Errors in WS handlers and route handlers are logged via `console.error` but not surfaced to the user in a consistent way.

**Fix**:
- Add Express error middleware that catches unhandled route errors and returns `{ error: message }` JSON
- Add a WS `error` event type the frontend handles — displays as a dismissable notification banner
- Wrap all WS send calls in try/catch (in case client disconnected mid-send)
- Log errors with a consistent format: `[ERROR] [timestamp] [route/handler] message`

### Files
`server.js`, `public/app.js`

---

## 4.6 Request Validation Middleware

**Problem**: Route handlers directly access `req.body` fields without type checking or sanitization. A malformed request body can cause runtime errors.

**Fix**: Add a lightweight schema-check function (no new dependencies) used in each route:

```js
function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined) throw new Error(`Missing field: ${f}`)
  }
}
```

Apply to all `POST/PUT` routes that accept JSON bodies.

### Files
`server.js` (and router files after 4.1)

---

## 4.7 Graceful Shutdown

**Problem**: When `server.js` is killed (Ctrl+C or process manager), managed child processes may be left running. Current SIGTERM handler stops apps, but there's no timeout — if apps don't stop in 5s, they orphan.

**Fix**:
- Existing SIGTERM handler: add 8-second timeout; after that, `SIGKILL` remaining processes
- Send WS event `{ type: 'server-shutdown' }` to clients before closing — client shows "Server offline" banner and stops reconnecting temporarily
- On `SIGINT`, flush log buffers to disk before exit

### Files
`server.js`, `public/app.js`

---

## 4.8 User-Defined Templates

**Problem**: Templates are bundled with the app. Users can't share their own stack configs as templates.

**Fix**:
- New endpoint: `POST /api/templates/save` — takes current config and a name; saves to `{appDataDir}/templates/{name}.json`
- New endpoint: `DELETE /api/templates/:id`
- `GET /api/templates` merges built-in templates with user-saved ones (user templates marked with `"source": "user"`)
- Settings template browser: Show user templates separately, with delete button

### Files
`lib/templates.js`, `server.js`, `public/settings.html`, `public/settings.js`

---

## 4.9 Comprehensive Logging (Server-Side)

**Problem**: `console.log` and `console.error` throughout `server.js` with no levels, no timestamps, no filtering.

**Fix**: Add a minimal `lib/logger.js` (no deps):

```js
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const level = LEVELS[process.env.RS_LOG_LEVEL] ?? LEVELS.info

export function log(lvl, ...args) {
  if (LEVELS[lvl] >= level) {
    console[lvl === 'debug' ? 'log' : lvl](`[${new Date().toISOString()}] [${lvl.toUpperCase()}]`, ...args)
  }
}
```

Replace all `console.log/error` with `log('info', ...)` / `log('error', ...)`.

### Files
`lib/logger.js` (new), all files using `console.*`

---

## 4.10 Performance: Debounce Config Reload

**Problem**: Hot-reloading config on file change (if implemented) or rapid reload-button clicks can cause race conditions as apps restart.

**Fix**:
- Debounce the config reload handler by 500ms (already done for WS broadcasts, apply same pattern here)
- Lock `isReloading` flag during reload; reject concurrent reload requests with a `409 Conflict`
- Surface lock state in UI as a loading indicator on the "Reload Config" button

### Files
`server.js`, `public/app.js`

---

## Acceptance Criteria for Phase 4

- [ ] `server.js` is < 150 lines; all logic lives in extracted modules
- [ ] All hardcoded constants are in `lib/constants.js` with env var overrides
- [ ] Frontend JS files use `type="module"` with no global scope pollution
- [ ] Dashboard respects `prefers-color-scheme` and has a manual theme toggle
- [ ] All Express route errors return consistent `{ error }` JSON; WS errors show banner
- [ ] All POST/PUT routes validate required fields before processing
- [ ] Ctrl+C cleanly stops all managed processes within 8 seconds, flushing logs
- [ ] Users can save, browse, and delete their own named templates
- [ ] `RS_LOG_LEVEL` env var controls server log verbosity
- [ ] Reload Config button is disabled and shows spinner during active reload
