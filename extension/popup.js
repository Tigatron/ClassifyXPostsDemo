const classifyButton = document.getElementById('classify-button');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const CONNECTION_ERROR_REGEX = /Receiving end does not exist|Could not establish connection/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyColorScheme() {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const update = () => {
    document.body.classList.toggle('light', prefersLight.matches);
  };
  update();
  prefersLight.addEventListener('change', update);
}

applyColorScheme();

function normalizePermalink(link) {
  if (typeof link !== 'string') {
    return null;
  }
  const trimmed = link.trim();
  if (!trimmed) {
    return null;
  }

  const ensureHttpUrl = (value, base = undefined) => {
    try {
      const url = base ? new URL(value, base) : new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.href;
      }
      return null;
    } catch (_error) {
      return null;
    }
  };

  if (/^https?:/i.test(trimmed)) {
    return ensureHttpUrl(trimmed);
  }
  if (trimmed.startsWith('/')) {
    return ensureHttpUrl(trimmed, 'https://x.com');
  }
  return ensureHttpUrl(`https://x.com/${trimmed.replace(/^\/+/, '')}`);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#f87171' : '';
}

async function ensureBookmarkCollector(tabId) {
  if (!chrome.scripting?.executeScript) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
  } catch (error) {
    console.debug('Failed to inject content script', error);
  }
}

async function sendMessageWithRetry(tabId, message) {
  const attempts = chrome.scripting?.executeScript ? 2 : 1;
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      const errorMessage = error?.message ?? '';
      lastError = error;

      if (index + 1 < attempts && CONNECTION_ERROR_REGEX.test(errorMessage)) {
        await ensureBookmarkCollector(tabId);
        await sleep(100);
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error('无法与页面内容脚本通信。');
}

function createPostListItem(post, fallbackIndex) {
  const li = document.createElement('li');
  li.className = 'result-post';

  if (typeof post === 'string') {
    li.textContent = post;
    return li;
  }

  const metaSegments = [];
  const displayIndex = Number.isFinite(post.index)
    ? post.index
    : Number.isFinite(post.id)
    ? post.id
    : Number.isFinite(post.order)
    ? post.order
    : fallbackIndex;

  if (Number.isFinite(displayIndex)) {
    metaSegments.push(`#${displayIndex}`);
  }
  if (post.author) {
    metaSegments.push(post.author);
  }

  if (metaSegments.length > 0) {
    const metaEl = document.createElement('span');
    metaEl.className = 'post-meta';
    metaEl.textContent = metaSegments.join(' ｜ ');
    li.appendChild(metaEl);
  }

  const excerpt = post.excerpt ?? post.text ?? post.summary ?? '';
  if (excerpt) {
    const excerptEl = document.createElement('p');
    excerptEl.className = 'post-excerpt';
    excerptEl.textContent = excerpt;
    li.appendChild(excerptEl);
  }

  const reasonDetail = post.detail ?? post.note ?? null;
  const secondaryReason = post.reason ?? post.explanation ?? post.justification ?? '';
  if (reasonDetail || secondaryReason) {
    const reasonEl = document.createElement('p');
    reasonEl.className = 'post-reason';
    reasonEl.textContent = reasonDetail ? reasonDetail : `原因：${secondaryReason}`;
    li.appendChild(reasonEl);
  }

  const link = normalizePermalink(post.permalink ?? post.url ?? post.link);
  if (link) {
    const linkEl = document.createElement('a');
    linkEl.href = link;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = '查看原帖';
    li.appendChild(linkEl);
  }

  return li;
}

function renderResults(result) {
  resultsEl.innerHTML = '';
  if (!result) {
    return;
  }

  const categories = Array.isArray(result.categories)
    ? result.categories
    : Object.entries(result).map(([name, value]) => ({ name, ...value }));

  for (const category of categories) {
    const block = document.createElement('article');
    block.className = 'result-block';

    const posts = category.posts ?? category.items ?? category.entries ?? [];
    const count = Array.isArray(posts) ? posts.length : 0;

    const heading = document.createElement('h2');
    const title = category.name ?? category.title ?? '未命名分类';
    heading.textContent = count > 0 ? `${title}（${count}）` : title;
    block.appendChild(heading);

    if (category.summary ?? category.description) {
      const summary = document.createElement('p');
      summary.className = 'result-summary';
      summary.textContent = category.summary ?? category.description;
      block.appendChild(summary);
    }

    if (count > 0) {
      const list = document.createElement('ul');
      list.className = 'result-list';
      posts.forEach((post, index) => {
        list.appendChild(createPostListItem(post, index + 1));
      });
      block.appendChild(list);
    }

    resultsEl.appendChild(block);
  }
}

function extractJson(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('AI 响应中缺少 JSON 数据。');
  }
  const jsonSnippet = text.slice(first, last + 1);
  try {
    return JSON.parse(jsonSnippet);
  } catch (error) {
    console.error('Failed to parse AI response', error, text);
    throw new Error('无法解析 AI 输出的 JSON。');
  }
}

