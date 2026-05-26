const fs = require("fs");
const path = require("path");

function resolveLogPath() {
  const dir = process.env.TC_CONFIG_DIR || __dirname;
  return path.join(dir, "app.log");
}

const logStream = fs.createWriteStream(resolveLogPath(), { flags: "a" });

function formatMessage(level, category, message) {
  return `[${new Date().toISOString()}] [${level}] [${category}] ${message}`;
}

function write(level, category, message) {
  const formatted = formatMessage(level, category, message);
  logStream.write(formatted + "\n");
  if (level === "ERROR") {
    console.error(formatted);
  } else {
    console.log(formatted);
  }
}

const logger = {
  info: (category, message) => write("INFO", category, message),
  warn: (category, message) => write("WARN", category, message),
  error: (category, message) => write("ERROR", category, message),
  close: () => new Promise((resolve) => logStream.end(resolve)),
};

module.exports = logger;
