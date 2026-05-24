import { contextBridge, ipcRenderer } from "electron";
import { IPC, TcApi } from "./types";

const api: TcApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),
  getServerPort: () => ipcRenderer.invoke(IPC.GET_SERVER_PORT),
};

contextBridge.exposeInMainWorld("tc", api);
