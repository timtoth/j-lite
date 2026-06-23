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

const { Transform } = require("node:stream");
const { spawn: nodeSpawn } = require("node:child_process");

class LineSplitter extends Transform {
  constructor() {
    super({ readableObjectMode: false, writableObjectMode: false });
    this._buf = "";
  }
  _transform(chunk, _enc, cb) {
    this._buf += chunk.toString("utf8");
    let idx;
    while ((idx = this._buf.indexOf("\n")) !== -1) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.length > 0) this.push(line);
    }
    cb();
  }
  _flush(cb) {
    if (this._buf.length > 0) {
      this.push(this._buf);
      this._buf = "";
    }
    cb();
  }
}

function buildArgs(sessionId, prompt) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
  ];
  if (sessionId) args.push("--resume", sessionId);
  args.push(prompt);
  return args;
}

function runClaudeStream({
  prompt,
  cwd,
  sessionId,
  idleTimeoutMs,
  onEvent,
  onDone,
  onError,
  signal,
  spawn,
  logger,
}) {
  const spawnFn = spawn || nodeSpawn;
  const log = logger || { info: () => {}, warn: () => {} };

  let resolved = false;
  let timedOut = false;
  let stderrBuf = "";
  let idleTimer = null;
  let child;

  function fireDone(payload) {
    if (resolved) return;
    resolved = true;
    clearTimeout(idleTimer);
    onDone(payload);
  }

  function fireError(message) {
    if (resolved) return;
    resolved = true;
    clearTimeout(idleTimer);
    onError(message);
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
    }, idleTimeoutMs);
  }

  const opts = { stdio: ["ignore", "pipe", "pipe"], shell: false };
  if (cwd) opts.cwd = cwd;

  try {
    child = spawnFn("claude", buildArgs(sessionId, prompt), opts);
  } catch (err) {
    fireError(err.message);
    return { kill: () => {} };
  }

  resetIdle();

  if (signal) {
    if (signal.aborted) {
      try { child.kill("SIGTERM"); } catch {}
    } else {
      signal.addEventListener("abort", () => {
        try { child.kill("SIGTERM"); } catch {}
      }, { once: true });
    }
  }

  const splitter = new LineSplitter();
  child.stdout.pipe(splitter);

  splitter.on("data", (line) => {
    const evt = classify(line.toString("utf8"));
    switch (evt.kind) {
      case "delta":
        resetIdle();
        if (!resolved) onEvent({ text: evt.text });
        break;
      case "done":
        fireDone({ sessionId: evt.sessionId, fullText: evt.fullText });
        break;
      case "error":
        fireError(evt.message);
        break;
      case "bad_line":
        log.warn("INSTRUCT", `bad line: ${line.toString("utf8").slice(0, 200)}`);
        break;
      case "ignore":
      default:
        log.info("INSTRUCT", `dropped: ${evt.reason || "unknown"}`);
        break;
    }
  });

  const STDERR_CAP = 16_384;
  child.stderr.on("data", (chunk) => {
    if (stderrBuf.length >= STDERR_CAP) return;
    stderrBuf += chunk.toString("utf8");
    if (stderrBuf.length > STDERR_CAP) {
      stderrBuf = stderrBuf.slice(0, STDERR_CAP);
    }
  });

  child.on("error", (err) => {
    fireError(err.message);
  });

  child.on("close", (code, sig) => {
    if (resolved) {
      log.info("INSTRUCT", `EXIT CODE: ${code} SIGNAL: ${sig ?? "none"} (after resolve)`);
      return;
    }
    if (timedOut) {
      log.info("INSTRUCT", `EXIT CODE: ${code} SIGNAL: ${sig ?? "none"} (idle timeout)`);
      fireError(`Claude CLI idle for ${idleTimeoutMs}ms; terminated`);
    } else if (sig) {
      log.info("INSTRUCT", `EXIT CODE: ${code} SIGNAL: ${sig} (signal kill)`);
      fireError(`Claude CLI killed by ${sig}`);
    } else if (code !== 0) {
      log.info("INSTRUCT", `EXIT CODE: ${code} SIGNAL: ${sig ?? "none"} (non-zero exit)`);
      const trimmed = stderrBuf.trim();
      fireError(trimmed || `Claude CLI exited with code ${code}`);
    } else {
      log.info("INSTRUCT", `EXIT CODE: 0 SIGNAL: none (no result event)`);
      fireError("Stream ended with no result event");
    }
  });

  return {
    kill: () => {
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}

module.exports = { classify, runClaudeStream };
