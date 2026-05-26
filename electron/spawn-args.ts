import { buildServerSpawn as helper } from "./spawn-args.impl.js";

export interface SpawnArgsInput {
  serverEntry: string;
  port: number;
  configDir: string;
  parentEnv: NodeJS.ProcessEnv;
}

export interface SpawnArgs {
  command: string;
  args: string[];
  opts: {
    cwd: string;
    env: Record<string, string>;
    stdio: Array<"ignore" | "pipe">;
  };
}

export const buildServerSpawn: (input: SpawnArgsInput) => SpawnArgs = helper as (input: SpawnArgsInput) => SpawnArgs;
