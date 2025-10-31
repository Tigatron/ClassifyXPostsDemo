if (window.__xbacCollectorRegistered) {
  console.debug('X Bookmark AI collector already registered; skipping duplicate injection.');
} else {
  window.__xbacCollectorRegistered = true;

  const MAX_SCROLL_ATTEMPTS = 80;
  const MAX_IDLE_ROUNDS = 3;
  const SCROLL_DELAY_MS = 1500;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'collect-bookmarks') {
      collectBookmarks()
        .then((bookmarks) => sendResponse({ bookmarks }))
        .catch((error) => sendResponse({ error: error.message || String(error) }));
      return true;
    }
    if (message?.type === 'collector-ping') {
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });

  async function collectBookmarks() {
    if (!isBookmarksPage()) {
      throw new Error('请先打开 X 书签页面 https://x.com/i/bookmarks');
    }

    const seen = new Set();
    const results = [];
    let idleRounds = 0;

    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt += 1) {
      const newEntries = extractVisibleBookmarks(seen);
      if (newEntries.length > 0) {
        idleRounds = 0;
        results.push(...newEntries);
        reportProgress(results.length, `已提取 ${results.length} 条书签...`);
      } else {
        idleRounds += 1;
      }

      if (idleRounds >= MAX_IDLE_ROUNDS) {
        break;
      }

      await scrollForMore();
    }

    return results;
  }

  function isBookmarksPage() {
    return window.location.pathname.startsWith('/i/bookmarks');
  }

  function extractVisibleBookmarks(seen) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const extracted = [];
    articles.forEach((article) => {
      const bookmark = extractBookmark(article);
      if (!bookmark) {
        return;
      }
      if (seen.has(bookmark.statusId)) {
        return;
      }
      seen.add(bookmark.statusId);
      extracted.push(bookmark);
    });
    return extracted;
  }

  function extractBookmark(article) {
    try {
      const anchor = article.querySelector('a[href*="/status/"][role="link"]');
      if (!anchor?.href) {
        return null;
      }
      const url = anchor.href.split('?')[0];
      const statusMatch = url.match(/status\/(\d+)/);
      const statusId = statusMatch ? statusMatch[1] : createHash(url);

      const usernameMatch = url.match(/https:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status/);
      const username = usernameMatch ? `@${decodeURIComponent(usernameMatch[1])}` : '';

      const displayName =
        article.querySelector('div[data-testid="User-Name"] span span')?.textContent?.trim() ?? '';
      const datetime = article.querySelector('time')?.dateTime ?? '';
      const text = Array.from(article.querySelectorAll('div[data-testid="tweetText"] span'))
        .map((node) => node.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const hasVideo = Boolean(article.querySelector('video'));
      const hasImage = Boolean(article.querySelector('img[alt][src*="twimg"]'));
      const hasMedia = hasVideo || hasImage;
      const mediaType = hasMedia ? (hasVideo ? 'video' : 'image') : undefined;

      return {
        url,
        statusId,
        username,
        displayName,
        datetime,
        text,
        hasMedia,
        mediaType
      };
    } catch (error) {
      console.warn('解析书签失败', error);
      return null;
    }
  }

  async function scrollForMore() {
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    await wait(SCROLL_DELAY_MS);
  }

  function reportProgress(collected, message) {
    chrome.runtime.sendMessage({
      type: 'collector-progress',
      collected,
      message
    });
  }

  function wait(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function createHash(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return `hash-${Math.abs(hash)}`;
  }
}
