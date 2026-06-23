const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { migrateUserData } = require("./migrate-userdata.impl.js");

function makeFakeFs(initial) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set();
  for (const p of files.keys()) dirs.add(path.dirname(p));
  return {
    files,
    dirs,
    existsSync: (p) => files.has(p),
    mkdirSync: (p, _opts) => {
      dirs.add(p);
    },
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    copyFileSync: (src, dest) => {
      if (!files.has(src)) throw new Error("ENOENT: " + src);
      files.set(dest, files.get(src));
    },
  };
}

test("copies config.json and app.log from old dir when new dir is fresh", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"hello":"world"}',
    [path.join(oldDir, "app.log")]: "log line",
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.copied.sort(), ["app.log", "config.json"]);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"hello":"world"}');
  assert.equal(fs.files.get(path.join(newDir, "app.log")), "log line");
});

test("copies only config.json when old dir has no app.log", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"a":1}',
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.copied, ["config.json"]);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"a":1}');
});

test("no-op when new dir already has config.json", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: '{"old":true}',
    [path.join(newDir, "config.json")]: '{"new":true}',
  });

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, false);
  assert.deepEqual(result.copied, []);
  assert.equal(fs.files.get(path.join(newDir, "config.json")), '{"new":true}');
});

test("no-op when old dir has no config.json", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({});

  const result = migrateUserData({ oldDir, newDir, fs });

  assert.equal(result.migrated, false);
  assert.deepEqual(result.copied, []);
});

test("creates new dir before copying", () => {
  const oldDir = "/appdata/ticket-control";
  const newDir = "/appdata/jLite";
  const fs = makeFakeFs({
    [path.join(oldDir, "config.json")]: "{}",
  });

  migrateUserData({ oldDir, newDir, fs });

  assert.ok(fs.dirs.has(newDir), "new dir should be created");
});
