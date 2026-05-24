import { registerMcpIfNeeded as helper } from "./mcp-register.impl.js";

export interface RegisterMcpInput {
  mcpEntry: string;
  configDir: string;
  spawn: typeof import("node:child_process").spawn;
}

export interface RegisterMcpResult {
  attempted: boolean;
  success: boolean;
}

export const registerMcpIfNeeded: (
  input: RegisterMcpInput
) => Promise<RegisterMcpResult> = helper;
