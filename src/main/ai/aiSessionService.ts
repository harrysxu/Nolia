import { randomUUID } from "node:crypto";

import type { AiRunStatus } from "../../shared/ai";

interface AiRunSession {
  runId: string;
  controller: AbortController;
  status: AiRunStatus;
}

export class AiSessionService {
  private readonly sessions = new Map<string, AiRunSession>();

  create(): AiRunSession {
    const runId = randomUUID();
    const session = { runId, controller: new AbortController(), status: "queued" as AiRunStatus };
    this.sessions.set(runId, session);
    return session;
  }

  mark(runId: string, status: AiRunStatus): void {
    const session = this.sessions.get(runId);
    if (session) {
      session.status = status;
    }
  }

  cancel(runId: string): boolean {
    const session = this.sessions.get(runId);
    if (!session) {
      return false;
    }
    session.status = "cancelling";
    session.controller.abort();
    return true;
  }

  complete(runId: string): void {
    this.sessions.delete(runId);
  }
}
