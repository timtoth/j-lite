# Auto-Update Checking & Collapsible Settings — Design

**Status:** Approved 2026-07-28

**Goal:** Let users know when a newer version of the app exists and apply it with minimal friction: real restart-to-update on Windows, "here's the new version, go download it" on macOS/Linux. Surface this through a new "App Info" section at the top of Settings, and make the growing number of Settings sections collapsible so users can focus on the one they came to edit.

**Why:** The app has no update mechanism today — users must notice a new GitHub Release themselves and manually reinstall. `forge.config.ts` already builds Squirrel.Windows artifacts (`.nupkg`/`RELEASES`/`.exe`), which is exactly what Electron's `autoUpdater` needs on Windows; nothing else is wired up. Settings has grown to 4+ cards (`ProjectCard`, `JiraUserCard`, `JiraProjectCard`, plus its nested `SpaceAccordion` list) and will keep growing, making an always-expanded layout increasingly unwieldy.

**Non-goals:**
- macOS code-signing / real Squirrel.Mac auto-update. Requires an Apple Developer certificate this repo doesn't have; macOS is treated like Linux (notify + link) until that's set up separately.
- Background/on-launch update checks. Manual "Check for Updates" button only — no periodic polling, no check-on-startup.
- Version display anywhere outside Settings (no window-title change).
- Retrofitting `update-electron-app` (the high-level npm package) — it only exposes automatic startup+interval checking and its own native dialog, with no manual-trigger hook and no access to individual `autoUpdater` events, so it can't drive the custom in-Settings UI this design calls for. We talk to Electron's `autoUpdater` module directly instead, using the same feed-URL scheme that package uses internally.

---

## 1. Release pipeline: stop drafting releases

`.github/workflows/release.yml`'s `release` job currently does:

```yaml
- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    files: artifacts/**/*
    draft: true
    generate_release_notes: true
```

`update.electronjs.org` (the Windows update feed, §3) only serves updates from **published** releases — it cannot see drafts. Remove `draft: true` so tag-triggered releases publish immediately. `generate_release_notes: true` is unaffected.

The current `v0.3.0` draft was manually published as part of approving this design, so update-checking is testable against it immediately after this ships. `v0.1.0` stays a draft (not worth touching).

---

## 2. Version source of truth

`app.getVersion()` (Electron) reads `package.json`'s `version` field at build time — already `0.3.0`, no change needed there. A new IPC channel exposes it to the renderer:

```ts
// electron/types.ts
export const IPC = {
  PICK_FOLDER: "tc:pick-folder",
  GET_SERVER_PORT: "tc:get-server-port",
  GET_APP_VERSION: "tc:get-app-version",       // new
  CHECK_FOR_UPDATES: "tc:check-for-updates",    // new
  RESTART_TO_UPDATE: "tc:restart-to-update",    // new
  OPEN_EXTERNAL: "tc:open-external",            // new — macOS/Linux "Download" action
  UPDATE_STATUS: "tc:update-status",            // new — main → renderer push, not request/response
} as const;
```

`window.tc.getAppVersion(): Promise<string>` — returns `app.getVersion()` from main. In browser-only dev (`npm run dev:web`, no `window.tc`), the App Info card falls back to displaying nothing for version and hides the Check for Updates button entirely — same degradation pattern already used by `FolderPicker`/`browseFolder()` when `window.tc.pickFolder` is undefined.

---

## 3. Update-check strategy, branched by platform

All logic that decides *how* to check lives in a new pure module, `electron/update-checker.impl.js` (CommonJS, testable via `node --test` without an Electron runtime — same pattern as `free-port.impl.js`/`spawn-args.impl.js`). `electron/update-checker.ts` re-exports it for `main.ts`'s TypeScript import, mirroring `paths.ts`/`paths.impl.js`.

### 3.1 Windows — real `autoUpdater`

