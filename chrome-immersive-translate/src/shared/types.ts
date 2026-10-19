export type Platform = "local" | "gemini" | "cursor" | "grok" | "openai";

export type TranslateMode = "webpage" | "manual" | "offline_prefetch";

export type AuthMode = "apikey" | "oauth" | "local";

export interface PlatformConfig {
  apiKey: string;
  modelId: string;
  enabled: boolean;
  /**
   * Cursor: OpenAI-compatible base URL.
   * Local: Ollama (or compatible) base URL, default http://127.0.0.1:11434.
   */
  baseUrl?: string;
  authMode?: AuthMode;
}

export interface OAuthTokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export interface Settings {
  platforms: Record<Platform, PlatformConfig>;
  cacheLimitMb: number;
  onlineTranslateDefault: boolean;
  /** Google OAuth client ID for Gemini (user-created Chrome/Desktop client). */
  googleOAuthClientId: string;
  /**
   * When true and local Ollama is ready, route Local → Gemini → Cursor → Grok → OpenAI.
   * Default on so local-first users avoid cloud quota.
   */
  preferLocal: boolean;
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
  preferredPlatform?: Platform;
  sourceLang?: string;
  targetLang?: string;
  preferCacheOnly?: boolean;
}

export type TranslateErrorKind =
  | "rate_limit"
  | "quota"
  | "auth"
  | "not_found"
  | "other";

export interface TranslateResult {
  ok: boolean;
  translation?: string;
  platform?: Platform;
  modelId?: string;
  fromCache?: boolean;
  usage?: UsageTokens;
  error?: string;
  errorKind?: TranslateErrorKind;
  fallbackNote?: string;
  estimated?: boolean;
  /** Background asks content to stop enqueueing more paragraphs. */
  stopQueue?: boolean;
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

export interface ModelInfo {
  id: string;
  displayName: string;
  recommended?: boolean;
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
  | { type: "CONTENT_STATUS"; payload: { online: boolean; offline: boolean } }
  | { type: "LIST_MODELS"; payload: { platform: Platform } }
  | { type: "OAUTH_LOGIN"; payload: { platform: Platform } }
  | { type: "OAUTH_LOGOUT"; payload: { platform: Platform } }
  | { type: "GET_AUTH_STATUS" };

export type MessageResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export const DEFAULT_MODELS: Record<Platform, string> = {
  local: "qwen2.5:7b",
  gemini: "gemini-3.8-flash",
  cursor: "cursor-fast",
  grok: "grok-2-latest",
  openai: "gpt-4o",
};

export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434";

/** Retired Gemini IDs that 404 for new users — migrate on settings load. */
export const DEPRECATED_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
]);

/**
 * Cloud fallback order (after local when preferLocal + local ready).
 * Full default order with preferLocal: Local → Gemini → Cursor → Grok → OpenAI.
 */
export const CLOUD_PLATFORM_ORDER: Platform[] = ["gemini", "cursor", "grok", "openai"];

/** All platforms for settings UI / usage boards (local first). */
export const PLATFORM_ORDER: Platform[] = ["local", ...CLOUD_PLATFORM_ORDER];

export const PLATFORM_LABELS: Record<Platform, string> = {
  local: "本地模型 (Ollama)",
  gemini: "Gemini",
  cursor: "Cursor",
  grok: "Grok (xAI)",
  openai: "OpenAI",
};

export const TARGET_LANG = "zh-CN";
export const DEFAULT_CACHE_MB = 50;
/** Max parallel cloud provider calls (page-wide). Keep low to avoid 429 stampedes. */
export const MAX_CONCURRENCY = 2;
/** Local LLMs are usually single-GPU — keep at 1. */
export const MAX_CONCURRENCY_LOCAL = 1;
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
