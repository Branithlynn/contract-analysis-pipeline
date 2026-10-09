import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy here and nginx in prod keep the api on the same origin, so no CORS anywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
