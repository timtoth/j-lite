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
