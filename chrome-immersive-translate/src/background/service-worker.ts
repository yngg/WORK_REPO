import { clearCache, getCacheStats, setCacheLimitMb } from "./cache";
import { translateBatch, translateText } from "./router";
import { summarizeUsage } from "./usage";
import {
  getSettings,
  getTabState,
  saveSettings,
  setTabState,
} from "../shared/storage";
import type { MessageType, Settings, TabState } from "../shared/types";

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
  return true; // async
});

async function handleMessage(
  message: MessageType,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "PING":
      return { ok: true, data: { version: "1.0.0" } };

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }

    case "SAVE_SETTINGS": {
      const settings = message.payload as Settings;
      await saveSettings(settings);
      await setCacheLimitMb(settings.cacheLimitMb);
      return { ok: true, data: settings };
    }

    case "GET_TAB_STATE": {
      const state = await getTabState(message.payload.tabId);
      return { ok: true, data: state };
    }

    case "GET_MY_TAB_STATE": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false, error: "无标签页上下文" };
      const state = await getTabState(tabId);
      return { ok: true, data: state };
    }

    case "SET_TAB_STATE": {
      const prev = await getTabState(message.payload.tabId);
      const next: TabState = { ...prev, ...message.payload };
      await setTabState(next);

      // Abort in-flight when disabling online/offline
      if (!next.onlineEnabled && !next.offlinePrefetchEnabled) {
        abortControllers.get(next.tabId)?.abort();
        abortControllers.delete(next.tabId);
      }

      // Notify content script
      try {
        await chrome.tabs.sendMessage(next.tabId, {
          type: "CONTENT_STATUS",
          payload: {
            online: next.onlineEnabled,
            offline: next.offlinePrefetchEnabled,
          },
        });
      } catch {
        /* tab may not have content script */
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
      if (tabId != null && result.ok) {
        const state = await getTabState(tabId);
        await setTabState({
          ...state,
          lastModelId: result.modelId,
          lastPlatform: result.platform,
          lastFallbackNote: result.fallbackNote,
          lastError: undefined,
        });
      } else if (tabId != null && !result.ok) {
        const state = await getTabState(tabId);
        await setTabState({ ...state, lastError: result.error });
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
      const results = await translateBatch(
        message.payload.items,
        message.payload.mode,
        controller?.signal
      );
      return { ok: true, data: results };
    }

    case "GET_USAGE": {
      const summary = await summarizeUsage(message.payload?.days ?? 14);
      return { ok: true, data: summary };
    }

    case "CLEAR_CACHE": {
      await clearCache();
      return { ok: true, data: await getCacheStats() };
    }

    case "GET_CACHE_STATS": {
      return { ok: true, data: await getCacheStats() };
    }

    default:
      return { ok: false, error: "未知消息类型" };
  }
}

export {};
