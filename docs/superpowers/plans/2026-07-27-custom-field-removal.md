# Custom Field Removal & System-Field Misclassification Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop JIRA system fields (e.g. `project`) from being misclassified as org-specific custom fields during discovery, and give users a way to permanently remove a bad or unwanted custom field from a space — through the Settings UI and through the MCP server — without it resurfacing on re-discovery.

**Architecture:** A one-line classification guard in `lib/jira-discovery.js` stops new misclassification at the source. A new pure helper, `mergeSpaceRecord(existing, fresh)`, centralizes the "union customFields, but never resurrect an excluded one" merge policy and replaces three separate ad-hoc merges (`routes/settings.js`, `mcp/create-ticket-server.mjs`, `mcp/jira-create.js`) that currently disagree with each other — two of them silently drop `customFields` entirely today. `config.js` gains an `excludedCustomFields` list per space plus `excludeCustomField`/`restoreCustomField` helpers. Removal is exposed three ways: a REST endpoint pair, a new MCP tool (`remove_custom_field`), and buttons in `SpaceAccordion.tsx`; restore is UI-only.

**Tech Stack:** Node.js (CommonJS for server/lib/config, ESM `.mjs` for the MCP server), `node --test`, Express, React + Vite (TypeScript, no client test runner — `tsc -b` via `npm run build --prefix client` is the verification step for TS changes).

## Global Constraints

- Custom field identity for exclusion/restoration purposes is the lowercased display **name** (matches how `customFields` is already keyed), not the JIRA `fieldId`.
- `excludedCustomFields` is omitted from a space record (not stored as `[]`) when empty — mirrors how `customFields` is already omitted when empty.
- No MCP tool for restoring a field — restore is UI-only (non-goal, confirmed in the approved spec).
- Every merge of discovery results with an existing space record — no matter which of the three call sites — must go through the single shared `mergeSpaceRecord` helper so exclusion is honored everywhere.
- REST endpoints for exclude/restore return the updated space record as JSON (200), not a bare 204 — the client needs the new `customFields`/`excludedCustomFields` shape to update local state.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/jira-discovery.js` | Field discovery from createmeta + space-record merge policy | Add `schema.system` guard; add exported `mergeSpaceRecord(existing, fresh)` |
| `lib/jira-discovery.test.js` | Unit tests for discovery | Add system-field-exclusion test + `mergeSpaceRecord` tests |
| `config.js` | Space record persistence | Add `excludeCustomField(key, name)` / `restoreCustomField(key, name)` |
| `config.test.js` | Unit tests for config | Add tests for the two new helpers |
| `routes/settings.js` | Settings HTTP routes | Fix `refreshSpace` merge bug; add `DELETE`/`POST restore` custom-field routes |
| `routes/settings.test.js` | Route tests | Add merge-preservation tests + new endpoint tests |
| `mcp/jira-create.js` | Ticket creation + 400-retry auto-discovery | Fix retry-path merge bug |
| `mcp/jira-create.test.js` | Unit tests | Add merge-preservation tests for the retry path |
| `mcp/create-ticket-server.mjs` | MCP stdio server | Fix `handleDiscover` merge bug; add `remove_custom_field` tool; make handlers importable for tests |
| `mcp/create-ticket-server.test.js` | New — unit tests for the MCP handlers | `handleDiscover` merge tests + `remove_custom_field` tests |
| `client/src/types.ts` | Frontend types | Add `excludedCustomFields?: string[]` to `JiraSpace` |
| `client/src/api.ts` | Frontend API client | Add `removeCustomField` / `restoreCustomField` |
| `client/src/components/settings/SpaceAccordion.tsx` | Per-space accordion UI | Remove button per custom field; "Excluded fields" restore list |
| `client/src/App.css` | Styles | New classes for the remove/restore controls |

---

## Task 1: Stop system fields from being classified as custom fields

**Files:**
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.js`
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.test.js`

**Why this works:** JIRA marks every system field (`project`, `priority`, `issuetype`, ...) with `schema.system` in the createmeta response. True custom fields never set `schema.system` — they use `schema.custom` and a `customfield_NNNNN` id instead. `project` currently slips into `customFields` because it exposes `allowedValues` (the list of projects it can point to) and isn't one of the four hardcoded built-ins, so the generic loop scoops it up. A single guard on `schema.system` fixes this for `project` and any other system field, without a name blocklist.

**Interfaces:**
- Produces: no change to `discoverSpaceFields(jiraRequest, spaceKey)`'s existing signature or return shape — only which fields land in `result.customFields`.

- [ ] **Step 1.1: Add a failing test reproducing the `project` misclassification**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.test.js`. Append:

```javascript
test("discoverSpaceFields excludes system fields like project even when they expose allowedValues", async () => {
  const jiraRequest = fakeJiraRequest({
    "GET /rest/api/3/issue/createmeta": () => ({
      projects: [
        {
          key: "ABC",
          issuetypes: [
            {
              name: "Story",
              fields: {
                project: {
                  fieldId: "project",
                  name: "Project",
                  schema: { type: "project", system: "project" },
                  allowedValues: [
                    { id: "10001", key: "ABC", name: "ABC Project" },
                  ],
                },
                customfield_30000: {
                  fieldId: "customfield_30000",
                  name: "Region",
                  allowedValues: [{ value: "NA" }],
                },
              },
            },
          ],
        },
      ],
    }),
  });
  const result = await discoverSpaceFields(jiraRequest, "ABC");
  assert.equal(result.customFields?.project, undefined);
  assert.deepEqual(result.customFields, {
    region: { fieldId: "customfield_30000", allowedValues: ["NA"] },
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --test lib/jira-discovery.test.js`
Expected: FAIL — `result.customFields.project` is currently `{ fieldId: "project", allowedValues: ["ABC Project"] }`, so `assert.equal(result.customFields?.project, undefined)` fails.

- [ ] **Step 1.3: Add the guard**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.js`. In `discoverSpaceFields`, find the generic custom-field loop:

```javascript
  const knownFieldIds = new Set(Object.values(known).filter(Boolean));
  const customFields = {};
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    if (!fieldDef) continue;
    if (knownFieldIds.has(fieldId)) continue;
    const values = extractAllowedValues(fieldDef.allowedValues);
