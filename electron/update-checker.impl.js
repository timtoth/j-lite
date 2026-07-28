function windowsFeedUrl(repo, version) {
  return `https://update.electronjs.org/${repo}/win32-x64/${version}`;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function checkGithubLatestRelease(repo, currentVersion, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) {
    return { state: "error", message: `GitHub API returned ${res.status}` };
  }
  const data = await res.json();
  const latest = String(data.tag_name || "").replace(/^v/, "");
  if (!latest) {
    return { state: "error", message: "Could not parse latest release tag" };
  }
  if (compareVersions(latest, currentVersion) > 0) {
    return { state: "ready", action: "open-link", version: latest, url: data.html_url };
  }
  return { state: "up-to-date" };
}

module.exports = { windowsFeedUrl, compareVersions, checkGithubLatestRelease };
