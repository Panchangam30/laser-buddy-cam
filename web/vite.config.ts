import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Keys live on the API server, never in the browser bundle.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
