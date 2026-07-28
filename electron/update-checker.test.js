const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  windowsFeedUrl,
  compareVersions,
  checkGithubLatestRelease,
} = require("./update-checker.impl.js");

test("windowsFeedUrl builds the expected update.electronjs.org URL", () => {
  const url = windowsFeedUrl("timtoth/j-lite", "0.3.0");
  assert.equal(url, "https://update.electronjs.org/timtoth/j-lite/win32-x64/0.3.0");
});

test("compareVersions: lower vs higher returns negative", () => {
  assert.ok(compareVersions("0.3.0", "0.4.0") < 0);
});

test("compareVersions: equal versions returns zero", () => {
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
});

test("compareVersions: higher vs lower returns positive", () => {
  assert.ok(compareVersions("0.4.0", "0.3.0") > 0);
});

test("compareVersions: numeric segment comparison, not string comparison", () => {
  // "0.10.0" > "0.9.0" numerically, but "0.10.0" < "0.9.0" as plain strings.
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
});

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test("checkGithubLatestRelease: newer tag returns ready/open-link", async () => {
  const fetchImpl = fakeFetch(200, {
    tag_name: "v0.4.0",
    html_url: "https://github.com/timtoth/j-lite/releases/tag/v0.4.0",
  });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, {
    state: "ready",
    action: "open-link",
    version: "0.4.0",
    url: "https://github.com/timtoth/j-lite/releases/tag/v0.4.0",
  });
});

test("checkGithubLatestRelease: equal tag returns up-to-date", async () => {
  const fetchImpl = fakeFetch(200, { tag_name: "v0.3.0", html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, { state: "up-to-date" });
});

test("checkGithubLatestRelease: older tag returns up-to-date", async () => {
  const fetchImpl = fakeFetch(200, { tag_name: "v0.2.0", html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.deepEqual(result, { state: "up-to-date" });
});

test("checkGithubLatestRelease: non-2xx response returns error", async () => {
  const fetchImpl = fakeFetch(404, {});
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.equal(result.state, "error");
  assert.match(result.message, /404/);
});

test("checkGithubLatestRelease: missing tag_name returns error", async () => {
  const fetchImpl = fakeFetch(200, { html_url: "https://x" });
  const result = await checkGithubLatestRelease("timtoth/j-lite", "0.3.0", fetchImpl);
  assert.equal(result.state, "error");
});
