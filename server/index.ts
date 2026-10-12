import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import {
  config,
  readSettings,
  writeSettings,
  SECRET_SETTINGS,
  type Settings,
} from "./config.ts";
import { MemoryStore } from "./memory.ts";
import { Providers } from "./providers.ts";
import { Session } from "./session.ts";
import type { SettingsView } from "../shared/protocol.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

function serveFile(res: http.ServerResponse, file: string): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
  return true;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("Body too large");
  }
  return body;
}

function isLoopback(req: http.IncomingMessage) {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function settingsView(): SettingsView {
  const s = readSettings();
  return {
    keys: {
      anthropicKey: !!config.keys.anthropic,
      deepgramKey: !!config.keys.deepgram,
      elevenlabsKey: !!config.keys.elevenlabs,
      openaiKey: !!config.keys.openai,
    },
    stt: s.stt ?? "auto",
    tts: s.tts ?? "auto",
    voice: s.voice ?? "",
    userName: s.userName ?? config.userName ?? "",
    active: { stt: config.stt, tts: config.tts, voice: config.voice },
  };
}

/** Applies a settings change from the app. Secrets sent as "" are left unchanged. */
function mergeSettings(patch: Settings): Settings {
  const next: Settings = { ...readSettings() };
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    const value = patch[key];
    if (typeof value !== "string") continue;
    if ((SECRET_SETTINGS as readonly string[]).includes(key) && value === "") continue;
    (next as Record<string, string>)[key] = value === "__clear__" ? "" : value.trim();
  }
  return next;
}

export interface StartOptions {
  port?: number;
  host?: string;
}

/** Starts OS1: the web app, the voice WebSocket, and the memory and settings APIs. */
export async function startServer(options: StartOptions = {}) {
  const root = config.appRoot;
  // Voice-activity-detection model + onnxruntime wasm, served locally so the
  // app works offline-ish and on a LAN without a CDN.
  const vendor: Record<string, string> = {
    "/vendor/vad/": path.join(root, "node_modules/@ricky0123/vad-web/dist/"),
    "/vendor/ort/": path.join(root, "node_modules/onnxruntime-web/dist/"),
  };

  const memory = await new MemoryStore().load();
  const providers = new Providers();
  const sessions = new Set<Session>();
  console.log(
    `[os1] brain: ${config.model} (effort ${config.effort}) | ears: ${config.stt} | voice: ${config.tts}/${config.voice}`,
  );

  let vite: import("vite").ViteDevServer | null = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/memories" && req.method === "GET") {
      return json(res, 200, { items: memory.list() });
    }
    const del = url.pathname.match(/^\/api\/memories\/([\w-]+)$/);
    if (del && req.method === "DELETE") {
      const ok = await memory.remove(del[1]);
      return json(res, ok ? 200 : 404, { ok });
    }

    if (url.pathname === "/api/settings") {
      // API keys can only be read or changed from this machine.
      if (!isLoopback(req)) return json(res, 403, { error: "Settings are only available locally" });
      if (req.method === "GET") return json(res, 200, settingsView());
      if (req.method === "POST") {
        let patch: Settings;
        try {
          patch = JSON.parse(await readBody(req)) as Settings;
        } catch {
          return json(res, 400, { error: "Invalid JSON" });
        }
        writeSettings(mergeSettings(patch));
        providers.reload();
        for (const s of sessions) s.sendInfo();
        console.log(`[os1] settings saved | ears: ${config.stt} | voice: ${config.tts}/${config.voice}`);
        return json(res, 200, settingsView());
      }
    }

    for (const [prefix, dir] of Object.entries(vendor)) {
      if (url.pathname.startsWith(prefix)) {
        const file = path.join(dir, path.normalize(url.pathname.slice(prefix.length)));
        if (file.startsWith(dir) && serveFile(res, file)) return;
        res.writeHead(404).end();
        return;
      }
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = path.join(root, "dist");
    const file = path.join(dist, path.normalize(url.pathname));
    if (file.startsWith(dist) && serveFile(res, file)) return;
    if (!serveFile(res, path.join(dist, "index.html"))) {
      res.writeHead(404).end("Run `npm run build` first.");
    }
  });

  if (!config.isProduction) {
    // Dev: Vite runs inside this server (one process, one port, shared HMR socket).
    vite = await (await import("vite")).createServer({
      root,
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
  }

  // noServer + manual routing so Vite's HMR socket on the same port keeps working.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    const session = new Session(ws, { memory, providers }, () => {
      for (const s of sessions) s.send({ type: "memory_updated" });
    });
    sessions.add(session);
    ws.on("close", () => sessions.delete(session));
  });

  const host = options.host ?? config.host;
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? config.port, host, () => {
      server.off("error", reject);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (options.port ?? config.port));
    });
  });
  console.log(`[os1] listening on http://${host}:${port}`);

  return {
    port,
    url: `http://${host}:${port}`,
    async close() {
      for (const client of wss.clients) client.terminate();
      await vite?.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Run directly (`tsx server/index.ts`), as opposed to imported by the desktop app.
if (!process.versions.electron && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
