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

const TOOL = {
  name: "create_jira_ticket",
  description:
    "Create a JIRA ticket as a child of an existing epic. The ticket is " +
    "automatically assigned to the current user and tagged to the Unified " +
    "Platform team. Product defaults to Rightsline unless the caller asks " +
    "for Alliant.",
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
      product: {
        type: "string",
        enum: ["Rightsline", "Alliant"],
        description: "Product the ticket belongs to. Defaults to Rightsline.",
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
  if (!err.status) {
    return `Could not reach JIRA: ${err.message ?? String(err)}`;
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
      env: config.getAll(),
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
