import {
  SETTINGS_KEY,
  LATEST_RESULT_KEY,
  DEFAULT_SETTINGS,
  normalizeSettings,
  cloneSettings,
} from './settings.js';

const classifyButton = document.getElementById('classify-button');
const settingsButton = document.getElementById('settings-button');
const statusEl = document.getElementById('status');
const stageMessageEl = document.getElementById('stage-message');
const etaMessageEl = document.getElementById('eta-message');
const resultsEl = document.getElementById('results');
const metricsSection = document.getElementById('metrics');
const metricTotal = document.getElementById('metric-total');
const metricSummarized = document.getElementById('metric-summarized');
const metricCategories = document.getElementById('metric-categories');
const exportFormatSelect = document.getElementById('export-format');
const copyButton = document.getElementById('copy-button');
const downloadButton = document.getElementById('download-button');
const previewButton = document.getElementById('preview-button');

const progressElements = {
  extract: {
    bar: document.getElementById('progress-extract'),
    container: document.getElementById('progress-extract-bar'),
    text: document.getElementById('progress-extract-text'),
  },
  summarize: {
    bar: document.getElementById('progress-summarize'),
    container: document.getElementById('progress-summarize-bar'),
    text: document.getElementById('progress-summarize-text'),
  },
  classify: {
    bar: document.getElementById('progress-classify'),
    container: document.getElementById('progress-classify-bar'),
    text: document.getElementById('progress-classify-text'),
  },
};

const SUMMARY_FALLBACK_LENGTH = 160;
const UNCATEGORIZED_ID = 'uncategorized';

let settings = cloneSettings(DEFAULT_SETTINGS);
let latestClassification = null;

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
  statusEl.classList.toggle('error', Boolean(isError));
}

function setStageMessage(message) {
  stageMessageEl.textContent = message ?? '';
}

function updateEta(ms) {
  if (!ms || Number.isNaN(ms) || ms <= 0) {
    etaMessageEl.textContent = '';
    return;
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    etaMessageEl.textContent = `预计剩余 ${minutes} 分 ${remainSeconds} 秒`;
  } else {
    etaMessageEl.textContent = `预计剩余 ${seconds} 秒`;
  }
}

function resetProgress() {
  for (const { bar, container, text } of Object.values(progressElements)) {
    if (bar) {
      bar.style.width = '0%';
    }
    if (container) {
      container.setAttribute('aria-valuenow', '0');
      container.setAttribute('aria-valuetext', '0%');
    }
    if (text) {
      text.textContent = '0%';
    }
  }
  setStageMessage('尚未开始。');
  updateEta(0);
}

function updateProgress(phase, completed, total) {
  const element = progressElements[phase];
  if (!element) {
    return;
  }
  const ratio = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : completed >= total ? 100 : 0;
  if (element.bar) {
    element.bar.style.width = `${ratio}%`;
  }
  if (element.container) {
    element.container.setAttribute('aria-valuenow', `${ratio}`);
    element.container.setAttribute('aria-valuetext', `${ratio}%`);
  }
  if (element.text) {
    element.text.textContent = `${ratio}%`;
  }
}

function enableExportButtons(enabled) {
  copyButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
  previewButton.disabled = !enabled;
}

function updateMetrics({ total = 0, summarized = 0, categories = 0 }) {
  metricsSection.hidden = false;
  metricTotal.textContent = total.toString();
  metricSummarized.textContent = summarized.toString();
  metricCategories.textContent = categories.toString();
}

function hideMetrics() {
  metricsSection.hidden = true;
  metricTotal.textContent = '0';
  metricSummarized.textContent = '0';
  metricCategories.textContent = '0';
}

function extractJsonFromText(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('AI 响应中缺少 JSON 数据。');
  }
  const snippet = text.slice(first, last + 1);
  return JSON.parse(snippet);
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    const normalized = normalizeSettings(stored?.[SETTINGS_KEY]);
    settings = normalized;
  } catch (error) {
    console.warn('Failed to load settings, fallback to defaults.', error);
    settings = cloneSettings(DEFAULT_SETTINGS);
  }
  if (settings?.export?.defaultFormat) {
    exportFormatSelect.value = settings.export.defaultFormat;
  }
}

function listenForSettingsChanges() {
  if (!chrome?.storage?.onChanged) {
    return;
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      if (settings?.export?.defaultFormat) {
        exportFormatSelect.value = settings.export.defaultFormat;
      }
    }
  });
}

