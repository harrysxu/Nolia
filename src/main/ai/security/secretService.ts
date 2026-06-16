import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

interface SecretState {
  version: 1;
  items: Record<string, { encrypted: string } | undefined>;
}

const emptyState: SecretState = { version: 1, items: {} };

export class AiSecretService {
  private readonly statePath: string;
  private state: SecretState = emptyState;

  constructor(userDataPath: string) {
    this.statePath = path.join(userDataPath, "ai-secrets.json");
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SecretState>;
      this.state = {
        version: 1,
        items: parsed.items && typeof parsed.items === "object" ? parsed.items : {}
      };
    } catch {
      await this.persist();
    }
  }

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  backend(): string | undefined {
    try {
      return safeStorage.getSelectedStorageBackend();
    } catch {
      return undefined;
    }
  }

  has(secretId: string): boolean {
    return Boolean(this.state.items[secretId]?.encrypted);
  }

  get(secretId: string): string | undefined {
    const encrypted = this.state.items[secretId]?.encrypted;
    if (!encrypted || !this.isAvailable()) {
      return undefined;
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return undefined;
    }
  }

  async set(secretId: string, apiKey: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("Secret storage is not available");
    }
    const encrypted = safeStorage.encryptString(apiKey);
    this.state = {
      version: 1,
      items: {
        ...this.state.items,
        [secretId]: { encrypted: encrypted.toString("base64") }
      }
    };
    await this.persist();
  }

  async clear(secretId: string): Promise<void> {
    const next = { ...this.state.items };
    delete next[secretId];
    this.state = { version: 1, items: next };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}
