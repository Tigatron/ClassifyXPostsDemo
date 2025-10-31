import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  toKeywordList,
  keywordListToText,
  normalizeSettings
} from '../common/settings.js';

const summaryForm = document.getElementById('summaryForm');
const categoriesContainer = document.getElementById('categoriesContainer');
const addCategoryButton = document.getElementById('addCategoryButton');
const autoOpenSidePanelInput = document.getElementById('autoOpenSidePanel');
const historyLimitInput = document.getElementById('historyLimit');
const saveButton = document.getElementById('saveButton');
const resetButton = document.getElementById('resetButton');
const statusLabel = document.getElementById('statusLabel');
const categoryTemplate = document.getElementById('categoryTemplate');

let currentSettings = null;

init();

async function init() {
  currentSettings = await getSettings();
  renderSettings(currentSettings);

  addCategoryButton.addEventListener('click', handleAddCategory);
  saveButton.addEventListener('click', handleSave);
  resetButton.addEventListener('click', handleReset);
}

function renderSettings(settings) {
  const { summary, categories, fallbackCategoryId, autoOpenSidePanel, historyLimit } =
    normalizeSettings(settings);

  summaryForm.elements.type.value = summary.type;
  summaryForm.elements.format.value = summary.format;
  summaryForm.elements.length.value = summary.length;
  summaryForm.elements.sharedContext.value = summary.sharedContext;
  summaryForm.elements.perItemFocus.value = summary.perItemFocus ?? '';

  autoOpenSidePanelInput.checked = Boolean(autoOpenSidePanel);
  historyLimitInput.value = historyLimit ?? 10;

  categoriesContainer.innerHTML = '';
  categories.forEach((category) => {
    const node = categoryTemplate.content.cloneNode(true);
    const card = node.querySelector('.category-card');
    card.dataset.categoryId = category.id;

    const nameInput = card.querySelector('.category-name');
    nameInput.value = category.name;

    const keywordsInput = card.querySelector('.category-keywords');
    keywordsInput.value = keywordListToText(category.keywords);

    const fallbackRadio = card.querySelector('.fallback-radio');
    fallbackRadio.name = 'fallback-category';
    fallbackRadio.checked = category.id === fallbackCategoryId;
    fallbackRadio.addEventListener('change', () => setFallbackCategory(category.id));

    const removeButton = card.querySelector('.remove-category');
    removeButton.addEventListener('click', () => removeCategory(category.id));

    categoriesContainer.appendChild(node);
  });

  ensureFallbackExists();
}

function handleAddCategory() {
  const id = generateCategoryId();
  const node = categoryTemplate.content.cloneNode(true);
  const card = node.querySelector('.category-card');
  card.dataset.categoryId = id;

  const fallbackRadio = card.querySelector('.fallback-radio');
  fallbackRadio.name = 'fallback-category';
  fallbackRadio.addEventListener('change', () => setFallbackCategory(id));

  const removeButton = card.querySelector('.remove-category');
  removeButton.addEventListener('click', () => removeCategory(id));

  categoriesContainer.appendChild(node);
  ensureFallbackExists();
}

function removeCategory(categoryId) {
  const cards = Array.from(categoriesContainer.querySelectorAll('.category-card'));
  if (cards.length <= 1) {
    statusLabel.textContent = '至少需要保留一个分类。';
    return;
  }

  cards.forEach((card) => {
    if (card.dataset.categoryId === categoryId) {
      categoriesContainer.removeChild(card);
    }
  });

  ensureFallbackExists();
}

function setFallbackCategory(categoryId) {
  const radios = categoriesContainer.querySelectorAll('.fallback-radio');
  radios.forEach((radio) => {
    const card = radio.closest('.category-card');
    radio.checked = card.dataset.categoryId === categoryId;
  });
}

function ensureFallbackExists() {
  const radios = Array.from(categoriesContainer.querySelectorAll('.fallback-radio'));
  if (!radios.length) return;

  const hasChecked = radios.some((radio) => radio.checked);
  if (!hasChecked) {
    radios[0].checked = true;
  }
}

async function handleSave() {
  const summaryData = new FormData(summaryForm);
  const summary = {
    type: summaryData.get('type'),
    format: summaryData.get('format'),
    length: summaryData.get('length'),
    sharedContext: summaryData.get('sharedContext'),
    perItemFocus: summaryData.get('perItemFocus')
  };

  const categories = Array.from(categoriesContainer.querySelectorAll('.category-card')).map(
    (card, index) => {
      const id = card.dataset.categoryId || generateCategoryId(index);
      const name = card.querySelector('.category-name').value.trim() || `分类 ${index + 1}`;
      const keywords = toKeywordList(card.querySelector('.category-keywords').value);
      return { id, name, keywords };
    }
  );

  const fallbackRadio = categoriesContainer.querySelector('.fallback-radio:checked');
  const fallbackCard = fallbackRadio?.closest('.category-card');
  const fallbackCategoryId = fallbackCard?.dataset.categoryId ?? categories[0]?.id;

  const historyLimit = Number.parseInt(historyLimitInput.value, 10) || DEFAULT_SETTINGS.historyLimit;

  const nextSettings = {
    summary,
    categories,
    fallbackCategoryId,
    autoOpenSidePanel: autoOpenSidePanelInput.checked,
    historyLimit
  };

  currentSettings = await saveSettings(nextSettings);
  statusLabel.textContent = '已保存';
  setTimeout(() => {
    statusLabel.textContent = '';
  }, 2000);
}

async function handleReset() {
  currentSettings = await saveSettings(DEFAULT_SETTINGS);
  renderSettings(currentSettings);
  statusLabel.textContent = '已恢复默认';
  setTimeout(() => {
    statusLabel.textContent = '';
  }, 2000);
}

function generateCategoryId(seed = '') {
  if (crypto?.randomUUID) {
    return `cat-${crypto.randomUUID()}`;
  }
  return `cat-${Date.now()}-${Math.random().toString(16).slice(2)}-${seed}`;
}
