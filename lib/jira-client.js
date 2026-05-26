const config = require("../config");

function getAuthHeader() {
  const base = config.get("JIRA_BASE_URL");
  const email = config.get("JIRA_EMAIL");
  const token = config.get("JIRA_API_TOKEN");
  if (!base || !email || !token) {
    throw new Error("Missing JIRA config: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN");
  }
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${encoded}`;
}

async function jiraRequest(method, path, body) {
  const url = `${config.get("JIRA_BASE_URL")}${path}`;
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
  return config.get("JIRA_BASE_URL");
}

module.exports = { jiraRequest, getJiraBaseUrl };
