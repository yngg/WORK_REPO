import { getOAuthToken, getSettings } from "../../shared/storage";
import { markRecommended, PLATFORM_META, pickRecommendedId } from "../../shared/platform-meta";
import type { ModelInfo, Platform } from "../../shared/types";
import { getValidGeminiAccessToken } from "../auth/google-oauth";

function authHint(platform: Platform): string {
  return PLATFORM_META[platform].apiKeyNoteZh;
}

export async function listModels(platform: Platform): Promise<{
  models: ModelInfo[];
  source: "live" | "fallback";
  selectedId: string;
  fellBackFrom?: string;
  toast?: string;
}> {
  const settings = await getSettings();
  const cfg = settings.platforms[platform];
  const previous = cfg.modelId;

  let live: ModelInfo[] | null = null;
  try {
    live = await fetchLiveModels(platform);
  } catch {
    live = null;
  }

  const models = markRecommended(
    live && live.length ? live : PLATFORM_META[platform].fallbackModels,
    platform
  );
  const source: "live" | "fallback" = live && live.length ? "live" : "fallback";
  const selectedId = pickRecommendedId(models, platform, previous);
  const fellBackFrom = previous && previous !== selectedId && !models.some((m) => m.id === previous)
    ? previous
    : undefined;

  return {
    models,
    source,
    selectedId,
    fellBackFrom,
    toast: fellBackFrom
      ? `模型「${fellBackFrom}」已不在列表中，已切换为推荐：${selectedId}`
      : undefined,
  };
}

async function fetchLiveModels(platform: Platform): Promise<ModelInfo[]> {
  const settings = await getSettings();
  const cfg = settings.platforms[platform];
  const key = cfg.apiKey.trim();

  switch (platform) {
    case "gemini": {
      const oauth = await getValidGeminiAccessToken();
      if (!oauth && !key) throw new Error(authHint(platform));
      const url = "https://generativelanguage.googleapis.com/v1beta/models";
      const headers: Record<string, string> = {};
      const finalUrl = oauth ? url : `${url}?key=${encodeURIComponent(key)}`;
      if (oauth) headers.Authorization = `Bearer ${oauth}`;
      const res = await fetch(finalUrl, { headers });
      if (!res.ok) throw new Error(`Gemini models ${res.status}`);
      const data = (await res.json()) as {
        models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      };
      return (data.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => {
          const id = (m.name ?? "").replace(/^models\//, "");
          return { id, displayName: m.displayName || id };
        })
        .filter((m) => m.id);
    }
    case "openai": {
      if (!key) throw new Error(authHint(platform));
      if (key.toLowerCase() === "mock" || key.toLowerCase().startsWith("mock:")) {
        return PLATFORM_META.openai.fallbackModels;
      }
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`OpenAI models ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? [])
        .map((m) => ({ id: m.id, displayName: m.id }))
        .filter((m) => /^(gpt-|o\d)/.test(m.id))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    case "grok": {
      if (!key) throw new Error(authHint(platform));
      if (key.toLowerCase() === "mock" || key.toLowerCase().startsWith("mock:")) {
        return PLATFORM_META.grok.fallbackModels;
      }
      const res = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`Grok models ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
    }
    case "cursor": {
      const base = (cfg.baseUrl || "").replace(/\/$/, "");
      if (!key) throw new Error(authHint(platform));
      if (key.toLowerCase() === "mock" || key.toLowerCase().startsWith("mock:")) {
        return PLATFORM_META.cursor.fallbackModels;
      }
      if (!base) {
        // No official list endpoint for Cursor Plus chat — use curated fallback
        return PLATFORM_META.cursor.fallbackModels;
      }
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`Cursor compatible models ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
    }
    default:
      return [];
  }
}

export async function platformIsAuthenticated(platform: Platform): Promise<boolean> {
  const settings = await getSettings();
  const cfg = settings.platforms[platform];
  if (cfg.apiKey.trim()) return true;
  if (platform === "gemini") {
    const t = await getOAuthToken("gemini");
    return !!t?.accessToken;
  }
  return false;
}
