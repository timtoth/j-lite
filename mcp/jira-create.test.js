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

const { test: t } = require("node:test");
const a = require("node:assert/strict");
const { createJiraTicket, parseRequiredFieldErrors } = require("./jira-create");

t("createJiraTicket reads field ids from the space record", async () => {
  const calls = [];
  const jiraRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return { key: "RL-9", id: "10001" };
  };
  const result = await createJiraTicket(
    {
      summary: "x",
      description: "y",
      parent_epic_key: "RL-1",
      issue_type: "Story",
      product: "Rightsline",
    },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: (k) => k === "RL"
        ? { teamId: "team-uuid", fields: { team: "customfield_10001", product: "customfield_12037" } }
        : null,
      setSpace: () => {},
      discoverSpace: async () => { throw new Error("should not be called"); },
    },
  );
  a.equal(result.key, "RL-9");
  a.equal(calls[0].body.fields.customfield_10001, "team-uuid");
  a.deepEqual(calls[0].body.fields.customfield_12037, [{ value: "Rightsline" }]);
});

t("createJiraTicket discovers space when record is missing", async () => {
  let discovered = 0;
  const jiraRequest = async () => ({ key: "CUS-3" });
  const result = await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "CUS-1", issue_type: "Story", product: "Rightsline" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => null,
      setSpace: () => {},
      discoverSpace: async () => {
        discovered++;
        return { teamId: "", fields: { product: "customfield_12037" } };
      },
    },
  );
  a.equal(discovered, 1);
  a.equal(result.key, "CUS-3");
});

t("createJiraTicket retries once after 400 about required field", async () => {
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
    return { key: "RL-2" };
  };
  const result = await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "RL-1", issue_type: "Story", product: "Rightsline" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({ teamId: "", fields: { product: "customfield_12037" } }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({
        teamId: "", fields: { product: "customfield_12037", sprint: "customfield_10020" },
      }),
    },
  );
  a.equal(attempt, 2);
  a.equal(result.key, "RL-2");
  a.equal(setCalls.length, 1);
});

t("createJiraTicket does not retry permission-style 400", async () => {
  let attempt = 0;
  const jiraRequest = async () => {
    attempt++;
    const err = new Error("400");
    err.status = 400;
    err.body = { errorMessages: ["You do not have permission"], errors: {} };
    throw err;
  };
  await a.rejects(
    createJiraTicket(
      { summary: "x", description: "y", parent_epic_key: "RL-1", issue_type: "Story", product: "Rightsline" },
      {
        jiraRequest,
        getJiraBaseUrl: () => "https://x.atlassian.net",
        env: { JIRA_ACCOUNT_ID: "acct" },
        getSpace: () => ({ teamId: "", fields: { product: "customfield_12037" } }),
        setSpace: () => {},
        discoverSpace: async () => { throw new Error("should not call"); },
      },
    ),
  );
  a.equal(attempt, 1);
});

t("parseRequiredFieldErrors extracts field ids", () => {
  const ids = parseRequiredFieldErrors({
    errors: {
      customfield_10020: "Sprint is required.",
      customfield_10010: "Story Points is required.",
    },
  });
  a.deepEqual(ids.sort(), ["customfield_10010", "customfield_10020"]);
});

t("parseRequiredFieldErrors returns empty when no errors", () => {
  a.deepEqual(parseRequiredFieldErrors({}), []);
  a.deepEqual(parseRequiredFieldErrors({ errors: {} }), []);
  a.deepEqual(parseRequiredFieldErrors(null), []);
});
