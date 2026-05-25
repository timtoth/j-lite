const fs = require("node:fs");
const path = require("node:path");

const KEYS = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_ACCOUNT_ID",
  "JIRA_PRODUCT_FIELD_ID",
];

const REQUIRED_KEYS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
const PRODUCT_FIELD_DEFAULT = "customfield_12037";
const OLD_KEYS = ["JIRA_TEAM_FIELD_ID", "JIRA_TEAM_ID"];

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
  if (!seed.JIRA_PRODUCT_FIELD_ID) {
    seed.JIRA_PRODUCT_FIELD_ID = PRODUCT_FIELD_DEFAULT;
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
    const product = out.JIRA_PRODUCT_FIELD_ID || PRODUCT_FIELD_DEFAULT;
    const existing = out.JIRA_SPACES.RL || { teamId: "", fields: {} };
    out.JIRA_SPACES.RL = {
      teamId: parsed.JIRA_TEAM_ID || existing.teamId || "",
      fields: {
        ...(existing.fields || {}),
        team: parsed.JIRA_TEAM_FIELD_ID || existing.fields?.team || "",
        product: existing.fields?.product || product,
      },
      discoveredAt: existing.discoveredAt || new Date().toISOString(),
    };
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

function get(key) {
  return state[key] ?? "";
}

function getAll() {
  return JSON.parse(JSON.stringify(state));
}

function isConfigured() {
  return REQUIRED_KEYS.every((k) => state[k] && state[k].length > 0);
}

function update(patch) {
  const next = { ...state };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!KEYS.includes(k)) continue;
    next[k] = typeof v === "string" ? v : "";
  }
  next.JIRA_SPACES = state.JIRA_SPACES || {};
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  return getAll();
}

function getSpace(key) {
  if (!state.JIRA_SPACES || !state.JIRA_SPACES[key]) return null;
  return JSON.parse(JSON.stringify(state.JIRA_SPACES[key]));
}

function setSpace(key, record) {
  const next = { ...state, JIRA_SPACES: { ...(state.JIRA_SPACES || {}) } };
  next.JIRA_SPACES[key] = JSON.parse(JSON.stringify(record));
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  return getSpace(key);
}

module.exports = { get, getAll, isConfigured, update, getSpace, setSpace, KEYS, REQUIRED_KEYS };
