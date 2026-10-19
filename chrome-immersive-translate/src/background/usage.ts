import { estimateTokens } from "../shared/hash";
import { appendUsage, getUsageRecords } from "../shared/storage";
import type {
  Platform,
  TranslateMode,
  UsageRecord,
  UsageSummary,
  UsageTokens,
} from "../shared/types";

export type { UsageSummary };

export async function recordSuccess(args: {
  platform: Platform;
  modelId: string;
  mode: TranslateMode;
  usage?: UsageTokens;
  text: string;
  translation: string;
}): Promise<UsageRecord> {
  const estimated = !args.usage?.totalTokens && !args.usage?.promptTokens;
  let tokens = 0;
  if (args.usage?.totalTokens) {
    tokens = args.usage.totalTokens;
  } else if (args.usage?.promptTokens || args.usage?.completionTokens) {
    tokens = (args.usage.promptTokens ?? 0) + (args.usage.completionTokens ?? 0);
  } else {
    tokens = estimateTokens(args.text) + estimateTokens(args.translation);
  }

  const record: UsageRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    platform: args.platform,
    modelId: args.modelId,
    mode: args.mode,
    success: true,
    tokens: Math.max(1, tokens),
    estimated: estimated || !!args.usage?.estimated,
  };
  await appendUsage(record);
  return record;
}

export async function recordFailure(args: {
  platform: Platform;
  modelId: string;
  mode: TranslateMode;
  error: string;
}): Promise<UsageRecord> {
  const record: UsageRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    platform: args.platform,
    modelId: args.modelId,
    mode: args.mode,
    success: false,
    tokens: 0,
    estimated: false,
    error: args.error,
  };
  await appendUsage(record);
  return record;
}

export async function summarizeUsage(days = 14): Promise<UsageSummary> {
  const records = await getUsageRecords();
  const cutoff = Date.now() - days * 86400000;
  const recent = records.filter((r) => r.ts >= cutoff);

  const byPlatform = {
    gemini: emptyPlat(),
    cursor: emptyPlat(),
    grok: emptyPlat(),
    openai: emptyPlat(),
  } as UsageSummary["byPlatform"];

  const dailyMap = new Map<string, { tokens: number; count: number }>();

  for (const r of recent) {
    const p = byPlatform[r.platform];
    if (r.success) {
      p.successCount += 1;
      p.tokens += r.tokens;
      if (r.estimated) p.estimatedTokens += r.tokens;
      if (!p.models[r.modelId]) p.models[r.modelId] = { tokens: 0, count: 0 };
      p.models[r.modelId].tokens += r.tokens;
      p.models[r.modelId].count += 1;
    } else {
      p.failCount += 1;
    }
    const day = new Date(r.ts).toISOString().slice(0, 10);
    const d = dailyMap.get(day) ?? { tokens: 0, count: 0 };
    if (r.success) {
      d.tokens += r.tokens;
      d.count += 1;
    }
    dailyMap.set(day, d);
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { byPlatform, recent: recent.slice(-100).reverse(), daily };
}

function emptyPlat() {
  return {
    successCount: 0,
    failCount: 0,
    tokens: 0,
    estimatedTokens: 0,
    models: {} as Record<string, { tokens: number; count: number }>,
  };
}
