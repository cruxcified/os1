/**
 * OS1 desktop app (Electron). Runs the same OS1 server in-process, bound to
 * this machine only, and shows it in a native window with a menu bar / tray
 * icon. Settings and memories live in the OS's per-user app data folder.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
  systemPreferences,
} from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(here, "..");
const PORT = 47231; // fixed, so the window's origin (and its saved preferences) is stable

// Must be set before the server modules load (they read these at import time).
process.env.OS1_APP_ROOT = appRoot;
process.env.OS1_DATA_DIR ??= app.getPath("userData");
if (app.isPackaged) process.env.NODE_ENV = "production";

// A companion app should be able to speak without a click first.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverUrl = "";
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(start).catch((err) => {
    console.error(err);
    app.exit(1);
  });
}

async function start() {
  const { startServer } = await import("../server/index.ts");
  let server;
  try {
    server = await startServer({ host: "127.0.0.1", port: PORT });
  } catch {
    server = await startServer({ host: "127.0.0.1", port: 0 }); // port taken: any free one
  }
  serverUrl = server.url;
  app.on("will-quit", () => void server.close());

  // Only our own page may use the microphone.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === "media" && wc.getURL().startsWith(serverUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return permission === "media" && origin.startsWith(serverUrl);
  });
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone");
  }

  buildMenu();
  createTray();
  createWindow();

  app.on("activate", () => showWindow());
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 360,
    minHeight: 520,
    title: "OS1",
    backgroundColor: "#d1684e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    icon: path.join(appRoot, "build", "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // Keep listening and talking while the window is in the background.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  void win.loadURL(serverUrl);

  // Links open in the real browser, never inside OS1.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Closing the window hides it (OS1 keeps running in the menu bar / tray).
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win?.hide();
    }
  });
}

function showWindow() {
  if (!win) return createWindow();
  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(appRoot, "build", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("OS1");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open OS1", click: showWindow },
      { type: "separator" },
      {
        label: "Open Data Folder",
        click: () => void shell.openPath(process.env.OS1_DATA_DIR!),
      },
      { type: "separator" },
      { label: "Quit OS1", role: "quit" },
    ]),
  );
  tray.on("click", showWindow);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Open Data Folder",
            click: () => void shell.openPath(process.env.OS1_DATA_DIR!),
          },
        ],
      },
    ]),
  );
}

app.on("before-quit", () => {
  quitting = true;
});

// On Windows/Linux, OS1 lives in the tray; quitting is explicit.
app.on("window-all-closed", () => {});
