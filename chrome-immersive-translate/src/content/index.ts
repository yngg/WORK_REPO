import { sendMessage } from "../shared/messaging";
import type { TabState, TranslateMode, TranslateResult } from "../shared/types";
import { extractParagraphs, isInViewport, type ExtractedParagraph } from "./extract";
import {
  countInjected,
  insertPlaceholder,
  insertTranslation,
  showToast,
  teardownAll,
} from "./render";

interface ContentFlags {
  online: boolean;
  offline: boolean;
}

let flags: ContentFlags = { online: false, offline: false };
let observer: MutationObserver | null = null;
let scrollTimer: number | null = null;
let mutateTimer: number | null = null;
let running = false;
const pending = new Set<string>();
const done = new Set<string>();
let leakCheckTimer: number | null = null;
/** After sustained 429 / stopQueue, pause enqueue until user toggles or cooldown window. */
let queuePausedUntil = 0;
let idlePrefetchScheduled = false;

async function init(): Promise<void> {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CONTENT_STATUS") {
      void applyFlags({
        online: !!msg.payload?.online,
        offline: !!msg.payload?.offline,
      });
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "TOAST") {
      showToast(msg.payload.message, msg.payload.level);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "GET_CONTENT_STATS") {
      sendResponse({
        ok: true,
        data: { injected: countInjected(), pending: pending.size, done: done.size },
      });
      return true;
    }
    return false;
  });

  const resp = await sendMessage<TabState>({ type: "GET_MY_TAB_STATE" });
  if (resp.ok && resp.data) {
    await applyFlags({
      online: resp.data.onlineEnabled,
      offline: resp.data.offlinePrefetchEnabled,
    });
  } else {
    await applyFlags({ online: false, offline: false });
  }

  window.addEventListener("pagehide", cleanup, { once: true });
}

async function applyFlags(next: ContentFlags): Promise<void> {
  const wasOn = flags.online || flags.offline;
  const willOn = next.online || next.offline;
  flags = next;
  queuePausedUntil = 0;
  idlePrefetchScheduled = false;

  if (!willOn) {
    cleanup();
    teardownAll();
    pending.clear();
    done.clear();
    return;
  }

  if (!wasOn) {
    startObservers();
  }
  await scheduleTranslate(true);
}

function startObservers(): void {
  if (!observer) {
    observer = new MutationObserver(() => {
      if (mutateTimer) window.clearTimeout(mutateTimer);
      mutateTimer = window.setTimeout(() => {
        void scheduleTranslate(false);
      }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  if (!leakCheckTimer) {
    leakCheckTimer = window.setInterval(() => {
      const n = countInjected();
      if (n > 5000) {
        console.warn("[沉浸式翻译] 注入节点过多，执行清理校验", n);
      }
    }, 30000);
  }
}

function onScroll(): void {
  if (scrollTimer) window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    void scheduleTranslate(false);
  }, 200);
}

function cleanup(): void {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("scroll", onScroll);
  if (scrollTimer) window.clearTimeout(scrollTimer);
  if (mutateTimer) window.clearTimeout(mutateTimer);
  if (leakCheckTimer) window.clearInterval(leakCheckTimer);
  leakCheckTimer = null;
  running = false;
  idlePrefetchScheduled = false;
}

function isQueuePaused(): boolean {
  return Date.now() < queuePausedUntil;
}

function pauseQueue(ms = 60_000): void {
  queuePausedUntil = Math.max(queuePausedUntil, Date.now() + ms);
}

async function scheduleTranslate(preferViewport: boolean): Promise<void> {
  if (!flags.online && !flags.offline) return;
  if (running) return;
  if (isQueuePaused()) return;
  running = true;
  try {
    const paragraphs = extractParagraphs();
    let targets: ExtractedParagraph[];

    const visible = paragraphs.filter((p) => isInViewport(p.el) && !done.has(p.id));
    const rest = paragraphs.filter((p) => !isInViewport(p.el) && !done.has(p.id));

    if (flags.offline) {
      // Offline prefetch: viewport first, then rest — but only small slices to avoid stampede
      targets = preferViewport
        ? [...visible, ...rest.slice(0, 12)]
        : [...visible, ...rest.slice(0, 8)].filter((p) => !done.has(p.id));
    } else {
      targets = visible.length ? visible : rest.slice(0, 4);
      // Defer off-viewport work until after viewport batch finishes (no parallel stampede)
      if (rest.length && visible.length && !idlePrefetchScheduled) {
        idlePrefetchScheduled = true;
        requestIdleCallbackSafe(() => {
          idlePrefetchScheduled = false;
          if (!isQueuePaused() && (flags.online || flags.offline)) {
            void translateList(rest.slice(0, 8), "webpage", false);
          }
        });
      }
    }

    const mode: TranslateMode = flags.offline ? "offline_prefetch" : "webpage";
    const preferCacheOnly = !navigator.onLine;

    await translateList(targets, mode, preferCacheOnly);
  } finally {
    running = false;
  }
}

function requestIdleCallbackSafe(cb: () => void): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) {
    w.requestIdleCallback(cb, { timeout: 4000 });
  } else {
    setTimeout(cb, 1200);
  }
}

