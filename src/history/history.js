const LATEST_RUN_KEY = 'xbac.latestRun';

const historyContainer = document.getElementById('historyContainer');
const historyTemplate = document.getElementById('historyTemplate');
const refreshButton = document.getElementById('refreshButton');
const clearButton = document.getElementById('clearButton');

let historyData = [];

init();

function init() {
  refreshButton.addEventListener('click', loadHistory);
  clearButton.addEventListener('click', clearHistory);
  loadHistory();
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'request-history' });
  historyData = response?.history ?? [];
  renderHistory();
}

async function clearHistory() {
  if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: 'clear-history' });
  if (response?.ok) {
    historyData = [];
    renderHistory();
  }
}

function renderHistory() {
  historyContainer.innerHTML = '';
  if (!historyData.length) {
    historyContainer.innerHTML = '<div class="empty-hint">暂无历史记录</div>';
    return;
  }

  historyData.forEach((run) => {
    const node = historyTemplate.content.cloneNode(true);
    const card = node.querySelector('.history-card');
    card.dataset.runId = run.id;

    card.querySelector('.history-title').textContent = `Run ${run.id}`;
    card.querySelector('.history-time').textContent = `创建时间：${formatDateTime(run.createdAt)}`;
    card.querySelector('.history-count').textContent = `总数：${run.totals?.all ?? 0}`;

    const categoryList = card.querySelector('.history-categories');
    Object.values(run.categories ?? {}).forEach((category) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${category.name}</span><span>${category.items.length} 条</span>`;
      categoryList.appendChild(li);
    });

    card.querySelector('.view-sidepanel').addEventListener('click', () => handleViewInSidePanel(run));
    card.querySelector('.copy-markdown').addEventListener('click', () => copyMarkdown(run));
    card.querySelector('.download-json').addEventListener('click', () => downloadJSON(run));

    historyContainer.appendChild(node);
  });
}

async function handleViewInSidePanel(run) {
  await chrome.storage.local.set({ [LATEST_RUN_KEY]: run });
  await chrome.runtime.sendMessage({ type: 'open-sidepanel' });
}

async function copyMarkdown(run) {
  const markdown = buildMarkdown(run);
  await navigator.clipboard.writeText(markdown);
  alert('已复制 Markdown');
}

function downloadJSON(run) {
  const json = JSON.stringify(run, null, 2);
  downloadFile(`xbac-${run.id}.json`, json, 'application/json');
}

function buildMarkdown(run) {
  const header = `# X 书签分类结果（${run.id}）\n\n- 时间：${formatDateTime(run.createdAt)}\n- 总数：${
    run.totals?.all ?? 0
  }\n\n`;
  const sections = Object.values(run.categories ?? {})
    .sort((a, b) => b.items.length - a.items.length)
    .map((category) => {
      const lines = category.items
        .map(
          (item) =>
            `- [${item.displayName || item.username || item.url}](${item.url})\n  - ${item.summary}`
        )
        .join('\n');
      return `## ${category.name} (${category.items.length})\n\n${lines}\n`;
    });
  return header + sections.join('\n');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(
    2,
    '0'
  )}`;
}
