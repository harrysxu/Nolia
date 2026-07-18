import { wrap, type Remote } from "comlink";

import { parseMarkdown, renderMarkdownToHtml } from "../../shared/markdown";
import type { ParsedDocument } from "../../shared/types";
import type { MarkdownWorkerApi } from "../workers/markdown.worker";

let worker: Worker | undefined;
let remote: Remote<MarkdownWorkerApi> | undefined;

function client(): Remote<MarkdownWorkerApi> | undefined {
  if (typeof Worker === "undefined") {
    return undefined;
  }
  if (!remote) {
    worker = new Worker(new URL("../workers/markdown.worker.ts", import.meta.url), { type: "module", name: "nolia-markdown" });
    remote = wrap<MarkdownWorkerApi>(worker);
  }
  return remote;
}

export async function parseMarkdownOffThread(content: string, pathRel: string, signal?: AbortSignal): Promise<ParsedDocument> {
  const requestId = crypto.randomUUID();
  const markdownClient = client();
  if (!markdownClient) {
    return parseMarkdown(content, pathRel);
  }
  const abort = () => void markdownClient.cancel(requestId);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await markdownClient.parse({ requestId, pathRel, content });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function renderMarkdownOffThread(content: string, signal?: AbortSignal): Promise<string> {
  const requestId = crypto.randomUUID();
  const markdownClient = client();
  if (!markdownClient) {
    return renderMarkdownToHtml(content);
  }
  const abort = () => void markdownClient.cancel(requestId);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await markdownClient.render({ requestId, content });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export function disposeMarkdownWorker(): void {
  worker?.terminate();
  worker = undefined;
  remote = undefined;
}
