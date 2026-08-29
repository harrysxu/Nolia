import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Pencil, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

import { useRendererI18n } from "../app/i18n";

export interface DiagramViewerContent {
  svg: string;
  markdown?: string;
  name?: string;
  onEdit?: () => void;
  initialScale?: number;
}

interface DiagramViewerProps {
  content: DiagramViewerContent;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

export function DiagramViewer({ content, onClose }: DiagramViewerProps) {
  const { tr } = useRendererI18n();
  const [scale, setScale] = useState(() => clampScale(content.initialScale ?? 1));
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | undefined>(undefined);

  const changeScale = (nextScale: number | ((value: number) => number)) => {
    setScale((value) => clampScale(typeof nextScale === "function" ? nextScale(value) : nextScale));
    setPan({ x: 0, y: 0 });
  };

  const clampPan = (x: number, y: number) => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) {
      return { x, y };
    }
    const maxX = Math.max(0, canvas.offsetWidth - viewport.clientWidth);
    const maxY = Math.max(0, canvas.offsetHeight - viewport.clientHeight);
    return {
      x: Math.min(0, Math.max(-maxX, x)),
      y: Math.min(0, Math.max(-maxY, y))
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setIsPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setPan(clampPan(drag.panX + event.clientX - drag.startX, drag.panY + event.clientY - drag.startY));
  };

  const stopPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  };

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeScale((value) => value + SCALE_STEP);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        changeScale((value) => value - SCALE_STEP);
        return;
      }
      const isEditShortcut = event.key === "F2" || (event.key.toLowerCase() === "e" && !event.metaKey && !event.ctrlKey && !event.altKey) || ((event.metaKey || event.ctrlKey) && event.key === "Enter");
      if (content.onEdit && isEditShortcut) {
        event.preventDefault();
        onClose();
        content.onEdit();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [content, onClose]);

  const downloadPng = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadDiagramPng(content.svg, pngFileName(content.name));
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div className="diagram-viewer-layer" role="dialog" aria-modal="true" aria-labelledby="diagram-viewer-title" aria-keyshortcuts={content.onEdit ? "F2 E Control+Enter Meta+Enter" : undefined}>
      <button type="button" className="diagram-viewer-backdrop" aria-label={tr("关闭图表查看器")} onClick={onClose} />
      <section className="diagram-viewer-surface">
        <header className="diagram-viewer-header">
          <strong id="diagram-viewer-title">{tr("图表预览")}</strong>
          <div className="diagram-viewer-toolbar" role="toolbar" aria-label={tr("图表操作")}>
            <button type="button" className="icon-button" title={tr("缩小图表")} aria-label={tr("缩小图表")} disabled={scale <= MIN_SCALE} onClick={() => changeScale(scale - SCALE_STEP)}>
              <ZoomOut size={17} />
            </button>
            <span className="diagram-viewer-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" className="icon-button" title={tr("恢复图表比例")} aria-label={tr("恢复图表比例")} disabled={scale === 1 && pan.x === 0 && pan.y === 0} onClick={() => changeScale(1)}>
              <RotateCcw size={17} />
            </button>
            <button type="button" className="icon-button" title={tr("放大图表")} aria-label={tr("放大图表")} disabled={scale >= MAX_SCALE} onClick={() => changeScale(scale + SCALE_STEP)}>
              <ZoomIn size={17} />
            </button>
            <span className="diagram-viewer-divider" aria-hidden="true" />
            <button type="button" className="icon-button" title={tr("下载 PNG 图片")} aria-label={tr("下载 PNG 图片")} disabled={downloading} onClick={() => void downloadPng()}>
              <Download size={17} />
            </button>
            {content.onEdit ? (
              <button type="button" className="icon-button" title={tr("编辑图表源码")} aria-label={tr("编辑图表源码")} onClick={() => {
                onClose();
                content.onEdit?.();
              }}>
                <Pencil size={17} />
              </button>
            ) : null}
            <button ref={closeButtonRef} type="button" className="icon-button" title={tr("关闭图表查看器")} aria-label={tr("关闭图表查看器")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        {downloadError ? <div className="diagram-viewer-error" role="status">{tr("图表下载失败，请重试。")}</div> : null}
        <div
          ref={viewportRef}
          className={`diagram-viewer-viewport${isPanning ? " is-panning" : ""}`}
          aria-label={tr("查看图表")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointerDrag}
          onPointerCancel={stopPointerDrag}
        >
          <div ref={canvasRef} className="diagram-viewer-canvas" style={{ width: `${scale * 100}%`, transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}>
            <div className="diagram-viewer-diagram" dangerouslySetInnerHTML={{ __html: content.svg }} />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function pngFileName(name: string | undefined): string {
  const normalized = (name ?? "nolia-diagram")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  return `${normalized || "nolia-diagram"}.png`;
}

export async function downloadDiagramPng(svgMarkup: string, fileName: string): Promise<void> {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = documentNode.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || documentNode.querySelector("parsererror")) {
    throw new Error("Invalid SVG");
  }
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const dimensions = svgDimensions(svg);
  const outputScale = Math.min(2, 4096 / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * outputScale));
  const height = Math.max(1, Math.round(dimensions.height * outputScale));
  const serialized = new XMLSerializer().serializeToString(svg);
  const sourceUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable");
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    triggerDownload(blob, fileName);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function svgDimensions(svg: Element): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : undefined;
  const width = numericSvgLength(svg.getAttribute("width")) ?? viewBoxWidth ?? 1600;
  const height = numericSvgLength(svg.getAttribute("height")) ?? viewBoxHeight ?? 900;
  return {
    width: Math.max(1, Math.min(8192, width)),
    height: Math.max(1, Math.min(8192, height))
  };
}

function numericSvgLength(value: string | null): number | undefined {
  if (!value || value.trim().endsWith("%")) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Diagram image load failed"));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Diagram image export failed"));
      }
    }, "image/png");
  });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
