import test from "node:test";
import assert from "node:assert/strict";
import { describeUpdateStatus } from "./update-status-view.js";

test("describeUpdateStatus returns null before any check has run", () => {
  assert.equal(describeUpdateStatus(null), null);
});

test("describeUpdateStatus reports checking with a spinning loader", () => {
  const view = describeUpdateStatus({ state: "checking" });
  assert.equal(view.icon, "loader");
  assert.equal(view.label, "Checking…");
  assert.equal(view.spin, true);
});

test("describeUpdateStatus reports up-to-date with a green check", () => {
  const view = describeUpdateStatus({ state: "up-to-date" });
  assert.equal(view.icon, "check");
  assert.equal(view.label, "Up to date");
  assert.equal(view.color, "#7ee2a0");
  assert.equal(view.spin, false);
});

test("describeUpdateStatus reports downloading with a spinning loader", () => {
  const view = describeUpdateStatus({ state: "downloading" });
  assert.equal(view.icon, "loader");
  assert.equal(view.label, "Downloading…");
  assert.equal(view.spin, true);
});

test("describeUpdateStatus reports an available update in amber", () => {
  const view = describeUpdateStatus({ state: "ready", action: "restart" });
  assert.equal(view.icon, "arrow-up");
  assert.equal(view.label, "Update Available");
  assert.equal(view.color, "#e6c25a");
});

test("describeUpdateStatus treats the open-link ready variant the same", () => {
  const view = describeUpdateStatus({
    state: "ready",
    action: "open-link",
    version: "0.3.2",
    url: "https://example.test/releases",
  });
  assert.equal(view.icon, "arrow-up");
  assert.equal(view.label, "Update Available");
});

test("describeUpdateStatus surfaces the error message as a tooltip", () => {
  const view = describeUpdateStatus({ state: "error", message: "ENOTFOUND" });
  assert.equal(view.icon, "x");
  assert.equal(view.label, "Check failed");
  assert.equal(view.color, "#f5b7b1");
  assert.equal(view.title, "ENOTFOUND");
});

test("describeUpdateStatus omits the tooltip for non-error states", () => {
  assert.equal(describeUpdateStatus({ state: "up-to-date" }).title, undefined);
});
