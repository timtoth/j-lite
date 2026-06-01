// routes/instruct.stream.test.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

let app;
let mockRun;
let getTicketDetailsCalls;

beforeEach(() => {
  // Reset the route module so per-test injection is clean.
  delete require.cache[require.resolve("./instruct")];
  delete require.cache[require.resolve("../jira")];
  // Stub jira.getTicketDetails before the route loads.
  require.cache[require.resolve("../jira")] = {
    id: require.resolve("../jira"),
    filename: require.resolve("../jira"),
    loaded: true,
    exports: {
      getTicketDetails: async (key) => {
        getTicketDetailsCalls.push(key);
        return `Ticket: ${key}\nTitle: stub`;
      },
    },
  };
  getTicketDetailsCalls = [];

  const router = require("./instruct");
  // Default mock: capture call args, expose hooks to fire callbacks.
  mockRun = {
    lastArgs: null,
    fire: null,
    killCount: 0,
  };
  router._setRunClaudeStream((args) => {
    mockRun.lastArgs = args;
    mockRun.fire = args;
    return { kill: () => { mockRun.killCount += 1; } };
  });

  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(router);
});

afterEach(() => {
  delete require.cache[require.resolve("./instruct")];
  delete require.cache[require.resolve("../jira")];
});

async function postStream(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/instruct/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

async function readSseFrames(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = /^event: (.*)$/m.exec(raw)?.[1];
      const data = /^data: (.*)$/m.exec(raw)?.[1];
      frames.push({ event, data: JSON.parse(data) });
    }
    if (done) break;
  }
  return frames;
}

test("POST without instruction returns 400", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/instruct/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      this.close();
      resolve();
    });
  });
});

test("happy path streams delta then done", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      // Schedule the mock to fire once the route invokes runClaudeStream.
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onEvent({ text: "Hi" });
          mockRun.fire.onEvent({ text: ", world!" });
          mockRun.fire.onDone({ sessionId: "s1", fullText: "Hi, world!" });
        }
      }, 5);
      const res = await postStream(port, { instruction: "say hi" });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /event-stream/);
      const frames = await readSseFrames(res);
      assert.deepEqual(frames, [
        { event: "delta", data: { text: "Hi" } },
        { event: "delta", data: { text: ", world!" } },
        { event: "done",  data: { sessionId: "s1" } },
      ]);
      this.close();
      resolve();
    });
  });
});

test("error path streams a single error frame", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onError("boom");
        }
      }, 5);
      const res = await postStream(port, { instruction: "fail" });
      const frames = await readSseFrames(res);
      assert.deepEqual(frames, [
        { event: "error", data: { message: "boom" } },
      ]);
      this.close();
      resolve();
    });
  });
});

test("ticket key context is prepended to prompt", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onDone({ sessionId: "s1", fullText: "" });
        }
      }, 5);
      const res = await postStream(port, { instruction: "what is RL-123?" });
      await readSseFrames(res);
      assert.deepEqual(getTicketDetailsCalls, ["RL-123"]);
      assert.match(mockRun.lastArgs.prompt, /Ticket: RL-123/);
      assert.match(mockRun.lastArgs.prompt, /what is RL-123\?/);
      this.close();
      resolve();
    });
  });
});

test("space context is prepended to prompt", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onDone({ sessionId: "s1", fullText: "" });
        }
      }, 5);
      const res = await postStream(port, { instruction: "hello", space: "RL" });
      await readSseFrames(res);
      assert.match(
        mockRun.lastArgs.prompt,
        /^The user is working in JIRA space RL\./,
      );
      this.close();
      resolve();
    });
  });
});

test("sessionId is forwarded to runClaudeStream", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onDone({ sessionId: "s1", fullText: "" });
        }
      }, 5);
      const res = await postStream(port, { instruction: "hi", sessionId: "abc" });
      await readSseFrames(res);
      assert.equal(mockRun.lastArgs.sessionId, "abc");
      this.close();
      resolve();
    });
  });
});

test("client disconnect kills the child", async () => {
  await new Promise((resolve) => {
    app.listen(0, async function () {
      const port = this.address().port;
      const ctrl = new AbortController();
      const tick = setInterval(() => {
        if (mockRun.fire) {
          clearInterval(tick);
          mockRun.fire.onEvent({ text: "first" });
          // After first delta, abort the request.
          setTimeout(() => ctrl.abort(), 20);
        }
      }, 5);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/instruct/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction: "hi" }),
          signal: ctrl.signal,
        });
        // Read until aborted.
        const reader = res.body.getReader();
        try { while (true) { const { done } = await reader.read(); if (done) break; } } catch {}
      } catch {}
      // Give the server a tick to process req.on('close').
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(mockRun.killCount >= 1, `expected kill, got ${mockRun.killCount}`);
      this.close();
      resolve();
    });
  });
});
