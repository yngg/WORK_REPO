import type { Platform } from "../../shared/types";
import type { ProviderCallArgs, ProviderCallResult } from "./types";
import { ProviderError } from "./types";
import { translateGemini } from "./gemini";
import { translateGrok } from "./grok";
import { translateOpenAI } from "./openai";
import { mockTranslateToZh } from "./mock-zh";

export { ProviderError } from "./types";

/** Set API Key to `mock` (or `mock:fail`) in settings for local self-test without real credentials. */
async function translateMock(
  platform: Platform,
  args: ProviderCallArgs
): Promise<ProviderCallResult> {
  const key = args.apiKey.trim().toLowerCase();
  if (key === "mock:fail" || key === "mock:429") {
    throw new ProviderError(`${platform} 额度/限流错误 (429)`, 429, true);
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
    case "gemini":
      return translateGemini(args);
    case "grok":
      return translateGrok(args);
    case "openai":
      return translateOpenAI(args);
    default:
      throw new Error(`未知平台: ${platform}`);
  }
}
