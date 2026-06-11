const toast = document.getElementById('toast');
const manualEditorHost = document.getElementById('manualEditorHost');
const reviewHost = document.getElementById('reviewHost');

let draftConfig = ConfigEditor.emptyConfig();
let manualForm = null;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove('hidden', 'error');
  if (isError) toast.classList.add('error');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

async function ensureConfigured() {
  const status = await fetch('/api/setup/status').then((r) => r.json());
  if (!status.configured) {
    window.location.href = '/setup.html';
    return null;
  }
  document.getElementById('configPathHint').textContent = `Config file: ${status.configPath}`;
  return status;
}

async function loadConfig() {
  const data = await ConfigEditor.api('/api/config/full');
  draftConfig = data.config;
  manualForm = ConfigEditor.renderManualForm(manualEditorHost, draftConfig, (config) => {
    draftConfig = config;
  });
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  if (manualForm) {
    draftConfig = ConfigEditor.readManualForm(manualForm);
  }

  try {
    const validation = await ConfigEditor.validate(draftConfig);
    reviewHost.classList.remove('hidden');
    ConfigEditor.renderReview(reviewHost, validation);

    if (!validation.ok) {
      showToast('Fix validation errors before saving', true);
      return;
    }

    const result = await ConfigEditor.save(draftConfig);
    if (result.warnings?.length) {
      showToast(`Saved with ${result.warnings.length} warning(s)`);
    } else {
      showToast('Settings saved');
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('exportConfigBtn').addEventListener('click', () => {
  if (manualForm) {
    draftConfig = ConfigEditor.readManualForm(manualForm);
  }
  ConfigEditor.downloadJson('apps.json', draftConfig);
  showToast('Config exported');
});

document.getElementById('resetConfigBtn').addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Reset setup? This deletes your saved config and returns you to the setup wizard. Running apps will be stopped.'
  );
  if (!confirmed) return;

  try {
    await ConfigEditor.api('/api/config', { method: 'DELETE' });
    window.location.href = '/setup.html';
  } catch (err) {
    showToast(err.message, true);
  }
});

ensureConfigured()
  .then((status) => {
    if (status) return loadConfig();
  })
  .catch((err) => showToast(err.message, true));
