import { useEffect, useRef, type MouseEvent } from "react";
import mermaid from "mermaid";

import { normalizeCodeBlockLanguage } from "../../shared/codeBlockLanguages";
import type { Translator } from "../../shared/i18n";
import { useRendererI18n } from "../app/i18n";
import { getCodeBlockLanguageSelectOptions } from "./codeBlockLanguageSelect";

interface MarkdownPreviewProps {
  html: string;
  onMermaidClick?: (diagram: MarkdownPreviewDiagramClick) => void;
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

export function MarkdownPreview({ html, onMermaidClick, onCodeLanguageChange }: MarkdownPreviewProps) {
  const { tr } = useRendererI18n();
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) {
      return;
    }
    const diagrams = Array.from(root.querySelectorAll<HTMLElement>(".mermaid")).filter(
      (element) => element.dataset.rendered !== "true" && !element.classList.contains("is-error")
    );
    if (!diagrams.length) {
      return;
    }
    let canceled = false;
    void renderMermaidDiagrams(diagrams, () => canceled);
    return () => {
      canceled = true;
    };
  });

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
    if (!onMermaidClick || !(event.target instanceof Element)) {
      return;
    }
    const diagram = event.target.closest<HTMLElement>(".mermaid");
    const root = previewRef.current;
    if (!diagram || !root?.contains(diagram)) {
      return;
    }
    event.preventDefault();
    const diagrams = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
    onMermaidClick({
      index: diagrams.indexOf(diagram),
      markdown: diagram.dataset.markdown
    });
  };

  return <div ref={previewRef} className="markdown-preview" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
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
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.theme === "technical" ? "dark" : "default"
    });
  } catch (error) {
    if (!isCanceled()) {
      elements.forEach((element) => markMermaidRenderError(element, error));
    }
    return;
  }
  await Promise.all(
    elements.map(async (element, index) => {
      const source = element.textContent ?? "";
      if (!source.trim() || isCanceled()) {
        return;
      }
      const id = `nolia-mermaid-${Date.now()}-${index}`;
      try {
        const { svg } = await mermaid.render(id, source);
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
