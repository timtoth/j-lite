# Custom Field Removal & System-Field Misclassification Fix — Design

**Status:** Approved 2026-07-27

**Goal:** Fix `discoverSpaceFields` mis-classifying JIRA system fields (e.g. `project`) as org-specific custom fields, and add the ability to permanently remove a misclassified or unwanted custom field from a space, both through the Settings UI and through the MCP server.

**Why:** Ticket creation is currently broken for at least one space because discovery added `project` into that space's `customFields` map. `project` has `allowedValues` (the list of JIRA projects the field can point to) but is a JIRA **system** field — `create_jira_ticket` sends it as `fields[fieldId] = [{ value }]` (the generic custom-field shape), but JIRA only accepts `fields.project = { key: "ABC" }`. There is currently no way to remove a bad entry short of hand-editing `config.json`.

**Non-goals:**
- General per-field editing UI (renaming, changing allowedValues by hand).
- MCP tool to restore a previously-excluded field — restore is a manual/corrective action, UI-only is sufficient.
- Retroactively cleaning up already-created tickets that hit this bug.

---

## 1. Root cause: fix the classification, don't just patch around it

`lib/jira-discovery.js`'s generic-custom-field loop (`discoverSpaceFields`, ~line 100-113) adds *any* field with `allowedValues` to `customFields`, as long as its `fieldId` isn't already claimed by the four known built-ins (team/fixVersions/storyPoints/sprint). JIRA system fields like `project` and `priority` also expose `allowedValues` but are not custom fields.

JIRA marks every true custom field with `schema.custom` (a plugin type string like `com.atlassian.jira.plugin.system.customfieldtypes:select`) and a `customfield_NNNNN` id. System fields instead set `schema.system` (e.g. `"project"`, `"priority"`) and use a plain field id.

**Fix:** in the generic custom-field loop, skip any field where `fieldDef.schema?.system` is set. This is a one-line guard added before the `allowedValues` check, so `project` (and any other system field) is never captured as custom, without needing a hardcoded name blocklist.

This alone fixes new discoveries. Existing bad entries already in `config.json` (like a previously-discovered `project`) are cleaned up via the removal feature below.

---

## 2. Data model: per-space exclusion list

Add `excludedCustomFields: string[]` to the space record shape, storing lowercased field *names* (matching how `customFields` is keyed):

```json
{
  "JIRA_SPACES": {
    "ABC": {
      "teamId": "team-uuid",
      "fields": { "team": "customfield_10001", ... },
      "customFields": {
        "region": { "fieldId": "customfield_20001", "allowedValues": ["NA", "EU"] }
      },
      "excludedCustomFields": ["project"],
      "discoveredAt": "2026-07-27T12:00:00.000Z"
    }
  }
}
```

- `excludedCustomFields` is omitted (not an empty array) when a space has no exclusions, consistent with how `customFields` is already omitted when empty.
- Exclusion is by lowercased field **name**, not fieldId — names are what discovery keys `customFields` by, and what both the UI and MCP `remove_custom_field` tool operate on.
- Discovery merges are filtered against this list (Section 3) so an excluded field never resurfaces on re-discovery, even if JIRA still reports it as select-list-shaped.

### `config.js` changes

Two new exported helpers, following the existing `getSpace`/`setSpace` pattern:

