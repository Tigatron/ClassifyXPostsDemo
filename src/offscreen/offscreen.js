const SUMMARY_CACHE = {
  key: null,
  instance: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'offscreen-summarize') {
    handleSummarize(message.payload)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
    return true;
  }

  if (message?.type === 'offscreen-close') {
    closeDocument();
    sendResponse({ ok: true });
    return false;
  }

  return undefined;
});

async function handleSummarize(payload) {
  if (!payload) {
    throw new Error('缺少摘要请求参数');
  }
  ensureSummarizerAvailable();

  const { createOptions, content, context } = payload;
  const summarizer = await prepareSummarizer(createOptions);

  const summarizeOptions = context ? { context } : undefined;
  const result = await summarizer.summarize(content, summarizeOptions);
  if (typeof result === 'string') {
    return result;
  }
  if (result?.summary) {
    return result.summary;
  }
  return JSON.stringify(result);
}

async function prepareSummarizer(options = {}) {
  const availability = await getAvailability();
  if (availability === 'unavailable') {
    throw new Error('Summarizer API 当前不可用。');
  }

  const key = JSON.stringify({
    type: options?.type,
    format: options?.format,
    length: options?.length,
    sharedContext: options?.sharedContext,
    outputLanguage: options?.outputLanguage,
    expectedInputLanguages: options?.expectedInputLanguages,
    expectedContextLanguages: options?.expectedContextLanguages
  });

  if (SUMMARY_CACHE.instance && SUMMARY_CACHE.key === key) {
    return SUMMARY_CACHE.instance;
  }

  if (SUMMARY_CACHE.instance && typeof SUMMARY_CACHE.instance.destroy === 'function') {
    try {
      SUMMARY_CACHE.instance.destroy();
    } catch (error) {
      console.warn('销毁旧 Summarizer 失败', error);
    }
  }

  const createOptions = sanitizeCreateOptions(options);
  const SummarizerCtor = getSummarizerCtor();
  SUMMARY_CACHE.instance = await SummarizerCtor.create(createOptions);
  SUMMARY_CACHE.key = key;
  return SUMMARY_CACHE.instance;
}

function ensureSummarizerAvailable() {
  if (!getSummarizerCtor()) {
    throw new Error('Summarizer API 不可用，请确认已启用 Chrome 内置 AI 功能。');
  }
}

function serializeError(error) {
  if (!error) return { message: '未知错误' };
  if (typeof error === 'string') return { message: error };
  return {
    message: error.message || '未知错误',
    stack: error.stack
  };
}

function closeDocument() {
  if (SUMMARY_CACHE.instance && typeof SUMMARY_CACHE.instance.destroy === 'function') {
    try {
      SUMMARY_CACHE.instance.destroy();
    } catch (error) {
      console.warn('销毁 Summarizer 实例失败', error);
    }
  }
  SUMMARY_CACHE.instance = null;
  SUMMARY_CACHE.key = null;
  window.close();
}

function getSummarizerCtor() {
  if (typeof self !== 'undefined' && self.Summarizer) {
    return self.Summarizer;
  }
  if (typeof window !== 'undefined' && window.Summarizer) {
    return window.Summarizer;
  }
  if (typeof window !== 'undefined' && window.ai?.summarizer) {
    return window.ai.summarizer;
  }
  return null;
}

async function getAvailability() {
  const SummarizerCtor = getSummarizerCtor();
  if (!SummarizerCtor) return 'unavailable';
  if (typeof SummarizerCtor.availability === 'function') {
    return await SummarizerCtor.availability();
  }
  if (typeof SummarizerCtor.capabilities === 'function') {
    const capabilities = await SummarizerCtor.capabilities();
    if (capabilities.available === 'no') return 'unavailable';
    if (capabilities.available === 'after-download') {
      if (typeof capabilities.download === 'function') {
        await capabilities.download();
      } else if (typeof capabilities.ensureDownloaded === 'function') {
        await capabilities.ensureDownloaded();
      }
      return 'available';
    }
    return 'available';
  }
  return 'available';
}

function sanitizeCreateOptions(options = {}) {
  const allowedKeys = [
    'type',
    'format',
    'length',
    'sharedContext',
    'monitor',
    'expectedInputLanguages',
    'expectedContextLanguages',
    'outputLanguage'
  ];
  const sanitized = {};
  for (const key of allowedKeys) {
    if (options[key] !== undefined) {
      sanitized[key] = options[key];
    }
  }
  return sanitized;
}
