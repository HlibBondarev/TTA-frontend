import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://localhost:5001",
        changeOrigin: true,
        secure: false, // Disables SSL certificate verification for local ASP.NET HTTPS
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800, // Increase warning threshold for large vendor chunks
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@auth0")) {
              return "auth";
            }
            if (id.includes("dexie")) {
              return "db";
            }
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("@reduxjs") ||
              id.includes("react-redux")
            ) {
              return "vendor";
            }
          }
        },
      },
    },
  },
});