```

Replace with:

```javascript
  const knownFieldIds = new Set(Object.values(known).filter(Boolean));
  const customFields = {};
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    if (!fieldDef) continue;
    if (knownFieldIds.has(fieldId)) continue;
    // JIRA system fields (project, priority, issuetype, ...) can expose
    // allowedValues too, but they are never custom fields — schema.system
    // is JIRA's own signal for "this is a system field", unlike schema.custom.
    if (fieldDef.schema?.system) continue;
    const values = extractAllowedValues(fieldDef.allowedValues);
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `node --test lib/jira-discovery.test.js`
Expected: PASS, including all pre-existing tests in the file (the guard only removes entries that have `schema.system` set, which none of the existing fixtures use for their custom-field cases).

- [ ] **Step 1.5: Commit**

```bash
git add lib/jira-discovery.js lib/jira-discovery.test.js
git commit -m "fix(discovery): exclude JIRA system fields from customFields classification"
```

---

## Task 2: Shared `mergeSpaceRecord` helper

**Files:**
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.js`
- Modify: `C:\GHSource\ticket-control\lib\jira-discovery.test.js`

**Why this works:** Three call sites each hand-roll a merge of an existing space record with a freshly-discovered one. Two of them (`routes/settings.js`, `mcp/create-ticket-server.mjs`) forget to merge `customFields` at all — a re-discovery silently wipes it. The third (`mcp/jira-create.js`) merges `customFields` correctly today but has no way to honor an exclusion list once one exists. Centralizing the policy in one pure function makes all three sites correct and keeps them from drifting apart again.

**Interfaces:**
- Produces: `mergeSpaceRecord(existing, fresh)` — pure function. `existing`/`fresh` are space records (`{ teamId, fields, customFields?, excludedCustomFields? }`, `fresh` never carries `excludedCustomFields`). Returns a new object `{ teamId, fields, customFields?, excludedCustomFields? }` (no `discoveredAt` — callers that want it append it themselves, matching current per-call-site behavior). `customFields`/`excludedCustomFields` are omitted when empty.
- Consumes: nothing beyond its two plain-object arguments.

- [ ] **Step 2.1: Add failing tests for the merge policy**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.test.js`. Update the top import line:

```javascript
const { discoverAccountId, discoverSpaceFields, mergeSpaceRecord } = require("./jira-discovery");
```

Append:

```javascript
test("mergeSpaceRecord unions customFields from existing and fresh, fresh wins on collision", () => {
  const existing = {
    teamId: "team-1",
    fields: { team: "customfield_10001" },
    customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
  };
  const fresh = {
    teamId: "",
    fields: { sprint: "customfield_10020" },
    customFields: {
      region: { fieldId: "customfield_20001", allowedValues: ["NA", "EU"] },
      product: { fieldId: "customfield_12037", allowedValues: ["Alpha"] },
    },
  };
  const merged = mergeSpaceRecord(existing, fresh);
  assert.deepEqual(merged, {
    teamId: "team-1",
    fields: { team: "customfield_10001", sprint: "customfield_10020" },
    customFields: {
      region: { fieldId: "customfield_20001", allowedValues: ["NA", "EU"] },
      product: { fieldId: "customfield_12037", allowedValues: ["Alpha"] },
    },
  });
});

test("mergeSpaceRecord drops customFields whose name is in existing.excludedCustomFields", () => {
  const existing = {
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
    excludedCustomFields: ["project"],
  };
  const fresh = {
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
  };
  const merged = mergeSpaceRecord(existing, fresh);
  assert.equal(merged.customFields, undefined);
  assert.deepEqual(merged.excludedCustomFields, ["project"]);
});

test("mergeSpaceRecord keeps existing teamId when fresh teamId is empty", () => {
  const merged = mergeSpaceRecord({ teamId: "team-1", fields: {} }, { teamId: "", fields: {} });
  assert.equal(merged.teamId, "team-1");
});

test("mergeSpaceRecord omits customFields and excludedCustomFields keys when both are empty", () => {
  const merged = mergeSpaceRecord({ teamId: "", fields: {} }, { teamId: "", fields: {} });
  assert.equal(merged.customFields, undefined);
  assert.equal(merged.excludedCustomFields, undefined);
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `node --test lib/jira-discovery.test.js`
Expected: FAIL with `mergeSpaceRecord is not a function` (or similar) — it doesn't exist yet.

- [ ] **Step 2.3: Implement `mergeSpaceRecord` and export it**

Edit `C:\GHSource\ticket-control\lib\jira-discovery.js`. Add above the final `module.exports` line:

```javascript
function mergeSpaceRecord(existing, fresh) {
  const excluded = new Set((existing.excludedCustomFields || []).map((n) => n.toLowerCase()));
  const mergedCustomFields = { ...(existing.customFields || {}), ...(fresh.customFields || {}) };
  for (const name of excluded) delete mergedCustomFields[name];
  const merged = {
    teamId: existing.teamId || fresh.teamId || "",
    fields: { ...existing.fields, ...fresh.fields },
  };
  if (Object.keys(mergedCustomFields).length > 0) merged.customFields = mergedCustomFields;
  if (existing.excludedCustomFields && existing.excludedCustomFields.length > 0) {
    merged.excludedCustomFields = existing.excludedCustomFields;
  }
  return merged;
}
```

Update the export line:

```javascript
module.exports = { discoverAccountId, discoverSpaceFields, mergeSpaceRecord };
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `node --test lib/jira-discovery.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 2.5: Commit**

```bash
git add lib/jira-discovery.js lib/jira-discovery.test.js
git commit -m "feat(discovery): add shared mergeSpaceRecord helper for space-record merges"
```

---

## Task 3: `config.js` — exclusion list and helpers

**Files:**
- Modify: `C:\GHSource\ticket-control\config.js`
- Modify: `C:\GHSource\ticket-control\config.test.js`

**Why this works:** `excludeCustomField`/`restoreCustomField` are the single place that moves a field name between `customFields` and `excludedCustomFields` on a space record, reusing the existing `getSpace`/`setSpace` (which already handle `refreshIfStale` + atomic writes). No migration is needed — `excludedCustomFields` is optional and every consumer already treats a missing key as "no exclusions" via `|| []`.

**Interfaces:**
- Produces: `config.excludeCustomField(spaceKey, fieldName)` → updated space record, or `null` if `spaceKey` doesn't exist. `config.restoreCustomField(spaceKey, fieldName)` → same. Both lowercase `fieldName` internally before comparing/storing.
- Consumes: existing `config.getSpace(key)` / `config.setSpace(key, record)`.

- [ ] **Step 3.1: Add failing tests**

Edit `C:\GHSource\ticket-control\config.test.js`. Append:

```javascript
test("excludeCustomField moves a field from customFields to excludedCustomFields", () => {
  const config = require("./config");
  config.setSpace("XYZ", {
    teamId: "",
    fields: {},
    customFields: {
      project: { fieldId: "project", allowedValues: ["ABC Project"] },
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    },
  });
  const updated = config.excludeCustomField("XYZ", "Project");
  assert.deepEqual(updated.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
  const onDisk = readConfig();
  assert.deepEqual(onDisk.JIRA_SPACES.XYZ.excludedCustomFields, ["project"]);
});

test("excludeCustomField dedups on repeated calls", () => {
  const config = require("./config");
  config.setSpace("XYZ", {
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: [] } },
  });
  config.excludeCustomField("XYZ", "project");
  const updated = config.excludeCustomField("XYZ", "project");
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
});

