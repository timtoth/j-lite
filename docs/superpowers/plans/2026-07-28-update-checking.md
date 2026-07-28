# Auto-Update Checking & Collapsible Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Check for Updates" flow to the Electron app — real restart-to-update on Windows via Electron's `autoUpdater`, notify-and-open-download-page on macOS/Linux via the GitHub Releases API — surfaced in a new "App Info" Settings section, and make all top-level Settings sections collapsible.

**Architecture:** Platform-branching logic lives in a new pure CommonJS module (`electron/update-checker.impl.js`, following the existing `.impl.js` convention used by `free-port.impl.js`/`spawn-args.impl.js`) so it's unit-testable via `node --test` without an Electron runtime. `electron/main.ts` wires five new IPC channels (`get-app-version`, `check-for-updates`, `restart-to-update`, `open-external`, plus a main→renderer push `update-status`) and Electron's `autoUpdater` events (Windows only). The renderer sees one unified contract regardless of platform: call `checkForUpdates()`, listen for `onUpdateStatus`, call `applyUpdate(status)` to act on the result. A new `AppInfoCard` component renders this. A new shared `SettingsSection` wrapper (reusing the `.collapsible`/`.collapsible__inner` CSS already shipped for `SpaceAccordion`) makes every top-level Settings card collapsible; `AppInfoCard` defaults open, the rest default closed.

**Tech Stack:** Electron 32 (`autoUpdater`, `shell.openExternal`), Node.js `fetch` (built-in, no new HTTP dependency), `node --test`, React + TypeScript (no client test runner — `tsc -b` via `npm run build --prefix client` is the verification step for TS changes).

## Global Constraints

- Manual-only checking — no periodic/background polling, no check-on-launch.
- macOS is treated like Linux (notify + open-link), not given real Squirrel.Mac auto-update — no code-signing in this repo.
- No `update-electron-app` npm package — it hides the manual-trigger hook and individual `autoUpdater` events this design needs. Use Electron's `autoUpdater` module directly.
- Windows feed URL format: `https://update.electronjs.org/<repo>/win32-x64/<version>` where `<repo>` is `timtoth/j-lite`.
- `.github/workflows/release.yml` must stop creating draft releases (`update.electronjs.org` cannot see drafts) — this is a prerequisite, not optional.
- Version comparison must be numeric per-segment (`"0.10.0" > "0.9.0"`), never plain string comparison.
- Browser-only dev (`npm run dev:web`, no `window.tc`) must degrade gracefully with no crash — same pattern as existing `window.tc?.pickFolder` checks in `client/src/api.ts`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `.github/workflows/release.yml` | Release automation | Remove `draft: true` |
| `electron/update-checker.impl.js` | Pure update-check logic | New — feed URL construction, GitHub API polling, version comparison |
| `electron/update-checker.ts` | Electron-runtime wrapper | New — thin re-export, mirrors `paths.ts`/`paths.impl.js` |
| `electron/update-checker.test.js` | Unit tests | New |
| `electron/types.ts` | Shared IPC contract | New channel constants, `UpdateStatus` type, extended `TcApi` |
| `electron/main.ts` | Electron main process | New IPC handlers, `autoUpdater` wiring (Windows), platform branch |
| `electron/preload.ts` | Renderer bridge | Expose `getAppVersion`/`checkForUpdates`/`applyUpdate`/`onUpdateStatus` |
| `client/src/global.d.ts` | Renderer-side type mirror | Redeclare `UpdateStatus`/`TcApi` additions |
| `client/src/components/settings/AppInfoCard.tsx` | App Info section UI | New |
| `client/src/components/settings/SettingsSection.tsx` | Shared collapsible wrapper | New |
| `client/src/components/SettingsView.tsx` | Settings page composition | Wrap cards in `SettingsSection`, add `AppInfoCard` first |
| `client/src/components/settings/SpaceAccordion.tsx` | Per-space accordion | Rename chevron class to shared name |
| `client/src/components/settings/ProjectCard.tsx` | Project section content | Strip own `<section>`/title markup — content only |
| `client/src/components/settings/JiraUserCard.tsx` | JIRA User section content | Strip own `<section>`/title markup — content only |
| `client/src/components/settings/JiraProjectCard.tsx` | JIRA Project section content | Strip own `<section>`/header markup; expose Discover button via callback prop |
| `client/src/App.css` | Styles | Rename chevron class; new `AppInfoCard` banner style |

---

## Task 1: Stop drafting releases

**Files:**
- Modify: `C:\GHSource\ticket-control\.github\workflows\release.yml`

**Why this works:** `update.electronjs.org` only serves updates from published GitHub Releases — it cannot see drafts. Every later task in this plan depends on releases being publicly visible the moment a tag is pushed.

- [ ] **Step 1.1: Remove `draft: true`**

Edit `C:\GHSource\ticket-control\.github\workflows\release.yml`. Find:

```yaml
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          draft: true
          generate_release_notes: true
```

Replace with:

```yaml
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

- [ ] **Step 1.2: Validate YAML syntax**

Run: `node -e "require('js-yaml') ? null : null" 2>&1; python3 -c "import yaml" 2>&1 || true`

If neither `js-yaml` nor `python3`+`pyyaml` is available, just visually re-read the file to confirm indentation is intact (the `with:` block's remaining two keys must still be indented exactly as they were, and no trailing blank line issues). There is no test suite for GitHub Actions workflow files in this repo, so this step is a careful manual read, not an automated check.

- [ ] **Step 1.3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish releases immediately instead of as drafts"
```

---

## Task 2: `update-checker.impl.js` — pure logic + unit tests

