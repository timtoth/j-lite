# Rename app to j-Lite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the user-facing app from "Ticket Control" to **j-Lite** with a Windows Start Menu shortcut named `jLite` (no hyphen, so `jl` prefix-matches in search), and migrate per-user config from the old userData directory on first launch.

**Architecture:** Three identifiers, picked deliberately: `package.json` `productName: "jLite"` (drives Electron's userData dir + Squirrel shortcut name), `package.json` `name` stays `ticket-control` (internal slug), and the displayed window/dialog/HTML title is `j-Lite` (set explicitly so the hyphen survives despite the un-hyphenated shortcut). A pure `migrate-userdata.impl.js` helper handles the one-time copy of `config.json` and `app.log` from `%APPDATA%\ticket-control` to the new dir; it's wired into `electron/main.ts` before `startServer()`.

**Tech Stack:** Electron 32 + Forge 7, electron-forge `MakerSquirrel`, `node --test` for the helper test, plain CommonJS `.impl.js` files (per repo convention).

## Global Constraints

- **Display name everywhere user-facing:** `j-Lite` (with hyphen) — title bar, dialogs, HTML `<title>`, docs banners.
- **Shortcut/exe name (Windows installer only):** `jLite` (no hyphen).
- **Internal npm package slug stays:** `ticket-control` in `package.json` `name` and `client/package.json` `name`. Do not change the repo dir name.
- **Migration is idempotent:** if `<newUserData>/config.json` already exists, the migration is a no-op.
- **Commit style:** present-tense imperative (`feat:`, `chore:`, `docs:` per recent log).
- **Tests:** new pure helpers ship with `node --test` coverage in `electron/<name>.test.js`.

---

### Task 1: Add migrate-userdata pure helper + tests

**Files:**
- Create: `electron/migrate-userdata.impl.js`
- Create: `electron/migrate-userdata.test.js`

**Interfaces:**
- Consumes: nothing (pure helper, takes `fs`-like dependencies via parameters for testability).
- Produces: `migrateUserData({ oldDir, newDir, fs }): { migrated: boolean, copied: string[] }`. Called by Task 3 from `electron/main.ts` immediately before `startServer()`. Idempotent: returns `{ migrated: false, copied: [] }` whenever the new dir already has `config.json` or the old dir is missing `config.json`.

- [ ] **Step 1: Write the failing tests**

Create `electron/migrate-userdata.test.js` with the full content below:

```javascript
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { migrateUserData } = require("./migrate-userdata.impl.js");

function makeFakeFs(initial) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set();
  for (const p of files.keys()) dirs.add(path.dirname(p));
  return {
    files,
    dirs,
    existsSync: (p) => files.has(p),
    mkdirSync: (p, _opts) => {
      dirs.add(p);
    },
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    copyFileSync: (src, dest) => {
      if (!files.has(src)) throw new Error("ENOENT: " + src);
      files.set(dest, files.get(src));
    },
  };
}

test("copies config.json and app.log from old dir when new dir is fresh", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"hello":"world"}',
    [path.join(oldDir, "app.log")]: "log line",
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.copied.sort(), ["app.log", "config.json"]);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"hello":"world"}');
  assert.equal(fs.files.get(path.join(newDir, "app.log")), "log line");
});

test("copies only config.json when old dir has no app.log", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"a":1}',
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.copied, ["config.json"]);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"a":1}');
});

test("no-op when new dir already has config.json", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"old":true}',
    [path.join(newDir, "config.json")]: '{"new":true}',
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, false);
  assert.deepEqual(result.copied, []);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"new":true}');
});

test("no-op when old dir has no config.json", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({});

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, false);
  assert.deepEqual(result.copied, []);
});

test("creates new dir before copying", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: "{}",
  });

  migrateUserData({ oldDir, newDir, fs });

  assert.ok(fs.dirs.has(newDir), "new dir should be created");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/migrate-userdata.test.js`
Expected: FAIL — `Cannot find module './migrate-userdata.impl.js'`.

- [ ] **Step 3: Write the helper**

Create `electron/migrate-userdata.impl.js`:

```javascript
const path = require("node:path");

/**
 * @typedef {Object} MigrateArgs
 * @property {string} oldDir
 * @property {string} newDir
 * @property {{
 *   existsSync: (p: string) => boolean,
 *   mkdirSync: (p: string, opts?: object) => void,
 *   copyFileSync: (src: string, dest: string) => void,
 * }} fs
 */

/**
 * One-time copy of config.json (and app.log if present) from oldDir to
 * newDir. Idempotent: returns { migrated: false, copied: [] } if newDir
 * already has config.json or oldDir has no config.json.
 *
 * @param {MigrateArgs} args
 * @returns {{ migrated: boolean, copied: string[] }}
 */
function migrateUserData({ oldDir, newDir, fs }) {
  const newConfig = path.join(newDir, "config.json");
  const oldConfig = path.join(oldDir, "config.json");

  if (fs.existsSync(newConfig)) return { migrated: false, copied: [] };
  if (!fs.existsSync(oldConfig)) return { migrated: false, copied: [] };

  fs.mkdirSync(newDir, { recursive: true });
  const copied = [];

  fs.copyFileSync(oldConfig, newConfig);
  copied.push("config.json");

  const oldLog = path.join(oldDir, "app.log");
  if (fs.existsSync(oldLog)) {
    fs.copyFileSync(oldLog, path.join(newDir, "app.log"));
    copied.push("app.log");
  }

  return { migrated: true, copied };
}

module.exports = { migrateUserData };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/migrate-userdata.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all suites including the four pre-existing `electron/*.test.js` files.

- [ ] **Step 6: Commit**

```bash
git add electron/migrate-userdata.impl.js electron/migrate-userdata.test.js
git commit -m "feat: add migrate-userdata helper for one-time userData copy"
```

---

### Task 2: Update branding identifiers (package.json, Forge, HTML)

**Files:**
- Modify: `package.json` (add `productName` field)
- Modify: `forge.config.ts` (configure `MakerSquirrel` constructor args)
- Modify: `client/index.html` (line 6 `<title>`)

**Interfaces:**
- Consumes: nothing.
- Produces: `productName: "jLite"` becomes the value Electron returns from `app.getName()` and `app.getPath('userData')` (used by Task 3's migration call). Squirrel's installer artifact `out/make/squirrel.windows/x64/jLite-<ver> Setup.exe` and Start Menu shortcut named `jLite`.

- [ ] **Step 1: Add productName to root package.json**

In `package.json`, after the `"name": "ticket-control",` line (line 2), insert:

```json
  "productName": "jLite",
```

The top of the file should now read:

```json
{
  "name": "ticket-control",
  "productName": "jLite",
  "version": "0.1.0",
```

- [ ] **Step 2: Configure MakerSquirrel name/exe options**

In `forge.config.ts`, replace `new MakerSquirrel({}),` (line 24) with:

```typescript
    new MakerSquirrel({
      name: "jLite",
      exe: "jLite.exe",
      setupExe: "jLite-Setup.exe",
    }),
```

- [ ] **Step 3: Update the HTML title**

In `client/index.html`, change line 6 from:

```html
  <title>Ticket Control</title>
```

to:

```html
  <title>j-Lite</title>
```

- [ ] **Step 4: Verify package.json still parses and tests still pass**

Run: `npm test`
Expected: PASS — the helper tests from Task 1 plus all pre-existing suites.

- [ ] **Step 5: Commit**

```bash
git add package.json forge.config.ts client/index.html
git commit -m "feat: rebrand product identifiers to j-Lite / jLite"
```

---

### Task 3: Wire window title, dialog titles, and migration in main.ts

**Files:**
- Modify: `electron/main.ts` (window title, three dialog title strings, migration call)

**Interfaces:**
- Consumes: `migrateUserData` from Task 1's `./migrate-userdata.impl.js`; `productName` from Task 2's `package.json`.
- Produces: at runtime, the `BrowserWindow` displays `j-Lite` in the title bar and the three pre-existing `dialog.show*` calls show `j-Lite` as their dialog title. On first launch after upgrade, `%APPDATA%\jLite\config.json` is populated from `%APPDATA%\ticket-control\config.json` if the latter exists.

- [ ] **Step 1: Add the migrate-userdata import**

In `electron/main.ts`, after the existing import line `import { serverEntry, mcpEntry, configDir, isDev } from "./paths";` (line 9), add:

```typescript
import { migrateUserData } from "./migrate-userdata.impl.js";
```

- [ ] **Step 2: Replace the three dialog title strings**

In `electron/main.ts`, change all three occurrences of the string literal `"ticket-control"` (lines 83, 114, 198) to `"j-Lite"`. After the change, run a grep to confirm none remain:

Run: `grep -n '"ticket-control"' electron/main.ts`
Expected: no output.

- [ ] **Step 3: Set the BrowserWindow title**

In `electron/main.ts`, in the `createWindow()` function, modify the `BrowserWindow` constructor (currently lines 134–143):

```typescript
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: "j-Lite",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```

(The added line is `title: "j-Lite",`.)

- [ ] **Step 4: Run the migration before startServer()**

In `electron/main.ts`, in the `app.whenReady().then(async () => { ... })` block, replace the existing body up through the `startServer()` call. The current code (lines 192–203):

```typescript
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    serverPort = await startServer();
  } catch (err) {
    dialog.showErrorBox(
      "j-Lite",
      `Failed to start server: ${(err as Error).message}`
    );
    app.quit();
    return;
  }
```

becomes:

```typescript
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  try {
    const oldUserData = path.join(app.getPath("appData"), "ticket-control");
    const newUserData = app.getPath("userData");
    const result = migrateUserData({
      oldDir: oldUserData,
      newDir: newUserData,
      fs,
    });
    if (result.migrated) {
      console.log(
        `[j-Lite] migrated userData from ${oldUserData}: ${result.copied.join(", ")}`
      );
    }
  } catch (err) {
    console.error("[j-Lite] userData migration failed:", err);
  }

  try {
    serverPort = await startServer();
  } catch (err) {
    dialog.showErrorBox(
      "j-Lite",
      `Failed to start server: ${(err as Error).message}`
    );
    app.quit();
    return;
  }
```

(`path` and `fs` are already imported at the top of the file — lines 3 and 5.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no `main.ts` tests exist, but the helper tests from Task 1 must still pass.

- [ ] **Step 6: Smoke-test the dev app**

Run: `npm start`
Expected: Electron window opens with `j-Lite` shown in the title bar. Quit the app with the window's close button.

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts
git commit -m "feat: show j-Lite in window/dialogs and migrate userData on launch"
```

---

### Task 4: Update docs and setup scripts

**Files:**
- Modify: `CHECKLIST.md` (line 1)
- Modify: `setup.ps1` (lines 1, 6)
- Modify: `setup.sh` (line 7)
- Modify: `install-startup.bat` (lines 2, 4)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing runtime — these are docs/scripts only.

- [ ] **Step 1: Update CHECKLIST.md heading**

In `CHECKLIST.md`, change line 1 from:

```
# Ticket Control - Task Checklist
```

to:

```
# j-Lite - Task Checklist
```

- [ ] **Step 2: Update setup.ps1 banners**

In `setup.ps1`:
- Change line 1 from `# Ticket Control - Windows Setup Script` to `# j-Lite - Windows Setup Script`.
- Change line 6 from `Write-Host "=== Ticket Control - Windows Setup ===" -ForegroundColor Cyan` to `Write-Host "=== j-Lite - Windows Setup ===" -ForegroundColor Cyan`.

- [ ] **Step 3: Update setup.sh banner**

In `setup.sh`, change line 7 from:

```bash
echo "=== Ticket Control Setup ==="
```

to:

```bash
echo "=== j-Lite Setup ==="
```

- [ ] **Step 4: Update install-startup.bat**

In `install-startup.bat`:
- Change line 2 from `:: Registers a Windows Task Scheduler task to run ticket-control on login` to `:: Registers a Windows Task Scheduler task to run j-Lite on login`.
- Change line 4 from `set TASK_NAME=TicketControl` to `set TASK_NAME=jLite`.

- [ ] **Step 5: Verify no user-facing "Ticket Control" or "ticket-control" branding remains**

Run: `grep -rni --include='*.md' --include='*.html' --include='*.ps1' --include='*.sh' --include='*.bat' --include='*.ts' --include='*.tsx' -l 'ticket.control\|Ticket Control' .`
Expected: only `package.json`, `client/package.json`, `package-lock.json`, `client/package-lock.json`, `.claude/hooks/post-edit-test.js` (internal), and any `docs/superpowers/specs|plans/*.md` files for *this* effort. No hits in user-facing files (`CHECKLIST.md`, `setup.ps1`, `setup.sh`, `install-startup.bat`, `client/index.html`, `electron/main.ts`).

If any unexpected user-facing file appears in the results, update it the same way and re-run before committing.

- [ ] **Step 6: Run the full test suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add CHECKLIST.md setup.ps1 setup.sh install-startup.bat
git commit -m "docs: rename setup scripts and checklist banners to j-Lite"
```

---

## Out of scope (explicitly not modified)

- `package.json` `name` field (`ticket-control` — npm slug).
- `client/package.json` `name` field (`ticket-control-client` — npm slug).
- Repo directory `C:\GHSource\ticket-control`.
- `.claude/hooks/post-edit-test.js` (internal hook plumbing — uses `ticket-control` as a path-substring guard).
- Git remote / branch names.

## Manual post-implementation verification (not a plan task — operator runs after merge)

These need a Windows host with installer permissions, so they're operator steps, not tasks:

- `npm run make` produces `out/make/squirrel.windows/x64/jLite-<ver> Setup.exe`.
- After install, the Start Menu has a `jLite` entry that's reachable by pressing the Windows key and typing `jl`.
- On a machine with a pre-existing `%APPDATA%\ticket-control\config.json`, first launch of the new build creates `%APPDATA%\jLite\config.json` with the same contents and emits the `[j-Lite] migrated userData...` line in `app.log`.
- Second launch is a no-op (no migration log line).
