import { useEffect, useRef, useState } from "react";

import type { OpenDocumentTab } from "../../app/types";

export type ClosedDocumentRef = Pick<OpenDocumentTab, "pathRel" | "mode" | "sourceKind" | "filePath">;

export function selectActiveDocument(documents: OpenDocumentTab[], activePathRel?: string): OpenDocumentTab | undefined {
  return documents.find((document) => document.pathRel === activePathRel) ?? documents[0];
}

export function updateDocumentByPath(
  documents: OpenDocumentTab[],
  pathRel: string,
  updater: (document: OpenDocumentTab) => OpenDocumentTab
): OpenDocumentTab[] {
  return documents.map((document) => (document.pathRel === pathRel ? updater(document) : document));
}

export function useDocumentSession() {
  const [openDocs, setOpenDocs] = useState<OpenDocumentTab[]>([]);
  const [activePathRel, setActivePathRel] = useState<string | undefined>();
  const openDocsRef = useRef(openDocs);
  const recentlyClosedRef = useRef<ClosedDocumentRef[]>([]);

  useEffect(() => {
    openDocsRef.current = openDocs;
  }, [openDocs]);

  const updateOpenDocs = (updater: (documents: OpenDocumentTab[]) => OpenDocumentTab[]) => {
    setOpenDocs((documents) => {
      const next = updater(documents);
      openDocsRef.current = next;
      return next;
    });
  };

  const updateOpenDocument = (pathRel: string, updater: (document: OpenDocumentTab) => OpenDocumentTab) => {
    updateOpenDocs((documents) => updateDocumentByPath(documents, pathRel, updater));
  };

  const recordClosedDocument = (document: OpenDocumentTab) => {
    const closed = { pathRel: document.pathRel, mode: document.mode, sourceKind: document.sourceKind, filePath: document.filePath };
    recentlyClosedRef.current = [closed, ...recentlyClosedRef.current.filter((item) => item.pathRel !== document.pathRel)].slice(0, 20);
  };

  const takeRecentlyClosedDocument = (): ClosedDocumentRef | undefined => recentlyClosedRef.current.shift();

  const replaceRecentlyClosedDocuments = (documents: ClosedDocumentRef[]) => {
    recentlyClosedRef.current = documents.slice(0, 20);
  };

  return {
    openDocs,
    openDocsRef,
    activePathRel,
    setActivePathRel,
    currentDocument: () => selectActiveDocument(openDocs, activePathRel),
    currentDocumentFromRef: () => selectActiveDocument(openDocsRef.current, activePathRel),
    updateOpenDocs,
    updateOpenDocument,
    recentlyClosedRef,
    recordClosedDocument,
    takeRecentlyClosedDocument,
    replaceRecentlyClosedDocuments
  };
}
