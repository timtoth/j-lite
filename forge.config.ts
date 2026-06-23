import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      "./server.js",
      "./routes",
      "./lib",
      "./jira.js",
      "./config.js",
      "./logger.js",
      "./mcp",
    ],
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
    new MakerDeb({ options: { license: "MIT" } }),
    new MakerRpm({ options: { license: "MIT" } }),
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
