const LATEST_RUN_KEY = 'xbac.latestRun';

const els = {
  runInfo: document.getElementById('runInfo'),
  totalCount: document.getElementById('totalCount'),
  categoryCount: document.getElementById('categoryCount'),
  updatedAt: document.getElementById('updatedAt'),
  categoryContainer: document.getElementById('categoryContainer'),
  refreshButton: document.getElementById('refreshButton'),
  copyMarkdownButton: document.getElementById('copyMarkdownButton'),
  categoryTemplate: document.getElementById('categoryTemplate'),
  bookmarkTemplate: document.getElementById('bookmarkTemplate')
};

let currentRun = null;

init();

function init() {
  els.refreshButton.addEventListener('click', refresh);
  els.copyMarkdownButton.addEventListener('click', copyMarkdown);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'state-update') {
      if (message.state?.status === 'completed') {
        refresh();
      } else if (message.state?.status === 'processing') {
        els.runInfo.textContent = '处理中...';
      }
    }
  });

  refresh();
}

async function refresh() {
  currentRun = await loadLatestRun();
  if (!currentRun) {
    renderEmpty();
    return;
  }
  renderRun(currentRun);
}

async function copyMarkdown() {
  if (!currentRun) {
    await refresh();
  }
  if (!currentRun) {
    notify('暂无可复制的内容');
    return;
  }
  const markdown = buildMarkdown(currentRun);
  await navigator.clipboard.writeText(markdown);
  notify('已复制 Markdown');
}

async function loadLatestRun() {
  const stored = await chrome.storage.local.get(LATEST_RUN_KEY);
  return stored[LATEST_RUN_KEY] ?? null;
}

function renderEmpty() {
  els.runInfo.textContent = '尚未生成分类结果';
  els.totalCount.textContent = '0';
  els.categoryCount.textContent = '0';
  els.updatedAt.textContent = '-';
  els.categoryContainer.innerHTML = `
    <div class="empty-hint">
      <p>请在 X 书签页面中运行插件以生成分类结果。</p>
    </div>
  `;
}

function renderRun(run) {
  els.runInfo.textContent = `Run ${run.id}`;
  els.totalCount.textContent = run.totals?.all ?? run.items?.length ?? 0;
  els.categoryCount.textContent = Object.keys(run.categories ?? {}).length;
  els.updatedAt.textContent = formatDateTime(run.createdAt);

  els.categoryContainer.innerHTML = '';
  const categories = Object.values(run.categories ?? {}).sort((a, b) => b.items.length - a.items.length);
  categories.forEach((category) => {
    const node = els.categoryTemplate.content.cloneNode(true);
    const details = node.querySelector('details');
    details.dataset.categoryId = category.id;
    details.querySelector('.category-name').textContent = category.name;
    details.querySelector('.category-meta').textContent = `${category.items.length} 条`;

    const list = details.querySelector('.bookmark-list');
    category.items.forEach((item) => {
      const itemNode = els.bookmarkTemplate.content.cloneNode(true);
      const link = itemNode.querySelector('.bookmark-link');
      link.href = item.url;
      link.textContent = item.displayName || item.username || item.url;
      itemNode.querySelector('.bookmark-summary').textContent = item.summary;
      itemNode.querySelector('.author').textContent = item.username || item.displayName || '';
      itemNode.querySelector('.datetime').textContent = formatDateTime(item.datetime);
      list.appendChild(itemNode);
    });
    els.categoryContainer.appendChild(node);
  });
}

function buildMarkdown(run) {
  const header = `# X 书签分类结果\n\n- 导出时间：${formatDateTime(run.createdAt)}\n- 总数：${
    run.totals?.all ?? 0
  }\n\n`;
  const sections = Object.values(run.categories ?? {})
    .sort((a, b) => b.items.length - a.items.length)
    .map((category) => {
      const lines = category.items
        .map((item) => `- [${item.displayName || item.username || item.url}](${item.url})\n  - ${item.summary}`)
        .join('\n');
      return `## ${category.name} (${category.items.length})\n\n${lines}\n`;
    });
  return header + sections.join('\n');
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function notify(message) {
  els.runInfo.textContent = message;
  setTimeout(() => {
    if (currentRun) {
      els.runInfo.textContent = `Run ${currentRun.id}`;
    } else {
      els.runInfo.textContent = '尚未生成分类结果';
    }
  }, 2000);
}
