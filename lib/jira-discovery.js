async function discoverTeamFieldId(jiraRequest) {
  const fields = await jiraRequest("GET", "/rest/api/3/field");
  const matches = fields.filter((f) => f.name === "Team");
  if (matches.length === 0) {
    throw new Error("No 'Team' custom field found in this JIRA instance.");
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => m.id).join(", ");
    throw new Error(`Multiple 'Team' fields found: ${ids}. Set JIRA_TEAM_FIELD_ID manually.`);
  }
  return matches[0].id;
}

async function discoverTeamId(jiraRequest, fieldId, email) {
  const jql = `assignee = "${email}" AND "${fieldId}" is not EMPTY`;
  const url = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fieldId)}&maxResults=20`;
  const data = await jiraRequest("GET", url);
  const issues = data.issues ?? [];
  for (const issue of issues) {
    const v = issue.fields?.[fieldId];
    if (!v) continue;
    const id = typeof v === "string" ? v : (v.id ?? v.value ?? v.teamId);
    const label = typeof v === "object" ? (v.name ?? v.title ?? "(unknown)") : "(unknown)";
    if (label !== "Unified Platform") continue;
    if (!id) continue;
    return { id, label };
  }
  throw new Error(
    "Could not auto-discover the Unified Platform team UUID. Set JIRA_TEAM_ID manually.",
  );
}

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

async function enrichIds(jiraRequest, currentConfig) {
  const teamFieldIdRaw = await discoverTeamFieldId(jiraRequest);
  const teamFieldId = { id: teamFieldIdRaw, label: "Team (custom field)" };
  const teamId = await discoverTeamId(jiraRequest, teamFieldIdRaw, currentConfig.JIRA_EMAIL);
  const accountId = await discoverAccountId(jiraRequest, currentConfig.JIRA_EMAIL);
  const productFieldIdValue = currentConfig.JIRA_PRODUCT_FIELD_ID || "customfield_12037";
  const productFieldId = { id: productFieldIdValue, label: "Product (custom field)" };
  return { teamFieldId, teamId, accountId, productFieldId };
}

module.exports = { discoverTeamFieldId, discoverTeamId, discoverAccountId, enrichIds };
