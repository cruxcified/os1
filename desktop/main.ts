/**
 * OS1 desktop app (Electron). Runs the same OS1 server in-process, bound to
 * this machine only, and shows it in a native window with a menu bar / tray
 * icon. Settings and memories live in the OS's per-user app data folder.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
  systemPreferences,
  type Rectangle,
} from "electron";
import type { DesktopCommand, DesktopState } from "../shared/desktop.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(here, "..");
const PORT = 47231; // fixed, so the window's origin (and its saved preferences) is stable

// Must be set before the server modules load (they read these at import time).
process.env.OS1_APP_ROOT = appRoot;
process.env.OS1_DATA_DIR ??= app.getPath("userData");
if (app.isPackaged) process.env.NODE_ENV = "production";

// A companion app should be able to speak without a click first.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Mute/unmute from anywhere, and show/hide the window.
const SHORTCUTS = {
  mic: "CommandOrControl+Shift+Space",
  window: "CommandOrControl+Shift+O",
};

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverUrl = "";
let quitting = false;
let state: DesktopState = { phase: "connecting", micOn: true, quiet: false, agentState: "idle" };

/** Desktop-only preferences (window placement, keep on top), next to settings.json. */
interface DesktopPrefs {
  bounds?: Rectangle;
  keepOnTop?: boolean;
}
const prefsFile = () => path.join(process.env.OS1_DATA_DIR!, "desktop.json");
function readPrefs(): DesktopPrefs {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), "utf8")) as DesktopPrefs;
  } catch {
    return {};
  }
}
function savePrefs(patch: DesktopPrefs) {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...patch }, null, 2));
  } catch (err) {
    console.warn("[desktop] couldn't save preferences:", err);
  }
}

/** Started by "Open at login": stay in the tray instead of popping up a window. */
const startedHidden =
  process.argv.includes("--hidden") ||
  (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);

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

  ipcMain.on("os1:state", (event, next: DesktopState) => {
    if (event.sender !== win?.webContents) return;
    state = next;
    updateTray();
  });

  buildMenu();
  createTray();
  createWindow();
  registerShortcuts();

  app.on("activate", () => showWindow());
}

function command(cmd: DesktopCommand) {
  win?.webContents.send("os1:command", cmd);
}

function registerShortcuts() {
  const ok = [
    globalShortcut.register(SHORTCUTS.mic, () => {
      // Waking needs the window up once (mic permission, audio); muting doesn't.
      if (state.phase === "asleep") showWindow();
      command("toggle-mic");
    }),
    globalShortcut.register(SHORTCUTS.window, () => {
      if (win?.isVisible() && win.isFocused()) win.hide();
      else showWindow();
    }),
  ];
  if (ok.includes(false)) console.warn("[desktop] a global shortcut is taken by another app");
}

function createWindow() {
  const prefs = readPrefs();
  win = new BrowserWindow({
    width: 480,
    height: 760,
    ...prefs.bounds,
    alwaysOnTop: !!prefs.keepOnTop,
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
      preload: path.join(appRoot, "dist-electron", "preload.cjs"),
    },
  });
  if (prefs.keepOnTop) win.setAlwaysOnTop(true, "floating");
  if (!startedHidden) win.once("ready-to-show", () => win?.show());

  // Remember where the window was.
  const saveBounds = () => {
    if (win && !win.isMinimized() && !win.isFullScreen()) savePrefs({ bounds: win.getBounds() });
  };
  win.on("moved", saveBounds);
  win.on("resized", saveBounds);
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
  tray.on("click", showWindow);
  updateTray();
}

function statusLine(): string {
  if (state.phase !== "awake") return state.phase === "waking" ? "Waking up…" : "Asleep";
  if (!state.micOn) return "Mic muted";
  return { idle: "Listening", listening: "Listening", thinking: "Thinking…", speaking: "Speaking" }[
    state.agentState
  ];
}

function updateTray() {
  if (!tray) return;
  const status = statusLine();
  tray.setToolTip(`OS1: ${status}`);
  const keepOnTop = !!readPrefs().keepOnTop;
  const atLogin = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: "separator" },
      { label: "Open OS1", accelerator: SHORTCUTS.window, click: showWindow },
      {
        label: "Mute Microphone",
        type: "checkbox",
        checked: state.phase === "awake" && !state.micOn,
        enabled: state.phase === "awake",
        accelerator: SHORTCUTS.mic,
        click: () => command("toggle-mic"),
      },
      {
        label: "Quiet Mode (captions only)",
        type: "checkbox",
        checked: state.quiet,
        click: () => command("toggle-quiet"),
      },
      { type: "separator" },
      {
        label: "Keep Window on Top",
        type: "checkbox",
        checked: keepOnTop,
        click: () => {
          savePrefs({ keepOnTop: !keepOnTop });
          win?.setAlwaysOnTop(!keepOnTop, "floating");
          updateTray();
        },
      },
      {
        label: "Open at Login",
        type: "checkbox",
        checked: atLogin,
        click: () => {
          app.setLoginItemSettings({ openAtLogin: !atLogin, args: ["--hidden"] });
          updateTray();
        },
      },
      {
        label: "Open Data Folder",
        click: () => void shell.openPath(process.env.OS1_DATA_DIR!),
      },
      { type: "separator" },
      { label: "Quit OS1", role: "quit" },
    ]),
  );
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

app.on("will-quit", () => globalShortcut.unregisterAll());

// On Windows/Linux, OS1 lives in the tray; quitting is explicit.
app.on("window-all-closed", () => {});
