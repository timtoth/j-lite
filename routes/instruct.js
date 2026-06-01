const { Router } = require("express");
const { spawn } = require("child_process");
const { getTicketDetails } = require("../jira");
const logger = require("../logger");

const router = Router();

function log(message) {
  logger.info("INSTRUCT", message);
}

const TICKET_KEY_REGEX = /[A-Z][A-Z0-9]+-\d+/g;

router.post("/api/instruct", async (req, res) => {
  const { instruction, cwd, sessionId, space } = req.body;

  if (!instruction) {
    return res.status(400).json({ error: "instruction is required" });
  }

  // Detect ticket keys and fetch their details (unchanged behavior)
  const keys = [...new Set(instruction.match(TICKET_KEY_REGEX) || [])];
  let context = "";
  if (keys.length > 0) {
    const details = await Promise.allSettled(keys.map(getTicketDetails));
    const resolved = details
      .filter((d) => d.status === "fulfilled")
      .map((d) => d.value);
    if (resolved.length > 0) {
      context = "Here is the JIRA ticket data referenced in the request:\n\n" +
        resolved.join("\n---\n\n") +
        "\n---\n\n";
    }
  }

  let spaceContext = "";
  if (typeof space === "string" && space.length > 0) {
    spaceContext = `The user is working in JIRA space ${space}.\n\n`;
  }
  const prompt = spaceContext + context + instruction;
  log(`PROMPT: ${prompt}`);
  log(`SESSION: ${sessionId || "(new)"}`);

  const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions"];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  args.push(prompt);

  // 10 minutes — tool-heavy MCP turns (space re-discovery, multi-step ticket
  // creation) routinely exceed the old 2-minute cap.
  const TIMEOUT_MS = 600_000;

  const spawnOpts = {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (cwd) spawnOpts.cwd = cwd;

  const child = spawn("claude", args, spawnOpts);

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const killTimer = setTimeout(() => {
    timedOut = true;
    log(`TIMEOUT: killing Claude CLI after ${TIMEOUT_MS}ms`);
    child.kill("SIGTERM");
  }, TIMEOUT_MS);

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    log(`SPAWN ERROR: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  child.on("close", (code, signal) => {
    clearTimeout(killTimer);
    log(`EXIT CODE: ${code} SIGNAL: ${signal ?? "none"}${timedOut ? " (timeout)" : ""}`);
    log(`STDOUT: ${stdout.slice(0, 2000)}`);
    log(`STDERR: ${stderr}`);
    if (res.headersSent) return;

    let parsed = null;
    if (stdout.trim()) {
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        log(`JSON PARSE ERROR: ${err.message}`);
      }
    }

    // If the CLI reported an error (either via non-zero exit, signal-kill, or
    // is_error in JSON), surface the most informative message we can find.
    const cliReportedError =
      code !== 0 || signal !== null || (parsed && parsed.is_error);
    if (cliReportedError) {
      let fallback;
      if (timedOut) {
        fallback = `Claude CLI timed out after ${Math.round(TIMEOUT_MS / 1000)}s and was terminated`;
      } else if (signal) {
        fallback = `Claude CLI was killed by signal ${signal}`;
      } else {
        fallback = `Claude CLI exited with code ${code}`;
      }
      const message =
        (parsed && parsed.result) || stderr.trim() || fallback;
      return res.status(500).json({ error: message });
    }

    if (!parsed) {
      return res.status(500).json({
        error: "Failed to parse Claude output",
      });
    }

    const response = parsed.result ?? parsed.response ?? parsed.text ?? "";
    const returnedSessionId = parsed.session_id ?? parsed.sessionId ?? sessionId ?? null;

    if (!response) {
      log(`UNEXPECTED CLAUDE JSON SHAPE: ${JSON.stringify(parsed).slice(0, 500)}`);
      return res.status(500).json({
        error: "Claude returned an unexpected response shape",
      });
    }

    res.json({ response, sessionId: returnedSessionId });
  });
});

module.exports = router;
