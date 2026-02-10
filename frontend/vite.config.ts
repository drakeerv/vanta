import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 3001,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
