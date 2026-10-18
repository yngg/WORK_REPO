# 沉浸式翻译（Chrome MV3）v1

网页段落**双语对照**（原文下方显示中文译文）+ 工具栏**弹窗手动翻译**。支持自有 Gemini / Grok / OpenAI API Key。

## 功能概览

- 本页在线翻译（默认关闭，显式开启才请求）
- 本页离线预译 + 断网缓存/占位
- 弹窗手动翻译（默认 Gemini，可切换平台；始终展示所用模型 ID）
- 失败自动降级：Gemini → Grok → OpenAI
- 本机段落缓存（默认 50MB，LRU）
- 用量看板（按平台/模型统计）

## 安装（macOS / Windows 相同）

### 方式 A：加载已解压扩展（推荐）

1. 下载并解压 `immersive-translate-v1.zip`（或使用仓库构建产物目录 `dist/`）。
2. 打开 Chrome，地址栏进入 `chrome://extensions`。
3. 右上角打开「**开发者模式**」。
4. 点击「**加载已解压的扩展程序**」。
5. 选择解压后的文件夹（需包含 `manifest.json` 的那一层，即 `dist/` 内容）。
6. 固定工具栏图标后，点击进入「设置」，填写至少一个平台的 API Key。

### 从源码构建

```bash
cd chrome-immersive-translate
npm install
npm run build
```

产物：

- 可加载目录：`dist/`
- 发布压缩包：`dist/immersive-translate-v1.zip`（根目录亦有一份）

## 获取 API Key

| 平台 | 控制台 | 默认模型（可改） |
|------|--------|------------------|
| Gemini | [Google AI Studio](https://aistudio.google.com) | `gemini-2.5-flash` |
| Grok | [xAI Console](https://console.x.ai) | `grok-2-latest` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | `gpt-4o` |

说明：ChatGPT Plus / Gemini App / X Premium 等聊天订阅**通常不等于** API 额度，需单独开通 API。

## 使用

1. **本页在线翻译**：弹窗打开开关 → 正文段落下出现中文译文。
2. **本页离线预译**：开启后预译并缓存；断网时已缓存正常显示，未缓存显示「未缓存 / 缓存不足」。
3. **手动翻译**：弹窗输入文本 → 选择平台 → 翻译；结果区显示译文与**实际模型 ID**。

## 隐私

- API Key 仅存于本机 `chrome.storage.local`。
- 翻译请求只由扩展 **Service Worker** 发出，不进入页面 JS 上下文。

## 非目标（v1 不做）

Cursor 后端、PDF / 视频 / EPUB、多目标语言、Chrome Web Store 上架。

## 许可

仅供个人学习与本机使用。
