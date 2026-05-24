function buildServerSpawn({ serverEntry, port, configDir, parentEnv }) {
  return {
    command: "node",
    args: [serverEntry],
    opts: {
      cwd: configDir,
      env: {
        ...parentEnv,
        PORT: String(port),
        TC_CONFIG_DIR: configDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  };
}

module.exports = { buildServerSpawn };
