import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "demo"),
  base: process.env.VITE_BASE_PATH ?? "/fulltext-rss-reader/",
  plugins: [react()],
  build: {
    outDir: path.join(root, "demo-dist"),
    emptyOutDir: true,
  },
});