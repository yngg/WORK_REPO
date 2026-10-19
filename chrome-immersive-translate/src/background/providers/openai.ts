import type { ProviderCallArgs, ProviderCallResult } from "./types";
import {
  ProviderError,
  TRANSLATE_SYSTEM,
  TRANSLATE_USER_PREFIX,
  classifyHttpError,
  parseRetryAfterMs,
} from "./types";

export async function translateOpenAI(args: ProviderCallArgs): Promise<ProviderCallResult> {
  const { apiKey, modelId, text, signal } = args;
  const url = "https://api.openai.com/v1/chat/completions";

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
    const retryAfterMs = parseRetryAfterMs(res, body);
    const classified = classifyHttpError("OpenAI", res.status, body, retryAfterMs);
    console.warn("[沉浸式翻译] OpenAI HTTP", res.status, body.slice(0, 400));
    throw new ProviderError(classified.userMessage, res.status, classified.retryable, {
      kind: classified.kind,
      retryAfterMs,
      userMessage: classified.userMessage,
    });
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const translation = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!translation) {
    throw new ProviderError("OpenAI 返回空译文", 502, true, {
      kind: "other",
      userMessage: "OpenAI 返回空译文",
    });
  }

  return {
    translation,
    modelId,
    platform: "openai",
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
