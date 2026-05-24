const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { registerMcpIfNeeded } = require("./mcp-register.impl.js");

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-mcp-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("first run runs claude with correct args and writes state file", async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return {
      on(event, handler) {
        if (event === "close") setImmediate(() => handler(0));
      },
    };
  };

  const result = await registerMcpIfNeeded({
    mcpEntry: "/r/mcp/create-ticket-server.mjs",
    configDir: tmpDir,
    spawn: fakeSpawn,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.success, true);
  assert.deepEqual(calls[0].cmd, "claude");
  assert.deepEqual(calls[0].args, [
    "mcp", "add", "-s", "user", "create-jira-ticket",
    "--", "node", "/r/mcp/create-ticket-server.mjs",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(tmpDir, "electron-state.json"), "utf8")
  );
  assert.equal(state.mcpRegistered, true);
});

test("second run does nothing when mcpRegistered=true", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "electron-state.json"),
    JSON.stringify({ mcpRegistered: true })
  );
  let called = false;
  const fakeSpawn = () => {
    called = true;
    return { on: () => {} };
  };

  const result = await registerMcpIfNeeded({
    mcpEntry: "/x",
    configDir: tmpDir,
    spawn: fakeSpawn,
  });

  assert.equal(result.attempted, false);
  assert.equal(called, false);
});

test("non-zero exit leaves mcpRegistered false and reports failure", async () => {
  const fakeSpawn = () => ({
    on(event, handler) {
      if (event === "close") setImmediate(() => handler(1));
    },
  });

  const result = await registerMcpIfNeeded({
    mcpEntry: "/x",
    configDir: tmpDir,
    spawn: fakeSpawn,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.success, false);

  const stateExists = fs.existsSync(path.join(tmpDir, "electron-state.json"));
  if (stateExists) {
    const state = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "electron-state.json"), "utf8")
    );
    assert.notEqual(state.mcpRegistered, true);
  }
});

test("spawn error leaves mcpRegistered false", async () => {
  const fakeSpawn = () => ({
    on(event, handler) {
      if (event === "error") setImmediate(() => handler(new Error("ENOENT")));
    },
  });

  const result = await registerMcpIfNeeded({
    mcpEntry: "/x",
    configDir: tmpDir,
    spawn: fakeSpawn,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.success, false);
});
