const fs = require("node:fs");
const path = require("node:path");

const KEYS = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_TEAM_FIELD_ID",
  "JIRA_TEAM_ID",
  "JIRA_ACCOUNT_ID",
  "JIRA_PRODUCT_FIELD_ID",
];

const REQUIRED_KEYS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
const PRODUCT_FIELD_DEFAULT = "customfield_12037";

function configPath() {
  return path.join(process.cwd(), "config.json");
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
  return seed;
}

function writeAtomic(target, contents) {
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
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
  // Ensure all keys present even if file is older.
  const merged = { ...seedFromEnv(), ...parsed };
  for (const key of KEYS) if (merged[key] === undefined) merged[key] = "";
  return merged;
}

let state = load();

function get(key) {
  return state[key] ?? "";
}

function getAll() {
  return { ...state };
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
  writeAtomic(configPath(), JSON.stringify(next, null, 2) + "\n");
  state = next;
  return getAll();
}

module.exports = { get, getAll, isConfigured, update, KEYS, REQUIRED_KEYS };
