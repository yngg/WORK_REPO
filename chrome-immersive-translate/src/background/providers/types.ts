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

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = true) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
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
