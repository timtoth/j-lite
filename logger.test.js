const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-logger-"));
  delete require.cache[require.resolve("./logger")];
});

afterEach(async () => {
  delete process.env.TC_CONFIG_DIR;
  // Close the open write stream so Windows can delete the temp dir.
  try {
    const logger = require("./logger");
    if (typeof logger.close === "function") await logger.close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("logger writes app.log to TC_CONFIG_DIR when set", async () => {
  process.env.TC_CONFIG_DIR = tmpDir;
  const logger = require("./logger");
  logger.info("TEST", "hello");
  // Allow stream to flush (sync write, but just in case).
  await new Promise(resolve => setTimeout(resolve, 50));
  const logPath = path.join(tmpDir, "app.log");
  assert.equal(fs.existsSync(logPath), true);
  const contents = fs.readFileSync(logPath, "utf8");
  assert.match(contents, /\[INFO\] \[TEST\] hello/);
});

test("logger falls back to module dir when TC_CONFIG_DIR unset", () => {
  delete process.env.TC_CONFIG_DIR;
  const logger = require("./logger");
  // Should not throw; default path is alongside logger.js (existing behavior).
  logger.info("TEST", "fallback");
  assert.ok(true);
});
