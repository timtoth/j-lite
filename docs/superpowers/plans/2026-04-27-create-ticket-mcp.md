# Create-Ticket MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small local stdio-based MCP server exposing one tool, `create_jira_ticket`, registered with Claude Code at user scope so the right-column "Operations" flow can create JIRA tickets via natural-language instructions.

**Architecture:** A new `mcp/` directory holds the MCP server (`create-ticket-server.mjs`) and its pure logic (`jira-create.js`). A new `lib/jira-client.js` wraps authenticated JIRA requests for write operations and is reused by the MCP server, the discovery script, and the smoke test. Existing `jira.js` is left untouched to avoid disturbing the working read paths.

**Tech Stack:**
- Node 22 (built-in `fetch`, built-in `node:test`)
- `@modelcontextprotocol/sdk` (ESM) — added as a dependency
- Existing `dotenv` for `.env` loading
- Atlassian JIRA Cloud REST API v3 (auth: Basic with email + API token)

**Note on git:** This project is not currently a git repository, so the standard `git commit` step is replaced with a **Verify** step at the end of each task. Run any verification commands and confirm output matches expectations before moving on.

**Note on Windows setup:** `setup.ps1` delegates to `setup.sh` via WSL, so all setup-script changes go in `setup.sh`. PowerShell stays untouched.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `lib/jira-client.js` | new | Generic authenticated JIRA request helper (`jiraRequest`, `getJiraBaseUrl`) for write operations. |
| `mcp/jira-create.js` | new | Pure helpers (`wrapDescriptionAsAdf`, `deriveProjectKey`) and the `createJiraTicket` orchestrator. CommonJS, fully unit-testable. |
| `mcp/jira-create.test.js` | new | Unit tests for the above using `node:test`. |
| `mcp/create-ticket-server.mjs` | new | MCP stdio server entry point. ESM (the SDK is ESM-only). |
| `scripts/discover-jira-ids.js` | new | One-time bootstrap: writes `JIRA_TEAM_FIELD_ID`, `JIRA_TEAM_ID`, `JIRA_ACCOUNT_ID` into `.env`. |
| `scripts/install-mcp.js` | new | Wraps `claude mcp add -s user …` with the absolute server path. |
| `scripts/smoke-create.js` | new | Manual end-to-end test: creates one throwaway ticket. |
| `package.json` | modify | Add `@modelcontextprotocol/sdk` dep + four npm scripts (`test`, `mcp:discover`, `mcp:install`, `mcp:smoke`). |
| `.env.example` | modify | Add three placeholder vars. |
| `setup.sh` | modify | Append discovery + install steps after build. |
| `jira.js` | unchanged | Working code; leave alone. |

---

## Task 1: Add MCP SDK dependency and npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the MCP SDK**

Run from repo root:
```bash
npm install @modelcontextprotocol/sdk
```
Expected: `package.json` and `package-lock.json` updated; new entry under `dependencies` for `@modelcontextprotocol/sdk`.

- [ ] **Step 2: Add the four npm scripts**

In `package.json`, replace the `"scripts"` block with:
```json
"scripts": {
  "start": "node server.js",
  "dev": "concurrently \"node --watch server.js\" \"npm run dev --prefix client\"",
  "build": "npm run build --prefix client",
  "test": "node --test mcp/",
  "mcp:discover": "node scripts/discover-jira-ids.js",
  "mcp:install": "node scripts/install-mcp.js",
  "mcp:smoke": "node scripts/smoke-create.js"
}
```

- [ ] **Step 3: Verify**

Run:
```bash
npm test
```
Expected: exits successfully with `tests 0` (no test files yet — that's fine; we just want `node --test` to be reachable). If it errors that the `mcp/` directory doesn't exist, create an empty placeholder file `mcp/.gitkeep` and re-run.

---

## Task 2: Create `lib/jira-client.js`

**Files:**
- Create: `lib/jira-client.js`

- [ ] **Step 1: Create the file**

Create `lib/jira-client.js` with:
```js
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

function getAuthHeader() {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Missing JIRA env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN");
  }
  const encoded = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

async function jiraRequest(method, path, body) {
  const url = `${JIRA_BASE_URL}${path}`;
  const init = {
    method,
    headers: {
      Authorization: getAuthHeader(),
      Accept: "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  }
  if (!res.ok) {
    const err = new Error(`JIRA ${method} ${path} -> ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed;
}

function getJiraBaseUrl() {
  return JIRA_BASE_URL;
}

