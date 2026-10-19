/**
 * Chrome MV3 extension self-test against spec §7 (mock API keys).
 * Uses a seeded Chrome profile + CDP (more reliable than --load-extension alone).
 */
import { createServer } from "node:http";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  cpSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const mediaDir = "/cursor/stores/self/media";
const profileDir = resolve(root, ".chrome-profile-selftest");
const results = [];
const EXT_ID = "kmjkpcmnidgbpcmcoablnpjbolnadbao"; // deterministic for path /workspace/.../dist

function record(id, pass, note = "") {
  results.push({ id, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${note ? " — " + note : ""}`);
}

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Selftest Article</title>
<style>
nav{background:#eee;padding:8px} aside{float:right;width:160px;background:#f8f8f8}
.ad{color:#999} article{max-width:640px;margin:20px} p{line-height:1.6}
</style></head><body>
<nav class="menu"><a href="#">Home</a> | <a href="#">Markets</a></nav>
<aside class="sidebar"><div class="ad sponsor">Buy ads here now</div><p>Related links only</p></aside>
<article class="article-body">
<h1>SemiAnalysis Style Earnings Call Notes</h1>
<p>The company reported strong sequential growth in data center GPUs during the latest quarter, with hyperscale demand remaining resilient despite macro uncertainty.</p>
<p>Management guided for continued capital expenditure from cloud providers and highlighted custom ASIC competition as a medium-term risk to margins.</p>
<p>Investors should watch inventory levels and export control updates that may affect shipment timing into China and other restricted markets.</p>
</article>
<footer>Copyright footer nav links</footer>
</body></html>`;

async function startFixtureServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(FIXTURE_HTML);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

function seedProfile() {
  if (existsSync(profileDir)) rmSync(profileDir, { recursive: true });
  mkdirSync(resolve(profileDir, "Default"), { recursive: true });
  // Prefer copying a known-good Preferences shell if present
  const donor = "/tmp/chrome-manual-load/Default/Preferences";
  let prefs = {
    extensions: {
      ui: { developer_mode: true },
      settings: {},
    },
  };
  if (existsSync(donor)) {
    prefs = JSON.parse(readFileSync(donor, "utf-8"));
  }
  prefs.extensions = prefs.extensions || {};
  prefs.extensions.ui = { ...(prefs.extensions.ui || {}), developer_mode: true };
  prefs.extensions.settings = prefs.extensions.settings || {};
  prefs.extensions.settings[EXT_ID] = {
    account_extension_type: 0,
    active_permissions: {
      api: ["activeTab", "scripting", "storage"],
      explicit_host: [
        "https://api.openai.com/*",
        "https://api.x.ai/*",
        "https://generativelanguage.googleapis.com/*",
      ],
      manifest_permissions: [],
      scriptable_host: ["http://*/*", "https://*/*"],
    },
    commands: {},
    content_settings: [],
    creation_flags: 1,
    disable_reasons: [],
    from_webstore: false,
    granted_permissions: {
      api: ["activeTab", "scripting", "storage"],
      explicit_host: [
        "https://api.openai.com/*",
        "https://api.x.ai/*",
        "https://generativelanguage.googleapis.com/*",
      ],
      manifest_permissions: [],
      scriptable_host: ["http://*/*", "https://*/*"],
    },
    location: 4,
    path: dist,
    was_installed_by_default: false,
    was_installed_by_oem: false,
    withholding_permissions: false,
  };
  writeFileSync(resolve(profileDir, "Default/Preferences"), JSON.stringify(prefs));
}

async function waitForCDP(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("CDP not ready");
}

async function main() {
  if (!existsSync(resolve(dist, "manifest.json"))) {
    throw new Error("dist/ missing — run npm run build first");
  }
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync("/cursor/stores/self/internal", { recursive: true });
  seedProfile();

  const { server, url } = await startFixtureServer();
  const port = 9340;
  const chrome = spawn(
    "google-chrome",
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: "ignore", env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" } }
  );

  let browser;
  try {
    await waitForCDP(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] || (await browser.newContext());

    // Find service worker target via CDP list
    let swUrl = "";
    let extId = EXT_ID;
    for (let i = 0; i < 30; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const sw = list.find(
        (t) => t.type === "service_worker" && t.url?.includes("chrome-extension://") && t.url.includes("background.js")
      );
      if (sw) {
        swUrl = sw.url;
        extId = swUrl.split("/")[2];
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!swUrl) {
      // Fallback: open extension page to wake SW
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(`chrome-extension://${EXT_ID}/popup.html`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const sw = list.find((t) => t.type === "service_worker" && String(t.url).includes("background.js"));
      if (sw) {
        swUrl = sw.url;
        extId = swUrl.split("/")[2];
      }
    }
    console.log("Extension ID:", extId, "SW:", swUrl || "(missing)");
    record("F9", !!swUrl, swUrl ? `loaded ${extId}` : "service worker not found");

    // Use Playwright service worker handle if available
    let sw = context.serviceWorkers().find((w) => w.url().includes(extId));
    if (!sw && swUrl) {
      // attach via wait
      for (let i = 0; i < 10 && !sw; i++) {
        sw = context.serviceWorkers().find((w) => w.url().includes("background.js"));
        if (!sw) await new Promise((r) => setTimeout(r, 300));
      }
    }

    async function swEval(fn, arg) {
      if (sw) return sw.evaluate(fn, arg);
      // CDP Runtime.evaluate on SW target
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === "service_worker" && t.url?.includes(extId));
      if (!target?.webSocketDebuggerUrl) throw new Error("No SW websocket");
      const { default: WebSocket } = await import("ws");
      return new Promise((resolvePromise, reject) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        let id = 0;
        ws.on("open", () => {
          const expr = `(${fn.toString()})(${arg !== undefined ? JSON.stringify(arg) : ""})`;
          ws.send(
            JSON.stringify({
              id: ++id,
              method: "Runtime.evaluate",
              params: { expression: expr, awaitPromise: true, returnByValue: true },
            })
          );
        });
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data));
          if (msg.id) {
            ws.close();
            if (msg.result?.exceptionDetails) {
              reject(new Error(msg.result.exceptionDetails.text || "SW eval failed"));
            } else {
              resolvePromise(msg.result?.result?.value);
            }
          }
        });
        ws.on("error", reject);
      });
    }

    if (!swUrl) {
      throw new Error("Extension service worker failed to start");
    }

    await swEval(async () => {
      const settings = {
        platforms: {
          gemini: { apiKey: "mock", modelId: "gemini-3.8-flash", enabled: true },
          grok: { apiKey: "mock", modelId: "grok-2-latest", enabled: true },
          openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
        },
        cacheLimitMb: 50,
        onlineTranslateDefault: false,
      };
      await chrome.storage.local.set({ imt_settings: settings, imt_usage: [] });
      const all = await chrome.storage.local.get(null);
      const remove = Object.keys(all).filter(
        (k) => k.startsWith("imt_ce_") || k === "imt_cache_index" || k.startsWith("imt_tab_")
      );
      if (remove.length) await chrome.storage.local.remove(remove);
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const injectedOff = await page.evaluate(
      () => document.querySelectorAll("[data-imt-translation]").length
    );
    record("F1", injectedOff === 0, `injected=${injectedOff}`);

    const tabId = await swEval(async (pageUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.startsWith(pageUrl));
      if (!tab?.id) throw new Error("tab not found: " + tabs.map((t) => t.url).join(","));
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SET_TAB_STATE",
            payload: { tabId: tab.id, onlineEnabled: true, offlinePrefetchEnabled: false },
          },
          () => resolve(null)
        );
      });
      return tab.id;
    }, url);

    const t0 = Date.now();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-imt-translation]").length >= 1,
      { timeout: 8000 }
    );
    const firstVisibleMs = Date.now() - t0;
    const injectedOn = await page.evaluate(
      () => document.querySelectorAll("[data-imt-translation]").length
    );
    const navTranslated = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      const next = nav?.nextElementSibling;
      return next?.hasAttribute?.("data-imt-translation") === true;
    });
    record(
      "F2",
      injectedOn >= 2 && !navTranslated,
      `injected=${injectedOn}, firstMs=${firstVisibleMs}`
    );
    record("P1", firstVisibleMs < 3000, `firstVisibleMs=${firstVisibleMs}`);
    await page.screenshot({ path: resolve(mediaDir, "f2-bilingual.png"), fullPage: true });

    const usageBefore = await swEval(async () => {
      const raw = await chrome.storage.local.get("imt_usage");
      return (raw.imt_usage || []).filter((r) => r.success).length;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const usageAfterScroll = await swEval(async () => {
      const raw = await chrome.storage.local.get("imt_usage");
      return (raw.imt_usage || []).filter((r) => r.success).length;
    });
    record(
      "F3",
      usageAfterScroll === usageBefore,
      `usageBefore=${usageBefore}, afterScroll=${usageAfterScroll}`
    );
    record("P2", usageAfterScroll === usageBefore, "cache revisit");

    const manual = await swEval(async () => {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "TRANSLATE",
            payload: {
              text: "Hello world, this is a test sentence for manual translation.",
              mode: "manual",
              preferredPlatform: "gemini",
            },
          },
          resolve
        );
      });
    });
    record(
      "F5",
      !!(manual?.ok && manual?.data?.translation && manual?.data?.modelId === "gemini-3.8-flash"),
      `model=${manual?.data?.modelId}`
    );

    await swEval(async () => {
      await chrome.storage.local.set({
        imt_settings: {
          platforms: {
            gemini: { apiKey: "mock:429", modelId: "gemini-3.8-flash", enabled: true },
            grok: { apiKey: "mock", modelId: "grok-2-latest", enabled: true },
            openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
          },
          cacheLimitMb: 50,
          onlineTranslateDefault: false,
        },
      });
    });
    const fb = await swEval(async () => {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "TRANSLATE",
            payload: {
              text: "Unique fallback sentence that should not be cached previously XYZ123.",
              mode: "manual",
              preferredPlatform: "gemini",
            },
          },
          resolve
        );
      });
    });
    record(
      "F6",
      !!(fb?.data?.ok && fb?.data?.platform === "grok" && fb?.data?.fallbackNote),
      `platform=${fb?.data?.platform}, note=${fb?.data?.fallbackNote || fb?.error || ""}`
    );

    await swEval(async (id) => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SET_TAB_STATE",
            payload: { tabId: id, onlineEnabled: false, offlinePrefetchEnabled: false },
          },
          () => resolve(null)
        );
      });
    }, tabId);
    await page.waitForTimeout(600);
    const afterOff = await page.evaluate(
      () => document.querySelectorAll("[data-imt-translation],[data-imt-placeholder]").length
    );
    record("F7", afterOff === 0, `remaining=${afterOff}`);

    await swEval(async () => {
      await chrome.storage.local.set({
        imt_settings: {
          platforms: {
            gemini: { apiKey: "mock", modelId: "gemini-3.8-flash", enabled: true },
            grok: { apiKey: "", modelId: "grok-2-latest", enabled: true },
            openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
          },
          cacheLimitMb: 50,
          onlineTranslateDefault: false,
        },
      });
    });
    await swEval(async (id) => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SET_TAB_STATE",
            payload: { tabId: id, onlineEnabled: false, offlinePrefetchEnabled: true },
          },
          () => resolve(null)
        );
      });
    }, tabId);
    await page.waitForFunction(
      () => document.querySelectorAll("[data-imt-translation]").length >= 1,
      { timeout: 8000 }
    );
    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(800);
    const cachedStill = await page.evaluate(
      () => document.querySelectorAll("[data-imt-translation]").length
    );
    const placeholders = await page.evaluate(
      () => document.querySelectorAll("[data-imt-placeholder]").length
    );
    record(
      "F4",
      cachedStill >= 1,
      `cached=${cachedStill}, placeholders=${placeholders}`
    );
    await page.screenshot({ path: resolve(mediaDir, "f4-offline.png"), fullPage: true });
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    const usage = await swEval(async () => {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_USAGE", payload: { days: 14 } }, resolve);
      });
    });
    const hasAny =
      (usage?.data?.byPlatform?.gemini?.successCount || 0) +
        (usage?.data?.byPlatform?.grok?.successCount || 0) >
      0;
    record("F8", !!(usage?.ok && hasAny), JSON.stringify(usage?.data?.byPlatform));

    // P4 toggle
    for (const on of [true, false, true]) {
      await swEval(
        async ({ id, on }) => {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: "SET_TAB_STATE",
                payload: {
                  tabId: id,
                  onlineEnabled: on,
                  offlinePrefetchEnabled: false,
                },
              },
              () => resolve(null)
            );
          });
        },
        { id: tabId, on }
      );
      await page.waitForTimeout(700);
    }
    const dup = await page.evaluate(() => {
      let bad = 0;
      document.querySelectorAll("[data-imt-id]").forEach((el) => {
        let n = el.nextElementSibling;
        let count = 0;
        while (n?.hasAttribute?.("data-imt-translation")) {
          count++;
          n = n.nextElementSibling;
        }
        if (count > 1) bad++;
      });
      return bad;
    });
    record("P4", dup === 0, `duplicateStacks=${dup}`);

    const popup = await context.newPage();
    const popupNav = await popup.goto(`chrome-extension://${extId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    const popupOk = popupNav && popupNav.ok();
    if (popupOk) {
      await popup.waitForSelector("#translate-btn");
      await popup.screenshot({ path: resolve(mediaDir, "popup.png") });
    }
    record("UI-popup", !!popupOk, popupOk ? "ok" : `status=${popupNav?.status()}`);

    const options = await context.newPage();
    const optNav = await options.goto(`chrome-extension://${extId}/options.html`, {
      waitUntil: "domcontentloaded",
    });
    const optOk = optNav && optNav.ok();
    if (optOk) {
      await options.waitForSelector("#save");
      await options.screenshot({ path: resolve(mediaDir, "options.png") });
    }
    record("UI-options", !!optOk, optOk ? "ok" : `status=${optNav?.status()}`);
  } finally {
    await browser?.close().catch(() => {});
    chrome.kill("SIGKILL");
    server.close();
  }

  const passCount = results.filter((r) => r.pass).length;
  const md = `---
cursor:
  subagentId: "bc-0fde7f54-57da-56ce-a115-4121b173ee3a"
---

# v1 Self-test (§7)

**Date**: ${new Date().toISOString()}
**Environment**: Chrome + CDP, mock API keys (\`mock\` / \`mock:429\`)
**Extension dist**: \`/workspace/chrome-immersive-translate/dist\`

## Results

| ID | Pass | Note |
|----|------|------|
${results.map((r) => `| ${r.id} | ${r.pass ? "✅" : "❌"} | ${String(r.note).replace(/\|/g, "/")} |`).join("\n")}

**Score**: ${passCount}/${results.length}

## Notes

- Live Gemini/Grok/OpenAI calls not exercised (no real API keys). Mock path covers routing, cache, fallback, UI.
- P3 (10-article memory soak) not run in this automated pass.
- Screenshots: \`/cursor/stores/self/media/\`
`;

  writeFileSync("/cursor/stores/self/internal/v1-selftest.md", md);
  console.log(`\nWrote selftest report. ${passCount}/${results.length} passed.`);
  if (passCount < results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    "/cursor/stores/self/internal/v1-selftest.md",
    `---
cursor:
  subagentId: "bc-0fde7f54-57da-56ce-a115-4121b173ee3a"
---

# v1 Self-test FAILED TO RUN

\`\`\`
${e?.stack || e}
\`\`\`
`
  );
  process.exit(1);
});
