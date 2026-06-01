// lib/claude-stream.js
function classify(line) {
  if (!line || !line.trim()) return { kind: "bad_line" };

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return { kind: "bad_line" };
  }

  if (!obj || typeof obj !== "object") return { kind: "bad_line" };

  // Final result envelope.
  if (obj.type === "result") {
    if (obj.is_error === true) {
      const message =
        (typeof obj.result === "string" && obj.result.trim()) ||
        "Claude reported an error";
      return { kind: "error", message };
    }
    return {
      kind: "done",
      sessionId: obj.session_id || null,
      fullText: typeof obj.result === "string" ? obj.result : "",
    };
  }

  // Per-event stream messages.
  if (obj.type === "stream_event" && obj.event && typeof obj.event === "object") {
    const ev = obj.event;
    if (ev.type === "content_block_delta" && ev.delta) {
      if (ev.delta.type === "text_delta" && typeof ev.delta.text === "string") {
        return { kind: "delta", text: ev.delta.text };
      }
      // signature_delta (thinking) and any other delta types fall through.
      return { kind: "ignore", reason: `delta:${ev.delta.type}` };
    }
    return { kind: "ignore", reason: `stream_event:${ev.type}` };
  }

  // Full-message echoes, system events, status, hooks, etc.
  if (obj.type === "assistant" || obj.type === "user") {
    return { kind: "ignore", reason: `${obj.type}:full_message` };
  }
  if (obj.type === "system") {
    return { kind: "ignore", reason: `system:${obj.subtype || "unknown"}` };
  }

  return { kind: "ignore", reason: `unknown:${obj.type || "no_type"}` };
}

module.exports = { classify };
