export type UpdateStatus =
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "downloading" }
  | { state: "ready"; action: "restart" }
  | { state: "ready"; action: "open-link"; version: string; url: string }
  | { state: "error"; message: string };

interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  applyUpdate: (status: UpdateStatus) => Promise<void>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    tc?: TcApi;
  }
}

export {};