**Files:**
- Create: `C:\GHSource\ticket-control\electron\update-checker.impl.js`
- Create: `C:\GHSource\ticket-control\electron\update-checker.test.js`

**Why this works:** All the logic that doesn't require the Electron runtime — feed URL construction, semver-ish comparison, GitHub API response handling — lives in one pure CommonJS module, testable via `node --test` with no Electron dependency, following the exact pattern `free-port.impl.js` and `spawn-args.impl.js` already establish in this directory.

**Interfaces:**
- Produces: `windowsFeedUrl(repo, version)`, `compareVersions(a, b)`, `checkGithubLatestRelease(repo, currentVersion, fetchImpl)` — all exported via `module.exports`.
- Consumes: nothing beyond its own arguments; `checkGithubLatestRelease` takes an injected `fetchImpl` so it never makes a real network call under test.

- [ ] **Step 2.1: Write the failing tests**

Create `C:\GHSource\ticket-control\electron\update-checker.test.js`:

```javascript
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  windowsFeedUrl,
  compareVersions,
  checkGithubLatestRelease,
} = require("./update-checker.impl.js");

test("windowsFeedUrl builds the expected update.electronjs.org URL", () => {
  const url = windowsFeedUrl("timtoth/j-lite", "0.3.0");
  assert.equal(url, "https://update.electronjs.org/timtoth/j-lite/win32-x64/0.3.0");
});

test("compareVersions: lower vs higher returns negative", () => {
  assert.ok(compareVersions("0.3.0", "0.4.0") < 0);
});

test("compareVersions: equal versions returns zero", () => {
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
});

test("compareVersions: higher vs lower returns positive", () => {
  assert.ok(compareVersions("0.4.0", "0.3.0") > 0);
});

test("compareVersions: numeric segment comparison, not string comparison", () => {
  // "0.10.0" > "0.9.0" numerically, but "0.10.0" < "0.9.0" as plain strings.
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
});

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test("checkGithubLatestRelease: newer tag returns ready/open-link", async () => {
  const fetchImpl = fakeFetch(200, {
    tag_name: "v0.4.0",
    html_url: "https://github.com/timtoth/j-lite/releases/tag/v0.4.0",
  });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, {
    state: "ready",
    action: "open-link",
    version: "0.4.0",
    url: "https://github.com/timtoth/j-lite/releases/tag/v0.4.0",
  });
});

test("checkGithubLatestRelease: equal tag returns up-to-date", async () => {
  const fetchImpl = fakeFetch(200, { tag_name: "v0.3.0", html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, { state: "up-to-date" });
});

test("checkGithubLatestRelease: older tag returns up-to-date", async () => {
  const fetchImpl = fakeFetch(200, { tag_name: "v0.2.0", html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, { state: "up-to-date" });
});

test("checkGithubLatestRelease: non-2xx response returns error", async () => {
  const fetchImpl = fakeFetch(404, {});
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.equal(result.state, "error");
  assert.match(result.message, /404/);
});

test("checkGithubLatestRelease: missing tag_name returns error", async () => {
  const fetchImpl = fakeFetch(200, { html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.equal(result.state, "error");
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `node --test electron/update-checker.test.js`
Expected: FAIL — `Cannot find module './update-checker.impl.js'` (the file doesn't exist yet).

- [ ] **Step 2.3: Implement the module**

Create `C:\GHSource\ticket-control\electron\update-checker.impl.js`:

```javascript
function windowsFeedUrl(repo, version) {
  return `https://update.electronjs.org/${repo}/win32-x64/${version}`;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function checkGithubLatestRelease(repo, currentVersion, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) {
    return { state: "error", message: `GitHub API returned ${res.status}` };
  }
  const data = await res.json();
  const latest = String(data.tag_name || "").replace(/^v/, "");
  if (!latest) {
    return { state: "error", message: "Could not parse latest release tag" };
  }
  if (compareVersions(latest, currentVersion) > 0) {
    return { state: "ready", action: "open-link", version: latest, url: data.html_url };
  }
  return { state: "up-to-date" };
}

module.exports = { windowsFeedUrl, compareVersions, checkGithubLatestRelease };
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `node --test electron/update-checker.test.js`
Expected: PASS, all 10 tests.

- [ ] **Step 2.5: Commit**

```bash
git add electron/update-checker.impl.js electron/update-checker.test.js
git commit -m "feat(electron): add pure update-checker logic (feed URL, version compare, GitHub API poll)"
```

---

## Task 3: `update-checker.ts` wrapper + IPC/type contract + `preload.ts`

**Files:**
- Create: `C:\GHSource\ticket-control\electron\update-checker.ts`
- Modify: `C:\GHSource\ticket-control\electron\types.ts`
- Modify: `C:\GHSource\ticket-control\electron\preload.ts`

**Why this works:** `electron/types.ts` is the single source of truth for the IPC channel names and the `TcApi` shape that both `main.ts` and `preload.ts` import. `preload.ts` is `TcApi`'s only implementer — if this task extended the interface without updating `preload.ts` in the same commit, the tree would sit in a broken intermediate state where `tsc` fails because the extended interface no longer matches its (now incomplete) implementation. Both changes land together for exactly that reason. `update-checker.ts` is a thin `.ts` re-export of the pure `.impl.js` module — this repo's existing pattern (see `paths.ts` wrapping `paths.impl.js`) exists so `vite.main.config.ts`'s module resolution (`.ts` before `.js`) and Rollup's CommonJS-named-exports handling (`/\.impl\.js$/` include) both work correctly when `main.ts` imports it.

