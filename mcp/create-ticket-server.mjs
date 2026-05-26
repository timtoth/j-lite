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
const config = require("../config");
const { jiraRequest, getJiraBaseUrl } = require("../lib/jira-client.js");
const { createJiraTicket } = require("./jira-create.js");
const { discoverSpaceFields } = require("../lib/jira-discovery.js");

const CREATE_TOOL = {
  name: "create_jira_ticket",
  description:
    "Create a JIRA ticket as a child of an existing epic. The space is " +
    "inferred from the parent epic key (e.g. ABC-456 → space ABC). Built-in " +
    "fields (team, sprint, story points, fix versions) are auto-discovered " +
    "from the space's create screens. Org-specific select-list custom fields " +
    "are passed via `custom_fields` as { fieldName: value } pairs — call " +
    "`discover_jira_space` first to learn which fields and values a given " +
    "space accepts.",
  inputSchema: {
    type: "object",
    properties: {
      summary:         { type: "string", description: "Ticket title." },
      description:     { type: "string", description: "Plain-text body." },
      parent_epic_key: { type: "string", description: "Existing epic key, e.g. ABC-456." },
      issue_type:      { type: "string", enum: ["Story", "Task", "Bug"] },
      custom_fields: {
        type: "object",
        description:
          "Optional map of org-specific custom field values. Keys are the " +
          "field's display name (case-insensitive). Values must be strings " +
          "and must match the field's allowedValues from discovery.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["summary", "description", "parent_epic_key"],
  },
};

const DISCOVER_TOOL = {
  name: "discover_jira_space",
  description:
    "Run discovery for a JIRA space (project key) — finds the custom-field " +
    "IDs needed for ticket creation. Persists the result. Use when the user " +
    "mentions a project you haven't seen before.",
  inputSchema: {
    type: "object",
    properties: {
      space_key: { type: "string", description: "Project key, e.g. ABC, XYZ." },
    },
    required: ["space_key"],
  },
};

function formatError(err) {
  if (err.status === 401 || err.status === 403) return "JIRA auth failed; regenerate JIRA_API_TOKEN.";
  if (err.status === 404) return `Not found: ${err.body?.errorMessages?.[0] ?? err.message}`;
  if (err.status === 400) return `JIRA rejected the request: ${JSON.stringify(err.body)}`;
  if (!err.status) return `Could not reach JIRA: ${err.message ?? String(err)}`;
  return err.message ?? String(err);
}

async function handleCreate(args) {
  const result = await createJiraTicket(args ?? {}, {
    jiraRequest,
    getJiraBaseUrl,
    env: config.getAll(),
    getSpace: (k) => config.getSpace(k),
    setSpace: (k, r) => config.setSpace(k, { ...r, discoveredAt: new Date().toISOString() }),
    discoverSpace: (k) => discoverSpaceFields(jiraRequest, k),
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

async function handleDiscover(args) {
  const spaceKey = args?.space_key;
  if (!spaceKey) throw new Error("space_key is required");
  const fresh = await discoverSpaceFields(jiraRequest, spaceKey);
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  const merged = {
    teamId: existing.teamId || fresh.teamId,
    fields: { ...existing.fields, ...fresh.fields },
    discoveredAt: new Date().toISOString(),
  };
  config.setSpace(spaceKey, merged);
  return { content: [{ type: "text", text: JSON.stringify(merged) }] };
}

const server = new Server(
  { name: "create-jira-ticket", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [CREATE_TOOL, DISCOVER_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === CREATE_TOOL.name) return await handleCreate(request.params.arguments);
    if (request.params.name === DISCOVER_TOOL.name) return await handleDiscover(request.params.arguments);
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: formatError(err) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[create-jira-ticket] MCP server listening on stdio");
