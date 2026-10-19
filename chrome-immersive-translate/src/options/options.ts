import { sendMessage } from "../shared/messaging";
import {
  PLATFORM_LABELS,
  type Platform,
  type Settings,
  type UsageSummary,
} from "../shared/types";

const PLATFORMS: Platform[] = ["gemini", "grok", "openai"];

async function main(): Promise<void> {
  const settingsResp = await sendMessage<Settings>({ type: "GET_SETTINGS" });
  if (!settingsResp.ok || !settingsResp.data) {
    alert(settingsResp.error || "无法加载设置");
    return;
  }
  const settings = settingsResp.data;
  fillForm(settings);
  await refreshCacheStats();
  await refreshUsage();

  document.getElementById("save")!.addEventListener("click", () => void save());
  document.getElementById("clear-cache")!.addEventListener("click", () => void clearCache());
}

function fillForm(settings: Settings): void {
  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`);
    if (!root) continue;
    const cfg = settings.platforms[p];
    (root.querySelector('[data-field="apiKey"]') as HTMLInputElement).value = cfg.apiKey;
    (root.querySelector('[data-field="modelId"]') as HTMLInputElement).value = cfg.modelId;
    (root.querySelector('[data-field="enabled"]') as HTMLInputElement).checked = cfg.enabled;
  }
  (document.getElementById("cache-limit") as HTMLInputElement).value = String(
    settings.cacheLimitMb
  );
}

function readForm(): Settings {
  const platforms = {} as Settings["platforms"];
  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`)!;
    platforms[p] = {
      apiKey: (root.querySelector('[data-field="apiKey"]') as HTMLInputElement).value.trim(),
      modelId: (root.querySelector('[data-field="modelId"]') as HTMLInputElement).value.trim(),
      enabled: (root.querySelector('[data-field="enabled"]') as HTMLInputElement).checked,
    };
  }
  return {
    platforms,
    cacheLimitMb: Number((document.getElementById("cache-limit") as HTMLInputElement).value) || 50,
    onlineTranslateDefault: false,
    googleOAuthClientId: "",
  };
}

async function save(): Promise<void> {
  const settings = readForm();
  const resp = await sendMessage({ type: "SAVE_SETTINGS", payload: settings });
  const status = document.getElementById("save-status")!;
  if (resp.ok) {
    status.textContent = "已保存";
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
    await refreshCacheStats();
  } else {
    status.textContent = resp.error || "保存失败";
  }
}

async function clearCache(): Promise<void> {
  if (!confirm("确定清空全部翻译缓存？")) return;
  await sendMessage({ type: "CLEAR_CACHE" });
  await refreshCacheStats();
}

async function refreshCacheStats(): Promise<void> {
  const resp = await sendMessage<{
    entryCount: number;
    totalBytes: number;
    limitMb: number;
  }>({ type: "GET_CACHE_STATS" });
  const el = document.getElementById("cache-stats")!;
  if (!resp.ok || !resp.data) {
    el.textContent = "无法读取缓存状态";
    return;
  }
  const mb = (resp.data.totalBytes / (1024 * 1024)).toFixed(2);
  el.textContent = `已用 ${mb} MB / ${resp.data.limitMb} MB · ${resp.data.entryCount} 条`;
}

async function refreshUsage(): Promise<void> {
  const resp = await sendMessage<UsageSummary>({ type: "GET_USAGE", payload: { days: 14 } });
  const boards = document.getElementById("usage-boards")!;
  const daily = document.getElementById("usage-daily")!;
  if (!resp.ok || !resp.data) {
    boards.textContent = "无法加载用量";
    return;
  }

  boards.innerHTML = "";
  for (const p of PLATFORMS) {
    const s = resp.data.byPlatform[p];
    const card = document.createElement("div");
    card.className = "board";
    const models = Object.entries(s.models)
      .map(([id, m]) => `${id}（${m.count} 次 / ${m.tokens} tokens）`)
      .join("<br>") || "暂无";
    card.innerHTML = `
      <h4>${PLATFORM_LABELS[p]}</h4>
      <div class="metric">成功 <strong>${s.successCount}</strong> · 失败 <strong>${s.failCount}</strong></div>
      <div class="metric">Tokens <strong>${s.tokens}</strong>${s.estimatedTokens ? `（含估算 ${s.estimatedTokens}）` : ""}</div>
      <div class="metric">模型明细<br>${models}</div>
    `;
    boards.appendChild(card);
  }

  if (!resp.data.daily.length) {
    daily.textContent = "近 14 日暂无数据";
  } else {
    daily.innerHTML = resp.data.daily
      .map(
        (d) =>
          `<div class="row"><span>${d.date}</span><span>${d.count} 次 · ${d.tokens} tokens</span></div>`
      )
      .join("");
  }
}

void main();
