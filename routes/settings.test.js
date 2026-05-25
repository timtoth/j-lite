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
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "GET", "/api/settings");
  assert.equal(res.status, 200);
  assert.equal(res.json.JIRA_BASE_URL, "https://x.atlassian.net");
  assert.deepEqual(res.json.JIRA_API_TOKEN, { masked: true, last4: "GHIJ" });
  assert.deepEqual(res.json.JIRA_SPACES, {});
});

test("GET /api/settings returns null token when unset", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
      JIRA_SPACES: {},
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
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
      JIRA_SPACES: {},
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
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
      JIRA_SPACES: {},
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
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
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
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
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
    JSON.stringify({
      JIRA_BASE_URL: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings", { JIRA_EMAIL: 12345 });
  assert.equal(res.status, 400);
});

test("POST /api/settings/discover without query updates account id and sweeps spaces", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: { RL: { teamId: "t1", fields: { team: "old" } } },
    }),
  );
  const discoveryMock = require("../lib/jira-discovery");
  const origAcct = discoveryMock.discoverAccountId;
  const origFields = discoveryMock.discoverSpaceFields;
  discoveryMock.discoverAccountId = async () => ({ id: "acct-1", label: "Me" });
  discoveryMock.discoverSpaceFields = async (_req, key) => ({
    teamId: "",
    fields: {
      team: `team-${key}`, fixVersions: "", storyPoints: "", sprint: "", product: "",
    },
  });
  try {
    const app = makeApp();
    const res = await call(app, "POST", "/api/settings/discover");
    assert.equal(res.status, 200);
    assert.equal(res.json.accountId.id, "acct-1");
    assert.equal(res.json.spaces.RL.fields.team, "team-RL");
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
    assert.equal(onDisk.JIRA_ACCOUNT_ID, "acct-1");
    assert.equal(onDisk.JIRA_SPACES.RL.fields.team, "team-RL");
    // teamId is preserved across discovery (user-set, not overwritten by empty discovery)
    assert.equal(onDisk.JIRA_SPACES.RL.teamId, "t1");
  } finally {
    discoveryMock.discoverAccountId = origAcct;
    discoveryMock.discoverSpaceFields = origFields;
  }
});

test("POST /api/settings/discover?space=KEY only touches that space", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "preexisting",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const discoveryMock = require("../lib/jira-discovery");
  const origAcct = discoveryMock.discoverAccountId;
  const origFields = discoveryMock.discoverSpaceFields;
  let acctCalls = 0;
  discoveryMock.discoverAccountId = async () => { acctCalls++; return { id: "x", label: "x" }; };
  discoveryMock.discoverSpaceFields = async (_req, key) => ({
    teamId: "", fields: { team: "", fixVersions: "", storyPoints: "", sprint: "customfield_10020", product: "" },
  });
  try {
    const app = makeApp();
    const res = await call(app, "POST", "/api/settings/discover?space=CUS");
    assert.equal(res.status, 200);
    assert.equal(res.json.accountId, null);
    assert.equal(res.json.spaces.CUS.fields.sprint, "customfield_10020");
    assert.equal(acctCalls, 0);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
    assert.equal(onDisk.JIRA_ACCOUNT_ID, "preexisting");
    assert.equal(onDisk.JIRA_SPACES.CUS.fields.sprint, "customfield_10020");
  } finally {
    discoveryMock.discoverAccountId = origAcct;
    discoveryMock.discoverSpaceFields = origFields;
  }
});

test("POST /api/settings/discover returns per-space error without aborting", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {
        RL: { teamId: "", fields: {} },
        BAD: { teamId: "", fields: {} },
      },
    }),
  );
  const discoveryMock = require("../lib/jira-discovery");
  const origAcct = discoveryMock.discoverAccountId;
  const origFields = discoveryMock.discoverSpaceFields;
  discoveryMock.discoverAccountId = async () => ({ id: "a", label: "a" });
  discoveryMock.discoverSpaceFields = async (_req, key) => {
    if (key === "BAD") throw new Error("not found");
    return { teamId: "", fields: { team: "", fixVersions: "", storyPoints: "", sprint: "", product: "" } };
  };
  try {
    const app = makeApp();
    const res = await call(app, "POST", "/api/settings/discover");
    assert.equal(res.status, 200);
    assert.equal(res.json.spaces.BAD.error, "not found");
    assert.ok(!res.json.spaces.RL.error);
  } finally {
    discoveryMock.discoverAccountId = origAcct;
    discoveryMock.discoverSpaceFields = origFields;
  }
});

test("PUT /api/settings/spaces/:key updates teamId and preserves fields", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {
        RL: {
          teamId: "old-team",
          fields: { team: "customfield_10001", fixVersions: "fixVersions", storyPoints: "", sprint: "", product: "" },
          discoveredAt: "2026-05-24T00:00:00.000Z",
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: "new-team-uuid" });
  assert.equal(res.status, 200);
  assert.equal(res.json.teamId, "new-team-uuid");
  assert.equal(res.json.fields.team, "customfield_10001");
  assert.equal(res.json.discoveredAt, "2026-05-24T00:00:00.000Z");
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_SPACES.RL.teamId, "new-team-uuid");
  assert.equal(onDisk.JIRA_SPACES.RL.fields.team, "customfield_10001");
});

test("PUT /api/settings/spaces/:key returns 404 when space doesn't exist", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/MISSING", { teamId: "x" });
  assert.equal(res.status, 404);
});

test("PUT /api/settings/spaces/:key rejects non-string teamId", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: { RL: { teamId: "", fields: {} } },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: 1234 });
  assert.equal(res.status, 400);
});

test("PUT /api/settings/spaces/:key clears prior error field", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {
        RL: {
          teamId: "",
          fields: { team: "customfield_10001" },
          error: "discovery failed last time",
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: "fresh" });
  assert.equal(res.status, 200);
  assert.equal(res.json.error, undefined);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_SPACES.RL.error, undefined);
});
