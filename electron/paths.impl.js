const path = require("node:path");

/**
 * @typedef {Object} PathEnv
 * @property {boolean} isPackaged
 * @property {string} resourcesPath
 * @property {string} appPath
 */

/**
 * @param {PathEnv} env
 * @returns {string}
 */
function rootDir(env) {
  return env.isPackaged ? env.resourcesPath : env.appPath;
}

/**
 * @param {PathEnv} env
 * @returns {string}
 */
function serverEntry(env) {
  return path.join(rootDir(env), "server.js");
}

/**
 * @param {PathEnv} env
 * @returns {string}
 */
function mcpEntry(env) {
  return path.join(rootDir(env), "mcp", "create-ticket-server.mjs");
}

module.exports = { rootDir, serverEntry, mcpEntry };
