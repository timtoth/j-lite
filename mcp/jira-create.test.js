const { test } = require("node:test");
const assert = require("node:assert/strict");
const { wrapDescriptionAsAdf, deriveProjectKey } = require("./jira-create");

test("wrapDescriptionAsAdf wraps single paragraph", () => {
  const result = wrapDescriptionAsAdf("hello world");
  assert.deepEqual(result, {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
    ],
  });
});

test("wrapDescriptionAsAdf splits on blank lines", () => {
  const result = wrapDescriptionAsAdf("first paragraph\n\nsecond paragraph");
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].content[0].text, "first paragraph");
  assert.equal(result.content[1].content[0].text, "second paragraph");
});

test("wrapDescriptionAsAdf preserves single newlines inside a paragraph", () => {
  const result = wrapDescriptionAsAdf("line one\nline two");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].content[0].text, "line one\nline two");
});

test("wrapDescriptionAsAdf returns one empty paragraph for empty input", () => {
  const result = wrapDescriptionAsAdf("");
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.content[0].content, []);
});

test("deriveProjectKey extracts prefix", () => {
  assert.equal(deriveProjectKey("UP-456"), "UP");
  assert.equal(deriveProjectKey("ABC123-9"), "ABC123");
});

test("deriveProjectKey rejects malformed keys", () => {
  assert.throws(() => deriveProjectKey("bad"), /Invalid parent epic key/);
  assert.throws(() => deriveProjectKey(""), /required/);
  assert.throws(() => deriveProjectKey(null), /required/);
});

const { createJiraTicket } = require("./jira-create");

function makeDeps(overrides = {}) {
  let captured = null;
  const deps = {
    jiraRequest: async (method, path, body) => {
      captured = { method, path, body };
      return { key: "UP-789" };
    },
    getJiraBaseUrl: () => "https://example.atlassian.net",
    env: {
      JIRA_TEAM_FIELD_ID: "customfield_10001",
      JIRA_TEAM_ID: "team-uuid-123",
      JIRA_ACCOUNT_ID: "account-abc",
      JIRA_PRODUCT_FIELD_ID: "customfield_12037",
      ...overrides,
    },
  };
  return { deps, getCaptured: () => captured };
}

test("createJiraTicket builds expected POST body and returns key + url", async () => {
  const { deps, getCaptured } = makeDeps();
  const result = await createJiraTicket(
    { summary: "Implement consumer", description: "Do the thing.", parent_epic_key: "UP-456" },
    deps,
  );
  const captured = getCaptured();
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/rest/api/3/issue");
  assert.equal(captured.body.fields.project.key, "UP");
  assert.equal(captured.body.fields.summary, "Implement consumer");
  assert.equal(captured.body.fields.parent.key, "UP-456");
  assert.equal(captured.body.fields.issuetype.name, "Story");
  assert.equal(captured.body.fields.assignee.accountId, "account-abc");
  assert.equal(captured.body.fields.customfield_10001, "team-uuid-123");
  assert.deepEqual(captured.body.fields.customfield_12037, [{ value: "Rightsline" }]);
  assert.equal(captured.body.fields.description.type, "doc");
  assert.deepEqual(result, { key: "UP-789", url: "https://example.atlassian.net/browse/UP-789" });
});

test("createJiraTicket honors product override", async () => {
  const { deps, getCaptured } = makeDeps();
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "UP-1", product: "Alliant" },
    deps,
  );
  assert.deepEqual(getCaptured().body.fields.customfield_12037, [{ value: "Alliant" }]);
});

test("createJiraTicket rejects unknown product", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "UP-1", product: "Bogus" },
      deps,
    ),
    /product must be one of/,
  );
});

test("createJiraTicket honors issue_type override", async () => {
  const { deps, getCaptured } = makeDeps();
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "UP-1", issue_type: "Bug" },
    deps,
  );
  assert.equal(getCaptured().body.fields.issuetype.name, "Bug");
});

test("createJiraTicket rejects unknown issue_type", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "UP-1", issue_type: "Epic" },
      deps,
    ),
    /issue_type must be one of/,
  );
});

test("createJiraTicket fails fast when env IDs missing", async () => {
  const { deps } = makeDeps({ JIRA_TEAM_ID: undefined });
  await assert.rejects(
    createJiraTicket({ summary: "x", description: "y", parent_epic_key: "UP-1" }, deps),
    /MCP not configured/,
  );
});

test("createJiraTicket validates required arg presence", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    createJiraTicket({ description: "y", parent_epic_key: "UP-1" }, deps),
    /summary is required/,
  );
});
