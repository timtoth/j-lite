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

// ---------- runClaudeStream runtime suite ----------

const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");

const { runClaudeStream } = require("./claude-stream");

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.killed = false;
  child.kill = (_signal) => {
    child.killed = true;
    // Schedule a close event next tick to mimic real spawn behavior.
    setImmediate(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  child.emitLine = (obj) => {
    child.stdout.push(JSON.stringify(obj) + "\n");
  };
  child.emitRaw = (str) => {
    child.stdout.push(str);
  };
  child.emitStderr = (str) => {
    child.stderr.push(str);
  };
  child.exit = (code, signal = null) => {
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit("close", code, signal));
  };
  return child;
}

function makeFakeSpawn(child) {
  return (_cmd, _args, _opts) => child;
}

function collect() {
  return {
    events: [],
    done: null,
    error: null,
    onEvent(e) { this.events.push(e); },
    onDone(d) { this.done = d; },
    onError(m) { this.error = m; },
  };
}

test("runClaudeStream: forwards deltas in order then onDone", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 1000,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  child.emitLine({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
  });
  child.emitLine({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: ", world!" } },
  });
  child.emitLine({
    type: "result",
    is_error: false,
    result: "Hi, world!",
    session_id: "s1",
  });
  child.exit(0);
  await promise;
  assert.deepEqual(c.events, [{ text: "Hi" }, { text: ", world!" }]);
  assert.deepEqual(c.done, { sessionId: "s1", fullText: "Hi, world!" });
  assert.equal(c.error, null);
});

test("runClaudeStream: idle timeout kills child and reports timeout", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 30,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  await promise;
  assert.equal(child.killed, true);
  assert.match(c.error, /idle for 30ms/);
});

test("runClaudeStream: delta resets idle timer", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 60,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  // Tick deltas every 30ms — 60ms timeout never fires.
  await new Promise((r) => setTimeout(r, 30));
  child.emitLine({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "a" } },
  });
  await new Promise((r) => setTimeout(r, 30));
  child.emitLine({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "b" } },
  });
  await new Promise((r) => setTimeout(r, 30));
  child.emitLine({
    type: "result", is_error: false, result: "ab", session_id: "s2",
  });
  child.exit(0);
  await promise;
  assert.equal(c.error, null);
  assert.deepEqual(c.done, { sessionId: "s2", fullText: "ab" });
});

test("runClaudeStream: AbortSignal kills child", async () => {
  const child = makeFakeChild();
  const c = collect();
  const ctrl = new AbortController();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      signal: ctrl.signal,
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  setImmediate(() => ctrl.abort());
  await promise;
  assert.equal(child.killed, true);
});

test("runClaudeStream: spawn ENOENT yields onError", async () => {
  const c = collect();
  const fakeSpawn = () => {
    const ee = new EventEmitter();
    ee.stdout = new Readable({ read() {} });
    ee.stderr = new Readable({ read() {} });
    ee.kill = () => {};
    setImmediate(() => ee.emit("error", new Error("spawn ENOENT")));
    return ee;
  };
  await new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 1000,
      spawn: fakeSpawn,
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  assert.match(c.error, /spawn ENOENT/);
});

test("runClaudeStream: non-zero exit with stderr surfaces stderr", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  child.emitStderr("No conversation found with session ID: bogus\n");
  child.exit(1);
  await promise;
  assert.match(c.error, /No conversation found/);
});

test("runClaudeStream: exit by external signal (no timeout) reports the signal", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  // Simulate external SIGINT without setting timedOut flag.
  setImmediate(() => {
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit("close", null, "SIGINT");
  });
  await promise;
  assert.match(c.error, /killed by SIGINT/);
});

test("runClaudeStream: exit 0 with no result event reports missing result", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  child.emitLine({ type: "system", subtype: "init" });
  child.exit(0);
  await promise;
  assert.match(c.error, /no result event/i);
});

test("runClaudeStream: two result events — onDone fires once", async () => {
  const child = makeFakeChild();
  let doneCount = 0;
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      onEvent: () => {},
      onDone:  () => { doneCount += 1; if (doneCount === 1) setImmediate(resolve); },
      onError: () => resolve(),
    });
  });
  child.emitLine({ type: "result", is_error: false, result: "a", session_id: "s1" });
  child.emitLine({ type: "result", is_error: false, result: "b", session_id: "s2" });
  child.exit(0);
  await promise;
  assert.equal(doneCount, 1);
});

test("runClaudeStream: line splitter handles a chunk split mid-line", async () => {
  const child = makeFakeChild();
  const c = collect();
  const promise = new Promise((resolve) => {
    runClaudeStream({
      prompt: "hi",
      idleTimeoutMs: 5000,
      spawn: makeFakeSpawn(child),
      onEvent: (e) => c.onEvent(e),
      onDone:  (d) => { c.onDone(d); resolve(); },
      onError: (m) => { c.onError(m); resolve(); },
    });
  });
  // Half of one line, then the rest plus a full second line.
  const part1 = `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"`;
  const part2 = `}}}\n{"type":"result","is_error":false,"result":"Hi","session_id":"s1"}\n`;
  child.emitRaw(part1);
  child.emitRaw(part2);
  child.exit(0);
  await promise;
  assert.deepEqual(c.events, [{ text: "Hi" }]);
  assert.deepEqual(c.done, { sessionId: "s1", fullText: "Hi" });
});
