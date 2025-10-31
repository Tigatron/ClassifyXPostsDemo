
# Chrome Built-In AI — Summarizer API 使用手册
> ✅ **面向 Codex/AI 模型友好**  
> ✅ Markdown 完整结构  
> ✅ 已自动合入全部补充内容  

## 📘 概述
Chrome 提供内置 AI 功能，可在本地执行文本摘要任务，无需外部模型部署。  
本手册介绍如何使用 **Summarizer API** 进行文本摘要。

## ✅ 功能简介
Summarizer API 可将输入文本进行本地摘要输出。  
- 输入：Plain text  
- 输出：摘要文本  
- 模式：完全在本地执行 (Gemini Nano)  
- 数据不会离开本地设备  

> **适用场景**  
- 内容聚合摘要  
- 聊天/文章总结  
- 自动生成标题/关键信息  
- 推荐摘要用语  

# ✅ 浏览器兼容性
| 浏览器 | 支持 |
|---|:---:|
| Chrome (≥138 stable) | ✅ |
| Edge | ⚠️ behind a flag |
| Firefox | ❌ |
| Safari | ❌ |

# ✅ 前置条件
## ✅ 硬件需求
| 条件 | 要求 |
|---|---|
| OS | Windows 10/11, macOS 13+, Linux, ChromeOS Plus |
| Storage | ≥22GB 可用空间 |
| CPU | ≥4 cores |
| RAM | ≥16GB |
| GPU (可选) | ≥4GB VRAM |
| 网络 | 非计量网络 |

> 若空间降至 <10GB，模型会自动删除  
> 可在 `chrome://on-device-internals` 查看模型状态  

# ✅ Summarizer API 核心参数
## create(options)
| 参数 | 类型 | 说明 |
|---|---|---|
| sharedContext | string | 提供摘要背景信息 |
| type | string | 摘要类型 |
| format | string | 输出格式 |
| length | string | 摘要长度级别 |
| monitor | fn | 下载进度回调 |
| expectedInputLanguages | string[] | 输入语言范围 |
| expectedContextLanguages | string[] | 上下文语言 |
| outputLanguage | string | 输出语言 |

## ✅ type – 摘要类型
| type | 含义 |
|---|---|
| tldr | 简短核心概述 |
| teaser | 有趣的引导类型摘要 |
| key-points (默认) | 核心条目，bullet 返回 |
| headline | 标题摘要 |

## ✅ length – 长度规格  
| type | short | medium | long |
|---|---:|---:|---:|
| tldr | 1 sentence | 3 sentences | 5 sentences |
| teaser | 1 sentence | 3 sentences | 5 sentences |
| key-points | 3 bullets | 5 bullets | 7 bullets |
| headline | ~12 words | ~17 words | ~22 words |

## ✅ format
| format | 说明 |
|---|---|
| markdown (默认) | 以 Markdown 格式输出 |
| plain-text | 纯文本 |

# ✅ 使用流程
```mermaid
flowchart TD
  A[检查 availability()] --> B{available?}
  B -->|Yes| C[create()]
  B -->|No| D[等待下载/用户激活]
  C --> E[summarize()]
  E --> F[结果]
```

# ✅ availability()
```js
const status = await Summarizer.availability();
```
| 状态 | 说明 |
|---|---|
| unavailable | 设备不支持 |
| downloadable | 需要下载 |
| downloading | 正在下载 |
| available | ✅ 可用 |

# ✅ 用户激活要求
```js
if (navigator.userActivation.isActive) {
  const summarizer = await Summarizer.create();
}
```

# ✅ create()
```js
const summarizer = await Summarizer.create({
  type: "key-points",
  format: "markdown",
  length: "medium",
  sharedContext: "This is background...",
  monitor(m) {
    m.addEventListener("downloadprogress", e => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  }
});
```

# ✅ summarize（批处理）
```js
const summary = await summarizer.summarize(text, {
  context: "audience: professionals"
});
```
```js
const text = element.innerText;
```

# ✅ summarizeStreaming（流式）
```js
const stream = summarizer.summarizeStreaming(text);
for await (const chunk of stream) {
  console.log(chunk);
}
```

# ✅ 语言控制
```js
const summarizer = await Summarizer.create({
  expectedInputLanguages: ["en", "es"],
  expectedContextLanguages: ["en"],
  outputLanguage: "es"
});
```

# ✅ 典型最小示例
```js
const status = await Summarizer.availability();
if (status === "available") {
  const summarizer = await Summarizer.create();
  const output = await summarizer.summarize("text");
  console.log(output);
}
```

# ✅ 错误处理
```js
try {
  const status = await Summarizer.availability();
  if (status === "unavailable") throw new Error("Unsupported");

  const summarizer = await Summarizer.create();
  const summary = await summarizer.summarize(text);
} catch (err) {
  console.error("Summarizer error:", err);
}
```

# ✅ Permission Policy
| 项目 | 是否支持 |
|---|---|
| top-level window | ✅ |
| same-origin iframe | ✅ |
| cross-origin iframe | ✅ 需 allow |
| Web Worker | ❌ |

```html
<iframe
  src="https://cross-origin.example.com"
  allow="summarizer">
</iframe>
```

# ✅ Tips
| 建议 | 原因 |
|---|---|
| 使用 innerText | 避免 HTML 噪声 |
| 监听下载进度 | 提示用户 |
| 用按钮触发 create | 满足 userActivation |
| 避免传入非常长文本 | 提升性能 |

# ✅ 与其他 API 对比
| API | 功能 | 多模态 |
|---|---|:---:|
| Summarizer | 摘要 | ❌ |
| Writer | 写作 | ❌ |
| Rewriter | 重写 | ❌ |
| Proofreader | 校对 | ❌ |
| Prompt API | Prompt 推理 | ✅ |

# ✅ 封装示例
```js
export async function summarize(text) {
  const status = await Summarizer.availability();
  if (status !== "available") {
    return { error: status };
  }
  const summarizer = await Summarizer.create();
  return summarizer.summarize(text);
}
```

# ✅ 本地测试（localhost）
启用：
```
chrome://flags/#prompt-api-for-gemini-nano-multimodal-input
```

# ✅ TL;DR
```js
await Summarizer.availability();
const sum = await (await Summarizer.create()).summarize("text");
console.log(sum);
```
