const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const config = require("../config");
const { jiraRequest } = require("../lib/jira-client");
const { enrichIds } = require("../lib/jira-discovery");

async function main() {
  const current = config.getAll();
  console.log("Discovering JIRA IDs...");
  const result = await enrichIds(jiraRequest, current);

  const patch = {};
  if (!current.JIRA_TEAM_FIELD_ID) patch.JIRA_TEAM_FIELD_ID = result.teamFieldId.id;
  if (!current.JIRA_TEAM_ID) patch.JIRA_TEAM_ID = result.teamId.id;
  if (!current.JIRA_ACCOUNT_ID) patch.JIRA_ACCOUNT_ID = result.accountId.id;
  if (!current.JIRA_PRODUCT_FIELD_ID) patch.JIRA_PRODUCT_FIELD_ID = result.productFieldId.id;

  if (Object.keys(patch).length === 0) {
    console.log("All JIRA IDs already set in config.json. Nothing to do.");
    return;
  }
  config.update(patch);
  for (const [k, v] of Object.entries(patch)) {
    console.log(`  ${k} = ${v}`);
  }
  console.log("\nDone. Values written to config.json.");
}

main().catch((err) => {
  console.error("Discovery failed:", err.message);
  if (err.body) console.error("Response:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
