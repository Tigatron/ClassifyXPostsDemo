import { LATEST_RESULT_KEY } from './settings.js';

const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');
const refreshButton = document.getElementById('refresh-button');

function applyColorScheme() {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const update = () => {
    document.body.classList.toggle('light', prefersLight.matches);
  };
  update();
  prefersLight.addEventListener('change', update);
}

applyColorScheme();

function formatSummary(classification) {
  const lines = [];
  lines.push(`最新更新：${new Date(classification.generatedAt).toLocaleString()}`);
  lines.push(`书签总数：${classification.totalCount}`);
  const categoryCount = classification.categories?.length ?? 0;
  lines.push(`分类数量：${categoryCount}`);
  return lines.join(' ｜ ');
}

function createPostCard(post, index) {
  const card = document.createElement('div');
  card.className = 'post-card';

  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const segments = [`#${index + 1}`];
  if (post.displayName || post.username) {
    segments.push([post.displayName, post.username].filter(Boolean).join(' '));
  }
  if (post.datetime) {
    segments.push(new Date(post.datetime).toLocaleString());
  }
  if (post.stage === 'keyword') {
    segments.push('关键词匹配');
  } else if (post.stage === 'semantic') {
    segments.push('语义匹配');
  }
  meta.textContent = segments.join(' ｜ ');
  card.appendChild(meta);

  if (post.summary) {
    const summary = document.createElement('p');
    summary.className = 'post-summary';
    summary.textContent = post.summary;
    card.appendChild(summary);
  }

  if (post.reason) {
    const reason = document.createElement('p');
    reason.className = 'post-reason';
    reason.textContent = post.reason;
    card.appendChild(reason);
  }

  if (post.url) {
    const link = document.createElement('a');
    link.href = post.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '查看原帖';
    card.appendChild(link);
  }

  return card;
}

function renderClassification(classification) {
  resultsEl.innerHTML = '';
  if (!classification || !Array.isArray(classification.categories) || classification.categories.length === 0) {
    summaryEl.textContent = '暂无分类结果，请在弹窗中执行分类后查看。';
    return;
  }
  summaryEl.textContent = formatSummary(classification);

  classification.categories.forEach((category) => {
    const details = document.createElement('details');
    details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = `${category.name}（${category.posts.length}）`;
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'category-content';
    category.posts.forEach((post, index) => {
      content.appendChild(createPostCard(post, index));
    });
    details.appendChild(content);

    resultsEl.appendChild(details);
  });
}

async function loadLatestClassification() {
  try {
    const stored = await chrome.storage.local.get(LATEST_RESULT_KEY);
    renderClassification(stored?.[LATEST_RESULT_KEY]);
  } catch (error) {
    console.error('无法读取最新分类结果。', error);
    summaryEl.textContent = '无法读取分类结果，请稍后重试。';
  }
}

refreshButton.addEventListener('click', () => {
  loadLatestClassification();
});

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LATEST_RESULT_KEY]) {
      renderClassification(changes[LATEST_RESULT_KEY].newValue);
    }
  });
}

loadLatestClassification();
