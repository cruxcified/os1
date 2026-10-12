import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// The app is served by the OS1 server (server/index.ts), which embeds Vite in dev.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "./src"),
    },
  },
  build: {
    target: "es2022",
    // three.js is most of the main bundle; the voice-activity model loads on demand.
    chunkSizeWarningLimit: 1000,
  },
});
