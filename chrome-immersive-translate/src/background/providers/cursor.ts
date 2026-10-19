import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError, TRANSLATE_SYSTEM, TRANSLATE_USER_PREFIX } from "./types";

/**
 * Cursor Plus does NOT expose a public chat-completions API for third-party extensions.
 * This adapter only works when the user configures an OpenAI-compatible Base URL + API Key
 * (experimental). Without baseUrl, callers should skip Cursor.
 */
export async function translateCursor(args: ProviderCallArgs & { baseUrl?: string }): Promise<ProviderCallResult> {
  const base = (args.baseUrl || "").replace(/\/$/, "");
  if (!base) {
    throw new ProviderError(
      "Cursor 官方未提供可供第三方扩展调用的聊天补全 API；请配置兼容 Base URL，或跳过 Cursor。",
      501,
      false
    );
  }

  const { apiKey, modelId, text, signal } = args;
  const url = `${base}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      messages: [
        { role: "system", content: TRANSLATE_SYSTEM },
        { role: "user", content: TRANSLATE_USER_PREFIX + text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      `Cursor 兼容端点错误 ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      res.status,
      res.status === 429 || res.status >= 500 || res.status === 402
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const translation = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!translation) {
    throw new ProviderError("Cursor 兼容端点返回空译文", 502, true);
  }

  return {
    translation,
    modelId,
    platform: "cursor",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          estimated: false,
        }
      : undefined,
  };
}
