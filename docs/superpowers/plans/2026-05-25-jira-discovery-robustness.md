# JIRA Discovery Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden JIRA field discovery against localized/renamed field names by adding schema-key matching, and let users edit a per-space `teamId` from Settings UI now that discovery cannot supply it.

**Architecture:** Two independent improvements to the per-space discovery flow that landed in `2026-05-24-jira-spaces-discovery.md`. (1) `lib/jira-discovery.js`'s `FIELD_NAME_MAP` extends each entry with a single `match(fieldDef)` predicate that consults both the field name and `fieldDef.schema` (the locale-stable custom-type identifier from JIRA's createmeta response). (2) A new `PUT /api/settings/spaces/:key` endpoint wraps `config.setSpace` so the renderer can persist a user-edited `teamId`; `SpaceAccordion` gains inline edit/save/cancel controls on the Team ID row.

**Tech Stack:** Node.js (no build step for server), `node --test`, Express, React + Vite (TypeScript). Existing test patterns reused: module-mutation mocking for routes, `fakeJiraRequest` helper for discovery.

**Background:** The previous plan's Task 3 left two open items the reviewer flagged:
- `FIELD_NAME_MAP` matched only on lowercased English field names, breaking on localized JIRA instances (e.g. "Sprint" → "Sprint Number" in some configurations) or instances that have renamed default fields.
- `discoverSpaceFields` always returns `teamId: ""` because the createmeta endpoint exposes the *field* but not the *team value*; the user must supply the team UUID. Until now, the only way to set it was hand-editing `config.json`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/jira-discovery.js` | Field-id discovery from createmeta | Extend `FIELD_NAME_MAP` matchers to consult `fieldDef.schema` |
| `lib/jira-discovery.test.js` | Unit tests for discovery | Add 5 schema-match tests |
| `routes/settings.js` | Settings HTTP routes | Add `PUT /api/settings/spaces/:key` endpoint |
| `routes/settings.test.js` | Route tests | Add 4 tests for the new endpoint |
| `client/src/api.ts` | Frontend API client | Add `updateJiraSpace(key, patch)` |
| `client/src/components/settings/SpaceAccordion.tsx` | Per-space accordion UI | Replace static Team ID row with inline edit |
| `client/src/App.css` | Styles | Append edit-mode styles for the team-id row |

`SpaceAccordion`'s save handler will call `updateJiraSpace`; on success it lifts the new value into the parent `JiraProjectCard` via a new `onUpdate` prop, mirroring how `onRefresh` already works. No new types are introduced — `JiraSpace` already covers everything.

---

## Task 1: Schema-aware field matching in `lib/jira-discovery.js`

**Files:**
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.js`
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.test.js`

**Why this works:** JIRA's createmeta response includes a `schema` object on each field with stable identifiers — `schema.system` for built-in fields (e.g. `"fixVersions"`), `schema.custom` for custom field types (e.g. `"com.pyxis.greenhopper.jira:gh-sprint"`), and `schema.type` for value-class hints. These identifiers are not localized and don't change when admins rename the user-facing label. We make the matcher consult schema first, then fall back to name-matching for the cases where the schema is too generic to disambiguate (Product custom field is a plain `option` type indistinguishable from any other select-list).

- [ ] **Step 1.1: Add a failing test for Sprint matched by schema.custom even when localized**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.test.js`. Append:

```javascript
test("discoverSpaceFields matches Sprint by schema.custom when name is localized", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10020: {
                  fieldId: "customfield_10020",
                  name: "Iteration",
                  schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10020 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.sprint, "customfield_10020");
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --test lib/jira-discovery.test.js`
Expected: FAIL on the new test ("Sprint matched by schema.custom") because the current matcher checks the lowercased name only and "iteration" doesn't equal "sprint".

- [ ] **Step 1.3: Add a failing test for Story Points matched by schema.custom**

Append to the same test file:

```javascript
test("discoverSpaceFields matches Story Points by schema.custom when name differs", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10010: {
                  fieldId: "customfield_10010",
                  name: "Effort",
                  schema: { type: "number", custom: "com.pyxis.greenhopper.jira:jsw-story-points", customId: 10010 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.storyPoints, "customfield_10010");
});
```

- [ ] **Step 1.4: Add a failing test for Fix Versions matched by schema.system**

