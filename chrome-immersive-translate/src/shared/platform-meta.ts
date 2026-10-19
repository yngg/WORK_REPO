import type { ModelInfo, Platform } from "./types";

export interface PlatformMeta {
  supportsOAuth: boolean;
  oauthNoteZh: string;
  apiKeyNoteZh: string;
  recommendedModelIds: string[];
  /** Static fallback list when live list API unavailable */
  fallbackModels: ModelInfo[];
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  local: {
    supportsOAuth: false,
    oauthNoteZh: "本地模型无需云端登录；由本机 Ollama（或兼容服务）提供推理。",
    apiKeyNoteZh:
      "默认连接 http://127.0.0.1:11434。Mac M2·16GB 推荐 qwen2.5:7b；Mac M5·24GB 可用 qwen2.5:14b 提质。首次 pull 体积较大，请预留磁盘与内存。",
    recommendedModelIds: ["qwen2.5:14b", "qwen2.5:7b", "gemma2:9b", "llama3.2:3b"],
    fallbackModels: [
      {
        id: "qwen2.5:14b",
        displayName: "qwen2.5:14b（推荐 · 24GB）",
        recommended: true,
      },
      {
        id: "qwen2.5:7b",
        displayName: "qwen2.5:7b（推荐 · 16GB / 更快）",
        recommended: true,
      },
      { id: "gemma2:9b", displayName: "gemma2:9b（备选）" },
      { id: "llama3.2:3b", displayName: "llama3.2:3b（更快/较弱）" },
    ],
  },
  gemini: {
    supportsOAuth: true,
    oauthNoteZh:
      "支持 Google 账户 OAuth（需在下方填写你自己创建的 OAuth 客户端 ID）。也可使用 Google AI Studio API Key。",
    apiKeyNoteZh: "API Key 来自 aistudio.google.com，与 Gemini App 订阅分开计费。",
    recommendedModelIds: ["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash"],
    fallbackModels: [
      { id: "gemini-3.8-flash", displayName: "gemini-3.8-flash", recommended: true },
      { id: "gemini-3-flash", displayName: "gemini-3-flash" },
      { id: "gemini-2.5-pro", displayName: "gemini-2.5-pro" },
      { id: "gemini-2.5-flash", displayName: "gemini-2.5-flash（旧，可能 404）" },
    ],
  },
  cursor: {
    supportsOAuth: false,
    oauthNoteZh:
      "Cursor 官方不提供面向第三方扩展的 OAuth 聊天接口；Cursor Plus 订阅也无法在本扩展内直接登录调用模型。",
    apiKeyNoteZh:
      "官方公开 API（Admin / Cloud Agents 等）不是段落翻译用的聊天补全接口。若你有自建/兼容的 OpenAI 风格端点，可填写 API Key + Base URL（实验）；否则请跳过 Cursor。",
    recommendedModelIds: ["cursor-fast", "composer-1"],
    fallbackModels: [
      { id: "cursor-fast", displayName: "cursor-fast", recommended: true },
      { id: "composer-1", displayName: "composer-1", recommended: true },
      { id: "gpt-4o", displayName: "gpt-4o（兼容端点）" },
      { id: "claude-sonnet-4", displayName: "claude-sonnet-4（兼容端点）" },
    ],
  },
  grok: {
    supportsOAuth: false,
    oauthNoteZh: "xAI 当前仅支持 API Key，无适合本扩展的 OAuth。",
    apiKeyNoteZh:
      "重要：X Premium / Grok 网页订阅通常不包含 API 额度。须在 console.x.ai 单独开通 API 并计费。",
    recommendedModelIds: ["grok-2-latest", "grok-2", "grok-3-mini"],
    fallbackModels: [
      { id: "grok-2-latest", displayName: "grok-2-latest", recommended: true },
      { id: "grok-2", displayName: "grok-2", recommended: true },
      { id: "grok-3-mini", displayName: "grok-3-mini" },
      { id: "grok-3", displayName: "grok-3" },
    ],
  },
  openai: {
    supportsOAuth: false,
    oauthNoteZh: "OpenAI 面向扩展的稳定路径是 API Key（ChatGPT 登录 OAuth 不能直接当 API 用）。",
    apiKeyNoteZh: "API Key 来自 platform.openai.com，与 ChatGPT Plus 订阅分开计费。",
    recommendedModelIds: ["gpt-4o", "gpt-4o-mini"],
    fallbackModels: [
      { id: "gpt-4o", displayName: "gpt-4o", recommended: true },
      { id: "gpt-4o-mini", displayName: "gpt-4o-mini" },
      { id: "gpt-4.1", displayName: "gpt-4.1" },
      { id: "gpt-4.1-mini", displayName: "gpt-4.1-mini" },
      { id: "o4-mini", displayName: "o4-mini" },
    ],
  },
};

/** Annotate local Ollama model labels for Mac RAM tiers. */
export function annotateLocalModelLabel(id: string, displayName?: string): string {
  const base = displayName || id;
  const lower = id.toLowerCase();
  if (/qwen2\.5:14b/.test(lower)) return `${id}（推荐 · 24GB）`;
  if (/qwen2\.5:7b/.test(lower)) return `${id}（推荐 · 16GB / 更快）`;
  if (/gemma2:9b/.test(lower)) return `${id}（备选）`;
  if (/llama3\.2:3b/.test(lower)) return `${id}（更快/较弱）`;
  if (base !== id) return base;
  return id;
}

export function markRecommended(models: ModelInfo[], platform: Platform): ModelInfo[] {
  const rec = new Set(PLATFORM_META[platform].recommendedModelIds);
  return models.map((m) => {
    const recommended =
      m.recommended || rec.has(m.id) || [...rec].some((r) => m.id.includes(r) || r.includes(m.id));
    if (platform === "local") {
      return {
        ...m,
        displayName: annotateLocalModelLabel(m.id, m.displayName),
        recommended: recommended || /qwen2\.5:(7b|14b)/i.test(m.id),
      };
    }
    return { ...m, recommended };
  });
}

/**
 * Prefer current selection if still present.
 * Local: if both pulled, prefer qwen2.5:14b (24GB quality), else qwen2.5:7b (16GB default).
 */
export function pickRecommendedId(models: ModelInfo[], platform: Platform, current?: string): string {
  if (current && models.some((m) => m.id === current)) return current;

  if (platform === "local") {
    const fourteen = models.find((m) => /qwen2\.5:14b/i.test(m.id));
    if (fourteen) return fourteen.id;
    const seven = models.find((m) => /qwen2\.5:7b/i.test(m.id));
    if (seven) return seven.id;
  }

  const rec = models.find((m) => m.recommended);
  if (rec) return rec.id;
  const fallback = PLATFORM_META[platform].recommendedModelIds.find((id) =>
    models.some((m) => m.id === id)
  );
  if (fallback) return fallback;
  const metaFallback = PLATFORM_META[platform].recommendedModelIds[0];
  if (metaFallback) return metaFallback;
  return models[0]?.id ?? "";
}
