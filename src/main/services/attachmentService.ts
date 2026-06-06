import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { dialog } from "electron";
import { lookup } from "mime-types";
import sanitize from "sanitize-filename";

import { createTranslator, type Translator } from "../../shared/i18n";
import type { AttachmentImportRequest, AttachmentPickImageRequest } from "../../shared/ipc";
import type { ResolvedLocale } from "../../shared/types";
import { dirnameRel, normalizePathRel, resolveWorkspacePath } from "../utils/filePaths";
import { WorkspaceIndexService } from "./workspaceIndexService";
import { WorkspaceService } from "./workspaceService";

export class AttachmentService {
  private readonly indexer = new WorkspaceIndexService();
  private readonly tr: Translator;

  constructor(private readonly workspaces: WorkspaceService, locale: ResolvedLocale = "zh-CN") {
    this.tr = createTranslator(locale);
  }

  async pickImage(request: AttachmentPickImageRequest): Promise<{ path?: string }> {
    this.workspaces.requireWorkspace(request.workspaceId);
    const result = await dialog.showOpenDialog({
      title: this.tr("选择图片"),
      properties: ["openFile"],
      filters: [
        {
          name: this.tr("图片"),
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]
        }
      ]
    });
    return result.canceled ? {} : { path: result.filePaths[0] };
  }

  async importAttachment(request: AttachmentImportRequest): Promise<{
    assetPathRel: string;
    markdown: string;
    mimeType: string;
    size: number;
  }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const sourcePath = request.source.path;
    const sourceStat = await stat(sourcePath);
    const safeName = sanitize(path.basename(sourcePath)) || `asset-${Date.now()}`;
    const documentPathRel = normalizePathRel(request.documentPathRel);
    const strategy = request.strategy ?? "workspace_assets";
    const targetDirRel =
      strategy === "document_assets"
        ? path.posix.join(dirnameRel(documentPathRel), `${path.posix.basename(documentPathRel, path.extname(documentPathRel))}.assets`)
        : "assets";
    const targetDir = resolveWorkspacePath(runtime.info.rootPath, targetDirRel);
    await mkdir(targetDir, { recursive: true });
    const assetPathRel = await uniqueAssetPath(runtime.info.rootPath, targetDirRel, safeName, this.tr);
    await copyFile(sourcePath, resolveWorkspacePath(runtime.info.rootPath, assetPathRel));
    await this.indexer.indexPathRel(runtime.info.rootPath, assetPathRel, runtime.db);

    const mimeType = lookup(sourcePath) || "application/octet-stream";
    const link = path.posix.relative(dirnameRel(documentPathRel) || ".", assetPathRel).replace(/^\.\//, "");
    const markdown = mimeType.startsWith("image/") ? `![${safeName}](${link})` : `[${safeName}](${link})`;

    return {
      assetPathRel,
      markdown,
      mimeType,
      size: sourceStat.size
    };
  }
}

async function uniqueAssetPath(rootPath: string, dirRel: string, fileName: string, tr: Translator): Promise<string> {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  for (let index = 0; index < 500; index += 1) {
    const candidateName = index === 0 ? fileName : `${stem}-${index}${ext}`;
    const candidate = normalizePathRel(path.posix.join(dirRel, candidateName));
    try {
      await stat(resolveWorkspacePath(rootPath, candidate));
    } catch {
      return candidate;
    }
  }
  throw new Error(tr("Could not allocate a unique attachment name"));
}
