/** Global API cooldown — pauses the whole translate queue on 429. */

let cooldownUntil = 0;
let consecutive429 = 0;

export function getCooldownRemaining(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

export async function waitForCooldown(signal?: AbortSignal): Promise<void> {
  while (Date.now() < cooldownUntil) {
    if (signal?.aborted) return;
    const wait = Math.min(500, cooldownUntil - Date.now());
    await new Promise((r) => setTimeout(r, Math.max(50, wait)));
  }
}

/** Record a 429 and extend global pause (exponential + Retry-After). */
export function noteRateLimited(retryAfterMs?: number): number {
  consecutive429 += 1;
  const exp = Math.min(60_000, 1500 * 2 ** Math.min(consecutive429 - 1, 5));
  const pause = Math.max(exp, retryAfterMs ?? 0, 2000);
  cooldownUntil = Math.max(cooldownUntil, Date.now() + pause);
  return pause;
}

export function noteRequestSuccess(): void {
  consecutive429 = 0;
}

export function getConsecutive429(): number {
  return consecutive429;
}

/** Soft reset when falling back to another platform after sustained 429. */
export function resetConsecutive429(): void {
  consecutive429 = 0;
}