module.exports = { jiraRequest, getJiraBaseUrl };
```

- [ ] **Step 2: Verify**

Run:
```bash
node -e "require('./lib/jira-client.js'); console.log('ok')"
```
Expected: prints `ok` (no syntax errors). The module reads env at load time but only validates inside `jiraRequest`, so requiring it without env set is fine.

---

## Task 3: Create pure helpers in `mcp/jira-create.js` (TDD)

**Files:**
- Create: `mcp/jira-create.test.js`
- Create: `mcp/jira-create.js`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `mcp/jira-create.test.js` with:
```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { wrapDescriptionAsAdf, deriveProjectKey } = require("./jira-create");

test("wrapDescriptionAsAdf wraps single paragraph", () => {
  const result = wrapDescriptionAsAdf("hello world");
  assert.deepEqual(result, {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
    ],
  });
});

test("wrapDescriptionAsAdf splits on blank lines", () => {
  const result = wrapDescriptionAsAdf("first paragraph\n\nsecond paragraph");
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].content[0].text, "first paragraph");
  assert.equal(result.content[1].content[0].text, "second paragraph");
});

test("wrapDescriptionAsAdf preserves single newlines inside a paragraph", () => {
  const result = wrapDescriptionAsAdf("line one\nline two");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].content[0].text, "line one\nline two");
});

test("wrapDescriptionAsAdf returns one empty paragraph for empty input", () => {
  const result = wrapDescriptionAsAdf("");
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.content[0].content, []);
});

test("deriveProjectKey extracts prefix", () => {
  assert.equal(deriveProjectKey("UP-456"), "UP");
  assert.equal(deriveProjectKey("ABC123-9"), "ABC123");
});

test("deriveProjectKey rejects malformed keys", () => {
  assert.throws(() => deriveProjectKey("bad"), /Invalid parent epic key/);
  assert.throws(() => deriveProjectKey(""), /required/);
  assert.throws(() => deriveProjectKey(null), /required/);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```bash
npm test
```
Expected: failures referencing "Cannot find module './jira-create'".

- [ ] **Step 3: Implement the helpers**

Create `mcp/jira-create.js` with:
```js
function wrapDescriptionAsAdf(text) {
  const value = text ?? "";
  const trimmed = value.trim();
  const paragraphs = trimmed.length === 0
    ? [""]
    : trimmed.split(/\n\s*\n/);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p === "" ? [] : [{ type: "text", text: p }],
    })),
  };
}

function deriveProjectKey(parentEpicKey) {
  if (!parentEpicKey || typeof parentEpicKey !== "string") {
    throw new Error("parent_epic_key is required");
  }
  const match = parentEpicKey.match(/^([A-Z][A-Z0-9]+)-\d+$/);
  if (!match) {
    throw new Error(`Invalid parent epic key: ${parentEpicKey}`);
  }
  return match[1];
}

module.exports = { wrapDescriptionAsAdf, deriveProjectKey };
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```bash
npm test
```
Expected: all tests pass.

---

## Task 4: Add `createJiraTicket` to `mcp/jira-create.js` (TDD)

**Files:**
- Modify: `mcp/jira-create.test.js`
- Modify: `mcp/jira-create.js`

- [ ] **Step 1: Append failing tests for `createJiraTicket`**

Append to `mcp/jira-create.test.js`:
```js
const { createJiraTicket } = require("./jira-create");

function makeDeps(overrides = {}) {
  let captured = null;
  const deps = {
    jiraRequest: async (method, path, body) => {
      captured = { method, path, body };
      return { key: "UP-789" };
    },
    getJiraBaseUrl: () => "https://example.atlassian.net",
    env: {
      JIRA_TEAM_FIELD_ID: "customfield_10001",
      JIRA_TEAM_ID: "team-uuid-123",
      JIRA_ACCOUNT_ID: "account-abc",
      ...overrides,
    },
  };
  return { deps, getCaptured: () => captured };
}

test("createJiraTicket builds expected POST body and returns key + url", async () => {
  const { deps, getCaptured } = makeDeps();
  const result = await createJiraTicket(
    { summary: "Implement consumer", description: "Do the thing.", parent_epic_key: "UP-456" },
    deps,
  );
  const captured = getCaptured();
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/rest/api/3/issue");
  assert.equal(captured.body.fields.project.key, "UP");
  assert.equal(captured.body.fields.summary, "Implement consumer");
  assert.equal(captured.body.fields.parent.key, "UP-456");
  assert.equal(captured.body.fields.issuetype.name, "Story");
  assert.equal(captured.body.fields.assignee.accountId, "account-abc");
  assert.equal(captured.body.fields.customfield_10001, "team-uuid-123");
  assert.equal(captured.body.fields.description.type, "doc");
  assert.deepEqual(result, { key: "UP-789", url: "https://example.atlassian.net/browse/UP-789" });
});

test("createJiraTicket honors issue_type override", async () => {
  const { deps, getCaptured } = makeDeps();
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "UP-1", issue_type: "Bug" },
    deps,
  );
  assert.equal(getCaptured().body.fields.issuetype.name, "Bug");
});

