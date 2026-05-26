const fs = require("node:fs");
const path = require("node:path");

function statePath(configDir) {
  return path.join(configDir, "electron-state.json");
}

function readState(configDir) {
  const p = statePath(configDir);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeState(configDir, state) {
  fs.writeFileSync(statePath(configDir), JSON.stringify(state, null, 2));
}

function runClaude(spawn, args) {
  return new Promise((resolve) => {
    let settled = false;
    // shell: true so Windows resolves claude.cmd / claude.ps1 from PATH.
    const proc = spawn("claude", args, { stdio: "ignore", shell: true });
    proc.on("error", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve(code === 0);
      }
    });
  });
}

async function runClaudeAdd(spawn, mcpEntry, configDir) {
  // Remove first so an existing registration without TC_CONFIG_DIR (or with a
  // stale path) gets replaced. We ignore the exit code — remove fails when
  // there's nothing to remove, which is fine.
  await runClaude(spawn, ["mcp", "remove", "-s", "user", "create-jira-ticket"]);
  // Arg order matters: the name must come BEFORE -e, otherwise `claude mcp add`
  // greedily consumes the next token as another env var.
  return runClaude(spawn, [
    "mcp", "add", "-s", "user",
    "create-jira-ticket",
    "-e", `TC_CONFIG_DIR=${configDir}`,
    "--", "node", mcpEntry,
  ]);
}

async function registerMcpIfNeeded({ mcpEntry, configDir, spawn }) {
  const state = readState(configDir);
  if (state.mcpRegistered === true && state.mcpConfigDir === configDir) {
    return { attempted: false, success: false };
  }
  const success = await runClaudeAdd(spawn, mcpEntry, configDir);
  if (success) {
    writeState(configDir, { ...state, mcpRegistered: true, mcpConfigDir: configDir });
  }
  return { attempted: true, success };
}

module.exports = { registerMcpIfNeeded };
