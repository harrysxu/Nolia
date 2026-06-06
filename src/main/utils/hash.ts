import { createHash } from "node:crypto";

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sha256Buffer(content: Buffer | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
