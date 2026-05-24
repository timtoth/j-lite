const { spawnSync } = require("node:child_process");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "mcp", "create-ticket-server.mjs");
const shellOpt = process.platform === "win32";

const listResult = spawnSync("claude", ["mcp", "list"], {
  encoding: "utf8",
  shell: shellOpt,
});

if (listResult.error) {
  console.error("Failed to invoke 'claude':", listResult.error.message);
  console.error("Make sure Claude Code is installed and 'claude' is on your PATH.");
  process.exit(1);
}

if ((listResult.stdout || "").includes("create-jira-ticket")) {
  console.log("create-jira-ticket MCP is already registered with Claude Code.");
  process.exit(0);
}

console.log("Registering create-jira-ticket MCP with Claude Code (user scope)...");
console.log(`  Server: ${serverPath}`);

const result = spawnSync(
  "claude",
  ["mcp", "add", "-s", "user", "create-jira-ticket", "--", "node", serverPath],
  { stdio: "inherit", shell: shellOpt }
);

if (result.error) {
  console.error("Failed to invoke 'claude':", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
