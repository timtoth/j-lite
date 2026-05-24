# Local JIRA "create-ticket" MCP Server — Design

**Date:** 2026-04-27
**Status:** Approved (design phase)
**Author:** ttoth@rightsline.com

## Problem

The `ticket-control` app's right-column "Operations" flow shells out to the
`claude` CLI, which historically used a JIRA MCP server for ticket actions.
That MCP is not accessible to this user, so creating tickets via natural-
language instructions has no working path.

## Goal

Add a small, single-purpose MCP server — local to this repo, registered with
Claude Code at user scope — that exposes one tool: `create_jira_ticket`. It
must let the user issue instructions like:

> "Create 3 tickets around implementing consumers for these 3 message
> contracts {…}"

…and have Claude call the tool 3 times, producing real JIRA issues.

## Non-Goals

- No general-purpose JIRA MCP. Only ticket creation.
- No UI form / REST endpoint in the web app for creation.
- No support for updating, transitioning, or commenting on tickets.
- No support for sub-tasks, links, labels, components, fix versions, sprints.

## Architecture

A stdio-based MCP server lives in this repo and reuses `jira.js` for
authentication. Claude Code is registered to launch it via `claude mcp add`
at user scope, so it works from any working directory.

```
ticket-control/
├── jira.js                       (existing — refactor: extract auth helper)
├── mcp/
│   ├── create-ticket-server.js   (new — MCP stdio server, one tool)
│   └── jira-create.js            (new — JIRA create-issue logic + ADF wrapper)
├── scripts/
│   ├── discover-jira-ids.js      (new — one-time bootstrap script)
│   ├── install-mcp.js            (new — registers server with Claude Code)
│   └── smoke-create.js           (new — manual end-to-end smoke test)
└── .env                          (gains JIRA_TEAM_FIELD_ID, JIRA_TEAM_ID,
                                   JIRA_ACCOUNT_ID)
```

The MCP server is a separate Node process from the Express server. They share
only `.env` and (optionally) the refactored auth helper from `jira.js`.

## MCP Tool Contract

**Tool name:** `create_jira_ticket`

**Description (shown to Claude):** "Create a JIRA ticket as a child of an
existing epic. The ticket is automatically assigned to the current user and
tagged to the Unified Platform team."

**Input schema:**

| Arg                | Type   | Required | Notes                                                                 |
|--------------------|--------|----------|-----------------------------------------------------------------------|
| `summary`          | string | yes      | Ticket title.                                                         |
| `description`      | string | yes      | Plain text. Server wraps it in minimal ADF (one paragraph per `\n\n`). |
| `parent_epic_key`  | string | yes      | e.g., `"UP-456"`. Must reference an existing epic.                    |
| `issue_type`       | string | no       | One of `"Story"`, `"Task"`, `"Bug"`. Default `"Story"`.               |

**Output (success):** `{ "key": "UP-789", "url": "https://<host>/browse/UP-789" }`

**Output (failure):** MCP tool error containing a human-readable message
(see *Error Handling* below).

## JIRA Create-Issue Mapping

POST `/rest/api/3/issue` with body:

```json
{
  "fields": {
    "project":     { "key": "<derived>" },
    "summary":     "<summary>",
    "description": <ADF doc>,
    "issuetype":   { "name": "<issue_type>" },
    "parent":      { "key": "<parent_epic_key>" },
    "assignee":    { "accountId": "<JIRA_ACCOUNT_ID>" },
    "<JIRA_TEAM_FIELD_ID>": "<JIRA_TEAM_ID>"
  }
}
```

### Project key derivation

`project.key = parent_epic_key.split("-")[0]`. Reasoning: a child issue in a
different project from its parent epic is not a use case we support.

### ADF wrapping

