# Phase 1 — Quick Wins

**Goal**: Improve day-to-day usability with minimal risk. No new dependencies, no config schema changes, no API changes.  
**Effort**: 1–3 days total  
**Files changed**: Mostly `public/` (frontend only, no server restart needed)

---

## 1.1 Clickable Port Badges → Open App in Browser

**Problem**: When a service is running on a known port, there's no one-click way to open it.  
**Fix**: Wrap the port badge in an `<a href="http://localhost:{port}" target="_blank">` when status is `running`.  
**Files**: `public/index.html`, `public/app.js` (card rendering)  
**Risk**: None. Pure HTML change.

---

## 1.2 Log Timestamps

**Problem**: Terminal output has no timestamps — can't tell when a line was emitted or how long startup took.  
**Fix**: In `server.js`, prepend ISO timestamp to each log entry in the `logsByApp` buffer. In `app.js`, render it as a muted prefix column.  
**Files**: `server.js` (around `logsByApp` push), `public/app.js` (log line render), `public/styles.css`  
**Risk**: Low. Adds a field to log entries; old frontend ignores unknown fields gracefully.

---

## 1.3 Terminal "Follow" Toggle

**Problem**: Terminal auto-scrolls to bottom on every new line. You can't read earlier output without it jumping away.  
**Fix**: Add a "Pause scroll" button in the terminal header. When paused, new lines still render but scroll position doesn't change. Re-enable on click or when user manually scrolls to bottom.  
**Files**: `public/index.html` (terminal header), `public/app.js` (scroll logic)  
**Risk**: None.

---

## 1.4 Terminal Search / Filter

**Problem**: No way to find a specific log line in noisy output.  
**Fix**: Add an input field above the terminal panel. On keyup, highlight matching lines (CSS class) and hide non-matching ones. Clear filter restores full view.  
**Files**: `public/index.html`, `public/app.js`, `public/styles.css`  
**Risk**: None. Client-side filter over already-rendered HTML.

---

## 1.5 Unread Log Badge on Terminal Tabs

**Problem**: If another app's tab has new output, there's no indication.  
**Fix**: When a log message arrives for an app whose terminal tab is not active, increment a counter shown as a red badge on the tab. Clear on tab focus.  
**Files**: `public/app.js` (WS message handler), `public/styles.css`  
**Risk**: None.

---

## 1.6 Log Export (Plaintext)

**Problem**: "Copy" button copies full terminal to clipboard. No file download option.  
**Fix**: Add "Export .txt" button that triggers a Blob download with all current log lines as plaintext.  
**Files**: `public/app.js`, `public/index.html`  
**Risk**: None. Uses standard browser `URL.createObjectURL`.

---

## 1.7 App Search / Filter Bar

**Problem**: With many apps, finding one requires scrolling through all type groups.  
**Fix**: Add a filter input at the top of the app grid. On input, hide cards whose name doesn't match. Show "no results" if all hidden.  
**Files**: `public/index.html`, `public/app.js`, `public/styles.css`  
**Risk**: None.

---

## 1.8 Keyboard Shortcuts

**Problem**: Power users must click to start/stop. No keyboard-driven workflow.  
**Fix**: Add global keyboard shortcuts documented in a tooltip:
- `Ctrl+Shift+S` → Start All
- `Ctrl+Shift+X` → Stop All
- `Ctrl+Shift+R` → Restart All  
- `Ctrl+Shift+F` → Focus app search  
- `Escape` → Close terminal / clear search

**Files**: `public/app.js` (keydown listener), `public/index.html` (tooltip)  
**Risk**: Low. Must ensure shortcuts don't conflict with browser defaults.

---

## 1.9 Port Conflict Warning Before Start

**Problem**: If a port is already occupied by a non-managed process, start fails silently (or shows a cryptic error in logs).  
**Fix**: Before `spawn()`, check if the port is in use. If yes and PID is unknown (not managed), send a WS warning event with a notification banner. Let user proceed or cancel.  
**Files**: `server.js` (start handler), `public/app.js` (notification banner)  
**Risk**: Low. Port check is already done periodically; reuse the same logic.

---

## 1.10 "Clear All Logs" Per App

**Problem**: Clear button in terminal header clears the visible terminal, but the server still holds the 500-line buffer — logs reappear on panel reopen.  
**Fix**: Clear button sends `POST /api/apps/:id/clear-logs` (new endpoint). Server empties `logsByApp` for that app and broadcasts a `log-clear` WS event.  
**Files**: `server.js` (new endpoint), `public/app.js` (clear button handler)  
**Risk**: Low. Additive endpoint.

---

## Acceptance Criteria for Phase 1

- [ ] Port badges link to `http://localhost:{port}` when app is running
- [ ] Each log line has a muted timestamp prefix
- [ ] Terminal scroll pause/resume works without losing any lines
- [ ] Filter input narrows visible log lines in real time
- [ ] Unread badge appears on inactive terminal tabs and clears on focus
- [ ] "Export .txt" downloads current terminal contents as a file
- [ ] App search hides non-matching cards
- [ ] At least 5 keyboard shortcuts work
- [ ] Pre-start port conflict shows a banner warning
- [ ] Clear logs empties server buffer and client display
