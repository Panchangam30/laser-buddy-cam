import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to the LAN so the phone remote can reach it. Only the web port is
    // exposed: /api is proxied from here to the API on localhost, so the API
    // and the vision service stay off the network.
    host: true,
    // Keys live on the API server, never in the browser bundle.
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
