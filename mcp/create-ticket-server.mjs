#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import config from "../config.js";
import { jiraRequest, getJiraBaseUrl } from "../lib/jira-client.js";
import { createJiraTicket } from "./jira-create.js";
import jiraDiscovery from "../lib/jira-discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CREATE_TOOL = {
  name: "create_jira_ticket",
  description:
    "Create a JIRA ticket as a child of an existing epic. The space is " +
    "inferred from the parent epic key (e.g. ABC-456 → space ABC). Built-in " +
    "fields (team, sprint, story points, fix versions) are auto-discovered " +
    "from the space's create screens. Org-specific select-list custom fields " +
    "are passed via `custom_fields` as { fieldName: value } pairs. " +
    "IMPORTANT: spaces often have REQUIRED custom fields (e.g. Product). " +
    "Call `discover_jira_space` first to learn which fields are required " +
    "and what allowedValues they accept — entries with `required: true` " +
    "must be supplied in `custom_fields` or creation will fail.",
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

const REMOVE_CUSTOM_FIELD_TOOL = {
  name: "remove_custom_field",
  description:
    "Permanently remove a custom field from a space's discovered configuration. " +
    "Use this when a field was incorrectly discovered as a custom field (e.g. it is " +
    "actually a JIRA system field) or is otherwise not needed. The field will not " +
    "reappear on future discovery runs for this space.",
  inputSchema: {
    type: "object",
    properties: {
      space_key:  { type: "string", description: "Project key, e.g. ABC, XYZ." },
      field_name: { type: "string", description: "Custom field display name (case-insensitive), e.g. \"Project\"." },
    },
    required: ["space_key", "field_name"],
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
    discoverSpace: (k) => jiraDiscovery.discoverSpaceFields(jiraRequest, k),
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

async function handleDiscover(args) {
  const spaceKey = args?.space_key;
  if (!spaceKey) throw new Error("space_key is required");
  const fresh = await jiraDiscovery.discoverSpaceFields(jiraRequest, spaceKey);
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  const merged = {
    ...jiraDiscovery.mergeSpaceRecord(existing, fresh),
    discoveredAt: new Date().toISOString(),
  };
  config.setSpace(spaceKey, merged);
  return { content: [{ type: "text", text: JSON.stringify(merged) }] };
}

async function handleRemoveCustomField(args) {
  const spaceKey = args?.space_key;
  const fieldName = args?.field_name;
  if (!spaceKey) throw new Error("space_key is required");
  if (!fieldName) throw new Error("field_name is required");
  const updated = config.excludeCustomField(spaceKey, fieldName);
  if (!updated) throw new Error(`Unknown space: ${spaceKey}`);
  return { content: [{ type: "text", text: JSON.stringify(updated) }] };
}

const server = new Server(
  { name: "create-jira-ticket", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [CREATE_TOOL, DISCOVER_TOOL, REMOVE_CUSTOM_FIELD_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === CREATE_TOOL.name) return await handleCreate(request.params.arguments);
    if (request.params.name === DISCOVER_TOOL.name) return await handleDiscover(request.params.arguments);
    if (request.params.name === REMOVE_CUSTOM_FIELD_TOOL.name) return await handleRemoveCustomField(request.params.arguments);
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: formatError(err) }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[create-jira-ticket] MCP server listening on stdio");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { handleCreate, handleDiscover, handleRemoveCustomField };
