const fs = require('fs');
const path = require('path');
const { getTemplatesDir } = require('./paths');

function readManifest() {
  const manifestPath = path.join(getTemplatesDir(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const items = JSON.parse(raw);
  return Array.isArray(items) ? items : [];
}

function listTemplates() {
  return readManifest().map(({ id, name, description }) => ({ id, name, description }));
}

function getTemplate(id) {
  const entry = readManifest().find((item) => item.id === id);
  if (!entry) {
    const err = new Error(`Template "${id}" not found`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const filePath = path.join(getTemplatesDir(), entry.file);
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Template file missing for "${id}"`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    config: JSON.parse(raw),
  };
}

module.exports = {
  listTemplates,
  getTemplate,
};
