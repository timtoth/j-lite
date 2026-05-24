const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildServerSpawn } = require("./spawn-args.impl.js");

test("buildServerSpawn includes serverEntry as the only positional arg", () => {
  const result = buildServerSpawn({
    serverEntry: "/r/server.js",
    port: 12345,
    configDir: "/u/data",
    parentEnv: { PATH: "/usr/bin", FOO: "bar" },
  });
  assert.deepEqual(result.args, ["/r/server.js"]);
});

test("buildServerSpawn sets PORT and TC_CONFIG_DIR in env", () => {
  const result = buildServerSpawn({
    serverEntry: "/r/server.js",
    port: 12345,
    configDir: "/u/data",
    parentEnv: { PATH: "/usr/bin" },
  });
  assert.equal(result.opts.env.PORT, "12345");
  assert.equal(result.opts.env.TC_CONFIG_DIR, "/u/data");
});

test("buildServerSpawn preserves parent PATH", () => {
  const result = buildServerSpawn({
    serverEntry: "/r/server.js",
    port: 1,
    configDir: "/u",
    parentEnv: { PATH: "/usr/local/bin:/usr/bin" },
  });
  assert.equal(result.opts.env.PATH, "/usr/local/bin:/usr/bin");
});

test("buildServerSpawn sets cwd to configDir", () => {
  const result = buildServerSpawn({
    serverEntry: "/r/server.js",
    port: 1,
    configDir: "/u/data",
    parentEnv: { PATH: "/usr/bin" },
  });
  assert.equal(result.opts.cwd, "/u/data");
});

test("buildServerSpawn pipes stdout/stderr", () => {
  const result = buildServerSpawn({
    serverEntry: "/r/server.js",
    port: 1,
    configDir: "/u",
    parentEnv: { PATH: "/usr/bin" },
  });
  assert.deepEqual(result.opts.stdio, ["ignore", "pipe", "pipe"]);
});
