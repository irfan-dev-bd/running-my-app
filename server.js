const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const { WebSocketServer } = require('ws');
const configLib = require('./lib/config');
const templatesLib = require('./lib/templates');
const fsBrowse = require('./lib/fsBrowse');
const { getConfigPath, getUserDataDir } = require('./lib/paths');

const execAsync = promisify(exec);

const PORT = process.env.PORT || 3000;
const MAX_LOG_LINES = 500;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, { proc: import('child_process').ChildProcess | null, externalPid: number | null, status: string, logs: string[], cwd: string, command: string }>} */
const processes = new Map();

const PORT_CHECK_TIMEOUT_MS = 500;
const EXTERNAL_SYNC_INTERVAL_MS = 10000;

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

function readConfig() {
  return configLib.readConfig();
}

function getDashboardConfig(config) {
  return configLib.getDashboardConfig(config);
}

function logTag(config) {
  if (config) {
    return configLib.getDashboardConfig(config).logPrefix;
  }
  return configLib.getDashboardConfig(configLib.readConfigOrNull()).logPrefix;
}

function requireConfigured(req, res, next) {
  if (!configLib.isConfigured()) {
    return res.status(409).json({ ok: false, error: 'Setup required' });
  }
  next();
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function getAppsWithStatus() {
  const config = readConfig();
  return config.apps.map((appDef) => {
    const runtime = processes.get(appDef.id);
    const managedPid = runtime?.proc && !runtime.proc.killed ? runtime.proc.pid : null;
    const external = Boolean(runtime?.status === 'running' && !managedPid);
    return {
      ...appDef,
      status: external ? 'external' : (runtime?.status ?? 'stopped'),
      pid: managedPid ?? runtime?.externalPid ?? null,
      external,
      logCount: runtime?.logs?.length ?? 0,
    };
  });
}

function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(PORT_CHECK_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function isKillablePid(pid) {
  if (!pid || Number.isNaN(pid) || pid <= 0) return false;
  if (process.platform === 'win32' && pid === 4) return false;
  return true;
}

async function checkPortInUse(port) {
  const hosts = ['127.0.0.1', '::1'];
  const results = await Promise.all(hosts.map((host) => isPortListening(port, host)));
  return results.some(Boolean);
}

async function getPidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('netstat -ano -p tcp');
      const portSuffix = `:${port}`;
      for (const line of stdout.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const trimmed = line.trim();
        const localAddress = trimmed.split(/\s+/)[1] ?? '';
        if (!localAddress.endsWith(portSuffix)) continue;
        const pid = Number.parseInt(trimmed.split(/\s+/).pop(), 10);
        if (isKillablePid(pid)) return pid;
      }
      return null;
    }

    try {
      const { stdout } = await execAsync(`ss -ltnp 'sport = :${port}'`);
      const match = stdout.match(/pid=(\d+)/);
      if (match) {
        const pid = Number.parseInt(match[1], 10);
        if (isKillablePid(pid)) return pid;
      }
    } catch {
      const { stdout } = await execAsync(`lsof -ti :${port} -sTCP:LISTEN`);
      const pid = Number.parseInt(stdout.trim().split('\n')[0], 10);
      if (isKillablePid(pid)) return pid;
    }
  } catch {
    return null;
  }

  return null;
}

async function inspectAppPort(appDef) {
  if (!appDef.port) {
    return { appDef, listening: false, pid: null };
  }

  const listening = await checkPortInUse(appDef.port);
  const pid = listening ? await getPidOnPort(appDef.port) : null;
  return { appDef, listening, pid };
}

function applyExternalInspection(appDef, listening, pid, options = {}) {
  const { logDetection = true } = options;
  const runtime = ensureRuntime(appDef);
  const managed = runtime.proc && !runtime.proc.killed;
  if (managed) return false;

  let changed = false;

  if (listening) {
    const wasExternal = runtime.status === 'running' && !runtime.proc;

    if (runtime.status !== 'running' || runtime.externalPid !== pid) {
      runtime.status = 'running';
      runtime.externalPid = pid;
      if (logDetection && !wasExternal) {
        appendLog(
          appDef.id,
          `[${logTag()}] Detected existing process on port ${appDef.port}${pid ? ` (PID: ${pid})` : ' (PID unknown)'}`
        );
      }
      changed = true;
    }
  } else if (runtime.externalPid || (runtime.status === 'running' && !runtime.proc)) {
    runtime.externalPid = null;
    runtime.status = 'stopped';
    changed = true;
  }

  return changed;
}