async function classifyPostsWithAI(posts) {
  if (!('ai' in globalThis) || !('languageModel' in globalThis.ai)) {
    throw new Error('当前版本的 Chrome 尚未提供内置 AI 语言模型 API。');
  }

  const capabilities = await ai.languageModel.capabilities();
  if (capabilities.available === 'no') {
    throw new Error(capabilities.reason ?? 'AI 语言模型不可用。');
  }
  if (capabilities.available === 'after-download') {
    setStatus('正在下载内置模型，请稍候…');
    const warmupSession = await ai.languageModel.create();
    if (warmupSession && typeof warmupSession.destroy === 'function') {
      warmupSession.destroy();
    }
  }

  const session = await ai.languageModel.create({
    systemPrompt:
      '你是一名数据整理助手，需要根据用户在社交媒体 X (Twitter) 上收藏的帖子内容进行主题分类。' +
      '请尽量使用简体中文输出分类标题和总结。',
    temperature: 0.2,
    topK: 32,
  });

  try {
    const formattedEntries = [];
    const MAX_PROMPT_CHARS = 12_000;
    let accumulatedLength = 0;
    let truncatedCount = 0;

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const pieces = [`帖子${index + 1}`];
      if (post.author) {
        pieces.push(`作者：${post.author}`);
      }
      if (post.timestamp) {
        pieces.push(`时间：${post.timestamp}`);
      }
      const normalizedLink = normalizePermalink(post.permalink);
      if (normalizedLink) {
        pieces.push(`链接：${normalizedLink}`);
      }
      const header = pieces.join(' ｜ ');
      const rawText = typeof post.text === 'string' ? post.text : '';
      const truncatedText = rawText.length > 600 ? `${rawText.slice(0, 600)}…` : rawText;
      const safeContent = truncatedText || (typeof post.excerpt === 'string' ? post.excerpt : '（无文本）');
      const entry = `${header}\n内容：${safeContent}`;
      const projectedLength = accumulatedLength + entry.length + 2;
      if (projectedLength > MAX_PROMPT_CHARS) {
        truncatedCount = posts.length - index;
        break;
      }
      formattedEntries.push(entry);
      accumulatedLength = projectedLength;
    }

    if (formattedEntries.length === 0) {
      throw new Error('书签内容过长，无法提交给内置模型。请减少帖子数量后重试。');
    }

    const formattedPosts = formattedEntries.join('\n\n');

    const prompt =
      '请阅读以下来自 X 书签的帖子，并将它们按主题分类。' +
      '请返回 JSON，字段结构如下：{"categories": [{"name": "分类名称", "summary": "该分类的简要说明", "posts": [{"index": 数字, "author": "作者", "excerpt": "帖子摘要", "reason": "分类原因", "permalink": "原帖链接"}]}]}。' +
      '请务必只输出 JSON，不要添加额外说明。\n\n' +
      formattedPosts;

    const included = truncatedCount > 0 ? posts.length - truncatedCount : formattedEntries.length;
    const statusMessage =
      truncatedCount > 0
        ? `AI 正在生成分类结果…（已限制为前 ${included} 条）`
        : 'AI 正在生成分类结果…';
    setStatus(statusMessage);
    const response = await session.prompt(prompt);
    if (typeof response !== 'string') {
      throw new Error('AI 响应格式异常。');
    }
    return extractJson(response);
  } finally {
    if (session && typeof session.destroy === 'function') {
      session.destroy();
    }
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

  await ensureBookmarkCollector(tab.id);

  let response;
  try {
    response = await sendMessageWithRetry(tab.id, { type: 'COLLECT_BOOKMARK_POSTS' });
  } catch (error) {
    throw new Error(error?.message ?? '无法与页面内容脚本通信。');
  }
  if (!response?.ok) {
    throw new Error(response?.message ?? '采集书签帖子失败。');
  }

  return response.posts;
}

async function handleClassifyClick() {
  classifyButton.disabled = true;
  setStatus('正在读取书签内容…');
  resultsEl.innerHTML = '';

  try {
    const posts = await requestBookmarkPosts();
    if (posts.length === 0) {
      setStatus('未找到任何帖子。');
      return;
    }
    setStatus(`已获取 ${posts.length} 条帖子，正在调用 AI 分类…`);
    const classification = await classifyPostsWithAI(posts);
    setStatus('分类完成。');
    renderResults(classification);
  } catch (error) {
    console.error(error);
    setStatus(error?.message ?? String(error), true);
  } finally {
    classifyButton.disabled = false;
  }
}

classifyButton.addEventListener('click', handleClassifyClick);
