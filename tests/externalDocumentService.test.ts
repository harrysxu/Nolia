import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalDocumentService } from "../src/main/services/externalDocumentService";
import { SettingsService } from "../src/main/services/settingsService";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("external document service", () => {
  it("preserves UTF-8 BOM and CRLF while saving atomically", async () => {
    const { root, service } = await createService();
    const filePath = path.join(root, "note.md");
    await writeFile(filePath, Buffer.from("\ufeff# Note\r\n\r\nOriginal\r\n", "utf8"));

    const opened = await service.read(filePath);
    expect(opened).toMatchObject({ bom: true, eol: "crlf", readonly: false, encodingSupported: true });

    const result = await service.save({
      filePath,
      content: "# Note\n\nUpdated\n",
      baseHash: opened.sha256,
      revision: 2,
      mode: "normal",
      bom: opened.bom,
      eol: opened.eol
    });
    expect(result.status).toBe("saved");
    const saved = await readFile(filePath);
    expect([...saved.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(saved.toString("utf8")).toBe("\ufeff# Note\r\n\r\nUpdated\r\n");
    service.close();
  });

  it("returns a structured conflict without overwriting disk changes", async () => {
    const { root, service } = await createService();
    const filePath = path.join(root, "conflict.md");
    await writeFile(filePath, "# Original\n", "utf8");
    const opened = await service.read(filePath);
    await writeFile(filePath, "# Changed elsewhere\n", "utf8");

    const result = await service.save({ filePath, content: "# Nolia edit\n", baseHash: opened.sha256, revision: 3, mode: "normal" });
    expect(result).toMatchObject({ status: "conflict", revision: 3, conflict: { diskContent: "# Changed elsewhere\n" } });
    expect(await readFile(filePath, "utf8")).toBe("# Changed elsewhere\n");
    service.close();
  });

  it("keeps unsupported encodings read-only at the main-process save boundary", async () => {
    const { root, service } = await createService();
    const filePath = path.join(root, "legacy.md");
    const original = Buffer.from([0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x4e, 0x00]);
    await writeFile(filePath, original);

    const opened = await service.read(filePath);
    expect(opened).toMatchObject({ readonly: true, encodingSupported: false });

    const result = await service.save({
      filePath,
      content: "# Replaced\n",
      baseHash: opened.sha256,
      revision: 1,
      mode: "normal"
    });
    expect(result.status).toBe("readonly");
    expect(await readFile(filePath)).toEqual(original);
    service.close();
  });

  it("reports a missing source without recreating it during normal save", async () => {
    const { root, service } = await createService();
    const filePath = path.join(root, "missing.md");
    await writeFile(filePath, "# Original\n", "utf8");
    const opened = await service.read(filePath);
    await rm(filePath);

    const result = await service.save({
      filePath,
      content: "# Recreated silently\n",
      baseHash: opened.sha256,
      revision: 2,
      mode: "normal"
    });
    expect(result.status).toBe("missing");
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    service.close();
  });

  it("stores drafts outside the source folder and restores their metadata", async () => {
    const { root, userData, service } = await createService();
    const filePath = path.join(root, "draft.md");
    await writeFile(filePath, "# Draft\n", "utf8");
    const opened = await service.read(filePath);
    await service.writeDraft({ filePath, content: "# Recovered\n", baseHash: opened.sha256, revision: 4 });

    expect(await service.readDraft(filePath)).toMatchObject({ filePath, content: "# Recovered\n", revision: 4 });
    expect((await readFile(path.join(userData, "external-drafts", `${await draftFileName(filePath)}`), "utf8"))).toContain("Recovered");
    service.close();
  });

  it("limits folder sessions to Markdown and rejects symlink link escapes", async () => {
    const { root, service } = await createService();
    const outside = await makeTempDir();
    const filePath = path.join(root, "index.md");
    await mkdir(path.join(root, "notes"));
    await writeFile(filePath, "[Child](notes/child.md)\n", "utf8");
    await writeFile(path.join(root, "notes", "child.md"), "# Child\n", "utf8");
    await writeFile(path.join(root, "ignored.txt"), "ignored", "utf8");
    await writeFile(path.join(outside, "secret.md"), "# Secret\n", "utf8");
    await symlink(path.join(outside, "secret.md"), path.join(root, "escape.md"));

    const session = await service.openFolder(filePath);
    expect(JSON.stringify(session.nodes)).toContain("child.md");
    expect(JSON.stringify(session.nodes)).not.toContain("ignored.txt");
    expect(JSON.stringify(session.nodes)).not.toContain("escape.md");
    await expect(service.resolveLink(filePath, "escape.md", session.id)).rejects.toThrow("escapes the authorized folder");
    service.close();
  });
});

async function createService(): Promise<{ root: string; userData: string; service: ExternalDocumentService }> {
  const root = await makeTempDir();
  const userData = await makeTempDir();
  const settings = new SettingsService(userData);
  await settings.init();
  const service = new ExternalDocumentService(userData, settings);
  await service.init();
  return { root, userData, service };
}

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nolia-external-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function draftFileName(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return `${createHash("sha256").update(path.resolve(filePath)).digest("hex")}.json`;
}