The description is split on `\n\n` and each chunk becomes a single ADF
`paragraph` containing one `text` node:

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    { "type": "paragraph", "content": [ { "type": "text", "text": "<chunk>" } ] }
  ]
}
```

This matches the inverse of the simple `adfToText` already in `jira.js` and
is sufficient for Claude-generated descriptions. No markdown, lists, or
inline marks in v1.

### Parent linking

Uses `fields.parent.key` (next-gen / team-managed projects). The existing
`getEpicChildren` already queries with `parent = key` as a fallback, so we
know this JIRA instance supports it. If a future project requires the
classic "Epic Link" custom field instead, that becomes a follow-up — not
v1 scope.

## Discovery Script (`scripts/discover-jira-ids.js`)

Run once after first `.env` setup. Idempotent: skips any of the three keys
already present in `.env`.

1. **Field ID** — GET `/rest/api/3/field`, find entry where `name === "Team"`.
   - Save as `JIRA_TEAM_FIELD_ID`.
   - If multiple matches or none, abort with the list of candidates printed.
2. **Team UUID** — GET an existing accessible epic (reusing `getMyEpics`
   logic) that has a non-null Team field, read its team value.
   - Verify the team's display name is `"Unified Platform"`. If not, abort
     with a message instructing the user to manually set `JIRA_TEAM_ID` in
     `.env`.
   - Save as `JIRA_TEAM_ID`.
3. **Account ID** — GET `/rest/api/3/user/search?query=${JIRA_EMAIL}`.
   - Save the first matching `accountId` as `JIRA_ACCOUNT_ID`.

Output: appends only the missing keys to `.env`. Failures print the JIRA
response body for diagnosis.

## Registration With Claude Code

User-scope registration so the tool works regardless of the `cwd` the
right-column flow targets:

```
claude mcp add -s user create-jira-ticket -- node "<absolute path>/mcp/create-ticket-server.js"
```

Wired up as an npm script:

```json
"scripts": {
  "mcp:install": "node scripts/install-mcp.js",
  "mcp:discover": "node scripts/discover-jira-ids.js"
}
```

`scripts/install-mcp.js` resolves the absolute path to the server file and
invokes `claude mcp add` via `child_process`.

`setup.sh` and `setup.ps1` gain a step that runs `npm run mcp:discover`
followed by `npm run mcp:install`.

## Error Handling

The MCP server catches HTTP errors from JIRA and returns a tool error with
a clean message so Claude can react and self-correct:

| JIRA response                              | Tool error message                                                |
|--------------------------------------------|-------------------------------------------------------------------|
| 404 on the epic key                        | `Parent epic <key> not found`                                     |
| 401 / 403                                  | `JIRA auth failed; regenerate JIRA_API_TOKEN`                     |
| 400 with field-level errors                | `JIRA rejected the request: <verbatim error body>`                |
| Network / timeout                          | `Could not reach JIRA: <message>`                                 |
| Missing env (`JIRA_TEAM_FIELD_ID`, etc.)   | `MCP not configured; run npm run mcp:discover`                    |

All diagnostic logging goes to **stderr** — the MCP protocol reserves
stdout for JSON-RPC messages.

## Testing

- **Unit (pure functions, no network):**
  - ADF wrapping: empty string, single paragraph, multiple paragraphs.
  - Project-key derivation from epic keys.
  - `.env` append logic in `discover-jira-ids.js` (skips existing keys).
- **Manual smoke test:** `scripts/smoke-create.js` creates one throwaway
  ticket against a configurable parent epic, prints the URL, and exits.
  Run before declaring the feature done; not part of CI.

## Open Questions / Follow-ups

- Description formatting beyond paragraphs (lists, code blocks) — out of
  scope for v1; revisit if Claude's outputs end up needing it.
- Support for the classic "Epic Link" custom field — only if a future
  project requires it.
- Bulk-create endpoint — JIRA supports `/rest/api/3/issue/bulk`. Not used
  in v1 because Claude calling the tool N times is simpler and gives
  per-ticket error feedback.
