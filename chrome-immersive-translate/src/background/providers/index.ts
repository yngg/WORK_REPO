import { getSettings } from "../../shared/storage";
import type { Platform } from "../../shared/types";
import { getValidGeminiAccessToken } from "../auth/google-oauth";
import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError } from "./types";
import { translateCursor } from "./cursor";
import { translateGemini } from "./gemini";
import { translateGrok } from "./grok";
import { translateOllama } from "./ollama";
import { translateOpenAI } from "./openai";
import { mockTranslateToZh } from "./mock-zh";

export { ProviderError } from "./types";

async function translateMock(
  platform: Platform,
  args: ProviderCallArgs
): Promise<ProviderCallResult> {
  const key = args.apiKey.trim().toLowerCase();
  if (key === "mock:fail" || key === "mock:429") {
    throw new ProviderError("请求过于频繁，已降速重试", 429, true, {
      kind: "rate_limit",
      retryAfterMs: 2000,
      userMessage: `${platform === "gemini" ? "Gemini" : platform} 请求过于频繁，已降速重试`,
    });
  }
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  const translation = mockTranslateToZh(args.text);
  return {
    translation,
    modelId: args.modelId,
    platform,
    usage: {
      promptTokens: Math.ceil(args.text.length / 4),
      completionTokens: Math.ceil(translation.length / 2),
      totalTokens: Math.ceil(args.text.length / 4) + Math.ceil(translation.length / 2),
      estimated: true,
    },
  };
}

export async function callProvider(
  platform: Platform,
  args: ProviderCallArgs
): Promise<ProviderCallResult> {
  const key = args.apiKey.trim().toLowerCase();
  if (key === "mock" || key.startsWith("mock:")) {
    return translateMock(platform, args);
  }

  switch (platform) {
    case "local": {
      const settings = await getSettings();
      const baseUrl = settings.platforms.local.baseUrl?.trim() || "";
      return translateOllama({ ...args, baseUrl });
    }
    case "gemini": {
      const accessToken = await getValidGeminiAccessToken();
      if (!accessToken && !args.apiKey.trim()) {
        throw new ProviderError("Gemini 未配置 API Key 或 OAuth", 401, false);
      }
      return translateGemini({ ...args, accessToken: accessToken ?? undefined });
    }
    case "cursor": {
      const settings = await getSettings();
      const baseUrl = settings.platforms.cursor.baseUrl?.trim() || "";
      return translateCursor({ ...args, baseUrl });
    }
    case "grok":
      return translateGrok(args);
    case "openai":
      return translateOpenAI(args);
    default:
      throw new Error(`未知平台: ${platform}`);
  }
}

/** Whether platform can participate in routing. */
export async function isPlatformReady(platform: Platform): Promise<boolean> {
  const settings = await getSettings();
  const cfg = settings.platforms[platform];
  if (!cfg.enabled) return false;
  const key = cfg.apiKey.trim();
  const isMock = key.toLowerCase() === "mock" || key.toLowerCase().startsWith("mock:");

  if (platform === "local") {
    if (isMock) return true;
    // Local needs a base URL (Ollama); no API key required
    return !!(cfg.baseUrl || "").trim() && !!(cfg.modelId || "").trim();
  }
  if (platform === "gemini") {
    if (isMock || key) return true;
    const token = await getValidGeminiAccessToken();
    return !!token;
  }
  if (platform === "cursor") {
    if (isMock) return true;
    return !!key && !!(cfg.baseUrl || "").trim();
  }
  return !!key;
}
