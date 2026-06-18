const appGrid = document.getElementById('appGrid');
const terminalOutput = document.getElementById('terminalOutput');
const terminalAppName = document.getElementById('terminalAppName');
const connectionStatus = document.getElementById('connectionStatus');
const totalCount = document.getElementById('totalCount');
const runningCount = document.getElementById('runningCount');
const externalCount = document.getElementById('externalCount');
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
  runningCount.textContent = String(
    apps.filter((a) => a.status === 'running' && !a.external).length
  );
  externalCount.textContent = String(apps.filter((a) => a.external).length);
  stoppedCount.textContent = String(
    apps.filter((a) => a.status === 'stopped' || !a.status).length
  );
}

function statusLabel(status, external = false) {
  if (external || status === 'external') return 'external';
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

function renderTerminal(appId) {
  const app = apps.find((a) => a.id === appId);
  terminalAppName.textContent = app ? app.name : 'Select an app to view output';
  const lines = logsByApp[appId] || [];
  terminalOutput.innerHTML = lines.map(ansiToHtml).join('\n');
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function renderApps() {
  updateStats();

  appGrid.innerHTML = apps
    .map((app) => {
      const status = statusLabel(app.status, app.external);
      const isRunning = status === 'running' || status === 'external';
      const isBusy = status === 'starting' || status === 'stopping';
      const isExternal = status === 'external';

      return `
        <article class="app-card ${selectedAppId === app.id ? 'selected' : ''} ${isExternal ? 'external' : ''}" data-id="${app.id}">
          <div class="app-card-header">
            <h2 class="app-name">${escapeHtml(app.name)}</h2>
            <span class="status-badge status-${status}">${status}</span>
          </div>
          <div class="app-meta">
            <span title="${escapeHtml(app.path)}"><strong>Path:</strong> <code>${escapeHtml(app.path)}</code></span>
            <span title="${escapeHtml(app.command)}"><strong>Cmd:</strong> <code>${escapeHtml(app.command)}</code></span>
            ${app.port || app.pid ? `<span>${app.port ? `<strong>Port:</strong> ${app.port}` : ''}${app.port && app.pid ? ' · ' : ''}${app.pid ? `<strong>PID:</strong> ${app.pid}` : ''}</span>` : ''}
            ${isExternal ? `<span class="external-tag">Started outside ${escapeHtml(dashboard.title)} — stop or restart from here</span>` : ''}
          </div>
          <div class="app-actions">
            <button class="btn btn-primary btn-start" data-id="${app.id}" ${isRunning || isBusy ? 'disabled' : ''}>Start</button>
            <button class="btn btn-danger btn-stop" data-id="${app.id}" ${!isRunning || isBusy ? 'disabled' : ''}>Stop</button>
            <button class="btn btn-secondary btn-restart" data-id="${app.id}" ${isBusy ? 'disabled' : ''}>Restart</button>
          </div>
        </article>
      `;
    })
    .join('');
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
  renderApps();
  renderTerminal(appId);
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
      if (!selectedAppId && apps.length > 0) {
        selectedAppId = apps[0].id;
      }
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

  const card = target.closest('.app-card');
  if (card && !target.closest('button')) {
    selectApp(card.dataset.id);
    return;
  }

  const id = target.dataset.id;
  if (!id) return;

  try {
    if (target.classList.contains('btn-start')) {
      await api(`/api/apps/${id}/start`, { method: 'POST' });
      showToast('App started');
      selectApp(id);
    }
    if (target.classList.contains('btn-stop')) {
      await api(`/api/apps/${id}/stop`, { method: 'POST' });
      showToast('App stopped');
    }
    if (target.classList.contains('btn-restart')) {
      await api(`/api/apps/${id}/restart`, { method: 'POST' });
      showToast('App restarted');
      selectApp(id);
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

document.getElementById('clearTerminalBtn').addEventListener('click', () => {
  if (!selectedAppId) return;
  logsByApp[selectedAppId] = [];
  renderTerminal(selectedAppId);
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  window.location.href = '/settings.html';
});

ensureConfigured().then((configured) => {
  if (configured) {
    connectWebSocket();
    loadApps().catch((err) => showToast(err.message, true));
  }
});
