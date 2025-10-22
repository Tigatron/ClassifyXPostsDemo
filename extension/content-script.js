const SCROLL_STEP_PX = () => window.innerHeight * 0.9;
const SCROLL_DELAY_MS = 800;
const MAX_IDLE_ROUNDS = 4;
const MAX_SCROLL_DURATION_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVisibleTweets() {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
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
    if (!text) {
      continue;
    }

    const permalink = article.querySelector('a[role="link"][href*="/status/"]');

    posts.push({
      text,
      timestamp: article.querySelector('time')?.getAttribute('datetime') ?? null,
      author: article.querySelector('a[role="link"][href^="/" i] span')?.textContent?.trim() ?? null,
      permalink: permalink ? permalink.href : null,
    });
  }

  return posts;
}

async function autoScrollToEnd() {
  const start = performance.now();
  let idleRounds = 0;
  let lastHeight = document.documentElement.scrollHeight;

  while (performance.now() - start < MAX_SCROLL_DURATION_MS) {
    window.scrollBy({ top: SCROLL_STEP_PX(), behavior: 'smooth' });
    await sleep(SCROLL_DELAY_MS);

    const currentHeight = document.documentElement.scrollHeight;
    const reachedBottom = Math.ceil(window.scrollY + window.innerHeight) >= currentHeight;

    if (currentHeight > lastHeight) {
      lastHeight = currentHeight;
      idleRounds = 0;
      continue;
    }

    if (reachedBottom) {
      idleRounds += 1;
      if (idleRounds >= MAX_IDLE_ROUNDS) {
        break;
      }
    } else {
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
    const key = `${post.author ?? ''}|${post.timestamp ?? ''}|${post.permalink ?? ''}|${post.text}`;
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
