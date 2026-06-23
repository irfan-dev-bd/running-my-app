const fs = require('fs');
const path = require('path');
const { getConfigPath, getUserDataDir } = require('./paths');

const DEFAULT_DASHBOARD = {
  title: 'Dev Dashboard',
  subtitle: 'Start, stop, and monitor local apps from one place',
  logPrefix: 'launcher',
  configFile: 'apps.json',
};

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'app';
}

function isConfigured() {
  return fs.existsSync(getConfigPath());
}

function readConfigOrNull() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function readConfig() {
  const config = readConfigOrNull();
  if (!config) {
    const err = new Error('Setup required');
    err.code = 'SETUP_REQUIRED';
    throw err;
  }
  return config;
}

function getDashboardConfig(config) {
  const source = config ?? readConfigOrNull() ?? {};
  const configPath = getConfigPath();
  return {
    ...DEFAULT_DASHBOARD,
    ...(source.dashboard ?? {}),
    configFile: path.basename(configPath),
    configPath,
  };
}

function normalizeApp(app, index, usedIds) {
  const name = String(app.name ?? '').trim();
  const appPath = String(app.path ?? '').trim();
  const command = String(app.command ?? '').trim();
  let id = String(app.id ?? '').trim();

  if (!id) {
    id = slugify(name || `app-${index + 1}`);
  }

  let uniqueId = id;
  let suffix = 2;
  while (usedIds.has(uniqueId)) {
    uniqueId = `${id}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(uniqueId);

  const normalized = {
    id: uniqueId,
    name,
    path: appPath,
    command,
  };

  const type = String(app.type ?? '').trim().toLowerCase();
  if (type) {
    normalized.type = type;
  }

  if (app.port !== undefined && app.port !== null && app.port !== '') {
    normalized.port = Number(app.port);
  }

  return normalized;
}

function normalizeConfig(input) {
  const dashboard = {
    ...DEFAULT_DASHBOARD,
    ...(input.dashboard ?? {}),
  };

  const usedIds = new Set();
  const apps = (input.apps ?? []).map((app, index) => normalizeApp(app, index, usedIds));

  return { dashboard, apps };
}

function validateConfig(input) {
  const errors = [];
  const warnings = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Config must be an object'], warnings: [] };
  }

  if (!Array.isArray(input.apps) || input.apps.length === 0) {
    errors.push('At least one app is required');
  }

  const ids = new Set();

  for (const [index, app] of (input.apps ?? []).entries()) {
    const label = `App ${index + 1}`;

    if (!app.name || !String(app.name).trim()) {
      errors.push(`${label}: name is required`);
    }
    if (!app.path || !String(app.path).trim()) {
      errors.push(`${label}: path is required`);
    }
    if (!app.command || !String(app.command).trim()) {
      errors.push(`${label}: command is required`);
    }

    const id = String(app.id ?? slugify(app.name ?? `app-${index + 1}`)).trim();
    if (ids.has(id)) {
      errors.push(`${label}: duplicate id "${id}"`);
    } else {
      ids.add(id);
    }

    if (app.port !== undefined && app.port !== null && app.port !== '') {
      const port = Number(app.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`${label}: port must be a number between 1 and 65535`);
      }
    }

    const appPath = String(app.path ?? '').trim();
    if (appPath && !fs.existsSync(appPath)) {
      warnings.push(`${label}: path does not exist — ${appPath}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function writeConfig(input) {
  const normalized = normalizeConfig(input);
  const validation = validateConfig(normalized);

  if (!validation.ok) {
    const err = new Error(validation.errors.join('; '));
    err.validation = validation;
    throw err;
  }

  const configPath = getConfigPath();
  const userDataDir = path.dirname(configPath);
  fs.mkdirSync(userDataDir, { recursive: true });

  const payload = JSON.stringify(normalized, null, 2);
  fs.writeFileSync(configPath, payload, 'utf8');

  return { config: normalized, warnings: validation.warnings, configPath };
}

function deleteConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

module.exports = {
  DEFAULT_DASHBOARD,
  isConfigured,
  readConfig,
  readConfigOrNull,
  getDashboardConfig,
  normalizeConfig,
  validateConfig,
  writeConfig,
  deleteConfig,
  getConfigPath,
};