**Interfaces:**
- Produces: `IPC.GET_APP_VERSION`, `IPC.CHECK_FOR_UPDATES`, `IPC.RESTART_TO_UPDATE`, `IPC.OPEN_EXTERNAL`, `IPC.UPDATE_STATUS` (string constants). `UpdateStatus` type (discriminated union). Extended `TcApi` interface with `getAppVersion`, `checkForUpdates`, `applyUpdate`, `onUpdateStatus` — all four implemented in this same task. Re-exported `windowsFeedUrl`, `checkGithubLatestRelease` from `update-checker.ts` for `main.ts` to import (Task 4). `window.tc.getAppVersion`/`checkForUpdates`/`applyUpdate`/`onUpdateStatus` all callable from the renderer once Task 5 (`client/src/global.d.ts`) adds the matching type mirror.
- Consumes: `windowsFeedUrl`, `checkGithubLatestRelease` from `./update-checker.impl.js` (Task 2).

- [ ] **Step 3.1: Update `electron/types.ts`**

Edit `C:\GHSource\ticket-control\electron\types.ts`. Replace the entire file with:

```typescript
export const IPC = {
  PICK_FOLDER: "tc:pick-folder",
  GET_SERVER_PORT: "tc:get-server-port",
  GET_APP_VERSION: "tc:get-app-version",
  CHECK_FOR_UPDATES: "tc:check-for-updates",
  RESTART_TO_UPDATE: "tc:restart-to-update",
  OPEN_EXTERNAL: "tc:open-external",
  UPDATE_STATUS: "tc:update-status",
} as const;

export type UpdateStatus =
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "downloading" }
  | { state: "ready"; action: "restart" }
  | { state: "ready"; action: "open-link"; version: string; url: string }
  | { state: "error"; message: string };

export interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  applyUpdate: (status: UpdateStatus) => Promise<void>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => void;
}
```

- [ ] **Step 3.2: Create `electron/update-checker.ts`**

Create `C:\GHSource\ticket-control\electron\update-checker.ts`:

```typescript
export {
  windowsFeedUrl,
  compareVersions,
  checkGithubLatestRelease,
} from "./update-checker.impl.js";
```

- [ ] **Step 3.3: Update `electron/preload.ts`**

Read `C:\GHSource\ticket-control\electron\preload.ts` first to confirm its current exact contents (it should be 9 lines, unchanged since this plan started). Replace its entire contents with:

```typescript
import { contextBridge, ipcRenderer } from "electron";
import { IPC, TcApi, UpdateStatus } from "./types";

const api: TcApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),
  getServerPort: () => ipcRenderer.invoke(IPC.GET_SERVER_PORT),
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION),
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  applyUpdate: (status: UpdateStatus) => {
    if (status.state === "ready" && status.action === "restart") {
      return ipcRenderer.invoke(IPC.RESTART_TO_UPDATE);
    }
    if (status.state === "ready" && status.action === "open-link") {
      return ipcRenderer.invoke(IPC.OPEN_EXTERNAL, status.url);
    }
    return Promise.resolve();
  },
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_event, status: UpdateStatus) => cb(status));
  },
};

contextBridge.exposeInMainWorld("tc", api);
```

Note: `preload.ts` calls `ipcRenderer.invoke(IPC.RESTART_TO_UPDATE)`/`IPC.OPEN_EXTERNAL`/etc. — the actual `ipcMain.handle` handlers for these channels don't exist yet (that's Task 4). This is expected and fine: `ipcRenderer.invoke` on a channel with no registered handler simply rejects at call time, it does not fail to *compile* or fail at *preload-script-load* time. The typecheck in Step 3.4 and the manual smoke test in Step 3.5 both only exercise module loading, not actually invoking these channels — so this ordering (types+preload before main.ts's handlers) is safe.

- [ ] **Step 3.4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.electron.json`
Expected: no NEW errors introduced by this task's three files. There is one pre-existing error in this repo, unrelated to this plan — `electron/main.ts(9,29): error TS7016: Could not find a declaration file for module 'electron-squirrel-startup'` — confirm this is the *only* error reported (matching the baseline), not evidence this step is broken. If you see any error mentioning `update-checker.ts`, `types.ts`, or `preload.ts`, that's a real regression from this task's edits and must be fixed before committing.

- [ ] **Step 3.5: Manual smoke test**

Run: `npm start`
Expected: app opens with no console errors in the DevTools (press F12 once the window is open, per the existing dev-tools toggle in `main.ts`). This confirms `preload.ts` still loads without a syntax/type error. Close the app when done.

- [ ] **Step 3.6: Commit**

```bash
git add electron/types.ts electron/update-checker.ts electron/preload.ts
git commit -m "feat(electron): add update-check IPC contract, TS wrapper, and preload bridge"
```

---

## Task 4: Wire IPC handlers and `autoUpdater` into `electron/main.ts`

**Files:**
- Modify: `C:\GHSource\ticket-control\electron\main.ts`

**Why this works:** This is where platform branching actually happens. Windows gets real `autoUpdater` wiring (`setFeedURL` once at startup, `checkForUpdates()`/`quitAndInstall()` on demand, events pushed to the renderer as they fire). macOS/Linux instead call `checkGithubLatestRelease` (Task 2/3) on demand and push an equivalent-shaped status. Both branches converge on the same `UPDATE_STATUS` push channel so the renderer (Task 6) never needs to know which platform it's running on.

**Interfaces:**
- Consumes: `IPC`, `UpdateStatus` from `./types` (Task 3); `windowsFeedUrl`, `checkGithubLatestRelease` from `./update-checker` (Task 3).
- Produces: five working IPC handlers reachable from the renderer via `ipcRenderer.invoke`/`ipcRenderer.on` (`preload.ts` already wired them up in Task 3).

- [ ] **Step 4.1: Add imports**

Edit `C:\GHSource\ticket-control\electron\main.ts`. Find the top-of-file import block:

```typescript
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as fs from "node:fs";
```

Replace with:

```typescript
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, autoUpdater } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as fs from "node:fs";
```

Find:

```typescript
import { serverEntry, mcpEntry, configDir, isDev } from "./paths";
import { migrateUserData } from "./migrate-userdata.impl.js";
import { IPC } from "./types";
```

Replace with:

```typescript
import { serverEntry, mcpEntry, configDir, isDev } from "./paths";
import { migrateUserData } from "./migrate-userdata.impl.js";
import { IPC, UpdateStatus } from "./types";
import { windowsFeedUrl, checkGithubLatestRelease } from "./update-checker";
```

- [ ] **Step 4.2: Add the update-status push helper and repo constant**

Find:

```typescript
let serverChild: ChildProcess | null = null;
let serverPort: number | null = null;
let mainWindow: BrowserWindow | null = null;
let logStream: fs.WriteStream | null = null;
```

Replace with:

```typescript
let serverChild: ChildProcess | null = null;
let serverPort: number | null = null;
let mainWindow: BrowserWindow | null = null;
let logStream: fs.WriteStream | null = null;

