import { contextBridge, ipcRenderer } from "electron";
import { IPC, TcApi, UpdateStatus } from "./types";

const api: TcApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),
  getServerPort: () => ipcRenderer.invoke(IPC.GET_SERVER_PORT),
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION),
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  applyUpdate: (status: UpdateStatus) => {
    if (status.state === "ready" && status.action === "restart") {
      return ipcRenderer.invoke(IPC.RESTART_TO_UPDATE);
    }
    if (status.state === "ready" && status.action === "open-link") {
      return ipcRenderer.invoke(IPC.OPEN_EXTERNAL, status.url);
    }
    return Promise.resolve();
  },
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_event: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IPC.UPDATE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, listener);
  },
};

contextBridge.exposeInMainWorld("tc", api);
