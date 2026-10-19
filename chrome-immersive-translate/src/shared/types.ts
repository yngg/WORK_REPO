export type Platform = "gemini" | "cursor" | "grok" | "openai";

export type TranslateMode = "webpage" | "manual" | "offline_prefetch";

export type AuthMode = "apikey" | "oauth";

export interface PlatformConfig {
  apiKey: string;
  modelId: string;
  enabled: boolean;
  /** Cursor: optional OpenAI-compatible base URL (official Cursor Plus has no public chat API). */
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
  gemini: "gemini-3.8-flash",
  cursor: "cursor-fast",
  grok: "grok-2-latest",
  openai: "gpt-4o",
};

/** Retired Gemini IDs that 404 for new users — migrate on settings load. */
export const DEPRECATED_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
]);

/** No-balance routing: Gemini → Cursor → Grok → OpenAI */
export const PLATFORM_ORDER: Platform[] = ["gemini", "cursor", "grok", "openai"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  gemini: "Gemini",
  cursor: "Cursor",
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
