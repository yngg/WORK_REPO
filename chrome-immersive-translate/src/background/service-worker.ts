import { clearCache, getCacheStats, setCacheLimitMb } from "./cache";
import { translateBatch, translateText } from "./router";
import { summarizeUsage } from "./usage";
import { listModels, platformIsAuthenticated } from "./providers/models";
import { loginGoogleGemini, logoutGoogleGemini } from "./auth/google-oauth";
import {
  getOAuthToken,
  getSettings,
  getTabState,
  saveSettings,
  setTabState,
} from "../shared/storage";
import { PLATFORM_ORDER, type MessageType, type Platform, type Settings, type TabState } from "../shared/types";

const abortControllers = new Map<number, AbortController>();

chrome.runtime.onInstalled.addListener(() => {
  console.info("[沉浸式翻译] 已安装 v1.0.0");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  abortControllers.get(tabId)?.abort();
  abortControllers.delete(tabId);
});

chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((e) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    );
  return true;
});

async function handleMessage(
  message: MessageType,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "PING":
      return { ok: true, data: { version: "1.0.0" } };

    case "GET_SETTINGS":
      return { ok: true, data: await getSettings() };

    case "SAVE_SETTINGS": {
      const settings = message.payload as Settings;
      await saveSettings(settings);
      await setCacheLimitMb(settings.cacheLimitMb);
      return { ok: true, data: settings };
    }

    case "GET_TAB_STATE":
      return { ok: true, data: await getTabState(message.payload.tabId) };

    case "GET_MY_TAB_STATE": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false, error: "无标签页上下文" };
      return { ok: true, data: await getTabState(tabId) };
    }

    case "SET_TAB_STATE": {
      const prev = await getTabState(message.payload.tabId);
      const next: TabState = { ...prev, ...message.payload };
      await setTabState(next);
      if (!next.onlineEnabled && !next.offlinePrefetchEnabled) {
        abortControllers.get(next.tabId)?.abort();
        abortControllers.delete(next.tabId);
      }
      try {
        await chrome.tabs.sendMessage(next.tabId, {
          type: "CONTENT_STATUS",
          payload: {
            online: next.onlineEnabled,
            offline: next.offlinePrefetchEnabled,
          },
        });
      } catch {
        /* ignore */
      }
      return { ok: true, data: next };
    }

    case "TRANSLATE": {
      const tabId = sender.tab?.id;
      let signal: AbortSignal | undefined;
      if (tabId != null) {
        if (!abortControllers.has(tabId)) {
          abortControllers.set(tabId, new AbortController());
        }
        signal = abortControllers.get(tabId)!.signal;
      }
      const result = await translateText(message.payload, signal);
      if (tabId != null) {
        const state = await getTabState(tabId);
        await setTabState({
          ...state,
          lastModelId: result.modelId,
          lastPlatform: result.platform,
          lastFallbackNote: result.fallbackNote,
          lastError: result.ok ? undefined : result.error,
        });
      }
      return { ok: result.ok, data: result, error: result.error };
    }

    case "TRANSLATE_BATCH": {
      const tabId = sender.tab?.id;
      let controller = tabId != null ? abortControllers.get(tabId) : undefined;
      if (tabId != null && !controller) {
        controller = new AbortController();
        abortControllers.set(tabId, controller);
      }
      return {
        ok: true,
        data: await translateBatch(
          message.payload.items,
          message.payload.mode,
          controller?.signal
        ),
      };
    }

    case "GET_USAGE":
      return { ok: true, data: await summarizeUsage(message.payload?.days ?? 14) };

    case "CLEAR_CACHE":
      await clearCache();
      return { ok: true, data: await getCacheStats() };

    case "GET_CACHE_STATS":
      return { ok: true, data: await getCacheStats() };

    case "LIST_MODELS": {
      const listed = await listModels(message.payload.platform);
      if (listed.fellBackFrom || listed.selectedId) {
        const settings = await getSettings();
        const p = message.payload.platform;
        if (settings.platforms[p].modelId !== listed.selectedId) {
          settings.platforms[p].modelId = listed.selectedId;
          await saveSettings(settings);
        }
      }
      return { ok: true, data: listed };
    }

    case "OAUTH_LOGIN": {
      if (message.payload.platform !== "gemini") {
        return { ok: false, error: "该平台不支持 OAuth 登录" };
      }
      const result = await loginGoogleGemini();
      const settings = await getSettings();
      settings.platforms.gemini.authMode = "oauth";
      await saveSettings(settings);
      return { ok: true, data: result };
    }

    case "OAUTH_LOGOUT": {
      if (message.payload.platform === "gemini") {
        await logoutGoogleGemini();
        const settings = await getSettings();
        settings.platforms.gemini.authMode = "apikey";
        await saveSettings(settings);
      }
      return { ok: true };
    }

    case "GET_AUTH_STATUS": {
      const status: Record<
        Platform,
        { authenticated: boolean; email?: string; mode: string }
      > = {} as never;
      for (const p of PLATFORM_ORDER) {
        const authenticated = await platformIsAuthenticated(p);
        const oauth = p === "gemini" ? await getOAuthToken("gemini") : null;
        status[p] = {
          authenticated,
          email: oauth?.email,
          mode: oauth?.accessToken ? "oauth" : "apikey",
        };
      }
      return { ok: true, data: status };
    }

    default:
      return { ok: false, error: "未知消息类型" };
  }
}

export {};
