import { build } from "vite";
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(dist, { recursive: true });

async function buildIife(entry, fileName) {
  await build({
    configFile: false,
    root,
    resolve: { alias: { "@": resolve(root, "src") } },
    build: {
      outDir: dist,
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry: resolve(root, entry),
        name: `imt_${fileName.replace(/\.js$/, "")}`,
        formats: ["iife"],
        fileName: () => fileName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: fileName,
        },
      },
    },
    logLevel: "warn",
  });
}

await buildIife("src/background/service-worker.ts", "background.js");
await buildIife("src/content/index.ts", "content.js");
await buildIife("src/popup/popup.ts", "popup.js");
await buildIife("src/options/options.ts", "options.js");

mkdirSync(resolve(dist, "icons"), { recursive: true });
mkdirSync(resolve(dist, "_locales/zh_CN"), { recursive: true });
for (const name of ["icon16.png", "icon48.png", "icon128.png"]) {
  copyFileSync(resolve(root, "icons", name), resolve(dist, "icons", name));
}
copyFileSync(
  resolve(root, "_locales/zh_CN/messages.json"),
  resolve(dist, "_locales/zh_CN/messages.json")
);
copyFileSync(resolve(root, "src/content/content.css"), resolve(dist, "content.css"));
copyFileSync(resolve(root, "src/popup/popup.css"), resolve(dist, "popup.css"));
copyFileSync(resolve(root, "src/options/options.css"), resolve(dist, "options.css"));

const popupHtml = readFileSync(resolve(root, "src/popup/index.html"), "utf-8").replace(
  '<script type="module" src="./popup.ts"></script>',
  '<script src="./popup.js"></script>'
);
const optionsHtml = readFileSync(resolve(root, "src/options/index.html"), "utf-8").replace(
  '<script type="module" src="./options.ts"></script>',
  '<script src="./options.js"></script>'
);
writeFileSync(resolve(dist, "popup.html"), popupHtml);
writeFileSync(resolve(dist, "options.html"), optionsHtml);

const manifest = {
  manifest_version: 3,
  name: "沉浸式翻译",
  description: "网页段落双语对照 + 弹窗手动翻译（Gemini / Cursor / Grok / OpenAI）",
  version: "1.0.1",
  default_locale: "zh_CN",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_popup: "popup.html",
    default_title: "沉浸式翻译",
    default_icon: { "16": "icons/icon16.png", "48": "icons/icon48.png" },
  },
  options_ui: { page: "options.html", open_in_tab: true },
  background: { service_worker: "background.js" },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "activeTab", "scripting", "tabs", "identity"],
  host_permissions: [
    "https://generativelanguage.googleapis.com/*",
    "https://api.x.ai/*",
    "https://api.openai.com/*",
    "https://api.cursor.com/*",
    "https://accounts.google.com/*",
    "https://oauth2.googleapis.com/*",
    "https://www.googleapis.com/*",
  ],
};
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("[build]", readdirSync(dist).join(", "));
execSync("node scripts/pack.mjs", { cwd: root, stdio: "inherit" });
