import { DEFAULT_LOCAL_BASE_URL } from "../../shared/types";
import type { ProviderCallArgs, ProviderCallResult } from "./types";
import {
  ProviderError,
  TRANSLATE_SYSTEM,
  TRANSLATE_USER_PREFIX,
  classifyHttpError,
  parseRetryAfterMs,
} from "./types";

function normalizeBase(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_LOCAL_BASE_URL).trim().replace(/\/$/, "");
  return raw || DEFAULT_LOCAL_BASE_URL;
}

/**
 * Call local Ollama (or OpenAI-compatible local server).
 * Prefers native POST /api/chat; falls back to /v1/chat/completions.
 */
export async function translateOllama(
  args: ProviderCallArgs & { baseUrl?: string }
): Promise<ProviderCallResult> {
  const base = normalizeBase(args.baseUrl);
  const { modelId, text, signal, apiKey } = args;

  try {
    return await callNativeChat(base, modelId, text, signal);
  } catch (e) {
    // If native endpoint missing, try OpenAI-compatible path (LM Studio, etc.)
    if (e instanceof ProviderError && (e.status === 404 || e.status === 405)) {
      return callOpenAiCompat(base, modelId, text, signal, apiKey);
    }
    throw e;
  }
}

async function callNativeChat(
  base: string,
  modelId: string,
  text: string,
  signal?: AbortSignal
): Promise<ProviderCallResult> {
  const url = `${base}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        messages: [
          { role: "system", content: TRANSLATE_SYSTEM },
          { role: "user", content: TRANSLATE_USER_PREFIX + text },
        ],
        options: { temperature: 0.2 },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderError(
      `本地模型无法连接（${base}）。请确认 Ollama 已启动：${msg}`,
      0,
      true,
      {
        kind: "other",
        userMessage: `本地模型无法连接（${base}）。请确认已安装并运行 Ollama`,
      }
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryAfterMs = parseRetryAfterMs(res, body);
    const classified = classifyHttpError("本地模型", res.status, body, retryAfterMs);
    console.warn("[沉浸式翻译] Ollama /api/chat", res.status, body.slice(0, 400));
    throw new ProviderError(classified.userMessage, res.status, classified.retryable, {
      kind: classified.kind,
      retryAfterMs,
      userMessage: classified.userMessage,
    });
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    model?: string;
    eval_count?: number;
    prompt_eval_count?: number;
  };

  const translation = data.message?.content?.trim() ?? "";
  if (!translation) {
    throw new ProviderError("本地模型返回空译文", 502, true, {
      kind: "other",
      userMessage: "本地模型返回空译文",
    });
  }

  return {
    translation,
    modelId: data.model || modelId,
    platform: "local",
    usage: {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      totalTokens:
        data.prompt_eval_count != null || data.eval_count != null
          ? (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
          : undefined,
      estimated: data.prompt_eval_count == null && data.eval_count == null,
    },
  };
}

async function callOpenAiCompat(
  base: string,
  modelId: string,
  text: string,
  signal?: AbortSignal,
  apiKey?: string
): Promise<ProviderCallResult> {
  const url = `${base}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model: modelId,
        temperature: 0.2,
        messages: [
          { role: "system", content: TRANSLATE_SYSTEM },
          { role: "user", content: TRANSLATE_USER_PREFIX + text },
        ],
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderError(`本地兼容端点无法连接：${msg}`, 0, true, {
      kind: "other",
      userMessage: `本地模型无法连接（${base}）。请确认 Ollama / 兼容服务已启动`,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryAfterMs = parseRetryAfterMs(res, body);
    const classified = classifyHttpError("本地模型", res.status, body, retryAfterMs);
    console.warn("[沉浸式翻译] Ollama /v1/chat", res.status, body.slice(0, 400));
    throw new ProviderError(classified.userMessage, res.status, classified.retryable, {
      kind: classified.kind,
      retryAfterMs,
      userMessage: classified.userMessage,
    });
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const translation = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!translation) {
    throw new ProviderError("本地兼容端点返回空译文", 502, true, {
      kind: "other",
      userMessage: "本地模型返回空译文",
    });
  }

  return {
    translation,
    modelId: data.model || modelId,
    platform: "local",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          estimated: false,
        }
      : { estimated: true },
  };
}

/** GET /api/tags — list pulled Ollama models. */
export async function listOllamaModels(baseUrl?: string): Promise<
  Array<{ id: string; displayName: string }>
> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { method: "GET" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法连接 Ollama（${base}）：${msg}`);
  }
  if (!res.ok) {
    // Try OpenAI-compatible models list
    const res2 = await fetch(`${base}/v1/models`).catch(() => null);
    if (res2?.ok) {
      const data = (await res2.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
    }
    throw new Error(`Ollama /api/tags 失败（${res.status}）`);
  }
  const data = (await res.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  return (data.models ?? [])
    .map((m) => {
      const id = (m.name || m.model || "").trim();
      return { id, displayName: id };
    })
    .filter((m) => m.id);
}
