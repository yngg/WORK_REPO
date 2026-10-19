/**
 * Self-test against Chrome with extension loaded (CDP).
 * CHROME_CDP=http://127.0.0.1:9351 node scripts/selftest-cdp.mjs
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const CDP = process.env.CHROME_CDP || "http://127.0.0.1:9351";
const EXT_ID = "kmjkpcmnidgbpcmcoablnpjbolnadbao";
const mediaDir = "/cursor/stores/self/media";
const results = [];

function record(id, pass, note = "") {
  results.push({ id, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${note ? " — " + note : ""}`);
}

const FIXTURE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Selftest</title>
<style>nav{background:#eee;padding:8px}aside{float:right;width:160px}.ad{color:#999}article{max-width:640px;margin:20px}</style>
</head><body>
<nav class="menu"><a href="#">Home</a></nav>
<aside class="sidebar"><div class="ad sponsor">Buy ads</div></aside>
<article class="article-body">
<h1>SemiAnalysis Style Earnings Call Notes</h1>
<p>The company reported strong sequential growth in data center GPUs during the latest quarter, with hyperscale demand remaining resilient despite macro uncertainty.</p>
<p>Management guided for continued capital expenditure from cloud providers and highlighted custom ASIC competition as a medium-term risk to margins.</p>
<p>Investors should watch inventory levels and export control updates that may affect shipment timing into China and other restricted markets.</p>
</article>
<footer>Copyright</footer>
</body></html>`;

async function extMsg(extPage, msg) {
  return extPage.evaluate(
    (m) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(m, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        });
      }),
    msg
  );
}

async function main() {
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync("/cursor/stores/self/internal", { recursive: true });

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];

  // Use options page as stable messaging host (popup closes on blur).
  const hub = await context.newPage();
  await hub.goto(`chrome-extension://${EXT_ID}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await hub.waitForSelector("#save");
  await hub.screenshot({ path: resolve(mediaDir, "options.png") });
  record("UI-options", true, "ok");
  record("F9", true, EXT_ID);

  const popupShot = await context.newPage();
  await popupShot.goto(`chrome-extension://${EXT_ID}/popup.html`, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await popupShot.waitForSelector("#translate-btn");
  await popupShot.screenshot({ path: resolve(mediaDir, "popup.png") });
  record("UI-popup", true, "ok");
  // Keep hub focused for subsequent messaging
  await hub.bringToFront();

  // Seed settings via extension page (not SW self-message)
  await extMsg(hub, {
    type: "SAVE_SETTINGS",
    payload: {
      platforms: {
        gemini: { apiKey: "mock", modelId: "gemini-2.5-flash", enabled: true },
        grok: { apiKey: "mock", modelId: "grok-2-latest", enabled: true },
        openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
      },
      cacheLimitMb: 50,
      onlineTranslateDefault: false,
    },
  });
  await extMsg(hub, { type: "CLEAR_CACHE" });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  const offCount = await page.evaluate(
    () => document.querySelectorAll("[data-imt-translation]").length
  );
  record("F1", offCount === 0, `injected=${offCount}`);

  // Resolve tab id from extension page
  const tabId = await hub.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url && t.url.startsWith(pageUrl));
    if (!tab?.id) throw new Error("tab not found");
    return tab.id;
  }, url);

  await extMsg(hub, {
    type: "SET_TAB_STATE",
    payload: { tabId, onlineEnabled: true, offlinePrefetchEnabled: false },
  });

  const t0 = Date.now();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-imt-translation]").length >= 1,
    { timeout: 8000 }
  );
  const firstMs = Date.now() - t0;
  const onCount = await page.evaluate(
    () => document.querySelectorAll("[data-imt-translation]").length
  );
  const navHit = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    return nav?.nextElementSibling?.hasAttribute?.("data-imt-translation") === true;
  });
  const zhCheck = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-imt-translation]")];
    const texts = nodes.map((n) => n.querySelector(".imt-translation-text")?.textContent || n.textContent || "");
    const footnotes = nodes.map((n) => n.querySelector(".imt-model-footnote")?.textContent || "");
    const joined = texts.join("\n");
    const hasZh = /[\u4e00-\u9fff]/.test(joined);
    const hasMockLabel = /模拟译文/.test(joined) || nodes.some((n) => /模拟译文/.test(n.textContent || ""));
    const allFootnotes = footnotes.every((f) => !!f);
    return { hasZh, hasMockLabel, allFootnotes, sample: texts[0]?.slice(0, 80), footnote: footnotes[0] };
  });
  record(
    "F2",
    onCount >= 2 && !navHit && zhCheck.hasZh && !zhCheck.hasMockLabel && zhCheck.allFootnotes,
    `injected=${onCount}, firstMs=${firstMs}, zh=${zhCheck.hasZh}, mockLabel=${zhCheck.hasMockLabel}, footnote=${zhCheck.footnote}, sample=${zhCheck.sample}`
  );
  record("P1", firstMs < 3000, `firstVisibleMs=${firstMs}`);
  record("ZH", zhCheck.hasZh && !zhCheck.hasMockLabel, `sample=${zhCheck.sample}`);
  record("FOOTNOTE", zhCheck.allFootnotes, `model=${zhCheck.footnote}`);
  await page.screenshot({ path: resolve(mediaDir, "f2-bilingual.png"), fullPage: true });

  const usageBefore = await hub.evaluate(async () => {
    const raw = await chrome.storage.local.get("imt_usage");
    return (raw.imt_usage || []).filter((r) => r.success).length;
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const usageAfter = await hub.evaluate(async () => {
    const raw = await chrome.storage.local.get("imt_usage");
    return (raw.imt_usage || []).filter((r) => r.success).length;
  });
  record("F3", usageAfter === usageBefore, `before=${usageBefore}, after=${usageAfter}`);
  record("P2", usageAfter === usageBefore, "cache");

  const manual = await extMsg(hub, {
    type: "TRANSLATE",
    payload: {
      text: "Hello world, this is a test sentence for manual translation.",
      mode: "manual",
      preferredPlatform: "gemini",
    },
  });
  const manualZh = /[\u4e00-\u9fff]/.test(manual?.data?.translation || "");
  const manualNoLabel = !/模拟译文/.test(manual?.data?.translation || "");
  record(
    "F5",
    !!(
      manual?.ok &&
      manual?.data?.modelId === "gemini-2.5-flash" &&
      manual?.data?.translation &&
      manualZh &&
      manualNoLabel
    ),
    `model=${manual?.data?.modelId}, zh=${manualZh}, text=${String(manual?.data?.translation || "").slice(0, 60)}`
  );

  await extMsg(hub, {
    type: "SAVE_SETTINGS",
    payload: {
      platforms: {
        gemini: { apiKey: "mock:429", modelId: "gemini-2.5-flash", enabled: true },
        grok: { apiKey: "mock", modelId: "grok-2-latest", enabled: true },
        openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
      },
      cacheLimitMb: 50,
      onlineTranslateDefault: false,
    },
  });
  const fb = await extMsg(hub, {
    type: "TRANSLATE",
    payload: {
      text: "Unique fallback sentence XYZ999 not cached before.",
      mode: "manual",
      preferredPlatform: "gemini",
    },
  });
  record(
    "F6",
    !!(fb?.data?.ok && fb?.data?.platform === "grok" && fb?.data?.fallbackNote),
    `platform=${fb?.data?.platform} note=${fb?.data?.fallbackNote || fb?.error || ""}`
  );

  await extMsg(hub, {
    type: "SET_TAB_STATE",
    payload: { tabId, onlineEnabled: false, offlinePrefetchEnabled: false },
  });
  await page.waitForTimeout(700);
  const cleared = await page.evaluate(
    () => document.querySelectorAll("[data-imt-translation],[data-imt-placeholder]").length
  );
  record("F7", cleared === 0, `remaining=${cleared}`);

  await extMsg(hub, {
    type: "SAVE_SETTINGS",
    payload: {
      platforms: {
        gemini: { apiKey: "mock", modelId: "gemini-2.5-flash", enabled: true },
        grok: { apiKey: "", modelId: "grok-2-latest", enabled: true },
        openai: { apiKey: "", modelId: "gpt-4o", enabled: true },
      },
      cacheLimitMb: 50,
      onlineTranslateDefault: false,
    },
  });
  await extMsg(hub, {
    type: "SET_TAB_STATE",
    payload: { tabId, onlineEnabled: false, offlinePrefetchEnabled: true },
  });
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
  const cached = await page.evaluate(
    () => document.querySelectorAll("[data-imt-translation]").length
  );
  record("F4", cached >= 1, `cached=${cached}`);
  await page.screenshot({ path: resolve(mediaDir, "f4-offline.png"), fullPage: true });
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  const usage = await extMsg(hub, { type: "GET_USAGE", payload: { days: 14 } });
  const total =
    (usage?.data?.byPlatform?.gemini?.successCount || 0) +
    (usage?.data?.byPlatform?.grok?.successCount || 0);
  record("F8", total > 0, JSON.stringify(usage?.data?.byPlatform));

  for (const on of [true, false, true]) {
    await extMsg(hub, {
      type: "SET_TAB_STATE",
      payload: { tabId, onlineEnabled: on, offlinePrefetchEnabled: false },
    });
    await page.waitForTimeout(600);
  }
  const dup = await page.evaluate(() => {
    let bad = 0;
    document.querySelectorAll("[data-imt-id]").forEach((el) => {
      let n = el.nextElementSibling;
      let c = 0;
      while (n?.hasAttribute?.("data-imt-translation")) {
        c++;
        n = n.nextElementSibling;
      }
      if (c > 1) bad++;
    });
    return bad;
  });
  record("P4", dup === 0, `dups=${dup}`);

  try {
    const cu = "/tmp/computer-use";
    if (existsSync(cu)) {
      for (const f of readdirSync(cu).filter((x) => x.endsWith(".webp")).slice(-3)) {
        copyFileSync(resolve(cu, f), resolve(mediaDir, `chrome-ui-${f}`));
      }
    }
  } catch {
    /* ignore */
  }

  server.close();

  const pass = results.filter((r) => r.pass).length;
  writeFileSync(
    "/cursor/stores/self/internal/v1-selftest.md",
    `---
cursor:
  subagentId: "bc-0fde7f54-57da-56ce-a115-4121b173ee3a"
---

# v1 Self-test (§7)

**Date**: ${new Date().toISOString()}
**Environment**: Chrome CDP \`${CDP}\`, mock keys (\`mock\` / \`mock:429\`)
**Extension**: \`${EXT_ID}\` · \`/workspace/chrome-immersive-translate/dist\`

## Results

| ID | Pass | Note |
|----|------|------|
${results.map((r) => `| ${r.id} | ${r.pass ? "✅" : "❌"} | ${String(r.note).replace(/\|/g, "/")} |`).join("\n")}

**Score**: ${pass}/${results.length}

## Notes

- Live Gemini/Grok/OpenAI not called (no real keys). Mock provider covers routing, cache, fallback, UI.
- P3 (10-article memory soak) not automated.
- Media: \`/cursor/stores/self/media/\`
`
  );
  console.log(`\n${pass}/${results.length} passed`);
  if (pass < results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    "/cursor/stores/self/internal/v1-selftest.md",
    `---
cursor:
  subagentId: "bc-0fde7f54-57da-56ce-a115-4121b173ee3a"
---

# v1 Self-test FAILED

\`\`\`
${e?.stack || e}
\`\`\`
`
  );
  process.exit(1);
});
