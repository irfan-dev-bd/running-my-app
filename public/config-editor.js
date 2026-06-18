const ConfigEditor = {
  emptyConfig() {
    return {
      dashboard: {
        title: 'Dev Dashboard',
        subtitle: 'Start, stop, and monitor local apps from one place',
      },
      apps: [
        {
          id: '',
          name: '',
          path: '',
          command: 'npm start',
          port: '',
        },
      ],
    };
  },

  parseJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Config must be a JSON object');
    }
    return parsed;
  },

  async api(path, options = {}) {
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
  },

  async validate(config) {
    return this.api('/api/config/validate', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async save(config) {
    return this.api('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  },

  readManualForm(form) {
    const title = form.querySelector('[name="dashboardTitle"]').value.trim();
    const subtitle = form.querySelector('[name="dashboardSubtitle"]').value.trim();
    const rows = [...form.querySelectorAll('.app-row')];

    const apps = rows.map((row) => ({
      id: row.querySelector('[name="appId"]').value.trim(),
      name: row.querySelector('[name="appName"]').value.trim(),
      path: row.querySelector('[name="appPath"]').value.trim(),
      command: row.querySelector('[name="appCommand"]').value.trim(),
      port: row.querySelector('[name="appPort"]').value.trim(),
    }));

    return {
      dashboard: {
        title: title || 'Dev Dashboard',
        subtitle: subtitle || 'Start, stop, and monitor local apps from one place',
      },
      apps,
    };
  },

  renderManualForm(container, config, onChange) {
    const apps = config.apps?.length ? config.apps : this.emptyConfig().apps;

    container.innerHTML = `
      <form class="manual-form" id="manualForm">
        <div class="form-row two-col">
          <label class="field">
            <span>Dashboard title</span>
            <input type="text" name="dashboardTitle" value="${this.escapeHtml(config.dashboard?.title || 'Dev Dashboard')}" />
          </label>
          <label class="field">
            <span>Subtitle</span>
            <input type="text" name="dashboardSubtitle" value="${this.escapeHtml(config.dashboard?.subtitle || '')}" />
          </label>
        </div>
        <div class="apps-editor">
          <div class="apps-editor-header">
            <h3>Apps</h3>
            <button type="button" class="btn btn-ghost btn-sm" id="addAppRowBtn">Add app</button>
          </div>
          <div id="appRows">
            ${apps
              .map(
                (app, index) => `
              <div class="app-row" data-index="${index}">
                <label class="field">
                  <span>Name</span>
                  <input type="text" name="appName" value="${this.escapeHtml(app.name || '')}" required />
                </label>
                <label class="field field-grow">
                  <span>Path</span>
                  <div class="path-input">
                    <input type="text" name="appPath" value="${this.escapeHtml(app.path || '')}" required />
                    <button type="button" class="btn btn-ghost btn-sm browse-btn" data-index="${index}">Browse</button>
                  </div>
                </label>
                <label class="field field-grow">
                  <span>Command</span>
                  <input type="text" name="appCommand" value="${this.escapeHtml(app.command || 'npm start')}" required />
                </label>
                <label class="field field-narrow">
                  <span>Port</span>
                  <input type="number" name="appPort" value="${app.port ?? ''}" min="1" max="65535" placeholder="optional" />
                </label>
                <label class="field field-narrow">
                  <span>ID</span>
                  <input type="text" name="appId" value="${this.escapeHtml(app.id || '')}" placeholder="auto" />
                </label>
                <button type="button" class="btn btn-ghost btn-sm remove-app-btn" ${apps.length <= 1 ? 'disabled' : ''} aria-label="Remove app">&times;</button>
              </div>`
              )
              .join('')}
          </div>
        </div>
      </form>
    `;

    const form = container.querySelector('#manualForm');
    const appRows = container.querySelector('#appRows');

    const notify = () => {
      if (onChange) onChange(this.readManualForm(form));
    };

    form.addEventListener('input', notify);

    container.querySelector('#addAppRowBtn').addEventListener('click', () => {
      const configFromForm = this.readManualForm(form);
      configFromForm.apps.push({ id: '', name: '', path: '', command: 'npm start', port: '' });
      this.renderManualForm(container, configFromForm, onChange);
    });

    appRows.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains('remove-app-btn')) {
        const configFromForm = this.readManualForm(form);
        if (configFromForm.apps.length <= 1) return;
        const row = target.closest('.app-row');
        const index = Number(row?.dataset.index);
        configFromForm.apps.splice(index, 1);
        this.renderManualForm(container, configFromForm, onChange);
        return;
      }

      if (target.classList.contains('browse-btn')) {
        const index = Number(target.dataset.index);
        this.openBrowseDialog((selectedPath) => {
          const row = appRows.querySelector(`.app-row[data-index="${index}"]`);
          const pathInput = row?.querySelector('[name="appPath"]');
          if (pathInput) {
            pathInput.value = selectedPath;
            notify();
          }
        });
      }
    });

    return form;
  },

  renderReview(container, validation) {
    const { config, errors = [], warnings = [] } = validation;

    container.innerHTML = `
      ${
        errors.length
          ? `<div class="alert alert-error"><strong>Fix these issues:</strong><ul>${errors.map((e) => `<li>${this.escapeHtml(e)}</li>`).join('')}</ul></div>`
          : ''
      }
      ${
        warnings.length
          ? `<div class="alert alert-warning"><strong>Warnings:</strong><ul>${warnings.map((w) => `<li>${this.escapeHtml(w)}</li>`).join('')}</ul></div>`
          : ''
      }
      <div class="review-table-wrap">
        <table class="review-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Path</th>
              <th>Command</th>
              <th>Port</th>
            </tr>
          </thead>
          <tbody>
            ${(config.apps || [])
              .map(
                (app) => `
              <tr>
                <td>${this.escapeHtml(app.name)}</td>
                <td><code>${this.escapeHtml(app.path)}</code></td>
                <td><code>${this.escapeHtml(app.command)}</code></td>
                <td>${app.port ?? '—'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  openBrowseDialog(onSelect) {
    let modal = document.getElementById('browseModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'browseModal';
      modal.className = 'modal hidden';
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-panel">
          <div class="modal-header">
            <h3>Select folder</h3>
            <button type="button" class="btn btn-ghost btn-sm" id="browseCloseBtn">Close</button>
          </div>
          <div class="browse-path" id="browseCurrentPath"></div>
          <div class="browse-list" id="browseList"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-primary" id="browseSelectBtn">Use this folder</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const backdrop = modal.querySelector('.modal-backdrop');
    const closeBtn = modal.querySelector('#browseCloseBtn');
    const listEl = modal.querySelector('#browseList');
    const pathEl = modal.querySelector('#browseCurrentPath');
    const selectBtn = modal.querySelector('#browseSelectBtn');

    let currentPath = null;
    let onSelectCallback = onSelect;

    const close = () => {
      modal.classList.add('hidden');
    };

    const loadPath = async (pathValue) => {
      listEl.innerHTML = '<p class="muted">Loading...</p>';
      try {
        const query = pathValue ? `?path=${encodeURIComponent(pathValue)}` : '';
        const data = await this.api(`/api/fs/browse${query}`);
        currentPath = data.path;
        pathEl.textContent = data.path;

        const items = [];
        if (data.parentPath) {
          items.push(
            `<button type="button" class="browse-item" data-path="${this.escapeHtml(data.parentPath)}">.. (parent)</button>`
          );
        }
        for (const dir of data.directories) {
          items.push(
            `<button type="button" class="browse-item" data-path="${this.escapeHtml(dir.path)}">${this.escapeHtml(dir.name)}</button>`
          );
        }
        listEl.innerHTML = items.length ? items.join('') : '<p class="muted">No subfolders</p>';
      } catch (err) {
        listEl.innerHTML = `<p class="alert-inline error">${this.escapeHtml(err.message)}</p>`;
      }
    };

    listEl.onclick = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('.browse-item');
      if (!item) return;
      loadPath(item.dataset.path);
    };

    selectBtn.onclick = () => {
      if (currentPath && onSelectCallback) {
        onSelectCallback(currentPath);
      }
      close();
    };

    closeBtn.onclick = close;
    backdrop.onclick = close;

    modal.classList.remove('hidden');
    loadPath('');
  },

  downloadJson(filename, config) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};

window.ConfigEditor = ConfigEditor;
