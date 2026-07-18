import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface PerformanceLogOptions {
  maxBytes?: number;
  maxFiles?: number;
}

export class PerformanceLogService {
  readonly logRoot: string;
  readonly logFilePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private writeQueue = Promise.resolve();

  constructor(userDataPath: string, options: PerformanceLogOptions = {}) {
    this.logRoot = path.join(userDataPath, "metrics");
    this.logFilePath = path.join(this.logRoot, "performance.jsonl");
    this.maxBytes = options.maxBytes ?? 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 4;
  }

  async init(): Promise<void> {
    await mkdir(this.logRoot, { recursive: true });
  }

  record(operation: string, durationMs: number, meta?: Record<string, string | number | boolean | undefined>): void {
    const payload = JSON.stringify({ ts: new Date().toISOString(), operation, durationMs: Math.max(0, Math.round(durationMs * 100) / 100), meta: cleanMeta(meta) });
    this.writeQueue = this.writeQueue.then(() => this.append(`${payload}\n`)).catch(() => undefined);
  }

  async measure<T>(operation: string, run: () => T | Promise<T>, meta?: () => Record<string, string | number | boolean | undefined>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await run();
    } finally {
      this.record(operation, performance.now() - startedAt, meta?.());
    }
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async append(line: string): Promise<void> {
    const size = await stat(this.logFilePath).then((entry) => entry.size).catch(() => 0);
    if (size + Buffer.byteLength(line) > this.maxBytes) await this.rotate();
    await appendFile(this.logFilePath, line, "utf8");
  }

  private async rotate(): Promise<void> {
    await rm(`${this.logFilePath}.${this.maxFiles}`, { force: true });
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      await rename(`${this.logFilePath}.${index}`, `${this.logFilePath}.${index + 1}`).catch(() => undefined);
    }
    await rename(this.logFilePath, `${this.logFilePath}.1`).catch(() => undefined);
  }
}

function cleanMeta(meta: Record<string, string | number | boolean | undefined> | undefined): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  return Object.fromEntries(Object.entries(meta).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined));
}
