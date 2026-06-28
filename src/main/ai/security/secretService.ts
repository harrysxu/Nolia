import { chmod, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

interface SecretState {
  version: 1;
  items: Record<string, SecretItem | undefined>;
}

interface SecretItem {
  encrypted?: string;
  localPlainText?: string;
}

const emptyState: SecretState = { version: 1, items: {} };
const localFileBackend = "local-file";

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
    return this.isSecureStorageAvailable() || Boolean(this.statePath);
  }

  backend(): string | undefined {
    if (!this.isSecureStorageAvailable()) {
      return localFileBackend;
    }
    try {
      return safeStorage.getSelectedStorageBackend();
    } catch {
      return undefined;
    }
  }

  has(secretId: string): boolean {
    return Boolean(this.get(secretId));
  }

  get(secretId: string): string | undefined {
    const item = this.state.items[secretId];
    if (!item) {
      return undefined;
    }
    if (item.encrypted && this.isSecureStorageAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(item.encrypted, "base64"));
      } catch {
        return item.localPlainText;
      }
    }
    return item.localPlainText;
  }

  async set(secretId: string, apiKey: string): Promise<void> {
    const cleanApiKey = apiKey.trim();
    if (!cleanApiKey) {
      return;
    }
    let item: SecretItem;
    if (this.isSecureStorageAvailable()) {
      const encrypted = safeStorage.encryptString(cleanApiKey);
      item = { encrypted: encrypted.toString("base64") };
    } else {
      item = { localPlainText: cleanApiKey };
    }
    this.state = {
      version: 1,
      items: {
        ...this.state.items,
        [secretId]: item
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

  private isSecureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.statePath, 0o600).catch(() => undefined);
  }
}
