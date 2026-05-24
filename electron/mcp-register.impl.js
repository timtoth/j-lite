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

function runClaudeAdd(spawn, mcpEntry) {
  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(
      "claude",
      ["mcp", "add", "-s", "user", "create-jira-ticket", "--", "node", mcpEntry],
      { stdio: "ignore" }
    );
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

async function registerMcpIfNeeded({ mcpEntry, configDir, spawn }) {
  const state = readState(configDir);
  if (state.mcpRegistered === true) {
    return { attempted: false, success: false };
  }
  const success = await runClaudeAdd(spawn, mcpEntry);
  if (success) {
    writeState(configDir, { ...state, mcpRegistered: true });
  }
  return { attempted: true, success };
}

module.exports = { registerMcpIfNeeded };
