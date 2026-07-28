const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  wrapDescriptionAsAdf,
  deriveProjectKey,
  createJiraTicket,
  parseRequiredFieldErrors,
} = require("./jira-create");

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

test("createJiraTicket reads field ids from the space record", async () => {
  const calls = [];
  const jiraRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return { key: "ABC-9", id: "10001" };
  };
  const result = await createJiraTicket(
    {
      summary: "x",
      description: "y",
      parent_epic_key: "ABC-1",
      issue_type: "Story",
    },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: (k) => k === "ABC"
        ? { teamId: "team-uuid", fields: { team: "customfield_10001" } }
        : null,
      setSpace: () => {},
      discoverSpace: async () => { throw new Error("should not be called"); },
    },
  );
  assert.equal(result.key, "ABC-9");
  assert.equal(calls[0].body.fields.customfield_10001, "team-uuid");
});

test("createJiraTicket discovers space when record is missing", async () => {
  let discovered = 0;
  const jiraRequest = async () => ({ key: "XYZ-3" });
  const result = await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "XYZ-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => null,
      setSpace: () => {},
      discoverSpace: async () => {
        discovered++;
        return { teamId: "", fields: {} };
      },
    },
  );
  assert.equal(discovered, 1);
  assert.equal(result.key, "XYZ-3");
});

test("createJiraTicket retries once after 400 about required field", async () => {
  const setCalls = [];
  let attempt = 0;
  const jiraRequest = async () => {
    attempt++;
    if (attempt === 1) {
      const err = new Error("400");
      err.status = 400;
      err.body = { errors: { customfield_10020: "Sprint is required." } };
      throw err;
    }
    return { key: "ABC-2" };
  };
  const result = await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({ teamId: "", fields: {} }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({
        teamId: "", fields: { sprint: "customfield_10020" },
      }),
    },
  );
  assert.equal(attempt, 2);
  assert.equal(result.key, "ABC-2");
  assert.equal(setCalls.length, 1);
});

test("createJiraTicket does not retry permission-style 400", async () => {
  let attempt = 0;
  const jiraRequest = async () => {
    attempt++;
    const err = new Error("400");
    err.status = 400;
    err.body = { errorMessages: ["You do not have permission"], errors: {} };
    throw err;
  };
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
      {
        jiraRequest,
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: { JIRA_ACCOUNT_ID: "acct" },
        getSpace: () => ({ teamId: "", fields: {} }),
        setSpace: () => {},
        discoverSpace: async () => { throw new Error("should not call"); },
      },
    ),
  );
  assert.equal(attempt, 1);
});

test("createJiraTicket applies custom_fields against the space's customFields map", async () => {
  const calls = [];
  const jiraRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return { key: "ABC-7" };
  };
  await createJiraTicket(
    {
      summary: "x",
      description: "y",
      parent_epic_key: "ABC-1",
      issue_type: "Story",
      custom_fields: { product: "Alpha", region: "NA" },
    },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({
        teamId: "",
        fields: {},
        customFields: {
          product: { fieldId: "customfield_12037", allowedValues: ["Alpha", "Beta"] },
          region: { fieldId: "customfield_20001", allowedValues: ["NA", "EU"] },
        },
      }),
      setSpace: () => {},
      discoverSpace: async () => { throw new Error("should not call"); },
    },
  );
  assert.deepEqual(calls[0].body.fields.customfield_12037, [{ value: "Alpha" }]);
  assert.deepEqual(calls[0].body.fields.customfield_20001, [{ value: "NA" }]);
});

test("createJiraTicket rejects unknown custom_field name", async () => {
  await assert.rejects(
    createJiraTicket(
      {
        summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story",
        custom_fields: { unknown: "foo" },
      },
      {
        jiraRequest: async () => ({}),
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: {},
        getSpace: () => ({ teamId: "", fields: {}, customFields: { product: { fieldId: "cf", allowedValues: ["A"] } } }),
        setSpace: () => {},
        discoverSpace: async () => { throw new Error("should not call"); },
      },
    ),
    /Unknown custom field "unknown" for space ABC\. Known custom fields: product\./,
  );
});

