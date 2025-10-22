const classifyButton = document.getElementById('classify-button');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

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
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#f87171' : '';
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

    const heading = document.createElement('h2');
    heading.textContent = category.name ?? category.title ?? '未命名分类';
    block.appendChild(heading);

    if (category.summary) {
      const summary = document.createElement('p');
      summary.textContent = category.summary;
      block.appendChild(summary);
    }

    const posts = category.posts ?? category.items ?? category.entries ?? [];
    if (posts.length > 0) {
      const list = document.createElement('ul');
      for (const post of posts) {
        const li = document.createElement('li');
        if (typeof post === 'string') {
          li.textContent = post;
        } else {
          const segments = [post.index ? `#${post.index}` : null, post.author ?? null, post.excerpt ?? post.text ?? null, post.reason ?? null]
            .filter(Boolean);
          li.textContent = segments.join(' ｜ ');
        }
        list.appendChild(li);
      }
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
  return JSON.parse(jsonSnippet);
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
    await ai.languageModel.create();
  }

  const session = await ai.languageModel.create({
    systemPrompt:
      '你是一名数据整理助手，需要根据用户在社交媒体 X (Twitter) 上收藏的帖子内容进行主题分类。' +
      '请尽量使用简体中文输出分类标题和总结。',
    temperature: 0.2,
    topK: 32,
  });

  const formattedPosts = posts
    .map((post, index) => {
      const header = `帖子${index + 1}`;
      const author = post.author ? ` 作者：${post.author}` : '';
      const time = post.timestamp ? ` 时间：${post.timestamp}` : '';
      return `${header}${author}${time}\n内容：${post.text}`;
    })
    .join('\n\n');

  const prompt =
    '请阅读以下来自 X 书签的帖子，并将它们按主题分类。' +
    '请返回 JSON，字段结构如下：{"categories": [{"name": "分类名称", "summary": "该分类的简要说明", "posts": [{"index": 数字, "author": "作者", "excerpt": "帖子摘要", "reason": "分类原因"}]}]}。' +
    '请务必只输出 JSON，不要添加额外说明。\n\n' +
    formattedPosts;

  const response = await session.prompt(prompt);
  return extractJson(response);
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

  const response = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_BOOKMARK_POSTS' });
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
