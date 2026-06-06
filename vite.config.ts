import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "nolia-file-protocol-html",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin(?=[\s>])/g, "");
      }
    }
  ],
  root: ".",
  base: "./",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  }
});
