/** Retained for tooling; production build uses scripts/build.mjs */
import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
