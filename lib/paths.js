const os = require('os');
const path = require('path');

function getUserDataDir() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Reg-Starter');
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Reg-Starter');
  }

  return path.join(home, '.config', 'reg-starter');
}

function getConfigPath() {
  if (process.env.REG_STARTER_CONFIG) {
    return path.resolve(process.env.REG_STARTER_CONFIG);
  }
  return path.join(getUserDataDir(), 'apps.json');
}

function getTemplatesDir() {
  return path.join(__dirname, '..', 'templates');
}

function getBrowseRoots() {
  const home = os.homedir();
  const roots = [home];

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      roots.push(`${letter}:\\`);
    }
  } else {
    roots.push('/');
  }

  return [...new Set(roots.map((p) => path.resolve(p)))];
}

module.exports = {
  getUserDataDir,
  getConfigPath,
  getTemplatesDir,
  getBrowseRoots,
};
