# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted.

- `npm run dev` — runs the Express API (`node --watch server.js` on port 3000) and the Vite dev server (port 5173) concurrently. The Vite config proxies `/api` to `:3000`, so use `http://localhost:5173` during development.
- `npm run build` — type-checks and builds the React client into `client/dist/`. The Express server serves that directory in production via `npm start`.
- `npm start` — runs the production server only; requires a prior `npm run build`.
- `npm test` — runs all `node --test` suites (currently `mcp/*.test.js`). Run a single file with `node --test mcp/jira-create.test.js`. Filter to one test with `node --test --test-name-pattern="<regex>"`.
- `npm run mcp:discover` — one-time discovery script. Calls JIRA to populate `JIRA_TEAM_FIELD_ID`, `JIRA_TEAM_ID`, and `JIRA_ACCOUNT_ID` in `.env`. Required before the create-ticket MCP will work.
- `npm run mcp:install` — registers `mcp/create-ticket-server.mjs` with the local Claude Code CLI at user scope (idempotent).
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

Folder selection on Windows uses a PowerShell `FolderBrowserDialog` shelled out from `GET /api/browse-folder`.

### create-jira-ticket MCP (`mcp/`)
A standalone MCP stdio server (`create-ticket-server.mjs`) exposing one tool, `create_jira_ticket`. It is **not** loaded by this app's server — it is registered with the user's Claude Code CLI via `npm run mcp:install`, so the CLI invoked by `/api/instruct` (and any other Claude Code session) can call it. Ticket creation logic lives in `mcp/jira-create.js`; HTTP plumbing in `lib/jira-client.js`. The tool requires the discovered env vars (`JIRA_TEAM_FIELD_ID`, `JIRA_TEAM_ID`, `JIRA_ACCOUNT_ID`, `JIRA_PRODUCT_FIELD_ID`) — without them it throws "MCP not configured; run npm run mcp:discover".

### Environment
`.env` lives at the repo root and is loaded by `server.js`, the discovery script, and the MCP server. Use `.env.example` as the template. `JIRA_PRODUCT_FIELD_ID=customfield_12037` is a fixed instance-specific custom field.

### Logging
`logger.js` writes timestamped lines to `app.log` at the repo root and mirrors them to stdout/stderr. Use `logger.info/warn/error(category, message)` rather than `console.*` in server-side code so the log file stays consistent.

### Production serving
`server.js` mounts the API routers and then a catch-all `app.get("*")` that serves `client/dist/index.html`, so client routes work on hard refresh once `npm run build` has been run.

## Setup notes

`setup.ps1` / `setup.sh` exist to bootstrap WSL + Node on a fresh Windows machine. They are not part of normal development and should not be run unless explicitly setting up a new machine.