async function injectContentScript(tabId) {
  if (!chrome?.scripting?.executeScript) {
    return false;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
    return true;
  } catch (error) {
    console.warn('手动注入内容脚本失败', error);
    return false;
  }
}

async function requestBookmarkPosts() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('未找到当前标签页。');
  }
  const url = tab.url ?? '';
  if (!/https?:\/\/(x|twitter)\.com\/i\/bookmarks/i.test(url)) {
    throw new Error('请在 X 书签页面打开插件。');
  }

  const sendCollectMessage = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_BOOKMARK_POSTS' }, (response) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || '无法与内容脚本通信。'));
          return;
        }
        resolve(response);
      });
    });

  let response;
  try {
    response = await sendCollectMessage();
  } catch (error) {
    const message = error?.message ?? '';
    if (message.includes('Could not establish connection')) {
      const injected = await injectContentScript(tab.id);
      if (injected) {
        // give the injected script a brief moment to register listeners
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
          response = await sendCollectMessage();
        } catch (retryError) {
          console.warn('重新尝试与内容脚本通信仍然失败', retryError);
          throw new Error('无法连接到书签页面，请刷新页面后重试。');
        }
      } else {
        throw new Error('内容脚本尚未加载，请刷新书签页面后重试。');
      }
    } else {
      throw new Error(message || '无法与页面内容脚本通信。');
    }
  }

  if (!response?.ok) {
    throw new Error(response?.message ?? '采集书签帖子失败。');
  }
  const posts = Array.isArray(response.posts) ? response.posts : [];
  return posts.map((post, index) => ({ ...post, index: index + 1 }));
}

function buildSummarizerOptions() {
  const options = {
    type: settings?.summarizer?.type ?? DEFAULT_SETTINGS.summarizer.type,
    length: settings?.summarizer?.length ?? DEFAULT_SETTINGS.summarizer.length,
    format: settings?.summarizer?.format ?? DEFAULT_SETTINGS.summarizer.format,
  };
  if (settings?.summarizer?.language) {
    options.language = settings.summarizer.language;
  }
  return options;
}

async function ensureSummarizerAvailable() {
  if (!('ai' in globalThis) || !('summarizer' in globalThis.ai)) {
    throw new Error('当前版本的 Chrome 尚未提供内置 Summarizer API。');
  }
  const capabilities = await ai.summarizer.capabilities();
  if (capabilities.available === 'no') {
    throw new Error(capabilities.reason ?? 'Summarizer 模型不可用。');
  }
  if (capabilities.available === 'after-download') {
    setStageMessage('正在下载 Summarizer 模型，请稍候…');
  }
  return ai.summarizer.create(buildSummarizerOptions());
}

function withTimeout(promise, timeoutMs) {
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 12_000;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Summarizer 调用超时。')), limit);
    }),
  ]);
}