test("excludeCustomField returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.excludeCustomField("NOPE", "project"), null);
});

test("restoreCustomField removes a name from excludedCustomFields without restoring customFields", () => {
  const config = require("./config");
  config.setSpace("XYZ", { teamId: "", fields: {}, excludedCustomFields: ["project"] });
  const updated = config.restoreCustomField("XYZ", "project");
  assert.equal(updated.excludedCustomFields, undefined);
  assert.equal(updated.customFields, undefined);
});

test("restoreCustomField returns null for unknown space", () => {
  const config = require("./config");
  assert.equal(config.restoreCustomField("NOPE", "project"), null);
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `node --test config.test.js`
Expected: FAIL — `config.excludeCustomField is not a function`.

- [ ] **Step 3.3: Implement the helpers**

Edit `C:\GHSource\ticket-control\config.js`. Add before the final `module.exports` line:

```javascript
function excludeCustomField(spaceKey, fieldName) {
  const space = getSpace(spaceKey);
  if (!space) return null;
  const name = fieldName.trim().toLowerCase();
  const nextCustomFields = { ...(space.customFields || {}) };
  delete nextCustomFields[name];
  const nextExcluded = Array.from(new Set([...(space.excludedCustomFields || []), name]));
  const next = { ...space, excludedCustomFields: nextExcluded };
  if (Object.keys(nextCustomFields).length > 0) next.customFields = nextCustomFields;
  else delete next.customFields;
  return setSpace(spaceKey, next);
}

function restoreCustomField(spaceKey, fieldName) {
  const space = getSpace(spaceKey);
  if (!space) return null;
  const name = fieldName.trim().toLowerCase();
  const nextExcluded = (space.excludedCustomFields || []).filter((n) => n !== name);
  const next = { ...space };
  if (nextExcluded.length > 0) next.excludedCustomFields = nextExcluded;
  else delete next.excludedCustomFields;
  return setSpace(spaceKey, next);
}
```

Update the export line:

```javascript
module.exports = {
  get, getAll, isConfigured, update, getSpace, setSpace, deleteSpace,
  excludeCustomField, restoreCustomField, KEYS, REQUIRED_KEYS,
};
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `node --test config.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 3.5: Commit**

```bash
git add config.js config.test.js
git commit -m "feat(config): add excludeCustomField/restoreCustomField space helpers"
```

---

## Task 4: Fix the discovery merge bug in `routes/settings.js`

**Files:**
- Modify: `C:\GHSource\ticket-control\routes\settings.js`
- Modify: `C:\GHSource\ticket-control\routes\settings.test.js`

**Why this works:** `refreshSpace` currently builds `merged` from only `teamId` and `fields`, dropping `customFields` on every re-discovery. Routing it through `mergeSpaceRecord` (Task 2) fixes that and, once exclusions exist, stops them from being resurrected by "Discover from JIRA".

**Interfaces:**
- Consumes: `jiraDiscovery.mergeSpaceRecord(existing, fresh)` from Task 2 (module already required as `jiraDiscovery` in this file).

- [ ] **Step 4.1: Add failing tests**

Edit `C:\GHSource\ticket-control\routes\settings.test.js`. Append:

```javascript
test("POST /api/settings/discover?space=KEY preserves customFields across re-discovery", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {
        XYZ: {
          teamId: "",
          fields: {},
          customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
        },
      },
    }),
  );
  const discoveryMock = require("../lib/jira-discovery");
  const origFields = discoveryMock.discoverSpaceFields;
  discoveryMock.discoverSpaceFields = async () => ({
    teamId: "", fields: { sprint: "customfield_10020" },
  });
  try {
    const app = makeApp();
    const res = await call(app, "POST", "/api/settings/discover?space=XYZ");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.spaces.XYZ.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
    assert.deepEqual(onDisk.JIRA_SPACES.XYZ.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
  } finally {
    discoveryMock.discoverSpaceFields = origFields;
  }
});

test("POST /api/settings/discover?space=KEY does not resurrect an excluded custom field", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {
        XYZ: { teamId: "", fields: {}, excludedCustomFields: ["project"] },
      },
    }),
  );
  const discoveryMock = require("../lib/jira-discovery");
  const origFields = discoveryMock.discoverSpaceFields;
  discoveryMock.discoverSpaceFields = async () => ({
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
  });
  try {
    const app = makeApp();
    const res = await call(app, "POST", "/api/settings/discover?space=XYZ");
    assert.equal(res.status, 200);
    assert.equal(res.json.spaces.XYZ.customFields, undefined);
    assert.deepEqual(res.json.spaces.XYZ.excludedCustomFields, ["project"]);
  } finally {
    discoveryMock.discoverSpaceFields = origFields;
  }
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `node --test routes/settings.test.js`
Expected: FAIL on both new tests — `res.json.spaces.XYZ.customFields` is `undefined` in the first test (current `refreshSpace` drops it), and the second test's assertion on `excludedCustomFields` surviving fails likewise.

- [ ] **Step 4.3: Fix `refreshSpace`**

Edit `C:\GHSource\ticket-control\routes\settings.js`. Replace:

```javascript
async function refreshSpace(spaceKey) {
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  try {
    const fresh = await jiraDiscovery.discoverSpaceFields(jiraRequest, spaceKey);
    const merged = {
      teamId: existing.teamId || fresh.teamId || "",
      fields: { ...existing.fields, ...fresh.fields },
      discoveredAt: new Date().toISOString(),
    };
    config.setSpace(spaceKey, merged);
    return merged;
  } catch (err) {
    logger.warn("DISCOVERY", `Space ${spaceKey} failed: ${err.message}\n${err.stack}`);
    return { ...existing, error: err.message };
  }
}
```

With:

```javascript
async function refreshSpace(spaceKey) {
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  try {
    const fresh = await jiraDiscovery.discoverSpaceFields(jiraRequest, spaceKey);
    const merged = {
      ...jiraDiscovery.mergeSpaceRecord(existing, fresh),
      discoveredAt: new Date().toISOString(),
    };
    config.setSpace(spaceKey, merged);
    return merged;
  } catch (err) {
    logger.warn("DISCOVERY", `Space ${spaceKey} failed: ${err.message}\n${err.stack}`);
    return { ...existing, error: err.message };
  }
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `node --test routes/settings.test.js`
Expected: PASS, all tests in the file (including the pre-existing "teamId is preserved" and "only touches that space" tests).

- [ ] **Step 4.5: Commit**

```bash
git add routes/settings.js routes/settings.test.js
git commit -m "fix(settings): preserve and filter customFields across space re-discovery"
```

---

## Task 4b: Fix `PUT /api/settings/spaces/:key` dropping `customFields`/`excludedCustomFields`

**Files:**
- Modify: `C:\GHSource\ticket-control\routes\settings.js`
- Modify: `C:\GHSource\ticket-control\routes\settings.test.js`

**Why this works:** This endpoint saves a user-edited `teamId` (the "Edit" button on a space's Team ID row in `SpaceAccordion`). It builds its persisted record from only `body.teamId` and `existing.fields`, silently dropping `customFields` and `excludedCustomFields` on every save — a pre-existing bug discovered while reviewing Task 4, structurally identical to the bug Task 4 just fixed in `refreshSpace`. Left unfixed, saving a Team ID edit after removing a custom field (Task 3/7/9's whole feature) would silently undo the exclusion, since the next discovery would see no `excludedCustomFields` and happily rediscover the removed field. This task closes that gap by carrying both fields through unchanged, the same way `discoveredAt` is already carried through on line 127.

**Interfaces:**
- Consumes: nothing new — this is a same-file addition using the space record fields already in scope (`existing.customFields`, `existing.excludedCustomFields`). Does not need `mergeSpaceRecord` since there's no "fresh" discovery result to merge here — it's a pure preserve-on-write, not a merge.

- [ ] **Step 4b.1: Add a failing test**

Edit `C:\GHSource\ticket-control\routes\settings.test.js`. Append:

```javascript
test("PUT /api/settings/spaces/:key preserves customFields and excludedCustomFields", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {
        ABC: {
          teamId: "old-team",
          fields: { team: "customfield_10001" },
          customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
          excludedCustomFields: ["project"],
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "PUT", "/api/settings/spaces/ABC", { teamId: "new-team-uuid" });
  assert.equal(res.status, 200);
  assert.equal(res.json.teamId, "new-team-uuid");
  assert.deepEqual(res.json.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
  assert.deepEqual(res.json.excludedCustomFields, ["project"]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.deepEqual(onDisk.JIRA_SPACES.ABC.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
  assert.deepEqual(onDisk.JIRA_SPACES.ABC.excludedCustomFields, ["project"]);
});
```

- [ ] **Step 4b.2: Run test to verify it fails**

Run: `node --test routes/settings.test.js`
Expected: FAIL — `res.json.customFields` and `res.json.excludedCustomFields` are both `undefined` under the current implementation, which only copies `teamId` and `fields`.

- [ ] **Step 4b.3: Fix the handler**

Edit `C:\GHSource\ticket-control\routes\settings.js`. Find:

```javascript
  const merged = {
    teamId: body.teamId,
    fields: { ...(existing.fields || {}) },
  };
  if (existing.discoveredAt) merged.discoveredAt = existing.discoveredAt;
```

Replace with:

```javascript
  const merged = {
    teamId: body.teamId,
    fields: { ...(existing.fields || {}) },
  };
  if (existing.customFields) merged.customFields = existing.customFields;
  if (existing.excludedCustomFields) merged.excludedCustomFields = existing.excludedCustomFields;
  if (existing.discoveredAt) merged.discoveredAt = existing.discoveredAt;
```

- [ ] **Step 4b.4: Run test to verify it passes**

Run: `node --test routes/settings.test.js`
Expected: PASS, all tests in the file, including the pre-existing `PUT /api/settings/spaces/:key` tests (updates teamId and preserves fields; 404 for unknown space; rejects non-string teamId; clears prior error field).

- [ ] **Step 4b.5: Commit**

```bash
git add routes/settings.js routes/settings.test.js
git commit -m "fix(settings): preserve customFields/excludedCustomFields on teamId edit"
```

---

## Task 5: Fix the discovery merge bug in `mcp/jira-create.js`'s retry path

**Files:**
- Modify: `C:\GHSource\ticket-control\mcp\jira-create.js`
- Modify: `C:\GHSource\ticket-control\mcp\jira-create.test.js`

**Why this works:** This call site already merges `customFields` correctly (unlike the other two), but it inlines the merge logic, so once an exclusion list exists this site would resurrect an excluded field on its very next 400-triggered retry. Routing it through `mergeSpaceRecord` closes that gap and removes the duplicated logic.

**Interfaces:**
- Consumes: `mergeSpaceRecord(existing, fresh)` from Task 2, via `require("../lib/jira-discovery")`.

- [ ] **Step 5.1: Add failing tests**

Edit `C:\GHSource\ticket-control\mcp\jira-create.test.js`. Append:

```javascript
test("createJiraTicket retry preserves existing customFields not returned by fresh discovery", async () => {
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
    return { key: "ABC-2" };
  };
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({
        teamId: "",
        fields: {},
        customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
      }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({ teamId: "", fields: { sprint: "customfield_10020" } }),
    },
  );
  assert.deepEqual(setCalls[0].r.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
});

test("createJiraTicket retry does not resurrect an excluded custom field", async () => {
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
    return { key: "ABC-2" };
  };
  await createJiraTicket(
    { summary: "x", description: "y", parent_epic_key: "ABC-1", issue_type: "Story" },
    {
      jiraRequest,
      getJiraBaseUrl: () => "https://x.atlassian.net",
      env: { JIRA_ACCOUNT_ID: "acct" },
      getSpace: () => ({
        teamId: "",
        fields: {},
        excludedCustomFields: ["project"],
      }),
      setSpace: (k, r) => setCalls.push({ k, r }),
      discoverSpace: async () => ({
        teamId: "",
        fields: { sprint: "customfield_10020" },
        customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
      }),
    },
  );
  assert.equal(setCalls[0].r.customFields, undefined);
  assert.deepEqual(setCalls[0].r.excludedCustomFields, ["project"]);
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `node --test mcp/jira-create.test.js`
Expected: The second new test FAILs — current inline merge has no concept of `excludedCustomFields`, so `setCalls[0].r.customFields` would be `{ project: {...} }` instead of `undefined`. (The first new test may already pass against the current inline merge, since it also unions `customFields` correctly today — that's expected; it's a regression guard for the refactor in the next step, not a bug repro.)

- [ ] **Step 5.3: Wire in `mergeSpaceRecord`**

Edit `C:\GHSource\ticket-control\mcp\jira-create.js`. Add at the top of the file, before `function wrapDescriptionAsAdf`:

```javascript
const { mergeSpaceRecord } = require("../lib/jira-discovery");
```

Then find, inside `createJiraTicket`'s catch block:

```javascript
    const fresh = await discoverSpace(projectKey);
    const merged = {
      teamId: space.teamId || fresh.teamId,
      fields: { ...space.fields, ...fresh.fields },
      customFields: { ...(space.customFields || {}), ...(fresh.customFields || {}) },
    };
    setSpace(projectKey, merged);
```

Replace with:

```javascript
    const fresh = await discoverSpace(projectKey);
    const merged = mergeSpaceRecord(space, fresh);
    setSpace(projectKey, merged);
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `node --test mcp/jira-create.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5.5: Commit**

```bash
git add mcp/jira-create.js mcp/jira-create.test.js
git commit -m "fix(mcp): route ticket-creation retry merge through mergeSpaceRecord"
```

---

## Task 6: Fix `handleDiscover`'s merge bug and add the `remove_custom_field` MCP tool

**Files:**
- Modify: `C:\GHSource\ticket-control\mcp\create-ticket-server.mjs`
- Create: `C:\GHSource\ticket-control\mcp\create-ticket-server.test.js`

**Why this works:** `handleDiscover` has the same drop-customFields bug as `routes/settings.js` did. Fixing it, plus adding `remove_custom_field`, requires the handlers to be importable without the module's top-level `server.connect(transport)` side effect firing (which would hang a test process trying to read stdio). Guarding that call behind an "am I the entry point" check — the standard Node ESM idiom — makes the file both testable and unchanged in its normal `node mcp/create-ticket-server.mjs` invocation.

**Interfaces:**
- Produces: exported `handleCreate`, `handleDiscover`, `handleRemoveCustomField` (all `async (args) => { content: [{ type: "text", text: string }] }`, throwing on invalid input — same envelope as the existing tools).
- Consumes: `config.excludeCustomField` (Task 3), `jiraDiscovery.mergeSpaceRecord` (Task 2).

- [ ] **Step 6.1: Switch to a live-bindable import for `jiraDiscovery`**

Edit `C:\GHSource\ticket-control\mcp\create-ticket-server.mjs`. Replace:

```javascript
import { discoverSpaceFields } from "../lib/jira-discovery.js";
```

With:

```javascript
import jiraDiscovery from "../lib/jira-discovery.js";
```

This matches how `config` is already imported (default import = the CJS module's `module.exports` object itself), which is what lets tests mutate `require("../lib/jira-discovery").discoverSpaceFields` and have this file observe the mutation at call time — the same trick `routes/settings.test.js` already relies on for `routes/settings.js`.

- [ ] **Step 6.2: Update `handleCreate`'s and `handleDiscover`'s call sites, and fix the merge bug**

Find:

```javascript
async function handleCreate(args) {
  const result = await createJiraTicket(args ?? {}, {
    jiraRequest,
    getJiraBaseUrl,
    env: config.getAll(),
    getSpace: (k) => config.getSpace(k),
    setSpace: (k, r) => config.setSpace(k, { ...r, discoveredAt: new Date().toISOString() }),
    discoverSpace: (k) => discoverSpaceFields(jiraRequest, k),
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

async function handleDiscover(args) {
  const spaceKey = args?.space_key;
  if (!spaceKey) throw new Error("space_key is required");
  const fresh = await discoverSpaceFields(jiraRequest, spaceKey);
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  const merged = {
    teamId: existing.teamId || fresh.teamId,
    fields: { ...existing.fields, ...fresh.fields },
    discoveredAt: new Date().toISOString(),
  };
  config.setSpace(spaceKey, merged);
  return { content: [{ type: "text", text: JSON.stringify(merged) }] };
}
```

Replace with:

```javascript
async function handleCreate(args) {
  const result = await createJiraTicket(args ?? {}, {
    jiraRequest,
    getJiraBaseUrl,
    env: config.getAll(),
    getSpace: (k) => config.getSpace(k),
    setSpace: (k, r) => config.setSpace(k, { ...r, discoveredAt: new Date().toISOString() }),
    discoverSpace: (k) => jiraDiscovery.discoverSpaceFields(jiraRequest, k),
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

async function handleDiscover(args) {
  const spaceKey = args?.space_key;
  if (!spaceKey) throw new Error("space_key is required");
  const fresh = await jiraDiscovery.discoverSpaceFields(jiraRequest, spaceKey);
  const existing = config.getSpace(spaceKey) || { teamId: "", fields: {} };
  const merged = {
    ...jiraDiscovery.mergeSpaceRecord(existing, fresh),
    discoveredAt: new Date().toISOString(),
  };
  config.setSpace(spaceKey, merged);
  return { content: [{ type: "text", text: JSON.stringify(merged) }] };
}

async function handleRemoveCustomField(args) {
  const spaceKey = args?.space_key;
  const fieldName = args?.field_name;
  if (!spaceKey) throw new Error("space_key is required");
  if (!fieldName) throw new Error("field_name is required");
  const updated = config.excludeCustomField(spaceKey, fieldName);
  if (!updated) throw new Error(`Unknown space: ${spaceKey}`);
  return { content: [{ type: "text", text: JSON.stringify(updated) }] };
}
```

- [ ] **Step 6.3: Register the new tool**

Find the `DISCOVER_TOOL` constant and add a new tool constant after it:

```javascript
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

Find:

```javascript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [CREATE_TOOL, DISCOVER_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === CREATE_TOOL.name) return await handleCreate(request.params.arguments);
    if (request.params.name === DISCOVER_TOOL.name) return await handleDiscover(request.params.arguments);
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: formatError(err) }], isError: true };
  }
});
```

Replace with:

```javascript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [CREATE_TOOL, DISCOVER_TOOL, REMOVE_CUSTOM_FIELD_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === CREATE_TOOL.name) return await handleCreate(request.params.arguments);
    if (request.params.name === DISCOVER_TOOL.name) return await handleDiscover(request.params.arguments);
    if (request.params.name === REMOVE_CUSTOM_FIELD_TOOL.name) return await handleRemoveCustomField(request.params.arguments);
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: formatError(err) }], isError: true };
  }
});
```

- [ ] **Step 6.4: Guard the stdio connection and export the handlers**

Edit the top import line:

```javascript
import { fileURLToPath } from "node:url";
```

Replace with:

```javascript
import { fileURLToPath, pathToFileURL } from "node:url";
```

Find the bottom of the file:

```javascript
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[create-jira-ticket] MCP server listening on stdio");
```

Replace with:

```javascript
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[create-jira-ticket] MCP server listening on stdio");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { handleCreate, handleDiscover, handleRemoveCustomField };
```

- [ ] **Step 6.5: Write the new test file with failing tests**

Create `C:\GHSource\ticket-control\mcp\create-ticket-server.test.js`:

```javascript
const { test, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let tmpDir;
let savedEnv;
let handleDiscover;
let handleRemoveCustomField;

before(async () => {
  const mod = await import("../mcp/create-ticket-server.mjs");
  handleDiscover = mod.handleDiscover;
  handleRemoveCustomField = mod.handleRemoveCustomField;
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-mcp-"));
  savedEnv = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.TC_CONFIG_DIR;
  else process.env.TC_CONFIG_DIR = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(obj) {
  fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify(obj));
}

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
}

test("handleDiscover merge preserves existing customFields not returned by fresh discovery", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: {
        teamId: "",
        fields: {},
        customFields: { region: { fieldId: "customfield_20001", allowedValues: ["NA"] } },
      },
    },
  });
  const jiraDiscoveryCjs = require("../lib/jira-discovery");
  const orig = jiraDiscoveryCjs.discoverSpaceFields;
  jiraDiscoveryCjs.discoverSpaceFields = async () => ({ teamId: "", fields: { sprint: "customfield_10020" } });
  try {
    const result = await handleDiscover({ space_key: "XYZ" });
    const merged = JSON.parse(result.content[0].text);
    assert.deepEqual(merged.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
    const onDisk = readConfig();
    assert.deepEqual(onDisk.JIRA_SPACES.XYZ.customFields, {
      region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
    });
  } finally {
    jiraDiscoveryCjs.discoverSpaceFields = orig;
  }
});

test("handleDiscover merge does not resurrect an excluded custom field", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: { teamId: "", fields: {}, excludedCustomFields: ["project"] },
    },
  });
  const jiraDiscoveryCjs = require("../lib/jira-discovery");
  const orig = jiraDiscoveryCjs.discoverSpaceFields;
  jiraDiscoveryCjs.discoverSpaceFields = async () => ({
    teamId: "",
    fields: {},
    customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
  });
  try {
    const result = await handleDiscover({ space_key: "XYZ" });
    const merged = JSON.parse(result.content[0].text);
    assert.equal(merged.customFields, undefined);
    assert.deepEqual(merged.excludedCustomFields, ["project"]);
  } finally {
    jiraDiscoveryCjs.discoverSpaceFields = orig;
  }
});

test("handleRemoveCustomField excludes a field and persists it", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {
      XYZ: {
        teamId: "",
        fields: {},
        customFields: { project: { fieldId: "project", allowedValues: ["ABC Project"] } },
      },
    },
  });
  const result = await handleRemoveCustomField({ space_key: "XYZ", field_name: "Project" });
  const updated = JSON.parse(result.content[0].text);
  assert.equal(updated.customFields, undefined);
  assert.deepEqual(updated.excludedCustomFields, ["project"]);
  const onDisk = readConfig();
  assert.deepEqual(onDisk.JIRA_SPACES.XYZ.excludedCustomFields, ["project"]);
});

test("handleRemoveCustomField throws for unknown space", async () => {
  writeConfig({
    JIRA_BASE_URL: "https://x.atlassian.net",
    JIRA_EMAIL: "me@x.com",
    JIRA_API_TOKEN: "tok",
    JIRA_ACCOUNT_ID: "",
    JIRA_SPACES: {},
  });
  await assert.rejects(
    handleRemoveCustomField({ space_key: "NOPE", field_name: "project" }),
    /Unknown space: NOPE/,
  );
});
```

- [ ] **Step 6.6: Run the new test file to verify it fails**

Run: `node --test mcp/create-ticket-server.test.js`
Expected: FAIL before Steps 6.1–6.4 are applied — `handleDiscover`/`handleRemoveCustomField` aren't exported yet, so `mod.handleDiscover` is `undefined` and calling it throws `TypeError: handleDiscover is not a function`. (If you're implementing steps in order, 6.1–6.4 already happened before this file existed — this step is a sanity check; if it already passes, double check Step 6.1–6.4 were applied correctly and re-verify by temporarily reverting one to confirm the test suite actually exercises the code path.)

- [ ] **Step 6.7: Run the new test file to verify it passes**

Run: `node --test mcp/create-ticket-server.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 6.8: Run the full existing MCP test suite to check for regressions**

Run: `node --test mcp/jira-create.test.js`
Expected: PASS (unaffected by this task's changes).

- [ ] **Step 6.9: Manually verify the server still starts normally**

Run: `node mcp/create-ticket-server.mjs` then press Ctrl+C after a moment.
Expected: stderr prints `[create-jira-ticket] MCP server listening on stdio` before you kill it — confirms the entry-point guard still lets normal invocation (via `scripts/install-mcp.js` / the packaged Electron app) work unchanged.

- [ ] **Step 6.10: Commit**

```bash
git add mcp/create-ticket-server.mjs mcp/create-ticket-server.test.js
git commit -m "feat(mcp): add remove_custom_field tool and fix handleDiscover merge bug"
```

---

## Task 7: REST endpoints for exclude/restore

**Files:**
- Modify: `C:\GHSource\ticket-control\routes\settings.js`
- Modify: `C:\GHSource\ticket-control\routes\settings.test.js`

**Interfaces:**
- Produces: `DELETE /api/settings/spaces/:key/custom-fields/:name` → 200 with updated space record, or 404 `{ error }`. `POST /api/settings/spaces/:key/custom-fields/:name/restore` → same shape.

- [ ] **Step 7.1: Add failing tests**

Edit `C:\GHSource\ticket-control\routes\settings.test.js`. Append:

```javascript
test("DELETE /api/settings/spaces/:key/custom-fields/:name excludes the field", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {
        ABC: {
          teamId: "",
          fields: {},
          customFields: {
            project: { fieldId: "project", allowedValues: ["ABC Project"] },
            region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
          },
        },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "DELETE", "/api/settings/spaces/ABC/custom-fields/project");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.customFields, {
    region: { fieldId: "customfield_20001", allowedValues: ["NA"] },
  });
  assert.deepEqual(res.json.excludedCustomFields, ["project"]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.deepEqual(onDisk.JIRA_SPACES.ABC.excludedCustomFields, ["project"]);
});

test("DELETE /api/settings/spaces/:key/custom-fields/:name returns 404 for unknown space", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "DELETE", "/api/settings/spaces/MISSING/custom-fields/project");
  assert.equal(res.status, 404);
});

test("POST /api/settings/spaces/:key/custom-fields/:name/restore un-excludes the field", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {
        ABC: { teamId: "", fields: {}, excludedCustomFields: ["project"] },
      },
    }),
  );
  const app = makeApp();
  const res = await call(app, "POST", "/api/settings/spaces/ABC/custom-fields/project/restore");
  assert.equal(res.status, 200);
  assert.equal(res.json.excludedCustomFields, undefined);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
  assert.equal(onDisk.JIRA_SPACES.ABC.excludedCustomFields, undefined);
});

test("POST /api/settings/spaces/:key/custom-fields/:name/restore returns 404 for unknown space", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "me@x.com",
      JIRA_API_TOKEN: "tok",
      JIRA_ACCOUNT_ID: "",
      JIRA_SPACES: {},
    }),
  );
  const app = makeApp();
  const res = await call(app, "POST", "/api/settings/spaces/MISSING/custom-fields/project/restore");
  assert.equal(res.status, 404);
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `node --test routes/settings.test.js`
Expected: FAIL on the 4 new tests with 404s / connection issues — the routes don't exist yet, so Express returns its default 404 handler (not JSON), and `res.json()` in the `call` helper will throw on parsing that HTML 404 page.

