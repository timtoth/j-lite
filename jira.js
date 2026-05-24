const logger = require("./logger");
const config = require("./config");

class NotConfiguredError extends Error {
  constructor(message) {
    super(message || "JIRA is not configured");
    this.name = "NotConfiguredError";
  }
}

function authHeader() {
  const email = config.get("JIRA_EMAIL");
  const token = config.get("JIRA_API_TOKEN");
  if (!email || !token) {
    throw new NotConfiguredError("Missing JIRA credentials");
  }
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

function jiraBaseUrl() {
  const base = config.get("JIRA_BASE_URL");
  if (!base) throw new NotConfiguredError("Missing JIRA_BASE_URL");
  return base;
}

async function jiraFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("JIRA", `${res.status} ${res.statusText} - ${url}`);
    if (body) logger.error("JIRA", `Body: ${body}`);
    throw new Error(`JIRA API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.issues && data.issues.length === 0) {
    logger.warn("JIRA", "Query returned 0 issues. If this is unexpected, your API token may have expired. Regenerate it at https://id.atlassian.com/manage-profile/security/api-tokens");
  }

  return data;
}

async function getMyTickets() {
  const jql = `assignee = "${config.get("JIRA_EMAIL")}" AND status != Closed ORDER BY updated DESC`;
  const url = `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status`;

  const data = await jiraFetch(url);

  return data.issues.map((issue) => ({
    id: issue.id,
    key: issue.key,
    title: issue.fields.summary,
    status: issue.fields.status.name,
    url: `${jiraBaseUrl()}/browse/${issue.key}`,
  }));
}

async function getMyEpics() {
  // Step 1: Find tickets assigned to or reported by user that belong to an Epic
  const jql = `(assignee = "${config.get("JIRA_EMAIL")}" OR reporter = "${config.get("JIRA_EMAIL")}") AND "Epic Link" is not EMPTY AND status != Closed`;
  const url = `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,parent`;

  const data = await jiraFetch(url);

  // Extract unique Epic keys from parent field
  const epicKeys = new Set();
  for (const issue of data.issues) {
    if (issue.fields.parent && issue.fields.parent.fields.issuetype?.hierarchyLevel === 1) {
      epicKeys.add(issue.fields.parent.key);
    }
  }

  if (epicKeys.size === 0) return [];

  // Step 2: Fetch Epic details
  const epicJql = `key IN (${[...epicKeys].join(",")})`;
  const epicUrl = `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(epicJql)}&fields=summary,status`;

  const epicData = await jiraFetch(epicUrl);

  return epicData.issues.map((issue) => ({
    id: issue.id,
    key: issue.key,
    title: issue.fields.summary,
    status: issue.fields.status.name,
    url: `${jiraBaseUrl()}/browse/${issue.key}`,
  }));
}

async function getEpicChildren(epicKey) {
  // Try "Epic Link" first (classic projects)
  let jql = `"Epic Link" = ${epicKey} ORDER BY status ASC, updated DESC`;
  let url = `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,assignee`;

  let data = await jiraFetch(url);

  // Fallback to parent = key (next-gen projects)
  if (data.issues.length === 0) {
    jql = `parent = ${epicKey} ORDER BY status ASC, updated DESC`;
    url = `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,assignee`;
    data = await jiraFetch(url);
  }

  return data.issues.map((issue) => ({
    id: issue.id,
    key: issue.key,
    title: issue.fields.summary,
    status: issue.fields.status.name,
    url: `${jiraBaseUrl()}/browse/${issue.key}`,
    assignee: issue.fields.assignee?.displayName || "Unassigned",
  }));
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function adfToHtml(node) {
  if (!node) return "";

  if (node.type === "text") {
    let html = escapeHtml(node.text);
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "strong":
            html = `<strong>${html}</strong>`; break;
          case "em":
            html = `<em>${html}</em>`; break;
          case "strike":
            html = `<s>${html}</s>`; break;
          case "code":
            html = `<code>${html}</code>`; break;
          case "underline":
            html = `<u>${html}</u>`; break;
          case "link":
            html = `<a href="${escapeHtml(mark.attrs.href)}" target="_blank" rel="noopener">${html}</a>`; break;
        }
      }
    }
    return html;
  }

  const children = (node.content || []).map(adfToHtml).join("");

  switch (node.type) {
    case "doc":              return children;
    case "paragraph":        return `<p>${children}</p>`;
    case "heading":          return `<h${node.attrs.level}>${children}</h${node.attrs.level}>`;
    case "bulletList":       return `<ul>${children}</ul>`;
    case "orderedList":      return `<ol>${children}</ol>`;
    case "listItem":         return `<li>${children}</li>`;
    case "blockquote":       return `<blockquote>${children}</blockquote>`;
    case "codeBlock":        return `<pre><code>${children}</code></pre>`;
    case "hardBreak":        return `<br>`;
    case "rule":             return `<hr>`;
    case "table":            return `<table>${children}</table>`;
    case "tableRow":         return `<tr>${children}</tr>`;
    case "tableHeader":      return `<th>${children}</th>`;
    case "tableCell":        return `<td>${children}</td>`;
    case "mediaSingle":      return `<p><em>[image]</em></p>`;
    case "mention":          return `<strong>@${escapeHtml(node.attrs.text || "")}</strong>`;
    case "emoji":            return node.attrs.shortName || "";
    case "inlineCard":       return `<a href="${escapeHtml(node.attrs.url)}" target="_blank" rel="noopener">${escapeHtml(node.attrs.url)}</a>`;
    default:                 return children;
  }
}

async function getTicketDescription(key) {
  const url = `${jiraBaseUrl()}/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`;
  const data = await jiraFetch(url);
  return adfToHtml(data.fields.description) || "<em>No description.</em>";
}

function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (!node.content) return "";
  const inner = node.content.map(adfToText).join("");
  if (node.type === "paragraph" || node.type === "heading") return inner + "\n";
  if (node.type === "listItem") return "- " + inner;
  return inner;
}

async function getTicketDetails(key) {
  const url = `${jiraBaseUrl()}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,description,assignee,reporter,priority,issuetype,created,updated,comment`;
  const data = await jiraFetch(url);
  const f = data.fields;

  let text = `Ticket: ${data.key}\n`;
  text += `Title: ${f.summary}\n`;
  text += `Type: ${f.issuetype?.name || "Unknown"}\n`;
  text += `Status: ${f.status?.name || "Unknown"}\n`;
  text += `Priority: ${f.priority?.name || "Unknown"}\n`;
  text += `Assignee: ${f.assignee?.displayName || "Unassigned"}\n`;
  text += `Reporter: ${f.reporter?.displayName || "Unknown"}\n`;
  text += `Created: ${f.created}\n`;
  text += `Updated: ${f.updated}\n`;
  text += `URL: ${jiraBaseUrl()}/browse/${data.key}\n`;
  text += `\nDescription:\n${adfToText(f.description) || "No description."}\n`;

  if (f.comment?.comments?.length) {
    text += `\nComments (${f.comment.comments.length}):\n`;
    for (const c of f.comment.comments.slice(-5)) {
      text += `--- ${c.author?.displayName || "Unknown"} (${c.created}) ---\n`;
      text += adfToText(c.body) + "\n";
    }
  }

  return text;
}

module.exports = { getMyTickets, getTicketDescription, getTicketDetails, getMyEpics, getEpicChildren, NotConfiguredError };
