import { getSettings, saveSettings, DEFAULT_SETTINGS } from './common/settings.js';

const HISTORY_KEY = 'xbac.history';
const LATEST_RUN_KEY = 'xbac.latestRun';
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';

let offscreenCreationPromise = null;
let offscreenCreated = false;

const state = {
  status: 'idle',
  stage: 'idle',
  message: '等待开始',
  totals: {
    bookmarks: 0,
    summarized: 0,
    classified: 0
  },
  runId: null,
  error: null,
  tabId: null,
  categories: {},
  startedAt: null,
  finishedAt: null
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await getSettings();
  if (!existing) {
    await saveSettings(DEFAULT_SETTINGS);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'get-state': {
      sendResponse({ state: serializeState() });
      return;
    }
    case 'start-classification': {
      handleStartClassification(message.tabId)
        .then((run) => sendResponse({ ok: true, run }))
        .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
      return true;
    }
    case 'get-settings': {
      getSettings().then((settings) => sendResponse({ settings })).catch((error) => sendResponse({ error: serializeError(error) }));
      return true;
    }
    case 'save-settings': {
      saveSettings(message.settings)
        .then((settings) => sendResponse({ ok: true, settings }))
        .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
      return true;
    }
    case 'request-history': {
      loadHistory()
        .then((history) => sendResponse({ history }))
        .catch((error) => sendResponse({ error: serializeError(error) }));
      return true;
    }
    case 'clear-history': {
      chrome.storage.local
        .set({ [HISTORY_KEY]: [] })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
      return true;
    }
    case 'collector-progress': {
      updateState({
        stage: 'collecting',
        message: message.message ?? state.message,
        totals: {
          ...state.totals,
          bookmarks: message.collected ?? state.totals.bookmarks
        }
      });
      sendStateUpdate();
      return;
    }
    case 'collector-error': {
      updateState({
        status: 'error',
        stage: 'collecting',
        message: message.message ?? '提取书签失败',
        error: message.error
      });
      sendStateUpdate();
      return;
    }
    case 'open-history': {
      openHistoryPage()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
      return true;
    }
    case 'open-sidepanel': {
      handlePrepareSidePanel(message.tabId)
        .then((panelInfo) => sendResponse({ ok: true, ...panelInfo }))
        .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
      return true;
    }
    default:
      break;
  }
});