const UPDATE_REPO = "timtoth/j-lite";

function pushUpdateStatus(status: UpdateStatus): void {
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, status);
}
```

- [ ] **Step 4.3: Wire `autoUpdater` events (Windows) at module load**

Find:

```typescript
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
```

Add immediately after it:

```typescript
if (process.platform === "win32") {
  autoUpdater.on("checking-for-update", () => pushUpdateStatus({ state: "checking" }));
  autoUpdater.on("update-not-available", () => pushUpdateStatus({ state: "up-to-date" }));
  autoUpdater.on("update-available", () => pushUpdateStatus({ state: "downloading" }));
  autoUpdater.on("update-downloaded", () =>
    pushUpdateStatus({ state: "ready", action: "restart" })
  );
  autoUpdater.on("error", (err) =>
    pushUpdateStatus({ state: "error", message: err.message })
  );
}
```

- [ ] **Step 4.4: Set the feed URL once the app is ready (Windows only)**

Find, inside `app.whenReady().then(async () => {`:

```typescript
  try {
    serverPort = await startServer();
  } catch (err) {
```

Add immediately before that `try` block, still inside the same `app.whenReady().then(async () => {` callback:

```typescript
  if (process.platform === "win32") {
    autoUpdater.setFeedURL({ url: windowsFeedUrl(UPDATE_REPO, app.getVersion()) });
  }

  try {
    serverPort = await startServer();
  } catch (err) {
```

- [ ] **Step 4.5: Add the five IPC handlers**

Find:

```typescript
ipcMain.handle(IPC.GET_SERVER_PORT, () => {
  return serverPort ?? 0;
});
```

Add immediately after it:

```typescript
ipcMain.handle(IPC.GET_APP_VERSION, () => {
  return app.getVersion();
});

ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
  if (process.platform === "win32") {
    autoUpdater.checkForUpdates();
    return;
  }
  pushUpdateStatus({ state: "checking" });
  const result = await checkGithubLatestRelease(UPDATE_REPO, app.getVersion(), fetch);
  pushUpdateStatus(result as UpdateStatus);
});

ipcMain.handle(IPC.RESTART_TO_UPDATE, () => {
  if (process.platform === "win32") {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: string) => {
  shell.openExternal(url);
});
```

- [ ] **Step 4.6: Run existing electron test suite to check for regressions**

Run: `node --test electron/`
Expected: PASS, all pre-existing tests (`free-port.test.js`, `mcp-register.test.js`, `migrate-userdata.test.js`, `paths.test.js`, `spawn-args.test.js`) plus Task 2's `update-checker.test.js`. This step confirms nothing in this task's edits broke pure-logic tests that don't touch `main.ts` directly (they don't import it), but it's a cheap sanity check before moving on.

- [ ] **Step 4.7: Manual smoke test — app still starts**

Run: `npm start`
Expected: the Electron window opens normally, no crash, no error dialog. This confirms `main.ts`'s new top-level `autoUpdater.on(...)` block (Step 4.3) and the new `app.whenReady()` addition (Step 4.4) don't throw on non-Windows dev machines — the `process.platform === "win32"` guards mean this code is inert on macOS/Linux. Close the app when done.

- [ ] **Step 4.8: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): wire autoUpdater (Windows) and GitHub-poll (mac/linux) IPC handlers"
```

---

## Task 5: Renderer-side type mirror in `client/src/global.d.ts`

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\global.d.ts`

**Why this works:** `client/` and `electron/` are separate TypeScript builds with no shared import between them — `global.d.ts` already independently redeclares `TcApi` to match `electron/types.ts`'s shape for `pickFolder`/`getServerPort`. This task extends that existing redeclaration with the four new members, so `AppInfoCard` (Task 6) gets full type-checking on `window.tc.getAppVersion()` etc. without a cross-project import.

- [ ] **Step 5.1: Replace the file**

Read `C:\GHSource\ticket-control\client\src\global.d.ts` first to confirm its current exact contents (4 lines). Replace its entire contents with:

```typescript
export type UpdateStatus =
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "downloading" }
  | { state: "ready"; action: "restart" }
  | { state: "ready"; action: "open-link"; version: string; url: string }
  | { state: "error"; message: string };

interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  applyUpdate: (status: UpdateStatus) => Promise<void>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => void;
}

interface Window {
  tc?: TcApi;
}
```

- [ ] **Step 5.2: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors. (No renderer code references `window.tc.getAppVersion` etc. yet — this step only confirms the type declaration itself is syntactically valid and doesn't conflict with anything.)

- [ ] **Step 5.3: Commit**

```bash
git add client/src/global.d.ts
git commit -m "feat(client): mirror UpdateStatus/TcApi update-check additions for renderer typecheck"
```

---

## Task 6: `AppInfoCard` component

**Files:**
- Create: `C:\GHSource\ticket-control\client\src\components\settings\AppInfoCard.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\App.css`

**Why this works:** This is the actual UI users interact with. It renders the current version, a "Check for Updates" button, and a status area whose content/action button are entirely determined by the `UpdateStatus` payload it receives — the component itself has zero platform-specific logic, matching the design's "unified renderer contract" (all platform branching already happened in `main.ts`, Task 4).

**Interfaces:**
- Consumes: `window.tc?.getAppVersion`, `window.tc?.checkForUpdates`, `window.tc?.applyUpdate`, `window.tc?.onUpdateStatus` (implemented in Task 3's `preload.ts`, type-mirrored in Task 5's `global.d.ts`). Reuses existing `.settings-error`/`.settings-success` CSS classes (already defined in `App.css`); adds one new class for the "update available" banner.
- Produces: `AppInfoCard` React component, no props (self-contained — fetches its own version on mount).

- [ ] **Step 6.1: Create the component**

Create `C:\GHSource\ticket-control\client\src\components\settings\AppInfoCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { UpdateStatus } from "../../global";

export function AppInfoCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!window.tc?.getAppVersion) {
      setSupported(false);
      return;
    }
    setSupported(true);
    window.tc.getAppVersion().then(setVersion).catch(() => setVersion(null));
    window.tc.onUpdateStatus?.(setStatus);
  }, []);

  async function handleCheck() {
    setStatus({ state: "checking" });
    try {
      await window.tc!.checkForUpdates();
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Check failed",
      });
    }
  }

  async function handleApply() {
    if (!status) return;
    await window.tc!.applyUpdate(status);
  }

  if (!supported) {
    return (
      <div className="settings-hint">
        Version unknown (browser dev mode).
      </div>
    );
  }

  const checking = status?.state === "checking";
  const isReady = status?.state === "ready";
  const applyLabel =
    isReady && status.action === "restart" ? "Restart to Update" : "Download";

  return (
    <div>
      <div className="settings-row">
        <span className="settings-row__label">Version</span>
        <span className="settings-row__value">{version ?? "…"}</span>
      </div>

      <button
        type="button"
        className="settings-discover-btn"
        onClick={handleCheck}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check for Updates"}
      </button>

      {status?.state === "up-to-date" && (
        <div className="settings-success">✓ You're up to date.</div>
      )}

      {status?.state === "downloading" && (
        <div className="settings-hint">Downloading update…</div>
      )}

      {isReady && (
        <div className="update-available-banner">
          <span>
            Update available{status.action === "open-link" ? ` — v${status.version}` : ""}
          </span>
          <button type="button" className="settings-discover-btn" onClick={handleApply}>
            {applyLabel}
          </button>
        </div>
      )}

      {status?.state === "error" && (
        <div className="settings-error">{status.message}</div>
      )}
    </div>
  );
}
```

`UpdateStatus` is imported from `../../global` — this relies on `client/src/global.d.ts` (Task 5) exporting the type rather than only declaring it ambiently. Re-check Task 5's file: it must use `export type UpdateStatus = ...` (as written in Step 5.1) for this import to resolve; a `.d.ts` file with a top-level `export` becomes a module, and its ambient declarations (`interface TcApi`, `interface Window`) remain global as long as the file doesn't also wrap them in `declare global {}` — TypeScript's rule here is that a `.d.ts` file with any top-level `import`/`export` stops being a pure ambient script file for *module* exports specifically, but bare `interface`/`declare` augmentations to already-global types like `Window` still merge globally regardless. If Step 6.3's typecheck fails with a global-augmentation error, that's the first thing to check.

- [ ] **Step 6.2: Add the banner CSS**

Edit `C:\GHSource\ticket-control\client\src\App.css`. Append after the `.settings-success` block (search for `.settings-success {` and its closing brace, currently ending around the block that starts at line 889):

```css
.update-available-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(230, 180, 60, 0.12);
  border: 1px solid rgba(230, 180, 60, 0.4);
  color: #e6c25a;
  border-radius: 6px;
  padding: 10px 14px;
  margin-top: 10px;
  font-size: 0.85rem;
}
```

- [ ] **Step 6.3: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors. `AppInfoCard` is not yet imported anywhere (that's Task 8), so this only validates the component file compiles standalone.

- [ ] **Step 6.4: Commit**

```bash
git add client/src/components/settings/AppInfoCard.tsx client/src/App.css
git commit -m "feat(client): add AppInfoCard with version display and Check for Updates flow"
```

---

## Task 7: `SettingsSection` shared collapsible wrapper

**Files:**
- Create: `C:\GHSource\ticket-control\client\src\components\settings\SettingsSection.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\App.css`

**Why this works:** `SpaceAccordion` already implements exactly this collapsible-header pattern inline (chevron + click-to-toggle + `.collapsible`/`.collapsible__inner`). Rather than writing a second, slightly different implementation for the four top-level Settings cards, this task extracts the chevron into a shared CSS class (`.settings-chevron`, renamed from `.space-accordion__chevron`) and introduces `SettingsSection` as the wrapper the four top-level cards will use — reusing the same already-shipped `.collapsible` transition CSS rather than adding new transition rules.

**Interfaces:**
- Produces: `SettingsSection` component — `{ title: string; defaultOpen: boolean; headerRight?: React.ReactNode; children: React.ReactNode }`.
- Consumes: existing `.collapsible`/`.collapsible__inner` CSS (unchanged); the renamed `.settings-chevron` CSS (this task).

- [ ] **Step 7.1: Rename the chevron CSS class**

Edit `C:\GHSource\ticket-control\client\src\App.css`. Find:

```css
.space-accordion__chevron {
  font-size: 0.7rem;
  color: #a8b0b9;
  display: inline-block;
  transition: transform 0.22s ease;
}
.space-accordion__chevron.is-open {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .space-accordion__chevron { transition: none; }
}
```

Replace with:

```css
.settings-chevron {
  font-size: 0.7rem;
  color: #a8b0b9;
  display: inline-block;
  transition: transform 0.22s ease;
}
.settings-chevron.is-open {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .settings-chevron { transition: none; }
}
```

- [ ] **Step 7.2: Update `SpaceAccordion.tsx`'s reference to the renamed class**

Edit `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx`. Find:

```tsx
          <span className={`space-accordion__chevron${open ? " is-open" : ""}`}>▶</span>
