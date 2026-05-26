const { Router } = require("express");
const config = require("../config");
const logger = require("../logger");
const { jiraRequest } = require("../lib/jira-client");

const router = Router();

let cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAllProjects() {
  const all = [];
  let startAt = 0;
  const maxResults = 100;
  while (true) {
    const url =
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}` +
      `&orderBy=key&status=live`;
    const page = await jiraRequest("GET", url);
    const values = page?.values ?? [];
    for (const p of values) {
      all.push({ key: p.key, name: p.name });
    }
    if (page?.isLast || values.length < maxResults) break;
    startAt += values.length;
    if (startAt > 5000) break;
  }
  return all;
}

router.get("/api/jira/projects", async (req, res) => {
  if (!config.isConfigured()) {
    return res.status(400).json({ error: "JIRA credentials not set." });
  }
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ projects: cache.projects, cached: true });
  }
  try {
    const projects = await fetchAllProjects();
    cache = { fetchedAt: now, projects };
    return res.json({ projects, cached: false });
  } catch (err) {
    logger.warn("PROJECTS", `List failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
