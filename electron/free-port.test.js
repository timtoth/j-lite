const { test } = require("node:test");
const assert = require("node:assert/strict");

const { findFreePort } = require("./free-port.js");

test("findFreePort returns a valid port number", async () => {
  const port = await findFreePort();
  assert.equal(typeof port, "number");
  assert.ok(port > 0);
  assert.ok(port <= 65535);
});

// Relies on kernel not reusing same ephemeral port for concurrent listeners (reliable in practice).
test("two concurrent calls return different ports", async () => {
  const [port1, port2] = await Promise.all([findFreePort(), findFreePort()]);
  assert.notEqual(port1, port2);
});
