const SCROLL_STEP_PX = () => window.innerHeight * 0.9;
const SCROLL_DELAY_MS = 800;
const MAX_IDLE_ROUNDS = 4;
const MAX_SCROLL_DURATION_MS = 60_000;
const MAX_CONSECUTIVE_IDLE = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureAbsoluteUrl(permalink) {
  if (typeof permalink !== 'string') {
    return null;
  }
  const trimmed = permalink.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:/i.test(trimmed)) {
      const normalized = new URL(trimmed);
      return normalized.href;
    }
    if (trimmed.startsWith('/')) {
      return new URL(trimmed, window.location.origin).href;
    }
    return new URL(`/` + trimmed.replace(/^\/+/g, ''), window.location.origin).href;
  } catch (_error) {
    return null;
  }
}

function detectMedia(article) {
  const hasVideo = article.querySelector('video');
  if (hasVideo) {
    return { hasMedia: true, mediaType: 'video' };
  }
  const photo = article.querySelector('div[data-testid="tweetPhoto"] img, img[src*="twimg"]');
  if (photo) {
    return { hasMedia: true, mediaType: 'image' };
  }
  return { hasMedia: false, mediaType: undefined };
}

function parseArticle(article) {
  const textBlocks = article.querySelectorAll('div[data-testid="tweetText"]');
  const text = Array.from(textBlocks)
    .map((block) => block.textContent.trim())
    .filter(Boolean)
    .join('\n');

  const permalinkNode = article.querySelector('a[role="link"][href*="/status/"]');
  const rawPermalink = permalinkNode ? permalinkNode.getAttribute('href') ?? '' : '';
  const absoluteUrl = ensureAbsoluteUrl(rawPermalink);
  const statusIdMatch = rawPermalink.match(/status\/(\d+)/i);

  const nameContainer = article.querySelector('div[data-testid="User-Name"]');
  let displayName = null;
  let username = null;
  if (nameContainer) {
    const spanTexts = Array.from(nameContainer.querySelectorAll('span'))
      .map((span) => span.textContent?.trim())
      .filter(Boolean);
    if (spanTexts.length > 0) {
      displayName = spanTexts[0];
    }
    const handle = spanTexts.find((value) => value.startsWith('@'));
    if (handle) {
      username = handle;
    }
  }

  const timestamp = article.querySelector('time')?.getAttribute('datetime') ?? null;
  const { hasMedia, mediaType } = detectMedia(article);

  return {
    url: absoluteUrl,
    statusId: statusIdMatch ? statusIdMatch[1] : null,
    username,
    displayName,
    datetime: timestamp,
    text,
    hasMedia,
    mediaType,
    permalink: absoluteUrl,
  };
}

function getVisibleTweets() {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const posts = [];

  for (const article of articles) {
    const post = parseArticle(article);
    if (!post.text) {
      continue;
    }
    posts.push(post);
  }

  return posts;
}

async function autoScrollToEnd() {
  const start = performance.now();
  let idleRounds = 0;
  let lastHeight = document.documentElement.scrollHeight;
  let consecutiveIdle = 0;

  while (performance.now() - start < MAX_SCROLL_DURATION_MS) {
    window.scrollBy({ top: SCROLL_STEP_PX(), behavior: 'smooth' });
    await sleep(SCROLL_DELAY_MS);

    const currentHeight = document.documentElement.scrollHeight;
    const reachedBottom = Math.ceil(window.scrollY + window.innerHeight) >= currentHeight;

    if (currentHeight > lastHeight) {
      lastHeight = currentHeight;
      idleRounds = 0;
      consecutiveIdle = 0;
      continue;
    }

    if (reachedBottom) {
      idleRounds += 1;
      consecutiveIdle += 1;
      if (idleRounds >= MAX_IDLE_ROUNDS || consecutiveIdle >= MAX_CONSECUTIVE_IDLE) {
        break;
      }
    } else {
      consecutiveIdle = 0;
      idleRounds = 0;
    }
  }
}

async function collectBookmarkPosts() {
  await autoScrollToEnd();
  await sleep(500);
  const posts = getVisibleTweets();
  const unique = [];
  const seen = new Set();

  for (const post of posts) {
    const key = `${post.statusId ?? ''}|${post.username ?? ''}|${post.datetime ?? ''}|${post.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(post);
    }
  }

  return unique;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === 'COLLECT_BOOKMARK_POSTS') {
    collectBookmarkPosts()
      .then((posts) => sendResponse({ ok: true, posts }))
      .catch((error) => sendResponse({ ok: false, message: error?.message ?? String(error) }));
    return true;
  }
  return false;
});
