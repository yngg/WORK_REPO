import { DEFAULT_MODELS } from "../../shared/types";
import type { ProviderCallArgs, ProviderCallResult } from "./types";
import {
  ProviderError,
  TRANSLATE_SYSTEM,
  TRANSLATE_USER_PREFIX,
  classifyHttpError,
  parseRetryAfterMs,
} from "./types";

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
    const retryAfterMs = parseRetryAfterMs(res, body);
    const classified = classifyHttpError("Gemini", res.status, body, retryAfterMs);
    console.warn("[沉浸式翻译] Gemini HTTP", res.status, body.slice(0, 400));
    throw new ProviderError(classified.userMessage, res.status, classified.retryable, {
      kind: classified.kind,
      retryAfterMs,
      userMessage: classified.userMessage,
    });
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
    throw new ProviderError("Gemini 返回空译文", 502, true, {
      kind: "other",
      userMessage: "Gemini 返回空译文",
    });
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
      (e.status === 404 || e.kind === "not_found" || /no longer available|not found/i.test(e.message));
    const fallback = DEFAULT_MODELS.gemini;
    if (is404 && primary !== fallback) {
      return callOnce(args, fallback);
    }
    throw e;
  }
}