```js
// electron/update-checker.impl.js (Windows branch, invoked from main.ts)
function windowsFeedUrl(repo, version) {
  return `https://update.electronjs.org/${repo}/win32-x64/${version}`;
}
```

`electron/main.ts`, on `app.whenReady()` (Windows only):

```ts
if (process.platform === "win32") {
  autoUpdater.setFeedURL({ url: windowsFeedUrl("timtoth/j-lite", app.getVersion()) });
}
```

IPC handler for `CHECK_FOR_UPDATES` (Windows branch) calls `autoUpdater.checkForUpdates()`. This is the *only* trigger — no `setInterval`, matching the manual-only decision. `autoUpdater`'s events are wired once at startup and pushed to the renderer as they fire:

| `autoUpdater` event | Pushed status (`tc:update-status` payload) |
|---|---|
| `checking-for-update` | `{ state: "checking" }` |
| `update-not-available` | `{ state: "up-to-date" }` |
| `update-available` | `{ state: "downloading" }` |
| `update-downloaded` | `{ state: "ready", action: "restart" }` |
| `error` | `{ state: "error", message: string }` |

IPC handler for `RESTART_TO_UPDATE` calls `autoUpdater.quitAndInstall()` (Windows branch only; renderer never calls this on macOS/Linux since that status payload never carries `action: "restart"` there).

**Squirrel silent-failure risk:** per Electron's own docs, if a release is missing the expected Squirrel assets (`RELEASES`, `*-full.nupkg`, the setup `.exe`), the update check fails *silently* (no `error` event, just perpetual `update-not-available`). `release.yml`'s existing artifact glob (`out/make/**/*.exe`, `*.nupkg`, `RELEASES`) already uploads all required files — this is a pre-existing correctness property we're relying on, not a new requirement.

### 3.2 macOS / Linux — GitHub Releases API polling

No `autoUpdater`, no code-signing dependency. On `CHECK_FOR_UPDATES` (mac/linux branch):

```js
// electron/update-checker.impl.js
async function checkGithubLatestRelease(repo, currentVersion, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) return { state: "error", message: `GitHub API returned ${res.status}` };
  const data = await res.json();
  const latest = String(data.tag_name || "").replace(/^v/, "");
  if (!latest) return { state: "error", message: "Could not parse latest release tag" };
  if (compareVersions(latest, currentVersion) > 0) {
    return { state: "ready", action: "open-link", version: latest, url: data.html_url };
  }
  return { state: "up-to-date" };
}
```

`compareVersions` is a small semver-ish comparator (`"0.3.0"` vs `"0.4.0"` → `-1`; no external dependency needed for plain `x.y.z` tags, which is all this repo uses). `fetchImpl` is injected so the function is testable with a fake without hitting the network.

Main process calls this, pushes the `tc:update-status` shape (`{ state: "ready", action: "open-link", version, url }` on update found) over the `UPDATE_STATUS` channel. The renderer's "Download" button (shown when `action === "open-link"`) then calls the `OPEN_EXTERNAL` handler with `status.url`, which wraps Electron's `shell.openExternal` (already used internally by `main.ts` for other external links) — kept as its own IPC channel rather than folded into `RESTART_TO_UPDATE` since the payload and semantics differ (a URL string vs. no argument).

### 3.3 Unified renderer contract

Regardless of platform, the renderer only ever sees:
- `window.tc.checkForUpdates(): Promise<void>` — fire-and-forget; result arrives via the status push.
- A subscription to `tc:update-status` pushes (exposed via `window.tc.onUpdateStatus(cb)`, using `ipcRenderer.on` in preload — this one is push-based from main to renderer, unlike `getAppVersion`/`checkForUpdates`/`applyUpdate`, which are renderer-initiated request/response calls via `ipcRenderer.invoke`).
- `window.tc.applyUpdate(status): Promise<void>` — the renderer's single "do the thing" action. If `status.action === "restart"`, the preload implementation invokes `RESTART_TO_UPDATE`; if `"open-link"`, it invokes `OPEN_EXTERNAL` with `status.url`. This keeps `AppInfoCard` platform-agnostic — it renders a button whose label and behavior come entirely from the status payload it already has, calling this one function regardless of platform.

---

## 4. `AppInfoCard` component

New `client/src/components/settings/AppInfoCard.tsx`. Always the **first** card in `SettingsView`, defaults **open** (per your explicit "first section open, rest closed" decision).

States (driven by local `useState<UpdateStatus>` synced from `onUpdateStatus`):
- **Idle** (before any check): version number, "Check for Updates" button, no status line.
- **Checking**: button disabled, "Checking…" text.
- **Up to date**: green checkmark, "You're up to date."
- **Update ready** (`action: "restart"`): amber banner "Update available — v0.4.0", button reads "Restart to Update".
- **Update ready** (`action: "open-link"`): amber banner "Update available — v0.4.0", button reads "Download".
- **Error**: red inline error text with the message, "Check for Updates" button re-enabled.

If `window.tc?.getAppVersion` is undefined (browser-only dev), render only the static text "Version unknown (browser dev mode)" — no button, no status area.

---

## 5. Collapsible settings sections

A new shared wrapper, `client/src/components/settings/SettingsSection.tsx`, standardizes the collapsible header (chevron + title) that `SpaceAccordion` already implements inline, reusing the existing `.collapsible`/`.collapsible__inner` CSS (already shipped, used by `SpaceAccordion`'s per-space bodies) rather than introducing new transition CSS.

```tsx
interface Props {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}
```

Internally: local `open` state seeded from `defaultOpen`, a header button toggling it (reusing `.space-accordion__chevron`-style rotation, promoted to a shared class name since it's no longer space-specific — e.g. renamed `.settings-chevron` and referenced from both `SpaceAccordion` and `SettingsSection`), and the existing `.collapsible`/`.collapsible__inner` div structure wrapping `children`.

`SettingsView.tsx` wraps each existing card's *contents* in `SettingsSection`:
- `AppInfoCard` → `defaultOpen: true` (first section, open per your decision)
- `ProjectCard` → `defaultOpen: false`
- `JiraUserCard` → `defaultOpen: false`
- `JiraProjectCard` → `defaultOpen: false`

Each card component keeps its own internal content unchanged; only the outer `<section className="settings-card">` + `<h2 className="settings-card__title">` boilerplate each currently repeats gets replaced by the shared `SettingsSection` wrapper. `JiraProjectCard`'s own "Discover from JIRA" header button (currently in its title row) moves into `SettingsSection`'s header-right slot — `SettingsSection` needs an optional `headerRight?: React.ReactNode` prop to accommodate this, matching the pattern `SpaceAccordion` already uses for its own remove button.

`SpaceAccordion` itself is *not* migrated to `SettingsSection` in this pass — it's a per-item accordion nested inside `JiraProjectCard`, a different semantic level from the four top-level cards, and changing it isn't necessary to satisfy the ask.

---

## 6. File structure summary

| File | Change |
|---|---|
| `.github/workflows/release.yml` | Remove `draft: true` |
| `electron/update-checker.impl.js` | New — pure logic: feed URL construction, GitHub API polling, version comparison |
| `electron/update-checker.ts` | New — thin re-export wrapper (Electron-runtime import point) |
| `electron/update-checker.test.js` | New — unit tests for the pure logic |
| `electron/main.ts` | New IPC handlers (`GET_APP_VERSION`, `CHECK_FOR_UPDATES`, `RESTART_TO_UPDATE`, `OPEN_EXTERNAL`); pushes `UPDATE_STATUS` events; `autoUpdater` event wiring (Windows); platform branch to pick strategy |
| `electron/preload.ts` | Expose `getAppVersion`, `checkForUpdates`, `applyUpdate`, `onUpdateStatus` on `window.tc` |
| `electron/types.ts` | New IPC channel constants; extend `TcApi` interface; new `UpdateStatus` type |
| `client/src/global.d.ts` | Redeclare `UpdateStatus` and extend `TcApi` with `getAppVersion`/`checkForUpdates`/`applyUpdate`/`onUpdateStatus`, mirroring `electron/types.ts` — same independent-redeclaration pattern this file already uses for `pickFolder`/`getServerPort` (client and electron are separate TS builds with no shared import between them) |
| `client/src/components/settings/AppInfoCard.tsx` | New |
| `client/src/components/settings/SettingsSection.tsx` | New — shared collapsible wrapper |
| `client/src/components/SettingsView.tsx` | Wrap existing cards in `SettingsSection`; render `AppInfoCard` first |
| `client/src/components/settings/SpaceAccordion.tsx` | Rename its chevron class to the shared `.settings-chevron` (no behavioral change) |
| `client/src/App.css` | Promote `.space-accordion__chevron` → `.settings-chevron`; new styles for `AppInfoCard`'s status states (checkmark, amber banner, error text) |

---

## 7. Testing

### Unit (`electron/update-checker.test.js`)
- `windowsFeedUrl` produces the exact expected URL string for a given repo/version.
- `checkGithubLatestRelease`: newer tag → `{ state: "ready", action: "open-link", ... }`; equal/older tag → `{ state: "up-to-date" }`; non-2xx response → `{ state: "error", ... }`; malformed/missing `tag_name` → `{ state: "error", ... }`. All driven by an injected fake `fetchImpl`, no real network calls.
- `compareVersions`: `"0.3.0"` vs `"0.4.0"` → negative; `"0.3.0"` vs `"0.3.0"` → zero; `"0.10.0"` vs `"0.9.0"` → positive (numeric segment comparison, not string comparison — `"0.10.0" > "0.9.0"` must not be decided by string ordering).

### Manual (this feature cannot be fully verified by automated tests — it depends on real Squirrel/GitHub infrastructure)
- Windows: package the app at a version older than the latest published release, run `npm run package`, launch it, click Check for Updates, confirm the `checking → downloading → ready` sequence and that clicking Restart actually relaunches at the new version.
- macOS/Linux: same version-lag setup, confirm `checking → ready (open-link)`, and that the Download button opens the correct release URL in the default browser.
- Up-to-date case on all three platforms: package at the current latest version, confirm `checking → up-to-date` with the green checkmark.
- Browser-only dev (`npm run dev:web`): confirm `AppInfoCard` renders the "unknown / browser dev mode" fallback with no crash.

### Settings collapsibility
- Manual: open Settings, confirm App Info is expanded and the other three cards are collapsed on first render; confirm each collapses/expands independently and state doesn't reset when toggling a sibling.

---

## 8. Out of scope / deferred

- macOS code-signing and real Squirrel.Mac auto-update.
- Periodic/background update checks.
- Any change to `SpaceAccordion`'s per-space accordion behavior beyond the chevron class rename.
- Release-notes surfacing in the UI (the amber banner shows only the version number, not changelog text — `generate_release_notes: true` output is visible on GitHub, not mirrored into the app).
