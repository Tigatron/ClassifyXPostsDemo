const LATEST_RUN_KEY = 'xbac.latestRun';

const elements = {
  statusText: document.getElementById('statusText'),
  bookmarkCount: document.getElementById('bookmarkCount'),
  summaryCount: document.getElementById('summaryCount'),
  classifiedCount: document.getElementById('classifiedCount'),
  progressFill: document.getElementById('progressFill'),
  progressMessage: document.getElementById('progressMessage'),
  startButton: document.getElementById('startButton'),
  categoryList: document.getElementById('categoryList'),
  openSidePanelButton: document.getElementById('openSidePanelButton'),
  exportButtons: document.querySelectorAll('[data-export]'),
  optionsButton: document.getElementById('optionsButton'),
  historyButton: document.getElementById('historyButton'),
  helpButton: document.getElementById('helpButton'),
  helpDialog: document.getElementById('helpDialog'),
  closeHelpButton: document.getElementById('closeHelpButton')
};

let currentState = null;

init();

function init() {
  elements.startButton.addEventListener('click', handleStart);
  elements.openSidePanelButton.addEventListener('click', handleOpenSidePanel);
  elements.optionsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.historyButton.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-history' }));
  elements.helpButton.addEventListener('click', () => elements.helpDialog.showModal());
  elements.closeHelpButton.addEventListener('click', () => elements.helpDialog.close());

  elements.exportButtons.forEach((button) => {
    button.addEventListener('click', () => handleExport(button.dataset.export));
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'state-update') {
      updateUI(message.state);
    }
  });

  chrome.runtime
    .sendMessage({ type: 'get-state' })
    .then((response) => {
      if (response?.state) {
        updateUI(response.state);
      }
    })
    .catch((error) => console.warn('获取状态失败', error));
}

async function handleStart() {
  try {
    disableStartButton(true);
    const response = await chrome.runtime.sendMessage({ type: 'start-classification' });
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? '启动失败');
    }
  } catch (error) {
    showMessage(error.message || '启动失败，请确认在 X 书签页面');
  } finally {
    disableStartButton(false);
  }
}

async function handleOpenSidePanel() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'open-sidepanel',
      tabId: currentState?.tabId ?? null
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? '无法打开侧边栏');
    }

    const targetTabId = response.tabId ?? currentState?.tabId ?? null;
    let targetWindowId = response.windowId ?? null;

    if (targetWindowId === null || targetWindowId === undefined) {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        targetWindowId = currentWindow?.id ?? null;
      } catch (error) {
        console.warn('获取当前窗口失败', error);
      }
    }

    if (targetWindowId !== null && targetWindowId !== undefined) {
      await chrome.sidePanel.open({ windowId: targetWindowId });
    } else if (targetTabId !== null && targetTabId !== undefined) {
      await chrome.sidePanel.open({ tabId: targetTabId });
    } else {
      throw new Error('无法确定侧边栏目标窗口，请刷新浏览器后重试。');
    }
  } catch (error) {
    showMessage(error.message || '无法打开侧边栏，请在支持的标签页内重试。');
  }
}

function disableStartButton(disabled) {
  elements.startButton.disabled = disabled;
  elements.startButton.textContent = disabled ? '处理中...' : '▶ 开始自动分类';
}

function updateUI(state) {
  if (!state) return;
  currentState = state;

  elements.statusText.textContent = translateStatus(state.status, state.stage);
  elements.progressMessage.textContent = state.message ?? '';
  elements.bookmarkCount.textContent = state.totals?.bookmarks ?? 0;
  elements.summaryCount.textContent = state.totals?.summarized ?? 0;
  elements.classifiedCount.textContent = state.totals?.classified ?? 0;

  const total = Number(state.totals?.bookmarks ?? 0);
  const completed = Math.min(Number(state.totals?.classified ?? 0), total);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  elements.progressFill.style.width = `${percent}%`;

  renderCategories(state.categories ?? {});

  const isProcessing = state.status === 'processing';
  disableStartButton(isProcessing);
}

function renderCategories(categories) {
  elements.categoryList.innerHTML = '';
  const entries = Object.values(categories);
  if (!entries.length) {
    const placeholder = document.createElement('li');
    placeholder.textContent = '尚无分类结果';
    placeholder.classList.add('empty');
    elements.categoryList.appendChild(placeholder);
    return;
  }

  entries
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .forEach((category) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'category-name';
      name.textContent = category.name ?? category.id;

      const count = document.createElement('span');
      count.className = 'category-count';
      count.textContent = category.count ?? 0;

      item.appendChild(name);
      item.appendChild(count);
      elements.categoryList.appendChild(item);
    });
}

async function handleExport(type) {
  const run = await loadLatestRun();
  if (!run) {
    showMessage('暂无可导出的结果，请先完成一次分类。');
    return;
  }

  try {
    if (type === 'markdown') {
      const markdown = buildMarkdown(run);
      await navigator.clipboard.writeText(markdown);
      showMessage('已复制 Markdown 到剪贴板。');
    } else if (type === 'json') {
      const json = JSON.stringify(run, null, 2);
      downloadFile(`xbac-${run.id}.json`, json, 'application/json');
    } else if (type === 'csv') {
      const csv = buildCSV(run);
      downloadFile(`xbac-${run.id}.csv`, csv, 'text/csv');
    }
  } catch (error) {
    showMessage(error.message || '导出失败，请重试。');
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function loadLatestRun() {
  const stored = await chrome.storage.local.get(LATEST_RUN_KEY);
  return stored[LATEST_RUN_KEY] ?? null;
}

function buildMarkdown(run) {
  const header = `# X 书签智能分类结果\n\n- 导出时间：${formatDateTime(
    run.createdAt
  )}\n- 总书签数：${run.totals?.all ?? 0}\n\n`;
  const sections = Object.values(run.categories)
    .sort((a, b) => b.items.length - a.items.length)
    .map((category) => {
      const lines = category.items
        .map((item) => {
          const title = item.summary.split('\n')[0] || item.summary;
          const author = item.displayName || item.username || '未知作者';
          return `- [${author}](${item.url}) · ${formatDateTime(item.datetime)}\n  - 摘要：${item.summary}`;
        })
        .join('\n');
      return `## ${category.name} (${category.items.length})\n\n${lines}\n`;
    });
  return header + sections.join('\n');
}

function buildCSV(run) {
  const header = '分类,标题,摘要,链接,用户名,时间';
  const rows = [];
  Object.values(run.categories).forEach((category) => {
    category.items.forEach((item) => {
      rows.push(
        [
          wrapCsvCell(category.name),
          wrapCsvCell(item.summary.split('\n')[0] || item.summary),
          wrapCsvCell(item.summary),
          wrapCsvCell(item.url),
          wrapCsvCell(item.username || item.displayName || ''),
          wrapCsvCell(formatDateTime(item.datetime))
        ].join(',')
      );
    });
  });
  return [header, ...rows].join('\n');
}

function wrapCsvCell(text) {
  const value = text ?? '';
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(
    2,
    '0'
  )}`;
}

function translateStatus(status, stage) {
  if (status === 'processing') {
    if (stage === 'collecting') return '提取书签中';
    if (stage === 'summarizing') return '生成摘要中';
    if (stage === 'classifying') return '分类处理中';
  }
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'error') {
    return '发生错误';
  }
  return '等待开始';
}

function showMessage(message) {
  elements.progressMessage.textContent = message;
}