test("createJiraTicket rejects unknown issue_type", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "UP-1", issue_type: "Epic" },
      deps,
    ),
    /issue_type must be one of/,
  );
});

test("createJiraTicket fails fast when env IDs missing", async () => {
  const { deps } = makeDeps({ JIRA_TEAM_ID: undefined });
  await assert.rejects(
    createJiraTicket({ summary: "x", description: "y", parent_epic_key: "UP-1" }, deps),
    /MCP not configured/,
  );
});

test("createJiraTicket validates required arg presence", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    createJiraTicket({ description: "y", parent_epic_key: "UP-1" }, deps),
    /summary is required/,
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```bash
npm test
```
Expected: failures referencing `createJiraTicket is not a function`.

- [ ] **Step 3: Implement `createJiraTicket`**

In `mcp/jira-create.js`, replace the existing `module.exports` line and add the function above it:
```js
const ALLOWED_ISSUE_TYPES = new Set(["Story", "Task", "Bug"]);

async function createJiraTicket(args, deps) {
  const { jiraRequest, getJiraBaseUrl, env } = deps;
  const teamFieldId = env.JIRA_TEAM_FIELD_ID;
  const teamId = env.JIRA_TEAM_ID;
  const accountId = env.JIRA_ACCOUNT_ID;
  if (!teamFieldId || !teamId || !accountId) {
    throw new Error("MCP not configured; run npm run mcp:discover");
  }

  const { summary, description, parent_epic_key, issue_type = "Story" } = args ?? {};
  if (!summary) throw new Error("summary is required");
  if (!description) throw new Error("description is required");
  if (!parent_epic_key) throw new Error("parent_epic_key is required");
  if (!ALLOWED_ISSUE_TYPES.has(issue_type)) {
    throw new Error(`issue_type must be one of: ${[...ALLOWED_ISSUE_TYPES].join(", ")}`);
  }

  const projectKey = deriveProjectKey(parent_epic_key);

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description: wrapDescriptionAsAdf(description),
      issuetype: { name: issue_type },
      parent: { key: parent_epic_key },
      assignee: { accountId },
      [teamFieldId]: teamId,
    },
  };

  const result = await jiraRequest("POST", "/rest/api/3/issue", body);
  return {
    key: result.key,
    url: `${getJiraBaseUrl()}/browse/${result.key}`,
  };
}

module.exports = { wrapDescriptionAsAdf, deriveProjectKey, createJiraTicket };
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```bash
npm test
```
Expected: all tests pass (8 total: 6 from Task 3 + 5 new ones — actually 11 total).

---

## Task 5: Build the MCP stdio server (`mcp/create-ticket-server.mjs`)

**Files:**
- Create: `mcp/create-ticket-server.mjs`

- [ ] **Step 1: Create the server file**

Create `mcp/create-ticket-server.mjs` with:
```js
#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const require = createRequire(import.meta.url);
const { jiraRequest, getJiraBaseUrl } = require("../lib/jira-client.js");
const { createJiraTicket } = require("./jira-create.js");

const TOOL = {
  name: "create_jira_ticket",
  description:
    "Create a JIRA ticket as a child of an existing epic. The ticket is " +
    "automatically assigned to the current user and tagged to the Unified " +
    "Platform team.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Ticket title." },
      description: {
        type: "string",
        description: "Plain-text body. Use blank lines between paragraphs.",
      },
      parent_epic_key: {
        type: "string",
        description: "Existing epic key, e.g. UP-456. Determines the project.",
      },
      issue_type: {
        type: "string",
        enum: ["Story", "Task", "Bug"],
        description: "Issue type. Defaults to Story.",
      },
    },
    required: ["summary", "description", "parent_epic_key"],
  },
};

