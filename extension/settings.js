export const SETTINGS_KEY = 'xbm-settings';
export const LATEST_RESULT_KEY = 'xbm-latest-classification';

const clone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

export const DEFAULT_SETTINGS = {
  summarizer: {
    type: 'key-points',
    length: 'medium',
    format: 'paragraph',
    language: 'zh',
    timeoutMs: 12_000,
  },
  categories: [
    {
      id: 'ai-tools',
      name: 'AI 工具',
      keywords: ['AI', '人工智能', '模型', '大模型', 'LLM', '提示词'],
      description: '与 AI 工具、模型、提示词相关的内容。',
    },
    {
      id: 'product-growth',
      name: '产品/增长',
      keywords: ['增长', '产品', '用户', '留存', '转化'],
      description: '产品策略、增长技巧与用户运营。',
    },
    {
      id: 'startup-finance',
      name: '创业/金融',
      keywords: ['创业', '融资', '投资', '商业模式', '估值'],
      description: '创业经验、融资案例与商业模式讨论。',
    },
    {
      id: 'dev-tech',
      name: '开发/技术',
      keywords: ['开发', '编程', '工程', '代码', '开源', '框架'],
      description: '软件开发、工程实践与技术分享。',
    },
    {
      id: 'learning',
      name: '学习/教程',
      keywords: ['教程', '课程', '学习', '指南', '速查'],
      description: '学习资源、教程与知识总结。',
    },
  ],
  export: {
    defaultFormat: 'markdown',
    fileNamePrefix: 'x-bookmarks',
  },
};

export function keywordsToArray(keywords) {
  if (Array.isArray(keywords)) {
    return keywords
      .map((item) => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
      .filter(Boolean);
  }
  if (typeof keywords === 'string') {
    return keywords
      .split(/[,，;；\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeCategory(category, fallbackIndex = 0) {
  if (!category || typeof category !== 'object') {
    return null;
  }
  const idBase = category.id || category.name || `category-${fallbackIndex}`;
  const normalizedId = idBase.toString().trim().toLowerCase().replace(/\s+/g, '-');
  return {
    id: normalizedId,
    name: category.name?.toString().trim() || `未命名分类 ${fallbackIndex + 1}`,
    keywords: keywordsToArray(category.keywords),
    description: category.description?.toString().trim() || '',
  };
}

export function normalizeSettings(raw) {
  const base = clone(DEFAULT_SETTINGS);
  if (raw && typeof raw === 'object') {
    if (raw.summarizer && typeof raw.summarizer === 'object') {
      base.summarizer = {
        ...base.summarizer,
        ...raw.summarizer,
      };
      if (typeof base.summarizer.timeoutMs !== 'number' || base.summarizer.timeoutMs <= 0) {
        base.summarizer.timeoutMs = DEFAULT_SETTINGS.summarizer.timeoutMs;
      }
    }
    if (Array.isArray(raw.categories)) {
      const normalized = raw.categories
        .map((category, index) => normalizeCategory(category, index))
        .filter(Boolean);
      if (normalized.length > 0) {
        base.categories = normalized;
      }
    }
    if (raw.export && typeof raw.export === 'object') {
      base.export = {
        ...base.export,
        ...raw.export,
      };
      if (!['markdown', 'json', 'csv'].includes(base.export.defaultFormat)) {
        base.export.defaultFormat = DEFAULT_SETTINGS.export.defaultFormat;
      }
      if (!base.export.fileNamePrefix || typeof base.export.fileNamePrefix !== 'string') {
        base.export.fileNamePrefix = DEFAULT_SETTINGS.export.fileNamePrefix;
      }
    }
  }
  return base;
}

export function cloneSettings(settings = DEFAULT_SETTINGS) {
  return clone(settings);
}
