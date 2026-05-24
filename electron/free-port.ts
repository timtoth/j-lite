const helper = require("./free-port.js");

export function findFreePort(): Promise<number> {
  return helper.findFreePort();
}
