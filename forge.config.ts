import * as path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { bundleServerResources } from "./scripts/bundle-server.js";

// The server (routes/, lib/, jira.js, etc.) is unbundled CommonJS with npm
// dependencies (express, dotenv, @modelcontextprotocol/sdk). Packager's
// extraResource only copies files as-is — it never installs their
// node_modules — so the server.js/MCP entry points must be pre-bundled with
// esbuild before packaging, with their deps inlined, or the spawned server
// child crashes on first require() in the packaged app.
const serverBundleDir = path.resolve(__dirname, ".server-bundle");

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // extraResource copies each entry to resources/<basename(entry)>, so
    // these are listed individually (not as the bundle dir itself) to land
    // directly under resources/ where paths.impl.js expects them.
    extraResource: [
      path.join(serverBundleDir, "server.js"),
      path.join(serverBundleDir, "mcp"),
    ],
  },
  hooks: {
    prePackage: async () => {
      bundleServerResources(serverBundleDir);
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "jLite",
      exe: "jLite.exe",
      setupExe: "jLite-Setup.exe",
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({}),
    new MakerDeb({ options: { license: "MIT", bin: "jLite" } }),
    new MakerRpm({ options: { license: "MIT", bin: "jLite" } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "electron/main.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "electron/preload.ts", config: "vite.preload.config.ts", target: "preload" },
      ],
      renderer: [
        { name: "main_window", config: "client/vite.config.ts" },
      ],
    }),
  ],
};

export default config;
