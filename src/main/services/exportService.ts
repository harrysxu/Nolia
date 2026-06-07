import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, type SaveDialogOptions } from "electron";

import type { ExportDocumentRequest } from "../../shared/ipc";
import { APP_NAME, WORKSPACE_DIRECTORIES, WORKSPACE_META_DIR } from "../../shared/constants";
import { createTranslator, type Translator } from "../../shared/i18n";
import { renderMarkdownToHtml } from "../../shared/markdown";
import type { ResolvedLocale } from "../../shared/types";
import { normalizePathRel, resolveWorkspacePath } from "../utils/filePaths";
import { WorkspaceService } from "./workspaceService";

export class ExportService {
  private readonly tr: Translator;

  constructor(private readonly workspaces: WorkspaceService, locale: ResolvedLocale = "zh-CN") {
    this.tr = createTranslator(locale);
  }

  async exportDocument(request: ExportDocumentRequest, parentWindow?: BrowserWindow): Promise<{
    status: "completed" | "failed";
    outputPath?: string;
    warnings: string[];
  }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizePathRel(request.pathRel);
    const sourcePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    const markdown = await readFile(sourcePath, "utf8");
    const defaultPath = path.join(
      runtime.info.rootPath,
      `${path.basename(normalized, path.extname(normalized))}.${request.format === "markdown" ? "md" : request.format}`
    );
    const options: SaveDialogOptions = {
      title: this.tr("导出文档对话框"),
      defaultPath
    };
    const result = parentWindow && !parentWindow.isDestroyed() ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { status: "failed", warnings: [this.tr("已取消导出")] };
    }

    if (request.format === "markdown") {
      await writeFile(result.filePath, markdown, "utf8");
      return { status: "completed", outputPath: result.filePath, warnings: [] };
    }

    const html = await createExportHtml(markdown, path.basename(normalized), request.themeId);
    if (request.format === "html") {
      await writeFile(result.filePath, html, "utf8");
      return { status: "completed", outputPath: result.filePath, warnings: [] };
    }

    const tempDir = path.join(runtime.info.rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.cache);
    await mkdir(tempDir, { recursive: true });
    const tempHtml = path.join(tempDir, `export-${Date.now()}.html`);
    await writeFile(tempHtml, html, "utf8");
    const pdf = await printHtmlToPdf(tempHtml);
    await writeFile(result.filePath, pdf);
    return { status: "completed", outputPath: result.filePath, warnings: [] };
  }
}

async function createExportHtml(markdown: string, title: string, themeId?: string): Promise<string> {
  const body = await renderMarkdownToHtml(markdown);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="generator" content="${APP_NAME}" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 48px auto;
      max-width: 820px;
      font: 16px/1.65 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      color: ${themeId === "dark" ? "#e8e6e3" : "#222"};
      background: ${themeId === "dark" ? "#171717" : "#fff"};
    }
    pre, code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; }
    pre { padding: 16px; overflow: auto; background: rgba(127,127,127,.12); border-radius: 8px; }
    blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #8ea1b2; color: #667; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid rgba(127,127,127,.35); padding: 6px 8px; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

async function printHtmlToPdf(htmlPath: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    await window.loadFile(htmlPath);
    return await window.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4"
    });
  } finally {
    window.destroy();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
