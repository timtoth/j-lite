// lib/claude-stream.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { classify } = require("./claude-stream");

function line(obj) {
  return JSON.stringify(obj);
}

test("classify: text_delta extracts text", () => {
  const evt = classify(line({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hi" },
    },
  }));
  assert.deepEqual(evt, { kind: "delta", text: "Hi" });
});

test("classify: signature_delta (thinking) is ignored", () => {
  const evt = classify(line({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "signature_delta", signature: "..." },
    },
  }));
  assert.equal(evt.kind, "ignore");
});

test("classify: thinking content_block_start is ignored", () => {
  const evt = classify(line({
    type: "stream_event",
    event: {
      type: "content_block_start",
      content_block: { type: "thinking", thinking: "" },
    },
  }));
  assert.equal(evt.kind, "ignore");
});

test("classify: message_start is ignored", () => {
  const evt = classify(line({
    type: "stream_event",
    event: { type: "message_start", message: {} },
  }));
  assert.equal(evt.kind, "ignore");
});

test("classify: assistant full message echo is ignored", () => {
  const evt = classify(line({
    type: "assistant",
    message: { content: [] },
  }));
  assert.equal(evt.kind, "ignore");
});

test("classify: system init is ignored", () => {
  const evt = classify(line({ type: "system", subtype: "init" }));
  assert.equal(evt.kind, "ignore");
});

test("classify: system hook events are ignored", () => {
  const a = classify(line({ type: "system", subtype: "hook_started" }));
  const b = classify(line({ type: "system", subtype: "hook_response" }));
  assert.equal(a.kind, "ignore");
  assert.equal(b.kind, "ignore");
});

test("classify: system status is ignored", () => {
  const evt = classify(line({ type: "system", subtype: "status" }));
  assert.equal(evt.kind, "ignore");
});

test("classify: result success becomes done", () => {
  const evt = classify(line({
    type: "result",
    is_error: false,
    result: "Hi there",
    session_id: "abc-123",
  }));
  assert.deepEqual(evt, {
    kind: "done",
    sessionId: "abc-123",
    fullText: "Hi there",
  });
});

test("classify: result is_error becomes error with result text", () => {
  const evt = classify(line({
    type: "result",
    is_error: true,
    result: "oh no",
    session_id: "abc-123",
  }));
  assert.deepEqual(evt, { kind: "error", message: "oh no" });
});

test("classify: result is_error with empty result uses default message", () => {
  const evt = classify(line({
    type: "result",
    is_error: true,
    result: "",
    session_id: "abc-123",
  }));
  assert.deepEqual(evt, { kind: "error", message: "Claude reported an error" });
});

test("classify: malformed JSON is bad_line", () => {
  const evt = classify("not json");
  assert.equal(evt.kind, "bad_line");
});

test("classify: empty line is bad_line", () => {
  const evt = classify("");
  assert.equal(evt.kind, "bad_line");
});

test("classify: unknown event type is ignored", () => {
  const evt = classify(line({ type: "future_event_type" }));
  assert.equal(evt.kind, "ignore");
});
