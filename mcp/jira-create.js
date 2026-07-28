const { mergeSpaceRecord } = require("../lib/jira-discovery");

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

function parseRequiredFieldErrors(body) {
  if (!body || typeof body !== "object") return [];
  const errors = body.errors;
  if (!errors || typeof errors !== "object") return [];
  return Object.keys(errors);
}

function checkRequiredCustomFields(customFieldArgs, space, projectKey) {
  const map = space.customFields || {};
  const provided = new Set(
    Object.keys(customFieldArgs ?? {}).map((k) => k.trim().toLowerCase()),
  );
  const missing = [];
  for (const [name, def] of Object.entries(map)) {
    if (def?.required !== true) continue;
    if (provided.has(name)) continue;
    const allowed = Array.isArray(def.allowedValues) ? def.allowedValues : [];
    missing.push(
      allowed.length > 0
        ? `"${name}" (one of: ${allowed.join(", ")})`
        : `"${name}"`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required custom_fields for space ${projectKey}: ${missing.join("; ")}. ` +
      `Pass them in the custom_fields argument.`,
    );
  }
}

function applyCustomFields(fields, customFieldArgs, space, projectKey) {
  if (!customFieldArgs) return;
  const map = space.customFields || {};
  for (const [argName, argValue] of Object.entries(customFieldArgs)) {
    const key = argName.trim().toLowerCase();
    const def = map[key];
    if (!def) {
      const known = Object.keys(map);
      const knownHint = known.length > 0
        ? `Known custom fields: ${known.join(", ")}.`
        : "No custom fields are configured for this space.";
      throw new Error(
        `Unknown custom field "${argName}" for space ${projectKey}. ${knownHint}`,
      );
    }
    const allowed = Array.isArray(def.allowedValues) ? def.allowedValues : [];
    if (allowed.length > 0 && !allowed.includes(argValue)) {
      throw new Error(
        `Invalid value for custom field "${argName}": ${argValue}. ` +
        `Expected one of: ${allowed.join(", ")}`,
      );
    }
    fields[def.fieldId] = [{ value: argValue }];
  }
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
  applyCustomFields(fields, args.custom_fields, space, projectKey);
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
    custom_fields,
  } = args ?? {};
  if (!summary) throw new Error("summary is required");
  if (!description) throw new Error("description is required");
  if (!parent_epic_key) throw new Error("parent_epic_key is required");
  if (!ALLOWED_ISSUE_TYPES.has(issue_type)) {
    throw new Error(`issue_type must be one of: ${[...ALLOWED_ISSUE_TYPES].join(", ")}`);
  }
  if (custom_fields !== undefined && (typeof custom_fields !== "object" || custom_fields === null || Array.isArray(custom_fields))) {
    throw new Error("custom_fields must be an object of { name: value } pairs");
  }

  const projectKey = deriveProjectKey(parent_epic_key);
  let space = getSpace(projectKey);
  if (!space) {
    const fresh = await discoverSpace(projectKey);
    space = fresh;
    setSpace(projectKey, fresh);
  }

  const ticketArgs = { summary, description, parent_epic_key, issue_type, custom_fields };
  checkRequiredCustomFields(custom_fields, space, projectKey);
  const body = buildBody(ticketArgs, space, accountId, projectKey);

  try {
    const result = await jiraRequest("POST", "/rest/api/3/issue", body);
    return { key: result.key, url: `${getJiraBaseUrl()}/browse/${result.key}` };
  } catch (err) {
    if (err.status !== 400) throw err;
    const missingIds = parseRequiredFieldErrors(err.body);
    if (missingIds.length === 0) throw err;
    const fresh = await discoverSpace(projectKey);
    const merged = mergeSpaceRecord(space, fresh);
    setSpace(projectKey, merged);
    checkRequiredCustomFields(custom_fields, merged, projectKey);
    const retryBody = buildBody(ticketArgs, merged, accountId, projectKey);
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
