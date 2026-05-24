import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // Resolve .ts before .js so `./paths` picks up the Electron-runtime
    // wrapper (paths.ts) instead of the pure-JS helper (paths.js).
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
  build: {
    rollupOptions: {
      external: ["electron"],
    },
  },
});
