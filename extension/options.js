import {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeCategory,
  cloneSettings,
} from './settings.js';

const summarizerType = document.getElementById('summarizer-type');
const summarizerLength = document.getElementById('summarizer-length');
const summarizerFormat = document.getElementById('summarizer-format');
const summarizerLanguage = document.getElementById('summarizer-language');
const summarizerTimeout = document.getElementById('summarizer-timeout');
const categoryRows = document.getElementById('category-rows');
const addCategoryButton = document.getElementById('add-category');
const exportFormat = document.getElementById('export-format');
const exportPrefix = document.getElementById('export-prefix');
const saveButton = document.getElementById('save-button');
const resetButton = document.getElementById('reset-button');
const statusEl = document.getElementById('status');
const template = document.getElementById('category-row-template');

let currentSettings = cloneSettings(DEFAULT_SETTINGS);

function applyColorScheme() {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const update = () => {
    document.body.classList.toggle('light', prefersLight.matches);
  };
  update();
  prefersLight.addEventListener('change', update);
}

applyColorScheme();

function setStatus(message, isError = false) {
  statusEl.textContent = message ?? '';
  statusEl.style.color = isError ? '#f87171' : '';
}

function renderSummarizer(settings) {
  summarizerType.value = settings.summarizer.type;
  if (summarizerType.value !== settings.summarizer.type) {
    summarizerType.value = DEFAULT_SETTINGS.summarizer.type;
  }
  summarizerLength.value = settings.summarizer.length;
  if (summarizerLength.value !== settings.summarizer.length) {
    summarizerLength.value = DEFAULT_SETTINGS.summarizer.length;
  }
  summarizerFormat.value = settings.summarizer.format;
  if (summarizerFormat.value !== settings.summarizer.format) {
    summarizerFormat.value = DEFAULT_SETTINGS.summarizer.format;
  }
  summarizerLanguage.value = settings.summarizer.language ?? '';
  summarizerTimeout.value = settings.summarizer.timeoutMs ?? DEFAULT_SETTINGS.summarizer.timeoutMs;
}

function createCategoryRow(category) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector('.category-row');
  row.querySelector('.category-id').value = category.id ?? '';
  row.querySelector('.category-name').value = category.name ?? '';
  row.querySelector('.category-keywords').value = Array.isArray(category.keywords)
    ? category.keywords.join(', ')
    : '';
  row.querySelector('.category-description').value = category.description ?? '';
  row.querySelector('.remove-category').addEventListener('click', () => {
    row.remove();
  });
  categoryRows.appendChild(fragment);
}

function renderCategories(settings) {
  categoryRows.innerHTML = '';
  settings.categories.forEach((category) => createCategoryRow(category));
}

function renderExport(settings) {
  exportFormat.value = settings.export.defaultFormat;
  if (exportFormat.value !== settings.export.defaultFormat) {
    exportFormat.value = DEFAULT_SETTINGS.export.defaultFormat;
  }
  exportPrefix.value = settings.export.fileNamePrefix;
}

function render(settings) {
  renderSummarizer(settings);
  renderCategories(settings);
  renderExport(settings);
}

function readCategoriesFromDom() {
  const rows = Array.from(categoryRows.querySelectorAll('.category-row'));
  return rows
    .map((row, index) => {
      const id = row.querySelector('.category-id').value;
      const name = row.querySelector('.category-name').value.trim();
      const keywords = row.querySelector('.category-keywords').value;
      const description = row.querySelector('.category-description').value.trim();
      const normalized = normalizeCategory({ id, name, keywords, description }, index);
      if (normalized) {
        return normalized;
      }
      return null;
    })
    .filter(Boolean);
}

function buildSettingsFromForm() {
  const timeout = Number.parseInt(summarizerTimeout.value, 10);
  const categories = readCategoriesFromDom();
  return {
    summarizer: {
      type: summarizerType.value,
      length: summarizerLength.value,
      format: summarizerFormat.value,
      language: summarizerLanguage.value.trim() || undefined,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SETTINGS.summarizer.timeoutMs,
    },
    categories,
    export: {
      defaultFormat: exportFormat.value,
      fileNamePrefix: exportPrefix.value.trim() || DEFAULT_SETTINGS.export.fileNamePrefix,
    },
  };
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    currentSettings = normalizeSettings(stored?.[SETTINGS_KEY]);
  } catch (error) {
    console.warn('加载设置失败，使用默认配置。', error);
    currentSettings = cloneSettings(DEFAULT_SETTINGS);
  }
  render(currentSettings);
}

async function saveSettings() {
  const next = buildSettingsFromForm();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  currentSettings = normalizeSettings(next);
  setStatus('设置已保存。');
}

async function resetSettings() {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  currentSettings = cloneSettings(DEFAULT_SETTINGS);
  render(currentSettings);
  setStatus('已恢复默认设置。');
}

addCategoryButton.addEventListener('click', () => {
  const timestamp = Date.now();
  createCategoryRow({
    id: `custom-${timestamp}`,
    name: '',
    keywords: [],
    description: '',
  });
});

saveButton.addEventListener('click', () => {
  saveSettings().catch((error) => {
    console.error(error);
    setStatus('保存失败，请重试。', true);
  });
});

resetButton.addEventListener('click', () => {
  if (confirm('确定要恢复默认设置吗？现有配置将被覆盖。')) {
    resetSettings().catch((error) => {
      console.error(error);
      setStatus('恢复失败，请重试。', true);
    });
  }
});

loadSettings();
