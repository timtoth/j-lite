import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as fs from "node:fs";
import { findFreePort } from "./free-port";
import { buildServerSpawn } from "./spawn-args";
import { registerMcpIfNeeded } from "./mcp-register";
import { serverEntry, mcpEntry, configDir, isDev } from "./paths";
import { IPC } from "./types";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let serverChild: ChildProcess | null = null;
let serverPort: number | null = null;
let mainWindow: BrowserWindow | null = null;
let logStream: fs.WriteStream | null = null;

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function waitForServer(port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/settings/status`;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error("not ready"));
        });
        req.on("error", reject);
        req.setTimeout(1000, () => req.destroy(new Error("timeout")));
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Server did not become ready within timeout");
}

async function startServer(): Promise<number> {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });

  const port = await findFreePort();
  const { command, args, opts } = buildServerSpawn({
    serverEntry: serverEntry(),
    port,
    configDir: dir,
    parentEnv: process.env,
  });
  serverChild = spawn(command, args, opts);

  const logPath = path.join(dir, "app.log");
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  logStream = fs.createWriteStream(logPath, { flags: "a" });
  serverChild.stdout?.pipe(logStream);
  serverChild.stderr?.pipe(logStream);

  serverChild.on("exit", (code) => {
    serverChild = null;
    if (code !== 0 && mainWindow) {
      const tail = readLogTail(logPath, 50);
      dialog
        .showMessageBox(mainWindow, {
          type: "error",
          title: "ticket-control",
          message: "Server stopped unexpectedly.",
          detail: tail,
          buttons: ["Restart", "Quit"],
          defaultId: 0,
        })
        .then((result) => {
          if (result.response === 0) restartServer();
          else app.quit();
        });
    }
  });

  await waitForServer(port);
  return port;
}

function readLogTail(p: string, lines: number): string {
  if (!fs.existsSync(p)) return "(no log)";
  const contents = fs.readFileSync(p, "utf8");
  const all = contents.split("\n");
  return all.slice(-lines).join("\n");
}

async function restartServer(): Promise<void> {
  try {
    serverPort = await startServer();
    if (mainWindow) loadWindow(mainWindow);
  } catch (err) {
    if (mainWindow) {
      dialog.showErrorBox(
        "ticket-control",
        `Failed to restart server: ${(err as Error).message}`
      );
    }
  }
}

function loadWindow(win: BrowserWindow): void {
  if (isDev() && typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else if (serverPort !== null) {
    win.loadURL(`http://127.0.0.1:${serverPort}/`);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  loadWindow(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle(IPC.PICK_FOLDER, async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(IPC.GET_SERVER_PORT, () => {
  return serverPort ?? 0;
});

app.whenReady().then(async () => {
  try {
    serverPort = await startServer();
  } catch (err) {
    dialog.showErrorBox(
      "ticket-control",
      `Failed to start server: ${(err as Error).message}`
    );
    app.quit();
    return;
  }

  createWindow();

  registerMcpIfNeeded({
    mcpEntry: mcpEntry(),
    configDir: configDir(),
    spawn,
  }).catch(() => {
    // non-fatal
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (!serverChild) return;
  event.preventDefault();
  const child = serverChild;
  serverChild = null;
  child.kill("SIGTERM");
  const killed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!killed) child.kill("SIGKILL");
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  app.exit(0);
});
