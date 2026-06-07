import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveDiagnosticsLogRoot } from "../utils/platform";

export class DiagnosticsService {
  readonly logRoot: string;
  readonly logFilePath: string;

  constructor(homePath: string) {
    this.logRoot = resolveDiagnosticsLogRoot(homePath);
    this.logFilePath = path.join(this.logRoot, "nolia.log");
  }

  async init(): Promise<void> {
    await mkdir(this.logRoot, { recursive: true });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    void this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    void this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    void this.write("error", message, meta);
  }

  private async write(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): Promise<void> {
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      meta
    };
    await appendFile(this.logFilePath, `${JSON.stringify(payload)}\n`, "utf8");
  }
}
