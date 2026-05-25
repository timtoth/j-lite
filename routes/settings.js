const { Router } = require("express");
const { spawn } = require("node:child_process");
const config = require("../config");
const logger = require("../logger");
const { jiraRequest } = require("../lib/jira-client");
const { enrichIds } = require("../lib/jira-discovery");

const router = Router();

function maskToken(token) {
  if (!token) return null;
  const last4 = token.length >= 4 ? token.slice(-4) : token;
  return { masked: true, last4 };
}

function shapeForClient(all) {
  return {
    JIRA_BASE_URL: all.JIRA_BASE_URL || "",
    JIRA_EMAIL: all.JIRA_EMAIL || "",
    JIRA_API_TOKEN: maskToken(all.JIRA_API_TOKEN),
    JIRA_TEAM_FIELD_ID: all.JIRA_TEAM_FIELD_ID || "",
    JIRA_TEAM_ID: all.JIRA_TEAM_ID || "",
    JIRA_ACCOUNT_ID: all.JIRA_ACCOUNT_ID || "",
    JIRA_PRODUCT_FIELD_ID: all.JIRA_PRODUCT_FIELD_ID || "",
  };
}

router.get("/api/settings", (req, res) => {
  res.json(shapeForClient(config.getAll()));
});

const ALLOWED_KEYS = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_TEAM_FIELD_ID",
  "JIRA_TEAM_ID",
  "JIRA_ACCOUNT_ID",
  "JIRA_PRODUCT_FIELD_ID",
];

router.put("/api/settings", (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(k)) continue;
    if (typeof v !== "string") {
      return res.status(400).json({ error: `${k} must be a string` });
    }
    // Empty token means "leave existing token alone" — never overwrite a stored token with "".
    if (k === "JIRA_API_TOKEN" && v === "") continue;
    patch[k] = v;
  }
  try {
    const updated = config.update(patch);
    logger.info("CONFIG", `Updated keys: ${Object.keys(patch).join(", ") || "(none)"}`);
    return res.json(shapeForClient(updated));
  } catch (err) {
    logger.error("CONFIG", `Failed to write config: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/api/settings/discover", async (req, res) => {
  try {
    const result = await enrichIds(jiraRequest, config.getAll());
    return res.json(result);
  } catch (err) {
    logger.warn("CONFIG", `Discovery failed: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

function checkClaude() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let proc;
    try {
      // shell: true so Windows resolves claude.cmd / claude.ps1 from PATH.
      proc = spawn("claude", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
    } catch {
      done({ available: false });
      return;
    }
    let stdout = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk; });
    proc.on("error", () => done({ available: false }));
    proc.on("close", (code) => {
      if (code === 0) done({ available: true, version: stdout.trim() });
      else done({ available: false });
    });
    setTimeout(() => {
      try { proc.kill(); } catch {}
      done({ available: false });
    }, 4000);
  });
}

async function checkJira() {
  if (!config.isConfigured()) return { ok: false, error: "not_configured" };
  try {
    await jiraRequest("GET", "/rest/api/3/myself");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.status === 401 || err.status === 403 ? "auth" : "fetch_failed" };
  }
}

router.get("/api/settings/status", async (req, res) => {
  const [claude, jira] = await Promise.all([checkClaude(), checkJira()]);
  res.json({ claude, jira, configured: config.isConfigured() });
});

module.exports = router;
