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

test("discoverSpaceFields matches Sprint by schema.custom when name is localized", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10020: {
                  fieldId: "customfield_10020",
                  name: "Iteration",
                  schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10020 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.sprint, "customfield_10020");
});

test("discoverSpaceFields matches Story Points by schema.custom when name differs", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10010: {
                  fieldId: "customfield_10010",
                  name: "Effort",
                  schema: { type: "number", custom: "com.pyxis.greenhopper.jira:jsw-story-points", customId: 10010 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.storyPoints, "customfield_10010");
});

test("discoverSpaceFields matches Fix Versions by schema.system when name is localized", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                fixVersions: {
                  fieldId: "fixVersions",
                  name: "Versions de correctif",
                  schema: { type: "array", system: "fixVersions", items: "version" },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.fixVersions, "fixVersions");
});

test("discoverSpaceFields matches Team by schema.type when name differs", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10001: {
                  fieldId: "customfield_10001",
                  name: "Squad",
                  schema: { type: "team", custom: "com.atlassian.teams:rm-teams-custom-field-team", customId: 10001 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.team, "customfield_10001");
});

test("discoverSpaceFields prefers schema match over a coincidental name match", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_99998: {
                  fieldId: "customfield_99998",
                  name: "Sprint",
                  schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield", customId: 99998 },
                },
                customfield_10020: {
                  fieldId: "customfield_10020",
                  name: "Iteration",
                  schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10020 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.sprint, "customfield_10020");
});

test("discoverSpaceFields unions fields across all issue types", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "RL",
          issuetypes: [
            {
              name: "Epic",
              fields: {
                summary: { fieldId: "summary", name: "Summary" },
                customfield_10001: { fieldId: "customfield_10001", name: "Team" },
              },
            },
            {
              name: "Story",
              fields: {
                summary: { fieldId: "summary", name: "Summary" },
                customfield_10001: { fieldId: "customfield_10001", name: "Team" },
                customfield_10010: { fieldId: "customfield_10010", name: "Story Points" },
                customfield_10020: { fieldId: "customfield_10020", name: "Sprint" },
                fixVersions:       { fieldId: "fixVersions",       name: "Fix versions" },
                customfield_12037: { fieldId: "customfield_12037", name: "Product" },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "RL");
  assert.deepEqual(result.fields, {
    team: "customfield_10001",
    fixVersions: "fixVersions",
    storyPoints: "customfield_10010",
    sprint: "customfield_10020",
    product: "customfield_12037",
  });
});

test("discoverSpaceFields keeps first issuetype's id when fieldIds differ for same conceptual key", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "RL",
          issuetypes: [
            {
              name: "Epic",
              fields: {
                customfield_10010: { fieldId: "customfield_10010", name: "Story Points" },
              },
            },
            {
              name: "Story",
              fields: {
                customfield_99999: { fieldId: "customfield_99999", name: "Story Points" },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "RL");
  assert.equal(result.fields.storyPoints, "customfield_10010");
});
