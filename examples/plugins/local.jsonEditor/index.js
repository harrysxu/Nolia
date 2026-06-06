const DEFAULT_INDENT = 2;

export function activate(context) {
  context.api.ui.registerFileEditor("local.jsonEditor.editor", (file) => {
    let lastValidValue = undefined;
    let indent = DEFAULT_INDENT;

    const root = document.createElement("div");
    root.setAttribute("data-testid", "json-editor-plugin");
    root.style.height = "100%";
    root.style.minHeight = "0";
    root.style.display = "grid";
    root.style.gridTemplateRows = "auto minmax(0, 1fr) auto";
    root.style.background = "var(--bg, #f7f8fb)";
    root.style.color = "var(--text, #1f2937)";

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.flexWrap = "wrap";
    toolbar.style.alignItems = "center";
    toolbar.style.gap = "8px";
    toolbar.style.padding = "10px 12px";
    toolbar.style.borderBottom = "1px solid var(--border, rgba(148, 163, 184, 0.3))";
    toolbar.style.background = "var(--panel, #ffffff)";

    const title = document.createElement("strong");
    title.textContent = "JSON 编辑器";
    title.style.marginRight = "auto";
    title.style.fontSize = "13px";

    const indentSelect = document.createElement("select");
    indentSelect.setAttribute("aria-label", "缩进");
    indentSelect.style.height = "30px";
    indentSelect.style.border = "1px solid var(--border, rgba(148, 163, 184, 0.45))";
    indentSelect.style.borderRadius = "6px";
    indentSelect.style.background = "var(--control-bg, #ffffff)";
    indentSelect.style.color = "inherit";
    for (const option of [
      ["2", "2 空格"],
      ["4", "4 空格"],
      ["tab", "Tab"]
    ]) {
      const node = document.createElement("option");
      node.value = option[0];
      node.textContent = option[1];
      indentSelect.append(node);
    }
    indentSelect.addEventListener("change", () => {
      indent = indentSelect.value === "tab" ? "\t" : Number(indentSelect.value);
    });

    const validateButton = createButton("校验");
    const formatButton = createButton("格式化");
    const sortButton = createButton("排序键");
    const minifyButton = createButton("压缩");
    const reloadButton = createButton("重新读取");

    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "JSON 内容");
    textarea.spellcheck = false;
    textarea.value = file.initialText ?? "";
    textarea.style.width = "100%";
    textarea.style.height = "100%";
    textarea.style.minHeight = "0";
    textarea.style.boxSizing = "border-box";
    textarea.style.resize = "none";
    textarea.style.border = "0";
    textarea.style.outline = "0";
    textarea.style.padding = "16px";
    textarea.style.background = "var(--editor-bg, #ffffff)";
    textarea.style.color = "inherit";
    textarea.style.font = "13px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    textarea.style.tabSize = "2";

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.alignItems = "center";
    footer.style.gap = "12px";
    footer.style.minHeight = "36px";
    footer.style.padding = "7px 12px";
    footer.style.borderTop = "1px solid var(--border, rgba(148, 163, 184, 0.3))";
    footer.style.background = "var(--panel, #ffffff)";
    footer.style.fontSize = "12px";

    const status = document.createElement("span");
    status.setAttribute("data-testid", "json-editor-status");
    status.textContent = "未校验";
    status.style.fontWeight = "700";

    const detail = document.createElement("span");
    detail.setAttribute("data-testid", "json-editor-detail");
    detail.style.color = "var(--muted, #64748b)";
    detail.style.overflow = "hidden";
    detail.style.textOverflow = "ellipsis";
    detail.style.whiteSpace = "nowrap";

    const position = document.createElement("span");
    position.style.marginLeft = "auto";
    position.style.color = "var(--muted, #64748b)";

    toolbar.append(title, indentSelect, validateButton, formatButton, sortButton, minifyButton, reloadButton);
    footer.append(status, detail, position);
    root.append(toolbar, textarea, footer);

    textarea.addEventListener("input", () => {
      file.updateText(textarea.value);
      setNeutral("已修改", `${textarea.value.length} 字符`);
      updatePosition();
    });
    textarea.addEventListener("click", updatePosition);
    textarea.addEventListener("keyup", updatePosition);
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      insertAtCursor(textarea, indent === "\t" ? "\t" : " ".repeat(Number(indent)));
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    validateButton.addEventListener("click", () => {
      try {
        validateCurrent();
      } catch (error) {
        setError(error);
      }
    });
    formatButton.addEventListener("click", () => {
      transformJson((value) => JSON.stringify(value, null, indent), "已格式化");
    });
    sortButton.addEventListener("click", () => {
      transformJson((value) => JSON.stringify(sortJsonKeys(value), null, indent), "已排序键");
    });
    minifyButton.addEventListener("click", () => {
      transformJson((value) => JSON.stringify(value), "已压缩");
    });
    reloadButton.addEventListener("click", async () => {
      try {
        const content = await file.readText();
        textarea.value = content;
        file.updateText(content, { dirty: false });
        validateCurrent("已重新读取");
      } catch (error) {
        setError(error);
      }
    });
    try {
      validateCurrent();
    } catch (error) {
      setError(error);
    }
    updatePosition();
    return root;

    function validateCurrent(successMessage = "JSON 有效") {
      const value = JSON.parse(textarea.value || "null");
      lastValidValue = value;
      setOk(successMessage, `${textarea.value.length} 字符`);
      return value;
    }

    function transformJson(transform, message) {
      try {
        const value = validateCurrent();
        textarea.value = transform(value);
        file.updateText(textarea.value);
        validateCurrent(message);
        updatePosition();
      } catch (error) {
        setError(error);
      }
    }

    function setOk(message, extra) {
      status.textContent = message;
      status.style.color = "var(--accent-strong, #2563eb)";
      detail.textContent = extra ?? "";
    }

    function setNeutral(message, extra) {
      status.textContent = message;
      status.style.color = "var(--muted, #64748b)";
      detail.textContent = extra ?? "";
    }

    function setError(error) {
      status.textContent = "JSON 无效";
      status.style.color = "var(--danger, #dc2626)";
      detail.textContent = error instanceof Error ? error.message : String(error);
    }

    function updatePosition() {
      const beforeCursor = textarea.value.slice(0, textarea.selectionStart);
      const lines = beforeCursor.split("\n");
      const line = lines.length;
      const column = lines[lines.length - 1].length + 1;
      const type = lastValidValue === undefined ? "未知" : Array.isArray(lastValidValue) ? "数组" : lastValidValue === null ? "null" : typeof lastValidValue === "object" ? "对象" : typeof lastValidValue;
      position.textContent = `${type} · 第 ${line} 行，第 ${column} 列`;
    }
  });
}

function createButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.height = "30px";
  button.style.padding = "0 10px";
  button.style.border = "1px solid var(--border, rgba(148, 163, 184, 0.45))";
  button.style.borderRadius = "6px";
  button.style.background = "var(--control-bg, #ffffff)";
  button.style.color = "inherit";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  return button;
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = sortJsonKeys(value[key]);
      return result;
    }, {});
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
}
