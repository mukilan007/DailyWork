import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Use a port distinct from todo-app's `serve` (5173). `strictPort` makes the
    // dev server fail loudly if 5174 is taken instead of silently picking another,
    // so you never end up looking at the wrong app by accident.
    port: 5174,
    strictPort: true,
  },
});
