const SCROLL_STEP_PX = () => window.innerHeight * 0.9;
const SCROLL_DELAY_MS = 800;
const MAX_IDLE_ROUNDS = 4;

function getVisibleTweets() {
  const articles = Array.from(document.querySelectorAll('article'));
  const posts = [];

  for (const article of articles) {
    const textBlocks = article.querySelectorAll('div[data-testid="tweetText"]');
    if (textBlocks.length === 0) {
      continue;
    }
    const text = Array.from(textBlocks)
      .map((block) => block.textContent.trim())
      .filter(Boolean)
      .join('\n');
    if (text) {
      posts.push({
        text,
        timestamp: article.querySelector('time')?.getAttribute('datetime') ?? null,
        author: article.querySelector('a[role="link"][href^="/" i] span')?.textContent?.trim() ?? null,
      });
    }
  }

  return posts;
}

async function autoScrollToEnd() {
  return new Promise((resolve) => {
    let idleRounds = 0;
    let lastHeight = document.documentElement.scrollHeight;

    const interval = setInterval(() => {
      window.scrollBy({ top: SCROLL_STEP_PX(), behavior: 'smooth' });

      const currentHeight = document.documentElement.scrollHeight;
      const reachedBottom = Math.ceil(window.scrollY + window.innerHeight) >= currentHeight;

      if (reachedBottom) {
        if (currentHeight === lastHeight) {
          idleRounds += 1;
        } else {
          idleRounds = 0;
        }
        lastHeight = currentHeight;
      }

      if (idleRounds >= MAX_IDLE_ROUNDS) {
        clearInterval(interval);
        resolve();
      }
    }, SCROLL_DELAY_MS);
  });
}

async function collectBookmarkPosts() {
  await autoScrollToEnd();
  const posts = getVisibleTweets();
  const unique = [];
  const seen = new Set();

  for (const post of posts) {
    const key = `${post.author ?? ''}|${post.timestamp ?? ''}|${post.text}`;
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
