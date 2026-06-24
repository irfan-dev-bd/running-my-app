# Phase 3 — Workflow Integration

**Goal**: Make Reg-Starter a first-class local dev orchestration tool — startup ordering, workspace switching, resource monitoring, and tighter integration with the dev environment.  
**Effort**: 2–4 weeks  
**Architecture impact**: Medium — introduces concept of "workspace" and "dependency graph"; requires new state tracking  
**New files**: `lib/workspaces.js`, `lib/dependencyGraph.js`, `lib/portForward.js` (optional)

---

## 3.1 App Startup Dependencies (Ordered Start)

**Problem**: Dev stacks often have ordering requirements: DB must be running before API, API before frontend proxy. Today all apps start in config order with no waiting.

### Config schema addition

```json
{
  "id": "api",
  "dependsOn": ["postgres", "redis"]
}
```

### Implementation

- `lib/dependencyGraph.js`: Build directed graph from `dependsOn` fields; detect cycles (error on save); produce topological start order
- `server.js` `/api/start-all`: Use topological order; wait for each layer to reach `healthy` (or just `running` if no health check) before starting next layer
- `server.js` individual start: Warn (but don't block) if dependencies are stopped
- Dashboard UI: Show dependency arrows or indented grouping in card layout for apps that have `dependsOn`

### Files
`lib/dependencyGraph.js` (new), `server.js`, `lib/config.js` (schema), `public/app.js`

### Risk
High. Cycle detection is critical. Long startup chains could time out. Must define what "ready" means per-layer clearly.

---

## 3.2 Workspace / Config Profiles

**Problem**: A developer may work on multiple projects or need different configs for different contexts (frontend only vs full stack, staging ports vs dev ports). Currently only one config file exists.

### Implementation

- `lib/workspaces.js`: Manages a `workspaces.json` file listing named config paths
  - `list()` — returns [{name, path, active}]
  - `switch(name)` — updates active workspace pointer
  - `create(name, path)` — registers a new named config
- Dashboard toolbar: Add a workspace switcher dropdown (top bar) showing current workspace name
- New endpoints:
  - `GET /api/workspaces`
  - `POST /api/workspaces/switch` (body: `{name}`)
  - `POST /api/workspaces/create` (body: `{name, path}`)
- On switch: stop all running apps, load new config, broadcast reload event to all clients

### Files
`lib/workspaces.js` (new), `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`

### Risk
Medium. Switching workspace while apps are running must stop them cleanly. Must handle invalid/missing config paths.

---

## 3.3 Resource Usage Monitor (CPU / Memory)

**Problem**: No visibility into how much CPU or memory each managed process is consuming. Can't identify runaway services.

### Implementation

- `server.js`: Every 5 seconds, call `pidusage(pid)` (via `pidusage` npm package, or native `tasklist /FO CSV` on Windows / `/proc/{pid}/stat` on Linux) to get CPU % and RSS memory
- Push as WS event: `{ type: 'stats', appId, cpu, memory }` 
- Dashboard card: Add a small stats bar under each running app showing `CPU: 2% | Mem: 128MB`
- Add optional alert threshold to config: if CPU > N% for > 30s, send a warning banner

### New dependency
`pidusage` (tiny npm package, no native deps) or implement via `child_process` calls for zero-dep approach

### Files
`server.js`, `package.json`, `public/app.js`, `public/styles.css`

### Risk
Low-medium. PID tracking must match the actual spawned PID (not shell wrapper PID). Test on Windows with cmd.exe spawning.

---

## 3.4 Multi-Select App Actions

**Problem**: Starting or stopping specific subsets of apps requires clicking each card individually. Group controls only work by type.

### Implementation

- Dashboard: Add a checkbox to each app card (hidden by default; visible on hover or toggle mode)
- Selection toolbar appears at top when any cards checked: "Start selected", "Stop selected", "Restart selected"
- New endpoints:
  - `POST /api/apps/bulk` — body: `{ ids: ['api', 'db'], action: 'start' }`
- Keyboard: `Ctrl+Click` to add to selection; `Escape` to deselect all

### Files
`server.js` (bulk endpoint), `public/app.js`, `public/index.html`, `public/styles.css`

### Risk
Low. Bulk endpoint just calls existing per-app start/stop in order.

---

## 3.5 Git Integration Enhancements

**Problem**: Current git display shows branch name only. Dev workflows often need to know if there are uncommitted changes or if the branch is behind remote.

### Implementation

- `server.js` git check: Alongside `git branch --show-current`, also run:
  - `git status --short` → parse M/? counts for "dirty" indicator  
  - `git rev-list HEAD..@{u} --count 2>/dev/null` → commits behind remote
- WS event: Extend `branch` event with `{ branch, dirty: bool, behind: N }`
- Dashboard card: Show branch name + small icons: pencil (dirty), down-arrow+count (behind remote)

### Files
`server.js`, `public/app.js`, `public/styles.css`

### Risk
Low. New fields are additive; old UI ignores unknowns. Git commands are async already.

---

## 3.6 All-App Log Stream ("Tail All")

**Problem**: When debugging cross-service issues, you want to see all services' logs interleaved by time — like `docker-compose logs -f`.

### Implementation

- Dashboard: Add "All" tab to the terminal panel that shows a merged stream from all apps
- Each line prefixed with `[app-name]` colored by a per-app color (generated from ID hash)
- Log lines for already-running apps pre-populated from disk (Phase 2 persistence) or memory buffers
- WS: "All" tab subscribes to all `log` events; existing tab filter by `appId` unchanged

### Files
`public/app.js`, `public/index.html`, `public/styles.css`

### Risk
Low. Client-side change only — "All" tab is just an unfiltered view of existing WS stream.

---

## 3.7 Quick Command Runner

**Problem**: Dev workflows often involve one-off commands: `npm run db:seed`, `git pull`, `docker ps`. Today, you'd need a separate terminal.

### Implementation

- Dashboard: Add "Run Command" panel (collapsible, below terminal or in a modal)
- Fields: Select app (to set cwd), command input, "Run" button
- Output streams to a temporary terminal tab labeled `[run: command]`
- History: Last 20 commands stored in localStorage; accessible via ↑ arrow

### Files
`server.js` (new `POST /api/run` endpoint — runs command in app's cwd, streams output via WS), `public/app.js`, `public/index.html`, `public/styles.css`

### Risk
Medium. Arbitrary command execution via API. Since this is localhost-only, risk is acceptable, but document clearly.

---

## 3.8 .env File Support

**Problem**: Most Node/Python/Go apps load a `.env` file in their working directory. Reg-Starter has no way to reference or manage these.

### Implementation

- Config schema: Add `envFile: ".env"` to app config (relative to `app.path` or absolute)
- `server.js` spawn: Parse `app.envFile` with a simple `KEY=VALUE` line parser (no new deps); merge into spawn env after `dashboard.env` but before `app.env`
- Settings editor: Show detected `.env` file path; add a "View .env keys" button (shows key names only, not values, for security)

### Files
`lib/config.js`, `server.js`, `public/config-editor.js`

### Risk
Low. Parser is simple; only loaded at spawn time. Do NOT log env values.

---

## Acceptance Criteria for Phase 3

- [ ] `dependsOn` apps wait for dependency `running` status before spawning
- [ ] Cycle detection in dependency graph surfaces as validation error on config save
- [ ] Workspace switcher shows list of named configs; switching stops all apps and reloads
- [ ] CPU % and memory MB shown on each running app card, updated every 5s
- [ ] Checkbox multi-select on cards enables "Start/Stop selected" bulk action
- [ ] Git dirty indicator (pencil icon) appears when `git status --short` returns changes
- [ ] "Commits behind" counter shown when branch is behind remote
- [ ] "All" terminal tab shows merged log stream from all apps with `[name]` prefix
- [ ] Quick Command Runner runs arbitrary command in app cwd and streams output
- [ ] `.env` file loaded at spawn time; keys (not values) visible in settings
