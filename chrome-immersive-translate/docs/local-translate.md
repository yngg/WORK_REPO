# 本地翻译（Ollama）— 沉浸式翻译

在本机跑模型，少用（或不用）Gemini / 其他云端 API，避免配额 429。云端平台仍保留作降级。

## 快速开始（macOS / Windows）

### 1. 安装 Ollama

- 官网：https://ollama.com/download  
- macOS：下载 `.dmg` 安装，菜单栏出现 Ollama 图标即表示服务在跑（默认 `http://127.0.0.1:11434`）。  
- Windows：安装后同样监听 `11434`。若浏览器扩展连不上，确认防火墙未拦 localhost。

### 2. 拉取模型（按内存选）

| 机器 | 推荐 | 说明 | 命令 |
|------|------|------|------|
| **Mac M2 · 16GB** | `qwen2.5:7b`（推荐 · 16GB） | 中英质量好、RAM 可管；Chrome + 系统并存较稳 | `ollama pull qwen2.5:7b` |
| **Mac M2 · 16GB** | `qwen2.5:14b`（可选） | 质量更好，但与 Chrome/系统并存时可能偏紧、易换页 | `ollama pull qwen2.5:14b` |
| **Mac M5 · 24GB** | `qwen2.5:14b`（推荐 · 24GB） | 同系列提质首选 | `ollama pull qwen2.5:14b` |
| **Mac M5 · 24GB** | `qwen2.5:7b`（更快） | 延迟更低、省内存 | `ollama pull qwen2.5:7b` |

备选：

```bash
ollama pull gemma2:9b      # 备选
ollama pull llama3.2:3b   # 更快 / 较弱，适合试通链路
```

诚实预期：

- **首次下载**体积大（7B 常见数 GB；14B 更大），需稳定网络与磁盘。  
- **推理**占用统一内存 / VRAM；16GB 机器请优先 7B，并关掉多余标签页。  
- NLLB / Marian 等专用翻译模型不在典型 Ollama 体验里，本扩展以通用 chat 模型为主。

验证：

```bash
ollama list
curl -s http://127.0.0.1:11434/api/tags | head
```

### 3. 扩展里启用

1. 加载本分支构建的 zip：`immersive-translate-local-ollama.zip`（见 store `docs/`）。  
2. Chrome → `chrome://extensions` → 开发者模式 → 加载已解压目录。  
3. 打开「设置」：  
   - 勾选 **优先本地**（默认开）  
   - **本地模型 (Ollama)** → Base URL 默认 `http://127.0.0.1:11434` → **刷新已拉取模型**  
   - 下拉框会标注「推荐 · 16GB」「推荐 · 24GB」「更快」等；若已 pull 14b 与 7b，默认优先选 **14b**，否则 **7b**  
4. 弹窗选「本地模型 (Ollama)」，打开「本页在线翻译」试一段。

Manifest 已声明 `http://127.0.0.1/*` / `http://localhost/*`，扩展后台可访问 Ollama。

## 路由

`优先本地` + 本地启用且可连时：

**Local → Gemini → Cursor → Grok → OpenAI**

本地失败（未启动 / 无模型）会降级到已配置的云端平台。关闭「优先本地」则本地排在云端之后。

本地并发默认为 **1**（单卡/统一内存更稳）；云端仍为 2。

## UX（与云端一致）

- 目标语言：简体中文  
- 网页：原文下方双语译文 + 模型 ID 脚注  
- 段落缓存、失败 toast 合并（不刷屏）

## 排障

| 现象 | 处理 |
|------|------|
| 「本地模型无法连接」 | 确认 Ollama 在跑；URL 是否为 `http://127.0.0.1:11434` |
| 模型列表空 | `ollama pull qwen2.5:7b` 后再点「刷新已拉取模型」 |
| 很慢 / 风扇狂转 | 换 7B；关其它 App；长文会串行翻译 |
| 仍想用 Gemini | 关「优先本地」或关「启用本地模型」，并配置 API Key |

## 产物

- Zip：`/cursor/stores/self/docs/immersive-translate-local-ollama.zip`  
- 云端主线 zip 仍为 `immersive-translate-v1.zip`（本功能在独立分支，不覆盖其叙事）
