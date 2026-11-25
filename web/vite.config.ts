import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** `CSL_API` points the dev server at a running `csl serve`; the default is the usual port. */
const api = process.env["CSL_API"] ?? "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": api, "/engine": api } },
  build: { outDir: "dist", sourcemap: false },
});
