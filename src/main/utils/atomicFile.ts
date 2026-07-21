import { rename } from "node:fs/promises";

const TRANSIENT_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function replaceFileWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  let delayMs = 20;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
      if (!code || !TRANSIENT_RENAME_ERRORS.has(code) || attempt === 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}
