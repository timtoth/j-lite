const { Router } = require("express");
const { getTicketDetails } = require("../jira");
const logger = require("../logger");
const { openSse } = require("../lib/sse");
const { runClaudeStream: defaultRunClaudeStream } = require("../lib/claude-stream");

const router = Router();

function log(message) {
  logger.info("INSTRUCT", message);
}

const TICKET_KEY_REGEX = /[A-Z][A-Z0-9]+-\d+/g;
const IDLE_TIMEOUT_MS = 300_000; // 5 minutes — see spec section 8.

// Dependency-injection hook for tests.
let runClaudeStreamImpl = defaultRunClaudeStream;
router._setRunClaudeStream = (fn) => {
  runClaudeStreamImpl = fn || defaultRunClaudeStream;
};

async function buildPrompt({ instruction, space }) {
  const keys = [...new Set(instruction.match(TICKET_KEY_REGEX) || [])];
  let context = "";
  if (keys.length > 0) {
    const details = await Promise.allSettled(keys.map(getTicketDetails));
    const resolved = details
      .filter((d) => d.status === "fulfilled")
      .map((d) => d.value);
    if (resolved.length > 0) {
      context =
        "Here is the JIRA ticket data referenced in the request:\n\n" +
        resolved.join("\n---\n\n") +
        "\n---\n\n";
    }
  }
  let spaceContext = "";
  if (typeof space === "string" && space.length > 0) {
    spaceContext = `The user is working in JIRA space ${space}.\n\n`;
  }
  return spaceContext + context + instruction;
}

router.post("/api/instruct/stream", async (req, res) => {
  const { instruction, cwd, sessionId, space } = req.body || {};
  if (!instruction || typeof instruction !== "string") {
    return res.status(400).json({ error: "instruction is required" });
  }

  let prompt;
  try {
    prompt = await buildPrompt({ instruction, space });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  log(`PROMPT: ${prompt.slice(0, 4000)}`);
  log(`SESSION: ${sessionId || "(new)"}`);

  const sse = openSse(res);
  const ctrl = new AbortController();
  let fullText = "";
  let stream = null;

  res.on("close", () => {
    if (!res.writableEnded) {
      log("client disconnected mid-stream");
      ctrl.abort();
      if (stream) {
        try { stream.kill(); } catch {}
      }
    }
  });

  stream = runClaudeStreamImpl({
    prompt,
    cwd: cwd || undefined,
    sessionId: sessionId || undefined,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    signal: ctrl.signal,
    logger,
    onEvent: (e) => {
      fullText += e.text;
      sse.send("delta", { text: e.text });
    },
    onDone: (d) => {
      log(`FULL_RESPONSE: ${(d.fullText || fullText).slice(0, 2000)}`);
      sse.send("done", { sessionId: d.sessionId });
      sse.close();
    },
    onError: (message) => {
      sse.send("error", { message });
      sse.close();
    },
  });
});

module.exports = router;
