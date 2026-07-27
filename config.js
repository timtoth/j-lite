const fs = require("node:fs");
const path = require("node:path");

const KEYS = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_ACCOUNT_ID",
];

const REQUIRED_KEYS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
const OLD_KEYS = ["JIRA_TEAM_FIELD_ID", "JIRA_TEAM_ID", "JIRA_PRODUCT_FIELD_ID"];

function configPath() {
  const dir = process.env.TC_CONFIG_DIR || process.cwd();
  return path.join(dir, "config.json");
}

function seedFromEnv() {
  const seed = {};
  for (const key of KEYS) {
    const value = process.env[key];
    seed[key] = value === undefined ? "" : value;
  }
  seed.JIRA_SPACES = {};
  return seed;
}

function writeAtomic(target, contents) {
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function migrate(parsed) {
  const out = { ...parsed };
  if (!out.JIRA_SPACES || typeof out.JIRA_SPACES !== "object") {
    out.JIRA_SPACES = {};
  }
  const hasOldTeamField = typeof parsed.JIRA_TEAM_FIELD_ID === "string" && parsed.JIRA_TEAM_FIELD_ID.length > 0;
  const hasOldTeamId = typeof parsed.JIRA_TEAM_ID === "string" && parsed.JIRA_TEAM_ID.length > 0;
  if (hasOldTeamField || hasOldTeamId) {
    const existing = out.JIRA_SPACES.ABC || { teamId: "", fields: {} };
    out.JIRA_SPACES.ABC = {
      teamId: parsed.JIRA_TEAM_ID || existing.teamId || "",
      fields: {
        ...(existing.fields || {}),
        team: parsed.JIRA_TEAM_FIELD_ID || existing.fields?.team || "",
      },
      discoveredAt: existing.discoveredAt || new Date().toISOString(),
    };
  }
  // Drop legacy product slot from every space (org-specific, replaced by customFields).
  for (const [k, space] of Object.entries(out.JIRA_SPACES)) {
    if (space?.fields?.product !== undefined) {
      const { product, ...rest } = space.fields;
      out.JIRA_SPACES[k] = { ...space, fields: rest };
    }
  }
  for (const k of OLD_KEYS) delete out[k];
  return out;
}

function load() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    const seed = seedFromEnv();
    writeAtomic(file, JSON.stringify(seed, null, 2) + "\n");
    return seed;
  }
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  const merged = { ...seedFromEnv(), ...parsed };
  for (const key of KEYS) if (merged[key] === undefined) merged[key] = "";
  const migrated = migrate(merged);
  // If migration changed anything, persist it.
  if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
    writeAtomic(file, JSON.stringify(migrated, null, 2) + "\n");
  }
  return migrated;
}

let state = load();
let stateMtimeMs = currentMtimeMs();

function currentMtimeMs() {
  try {
    return fs.statSync(configPath()).mtimeMs;
  } catch {
    return 0;
  }
}

// Reload state if another process has written the file since we last read it.
// MCP and Express each hold their own in-memory state, so without this,
// changes made by the MCP would be invisible to the server until restart.
function refreshIfStale() {
  const mtime = currentMtimeMs();
  if (mtime && mtime !== stateMtimeMs) {
    state = load();
    stateMtimeMs = currentMtimeMs();
  }
}

function get(key) {
  refreshIfStale();
  return state[key] ?? "";
}

function getAll() {
  refreshIfStale();
  return JSON.parse(JSON.stringify(state));
}

function isConfigured() {
  refreshIfStale();
  return REQUIRED_KEYS.every((k) => state[k] && state[k].length > 0);
}

function update(patch) {
  refreshIfStale();
  const next = { ...state };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!KEYS.includes(k)) continue;
    next[k] = typeof v === "string" ? v : "";
  }
  next.JIRA_SPACES = state.JIRA_SPACES || {};
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  stateMtimeMs = currentMtimeMs();
  return getAll();
}

function getSpace(key) {
  refreshIfStale();
  if (!state.JIRA_SPACES || !state.JIRA_SPACES[key]) return null;
  return JSON.parse(JSON.stringify(state.JIRA_SPACES[key]));
}

function setSpace(key, record) {
  refreshIfStale();
  const next = { ...state, JIRA_SPACES: { ...(state.JIRA_SPACES || {}) } };
  next.JIRA_SPACES[key] = JSON.parse(JSON.stringify(record));
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  stateMtimeMs = currentMtimeMs();
  return getSpace(key);
}

function deleteSpace(key) {
  refreshIfStale();
  if (!state.JIRA_SPACES || !(key in state.JIRA_SPACES)) return false;
  const nextSpaces = { ...state.JIRA_SPACES };
  delete nextSpaces[key];
  const next = { ...state, JIRA_SPACES: nextSpaces };
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  stateMtimeMs = currentMtimeMs();
  return true;
}

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

module.exports = {
  get, getAll, isConfigured, update, getSpace, setSpace, deleteSpace,
  excludeCustomField, restoreCustomField, KEYS, REQUIRED_KEYS,
};
