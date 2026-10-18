export type Platform = "gemini" | "grok" | "openai";

export type TranslateMode = "webpage" | "manual" | "offline_prefetch";

export interface PlatformConfig {
  apiKey: string;
  modelId: string;
  enabled: boolean;
}

export interface Settings {
  platforms: Record<Platform, PlatformConfig>;
  cacheLimitMb: number;
  /** Global default for online translate — pages start OFF unless tab override */
  onlineTranslateDefault: boolean;
}

export interface TabState {
  tabId: number;
  onlineEnabled: boolean;
  offlinePrefetchEnabled: boolean;
  lastModelId?: string;
  lastPlatform?: Platform;
  lastError?: string;
  lastFallbackNote?: string;
}

export interface TranslateRequest {
  text: string;
  mode: TranslateMode;
  /** Force a platform (manual popup); otherwise use routing */
  preferredPlatform?: Platform;
  sourceLang?: string;
  targetLang?: string;
  /** Offline: only return cache hits, never call APIs */
  preferCacheOnly?: boolean;
}

export interface TranslateResult {
  ok: boolean;
  translation?: string;
  platform?: Platform;
  modelId?: string;
  fromCache?: boolean;
  usage?: UsageTokens;
  error?: string;
  fallbackNote?: string;
  estimated?: boolean;
}

export interface UsageTokens {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}

export interface UsageRecord {
  id: string;
  ts: number;
  platform: Platform;
  modelId: string;
  mode: TranslateMode;
  success: boolean;
  tokens: number;
  estimated: boolean;
  error?: string;
}

export interface CacheEntry {
  key: string;
  text: string;
  translation: string;
  platform: Platform;
  modelId: string;
  createdAt: number;
  lastAccess: number;
  sizeBytes: number;
}

export interface ParagraphPayload {
  id: string;
  text: string;
  preferCacheOnly?: boolean;
}

export type MessageType =
  | { type: "TRANSLATE"; payload: TranslateRequest }
  | { type: "TRANSLATE_BATCH"; payload: { items: ParagraphPayload[]; mode: TranslateMode } }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: Settings }
  | { type: "GET_TAB_STATE"; payload: { tabId: number } }
  | { type: "GET_MY_TAB_STATE" }
  | { type: "SET_TAB_STATE"; payload: Partial<TabState> & { tabId: number } }
  | { type: "GET_USAGE"; payload?: { days?: number } }
  | { type: "CLEAR_CACHE" }
  | { type: "GET_CACHE_STATS" }
  | { type: "PING" }
  | { type: "TOAST"; payload: { message: string; level?: "info" | "error" | "warn" } }
  | { type: "CONTENT_STATUS"; payload: { online: boolean; offline: boolean } };

export type MessageResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export const DEFAULT_MODELS: Record<Platform, string> = {
  gemini: "gemini-2.5-flash",
  grok: "grok-2-latest",
  openai: "gpt-4o",
};

export const PLATFORM_ORDER: Platform[] = ["gemini", "grok", "openai"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  gemini: "Gemini",
  grok: "Grok (xAI)",
  openai: "OpenAI",
};

export const TARGET_LANG = "zh-CN";
export const DEFAULT_CACHE_MB = 50;
export const MAX_CONCURRENCY = 3;
export const MIN_PARAGRAPH_CHARS = 20;

export interface UsageSummary {
  byPlatform: Record<
    Platform,
    {
      successCount: number;
      failCount: number;
      tokens: number;
      estimatedTokens: number;
      models: Record<string, { tokens: number; count: number }>;
    }
  >;
  recent: UsageRecord[];
  daily: Array<{ date: string; tokens: number; count: number }>;
}
