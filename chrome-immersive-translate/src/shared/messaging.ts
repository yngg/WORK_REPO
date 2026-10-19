import type { MessageResponse, MessageType } from "./types";

export function sendMessage<T = unknown>(msg: MessageType): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve((resp as MessageResponse<T>) ?? { ok: false, error: "空响应" });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

export function sendToTab<T = unknown>(
  tabId: number,
  msg: MessageType
): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve((resp as MessageResponse<T>) ?? { ok: false, error: "空响应" });
    });
  });
}
