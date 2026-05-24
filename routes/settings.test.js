const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const express = require("express");

let tmpDir;
let savedCwd;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-settings-"));
  savedCwd = process.cwd();
  process.chdir(tmpDir);
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("./settings")];
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(require("./settings"));
  return app;
}

async function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const init = { method };
        if (body !== undefined) {
          init.headers = { "Content-Type": "application/json" };
          init.body = JSON.stringify(body);
        }
        const res = await fetch(`http://127.0.0.1:${port}${url}`, init);
        const json = await res.json();
        resolve({ status: res.status, json });
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test("GET /api/settings masks the API token", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "ABCDEFGHIJ",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    }),
  );
  const app = makeApp();
  const res = await call(app, "GET", "/api/settings");
  assert.equal(res.status, 200);
  assert.equal(res.json.JIRA_BASE_URL, "https://x.atlassian.net");
  assert.deepEqual(res.json.JIRA_API_TOKEN, { masked: true, last4: "GHIJ" });
});

test("GET /api/settings returns null token when unset", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    }),
  );
  const app = makeApp();
  const res = await call(app, "GET", "/api/settings");
  assert.equal(res.json.JIRA_API_TOKEN, null);
});

test("PUT /api/settings updates fields", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://old.atlassian.net",
      JIRA_EMAIL: "old@x.com",
      JIRA_API_TOKEN: "OLDTOKEN1",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings", {
    JIRA_BASE_URL: "https://new.atlassian.net",
    JIRA_EMAIL: "new@x.com",
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.JIRA_BASE_URL, "https://new.atlassian.net");
  assert.equal(res.json.JIRA_EMAIL, "new@x.com");
  assert.deepEqual(res.json.JIRA_API_TOKEN, { masked: true, last4: "KEN1" });
});

test("PUT /api/settings without token field leaves token unchanged", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "KEEPMETOKEN",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings", {
    JIRA_EMAIL: "new@x.com",
  });
  assert.deepEqual(res.json.JIRA_API_TOKEN, { masked: true, last4: "OKEN" });

  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_API_TOKEN, "KEEPMETOKEN");
});

test("PUT /api/settings with new token writes it", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "OLD",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
    }),
  );
  const app = makeApp();
  await call(app, "PUT", "/api/settings", { JIRA_API_TOKEN: "BRANDNEWTOKEN" });
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_API_TOKEN, "BRANDNEWTOKEN");
});

test("PUT /api/settings with empty token preserves stored token", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "PRESERVED",
      JIRA_TEAM_FIELD_ID: "",
      JIRA_TEAM_ID: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
    }),
  );
  const app = makeApp();
  await call(app, "PUT", "/api/settings", { JIRA_API_TOKEN: "" });
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_API_TOKEN, "PRESERVED");
});

test("PUT /api/settings rejects non-string values", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({ JIRA_BASE_URL: "", JIRA_EMAIL: "", JIRA_API_TOKEN: "" }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings", { JIRA_EMAIL: 12345 });
  assert.equal(res.status, 400);
});
