import { app } from "electron";
import { serverEntry as helperServerEntry, mcpEntry as helperMcpEntry } from "./paths.impl.js";

interface PathEnv {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}

function pathEnv(): PathEnv {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  };
}

export function isDev(): boolean {
  return !app.isPackaged;
}

export function serverEntry(): string {
  return helperServerEntry(pathEnv());
}

export function mcpEntry(): string {
  return helperMcpEntry(pathEnv());
}

export function configDir(): string {
  return app.getPath("userData");
}