async function handleStartClassification(explicitTabId) {
  if (state.status === 'processing') {
    throw new Error('正在处理中，请稍候完成后重试。');
  }

  const tab = explicitTabId ? await getTab(explicitTabId) : await getActiveTab();
  if (!tab?.id) {
    throw new Error('未找到可用的标签页。请在 X 书签页面中重试。');
  }
  if (!isBookmarkUrl(tab.url)) {
    throw new Error('请在 X 书签页面执行自动分类（https://x.com/i/bookmarks）。');
  }

  const tabId = tab.id;
  const settings = await getSettings();
  updateState({
    status: 'processing',
    stage: 'collecting',
    message: '正在提取书签...',
    totals: { bookmarks: 0, summarized: 0, classified: 0 },
    error: null,
    tabId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    categories: {}
  });
  sendStateUpdate();

  try {
    await ensureCollectorInjected(tabId);
  } catch (error) {
    updateState({
      status: 'error',
      stage: 'collecting',
      message: error.message || '无法注入采集脚本，请刷新书签页面后重试。',
      error: serializeError(error)
    });
    sendStateUpdate();
    throw error;
  }

  let bookmarks;
  try {
    bookmarks = await collectBookmarks(tabId);
  } catch (error) {
    updateState({
      status: 'error',
      stage: 'collecting',
      message: '书签提取失败，请确认已打开 X 书签页面。',
      error: serializeError(error)
    });
    sendStateUpdate();
    throw error;
  }

  if (!bookmarks?.length) {
    updateState({
      status: 'completed',
      stage: 'collecting',
      message: '未找到任何书签。',
      totals: { bookmarks: 0, summarized: 0, classified: 0 },
      finishedAt: new Date().toISOString()
    });
    sendStateUpdate();
    return null;
  }

  updateState({
    stage: 'summarizing',
    message: '正在生成摘要...',
    totals: { ...state.totals, bookmarks: bookmarks.length }
  });
  sendStateUpdate();

  try {
    await ensureOffscreenDocument();
  } catch (error) {
    updateState({
      status: 'error',
      stage: 'summarizing',
      message: error.message || 'Summarizer API 初始化失败',
      error: serializeError(error)
    });
    sendStateUpdate();
    throw error;
  }

  const summarized = [];
  for (let index = 0; index < bookmarks.length; index += 1) {
    const bookmark = bookmarks[index];
    try {
      const summary = await requestSummaryForBookmark(bookmark, settings.summary);
      const classification = classifySummary(summary, settings, bookmark);
      summarized.push({
        ...bookmark,
        summary,
        category: classification.categoryId,
        score: classification.score
      });
      updateState({
        stage: 'summarizing',
        message: `生成摘要中 (${index + 1}/${bookmarks.length})`,
        totals: {
          bookmarks: bookmarks.length,
          summarized: index + 1,
          classified: Math.min(state.totals.classified, index + 1)
        }
      });
      sendStateUpdate();
    } catch (error) {
      summarized.push({
        ...bookmark,
        summary: `摘要失败: ${error.message || '未知错误'}`,
        category: settings.fallbackCategoryId,
        score: 0
      });
    }
  }

  updateState({
    stage: 'classifying',
    message: '正在进行分类...',
    totals: {
      ...state.totals,
      summarized: summarized.length
    }
  });
  sendStateUpdate();

  const classified = summarized.map((item) => {
    if (item.score > 0) {
      return item;
    }
    const classification = classifySummary(item.summary, settings, item);
    return { ...item, category: classification.categoryId, score: classification.score };
  });

  const grouped = aggregateByCategory(classified, settings);
  const run = {
    id: generateRunId(),
    createdAt: new Date().toISOString(),
    settingsSnapshot: settings,
    totals: {
      all: classified.length,
      categories: mapValues(grouped, (group) => group.items.length)
    },
    categories: grouped,
    items: classified
  };

  await persistRun(run, settings.historyLimit);
  await chrome.storage.local.set({ [LATEST_RUN_KEY]: run });

  updateState({
    status: 'completed',
    stage: 'completed',
    message: '分类完成',
    totals: {
      bookmarks: classified.length,
      summarized: classified.length,
      classified: classified.length
    },
    categories: summarizeCategories(grouped),
    finishedAt: new Date().toISOString(),
    runId: run.id
  });
  sendStateUpdate();

  if (settings.autoOpenSidePanel && state.tabId) {
    try {
      await prepareSidePanelForTab(state.tabId);
      updateState({
        message: '分类完成，点击“在侧边栏查看”按钮查看详细分类结果。'
      });
      sendStateUpdate();
    } catch (error) {
      console.warn('准备侧边栏失败', error);
    }
  }

  return run;
}

async function collectBookmarks(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'collect-bookmarks' }, { frameId: 0 });
    if (response?.error) {
      throw new Error(response.error);
    }
    if (!response) {
      throw new Error('内容脚本未响应，请刷新 X 书签页面后重试。');
    }
    return response.bookmarks ?? [];
  } catch (error) {
    if (error?.message?.includes('Could not establish connection')) {
      throw new Error('无法连接到书签页面，请确认已刷新页面并允许扩展访问该站点。');
    }
    throw error;
  }
}

async function requestSummaryForBookmark(bookmark, summaryOptions) {
  await ensureOffscreenDocument();
  const { perItemFocus = '', ...createOptions } = summaryOptions ?? {};
  const content = composeBookmarkContent(bookmark);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'offscreen-summarize',
      payload: {
        createOptions,
        content,
        context: perItemFocus
      }
    });
    if (!response) {
      throw new Error('Offscreen summarizer 未响应。');
    }
    if (!response.ok) {
      throw new Error(response.error?.message || response.error || '摘要失败');
    }
    return response.summary;
  } catch (error) {
    throw error;
  }
}

function composeBookmarkContent(bookmark) {
  const textParts = [];
  if (bookmark.displayName) textParts.push(`作者: ${bookmark.displayName}`);
  if (bookmark.username) textParts.push(`账号: ${bookmark.username}`);
  if (bookmark.text) textParts.push(`内容: ${bookmark.text}`);
  if (bookmark.hasMedia) {
    textParts.push(`媒体: ${bookmark.mediaType ?? '未知类型'}`);
  }
  return textParts.join('\n');
}

function classifySummary(summary, settings, bookmark) {
  const text = `${bookmark.username ?? ''} ${bookmark.displayName ?? ''} ${bookmark.text ?? ''} ${summary ?? ''}`.toLowerCase();
  let best = { categoryId: settings.fallbackCategoryId, score: 0 };
  for (const category of settings.categories) {
    if (!category.keywords?.length) {
      continue;
    }
    let score = 0;
    for (const keyword of category.keywords) {
      if (!keyword) continue;
      const lower = keyword.toLowerCase();
      if (text.includes(lower)) {
        score += 1;
      }
    }
    if (score > best.score) {
      best = { categoryId: category.id, score };
    }
  }
  if (best.score === 0) {
    best = { categoryId: settings.fallbackCategoryId, score: 0 };
  }
  return best;
}

