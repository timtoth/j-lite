import { app } from "electron";
const helper = require("./paths.js");

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
  return helper.serverEntry(pathEnv());
}

export function mcpEntry(): string {
  return helper.mcpEntry(pathEnv());
}

export function configDir(): string {
  return app.getPath("userData");
}
