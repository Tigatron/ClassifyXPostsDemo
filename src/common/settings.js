export const DEFAULT_SETTINGS = {
  summary: {
    type: 'key-points',
    format: 'plain-text',
    length: 'medium',
    sharedContext:
      'You summarize X (Twitter) bookmarks for an AI-powered bookmarking assistant. Generate concise key points to aid topic classification.',
    perItemFocus:
      'Highlight the main topic, tools, products, or themes mentioned in the post. Mention notable entities.'
  },
  categories: [
    {
      id: 'ai-tools',
      name: 'AI工具',
      keywords: ['ai', '人工智能', 'llm', '模型', 'prompt', '推理']
    },
    {
      id: 'dev-tools',
      name: '开发工具',
      keywords: ['开发', 'sdk', 'api', 'github', '框架', '前端', '后端']
    },
    {
      id: 'product-growth',
      name: '出海/增长',
      keywords: ['增长', '出海', '市场', '用户', '营销', '运营']
    },
    {
      id: 'finance',
      name: '出海/金融',
      keywords: ['融资', '投资', '支付', 'bank', 'stripe', '金融']
    },
    {
      id: 'learning',
      name: '学习/教程',
      keywords: ['教程', '指南', '课程', '学习', 'how to', 'tips', '案例']
    },
    {
      id: 'misc',
      name: '其他',
      keywords: []
    }
  ],
  fallbackCategoryId: 'misc',
  autoOpenSidePanel: true,
  historyLimit: 10
};

const SETTINGS_KEY = 'xbac.settings';

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export function normalizeSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const normalized = structuredClone(DEFAULT_SETTINGS);
  if (candidate.summary) {
    normalized.summary = {
      ...normalized.summary,
      ...candidate.summary
    };
  }
  if (Array.isArray(candidate.categories) && candidate.categories.length > 0) {
    normalized.categories = candidate.categories.map((cat, index) => ({
      id: cat.id || `category-${index}`,
      name: cat.name || `分类 ${index + 1}`,
      keywords: Array.isArray(cat.keywords)
        ? cat.keywords.map((kw) => String(kw).trim()).filter(Boolean)
        : []
    }));
  }
  if (candidate.fallbackCategoryId) {
    normalized.fallbackCategoryId = candidate.fallbackCategoryId;
  }
  if (typeof candidate.autoOpenSidePanel === 'boolean') {
    normalized.autoOpenSidePanel = candidate.autoOpenSidePanel;
  }
  if (typeof candidate.historyLimit === 'number' && candidate.historyLimit > 0) {
    normalized.historyLimit = candidate.historyLimit;
  }
  return normalized;
}

export function toKeywordList(text = '') {
  return text
    .split(/[,\s，、]+/)
    .map((kw) => kw.trim())
    .filter(Boolean);
}

export function keywordListToText(list = []) {
  return list.join(', ');
}
