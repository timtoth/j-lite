function wrapDescriptionAsAdf(text) {
  const value = text ?? "";
  const trimmed = value.trim();
  const paragraphs = trimmed.length === 0 ? [""] : trimmed.split(/\n\s*\n/);
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
  if (!match) throw new Error(`Invalid parent epic key: ${parentEpicKey}`);
  return match[1];
}

const ALLOWED_ISSUE_TYPES = new Set(["Story", "Task", "Bug"]);
const ALLOWED_PRODUCTS = new Set(["Rightsline", "Alliant"]);

function parseRequiredFieldErrors(body) {
  if (!body || typeof body !== "object") return [];
  const errors = body.errors;
  if (!errors || typeof errors !== "object") return [];
  return Object.keys(errors);
}

function buildBody(args, space, accountId, projectKey) {
  const fields = {
    project: { key: projectKey },
    summary: args.summary,
    description: wrapDescriptionAsAdf(args.description),
    issuetype: { name: args.issue_type ?? "Story" },
    parent: { key: args.parent_epic_key },
  };
  if (accountId) fields.assignee = { accountId };
  if (space.fields?.team && space.teamId) {
    fields[space.fields.team] = space.teamId;
  }
  if (space.fields?.product) {
    fields[space.fields.product] = [{ value: args.product ?? "Rightsline" }];
  }
  return { fields };
}

async function createJiraTicket(args, deps) {
  const { jiraRequest, getJiraBaseUrl, env, getSpace, setSpace, discoverSpace } = deps;
  const accountId = env?.JIRA_ACCOUNT_ID;

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
  let space = getSpace(projectKey);
  if (!space) {
    const fresh = await discoverSpace(projectKey);
    space = fresh;
    setSpace(projectKey, fresh);
  }

  const body = buildBody(
    { summary, description, parent_epic_key, issue_type, product },
    space,
    accountId,
    projectKey,
  );

  try {
    const result = await jiraRequest("POST", "/rest/api/3/issue", body);
    return { key: result.key, url: `${getJiraBaseUrl()}/browse/${result.key}` };
  } catch (err) {
    if (err.status !== 400) throw err;
    const missingIds = parseRequiredFieldErrors(err.body);
    if (missingIds.length === 0) throw err;
    const fresh = await discoverSpace(projectKey);
    const merged = {
      teamId: space.teamId || fresh.teamId,
      fields: { ...space.fields, ...fresh.fields },
    };
    setSpace(projectKey, merged);
    const retryBody = buildBody(
      { summary, description, parent_epic_key, issue_type, product },
      merged,
      accountId,
      projectKey,
    );
    const result = await jiraRequest("POST", "/rest/api/3/issue", retryBody);
    return { key: result.key, url: `${getJiraBaseUrl()}/browse/${result.key}` };
  }
}

module.exports = {
  wrapDescriptionAsAdf,
  deriveProjectKey,
  createJiraTicket,
  parseRequiredFieldErrors,
};
