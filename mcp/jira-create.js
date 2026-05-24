function wrapDescriptionAsAdf(text) {
  const value = text ?? "";
  const trimmed = value.trim();
  const paragraphs = trimmed.length === 0
    ? [""]
    : trimmed.split(/\n\s*\n/);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p === "" ? [] : [{ type: "text", text: p }],
    })),
  };
}

function deriveProjectKey(parentEpicKey) {
  if (!parentEpicKey || typeof parentEpicKey !== "string") {
    throw new Error("parent_epic_key is required");
  }
  const match = parentEpicKey.match(/^([A-Z][A-Z0-9]+)-\d+$/);
  if (!match) {
    throw new Error(`Invalid parent epic key: ${parentEpicKey}`);
  }
  return match[1];
}

const ALLOWED_ISSUE_TYPES = new Set(["Story", "Task", "Bug"]);
const ALLOWED_PRODUCTS = new Set(["Rightsline", "Alliant"]);

async function createJiraTicket(args, deps) {
  const { jiraRequest, getJiraBaseUrl, env } = deps;
  const teamFieldId = env.JIRA_TEAM_FIELD_ID;
  const teamId = env.JIRA_TEAM_ID;
  const accountId = env.JIRA_ACCOUNT_ID;
  const productFieldId = env.JIRA_PRODUCT_FIELD_ID;
  if (!teamFieldId || !teamId || !accountId || !productFieldId) {
    throw new Error("MCP not configured; run npm run mcp:discover");
  }

  const {
    summary,
    description,
    parent_epic_key,
    issue_type = "Story",
    product = "Rightsline",
  } = args ?? {};
  if (!summary) throw new Error("summary is required");
  if (!description) throw new Error("description is required");
  if (!parent_epic_key) throw new Error("parent_epic_key is required");
  if (!ALLOWED_ISSUE_TYPES.has(issue_type)) {
    throw new Error(`issue_type must be one of: ${[...ALLOWED_ISSUE_TYPES].join(", ")}`);
  }
  if (!ALLOWED_PRODUCTS.has(product)) {
    throw new Error(`product must be one of: ${[...ALLOWED_PRODUCTS].join(", ")}`);
  }

  const projectKey = deriveProjectKey(parent_epic_key);

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description: wrapDescriptionAsAdf(description),
      issuetype: { name: issue_type },
      parent: { key: parent_epic_key },
      assignee: { accountId },
      [teamFieldId]: teamId,
      [productFieldId]: [{ value: product }],
    },
  };

  const result = await jiraRequest("POST", "/rest/api/3/issue", body);
  return {
    key: result.key,
    url: `${getJiraBaseUrl()}/browse/${result.key}`,
  };
}

module.exports = { wrapDescriptionAsAdf, deriveProjectKey, createJiraTicket };