async function persistRun(run, limit) {
  const history = await loadHistory();
  const next = [run, ...history];
  if (limit && next.length > limit) {
    next.length = limit;
  }
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

async function prepareSidePanel(tab) {
  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: SIDE_PANEL_PATH,
      enabled: true
    });
    return { tabId: tab.id, windowId: tab.windowId ?? null };
  } catch (error) {
    console.warn('prepareSidePanel failed', error);
    throw new Error(error?.message || '无法准备侧边栏，请确认当前窗口支持侧边栏。');
  }
}

async function prepareSidePanelForTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id) {
    throw new Error('指定的标签页不可用或已关闭。');
  }
  return prepareSidePanel(tab);
}

async function handlePrepareSidePanel(explicitTabId) {
  let tab = null;
  if (explicitTabId) {
    tab = await getTab(explicitTabId);
  }
  if (!tab && state.tabId) {
    tab = await getTab(state.tabId);
  }
  if (!tab) {
    tab = await getActiveTab();
  }
  if (!tab?.id) {
    throw new Error('未找到可用的标签页，请先在浏览器中打开一个页面。');
  }
  updateState({ tabId: tab.id });
  sendStateUpdate();
  return prepareSidePanel(tab);
}

function summarizeCategories(grouped) {
  return mapValues(grouped, (group) => ({
    id: group.id,
    name: group.name,
    count: group.items.length
  }));
}

function aggregateByCategory(items, settings) {
  const categoryIndex = new Map(settings.categories.map((cat) => [cat.id, cat]));
  const grouped = {};
  for (const item of items) {
    const category = categoryIndex.get(item.category) || categoryIndex.get(settings.fallbackCategoryId) || settings.categories[0];
    const id = category.id;
    if (!grouped[id]) {
      grouped[id] = {
        id,
        name: category.name,
        keywords: category.keywords,
        items: []
      };
    }
    grouped[id].items.push(item);
  }
  return grouped;
}

function serializeState() {
  return { ...state, totals: { ...state.totals }, categories: { ...state.categories } };
}

function updateState(patch) {
  Object.assign(state, patch);
}

function sendStateUpdate() {
  chrome.runtime.sendMessage({ type: 'state-update', state: serializeState() }).catch(() => {});
}

function serializeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  return {
    message: error.message || '未知错误',
    stack: error.stack
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    return tab;
  }
  const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return lastFocused ?? null;
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    console.warn('获取标签页失败', error);
    return null;
  }
}

function mapValues(object, iteratee) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, iteratee(value, key)]));
}

function generateRunId() {
  return `run-${Date.now()}`;
}

async function openHistoryPage() {
  const url = chrome.runtime.getURL('src/history/history.html');
  await chrome.tabs.create({ url });
}

function isBookmarkUrl(url = '') {
  return /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/bookmarks/.test(url);
}

async function ensureCollectorInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/bookmarkCollector.js']
    });
  } catch (error) {
    const message = error?.message ?? '';
    const ignorable =
      message.includes('Cannot access contents of') ||
      message.includes('No window with id') ||
      message.includes('Frame with id');
    if (!ignorable) {
      throw error;
    }
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'collector-ping' }, { frameId: 0 });
  } catch (error) {
    throw new Error('内容脚本未加载，请刷新书签页面后重试。');
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error('当前 Chrome 版本不支持 Offscreen 文档，请更新浏览器版本。');
  }

  if (chrome.offscreen.hasDocument) {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
      offscreenCreated = true;
      return;
    }
  } else if (offscreenCreated) {
    return;
  }

  if (offscreenCreationPromise) {
    await offscreenCreationPromise;
    return;
  }

  const reasons = chrome.offscreen.Reason
    ? [chrome.offscreen.Reason.DOM_PARSER]
    : ['DOM_PARSER'];

  offscreenCreationPromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons,
      justification: '需要在渲染上下文使用 Summarizer API 生成书签摘要。'
    })
    .then(() => {
      offscreenCreated = true;
    })
    .catch((error) => {
      offscreenCreationPromise = null;
      throw error;
    });

  await offscreenCreationPromise;
  offscreenCreationPromise = null;
}
