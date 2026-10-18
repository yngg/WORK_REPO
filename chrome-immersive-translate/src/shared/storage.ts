import {
  DEFAULT_CACHE_MB,
  DEFAULT_MODELS,
  type Platform,
  type Settings,
  type TabState,
  type UsageRecord,
} from "./types";

const SETTINGS_KEY = "imt_settings";
const USAGE_KEY = "imt_usage";
const TAB_PREFIX = "imt_tab_";

export function defaultSettings(): Settings {
  const platforms = {} as Settings["platforms"];
  for (const p of Object.keys(DEFAULT_MODELS) as Platform[]) {
    platforms[p] = {
      apiKey: "",
      modelId: DEFAULT_MODELS[p],
      enabled: true,
    };
  }
  return {
    platforms,
    cacheLimitMb: DEFAULT_CACHE_MB,
    onlineTranslateDefault: false,
  };
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (!stored) return defaultSettings();
  const base = defaultSettings();
  return {
    ...base,
    ...stored,
    platforms: {
      gemini: { ...base.platforms.gemini, ...stored.platforms?.gemini },
      grok: { ...base.platforms.grok, ...stored.platforms?.grok },
      openai: { ...base.platforms.openai, ...stored.platforms?.openai },
    },
  };
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
  // Keep last ~5000 records
  const trimmed = list.length > 5000 ? list.slice(list.length - 5000) : list;
  await chrome.storage.local.set({ [USAGE_KEY]: trimmed });
}

export async function clearUsage(): Promise<void> {
  await chrome.storage.local.set({ [USAGE_KEY]: [] });
}
