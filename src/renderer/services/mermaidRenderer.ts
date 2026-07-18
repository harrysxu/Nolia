import mermaid from "mermaid";

let renderSequence = 0;
let configuredTheme: "default" | "dark" | undefined;
let renderQueue: Promise<void> = Promise.resolve();

// Mermaid keeps parser/render state at module scope, so render calls must not overlap.
export function renderMermaidSvg(source: string, idPrefix: string): Promise<string> {
  const job = renderQueue.then(async () => {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      throw new Error("Mermaid diagram is empty");
    }
    const theme = document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.theme === "technical" ? "dark" : "default";
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme,
        htmlLabels: false,
        flowchart: {
          htmlLabels: false
        }
      });
      configuredTheme = theme;
    }
    const id = `${idPrefix}-${++renderSequence}`;
    return (await mermaid.render(id, normalizedSource)).svg;
  });
  renderQueue = job.then(() => undefined, () => undefined);
  return job;
}
