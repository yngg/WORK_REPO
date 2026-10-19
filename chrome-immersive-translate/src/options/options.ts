import { sendMessage } from "../shared/messaging";
import { PLATFORM_META } from "../shared/platform-meta";
import {
  PLATFORM_LABELS,
  PLATFORM_ORDER,
  type ModelInfo,
  type Platform,
  type Settings,
  type UsageSummary,
} from "../shared/types";

const PLATFORMS = PLATFORM_ORDER;

async function main(): Promise<void> {
  const redirectHint = document.getElementById("oauth-redirect-hint");
  if (redirectHint) {
    redirectHint.textContent = `https://${chrome.runtime.id}.chromiumapp.org/`;
  }

  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`);
    if (!root) continue;
    const apiNote = root.querySelector('[data-note="api"]');
    const oauthNote = root.querySelector('[data-note="oauth"]');
    if (apiNote) apiNote.textContent = PLATFORM_META[p].apiKeyNoteZh;
    if (oauthNote) oauthNote.textContent = PLATFORM_META[p].oauthNoteZh;
  }

  const settingsResp = await sendMessage<Settings>({ type: "GET_SETTINGS" });
  if (!settingsResp.ok || !settingsResp.data) {
    alert(settingsResp.error || "无法加载设置");
    return;
  }
  fillForm(settingsResp.data);
  await refreshAuthStatus();
  await refreshCacheStats();
  await refreshUsage();

  // Auto-refresh model lists for authenticated platforms
  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`)!;
    const key = (root.querySelector('[data-field="apiKey"]') as HTMLInputElement).value.trim();
    if (key || p === "gemini") {
      await refreshModels(p, false);
    }
  }

  document.getElementById("save")!.addEventListener("click", () => void save());
  document.getElementById("clear-cache")!.addEventListener("click", () => void clearCache());

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = (btn as HTMLElement).dataset.action;
      const platform = (btn.closest(".platform") as HTMLElement | null)?.dataset
        .platform as Platform | undefined;
      if (!platform) return;
      if (action === "refresh-models") void refreshModels(platform, true);
      if (action === "oauth-login") void oauthLogin(platform);
      if (action === "oauth-logout") void oauthLogout(platform);
    });
  });
}

function fillForm(settings: Settings): void {
  (document.getElementById("google-oauth-client-id") as HTMLInputElement).value =
    settings.googleOAuthClientId || "";
  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`);
    if (!root) continue;
    const cfg = settings.platforms[p];
    (root.querySelector('[data-field="apiKey"]') as HTMLInputElement).value = cfg.apiKey;
    (root.querySelector('[data-field="enabled"]') as HTMLInputElement).checked = cfg.enabled;
    const baseUrl = root.querySelector('[data-field="baseUrl"]') as HTMLInputElement | null;
    if (baseUrl) baseUrl.value = cfg.baseUrl || "";
    const select = root.querySelector('[data-field="modelId"]') as HTMLSelectElement;
    // seed single option until refresh
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = cfg.modelId;
    opt.textContent = cfg.modelId || "（未选择）";
    select.appendChild(opt);
    select.value = cfg.modelId;
    select.disabled = true;
  }
  (document.getElementById("cache-limit") as HTMLInputElement).value = String(
    settings.cacheLimitMb
  );
}

function readForm(): Settings {
  const platforms = {} as Settings["platforms"];
  for (const p of PLATFORMS) {
    const root = document.querySelector(`.platform[data-platform="${p}"]`)!;
    const baseUrlEl = root.querySelector('[data-field="baseUrl"]') as HTMLInputElement | null;
    platforms[p] = {
      apiKey: (root.querySelector('[data-field="apiKey"]') as HTMLInputElement).value.trim(),
      modelId: (root.querySelector('[data-field="modelId"]') as HTMLSelectElement).value.trim(),
      enabled: (root.querySelector('[data-field="enabled"]') as HTMLInputElement).checked,
      baseUrl: baseUrlEl ? baseUrlEl.value.trim() : undefined,
      authMode: "apikey",
    };
  }
  return {
    platforms,
    cacheLimitMb: Number((document.getElementById("cache-limit") as HTMLInputElement).value) || 50,
    onlineTranslateDefault: false,
    googleOAuthClientId: (
      document.getElementById("google-oauth-client-id") as HTMLInputElement
    ).value.trim(),
  };
}

function populateModelSelect(
  platform: Platform,
  models: ModelInfo[],
  selectedId: string
): void {
  const root = document.querySelector(`.platform[data-platform="${platform}"]`)!;
  const select = root.querySelector('[data-field="modelId"]') as HTMLSelectElement;
  select.innerHTML = "";
  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "无可用模型";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.recommended ? `${m.displayName || m.id}（推荐）` : m.displayName || m.id;
    select.appendChild(opt);
  }
  select.value = selectedId && models.some((m) => m.id === selectedId) ? selectedId : models[0].id;
  select.disabled = false;
}

async function refreshModels(platform: Platform, interactive: boolean): Promise<void> {
  // Persist current key/baseUrl first so SW can call list APIs
  await sendMessage({ type: "SAVE_SETTINGS", payload: readForm() });
  const resp = await sendMessage<{
    models: ModelInfo[];
    selectedId: string;
    toast?: string;
    source: string;
  }>({ type: "LIST_MODELS", payload: { platform } });

  if (!resp.ok || !resp.data) {
    if (interactive) alert(resp.error || "刷新模型失败");
    const root = document.querySelector(`.platform[data-platform="${platform}"]`)!;
    const select = root.querySelector('[data-field="modelId"]') as HTMLSelectElement;
    select.disabled = true;
    return;
  }
  populateModelSelect(platform, resp.data.models, resp.data.selectedId);
  if (resp.data.toast) {
    const status = document.getElementById("save-status")!;
    status.textContent = resp.data.toast;
    setTimeout(() => {
      status.textContent = "";
    }, 4000);
  }
}

async function oauthLogin(platform: Platform): Promise<void> {
  if (platform !== "gemini") {
    alert("该平台不支持 OAuth");
    return;
  }
  await sendMessage({ type: "SAVE_SETTINGS", payload: readForm() });
  const resp = await sendMessage<{ email?: string }>({
    type: "OAUTH_LOGIN",
    payload: { platform },
  });
  if (!resp.ok) {
    alert(resp.error || "登录失败");
    return;
  }
  await refreshAuthStatus();
  await refreshModels(platform, true);
}

async function oauthLogout(platform: Platform): Promise<void> {
  await sendMessage({ type: "OAUTH_LOGOUT", payload: { platform } });
  await refreshAuthStatus();
}

async function refreshAuthStatus(): Promise<void> {
  const resp = await sendMessage<
    Record<Platform, { authenticated: boolean; email?: string; mode: string }>
  >({ type: "GET_AUTH_STATUS" });
  if (!resp.ok || !resp.data) return;
  for (const p of PLATFORMS) {
    const el = document.querySelector(
      `.platform[data-platform="${p}"] [data-auth-status]`
    ) as HTMLElement | null;
    if (!el) continue;
    const s = resp.data[p];
    el.textContent = s.authenticated
      ? s.email
        ? `已登录：${s.email}`
        : `已配置（${s.mode}）`
      : "未登录 / 未配置 Key";
  }
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
    await refreshAuthStatus();
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
    const s = resp.data.byPlatform[p] ?? {
      successCount: 0,
      failCount: 0,
      tokens: 0,
      estimatedTokens: 0,
      models: {},
    };
    const card = document.createElement("div");
    card.className = "board";
    const models =
      Object.entries(s.models)
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
