export const IPC = {
  PICK_FOLDER: "tc:pick-folder",
  GET_SERVER_PORT: "tc:get-server-port",
  GET_APP_VERSION: "tc:get-app-version",
  CHECK_FOR_UPDATES: "tc:check-for-updates",
  RESTART_TO_UPDATE: "tc:restart-to-update",
  OPEN_EXTERNAL: "tc:open-external",
  UPDATE_STATUS: "tc:update-status",
} as const;

export type UpdateStatus =
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "downloading" }
  | { state: "ready"; action: "restart" }
  | { state: "ready"; action: "open-link"; version: string; url: string }
  | { state: "error"; message: string };

export interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  applyUpdate: (status: UpdateStatus) => Promise<void>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
}
