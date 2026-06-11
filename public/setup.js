const toast = document.getElementById('toast');
const stepper = document.getElementById('stepper');
const step1Panel = document.getElementById('step1Panel');
const step2Panel = document.getElementById('step2Panel');
const step3Panel = document.getElementById('step3Panel');
const templatePanel = document.getElementById('templatePanel');
const importPanel = document.getElementById('importPanel');
const templateGrid = document.getElementById('templateGrid');
const manualEditorHost = document.getElementById('manualEditorHost');
const reviewHost = document.getElementById('reviewHost');

let currentStep = 1;
let draftConfig = ConfigEditor.emptyConfig();
let lastValidation = null;
let manualForm = null;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove('hidden', 'error');
  if (isError) toast.classList.add('error');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function setStep(step) {
  currentStep = step;
  stepper.querySelectorAll('.step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
    el.classList.toggle('done', Number(el.dataset.step) < step);
  });

  step1Panel.classList.toggle('hidden', step !== 1);
  step2Panel.classList.toggle('hidden', step !== 2);
  step3Panel.classList.toggle('hidden', step !== 3);
}

async function checkSetupStatus() {
  const status = await ConfigEditor.api('/api/setup/status');
  document.getElementById('configPathHint').textContent = `Config will be saved to: ${status.configPath}`;
  if (status.configured) {
    window.location.href = '/';
  }
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
          <button type="button" class="btn btn-primary btn-sm use-template-btn" data-id="${ConfigEditor.escapeHtml(template.id)}">Use template</button>
        </div>
      </article>`
    )
    .join('');
}

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
      draftConfig = data.config;
      openManualStep();
      showToast(`Loaded ${data.name} template — update paths before saving`);
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

document.querySelectorAll('.method-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.method-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');

    const method = card.dataset.method;
    templatePanel.classList.toggle('hidden', method !== 'template');
    importPanel.classList.toggle('hidden', method !== 'import');

    if (method === 'manual') {
      openManualStep();
    }
  });
});

function openManualStep() {
  manualForm = ConfigEditor.renderManualForm(manualEditorHost, draftConfig, (config) => {
    draftConfig = config;
  });
  setStep(2);
}

document.getElementById('parseImportBtn').addEventListener('click', () => {
  try {
    const fileInput = document.getElementById('importFile');
    const text = document.getElementById('importText').value.trim();

    if (fileInput.files?.[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          draftConfig = ConfigEditor.parseJson(reader.result);
          openManualStep();
        } catch (err) {
          showToast(err.message, true);
        }
      };
      reader.readAsText(fileInput.files[0]);
      return;
    }

    if (!text) {
      showToast('Upload a file or paste JSON first', true);
      return;
    }

    draftConfig = ConfigEditor.parseJson(text);
    openManualStep();
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('backToStep1Btn').addEventListener('click', () => setStep(1));

document.getElementById('toReviewBtn').addEventListener('click', async () => {
  if (manualForm) {
    draftConfig = ConfigEditor.readManualForm(manualForm);
  }

  try {
    lastValidation = await ConfigEditor.validate(draftConfig);
    ConfigEditor.renderReview(reviewHost, lastValidation);
    setStep(3);
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('backToStep2Btn').addEventListener('click', () => setStep(2));

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  if (manualForm) {
    draftConfig = ConfigEditor.readManualForm(manualForm);
  }

  try {
    const validation = await ConfigEditor.validate(draftConfig);
    if (!validation.ok) {
      ConfigEditor.renderReview(reviewHost, validation);
      showToast('Fix validation errors before saving', true);
      return;
    }

    const result = await ConfigEditor.save(draftConfig);
    if (result.warnings?.length) {
      showToast(`Saved with ${result.warnings.length} warning(s)`);
    } else {
      showToast('Configuration saved');
    }

    setTimeout(() => {
      window.location.href = '/';
    }, 400);
  } catch (err) {
    showToast(err.message, true);
  }
});

checkSetupStatus().catch((err) => showToast(err.message, true));
loadTemplates().catch((err) => showToast(err.message, true));
