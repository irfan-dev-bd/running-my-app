const appGrid = document.getElementById('appGrid');
const terminalOutput = document.getElementById('terminalOutput');
const terminalTabs = document.getElementById('terminalTabs');
const terminalPanel = document.getElementById('terminalPanel');
const resizeHandle = document.getElementById('resizeHandle');
const layoutEl = document.querySelector('.layout');
const connectionStatus = document.getElementById('connectionStatus');
const totalCount = document.getElementById('totalCount');
const runningCount = document.getElementById('runningCount');
const stoppedCount = document.getElementById('stoppedCount');
const dashboardTitle = document.getElementById('dashboardTitle');
const dashboardSubtitle = document.getElementById('dashboardSubtitle');
const configFileName = document.getElementById('configFileName');
const toast = document.getElementById('toast');

let apps = [];
let dashboard = {
  title: 'App Dashboard',
  subtitle: 'Start, stop, and monitor local apps from one place',
  logPrefix: 'launcher',
  configFile: 'apps.json',
};
let selectedAppId = null;
/** @type {string[]} appIds whose terminal tab is open */
let openTerminals = [];
/** @type {Record<string, string[]>} */
const logsByApp = {};
let ws = null;
let reconnectTimer = null;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove('hidden', 'error');
  if (isError) toast.classList.add('error');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = await response.text();

  if (!isJson) {
    if (body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html')) {
      throw new Error(
        'Server returned a page instead of JSON. Restart the dashboard (npm start) and try again.'
      );
    }
    throw new Error(body.trim() || `Request failed (${response.status})`);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Server returned invalid JSON. Restart the dashboard and try again.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function applyDashboardConfig(nextDashboard) {
  if (!nextDashboard) return;
  dashboard = { ...dashboard, ...nextDashboard };
  document.title = dashboard.title;
  dashboardTitle.textContent = dashboard.title;
  dashboardSubtitle.textContent = dashboard.subtitle;
  configFileName.textContent = dashboard.configPath || dashboard.configFile;
}

function updateStats() {
  totalCount.textContent = String(apps.length);
  runningCount.textContent = String(apps.filter((a) => a.status === 'running').length);
  stoppedCount.textContent = String(
    apps.filter((a) => a.status === 'stopped' || !a.status).length
  );
}

function statusLabel(status) {
  return status || 'stopped';
}

const ANSI_PALETTE = [
  '#2d2d2d', '#cc3333', '#33aa33', '#aaaa33',
  '#5577dd', '#aa33aa', '#33aaaa', '#bbbbbb',
  '#666666', '#ff5555', '#55dd55', '#ffff55',
  '#7788ff', '#ff55ff', '#55dddd', '#ffffff',
];

function ansiToHtml(line) {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function idxToColor(idx) {
    if (idx < 16) return ANSI_PALETTE[idx];
    if (idx < 232) {
      const n = idx - 16;
      const r = Math.floor(n / 36) * 51;
      const g = Math.floor((n % 36) / 6) * 51;
      const b = (n % 6) * 51;
      return `rgb(${r},${g},${b})`;
    }
    const v = 8 + (idx - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }

  const segments = [];
  let fg = null, bg = null, bold = false, underline = false, dim = false;
  const re = /\x1b\[([0-9;]*)([A-Za-z])/g;
  let last = 0;

  for (const m of line.matchAll(re)) {
    if (m.index > last) {
      segments.push({ text: line.slice(last, m.index), fg, bg, bold, underline, dim });
    }
    last = m.index + m[0].length;

    if (m[2] !== 'm') continue;

    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    let i = 0;
    while (i < codes.length) {
      const c = codes[i];
      if (c === 0) { fg = null; bg = null; bold = false; underline = false; dim = false; }
      else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 4) underline = true;
      else if (c === 22) { bold = false; dim = false; }
      else if (c === 24) underline = false;
      else if (c >= 30 && c <= 37) fg = ANSI_PALETTE[c - 30];
      else if (c === 38) {
        if (codes[i + 1] === 5 && i + 2 < codes.length) { fg = idxToColor(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2 && i + 4 < codes.length) { fg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
      }
      else if (c === 39) fg = null;
      else if (c >= 40 && c <= 47) bg = ANSI_PALETTE[c - 40];
      else if (c === 48) {
        if (codes[i + 1] === 5 && i + 2 < codes.length) { bg = idxToColor(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2 && i + 4 < codes.length) { bg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
      }
      else if (c === 49) bg = null;
      else if (c >= 90 && c <= 97) fg = ANSI_PALETTE[c - 82];
      else if (c >= 100 && c <= 107) bg = ANSI_PALETTE[c - 92];
      i++;
    }
  }

  if (last < line.length) {
    segments.push({ text: line.slice(last), fg, bg, bold, underline, dim });
  }

  return segments.map(({ text, fg, bg, bold, underline, dim }) => {
    if (!text) return '';
    const style = [];
    if (fg) style.push(`color:${fg}`);
    if (bg) style.push(`background:${bg}`);
    if (bold) style.push('font-weight:bold');
    if (dim) style.push('opacity:0.6');
    if (underline) style.push('text-decoration:underline');
    const e = esc(text);
    return style.length ? `<span style="${style.join(';')}">${e}</span>` : e;
  }).join('');
}

const TERMINALS_KEY = 'regstarter.openTerminals';

function persistTerminals() {
  try {
    localStorage.setItem(
      TERMINALS_KEY,
      JSON.stringify({ open: openTerminals, selected: selectedAppId })
    );
  } catch {
    /* ignore */
  }
}

function isTerminalOpen(appId) {
  return openTerminals.includes(appId);
}

function openTerminal(appId) {
  if (!openTerminals.includes(appId)) openTerminals.push(appId);
  selectedAppId = appId;
  setCollapsed(false);
  persistTerminals();
  renderApps();
  renderTerminal(appId);
}

function closeTerminal(appId) {
  openTerminals = openTerminals.filter((id) => id !== appId);
  if (selectedAppId === appId) {
    selectedAppId = openTerminals[openTerminals.length - 1] || null;
  }
  persistTerminals();
  renderApps();
  if (selectedAppId) {
    renderTerminal(selectedAppId);
  } else {
    renderTerminalTabs();
    terminalOutput.innerHTML = '';
  }
}

function toggleTerminal(appId) {
  if (isTerminalOpen(appId)) {
    closeTerminal(appId);
  } else {
    openTerminal(appId);
  }
}

function openAllTerminals() {
  openTerminals = apps.map((a) => a.id);
  if (!selectedAppId || !openTerminals.includes(selectedAppId)) {
    selectedAppId = openTerminals[0] || null;
  }
  setCollapsed(false);
  persistTerminals();
  renderApps();
  if (selectedAppId) renderTerminal(selectedAppId);
}

function closeAllTerminals() {
  openTerminals = [];
  selectedAppId = null;
  persistTerminals();
  renderApps();
  renderTerminalTabs();
  terminalOutput.innerHTML = '';
}

async function copyActiveTerminal() {
  if (!selectedAppId) {
    showToast('No terminal selected', true);
    return;
  }
  const text = (logsByApp[selectedAppId] || []).join('\n');
  if (!text) {
    showToast('Terminal is empty', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Terminal output copied');
  } catch {
    // Fallback for non-secure contexts where the Clipboard API is blocked.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Terminal output copied');
    } catch {
      showToast('Copy failed', true);
    }
    document.body.removeChild(ta);
  }
}

function renderTerminalTabs() {
  if (openTerminals.length === 0) {
    terminalTabs.innerHTML =
      '<span class="terminal-empty">No terminal open — start an app or use the terminal button on a card</span>';
    return;
  }
  terminalTabs.innerHTML = openTerminals
    .map((id) => {
      const app = apps.find((a) => a.id === id);
      if (!app) return '';
      const status = statusLabel(app.status);
      return `
        <span class="term-tab status-${status} ${selectedAppId === id ? 'active' : ''}" data-id="${id}">
          <span class="term-tab-dot"></span>
          <span class="term-tab-name">${escapeHtml(app.name)}</span>
          <button class="term-tab-close" data-close="${id}" title="Close terminal" aria-label="Close terminal">${icon('x', 'icon-xs')}</button>
        </span>`;
    })
    .join('');
}

function renderTerminal(appId) {
  renderTerminalTabs();
  const lines = appId ? logsByApp[appId] || [] : [];
  terminalOutput.innerHTML = lines.map(ansiToHtml).join('\n');
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

const ICONS = {
  play: '<path fill="currentColor" stroke="none" d="M8 5v14l11-7z"/>',
  stop: '<rect fill="currentColor" stroke="none" x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',
  restart: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3"/><path d="M3 12A9 9 0 0 1 18.5 5.7"/><path d="M21 3v3.5h-3.5"/><path d="M3 21v-3.5h3.5"/>',
  branch:
    '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 10.4a6 6 0 0 1-6 6H8.4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<path d="M5 7l5 5-5 5"/><path d="M12 17h7"/>',
  port: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  send: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  power: '<path d="M12 3v9"/><path d="M6.6 7.6a8 8 0 1 0 10.8 0"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
};

function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

const TYPE_ICONS = { frontend: 'monitor', publisher: 'send', api: 'server', other: 'monitor' };

const TYPE_GROUPS = [
  { key: 'frontend', label: 'Frontend Apps', icon: 'monitor' },
  { key: 'api', label: 'APIs', icon: 'server' },
  { key: 'publisher', label: 'Publisher Frontend', icon: 'send' },
  { key: 'other', label: 'Other', icon: 'monitor' },
];

function inferType(app) {
  const hay = `${app.id || ''} ${app.path || ''} ${app.command || ''}`.toLowerCase();
  if (hay.includes('publisher')) return 'publisher';
  if (
    /\bdotnet\b/.test(hay) ||
    hay.includes('uvicorn') ||
    hay.includes('python') ||
    hay.includes('chatbot') ||
    /\bapi\b/.test(hay)
  ) {
    return 'api';
  }
  return 'frontend';
}

function groupApps(list) {
  const buckets = new Map();
  for (const app of list) {
    const key = (app.type || inferType(app)).toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(app);
  }

  const ordered = [];
  for (const group of TYPE_GROUPS) {
    if (buckets.has(group.key)) {
      ordered.push({ ...group, apps: buckets.get(group.key) });
      buckets.delete(group.key);
    }
  }
  // Any unknown types fall through, appended in insertion order.
  for (const [key, groupApps] of buckets) {
    ordered.push({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      icon: 'monitor',
      apps: groupApps,
    });
  }
  return ordered;
}

function renderAppCard(app) {
  const status = statusLabel(app.status);
  const isRunning = status === 'running';
  const isBusy = status === 'starting' || status === 'stopping';
  const type = (app.type || inferType(app)).toLowerCase();
  const typeIcon = TYPE_ICONS[type] || 'monitor';
  const termOpen = isTerminalOpen(app.id);

  const portPid = [
    app.port ? `${app.port}` : '',
    app.pid ? `PID ${app.pid}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');

  return `
    <article class="app-card ${selectedAppId === app.id ? 'selected' : ''}" data-id="${app.id}">
      <div class="app-card-header">
        <div class="app-card-id">
          <span class="app-avatar type-${type}">${icon(typeIcon)}</span>
          <h2 class="app-name">${escapeHtml(app.name)}</h2>
        </div>
        <span class="status-badge status-${status}">${status}</span>
      </div>
      <div class="branch-row">
        ${
          app.branch
            ? `<span class="branch-chip" title="Current git branch">${icon('branch', 'icon-xs')}<span class="branch-name">${escapeHtml(app.branch)}</span></span>`
            : `<span class="branch-chip branch-none" title="No git repository detected">no repo</span>`
        }
        <button class="branch-sync-btn" data-id="${app.id}" title="Sync git branch" aria-label="Sync git branch">${icon('sync', 'icon-xs')}</button>
      </div>
      <div class="app-meta">
        <span class="meta-row" title="${escapeHtml(app.path)}">${icon('folder', 'meta-ico')}<code>${escapeHtml(app.path)}</code></span>
        <span class="meta-row" title="${escapeHtml(app.command)}">${icon('terminal', 'meta-ico')}<code>${escapeHtml(app.command)}</code></span>
        ${portPid ? `<span class="meta-row">${icon('port', 'meta-ico')}<span class="meta-portpid">${escapeHtml(portPid)}</span></span>` : ''}
      </div>
      <div class="app-actions">
        <button class="btn btn-primary btn-start" data-id="${app.id}" ${isRunning || isBusy ? 'disabled' : ''}>${icon('play')}<span>Start</span></button>
        <button class="btn btn-danger btn-stop" data-id="${app.id}" ${!isRunning || isBusy ? 'disabled' : ''}>${icon('stop')}<span>Stop</span></button>
        <button class="btn btn-secondary btn-restart" data-id="${app.id}" ${!isRunning || isBusy ? 'disabled' : ''}>${icon('restart')}<span>Restart</span></button>
        <button class="btn btn-ghost btn-terminal ${termOpen ? 'active' : ''}" data-id="${app.id}" title="${termOpen ? 'Terminal open — click to focus' : 'Open terminal'}" aria-label="Open terminal">${icon('terminal')}</button>
      </div>
    </article>
  `;
}

function renderApps() {
  updateStats();

  appGrid.innerHTML = groupApps(apps)
    .map((group) => {
      const runningInGroup = group.apps.filter((a) => a.status === 'running').length;
      return `
        <section class="app-group" data-group="${group.key}">
          <header class="app-group-header">
            <span class="app-group-icon">${icon(group.icon || 'monitor')}</span>
            <h3 class="app-group-title">${escapeHtml(group.label)}</h3>
            <span class="app-group-rule"></span>
            <span class="app-group-count">${runningInGroup}/${group.apps.length} running</span>
            <div class="app-group-actions">
              <button class="btn btn-primary btn-sm btn-group-start" data-group="${escapeHtml(group.key)}" title="Start all ${escapeHtml(group.label)}">${icon('play')}<span>Start All ${escapeHtml(group.label)}</span></button>
              <button class="btn btn-danger btn-sm btn-group-stop" data-group="${escapeHtml(group.key)}" title="Stop all ${escapeHtml(group.label)}">${icon('stop')}<span>Stop All ${escapeHtml(group.label)}</span></button>
            </div>
          </header>
          <div class="app-grid">
            ${group.apps.map(renderAppCard).join('')}
          </div>
        </section>
      `;
    })
    .join('');

  renderTerminalTabs();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function selectApp(appId) {
  selectedAppId = appId;
  persistTerminals();
  renderApps();
  renderTerminal(appId);
}

function restoreOpenTerminals() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(TERMINALS_KEY) || 'null');
  } catch {
    saved = null;
  }
  const ids = new Set(apps.map((a) => a.id));
  openTerminals = (saved?.open || []).filter((id) => ids.has(id));
  selectedAppId =
    saved?.selected && openTerminals.includes(saved.selected)
      ? saved.selected
      : openTerminals[openTerminals.length - 1] || null;
}

function appendLog(appId, line) {
  if (!logsByApp[appId]) logsByApp[appId] = [];
  const chunks = line.replace(/\r\n/g, '\n').split('\n');
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    logsByApp[appId].push(chunk);
  }
  while (logsByApp[appId].length > 500) {
    logsByApp[appId].shift();
  }
  if (selectedAppId === appId) {
    renderTerminal(appId);
  }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.classList.remove('offline');
    connectionStatus.classList.add('online');
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'init') {
      if (message.configured === false) {
        window.location.href = '/setup.html';
        return;
      }
      applyDashboardConfig(message.dashboard);
      apps = message.apps || [];
      Object.assign(logsByApp, message.logs || {});
      restoreOpenTerminals();
      renderApps();
      if (selectedAppId) renderTerminal(selectedAppId);
    }

    if (message.type === 'status') {
      apps = message.apps;
      renderApps();
    }

    if (message.type === 'log') {
      appendLog(message.appId, message.line);
    }
  };

  ws.onclose = () => {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.classList.remove('online');
    connectionStatus.classList.add('offline');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  };
}

async function ensureConfigured() {
  const status = await api('/api/setup/status');
  if (!status.configured) {
    window.location.href = '/setup.html';
    return false;
  }
  return true;
}

async function loadApps() {
  const configured = await ensureConfigured();
  if (!configured) return;

  const data = await api('/api/apps');
  applyDashboardConfig(data.dashboard);
  apps = data.apps;
  renderApps();
}

appGrid.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const groupBtn = target.closest('.btn-group-start, .btn-group-stop');
  if (groupBtn) {
    const groupKey = groupBtn.dataset.group;
    const action = groupBtn.classList.contains('btn-group-start') ? 'start' : 'stop';
    try {
      const data = await api(`/api/group/${encodeURIComponent(groupKey)}/${action}`, {
        method: 'POST',
      });
      apps = data.apps;
      renderApps();
      showToast(action === 'start' ? 'Starting group...' : 'Group stopped');
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const btn = target.closest('button');

  const card = target.closest('.app-card');
  if (card && !btn) {
    // Clicking the card body opens (and selects) its terminal.
    openTerminal(card.dataset.id);
    return;
  }

  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;

  // Terminal button — open (or focus) this app's terminal. No API call.
  if (btn.classList.contains('btn-terminal')) {
    openTerminal(id);
    return;
  }

  try {
    if (btn.classList.contains('branch-sync-btn')) {
      btn.classList.add('spinning');
      await api(`/api/apps/${id}/refresh-branch`, { method: 'POST' });
      showToast('Branch synced');
    }
    if (btn.classList.contains('btn-start')) {
      await api(`/api/apps/${id}/start`, { method: 'POST' });
      showToast('App started');
      openTerminal(id);
    }
    if (btn.classList.contains('btn-stop')) {
      await api(`/api/apps/${id}/stop`, { method: 'POST' });
      showToast('App stopped');
    }
    if (btn.classList.contains('btn-restart')) {
      await api(`/api/apps/${id}/restart`, { method: 'POST' });
      showToast('App restarted');
      openTerminal(id);
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('startAllBtn').addEventListener('click', async () => {
  try {
    await api('/api/start-all', { method: 'POST' });
    showToast('Starting all apps...');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('stopAllBtn').addEventListener('click', async () => {
  try {
    await api('/api/stop-all', { method: 'POST' });
    showToast('All apps stopped');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('rescanPortsBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/rescan-ports', { method: 'POST' });
    applyDashboardConfig(data.dashboard);
    apps = data.apps;
    renderApps();
    showToast('Ports rescanned');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('refreshBranchesBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/refresh-branches', { method: 'POST' });
    apps = data.apps;
    renderApps();
    showToast('Git branches refreshed');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('reloadConfigBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/reload-config', { method: 'POST' });
    applyDashboardConfig(data.dashboard);
    apps = data.apps;
    renderApps();
    showToast(`Config reloaded from ${dashboard.configFile}`);
  } catch (err) {
    showToast(err.message, true);
  }
});

terminalTabs.addEventListener('click', (event) => {
  const closeBtn = event.target.closest('.term-tab-close');
  if (closeBtn) {
    event.stopPropagation();
    closeTerminal(closeBtn.dataset.close);
    return;
  }
  const tab = event.target.closest('.term-tab');
  if (!tab || !tab.dataset.id) return;
  selectApp(tab.dataset.id);
});

document.getElementById('openAllTerminalsBtn').addEventListener('click', openAllTerminals);
document.getElementById('closeAllTerminalsBtn').addEventListener('click', closeAllTerminals);
document.getElementById('copyTerminalBtn').addEventListener('click', copyActiveTerminal);

// --- Terminal collapse / expand ---
const COLLAPSE_KEY = 'regstarter.terminalCollapsed';
const WIDTH_KEY = 'regstarter.terminalWidth';

function setCollapsed(collapsed) {
  terminalPanel.classList.toggle('collapsed', collapsed);
  resizeHandle.classList.toggle('hidden', collapsed);
  localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
}

document.getElementById('collapseTerminalBtn').addEventListener('click', () => setCollapsed(true));
document.getElementById('expandTerminalBtn').addEventListener('click', () => {
  setCollapsed(false);
  if (selectedAppId) renderTerminal(selectedAppId);
});

// --- Terminal drag-resize (from its left edge) ---
let dragging = false;

resizeHandle.addEventListener('mousedown', (event) => {
  if (terminalPanel.classList.contains('collapsed')) return;
  dragging = true;
  document.body.classList.add('resizing');
  event.preventDefault();
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  const rect = layoutEl.getBoundingClientRect();
  let width = rect.right - event.clientX;
  const maxWidth = rect.width - 360; // keep room for the dashboard
  width = Math.max(300, Math.min(width, Math.max(300, maxWidth)));
  terminalPanel.style.flexBasis = `${width}px`;
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('resizing');
  if (terminalPanel.style.flexBasis) {
    localStorage.setItem(WIDTH_KEY, terminalPanel.style.flexBasis);
  }
});

// Restore persisted terminal size / collapsed state.
(function restoreTerminalLayout() {
  const savedWidth = localStorage.getItem(WIDTH_KEY);
  if (savedWidth) terminalPanel.style.flexBasis = savedWidth;
  setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
})();

document.getElementById('clearTerminalBtn').addEventListener('click', () => {
  if (!selectedAppId) return;
  logsByApp[selectedAppId] = [];
  renderTerminal(selectedAppId);
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  window.location.href = '/settings.html';
});

function decorateHeaderButtons() {
  const map = {
    settingsBtn: 'gear',
    rescanPortsBtn: 'search',
    refreshBranchesBtn: 'branch',
    reloadConfigBtn: 'restart',
    startAllBtn: 'play',
    stopAllBtn: 'stop',
    openAllTerminalsBtn: 'terminal',
    closeAllTerminalsBtn: 'x',
    copyTerminalBtn: 'copy',
    clearTerminalBtn: 'trash',
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `${icon(name)}<span>${el.textContent.trim()}</span>`;
  }
}

decorateHeaderButtons();

ensureConfigured().then((configured) => {
  if (configured) {
    connectWebSocket();
    loadApps().catch((err) => showToast(err.message, true));
  }
});
