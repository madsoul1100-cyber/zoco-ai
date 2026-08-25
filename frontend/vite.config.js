import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["voice.my-leader.in"],
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/webhooks": "http://127.0.0.1:8787",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["voice.my-leader.in"],
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/webhooks": "http://127.0.0.1:8787",
    },
  },
});
