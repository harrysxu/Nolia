import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

import type { AiCredentialSummary } from "../../../shared/ai";

interface StoredCredential extends AiCredentialSummary {
  encoding: "safe-storage" | "base64";
  value: string;
}

interface CredentialState {
  credentials: StoredCredential[];
}

export class CredentialService {
  private readonly credentialsPath: string;
  private state: CredentialState = { credentials: [] };

  constructor(userDataPath: string) {
    this.credentialsPath = path.join(userDataPath, "ai-credentials.json");
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.credentialsPath), { recursive: true });
    try {
      const raw = await readFile(this.credentialsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CredentialState>;
      this.state = {
        credentials: Array.isArray(parsed.credentials) ? parsed.credentials.filter(isStoredCredential) : []
      };
    } catch {
      await this.persist();
    }
  }

  list(): AiCredentialSummary[] {
    return this.state.credentials.map(toSummary);
  }

  async set(providerId: string, value: string, label?: string): Promise<AiCredentialSummary> {
    const now = Date.now();
    const existing = this.state.credentials.find((item) => item.providerId === providerId);
    const next: StoredCredential = {
      keyRef: existing?.keyRef ?? `ai:${providerId}:${randomUUID()}`,
      providerId,
      label,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...encryptSecret(value)
    };
    this.state.credentials = [
      next,
      ...this.state.credentials.filter((item) => item.keyRef !== next.keyRef && item.providerId !== providerId)
    ];
    await this.persist();
    return toSummary(next);
  }

  async delete(keyRef: string): Promise<{ ok: boolean }> {
    const before = this.state.credentials.length;
    this.state.credentials = this.state.credentials.filter((item) => item.keyRef !== keyRef);
    if (this.state.credentials.length !== before) {
      await this.persist();
    }
    return { ok: this.state.credentials.length !== before };
  }

  getSecret(keyRef: string | undefined): string | undefined {
    if (!keyRef) {
      return undefined;
    }
    const credential = this.state.credentials.find((item) => item.keyRef === keyRef);
    if (!credential) {
      return undefined;
    }
    return decryptSecret(credential);
  }

  private async persist(): Promise<void> {
    const publicState: CredentialState = {
      credentials: this.state.credentials
    };
    await writeFile(this.credentialsPath, `${JSON.stringify(publicState, null, 2)}\n`, "utf8");
  }
}

function encryptSecret(secret: string): Pick<StoredCredential, "encoding" | "value"> {
  if (safeStorage?.isEncryptionAvailable?.()) {
    return {
      encoding: "safe-storage",
      value: safeStorage.encryptString(secret).toString("base64")
    };
  }
  return {
    encoding: "base64",
    value: Buffer.from(secret, "utf8").toString("base64")
  };
}

function decryptSecret(credential: StoredCredential): string | undefined {
  try {
    const bytes = Buffer.from(credential.value, "base64");
    if (credential.encoding === "safe-storage" && safeStorage?.isEncryptionAvailable?.()) {
      return safeStorage.decryptString(bytes);
    }
    if (credential.encoding === "base64") {
      return bytes.toString("utf8");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toSummary(credential: StoredCredential): AiCredentialSummary {
  return {
    keyRef: credential.keyRef,
    providerId: credential.providerId,
    label: credential.label,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt
  };
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const credential = value as Partial<StoredCredential>;
  return (
    typeof credential.keyRef === "string" &&
    typeof credential.providerId === "string" &&
    (credential.label === undefined || typeof credential.label === "string") &&
    typeof credential.createdAt === "number" &&
    typeof credential.updatedAt === "number" &&
    (credential.encoding === "safe-storage" || credential.encoding === "base64") &&
    typeof credential.value === "string"
  );
}
