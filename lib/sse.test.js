// lib/sse.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");

const { openSse } = require("./sse");

function makeMockRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  res.headers = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.flushHeaders = () => {
    res.headersSent = true;
  };
  res.writableEnded = false;
  const origEnd = res.end.bind(res);
  res.end = (...args) => {
    res.writableEnded = true;
    return origEnd(...args);
  };
  res.body = () => chunks.join("");
  return res;
}

test("openSse sets streaming headers and flushes", () => {
  const res = makeMockRes();
  openSse(res);
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.equal(res.headers["connection"], "keep-alive");
  assert.equal(res.headers["x-accel-buffering"], "no");
  assert.equal(res.headersSent, true);
});

test("send writes a properly framed SSE event", () => {
  const res = makeMockRes();
  const sse = openSse(res);
  sse.send("delta", { text: "hi" });
  assert.equal(res.body(), `event: delta\ndata: {"text":"hi"}\n\n`);
});

test("send after close is a no-op", () => {
  const res = makeMockRes();
  const sse = openSse(res);
  sse.send("delta", { text: "before" });
  sse.close();
  sse.send("delta", { text: "after" });
  assert.equal(res.body(), `event: delta\ndata: {"text":"before"}\n\n`);
});

test("send after res.end is a no-op", () => {
  const res = makeMockRes();
  const sse = openSse(res);
  res.end();
  sse.send("delta", { text: "after" });
  assert.equal(res.body(), "");
});

test("close ends the response exactly once", () => {
  const res = makeMockRes();
  let endCount = 0;
  const origEnd = res.end.bind(res);
  res.end = (...args) => {
    endCount += 1;
    return origEnd(...args);
  };
  const sse = openSse(res);
  sse.close();
  sse.close();
  assert.equal(endCount, 1);
});
