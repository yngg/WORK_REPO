import type { Platform, UsageTokens } from "../../shared/types";

export interface ProviderCallArgs {
  apiKey: string;
  modelId: string;
  text: string;
  targetLang: string;
  signal?: AbortSignal;
}

export interface ProviderCallResult {
  translation: string;
  usage?: UsageTokens;
  modelId: string;
  platform: Platform;
}

export type ErrorKind = "rate_limit" | "quota" | "auth" | "not_found" | "other";

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  kind: ErrorKind;
  retryAfterMs?: number;
  /** Short Chinese message for UI toast */
  userMessage: string;

  constructor(
    message: string,
    status?: number,
    retryable = true,
    opts?: { kind?: ErrorKind; retryAfterMs?: number; userMessage?: string }
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.kind = opts?.kind ?? "other";
    this.retryAfterMs = opts?.retryAfterMs;
    this.userMessage = opts?.userMessage ?? message;
  }
}

/** Target language is always Simplified Chinese. Never echo English source. */
export const TRANSLATE_SYSTEM = `你是专业中文翻译引擎。把用户给出的文本翻译成【简体中文】。

硬性规则：
1. 输出必须是简体中文译文。禁止用英文复述、摘要或回显原文。
2. 只输出译文正文，不要解释、不要标题、不要前后缀标签（如「译文：」「Translation:」）。
3. 专有名词、产品名、代码、URL、邮箱可按惯例保留或音译；数字与单位保留。
4. 自动识别源语言；若原文已是简体中文，则原样返回（仍不要改成英文）。
5. 保持段落语气与信息完整，不要漏译关键句。`;

export const TRANSLATE_USER_PREFIX =
  "请将下列文本翻译成简体中文，只输出中文译文：\n\n";

export function parseRetryAfterMs(res: Response, body: string): number | undefined {
  const h = res.headers.get("retry-after");
  if (h) {
    const sec = Number(h);
    if (!Number.isNaN(sec) && sec >= 0) return Math.min(120_000, sec * 1000);
    const when = Date.parse(h);
    if (!Number.isNaN(when)) return Math.max(0, Math.min(120_000, when - Date.now()));
  }
  const m = body.match(/retryDelay["\s:]*"?(\d+)s/i) || body.match(/Retry in (\d+)/i);
  if (m) return Math.min(120_000, Number(m[1]) * 1000);
  return undefined;
}

export function classifyHttpError(
  platform: string,
  status: number,
  body: string,
  retryAfterMs?: number
): { kind: ErrorKind; userMessage: string; retryable: boolean } {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      userMessage: `${platform} 鉴权失败，请检查 API Key / 登录状态`,
      retryable: false,
    };
  }
  if (status === 404 || /no longer available/i.test(body)) {
    return {
      kind: "not_found",
      userMessage: `${platform} 模型不可用，请在设置中刷新模型列表`,
      retryable: true,
    };
  }
  if (status === 429 || status === 402) {
    const isQuota =
      /quota|billing|plan|exceeded your current quota|daily|limit: 0/i.test(body) &&
      !/rate.?limit|too many requests|resource.?exhausted/i.test(lower)
        ? true
        : /quota exceeded|free_tier|generate_requests_per_day|exceeded your current quota/i.test(
            body
          );
    // Gemini often says "exceeded your current quota" for both RPM and daily — prefer rate_limit if retry-after short
    const kind: ErrorKind =
      isQuota && !(retryAfterMs != null && retryAfterMs < 30_000) ? "quota" : "rate_limit";
    if (kind === "quota") {
      return {
        kind,
        userMessage: `${platform} 配额不足，请检查 Google AI 账单/套餐或稍后再试`,
        retryable: true,
      };
    }
    return {
      kind: "rate_limit",
      userMessage: `${platform} 请求过于频繁，已降速重试`,
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      kind: "other",
      userMessage: `${platform} 服务暂时不可用（${status}）`,
      retryable: true,
    };
  }
  return {
    kind: "other",
    userMessage: `${platform} 请求失败（${status}）`,
    retryable: status === 429 || status >= 500,
  };
}
