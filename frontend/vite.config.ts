import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:3100";
const shouldServeSpaFallback = (url: string | undefined) => {
  if (!url) {
    return false;
  }

  const pathname = url.split("?")[0] ?? "";
  if (!pathname || pathname === "/" || pathname === "/index.html") {
    return false;
  }
  if (pathname.startsWith("/api")) {
    return false;
  }

  return !pathname.includes(".");
};

const spaFallbackPlugin = () => ({
  name: "corepos-spa-fallback",
  configureServer(server: {
    middlewares: { use: (handler: (req: { method?: string; url?: string }, _res: unknown, next: () => void) => void) => void };
  }) {
    server.middlewares.use((req, _res, next) => {
      if ((req.method === "GET" || req.method === "HEAD") && shouldServeSpaFallback(req.url)) {
        req.url = "/index.html";
      }
      next();
    });
  },
  configurePreviewServer(server: {
    middlewares: { use: (handler: (req: { method?: string; url?: string }, _res: unknown, next: () => void) => void) => void };
  }) {
    server.middlewares.use((req, _res, next) => {
      if ((req.method === "GET" || req.method === "HEAD") && shouldServeSpaFallback(req.url)) {
        req.url = "/index.html";
      }
      next();
    });
  },
});

export default defineConfig({
  appType: "spa",
  plugins: [react(), spaFallbackPlugin()],
  preview: {
    port: 5173,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  server: {
    allowedHosts: ["capture.claphamcycle.com"],
    fs: {
      strict: false,
    },
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
