const fs = require('fs');
const path = require('path');
const os = require('os');
const { getBrowseRoots } = require('./paths');

function resolveBrowsePath(inputPath) {
  const home = os.homedir();

  if (!inputPath || inputPath === '~') {
    return home;
  }

  let resolved = inputPath;
  if (resolved.startsWith('~')) {
    resolved = path.join(home, resolved.slice(1).replace(/^[/\\]/, ''));
  }

  resolved = path.resolve(resolved);

  const roots = getBrowseRoots();
  const allowed = roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });

  if (!allowed) {
    const err = new Error('Path is outside allowed browse roots');
    err.code = 'PATH_NOT_ALLOWED';
    throw err;
  }

  return resolved;
}

function listDirectory(inputPath) {
  const currentPath = resolveBrowsePath(inputPath);

  if (!fs.existsSync(currentPath)) {
    const err = new Error('Path does not exist');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const stat = fs.statSync(currentPath);
  if (!stat.isDirectory()) {
    const err = new Error('Path is not a directory');
    err.code = 'NOT_DIRECTORY';
    throw err;
  }

  let entries;
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read directory: ${err.message}`);
  }

  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parentPath = path.dirname(currentPath);
  const roots = getBrowseRoots();
  const atRoot = roots.some((root) => path.resolve(root) === currentPath);

  return {
    path: currentPath,
    parentPath: atRoot ? null : parentPath,
    directories,
  };
}

module.exports = {
  listDirectory,
  resolveBrowsePath,
};
