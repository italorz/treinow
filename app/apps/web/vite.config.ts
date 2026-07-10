import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Treinow", short_name: "Treinow", description: "Seu treino inteligente",
        theme_color: "#0b1020", background_color: "#f5f7fb", display: "standalone",
        start_url: "/", icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [{ urlPattern: /^.*\/v1\/.*/i, handler: "NetworkOnly" }]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("node_modules/react") || id.includes("@tanstack")) return "react-vendor";
        }
      }
    }
  },
  server: { proxy: { "/v1": "http://localhost:3000", "/health": "http://localhost:3000" } }
});
