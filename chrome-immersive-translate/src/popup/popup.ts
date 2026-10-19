import { sendMessage } from "../shared/messaging";
import {
  DEFAULT_MODELS,
  type Platform,
  type Settings,
  type TabState,
  type TranslateResult,
} from "../shared/types";

const onlineToggle = document.getElementById("online-toggle") as HTMLInputElement;
const offlineToggle = document.getElementById("offline-toggle") as HTMLInputElement;
const platformSelect = document.getElementById("platform") as HTMLSelectElement;
const modelIdEl = document.getElementById("model-id") as HTMLElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const translateBtn = document.getElementById("translate-btn") as HTMLButtonElement;
const resultEl = document.getElementById("result") as HTMLElement;
const resultCache = document.getElementById("result-cache") as HTMLElement;
const fallbackNote = document.getElementById("fallback-note") as HTMLElement;
const errorEl = document.getElementById("error") as HTMLElement;
const openOptions = document.getElementById("open-options") as HTMLAnchorElement;

let settings: Settings | null = null;
let tabId: number | null = null;

async function main(): Promise<void> {
  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const settingsResp = await sendMessage<Settings>({ type: "GET_SETTINGS" });
  if (settingsResp.ok && settingsResp.data) {
    settings = settingsResp.data;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  if (tabId != null) {
    const stateResp = await sendMessage<TabState>({
      type: "GET_TAB_STATE",
      payload: { tabId },
    });
    if (stateResp.ok && stateResp.data) {
      onlineToggle.checked = stateResp.data.onlineEnabled;
      offlineToggle.checked = stateResp.data.offlinePrefetchEnabled;
    }
  }

  updateModelLabel();
  platformSelect.addEventListener("change", updateModelLabel);

  onlineToggle.addEventListener("change", () => void setTabFlags());
  offlineToggle.addEventListener("change", () => void setTabFlags());
  translateBtn.addEventListener("click", () => void runTranslate());
}

function updateModelLabel(): void {
  const p = platformSelect.value as Platform;
  const id = settings?.platforms[p]?.modelId ?? DEFAULT_MODELS[p];
  modelIdEl.textContent = id;
}

function renderResult(translation: string, modelId?: string): void {
  resultEl.replaceChildren();
  const text = document.createElement("span");
  text.className = "result-text";
  text.textContent = translation;
  resultEl.appendChild(text);
  if (modelId) {
    const mark = document.createElement("sup");
    mark.className = "result-model-footnote";
    mark.textContent = modelId;
    mark.title = `模型 ${modelId}`;
    resultEl.appendChild(mark);
  }
}

async function setTabFlags(): Promise<void> {
  if (tabId == null) return;
  await sendMessage({
    type: "SET_TAB_STATE",
    payload: {
      tabId,
      onlineEnabled: onlineToggle.checked,
      offlinePrefetchEnabled: offlineToggle.checked,
    },
  });
}

async function runTranslate(): Promise<void> {
  const text = input.value.trim();
  errorEl.classList.add("hidden");
  fallbackNote.classList.add("hidden");
  resultCache.classList.add("hidden");
  if (!text) {
    errorEl.textContent = "请输入文本";
    errorEl.classList.remove("hidden");
    return;
  }

  translateBtn.disabled = true;
  translateBtn.textContent = "翻译中…";
  resultEl.replaceChildren();

  try {
    const preferredPlatform = platformSelect.value as Platform;
    const resp = await sendMessage<TranslateResult>({
      type: "TRANSLATE",
      payload: {
        text,
        mode: "manual",
        preferredPlatform,
      },
    });

    const data = resp.data;
    if (!resp.ok || !data?.ok) {
      errorEl.textContent = data?.error || resp.error || "翻译失败";
      errorEl.classList.remove("hidden");
      if (data?.fallbackNote) {
        fallbackNote.textContent = data.fallbackNote;
        fallbackNote.classList.remove("hidden");
      }
      if (data?.modelId) renderResult("", data.modelId);
      return;
    }

    renderResult(data.translation ?? "", data.modelId);
    if (data.fromCache) resultCache.classList.remove("hidden");
    if (data.fallbackNote) {
      fallbackNote.textContent = data.fallbackNote;
      fallbackNote.classList.remove("hidden");
    }
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = "翻译";
  }
}

void main();
