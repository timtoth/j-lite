const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

function getAuthHeader() {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Missing JIRA env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN");
  }
  const encoded = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

async function jiraRequest(method, path, body) {
  const url = `${JIRA_BASE_URL}${path}`;
  const init = {
    method,
    headers: {
      Authorization: getAuthHeader(),
      Accept: "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  }
  if (!res.ok) {
    const err = new Error(`JIRA ${method} ${path} -> ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed;
}

function getJiraBaseUrl() {
  return JIRA_BASE_URL;
}

module.exports = { jiraRequest, getJiraBaseUrl };