```javascript
test("discoverSpaceFields matches Fix Versions by schema.system when name is localized", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                fixVersions: {
                  fieldId: "fixVersions",
                  name: "Versions de correctif",
                  schema: { type: "array", system: "fixVersions", items: "version" },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.fixVersions, "fixVersions");
});
```

- [ ] **Step 1.5: Add a failing test for Team matched by schema.type**

```javascript
test("discoverSpaceFields matches Team by schema.type when name differs", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_10001: {
                  fieldId: "customfield_10001",
                  name: "Squad",
                  schema: { type: "team", custom: "com.atlassian.teams:rm-teams-custom-field-team", customId: 10001 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.team, "customfield_10001");
});
```

- [ ] **Step 1.6: Add a failing test for schema-match precedence over a wrong name match**

This guards against the edge case where two fields exist and the one with a matching name is *not* the right one (a custom field literally named "Sprint" that's a plain text field, plus a real Sprint field with a different name). Schema match should win.

```javascript
test("discoverSpaceFields prefers schema match over a coincidental name match", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "DE",
          issuetypes: [
            {
              name: "Story",
              fields: {
                customfield_99998: {
                  fieldId: "customfield_99998",
                  name: "Sprint",
                  schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield", customId: 99998 },
                },
                customfield_10020: {
                  fieldId: "customfield_10020",
                  name: "Iteration",
                  schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10020 },
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "DE");
  assert.equal(result.fields.sprint, "customfield_10020");
});
```

- [ ] **Step 1.7: Run all five new tests to confirm they fail**

Run: `node --test lib/jira-discovery.test.js`
Expected: 5 failures (the 5 newly-added tests). The 6 pre-existing tests should still pass.

- [ ] **Step 1.8: Update `FIELD_NAME_MAP` to consult schema**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.js`. Replace the entire `FIELD_NAME_MAP` block and the loop that uses it.

Replace:

```javascript
const FIELD_NAME_MAP = [
  { key: "team",         match: (n) => n === "team" },
  { key: "fixVersions",  match: (n) => n === "fix versions" },
  { key: "storyPoints",  match: (n) => n === "story points" || n === "story point estimate" },
  { key: "sprint",       match: (n) => n === "sprint" },
  { key: "product",      match: (n) => n === "product" },
];
```

with:

```javascript
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
```

Then update the matching loop. Replace:

```javascript
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    const name = String(fieldDef?.name ?? "").trim().toLowerCase();
    for (const { key, match } of FIELD_NAME_MAP) {
      if (!result[key] && match(name)) {
        result[key] = fieldDef.fieldId || fieldId;
        break;
      }
    }
  }
