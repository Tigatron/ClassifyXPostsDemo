# Classify X Bookmarks Chrome 扩展

本项目演示了如何使用 Chrome 提供的 [内置 AI 语言模型 API](https://developer.chrome.com/docs/ai/built-in-apis?hl=zh-cn) 来对社交媒体 X (Twitter) 书签页中收藏的帖子进行自动分类。

## 功能概述

- 在 X 书签页面中注入脚本，自动向下滚动直至加载所有收藏的帖子。
- 收集每条帖子的文本、作者、时间以及原帖链接等信息，并去重汇总。
- 通过 `ai.languageModel` API 调用 Chrome 内置语言模型，对帖子进行主题聚类并生成简要说明。
- 在插件弹窗中展示分类结果，支持深浅色模式。

## 文件结构

```
extension/
├── manifest.json        // Chrome 扩展配置
├── content-script.js    // 注入 X 书签页，自动滚动并采集帖子
├── popup.html           // 扩展弹窗界面
├── popup.js             // 弹窗逻辑、AI 调用与结果展示
└── styles.css           // 弹窗样式
```

## 本地加载与测试

1. 打开 Chrome，输入 `chrome://extensions/`。
2. 右上角打开“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目下的 `extension` 目录。
4. 在浏览器中访问 `https://x.com/i/bookmarks` 或 `https://twitter.com/i/bookmarks`，确保页面加载完成。
5. 点击扩展图标并打开“Classify X Bookmarks”弹窗，点击“开始分类”。
6. 插件会自动向下滚动加载书签页的全部帖子（包含防止无限滚动的超时机制），然后调用内置 AI 完成分类并展示结果。

> **提示**：要使用 `ai.languageModel` API，需要运行在支持 Chrome 内置 AI 模型的版本中，并在 `chrome://flags` 中启用相关实验性功能（若默认未开启）。

## 开发说明

- `content-script.js` 会在书签页面加载完成后开始监听来自弹窗的消息，在收到 `COLLECT_BOOKMARK_POSTS` 指令时负责自动滚动页面并返回采集到的帖子。
- `popup.js` 会检查当前标签页是否位于书签页面，并在必要时通过 `chrome.scripting.executeScript` 主动注入内容脚本，避免出现“无法建立连接”错误。随后调用 `ai.languageModel` API，根据提示语生成 JSON 格式的分类结果。
- 代码中包含 JSON 提取与错误处理逻辑，以确保当模型输出格式不正确时给予用户明确提示。

欢迎根据自身需求扩展分类提示词、界面展示或接入自定义模型。
