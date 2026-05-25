const { test } = require("node:test");
const assert = require("node:assert/strict");
const { discoverAccountId, discoverSpaceFields } = require("./jira-discovery");

function fakeJiraRequest(routes) {
  return async (method, url) => {
    const key = `${method} ${url.split("?")[0]}`;
    const handler = routes[key];
    if (!handler) throw new Error("No fake for " + method + " " + url);
    return handler(url);
  };
}

test("discoverAccountId returns first user", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/user/search": () => [{ accountId: "acct-1", displayName: "Me" }],
  });
  const acct = await discoverAccountId(jiraRequest, "me@x.com");
  assert.deepEqual(acct, { id: "acct-1", label: "Me" });
});

test("discoverAccountId throws when no user", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/user/search": () => [],
  });
  await assert.rejects(discoverAccountId(jiraRequest, "x@y.com"), /No JIRA user/);
});

const SAMPLE_CREATEMETA = {
  projects: [
    {
      key: "RL",
      issuetypes: [
        {
          name: "Story",
          fields: {
            customfield_10001: { fieldId: "customfield_10001", name: "Team" },
            fixVersions:       { fieldId: "fixVersions",       name: "Fix versions" },
            customfield_10010: { fieldId: "customfield_10010", name: "Story Points" },
            customfield_10020: { fieldId: "customfield_10020", name: "Sprint" },
            customfield_12037: { fieldId: "customfield_12037", name: "Product" },
            summary:           { fieldId: "summary",           name: "Summary" },
          },
        },
      ],
    },
  ],
};

test("discoverSpaceFields maps known field names to ids", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => SAMPLE_CREATEMETA,
  });
  const result = await discoverSpaceFields(jiraRequest, "RL");
  assert.deepEqual(result, {
    teamId: "",
    fields: {
      team: "customfield_10001",
      fixVersions: "fixVersions",
      storyPoints: "customfield_10010",
      sprint: "customfield_10020",
      product: "customfield_12037",
    },
  });
});

test("discoverSpaceFields handles missing fields gracefully", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "CUS",
          issuetypes: [
            {
              name: "Task",
              fields: {
                customfield_12037: { fieldId: "customfield_12037", name: "Product" },
                summary:           { fieldId: "summary",           name: "Summary" },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "CUS");
  assert.equal(result.fields.team, "");
  assert.equal(result.fields.sprint, "");
  assert.equal(result.fields.product, "customfield_12037");
});

test("discoverSpaceFields throws when project not found", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({ projects: [] }),
  });
  await assert.rejects(discoverSpaceFields(jiraRequest, "NOPE"), /not found/i);
});

test("discoverSpaceFields matches Story point estimate as storyPoints", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "X",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_99999: { fieldId: "customfield_99999", name: "Story point estimate" },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "X");
  assert.equal(result.fields.storyPoints, "customfield_99999");
});
