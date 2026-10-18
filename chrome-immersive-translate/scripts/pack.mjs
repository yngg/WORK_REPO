import { existsSync, rmSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const zipName = "immersive-translate-v1.zip";
const zipPath = resolve(dist, zipName);
const rootZip = resolve(root, zipName);

if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json missing — run build first");
  process.exit(1);
}

if (existsSync(zipPath)) rmSync(zipPath);
if (existsSync(rootZip)) rmSync(rootZip);

execSync(`cd "${dist}" && zip -r "${zipName}" . -x "*.map" -x "${zipName}"`, {
  stdio: "inherit",
});
cpSync(zipPath, rootZip);
console.log(`Packed: ${zipPath}`);
console.log(`Also: ${rootZip}`);
