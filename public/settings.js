const toast = document.getElementById('toast');
const manualEditorHost = document.getElementById('manualEditorHost');
const reviewHost = document.getElementById('reviewHost');
const templateGrid = document.getElementById('templateGrid');
const settingsTabs = document.getElementById('settingsTabs');

const tabPanels = {
  edit: document.getElementById('editPanel'),
  import: document.getElementById('importPanel'),
  template: document.getElementById('templatePanel'),
};

let draftConfig = ConfigEditor.emptyConfig();
let manualForm = null;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove('hidden', 'error');
  if (isError) toast.classList.add('error');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function setTab(tabId) {
  settingsTabs.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  for (const [id, panel] of Object.entries(tabPanels)) {
    panel.classList.toggle('hidden', id !== tabId);
  }
}

function renderEditor() {
  manualForm = ConfigEditor.renderManualForm(manualEditorHost, draftConfig, (config) => {
    draftConfig = config;
  });
}

function loadConfigIntoEditor(config, message) {
  draftConfig = config;
  renderEditor();
  reviewHost.classList.add('hidden');
  setTab('edit');
  if (message) showToast(message);
}

async function ensureConfigured() {
  const status = await ConfigEditor.api('/api/setup/status');
  if (!status.configured) {
    window.location.href = '/setup.html';
    return null;
  }
  document.getElementById('configPathHint').textContent = `Config file: ${status.configPath}`;
  return status;
}

async function loadConfig() {
  const data = await ConfigEditor.api('/api/config/full');
  loadConfigIntoEditor(data.config);
}

async function loadTemplates() {
  const data = await ConfigEditor.api('/api/templates');
  templateGrid.innerHTML = data.templates
    .map(
      (template) => `
      <article class="template-card">
        <h4>${ConfigEditor.escapeHtml(template.name)}</h4>
        <p>${ConfigEditor.escapeHtml(template.description)}</p>
        <div class="template-actions">
          <button type="button" class="btn btn-ghost btn-sm download-template-btn" data-id="${ConfigEditor.escapeHtml(template.id)}">Download</button>
          <button type="button" class="btn btn-primary btn-sm use-template-btn" data-id="${ConfigEditor.escapeHtml(template.id)}">Load template</button>
        </div>
      </article>`
    )
    .join('');
}

settingsTabs.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const tab = target.closest('.settings-tab');
  if (!tab) return;
  setTab(tab.dataset.tab);
});

templateGrid.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const id = target.dataset.id;
  if (!id) return;

  try {
    const data = await ConfigEditor.api(`/api/templates/${id}`);
    if (target.classList.contains('download-template-btn')) {
      ConfigEditor.downloadJson(`${id}.json`, data.config);
      showToast(`Downloaded ${data.name} template`);
      return;
    }

    if (target.classList.contains('use-template-btn')) {
      loadConfigIntoEditor(data.config, `Loaded ${data.name} — update paths, then save`);
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('applyImportBtn').addEventListener('click', () => {
  const fileInput = document.getElementById('importFile');
  const text = document.getElementById('importText').value.trim();

  const applyParsed = (raw) => {
    try {
      const parsed = ConfigEditor.parseJson(raw);
      loadConfigIntoEditor(parsed, 'Config loaded — review apps, then save');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  if (fileInput.files?.[0]) {
    const reader = new FileReader();
    reader.onload = () => applyParsed(reader.result);
    reader.onerror = () => showToast('Could not read file', true);
    reader.readAsText(fileInput.files[0]);
    return;
  }

  if (!text) {
    showToast('Upload a file or paste JSON first', true);
    return;
  }

  applyParsed(text);
});

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  if (manualForm) {
    draftConfig = ConfigEditor.readManualForm(manualForm);
  }

  try {
    const validation = await ConfigEditor.validate(draftConfig);
    reviewHost.classList.remove('hidden');
    ConfigEditor.renderReview(reviewHost, validation);

    if (!validation.ok) {
      setTab('edit');
      showToast('Fix validation errors before saving', true);
      return;
    }

    const result = await ConfigEditor.save(draftConfig);
    reviewHost.classList.add('hidden');
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
    if (!status) return;
    return Promise.all([loadConfig(), loadTemplates()]);
  })
  .catch((err) => showToast(err.message, true));
