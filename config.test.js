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

test("migration moves old JIRA_TEAM_FIELD_ID/JIRA_TEAM_ID into JIRA_SPACES.ABC", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_TEAM_FIELD_ID: "customfield_001",
    JIRA_TEAM_ID: "team-uuid",
    JIRA_ACCOUNT_ID: "acct",
  });
  const config = require("./config");
  const all = config.getAll();
  assert.equal(all.JIRA_TEAM_FIELD_ID, undefined);
  assert.equal(all.JIRA_TEAM_ID, undefined);
  // Legacy migration always lands on the historical "ABC" placeholder space —
  // we no longer special-case any tenant.
  assert.equal(all.JIRA_SPACES.ABC.fields.team, "customfield_001");
  assert.equal(all.JIRA_SPACES.ABC.teamId, "team-uuid");
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
  });
  require("./config");
  delete require.cache[require.resolve("./config")];
  const config = require("./config");
  const all = config.getAll();
  assert.equal(Object.keys(all.JIRA_SPACES).length, 1);
  assert.equal(all.JIRA_SPACES.ABC.fields.team, "customfield_001");
});

test("migration strips legacy JIRA_PRODUCT_FIELD_ID and space fields.product", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    JIRA_SPACES: {
      ABC: { teamId: "", fields: { team: "customfield_001", product: "customfield_12037" } },
    },
  });
  const config = require("./config");
  const all = config.getAll();
  assert.equal(all.JIRA_PRODUCT_FIELD_ID, undefined);
  assert.equal(all.JIRA_SPACES.ABC.fields.product, undefined);
  assert.equal(all.JIRA_SPACES.ABC.fields.team, "customfield_001");
  const onDisk = readConfig();
  assert.equal(onDisk.JIRA_PRODUCT_FIELD_ID, undefined);
  assert.equal(onDisk.JIRA_SPACES.ABC.fields.product, undefined);
});

test("getSpace returns space record", () => {
  writeConfig({
    JIRA_BASE_URL: "",
    JIRA_EMAIL: "",
    JIRA_API_TOKEN: "",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: { XYZ: { teamId: "", fields: { sprint: "customfield_10020" } } },
  });
  const config = require("./config");
  assert.deepEqual(config.getSpace("XYZ"), {
    teamId: "",
    fields: { sprint: "customfield_10020" },
  });
});

test("getSpace returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.getSpace("NOPE"), null);
});

test("setSpace persists a new space with customFields", () => {
  const config = require("./config");
  config.setSpace("XYZ", {
    teamId: "",
    fields: { sprint: "customfield_10020" },
    customFields: {
      product: { fieldId: "customfield_12037", allowedValues: ["A", "B"] },
    },
    discoveredAt: "2026-05-26T00:00:00.000Z",
  });
  const onDisk = readConfig();
  assert.equal(onDisk.JIRA_SPACES.XYZ.fields.sprint, "customfield_10020");
  assert.deepEqual(onDisk.JIRA_SPACES.XYZ.customFields.product, {
    fieldId: "customfield_12037",
    allowedValues: ["A", "B"],
  });
});

test("isConfigured stays based on JIRA_BASE_URL/EMAIL/API_TOKEN only", () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "a@b.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
  });
  const config = require("./config");
  assert.equal(config.isConfigured(), true);
});

test("excludeCustomField moves a field from customFields to excludedCustomFields", () => {
  const config = require("./config");
  config.setSpace("XYZ", {
    teamId: "",
    fields: {},
    customFields: {
      project: { fieldId: "project", allowedValues: ["ABC Project"] },
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    },
  });
  const updated = config.excludeCustomField("XYZ", "Project");
  assert.deepEqual(updated.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
  const onDisk = readConfig();
  assert.deepEqual(onDisk.JIRA_SPACES.XYZ.excludedCustomFields, ["project"]);
});

test("excludeCustomField dedups on repeated calls", () => {
  const config = require("./config");
  config.setSpace("XYZ", {
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: [] } },
  });
  config.excludeCustomField("XYZ", "project");
  const updated = config.excludeCustomField("XYZ", "project");
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
});

test("excludeCustomField returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.excludeCustomField("NOPE", "project"), null);
});

test("restoreCustomField removes a name from excludedCustomFields without restoring customFields", () => {
  const config = require("./config");
  config.setSpace("XYZ", { teamId: "", fields: {}, excludedCustomFields: ["project"] });
  const updated = config.restoreCustomField("XYZ", "project");
  assert.equal(updated.excludedCustomFields, undefined);
  assert.equal(updated.customFields, undefined);
});

test("restoreCustomField returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.restoreCustomField("NOPE", "project"), null);
});
