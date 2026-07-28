const { test, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let tmpDir;
let savedEnv;
let handleDiscover;
let handleRemoveCustomField;

before(async () => {
  const mod = await import("../mcp/create-ticket-server.mjs");
  handleDiscover = mod.handleDiscover;
  handleRemoveCustomField = mod.handleRemoveCustomField;
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-mcp-"));
  savedEnv = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.TC_CONFIG_DIR;
  else process.env.TC_CONFIG_DIR = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(obj) {
  fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify(obj));
}

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
}

test("handleDiscover merge preserves existing customFields not returned by fresh discovery", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: {
        teamId: "",
        fields: {},
        customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
      },
    },
  });
  const jiraDiscoveryCjs = require("../lib/jira-discovery");
  const orig = jiraDiscoveryCjs.discoverSpaceFields;
  jiraDiscoveryCjs.discoverSpaceFields = async () => ({ teamId: "", fields: { sprint: "customfield_10020" } });
  try {
    const result = await handleDiscover({ space_key: "XYZ" });
    const merged = JSON.parse(result.content[0].text);
    assert.deepEqual(merged.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
    const onDisk = readConfig();
    assert.deepEqual(onDisk.JIRA_SPACES.XYZ.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
  } finally {
    jiraDiscoveryCjs.discoverSpaceFields = orig;
  }
});

test("handleDiscover merge does not resurrect an excluded custom field", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: { teamId: "", fields: {}, excludedCustomFields: ["project"] },
    },
  });
  const jiraDiscoveryCjs = require("../lib/jira-discovery");
  const orig = jiraDiscoveryCjs.discoverSpaceFields;
  jiraDiscoveryCjs.discoverSpaceFields = async () => ({
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
  });
  try {
    const result = await handleDiscover({ space_key: "XYZ" });
    const merged = JSON.parse(result.content[0].text);
    assert.equal(merged.customFields, undefined);
    assert.deepEqual(merged.excludedCustomFields, ["project"]);
  } finally {
    jiraDiscoveryCjs.discoverSpaceFields = orig;
  }
});

test("handleRemoveCustomField excludes a field and persists it", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: {
        teamId: "",
        fields: {},
        customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
      },
    },
  });
  const result = await handleRemoveCustomField({ space_key: "XYZ", field_name: "Project" });
  const updated = JSON.parse(result.content[0].text);
  assert.equal(updated.customFields, undefined);
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
  const onDisk = readConfig();
  assert.deepEqual(onDisk.JIRA_SPACES.XYZ.excludedCustomFields, ["project"]);
});

test("handleRemoveCustomField throws for unknown space", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {},
  });
  await assert.rejects(
    handleRemoveCustomField({ space_key: "NOPE", field_name: "project" }),
    /Unknown space: NOPE/,
  );
});
