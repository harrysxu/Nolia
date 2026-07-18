import { once } from "node:events";

const GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;

export async function closeElectronApplication(application) {
  if (!application) return;
  const child = application.process();

  await withTimeout(
    application.evaluate(({ app }) => app.quit()),
    GRACEFUL_CLOSE_TIMEOUT_MS
  ).catch(() => undefined);
  await withTimeout(application.close(), GRACEFUL_CLOSE_TIMEOUT_MS).catch(() => undefined);
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  await withTimeout(once(child, "exit"), GRACEFUL_CLOSE_TIMEOUT_MS).catch(() => undefined);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await withTimeout(once(child, "exit"), GRACEFUL_CLOSE_TIMEOUT_MS).catch(() => undefined);
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Electron close timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
