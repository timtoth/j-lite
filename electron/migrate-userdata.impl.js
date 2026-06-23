const path = require("node:path");

/**
 * @typedef {Object} MigrateArgs
 * @property {string} oldDir
 * @property {string} newDir
 * @property {{
 *   existsSync: (p: string) => boolean,
 *   mkdirSync: (p: string, opts?: object) => void,
 *   copyFileSync: (src: string, dest: string) => void,
 * }} fs
 */

/**
 * One-time copy of config.json (and app.log if present) from oldDir to
 * newDir. Idempotent: returns { migrated: false, copied: [] } if newDir
 * already has config.json or oldDir has no config.json.
 *
 * @param {MigrateArgs} args
 * @returns {{ migrated: boolean, copied: string[] }}
 */
function migrateUserData({ oldDir, newDir, fs }) {
  const newConfig = path.join(newDir, "config.json");
  const oldConfig = path.join(oldDir, "config.json");

  if (fs.existsSync(newConfig)) return { migrated: false, copied: [] };
  if (!fs.existsSync(oldConfig)) return { migrated: false, copied: [] };

  fs.mkdirSync(newDir, { recursive: true });
  const copied = [];

  fs.copyFileSync(oldConfig, newConfig);
  copied.push("config.json");

  const oldLog = path.join(oldDir, "app.log");
  if (fs.existsSync(oldLog)) {
    fs.copyFileSync(oldLog, path.join(newDir, "app.log"));
    copied.push("app.log");
  }

  return { migrated: true, copied };
}

module.exports = { migrateUserData };
