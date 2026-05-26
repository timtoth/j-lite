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

// Each matcher returns truthy if `fieldDef` represents the conceptual field.
// We prefer schema identifiers (locale-stable, admin-rename-stable) over name
// matching. Name fallback covers fields without a stable schema (e.g. Product,
// which is an instance-specific custom select-list).
const FIELD_NAME_MAP = [
  {
    key: "team",
    match: (def, name) =>
      def.schema?.type === "team" ||
      def.schema?.custom === "com.atlassian.teams:rm-teams-custom-field-team" ||
      name === "team",
  },
  {
    key: "fixVersions",
    match: (def, name) =>
      def.schema?.system === "fixVersions" ||
      name === "fix versions",
  },
  {
    key: "storyPoints",
    match: (def, name) =>
      def.schema?.custom === "com.pyxis.greenhopper.jira:jsw-story-points" ||
      def.schema?.custom === "com.atlassian.jira.plugin.system.customfieldtypes:float" && name === "story points" ||
      name === "story points" ||
      name === "story point estimate",
  },
  {
    key: "sprint",
    match: (def, name) =>
      def.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint" ||
      name === "sprint",
  },
  {
    key: "product",
    match: (def, name) => name === "product",
  },
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
  // Union every issue type's fields. Each issuetype's `fields` map only lists
  // what that issuetype's create screen exposes, so a field present on Story
  // but not on Epic would otherwise be invisible. First issuetype to define a
  // given fieldId wins; in practice fieldIds are tenant-stable so duplicates
  // resolve to identical definitions anyway.
  const fields = {};
  for (const issueType of project.issuetypes ?? []) {
    for (const [fieldId, fieldDef] of Object.entries(issueType?.fields ?? {})) {
      if (!(fieldId in fields)) fields[fieldId] = fieldDef;
    }
  }
  const result = {
    team: "", fixVersions: "", storyPoints: "", sprint: "", product: "",
  };
  // Two-pass: schema-only matchers run first so a schema match always wins
  // over a coincidental name collision on a different field. A matcher that
  // succeeds with an empty name must be matching on schema alone.
  function matchOnce(schemaOnly) {
    for (const [fieldId, fieldDef] of Object.entries(fields)) {
      if (!fieldDef) continue;
      const name = String(fieldDef.name ?? "").trim().toLowerCase();
      for (const { key, match } of FIELD_NAME_MAP) {
        if (result[key]) continue;
        if (schemaOnly && !match(fieldDef, "")) continue;
        if (match(fieldDef, name)) {
          result[key] = fieldDef.fieldId || fieldId;
        }
      }
    }
  }
  matchOnce(true);
  matchOnce(false);
  return { teamId: "", fields: result };
}

module.exports = { discoverAccountId, discoverSpaceFields };