function formatError(err) {
  if (err.status === 401 || err.status === 403) {
    return "JIRA auth failed; regenerate JIRA_API_TOKEN.";
  }
  if (err.status === 404) {
    const msg = err.body?.errorMessages?.[0] ?? err.message;
    return `Parent epic not found: ${msg}`;
  }
  if (err.status === 400) {
    return `JIRA rejected the request: ${JSON.stringify(err.body)}`;
  }
  return err.message ?? String(err);
}

const server = new Server(
  { name: "create-jira-ticket", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL.name) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  try {
    const result = await createJiraTicket(request.params.arguments ?? {}, {
      jiraRequest,
      getJiraBaseUrl,
      env: process.env,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: formatError(err) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[create-jira-ticket] MCP server listening on stdio");
```

- [ ] **Step 2: Smoke-load the server (no live JIRA call)**

Run:
```bash
node -e "import('./mcp/create-ticket-server.mjs').then(()=>console.error('loaded'))" &
sleep 1
kill %1 2>/dev/null
```
Expected: stderr prints `[create-jira-ticket] MCP server listening on stdio` (and `loaded`). On Windows bash from the prompt, you can also just run `node mcp/create-ticket-server.mjs` and Ctrl+C — you should see the listening message before the process is killed.

---

## Task 6: Build the discovery script

**Files:**
- Create: `scripts/discover-jira-ids.js`

- [ ] **Step 1: Create the script**

Create `scripts/discover-jira-ids.js` with:
```js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("node:fs");
const { jiraRequest } = require("../lib/jira-client");

const ENV_PATH = path.join(__dirname, "..", ".env");

async function findTeamFieldId() {
  const fields = await jiraRequest("GET", "/rest/api/3/field");
  const matches = fields.filter((f) => f.name === "Team");
  if (matches.length === 0) {
    throw new Error("No 'Team' custom field found in this JIRA instance.");
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => m.id).join(", ");
    throw new Error(`Multiple 'Team' fields found: ${ids}. Set JIRA_TEAM_FIELD_ID manually in .env.`);
  }
  return matches[0].id;
}

async function findUnifiedPlatformTeamId(fieldId, email) {
  const jql = `assignee = "${email}" AND "${fieldId}" is not EMPTY`;
  const url = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fieldId)}&maxResults=20`;
  const data = await jiraRequest("GET", url);
  const issues = data.issues ?? [];
  for (const issue of issues) {
    const v = issue.fields?.[fieldId];
    if (!v) continue;
    const id = typeof v === "string" ? v : (v.id ?? v.value ?? v.teamId);
    const name = typeof v === "object" ? (v.name ?? v.title) : null;
    if (name && name !== "Unified Platform") continue;
    if (!id) continue;
    return { id, name: name ?? "(unknown name)" };
  }
  throw new Error(
    "Could not auto-discover the Unified Platform team UUID. " +
    "Open any JIRA issue with Team=Unified Platform, copy the team UUID from the URL or API, " +
    "and set JIRA_TEAM_ID in .env manually."
  );
}

async function findAccountId(email) {
  const data = await jiraRequest(
    "GET",
    `/rest/api/3/user/search?query=${encodeURIComponent(email)}`
  );
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No JIRA user found for ${email}`);
  }
  return data[0].accountId;
}

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  const map = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] !== "") map[m[1]] = m[2];
  }
  return map;
}

