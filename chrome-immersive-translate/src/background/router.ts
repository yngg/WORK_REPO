import { getSettings } from "../shared/storage";
import {
  MAX_CONCURRENCY,
  PLATFORM_LABELS,
  PLATFORM_ORDER,
  TARGET_LANG,
  type Platform,
  type TranslateMode,
  type TranslateRequest,
  type TranslateResult,
} from "../shared/types";
import { getCached, getCachedAny, putCache } from "./cache";
import { callProvider, isPlatformReady, ProviderError } from "./providers";
import type { ErrorKind } from "./providers/types";
import {
  getConsecutive429,
  noteRateLimited,
  noteRequestSuccess,
  resetConsecutive429,
  waitForCooldown,
} from "./rate-limit";
import { recordFailure, recordSuccess } from "./usage";

const inflight = new Map<string, Promise<TranslateResult>>();
let activeCount = 0;
const waitQueue: Array<() => void> = [];

/** Per-platform retries before falling through to the next provider. */
const MAX_RETRIES_PER_PLATFORM = 3;
/** After this many consecutive 429s (global), fall through even mid-retry. */
const SUSTAINED_429_FALLBACK = 3;

async function acquireSlot(signal?: AbortSignal): Promise<void> {
  await waitForCooldown(signal);
  if (signal?.aborted) return;
  if (activeCount < MAX_CONCURRENCY) {
    activeCount += 1;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  await waitForCooldown(signal);
  activeCount += 1;
}

function releaseSlot(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}

async function configuredPlatforms(preferred?: Platform): Promise<Platform[]> {
  const all = preferred
    ? [preferred, ...PLATFORM_ORDER.filter((p) => p !== preferred)]
    : [...PLATFORM_ORDER];
  const ready: Platform[] = [];
  for (const p of all) {
    if (await isPlatformReady(p)) ready.push(p);
  }
  return ready;
}

function toUserError(e: unknown): { message: string; kind?: ErrorKind; retryAfterMs?: number } {
  if (e instanceof ProviderError) {
    return {
      message: e.userMessage || e.message,
      kind: e.kind,
      retryAfterMs: e.retryAfterMs,
    };
  }
  if (e instanceof Error) return { message: e.message };
  return { message: String(e) };
}

export async function translateText(
  req: TranslateRequest,
  signal?: AbortSignal
): Promise<TranslateResult> {
  const settings = await getSettings();
  const platforms = await configuredPlatforms(req.preferredPlatform);

  if (platforms.length === 0) {
    return {
      ok: false,
      error:
        "未配置可用平台。请填写 API Key（Gemini 也可 OAuth）；Cursor 还需兼容 Base URL（官方无第三方聊天 API）。",
      errorKind: "auth",
    };
  }

  const modelIds = platforms.map((p) => settings.platforms[p].modelId);
  const cacheKeyHint = `${req.text.slice(0, 80)}|${modelIds.join(",")}`;

  const existing = inflight.get(cacheKeyHint);
  if (existing) return existing;

  const task = (async (): Promise<TranslateResult> => {
    const cached = await getCachedAny(req.text, modelIds);
    if (cached) {
      return {
        ok: true,
        translation: cached.translation,
        platform: cached.platform,
        modelId: cached.modelId,
        fromCache: true,
      };
    }

    if (req.preferCacheOnly) {
      return { ok: false, error: "未缓存 / 缓存不足", fromCache: false };
    }

    await acquireSlot(signal);
    try {
      let lastError = "";
      let lastKind: ErrorKind | undefined;
      let fallbackNote: string | undefined;
      let previousLabel: string | undefined;
      let hadRateLimit = false;

      for (const platform of platforms) {
        if (signal?.aborted) return { ok: false, error: "已取消" };
        const cfg = settings.platforms[platform];
        const modelId = cfg.modelId;

        const hit = await getCached(req.text, modelId);
        if (hit) {
          return {
            ok: true,
            translation: hit.translation,
            platform: hit.platform,
            modelId: hit.modelId,
            fromCache: true,
            fallbackNote,
          };
        }

        let platformFailed = false;
        for (let attempt = 0; attempt < MAX_RETRIES_PER_PLATFORM; attempt++) {
          if (signal?.aborted) return { ok: false, error: "已取消" };
          await waitForCooldown(signal);

          try {
            const result = await callProvider(platform, {
              apiKey: cfg.apiKey.trim(),
              modelId,
              text: req.text,
              targetLang: req.targetLang ?? TARGET_LANG,
              signal,
            });

            noteRequestSuccess();

            await putCache({
              text: req.text,
              translation: result.translation,
              platform,
              modelId: result.modelId,
            });

            await recordSuccess({
              platform,
              modelId: result.modelId,
              mode: req.mode,
              usage: result.usage,
              text: req.text,
              translation: result.translation,
            });

            if (previousLabel) {
              fallbackNote = `已从 ${previousLabel} 切换到 ${PLATFORM_LABELS[platform]}，模型 ${result.modelId}`;
            }

            return {
              ok: true,
              translation: result.translation,
              platform,
              modelId: result.modelId,
              fromCache: false,
              usage: result.usage,
              fallbackNote,
              estimated: result.usage?.estimated,
            };
          } catch (e) {
            const { message, kind, retryAfterMs } = toUserError(e);
            lastError = message;
            lastKind = kind;
            await recordFailure({
              platform,
              modelId,
              mode: req.mode,
              error: message,
            });

            const is429 =
              kind === "rate_limit" ||
              kind === "quota" ||
              (e instanceof ProviderError && e.status === 429);

            if (is429) {
              hadRateLimit = true;
              const pause = noteRateLimited(retryAfterMs);
              console.warn(
                `[沉浸式翻译] ${PLATFORM_LABELS[platform]} 限流/配额，全局暂停 ${Math.round(pause / 1000)}s`,
                { kind, attempt: attempt + 1, consecutive: getConsecutive429() }
              );

              if (getConsecutive429() >= SUSTAINED_429_FALLBACK) {
                previousLabel = `${PLATFORM_LABELS[platform]}（${modelId}）`;
                resetConsecutive429();
                platformFailed = true;
                break;
              }

              if (attempt < MAX_RETRIES_PER_PLATFORM - 1) {
                continue;
              }
              previousLabel = `${PLATFORM_LABELS[platform]}（${modelId}）`;
              platformFailed = true;
              break;
            }

            // Non-429: fall through to next platform immediately
            previousLabel = `${PLATFORM_LABELS[platform]}（${modelId}）`;
            platformFailed = true;
            break;
          }
        }

        if (!platformFailed) break;
      }

      const triedFallback = Boolean(previousLabel);
      let finalMsg =
        lastKind === "quota"
          ? lastError || "配额不足，请检查 Google AI 账单/套餐后重试"
          : lastKind === "rate_limit"
            ? lastError || "请求过于频繁，已降速重试"
            : lastError || "所有平台均翻译失败";
      if (triedFallback && (lastKind === "quota" || lastKind === "rate_limit")) {
        finalMsg = `${finalMsg}（已尝试备用平台）`;
      }

      return {
        ok: false,
        error: finalMsg,
        errorKind: lastKind,
        fallbackNote,
        stopQueue: hadRateLimit ? true : undefined,
      };
    } finally {
      releaseSlot();
    }
  })();

  inflight.set(cacheKeyHint, task);
  try {
    return await task;
  } finally {
    inflight.delete(cacheKeyHint);
  }
}

export async function translateBatch(
  items: Array<{ id: string; text: string; preferCacheOnly?: boolean }>,
  mode: TranslateMode,
  signal?: AbortSignal
): Promise<Array<{ id: string; result: TranslateResult }>> {
  const out: Array<{ id: string; result: TranslateResult }> = [];
  const queue = [...items];
  const workerCount = Math.min(MAX_CONCURRENCY, Math.max(1, queue.length));
  let stopAll = false;

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length && !signal?.aborted && !stopAll) {
      await waitForCooldown(signal);
      if (stopAll || signal?.aborted) break;
      const item = queue.shift();
      if (!item) break;
      const result = await translateText(
        {
          text: item.text,
          mode,
          preferCacheOnly: item.preferCacheOnly,
        },
        signal
      );
      out.push({ id: item.id, result });
      if (result.stopQueue && !result.ok) {
        stopAll = true;
        // Drain remaining as cancelled so content can stop cleanly
        while (queue.length) {
          const left = queue.shift()!;
          out.push({
            id: left.id,
            result: {
              ok: false,
              error: result.error || "队列已暂停（限流/配额）",
              errorKind: result.errorKind,
              stopQueue: true,
            },
          });
        }
        break;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
