import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { config } from "./config.ts";
import { MemoryStore } from "./memory.ts";
import { Session } from "./session.ts";
import { createStt } from "./stt/index.ts";
import { createTts } from "./tts/index.ts";

const root = process.cwd();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

// Voice-activity-detection model + onnxruntime wasm, served locally so the
// app works on a LAN or offline-ish device without a CDN.
const VENDOR: Record<string, string> = {
  "/vendor/vad/": path.join(root, "node_modules/@ricky0123/vad-web/dist/"),
  "/vendor/ort/": path.join(root, "node_modules/onnxruntime-web/dist/"),
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

async function main() {
  const memory = await new MemoryStore().load();
  console.log(`[os1] brain: ${config.model} (effort ${config.effort}) | ears: ${config.stt} | voice: ${config.tts}/${config.voice}`);
  const [stt, tts] = await Promise.all([createStt(), createTts()]);

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

    for (const [prefix, dir] of Object.entries(VENDOR)) {
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
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
  }

  const sessions = new Set<Session>();
  // noServer + manual routing so Vite's HMR socket on the same port keeps working.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    const session = new Session(ws, { memory, stt, tts }, () => {
      for (const s of sessions) s.send({ type: "memory_updated" });
    });
    sessions.add(session);
    ws.on("close", () => sessions.delete(session));
  });

  server.listen(config.port, config.host, () => {
    console.log(`[os1] listening on http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
