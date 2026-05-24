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
  const { instruction, cwd, sessionId } = req.body;

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

  const prompt = context + instruction;
  log(`PROMPT: ${prompt}`);
  log(`SESSION: ${sessionId || "(new)"}`);

  const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions"];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  args.push(prompt);

  const spawnOpts = {
    timeout: 120_000,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (cwd) spawnOpts.cwd = cwd;

  const child = spawn("claude", args, spawnOpts);

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    log(`SPAWN ERROR: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  child.on("close", (code) => {
    log(`EXIT CODE: ${code}`);
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

    // If the CLI reported an error (either via non-zero exit or is_error in JSON),
    // surface the most informative message we can find.
    const cliReportedError = code !== 0 || (parsed && parsed.is_error);
    if (cliReportedError) {
      const message =
        (parsed && parsed.result) ||
        stderr.trim() ||
        `Claude CLI exited with code ${code}`;
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
