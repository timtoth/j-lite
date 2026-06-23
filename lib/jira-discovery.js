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
// matching. Org-specific custom select-lists (e.g. Product, Region) are not
// listed here; they go into the generic customFields map below.
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
];

function extractAllowedValues(allowedValues) {
  if (!Array.isArray(allowedValues)) return null;
  const out = [];
  for (const v of allowedValues) {
    if (typeof v?.value === "string") out.push(v.value);
    else if (typeof v?.name === "string") out.push(v.name);
  }
  return out;
}

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
  const known = {
    team: "", fixVersions: "", storyPoints: "", sprint: "",
  };
  function matchOnce(schemaOnly) {
    for (const [fieldId, fieldDef] of Object.entries(fields)) {
      if (!fieldDef) continue;
      const name = String(fieldDef.name ?? "").trim().toLowerCase();
      for (const { key, match } of FIELD_NAME_MAP) {
        if (known[key]) continue;
        if (schemaOnly && !match(fieldDef, "")) continue;
        if (match(fieldDef, name)) {
          known[key] = fieldDef.fieldId || fieldId;
        }
      }
    }
  }
  matchOnce(true);
  matchOnce(false);

  // Generic select-list custom fields → customFields[name] = { fieldId, allowedValues }.
  // Excludes built-in fields we successfully matched above (team, sprint, etc.).
  // First occurrence wins on lowercased-name collision (mirrors the fieldId union policy).
  const knownFieldIds = new Set(Object.values(known).filter(Boolean));
  const customFields = {};
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    if (!fieldDef) continue;
    if (knownFieldIds.has(fieldId)) continue;
    const values = extractAllowedValues(fieldDef.allowedValues);
    if (values === null) continue;
    const name = String(fieldDef.name ?? "").trim().toLowerCase();
    if (!name) continue;
    if (name in customFields) continue;
    const entry = { fieldId: fieldDef.fieldId || fieldId, allowedValues: values };
    if (fieldDef.required === true) entry.required = true;
    customFields[name] = entry;
  }

  const result = { teamId: "", fields: known };
  if (Object.keys(customFields).length > 0) result.customFields = customFields;
  return result;
}

module.exports = { discoverAccountId, discoverSpaceFields };
