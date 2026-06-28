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
        codeSplitting: true,
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("lowlight")) {
              return "editor-wysiwyg-vendor";
            }
            if (id.includes("@codemirror") || id.includes("@lezer") || id.includes("@uiw/react-codemirror")) {
              return "editor-source-vendor";
            }
            if (id.includes("mermaid") || id.includes("d3")) {
              return "preview-diagrams-vendor";
            }
            if (id.includes("katex")) {
              return "preview-math-vendor";
            }
            if (id.includes("@ai-sdk") || id.includes("/ai/")) {
              return "ai-vendor";
            }
            return "vendor";
          }
          if (id.includes("/src/renderer/components/WysiwygEditor")) {
            return "editor-wysiwyg";
          }
          if (id.includes("/src/renderer/components/SourceEditor") || id.includes("/src/renderer/components/TextResourceEditor")) {
            return "editor-source";
          }
          if (id.includes("/src/renderer/components/MarkdownPreview")) {
            return "preview-markdown";
          }
          if (id.includes("/src/renderer/ai/")) {
            return "ai-ui";
          }
        }
      }
    }
  }
});
