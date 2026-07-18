import { expose } from "comlink";

import { parseMarkdown, renderMarkdownToHtml } from "../../shared/markdown";

const cancelled = new Set<string>();

const api = {
  async parse(request: { requestId: string; pathRel: string; content: string }) {
    if (cancelled.delete(request.requestId)) {
      throw new Error("Markdown request cancelled");
    }
    const result = parseMarkdown(request.content, request.pathRel);
    if (cancelled.delete(request.requestId)) {
      throw new Error("Markdown request cancelled");
    }
    return result;
  },
  async render(request: { requestId: string; content: string }) {
    if (cancelled.delete(request.requestId)) {
      throw new Error("Markdown request cancelled");
    }
    const result = await renderMarkdownToHtml(request.content);
    if (cancelled.delete(request.requestId)) {
      throw new Error("Markdown request cancelled");
    }
    return result;
  },
  cancel(requestId: string) {
    cancelled.add(requestId);
  }
};

export type MarkdownWorkerApi = typeof api;

expose(api);
