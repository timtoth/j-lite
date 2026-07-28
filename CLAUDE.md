# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted.

- `npm start` — launches the Electron app in dev mode (Forge starts Vite for renderer/main/preload, opens an Electron window). The Express server is spawned by Electron main on a random port.
- `npm run dev:web` — runs the Express API and the Vite dev server *without* Electron, for browser-only debugging. Express on `:3000`, Vite on `:5173`.
- `npm run build` — type-checks the React client and runs `vite build` (mostly useful as a standalone typecheck; `npm run package` does this as part of its pipeline).
- `npm run package` — builds the Electron app into `out/<app>-<platform>-<arch>/` without producing an installer. Useful for smoke-testing the packaged layout.
- `npm run make` — produces installers in `out/make/` for the host OS (Squirrel `.exe` on Windows, `.dmg`/`.zip` on macOS, `.deb`/`.rpm` on Linux). Run on the target OS — there is no cross-compile.
- `npm test` — runs all `node --test` suites. Run a single file with `node --test <file>`. Filter to one test with `node --test --test-name-pattern="<regex>"`.
- `npm run mcp:install` — manual escape hatch for registering the create-ticket MCP with the user's `claude` CLI. The packaged app runs the equivalent automatically on first launch.
- `npm run mcp:smoke` — smoke test for the MCP create-ticket flow.

There is no lint config; do not invent one.

## Architecture

The product is a two-pane JIRA dashboard. The **left pane reads JIRA directly via REST**; the **right pane delegates write operations to the local Claude Code CLI**, which in turn uses MCP servers to talk to JIRA. These two paths are intentionally separate and use different auth.

### Read path (left pane)
`client/` (React + Vite) → `routes/tickets.js` and `routes/epics.js` → `jira.js` → JIRA REST `/rest/api/3/...`. Auth is HTTP Basic with `JIRA_EMAIL` + `JIRA_API_TOKEN` from `.env`. `jira.js` also contains an ADF-to-HTML converter (`adfToHtml`) and an ADF-to-plain-text converter (`adfToText`) used to render descriptions and to feed ticket context into prompts.

### Write/instruction path (right pane)
`client/src/components/InstructPanel.tsx` posts to `POST /api/instruct` (`routes/instruct.js`). The route:
1. Scans the user's instruction for `[A-Z]+-\d+` ticket keys and prepends fetched ticket details (via `getTicketDetails` in `jira.js`) so the CLI has context without re-fetching.
2. Spawns `claude -p --output-format json --dangerously-skip-permissions [--resume <sessionId>] <prompt>`, optionally with a user-selected `cwd`.
3. Parses the JSON envelope, returns `{ response, sessionId }`. The client persists `sessionId` and chat history in `localStorage` (`tc_chat`, `tc_folderPath`) so conversations resume across reloads.

Folder selection uses Electron's native `dialog.showOpenDialog` via `window.tc.pickFolder()` (see Electron host section). In browser-only dev (`npm run dev:web`) the picker returns empty and the user types the path manually.

### create-jira-ticket MCP (`mcp/`)
A standalone MCP stdio server (`create-ticket-server.mjs`) exposing three tools, `create_jira_ticket`, `discover_jira_space`, and `remove_custom_field`. It is **not** loaded by this app's server — it is registered with the user's Claude Code CLI via `npm run mcp:install`, so the CLI invoked by `/api/instruct` (and any other Claude Code session) can call it. Ticket creation logic lives in `mcp/jira-create.js`; HTTP plumbing in `lib/jira-client.js`; field discovery in `lib/jira-discovery.js`. Per-space built-in field IDs (team, sprint, story points, fix versions) are read from `config.json`'s `JIRA_SPACES` map and auto-discovered on first use. Org-specific select-list custom fields land in each space's `customFields` map (keyed by the field's display name, with `fieldId` and `allowedValues`); the MCP `create_jira_ticket` tool exposes them via the `custom_fields` argument. Fields removed via `remove_custom_field` land in the space's `excludedCustomFields` list and are filtered out of every subsequent discovery merge.

### Environment
`.env` lives at the repo root and is loaded by `server.js`, the discovery script, and the MCP server. Use `.env.example` as the template.

### Logging
`logger.js` writes timestamped lines to `app.log` at the repo root and mirrors them to stdout/stderr. Use `logger.info/warn/error(category, message)` rather than `console.*` in server-side code so the log file stays consistent.

### Production serving
The packaged Electron app loads the renderer with `BrowserWindow.loadFile()` straight from the asar (`.vite/renderer/main_window/index.html`); `server.js` is API-only. Renderer → API requests are cross-origin (renderer at `file://` or Vite, API at `http://127.0.0.1:<random>`), so `server.js` enables CORS for `localhost`/`127.0.0.1` origins.

### Electron host (`electron/`)

When run as the desktop app (`npm start` / installed build), an Electron main process wraps the existing stack:

- **Main** (`electron/main.ts`) creates the `BrowserWindow`, spawns `node server.js` as a child on a random localhost port, owns the native folder-picker dialog, registers the bundled MCP with the user's `claude` CLI on first launch, and tears the child down on quit.
- **Preload** (`electron/preload.ts`) exposes a tiny `window.tc` API to the renderer (`pickFolder`, `getServerPort`, `getAppVersion`, `checkForUpdates`, `applyUpdate`, `onUpdateStatus`).
- **Server child** is the unchanged `server.js`, launched with `cwd: app.getPath('userData')` and env vars `PORT=<random>` and `TC_CONFIG_DIR=<userData>`. `config.js` and `logger.js` honor `TC_CONFIG_DIR` so `config.json` and `app.log` live next to each other in `userData`.

Pure helpers in `electron/` (`paths.impl.js`, `free-port.impl.js`, `spawn-args.impl.js`, `mcp-register.impl.js`, `update-checker.impl.js`) are kept in plain CommonJS so they can be unit-tested via `node --test` without an Electron runtime. The `.ts` files in the same folder are thin re-exports for type safety in `main.ts` and `preload.ts`. The `.impl.js` suffix is load-bearing: `vite.main.config.ts` tells Rollup's CommonJS plugin to process files matching `/\.impl\.js$/` so named exports survive bundling.

The `extraResource` list in `forge.config.ts` ships the existing CommonJS server tree (`server.js`, `routes/`, `lib/`, `jira.js`, `config.js`, `logger.js`, `mcp/`) into `process.resourcesPath` so the spawned child can find them.

`/api/browse-folder` no longer exists — the renderer calls `window.tc.pickFolder()` instead.

Update checking is on-demand only — there is no background polling. On Windows, `checkForUpdates` drives Electron's `autoUpdater` pointed at `update.electronjs.org`, giving a real download-and-restart-to-update flow. On macOS/Linux, it instead polls the GitHub Releases API directly and, if a newer version exists, opens the release page in the browser; there is no real Squirrel.Mac auto-update since this repo does no code-signing.

## Setup notes

`setup.ps1` / `setup.sh` exist to bootstrap WSL + Node on a fresh Windows machine. They are not part of normal development and should not be run unless explicitly setting up a new machine.