- [ ] **Step 7.3: Add the routes**

Edit `C:\GHSource\ticket-control\routes\settings.js`. Add after the existing `router.put("/api/settings/spaces/:key", ...)` block (before `function checkClaude()`):

```javascript
router.delete("/api/settings/spaces/:key/custom-fields/:name", (req, res) => {
  const { key, name } = req.params;
  try {
    const updated = config.excludeCustomField(key, name);
    if (!updated) return res.status(404).json({ error: `Unknown space: ${key}` });
    logger.info("CONFIG", `Excluded custom field "${name}" from space ${key}`);
    return res.json(updated);
  } catch (err) {
    logger.error("CONFIG", `Failed to exclude custom field "${name}" from space ${key}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/api/settings/spaces/:key/custom-fields/:name/restore", (req, res) => {
  const { key, name } = req.params;
  try {
    const updated = config.restoreCustomField(key, name);
    if (!updated) return res.status(404).json({ error: `Unknown space: ${key}` });
    logger.info("CONFIG", `Restored custom field "${name}" for space ${key}`);
    return res.json(updated);
  } catch (err) {
    logger.error("CONFIG", `Failed to restore custom field "${name}" for space ${key}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `node --test routes/settings.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 7.5: Commit**

```bash
git add routes/settings.js routes/settings.test.js
git commit -m "feat(settings): add REST endpoints to exclude/restore a space's custom field"
```

---

## Task 8: Frontend types and API client

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\types.ts`
- Modify: `C:\GHSource\ticket-control\client\src\api.ts`

**Interfaces:**
- Produces: `removeCustomField(spaceKey: string, fieldName: string): Promise<JiraSpace>`, `restoreCustomField(spaceKey: string, fieldName: string): Promise<JiraSpace>` in `client/src/api.ts`. `JiraSpace.excludedCustomFields?: string[]` in `client/src/types.ts`.

There's no client-side test runner in this project (`npm run build --prefix client` runs `tsc -b && vite build`, used as the typecheck). This task's verification is that typecheck step.

- [ ] **Step 8.1: Add the type field**

Edit `C:\GHSource\ticket-control\client\src\types.ts`. Find:

```typescript
export interface JiraSpace {
  teamId: string;
  fields: JiraSpaceFields;
  customFields?: Record<string, JiraCustomField>;
  discoveredAt?: string;
  error?: string;
}
```

Replace with:

```typescript
export interface JiraSpace {
  teamId: string;
  fields: JiraSpaceFields;
  customFields?: Record<string, JiraCustomField>;
  excludedCustomFields?: string[];
  discoveredAt?: string;
  error?: string;
}
```

- [ ] **Step 8.2: Add the API functions**

Edit `C:\GHSource\ticket-control\client\src\api.ts`. Append after `deleteJiraSpace`:

```typescript
export async function removeCustomField(spaceKey: string, fieldName: string): Promise<JiraSpace> {
  const res = await apiFetch(
    `/api/settings/spaces/${encodeURIComponent(spaceKey)}/custom-fields/${encodeURIComponent(fieldName)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    let message = "Failed to remove custom field";
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

export async function restoreCustomField(spaceKey: string, fieldName: string): Promise<JiraSpace> {
  const res = await apiFetch(
    `/api/settings/spaces/${encodeURIComponent(spaceKey)}/custom-fields/${encodeURIComponent(fieldName)}/restore`,
    { method: "POST" },
  );
  if (!res.ok) {
    let message = "Failed to restore custom field";
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

- [ ] **Step 8.3: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 8.4: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat(client): add removeCustomField/restoreCustomField API helpers"
```

---

## Task 9: `SpaceAccordion.tsx` UI — remove and restore controls

**Files:**
- Modify: `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx`
- Modify: `C:\GHSource\ticket-control\client\src\App.css`

**Interfaces:**
- Consumes: `removeCustomField`, `restoreCustomField` from Task 8; existing `onUpdate(key: string, next: JiraSpace)` prop (already threaded through from `JiraProjectCard` — no prop changes needed).

- [ ] **Step 9.1: Import the new API functions**

Edit `C:\GHSource\ticket-control\client\src\components\settings\SpaceAccordion.tsx`. Find:

```typescript
import { updateJiraSpace, deleteJiraSpace } from "../../api";
```

Replace with:

```typescript
import { updateJiraSpace, deleteJiraSpace, removeCustomField, restoreCustomField } from "../../api";
```

- [ ] **Step 9.2: Add local state and handlers**

Find:

```typescript
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
```

Add immediately after:

```typescript
  const [removingField, setRemovingField] = useState<string | null>(null);
  const [restoringField, setRestoringField] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleRemoveCustomField(name: string) {
    setRemovingField(name);
    setFieldError(null);
    try {
      const next = await removeCustomField(spaceKey, name);
      onUpdate(spaceKey, next);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemovingField(null);
    }
  }

  async function handleRestoreCustomField(name: string) {
    setRestoringField(name);
    setFieldError(null);
    try {
      const next = await restoreCustomField(spaceKey, name);
      onUpdate(spaceKey, next);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoringField(null);
    }
  }
```

- [ ] **Step 9.3: Add remove buttons to custom field rows and an excluded-fields list**

Find:

```tsx
          {space.customFields && Object.keys(space.customFields).length > 0 && (
            <div className="space-accordion__custom-fields">
              <div className="space-accordion__custom-fields-title">Custom fields</div>
              {Object.entries(space.customFields).map(([name, def]) => (
                <div className="space-accordion__field-row" key={name}>
                  <span>{name}</span>
                  <strong title={def.allowedValues.join(", ") || "(no values)"}>
                    {def.fieldId} ({def.allowedValues.length}{" "}
                    value{def.allowedValues.length === 1 ? "" : "s"})
                  </strong>
                </div>
              ))}
            </div>
          )}
```

Replace with:

```tsx
          {space.customFields && Object.keys(space.customFields).length > 0 && (
            <div className="space-accordion__custom-fields">
              <div className="space-accordion__custom-fields-title">Custom fields</div>
              {Object.entries(space.customFields).map(([name, def]) => (
                <div className="space-accordion__field-row" key={name}>
                  <span>{name}</span>
                  <span>
                    <strong title={def.allowedValues.join(", ") || "(no values)"}>
                      {def.fieldId} ({def.allowedValues.length}{" "}
                      value{def.allowedValues.length === 1 ? "" : "s"})
                    </strong>
                    <button
                      type="button"
                      className="space-accordion__remove-field"
                      onClick={() => handleRemoveCustomField(name)}
                      disabled={removingField === name}
                      aria-label={`Remove custom field ${name}`}
                      title="Remove custom field"
                    >
                      🗑
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {space.excludedCustomFields && space.excludedCustomFields.length > 0 && (
            <div className="space-accordion__excluded-fields">
              <div className="space-accordion__custom-fields-title">Excluded fields</div>
              {space.excludedCustomFields.map((name) => (
                <div className="space-accordion__field-row" key={name}>
                  <span>{name}</span>
                  <button
                    type="button"
                    className="space-accordion__restore-field"
                    onClick={() => handleRestoreCustomField(name)}
                    disabled={restoringField === name}
                  >
                    {restoringField === name ? "Restoring…" : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {fieldError && <div className="space-accordion__edit-error">{fieldError}</div>}
```

- [ ] **Step 9.4: Add styles**

Edit `C:\GHSource\ticket-control\client\src\App.css`. Append after the `.space-accordion__edit-row button` block:

```css
.space-accordion__remove-field {
  background: none;
  border: none;
  color: #8b94a3;
  font-size: 0.85rem;
  padding: 1px 4px;
  margin-left: 6px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}

.space-accordion__remove-field:hover:not(:disabled) {
  color: #f5b7b1;
  background: rgba(245, 183, 177, 0.1);
}

.space-accordion__remove-field:disabled {
  opacity: 0.5;
  cursor: default;
}

.space-accordion__excluded-fields {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #3a3f47;
}

.space-accordion__restore-field {
  background: transparent;
  border: 1px solid #3a3f47;
  color: #8b9cf7;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.76rem;
  cursor: pointer;
}

.space-accordion__restore-field:hover:not(:disabled) {
  background: rgba(139, 156, 247, 0.1);
}

.space-accordion__restore-field:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 9.5: Typecheck**

Run: `npm run build --prefix client`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 9.6: Manually verify in the browser**

Run: `npm run dev:web` (Express on `:3000`, Vite on `:5173`; open the Vite URL).
In Settings, open a space that has custom fields (or trigger discovery against a real JIRA space that includes `project` or another select-list custom field). Click the 🗑 next to a custom field row — confirm it disappears from "Custom fields" and appears under "Excluded fields". Click "Re-discover this space" — confirm the removed field does **not** reappear in "Custom fields" (it should stay listed under "Excluded fields"). Now click "Restore" on that entry — confirm it disappears from "Excluded fields" (note it won't reappear in "Custom fields" yet, since restore only un-excludes it — see Task 3). Click "Re-discover this space" once more — confirm the field now reappears in "Custom fields" (assuming JIRA still reports it as a genuine select-list field).

- [ ] **Step 9.7: Commit**

```bash
git add client/src/components/settings/SpaceAccordion.tsx client/src/App.css
git commit -m "feat(client): add remove/restore controls for space custom fields"
```

---

## Task 10: End-to-end verification

**Files:** none — this task runs the full suite and the manual/MCP checks from the spec's testing section; it makes no code changes.

- [ ] **Step 10.1: Run the full server-side test suite**

Run: `npm test`
Expected: PASS, no failures, across `config.test.js`, `lib/jira-discovery.test.js`, `routes/settings.test.js`, `mcp/jira-create.test.js`, `mcp/create-ticket-server.test.js`, and every other existing suite in the repo.

- [ ] **Step 10.2: Reproduce and verify the fix against the original bug**

If you have access to a JIRA space where `project` was previously discovered as a custom field (the bug this whole plan exists to fix): open Settings, remove `project` from that space's "Custom fields" list via the 🗑 button (Task 9), then click "Re-discover this space". Confirm `project` does not reappear in "Custom fields" — both because the Task 1 classification fix stops it being discovered as custom going forward, and because the Task 4 merge fix means even if it somehow were rediscovered, the exclusion would filter it.

- [ ] **Step 10.3: Verify the MCP path end-to-end**

If `create-jira-ticket` is registered with your local `claude` CLI (`npm run mcp:install` if not), start a Claude Code session and ask it to call `remove_custom_field` with a real `space_key` and `field_name` from your JIRA instance, then call `discover_jira_space` for the same space. Confirm the removed field is absent from the returned `customFields` and present in `excludedCustomFields`.

- [ ] **Step 10.4: Verify ticket creation is unblocked**

Run `node scripts/smoke-create.js <PARENT_EPIC_KEY>` against a space that previously failed because of the misclassified `project` field (after removing it via Task 9's UI or the MCP tool in Step 10.3). Confirm the ticket is created successfully and the script prints `Created: { key: ..., url: ... }`.

No commit for this task — it's verification only.
