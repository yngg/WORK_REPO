import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError, TRANSLATE_SYSTEM, TRANSLATE_USER_PREFIX } from "./types";

export async function translateGemini(args: ProviderCallArgs): Promise<ProviderCallResult> {
  const { apiKey, modelId, text, signal } = args;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TRANSLATE_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: TRANSLATE_USER_PREFIX + text }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      `Gemini 错误 ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      res.status,
      res.status === 429 || res.status >= 500 || res.status === 402
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const translation =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";
  if (!translation) {
    throw new ProviderError("Gemini 返回空译文", 502, true);
  }

  return {
    translation,
    modelId,
    platform: "gemini",
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
          estimated: false,
        }
      : undefined,
  };
}