- `excludeCustomField(spaceKey, fieldName)` — reads the space, deletes `customFields[fieldName]` if present, adds `fieldName` to `excludedCustomFields` (dedup, lowercase), writes back. Returns the updated space record, or `null` if the space doesn't exist.
- `restoreCustomField(spaceKey, fieldName)` — removes `fieldName` from `excludedCustomFields`. Does **not** re-add the field to `customFields` (the next discovery/re-discovery will naturally pick it back up, now that it's no longer excluded). Returns the updated space record, or `null` if the space doesn't exist.

Both use `refreshIfStale()` + `writeAtomic()` like the existing helpers.

---

## 3. Fix pre-existing merge bug (blocking prerequisite)

Both re-discovery paths currently drop `customFields` on merge — only the ticket-creation retry path in `mcp/jira-create.js` merges it correctly today:

- `routes/settings.js` `refreshSpace()` (~line 59-74): builds `merged` from `teamId` and `fields` only.
- `mcp/create-ticket-server.mjs` `handleDiscover()` (~line 86-98): same gap.

Without a fix, clicking "Discover from JIRA" (or calling `discover_jira_space` via MCP) silently wipes any previously-discovered custom fields **and** any exclusion list — defeating the point of permanent exclusion.

**Fix (both places):** when building `merged`, also merge `customFields` (existing ∪ fresh, fresh wins on collision — same policy already used in `jira-create.js`'s retry path) and carry over `excludedCustomFields` from `existing` unchanged (discovery never produces this field itself). Then filter the merged `customFields` to drop any name present in `excludedCustomFields` before persisting.

Concretely, in both functions:
```js
const excluded = new Set(existing.excludedCustomFields || []);
const mergedCustomFields = { ...(existing.customFields || {}), ...(fresh.customFields || {}) };
for (const name of excluded) delete mergedCustomFields[name];
const merged = {
  teamId: existing.teamId || fresh.teamId || "",
  fields: { ...existing.fields, ...fresh.fields },
  ...(Object.keys(mergedCustomFields).length > 0 ? { customFields: mergedCustomFields } : {}),
  ...(existing.excludedCustomFields ? { excludedCustomFields: existing.excludedCustomFields } : {}),
  discoveredAt: new Date().toISOString(),
};
```

---

## 4. REST API

New endpoints in `routes/settings.js`, alongside the existing `/api/settings/spaces/:key` routes:

- `DELETE /api/settings/spaces/:key/custom-fields/:name`
  - Calls `config.excludeCustomField(key, name)`.
  - 404 if the space doesn't exist.
  - Returns the updated space record (200) — mirrors `PUT /api/settings/spaces/:key`'s response shape, not a bare 204, since the client needs the updated `customFields`/`excludedCustomFields` to update local state.
- `POST /api/settings/spaces/:key/custom-fields/:name/restore`
  - Calls `config.restoreCustomField(key, name)`.
  - 404 if the space doesn't exist.
  - Returns the updated space record (200).

`:name` is the lowercased display name, URL-encoded (e.g. `project`, `region`).

---

## 5. Settings UI

`client/src/components/settings/SpaceAccordion.tsx`:

- Each row under "Custom fields" gets a small remove button (🗑, same visual language as the existing space-level remove — inline confirm, no modal).
- New "Excluded fields" section (shown only when `excludedCustomFields` is non-empty) below the custom fields list: each entry shows the field name with a "Restore" button.
- Both actions call new `client/src/api.ts` functions (`removeCustomField`, `restoreCustomField`), following the existing `updateJiraSpace`/`deleteJiraSpace` fetch pattern, and update local state via the existing `onUpdate(key, next)` callback already threaded through from `JiraProjectCard`.

`client/src/types.ts`: add `excludedCustomFields?: string[]` to `JiraSpace`.

No changes needed to `JiraProjectCard.tsx` — it already passes `onUpdate` through to `SpaceAccordion`, which is sufficient for the new actions.

---

## 6. MCP server

`mcp/create-ticket-server.mjs`: new independent tool, registered alongside `create_jira_ticket` and `discover_jira_space`.

```js
const REMOVE_CUSTOM_FIELD_TOOL = {
  name: "remove_custom_field",
  description:
    "Permanently remove a custom field from a space's discovered configuration. " +
    "Use this when a field was incorrectly discovered as a custom field (e.g. it is " +
    "actually a JIRA system field) or is otherwise not needed. The field will not " +
    "reappear on future discovery runs for this space.",
  inputSchema: {
    type: "object",
    properties: {
      space_key:  { type: "string", description: "Project key, e.g. ABC, XYZ." },
      field_name: { type: "string", description: "Custom field display name (case-insensitive), e.g. \"Project\"." },
    },
    required: ["space_key", "field_name"],
  },
};
```

Handler: `config.excludeCustomField(space_key, field_name)`; throw if the space is unknown (mirrors the existing `space_key is required` style error in `handleDiscover`). Returns the updated space record as JSON text, same envelope shape as the other two tools.

No MCP restore tool (non-goal) — restoring is UI-only.

---

## 7. Testing

### Unit
- `lib/jira-discovery.js` / `jira-discovery.test.js`:
  - A field with `schema.system` set and `allowedValues` present (simulating `project`) is excluded from `customFields`, even though it would otherwise qualify.
  - Existing "excludes builtins" test continues to pass alongside the new system-field guard.
- `config.js` / `config.test.js`:
  - `excludeCustomField` moves an entry from `customFields` to `excludedCustomFields`, dedups on repeated calls, returns `null` for unknown space.
  - `restoreCustomField` removes a name from `excludedCustomFields` without restoring it to `customFields`.
- `routes/settings.js` / `routes/settings.test.js`:
  - `refreshSpace` merge preserves existing `customFields` across a re-discovery call (regression test for the merge bug).
  - `refreshSpace` merge drops a customField whose name is in `excludedCustomFields`, even if freshly discovered again.
  - New DELETE / POST restore routes: happy path + 404 for unknown space.
- `mcp/create-ticket-server.test.js` (new or extended): `remove_custom_field` tool happy path; `handleDiscover` merge preserves `customFields` and respects `excludedCustomFields` (mirrors the settings.js regression test).

### Manual / integration
- Reproduce the original bug: discover a space where JIRA's createmeta includes `project` with `allowedValues`, confirm it no longer lands in `customFields` after the fix.
- For an already-corrupted `config.json` (containing a bad `project` custom field entry from before the fix): remove it via the Settings UI, re-run "Discover from JIRA", confirm it does not come back.
- Same flow via MCP: call `remove_custom_field`, then `discover_jira_space` again, confirm exclusion holds.
- Restore via UI, re-discover, confirm the field returns (assuming JIRA still reports it as a genuine select-list custom field).

---

## 8. Out of scope / deferred

- MCP-side restore tool.
- General custom-field editing (allowedValues, required flag) beyond remove/restore.
- Automatic detection/cleanup of other potentially-misclassified fields already sitting in existing configs beyond `project` — the fix prevents new misclassification and gives a manual removal path, but doesn't scan and auto-fix existing `config.json` files.