```

Replace with:

```tsx
          <span className={`settings-chevron${open ? " is-open" : ""}`}>▶</span>
```

- [ ] **Step 7.3: Create `SettingsSection.tsx`**

Create `C:\GHSource\ticket-control\client\src\components\settings\SettingsSection.tsx`:

```tsx
import { useState } from "react";

interface Props {
  title: string;
  defaultOpen: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsSection({ title, defaultOpen, headerRight, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="settings-card">
      <div className="settings-card__header" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <h2 className="settings-card__title">
          <span className={`settings-chevron${open ? " is-open" : ""}`}>▶</span>
          {" "}
          {title}
        </h2>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>
        )}
      </div>
      <div className={`collapsible${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="collapsible__inner">{children}</div>
      </div>
    </section>
  );
}
```

The `onClick={(e) => e.stopPropagation()}` wrapper around `headerRight` mirrors the exact pattern `SpaceAccordion` already uses for its own remove-confirm buttons (`onClick={(e) => e.stopPropagation()}` on the button-container div) — without it, clicking a header-right button (e.g. "Discover from JIRA") would also toggle the section open/closed, since the click bubbles up to the header's own `onClick`.

- [ ] **Step 7.4: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors. `SettingsSection` is not yet consumed (Task 8), so this validates the two edited/new files compile.

- [ ] **Step 7.5: Manual visual check of `SpaceAccordion`**

Run: `npm run dev:web`, open the app in a browser, navigate to Settings → JIRA Project → expand any configured space (or add one). Confirm the chevron still rotates on expand/collapse exactly as before — this is a pure rename with no behavior change, so a visual regression here would indicate a missed reference. Stop the dev server when done (`Ctrl+C` in the terminal running `npm run dev:web`).

- [ ] **Step 7.6: Commit**

```bash
git add client/src/App.css client/src/components/settings/SpaceAccordion.tsx client/src/components/settings/SettingsSection.tsx
git commit -m "feat(client): extract shared SettingsSection collapsible wrapper"
```

---

## Task 8: Wrap Settings cards in `SettingsSection` and mount `AppInfoCard`

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\components\SettingsView.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\ProjectCard.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\JiraUserCard.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\JiraProjectCard.tsx`

**Why this works:** This is where everything from Tasks 6 and 7 actually becomes visible. `AppInfoCard` becomes the first section (open by default); the three existing cards each lose their own `<section className="settings-card">`/title markup (now redundant with `SettingsSection`'s own wrapper) and instead render just their inner content, wrapped by `SettingsSection` from the parent (`SettingsView`). `JiraProjectCard`'s "Discover from JIRA" button — currently inside its own title row — moves to `SettingsSection`'s `headerRight` slot via a prop passed up from `SettingsView`, since `JiraProjectCard` itself no longer owns a header row.

**Interfaces:**
- Consumes: `SettingsSection` (Task 7), `AppInfoCard` (Task 6).
- Produces: each of `ProjectCard`, `JiraUserCard`, `JiraProjectCard` now returns a `<>...</>` fragment (or bare children) instead of a `<section>` — a breaking change to their own render output that only `SettingsView` (which mounts them) needs to account for.

- [ ] **Step 8.1: Strip `ProjectCard`'s own section wrapper**

Edit `C:\GHSource\ticket-control\client\src\components\settings\ProjectCard.tsx`. Find:

```tsx
  return (
    <section className="settings-card">
      <h2 className="settings-card__title">Project</h2>

      <div className="settings-row">
```

Replace with:

```tsx
  return (
    <>
      <div className="settings-row">
```

Find the closing tags at the end of the same return statement:

```tsx
      <p className="settings-hint">
        The working directory Claude uses when running your instructions. Pick the
        repo or project folder you want it to act on.
      </p>
    </section>
  );
}
```

Replace with:

```tsx
      <p className="settings-hint">
        The working directory Claude uses when running your instructions. Pick the
        repo or project folder you want it to act on.
      </p>
    </>
  );
}
```

- [ ] **Step 8.2: Strip `JiraUserCard`'s own section wrapper**

Edit `C:\GHSource\ticket-control\client\src\components\settings\JiraUserCard.tsx`. Find:

```tsx
  return (
    <section className="settings-card">
      <h2 className="settings-card__title">JIRA User</h2>

      <label className="settings-field">
```

Replace with:

```tsx
  return (
    <>
      <label className="settings-field">
```

Find the end of the same return statement:

```tsx
          . Stored locally; never sent anywhere except your JIRA instance.
        </span>
      </label>
    </section>
  );
}
```

Replace with:

```tsx
          . Stored locally; never sent anywhere except your JIRA instance.
        </span>
      </label>
    </>
  );
}
```

- [ ] **Step 8.3: Strip `JiraProjectCard`'s own section/header wrapper**

Edit `C:\GHSource\ticket-control\client\src\components\settings\JiraProjectCard.tsx`. First, find the top-of-file import line:

```tsx
import { ChangeEvent, useState } from "react";
```

Replace with:

```tsx
import { ChangeEvent, useEffect, useState } from "react";
```

Next, find:

```tsx
  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <h2 className="settings-card__title">JIRA Project</h2>
        <button
          type="button"
          className="settings-discover-btn"
          onClick={() => runDiscovery()}
          disabled={discovering || !canDiscover}
          title={canDiscover ? undefined : "Save valid JIRA credentials first"}
        >
          {discovering ? "Discovering…" : "Discover from JIRA"}
        </button>
      </div>

      {status?.configured && status.jira.ok && !dirty && (
```

Replace with:

```tsx
  return (
    <>
      {status?.configured && status.jira.ok && !dirty && (
```

The "Discover from JIRA" button itself is removed from here — it moves to `SettingsView` (Step 8.4) as the `headerRight` prop, since this component no longer renders its own header row. This means `JiraProjectCard`'s `discovering`/`canDiscover`/`runDiscovery` state and the button's `onClick` need to be reachable from `SettingsView` too — also resolved in Step 8.4 by lifting the button itself out as a small inline render in `SettingsView`, using props already being passed into `JiraProjectCard` today (`status`) plus one new callback prop.

Find the end of `JiraProjectCard`'s return statement:

```tsx
      <AddSpaceForm
        onAdd={async (key) => { await runDiscovery(key); }}
        disabled={!canDiscover}
      />
    </section>
  );
}
```

Replace with:

```tsx
      <AddSpaceForm
        onAdd={async (key) => { await runDiscovery(key); }}
        disabled={!canDiscover}
      />
    </>
  );
}
```

Now expose the discover-button state so `SettingsView` can render the button in the header slot. Find the component's props/state declarations near the top:

```tsx
export function JiraProjectCard({
  values, patch, onChange, onValuesChange, status, dirty,
}: Props) {
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const canDiscover = !!status?.jira.ok;
```

This stays as-is — no change needed here. Instead, `JiraProjectCard` gains a way to expose its "Discover from JIRA" trigger to its parent. Find the `Props` interface at the top of the file:

```tsx
interface Props {
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
  onValuesChange: (next: Settings) => void;
  status: SettingsStatus | null;
  dirty: boolean;
}
```

Replace with:

```tsx
interface Props {
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
  onValuesChange: (next: Settings) => void;
  status: SettingsStatus | null;
  dirty: boolean;
  onDiscoverButtonReady?: (button: { discovering: boolean; canDiscover: boolean; onClick: () => void }) => void;
}
```

Find, inside the component body, right after `const canDiscover = !!status?.jira.ok;`:

```tsx
  const canDiscover = !!status?.jira.ok;
```

Replace with:

```tsx
  const canDiscover = !!status?.jira.ok;

  useEffect(() => {
    onDiscoverButtonReady?.({
      discovering,
      canDiscover,
      onClick: () => { runDiscovery(); },
    });
  }, [discovering, canDiscover, values, patch]);
```

This must run in a `useEffect`, not directly in the render body — calling a parent's `setState`-backed callback synchronously during render triggers React's "Cannot update a component while rendering a different component" warning and risks an infinite render loop. The dependency array includes `values` and `patch` (not just `discovering`/`canDiscover`) because the `onClick` closure captures `runDiscovery`, which itself closes over `values`/`patch`/`onChange` — without `values`/`patch` in the deps, a user edit to those fields (without `discovering`/`canDiscover` also changing) would leave the parent holding a stale `onClick` closure that reads outdated `values`. This does not create an infinite loop: `onDiscoverButtonReady` only calls `setDiscoverButton` in `SettingsView` (Step 8.4), which does not itself change `values`/`patch`/`discovering`/`canDiscover`, so the effect's own trigger conditions are never re-satisfied by its own side effect. Add `import { useEffect, useState } from "react";` to this file's existing import line if `useEffect` isn't already imported (check the top of the file — it currently imports `ChangeEvent, useState` from `"react"`, so `useEffect` needs to be added there).

- [ ] **Step 8.4: Update `SettingsView.tsx` to compose everything**

Edit `C:\GHSource\ticket-control\client\src\components\SettingsView.tsx`. Replace the entire file with:

```tsx
import { useEffect, useState } from "react";
import { Settings, SettingsPatch, SettingsStatus } from "../types";
import { getSettings, updateSettings, getSettingsStatus } from "../api";
import { ProjectCard } from "./settings/ProjectCard";
import { JiraUserCard } from "./settings/JiraUserCard";
import { JiraProjectCard } from "./settings/JiraProjectCard";
import { AppInfoCard } from "./settings/AppInfoCard";
import { SettingsSection } from "./settings/SettingsSection";

const FOLDER_STORAGE_KEY = "tc_folderPath";

interface Props {
  onClose: () => void;
}

interface DiscoverButtonState {
  discovering: boolean;
  canDiscover: boolean;
  onClick: () => void;
}

export function SettingsView({ onClose }: Props) {
  const [values, setValues] = useState<Settings | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [patch, setPatch] = useState<SettingsPatch>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState(
    () => localStorage.getItem(FOLDER_STORAGE_KEY) || "",
  );
  const [discoverButton, setDiscoverButton] = useState<DiscoverButtonState | null>(null);

  useEffect(() => {
    getSettings().then(setValues).catch(() => setValues(null));
    getSettingsStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  function handleFolderChange(path: string) {
    setFolderPath(path);
    localStorage.setItem(FOLDER_STORAGE_KEY, path);
  }

  async function handleSave() {
    if (!values) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSettings(patch);
      setValues(updated);
      setPatch({});
      const fresh = await getSettingsStatus();
      setStatus(fresh);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const dirty = Object.keys(patch).length > 0;

  return (
    <div className="settings-view">
      <div className="panel-header">
        <h1>Settings</h1>
        <button className="refresh-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-scroll">
        <SettingsSection title="App Info" defaultOpen={true}>
          <AppInfoCard />
        </SettingsSection>

        <SettingsSection title="Project" defaultOpen={false}>
          <ProjectCard
            status={status}
            folderPath={folderPath}
            onFolderChange={handleFolderChange}
          />
        </SettingsSection>

        {values && (
          <>
            <SettingsSection title="JIRA User" defaultOpen={false}>
              <JiraUserCard values={values} patch={patch} onChange={setPatch} />
            </SettingsSection>

            <SettingsSection
              title="JIRA Project"
              defaultOpen={false}
              headerRight={
                discoverButton && (
                  <button
                    type="button"
                    className="settings-discover-btn"
                    onClick={discoverButton.onClick}
                    disabled={discoverButton.discovering || !discoverButton.canDiscover}
                    title={discoverButton.canDiscover ? undefined : "Save valid JIRA credentials first"}
                  >
                    {discoverButton.discovering ? "Discovering…" : "Discover from JIRA"}
                  </button>
                )
              }
            >
              <JiraProjectCard
                values={values}
                patch={patch}
                onChange={setPatch}
                onValuesChange={setValues}
                status={status}
                dirty={dirty}
                onDiscoverButtonReady={setDiscoverButton}
              />
            </SettingsSection>
          </>
        )}
        {!values && <div className="empty-state">Loading settings…</div>}

        {saveError && <div className="settings-error">{saveError}</div>}

        <div className="settings-actions">
          <button
            className="settings-save-btn"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.5: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors. Pay particular attention to any error on the `onDiscoverButtonReady?.({...})` call added in Step 8.3 (Props typing must line up exactly) and on `discoverButton &&` inside the `headerRight` prop (must resolve to `ReactNode | undefined`, not `false` — using `discoverButton && (<button>...)` returns `false` when `discoverButton` is `null`, which IS a valid `ReactNode` in React 18+, so this should typecheck and render nothing when falsy; if TypeScript complains, wrap as `discoverButton ? (<button>...) : undefined` instead).

- [ ] **Step 8.6: Manual visual verification**

Run: `npm run dev:web`, open the app in a browser, open Settings. Confirm:
- "App Info" section is expanded by default, shows a version number (or the browser-dev fallback text if `window.tc` is absent — expected in `dev:web` mode, confirm no crash).
- "Project", "JIRA User", "JIRA Project" sections are collapsed by default.
- Expanding "JIRA Project" reveals the existing content, and its "Discover from JIRA" button appears in the section header (next to the chevron/title), not inside the body — click it and confirm discovery still runs (existing behavior, just relocated).
- Toggling one section open/closed doesn't affect the open/closed state of any other section (independent state, since each `SettingsSection` holds its own `useState`).
- The Save button and overall save flow still work (edit the JIRA User email field, confirm the Save button enables, save it).

Stop the dev server when done.

- [ ] **Step 8.7: Commit**

```bash
git add client/src/components/SettingsView.tsx client/src/components/settings/ProjectCard.tsx client/src/components/settings/JiraUserCard.tsx client/src/components/settings/JiraProjectCard.tsx
git commit -m "feat(client): make all Settings sections collapsible, mount AppInfoCard first"
```

---

## Task 9: End-to-end verification

**Files:** none — this task runs full verification; it makes no code changes.

- [ ] **Step 9.1: Run the full server-side test suite**

Run: `npm test`
Expected: PASS, no failures, across every existing suite plus the new `electron/update-checker.test.js` (10 new tests from Task 2).

- [ ] **Step 9.2: Run the full client build**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors, no build warnings beyond pre-existing ones (if any).

- [ ] **Step 9.3: Manual — package and test on Windows**

Run: `npm run package` (or `npm run make` for a full installer if you want to test the Squirrel update path specifically — `npm run package` alone does not produce Squirrel `RELEASES`/`.nupkg` files, only `npm run make` does, per `forge.config.ts`'s `MakerSquirrel`). Since real end-to-end update verification requires a second, newer published release to check against, this step is inherently manual and requires either: (a) a real newer tag already published via Task 1's now-non-draft release workflow, or (b) accepting that "up-to-date" is the only state fully verifiable without publishing a second release first. At minimum, confirm: launching the packaged app, opening Settings → App Info, clicking "Check for Updates" does not crash and eventually shows either "up-to-date" or an error (not an infinite "Checking…" hang).

- [ ] **Step 9.4: Manual — verify macOS/Linux notify-and-link path**

If you have access to a macOS or Linux machine (or CI runner) to test on: package the app, run it, click Check for Updates, confirm it reaches `up-to-date` (if already on the latest tag) without any code-signing-related crash — this is the whole point of routing mac/linux through the GitHub API path instead of `autoUpdater`. If a newer release exists, confirm the amber banner appears with "Download" and clicking it opens the release page in the default browser.

- [ ] **Step 9.5: Manual — confirm draft-release change took effect**

After Task 1 is merged and a new tag is pushed through the normal release process, run `gh release view <tag> --json isDraft` (or check the GitHub UI) and confirm `isDraft: false` — verifying the CI change actually took effect on a real release, not just that the YAML parses.

No commit for this task — it's verification only.
