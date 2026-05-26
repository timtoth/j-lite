const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// We import the compiled module under test by requiring the .ts via ts-node?
// Avoid that complexity: use plain JS for the helper and test it directly.
const paths = require("./paths.impl.js");

test("serverEntry uses resourcesPath when packaged", () => {
  const result = paths.serverEntry({
    isPackaged: true,
    resourcesPath: "/Applications/TC.app/Contents/Resources",
    appPath: "/Applications/TC.app/Contents/Resources/app",
  });
  assert.equal(result, path.join("/Applications/TC.app/Contents/Resources", "server.js"));
});

test("serverEntry uses repo root when in dev", () => {
  const result = paths.serverEntry({
    isPackaged: false,
    resourcesPath: "/ignored",
    appPath: "/repo/root",
  });
  assert.equal(result, path.join("/repo/root", "server.js"));
});

test("mcpEntry uses resourcesPath when packaged", () => {
  const result = paths.mcpEntry({
    isPackaged: true,
    resourcesPath: "/Resources",
    appPath: "/Resources/app",
  });
  assert.equal(result, path.join("/Resources", "mcp", "create-ticket-server.mjs"));
});

test("mcpEntry uses repo root when in dev", () => {
  const result = paths.mcpEntry({
    isPackaged: false,
    resourcesPath: "/ignored",
    appPath: "/repo",
  });
  assert.equal(result, path.join("/repo", "mcp", "create-ticket-server.mjs"));
});
