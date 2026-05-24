const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let tmpDir;
let savedCwd;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-config-"));
  savedCwd = process.cwd();
  process.chdir(tmpDir);
  // Drop cached module so each test gets a fresh load.
  delete require.cache[require.resolve("./config")];
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("first run seeds from process.env and writes config.json", () => {
  process.env.JIRA_BASE_URL = "https://seed.atlassian.net";
  process.env.JIRA_EMAIL = "seed@example.com";
  process.env.JIRA_API_TOKEN = "seed-token";
  process.env.JIRA_PRODUCT_FIELD_ID = "customfield_12037";
  delete process.env.JIRA_TEAM_FIELD_ID;
  delete process.env.JIRA_TEAM_ID;
  delete process.env.JIRA_ACCOUNT_ID;

  const config = require("./config");

  assert.equal(config.get("JIRA_BASE_URL"), "https://seed.atlassian.net");
  assert.equal(config.get("JIRA_EMAIL"), "seed@example.com");
  assert.equal(config.get("JIRA_API_TOKEN"), "seed-token");
  assert.equal(config.get("JIRA_PRODUCT_FIELD_ID"), "customfield_12037");

  const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(persisted.JIRA_BASE_URL, "https://seed.atlassian.net");
});

test("subsequent run loads config.json and ignores process.env", () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://disk.atlassian.net",
      JIRA_EMAIL: "disk@example.com",
      JIRA_API_TOKEN: "disk-token",
      JIRA_TEAM_FIELD_ID: "customfield_10001",
      JIRA_TEAM_ID: "team-uuid",
      JIRA_ACCOUNT_ID: "acct-1",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    }),
  );
  process.env.JIRA_BASE_URL = "https://env.atlassian.net";
  process.env.JIRA_EMAIL = "env@example.com";
  process.env.JIRA_API_TOKEN = "env-token";

  const config = require("./config");
  assert.equal(config.get("JIRA_BASE_URL"), "https://disk.atlassian.net");
  assert.equal(config.get("JIRA_EMAIL"), "disk@example.com");
});

test("update merges patch and persists atomically", () => {
  process.env.JIRA_BASE_URL = "";
  process.env.JIRA_EMAIL = "";
  process.env.JIRA_API_TOKEN = "";
  const config = require("./config");

  const next = config.update({ JIRA_BASE_URL: "https://new.atlassian.net" });
  assert.equal(next.JIRA_BASE_URL, "https://new.atlassian.net");
  assert.equal(config.get("JIRA_BASE_URL"), "https://new.atlassian.net");

  const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(persisted.JIRA_BASE_URL, "https://new.atlassian.net");
  assert.equal(fs.existsSync(path.join(tmpDir, "config.json.tmp")), false);
});

test("update ignores unknown keys", () => {
  const config = require("./config");
  const next = config.update({ NOT_A_KEY: "x" });
  assert.equal(next.NOT_A_KEY, undefined);
});

test("isConfigured is false when any required field is empty", () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "tok",
    }),
  );
  const config = require("./config");
  assert.equal(config.isConfigured(), false);
});

test("isConfigured is true when all required fields present", () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "a@b.com",
      JIRA_API_TOKEN: "tok",
    }),
  );
  const config = require("./config");
  assert.equal(config.isConfigured(), true);
});

test("TC_CONFIG_DIR overrides cwd for config location", () => {
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-override-"));
  try {
    process.env.TC_CONFIG_DIR = overrideDir;
    process.env.JIRA_BASE_URL = "https://override.atlassian.net";
    process.env.JIRA_EMAIL = "o@example.com";
    process.env.JIRA_API_TOKEN = "tok";

    const config = require("./config");
    config.update({ JIRA_BASE_URL: "https://override.atlassian.net" });

    assert.equal(
      fs.existsSync(path.join(overrideDir, "config.json")),
      true,
      "config.json should be in TC_CONFIG_DIR"
    );
    assert.equal(
      fs.existsSync(path.join(tmpDir, "config.json")),
      false,
      "config.json should NOT be in cwd"
    );
  } finally {
    delete process.env.TC_CONFIG_DIR;
    fs.rmSync(overrideDir, { recursive: true, force: true });
  }
});
