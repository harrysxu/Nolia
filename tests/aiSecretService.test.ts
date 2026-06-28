import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const safeStorageMock = vi.hoisted(() => ({
  encryptionAvailable: true,
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, "utf8")),
  decryptString: vi.fn((value: Buffer) => value.toString("utf8").replace(/^encrypted:/, "")),
  getSelectedStorageBackend: vi.fn(() => "basic_text")
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageMock.encryptionAvailable,
    encryptString: safeStorageMock.encryptString,
    decryptString: safeStorageMock.decryptString,
    getSelectedStorageBackend: safeStorageMock.getSelectedStorageBackend
  }
}));

const tempDirs: string[] = [];

describe("AiSecretService", () => {
  afterEach(async () => {
    safeStorageMock.encryptionAvailable = true;
    safeStorageMock.encryptString.mockClear();
    safeStorageMock.decryptString.mockClear();
    safeStorageMock.getSelectedStorageBackend.mockClear();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("saves and reads secrets from a local fallback when secure storage is unavailable", async () => {
    safeStorageMock.encryptionAvailable = false;
    const { AiSecretService } = await import("../src/main/ai/security/secretService");
    const service = await createService(AiSecretService);

    await service.set("provider-1", "secret-key");

    expect(service.backend()).toBe("local-file");
    expect(service.has("provider-1")).toBe(true);
    expect(service.get("provider-1")).toBe("secret-key");
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled();

    const raw = await readFile(path.join(tempDirs.at(-1) ?? "", "ai-secrets.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      items: {
        "provider-1": {
          localPlainText: "secret-key"
        }
      }
    });
  });

  it("does not report an unreadable encrypted secret as present", async () => {
    const { AiSecretService } = await import("../src/main/ai/security/secretService");
    const service = await createService(AiSecretService);
    await service.set("provider-1", "secret-key");

    safeStorageMock.encryptionAvailable = false;

    expect(service.get("provider-1")).toBeUndefined();
    expect(service.has("provider-1")).toBe(false);
  });

  it("does not keep a stale local copy after saving with secure storage again", async () => {
    safeStorageMock.encryptionAvailable = false;
    const { AiSecretService } = await import("../src/main/ai/security/secretService");
    const service = await createService(AiSecretService);
    await service.set("provider-1", "secret-key");

    safeStorageMock.encryptionAvailable = true;
    await service.set("provider-1", "new-secret");
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error("decrypt failed");
    });

    expect(service.get("provider-1")).toBeUndefined();
  });
});

type AiSecretServiceCtor = new (userDataPath: string) => import("../src/main/ai/security/secretService").AiSecretService;

async function createService(Service: AiSecretServiceCtor): Promise<import("../src/main/ai/security/secretService").AiSecretService> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nolia-secret-test-"));
  tempDirs.push(tempDir);
  const service = new Service(tempDir);
  await service.init();
  return service;
}
