import type { DocumentRevision } from "../../../shared/contracts";

export function createDocumentRevision(documentId: string, pathRel: string, diskHash: string, readOnly = false): DocumentRevision {
  return { documentId, pathRel, revision: 0, parsedRevision: 0, baseHash: diskHash, diskHash, saveState: readOnly ? "readonly" : "clean" };
}

export function editDocumentRevision(state: DocumentRevision, draftHash?: string): DocumentRevision {
  if (state.saveState === "readonly") return { ...state, revision: state.revision + 1, draftHash };
  return { ...state, revision: state.revision + 1, draftHash, saveState: "dirty" };
}

export function beginDocumentSave(state: DocumentRevision): DocumentRevision {
  if (state.saveState === "readonly") return state;
  return { ...state, saveState: "saving" };
}

export function completeDocumentSave(state: DocumentRevision, savedRevision: number, diskHash: string): DocumentRevision {
  if (savedRevision !== state.revision) return { ...state, diskHash, baseHash: diskHash, saveState: "dirty" };
  return { ...state, diskHash, baseHash: diskHash, draftHash: undefined, saveState: "clean" };
}

export function failDocumentSave(state: DocumentRevision, reason: "conflict" | "missing" | "error"): DocumentRevision {
  return { ...state, saveState: reason };
}

export function applyParsedRevision(state: DocumentRevision, parsedRevision: number): DocumentRevision {
  return parsedRevision < state.revision ? state : { ...state, parsedRevision };
}
