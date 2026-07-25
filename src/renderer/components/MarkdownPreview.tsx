import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { normalizeCodeBlockLanguage } from "../../shared/codeBlockLanguages";
import type { Translator } from "../../shared/i18n";
import { useRendererI18n } from "../app/i18n";
import { renderMermaidSvg } from "../services/mermaidRenderer";
import { getCodeBlockLanguageSelectOptions } from "./codeBlockLanguageSelect";
import { DiagramViewer, type DiagramViewerContent } from "./DiagramViewer";

interface MarkdownPreviewProps {
  html: string;
  renderDiagrams?: boolean;
  onMermaidEdit?: (diagram: MarkdownPreviewDiagramClick) => void;
  onCodeLanguageChange?: (change: MarkdownPreviewCodeLanguageChange) => void;
}

export interface MarkdownPreviewDiagramClick {
  index: number;
  markdown?: string;
}

export interface MarkdownPreviewCodeLanguageChange {
  index: number;
  language: string;
}

export function MarkdownPreview({ html, renderDiagrams = true, onMermaidEdit, onCodeLanguageChange }: MarkdownPreviewProps) {
  const { tr } = useRendererI18n();
  const previewRef = useRef<HTMLDivElement>(null);
  const [diagramViewer, setDiagramViewer] = useState<DiagramViewerContent | undefined>();
  const canEditMermaid = Boolean(onMermaidEdit);

  useEffect(() => {
    const root = previewRef.current;
    if (!root || !renderDiagrams) {
      return;
    }
    const diagrams = Array.from(root.querySelectorAll<HTMLElement>(".mermaid")).filter(
      (element) => element.dataset.rendered !== "true" && !element.classList.contains("is-error")
    );
    if (!diagrams.length) {
      return;
    }
    diagrams.forEach((diagram) => prepareDiagramInteraction(diagram, tr(canEditMermaid ? "编辑图表源码" : "查看图表")));
    let canceled = false;
    void renderMermaidDiagrams(diagrams, () => canceled).then(() => {
      if (!canceled) {
        diagrams.forEach((diagram) => prepareDiagramInteraction(diagram, tr(canEditMermaid ? "编辑图表源码" : "查看图表")));
      }
    });
    return () => {
      canceled = true;
    };
  }, [canEditMermaid, html, renderDiagrams, tr]);

  useEffect(() => {
    setDiagramViewer(undefined);
  }, [html]);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) {
      return;
    }
    return attachCodeLanguageControls(root, tr, onCodeLanguageChange);
  }, [html, onCodeLanguageChange, tr]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(".code-language-select")) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    const diagram = event.target.closest<HTMLElement>(".mermaid");
    const root = previewRef.current;
    if (!diagram || !root?.contains(diagram)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const location = diagramLocation(root, diagram);
    if (event.metaKey || event.ctrlKey) {
      openDiagramViewer(diagram, location);
    } else if (onMermaidEdit) {
      onMermaidEdit(location);
    } else {
      diagram.focus({ preventScroll: true });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const diagram = event.target.closest<HTMLElement>(".mermaid");
    const root = previewRef.current;
    if (!diagram || !root?.contains(diagram)) {
      return;
    }
    const location = diagramLocation(root, diagram);
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      openDiagramViewer(diagram, location);
      return;
    }
    if (event.key === "F2" || (event.key.toLowerCase() === "e" && !event.metaKey && !event.ctrlKey && !event.altKey)) {
      if (!onMermaidEdit) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onMermaidEdit(location);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (onMermaidEdit) {
      onMermaidEdit(location);
    } else {
      openDiagramViewer(diagram, location);
    }
  };

  const openDiagramViewer = (diagram: HTMLElement, location: MarkdownPreviewDiagramClick) => {
    const svg = diagram.querySelector<SVGElement>("svg")?.outerHTML;
    if (!svg) {
      return;
    }
    setDiagramViewer({
      svg,
      markdown: location.markdown,
      initialScale: 1.25,
      onEdit: onMermaidEdit ? () => onMermaidEdit(location) : undefined
    });
  };

  return (
    <Fragment>
      <div ref={previewRef} className="markdown-preview" onClick={handleClick} onKeyDown={handleKeyDown} dangerouslySetInnerHTML={{ __html: html }} />
      {diagramViewer ? <DiagramViewer content={diagramViewer} onClose={() => setDiagramViewer(undefined)} /> : null}
    </Fragment>
  );
}

function prepareDiagramInteraction(diagram: HTMLElement, label: string) {
  diagram.tabIndex = 0;
  diagram.setAttribute("role", "button");
  diagram.setAttribute("aria-label", label);
  diagram.setAttribute("aria-keyshortcuts", "Enter Space F2 E Control+Enter Meta+Enter");
  diagram.title = label;
}

function diagramLocation(root: HTMLElement, diagram: HTMLElement): MarkdownPreviewDiagramClick {
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
  return {
    index: diagrams.indexOf(diagram),
    markdown: diagram.dataset.markdown
  };
}

function attachCodeLanguageControls(
  root: HTMLElement,
  tr: Translator,
  onCodeLanguageChange: ((change: MarkdownPreviewCodeLanguageChange) => void) | undefined
): () => void {
  root.querySelectorAll(".code-language-select").forEach((control) => control.remove());
  const codeBlocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre[data-code-block='true'], pre[data-language]"));
  const controls: HTMLSelectElement[] = [];
  codeBlocks.forEach((pre, index) => {
    const language = normalizeCodeBlockLanguage(pre.dataset.language ?? languageFromCodeElement(pre));
    const select = root.ownerDocument.createElement("select");
    select.className = "code-language-select";
    select.title = tr("代码语言");
    select.setAttribute("aria-label", tr("代码语言"));
    select.addEventListener("mousedown", stopPreviewControlEvent);
    select.addEventListener("click", stopPreviewControlEvent);
    select.addEventListener("change", (event) => {
      event.stopPropagation();
      const target = event.currentTarget;
      if (target instanceof HTMLSelectElement) {
        onCodeLanguageChange?.({ index, language: target.value });
      }
    });
    getCodeBlockLanguageSelectOptions(language, tr).forEach((option) => {
      const optionElement = root.ownerDocument.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      select.append(optionElement);
    });
    select.value = language;
    pre.append(select);
    controls.push(select);
  });
  return () => {
    controls.forEach((control) => control.remove());
  };
}

function stopPreviewControlEvent(event: Event) {
  event.stopPropagation();
}

function languageFromCodeElement(pre: HTMLPreElement): string | undefined {
  const code = pre.querySelector("code");
  const className = Array.from(code?.classList ?? []).find((value) => value.startsWith("language-"));
  return className?.replace(/^language-/, "");
}

async function renderMermaidDiagrams(elements: HTMLElement[], isCanceled: () => boolean) {
  if (isCanceled()) {
    return;
  }
  await Promise.all(
    elements.map(async (element) => {
      const source = element.textContent ?? "";
      if (!source.trim() || isCanceled()) {
        return;
      }
      try {
        const svg = await renderMermaidSvg(source, "nolia-mermaid");
        if (isCanceled()) {
          return;
        }
        element.innerHTML = svg;
        element.dataset.rendered = "true";
      } catch (error) {
        if (isCanceled()) {
          return;
        }
        markMermaidRenderError(element, error);
      }
    })
  );
}

function markMermaidRenderError(element: HTMLElement, error: unknown) {
  element.classList.add("is-error");
  element.textContent = error instanceof Error ? error.message : "Mermaid render failed";
}