function appendEnv(updates) {
  const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  if (content && !content.endsWith("\n")) content += "\n";
  for (const [k, v] of entries) {
    content += `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

async function main() {
  const existing = readEnvFile();
  const updates = {};

  if (!existing.JIRA_TEAM_FIELD_ID) {
    console.log("Discovering JIRA_TEAM_FIELD_ID...");
    updates.JIRA_TEAM_FIELD_ID = await findTeamFieldId();
    console.log(`  -> ${updates.JIRA_TEAM_FIELD_ID}`);
  } else {
    console.log(`JIRA_TEAM_FIELD_ID already set: ${existing.JIRA_TEAM_FIELD_ID}`);
  }

  if (!existing.JIRA_TEAM_ID) {
    const fieldId = updates.JIRA_TEAM_FIELD_ID ?? existing.JIRA_TEAM_FIELD_ID;
    console.log("Discovering JIRA_TEAM_ID (Unified Platform)...");
    const team = await findUnifiedPlatformTeamId(fieldId, process.env.JIRA_EMAIL);
    updates.JIRA_TEAM_ID = team.id;
    console.log(`  -> ${team.id} (${team.name})`);
  } else {
    console.log(`JIRA_TEAM_ID already set: ${existing.JIRA_TEAM_ID}`);
  }

  if (!existing.JIRA_ACCOUNT_ID) {
    console.log(`Discovering JIRA_ACCOUNT_ID for ${process.env.JIRA_EMAIL}...`);
    updates.JIRA_ACCOUNT_ID = await findAccountId(process.env.JIRA_EMAIL);
    console.log(`  -> ${updates.JIRA_ACCOUNT_ID}`);
  } else {
    console.log(`JIRA_ACCOUNT_ID already set: ${existing.JIRA_ACCOUNT_ID}`);
  }

  appendEnv(updates);
  console.log("\nDone. Discovered values appended to .env.");
}

main().catch((err) => {
  console.error("Discovery failed:", err.message);
  if (err.body) console.error("Response:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script loads**

Run:
```bash
node -e "require('./scripts/discover-jira-ids.js'); console.log('loaded')" 2>&1 | head -20
```
Note: this will actually try to run `main()` because the file is structured as a top-level script, so it will hit the network. Skip this and instead verify syntactically:
```bash
node --check scripts/discover-jira-ids.js
```
Expected: no output on success.

---

## Task 7: Build the install script

**Files:**
- Create: `scripts/install-mcp.js`

- [ ] **Step 1: Create the script**

Create `scripts/install-mcp.js` with:
```js
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "mcp", "create-ticket-server.mjs");

console.log("Registering create-jira-ticket MCP with Claude Code (user scope)...");
console.log(`  Server: ${serverPath}`);

const result = spawnSync(
  "claude",
  ["mcp", "add", "-s", "user", "create-jira-ticket", "--", "node", serverPath],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (result.error) {
  console.error("Failed to invoke 'claude':", result.error.message);
  console.error("Make sure Claude Code is installed and 'claude' is on your PATH.");
  process.exit(1);
}
process.exit(result.status ?? 1);
```

- [ ] **Step 2: Syntax-verify**

Run:
```bash
node --check scripts/install-mcp.js
```
Expected: no output.

---

## Task 8: Build the smoke-test script

**Files:**
- Create: `scripts/smoke-create.js`

- [ ] **Step 1: Create the script**

Create `scripts/smoke-create.js` with:
```js
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { jiraRequest, getJiraBaseUrl } = require("../lib/jira-client");
const { createJiraTicket } = require("../mcp/jira-create");

async function main() {
  const parent = process.argv[2];
  if (!parent) {
    console.error("Usage: node scripts/smoke-create.js <PARENT_EPIC_KEY>");
    process.exit(1);
  }
  const result = await createJiraTicket(
    {
      summary: "Smoke test ticket — safe to close",
      description:
        "Created by scripts/smoke-create.js to verify the create-ticket MCP path works.\n\nSafe to close immediately.",
      parent_epic_key: parent,
    },
    { jiraRequest, getJiraBaseUrl, env: process.env },
  );
  console.log("Created:", result);
}

main().catch((err) => {
  console.error("Smoke test failed:", err.message);
  if (err.body) console.error("Response:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
```

- [ ] **Step 2: Syntax-verify**

Run:
```bash
node --check scripts/smoke-create.js
```
Expected: no output.

---

## Task 9: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the new placeholder vars**

The current file is:
```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
PORT=3000
```

Replace its contents with:
```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
PORT=3000

# Populated by `npm run mcp:discover`. Leave blank initially.
JIRA_TEAM_FIELD_ID=
JIRA_TEAM_ID=
JIRA_ACCOUNT_ID=
```

- [ ] **Step 2: Verify**

Run:
```bash
cat .env.example
```
Expected: file shows the three new keys with empty values and the comment.

---

## Task 10: Update `setup.sh`

**Files:**
- Modify: `setup.sh`

- [ ] **Step 1: Add the discovery + install steps**

Find the line `npm run build` in `setup.sh`. Insert the following block immediately *after* the `# Build client` block (which ends with `npm run build`) and *before* the line `echo ""` that precedes `=== Setup Complete ===`:

```bash

# Discover JIRA team/account IDs if not yet populated
if grep -qE '^(JIRA_TEAM_FIELD_ID|JIRA_TEAM_ID|JIRA_ACCOUNT_ID)=$' .env 2>/dev/null; then
  echo ""
  echo "Discovering JIRA Team/Account IDs..."
  npm run mcp:discover || echo "** Discovery failed; run 'npm run mcp:discover' manually after fixing .env. **"
fi

# Register the create-ticket MCP with Claude Code (user scope)
if command -v claude &> /dev/null; then
  echo ""
  echo "Registering create-jira-ticket MCP with Claude Code..."
  npm run mcp:install || echo "** MCP registration failed; run 'npm run mcp:install' manually later. **"
else
  echo ""
  echo "** 'claude' not found on PATH — skipping MCP registration. **"
  echo "   Run 'npm run mcp:install' after Claude Code is installed."
fi
```

- [ ] **Step 2: Verify**

Run:
```bash
bash -n setup.sh
```
Expected: no output (script parses cleanly).

---

## Task 11: End-to-end manual verification

This task is manual — there's no automated way to verify the live JIRA + Claude Code pipeline.

- [ ] **Step 1: Run unit tests**

Run:
```bash
npm test
```
Expected: all 11 tests pass.

- [ ] **Step 2: Run discovery against real JIRA**

Make sure `.env` already has working `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and that the three new keys exist but are empty (per Task 9). Then:
```bash
npm run mcp:discover
```
Expected: prints discovered values, appends `JIRA_TEAM_FIELD_ID`, `JIRA_TEAM_ID`, `JIRA_ACCOUNT_ID` to `.env`. Confirm by opening `.env` and verifying the three keys now have non-empty values.

If discovery fails on `JIRA_TEAM_ID` (e.g., none of your epics has Team=Unified Platform set), follow the printed instructions: find a ticket with Team set in the JIRA UI, copy the team UUID, paste it into `.env` as `JIRA_TEAM_ID=<uuid>`, then re-run discovery to fill in the rest.

- [ ] **Step 3: Smoke-create a real ticket**

Pick any accessible epic key (e.g., one returned by the existing app's epic list) and run:
```bash
npm run mcp:smoke -- <EPIC_KEY>
```
Expected: prints `Created: { key: '<NEW-KEY>', url: '<browse url>' }`. Open the URL in a browser and confirm:
- Parent is the epic you specified
- Assignee is you
- Team is "Unified Platform"
- Issue type is "Story"
- Title and description match the smoke-test text

Close the ticket manually after verifying.

- [ ] **Step 4: Register with Claude Code**

Run:
```bash
npm run mcp:install
```
Expected: `claude mcp add` succeeds. Verify by running:
```bash
claude mcp list
```
Expected: output includes `create-jira-ticket`.

- [ ] **Step 5: Trigger a real create through the app**

Start the app (`npm start`), open it in the browser, and in the right column, type something like:
> Create one Story under <EPIC_KEY> titled "Wire up consumer for OrderPlaced contract" with a one-paragraph description explaining we need to subscribe and persist incoming events. Just one ticket.

Submit. Expected: response confirms the ticket was created with a key and URL. Click through and verify the ticket exists in JIRA with the right fields. Close it manually.

- [ ] **Step 6: Trigger the multi-create use case**

In the right column:
> Create 3 Stories under <EPIC_KEY> for implementing consumers for these message contracts: OrderPlaced, OrderCancelled, OrderShipped. Each ticket should describe what subscription and persistence work is needed for that specific contract.

Expected: three tickets are created, each with a sensible distinct description. Close them manually after verifying.

---

## Self-Review Notes

**Spec coverage:**
- §2 Tool Contract → Task 5 (server + schema), Task 4 (validation logic). ✓
- §3 JIRA mapping → Task 4 (`createJiraTicket`), Task 3 (`wrapDescriptionAsAdf`, `deriveProjectKey`). ✓
- §4 Discovery script → Task 6. ✓
- §5 Registration → Task 7 + setup.sh in Task 10. ✓
- §6 Error handling → Task 5 (`formatError`) + Task 4 (validation errors). ✓
- §7 Testing → Tasks 3, 4 (unit), Task 8 + Task 11 (smoke). ✓

**Type/name consistency:**
- `jiraRequest(method, path, body)` — same signature in `lib/jira-client.js`, server, discovery script, smoke script.
- `createJiraTicket(args, deps)` — `deps = { jiraRequest, getJiraBaseUrl, env }` consistent across all callers.
- `wrapDescriptionAsAdf` and `deriveProjectKey` — same names in tests and implementation.

**Spec deviation:**
- The spec said "refactor `jira.js` to extract auth helper". The plan instead introduces a new `lib/jira-client.js` and leaves `jira.js` untouched. Same intent (shared auth/request helper for write operations), lower risk to working read paths.
