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

export const TRANSLATE_SYSTEM = `你是专业翻译。将用户给出的文本翻译成简体中文。
规则：
1. 只输出译文，不要解释、不加前后缀。
2. 保留专有名词、数字、代码、URL 原样或按惯例音译。
3. 源语言自动识别；若已是中文则原样返回。`;
