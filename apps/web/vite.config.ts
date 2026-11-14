import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Astronaut Health Monitor",
        short_name: "AstroHealth",
        description: "Onboard health and cabin monitoring for astronauts",
        theme_color: "#1d1b2f",
        background_color: "#1d1b2f",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
    }),
  ],
  server: { port: 5173 },
});
