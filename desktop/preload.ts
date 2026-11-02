/**
 * The only bridge between the OS1 page and the desktop shell: the tray menu
 * and global shortcuts send commands in, and the page reports its state out
 * so the tray can show it. Nothing else from Electron is exposed.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopCommand, DesktopState } from "../shared/desktop.ts";

const bridge: DesktopBridge = {
  onCommand(callback) {
    const listener = (_event: unknown, command: DesktopCommand) => callback(command);
    ipcRenderer.on("os1:command", listener);
    return () => ipcRenderer.off("os1:command", listener);
  },
  reportState(state: DesktopState) {
    ipcRenderer.send("os1:state", state);
  },
};

contextBridge.exposeInMainWorld("os1Desktop", bridge);