function createFallbackSummary(text) {
  if (!text) {
    return '（无法生成摘要）';
  }
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_FALLBACK_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, SUMMARY_FALLBACK_LENGTH)}…`;
}

async function summarizePosts(posts, callbacks = {}) {
  if (posts.length === 0) {
    return posts;
  }
  setStageMessage('正在初始化 Summarizer…');
  const summarizer = await ensureSummarizerAvailable();
  const timeoutMs = settings?.summarizer?.timeoutMs ?? DEFAULT_SETTINGS.summarizer.timeoutMs;
  let completed = 0;
  let totalDuration = 0;
  try {
    for (const post of posts) {
      const start = performance.now();
      let summaryText = '';
      try {
        const response = await withTimeout(
          summarizer.summarize({
            text: post.text ?? '',
            context: [post.displayName, post.username, post.datetime].filter(Boolean).join(' ｜ ') || undefined,
          }),
          timeoutMs,
        );
        if (typeof response === 'string') {
          summaryText = response;
        } else if (response && typeof response.summary === 'string') {
          summaryText = response.summary;
        }
      } catch (error) {
        console.warn('Summarizer failed, fallback to raw text.', error);
      }
      if (!summaryText) {
        summaryText = createFallbackSummary(post.text ?? '');
        post.summarySource = 'fallback';
      } else {
        post.summarySource = 'summarizer';
      }
      post.summary = summaryText.trim();
      const end = performance.now();
      completed += 1;
      totalDuration += end - start;
      const average = totalDuration / completed;
      const remaining = Math.max(posts.length - completed, 0) * average;
      callbacks.onProgress?.(completed, posts.length, {
        message: `正在生成摘要（${completed}/${posts.length}）…`,
        etaMs: remaining,
      });
    }
    callbacks.onProgress?.(posts.length, posts.length, {
      message: '摘要阶段完成。',
      etaMs: 0,
    });
    return posts;
  } finally {
    if (typeof summarizer.destroy === 'function') {
      summarizer.destroy();
    }
  }
}

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return [];
  }
  return keywords
    .map((keyword) => (typeof keyword === 'string' ? keyword.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function matchCategoryByKeywords(post, categories) {
  const content = `${post.summary ?? ''}\n${post.text ?? ''}`.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const category of categories) {
    const normalizedKeywords = normalizeKeywords(category.keywords);
    if (normalizedKeywords.length === 0) {
      continue;
    }
    const hits = [];
    for (const keyword of normalizedKeywords) {
      if (content.includes(keyword)) {
        hits.push(keyword);
      }
    }
    if (hits.length > 0 && hits.length >= bestScore) {
      bestMatch = {
        category,
        hits,
      };
      bestScore = hits.length;
    }
  }
  return bestMatch;
}

async function semanticClassifyPosts(unmatched, categories, progressCallbacks = {}) {
  if (unmatched.length === 0) {
    return [];
  }
  if (!('ai' in globalThis) || !('languageModel' in globalThis.ai)) {
    console.warn('语言模型不可用，语义分类跳过。');
    return unmatched.map((post) => ({ post, categoryName: '未分类', reason: 'Chrome 内置语言模型不可用。' }));
  }
  const capabilities = await ai.languageModel.capabilities();
  if (capabilities.available === 'no') {
    console.warn('语言模型不可用：', capabilities.reason);
    return unmatched.map((post) => ({ post, categoryName: '未分类', reason: capabilities.reason ?? '语言模型不可用。' }));
  }
  if (capabilities.available === 'after-download') {
    progressCallbacks.onMessage?.('正在准备内置语言模型，请稍候…');
  }
  const session = await ai.languageModel.create({
    systemPrompt:
      '你是一名分类助手，需要根据给定的分类清单，为 X (Twitter) 的帖子摘要选择最合适的分类。' +
      '请始终返回 JSON，格式为 {"category": "分类名称", "reason": "分类理由"}。',
    temperature: 0.2,
    topK: 32,
  });
  const results = [];
  try {
    let completed = 0;
    for (const post of unmatched) {
      progressCallbacks.onMessage?.(`正在语义分类第 ${completed + 1}/${unmatched.length} 条…`);
      const prompt =
        `可选分类：\n${categories
          .map((category, index) => `${index + 1}. ${category.name}：${category.description || '（无描述）'}`)
          .join('\n')}\n` +
        '如果没有合适分类，请返回 {"category": "未分类", "reason": "说明原因"}。' +
        `\n帖子摘要：${post.summary}\n原始内容：${post.text ?? ''}`;
      let categoryName = null;
      let reason = '';
      try {
        const response = await session.prompt(prompt);
        if (typeof response === 'string') {
          const parsed = extractJsonFromText(response);
          categoryName = parsed.category ?? null;
          reason = parsed.reason ?? '';
        }
      } catch (error) {
        console.warn('语义分类失败，使用默认分类。', error);
        reason = '语义分类失败，已放入未分类。';
      }
      if (!categoryName) {
        categoryName = '未分类';
      }
      completed += 1;
      results.push({ post, categoryName, reason });
      progressCallbacks.onProgress?.(completed, unmatched.length);
    }
    return results;
  } finally {
    if (typeof session.destroy === 'function') {
      session.destroy();
    }
  }
}

function createEmptyResults(categories) {
  const map = new Map();
  for (const category of categories) {
    map.set(category.name, {
      id: category.id,
      name: category.name,
      summary: category.description ?? '',
      posts: [],
    });
  }
  map.set('未分类', {
    id: UNCATEGORIZED_ID,
    name: '未分类',
    summary: '未能通过关键字或语义匹配的帖子。',
    posts: [],
  });
  return map;
}

function toResultPost(post, reason, stage) {
  const titleSource = post.summary || post.text || '（无文本）';
  const titleLine = titleSource.split(/\n+/)[0].trim().slice(0, 80);
  return {
    index: post.index,
    title: titleLine,
    summary: post.summary,
    url: post.url ?? post.permalink ?? null,
    username: post.username,
    displayName: post.displayName,
    datetime: post.datetime,
    hasMedia: post.hasMedia,
    mediaType: post.mediaType,
    statusId: post.statusId,
    reason,
    stage,
  };
}

async function classifyBookmarks(posts, callbacks = {}) {
  const categories = Array.isArray(settings?.categories) && settings.categories.length > 0
    ? settings.categories
    : DEFAULT_SETTINGS.categories;
  const resultsMap = createEmptyResults(categories);
  const unmatched = [];
  let processed = 0;
  callbacks.onMessage?.('正在进行关键词分类…');
  for (const post of posts) {
    const match = matchCategoryByKeywords(post, categories);
    if (match) {
      const reason = `命中关键词：${match.hits.join('、')}`;
      const bucket = resultsMap.get(match.category.name);
      bucket.posts.push(toResultPost(post, reason, 'keyword'));
      processed += 1;
      callbacks.onProgress?.(processed, posts.length, { message: `关键词匹配 ${processed}/${posts.length}` });
    } else {
      unmatched.push(post);
    }
  }

  let semanticAssignments = [];
  if (unmatched.length > 0) {
    const semanticResults = await semanticClassifyPosts(unmatched, categories, {
      onMessage: callbacks.onMessage,
      onProgress: (completed, total) => {
        const overallCompleted = processed + completed;
        callbacks.onProgress?.(overallCompleted, posts.length, {
          message: `语义分类 ${overallCompleted}/${posts.length}`,
        });
      },
    });
    semanticAssignments = semanticResults;
  }

  for (const { post, categoryName, reason } of semanticAssignments) {
    const normalizedName = categoryName && resultsMap.has(categoryName) ? categoryName : '未分类';
    const bucket = resultsMap.get(normalizedName) ?? resultsMap.get('未分类');
    bucket.posts.push(toResultPost(post, reason || '语义匹配结果', 'semantic'));
  }

  for (const post of unmatched) {
    const alreadyClassified = semanticAssignments.find((item) => item.post === post);
    if (!alreadyClassified) {
      const bucket = resultsMap.get('未分类');
      bucket.posts.push(toResultPost(post, '未能匹配任何分类。', 'fallback'));
    }
  }

  callbacks.onProgress?.(posts.length, posts.length, { message: '分类阶段完成。' });

  const categoriesArray = Array.from(resultsMap.values()).filter((category) => category.posts.length > 0);
  categoriesArray.sort((a, b) => b.posts.length - a.posts.length);

  return {
    generatedAt: new Date().toISOString(),
    totalCount: posts.length,
    categories: categoriesArray,
  };
}

function createPostListItem(post, fallbackIndex) {
  const li = document.createElement('li');
  li.className = 'result-post';

  const metaSegments = [];
  const displayIndex = Number.isFinite(post.index)
    ? post.index
    : fallbackIndex;
  if (Number.isFinite(displayIndex)) {
    metaSegments.push(`#${displayIndex}`);
  }
  if (post.displayName || post.username) {
    const nameParts = [post.displayName, post.username].filter(Boolean).join(' ');
    metaSegments.push(nameParts);
  }
  if (post.stage === 'keyword') {
    metaSegments.push('关键词匹配');
  } else if (post.stage === 'semantic') {
    metaSegments.push('语义匹配');
  }
  if (metaSegments.length > 0) {
    const metaEl = document.createElement('span');
    metaEl.className = 'post-meta';
    metaEl.textContent = metaSegments.join(' ｜ ');
    li.appendChild(metaEl);
  }

  if (post.summary) {
    const summaryEl = document.createElement('p');
    summaryEl.className = 'post-excerpt';
    summaryEl.textContent = post.summary;
    li.appendChild(summaryEl);
  }

  if (post.reason) {
    const reasonEl = document.createElement('p');
    reasonEl.className = 'post-reason';
    reasonEl.textContent = post.reason;
    li.appendChild(reasonEl);
  }

  if (post.url) {
    const linkEl = document.createElement('a');
    linkEl.href = post.url;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = '查看原帖';
    li.appendChild(linkEl);
  }

  return li;
}

