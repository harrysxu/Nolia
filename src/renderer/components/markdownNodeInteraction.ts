import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type MarkdownNodeInteractionElements = {
  wrapper: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
  view: EditorView;
  getPos: () => number | undefined;
  setEditing: (editing: boolean, focusInput?: boolean) => void;
  focusInputOnSelect?: boolean;
  onOpenModifiedClick?: (event: MouseEvent) => void;
  hasBlockingError?: () => boolean;
  clearTransientError?: () => void;
};

export function wireMarkdownNodeInteraction({
  wrapper,
  input,
  view,
  getPos,
  setEditing,
  focusInputOnSelect = true,
  onOpenModifiedClick,
  hasBlockingError = () => false,
  clearTransientError
}: MarkdownNodeInteractionElements) {
  const selectNode = () => {
    const pos = getPos();
    if (typeof pos !== "number") {
      return false;
    }
    const transaction = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos));
    view.dispatch(transaction);
    view.focus();
    return true;
  };

  const enterEditing = () => setEditing(true, true);
  const selectAndRevealSource = () => {
    selectNode();
    setEditing(true, focusInputOnSelect);
  };
  const closeWhenFocusLeaves = () => {
    window.setTimeout(() => {
      if (wrapper.contains(document.activeElement)) {
        return;
      }
      if (hasBlockingError()) {
        setEditing(true);
        return;
      }
      setEditing(false);
    }, 0);
  };

  wrapper.addEventListener("mousedown", (event) => {
    if (input.contains(event.target as globalThis.Node)) {
      return;
    }
    if (onOpenModifiedClick && isModifiedOpenClick(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectAndRevealSource();
  });
  wrapper.addEventListener("click", (event) => {
    if (input.contains(event.target as globalThis.Node)) {
      return;
    }
    if (onOpenModifiedClick && isModifiedOpenClick(event)) {
      event.preventDefault();
      event.stopPropagation();
      onOpenModifiedClick(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectAndRevealSource();
  });
  wrapper.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    enterEditing();
  });
  wrapper.addEventListener("focus", () => selectAndRevealSource());
  wrapper.addEventListener("blur", closeWhenFocusLeaves);
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      enterEditing();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      clearTransientError?.();
      setEditing(false);
      view.focus();
    }
  });

  input.addEventListener("focus", () => setEditing(true));
  input.addEventListener("blur", closeWhenFocusLeaves);

  return { selectNode, enterEditing };
}

export function isModifiedOpenClick(event: MouseEvent): boolean {
  return event.button === 0 && (event.metaKey || event.ctrlKey);
}
