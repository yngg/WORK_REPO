import { getSettings } from "../shared/storage";
import {
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
import { recordFailure, recordSuccess } from "./usage";

const inflight = new Map<string, Promise<TranslateResult>>();
let activeCount = 0;
const MAX_CONCURRENCY = 3;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENCY) {
    activeCount += 1;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
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

    await acquireSlot();
    try {
      let lastError = "";
      let fallbackNote: string | undefined;
      let previousLabel: string | undefined;

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

        try {
          const result = await callProvider(platform, {
            apiKey: cfg.apiKey.trim(),
            modelId,
            text: req.text,
            targetLang: req.targetLang ?? TARGET_LANG,
            signal,
          });

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
          const msg =
            e instanceof ProviderError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          lastError = msg;
          await recordFailure({
            platform,
            modelId,
            mode: req.mode,
            error: msg,
          });
          previousLabel = `${PLATFORM_LABELS[platform]}（${modelId}）`;
        }
      }

      return {
        ok: false,
        error: lastError || "所有平台均翻译失败",
        fallbackNote,
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
  const workers = Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, async () => {
    while (queue.length && !signal?.aborted) {
      const item = queue.shift()!;
      const result = await translateText(
        {
          text: item.text,
          mode,
          preferCacheOnly: item.preferCacheOnly,
        },
        signal
      );
      out.push({ id: item.id, result });
    }
  });
  await Promise.all(workers);
  return out;
}