```

with:

```javascript
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
```

The first pass passes an empty string as the name to each matcher. Since every name-only predicate in `FIELD_NAME_MAP` is `name === "<literal>"`, an empty name will only match if the matcher's schema clauses fired — so the first pass exclusively claims slots for schema-driven matches. The second pass is unconstrained and picks up name-only matches for keys still empty. Do not introduce a separate `(def) => ...` predicate; it duplicates the schema knowledge already encoded inside each matcher.

- [ ] **Step 1.9: Run all tests to confirm pass**

Run: `node --test lib/jira-discovery.test.js`
Expected: 11 tests pass (6 pre-existing + 5 new).

- [ ] **Step 1.10: Run full suite to confirm no regressions**

Run: `npm test`
Expected: 83/83 pass (78 from prior plan + 5 new in this task).

- [ ] **Step 1.11: Commit**

```bash
git add lib/jira-discovery.js lib/jira-discovery.test.js
git commit -m "feat(discovery): match JIRA fields by schema identifiers, not just name"
```

---

## Task 2: `PUT /api/settings/spaces/:key` endpoint

**Files:**
- Modify: `C:\GHSource\ticket-control\routes\settings.js`
- Modify: `C:\GHSource\ticket-control\routes\settings.test.js`

**Behavior:** `PUT /api/settings/spaces/RL` with body `{ teamId: "uuid" }` updates only the `teamId` of the existing space record, preserves `fields` and `discoveredAt`, and clears any prior `error`. Returns the merged record. Returns 404 if the space doesn't exist (forces users through discovery to create new spaces). Returns 400 if `teamId` is not a string.

- [ ] **Step 2.1: Write the failing happy-path test**

Append to `C:\GHSource\ticket-control\routes\settings.test.js`:

```javascript
test("PUT /api/settings/spaces/:key updates teamId and preserves fields", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {
        RL: {
          teamId: "old-team",
          fields: { team: "customfield_10001", fixVersions: "fixVersions", storyPoints: "", sprint: "", product: "" },
          discoveredAt: "2026-05-24T00:00:00.000Z",
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: "new-team-uuid" });
  assert.equal(res.status, 200);
  assert.equal(res.json.teamId, "new-team-uuid");
  assert.equal(res.json.fields.team, "customfield_10001");
  assert.equal(res.json.discoveredAt, "2026-05-24T00:00:00.000Z");
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_SPACES.RL.teamId, "new-team-uuid");
  assert.equal(onDisk.JIRA_SPACES.RL.fields.team, "customfield_10001");
});
```

- [ ] **Step 2.2: Write the failing 404 test**

```javascript
test("PUT /api/settings/spaces/:key returns 404 when space doesn't exist", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/MISSING", { teamId: "x" });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2.3: Write the failing validation test**

```javascript
test("PUT /api/settings/spaces/:key rejects non-string teamId", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: { RL: { teamId: "", fields: {} } },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: 1234 });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2.4: Write the failing test that confirms prior `error` is cleared**

```javascript
test("PUT /api/settings/spaces/:key clears prior error field", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_PRODUCT_FIELD_ID: "",
      JIRA_SPACES: {
        RL: {
          teamId: "",
          fields: { team: "customfield_10001" },
          error: "discovery failed last time",
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/RL", { teamId: "fresh" });
  assert.equal(res.status, 200);
  assert.equal(res.json.error, undefined);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_SPACES.RL.error, undefined);
});
```

- [ ] **Step 2.5: Run the four new tests to confirm they fail**

Run: `node --test routes/settings.test.js`
Expected: 4 failures (the new tests). All others still pass.

- [ ] **Step 2.6: Add the route handler in `routes/settings.js`**

Edit `C:\GHSource\ticket-control\routes\settings.js`. Insert the new route after the `POST /api/settings/discover` block and before `function checkClaude()`:

```javascript
router.put("/api/settings/spaces/:key", (req, res) => {
  const key = req.params.key;
  const body = req.body || {};
  if (typeof body.teamId !== "string") {
    return res.status(400).json({ error: "teamId must be a string" });
  }
  const existing = config.getSpace(key);
  if (!existing) {
    return res.status(404).json({ error: `Unknown space: ${key}` });
  }
  const merged = {
    teamId: body.teamId,
    fields: { ...(existing.fields || {}) },
  };
  if (existing.discoveredAt) merged.discoveredAt = existing.discoveredAt;
  // `error` is intentionally not copied — successful edit clears it.
  try {
    config.setSpace(key, merged);
    return res.json(merged);
  } catch (err) {
    logger.error("CONFIG", `Failed to update space ${key}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2.7: Run the new tests to confirm they pass**

Run: `node --test routes/settings.test.js`
Expected: all tests pass (the original 11 + 4 new).

- [ ] **Step 2.8: Run full suite**

Run: `npm test`
Expected: 87/87 pass (83 from end of Task 1 + 4 new).

- [ ] **Step 2.9: Commit**

```bash
git add routes/settings.js routes/settings.test.js
git commit -m "feat(settings): PUT /api/settings/spaces/:key for inline teamId edit"
```

---

## Task 3: Frontend `updateJiraSpace` API helper

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\api.ts`

- [ ] **Step 3.1: Add the helper**

Edit `C:\GHSource\ticket-control\client\src\api.ts`. After the existing `discoverJiraIds` function (currently ending around line 149), insert:

```typescript
export async function updateJiraSpace(
  spaceKey: string,
  patch: { teamId: string },
): Promise<JiraSpace> {
  const res = await apiFetch(`/api/settings/spaces/${encodeURIComponent(spaceKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let message = "Failed to update space";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep default message
    }
    throw new Error(message);
  }
  return res.json();
}
```

- [ ] **Step 3.2: Update the imports at the top of `api.ts`**

The existing import block currently reads:

```typescript
import {
  Ticket,
  Epic,
  EpicChild,
  ListResponse,
  Settings,
  SettingsPatch,
  DiscoveryResult,
  SettingsStatus,
} from "./types";
```

Add `JiraSpace`:

```typescript
import {
  Ticket,
  Epic,
  EpicChild,
  ListResponse,
  Settings,
  SettingsPatch,
  DiscoveryResult,
  SettingsStatus,
  JiraSpace,
} from "./types";
```

- [ ] **Step 3.3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3.4: Commit**

```bash
git add client/src/api.ts
git commit -m "feat(client): add updateJiraSpace API helper"
```

---

## Task 4: Inline `teamId` editing in `SpaceAccordion`

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\JiraProjectCard.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\App.css`

**UX:** Team ID row shows the current value plus an "Edit" pencil-style link. Clicking Edit replaces the row with an input + Save + Cancel buttons. Saving calls `updateJiraSpace`; on success the parent `JiraProjectCard` lifts the new record into `values`. On failure an inline error appears; the input stays focused.

- [ ] **Step 4.1: Append CSS to `client/src/App.css`**

Find the `/* ---- Space Accordion ---- */` block (added in the prior plan). Append these new rules at the end of that block (before the next section comment):

```css
.space-accordion__field-row--editable {
  align-items: center;
}

.space-accordion__edit-btn {
  background: none;
  border: none;
  color: #8b9cf7;
  cursor: pointer;
  font-size: 0.78rem;
  padding: 0 4px;
}

.space-accordion__edit-btn:hover {
  text-decoration: underline;
}

.space-accordion__edit-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 0;
}

.space-accordion__edit-row input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #3a3f47;
  background: #15181c;
  color: #e6e8eb;
  border-radius: 4px;
  font-size: 0.82rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.space-accordion__edit-row button {
  background: #2a3f5a;
  color: #e6e8eb;
  border: 1px solid #3a4f6a;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.78rem;
  cursor: pointer;
}

.space-accordion__edit-row button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.space-accordion__edit-row button.cancel {
  background: transparent;
  border-color: #3a3f47;
  color: #a8b0b9;
}

.space-accordion__edit-error {
  color: #f5b7b1;
  font-size: 0.78rem;
  padding: 4px 0 0;
}
```

- [ ] **Step 4.2: Replace `SpaceAccordion.tsx` entirely**

Overwrite `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx` with:

```typescript
import { useState } from "react";
import { JiraSpace } from "../../types";
import { updateJiraSpace } from "../../api";

interface Props {
  spaceKey: string;
  space: JiraSpace;
  onRefresh: (key: string) => Promise<void>;
  onUpdate: (key: string, next: JiraSpace) => void;
}

const FIELD_LABELS: Array<[keyof JiraSpace["fields"], string]> = [
  ["team", "Team field"],
  ["fixVersions", "Fix Versions field"],
  ["storyPoints", "Story Points field"],
  ["sprint", "Sprint field"],
  ["product", "Product field"],
];

export function SpaceAccordion({ spaceKey, space, onRefresh, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [draftTeamId, setDraftTeamId] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  const fieldCount = FIELD_LABELS.filter(([k]) => !!space.fields?.[k]).length;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh(spaceKey);
    } finally {
      setRefreshing(false);
    }
  }

  function startEdit() {
    setDraftTeamId(space.teamId || "");
    setTeamError(null);
    setEditingTeam(true);
  }

  function cancelEdit() {
    setEditingTeam(false);
    setTeamError(null);
  }

  async function saveTeamId() {
    setSavingTeam(true);
    setTeamError(null);
    try {
      const next = await updateJiraSpace(spaceKey, { teamId: draftTeamId.trim() });
      onUpdate(spaceKey, next);
      setEditingTeam(false);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingTeam(false);
    }
  }

  return (
    <div className="space-accordion">
      <div className="space-accordion__header" onClick={() => setOpen(!open)}>
        <div className="space-accordion__title">
          <span className="space-accordion__chevron">{open ? "▼" : "▶"}</span>
          {spaceKey}
        </div>
        <span className="space-accordion__count">
          {fieldCount} field{fieldCount === 1 ? "" : "s"} discovered
        </span>
      </div>
      {open && (
        <div className="space-accordion__body">
          {editingTeam ? (
            <div className="space-accordion__edit-row">
              <input
                type="text"
                autoFocus
                placeholder="Team UUID"
                value={draftTeamId}
                onChange={(e) => setDraftTeamId(e.target.value)}
                disabled={savingTeam}
              />
              <button onClick={saveTeamId} disabled={savingTeam}>
                {savingTeam ? "Saving…" : "Save"}
              </button>
              <button className="cancel" onClick={cancelEdit} disabled={savingTeam}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-accordion__field-row space-accordion__field-row--editable">
              <span>Team ID</span>
              <span>
                <strong>{space.teamId || "(not set)"}</strong>
                <button type="button" className="space-accordion__edit-btn" onClick={startEdit}>
                  Edit
                </button>
              </span>
            </div>
          )}
          {teamError && <div className="space-accordion__edit-error">{teamError}</div>}

          {FIELD_LABELS.map(([key, label]) => (
            <div className="space-accordion__field-row" key={key}>
              <span>{label}</span>
              <strong>{space.fields?.[key] || "(not discovered)"}</strong>
            </div>
          ))}
          {space.error && (
            <div className="settings-error" style={{ marginTop: 8 }}>
              {space.error}
            </div>
          )}
          <button className="space-accordion__refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Re-discover this space"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.3: Wire `onUpdate` through `JiraProjectCard.tsx`**

Edit `C:\GHSource\ticket-control\client\src\components\settings\JiraProjectCard.tsx`. Find the `<SpaceAccordion ... />` element (currently around lines 99–106):

```typescript
      {Object.entries(spaces).map(([key, space]) => (
        <SpaceAccordion
          key={key}
          spaceKey={key}
          space={space}
          onRefresh={async (k) => { await runDiscovery(k); }}
        />
      ))}
```

Replace with:

```typescript
      {Object.entries(spaces).map(([key, space]) => (
        <SpaceAccordion
          key={key}
          spaceKey={key}
          space={space}
          onRefresh={async (k) => { await runDiscovery(k); }}
          onUpdate={(k, next) => {
            onValuesChange({
              ...values,
              JIRA_SPACES: { ...values.JIRA_SPACES, [k]: next },
            });
          }}
        />
      ))}
```

- [ ] **Step 4.4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4.5: Run full suite**

Run: `npm test`
Expected: 87/87 pass (no new server-side tests in this task; UI is verified manually).

- [ ] **Step 4.6: Manual visual check**

Run: `npm start`. In Settings:
1. Expand the RL accordion. Confirm the Team ID row shows the current value with an "Edit" button next to it.
2. Click Edit. Confirm an input appears prefilled with the current team UUID, plus Save and Cancel.
3. Click Cancel. Confirm the row reverts and no save happens.
4. Click Edit, change the value, click Save. Confirm the new value is shown after the save and `config.json` (in `%APPDATA%\ticket-control\config.json` for packaged Electron) reflects the change.
5. Trigger an error: click Edit, then in DevTools → Network, set offline mode, then Save. Confirm an inline error appears and the input stays editable.

- [ ] **Step 4.7: Commit**

```bash
git add client/src/components/settings/SpaceAccordion.tsx client/src/components/settings/JiraProjectCard.tsx client/src/App.css
git commit -m "feat(client): inline teamId editing in SpaceAccordion"
```

---

## Self-review notes

- Task 1's matcher loop runs twice. The first pass calls each matcher with an empty `name`, so only matchers whose schema clauses fire can claim a slot. The second pass runs without that constraint and lets name-only fallbacks (Product) match. The "Sprint custom text field" edge case test (Step 1.6) proves schema wins over coincidental names.
- Task 1's `storyPoints` matcher contains both schema and name predicates because there are *two* common Story Points fields in the wild: the legacy custom number field (no stable schema beyond `float`, indistinguishable from any other float) and the newer Greenhopper-managed `jsw-story-points`. The matcher accepts either, with name fallback for the legacy case.
- Task 2's endpoint is intentionally narrow (`teamId` only). Future per-space edits (e.g. overriding a discovered field ID) can extend the same handler without breaking the contract — accept additional keys in `body` and merge into `merged.fields`. Out of scope here.
- Task 4's `onUpdate` lifts state into the parent the same way `onRefresh` already does (via `runDiscovery` → `onValuesChange`). No new state-management pattern.
- The `"discoveredAt"` field is preserved on edit but not bumped — editing `teamId` is a user action, not a discovery, so the timestamp keeps its meaning ("last time we ran createmeta against this space").

---
