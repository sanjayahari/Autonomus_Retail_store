// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy REST API calls to cloud-api during development
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Proxy WebSocket to cloud-api
      "/ws": {
        target:  "ws://localhost:3001",
        ws:      true,
      },
    },
  },
  build: {
    outDir:        "dist",
    sourcemap:     true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ["react", "react-dom"],
          recharts: ["recharts"],
        },
      },
    },
  },
  define: {
    // Expose git commit hash to the dashboard footer
    __GIT_HASH__: JSON.stringify(process.env.GIT_HASH ?? "dev"),
  },
});
