import { byteSize, hashCacheKey } from "../shared/hash";
import { DEFAULT_CACHE_MB, TARGET_LANG, type CacheEntry, type Platform } from "../shared/types";

const INDEX_KEY = "imt_cache_index";
const ENTRY_PREFIX = "imt_ce_";

interface CacheIndex {
  keys: string[];
  totalBytes: number;
  limitBytes: number;
}

async function getIndex(): Promise<CacheIndex> {
  const raw = await chrome.storage.local.get(INDEX_KEY);
  const idx = raw[INDEX_KEY] as CacheIndex | undefined;
  return (
    idx ?? {
      keys: [],
      totalBytes: 0,
      limitBytes: DEFAULT_CACHE_MB * 1024 * 1024,
    }
  );
}

async function saveIndex(idx: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: idx });
}

function entryStorageKey(key: string): string {
  return ENTRY_PREFIX + key;
}

export async function setCacheLimitMb(mb: number): Promise<void> {
  const idx = await getIndex();
  idx.limitBytes = Math.max(1, mb) * 1024 * 1024;
  await saveIndex(idx);
  await evictIfNeeded(idx);
}

export async function makeCacheKey(
  text: string,
  modelId: string
): Promise<string> {
  return hashCacheKey(text, "auto", TARGET_LANG, modelId);
}

export async function getCached(
  text: string,
  modelId: string
): Promise<CacheEntry | null> {
  const key = await makeCacheKey(text, modelId);
  const sk = entryStorageKey(key);
  const raw = await chrome.storage.local.get(sk);
  const entry = raw[sk] as CacheEntry | undefined;
  if (!entry) return null;
  entry.lastAccess = Date.now();
  await chrome.storage.local.set({ [sk]: entry });
  // Move to end of LRU
  const idx = await getIndex();
  idx.keys = idx.keys.filter((k) => k !== key);
  idx.keys.push(key);
  await saveIndex(idx);
  return entry;
}

/** Try cache across a list of model IDs (for routing hit before any request). */
export async function getCachedAny(
  text: string,
  modelIds: string[]
): Promise<CacheEntry | null> {
  for (const modelId of modelIds) {
    const hit = await getCached(text, modelId);
    if (hit) return hit;
  }
  return null;
}

export async function putCache(args: {
  text: string;
  translation: string;
  platform: Platform;
  modelId: string;
}): Promise<CacheEntry> {
  const key = await makeCacheKey(args.text, args.modelId);
  const now = Date.now();
  const entry: CacheEntry = {
    key,
    text: args.text,
    translation: args.translation,
    platform: args.platform,
    modelId: args.modelId,
    createdAt: now,
    lastAccess: now,
    sizeBytes: byteSize(args.text) + byteSize(args.translation) + 128,
  };

  const idx = await getIndex();
  const sk = entryStorageKey(key);
  const existing = (await chrome.storage.local.get(sk))[sk] as CacheEntry | undefined;
  if (existing) {
    idx.totalBytes -= existing.sizeBytes;
    idx.keys = idx.keys.filter((k) => k !== key);
  }

  idx.keys.push(key);
  idx.totalBytes += entry.sizeBytes;
  await chrome.storage.local.set({ [sk]: entry });
  await saveIndex(idx);
  await evictIfNeeded(idx);
  return entry;
}

async function evictIfNeeded(idx: CacheIndex): Promise<void> {
  while (idx.totalBytes > idx.limitBytes && idx.keys.length > 0) {
    const oldest = idx.keys.shift()!;
    const sk = entryStorageKey(oldest);
    const raw = await chrome.storage.local.get(sk);
    const entry = raw[sk] as CacheEntry | undefined;
    if (entry) {
      idx.totalBytes -= entry.sizeBytes;
      await chrome.storage.local.remove(sk);
    }
  }
  await saveIndex(idx);
}

export async function clearCache(): Promise<void> {
  const idx = await getIndex();
  const removes = idx.keys.map(entryStorageKey);
  removes.push(INDEX_KEY);
  // chrome.storage.local.remove accepts array
  for (let i = 0; i < removes.length; i += 50) {
    await chrome.storage.local.remove(removes.slice(i, i + 50));
  }
  await saveIndex({
    keys: [],
    totalBytes: 0,
    limitBytes: idx.limitBytes,
  });
}

export async function getCacheStats(): Promise<{
  entryCount: number;
  totalBytes: number;
  limitBytes: number;
  limitMb: number;
}> {
  const idx = await getIndex();
  return {
    entryCount: idx.keys.length,
    totalBytes: idx.totalBytes,
    limitBytes: idx.limitBytes,
    limitMb: Math.round(idx.limitBytes / (1024 * 1024)),
  };
}
