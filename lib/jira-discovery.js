async function discoverAccountId(jiraRequest, email) {
  const data = await jiraRequest(
    "GET",
    `/rest/api/3/user/search?query=${encodeURIComponent(email)}`,
  );
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No JIRA user found for ${email}`);
  }
  return { id: data[0].accountId, label: data[0].displayName ?? email };
}

const FIELD_NAME_MAP = [
  { key: "team",         match: (n) => n === "team" },
  { key: "fixVersions",  match: (n) => n === "fix versions" },
  { key: "storyPoints",  match: (n) => n === "story points" || n === "story point estimate" },
  { key: "sprint",       match: (n) => n === "sprint" },
  { key: "product",      match: (n) => n === "product" },
];

async function discoverSpaceFields(jiraRequest, spaceKey) {
  const url =
    `/rest/api/3/issue/createmeta` +
    `?projectKeys=${encodeURIComponent(spaceKey)}` +
    `&expand=projects.issuetypes.fields`;
  const data = await jiraRequest("GET", url);
  const project = (data?.projects ?? []).find((p) => p.key === spaceKey)
    ?? data?.projects?.[0];
  if (!project) {
    throw new Error(`JIRA project not found: ${spaceKey}`);
  }
  const issueType = project.issuetypes?.[0];
  const fields = issueType?.fields ?? {};
  const result = {
    team: "", fixVersions: "", storyPoints: "", sprint: "", product: "",
  };
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    const name = String(fieldDef?.name ?? "").trim().toLowerCase();
    for (const { key, match } of FIELD_NAME_MAP) {
      if (!result[key] && match(name)) {
        result[key] = fieldDef.fieldId || fieldId;
        break;
      }
    }
  }
  return { teamId: "", fields: result };
}

module.exports = { discoverAccountId, discoverSpaceFields };
