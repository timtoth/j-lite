const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverTeamFieldId,
  discoverTeamId,
  discoverAccountId,
  enrichIds,
} = require("./jira-discovery");

function fakeJiraRequest(routes) {
  return async (method, url) => {
    const handler = routes[`${method} ${url.split("?")[0]}`];
    if (!handler) throw new Error("No fake for " + method + " " + url);
    return handler(url);
  };
}

test("discoverTeamFieldId returns single Team field id", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/field": () => [
      { id: "customfield_001", name: "Team" },
      { id: "customfield_002", name: "Sprint" },
    ],
  });
  const id = await discoverTeamFieldId(jiraRequest);
  assert.equal(id, "customfield_001");
});

test("discoverTeamFieldId throws when zero matches", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/field": () => [{ id: "x", name: "Other" }],
  });
  await assert.rejects(discoverTeamFieldId(jiraRequest), /No 'Team' custom field/);
});

test("discoverTeamFieldId throws when multiple matches", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/field": () => [
      { id: "a", name: "Team" },
      { id: "b", name: "Team" },
    ],
  });
  await assert.rejects(discoverTeamFieldId(jiraRequest), /Multiple 'Team' fields/);
});

test("discoverTeamId filters to Unified Platform", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/search/jql": () => ({
      issues: [
        { fields: { customfield_001: { id: "team-a", name: "Other Team" } } },
        { fields: { customfield_001: { id: "team-b", name: "Unified Platform" } } },
      ],
    }),
  });
  const team = await discoverTeamId(jiraRequest, "customfield_001", "me@x.com");
  assert.deepEqual(team, { id: "team-b", label: "Unified Platform" });
});

test("discoverAccountId returns first user", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/user/search": () => [{ accountId: "acct-1", displayName: "Me" }],
  });
  const acct = await discoverAccountId(jiraRequest, "me@x.com");
  assert.deepEqual(acct, { id: "acct-1", label: "Me" });
});

test("enrichIds composes all four entries", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/field": () => [{ id: "customfield_001", name: "Team" }],
    "GET /rest/api/3/search/jql": () => ({
      issues: [{ fields: { customfield_001: { id: "team-b", name: "Unified Platform" } } }],
    }),
    "GET /rest/api/3/user/search": () => [{ accountId: "acct-1", displayName: "Me" }],
  });
  const result = await enrichIds(jiraRequest, {
    JIRA_EMAIL: "me@x.com",
    JIRA_PRODUCT_FIELD_ID: "customfield_12037",
  });
  assert.equal(result.teamFieldId.id, "customfield_001");
  assert.equal(result.teamId.id, "team-b");
  assert.equal(result.accountId.id, "acct-1");
  assert.equal(result.productFieldId.id, "customfield_12037");
});