function renderResults(classification) {
  resultsEl.innerHTML = '';
  if (!classification || !Array.isArray(classification.categories) || classification.categories.length === 0) {
    const emptyEl = document.createElement('p');
    emptyEl.textContent = '暂无分类结果。';
    resultsEl.appendChild(emptyEl);
    return;
  }
  classification.categories.forEach((category) => {
    const block = document.createElement('article');
    block.className = 'result-block';

    const heading = document.createElement('h2');
    heading.textContent = `${category.name}（${category.posts.length}）`;
    block.appendChild(heading);

    if (category.summary) {
      const summary = document.createElement('p');
      summary.className = 'result-summary';
      summary.textContent = category.summary;
      block.appendChild(summary);
    }

    const list = document.createElement('ul');
    list.className = 'result-list';
    category.posts.forEach((post, index) => {
      list.appendChild(createPostListItem(post, index + 1));
    });
    block.appendChild(list);

    resultsEl.appendChild(block);
  });
}

function buildMarkdownResult(classification) {
  const lines = [];
  lines.push('# X 书签分类结果');
  lines.push(`- 导出时间：${classification.generatedAt}`);
  lines.push(`- 书签总数：${classification.totalCount}`);
  lines.push('');
  classification.categories.forEach((category) => {
    lines.push(`## ${category.name}（${category.posts.length}）`);
    if (category.summary) {
      lines.push(`> ${category.summary}`);
    }
    lines.push('');
    category.posts.forEach((post, index) => {
      lines.push(`### ${index + 1}. ${post.title || post.summary || '未命名帖子'}`);
      const meta = [];
      if (post.displayName || post.username) {
        meta.push(`作者：${[post.displayName, post.username].filter(Boolean).join(' ')}`);
      }
      if (post.datetime) {
        meta.push(`时间：${post.datetime}`);
      }
      if (post.url) {
        meta.push(`链接：${post.url}`);
      }
      if (meta.length > 0) {
        lines.push(meta.map((item) => `- ${item}`).join('\n'));
      }
      if (post.summary) {
        lines.push('');
        lines.push(post.summary);
      }
      if (post.reason) {
        lines.push('');
        lines.push(`> 分类理由：${post.reason}`);
      }
      lines.push('');
    });
  });
  return lines.join('\n');
}