function toastForResult(result: TranslateResult): void {
  if (!result.error && !result.fallbackNote) return;
  if (result.fallbackNote) showToast(result.fallbackNote, "warn");
  if (!result.error) return;

  if (result.errorKind === "quota") {
    showToast(result.error, "error");
    return;
  }
  if (result.errorKind === "rate_limit" || result.stopQueue) {
    showToast(result.error, "warn");
    return;
  }
  showToast(result.error, "error");
}

async function translateList(
  list: ExtractedParagraph[],
  mode: TranslateMode,
  preferCacheOnly: boolean
): Promise<void> {
  const items = list.filter((p) => !pending.has(p.id) && !done.has(p.id));
  if (!items.length) return;
  if (isQueuePaused()) return;

  for (const p of items) pending.add(p.id);

  // Small chunks — background concurrency is already capped at 2
  const chunkSize = 2;
  for (let i = 0; i < items.length; i += chunkSize) {
    if (!flags.online && !flags.offline) break;
    if (isQueuePaused()) {
      for (let j = i; j < items.length; j++) pending.delete(items[j].id);
      break;
    }

    const chunk = items.slice(i, i + chunkSize);
    const resp = await sendMessage<Array<{ id: string; result: TranslateResult }>>({
      type: "TRANSLATE_BATCH",
      payload: {
        mode,
        items: chunk.map((p) => ({
          id: p.id,
          text: p.text,
          preferCacheOnly,
        })),
      },
    });

    if (!resp.ok || !resp.data) {
      for (const p of chunk) {
        pending.delete(p.id);
        if (preferCacheOnly) {
          insertPlaceholder(p.el);
          done.add(p.id);
        }
      }
      if (resp.error) showToast(resp.error, "error");
      continue;
    }

    let sawStop = false;
    const byId = new Map(chunk.map((p) => [p.id, p]));
    let coalescedErrorShown = false;

    for (const { id, result } of resp.data) {
      const p = byId.get(id);
      if (!p) continue;
      pending.delete(id);
      if (result.ok && result.translation) {
        insertTranslation(p.el, result.translation, {
          modelId: result.modelId,
          platform: result.platform,
          fromCache: result.fromCache,
        });
        done.add(id);
        if (result.fallbackNote) showToast(result.fallbackNote, "warn");
      } else if (preferCacheOnly || result.error === "未缓存 / 缓存不足") {
        insertPlaceholder(p.el, result.error || "未缓存 / 缓存不足");
        done.add(id);
      } else {
        if (result.stopQueue) sawStop = true;
        // One toast per chunk for identical failures (render also coalesces across chunks)
        if (result.error && !coalescedErrorShown) {
          toastForResult(result);
          coalescedErrorShown = true;
        } else if (result.fallbackNote) {
          showToast(result.fallbackNote, "warn");
        }
      }
    }

    if (sawStop) {
      pauseQueue(90_000);
      for (let j = i + chunkSize; j < items.length; j++) pending.delete(items[j].id);
      break;
    }
  }
}

window.addEventListener("offline", () => {
  if (flags.online || flags.offline) {
    showToast("网络已断开，将仅显示已缓存译文", "warn");
    done.clear();
    void scheduleTranslate(true);
  }
});

window.addEventListener("online", () => {
  if (flags.online || flags.offline) {
    queuePausedUntil = 0;
    showToast("网络已恢复", "info");
    document.querySelectorAll("[data-imt-placeholder]").forEach((n) => {
      const prev = n.previousElementSibling;
      if (prev instanceof HTMLElement && prev.dataset.imtId) {
        done.delete(prev.dataset.imtId);
      }
      n.remove();
    });
    void scheduleTranslate(true);
  }
});

void init();
