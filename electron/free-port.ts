import { findFreePort as helper } from "./free-port.impl.js";

export const findFreePort: () => Promise<number> = helper;