async function syncExternalProcesses(options = {}) {
  const { broadcastUpdate = false, logDetection = true } = options;
  const config = readConfig();
  const appsWithPorts = config.apps.filter((appDef) => appDef.port);

  for (const appDef of config.apps) {
    ensureRuntime(appDef);
  }

  const inspections = await Promise.all(appsWithPorts.map((appDef) => inspectAppPort(appDef)));

  let changed = false;
  for (const { appDef, listening, pid } of inspections) {
    if (
      applyExternalInspection(appDef, listening, pid, { logDetection })
    ) {
      changed = true;
    }
  }

  if (changed && broadcastUpdate) {
    broadcast({ type: 'status', apps: getAppsWithStatus() });
  }

  return changed;
}

function appendLog(appId, line) {
  const runtime = processes.get(appId);
  if (!runtime) return;

  const normalized = line.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const chunks = normalized.split('\n');
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    runtime.logs.push(chunk);
  }

  while (runtime.logs.length > MAX_LOG_LINES) {
    runtime.logs.shift();
  }

  broadcast({ type: 'log', appId, line: normalized });
}

function setStatus(appId, status) {
  const runtime = processes.get(appId);
  if (runtime) {
    runtime.status = status;
  }
  broadcast({ type: 'status', appId, status, apps: getAppsWithStatus() });
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /T /F`, () => resolve());
    } else {
      exec(`kill -TERM -${pid}`, () => resolve());
    }
  });
}

function ensureRuntime(appDef) {
  if (!processes.has(appDef.id)) {
    processes.set(appDef.id, {
      proc: null,
      externalPid: null,
      status: 'stopped',
      logs: [],
      cwd: appDef.path,
      command: appDef.command,
    });
  }
  return processes.get(appDef.id);
}

async function startApp(appId) {
  const config = readConfig();
  const appDef = config.apps.find((a) => a.id === appId);
  if (!appDef) {
    throw new Error(`App "${appId}" not found in config`);
  }

  const runtime = ensureRuntime(appDef);

  if (runtime.proc && !runtime.proc.killed) {
    return { alreadyRunning: true };
  }

  if (appDef.port && (await checkPortInUse(appDef.port))) {
    const pid = await getPidOnPort(appDef.port);
    runtime.externalPid = pid;
    runtime.status = 'running';
    setStatus(appId, 'running');
    return { alreadyRunning: true, external: true, pid };
  }

  runtime.externalPid = null;

  if (!fs.existsSync(appDef.path)) {
    throw new Error(`Path does not exist: ${appDef.path}`);
  }

  runtime.logs = [];
  runtime.cwd = appDef.path;
  runtime.command = appDef.command;
  setStatus(appId, 'starting');

  const tag = logTag(config);
  appendLog(appId, `[${tag}] Starting "${appDef.name}"`);
  appendLog(appId, `[${tag}] cd ${appDef.path}`);
  appendLog(appId, `[${tag}] ${appDef.command}`);
  appendLog(appId, '');

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shellFlag = process.platform === 'win32' ? '/c' : '-lc';
  // Switch cmd.exe to UTF-8 (code page 65001) so non-ASCII output isn't garbled.
  const cmd = process.platform === 'win32'
    ? `chcp 65001 >nul 2>&1 & ${appDef.command}`
    : appDef.command;

  const child = spawn(shell, [shellFlag, cmd], {
    cwd: appDef.path,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      npm_config_color: 'always',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    windowsHide: true,
  });

  runtime.proc = child;
  setStatus(appId, 'running');

  child.stdout.on('data', (data) => appendLog(appId, data.toString()));
  child.stderr.on('data', (data) => appendLog(appId, data.toString()));

  child.on('close', (code) => {
    appendLog(appId, `\n[${logTag()}] Process exited with code ${code ?? 'unknown'}`);
    runtime.proc = null;
    runtime.externalPid = null;
    setStatus(appId, 'stopped');
  });

  child.on('error', (err) => {
    appendLog(appId, `[${logTag()}] Error: ${err.message}`);
    runtime.proc = null;
    runtime.externalPid = null;
    setStatus(appId, 'stopped');
  });

  return { started: true, pid: child.pid };
}

async function stopApp(appId) {
  const runtime = processes.get(appId);

  if (runtime?.proc && !runtime.proc.killed) {
    setStatus(appId, 'stopping');
    appendLog(appId, `\n[${logTag()}] Stopping...`);

    const pid = runtime.proc.pid;
    runtime.proc.kill();
    await killProcessTree(pid);

    runtime.proc = null;
    runtime.externalPid = null;
    setStatus(appId, 'stopped');
    return { stopped: true };
  }

  const config = readConfig();
  const appDef = config.apps.find((a) => a.id === appId);
  let pid = runtime?.externalPid ?? null;

  if (!pid && appDef?.port && (await checkPortInUse(appDef.port))) {
    pid = await getPidOnPort(appDef.port);
  }

  if (isKillablePid(pid)) {
    setStatus(appId, 'stopping');
    appendLog(appId, `\n[${logTag()}] Stopping external process...`);
    await killProcessTree(pid);
    if (runtime) runtime.externalPid = null;
    setStatus(appId, 'stopped');
    return { stopped: true };
  }

  if (appDef?.port && (await checkPortInUse(appDef.port))) {
    appendLog(
      appId,
      `\n[${logTag()}] Port is in use but the owning PID could not be determined. Stop it manually, then try again.`
    );
    setStatus(appId, 'running');
    return { stopped: false, error: 'Could not determine PID for external process' };
  }

  if (runtime) runtime.externalPid = null;
  setStatus(appId, 'stopped');
  return { alreadyStopped: true };
}

async function restartApp(appId) {
  await stopApp(appId);
  await new Promise((r) => setTimeout(r, 400));
  return startApp(appId);
}

app.get('/api/setup/status', (_req, res) => {
  res.json({
    configured: configLib.isConfigured(),
    configPath: getConfigPath(),
    userDataDir: getUserDataDir(),
  });
});

app.get('/api/templates', (_req, res) => {
  res.json({ templates: templatesLib.listTemplates() });
});

app.get('/api/templates/:id', (req, res) => {
  try {
    const template = templatesLib.getTemplate(req.params.id);
    res.json({ ok: true, ...template });
  } catch (err) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ ok: false, error: err.message });
  }
});

app.get('/api/config/full', requireConfigured, (_req, res) => {
  res.json({ ok: true, config: readConfig(), configPath: getConfigPath() });
});

app.put('/api/config', async (req, res) => {
  try {
    const result = configLib.writeConfig(req.body);
    for (const appDef of result.config.apps) {
      ensureRuntime(appDef);
    }
    await syncExternalProcesses({ logDetection: false });
    res.json({
      ok: true,
      warnings: result.warnings,
      configPath: result.configPath,
      config: result.config,
      dashboard: getDashboardConfig(result.config),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message,
      validation: err.validation ?? null,
    });
  }
});

app.delete('/api/config', requireConfigured, async (_req, res) => {
  try {
    for (const id of [...processes.keys()]) {
      await stopApp(id);
    }
    processes.clear();
    configLib.deleteConfig();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/fs/browse', (req, res) => {
  try {
    const result = fsBrowse.listDirectory(req.query.path);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/config/validate', (req, res) => {
  const normalized = configLib.normalizeConfig(req.body);
  const validation = configLib.validateConfig(normalized);
  res.json({ ok: validation.ok, ...validation, config: normalized });
});

app.get('/api/config', requireConfigured, (_req, res) => {
  const config = readConfig();
  res.json({ dashboard: getDashboardConfig(config) });
});

app.get('/api/apps', requireConfigured, async (_req, res) => {
  await syncExternalProcesses({ logDetection: false });
  res.json({ apps: getAppsWithStatus(), dashboard: getDashboardConfig() });
});

app.post('/api/rescan-ports', requireConfigured, async (_req, res) => {
  try {
    await syncExternalProcesses({ logDetection: true, broadcastUpdate: true });
    res.json({ ok: true, apps: getAppsWithStatus(), dashboard: getDashboardConfig() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/apps/:id/start', requireConfigured, async (req, res) => {
  try {
    const result = await startApp(req.params.id);
    res.json({ ok: true, ...result, apps: getAppsWithStatus() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/apps/:id/stop', requireConfigured, async (req, res) => {
  try {
    const result = await stopApp(req.params.id);
    res.json({ ok: true, ...result, apps: getAppsWithStatus() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/apps/:id/restart', requireConfigured, async (req, res) => {
  try {
    const result = await restartApp(req.params.id);
    res.json({ ok: true, ...result, apps: getAppsWithStatus() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/start-all', requireConfigured, async (_req, res) => {
  const config = readConfig();
  const results = [];

  for (const appDef of config.apps) {
    try {
      const result = await startApp(appDef.id);
      results.push({ id: appDef.id, ok: true, ...result });
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      results.push({ id: appDef.id, ok: false, error: err.message });
    }
  }

  res.json({ ok: true, results, apps: getAppsWithStatus() });
});

app.post('/api/stop-all', requireConfigured, async (_req, res) => {
  await syncExternalProcesses();
  const config = readConfig();
  const results = [];

  for (const appDef of config.apps) {
    try {
      const result = await stopApp(appDef.id);
      results.push({ id: appDef.id, ok: true, ...result });
    } catch (err) {
      results.push({ id: appDef.id, ok: false, error: err.message });
    }
  }

  res.json({ ok: true, results, apps: getAppsWithStatus() });
});

app.post('/api/reload-config', requireConfigured, async (_req, res) => {
  try {
    const config = readConfig();
    for (const appDef of config.apps) {
      ensureRuntime(appDef);
    }
    await syncExternalProcesses();
    res.json({ ok: true, apps: getAppsWithStatus(), dashboard: getDashboardConfig() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/apps/:id/logs', requireConfigured, (req, res) => {
  const runtime = processes.get(req.params.id);
  res.json({ logs: runtime?.logs ?? [] });
});

wss.on('connection', (ws) => {
  clients.add(ws);

  const sendInit = async () => {
    if (ws.readyState !== 1) return;

    if (!configLib.isConfigured()) {
      ws.send(
        JSON.stringify({
          type: 'init',
          configured: false,
          dashboard: getDashboardConfig(),
        })
      );
      return;
    }

    try {
      await syncExternalProcesses({ logDetection: false });
    } catch {
      // ignore sync errors during init
    }

    ws.send(
      JSON.stringify({
        type: 'init',
        configured: true,
        dashboard: getDashboardConfig(),
        apps: getAppsWithStatus(),
        logs: Object.fromEntries(
          [...processes.entries()].map(([id, runtime]) => [id, runtime.logs])
        ),
      })
    );
  };

  sendInit().catch(() => {});

  ws.on('close', () => clients.delete(ws));
});

async function bootstrap() {
  if (configLib.isConfigured()) {
    const config = readConfig();
    for (const appDef of config.apps) {
      ensureRuntime(appDef);
    }
    await syncExternalProcesses({ logDetection: true, broadcastUpdate: false });
  }

  server.listen(PORT, () => {
    const configPath = getConfigPath();
    if (configLib.isConfigured()) {
      const dashboard = getDashboardConfig();
      console.log(`${dashboard.title} running at http://localhost:${PORT}`);
    } else {
      console.log(`Reg-Starter running at http://localhost:${PORT}`);
      console.log('Setup required — open the URL in your browser to configure');
    }
    console.log(`Config: ${configPath}`);

    setInterval(() => {
      if (!configLib.isConfigured()) return;
      syncExternalProcesses({ broadcastUpdate: true, logDetection: false }).catch(() => {});
    }, EXTERNAL_SYNC_INTERVAL_MS);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start dashboard:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down, stopping all apps...');
  for (const id of [...processes.keys()]) {
    await stopApp(id);
  }
  process.exit(0);
});
