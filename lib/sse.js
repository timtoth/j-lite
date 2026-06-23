// lib/sse.js
function openSse(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering. Harmless on direct connections.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;

  function send(eventName, data) {
    if (closed || res.writableEnded) return;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function close() {
    if (closed || res.writableEnded) return;
    closed = true;
    res.end();
  }

  return { send, close };
}

module.exports = { openSse };
