/** FNV-1a style hash for cache keys (fast, non-crypto). */
export async function hashCacheKey(
  text: string,
  sourceStrategy: string,
  targetLang: string,
  modelId: string
): Promise<string> {
  const normalized = normalizeText(text);
  const payload = `${normalized}\0${sourceStrategy}\0${targetLang}\0${modelId}`;
  if (globalThis.crypto?.subtle) {
    const buf = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40);
  }
  // Fallback
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function estimateTokens(text: string): number {
  // Rough: ~4 chars per token for mixed CJK/Latin
  return Math.max(1, Math.ceil(text.length / 4));
}

export function byteSize(str: string): number {
  return new TextEncoder().encode(str).length;
}
