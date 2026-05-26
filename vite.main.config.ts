import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // Resolve .ts before .js so `./paths` picks up the Electron-runtime
    // wrapper (paths.ts) instead of the pure-JS helper (paths.js).
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
  build: {
    commonjsOptions: {
      // Allow Rollup's CommonJS plugin to extract named exports from our
      // .impl.js source files (default include is node_modules only).
      include: [/node_modules/, /\.impl\.js$/],
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
