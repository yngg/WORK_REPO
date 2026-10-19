import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError, TRANSLATE_SYSTEM, TRANSLATE_USER_PREFIX } from "./types";

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
    throw new ProviderError(
      `OpenAI 错误 ${res.status}: ${body.slice(0, 200) || res.statusText}`,
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
    throw new ProviderError("OpenAI 返回空译文", 502, true);
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
