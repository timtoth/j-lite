export const IPC = {
  PICK_FOLDER: "tc:pick-folder",
  GET_SERVER_PORT: "tc:get-server-port",
} as const;

export interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
}
