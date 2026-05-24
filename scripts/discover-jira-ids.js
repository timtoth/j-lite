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

  if (!existing.JIRA_PRODUCT_FIELD_ID) {
    updates.JIRA_PRODUCT_FIELD_ID = "customfield_12037";
    console.log(`JIRA_PRODUCT_FIELD_ID set to ${updates.JIRA_PRODUCT_FIELD_ID}`);
  } else {
    console.log(`JIRA_PRODUCT_FIELD_ID already set: ${existing.JIRA_PRODUCT_FIELD_ID}`);
  }

  appendEnv(updates);
  console.log("\nDone. Discovered values appended to .env.");
}

main().catch((err) => {
  console.error("Discovery failed:", err.message);
  if (err.body) console.error("Response:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
