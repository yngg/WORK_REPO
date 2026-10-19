import { DEFAULT_MODELS } from "../../shared/types";
import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError, TRANSLATE_SYSTEM, TRANSLATE_USER_PREFIX } from "./types";

function normalizeModelId(modelId: string): string {
  return modelId.replace(/^models\//, "").trim();
}

async function callOnce(
  args: ProviderCallArgs & { accessToken?: string },
  modelId: string
): Promise<ProviderCallResult> {
  const { apiKey, text, signal, accessToken } = args;
  const id = normalizeModelId(modelId);
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`;
  const url = accessToken ? base : `${base}?key=${encodeURIComponent(apiKey)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers,
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
      res.status === 429 || res.status >= 500 || res.status === 402 || res.status === 404
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
    modelId: id,
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

export async function translateGemini(
  args: ProviderCallArgs & { accessToken?: string }
): Promise<ProviderCallResult> {
  const primary = normalizeModelId(args.modelId) || DEFAULT_MODELS.gemini;
  try {
    return await callOnce(args, primary);
  } catch (e) {
    const is404 =
      e instanceof ProviderError &&
      (e.status === 404 || /no longer available|not found|404/i.test(e.message));
    const fallback = DEFAULT_MODELS.gemini;
    if (is404 && primary !== fallback) {
      return callOnce(args, fallback);
    }
    throw e;
  }
}
