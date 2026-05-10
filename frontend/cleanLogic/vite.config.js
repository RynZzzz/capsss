// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendProxy = {
  target: "http://localhost:8000",
  changeOrigin: true,
};

const proxyRules = {
  "/api":    backendProxy,
  "/files":  backendProxy,
  "/file":   backendProxy,
  // Only proxy POST to /upload — GET is the React Router upload page
  "/upload": {
    ...backendProxy,
    bypass: (req) => {
      if (req.method !== "POST") return "/index.html";
    },
  },
  "/export": backendProxy,
  "/save":   backendProxy,
};

export default defineConfig({
  plugins: [react()],
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx",
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    open: false,
    hmr: true,
    proxy: proxyRules,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: proxyRules,
    allowedHosts: true,
  },
});
