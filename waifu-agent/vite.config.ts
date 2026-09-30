import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  clearScreen: false,
  define: {
    __WAIFU_MODE__: JSON.stringify(
      command === "build"
        ? process.env.VITE_WAIFU_MODE || "user"
        : process.env.VITE_WAIFU_MODE || "dev"
    ),
  },
  server: {
    port: 1420,
    watch: {
      ignored: ['**/src-tauri/**'],
      usePolling: true,
      interval: 1000
    },
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari14",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));