function buildJsonResult(classification) {
  const payload = {
    exportTime: classification.generatedAt,
    totalCount: classification.totalCount,
    categories: {},
  };
  classification.categories.forEach((category) => {
    payload.categories[category.name] = {
      summary: category.summary,
      count: category.posts.length,
      bookmarks: category.posts.map((post) => ({
        title: post.title,
        summary: post.summary,
        url: post.url,
        username: post.username,
        displayName: post.displayName,
        datetime: post.datetime,
        hasMedia: post.hasMedia,
        mediaType: post.mediaType,
        statusId: post.statusId,
        reason: post.reason,
      })),
    };
  });
  return JSON.stringify(payload, null, 2);
}

function csvEscape(value) {
  const text = value ?? '';
  if (text === '') {
    return '';
  }
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvResult(classification) {
  const rows = [];
  rows.push(['分类', '标题', '摘要', '链接', '用户名', '显示名', '时间', '媒体', '理由'].join(','));
  classification.categories.forEach((category) => {
    category.posts.forEach((post) => {
      rows.push(
        [
          csvEscape(category.name),
          csvEscape(post.title || ''),
          csvEscape(post.summary || ''),
          csvEscape(post.url || ''),
          csvEscape(post.username || ''),
          csvEscape(post.displayName || ''),
          csvEscape(post.datetime || ''),
          csvEscape(post.mediaType || (post.hasMedia ? '媒体' : '无')), 
          csvEscape(post.reason || ''),
        ].join(','),
      );
    });
  });
  return rows.join('\n');
}

function buildExportContent(format, classification) {
  switch (format) {
    case 'json':
      return { content: buildJsonResult(classification), mime: 'application/json', extension: 'json' };
    case 'csv':
      return { content: buildCsvResult(classification), mime: 'text/csv', extension: 'csv' };
    case 'markdown':
    default:
      return { content: buildMarkdownResult(classification), mime: 'text/markdown', extension: 'md' };
  }
}

async function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function downloadAsFile(format, classification) {
  const { content, mime, extension } = buildExportContent(format, classification);
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const timestamp = classification.generatedAt.replace(/[:.]/g, '-');
  const filename = `${settings?.export?.fileNamePrefix ?? 'x-bookmarks'}-${timestamp}.${extension}`;
  try {
    if (chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

async function openPreviewTab(format, classification) {
  const { content, mime, extension } = buildExportContent(format, classification);
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function persistLatestResult(classification) {
  try {
    await chrome.storage.local.set({ [LATEST_RESULT_KEY]: classification });
  } catch (error) {
    console.warn('无法缓存最新分类结果。', error);
  }
}

async function persistSettingsExportFormat(format) {
  try {
    const current = await chrome.storage.sync.get(SETTINGS_KEY);
    const next = normalizeSettings(current?.[SETTINGS_KEY]);
    next.export.defaultFormat = format;
    await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  } catch (error) {
    console.warn('更新导出格式失败。', error);
  }
}

async function handleClassifyClick() {
  classifyButton.disabled = true;
  enableExportButtons(false);
  setStatus('');
  resetProgress();
  hideMetrics();
  resultsEl.innerHTML = '';
  latestClassification = null;

  try {
    setStageMessage('正在读取书签内容…');
    updateProgress('extract', 0, 1);
    const posts = await requestBookmarkPosts();
    if (posts.length === 0) {
      updateProgress('extract', 1, 1);
      setStageMessage('未找到任何书签。');
      setStatus('未找到任何书签。');
      return;
    }
    updateProgress('extract', 1, 1);
    updateMetrics({ total: posts.length, summarized: 0, categories: 0 });

    await summarizePosts(posts, {
      onProgress: (completed, total, extra) => {
        updateProgress('summarize', completed, total);
        if (extra?.message) {
          setStageMessage(extra.message);
        }
        if (typeof extra?.etaMs === 'number') {
          updateEta(extra.etaMs);
        }
        updateMetrics({ total: posts.length, summarized: completed, categories: 0 });
      },
    });

    updateEta(0);
    setStageMessage('摘要完成，开始分类…');

    const classification = await classifyBookmarks(posts, {
      onProgress: (completed, total, extra) => {
        updateProgress('classify', completed, total);
        if (extra?.message) {
          setStageMessage(extra.message);
        }
      },
      onMessage: (message) => {
        setStageMessage(message);
      },
    });

    latestClassification = classification;
    setStatus('分类完成。');
    setStageMessage('全部流程完成。');
    updateProgress('classify', posts.length, posts.length);
    updateMetrics({ total: posts.length, summarized: posts.length, categories: classification.categories.length });
    renderResults(classification);
    enableExportButtons(true);
    await persistLatestResult(classification);
  } catch (error) {
    console.error(error);
    setStatus(error?.message ?? String(error), true);
    setStageMessage('流程已停止。');
  } finally {
    classifyButton.disabled = false;
    updateEta(0);
  }
}

function handleExport(action) {
  if (!latestClassification) {
    setStatus('暂无可导出的分类结果。', true);
    return;
  }
  const format = exportFormatSelect.value;
  switch (action) {
    case 'copy':
      copyToClipboard(buildExportContent(format, latestClassification).content)
        .then(() => setStatus('已复制到剪贴板。'))
        .catch((error) => {
          console.error(error);
          setStatus('复制失败，请重试。', true);
        });
      break;
    case 'download':
      downloadAsFile(format, latestClassification).catch((error) => {
        console.error(error);
        setStatus('下载失败，请重试。', true);
      });
      break;
    case 'preview':
      openPreviewTab(format, latestClassification).catch((error) => {
        console.error(error);
        setStatus('打开预览失败，请重试。', true);
      });
      break;
    default:
      break;
  }
}

classifyButton.addEventListener('click', handleClassifyClick);
settingsButton.addEventListener('click', () => {
  if (chrome?.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});
copyButton.addEventListener('click', () => handleExport('copy'));
downloadButton.addEventListener('click', () => handleExport('download'));
previewButton.addEventListener('click', () => handleExport('preview'));
exportFormatSelect.addEventListener('change', (event) => {
  const value = event.target.value;
  settings.export.defaultFormat = value;
  persistSettingsExportFormat(value);
});

loadSettings();
listenForSettingsChanges();