test("createJiraTicket rejects custom_field value outside allowedValues", async () => {
  await assert.rejects(
    createJiraTicket(
      {
        summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story",
        custom_fields: { product: "Gamma" },
      },
      {
        jiraRequest: async () => ({}),
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: {},
        getSpace: () => ({
          teamId: "", fields: {},
          customFields: { product: { fieldId: "cf", allowedValues: ["Alpha", "Beta"] } },
        }),
        setSpace: () => {},
        discoverSpace: async () => { throw new Error("should not call"); },
      },
    ),
    /product.*Gamma.*Alpha.*Beta/,
  );
});

test("createJiraTicket throws actionable error when required custom field is omitted", async () => {
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
      {
        jiraRequest: async () => { throw new Error("should not call jira"); },
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: {},
        getSpace: () => ({
          teamId: "", fields: {},
          customFields: {
            product: { fieldId: "customfield_12037", allowedValues: ["Alpha", "Beta"], required: true },
          },
        }),
        setSpace: () => {},
        discoverSpace: async () => { throw new Error("should not call"); },
      },
    ),
    /Missing required custom_fields for space ABC.*"product".*Alpha.*Beta/,
  );
});

test("createJiraTicket succeeds when required custom field is provided", async () => {
  const calls = [];
  const jiraRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return { key: "ABC-9" };
  };
  const result = await createJiraTicket(
    {
      summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story",
      custom_fields: { product: "Alpha" },
    },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: {},
      getSpace: () => ({
        teamId: "", fields: {},
        customFields: {
          product: { fieldId: "customfield_12037", allowedValues: ["Alpha", "Beta"], required: true },
        },
      }),
      setSpace: () => {},
      discoverSpace: async () => { throw new Error("should not call"); },
    },
  );
  assert.equal(result.key, "ABC-9");
  assert.deepEqual(calls[0].body.fields.customfield_12037, [{ value: "Alpha" }]);
});

test("createJiraTicket surfaces required-field error after rediscovery branch", async () => {
  let jiraCalls = 0;
  const jiraRequest = async () => {
    jiraCalls++;
    const err = new Error("400");
    err.status = 400;
    err.body = { errors: { customfield_12037: "Product is required." } };
    throw err;
  };
  await assert.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
      {
        jiraRequest,
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: {},
        getSpace: () => ({ teamId: "", fields: {} }),
        setSpace: () => {},
        discoverSpace: async () => ({
          teamId: "", fields: {},
          customFields: {
            product: { fieldId: "customfield_12037", allowedValues: ["Alpha"], required: true },
          },
        }),
      },
    ),
    /Missing required custom_fields.*"product".*Alpha/,
  );
  assert.equal(jiraCalls, 1);
});

test("parseRequiredFieldErrors extracts field ids", () => {
  const ids = parseRequiredFieldErrors({
    errors: {
      customfield_10020: "Sprint is required.",
      customfield_10010: "Story Points is required.",
    },
  });
  assert.deepEqual(ids.sort(), ["customfield_10010", "customfield_10020"]);
});

test("parseRequiredFieldErrors returns empty when no errors", () => {
  assert.deepEqual(parseRequiredFieldErrors({}), []);
  assert.deepEqual(parseRequiredFieldErrors({ errors: {} }), []);
  assert.deepEqual(parseRequiredFieldErrors(null), []);
});

test("createJiraTicket retry preserves existing customFields not returned by fresh discovery", async () => {
  const setCalls = [];
  let attempt = 0;
  const jiraRequest = async () => {
    attempt++;
    if (attempt === 1) {
      const err = new Error("400");
      err.status = 400;
      err.body = { errors: { customfield_10020: "Sprint is required." } };
      throw err;
    }
    return { key: "ABC-2" };
  };
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({
        teamId: "",
        fields: {},
        customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
      }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({ teamId: "", fields: { sprint: "customfield_10020" } }),
    },
  );
  assert.deepEqual(setCalls[0].r.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
});

test("createJiraTicket retry does not resurrect an excluded custom field", async () => {
  const setCalls = [];
  let attempt = 0;
  const jiraRequest = async () => {
    attempt++;
    if (attempt === 1) {
      const err = new Error("400");
      err.status = 400;
      err.body = { errors: { customfield_10020: "Sprint is required." } };
      throw err;
    }
    return { key: "ABC-2" };
  };
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({
        teamId: "",
        fields: {},
        excludedCustomFields: ["project"],
      }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({
        teamId: "",
        fields: { sprint: "customfield_10020" },
        customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
      }),
    },
  );
  assert.equal(setCalls[0].r.customFields, undefined);
  assert.deepEqual(setCalls[0].r.excludedCustomFields, ["project"]);
});
