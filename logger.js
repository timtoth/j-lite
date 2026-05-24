const fs = require("fs");
const path = require("path");

const logStream = fs.createWriteStream(path.join(__dirname, "app.log"), { flags: "a" });

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
};

module.exports = logger;
