import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Windows tools can atomically replace image/icon assets via .~tmp files.
    // Chokidar may receive an EBUSY event while those files are being renamed;
    // they are not source assets and should never be watched or compiled.
    watch: {
      ignored: ["**/*.~tmp", "**/*~tmp", "**/*.swp"],
    },
  },
});
