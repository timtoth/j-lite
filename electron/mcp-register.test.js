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
    "mcp", "remove", "-s", "user", "create-jira-ticket",
  ]);
  assert.deepEqual(calls[1].args, [
    "mcp", "add", "-s", "user",
    "create-jira-ticket",
    "-e", `TC_CONFIG_DIR=${tmpDir}`,
    "--", "node", "/r/mcp/create-ticket-server.mjs",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(tmpDir, "electron-state.json"), "utf8")
  );
  assert.equal(state.mcpRegistered, true);
  assert.equal(state.mcpConfigDir, tmpDir);
});

test("second run does nothing when mcpRegistered=true and configDir matches", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "electron-state.json"),
    JSON.stringify({ mcpRegistered: true, mcpConfigDir: tmpDir })
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

test("re-registers when configDir differs from saved mcpConfigDir", async () => {
  fs.writeFileSync(
    path.join(tmpDir, "electron-state.json"),
    JSON.stringify({ mcpRegistered: true, mcpConfigDir: "/old/path" })
  );
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
    mcpEntry: "/x",
    configDir: tmpDir,
    spawn: fakeSpawn,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.success, true);
  const addCall = calls.find((c) => c.args[1] === "add");
  assert.ok(addCall, "expected an mcp add call");
  assert.ok(addCall.args.includes(`TC_CONFIG_DIR=${tmpDir}`));
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
