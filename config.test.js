const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let tmpDir;
let savedEnv;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-config-"));
  savedEnv = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = tmpDir;
  delete require.cache[require.resolve("./config")];
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

test("seeds JIRA_SPACES as empty object on fresh install", () => {
  const config = require("./config");
  assert.deepEqual(config.getAll().JIRA_SPACES, {});
});

test("migration moves old JIRA_TEAM_FIELD_ID/JIRA_TEAM_ID into JIRA_SPACES.RL", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_TEAM_FIELD_ID: "customfield_001",
    JIRA_TEAM_ID: "team-uuid",
    JIRA_ACCOUNT_ID: "acct",
    JIRA_PRODUCT_FIELD_ID: "customfield_12037",
  });
  const config = require("./config");
  const all = config.getAll();
  assert.equal(all.JIRA_TEAM_FIELD_ID, undefined);
  assert.equal(all.JIRA_TEAM_ID, undefined);
  assert.deepEqual(all.JIRA_SPACES.RL.fields.team, "customfield_001");
  assert.equal(all.JIRA_SPACES.RL.teamId, "team-uuid");
  assert.equal(all.JIRA_SPACES.RL.fields.product, "customfield_12037");
  const onDisk = readConfig();
  assert.equal(onDisk.JIRA_TEAM_FIELD_ID, undefined);
  assert.equal(onDisk.JIRA_TEAM_ID, undefined);
});

test("migration is idempotent", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_TEAM_FIELD_ID: "customfield_001",
    JIRA_TEAM_ID: "team-uuid",
    JIRA_ACCOUNT_ID: "acct",
    JIRA_PRODUCT_FIELD_ID: "customfield_12037",
  });
  require("./config");
  delete require.cache[require.resolve("./config")];
  const config = require("./config");
  const all = config.getAll();
  assert.equal(Object.keys(all.JIRA_SPACES).length, 1);
  assert.equal(all.JIRA_SPACES.RL.fields.team, "customfield_001");
});

test("getSpace returns space record", () => {
  writeConfig({
    JIRA_BASE_URL: "",
    JIRA_EMAIL: "",
    JIRA_API_TOKEN: "",
    JIRA_ACCOUNT_ID: "",
    JIRA_PRODUCT_FIELD_ID: "",
    JIRA_SPACES: { CUS: { teamId: "", fields: { product: "customfield_12037" } } },
  });
  const config = require("./config");
  assert.deepEqual(config.getSpace("CUS"), {
    teamId: "",
    fields: { product: "customfield_12037" },
  });
});

test("getSpace returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.getSpace("NOPE"), null);
});

test("setSpace persists a new space", () => {
  const config = require("./config");
  config.setSpace("CUS", {
    teamId: "",
    fields: { product: "customfield_12037", sprint: "customfield_10020" },
    discoveredAt: "2026-05-24T00:00:00.000Z",
  });
  const onDisk = readConfig();
  assert.equal(onDisk.JIRA_SPACES.CUS.fields.sprint, "customfield_10020");
});

test("isConfigured stays based on JIRA_BASE_URL/EMAIL/API_TOKEN only", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_PRODUCT_FIELD_ID: "",
  });
  const config = require("./config");
  assert.equal(config.isConfigured(), true);
});
