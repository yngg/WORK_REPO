import {
  DEFAULT_CACHE_MB,
  DEFAULT_MODELS,
  DEPRECATED_GEMINI_MODELS,
  PLATFORM_ORDER,
  type OAuthTokenState,
  type Platform,
  type Settings,
  type TabState,
  type UsageRecord,
} from "./types";

const SETTINGS_KEY = "imt_settings";
const USAGE_KEY = "imt_usage";
const TAB_PREFIX = "imt_tab_";
const OAUTH_PREFIX = "imt_oauth_";

export function defaultSettings(): Settings {
  const platforms = {} as Settings["platforms"];
  for (const p of PLATFORM_ORDER) {
    platforms[p] = {
      apiKey: "",
      modelId: DEFAULT_MODELS[p],
      enabled: true,
      authMode: "apikey",
      baseUrl: p === "cursor" ? "" : undefined,
    };
  }
  return {
    platforms,
    cacheLimitMb: DEFAULT_CACHE_MB,
    onlineTranslateDefault: false,
    googleOAuthClientId: "",
  };
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (!stored) return defaultSettings();
  const base = defaultSettings();
  const platforms = { ...base.platforms };
  for (const p of PLATFORM_ORDER) {
    platforms[p] = { ...base.platforms[p], ...stored.platforms?.[p] };
  }
  // Migrate retired Gemini model IDs that 404 for new API users
  let migrated = false;
  const geminiId = (platforms.gemini.modelId || "").replace(/^models\//, "");
  if (!geminiId || DEPRECATED_GEMINI_MODELS.has(geminiId)) {
    platforms.gemini.modelId = DEFAULT_MODELS.gemini;
    migrated = true;
  } else {
    platforms.gemini.modelId = geminiId;
  }
  const settings: Settings = {
    ...base,
    ...stored,
    platforms,
    googleOAuthClientId: stored.googleOAuthClientId ?? "",
  };
  if (migrated) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getTabState(tabId: number): Promise<TabState> {
  const key = TAB_PREFIX + tabId;
  let fromSession: Record<string, unknown> = {};
  try {
    if (chrome.storage.session) {
      fromSession = await chrome.storage.session.get(key);
    }
  } catch {
    fromSession = {};
  }
  const fromLocal = await chrome.storage.local.get(key);
  const stored = (fromSession[key] ?? fromLocal[key]) as Partial<TabState> | undefined;
  return {
    tabId,
    onlineEnabled: false,
    offlinePrefetchEnabled: false,
    ...stored,
  };
}

export async function setTabState(state: TabState): Promise<void> {
  const key = TAB_PREFIX + state.tabId;
  const data = { [key]: state };
  if (chrome.storage.session) {
    await chrome.storage.session.set(data);
  } else {
    await chrome.storage.local.set(data);
  }
}

export async function getUsageRecords(): Promise<UsageRecord[]> {
  const raw = await chrome.storage.local.get(USAGE_KEY);
  return (raw[USAGE_KEY] as UsageRecord[]) ?? [];
}

export async function appendUsage(record: UsageRecord): Promise<void> {
  const list = await getUsageRecords();
  list.push(record);
  const trimmed = list.length > 5000 ? list.slice(list.length - 5000) : list;
  await chrome.storage.local.set({ [USAGE_KEY]: trimmed });
}

export async function clearUsage(): Promise<void> {
  await chrome.storage.local.set({ [USAGE_KEY]: [] });
}

export async function getOAuthToken(platform: Platform): Promise<OAuthTokenState | null> {
  const key = OAUTH_PREFIX + platform;
  const raw = await chrome.storage.local.get(key);
  return (raw[key] as OAuthTokenState | undefined) ?? null;
}

export async function setOAuthToken(
  platform: Platform,
  token: OAuthTokenState | null
): Promise<void> {
  const key = OAUTH_PREFIX + platform;
  if (!token) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: token });
  }
}
