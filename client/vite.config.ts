import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Forge's Vite plugin runs the renderer from the repo root, but our React
// deps live in client/node_modules. Pin root to this config file's directory
// so Vite resolves modules relative to client/. Forge expects the renderer
// build output at <repoRoot>/.vite/renderer/<name>/, so we override outDir
// to an absolute path under the repo root rather than letting it resolve
// relative to our renamed `root`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig(({ mode }) => ({
  root: here,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir:
      mode === "production"
        ? resolve(repoRoot, ".vite/renderer/main_window")
        : resolve(here, "dist"),
    emptyOutDir: true,
  },
}));
